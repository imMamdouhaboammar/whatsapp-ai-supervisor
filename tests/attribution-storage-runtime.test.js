import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStorageRuntime } from '../src/storage/storage-runtime.js';

test('file runtime exposes file outbound attribution store', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'was-attribution-runtime-file-'));
  const runtime = await createStorageRuntime({ backend: 'file', dataDir });
  assert.equal(runtime.outboundAttributionStore.constructor.name, 'FileOutboundAttributionStore');
  await runtime.close();
});

test('postgres runtime exposes outbound attribution through the shared pool', async () => {
  const pool = {
    async query() { return { rows: [{ ok: 1 }], rowCount: 1 }; },
    async connect() { throw new Error('not_used'); },
    async end() {}
  };
  const runtime = await createStorageRuntime({
    backend: 'postgres', databaseUrl: 'postgres://db/app', poolMax: 4, dataDir: '/tmp/unused'
  }, {
    poolFactory: () => pool,
    migrationRunner: async () => {}
  });
  assert.equal(runtime.outboundAttributionStore.constructor.name, 'PostgresOutboundAttributionStore');
  assert.equal(runtime.outboundAttributionStore.pool, pool);
  await runtime.close();
});
