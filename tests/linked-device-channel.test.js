import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLinkedDeviceInbound, WhatsAppLinkedDeviceSender } from '../src/channels/whatsapp-linked-device.js';

test('normalizeLinkedDeviceInbound accepts a direct text message from a trusted worker', () => {
  const message = normalizeLinkedDeviceInbound({
    sessionId: 'acme-sales',
    message: {
      id: 'false_20100@c.us_ABC',
      from: '20100@c.us',
      customerName: 'Mamdouh',
      text: 'hello',
      timestamp: 1720000000,
      type: 'chat',
      fromMe: false,
      isGroup: false
    }
  });

  assert.deepEqual(message, {
    id: 'false_20100@c.us_ABC',
    channel: 'whatsapp',
    transport: 'linked-device',
    sessionId: 'acme-sales',
    customerId: '20100@c.us',
    customerName: 'Mamdouh',
    text: 'hello',
    timestamp: 1720000000
  });
});

test('normalizeLinkedDeviceInbound ignores self, status, non-text, and groups by default', () => {
  const base = {
    sessionId: 's1',
    message: { id: 'm1', from: '20100@c.us', text: 'hello', timestamp: 1, type: 'chat', fromMe: false, isGroup: false }
  };
  assert.equal(normalizeLinkedDeviceInbound({ ...base, message: { ...base.message, fromMe: true } }), null);
  assert.equal(normalizeLinkedDeviceInbound({ ...base, message: { ...base.message, from: 'status@broadcast' } }), null);
  assert.equal(normalizeLinkedDeviceInbound({ ...base, message: { ...base.message, type: 'image' } }), null);
  assert.equal(normalizeLinkedDeviceInbound({ ...base, message: { ...base.message, from: '123@g.us', isGroup: true } }), null);
});

test('normalizeLinkedDeviceInbound can allow group text for an opted-in tenant', () => {
  const message = normalizeLinkedDeviceInbound({
    sessionId: 'support-group',
    message: { id: 'm2', from: '123@g.us', text: 'hello team', timestamp: 2, type: 'chat', fromMe: false, isGroup: true }
  }, { allowGroups: true });
  assert.equal(message.customerId, '123@g.us');
});

test('WhatsAppLinkedDeviceSender sends through worker with bearer auth and session id', async () => {
  const calls = [];
  const sender = new WhatsAppLinkedDeviceSender({
    baseUrl: 'http://wa-worker:7441',
    token: 'worker-secret',
    sessionId: 'acme-sales',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: 'out-1' }), { status: 200 });
    }
  });

  const result = await sender.sendText({ to: '20100@c.us', text: 'Hi', replyToId: 'in-1' });
  assert.equal(result.id, 'out-1');
  assert.equal(calls[0].url, 'http://wa-worker:7441/v1/send-text');
  assert.equal(calls[0].init.headers.authorization, 'Bearer worker-secret');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    sessionId: 'acme-sales', to: '20100@c.us', text: 'Hi', replyToId: 'in-1'
  });
});

test('WhatsAppLinkedDeviceSender maps worker errors to a useful failure', async () => {
  const sender = new WhatsAppLinkedDeviceSender({
    baseUrl: 'http://wa-worker:7441', token: 'secret', sessionId: 's1',
    fetchImpl: async () => new Response(JSON.stringify({ error: 'session_not_ready' }), { status: 409 })
  });
  await assert.rejects(sender.sendText({ to: '20100@c.us', text: 'Hi' }), /session_not_ready/);
});
