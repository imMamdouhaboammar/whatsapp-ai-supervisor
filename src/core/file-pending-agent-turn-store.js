import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validatePendingAgentTurn } from '../agents/pending-agent-turn.js';

function requiredString(value, code) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function encodedTenantId(value) {
  return `tenant-${Buffer.from(String(value), 'utf8').toString('base64url')}`;
}

function readEntries(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

export class FilePendingAgentTurnStore {
  constructor({ dataDir, now = () => new Date().toISOString() }) {
    if (!dataDir) throw new Error('pending_agent_turn_data_dir_required');
    this.dir = join(dataDir, 'pending-agent-turns');
    this.now = now;
    this.locks = new Map();
    mkdirSync(this.dir, { recursive: true });
  }

  fileFor(tenantId) {
    return join(this.dir, `${encodedTenantId(tenantId)}.ndjson`);
  }

  readCurrent(tenantId, turnId) {
    const tenant = requiredString(tenantId, 'pending_agent_turn_tenant_id_required');
    const turn = requiredString(turnId, 'pending_agent_turn_turn_id_required');
    const entries = readEntries(this.fileFor(tenant));
    const recorded = entries.find((entry) =>
      entry.kind === 'record' && entry.record?.tenantId === tenant && entry.record?.turnId === turn
    );
    if (!recorded) return null;

    const invalidation = entries.find((entry) =>
      entry.kind === 'invalidate' && entry.tenantId === tenant && entry.turnId === turn
    );
    const value = invalidation
      ? {
          ...recorded.record,
          status: 'invalidated',
          invalidatedAt: invalidation.invalidatedAt,
          reasonCode: invalidation.reasonCode
        }
      : recorded.record;
    return validatePendingAgentTurn(value);
  }

  async withLock(key, work) {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.locks.set(key, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }

  async record(value) {
    const record = validatePendingAgentTurn(value);
    if (record.status !== 'pending') throw new Error('pending_agent_turn_record_must_be_pending');
    const key = `${record.tenantId}\u0000${record.turnId}`;
    return this.withLock(key, async () => {
      const existing = this.readCurrent(record.tenantId, record.turnId);
      if (existing) return existing;
      appendFileSync(this.fileFor(record.tenantId), `${JSON.stringify({ kind: 'record', record })}\n`, 'utf8');
      return record;
    });
  }

  async get(tenantId, turnId) {
    return this.readCurrent(tenantId, turnId);
  }

  async invalidate(tenantId, turnId, { reasonCode } = {}) {
    const tenant = requiredString(tenantId, 'pending_agent_turn_tenant_id_required');
    const turn = requiredString(turnId, 'pending_agent_turn_turn_id_required');
    const reason = requiredString(reasonCode, 'pending_agent_turn_reason_code_required');
    const key = `${tenant}\u0000${turn}`;

    return this.withLock(key, async () => {
      const current = this.readCurrent(tenant, turn);
      if (!current) return null;
      if (current.status !== 'pending') return current;

      const invalidatedAt = requiredString(this.now(), 'pending_agent_turn_invalidated_at_required');
      if (!Number.isFinite(Date.parse(invalidatedAt))) {
        throw new Error('pending_agent_turn_invalidated_at_invalid');
      }
      appendFileSync(this.fileFor(tenant), `${JSON.stringify({
        kind: 'invalidate', tenantId: tenant, turnId: turn, invalidatedAt, reasonCode: reason
      })}\n`, 'utf8');
      return validatePendingAgentTurn({
        ...current,
        status: 'invalidated',
        invalidatedAt,
        reasonCode: reason
      });
    });
  }
}
