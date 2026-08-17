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

test('decision lineage derives from the canonical event returned by durable storage', async () => {
  const tenant = { id: 'acme', phoneNumberId: 'phone-123', whatsapp: { mode: 'cloud' }, ai: { routes: {} }, policy: { rules: [] } };
  const appended = [];
  const decisionRecords = [];
  const realtime = [];
  const canonicalRoot = {
    eventId: 'evt-existing-root',
    eventType: 'message.received',
    schemaVersion: 1,
    occurredAt: '2026-08-17T11:40:00.000Z',
    tenantId: 'acme',
    conversationId: 'whatsapp:20100',
    messageId: 'wamid.retry',
    correlationId: 'evt-existing-root',
    causationId: undefined,
    idempotencyKey: 'acme:wamid.retry',
    actor: { type: 'connector', id: 'whatsapp-cloud' },
    payload: { channel: 'whatsapp', customerId: '20100', customerName: 'Nora', text: 'Hello' }
  };

  const deps = {
    verifyToken: 'verify', appSecret: null,
    tenantStore: {
      findByPhoneNumberId: (id) => id === 'phone-123' ? tenant : null,
      findById: (id) => id === 'acme' ? tenant : null
    },
    claimStore: { async claim() { return true; }, async release() {} },
    auditStore: { append() {}, list() { return []; } },
    domainEventStore: {
      async append(event) {
        appended.push(event);
        return appended.length === 1 ? canonicalRoot : event;
      }
    },
    conversationStore: {
      recordInbound() {},
      recordDecision(message, result, domainEvent) { decisionRecords.push(domainEvent); },
      isHumanControlled() { return false; }
    },
    sseBroadcaster: { broadcastDomainEvent(event) { realtime.push(event); } },
    orchestratorForTenant: () => ({
      async handle() {
        return { action: 'ignore', model: { intent: 'other', confidence: 0.9, provider: 'openai', model: 'gpt-5.6' }, permission: { action: 'ignore' } };
      }
    })
  };

  await withServer(deps, async (base) => {
    const response = await fetch(`${base}/webhooks/whatsapp`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [{ changes: [{ value: {
          metadata: { phone_number_id: 'phone-123' },
          contacts: [{ wa_id: '20100', profile: { name: 'Nora' } }],
          messages: [{ id: 'wamid.retry', from: '20100', timestamp: '1720000000', type: 'text', text: { body: 'Hello' } }]
        } }] }]
      })
    });
    assert.equal(response.status, 200);
  });

  assert.equal(appended.length, 2);
  const attemptedDecision = appended[1];
  assert.equal(attemptedDecision.eventType, 'decision.completed');
  assert.equal(attemptedDecision.correlationId, 'evt-existing-root');
  assert.equal(attemptedDecision.causationId, 'evt-existing-root');
  assert.equal(attemptedDecision.idempotencyKey, 'acme:wamid.retry:decision.completed');
  assert.equal(decisionRecords[0].eventId, attemptedDecision.eventId);
  assert.deepEqual(realtime.map((event) => event.eventId), ['evt-existing-root', attemptedDecision.eventId]);
});
