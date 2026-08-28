import test from 'node:test';
import assert from 'node:assert/strict';
import { WhatsAppLinkedDeviceSender } from '../src/channels/whatsapp-linked-device.js';

test('linked-device sender assigns one stable operation id to worker send and receipt', async () => {
  const calls = [];
  const sender = new WhatsAppLinkedDeviceSender({
    baseUrl: 'http://wa-worker:7441',
    token: 'worker-secret',
    sessionId: 'acme-sales',
    idFactory: () => 'op-agent-1',
    fetchImpl: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: 'true_20100@c.us_AGENT1', operationId: 'op-agent-1' }), { status: 200 });
    }
  });

  const receipt = await sender.sendText({ to: '20100', text: 'hello', replyToId: 'in-1' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].operationId, 'op-agent-1');
  assert.equal(receipt.operationId, 'op-agent-1');
  assert.equal(receipt.platformMessageId, 'true_20100@c.us_AGENT1');
});

test('linked-device sender rejects a worker receipt that changes the operation id', async () => {
  const sender = new WhatsAppLinkedDeviceSender({
    baseUrl: 'http://wa-worker:7441',
    token: 'worker-secret',
    sessionId: 'acme-sales',
    idFactory: () => 'op-agent-1',
    fetchImpl: async () => new Response(JSON.stringify({ id: 'out-1', operationId: 'different-operation' }), { status: 200 })
  });

  await assert.rejects(
    sender.sendText({ to: '20100', text: 'hello' }),
    /linked_device_operation_mismatch/
  );
});
