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

test('worker API echo arriving before central attribution never triggers human takeover', async () => {
  let transitions = 0;
  let orchestratorCalls = 0;
  let manualRows = 0;
  const tenant = { id: 'demo', whatsapp: { mode: 'linked-device', sessionId: 'demo-session' } };

  await withServer({
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
      async get() {
        return {
          tenantId: 'demo', conversationId: 'whatsapp:20100', state: 'AI_ACTIVE', version: 0,
          changedAt: '2026-08-27T10:00:00.000Z', changedBy: 'supervisor',
          reasonCode: 'default_ai_active', transitionId: null
        };
      },
      async transition() { transitions += 1; throw new Error('takeover_must_not_run'); }
    },
    outboundAttributionStore: {
      async findByPlatformMessageId() { return null; },
      async consumeEcho() { throw new Error('consume_must_not_run_without_attribution'); }
    },
    domainEventStore: { async append(event) { return event; } },
    conversationStore: {
      recordManualOutbound() { manualRows += 1; },
      setControl() { throw new Error('legacy_takeover_must_not_run'); }
    }
  }, async (base) => {
    const response = await fetch(`${base}/internal/transports/linked-device/message`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ingress-secret'
      },
      body: JSON.stringify({
        sessionId: 'demo-session',
        message: {
          id: 'true_20100@c.us_RACE1',
          from: '20100@c.us',
          to: '20100@c.us',
          text: 'agent reply',
          timestamp: 100,
          type: 'chat',
          fromMe: true,
          isGroup: false,
          originHint: 'worker_api',
          apiSendOperationId: 'op-race-1'
        }
      })
    });

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      ignored: true,
      origin: 'worker_api_echo_pending_attribution'
    });
  });

  assert.equal(transitions, 0);
  assert.equal(manualRows, 0);
  assert.equal(orchestratorCalls, 0);
});

test('untrusted-looking origin hint without a valid operation id does not bypass takeover classification', async () => {
  let transitions = 0;
  const tenant = { id: 'demo', whatsapp: { mode: 'linked-device', sessionId: 'demo-session' } };
  const current = {
    tenantId: 'demo', conversationId: 'whatsapp:20100', state: 'AI_ACTIVE', version: 0,
    changedAt: '2026-08-27T10:00:00.000Z', changedBy: 'supervisor', reasonCode: 'default_ai_active', transitionId: null
  };

  await withServer({
    verifyToken: 'verify', appSecret: null, linkedDeviceIngressToken: 'ingress-secret',
    tenantStore: {
      findByLinkedDeviceSessionId() { return tenant; },
      findByPhoneNumberId() { return null; },
      findById() { return tenant; }
    },
    orchestratorForTenant: () => ({ async handle() { throw new Error('model_must_not_run'); } }),
    auditStore: { append() {}, list() { return []; } },
    ownershipStore: {
      async get() { return current; },
      async transition(input) {
        transitions += 1;
        return {
          ...current,
          state: 'HUMAN_ACTIVE',
          version: 1,
          changedBy: input.actor,
          reasonCode: input.reasonCode,
          transitionId: input.transitionId
        };
      }
    },
    outboundAttributionStore: { async findByPlatformMessageId() { return null; } },
    domainEventStore: { async append(event) { return event; } },
    conversationStore: { recordManualOutbound() {}, setControl() {} }
  }, async (base) => {
    const response = await fetch(`${base}/internal/transports/linked-device/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ingress-secret' },
      body: JSON.stringify({
        sessionId: 'demo-session',
        message: {
          id: 'manual-1', from: '20100@c.us', to: '20100@c.us', text: 'manual reply',
          timestamp: 101, type: 'chat', fromMe: true, isGroup: false,
          originHint: 'worker_api'
        }
      })
    });
    assert.equal(response.status, 200);
  });

  assert.equal(transitions, 1);
});
