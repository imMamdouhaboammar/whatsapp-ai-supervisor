import test from 'node:test';
import assert from 'node:assert/strict';
import { SupervisorOrchestrator } from '../src/core/orchestrator.js';
import { InMemoryAuditStore } from '../src/core/audit-store.js';

function setup({ shadowMode = false, modelDecision, rules }) {
  const sent = [];
  const gateway = { async decide() { return modelDecision; } };
  const sender = { async sendText(message) { sent.push(message); return { id: 'wamid.out' }; } };
  const audit = new InMemoryAuditStore();
  const tenant = {
    id: 'tenant-1',
    shadowMode,
    businessContext: { name: 'Demo Co' },
    ai: { route: 'standard', routes: { standard: [{ provider: 'fake', model: 'fake-model' }] } },
    policy: { minConfidence: 0.8, defaultAction: 'human', rules }
  };
  const orchestrator = new SupervisorOrchestrator({ modelGateway: gateway, channelSender: sender, auditStore: audit });
  return { orchestrator, tenant, sent, audit };
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
