import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertOutboundAttribution } from '../domain/outbound-attribution.js';

function safeTenantId(value) {
  return String(value).replace(/[^a-z0-9._-]/gi, '_');
}

function required(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`outbound_${field}_required`);
  return normalized;
}

function freeze(record) {
  return record ? Object.freeze(structuredClone(record)) : null;
}

export class FileOutboundAttributionStore {
  constructor({ dataDir, now = () => new Date().toISOString() }) {
    if (!dataDir) throw new Error('outbound_data_dir_required');
    this.dir = join(dataDir, 'outbound-attribution');
    this.now = now;
    mkdirSync(this.dir, { recursive: true });
  }

  fileFor(tenantId) {
    return join(this.dir, `${safeTenantId(tenantId)}.ndjson`);
  }

  readLedger(tenantId) {
    const file = this.fileFor(tenantId);
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  }

  append(entry) {
    appendFileSync(this.fileFor(entry.tenantId), `${JSON.stringify(entry)}\n`, 'utf8');
  }

  async record(record) {
    assertOutboundAttribution(record);
    const existing = await this.findByPlatformMessageId(record.tenantId, record.sessionId, record.platformMessageId);
    if (existing) return existing;
    this.append({
      kind: 'record',
      tenantId: record.tenantId,
      sessionId: record.sessionId,
      platformMessageId: record.platformMessageId,
      record
    });
    return freeze(record);
  }

  async findByPlatformMessageId(tenantId, sessionId, platformMessageId) {
    const tenant = required(tenantId, 'tenant_id');
    const session = required(sessionId, 'session_id');
    const messageId = required(platformMessageId, 'platform_message_id');
    const entries = this.readLedger(tenant).filter((entry) =>
      entry.sessionId === session && entry.platformMessageId === messageId
    );
    const recorded = entries.find((entry) => entry.kind === 'record');
    if (!recorded) return null;
    const value = structuredClone(recorded.record);
    const echo = entries.find((entry) => entry.kind === 'echo');
    if (echo) value.echoObservedAt = echo.observedAt;
    assertOutboundAttribution(value);
    return freeze(value);
  }

  async consumeEcho(tenantId, sessionId, platformMessageId) {
    const current = await this.findByPlatformMessageId(tenantId, sessionId, platformMessageId);
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
  }
}
