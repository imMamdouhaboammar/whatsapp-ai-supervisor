import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileConversationOwnershipStore } from '../src/core/file-conversation-ownership-store.js';
import { FileOutboundAttributionStore } from '../src/core/file-outbound-attribution-store.js';
import { WhatsAppLinkedDeviceSender } from '../src/channels/whatsapp-linked-device.js';
import { createManagementRouter } from '../src/management/router.js';
import { PostgresConversationOwnershipStore } from '../src/storage/postgres-conversation-ownership-store.js';
import { SupervisorOrchestrator } from '../src/core/orchestrator.js';
import { InMemoryAuditStore } from '../src/core/audit-store.js';

function attribution(overrides = {}) {
  return {
    tenantId: 'acme/sales',
    sessionId: 'sales',
    conversationId: 'whatsapp:20100',
    customerId: '20100',
    platformMessageId: 'out-1',
    origin: 'agent',
    sourceMessageId: 'in-1',
    createdAt: '2026-08-27T09:00:00.000Z',
    expiresAt: '2026-08-28T09:00:00.000Z',
    echoObservedAt: null,
    ...overrides
  };
}

function ledgerEntries(dir) {
  return readdirSync(dir).flatMap((name) =>
    readFileSync(join(dir, name), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
  );
}

async function start(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

function canonicalOwnership(tenantId, conversationId, state = 'AI_ACTIVE', version = 0) {
  return {
    tenantId,
    conversationId,
    state,
    version,
    changedAt: '2026-08-27T10:00:00.000Z',
    changedBy: 'supervisor',
    reasonCode: state === 'AI_ACTIVE' ? 'default_ai_active' : 'manual_outbound_observed',
    transitionId: version ? `transition-${version}` : null
  };
}

test('file ownership tenant filenames are collision-free and legacy rows cannot cross tenant boundaries', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'was-ownership-collision-'));
  const store = new FileConversationOwnershipStore({ dataDir, now: () => '2026-08-27T10:00:00.000Z' });

  await store.transition({
    tenantId: 'acme/sales',
    conversationId: 'whatsapp:20100',
    command: 'manual_takeover',
    transitionId: 'takeover-slash',
    actor: 'operator',
    expectedVersion: 0
  });

  const other = await store.get('acme?sales', 'whatsapp:20100');
  assert.equal(other.tenantId, 'acme?sales');
  assert.equal(other.state, 'AI_ACTIVE');

  await store.transition({
    tenantId: 'acme?sales',
    conversationId: 'whatsapp:20100',
    command: 'manual_takeover',
    transitionId: 'takeover-question',
    actor: 'operator',
    expectedVersion: 0
  });

  assert.equal((await store.get('acme/sales', 'whatsapp:20100')).transitionId, 'takeover-slash');
  assert.equal((await store.get('acme?sales', 'whatsapp:20100')).transitionId, 'takeover-question');
  assert.ok(readdirSync(join(dataDir, 'ownership')).length >= 2);
});

test('file outbound attribution isolates colliding tenant ids', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'was-attribution-collision-'));
  const store = new FileOutboundAttributionStore({ dataDir });

  await store.record(attribution());
  await store.record(attribution({ tenantId: 'acme?sales', origin: 'operator_api' }));

  assert.equal((await store.findByPlatformMessageId('acme/sales', 'sales', 'out-1')).origin, 'agent');
  assert.equal((await store.findByPlatformMessageId('acme?sales', 'sales', 'out-1')).origin, 'operator_api');
  assert.ok(readdirSync(join(dataDir, 'outbound-attribution')).length >= 2);
});

test('file outbound attribution serializes concurrent record and echo writes per platform message', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'was-attribution-race-'));
  const store = new FileOutboundAttributionStore({ dataDir, now: () => '2026-08-27T09:07:00.000Z' });
  const value = attribution({ tenantId: 'acme' });

  await Promise.all([store.record(value), store.record(value), store.record(value)]);
  await Promise.all([
    store.consumeEcho('acme', 'sales', 'out-1'),
    store.consumeEcho('acme', 'sales', 'out-1'),
    store.consumeEcho('acme', 'sales', 'out-1')
  ]);

  const entries = ledgerEntries(join(dataDir, 'outbound-attribution'));
  assert.equal(entries.filter((entry) => entry.kind === 'record').length, 1);
  assert.equal(entries.filter((entry) => entry.kind === 'echo').length, 1);
});

test('linked-device sender rejects a successful worker response without a platform message id', async () => {
  const sender = new WhatsAppLinkedDeviceSender({
    baseUrl: 'http://worker:7441',
    token: 'secret',
    sessionId: 'sales',
    idFactory: () => 'op-1',
    fetchImpl: async () => new Response(JSON.stringify({ operationId: 'op-1' }), { status: 200 })
  });

  await assert.rejects(
    sender.sendText({ to: '20100', text: 'hello' }),
    /linked_device_message_id_missing/
  );
});

