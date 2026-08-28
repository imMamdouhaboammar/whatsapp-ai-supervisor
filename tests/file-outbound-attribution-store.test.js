import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileOutboundAttributionStore } from '../src/core/file-outbound-attribution-store.js';

function record(overrides = {}) {
  return {
    tenantId: 'acme', sessionId: 'acme-sales', conversationId: 'whatsapp:20100', customerId: '20100',
    platformMessageId: 'out-1', origin: 'agent', sourceMessageId: 'in-1',
    createdAt: '2026-08-27T09:00:00.000Z', expiresAt: '2026-08-28T09:00:00.000Z', echoObservedAt: null,
    ...overrides
  };
}

test('file attribution store persists and resolves platform message origin', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'was-attribution-file-'));
  const store = new FileOutboundAttributionStore({ dataDir, now: () => '2026-08-27T09:05:00.000Z' });
  await store.record(record());

  const found = await store.findByPlatformMessageId('acme', 'acme-sales', 'out-1');
  assert.equal(found.origin, 'agent');
  assert.equal(found.echoObservedAt, null);

  const reloaded = new FileOutboundAttributionStore({ dataDir, now: () => '2026-08-27T09:06:00.000Z' });
  assert.equal((await reloaded.findByPlatformMessageId('acme', 'acme-sales', 'out-1')).origin, 'agent');
});

test('file attribution record is idempotent for the same platform message id', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'was-attribution-idempotent-'));
  const store = new FileOutboundAttributionStore({ dataDir });
  const first = await store.record(record());
  const second = await store.record(record({ origin: 'operator_api' }));
  assert.deepEqual(second, first);
  assert.equal(second.origin, 'agent');
});

test('consumeEcho records the first observation idempotently', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'was-attribution-echo-'));
  const store = new FileOutboundAttributionStore({ dataDir, now: () => '2026-08-27T09:07:00.000Z' });
  await store.record(record());
  const first = await store.consumeEcho('acme', 'acme-sales', 'out-1');
  assert.equal(first.echoObservedAt, '2026-08-27T09:07:00.000Z');

  const second = await store.consumeEcho('acme', 'acme-sales', 'out-1');
  assert.equal(second.echoObservedAt, first.echoObservedAt);
  assert.equal((await store.findByPlatformMessageId('acme', 'acme-sales', 'missing')), null);
});
