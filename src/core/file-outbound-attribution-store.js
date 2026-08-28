import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertOutboundAttribution } from '../domain/outbound-attribution.js';

function legacyTenantId(value) {
  return String(value).replace(/[^a-z0-9._-]/gi, '_');
}

function encodedTenantId(value) {
  return `tenant-${Buffer.from(String(value), 'utf8').toString('base64url')}`;
}

function required(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`outbound_${field}_required`);
  return normalized;
}

function freeze(record) {
  return record ? Object.freeze(structuredClone(record)) : null;
}

function readEntries(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

export class FileOutboundAttributionStore {
  constructor({ dataDir, now = () => new Date().toISOString() }) {
    if (!dataDir) throw new Error('outbound_data_dir_required');
    this.dir = join(dataDir, 'outbound-attribution');
    this.now = now;
    this.locks = new Map();
    mkdirSync(this.dir, { recursive: true });
  }

  fileFor(tenantId) {
    return join(this.dir, `${encodedTenantId(tenantId)}.ndjson`);
  }

  legacyFileFor(tenantId) {
    return join(this.dir, `${legacyTenantId(tenantId)}.ndjson`);
  }

  readLedger(tenantId) {
    const tenant = String(tenantId);
    return [
      ...readEntries(this.legacyFileFor(tenant)),
      ...readEntries(this.fileFor(tenant))
    ].filter((entry) => String(entry.tenantId) === tenant);
  }

  append(entry) {
    appendFileSync(this.fileFor(entry.tenantId), `${JSON.stringify(entry)}\n`, 'utf8');
  }

  lockKey(tenantId, sessionId, platformMessageId) {
    return `${tenantId}\u0000${sessionId}\u0000${platformMessageId}`;
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

  findUnlocked(tenantId, sessionId, platformMessageId) {
    const tenant = required(tenantId, 'tenant_id');
    const session = required(sessionId, 'session_id');
    const messageId = required(platformMessageId, 'platform_message_id');
    const entries = this.readLedger(tenant).filter((entry) =>
      String(entry.tenantId) === tenant &&
      entry.sessionId === session &&
      entry.platformMessageId === messageId
    );
    const recorded = entries.find((entry) => entry.kind === 'record');
    if (!recorded) return null;
    const value = structuredClone(recorded.record);
    if (String(value.tenantId) !== tenant) return null;
    const echo = entries.find((entry) => entry.kind === 'echo');
    if (echo) value.echoObservedAt = echo.observedAt;
    assertOutboundAttribution(value);
    return freeze(value);
  }

  async record(record) {
    assertOutboundAttribution(record);
    const tenant = required(record.tenantId, 'tenant_id');
    const session = required(record.sessionId, 'session_id');
    const messageId = required(record.platformMessageId, 'platform_message_id');
    const key = this.lockKey(tenant, session, messageId);
    return this.withLock(key, async () => {
      const existing = this.findUnlocked(tenant, session, messageId);
      if (existing) return existing;
      this.append({
        kind: 'record',
        tenantId: tenant,
        sessionId: session,
        platformMessageId: messageId,
        record
      });
      return freeze(record);
    });
  }

  async findByPlatformMessageId(tenantId, sessionId, platformMessageId) {
    return this.findUnlocked(tenantId, sessionId, platformMessageId);
  }

  async consumeEcho(tenantId, sessionId, platformMessageId) {
    const tenant = required(tenantId, 'tenant_id');
    const session = required(sessionId, 'session_id');
    const messageId = required(platformMessageId, 'platform_message_id');
    const key = this.lockKey(tenant, session, messageId);
    return this.withLock(key, async () => {
      const current = this.findUnlocked(tenant, session, messageId);
      if (!current) return null;
      if (current.echoObservedAt) return current;
      const observedAt = this.now();
      if (!Number.isFinite(Date.parse(observedAt))) throw new Error('outbound_echo_observed_at_invalid');
      this.append({
        kind: 'echo',
        tenantId: current.tenantId,
        sessionId: current.sessionId,
        platformMessageId: current.platformMessageId,
        observedAt
      });
      return freeze({ ...current, echoObservedAt: observedAt });
    });
  }
}
