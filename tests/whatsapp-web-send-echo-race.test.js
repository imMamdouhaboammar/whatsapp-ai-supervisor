import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WhatsAppWebSessionManager } from '../workers/whatsapp-web/src/session-manager.js';

class FakeLocalAuth {
  constructor(options) { this.options = options; }
}

test('message_create emitted before sendMessage resolves carries worker API origin hint', async () => {
  let client;
  const enqueued = [];

  class RacingClient extends EventEmitter {
    async initialize() {}
    async destroy() {}
    async sendMessage(to, text) {
      this.emit('message_create', {
        id: { _serialized: 'true_20100@c.us_RACE1' },
        from: '15550001111@c.us',
        to,
        body: text,
        timestamp: 100,
        type: 'chat',
        fromMe: true
      });
      await new Promise((resolve) => setImmediate(resolve));
      return { id: { _serialized: 'true_20100@c.us_RACE1' } };
    }
  }

  const manager = new WhatsAppWebSessionManager({
    Client: class extends RacingClient { constructor(options) { super(); this.options = options; client = this; } },
    LocalAuth: FakeLocalAuth,
    sessions: [{ sessionId: 'acme-sales' }],
    spool: {
      async enqueue(value) { enqueued.push(value); },
      async flushOnce() { return { delivered: 1 }; }
    },
    reconnect: false,
    minSendIntervalMs: 0
  });

  await manager.startAll();
  client.emit('ready');
  await new Promise((resolve) => setImmediate(resolve));

  const receipt = await manager.sendText({
    sessionId: 'acme-sales',
    to: '20100@c.us',
    text: 'agent reply',
    operationId: 'op-race-1'
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(receipt.id, 'true_20100@c.us_RACE1');
  assert.equal(receipt.operationId, 'op-race-1');
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].message.fromMe, true);
  assert.equal(enqueued[0].message.originHint, 'worker_api');
  assert.equal(enqueued[0].message.apiSendOperationId, 'op-race-1');
});

test('later duplicate outgoing event is still recognized from recent API message id', async () => {
  let client;
  const enqueued = [];

  class DeferredEchoClient extends EventEmitter {
    async initialize() {}
    async destroy() {}
    async sendMessage() {
      return { id: { _serialized: 'true_20100@c.us_LATE1' } };
    }
  }

  const manager = new WhatsAppWebSessionManager({
    Client: class extends DeferredEchoClient { constructor(options) { super(); this.options = options; client = this; } },
    LocalAuth: FakeLocalAuth,
    sessions: [{ sessionId: 'acme-sales' }],
    spool: {
      async enqueue(value) { enqueued.push(value); },
      async flushOnce() { return { delivered: 1 }; }
    },
    reconnect: false,
    minSendIntervalMs: 0,
    now: () => 1_000
  });

  await manager.startAll();
  client.emit('ready');
  await new Promise((resolve) => setImmediate(resolve));

  await manager.sendText({
    sessionId: 'acme-sales',
    to: '20100@c.us',
    text: 'agent reply',
    operationId: 'op-late-1'
  });

  client.emit('message_create', {
    id: { _serialized: 'true_20100@c.us_LATE1' },
    from: '15550001111@c.us',
    to: '20100@c.us',
    body: 'agent reply',
    timestamp: 101,
    type: 'chat',
    fromMe: true
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].message.originHint, 'worker_api');
  assert.equal(enqueued[0].message.apiSendOperationId, 'op-late-1');
});
