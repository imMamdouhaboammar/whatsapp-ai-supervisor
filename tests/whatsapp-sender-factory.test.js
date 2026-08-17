import test from 'node:test';
import assert from 'node:assert/strict';
import { createWhatsAppSender } from '../src/channels/whatsapp-sender-factory.js';
import { WhatsAppCloudSender } from '../src/channels/whatsapp-cloud.js';
import { WhatsAppLinkedDeviceSender } from '../src/channels/whatsapp-linked-device.js';

test('sender factory keeps Cloud API as default transport', () => {
  const lookups = [];
  const sender = createWhatsAppSender({
    tenant: { id: 'cloud', phoneNumberId: 'p1', whatsapp: { accessTokenEnv: 'META_TOKEN' } },
    metaGraphVersion: 'v99.0',
    resolveSecret: (obj, field, fallback) => { lookups.push({ obj, field, fallback }); return 'secret'; }
  });
  assert.equal(sender instanceof WhatsAppCloudSender, true);
  assert.equal(lookups[0].field, 'accessTokenEnv');
});

test('sender factory creates linked-device sender without reading Meta token', () => {
  const lookups = [];
  const tenant = {
    id: 'linked',
    whatsapp: {
      mode: 'linked-device', sessionId: 'acme', workerUrl: 'http://wa-worker:7441', workerTokenEnv: 'WA_WORKER_TOKEN'
    }
  };
  const sender = createWhatsAppSender({
    tenant,
    metaGraphVersion: null,
    resolveSecret: (obj, field, fallback) => { lookups.push({ field, fallback }); return 'worker-secret'; }
  });
  assert.equal(sender instanceof WhatsAppLinkedDeviceSender, true);
  assert.deepEqual(lookups, [{ field: 'workerTokenEnv', fallback: 'WHATSAPP_LINKED_DEVICE_WORKER_TOKEN' }]);
});

test('sender factory rejects unknown WhatsApp transport', () => {
  assert.throws(() => createWhatsAppSender({
    tenant: { id: 'bad', whatsapp: { mode: 'telepathy' } },
    metaGraphVersion: 'v1', resolveSecret: () => 'x'
  }), /Unsupported WhatsApp transport/);
});
