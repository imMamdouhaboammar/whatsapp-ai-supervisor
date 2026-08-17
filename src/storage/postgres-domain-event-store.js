import { assertDomainEvent } from '../domain/domain-event.js';

function iso(value) {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapRow(row) {
  if (!row) return null;
  const event = {
    eventId: row.event_id,
    eventType: row.event_type,
    schemaVersion: Number(row.schema_version),
    occurredAt: iso(row.occurred_at),
    tenantId: row.tenant_id,
    conversationId: row.conversation_id ?? undefined,
    messageId: row.message_id ?? undefined,
    correlationId: row.correlation_id,
    causationId: row.causation_id ?? undefined,
    idempotencyKey: row.idempotency_key ?? undefined,
    actor: row.actor,
    payload: row.payload
  };
  assertDomainEvent(event);
  return Object.freeze(event);
}

export class PostgresDomainEventStore {
  constructor({ pool }) {
    if (!pool?.query) throw new Error('PostgresDomainEventStore pool is required');
    this.pool = pool;
  }

  async append(event) {
    assertDomainEvent(event);
    const result = await this.pool.query(
      `INSERT INTO domain_events (
         event_id, event_type, schema_version, occurred_at, tenant_id,
         conversation_id, message_id, correlation_id, causation_id,
         idempotency_key, actor, payload
       ) VALUES (
         $1, $2, $3, $4::timestamptz, $5,
         $6, $7, $8, $9,
         $10, $11::jsonb, $12::jsonb
       )
       ON CONFLICT (tenant_id, event_type, idempotency_key)
       DO UPDATE SET event_id = domain_events.event_id
       RETURNING *`,
      [
        event.eventId,
        event.eventType,
        event.schemaVersion,
        event.occurredAt,
        event.tenantId,
        event.conversationId ?? null,
        event.messageId ?? null,
        event.correlationId,
        event.causationId ?? null,
        event.idempotencyKey ?? null,
        event.actor,
        event.payload
      ]
    );
    return mapRow(result.rows[0]);
  }

  async listCorrelation(correlationId) {
    const id = String(correlationId ?? '').trim();
    if (!id) throw new Error('correlation_id_required');
    const result = await this.pool.query(
      `SELECT *
       FROM domain_events
       WHERE correlation_id = $1
       ORDER BY occurred_at ASC, event_id ASC`,
      [id]
    );
    return result.rows.map(mapRow);
  }
}
