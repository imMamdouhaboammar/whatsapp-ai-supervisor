import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadWorkerConfig } from '../workers/whatsapp-web/src/config.js';

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), 'was-wa-worker-config-'));
  await mkdir(join(cwd, 'config'));
  await writeFile(join(cwd, 'config/tenants.json'), JSON.stringify([
    { id: 'cloud', phoneNumberId: 'p1', whatsapp: { mode: 'cloud' } },
    { id: 'linked', whatsapp: { mode: 'linked-device', sessionId: 'acme', allowGroups: true, pairingPhoneNumber: '201000000000' } }
  ]));
  return cwd;
}

test('worker config derives only linked-device sessions from tenant config', async () => {
  const cwd = await fixture();
  const config = loadWorkerConfig({ cwd, env: {
    WHATSAPP_LINKED_DEVICE_WORKER_TOKEN: 'worker-token',
    LINKED_DEVICE_INGRESS_TOKEN: 'ingress-token',
    SUPERVISOR_INTERNAL_URL: 'http://supervisor:3000'
  } });
  assert.equal(config.sessions.length, 1);
  assert.deepEqual(config.sessions[0], {
    tenantId: 'linked', sessionId: 'acme', allowGroups: true, pairingPhoneNumber: '201000000000'
  });
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 7441);
});

test('worker config requires separate inbound and outbound shared secrets', async () => {
  const cwd = await fixture();
  assert.throws(() => loadWorkerConfig({ cwd, env: {
    LINKED_DEVICE_INGRESS_TOKEN: 'ingress-token', SUPERVISOR_INTERNAL_URL: 'http://supervisor:3000'
  } }), /WHATSAPP_LINKED_DEVICE_WORKER_TOKEN/);
});
