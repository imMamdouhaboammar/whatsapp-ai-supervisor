import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresConversationOwnershipStore } from '../src/storage/postgres-conversation-ownership-store.js';

class FakeClient {
  constructor(handler) {
    this.handler = handler;
    this.queries = [];
    this.released = false;
  }
  async query(text, values = []) {
    const entry = { text: String(text), values };
    this.queries.push(entry);
    return this.handler(entry, this.queries.length - 1);
  }
  release() { this.released = true; }
}

function row(state = 'AI_ACTIVE', version = 0, transitionId = null) {
  return {
    tenant_id: 'acme',
    conversation_id: 'whatsapp:20100',
    state,
    version,
    changed_at: '2026-08-27T08:20:00.000Z',
    changed_by: 'supervisor',
    reason_code: state === 'AI_ACTIVE' ? 'default_ai_active' : 'manual_outbound_observed',
    transition_id: transitionId
  };
}

const input = {
  tenantId: 'acme',
  conversationId: 'whatsapp:20100',
  command: 'manual_takeover',
  transitionId: 'takeover-1',
  actor: 'operator:phone',
  reasonCode: 'manual_outbound_observed',
  expectedVersion: 0
};

test('postgres ownership store defaults missing rows to AI_ACTIVE', async () => {
  const pool = {
    async query(text) {
      assert.match(String(text), /FROM conversation_ownership/i);
      return { rows: [], rowCount: 0 };
    }
  };
  const store = new PostgresConversationOwnershipStore({ pool, now: () => '2026-08-27T08:20:00.000Z' });
  const current = await store.get('acme', 'whatsapp:20100');
  assert.equal(current.state, 'AI_ACTIVE');
  assert.equal(current.version, 0);
});

test('postgres ownership transition is transactional and compare-and-set', async () => {
  const client = new FakeClient((query) => {
    if (query.text === 'BEGIN' || query.text === 'COMMIT') return { rows: [], rowCount: 0 };
    if (/INSERT INTO conversation_ownership \(/i.test(query.text) && /ON CONFLICT/i.test(query.text)) return { rows: [], rowCount: 1 };
    if (/SELECT result FROM conversation_ownership_transitions/i.test(query.text)) return { rows: [], rowCount: 0 };
    if (/SELECT \* FROM conversation_ownership/i.test(query.text) && /FOR UPDATE/i.test(query.text)) return { rows: [row()], rowCount: 1 };
    if (/UPDATE conversation_ownership/i.test(query.text)) return { rows: [row('HUMAN_ACTIVE', 1, 'takeover-1')], rowCount: 1 };
    if (/INSERT INTO conversation_ownership_transitions/i.test(query.text)) return { rows: [], rowCount: 1 };
    throw new Error(`unexpected query: ${query.text}`);
  });
  const store = new PostgresConversationOwnershipStore({
    pool: { async connect() { return client; } },
    now: () => '2026-08-27T08:21:00.000Z'
  });

  const result = await store.transition(input);
  assert.equal(result.state, 'HUMAN_ACTIVE');
  assert.equal(result.version, 1);
  assert.equal(client.released, true);
  assert.equal(client.queries[0].text, 'BEGIN');
  assert.equal(client.queries.at(-1).text, 'COMMIT');
  assert.ok(client.queries.some((query) => /FOR UPDATE/i.test(query.text)));
});

test('postgres ownership store returns historical duplicate transition without changing current state', async () => {
  const historical = {
    tenantId: 'acme', conversationId: 'whatsapp:20100', state: 'HUMAN_ACTIVE', version: 1,
    changedAt: '2026-08-27T08:21:00.000Z', changedBy: 'operator:phone',
    reasonCode: 'manual_outbound_observed', transitionId: 'takeover-1'
  };
  const client = new FakeClient((query) => {
    if (query.text === 'BEGIN' || query.text === 'COMMIT') return { rows: [], rowCount: 0 };
    if (/INSERT INTO conversation_ownership \(/i.test(query.text)) return { rows: [], rowCount: 1 };
    if (/SELECT \* FROM conversation_ownership/i.test(query.text) && /FOR UPDATE/i.test(query.text)) return { rows: [row('AI_ACTIVE', 2, 'release-1')], rowCount: 1 };
    if (/SELECT result FROM conversation_ownership_transitions/i.test(query.text)) return { rows: [{ result: historical }], rowCount: 1 };
    throw new Error(`unexpected query: ${query.text}`);
  });
  const store = new PostgresConversationOwnershipStore({ pool: { async connect() { return client; } } });
  const duplicate = await store.transition(input);
  assert.deepEqual(duplicate, historical);
  assert.equal(client.queries.some((query) => /UPDATE conversation_ownership/i.test(query.text)), false);
  assert.equal(client.released, true);
});

test('postgres ownership store rolls back stale expected versions', async () => {
  const client = new FakeClient((query) => {
    if (query.text === 'BEGIN' || query.text === 'ROLLBACK') return { rows: [], rowCount: 0 };
    if (/INSERT INTO conversation_ownership \(/i.test(query.text)) return { rows: [], rowCount: 1 };
    if (/SELECT result FROM conversation_ownership_transitions/i.test(query.text)) return { rows: [], rowCount: 0 };
    if (/SELECT \* FROM conversation_ownership/i.test(query.text)) return { rows: [row('HUMAN_ACTIVE', 2, 'takeover-old')], rowCount: 1 };
    throw new Error(`unexpected query: ${query.text}`);
  });
  const store = new PostgresConversationOwnershipStore({ pool: { async connect() { return client; } } });
  await assert.rejects(store.transition(input), /ownership_version_conflict/);
  assert.equal(client.queries.at(-1).text, 'ROLLBACK');
  assert.equal(client.released, true);
});
