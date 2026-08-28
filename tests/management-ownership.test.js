import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createManagementRouter } from '../src/management/router.js';

async function start(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

function ownership(state = 'AI_ACTIVE', version = 0) {
  return {
    tenantId: 'acme', conversationId: 'whatsapp:c1', state, version,
    changedAt: '2026-08-27T09:30:00.000Z', changedBy: 'supervisor',
    reasonCode: 'test', transitionId: version ? `t-${version}` : null
  };
}

function fixture() {
  const tenant = { id: 'acme', whatsapp: { mode: 'linked-device', sessionId: 'acme-sales' } };
  const current = { value: ownership() };
  const transitions = [];
  const controls = [];
  const attributions = [];
  const domainEvents = [];
  const manual = [];
  const router = createManagementRouter({
    token: 'secret',
    tenantStore: { list: () => [tenant], findById: (id) => id === 'acme' ? tenant : null },
    auditStore: { list: () => [] },
    conversationStore: {
      list: () => [{ tenantId: 'acme', customerId: 'c1', customerName: 'Nora', control: controls.at(-1)?.mode ?? 'ai', messages: [] }],
      setControl: (tenantId, customerId, mode) => controls.push({ tenantId, customerId, mode }),
      isHumanControlled: () => controls.at(-1)?.mode === 'human',
      recordManualOutbound: (value) => manual.push(value)
    },
    ownershipStore: {
      async get() { return current.value; },
      async transition(input) {
        transitions.push(input);
        if (input.expectedVersion !== current.value.version) {
          const error = new Error('ownership_version_conflict');
          error.statusCode = 409;
          throw error;
        }
        const target = input.command === 'manual_takeover' ? 'HUMAN_ACTIVE' : 'AI_ACTIVE';
        current.value = {
          ...current.value,
          state: target,
          version: current.value.version + (target === current.value.state ? 0 : 1),
          transitionId: input.transitionId,
          changedBy: input.actor,
          reasonCode: input.reasonCode
        };
        return current.value;
      }
    },
    outboundAttributionStore: { async record(value) { attributions.push(value); return value; } },
    domainEventStore: { async append(event) { domainEvents.push(event); return event; } },
    readiness: async () => ({ ready: true }),
    linkedDeviceStatus: async () => [],
    manualSend: async () => ({
      id: 'out-operator-1',
      platformMessageId: 'out-operator-1',
      transport: 'linked-device',
      sessionId: 'acme-sales'
    })
  });
  const server = createServer((req, res) => router(req, res, new URL(req.url, 'http://localhost')));
  return { server, current, transitions, controls, attributions, domainEvents, manual };
}

const headers = { authorization: 'Bearer secret', 'content-type': 'application/json' };

test('management takeover writes HUMAN_ACTIVE with expected-version semantics and legacy projection', async () => {
  const f = fixture();
  const base = await start(f.server);
  try {
    const response = await fetch(`${base}/api/management/conversations/control`, {
      method: 'POST', headers,
      body: JSON.stringify({ tenantId: 'acme', customerId: 'c1', mode: 'human', expectedVersion: 0, transitionId: 'ui-takeover-1' })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.mode, 'human');
    assert.equal(body.ownership.state, 'HUMAN_ACTIVE');
    assert.equal(body.ownership.version, 1);
    assert.equal(f.transitions[0].command, 'manual_takeover');
    assert.equal(f.transitions[0].expectedVersion, 0);
    assert.deepEqual(f.controls, [{ tenantId: 'acme', customerId: 'c1', mode: 'human' }]);
    assert.equal(f.domainEvents.at(-1).eventType, 'conversation.ownership_changed');
  } finally { f.server.close(); }
});

test('management release is explicit and maps HUMAN_ACTIVE back to AI_ACTIVE', async () => {
  const f = fixture();
  f.current.value = ownership('HUMAN_ACTIVE', 3);
  const base = await start(f.server);
  try {
    const response = await fetch(`${base}/api/management/conversations/control`, {
      method: 'POST', headers,
      body: JSON.stringify({ tenantId: 'acme', customerId: 'c1', mode: 'ai', expectedVersion: 3, transitionId: 'ui-release-1' })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ownership.state, 'AI_ACTIVE');
    assert.equal(f.transitions[0].command, 'release_to_agent');
    assert.deepEqual(f.controls, [{ tenantId: 'acme', customerId: 'c1', mode: 'ai' }]);
  } finally { f.server.close(); }
});

test('management stale expected version returns conflict without changing ownership', async () => {
  const f = fixture();
  f.current.value = ownership('HUMAN_ACTIVE', 4);
  const base = await start(f.server);
  try {
    const response = await fetch(`${base}/api/management/conversations/control`, {
      method: 'POST', headers,
      body: JSON.stringify({ tenantId: 'acme', customerId: 'c1', mode: 'ai', expectedVersion: 2, transitionId: 'stale-release' })
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'ownership_version_conflict' });
    assert.equal(f.current.value.state, 'HUMAN_ACTIVE');
    assert.equal(f.controls.length, 0);
  } finally { f.server.close(); }
});

test('manual linked-device send requires canonical HUMAN_ACTIVE and records operator_api attribution', async () => {
  const f = fixture();
  const base = await start(f.server);
  try {
    const blocked = await fetch(`${base}/api/management/conversations/send`, {
      method: 'POST', headers,
      body: JSON.stringify({ tenantId: 'acme', customerId: 'c1', text: 'Hello' })
    });
    assert.equal(blocked.status, 409);

    f.current.value = ownership('HUMAN_ACTIVE', 1);
    const sent = await fetch(`${base}/api/management/conversations/send`, {
      method: 'POST', headers,
      body: JSON.stringify({ tenantId: 'acme', customerId: 'c1', text: 'Hello' })
    });
    assert.equal(sent.status, 200);
    assert.equal(f.manual.length, 1);
    assert.equal(f.attributions.length, 1);
    assert.equal(f.attributions[0].origin, 'operator_api');
    assert.equal(f.attributions[0].platformMessageId, 'out-operator-1');
    assert.equal(f.attributions[0].conversationId, 'whatsapp:c1');
  } finally { f.server.close(); }
});

test('conversation listing exposes canonical ownership alongside legacy control', async () => {
  const f = fixture();
  f.current.value = ownership('WAITING_APPROVAL', 2);
  const base = await start(f.server);
  try {
    const response = await fetch(`${base}/api/management/conversations?tenantId=acme`, { headers });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.conversations[0].ownership.state, 'WAITING_APPROVAL');
    assert.equal(body.conversations[0].ownership.version, 2);
  } finally { f.server.close(); }
});
