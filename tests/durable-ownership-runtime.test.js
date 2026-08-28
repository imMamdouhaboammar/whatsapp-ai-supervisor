import test from 'node:test';
import assert from 'node:assert/strict';
import { createInboundProcessingRuntime } from '../src/jobs/durable-inbound-runtime.js';

const inboundEvent = {
  eventId: 'evt-root', eventType: 'message.received', schemaVersion: 1,
  occurredAt: '2026-08-27T08:45:00.000Z', tenantId: 'acme',
  conversationId: 'whatsapp:20100', messageId: 'm1', correlationId: 'evt-root',
  causationId: undefined, idempotencyKey: 'acme:m1',
  actor: { type: 'connector', id: 'whatsapp-cloud' }, payload: {}
};

test('createInboundProcessingRuntime passes canonical ownership into its shared decision handler', async () => {
  let orchestratorCalls = 0;
  const runtime = createInboundProcessingRuntime({
    tenantStore: { findById: () => ({ id: 'acme' }) },
    orchestratorForTenant: () => ({ async handle() { orchestratorCalls += 1; } }),
    auditStore: { append() {} },
    conversationStore: { recordDecision() {}, isHumanControlled() { return false; } },
    ownershipStore: {
      async get() {
        return {
          tenantId: 'acme', conversationId: 'whatsapp:20100', state: 'HUMAN_ACTIVE', version: 1,
          changedAt: '2026-08-27T08:44:00.000Z', changedBy: 'operator', reasonCode: 'takeover', transitionId: 't1'
        };
      }
    },
    domainEventStore: { async append(event) { return event; } },
    jobQueue: null
  });

  const result = await runtime.decisionHandler({
    message: { id: 'm1', tenantId: 'acme', channel: 'whatsapp', customerId: '20100', text: 'hello' },
    tenant: { id: 'acme' },
    inboundEvent
  });

  assert.equal(result.reason, 'ownership_human_active');
  assert.equal(orchestratorCalls, 0);
});
