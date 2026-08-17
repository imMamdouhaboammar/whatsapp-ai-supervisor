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

function fixture({ humanControlled = false } = {}) {
  const inboundEvents = [];
  const decisions = [];
  const tenant = {
    id: 'acme',
    phoneNumberId: 'phone-123',
    whatsapp: { mode: 'cloud' },
    ai: { routes: {} },
    policy: { rules: [] }
  };
  return {
    inboundEvents,
    decisions,
    deps: {
      verifyToken: 'verify',
      appSecret: null,
      tenantStore: {
        findByPhoneNumberId: (id) => id === 'phone-123' ? tenant : null,
        findById: (id) => id === 'acme' ? tenant : null
      },
      auditStore: { append() {}, list() { return []; } },
      conversationStore: {
        recordInbound(_message, event) { inboundEvents.push(event); },
        recordDecision(message, result, event) { decisions.push({ message, result, event }); },
        isHumanControlled() { return humanControlled; }
      },
      orchestratorForTenant: () => ({
        async handle() {
          return {
            action: 'reply',
            outbound: { id: 'wamid.out' },
            model: { intent: 'faq', confidence: 0.94, reply: 'Hi', provider: 'openai', model: 'gpt-5.6', thinking: 'private reasoning' },
            permission: { action: 'reply', reason: 'matched_rule' }
          };
        }
      })
    }
  };
}

async function postCloud(base, id = 'wamid.in') {
  return fetch(`${base}/webhooks/whatsapp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: 'phone-123' },
        messages: [{ id, from: '20100', timestamp: '1720000000', type: 'text', text: { body: 'Hello' } }]
      } }] }]
    })
  });
}

test('decision.completed is a direct child of message.received', async () => {
  const { deps, inboundEvents, decisions } = fixture();
  await withServer(deps, async (base) => {
    const response = await postCloud(base);
    assert.equal(response.status, 200);
  });

  assert.equal(inboundEvents.length, 1);
  assert.equal(decisions.length, 1);
  const root = inboundEvents[0];
  const decision = decisions[0].event;
  assert.equal(decision.eventType, 'decision.completed');
  assert.equal(decision.tenantId, root.tenantId);
  assert.equal(decision.conversationId, root.conversationId);
  assert.equal(decision.messageId, root.messageId);
  assert.equal(decision.correlationId, root.eventId);
  assert.equal(decision.causationId, root.eventId);
  assert.deepEqual(decision.actor, { type: 'ai', id: 'supervisor' });
  assert.deepEqual(decision.payload, {
    action: 'reply',
    wouldAction: null,
    reason: null,
    intent: 'faq',
    confidence: 0.94,
    provider: 'openai',
    model: 'gpt-5.6'
  });
  assert.equal(JSON.stringify(decision).includes('private reasoning'), false);
  assert.equal(JSON.stringify(decision).includes('"reply":"Hi"'), false);
});

test('human takeover decision uses the same correlation and causation contract', async () => {
  const { deps, inboundEvents, decisions } = fixture({ humanControlled: true });
  await withServer(deps, async (base) => {
    const response = await postCloud(base, 'wamid.human');
    assert.equal(response.status, 200);
  });

  const root = inboundEvents[0];
  const decision = decisions[0].event;
  assert.equal(decision.eventType, 'decision.completed');
  assert.equal(decision.correlationId, root.eventId);
  assert.equal(decision.causationId, root.eventId);
  assert.equal(decision.payload.action, 'human');
  assert.equal(decision.payload.reason, 'human_takeover');
  assert.equal(decision.payload.intent, null);
  assert.equal(decision.payload.confidence, null);
});
