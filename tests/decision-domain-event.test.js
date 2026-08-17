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

test('decision.completed is a direct child of message.received with bounded payload', async () => {
  const tenant = {
    id: 'acme',
    phoneNumberId: 'phone-123',
    whatsapp: { mode: 'cloud' },
    ai: { routes: {} },
    policy: { rules: [] }
  };
  const inboundRecords = [];
  const decisionRecords = [];
  const realtimeEvents = [];

  const deps = {
    verifyToken: 'verify',
    appSecret: null,
    tenantStore: {
      findByPhoneNumberId: (id) => id === 'phone-123' ? tenant : null,
      findById: (id) => id === 'acme' ? tenant : null
    },
    auditStore: { append() {}, list() { return []; } },
    conversationStore: {
      recordInbound(message, domainEvent) { inboundRecords.push({ message, domainEvent }); },
      recordDecision(message, result, domainEvent) { decisionRecords.push({ message, result, domainEvent }); },
      isHumanControlled() { return false; }
    },
    sseBroadcaster: {
      broadcastDomainEvent(event) { realtimeEvents.push(event); },
      broadcast() { throw new Error('legacy_realtime_domain_broadcast_used'); }
    },
    orchestratorForTenant: () => ({
      async handle() {
        return {
          action: 'reply',
          reason: 'policy_permitted',
          wouldAction: null,
          model: {
            intent: 'faq',
            confidence: 0.94,
            reply: 'Private reply text',
            thinking: 'Private reasoning',
            provider: 'openai',
            model: 'gpt-5.6'
          },
          permission: { action: 'reply', intent: 'faq' },
          outbound: { messages: [{ id: 'wamid.out' }] }
        };
      }
    })
  };

  await withServer(deps, async (base) => {
    const response = await fetch(`${base}/webhooks/whatsapp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [{ changes: [{ value: {
          metadata: { phone_number_id: 'phone-123' },
          contacts: [{ wa_id: '20100', profile: { name: 'Nora' } }],
          messages: [{ id: 'wamid.in', from: '20100', timestamp: '1720000000', type: 'text', text: { body: 'Hello' } }]
        } }] }]
      })
    });
    assert.equal(response.status, 200);
  });

  assert.equal(inboundRecords.length, 1);
  assert.equal(decisionRecords.length, 1);
  const inbound = inboundRecords[0].domainEvent;
  const decision = decisionRecords[0].domainEvent;

  assert.equal(decision.eventType, 'decision.completed');
  assert.equal(decision.tenantId, inbound.tenantId);
  assert.equal(decision.conversationId, inbound.conversationId);
  assert.equal(decision.messageId, inbound.messageId);
  assert.equal(decision.correlationId, inbound.correlationId);
  assert.equal(decision.causationId, inbound.eventId);
  assert.deepEqual(decision.actor, { type: 'ai', id: 'supervisor' });
  assert.equal(decision.payload.action, 'reply');
  assert.equal(decision.payload.intent, 'faq');
  assert.equal(decision.payload.confidence, 0.94);
  assert.equal(decision.payload.provider, 'openai');
  assert.equal(decision.payload.model, 'gpt-5.6');
  assert.equal(Object.hasOwn(decision.payload, 'reply'), false);
  assert.equal(Object.hasOwn(decision.payload, 'thinking'), false);

  assert.deepEqual(realtimeEvents.map((event) => event.eventType), [
    'message.received',
    'decision.completed'
  ]);
}