import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_MIGRATIONS_DIR = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'migrations');
const MIGRATION_LOCK_NAME = 'whatsapp-ai-supervisor:migrations';

export async function runPostgresMigrations({ pool, migrationsDir = DEFAULT_MIGRATIONS_DIR } = {}) {
  if (!pool?.connect) throw new Error('Postgres migration pool is required');
  const client = await pool.connect();
  let locked = false;
  let inTransaction = false;
  const applied = [];

  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [MIGRATION_LOCK_NAME]);
    locked = true;

    const names = (await readdir(migrationsDir))
      .filter((name) => /^\d+_.+\.sql$/i.test(name))
      .sort((a, b) => a.localeCompare(b));

    for (const name of names) {
      const existing = await client.query('SELECT version FROM schema_migrations WHERE version = $1', [name]);
      if (existing.rows.length > 0) continue;

      const sql = await readFile(join(migrationsDir, name), 'utf8');
      await client.query('BEGIN');
      inTransaction = true;
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [name]);
        await client.query('COMMIT');
        inTransaction = false;
        applied.push(name);
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        inTransaction = false;
        throw error;
      }
    }

    return applied;
  } finally {
    if (inTransaction) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    if (locked) {
      try { await client.query('SELECT pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK_NAME]); } catch {}
    }
    client.release();
  }
}
