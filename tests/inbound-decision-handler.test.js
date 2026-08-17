import test from 'node:test';
import assert from 'node:assert/strict';
import { createInboundDecisionHandler, createProcessInboundJobHandler } from '../src/jobs/inbound-decision-handler.js';

function inboundEvent(overrides = {}) {
  return {
    eventId: 'evt-root', eventType: 'message.received', schemaVersion: 1,
    occurredAt: '2026-08-17T11:55:00.000Z', tenantId: 'acme',
    conversationId: 'whatsapp:20100', messageId: 'wamid.1', correlationId: 'evt-root',
    causationId: undefined, idempotencyKey: 'acme:wamid.1',
    actor: { type: 'connector', id: 'whatsapp-cloud' }, payload: { text: 'Hello' },
    ...overrides
  };
}

test('createInboundDecisionHandler runs orchestrator then persists and broadcasts one canonical decision child', async () => {
  const appended = [];
  const recorded = [];
  const broadcast = [];
  const tenant = { id: 'acme' };
  const message = { id: 'wamid.1', tenantId: 'acme', channel: 'whatsapp', customerId: '20100', text: 'Hello' };
  const root = inboundEvent();
  const handler = createInboundDecisionHandler({
    orchestratorForTenant: () => ({
      async handle(received, currentTenant) {
        assert.equal(received, message);
        assert.equal(currentTenant, tenant);
        return { action: 'ignore', reason: 'no_reply', model: { intent: 'other', confidence: 0.87, provider: 'openai', model: 'gpt-5.6' }, permission: { action: 'ignore' } };
      }
    }),
    auditStore: { append() {} },
    conversationStore: {
      isHumanControlled() { return false; },
      recordDecision(_message, result, event) { recorded.push({ result, event }); }
    },
    domainEventStore: { async append(event) { appended.push(event); return event; } },
    sseBroadcaster: { broadcastDomainEvent(event) { broadcast.push(event); } }
  });

  const result = await handler({ message, tenant, inboundEvent: root });

  assert.equal(result.action, 'ignore');
  assert.equal(appended.length, 1);
  assert.equal(appended[0].eventType, 'decision.completed');
  assert.equal(appended[0].correlationId, 'evt-root');
  assert.equal(appended[0].causationId, 'evt-root');
  assert.equal(appended[0].idempotencyKey, 'acme:wamid.1:decision.completed');
  assert.equal(recorded[0].event.eventId, appended[0].eventId);
  assert.equal(broadcast[0].eventId, appended[0].eventId);
});

test('createInboundDecisionHandler keeps human takeover in the same durable lineage without invoking the orchestrator', async () => {
  let orchestratorCalls = 0;
  const audits = [];
  const decisions = [];
  const handler = createInboundDecisionHandler({
    orchestratorForTenant: () => ({ async handle() { orchestratorCalls += 1; } }),
    auditStore: { append(event) { audits.push(event); } },
    conversationStore: {
      isHumanControlled() { return true; },
      recordDecision(_message, result, event) { decisions.push({ result, event }); }
    },
    domainEventStore: { async append(event) { return event; } },
    sseBroadcaster: { broadcastDomainEvent() {} }
  });

  const result = await handler({
    message: { id: 'wamid.2', tenantId: 'acme', channel: 'whatsapp', customerId: '20100', text: 'Hello' },
    tenant: { id: 'acme' },
    inboundEvent: inboundEvent({ eventId: 'evt-human', correlationId: 'evt-human', messageId: 'wamid.2', idempotencyKey: 'acme:wamid.2' })
  });

  assert.equal(orchestratorCalls, 0);
  assert.equal(result.action, 'human');
  assert.equal(decisions[0].event.causationId, 'evt-human');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].result.reason, 'human_takeover');
});

test('createProcessInboundJobHandler validates durable payload tenant boundaries before decision execution', async () => {
  const calls = [];
  const handler = createProcessInboundJobHandler({
    tenantStore: { findById(id) { return id === 'acme' ? { id: 'acme' } : null; } },
    decisionHandler: async (input) => { calls.push(input); return { action: 'ignore' }; }
  });

  await handler({
    message: { id: 'm1', tenantId: 'acme', channel: 'whatsapp', customerId: '20100', text: 'Hello' },
    inboundEvent: inboundEvent()
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tenant.id, 'acme');

  await assert.rejects(handler({
    message: { id: 'm2', tenantId: 'other', channel: 'whatsapp', customerId: '20100', text: 'Hello' },
    inboundEvent: inboundEvent()
  }), /durable_job_tenant_mismatch/);
  await assert.rejects(handler({
    message: { id: 'm3', tenantId: 'missing', channel: 'whatsapp', customerId: '20100', text: 'Hello' },
    inboundEvent: inboundEvent({ tenantId: 'missing' })
  }), /durable_job_tenant_not_found/);
});
