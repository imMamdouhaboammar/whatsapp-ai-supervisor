import { validatePendingAgentTurn } from '../agents/pending-agent-turn.js';

function iso(value) {
  if (value instanceof Date) return value.toISOString();
  return value == null ? null : String(value);
}

function requiredString(value, code) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function mapRow(row) {
  if (!row) return null;
  return validatePendingAgentTurn({
    tenantId: row.tenant_id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    turnId: row.turn_id,
    runtimeId: row.runtime_id,
    dispatchedAt: iso(row.dispatched_at),
    expiresAt: iso(row.expires_at),
    status: row.status,
    ownershipVersion: Number(row.ownership_version),
    ...(row.invalidated_at == null ? {} : { invalidatedAt: iso(row.invalidated_at) }),
    ...(row.reason_code == null ? {} : { reasonCode: row.reason_code })
  });
}

export class PostgresPendingAgentTurnStore {
  constructor({ pool, now = () => new Date().toISOString() }) {
    if (!pool?.query) throw new Error('PostgresPendingAgentTurnStore pool is required');
    this.pool = pool;
    this.now = now;
  }

  async record(value) {
    const record = validatePendingAgentTurn(value);
    if (record.status !== 'pending') throw new Error('pending_agent_turn_record_must_be_pending');
    const result = await this.pool.query(
      `INSERT INTO pending_agent_turns (
         tenant_id, conversation_id, message_id, turn_id, runtime_id,
         dispatched_at, expires_at, status, ownership_version
       ) VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8, $9)
       ON CONFLICT (tenant_id, turn_id)
       DO UPDATE SET turn_id = pending_agent_turns.turn_id
       RETURNING *`,
      [
        record.tenantId,
        record.conversationId,
        record.messageId,
        record.turnId,
        record.runtimeId,
        record.dispatchedAt,
        record.expiresAt,
        record.status,
        record.ownershipVersion
      ]
    );
    return mapRow(result.rows[0]);
  }

  async get(tenantId, turnId) {
    const result = await this.pool.query(
      `SELECT * FROM pending_agent_turns
       WHERE tenant_id = $1 AND turn_id = $2`,
      [
        requiredString(tenantId, 'pending_agent_turn_tenant_id_required'),
        requiredString(turnId, 'pending_agent_turn_turn_id_required')
      ]
    );
    return mapRow(result.rows[0]);
  }

  async invalidate(tenantId, turnId, { reasonCode } = {}) {
    const invalidatedAt = requiredString(this.now(), 'pending_agent_turn_invalidated_at_required');
    if (!Number.isFinite(Date.parse(invalidatedAt))) {
      throw new Error('pending_agent_turn_invalidated_at_invalid');
    }
    const result = await this.pool.query(
      `UPDATE pending_agent_turns
       SET status = 'invalidated',
           invalidated_at = COALESCE(invalidated_at, $3::timestamptz),
           reason_code = COALESCE(reason_code, $4)
       WHERE tenant_id = $1 AND turn_id = $2
       RETURNING *`,
      [
        requiredString(tenantId, 'pending_agent_turn_tenant_id_required'),
        requiredString(turnId, 'pending_agent_turn_turn_id_required'),
        invalidatedAt,
        requiredString(reasonCode, 'pending_agent_turn_reason_code_required')
      ]
    );
    return mapRow(result.rows[0]);
  }
}
