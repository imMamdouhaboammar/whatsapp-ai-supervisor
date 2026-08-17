import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createBrowserWorkerServer } from '../src/browser/worker-app.js';

async function withWorker(runtime, fn, options = {}) {
  const server = createBrowserWorkerServer({ runtime, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('browser worker requires bearer token when configured', async () => {
  let calls = 0;
  const runtime = {
    async probe() { calls += 1; return { available: true, backend: 'agent-browser' }; },
    async runTask() { calls += 1; return { ok: true }; }
  };

  await withWorker(runtime, async (base) => {
    const noAuth = await fetch(`${base}/health`);
    assert.equal(noAuth.status, 401);

    const wrongAuth = await fetch(`${base}/health`, { headers: { authorization: 'Bearer wrong' } });
    assert.equal(wrongAuth.status, 401);

    const goodAuth = await fetch(`${base}/health`, { headers: { authorization: 'Bearer worker-secret' } });
    assert.equal(goodAuth.status, 200);
    assert.equal(calls, 1);
  }, { authToken: 'worker-secret' });
});

test('browser worker rejects tasks above max concurrency with 429', async () => {
  let releaseFirst;
  const firstTask = new Promise((resolve) => { releaseFirst = resolve; });
  let calls = 0;
  const runtime = {
    async probe() { return { available: true, backend: 'agent-browser' }; },
    async runTask() {
      calls += 1;
      if (calls === 1) await firstTask;
      return { ok: true };
    }
  };

  await withWorker(runtime, async (base) => {
    const body = JSON.stringify({ task: 'x', sessionId: 's', allowedDomains: ['example.com'] });
    const first = fetch(`${base}/v1/browser/task`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await fetch(`${base}/v1/browser/task`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body
    });

    assert.equal(second.status, 429);
    assert.deepEqual(await second.json(), { error: 'browser_worker_busy' });
    releaseFirst();
    assert.equal((await first).status, 200);
  }, { maxConcurrency: 1 });
});

test('browser worker health reports available runtime', async () => {
  const runtime = {
    async probe() { return { available: true, backend: 'agent-browser', detail: 'ready' }; },
    async runTask() { return { ok: true }; }
  };

  await withWorker(runtime, async (base) => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: 'ok',
      backend: 'agent-browser',
      detail: 'ready'
    });
  });
});

test('browser worker health returns 503 when runtime is unavailable', async () => {
  const runtime = {
    async probe() { return { available: false, backend: 'agent-browser', detail: 'missing' }; },
    async runTask() { throw new Error('not used'); }
  };

  await withWorker(runtime, async (base) => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).status, 'unavailable');
  });
});

test('browser worker validates and runs browser task', async () => {
  let received;
  const runtime = {
    async probe() { return { available: true, backend: 'agent-browser' }; },
    async runTask(input) { received = input; return { success: true, text: 'done' }; }
  };

  await withWorker(runtime, async (base) => {
    const body = {
      task: 'Read the account dashboard',
      sessionId: 'client-a',
      allowedDomains: ['example.com'],
      timeoutMs: 30000
    };
    const response = await fetch(`${base}/v1/browser/task`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    assert.equal(response.status, 200);
    assert.deepEqual(received, body);
    assert.deepEqual(await response.json(), { success: true, text: 'done' });
  });
});

test('browser worker rejects unsafe task before invoking runtime', async () => {
  let calls = 0;
  const runtime = {
    async probe() { return { available: true, backend: 'agent-browser' }; },
    async runTask() { calls += 1; return { success: true }; }
  };

  await withWorker(runtime, async (base) => {
    const response = await fetch(`${base}/v1/browser/task`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: 'x', sessionId: 's', allowedDomains: ['https://evil.example/path'] })
    });
    assert.equal(response.status, 400);
    assert.equal(calls, 0);
    assert.match((await response.json()).error, /domain/i);
  });
});

test('browser worker maps task timeout to 504', async () => {
  const runtime = {
    async probe() { return { available: true, backend: 'agent-browser' }; },
    async runTask() { throw new Error('browser_task_timeout'); }
  };

  await withWorker(runtime, async (base) => {
    const response = await fetch(`${base}/v1/browser/task`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: 'x', sessionId: 's', allowedDomains: ['example.com'] })
    });
    assert.equal(response.status, 504);
    assert.deepEqual(await response.json(), { error: 'browser_task_timeout' });
  });
});
