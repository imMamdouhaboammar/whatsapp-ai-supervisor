import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function load(path) {
  try { return await import(path); } catch { return null; }
}

function pending(overrides = {}) {
  return {
    tenantId: 'acme',
    conversationId: 'whatsapp:20100',
    messageId: 'm1',
    turnId: 'turn-1',
    runtimeId: 'workspace-sales',
    dispatchedAt: '2026-08-28T06:00:00.000Z',
    expiresAt: '2026-08-28T06:10:00.000Z',
    status: 'pending',
    ownershipVersion: 3,
    ...overrides
  };
}

test('pending agent turn contract validates identity, state, ownership version and expiry', async () => {
  const mod = await load('../src/agents/pending-agent-turn.js');
  assert.equal(typeof mod?.validatePendingAgentTurn, 'function');
  const value = mod.validatePendingAgentTurn(pending());
  assert.equal(value.status, 'pending');
  assert.equal(Object.isFrozen(value), true);
  assert.throws(() => mod.validatePendingAgentTurn(pending({ expiresAt: '2026-08-28T05:59:00.000Z' })), /pending_agent_turn_expiry_invalid/);
  assert.throws(() => mod.validatePendingAgentTurn(pending({ ownershipVersion: -1 })), /pending_agent_turn_ownership_version_invalid/);
});

test('file pending turn store persists, reloads and invalidates one turn idempotently', async () => {
  const mod = await load('../src/core/file-pending-agent-turn-store.js');
  assert.equal(typeof mod?.FilePendingAgentTurnStore, 'function');
  const dataDir = mkdtempSync(join(tmpdir(), 'was-pending-turn-'));
  const first = new mod.FilePendingAgentTurnStore({ dataDir, now: () => '2026-08-28T06:01:00.000Z' });
  await first.record(pending());
  await first.record(pending());

  const second = new mod.FilePendingAgentTurnStore({ dataDir, now: () => '2026-08-28T06:02:00.000Z' });
  assert.equal((await second.get('acme', 'turn-1')).status, 'pending');
  const invalidated = await second.invalidate('acme', 'turn-1', { reasonCode: 'human_takeover' });
  assert.equal(invalidated.status, 'invalidated');
  assert.equal(invalidated.reasonCode, 'human_takeover');
  assert.equal(invalidated.invalidatedAt, '2026-08-28T06:02:00.000Z');
  assert.deepEqual(await second.invalidate('acme', 'turn-1', { reasonCode: 'duplicate' }), invalidated);
});

test('postgres pending turn store records idempotently and loads by tenant and turn', async () => {
  const mod = await load('../src/storage/postgres-pending-agent-turn-store.js');
  assert.equal(typeof mod?.PostgresPendingAgentTurnStore, 'function');
  const queries = [];
  const row = {
    tenant_id: 'acme', conversation_id: 'whatsapp:20100', message_id: 'm1', turn_id: 'turn-1',
    runtime_id: 'workspace-sales', dispatched_at: '2026-08-28T06:00:00.000Z', expires_at: '2026-08-28T06:10:00.000Z',
    status: 'pending', ownership_version: 3, invalidated_at: null, reason_code: null
  };
  const pool = {
    async query(text, values) {
      queries.push({ text: String(text), values });
      if (/INSERT INTO pending_agent_turns/i.test(String(text))) return { rows: [row], rowCount: 1 };
      if (/SELECT \* FROM pending_agent_turns/i.test(String(text))) return { rows: [row], rowCount: 1 };
      throw new Error('unexpected_query');
    }
  };
  const store = new mod.PostgresPendingAgentTurnStore({ pool });
  assert.equal((await store.record(pending())).turnId, 'turn-1');
  assert.equal((await store.get('acme', 'turn-1')).runtimeId, 'workspace-sales');
  assert.equal(queries.length, 2);
});

test('storage runtime exposes pending turns in file and postgres backends', async () => {
  const mod = await load('../src/storage/storage-runtime.js');
  assert.equal(typeof mod?.createStorageRuntime, 'function');
  const dataDir = mkdtempSync(join(tmpdir(), 'was-pending-runtime-'));
  const fileRuntime = await mod.createStorageRuntime({ backend: 'file', dataDir });
  assert.equal(typeof fileRuntime.pendingAgentTurnStore?.record, 'function');

  const pool = { async query() { return { rows: [] }; }, async end() {} };
  const pgRuntime = await mod.createStorageRuntime({ backend: 'postgres', databaseUrl: 'postgres://test', poolMax: 1 }, {
    poolFactory: async () => pool,
    migrationRunner: async () => {}
  });
  assert.equal(typeof pgRuntime.pendingAgentTurnStore?.record, 'function');
  await pgRuntime.close();
});
