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

function safeTenantId(value) {
  return String(value).replace(/[^a-z0-9._-]/gi, '_');
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
    return join(this.dir, `${safeTenantId(tenantId)}.ndjson`);
  }

  readLedger(tenantId) {
    const file = this.fileFor(tenantId);
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  appendLedger(entry) {
    appendFileSync(this.fileFor(entry.tenantId), `${JSON.stringify(entry)}\n`, 'utf8');
    return entry;
  }

  async get(tenantId, conversationId) {
    const matching = this.readLedger(tenantId)
      .filter((entry) => String(entry.conversationId) === String(conversationId));
    if (!matching.length) {
      return defaultOwnershipFor(tenantId, conversationId, { now: this.now, actor: 'supervisor' });
    }
    const record = matching.at(-1).result;
    assertConversationOwnership(record);
    return freezeResult(record);
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
