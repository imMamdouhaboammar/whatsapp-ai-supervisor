import test from 'node:test';
import assert from 'node:assert/strict';
import { createLinkedDeviceStatusProvider } from '../src/management/linked-device-status.js';

function tenantStore(tenants) {
  return { list() { return tenants; } };
}

const now = () => '2026-08-17T12:15:00.000Z';

test('management status projects Cloud API config into canonical health-unverified state', async () => {
  const provider = createLinkedDeviceStatusProvider({
    tenantStore: tenantStore([{ id: 'cloud-a', phoneNumberId: 'pn-1', whatsapp: { mode: 'cloud' } }]),
    resolveSecret() { throw new Error('cloud_should_not_resolve_worker_secret'); },
    now
  });

  const rows = await provider();
  assert.deepEqual(rows, [{
    tenantId: 'cloud-a', mode: 'cloud', phoneNumberId: 'pn-1',
    state: 'degraded', status: 'degraded', reasonCode: 'health_unverified',
    observedAt: '2026-08-17T12:15:00.000Z'
  }]);
});

test('management status maps linked-device worker state and strips raw diagnostics', async () => {
  const calls = [];
  const provider = createLinkedDeviceStatusProvider({
    tenantStore: tenantStore([{ id: 'linked-a', whatsapp: {
      mode: 'linked-device', sessionId: 'session-a', workerUrl: 'http://worker.internal:7441', workerTokenEnv: 'WORKER_TOKEN'
    } }]),
    resolveSecret() { return 'secret-token'; },
    now,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        sessionId: 'session-a', status: 'ready', qr: 'stale-qr', pairingCode: 'stale-code',
        reconnectAttempt: 3, lastError: 'private-file:/srv/tenant/secrets'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });

  const rows = await provider();
  assert.equal(calls[0].url, 'http://worker.internal:7441/v1/sessions/session-a');
  assert.equal(calls[0].init.headers.authorization, 'Bearer secret-token');
  assert.deepEqual(rows, [{
    tenantId: 'linked-a', mode: 'linked-device', sessionId: 'session-a',
    state: 'ready', status: 'ready', reasonCode: 'session_ready', observedAt: '2026-08-17T12:15:00.000Z',
    qr: null, pairingCode: null, reconnectAttempt: 3
  }]);
  assert.equal(JSON.stringify(rows).includes('private-file'), false);
  assert.equal(Object.hasOwn(rows[0], 'lastError'), false);
});

test('pairing response exposes pairing material only with canonical qr_required state', async () => {
  const provider = createLinkedDeviceStatusProvider({
    tenantStore: tenantStore([{ id: 'linked-pair', whatsapp: {
      mode: 'linked-device', sessionId: 'pair-1', workerUrl: 'http://worker:7441', workerTokenEnv: 'TOKEN'
    } }]),
    resolveSecret() { return 'secret'; },
    now,
    fetchImpl: async () => new Response(JSON.stringify({ status: 'pairing', qr: 'qr-data', pairingCode: '123-456', reconnectAttempt: 0 }), { status: 200 })
  });
  assert.deepEqual(await provider(), [{
    tenantId: 'linked-pair', mode: 'linked-device', sessionId: 'pair-1',
    state: 'qr_required', status: 'qr_required', reasonCode: 'pairing_required', observedAt: '2026-08-17T12:15:00.000Z',
    qr: 'qr-data', pairingCode: '123-456', reconnectAttempt: 0
  }]);
});

test('worker timeout and HTTP failures return fixed degraded reasons without URL or exception leakage', async () => {
  const tenant = { id: 'linked-fail', whatsapp: {
    mode: 'linked-device', sessionId: 'session-fail', workerUrl: 'http://private-worker.internal:7441', workerTokenEnv: 'TOKEN'
  } };

  const timeoutProvider = createLinkedDeviceStatusProvider({
    tenantStore: tenantStore([tenant]), resolveSecret() { return 'secret'; }, now,
    fetchImpl: async () => { const error = new Error('private diagnostic'); error.name = 'TimeoutError'; throw error; }
  });
  const timeout = (await timeoutProvider())[0];
  assert.equal(timeout.state, 'degraded');
  assert.equal(timeout.status, 'degraded');
  assert.equal(timeout.reasonCode, 'worker_timeout');
  assert.equal(JSON.stringify(timeout).includes('private'), false);

  const httpProvider = createLinkedDeviceStatusProvider({
    tenantStore: tenantStore([tenant]), resolveSecret() { return 'secret'; }, now,
    fetchImpl: async () => new Response('internal stack and secret URL', { status: 503 })
  });
  const failed = (await httpProvider())[0];
  assert.equal(failed.state, 'degraded');
  assert.equal(failed.reasonCode, 'worker_http_error');
  assert.equal(JSON.stringify(failed).includes('internal stack'), false);
  assert.equal(JSON.stringify(failed).includes('private-worker'), false);
});

test('multi-number tenants use the same canonical mapping for Cloud and linked-device connectors', async () => {
  const provider = createLinkedDeviceStatusProvider({
    tenantStore: tenantStore([{ id: 'multi', whatsapp: { numbers: [
      { id: 'cloud-num', label: 'Cloud', mode: 'cloud', phoneNumberId: 'pn-multi' },
      { id: 'linked-num', label: 'Linked', mode: 'linked-device', sessionId: 'session-multi', workerUrl: 'http://worker:7441', workerTokenEnv: 'TOKEN' }
    ] } }]),
    resolveSecret() { return 'secret'; }, now,
    fetchImpl: async () => new Response(JSON.stringify({ status: 'disconnected', reconnectAttempt: 4, lastError: 'do not leak' }), { status: 200 })
  });
  const rows = await provider();
  assert.deepEqual(rows.map((row) => [row.id, row.state, row.reasonCode]), [
    ['cloud-num', 'degraded', 'health_unverified'],
    ['linked-num', 'disconnected', 'session_disconnected']
  ]);
  assert.equal(JSON.stringify(rows).includes('do not leak'), false);
});
