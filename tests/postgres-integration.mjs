import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { runPostgresMigrations } from '../src/storage/postgres-migrations.js';
import { PostgresClaimStore } from '../src/storage/postgres-claim-store.js';
import { PostgresDomainEventStore } from '../src/storage/postgres-domain-event-store.js';
import { PostgresJobQueue } from '../src/jobs/postgres-job-queue.js';
import { createDomainEvent } from '../src/domain/domain-event.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for Postgres integration test');

const pool = new Pool({ connectionString, max: 8 });

try {
  const applied = await runPostgresMigrations({ pool });
  assert.ok(Array.isArray(applied));
  await pool.query('TRUNCATE TABLE durable_jobs, inbound_claims, domain_events RESTART IDENTITY');

  const claims = new PostgresClaimStore({ pool });
  assert.equal(await claims.claim('acme:wamid.1'), true);
  assert.equal(await claims.claim('acme:wamid.1'), false);
  await claims.release('acme:wamid.1');
  assert.equal(await claims.claim('acme:wamid.1'), true);

  const events = new PostgresDomainEventStore({ pool });
  const firstAttempt = createDomainEvent({
    eventType: 'message.received',
    tenantId: 'acme',
    conversationId: 'whatsapp:20100',
    messageId: 'wamid.1',
    idempotencyKey: 'acme:wamid.1',
    actor: { type: 'connector', id: 'whatsapp-cloud' },
    payload: { text: 'Hello' }
  });
  const persisted1 = await events.append(firstAttempt);
  const secondAttempt = createDomainEvent({
    eventType: 'message.received',
    tenantId: 'acme',
    conversationId: 'whatsapp:20100',
    messageId: 'wamid.1',
    idempotencyKey: 'acme:wamid.1',
    actor: { type: 'connector', id: 'whatsapp-cloud' },
    payload: { text: 'Hello again' }
  });
  const persisted2 = await events.append(secondAttempt);
  assert.equal(persisted2.eventId, persisted1.eventId);
  assert.equal(persisted2.correlationId, persisted1.correlationId);
  assert.equal(persisted2.payload.text, 'Hello');

  const queueA = new PostgresJobQueue({ pool, ownerId: 'worker-a', leaseMs: 5_000, jitter: () => 0 });
  const queueB = new PostgresJobQueue({ pool, ownerId: 'worker-b', leaseMs: 5_000, jitter: () => 0 });
  const enqueued1 = await queueA.enqueue({
    tenantId: 'acme', type: 'process_inbound', payload: { messageId: 'wamid.1' },
    idempotencyKey: 'acme:wamid.1:process_inbound', maxAttempts: 3
  });
  const enqueued2 = await queueA.enqueue({
    tenantId: 'acme', type: 'process_inbound', payload: { messageId: 'wamid.1' },
    idempotencyKey: 'acme:wamid.1:process_inbound', maxAttempts: 3
  });
  assert.equal(enqueued2.id, enqueued1.id);

  const concurrent = await Promise.all([queueA.claimNext(), queueB.claimNext()]);
  const claimed = concurrent.filter(Boolean);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].id, enqueued1.id);
  assert.equal(claimed[0].attemptCount, 1);

  await pool.query("UPDATE durable_jobs SET leased_until = NOW() - INTERVAL '1 second' WHERE id = $1", [enqueued1.id]);
  const recovered = await queueB.claimNext();
  assert.equal(recovered.id, enqueued1.id);
  assert.equal(recovered.leaseOwner, 'worker-b');
  assert.equal(recovered.attemptCount, 2);

  const requeued = await queueB.fail(recovered, new Error('private-provider-detail'));
  assert.equal(requeued.status, 'queued');
  assert.equal(requeued.lastError, 'job_failed');
  assert.equal(String(requeued.lastError).includes('private-provider-detail'), false);

  await pool.query('UPDATE durable_jobs SET available_at = NOW() WHERE id = $1', [enqueued1.id]);
  const terminalClaim = await queueA.claimNext();
  assert.equal(terminalClaim.attemptCount, 3);
  const dead = await queueA.fail(terminalClaim, new Error('still-private'));
  assert.equal(dead.status, 'dead');
  assert.equal(dead.lastError, 'job_failed');

  console.log('postgres durability integration: ok');
} finally {
  await pool.end();
}
