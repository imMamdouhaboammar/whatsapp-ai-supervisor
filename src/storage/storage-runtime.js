import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { FileClaimStore } from '../core/file-claim-store.js';
import { FileConversationOwnershipStore } from '../core/file-conversation-ownership-store.js';
import { probeDataDirectory } from '../runtime/readiness.js';
import { PostgresClaimStore } from './postgres-claim-store.js';
import { PostgresDomainEventStore } from './postgres-domain-event-store.js';
import { PostgresConversationOwnershipStore } from './postgres-conversation-ownership-store.js';
import { PostgresJobQueue } from '../jobs/postgres-job-queue.js';
import { runPostgresMigrations } from './postgres-migrations.js';

function safeDetail(error) {
  const code = String(error?.code ?? '').trim();
  if (code && /^[A-Z0-9_]+$/i.test(code)) return code.slice(0, 80);
  return 'unavailable';
}

async function defaultPoolFactory(options) {
  const { Pool } = await import('pg');
  return new Pool(options);
}

export async function createStorageRuntime(config, {
  poolFactory = defaultPoolFactory,
  migrationRunner = runPostgresMigrations
} = {}) {
  const backend = String(config?.backend ?? 'file').toLowerCase();
  const dataDir = config?.dataDir ?? './data';

  if (backend === 'file') {
    return {
      backend,
      claimStore: new FileClaimStore({ dataDir }),
      domainEventStore: null,
      ownershipStore: new FileConversationOwnershipStore({ dataDir }),
      jobQueue: null,
      probe: () => probeDataDirectory(dataDir),
      async close() {}
    };
  }

  if (backend !== 'postgres') throw new Error(`Unsupported storage backend: ${backend}`);
  if (!config?.databaseUrl) throw new Error('databaseUrl is required for postgres storage');

  const pool = await poolFactory({
    connectionString: config.databaseUrl,
    max: Math.max(1, Number(config.poolMax) || 10)
  });
  try {
    await migrationRunner({ pool });
  } catch (error) {
    try { await pool.end?.(); } catch {}
    throw error;
  }

  const ownerId = String(config.workerId ?? `${hostname()}:${process.pid}:${randomUUID()}`);
  return {
    backend,
    pool,
    claimStore: new PostgresClaimStore({ pool }),
    domainEventStore: new PostgresDomainEventStore({ pool }),
    ownershipStore: new PostgresConversationOwnershipStore({ pool }),
    jobQueue: new PostgresJobQueue({ pool, ownerId }),
    async probe() {
      try {
        await pool.query('SELECT 1 AS ok');
        return { available: true, detail: 'postgresql' };
      } catch (error) {
        return { available: false, detail: safeDetail(error) };
      }
    },
    async close() {
      await pool.end?.();
    }
  };
}
