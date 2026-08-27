import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createManagementRouter } from '../src/management/router.js';

async function start(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

const waiting = {
  tenantId: 'acme',
  conversationId: 'whatsapp:c1',
  state: 'WAITING_APPROVAL',
  version: 2,
  changedAt: '2026-08-27T10:10:00.000Z',
  changedBy: 'permission-engine',
  reasonCode: 'approval_required',
  transitionId: 'approval-1'
};

test('a no-op release from WAITING_APPROVAL remains non-AI in legacy projection', async () => {
  const controls = [];
  const tenant = { id: 'acme' };
  const router = createManagementRouter({
    token: 'secret',
    tenantStore: {
      list: () => [tenant],
      findById: (id) => id === 'acme' ? tenant : null
    },
    auditStore: { list: () => [] },
    conversationStore: {
      list: () => [],
      setControl: (tenantId, customerId, mode) => controls.push({ tenantId, customerId, mode })
    },
    ownershipStore: {
      async get() { return waiting; },
      async transition(input) {
        assert.equal(input.command, 'release_to_agent');
        return waiting;
      }
    },
    readiness: async () => ({ ready: true }),
    linkedDeviceStatus: async () => [],
    manualSend: async () => ({})
  });

  const server = createServer((req, res) => router(req, res, new URL(req.url, 'http://localhost')));
  const base = await start(server);
  try {
    const response = await fetch(`${base}/api/management/conversations/control`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        tenantId: 'acme',
        customerId: 'c1',
        mode: 'ai',
        expectedVersion: 2,
        transitionId: 'release-while-waiting'
      })
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ownership.state, 'WAITING_APPROVAL');
    assert.deepEqual(controls, [{ tenantId: 'acme', customerId: 'c1', mode: 'human' }]);
  } finally {
    server.close();
  }
});
