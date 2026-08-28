import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { runPostgresMigrations } from '../src/storage/postgres-migrations.js';
import { PostgresClaimStore } from '../src/storage/postgres-claim-store.js';
import { PostgresDomainEventStore } from '../src/storage/postgres-domain-event-store.js';
import { PostgresConversationOwnershipStore } from '../src/storage/postgres-conversation-ownership-store.js';
import { PostgresOutboundAttributionStore } from '../src/storage/postgres-outbound-attribution-store.js';
import { PostgresJobQueue } from '../src/jobs/postgres-job-queue.js';
import { createDomainEvent } from '../src/domain/domain-event.js';
import { createOutboundAttribution } from '../src/domain/outbound-attribution.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for Postgres integration test');

const pool = new Pool({ connectionString, max: 8 });

try {
  const applied = await runPostgresMigrations({ pool });
  assert.ok(Array.isArray(applied));
  await pool.query(`TRUNCATE TABLE
    outbound_attributions,
    conversation_ownership_transitions,
    conversation_ownership,
    durable_jobs,
    inbound_claims,
    domain_events
    RESTART IDENTITY`);

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

  const ownership = new PostgresConversationOwnershipStore({ pool });
  const ownershipDefault = await ownership.get('acme', 'whatsapp:20100');
  assert.equal(ownershipDefault.state, 'AI_ACTIVE');
  assert.equal(ownershipDefault.version, 0);

  const takeover = await ownership.transition({
    tenantId: 'acme',
    conversationId: 'whatsapp:20100',
    command: 'manual_takeover',
    transitionId: 'takeover-1',
    actor: 'operator:phone',
    reasonCode: 'manual_outbound_observed',
    expectedVersion: 0
  });
  assert.equal(takeover.state, 'HUMAN_ACTIVE');
  assert.equal(takeover.version, 1);

  const duplicateTakeover = await ownership.transition({
    tenantId: 'acme',
    conversationId: 'whatsapp:20100',
    command: 'manual_takeover',
    transitionId: 'takeover-1',
    actor: 'operator:phone',
    reasonCode: 'manual_outbound_observed',
    expectedVersion: 0
  });
  assert.equal(duplicateTakeover.state, 'HUMAN_ACTIVE');
  assert.equal(duplicateTakeover.version, 1);

  const releasedOwnership = await ownership.transition({
    tenantId: 'acme',
    conversationId: 'whatsapp:20100',
    command: 'release_to_agent',
    transitionId: 'release-1',
    actor: 'operator:management',
    reasonCode: 'management_release',
    expectedVersion: 1
  });
  assert.equal(releasedOwnership.state, 'AI_ACTIVE');
  assert.equal(releasedOwnership.version, 2);

  await assert.rejects(ownership.transition({
    tenantId: 'acme',
    conversationId: 'whatsapp:20100',
    command: 'manual_takeover',
    transitionId: 'stale-takeover',
    actor: 'operator:old-tab',
    reasonCode: 'stale',
    expectedVersion: 1
  }), /ownership_version_conflict/);

  const attributions = new PostgresOutboundAttributionStore({ pool });
  const agentAttribution = createOutboundAttribution({
    tenantId: 'acme',
    sessionId: 'acme-sales',
    conversationId: 'whatsapp:20100',
    customerId: '20100',
    platformMessageId: 'out-agent-1',
    origin: 'agent',
    sourceMessageId: 'wamid.1'
  });
  const recordedAttribution = await attributions.record(agentAttribution);
  assert.equal(recordedAttribution.origin, 'agent');

  const duplicateAttribution = await attributions.record({ ...agentAttribution, origin: 'operator_api' });
  assert.equal(duplicateAttribution.origin, 'agent');
  const matchedAttribution = await attributions.findByPlatformMessageId('acme', 'acme-sales', 'out-agent-1');
  assert.equal(matchedAttribution.origin, 'agent');
  const consumedAttribution = await attributions.consumeEcho('acme', 'acme-sales', 'out-agent-1');
  assert.ok(consumedAttribution.echoObservedAt);
  const consumedAgain = await attributions.consumeEcho('acme', 'acme-sales', 'out-agent-1');
  assert.equal(consumedAgain.echoObservedAt, consumedAttribution.echoObservedAt);

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