test('management router maps a bare ownership version conflict to HTTP 409', async () => {
  const tenant = { id: 'acme' };
  const router = createManagementRouter({
    token: 'secret',
    tenantStore: { list: () => [tenant], findById: () => tenant },
    auditStore: { list: () => [] },
    conversationStore: { list: () => [], setControl() {} },
    ownershipStore: {
      async get() { return canonicalOwnership('acme', 'whatsapp:20100'); },
      async transition() { throw new Error('ownership_version_conflict'); }
    },
    readiness: async () => ({ ready: true }),
    linkedDeviceStatus: async () => [],
    manualSend: async () => ({})
  });
  const server = createServer((req, res) => router(req, res, new URL(req.url, 'http://localhost')));
  const base = await start(server);
  try {
    const response = await fetch(`${base}/api/management/conversations/control`, {
      method: 'POST',
      headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: 'acme', customerId: '20100', mode: 'human', expectedVersion: 0 })
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'ownership_version_conflict' });
  } finally {
    server.close();
  }
});

test('management conversation projection uses one batch ownership lookup when available', async () => {
  const tenant = { id: 'acme' };
  let getManyCalls = 0;
  const router = createManagementRouter({
    token: 'secret',
    tenantStore: { list: () => [tenant], findById: () => tenant },
    auditStore: { list: () => [] },
    conversationStore: {
      list: () => [
        { tenantId: 'acme', customerId: 'c1', messages: [] },
        { tenantId: 'acme', customerId: 'c2', messages: [] }
      ]
    },
    ownershipStore: {
      async get() { throw new Error('single_get_should_not_run'); },
      async getMany(tenantId, conversationIds) {
        getManyCalls += 1;
        return conversationIds.map((conversationId, index) =>
          canonicalOwnership(tenantId, conversationId, index === 0 ? 'AI_ACTIVE' : 'HUMAN_ACTIVE', index)
        );
      },
      async transition() { throw new Error('unused'); }
    },
    readiness: async () => ({ ready: true }),
    linkedDeviceStatus: async () => [],
    manualSend: async () => ({})
  });
  const server = createServer((req, res) => router(req, res, new URL(req.url, 'http://localhost')));
  const base = await start(server);
  try {
    const response = await fetch(`${base}/api/management/conversations?tenantId=acme`, {
      headers: { authorization: 'Bearer secret' }
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(getManyCalls, 1);
    assert.equal(body.conversations[0].ownership.state, 'AI_ACTIVE');
    assert.equal(body.conversations[1].ownership.state, 'HUMAN_ACTIVE');
  } finally {
    server.close();
  }
});

test('postgres ownership store getMany uses one tenant-scoped query and defaults missing rows', async () => {
  let calls = 0;
  const pool = {
    async query(text, values) {
      calls += 1;
      assert.match(String(text), /conversation_id\s*=\s*ANY/i);
      assert.deepEqual(values, ['acme', ['whatsapp:c1', 'whatsapp:c2']]);
      return {
        rows: [{
          tenant_id: 'acme', conversation_id: 'whatsapp:c1', state: 'HUMAN_ACTIVE', version: 2,
          changed_at: '2026-08-27T10:00:00.000Z', changed_by: 'operator',
          reason_code: 'manual_outbound_observed', transition_id: 'takeover-2'
        }]
      };
    }
  };
  const store = new PostgresConversationOwnershipStore({ pool, now: () => '2026-08-27T10:00:00.000Z' });
  const results = await store.getMany('acme', ['whatsapp:c1', 'whatsapp:c2']);
  assert.equal(calls, 1);
  assert.equal(results[0].state, 'HUMAN_ACTIVE');
  assert.equal(results[1].state, 'AI_ACTIVE');
  assert.equal(results[1].tenantId, 'acme');
  assert.equal(results[1].conversationId, 'whatsapp:c2');
});

test('attribution persistence failure emits bounded structured warning without raw storage error', async () => {
  const warnings = [];
  const orchestrator = new SupervisorOrchestrator({
    modelGateway: {
      async decide() {
        return { intent: 'faq', confidence: 0.99, reply: 'Hi', requestedAction: 'reply' };
      }
    },
    channelSender: {
      async sendText() {
        return { id: 'out-1', platformMessageId: 'out-1', transport: 'linked-device', sessionId: 'sales' };
      }
    },
    auditStore: new InMemoryAuditStore(),
    outboundAttributionStore: { async record() { throw new Error('private-storage-detail'); } },
    logger: { warn(...args) { warnings.push(args); } }
  });
  const tenant = {
    id: 'acme',
    ai: { route: 'standard', routes: {} },
    policy: { minConfidence: 0.8, defaultAction: 'human', rules: [{ id: 'faq', intent: 'faq', action: 'reply' }] }
  };

  const result = await orchestrator.handle(
    { id: 'in-1', customerId: '20100', text: 'hello', channel: 'whatsapp' },
    tenant
  );

  assert.deepEqual(result.attribution, { recorded: false, reason: 'attribution_failed' });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], 'outbound_attribution_failed');
  assert.deepEqual(warnings[0][1], { tenantId: 'acme', sessionId: 'sales', platformMessageId: 'out-1' });
  assert.doesNotMatch(JSON.stringify(warnings), /private-storage-detail/);
});
