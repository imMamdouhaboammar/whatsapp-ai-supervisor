import {
  assertConversationOwnership,
  transitionOwnership
} from '../domain/conversation-ownership.js';
import {
  assertOwnershipTransitionInput,
  defaultOwnershipFor
} from '../core/conversation-ownership-store.js';

function iso(value) {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapRow(row) {
  if (!row) return null;
  const record = {
    tenantId: row.tenant_id,
    conversationId: row.conversation_id,
    state: row.state,
    version: Number(row.version),
    changedAt: iso(row.changed_at),
    changedBy: row.changed_by,
    reasonCode: row.reason_code ?? null,
    transitionId: row.transition_id ?? null
  };
  assertConversationOwnership(record);
  return Object.freeze(record);
}

function mapJsonRecord(value) {
  const record = typeof value === 'string' ? JSON.parse(value) : value;
  assertConversationOwnership(record);
  return Object.freeze(structuredClone(record));
}

function versionConflict(currentVersion = null) {
  const error = new Error('ownership_version_conflict');
  error.statusCode = 409;
  if (currentVersion !== null) error.currentVersion = currentVersion;
  return error;
}

export class PostgresConversationOwnershipStore {
  constructor({ pool, now = () => new Date().toISOString() }) {
    if (!pool?.query && !pool?.connect) throw new Error('PostgresConversationOwnershipStore pool is required');
    this.pool = pool;
    this.now = now;
  }

  async get(tenantId, conversationId) {
    const initial = defaultOwnershipFor(tenantId, conversationId, { now: this.now, actor: 'supervisor' });
    const result = await this.pool.query(
      `SELECT * FROM conversation_ownership
       WHERE tenant_id = $1 AND conversation_id = $2`,
      [tenantId, conversationId]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : initial;
  }

  async getMany(tenantId, conversationIds) {
    if (!Array.isArray(conversationIds)) throw new Error('ownership_conversation_ids_required');
    const ids = conversationIds.map((conversationId) => String(conversationId ?? '').trim());
    const defaults = ids.map((conversationId) =>
      defaultOwnershipFor(tenantId, conversationId, { now: this.now, actor: 'supervisor' })
    );
    if (ids.length === 0) return [];

    const result = await this.pool.query(
      `SELECT * FROM conversation_ownership
       WHERE tenant_id = $1 AND conversation_id = ANY($2::text[])`,
      [tenantId, ids]
    );
    const byConversation = new Map(result.rows.map((row) => {
      const record = mapRow(row);
      return [record.conversationId, record];
    }));
    return ids.map((conversationId, index) => byConversation.get(conversationId) ?? defaults[index]);
  }

  async transition(input) {
    assertOwnershipTransitionInput(input);
    if (!this.pool?.connect) throw new Error('PostgresConversationOwnershipStore transactional pool is required');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const initial = defaultOwnershipFor(input.tenantId, input.conversationId, { now: this.now, actor: 'supervisor' });
      await client.query(
        `INSERT INTO conversation_ownership (
           tenant_id, conversation_id, state, version, changed_at,
           changed_by, reason_code, transition_id
         ) VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8)
         ON CONFLICT (tenant_id, conversation_id) DO NOTHING`,
        [
          initial.tenantId,
          initial.conversationId,
          initial.state,
          initial.version,
          initial.changedAt,
          initial.changedBy,
          initial.reasonCode,
          initial.transitionId
        ]
      );

      const currentResult = await client.query(
        `SELECT * FROM conversation_ownership
         WHERE tenant_id = $1 AND conversation_id = $2
         FOR UPDATE`,
        [input.tenantId, input.conversationId]
      );
      const current = mapRow(currentResult.rows[0]);
      if (!current) throw new Error('ownership_current_row_missing');

      const duplicateResult = await client.query(
        `SELECT result FROM conversation_ownership_transitions
         WHERE tenant_id = $1 AND conversation_id = $2 AND transition_id = $3`,
        [input.tenantId, input.conversationId, input.transitionId]
      );
      if (duplicateResult.rows[0]) {
        const duplicate = mapJsonRecord(duplicateResult.rows[0].result);
        await client.query('COMMIT');
        return duplicate;
      }

      if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== current.version) {
        throw versionConflict(current.version);
      }

      const next = transitionOwnership(current, input.command, {
        transitionId: input.transitionId,
        actor: input.actor,
        reasonCode: input.reasonCode ?? null,
        now: this.now
      });

      let persisted = current;
      if (next.version !== current.version || next.state !== current.state) {
        const updateResult = await client.query(
          `UPDATE conversation_ownership
           SET state = $3,
               version = $4,
               changed_at = $5::timestamptz,
               changed_by = $6,
               reason_code = $7,
               transition_id = $8
           WHERE tenant_id = $1 AND conversation_id = $2 AND version = $9
           RETURNING *`,
          [
            input.tenantId,
            input.conversationId,
            next.state,
            next.version,
            next.changedAt,
            next.changedBy,
            next.reasonCode,
            next.transitionId,
            current.version
          ]
        );
        if (updateResult.rowCount !== 1) throw versionConflict(current.version);
        persisted = mapRow(updateResult.rows[0]);
      }

      await client.query(
        `INSERT INTO conversation_ownership_transitions (
           tenant_id, conversation_id, transition_id, command, actor,
           reason_code, expected_version, result, recorded_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::timestamptz)`,
        [
          input.tenantId,
          input.conversationId,
          input.transitionId,
          input.command,
          input.actor,
          input.reasonCode ?? null,
          input.expectedVersion ?? null,
          persisted,
          this.now()
        ]
      );

      await client.query('COMMIT');
      return persisted;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release?.();
    }
  }
}
