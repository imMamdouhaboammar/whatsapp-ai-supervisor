import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { normalizeWhatsAppWebhook, WhatsAppCloudSender, verifyWebhookChallenge, validateMetaSignature } from '../src/channels/whatsapp-cloud.js';

test('normalizes inbound text messages with phone number id', () => {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: {
      metadata: { phone_number_id: 'phone-123', display_phone_number: '1555' },
      contacts: [{ wa_id: '20100', profile: { name: 'Ahmed' } }],
      messages: [{ id: 'wamid.in', from: '20100', timestamp: '1720000000', type: 'text', text: { body: 'Hello' } }]
    } }] }]
  };

  const messages = normalizeWhatsAppWebhook(payload);
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0], {
    id: 'wamid.in',
    channel: 'whatsapp',
    phoneNumberId: 'phone-123',
    customerId: '20100',
    customerName: 'Ahmed',
    text: 'Hello',
    timestamp: 1720000000
  });
});

test('ignores non-message webhook updates and unsupported message types', () => {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: {
      metadata: { phone_number_id: 'phone-123' },
      statuses: [{ id: 'out-1', status: 'delivered' }],
      messages: [{ id: 'img-1', from: '201', type: 'image', image: { id: 'media' } }]
    } }] }]
  };
  assert.deepEqual(normalizeWhatsAppWebhook(payload), []);
});

test('sends text through official Graph messages endpoint and preserves reply context', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, async json() { return { messages: [{ id: 'wamid.out' }] }; } };
  };
  const sender = new WhatsAppCloudSender({
    accessToken: 'meta-token', phoneNumberId: 'phone-123', graphVersion: 'vXX.X', fetchImpl
  });

  const result = await sender.sendText({ to: '20100', text: 'Hi', replyToId: 'wamid.in' });
  const body = JSON.parse(calls[0].options.body);
  assert.equal(calls[0].url, 'https://graph.facebook.com/vXX.X/phone-123/messages');
  assert.equal(body.messaging_product, 'whatsapp');
  assert.equal(body.context.message_id, 'wamid.in');
  assert.equal(body.text.body, 'Hi');
  assert.equal(result.id, 'wamid.out');
});

test('verifies webhook challenge only with matching verify token', () => {
  assert.equal(verifyWebhookChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'abc', 'hub.challenge': '42' }, 'abc'), '42');
  assert.equal(verifyWebhookChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '42' }, 'abc'), null);
});


test('validates X-Hub-Signature-256 against raw webhook bytes', () => {
  const raw = Buffer.from('{"object":"whatsapp_business_account"}');
  const secret = 'app-secret';
  const digest = createHmac('sha256', secret).update(raw).digest('hex');
  assert.equal(validateMetaSignature(raw, `sha256=${digest}`, secret), true);
  assert.equal(validateMetaSignature(raw, 'sha256=bad', secret), false);
});
