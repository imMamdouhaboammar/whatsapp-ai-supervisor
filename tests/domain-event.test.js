import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOMAIN_ACTOR_TYPES,
  DOMAIN_EVENT_SCHEMA_VERSION,
  DOMAIN_EVENT_TYPES,
  assertDomainEvent,
  createDomainEvent,
  deriveDomainEvent
} from '../src/domain/domain-event.js';

const fixedNow = () => '2026-08-17T10:45:00.000Z';

function idSequence(...ids) {
  let index = 0;
  return () => ids[index++] ?? `event-${index}`;
}

test('createDomainEvent builds a versioned correlation root with deterministic dependencies', () => {
  const event = createDomainEvent({
    eventType: 'message.received',
    tenantId: 'acme',
    conversationId: 'whatsapp:20100',
    messageId: 'wamid.in',
    idempotencyKey: 'acme:wamid.in',
    actor: { type: 'connector', id: 'meta-cloud' },
    payload: { text: 'hello' }
  }, { now: fixedNow, idFactory: idSequence('evt-root') });

  assert.deepEqual(event, {
    eventId: 'evt-root',
    eventType: 'message.received',
    schemaVersion: 1,
    occurredAt: '2026-08-17T10:45:00.000Z',
    tenantId: 'acme',
    conversationId: 'whatsapp:20100',
    messageId: 'wamid.in',
    correlationId: 'evt-root',
    causationId: undefined,
    idempotencyKey: 'acme:wamid.in',
    actor: { type: 'connector', id: 'meta-cloud' },
    payload: { text: 'hello' }
  });
  assert.equal(DOMAIN_EVENT_SCHEMA_VERSION, 1);
  assert.equal(Object.isFrozen(event), true);
  assert.equal(Object.isFrozen(event.actor), true);
  assert.equal(Object.isFrozen(event.payload), true);
});

test('deriveDomainEvent preserves correlation and points causation at the direct parent', () => {
  const ids = idSequence('evt-root', 'evt-decision', 'evt-policy');
  const root = createDomainEvent({
    eventType: 'message.received',
    tenantId: 'acme',
    conversationId: 'whatsapp:20100',
    messageId: 'wamid.in',
    actor: { type: 'connector', id: 'meta-cloud' },
    payload: { text: 'hello' }
  }, { now: fixedNow, idFactory: ids });

  const decision = deriveDomainEvent(root, {
    eventType: 'decision.completed',
    actor: { type: 'ai', id: 'supervisor' },
    payload: { action: 'reply', intent: 'faq' }
  }, { now: fixedNow, idFactory: ids });
  const policy = deriveDomainEvent(decision, {
    eventType: 'policy.evaluated',
    actor: { type: 'ai', id: 'permission-engine' },
    payload: { action: 'reply', reason: 'matched_rule' }
  }, { now: fixedNow, idFactory: ids });

  assert.equal(decision.correlationId, root.eventId);
  assert.equal(decision.causationId, root.eventId);
  assert.equal(decision.tenantId, root.tenantId);
  assert.equal(decision.conversationId, root.conversationId);
  assert.equal(decision.messageId, root.messageId);
  assert.equal(policy.correlationId, root.eventId);
  assert.equal(policy.causationId, decision.eventId);
});

test('assertDomainEvent rejects unknown event types and actor types', () => {
  assert.equal(DOMAIN_EVENT_TYPES.has('message.received'), true);
  assert.equal(DOMAIN_EVENT_TYPES.has('browser.session_failed'), true);
  assert.deepEqual([...DOMAIN_ACTOR_TYPES].sort(), ['ai', 'connector', 'customer', 'operator', 'scheduler']);

  assert.throws(() => createDomainEvent({
    eventType: 'message.made_up',
    tenantId: 'acme',
    actor: { type: 'connector' },
    payload: {}
  }, { now: fixedNow, idFactory: idSequence('evt-bad') }), /unsupported_domain_event_type/);

  assert.throws(() => createDomainEvent({
    eventType: 'message.received',
    tenantId: 'acme',
    actor: { type: 'robot' },
    payload: {}
  }, { now: fixedNow, idFactory: idSequence('evt-bad') }), /unsupported_domain_actor_type/);
});

test('assertDomainEvent rejects malformed required fields and invalid timestamps', () => {
  const valid = {
    eventId: 'evt-1',
    eventType: 'message.received',
    schemaVersion: 1,
    occurredAt: '2026-08-17T10:45:00.000Z',
    tenantId: 'acme',
    correlationId: 'evt-1',
    actor: { type: 'connector' },
    payload: null
  };

  assert.equal(assertDomainEvent(valid), valid);
  assert.throws(() => assertDomainEvent({ ...valid, eventId: '' }), /domain_event_eventId_required/);
  assert.throws(() => assertDomainEvent({ ...valid, correlationId: '' }), /domain_event_correlationId_required/);
  assert.throws(() => assertDomainEvent({ ...valid, occurredAt: 'yesterday' }), /domain_event_occurredAt_invalid/);
  const { payload: _payload, ...withoutPayload } = valid;
  assert.throws(() => assertDomainEvent(withoutPayload), /domain_event_payload_required/);
});
