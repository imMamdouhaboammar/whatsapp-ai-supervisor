import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createWhatsAppWebWorkerServer } from '../workers/whatsapp-web/src/server.js';

async function withServer(manager, fn, options = {}) {
  const server = createWhatsAppWebWorkerServer({ manager, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try { await fn(`http://127.0.0.1:${port}`); }
  finally { server.close(); await once(server, 'close'); }
}

function manager() {
  return {
    listSessions() { return [{ sessionId: 'acme', status: 'ready', qr: null, pairingCode: null }]; },
    getSession(id) { return id === 'acme' ? { sessionId: 'acme', status: 'ready', qr: 'qr', pairingCode: 'code' } : null; },
    async sendText(input) { return { id: `sent:${input.sessionId}:${input.to}` }; }
  };
}

test('worker server requires bearer token when configured', async () => {
  await withServer(manager(), async (base) => {
    assert.equal((await fetch(`${base}/health`)).status, 401);
    assert.equal((await fetch(`${base}/health`, { headers: { authorization: 'Bearer secret' } })).status, 200);
  }, { authToken: 'secret' });
});

test('worker health and sessions expose session status', async () => {
  await withServer(manager(), async (base) => {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).readySessions, 1);

    const sessions = await fetch(`${base}/v1/sessions`);
    assert.equal((await sessions.json()).sessions[0].sessionId, 'acme');

    const one = await fetch(`${base}/v1/sessions/acme`);
    assert.equal((await one.json()).pairingCode, 'code');
  });
});

test('worker send-text validates payload and calls session manager', async () => {
  const calls = [];
  const m = manager();
  m.sendText = async (input) => { calls.push(input); return { id: 'out-1' }; };
  await withServer(m, async (base) => {
    const response = await fetch(`${base}/v1/send-text`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'acme', to: '20100@c.us', text: 'hello', replyToId: 'ignored-v1' })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id: 'out-1' });
    assert.deepEqual(calls[0], { sessionId: 'acme', to: '20100@c.us', text: 'hello', replyToId: 'ignored-v1' });
  });
});

test('worker maps not-ready session to 409', async () => {
  const m = manager();
  m.sendText = async () => { throw new Error('session_not_ready'); };
  await withServer(m, async (base) => {
    const response = await fetch(`${base}/v1/send-text`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'acme', to: '20100@c.us', text: 'hello' })
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'session_not_ready' });
  });
});

test('worker maps full outbound queue to 429', async () => {
  const m = manager();
  m.sendText = async () => { throw new Error('send_queue_full'); };
  await withServer(m, async (base) => {
    const response = await fetch(`${base}/v1/send-text`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'acme', to: '20100@c.us', text: 'hello' })
    });
    assert.equal(response.status, 429);
  });
});
