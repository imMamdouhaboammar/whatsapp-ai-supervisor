import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WhatsAppWebSessionManager } from '../workers/whatsapp-web/src/session-manager.js';

class FakeClient extends EventEmitter {
  constructor(options) { super(); this.options = options; this.sent = []; this.initialized = 0; }
  async initialize() { this.initialized += 1; }
  async sendMessage(to, text) { this.sent.push({ to, text }); return { id: { _serialized: 'out-1' } }; }
  async destroy() {}
}

class FakeLocalAuth {
  constructor(options) { this.options = options; }
}

test('session manager creates isolated LocalAuth session and starts client', async () => {
  const created = [];
  const manager = new WhatsAppWebSessionManager({
    Client: class extends FakeClient { constructor(options) { super(options); created.push(this); } },
    LocalAuth: FakeLocalAuth,
    sessions: [{ sessionId: 'acme-sales', allowGroups: false }],
    authDir: '/tmp/auth',
    spool: { async enqueue() {}, async flushOnce() {} },
    reconnect: false
  });

  await manager.startAll();
  assert.equal(created.length, 1);
  assert.equal(created[0].initialized, 1);
  assert.equal(created[0].options.authStrategy.options.clientId, 'acme-sales');
  assert.equal(created[0].options.authStrategy.options.dataPath, '/tmp/auth');
  assert.deepEqual(created[0].options.puppeteer.args.includes('--no-sandbox'), true);
});

test('session manager tracks QR, pairing code, and ready state', async () => {
  let client;
  const manager = new WhatsAppWebSessionManager({
    Client: class extends FakeClient { constructor(options) { super(options); client = this; } },
    LocalAuth: FakeLocalAuth,
    sessions: [{ sessionId: 'acme' }],
    spool: { async enqueue() {}, async flushOnce() {} },
    reconnect: false
  });
  await manager.startAll();
  client.emit('qr', 'qr-value');
  client.emit('code', '123-456');
  client.emit('ready');
  await new Promise((resolve) => setImmediate(resolve));
  const state = manager.getSession('acme');
  assert.equal(state.status, 'ready');
  assert.equal(state.qr, null);
  assert.equal(state.pairingCode, null);
});

test('session manager spools direct text and ignores own, status, and groups by default', async () => {
  let client;
  const enqueued = [];
  const manager = new WhatsAppWebSessionManager({
    Client: class extends FakeClient { constructor(options) { super(options); client = this; } },
    LocalAuth: FakeLocalAuth,
    sessions: [{ sessionId: 'acme', allowGroups: false }],
    spool: { async enqueue(value) { enqueued.push(value); }, async flushOnce() {} },
    reconnect: false
  });
  await manager.startAll();

  client.emit('message', { id: { _serialized: 'm1' }, from: '20100@c.us', body: 'hello', timestamp: 1, type: 'chat', fromMe: false });
  client.emit('message', { id: { _serialized: 'm2' }, from: '20100@c.us', body: 'self', timestamp: 1, type: 'chat', fromMe: true });
  client.emit('message', { id: { _serialized: 'm3' }, from: 'status@broadcast', body: 'status', timestamp: 1, type: 'chat', fromMe: false });
  client.emit('message', { id: { _serialized: 'm4' }, from: '123@g.us', body: 'group', timestamp: 1, type: 'chat', fromMe: false });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].sessionId, 'acme');
  assert.equal(enqueued[0].message.id, 'm1');
  assert.equal(enqueued[0].message.from, '20100@c.us');
});

test('session manager sends only through ready session', async () => {
  let client;
  const manager = new WhatsAppWebSessionManager({
    Client: class extends FakeClient { constructor(options) { super(options); client = this; } },
    LocalAuth: FakeLocalAuth,
    sessions: [{ sessionId: 'acme' }],
    spool: { async enqueue() {}, async flushOnce() {} },
    reconnect: false
  });
  await manager.startAll();
  await assert.rejects(manager.sendText({ sessionId: 'acme', to: '20100@c.us', text: 'hi' }), /session_not_ready/);
  client.emit('ready');
  await new Promise((resolve) => setImmediate(resolve));
  const result = await manager.sendText({ sessionId: 'acme', to: '20100@c.us', text: 'hi' });
  assert.equal(result.id, 'out-1');
  assert.deepEqual(client.sent, [{ to: '20100@c.us', text: 'hi' }]);
});

test('session manager serializes concurrent sends per session', async () => {
  let client;
  let active = 0;
  let maxActive = 0;
  class SlowClient extends FakeClient {
    async sendMessage(to, text) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { id: { _serialized: `${to}:${text}` } };
    }
  }
  const manager = new WhatsAppWebSessionManager({
    Client: class extends SlowClient { constructor(options) { super(options); client = this; } },
    LocalAuth: FakeLocalAuth,
    sessions: [{ sessionId: 'acme' }],
    spool: { async enqueue() {}, async flushOnce() {} },
    reconnect: false,
    minSendIntervalMs: 0
  });
  await manager.startAll();
  client.emit('ready');
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.all([
    manager.sendText({ sessionId: 'acme', to: 'a@c.us', text: 'one' }),
    manager.sendText({ sessionId: 'acme', to: 'b@c.us', text: 'two' })
  ]);
  assert.equal(maxActive, 1);
});

test('session manager rejects sends when per-session queue is full', async () => {
  let client;
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  class BlockedClient extends FakeClient {
    async sendMessage(to) { await blocked; return { id: { _serialized: to } }; }
  }
  const manager = new WhatsAppWebSessionManager({
    Client: class extends BlockedClient { constructor(options) { super(options); client = this; } },
    LocalAuth: FakeLocalAuth,
    sessions: [{ sessionId: 'acme' }],
    spool: { async enqueue() {}, async flushOnce() {} },
    reconnect: false,
    maxSendQueue: 1,
    minSendIntervalMs: 0
  });
  await manager.startAll();
  client.emit('ready');
  await new Promise((resolve) => setImmediate(resolve));
  const first = manager.sendText({ sessionId: 'acme', to: 'a@c.us', text: 'one' });
  await assert.rejects(manager.sendText({ sessionId: 'acme', to: 'b@c.us', text: 'two' }), /send_queue_full/);
  release();
  await first;
});
