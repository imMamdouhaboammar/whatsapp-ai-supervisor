import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/config.js';

async function withEnv(values, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { return await fn(); }
  finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function baseEnv(overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'was-config-'));
  const tenantsFile = join(dir, 'tenants.json');
  await writeFile(tenantsFile, JSON.stringify([{ id: 'a', phoneNumberId: 'p1', whatsapp: { mode: 'cloud' } }]));
  return {
    TENANTS_FILE: tenantsFile,
    META_WEBHOOK_VERIFY_TOKEN: 'verify',
    META_APP_SECRET: 'secret',
    META_GRAPH_VERSION: 'v99.0',
    DATA_DIR: join(dir, 'data'),
    ...overrides
  };
}

test('loadConfig defaults browser runtime to disabled local mode', async () => {
  await withEnv(await baseEnv({ BROWSER_RUNTIME: undefined }), async () => {
    const config = loadConfig();
    assert.equal(config.host, '127.0.0.1');
    assert.deepEqual(config.browser, {
      mode: 'none',
      command: 'agent-browser',
      engine: 'chrome',
      workerUrl: null,
      workerToken: null,
      required: false,
      taskTimeoutMs: 60000
    });
  });
});

test('loadConfig reads remote browser worker settings', async () => {
  await withEnv(await baseEnv({
    BROWSER_RUNTIME: 'remote',
    BROWSER_WORKER_URL: 'http://browser-worker:7331',
    BROWSER_WORKER_TOKEN: 'worker-secret',
    BROWSER_REQUIRED: 'true',
    BROWSER_ENGINE: 'lightpanda',
    BROWSER_TASK_TIMEOUT_MS: '45000'
  }), async () => {
    const config = loadConfig();
    assert.equal(config.browser.mode, 'remote');
    assert.equal(config.browser.workerUrl, 'http://browser-worker:7331');
    assert.equal(config.browser.workerToken, 'worker-secret');
    assert.equal(config.browser.required, true);
    assert.equal(config.browser.engine, 'lightpanda');
    assert.equal(config.browser.taskTimeoutMs, 45000);
  });
});

test('loadConfig allows linked-device-only tenants without Meta Cloud secrets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'was-config-linked-'));
  const tenantsFile = join(dir, 'tenants.json');
  await writeFile(tenantsFile, JSON.stringify([{
    id: 'linked',
    whatsapp: {
      mode: 'linked-device',
      sessionId: 'linked-session',
      workerUrl: 'http://wa-worker:7441',
      workerTokenEnv: 'WA_WORKER_TOKEN'
    }
  }]));
  await withEnv({
    TENANTS_FILE: tenantsFile,
    DATA_DIR: join(dir, 'data'),
    META_WEBHOOK_VERIFY_TOKEN: undefined,
    META_APP_SECRET: undefined,
    META_GRAPH_VERSION: undefined,
    LINKED_DEVICE_INGRESS_TOKEN: 'ingress-secret'
  }, async () => {
    const config = loadConfig();
    assert.equal(config.meta.enabled, false);
    assert.equal(config.linkedDevice.enabled, true);
    assert.equal(config.linkedDevice.ingressToken, 'ingress-secret');
  });
});

test('loadConfig requires linked-device ingress token when a linked-device tenant exists', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'was-config-linked-'));
  const tenantsFile = join(dir, 'tenants.json');
  await writeFile(tenantsFile, JSON.stringify([{
    id: 'linked',
    whatsapp: { mode: 'linked-device', sessionId: 's1', workerUrl: 'http://wa-worker:7441', workerTokenEnv: 'WA_WORKER_TOKEN' }
  }]));
  await withEnv({
    TENANTS_FILE: tenantsFile,
    LINKED_DEVICE_INGRESS_TOKEN: undefined,
    META_WEBHOOK_VERIFY_TOKEN: undefined,
    META_APP_SECRET: undefined,
    META_GRAPH_VERSION: undefined
  }, async () => {
    assert.throws(() => loadConfig(), /LINKED_DEVICE_INGRESS_TOKEN/);
  });
});

test('loadConfig still requires Meta secrets when any Cloud API tenant exists', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'was-config-cloud-'));
  const tenantsFile = join(dir, 'tenants.json');
  await writeFile(tenantsFile, JSON.stringify([{ id: 'cloud', phoneNumberId: 'p1', whatsapp: { mode: 'cloud' } }]));
  await withEnv({
    TENANTS_FILE: tenantsFile,
    META_WEBHOOK_VERIFY_TOKEN: undefined,
    META_APP_SECRET: undefined,
    META_GRAPH_VERSION: undefined
  }, async () => {
    assert.throws(() => loadConfig(), /META_WEBHOOK_VERIFY_TOKEN/);
  });
});
