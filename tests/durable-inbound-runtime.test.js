import test from 'node:test';
import assert from 'node:assert/strict';
import { createInboundProcessingRuntime } from '../src/jobs/durable-inbound-runtime.js';

function deps(overrides = {}) {
  const tenant = { id: 'acme' };
  return {
    tenantStore: { findById(id) { return id === 'acme' ? tenant : null; } },
    orchestratorForTenant: () => ({ async handle() { return { action: 'ignore', model: null, permission: { action: 'ignore' } }; } }),
    auditStore: { append() {} },
    conversationStore: { isHumanControlled() { return false; }, recordDecision() {} },
    domainEventStore: { async append(event) { return event; } },
    sseBroadcaster: { broadcastDomainEvent() {} },
    jobQueue: null,
    ...overrides
  };
}

test('createInboundProcessingRuntime returns one shared decision handler and no worker for synchronous file mode', () => {
  const runtime = createInboundProcessingRuntime(deps());
  assert.equal(typeof runtime.decisionHandler, 'function');
  assert.equal(runtime.worker, null);
});

test('createInboundProcessingRuntime wires process_inbound jobs through the same decision handler in durable mode', async () => {
  const root = {
    eventId: 'evt-root', eventType: 'message.received', schemaVersion: 1,
    occurredAt: '2026-08-17T12:00:00.000Z', tenantId: 'acme', conversationId: 'whatsapp:20100',
    messageId: 'm1', correlationId: 'evt-root', causationId: undefined,
    idempotencyKey: 'acme:m1', actor: { type: 'connector', id: 'whatsapp-cloud' }, payload: {}
  };
  const job = {
    id: 'job-1', type: 'process_inbound', attemptCount: 1, maxAttempts: 5,
    payload: { message: { id: 'm1', tenantId: 'acme', channel: 'whatsapp', customerId: '20100', text: 'Hello' }, inboundEvent: root }
  };
  const calls = [];
  const queue = {
    async claimNext() { return calls.length === 0 ? job : null; },
    async complete(value) { calls.push(['complete', value.id]); return { ...value, status: 'completed' }; },
    async fail() { throw new Error('fail_should_not_run'); }
  };
  const runtime = createInboundProcessingRuntime(deps({
    jobQueue: queue,
    orchestratorForTenant: () => ({ async handle(message) { calls.push(['orchestrate', message.id]); return { action: 'ignore', model: null, permission: { action: 'ignore' } }; } }),
    domainEventStore: { async append(event) { calls.push(['event', event.eventType]); return event; } }
  }));

  assert.ok(runtime.worker);
  const result = await runtime.worker.runOnce();
  assert.deepEqual(result, { status: 'completed', jobId: 'job-1', type: 'process_inbound' });
  assert.deepEqual(calls, [
    ['orchestrate', 'm1'],
    ['event', 'decision.completed'],
    ['complete', 'job-1']
  ]);
});
