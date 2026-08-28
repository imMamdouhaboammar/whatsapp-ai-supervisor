import test from 'node:test';
import assert from 'node:assert/strict';
import { createInboundDecisionHandler } from '../src/jobs/inbound-decision-handler.js';

function root() {
  return {
    eventId: 'evt-root', eventType: 'message.received', schemaVersion: 1,
    occurredAt: '2026-08-27T08:40:00.000Z', tenantId: 'acme',
    conversationId: 'whatsapp:20100', messageId: 'm1', correlationId: 'evt-root',
    causationId: undefined, idempotencyKey: 'acme:m1',
    actor: { type: 'connector', id: 'whatsapp-linked-device' }, payload: { text: 'hello' }
  };
}

function ownership(state, version = 1) {
  return {
    tenantId: 'acme', conversationId: 'whatsapp:20100', state, version,
    changedAt: '2026-08-27T08:39:00.000Z', changedBy: 'operator',
    reasonCode: 'test', transitionId: `transition-${version}`
  };
}

function handlerFor(state) {
  let orchestratorCalls = 0;
  const decisions = [];
  const handler = createInboundDecisionHandler({
    orchestratorForTenant: () => ({
      async handle() {
        orchestratorCalls += 1;
        return { action: 'ignore', reason: null, model: null, permission: { action: 'ignore' } };
      }
    }),
    auditStore: { append() {} },
    conversationStore: { isHumanControlled() { return false; }, recordDecision(_message, result) { decisions.push(result); } },
    ownershipStore: { async get() { return ownership(state); } },
    domainEventStore: { async append(event) { return event; } },
    sseBroadcaster: { broadcastDomainEvent() {} }
  });
  return { handler, decisions, orchestratorCalls: () => orchestratorCalls };
}

const message = { id: 'm1', tenantId: 'acme', channel: 'whatsapp', customerId: '20100', text: 'hello' };
const tenant = { id: 'acme' };

test('AI_ACTIVE ownership allows the model decision path', async () => {
  const fixture = handlerFor('AI_ACTIVE');
  const result = await fixture.handler({ message, tenant, inboundEvent: root() });
  assert.equal(result.action, 'ignore');
  assert.equal(fixture.orchestratorCalls(), 1);
});

for (const state of ['HUMAN_ACTIVE', 'HUMAN_REQUESTED', 'WAITING_APPROVAL', 'AI_PAUSED']) {
  test(`${state} ownership blocks stale automatic model execution`, async () => {
    const fixture = handlerFor(state);
    const result = await fixture.handler({ message, tenant, inboundEvent: root() });
    assert.equal(result.action, 'human');
    assert.equal(result.reason, `ownership_${state.toLowerCase()}`);
    assert.equal(result.ownershipState, state);
    assert.equal(fixture.orchestratorCalls(), 0);
  });
}

test('legacy human control remains a fallback when no canonical ownership store is injected', async () => {
  let orchestratorCalls = 0;
  const handler = createInboundDecisionHandler({
    orchestratorForTenant: () => ({ async handle() { orchestratorCalls += 1; } }),
    auditStore: { append() {} },
    conversationStore: { isHumanControlled() { return true; }, recordDecision() {} },
    domainEventStore: { async append(event) { return event; } }
  });

  const result = await handler({ message, tenant, inboundEvent: root() });
  assert.equal(result.action, 'human');
  assert.equal(result.reason, 'human_takeover');
  assert.equal(orchestratorCalls, 0);
});
