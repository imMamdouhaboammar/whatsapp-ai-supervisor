import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileConversationStore } from '../src/core/file-conversation-store.js';

test('recordManualOutbound does not duplicate the same platform message echo', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'was-manual-outbound-idempotent-'));
  const store = new FileConversationStore({ dataDir });
  const input = {
    tenantId: 'acme', customerId: '20100', customerName: 'Nora',
    text: 'manual reply', messageId: 'out-1', at: '2026-08-27T09:40:00.000Z'
  };

  const first = store.recordManualOutbound(input);
  const second = store.recordManualOutbound({ ...input, at: '2026-08-27T09:40:01.000Z' });

  assert.equal(first.id, 'out-1');
  assert.equal(second.id, 'out-1');
  const rows = store.readEvents('acme').filter((event) => event.id === 'out-1' && event.direction === 'operator');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].at, '2026-08-27T09:40:00.000Z');
});
