import test from 'node:test';
import assert from 'node:assert/strict';
import { createDomainEvent, deriveDomainEvent } from '../src/domain/domain-event.js';
import { PostgresDomainEventStore } from '../src/storage/postgres-domain-event-store.js';

class FakePool {
  constructor(responses = []) {
    this.responses = [...responses];
    this.queries = [];
  }
  async query(text, values = []) {
    this.queries.push({ text: String(text), values });
    const next = this.responses.shift();
    if (next instanceof Error) throw next;
    return next ?? { rows: [], rowCount: 0 };
  }
}

function rowFor(event) {
  return {
    event_id: event.eventId,
    event_type: event.eventType,
    schema_version: event.schemaVersion,
    occurred_at: event.occurredAt,
    tenant_id: event.tenantId,
    conversation_id: event.conversationId ?? null,
    message_id: event.messageId ?? null,
    correlation_id: event.correlationId,
    causation_id: event.causationId ?? null,
    idempotency_key: event.idempotencyKey ?? null,
    actor: event.actor,
    payload: event.payload
  };
}

test('PostgresDomainEventStore persists and returns the canonical row selected by idempotency', async () => {
  const attempted = createDomainEvent({
    eventType: 'message.received', tenantId: 'acme', conversationId: 'whatsapp:20100',
    messageId: 'wamid.1', idempotencyKey: 'acme:wamid.1',
    actor: { type: 'connector', id: 'whatsapp-cloud' }, payload: { text: 'hello' }
  }, { idFactory: () => 'evt-attempted', now: () => '2026-08-17T11:41:00.000Z' });
  const persisted = { ...attempted, eventId: 'evt-existing', correlationId: 'evt-existing', occurredAt: '2026-08-17T11:40:00.000Z' };
  const pool = new FakePool([{ rows: [rowFor(persisted)], rowCount: 1 }]);
  const store = new PostgresDomainEventStore({ pool });

  const canonical = await store.append(attempted);

  assert.equal(canonical.eventId, 'evt-existing');
  assert.equal(canonical.correlationId, 'evt-existing');
  assert.equal(canonical.idempotencyKey, 'acme:wamid.1');
  assert.match(pool.queries[0].text, /INSERT INTO domain_events/i);
  assert.match(pool.queries[0].text, /ON CONFLICT \(tenant_id, event_type, idempotency_key\)/i);
  assert.match(pool.queries[0].text, /DO UPDATE/i);
  assert.match(pool.queries[0].text, /RETURNING/i);
});

test('PostgresDomainEventStore rejects malformed envelopes before querying Postgres', async () => {
  const pool = new FakePool();
  const store = new PostgresDomainEventStore({ pool });
  await assert.rejects(store.append({ eventType: 'message.received' }), /domain_event_eventId_required/);
  assert.equal(pool.queries.length, 0);
});

test('PostgresDomainEventStore lists one correlation chain in causal time order', async () => {
  const root = createDomainEvent({
    eventType: 'message.received', tenantId: 'acme', conversationId: 'whatsapp:20100', messageId: 'm1',
    idempotencyKey: 'acme:m1:received', actor: { type: 'connector', id: 'whatsapp-cloud' }, payload: {}
  }, { idFactory: () => 'evt-root', now: () => '2026-08-17T11:40:00.000Z' });
  const child = deriveDomainEvent(root, {
    eventType: 'decision.completed', idempotencyKey: 'acme:m1:decision',
    actor: { type: 'ai', id: 'supervisor' }, payload: { action: 'reply' }
  }, { idFactory: () => 'evt-child', now: () => '2026-08-17T11:40:01.000Z' });
  const pool = new FakePool([{ rows: [rowFor(root), rowFor(child)], rowCount: 2 }]);
  const store = new PostgresDomainEventStore({ pool });

  const events = await store.listCorrelation('evt-root');
  assert.deepEqual(events.map((event) => event.eventId), ['evt-root', 'evt-child']);
  assert.match(pool.queries[0].text, /WHERE correlation_id = \$1/i);
  assert.match(pool.queries[0].text, /ORDER BY occurred_at ASC, event_id ASC/i);
});
