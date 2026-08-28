import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OUTBOUND_ORIGINS,
  createOutboundAttribution,
  assertOutboundAttribution
} from '../src/domain/outbound-attribution.js';

test('outbound attribution distinguishes agent and operator API origins', () => {
  assert.deepEqual([...OUTBOUND_ORIGINS], ['agent', 'operator_api']);
});

test('createOutboundAttribution captures linked-device platform identity and expiry', () => {
  const record = createOutboundAttribution({
    tenantId: 'acme',
    sessionId: 'acme-sales',
    conversationId: 'whatsapp:20100',
    customerId: '20100',
    platformMessageId: 'true_20100@c.us_AGENT1',
    origin: 'agent',
    sourceMessageId: 'in-1'
  }, {
    now: () => '2026-08-27T09:00:00.000Z',
    ttlMs: 86_400_000
  });

  assert.equal(record.origin, 'agent');
  assert.equal(record.platformMessageId, 'true_20100@c.us_AGENT1');
  assert.equal(record.createdAt, '2026-08-27T09:00:00.000Z');
  assert.equal(record.expiresAt, '2026-08-28T09:00:00.000Z');
  assert.equal(record.echoObservedAt, null);
  assert.equal(Object.isFrozen(record), true);
});

test('outbound attribution rejects unknown origins and missing platform identity', () => {
  const base = {
    tenantId: 'acme', sessionId: 's1', conversationId: 'whatsapp:20100', customerId: '20100',
    platformMessageId: 'out-1', origin: 'agent', createdAt: '2026-08-27T09:00:00.000Z',
    expiresAt: '2026-08-28T09:00:00.000Z', echoObservedAt: null, sourceMessageId: null
  };
  assert.equal(assertOutboundAttribution(base), base);
  assert.throws(() => assertOutboundAttribution({ ...base, origin: 'human_phone' }), /unsupported_outbound_origin/);
  assert.throws(() => assertOutboundAttribution({ ...base, platformMessageId: '' }), /outbound_platform_message_id_required/);
});
