import { assertOutboundAttribution } from '../domain/outbound-attribution.js';

function iso(value) {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapRow(row) {
  if (!row) return null;
  const record = {
    tenantId: row.tenant_id,
    sessionId: row.session_id,
    conversationId: row.conversation_id,
    customerId: row.customer_id,
    platformMessageId: row.platform_message_id,
    origin: row.origin,
    sourceMessageId: row.source_message_id ?? null,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    echoObservedAt: row.echo_observed_at == null ? null : iso(row.echo_observed_at)
  };
  assertOutboundAttribution(record);
  return Object.freeze(record);
}

function required(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`outbound_${field}_required`);
  return normalized;
}

export class PostgresOutboundAttributionStore {
  constructor({ pool, now = () => new Date().toISOString() }) {
    if (!pool?.query) throw new Error('PostgresOutboundAttributionStore pool is required');
    this.pool = pool;
    this.now = now;
  }

  async record(record) {
    assertOutboundAttribution(record);
    const result = await this.pool.query(
      `INSERT INTO outbound_attributions (
         tenant_id, session_id, conversation_id, customer_id, platform_message_id,
         origin, source_message_id, created_at, expires_at, echo_observed_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz, $10::timestamptz)
       ON CONFLICT (tenant_id, session_id, platform_message_id)
       DO UPDATE SET platform_message_id = outbound_attributions.platform_message_id
       RETURNING *`,
      [
        record.tenantId,
        record.sessionId,
        record.conversationId,
        record.customerId,
        record.platformMessageId,
        record.origin,
        record.sourceMessageId,
        record.createdAt,
        record.expiresAt,
        record.echoObservedAt
      ]
    );
    return mapRow(result.rows[0]);
  }

  async findByPlatformMessageId(tenantId, sessionId, platformMessageId) {
    const result = await this.pool.query(
      `SELECT * FROM outbound_attributions
       WHERE tenant_id = $1 AND session_id = $2 AND platform_message_id = $3`,
      [
        required(tenantId, 'tenant_id'),
        required(sessionId, 'session_id'),
        required(platformMessageId, 'platform_message_id')
      ]
    );
    return mapRow(result.rows[0]);
  }

  async consumeEcho(tenantId, sessionId, platformMessageId) {
    const observedAt = this.now();
    if (!Number.isFinite(Date.parse(observedAt))) throw new Error('outbound_echo_observed_at_invalid');
    const result = await this.pool.query(
      `UPDATE outbound_attributions
       SET echo_observed_at = COALESCE(echo_observed_at, $4::timestamptz)
       WHERE tenant_id = $1 AND session_id = $2 AND platform_message_id = $3
       RETURNING *`,
      [
        required(tenantId, 'tenant_id'),
        required(sessionId, 'session_id'),
        required(platformMessageId, 'platform_message_id'),
        observedAt
      ]
    );
    return mapRow(result.rows[0]);
  }
}
