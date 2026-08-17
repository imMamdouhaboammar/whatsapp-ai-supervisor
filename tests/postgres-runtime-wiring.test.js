import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/config.js';
import { runPostgresMigrations } from '../src/storage/postgres-migrations.js';
import { createStorageRuntime } from '../src/storage/storage-runtime.js';

async function withEnv(values, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { return await fn(); }
  finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function configEnv(overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'was-storage-config-'));
  const tenantsFile = join(dir, 'tenants.json');
  await writeFile(tenantsFile, JSON.stringify([{ id: 'a', phoneNumberId: 'p1', whatsapp: { mode: 'cloud' } }]));
  return {
    TENANTS_FILE: tenantsFile,
    META_WEBHOOK_VERIFY_TOKEN: 'verify',
    META_APP_SECRET: 'secret',
    META_GRAPH_VERSION: 'v99.0',
    DATA_DIR: join(dir, 'data'),
    STORAGE_BACKEND: undefined,
    DATABASE_URL: undefined,
    DATABASE_POOL_MAX: undefined,
    ...overrides
  };
}

test('loadConfig keeps file storage as the default development backend', async () => {
  await withEnv(await configEnv(), async () => {
    const config = loadConfig();
    assert.deepEqual(config.storage, { backend: 'file', databaseUrl: null, poolMax: 10 });
  });
});

test('loadConfig requires DATABASE_URL for Postgres and reads bounded pool size', async () => {
  await withEnv(await configEnv({ STORAGE_BACKEND: 'postgres' }), async () => {
    assert.throws(() => loadConfig(), /DATABASE_URL.*postgres/i);
  });
  await withEnv(await configEnv({ STORAGE_BACKEND: 'postgres', DATABASE_URL: 'postgres://db/app', DATABASE_POOL_MAX: '17' }), async () => {
    const config = loadConfig();
    assert.deepEqual(config.storage, { backend: 'postgres', databaseUrl: 'postgres://db/app', poolMax: 17 });
  });
});

test('runPostgresMigrations records sorted migration versions transactionally and releases its client', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'was-migrations-'));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, '002_second.sql'), 'SELECT 2;');
  await writeFile(join(dir, '001_first.sql'), 'SELECT 1;');

  const queries = [];
  let released = false;
  const client = {
    async query(text, values = []) {
      queries.push({ text: String(text), values });
      if (/SELECT version FROM schema_migrations/i.test(String(text))) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    },
    release() { released = true; }
  };
  const pool = { async connect() { return client; } };

  const applied = await runPostgresMigrations({ pool, migrationsDir: dir });

  assert.deepEqual(applied, ['001_first.sql', '002_second.sql']);
  assert.equal(released, true);
  assert.match(queries[0].text, /CREATE TABLE IF NOT EXISTS schema_migrations/i);
  const sqlBodies = queries.filter((entry) => entry.text === 'SELECT 1;' || entry.text === 'SELECT 2;').map((entry) => entry.text);
  assert.deepEqual(sqlBodies, ['SELECT 1;', 'SELECT 2;']);
  assert.equal(queries.filter((entry) => entry.text.trim() === 'BEGIN').length, 2);
  assert.equal(queries.filter((entry) => entry.text.trim() === 'COMMIT').length, 2);
  assert.equal(queries.filter((entry) => /INSERT INTO schema_migrations/i.test(entry.text)).length, 2);
});

test('runPostgresMigrations rolls back the active migration and releases the client on failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'was-migrations-fail-'));
  await writeFile(join(dir, '001_fail.sql'), 'BROKEN SQL;');
  const queries = [];
  let released = false;
  const client = {
    async query(text) {
      queries.push(String(text));
      if (String(text) === 'BROKEN SQL;') throw new Error('migration_failed');
      if (/SELECT version FROM schema_migrations/i.test(String(text))) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    },
    release() { released = true; }
  };

  await assert.rejects(runPostgresMigrations({ pool: { async connect() { return client; } }, migrationsDir: dir }), /migration_failed/);
  assert.equal(queries.includes('ROLLBACK'), true);
  assert.equal(released, true);
});

test('createStorageRuntime keeps file mode dependency-free and builds Postgres stores behind an injected pool factory', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'was-storage-runtime-'));
  const fileRuntime = await createStorageRuntime({ backend: 'file', dataDir });
  assert.equal(fileRuntime.backend, 'file');
  assert.equal(fileRuntime.claimStore.constructor.name, 'FileClaimStore');
  assert.equal(fileRuntime.domainEventStore, null);
  assert.equal(fileRuntime.jobQueue, null);
  assert.equal((await fileRuntime.probe()).available, true);

  const poolQueries = [];
  let ended = false;
  const pool = {
    async query(text) { poolQueries.push(String(text)); return { rows: [{ ok: 1 }], rowCount: 1 }; },
    async connect() { throw new Error('not_needed'); },
    async end() { ended = true; }
  };
  let migrated = false;
  const postgresRuntime = await createStorageRuntime({
    backend: 'postgres', databaseUrl: 'postgres://db/app', poolMax: 12, dataDir
  }, {
    poolFactory: (options) => {
      assert.deepEqual(options, { connectionString: 'postgres://db/app', max: 12 });
      return pool;
    },
    migrationRunner: async ({ pool: received }) => { assert.equal(received, pool); migrated = true; }
  });

  assert.equal(migrated, true);
  assert.equal(postgresRuntime.backend, 'postgres');
  assert.equal(postgresRuntime.claimStore.constructor.name, 'PostgresClaimStore');
  assert.equal(postgresRuntime.domainEventStore.constructor.name, 'PostgresDomainEventStore');
  assert.equal(postgresRuntime.jobQueue.constructor.name, 'PostgresJobQueue');
  assert.equal((await postgresRuntime.probe()).available, true);
  assert.match(poolQueries[0], /SELECT 1/i);
  await postgresRuntime.close();
  assert.equal(ended, true);
});
