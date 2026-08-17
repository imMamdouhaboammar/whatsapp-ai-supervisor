import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileConversationStore } from '../src/core/file-conversation-store.js';

function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), 'was-conversations-'));
  return { dataDir, store: new FileConversationStore({ dataDir }), cleanup: () => rmSync(dataDir, { recursive: true, force: true }) };
}

test('conversation store groups inbound and decision events into a thread', () => {
  const { store, cleanup } = fixture();
  try {
    const message = { id: 'm1', tenantId: 'acme', customerId: '20100', customerName: 'Nora', text: 'Where is my order?', timestamp: 1_700_000_000 };
    store.recordInbound(message);
    store.recordDecision(message, { action: 'reply', model: { intent: 'order_status', confidence: .94, reply: 'I am checking it now.' }, permission: { action: 'reply' } }, '2026-08-17T05:00:00.000Z');
    const [thread] = store.list('acme');
    assert.equal(thread.customerName, 'Nora');
    assert.equal(thread.control, 'ai');
    assert.equal(thread.messages.length, 2);
    assert.equal(thread.messages[1].intent, 'order_status');
    assert.equal(thread.preview, 'I am checking it now.');
  } finally { cleanup(); }
});

test('conversation control persists and manual replies are recorded', () => {
  const { dataDir, store, cleanup } = fixture();
  try {
    store.setControl('acme', '20100', 'human');
    const restarted = new FileConversationStore({ dataDir });
    assert.equal(restarted.isHumanControlled('acme', '20100'), true);
    restarted.recordManualOutbound({ tenantId: 'acme', customerId: '20100', text: 'I have taken over.' });
    assert.equal(restarted.list('acme')[0].messages[0].direction, 'human');
  } finally { cleanup(); }
});
