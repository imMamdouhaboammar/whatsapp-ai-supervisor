import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileConversationOwnershipStore } from '../src/core/file-conversation-ownership-store.js';

const now = () => '2026-08-27T08:10:00.000Z';

function createStore(dataDir) {
  return new FileConversationOwnershipStore({ dataDir, now });
}

test('file ownership store defaults missing conversations to AI_ACTIVE', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'was-ownership-file-default-'));
  const store = createStore(dataDir);
  const record = await store.get('acme', 'whatsapp:20100');
  assert.equal(record.state, 'AI_ACTIVE');
  assert.equal(record.version, 0);
  assert.equal(record.tenantId, 'acme');
  assert.equal(record.conversationId, 'whatsapp:20100');
});

test('file ownership store persists takeover and survives a new store instance', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'was-ownership-file-restart-'));
  const first = createStore(dataDir);
  const changed = await first.transition({
    tenantId: 'acme',
    conversationId: 'whatsapp:20100',
    command: 'manual_takeover',
    transitionId: 'takeover-1',
    actor: 'operator:phone',
    reasonCode: 'manual_outbound_observed',
    expectedVersion: 0
  });
  assert.equal(changed.state, 'HUMAN_ACTIVE');
  assert.equal(changed.version, 1);

  const reloaded = createStore(dataDir);
  const persisted = await reloaded.get('acme', 'whatsapp:20100');
  assert.equal(persisted.state, 'HUMAN_ACTIVE');
  assert.equal(persisted.version, 1);
  assert.equal(persisted.transitionId, 'takeover-1');
});

test('file ownership store rejects stale expected versions', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'was-ownership-file-cas-'));
  const store = createStore(dataDir);
  await store.transition({
    tenantId: 'acme', conversationId: 'whatsapp:20100', command: 'manual_takeover',
    transitionId: 'takeover-1', actor: 'operator', expectedVersion: 0
  });

  await assert.rejects(store.transition({
    tenantId: 'acme', conversationId: 'whatsapp:20100', command: 'release_to_agent',
    transitionId: 'release-stale', actor: 'operator', expectedVersion: 0
  }), /ownership_version_conflict/);

  const current = await store.get('acme', 'whatsapp:20100');
  assert.equal(current.state, 'HUMAN_ACTIVE');
  assert.equal(current.version, 1);
});

test('file ownership store makes duplicate transition ids idempotent across later versions', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'was-ownership-file-idempotent-'));
  const store = createStore(dataDir);
  const takeover = await store.transition({
    tenantId: 'acme', conversationId: 'whatsapp:20100', command: 'manual_takeover',
    transitionId: 'takeover-1', actor: 'operator', expectedVersion: 0
  });
  const released = await store.transition({
    tenantId: 'acme', conversationId: 'whatsapp:20100', command: 'release_to_agent',
    transitionId: 'release-1', actor: 'operator', expectedVersion: takeover.version
  });
  assert.equal(released.state, 'AI_ACTIVE');
  assert.equal(released.version, 2);

  const duplicate = await store.transition({
    tenantId: 'acme', conversationId: 'whatsapp:20100', command: 'manual_takeover',
    transitionId: 'takeover-1', actor: 'operator', expectedVersion: 0
  });
  assert.equal(duplicate.state, 'HUMAN_ACTIVE');
  assert.equal(duplicate.version, 1);

  const current = await store.get('acme', 'whatsapp:20100');
  assert.equal(current.state, 'AI_ACTIVE');
  assert.equal(current.version, 2);
});
