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

test('management tenant CRUD and WhatsApp numbers API', async () => {
  const tenants = new Map([
    ['acme', { id: 'acme', businessContext: { name: 'Acme' }, whatsapp: { mode: 'cloud', numbers: [] }, ai: {}, policy: { rules: [] } }]
  ]);
  let persisted = false;

  const mockStore = {
    list: () => Array.from(tenants.values()),
    findById: (id) => tenants.get(id) || null,
    create: (data) => {
      const t = { id: data.id || 'new-t', ...data, whatsapp: data.whatsapp || { mode: 'cloud' } };
      tenants.set(t.id, t);
      return t;
    },
    update: (id, patch) => {
      const existing = tenants.get(id);
      if (!existing) throw Object.assign(new Error('not_found'), { statusCode: 404 });
      const updated = { ...existing, ...patch };
      tenants.set(id, updated);
      return updated;
    },
    delete: (id) => {
      if (!tenants.has(id)) throw Object.assign(new Error('not_found'), { statusCode: 404 });
      tenants.delete(id);
      return true;
    },
    addWhatsAppNumber: (id, number) => {
      const tenant = tenants.get(id);
      if (!tenant) throw Object.assign(new Error('not_found'), { statusCode: 404 });
      const num = { id: number.id || 'num-1', ...number };
      tenant.whatsapp.numbers = [...(tenant.whatsapp.numbers || []), num];
      return { tenant, number: num };
    },
    removeWhatsAppNumber: (id, numberId) => {
      const tenant = tenants.get(id);
      if (!tenant) throw Object.assign(new Error('not_found'), { statusCode: 404 });
      tenant.whatsapp.numbers = (tenant.whatsapp.numbers || []).filter((n) => n.id !== numberId);
      return tenant;
    },
    persist: () => { persisted = true; }
  };

  const router = createManagementRouter({
    token: 'secret',
    tenantStore: mockStore,
    auditStore: { list: () => [] },
    conversationStore: { list: () => [] },
    readiness: async () => ({ ready: true }),
    linkedDeviceStatus: async () => []
  });

  const server = createServer((req, res) => router(req, res, new URL(req.url, 'http://localhost')));
  const base = await start(server);
  const headers = { authorization: 'Bearer secret', 'content-type': 'application/json' };

  try {
    // 1. Create tenant via POST
    const createRes = await fetch(`${base}/api/management/tenants`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: 'beta', businessContext: { name: 'Beta Corp' } })
    });
    assert.equal(createRes.status, 201);
    const createdData = await createRes.json();
    assert.equal(createdData.tenant.id, 'beta');
    assert.equal(persisted, true);

    // 2. Get created tenant
    const getRes = await fetch(`${base}/api/management/tenants/beta`, { headers });
    assert.equal(getRes.status, 200);
    const getData = await getRes.json();
    assert.equal(getData.tenant.id, 'beta');

    // 3. Update tenant via PUT
    const updateRes = await fetch(`${base}/api/management/tenants/beta`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ businessContext: { name: 'Beta Corp Updated' } })
    });
    assert.equal(updateRes.status, 200);

    // 4. Add WhatsApp number
    const addNumRes = await fetch(`${base}/api/management/tenants/beta/numbers`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: 'line-1', label: 'Support', mode: 'linked-device', sessionId: 'beta-supp' })
    });
    assert.equal(addNumRes.status, 201);

    // 5. List numbers
    const listNumRes = await fetch(`${base}/api/management/tenants/beta/numbers`, { headers });
    assert.equal(listNumRes.status, 200);
    const listNumData = await listNumRes.json();
    assert.equal(listNumData.numbers.length, 1);
    assert.equal(listNumData.numbers[0].id, 'line-1');

    // 6. Delete number
    const delNumRes = await fetch(`${base}/api/management/tenants/beta/numbers/line-1`, {
      method: 'DELETE',
      headers
    });
    assert.equal(delNumRes.status, 200);

    // 7. Delete tenant
    const delRes = await fetch(`${base}/api/management/tenants/beta`, {
      method: 'DELETE',
      headers
    });
    assert.equal(delRes.status, 200);
    assert.equal(mockStore.findById('beta'), null);
  } finally {
    server.close();
  }
});

test('management credentials in URL query parameters are rejected', async () => {
  const { server } = fixture();
  const base = await start(server);
  try {
    const queryCredential = await fetch(`${base}/api/management/session?token=secret`);
    assert.equal(queryCredential.status, 401);

    const bearerCredential = await fetch(`${base}/api/management/session`, {
      headers: { authorization: 'Bearer secret' }
    });
    assert.equal(bearerCredential.status, 200);
  } finally { server.close(); }
});
