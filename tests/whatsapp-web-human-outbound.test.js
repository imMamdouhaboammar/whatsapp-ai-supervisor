import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WhatsAppWebSessionManager } from '../workers/whatsapp-web/src/session-manager.js';

class FakeClient extends EventEmitter {
  async initialize() {}
  async destroy() {}
}

class FakeLocalAuth {
  constructor(options) { this.options = options; }
}

test('worker spools non-self fromMe text as outbound observation instead of dropping it', async () => {
  let client;
  const enqueued = [];
  const manager = new WhatsAppWebSessionManager({
    Client: class extends FakeClient { constructor(options) { super(); this.options = options; client = this; } },
    LocalAuth: FakeLocalAuth,
    sessions: [{ sessionId: 'acme', allowGroups: false }],
    spool: { async enqueue(value) { enqueued.push(value); }, async flushOnce() {} },
    reconnect: false
  });
  await manager.startAll();

  client.emit('message_create', {
    id: { _serialized: 'true_20100@c.us_MANUAL1' },
    from: '15550001111@c.us',
    to: '20100@c.us',
    body: 'manual reply',
    timestamp: 10,
    type: 'chat',
    fromMe: true
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].sessionId, 'acme');
  assert.deepEqual(enqueued[0].message, {
    id: 'true_20100@c.us_MANUAL1',
    from: '20100@c.us',
    to: '20100@c.us',
    customerName: null,
    text: 'manual reply',
    timestamp: 10,
    type: 'chat',
    fromMe: true,
    isGroup: false
  });
});

test('worker still ignores status and disallowed group outbound observations', async () => {
  let client;
  const enqueued = [];
  const manager = new WhatsAppWebSessionManager({
    Client: class extends FakeClient { constructor(options) { super(); this.options = options; client = this; } },
    LocalAuth: FakeLocalAuth,
    sessions: [{ sessionId: 'acme', allowGroups: false }],
    spool: { async enqueue(value) { enqueued.push(value); }, async flushOnce() {} },
    reconnect: false
  });
  await manager.startAll();

  client.emit('message_create', {
    id: { _serialized: 's1' }, from: '15550001111@c.us', to: 'status@broadcast', body: 'status', type: 'chat', fromMe: true
  });
  client.emit('message_create', {
    id: { _serialized: 'g1' }, from: '15550001111@c.us', to: '123@g.us', body: 'group', type: 'chat', fromMe: true
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(enqueued.length, 0);
});
