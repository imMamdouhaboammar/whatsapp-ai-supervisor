import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentBrowserRuntime } from '../src/browser/agent-browser-runtime.js';
import { RemoteBrowserRuntime } from '../src/browser/remote-browser-runtime.js';
import { createBrowserRuntime } from '../src/browser/runtime-factory.js';

test('AgentBrowserRuntime invokes agent-browser with isolated session and safety flags', async () => {
  const calls = [];
  const runtime = new AgentBrowserRuntime({
    command: 'agent-browser',
    engine: 'lightpanda',
    execFileImpl: async (command, args, options) => {
      calls.push({ command, args, options });
      return { stdout: JSON.stringify({ success: true, data: { text: 'done' } }), stderr: '' };
    }
  });

  const result = await runtime.runTask({
    task: 'Check order 123 in the CRM',
    sessionId: 'tenant/acme customer',
    allowedDomains: ['crm.example.com', '*.cdn.example.com'],
    timeoutMs: 12_000
  });

  assert.equal(result.backend, 'agent-browser');
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'agent-browser');
  assert.equal(calls[0].args.includes('--json'), true);
  assert.equal(calls[0].args.includes('--content-boundaries'), true);
  assert.deepEqual(calls[0].args.slice(calls[0].args.indexOf('--engine'), calls[0].args.indexOf('--engine') + 2), ['--engine', 'lightpanda']);
  assert.deepEqual(calls[0].args.slice(calls[0].args.indexOf('--allowed-domains'), calls[0].args.indexOf('--allowed-domains') + 2), ['--allowed-domains', 'crm.example.com,*.cdn.example.com']);
  const session = calls[0].args[calls[0].args.indexOf('--session') + 1];
  assert.match(session, /^was-[a-f0-9]{24}$/);
  assert.deepEqual(calls[0].args.slice(-2), ['chat', 'Check order 123 in the CRM']);
  assert.equal(calls[0].options.timeout, 12_000);
  assert.equal(calls[0].options.shell, false);
});

test('AgentBrowserRuntime rejects unsafe or malformed domain allowlists before spawning', async () => {
  let called = false;
  const runtime = new AgentBrowserRuntime({ execFileImpl: async () => { called = true; return { stdout: '{}' }; } });

  await assert.rejects(
    runtime.runTask({ task: 'test', sessionId: 's', allowedDomains: ['https://example.com/path'] }),
    /Invalid allowed domain/
  );
  assert.equal(called, false);
});

test('AgentBrowserRuntime maps child timeouts to browser_task_timeout', async () => {
  const runtime = new AgentBrowserRuntime({
    execFileImpl: async () => {
      const error = new Error('timed out');
      error.killed = true;
      error.signal = 'SIGTERM';
      throw error;
    }
  });

  await assert.rejects(
    runtime.runTask({ task: 'test', sessionId: 's', allowedDomains: ['example.com'], timeoutMs: 1_000 }),
    /browser_task_timeout/
  );
});

test('RemoteBrowserRuntime sends validated task to worker and parses result', async () => {
  const calls = [];
  const runtime = new RemoteBrowserRuntime({
    baseUrl: 'http://browser-worker:7331',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true, backend: 'agent-browser', output: { text: 'done' } }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    }
  });

  const result = await runtime.runTask({ task: 'Read order status', sessionId: 'tenant-a', allowedDomains: ['crm.example.com'], timeoutMs: 8_000 });

  assert.equal(result.ok, true);
  assert.equal(calls[0].url, 'http://browser-worker:7331/v1/browser/task');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    task: 'Read order status', sessionId: 'tenant-a', allowedDomains: ['crm.example.com'], timeoutMs: 8_000
  });
});

test('RemoteBrowserRuntime sends bearer token to worker health and task requests', async () => {
  const calls = [];
  const runtime = new RemoteBrowserRuntime({
    baseUrl: 'http://browser-worker:7331',
    token: 'worker-secret',
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok', backend: 'agent-browser' }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
  });

  await runtime.probe();
  await runtime.runTask({ task: 'Read account state', sessionId: 'tenant-a', allowedDomains: ['example.com'] });

  assert.equal(calls[0].init.headers.authorization, 'Bearer worker-secret');
  assert.equal(calls[1].init.headers.authorization, 'Bearer worker-secret');
});

test('RemoteBrowserRuntime probe reports worker availability', async () => {
  const runtime = new RemoteBrowserRuntime({
    baseUrl: 'http://browser-worker:7331',
    fetchImpl: async () => new Response(JSON.stringify({ status: 'ok', backend: 'agent-browser' }), { status: 200 })
  });
  const probe = await runtime.probe();
  assert.deepEqual(probe, { available: true, backend: 'remote', detail: 'agent-browser' });
});

test('createBrowserRuntime supports none, agent-browser, and remote modes', () => {
  assert.equal(createBrowserRuntime({ mode: 'none' }), null);
  assert.equal(createBrowserRuntime({ mode: 'agent-browser' }) instanceof AgentBrowserRuntime, true);
  assert.equal(createBrowserRuntime({ mode: 'remote', workerUrl: 'http://127.0.0.1:7331' }) instanceof RemoteBrowserRuntime, true);
  assert.throws(() => createBrowserRuntime({ mode: 'other' }), /Unsupported browser runtime/);
});
