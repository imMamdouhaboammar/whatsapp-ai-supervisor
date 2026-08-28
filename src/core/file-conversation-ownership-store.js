import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertConversationOwnership,
  transitionOwnership
} from '../domain/conversation-ownership.js';
import {
  assertOwnershipTransitionInput,
  defaultOwnershipFor
} from './conversation-ownership-store.js';

function legacyTenantId(value) {
  return String(value).replace(/[^a-z0-9._-]/gi, '_');
}

function encodedTenantId(value) {
  return `tenant-${Buffer.from(String(value), 'utf8').toString('base64url')}`;
}

function readEntries(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function freezeResult(value) {
  return Object.freeze(structuredClone(value));
}

export class FileConversationOwnershipStore {
  constructor({ dataDir, now = () => new Date().toISOString() }) {
    if (!dataDir) throw new Error('ownership_data_dir_required');
    this.dir = join(dataDir, 'ownership');
    this.now = now;
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

  appendLedger(entry) {
    appendFileSync(this.fileFor(entry.tenantId), `${JSON.stringify(entry)}\n`, 'utf8');
    return entry;
  }

  async get(tenantId, conversationId) {
    const [record] = await this.getMany(tenantId, [conversationId]);
    return record;
  }

  async getMany(tenantId, conversationIds) {
    if (!Array.isArray(conversationIds)) throw new Error('ownership_conversation_ids_required');
    const ids = conversationIds.map((conversationId) => String(conversationId ?? '').trim());
    const defaults = ids.map((conversationId) =>
      defaultOwnershipFor(tenantId, conversationId, { now: this.now, actor: 'supervisor' })
    );
    if (ids.length === 0) return [];

    const entries = this.readLedger(tenantId);
    const latest = new Map();
    for (const entry of entries) {
      const conversationId = String(entry.conversationId ?? '');
      if (!ids.includes(conversationId)) continue;
      const record = entry.result;
      assertConversationOwnership(record);
      if (record.tenantId !== String(tenantId) || record.conversationId !== conversationId) continue;
      latest.set(conversationId, freezeResult(record));
    }

    return ids.map((conversationId, index) => latest.get(conversationId) ?? defaults[index]);
  }

  async transition(input) {
    assertOwnershipTransitionInput(input);
    const entries = this.readLedger(input.tenantId)
      .filter((entry) => String(entry.conversationId) === String(input.conversationId));

    const duplicate = entries.find((entry) => entry.transitionId === input.transitionId);
    if (duplicate) {
      assertConversationOwnership(duplicate.result);
      return freezeResult(duplicate.result);
    }

    const current = entries.length
      ? entries.at(-1).result
      : defaultOwnershipFor(input.tenantId, input.conversationId, { now: this.now, actor: 'supervisor' });
    assertConversationOwnership(current);

    if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== current.version) {
      const error = new Error('ownership_version_conflict');
      error.statusCode = 409;
      error.currentVersion = current.version;
      throw error;
    }

    const result = transitionOwnership(current, input.command, {
      transitionId: input.transitionId,
      actor: input.actor,
      reasonCode: input.reasonCode ?? null,
      now: this.now
    });

    this.appendLedger({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      transitionId: input.transitionId,
      command: input.command,
      actor: input.actor,
      reasonCode: input.reasonCode ?? null,
      expectedVersion: input.expectedVersion ?? null,
      recordedAt: this.now(),
      result
    });

    return freezeResult(result);
  }
}
