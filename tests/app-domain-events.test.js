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

function fixture() {
  const inboundRecords = [];
  const orchestratedMessages = [];
  const tenant = {
    id: 'acme',
    phoneNumberId: 'phone-123',
    whatsapp: { mode: 'cloud', allowGroups: false },
    ai: { routes: {} },
    policy: { rules: [] }
  };
  return {
    inboundRecords,
    orchestratedMessages,
    deps: {
      verifyToken: 'verify',
      appSecret: null,
      linkedDeviceIngressToken: 'linked-secret',
      tenantStore: {
        findByPhoneNumberId: (id) => id === 'phone-123' ? tenant : null,
        findByLinkedDeviceSessionId: (id) => id === 'linked-session' ? tenant : null,
        findById: (id) => id === 'acme' ? tenant : null
      },
      auditStore: { append() {}, list() { return []; } },
      conversationStore: {
        recordInbound(message, domainEvent) { inboundRecords.push({ message, domainEvent }); },
        recordDecision() {},
        isHumanControlled() { return false; }
      },
      orchestratorForTenant: () => ({
        async handle(message) {
          orchestratedMessages.push(message);
          return { action: 'ignore', model: { intent: 'other', confidence: 0.9 }, permission: { action: 'ignore' } };
        }
      })
    }
  };
}

function assertInboundRoot(record, expectedConnector) {
  assert.equal(record.domainEvent.eventType, 'message.received');
  assert.equal(record.domainEvent.schemaVersion, 1);
  assert.equal(record.domainEvent.tenantId, 'acme');
  assert.equal(record.domainEvent.conversationId, 'whatsapp:20100');
  assert.equal(record.domainEvent.messageId, record.message.id);
  assert.equal(record.domainEvent.correlationId, record.domainEvent.eventId);
  assert.equal(record.domainEvent.causationId, undefined);
  assert.equal(record.domainEvent.idempotencyKey, `acme:${record.message.id}`);
  assert.deepEqual(record.domainEvent.actor, { type: 'connector', id: expectedConnector });
  assert.deepEqual(record.domainEvent.payload, {
    channel: 'whatsapp',
    customerId: '20100',
    customerName: 'Nora',
    text: 'Hello'
  });
}

test('Meta Cloud ingress creates one canonical message.received correlation root', async () => {
  const { deps, inboundRecords, orchestratedMessages } = fixture();
  await withServer(deps, async (base) => {
    const response = await fetch(`${base}/webhooks/whatsapp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [{ changes: [{ value: {
          metadata: { phone_number_id: 'phone-123' },
          contacts: [{ wa_id: '20100', profile: { name: 'Nora' } }],
          messages: [{ id: 'wamid.cloud', from: '20100', timestamp: '1720000000', type: 'text', text: { body: 'Hello' } }]
        } }] }]
      })
    });
    assert.equal(response.status, 200);
  });

  assert.equal(inboundRecords.length, 1);
  assertInboundRoot(inboundRecords[0], 'whatsapp-cloud');
  assert.equal(Object.hasOwn(orchestratedMessages[0], 'domainEvent'), false);
});

test('linked-device ingress uses the same root contract with linked-device actor identity', async () => {
  const { deps, inboundRecords } = fixture();
  await withServer(deps, async (base) => {
    const response = await fetch(`${base}/internal/transports/linked-device/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer linked-secret' },
      body: JSON.stringify({
        sessionId: 'linked-session',
        message: {
          id: 'wamid.linked', from: '20100@c.us', customerName: 'Nora', text: 'Hello',
          timestamp: 1720000000, type: 'chat', fromMe: false, isGroup: false
        }
      })
    });
    assert.equal(response.status, 200);
  });

  assert.equal(inboundRecords.length, 1);
  assertInboundRoot(inboundRecords[0], 'whatsapp-linked-device');
});

test('duplicate ingress does not create a second domain correlation root', async () => {
  const { deps, inboundRecords } = fixture();
  await withServer(deps, async (base) => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: 'phone-123' },
        messages: [{ id: 'wamid.same', from: '20100', timestamp: '1720000000', type: 'text', text: { body: 'Hello' } }]
      } }] }]
    };
    const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) };
    await fetch(`${base}/webhooks/whatsapp`, init);
    await fetch(`${base}/webhooks/whatsapp`, init);
  });

  assert.equal(inboundRecords.length, 1);
});
