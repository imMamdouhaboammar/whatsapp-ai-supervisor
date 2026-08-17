import test from 'node:test';
import assert from 'node:assert/strict';
import { SupervisorOrchestrator } from '../src/core/orchestrator.js';
import { InMemoryAuditStore } from '../src/core/audit-store.js';

function setup({ shadowMode = false, modelDecision, rules, actionGateway = null }) {
  const sent = [];
  const gatewayCalls = [];
  const gateway = { async decide(message, config) { gatewayCalls.push({ message, config }); return modelDecision; } };
  const sender = { async sendText(message) { sent.push(message); return { id: 'wamid.out' }; } };
  const audit = new InMemoryAuditStore();
  const tenant = {
    id: 'tenant-1',
    shadowMode,
    businessContext: { name: 'Demo Co' },
    ai: { route: 'standard', routes: { standard: [{ provider: 'fake', model: 'fake-model' }] } },
    policy: { minConfidence: 0.8, defaultAction: 'human', rules }
  };
  const orchestrator = new SupervisorOrchestrator({ modelGateway: gateway, channelSender: sender, auditStore: audit, actionGateway });
  return { orchestrator, tenant, sent, audit, gatewayCalls };
}

const inbound = { id: 'wamid.in', tenantId: 'tenant-1', customerId: '20100', text: 'hello', channel: 'whatsapp' };

test('shadow mode records what it would do but never sends', async () => {
  const { orchestrator, tenant, sent, audit } = setup({
    shadowMode: true,
    modelDecision: { intent: 'faq', confidence: 0.96, reply: 'Hi', requestedAction: 'reply' },
    rules: [{ id: 'faq', intent: 'faq', action: 'reply' }]
  });

  const result = await orchestrator.handle(inbound, tenant);
  assert.equal(result.action, 'shadow');
  assert.equal(result.wouldAction, 'reply');
  assert.equal(sent.length, 0);
  assert.equal(audit.list('tenant-1').length, 1);
});

test('model sees only non-sensitive capability metadata from policy', async () => {
  const { orchestrator, tenant, gatewayCalls } = setup({
    modelDecision: { intent: 'faq', confidence: 0.94, reply: 'ok', requestedAction: 'reply' },
    rules: [
      { id: 'faq', intent: 'faq', action: 'reply' },
      {
        id: 'order', intent: 'order_status', action: 'act',
        capability: { type: 'browser', task: 'Secret internal task', allowedDomains: ['portal.example.com'] }
      }
    ]
  });

  await orchestrator.handle(inbound, tenant);
  assert.deepEqual(gatewayCalls[0].config.availableCapabilities, [{ intent: 'order_status', type: 'browser' }]);
  assert.equal(JSON.stringify(gatewayCalls[0].config).includes('Secret internal task'), false);
  assert.equal(JSON.stringify(gatewayCalls[0].config).includes('portal.example.com'), false);
});

test('automatic reply sends only after deterministic policy permits it', async () => {
  const { orchestrator, tenant, sent } = setup({
    modelDecision: { intent: 'faq', confidence: 0.94, reply: 'We open at 9', requestedAction: 'reply' },
    rules: [{ id: 'faq', intent: 'faq', action: 'reply' }]
  });

  const result = await orchestrator.handle(inbound, tenant);
  assert.equal(result.action, 'reply');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { to: '20100', text: 'We open at 9', replyToId: 'wamid.in' });
});

test('human-only rule blocks outbound message', async () => {
  const { orchestrator, tenant, sent, audit } = setup({
    modelDecision: { intent: 'refund', confidence: 0.99, reply: 'I can refund it', requestedAction: 'reply' },
    rules: [{ id: 'refund', intent: 'refund', action: 'human' }]
  });

  const result = await orchestrator.handle(inbound, tenant);
  assert.equal(result.action, 'human');
  assert.equal(sent.length, 0);
  assert.equal(audit.list('tenant-1')[0].permission.reason, 'matched_rule');
});

test('every successful orchestration result is audited with model and policy decision', async () => {
  const { orchestrator, tenant, audit } = setup({
    modelDecision: { intent: 'pricing', confidence: 0.9, reply: 'Price is X', requestedAction: 'reply', model: 'gpt-5.6', provider: 'openai' },
    rules: [{ id: 'pricing', intent: 'pricing', action: 'draft' }]
  });

  await orchestrator.handle(inbound, tenant);
  const event = audit.list('tenant-1')[0];
  assert.equal(event.messageId, 'wamid.in');
  assert.equal(event.model.intent, 'pricing');
  assert.equal(event.permission.action, 'draft');
});

test('act permission executes only the capability attached to the matched policy rule', async () => {
  const calls = [];
  const actionGateway = {
    async execute(input) { calls.push(input); return { backend: 'browser', ok: true, output: 'order shipped' }; }
  };
  const rule = {
    id: 'order-status', intent: 'order_status', action: 'act',
    capability: { type: 'browser', task: 'Check order status', allowedDomains: ['portal.example.com'] }
  };
  const { orchestrator, tenant } = setup({
    modelDecision: { intent: 'order_status', confidence: 0.96, reply: '', requestedAction: 'act' },
    rules: [rule], actionGateway
  });

  const result = await orchestrator.handle(inbound, tenant);

  assert.equal(result.action, 'act');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].rule.id, 'order-status');
  assert.equal(calls[0].message.id, inbound.id);
  assert.equal(result.actionResult.output, 'order shipped');
});

test('act permission fails closed to human when no action gateway is available', async () => {
  const { orchestrator, tenant } = setup({
    modelDecision: { intent: 'order_status', confidence: 0.96, reply: '', requestedAction: 'act' },
    rules: [{ id: 'order-status', intent: 'order_status', action: 'act' }]
  });

  const result = await orchestrator.handle(inbound, tenant);
  assert.equal(result.action, 'human');
  assert.equal(result.reason, 'action_gateway_unavailable');
});

test('shadow mode never executes action gateway', async () => {
  let calls = 0;
  const actionGateway = { async execute() { calls += 1; return { ok: true }; } };
  const { orchestrator, tenant } = setup({
    shadowMode: true,
    modelDecision: { intent: 'order_status', confidence: 0.96, reply: '', requestedAction: 'act' },
    rules: [{ id: 'order-status', intent: 'order_status', action: 'act', capability: { type: 'browser', task: 'Check', allowedDomains: ['example.com'] } }],
    actionGateway
  });

  const result = await orchestrator.handle(inbound, tenant);
  assert.equal(result.action, 'shadow');
  assert.equal(result.wouldAction, 'act');
  assert.equal(calls, 0);
});
