import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DiskInboundSpool } from '../workers/whatsapp-web/src/spool.js';

async function tempDir() { return mkdtemp(join(tmpdir(), 'was-wa-spool-')); }

const payload = {
  sessionId: 'acme',
  message: { id: 'm1', from: '20100@c.us', text: 'hello', timestamp: 1, type: 'chat', fromMe: false, isGroup: false }
};

test('DiskInboundSpool persists inbound event across instances', async () => {
  const dir = await tempDir();
  const first = new DiskInboundSpool({ dir, supervisorUrl: 'http://supervisor:3000', token: 'secret', fetchImpl: async () => new Response('', { status: 500 }) });
  assert.equal(await first.enqueue(payload), true);
  assert.equal((await first.listPending()).length, 1);

  const second = new DiskInboundSpool({ dir, supervisorUrl: 'http://supervisor:3000', token: 'secret', fetchImpl: async () => new Response('', { status: 500 }) });
  assert.equal((await second.listPending()).length, 1);
});

test('DiskInboundSpool deduplicates the same session and message id', async () => {
  const dir = await tempDir();
  const spool = new DiskInboundSpool({ dir, supervisorUrl: 'http://supervisor:3000', token: 'secret', fetchImpl: async () => new Response('', { status: 500 }) });
  assert.equal(await spool.enqueue(payload), true);
  assert.equal(await spool.enqueue(payload), false);
  assert.equal((await spool.listPending()).length, 1);
});

test('DiskInboundSpool removes event only after supervisor accepts it', async () => {
  const dir = await tempDir();
  const calls = [];
  const spool = new DiskInboundSpool({
    dir,
    supervisorUrl: 'http://supervisor:3000',
    token: 'ingress-secret',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ processed: 1 }), { status: 200 });
    }
  });
  await spool.enqueue(payload);
  const report = await spool.flushOnce();
  assert.deepEqual(report, { delivered: 1, retained: 0 });
  assert.equal((await spool.listPending()).length, 0);
  assert.equal(calls[0].url, 'http://supervisor:3000/internal/transports/linked-device/message');
  assert.equal(calls[0].init.headers.authorization, 'Bearer ingress-secret');
});

test('DiskInboundSpool retains event on network or supervisor failure', async () => {
  const dir = await tempDir();
  const spool = new DiskInboundSpool({
    dir,
    supervisorUrl: 'http://supervisor:3000', token: 'secret',
    fetchImpl: async () => new Response(JSON.stringify({ error: 'down' }), { status: 503 })
  });
  await spool.enqueue(payload);
  assert.deepEqual(await spool.flushOnce(), { delivered: 0, retained: 1 });
  assert.equal((await spool.listPending()).length, 1);
});
