import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeLocalWorkspace } from '../src/runtime/init-local.js';
import { runDoctor } from '../src/runtime/doctor.js';

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'was-cli-'));
}

async function seedTemplates(cwd) {
  await mkdir(join(cwd, 'config'), { recursive: true });
  await writeFile(join(cwd, '.env.example'), 'META_WEBHOOK_VERIFY_TOKEN=change-me\nMETA_APP_SECRET=change-me\nMETA_GRAPH_VERSION=v1\nDEMO_META_ACCESS_TOKEN=change-me\nDEMO_OPENAI_API_KEY=change-me\n');
  await writeFile(join(cwd, 'config', 'tenants.example.json'), JSON.stringify([{ id: 'demo', phoneNumberId: 'p1', whatsapp: { accessTokenEnv: 'DEMO_META_ACCESS_TOKEN' }, ai: { apiKeyEnv: 'DEMO_OPENAI_API_KEY' } }], null, 2));
}

test('initializeLocalWorkspace creates env, tenant config, and persistent directories', async () => {
  const cwd = await tempDir();
  await seedTemplates(cwd);

  const result = await initializeLocalWorkspace({ cwd });

  assert.equal(result.created.includes('.env'), true);
  assert.equal(result.created.includes('config/tenants.json'), true);
  assert.equal(result.created.includes('data/audit'), true);
  assert.equal(result.created.includes('data/claims'), true);
  assert.equal(result.created.includes('data/browser'), true);
  assert.match(await readFile(join(cwd, '.env'), 'utf8'), /META_APP_SECRET/);
  assert.match(await readFile(join(cwd, 'config', 'tenants.json'), 'utf8'), /"demo"/);
});

test('initializeLocalWorkspace never overwrites an existing env or tenant config', async () => {
  const cwd = await tempDir();
  await seedTemplates(cwd);
  await writeFile(join(cwd, '.env'), 'CUSTOM=keep-me\n');
  await writeFile(join(cwd, 'config', 'tenants.json'), '[{"id":"custom"}]\n');

  const result = await initializeLocalWorkspace({ cwd });

  assert.equal(await readFile(join(cwd, '.env'), 'utf8'), 'CUSTOM=keep-me\n');
  assert.equal(await readFile(join(cwd, 'config', 'tenants.json'), 'utf8'), '[{"id":"custom"}]\n');
  assert.equal(result.skipped.includes('.env'), true);
  assert.equal(result.skipped.includes('config/tenants.json'), true);
});

test('runDoctor fails when tenant config is missing', async () => {
  const cwd = await tempDir();
  const report = await runDoctor({ cwd, env: {}, nodeVersion: '22.16.0' });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((check) => check.name === 'tenant-config' && check.status === 'fail'), true);
});

test('runDoctor reports a ready core when config, data, and secrets are present', async () => {
  const cwd = await tempDir();
  await seedTemplates(cwd);
  await initializeLocalWorkspace({ cwd });
  const env = {
    META_WEBHOOK_VERIFY_TOKEN: 'verify', META_APP_SECRET: 'secret', META_GRAPH_VERSION: 'v99',
    DEMO_META_ACCESS_TOKEN: 'token', DEMO_OPENAI_API_KEY: 'key', BROWSER_RUNTIME: 'none'
  };

  const report = await runDoctor({ cwd, env, nodeVersion: '22.16.0' });

  assert.equal(report.ok, true);
  assert.equal(report.checks.some((check) => check.name === 'browser' && check.status === 'ok'), true);
  assert.equal(report.checks.some((check) => check.name === 'tenant-secrets' && check.status === 'ok'), true);
});

test('runDoctor fails browser check when agent-browser is configured but unavailable', async () => {
  const cwd = await tempDir();
  await seedTemplates(cwd);
  await initializeLocalWorkspace({ cwd });
  const env = {
    META_WEBHOOK_VERIFY_TOKEN: 'verify', META_APP_SECRET: 'secret', META_GRAPH_VERSION: 'v99',
    DEMO_META_ACCESS_TOKEN: 'token', DEMO_OPENAI_API_KEY: 'key', BROWSER_RUNTIME: 'agent-browser'
  };
  const report = await runDoctor({
    cwd, env, nodeVersion: '22.16.0',
    commandProbe: async () => ({ ok: false, detail: 'command not found' })
  });

  assert.equal(report.ok, false);
  assert.equal(report.checks.some((check) => check.name === 'browser' && check.status === 'fail'), true);
});

test('runDoctor warns when remote browser worker has no bearer token', async () => {
  const cwd = await tempDir();
  await seedTemplates(cwd);
  await initializeLocalWorkspace({ cwd });
  const env = {
    META_WEBHOOK_VERIFY_TOKEN: 'verify', META_APP_SECRET: 'secret', META_GRAPH_VERSION: 'v99',
    DEMO_META_ACCESS_TOKEN: 'token', DEMO_OPENAI_API_KEY: 'key',
    BROWSER_RUNTIME: 'remote', BROWSER_WORKER_URL: 'http://browser-worker:7331'
  };

  const report = await runDoctor({ cwd, env, nodeVersion: '22.16.0' });
  const auth = report.checks.find((check) => check.name === 'browser-auth');
  assert.equal(auth.status, 'warn');
  assert.match(auth.detail, /trusted private network/i);
});

test('runDoctor does not require Meta secrets for linked-device-only tenant', async () => {
  const cwd = await tempDir();
  await mkdir(join(cwd, 'config'), { recursive: true });
  await writeFile(join(cwd, '.env'), 'LINKED_DEVICE_INGRESS_TOKEN=ingress\n');
  await writeFile(join(cwd, 'config', 'tenants.json'), JSON.stringify([{
    id: 'linked',
    whatsapp: {
      mode: 'linked-device', sessionId: 'acme', workerUrl: 'http://127.0.0.1:7441', workerTokenEnv: 'WA_WORKER_TOKEN'
    },
    ai: { apiKeyEnv: 'OPENAI_KEY' }
  }]));
  await mkdir(join(cwd, 'data'), { recursive: true });

  const report = await runDoctor({ cwd, env: {
    LINKED_DEVICE_INGRESS_TOKEN: 'ingress', WA_WORKER_TOKEN: 'worker', OPENAI_KEY: 'ai', BROWSER_RUNTIME: 'none'
  }, nodeVersion: '22.16.0' });

  assert.equal(report.ok, true);
  assert.equal(report.checks.find((check) => check.name === 'meta-secrets').status, 'ok');
  assert.match(report.checks.find((check) => check.name === 'meta-secrets').detail, /not required/i);
  assert.equal(report.checks.find((check) => check.name === 'linked-device').status, 'ok');
});

test('runDoctor fails linked-device config when ingress token is missing', async () => {
  const cwd = await tempDir();
  await mkdir(join(cwd, 'config'), { recursive: true });
  await writeFile(join(cwd, 'config', 'tenants.json'), JSON.stringify([{
    id: 'linked', whatsapp: { mode: 'linked-device', sessionId: 'acme', workerUrl: 'http://127.0.0.1:7441', workerTokenEnv: 'WA_WORKER_TOKEN' }
  }]));
  await mkdir(join(cwd, 'data'), { recursive: true });
  const report = await runDoctor({ cwd, env: { WA_WORKER_TOKEN: 'worker', BROWSER_RUNTIME: 'none' }, nodeVersion: '22.16.0' });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((check) => check.name === 'linked-device').status, 'fail');
});
