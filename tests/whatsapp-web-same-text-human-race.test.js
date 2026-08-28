import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WhatsAppWebSessionManager } from '../workers/whatsapp-web/src/session-manager.js';

class FakeLocalAuth {
  constructor(options) { this.options = options; }
}

test('same peer and text with a different platform id is not attributed to the active API send', async () => {
  let client;
  const enqueued = [];

  class ConcurrentHumanClient extends EventEmitter {
    async initialize() {}
    async destroy() {}
    async sendMessage(to, text) {
      this.emit('message_create', {
        id: { _serialized: 'true_20100@c.us_HUMAN_DIFFERENT' },
        from: '15550001111@c.us',
        to,
        body: text,
        timestamp: 120,
        type: 'chat',
        fromMe: true
      });
      await new Promise((resolve) => setImmediate(resolve));
      return { id: { _serialized: 'true_20100@c.us_API_SEND' } };
    }
  }

  const manager = new WhatsAppWebSessionManager({
    Client: class extends ConcurrentHumanClient { constructor(options) { super(); this.options = options; client = this; } },
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
    text: 'same text',
    operationId: 'op-api-1'
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(receipt.id, 'true_20100@c.us_API_SEND');
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].message.id, 'true_20100@c.us_HUMAN_DIFFERENT');
  assert.equal(enqueued[0].message.fromMe, true);
  assert.equal(enqueued[0].message.originHint, undefined);
  assert.equal(enqueued[0].message.apiSendOperationId, undefined);
});
