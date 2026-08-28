import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLinkedDeviceOutboundObservation } from '../src/channels/whatsapp-linked-device.js';

test('normalizeLinkedDeviceOutboundObservation returns canonical peer identity for fromMe text', () => {
  const observation = normalizeLinkedDeviceOutboundObservation({
    sessionId: 'acme-sales',
    message: {
      id: 'true_20100@c.us_MANUAL1',
      from: '20100@c.us',
      to: '20100@c.us',
      customerName: 'Nora',
      text: 'manual reply',
      timestamp: 1720000000,
      type: 'chat',
      fromMe: true,
      isGroup: false
    }
  });

  assert.deepEqual(observation, {
    id: 'true_20100@c.us_MANUAL1',
    platformMessageId: 'true_20100@c.us_MANUAL1',
    channel: 'whatsapp',
    transport: 'linked-device',
    sessionId: 'acme-sales',
    customerId: '20100',
    customerName: 'Nora',
    text: 'manual reply',
    timestamp: 1720000000,
    fromMe: true
  });
});

test('outbound normalization ignores customer inbound, status, non-text and disallowed groups', () => {
  const base = {
    sessionId: 's1',
    message: { id: 'm1', from: '20100@c.us', text: 'hello', timestamp: 1, type: 'chat', fromMe: true, isGroup: false }
  };
  assert.equal(normalizeLinkedDeviceOutboundObservation({ ...base, message: { ...base.message, fromMe: false } }), null);
  assert.equal(normalizeLinkedDeviceOutboundObservation({ ...base, message: { ...base.message, from: 'status@broadcast' } }), null);
  assert.equal(normalizeLinkedDeviceOutboundObservation({ ...base, message: { ...base.message, type: 'image' } }), null);
  assert.equal(normalizeLinkedDeviceOutboundObservation({ ...base, message: { ...base.message, from: '123@g.us', isGroup: true } }), null);
});
