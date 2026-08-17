import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createManagementRouter } from '../src/management/router.js';

function fixture() {
  const tenant = { id: 'acme', phoneNumberId: '123', whatsapp: { mode: 'cloud' }, ai: {}, policy: { rules: [] } };
  const controls = new Map();
  const sent = [];
  const router = createManagementRouter({
    token: 'secret',
    tenantStore: { list: () => [tenant], findById: (id) => id === 'acme' ? tenant : null },
    auditStore: { list: () => [] },
    conversationStore: {
      list: () => [{ tenantId: 'acme', customerId: 'c1', customerName: 'Nora', control: controls.get('c1') ?? 'ai', messages: [] }],
      setControl: (_tenantId, customerId, mode) => controls.set(customerId, mode),
      isHumanControlled: (_tenantId, customerId) => controls.get(customerId) === 'human',
      recordManualOutbound: (event) => sent.push(event)
    },
    readiness: async () => ({ ready: true, status: 'ready' }),
    linkedDeviceStatus: async () => [{ tenantId: 'acme', mode: 'cloud', status: 'configured' }],
    manualSend: async (_tenant, message) => ({ id: `out-${message.to}` }),
    runtimeSummary: () => ({ service: 'test' })
  });
  const server = createServer((req, res) => router(req, res, new URL(req.url, 'http://localhost')));
  return { server, controls, sent };
}

async function start(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

test('management endpoints require bearer token when configured', async () => {
  const { server } = fixture();
  const base = await start(server);
  try {
    const denied = await fetch(`${base}/api/management/tenants`);
    assert.equal(denied.status, 401);
    const allowed = await fetch(`${base}/api/management/tenants`, { headers: { authorization: 'Bearer secret' } });
    assert.equal(allowed.status, 200);
  } finally { server.close(); }
});

test('manual send requires human takeover', async () => {
  const { server, controls, sent } = fixture();
  const base = await start(server);
  const headers = { authorization: 'Bearer secret', 'content-type': 'application/json' };
  try {
    const blocked = await fetch(`${base}/api/management/conversations/send`, { method: 'POST', headers, body: JSON.stringify({ tenantId: 'acme', customerId: 'c1', text: 'Hello' }) });
    assert.equal(blocked.status, 409);

    const takeover = await fetch(`${base}/api/management/conversations/control`, { method: 'POST', headers, body: JSON.stringify({ tenantId: 'acme', customerId: 'c1', mode: 'human' }) });
    assert.equal(takeover.status, 200);
    assert.equal(controls.get('c1'), 'human');

    const sentResponse = await fetch(`${base}/api/management/conversations/send`, { method: 'POST', headers, body: JSON.stringify({ tenantId: 'acme', customerId: 'c1', text: 'Hello' }) });
    assert.equal(sentResponse.status, 200);
    assert.equal(sent.length, 1);
  } finally { server.close(); }
});
