import test from 'node:test';
import assert from 'node:assert/strict';
import { SupervisorOrchestrator } from '../src/core/orchestrator.js';
import { InMemoryAuditStore } from '../src/core/audit-store.js';

const inbound = {
  id: 'in-1', tenantId: 'acme', customerId: '20100',
  text: 'hello', channel: 'whatsapp'
};

function tenant() {
  return {
    id: 'acme',
    ai: { route: 'standard', routes: {} },
    policy: { minConfidence: 0.8, defaultAction: 'human', rules: [{ id: 'faq', intent: 'faq', action: 'reply' }] }
  };
}

test('successful linked-device agent reply records platform attribution', async () => {
  const records = [];
  const orchestrator = new SupervisorOrchestrator({
    modelGateway: { async decide() { return { intent: 'faq', confidence: 0.99, reply: 'Hi', requestedAction: 'reply' }; } },
    channelSender: {
      async sendText() {
        return { id: 'out-1', platformMessageId: 'out-1', transport: 'linked-device', sessionId: 'acme-sales' };
      }
    },
    auditStore: new InMemoryAuditStore(),
    outboundAttributionStore: { async record(value) { records.push(value); return value; } },
    now: () => '2026-08-27T09:10:00.000Z'
  });

  const result = await orchestrator.handle(inbound, tenant());
  assert.equal(result.action, 'reply');
  assert.equal(records.length, 1);
  assert.equal(records[0].origin, 'agent');
  assert.equal(records[0].sessionId, 'acme-sales');
  assert.equal(records[0].platformMessageId, 'out-1');
  assert.equal(records[0].conversationId, 'whatsapp:20100');
  assert.equal(records[0].sourceMessageId, 'in-1');
});

test('cloud reply does not create linked-device attribution', async () => {
  let records = 0;
  const orchestrator = new SupervisorOrchestrator({
    modelGateway: { async decide() { return { intent: 'faq', confidence: 0.99, reply: 'Hi', requestedAction: 'reply' }; } },
    channelSender: { async sendText() { return { id: 'wamid.cloud' }; } },
    auditStore: new InMemoryAuditStore(),
    outboundAttributionStore: { async record() { records += 1; } }
  });
  await orchestrator.handle(inbound, tenant());
  assert.equal(records, 0);
});

test('attribution persistence failure never retries or converts a successful send into a second send attempt', async () => {
  let sends = 0;
  const orchestrator = new SupervisorOrchestrator({
    modelGateway: { async decide() { return { intent: 'faq', confidence: 0.99, reply: 'Hi', requestedAction: 'reply' }; } },
    channelSender: {
      async sendText() {
        sends += 1;
        return { id: 'out-1', platformMessageId: 'out-1', transport: 'linked-device', sessionId: 'acme-sales' };
      }
    },
    auditStore: new InMemoryAuditStore(),
    outboundAttributionStore: { async record() { throw new Error('private-storage-detail'); } }
  });

  const result = await orchestrator.handle(inbound, tenant());
  assert.equal(sends, 1);
  assert.equal(result.action, 'reply');
  assert.deepEqual(result.attribution, { recorded: false, reason: 'attribution_failed' });
});
