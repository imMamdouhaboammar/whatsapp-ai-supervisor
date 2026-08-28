import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStorageRuntime } from '../src/storage/storage-runtime.js';

test('file storage runtime exposes a durable local ownership store', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'was-ownership-runtime-file-'));
  const runtime = await createStorageRuntime({ backend: 'file', dataDir });
  assert.equal(runtime.ownershipStore.constructor.name, 'FileConversationOwnershipStore');
  const current = await runtime.ownershipStore.get('acme', 'whatsapp:20100');
  assert.equal(current.state, 'AI_ACTIVE');
  await runtime.close();
});

test('postgres storage runtime exposes Postgres ownership behind the shared pool', async () => {
  const pool = {
    async query() { return { rows: [{ ok: 1 }], rowCount: 1 }; },
    async connect() { throw new Error('not_used_by_wiring_test'); },
    async end() {}
  };
  const runtime = await createStorageRuntime({
    backend: 'postgres',
    databaseUrl: 'postgres://db/app',
    poolMax: 5,
    dataDir: '/tmp/was-unused'
  }, {
    poolFactory: () => pool,
    migrationRunner: async () => {}
  });

  assert.equal(runtime.ownershipStore.constructor.name, 'PostgresConversationOwnershipStore');
  assert.equal(runtime.ownershipStore.pool, pool);
  await runtime.close();
});
