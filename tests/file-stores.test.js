import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileAuditStore } from '../src/core/file-audit-store.js';
import { FileClaimStore } from '../src/core/file-claim-store.js';

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'was-state-'));
}

test('FileAuditStore persists tenant events across store instances', async () => {
  const dataDir = await tempDir();
  const first = new FileAuditStore({ dataDir });
  await first.append({ id: 'a1', tenantId: 'tenant/a', messageId: 'm1', result: { action: 'shadow' } });

  const second = new FileAuditStore({ dataDir });
  assert.deepEqual(await second.list('tenant/a'), [
    { id: 'a1', tenantId: 'tenant/a', messageId: 'm1', result: { action: 'shadow' } }
  ]);
});

test('FileAuditStore skips malformed NDJSON lines instead of crashing', async () => {
  const dataDir = await tempDir();
  const store = new FileAuditStore({ dataDir });
  await store.append({ id: 'a1', tenantId: 'demo', messageId: 'm1' });
  await appendFile(store.fileForTenant('demo'), '{not-json}\n', 'utf8');
  await store.append({ id: 'a2', tenantId: 'demo', messageId: 'm2' });

  const events = await store.list('demo');
  assert.deepEqual(events.map((event) => event.id), ['a1', 'a2']);
});

test('FileClaimStore keeps duplicate claims durable across instances', async () => {
  const dataDir = await tempDir();
  const first = new FileClaimStore({ dataDir });
  assert.equal(await first.claim('tenant-a:wamid.1'), true);

  const second = new FileClaimStore({ dataDir });
  assert.equal(await second.claim('tenant-a:wamid.1'), false);
  assert.equal(await second.claim('tenant-a:wamid.2'), true);
});

test('FileClaimStore release allows retry after a failed operation', async () => {
  const dataDir = await tempDir();
  const store = new FileClaimStore({ dataDir });
  assert.equal(await store.claim('tenant-a:wamid.retry'), true);
  await store.release('tenant-a:wamid.retry');
  assert.equal(await store.claim('tenant-a:wamid.retry'), true);
});
