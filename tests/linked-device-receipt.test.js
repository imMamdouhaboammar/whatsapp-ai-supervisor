import test from 'node:test';
import assert from 'node:assert/strict';
import { WhatsAppLinkedDeviceSender } from '../src/channels/whatsapp-linked-device.js';

test('linked-device sender normalizes worker id into attribution-ready receipt metadata', async () => {
  const sender = new WhatsAppLinkedDeviceSender({
    baseUrl: 'http://wa-worker:7441',
    token: 'worker-secret',
    sessionId: 'acme-sales',
    fetchImpl: async () => new Response(JSON.stringify({ id: 'true_20100@c.us_AGENT1' }), { status: 200 })
  });

  const result = await sender.sendText({ to: '20100', text: 'hello', replyToId: 'in-1' });
  assert.deepEqual(result, {
    id: 'true_20100@c.us_AGENT1',
    platformMessageId: 'true_20100@c.us_AGENT1',
    transport: 'linked-device',
    sessionId: 'acme-sales'
  });
});
