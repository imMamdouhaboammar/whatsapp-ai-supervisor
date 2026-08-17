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

test('HTTP ingress broadcasts canonical root and decision events in one correlation chain', async () => {
  const events = [];
  const tenant = { id: 'acme', phoneNumberId: 'phone-123', whatsapp: { mode: 'cloud' }, policy: { rules: [] }, ai: { routes: {} } };
  const deps = {
    verifyToken: 'verify',
    appSecret: null,
    tenantStore: {
      findByPhoneNumberId: (id) => id === 'phone-123' ? tenant : null,
      findById: (id) => id === 'acme' ? tenant : null
    },
    auditStore: { append() {}, list() { return []; } },
    conversationStore: {
      recordInbound() {},
      recordDecision() {},
      isHumanControlled() { return false; }
    },
    orchestratorForTenant: () => ({
      async handle() {
        return {
          action: 'ignore',
          model: { intent: 'other', confidence: 0.91, provider: 'openai', model: 'gpt-5.6' },
          permission: { action: 'ignore', reason: 'matched_rule' }
        };
      }
    }),
    sseBroadcaster: {
      broadcast() { throw new Error('legacy_realtime_broadcast_used'); },
      broadcastDomainEvent(event) { events.push(event); }
    }
  };

  await withServer(deps, async (base) => {
    const response = await fetch(`${base}/webhooks/whatsapp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [{ changes: [{ value: {
          metadata: { phone_number_id: 'phone-123' },
          messages: [{ id: 'wamid.in', from: '20100', timestamp: '1720000000', type: 'text', text: { body: 'Hello' } }]
        } }] }]
      })
    });
    assert.equal(response.status, 200);
  });

  assert.deepEqual(events.map((event) => event.eventType), ['message.received', 'decision.completed']);
  assert.equal(events[0].correlationId, events[0].eventId);
  assert.equal(events[1].correlationId, events[0].eventId);
  assert.equal(events[1].causationId, events[0].eventId);
  assert.equal(events[1].messageId, 'wamid.in');
});
