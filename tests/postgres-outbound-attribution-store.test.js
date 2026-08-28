import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresOutboundAttributionStore } from '../src/storage/postgres-outbound-attribution-store.js';

function row(overrides = {}) {
  return {
    tenant_id: 'acme', session_id: 'acme-sales', conversation_id: 'whatsapp:20100', customer_id: '20100',
    platform_message_id: 'out-1', origin: 'agent', source_message_id: 'in-1',
    created_at: '2026-08-27T09:00:00.000Z', expires_at: '2026-08-28T09:00:00.000Z', echo_observed_at: null,
    ...overrides
  };
}

const record = {
  tenantId: 'acme', sessionId: 'acme-sales', conversationId: 'whatsapp:20100', customerId: '20100',
  platformMessageId: 'out-1', origin: 'agent', sourceMessageId: 'in-1',
  createdAt: '2026-08-27T09:00:00.000Z', expiresAt: '2026-08-28T09:00:00.000Z', echoObservedAt: null
};

test('postgres attribution record is idempotent and returns the canonical row', async () => {
  const queries = [];
  const pool = {
    async query(text, values) {
      queries.push({ text: String(text), values });
      return { rows: [row()], rowCount: 1 };
    }
  };
  const store = new PostgresOutboundAttributionStore({ pool });
  const result = await store.record(record);
  assert.equal(result.origin, 'agent');
  assert.match(queries[0].text, /INSERT INTO outbound_attributions/i);
  assert.match(queries[0].text, /ON CONFLICT \(tenant_id, session_id, platform_message_id\)/i);
  assert.match(queries[0].text, /RETURNING/i);
});

test('postgres attribution finds a platform message by tenant and session', async () => {
  const pool = { async query() { return { rows: [row()], rowCount: 1 }; } };
  const store = new PostgresOutboundAttributionStore({ pool });
  const found = await store.findByPlatformMessageId('acme', 'acme-sales', 'out-1');
  assert.equal(found.platformMessageId, 'out-1');
});

test('postgres consumeEcho sets only the first observation timestamp', async () => {
  const queries = [];
  const pool = {
    async query(text, values) {
      queries.push({ text: String(text), values });
      if (/UPDATE outbound_attributions/i.test(String(text))) {
        return { rows: [row({ echo_observed_at: '2026-08-27T09:07:00.000Z' })], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
  };
  const store = new PostgresOutboundAttributionStore({ pool, now: () => '2026-08-27T09:07:00.000Z' });
  const consumed = await store.consumeEcho('acme', 'acme-sales', 'out-1');
  assert.equal(consumed.echoObservedAt, '2026-08-27T09:07:00.000Z');
  assert.match(queries[0].text, /echo_observed_at = COALESCE\(echo_observed_at/i);
});
