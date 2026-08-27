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

function ownership(state = 'AI_ACTIVE', version = 0) {
  return {
    tenantId: 'demo', conversationId: 'whatsapp:20100', state, version,
    changedAt: '2026-08-27T09:20:00.000Z', changedBy: 'supervisor',
    reasonCode: 'test', transitionId: version ? `t-${version}` : null
  };
}

function fixture({ attribution = null } = {}) {
  const tenant = { id: 'demo', whatsapp: { mode: 'linked-device', sessionId: 'demo-session', allowGroups: false } };
  const transitions = [];
  const consumed = [];
  const domainEvents = [];
  const manual = [];
  const controls = [];
  let orchestratorCalls = 0;
  const currentOwnership = { value: ownership() };

  return {
    deps: {
      verifyToken: 'verify',
      appSecret: null,
      linkedDeviceIngressToken: 'ingress-secret',
      tenantStore: {
        findByLinkedDeviceSessionId(id) { return id === 'demo-session' ? tenant : null; },
        findByPhoneNumberId() { return null; },
        findById() { return tenant; }
      },
      orchestratorForTenant: () => ({ async handle() { orchestratorCalls += 1; return { action: 'ignore' }; } }),
      auditStore: { append() {}, list() { return []; } },
      ownershipStore: {
        async get() { return currentOwnership.value; },
        async transition(input) {
          transitions.push(input);
          const next = ownership('HUMAN_ACTIVE', currentOwnership.value.version + 1);
          currentOwnership.value = { ...next, changedBy: input.actor, reasonCode: input.reasonCode, transitionId: input.transitionId };
          return currentOwnership.value;
        }
      },
      outboundAttributionStore: {
        async findByPlatformMessageId() { return attribution; },
        async consumeEcho(_tenantId, _sessionId, platformMessageId) { consumed.push(platformMessageId); return attribution; }
      },
      domainEventStore: { async append(event) { domainEvents.push(event); return event; } },
      conversationStore: {
        recordManualOutbound(value) { manual.push(value); },
        setControl(tenantId, customerId, mode) { controls.push({ tenantId, customerId, mode }); }
      }
    },
    transitions,
    consumed,
    domainEvents,
    manual,
    controls,
    orchestratorCalls: () => orchestratorCalls
  };
}

function requestBody(id = 'manual-1') {
  return {
    sessionId: 'demo-session',
    message: {
      id,
      from: '20100@c.us',
      to: '20100@c.us',
      customerName: 'Nora',
      text: 'manual reply',
      timestamp: 10,
      type: 'chat',
      fromMe: true,
      isGroup: false
    }
  };
}

function post(base, body = requestBody()) {
  return fetch(`${base}/internal/transports/linked-device/message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ingress-secret' },
    body: JSON.stringify(body)
  });
}

test('matched agent fromMe echo is consumed without human takeover', async () => {
  const f = fixture({ attribution: {
    tenantId: 'demo', sessionId: 'demo-session', conversationId: 'whatsapp:20100', customerId: '20100',
    platformMessageId: 'agent-1', origin: 'agent', sourceMessageId: 'in-1',
    createdAt: '2026-08-27T09:00:00.000Z', expiresAt: '2026-08-28T09:00:00.000Z', echoObservedAt: null
  } });
  await withServer(f.deps, async (base) => {
    const response = await post(base, requestBody('agent-1'));
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { ignored: true, origin: 'agent_echo' });
  });
  assert.deepEqual(f.consumed, ['agent-1']);
  assert.equal(f.transitions.length, 0);
  assert.equal(f.manual.length, 0);
  assert.equal(f.orchestratorCalls(), 0);
});

test('matched operator_api echo is consumed without creating a second takeover event', async () => {
  const f = fixture({ attribution: {
    tenantId: 'demo', sessionId: 'demo-session', conversationId: 'whatsapp:20100', customerId: '20100',
    platformMessageId: 'operator-1', origin: 'operator_api', sourceMessageId: null,
    createdAt: '2026-08-27T09:00:00.000Z', expiresAt: '2026-08-28T09:00:00.000Z', echoObservedAt: null
  } });
  await withServer(f.deps, async (base) => {
    const response = await post(base, requestBody('operator-1'));
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { ignored: true, origin: 'operator_api_echo' });
  });
  assert.deepEqual(f.consumed, ['operator-1']);
  assert.equal(f.transitions.length, 0);
  assert.equal(f.orchestratorCalls(), 0);
});

test('unmatched fromMe observation becomes durable human outbound and forces HUMAN_ACTIVE', async () => {
  const f = fixture();
  await withServer(f.deps, async (base) => {
    const response = await post(base);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.observed, true);
    assert.equal(body.ownership.state, 'HUMAN_ACTIVE');
  });

  assert.equal(f.transitions.length, 1);
  assert.equal(f.transitions[0].command, 'manual_takeover');
  assert.equal(f.transitions[0].expectedVersion, 0);
  assert.equal(f.transitions[0].transitionId, 'linked-device:demo-session:manual-1:takeover');
  assert.deepEqual(f.domainEvents.map((event) => event.eventType), [
    'human.outbound_observed',
    'conversation.ownership_changed'
  ]);
  assert.equal(f.manual.length, 1);
  assert.equal(f.manual[0].messageId, 'manual-1');
  assert.equal(f.manual[0].customerId, '20100');
  assert.deepEqual(f.controls, [{ tenantId: 'demo', customerId: '20100', mode: 'human' }]);
  assert.equal(f.orchestratorCalls(), 0);
});

test('duplicate unmatched fromMe observation is claimed once and never enters model path', async () => {
  const f = fixture();
  await withServer(f.deps, async (base) => {
    const first = await post(base);
    const second = await post(base);
    assert.equal(first.status, 200);
    assert.equal(second.status, 202);
    assert.deepEqual(await second.json(), { ignored: true, duplicate: true });
  });
  assert.equal(f.transitions.length, 1);
  assert.equal(f.manual.length, 1);
  assert.equal(f.orchestratorCalls(), 0);
});
