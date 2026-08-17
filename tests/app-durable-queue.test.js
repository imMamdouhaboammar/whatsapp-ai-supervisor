import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHttpServer } from '../src/app.js';

async function withServer(deps, fn) {
  const server = createHttpServer(deps);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

function webhookBody(id = 'wamid.queue') {
  return {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: {
      metadata: { phone_number_id: 'phone-123' },
      contacts: [{ wa_id: '20100', profile: { name: 'Nora' } }],
      messages: [{ id, from: '20100', timestamp: '1720000000', type: 'text', text: { body: 'Hello' } }]
    } }] }]
  };
}

test('durable mode persists inbound root and enqueues processing without invoking the orchestrator in the webhook request', async () => {
  const tenant = { id: 'acme', phoneNumberId: 'phone-123', whatsapp: { mode: 'cloud' }, ai: { routes: {} }, policy: { rules: [] } };
  const enqueued = [];
  const persisted = [];
  let orchestratorCalls = 0;
  const deps = {
    verifyToken: 'verify', appSecret: null,
    tenantStore: {
      findByPhoneNumberId: (id) => id === 'phone-123' ? tenant : null,
      findById: (id) => id === 'acme' ? tenant : null
    },
    claimStore: { async claim() { return true; }, async release() { throw new Error('release_should_not_run'); } },
    domainEventStore: {
      async append(event) { persisted.push(event); return event; }
    },
    jobQueue: {
      async enqueue(job) { enqueued.push(job); return { id: 'job-1', ...job, status: 'queued', attemptCount: 0, maxAttempts: job.maxAttempts }; }
    },
    auditStore: { append() {}, list() { return []; } },
    conversationStore: {
      recordInbound() {}, recordDecision() { throw new Error('decision_should_be_deferred'); }, isHumanControlled() { return false; }
    },
    sseBroadcaster: { broadcastDomainEvent() {} },
    orchestratorForTenant: () => ({ async handle() { orchestratorCalls += 1; throw new Error('orchestrator_should_be_deferred'); } })
  };

  await withServer(deps, async (base) => {
    const response = await fetch(`${base}/webhooks/whatsapp`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(webhookBody())
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: 1, processed: 1, queued: 1, duplicates: 0, failures: [] });
  });

  assert.equal(orchestratorCalls, 0);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].eventType, 'message.received');
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].tenantId, 'acme');
  assert.equal(enqueued[0].type, 'process_inbound');
  assert.equal(enqueued[0].idempotencyKey, 'acme:wamid.queue:process_inbound');
  assert.equal(enqueued[0].maxAttempts, 5);
  assert.equal(enqueued[0].payload.message.id, 'wamid.queue');
  assert.equal(enqueued[0].payload.message.tenantId, 'acme');
  assert.equal(enqueued[0].payload.inboundEvent.eventId, persisted[0].eventId);
});

test('durable enqueue failure releases the ingress claim so a later webhook retry can repair the durable handoff', async () => {
  const tenant = { id: 'acme', phoneNumberId: 'phone-123', whatsapp: { mode: 'cloud' }, ai: { routes: {} }, policy: { rules: [] } };
  let releases = 0;
  const deps = {
    verifyToken: 'verify', appSecret: null,
    tenantStore: { findByPhoneNumberId: () => tenant, findById: () => tenant },
    claimStore: { async claim() { return true; }, async release() { releases += 1; } },
    domainEventStore: { async append(event) { return event; } },
    jobQueue: { async enqueue() { throw new Error('database_queue_unavailable'); } },
    auditStore: { append() {}, list() { return []; } },
    conversationStore: { recordInbound() {}, recordDecision() {}, isHumanControlled() { return false; } },
    orchestratorForTenant: () => ({ async handle() { throw new Error('should_not_run'); } })
  };

  await withServer(deps, async (base) => {
    const response = await fetch(`${base}/webhooks/whatsapp`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(webhookBody('wamid.enqueue-fail'))
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.processed, 0);
    assert.equal(body.queued, 0);
    assert.equal(body.failures[0].error, 'processing_failed');
  });
  assert.equal(releases, 1);
});
