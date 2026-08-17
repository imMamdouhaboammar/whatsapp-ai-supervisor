import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHttpServer } from '../src/app.js';
import { InMemoryAuditStore } from '../src/core/audit-store.js';

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

function deps() {
  const auditStore = new InMemoryAuditStore();
  const tenant = {
    id: 'demo',
    phoneNumberId: 'phone-123',
    shadowMode: true,
    policy: { minConfidence: 0.8, defaultAction: 'human', rules: [{ id: 'faq', intent: 'faq', action: 'reply' }] },
    ai: { route: 'standard', routes: { standard: [{ provider: 'fake', model: 'fake' }] } }
  };
  const tenantStore = {
    findById(id) { return id === 'demo' ? tenant : null; },
    findByPhoneNumberId(id) { return id === 'phone-123' ? tenant : null; },
    findByLinkedDeviceSessionId(id) { return id === 'demo-session' ? tenant : null; }
  };
  const orchestratorForTenant = () => ({
    async handle(message, currentTenant) {
      const event = {
        id: 'audit-1', tenantId: currentTenant.id, messageId: message.id, customerId: message.customerId,
        channel: message.channel, at: new Date(0).toISOString(), model: { intent: 'faq' },
        permission: { action: 'reply' }, result: { action: 'shadow' }
      };
      auditStore.append(event);
      return { action: currentTenant.shadowMode ? 'shadow' : 'reply', wouldAction: 'reply' };
    }
  });
  return { verifyToken: 'verify-me', appSecret: null, tenantStore, orchestratorForTenant, auditStore, linkedDeviceIngressToken: 'ingress-secret' };
}

test('GET /health returns service status', async () => {
  await withServer(deps(), async (base) => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', service: 'whatsapp-ai-supervisor' });
  });
});

test('GET /webhooks/whatsapp returns Meta verification challenge', async () => {
  await withServer(deps(), async (base) => {
    const response = await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '12345');
  });
});

test('POST /v1/simulate is dry-run by default and returns shadow result', async () => {
  await withServer(deps(), async (base) => {
    const response = await fetch(`${base}/v1/simulate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: 'demo', text: 'hello', customerId: 'sim-user' })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.dryRun, true);
    assert.equal(body.result.action, 'shadow');
  });
});

test('POST WhatsApp webhook processes normalized text message for matching tenant', async () => {
  const d = deps();
  await withServer(d, async (base) => {
    const response = await fetch(`${base}/webhooks/whatsapp`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [{ changes: [{ value: {
          metadata: { phone_number_id: 'phone-123' },
          messages: [{ id: 'wamid.in', from: '20100', timestamp: '1720000000', type: 'text', text: { body: 'Hello' } }]
        } }] }]
      })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).processed, 1);
    assert.equal(d.auditStore.list('demo').length, 1);
  });
});

test('duplicate WhatsApp webhook message id is not processed twice', async () => {
  const d = deps();
  await withServer(d, async (base) => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: 'phone-123' },
        messages: [{ id: 'wamid.duplicate', from: '20100', timestamp: '1720000000', type: 'text', text: { body: 'Hello' } }]
      } }] }]
    };
    const first = await fetch(`${base}/webhooks/whatsapp`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
    });
    const second = await fetch(`${base}/webhooks/whatsapp`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
    });
    assert.equal((await first.json()).processed, 1);
    const secondBody = await second.json();
    assert.equal(secondBody.processed, 0);
    assert.equal(secondBody.duplicates, 1);
    assert.equal(d.auditStore.list('demo').length, 1);
  });
});

test('linked-device ingress rejects requests without worker bearer token', async () => {
  const d = deps();
  await withServer(d, async (base) => {
    const response = await fetch(`${base}/internal/transports/linked-device/message`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'demo-session', message: { id: 'm-linked', from: '20100@c.us', text: 'Hello', timestamp: 1, type: 'chat' } })
    });
    assert.equal(response.status, 401);
    assert.equal(d.auditStore.list('demo').length, 0);
  });
});

test('linked-device ingress processes direct text for tenant session and deduplicates it', async () => {
  const d = deps();
  await withServer(d, async (base) => {
    const payload = { sessionId: 'demo-session', message: { id: 'm-linked', from: '20100@c.us', customerName: 'M', text: 'Hello', timestamp: 1, type: 'chat', fromMe: false, isGroup: false } };
    const init = {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ingress-secret' },
      body: JSON.stringify(payload)
    };
    const first = await fetch(`${base}/internal/transports/linked-device/message`, init);
    const second = await fetch(`${base}/internal/transports/linked-device/message`, init);
    assert.equal(first.status, 200);
    assert.equal((await first.json()).processed, 1);
    assert.equal((await second.json()).duplicates, 1);
    assert.equal(d.auditStore.list('demo').length, 1);
  });
});

test('linked-device ingress ignores group messages unless tenant opts in', async () => {
  const d = deps();
  await withServer(d, async (base) => {
    const response = await fetch(`${base}/internal/transports/linked-device/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ingress-secret' },
      body: JSON.stringify({ sessionId: 'demo-session', message: { id: 'm-group', from: '123@g.us', text: 'Hello', timestamp: 1, type: 'chat', fromMe: false, isGroup: true } })
    });
    assert.equal(response.status, 202);
    assert.equal((await response.json()).ignored, true);
    assert.equal(d.auditStore.list('demo').length, 0);
  });
});

test('legacy v1 control endpoints require management bearer auth when configured', async () => {
  const d = { ...deps(), managementToken: 'operator-secret' };
  await withServer(d, async (base) => {
    const simulateInit = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: 'demo', text: 'hello', customerId: 'sim-user' })
    };
    const deniedSimulation = await fetch(`${base}/v1/simulate`, simulateInit);
    const deniedAudit = await fetch(`${base}/v1/audit?tenantId=demo`);
    assert.equal(deniedSimulation.status, 401);
    assert.equal(deniedAudit.status, 401);

    const allowedSimulation = await fetch(`${base}/v1/simulate`, {
      ...simulateInit,
      headers: { ...simulateInit.headers, authorization: 'Bearer operator-secret' }
    });
    const allowedAudit = await fetch(`${base}/v1/audit?tenantId=demo`, {
      headers: { authorization: 'Bearer operator-secret' }
    });
    assert.equal(allowedSimulation.status, 200);
    assert.equal(allowedAudit.status, 200);
  });
});

test('unexpected internal errors are not returned to clients', async () => {
  const d = deps();
  d.orchestratorForTenant = () => ({ async handle() { throw new Error('private-file:/srv/secrets/customer-data'); } });
  await withServer(d, async (base) => {
    const response = await fetch(`${base}/v1/simulate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: 'demo', text: 'trigger failure' })
    });
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.deepEqual(body, { error: 'internal_error' });
    assert.equal(JSON.stringify(body).includes('private-file'), false);
  });
});

test('webhook processing failures do not expose internal exception details', async () => {
  const d = deps();
  d.orchestratorForTenant = () => ({ async handle() { throw new Error('provider-secret:/internal/model/error'); } });
  await withServer(d, async (base) => {
    const response = await fetch(`${base}/webhooks/whatsapp`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [{ changes: [{ value: {
          metadata: { phone_number_id: 'phone-123' },
          messages: [{ id: 'wamid.failure', from: '20100', timestamp: '1720000000', type: 'text', text: { body: 'Hello' } }]
        } }] }]
      })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.processed, 0);
    assert.deepEqual(body.failures, [{ messageId: 'wamid.failure', error: 'processing_failed' }]);
    assert.equal(JSON.stringify(body).includes('provider-secret'), false);
  });
});
