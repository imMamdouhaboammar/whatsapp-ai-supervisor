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
    findByPhoneNumberId(id) { return id === 'phone-123' ? tenant : null; }
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
  return { verifyToken: 'verify-me', appSecret: null, tenantStore, orchestratorForTenant, auditStore };
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
