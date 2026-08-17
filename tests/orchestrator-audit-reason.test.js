import test from 'node:test';
import assert from 'node:assert/strict';
import { SupervisorOrchestrator } from '../src/core/orchestrator.js';
import { InMemoryAuditStore } from '../src/core/audit-store.js';

test('failed action reason is persisted in audit for operator UI', async () => {
  const audit = new InMemoryAuditStore();
  const orchestrator = new SupervisorOrchestrator({
    modelGateway: { async decide() { return { intent: 'order_status', confidence: .99, reply: '', requestedAction: 'act' }; } },
    channelSender: { async sendText() { throw new Error('not used'); } },
    actionGateway: { async execute() { throw new Error('portal unavailable'); } },
    auditStore: audit,
    now: () => '2026-08-17T06:00:00.000Z'
  });
  const tenant = {
    id: 'acme',
    ai: {},
    policy: {
      minConfidence: .8,
      defaultAction: 'human',
      rules: [{ id: 'order', intent: 'order_status', action: 'act', capability: { type: 'browser' } }]
    }
  };
  await orchestrator.handle({ id: 'm1', customerId: 'c1', channel: 'whatsapp' }, tenant);
  assert.equal(audit.list('acme')[0].result.reason, 'action_failed');
});
