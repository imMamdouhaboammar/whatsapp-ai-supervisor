import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PostgresClaimStore } from '../src/storage/postgres-claim-store.js';
import { PostgresJobQueue } from '../src/jobs/postgres-job-queue.js';

class ScriptedClient {
  constructor(responses = []) {
    this.responses = [...responses];
    this.queries = [];
    this.released = false;
  }
  async query(text, values = []) {
    this.queries.push({ text: String(text), values });
    const next = this.responses.shift();
    if (next instanceof Error) throw next;
    return next ?? { rows: [], rowCount: 0 };
  }
  release() { this.released = true; }
}

class FakePool {
  constructor({ queryResponses = [], client = null } = {}) {
    this.queryResponses = [...queryResponses];
    this.queries = [];
    this.client = client;
    this.connectCount = 0;
  }
  async query(text, values = []) {
    this.queries.push({ text: String(text), values });
    const next = this.queryResponses.shift();
    if (next instanceof Error) throw next;
    return next ?? { rows: [], rowCount: 0 };
  }
  async connect() {
    this.connectCount += 1;
    if (!this.client) throw new Error('fake_client_missing');
    return this.client;
  }
}

test('PostgresClaimStore claims idempotency keys with one atomic insert', async () => {
  const pool = new FakePool({ queryResponses: [
    { rowCount: 1, rows: [{ claim_key: 'acme:wamid.1' }] },
    { rowCount: 0, rows: [] },
    { rowCount: 1, rows: [] }
  ] });
  const store = new PostgresClaimStore({ pool });

  assert.equal(await store.claim('acme:wamid.1'), true);
  assert.equal(await store.claim('acme:wamid.1'), false);
  await store.release('acme:wamid.1');

  assert.match(pool.queries[0].text, /INSERT INTO inbound_claims/i);
  assert.match(pool.queries[0].text, /ON CONFLICT/i);
  assert.match(pool.queries[0].text, /DO NOTHING/i);
  assert.equal(pool.queries[0].values[0], 'acme:wamid.1');
  assert.match(pool.queries[2].text, /DELETE FROM inbound_claims/i);
});

test('PostgresJobQueue enqueues idempotently and returns the existing durable job', async () => {
  const existing = { id: 'job-1', tenant_id: 'acme', type: 'process_inbound', status: 'queued' };
  const pool = new FakePool({ queryResponses: [{ rowCount: 1, rows: [existing] }] });
  const queue = new PostgresJobQueue({ pool, ownerId: 'worker-a' });

  const job = await queue.enqueue({
    tenantId: 'acme',
    type: 'process_inbound',
    payload: { messageId: 'wamid.1' },
    idempotencyKey: 'acme:wamid.1',
    maxAttempts: 5
  });

  assert.equal(job.id, 'job-1');
  assert.match(pool.queries[0].text, /INSERT INTO durable_jobs/i);
  assert.match(pool.queries[0].text, /ON CONFLICT \(tenant_id, type, idempotency_key\)/i);
  assert.match(pool.queries[0].text, /DO UPDATE/i);
  assert.deepEqual(pool.queries[0].values.slice(0, 4), ['acme', 'process_inbound', { messageId: 'wamid.1' }, 'acme:wamid.1']);
});

test('PostgresJobQueue claims work in one checked-out transaction using SKIP LOCKED and a lease', async () => {
  const selected = {
    id: 'job-1', tenant_id: 'acme', type: 'process_inbound', payload: { messageId: 'wamid.1' },
    attempt_count: 0, max_attempts: 5
  };
  const claimed = { ...selected, status: 'running', attempt_count: 1, lease_owner: 'worker-a' };
  const client = new ScriptedClient([
    { rows: [], rowCount: 0 },
    { rows: [selected], rowCount: 1 },
    { rows: [claimed], rowCount: 1 },
    { rows: [], rowCount: 0 }
  ]);
  const pool = new FakePool({ client });
  const queue = new PostgresJobQueue({ pool, ownerId: 'worker-a', leaseMs: 45_000 });

  const job = await queue.claimNext();

  assert.equal(job.id, 'job-1');
  assert.equal(pool.connectCount, 1);
  assert.equal(client.released, true);
  assert.equal(client.queries[0].text.trim(), 'BEGIN');
  assert.match(client.queries[1].text, /FOR UPDATE SKIP LOCKED/i);
  assert.match(client.queries[1].text, /status = 'queued'/i);
  assert.match(client.queries[1].text, /leased_until <= NOW\(\)/i);
  assert.match(client.queries[2].text, /lease_owner/i);
  assert.match(client.queries[2].text, /leased_until/i);
  assert.equal(client.queries[2].values.includes('worker-a'), true);
  assert.equal(client.queries[2].values.includes(45_000), true);
  assert.equal(client.queries.at(-1).text.trim(), 'COMMIT');
});

test('PostgresJobQueue rolls back and releases the same client when claiming fails', async () => {
  const client = new ScriptedClient([
    { rows: [], rowCount: 0 },
    new Error('database_broke'),
    { rows: [], rowCount: 0 }
  ]);
  const pool = new FakePool({ client });
  const queue = new PostgresJobQueue({ pool, ownerId: 'worker-a' });

  await assert.rejects(queue.claimNext(), /database_broke/);
  assert.equal(client.queries[0].text.trim(), 'BEGIN');
  assert.equal(client.queries.at(-1).text.trim(), 'ROLLBACK');
  assert.equal(client.released, true);
});

test('PostgresJobQueue requeues bounded failures then dead-letters the terminal attempt', async () => {
  const pool = new FakePool({ queryResponses: [
    { rows: [{ id: 'job-1', status: 'queued', attempt_count: 2, max_attempts: 3 }], rowCount: 1 },
    { rows: [{ id: 'job-1', status: 'dead', attempt_count: 3, max_attempts: 3 }], rowCount: 1 }
  ] });
  const queue = new PostgresJobQueue({ pool, ownerId: 'worker-a', baseRetryMs: 1_000, maxRetryMs: 60_000, jitter: () => 0 });

  const retry = await queue.fail({ id: 'job-1', attemptCount: 2, maxAttempts: 3 }, new Error('provider_timeout'));
  const dead = await queue.fail({ id: 'job-1', attemptCount: 3, maxAttempts: 3 }, new Error('provider_timeout'));

  assert.equal(retry.status, 'queued');
  assert.equal(dead.status, 'dead');
  assert.match(pool.queries[0].text, /status = 'queued'/i);
  assert.match(pool.queries[0].text, /available_at/i);
  assert.match(pool.queries[1].text, /status = 'dead'/i);
  assert.match(pool.queries[1].text, /last_error/i);
  assert.equal(pool.queries[0].values.some((value) => typeof value === 'string' && value.includes('provider_timeout')), false);
});

test('durable runtime migration defines append-only events, unique claims, queue idempotency, leases, and queue scan index', () => {
  const sql = readFileSync(new URL('../migrations/001_durable_runtime.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS domain_events/i);
  assert.match(sql, /event_id\s+TEXT\s+PRIMARY KEY/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS inbound_claims/i);
  assert.match(sql, /claim_key\s+TEXT\s+PRIMARY KEY/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS durable_jobs/i);
  assert.match(sql, /UNIQUE\s*\(tenant_id,\s*type,\s*idempotency_key\)/i);
  assert.match(sql, /leased_until\s+TIMESTAMPTZ/i);
  assert.match(sql, /CHECK\s*\(status IN \('queued', 'running', 'completed', 'dead'\)\)/i);
  assert.match(sql, /CREATE INDEX[^;]+durable_jobs[^;]+status[^;]+available_at/is);
});
