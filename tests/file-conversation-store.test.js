import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileConversationStore } from '../src/core/file-conversation-store.js';

test('FileConversationStore builds tenant conversation threads from event history', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'was-conversations-'));
  const store = new FileConversationStore({ dataDir });
  const tenantId = 'tenant/a';

  store.recordInbound({
    id: 'in-1',
    tenantId,
    customerId: '20100',
    customerName: 'Mamdouh',
    text: 'Hello',
    timestamp: 10
  });
  store.recordDecision({ id: 'in-1', tenantId, customerId: '20100', customerName: 'Mamdouh' }, {
    action: 'reply',
    model: { intent: 'faq', confidence: 0.91, reply: 'Hi there', thinking: 'Simple greeting', proactiveOffer: 'offer help', model: 'gpt-5.6', provider: 'openai' },
    permission: { action: 'reply' }
  }, '1970-01-01T00:00:11.000Z');

  const threads = store.list(tenantId);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].customerName, 'Mamdouh');
  assert.equal(threads[0].control, 'ai');
  assert.equal(threads[0].messages.length, 2);
  assert.equal(threads[0].messages[1].thinking, 'Simple greeting');
  assert.equal(threads[0].messages[1].provider, 'openai');
  assert.equal(threads[0].messages[1].modelName, 'gpt-5.6');
});

test('FileConversationStore persists and changes explicit human takeover state', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'was-conversations-control-'));
  const store = new FileConversationStore({ dataDir });
  const tenantId = 'tenant';

  assert.equal(store.isHumanControlled(tenantId, 'c1'), false);
  store.setControl(tenantId, 'c1', 'human');
  assert.equal(store.isHumanControlled(tenantId, 'c1'), true);
  store.setControl(tenantId, 'c1', 'ai');
  assert.equal(store.getControl(tenantId, 'c1'), 'ai');
});

test('FileConversationStore persists domain lineage on inbound legacy rows', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'was-conversations-domain-'));
  const store = new FileConversationStore({ dataDir });
  const domainEvent = {
    eventId: 'evt-root',
    eventType: 'message.received',
    schemaVersion: 1,
    occurredAt: '2026-08-17T10:45:00.000Z',
    tenantId: 'acme',
    conversationId: 'whatsapp:20100',
    messageId: 'wamid.in',
    correlationId: 'evt-root',
    causationId: undefined,
    idempotencyKey: 'acme:wamid.in',
    actor: { type: 'connector', id: 'whatsapp-cloud' },
    payload: { text: 'Hello' }
  };

  store.recordInbound({
    id: 'wamid.in', tenantId: 'acme', customerId: '20100', customerName: 'Nora',
    channel: 'whatsapp', text: 'Hello', timestamp: 1720000000
  }, domainEvent);

  const row = store.readEvents('acme')[0];
  assert.equal(row.domainEventId, 'evt-root');
  assert.equal(row.domainEventType, 'message.received');
  assert.equal(row.domainSchemaVersion, 1);
  assert.equal(row.conversationId, 'whatsapp:20100');
  assert.equal(row.correlationId, 'evt-root');
  assert.equal(row.causationId, null);
  assert.equal(row.idempotencyKey, 'acme:wamid.in');
});
