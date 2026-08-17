import test from 'node:test';
import assert from 'node:assert/strict';
import { TenantRuntimeCache } from '../src/runtime/tenant-runtime-cache.js';

test('TenantRuntimeCache reuses tenant resources until invalidated', () => {
  const cache = new TenantRuntimeCache();
  let runtimeBuilds = 0;
  let senderBuilds = 0;

  const runtimeFactory = () => ({ id: `runtime-${++runtimeBuilds}` });
  const senderFactory = () => ({ id: `sender-${++senderBuilds}` });

  const runtimeA = cache.runtimeFor('acme', runtimeFactory);
  const runtimeB = cache.runtimeFor('acme', runtimeFactory);
  const senderA = cache.senderFor('acme', senderFactory);
  const senderB = cache.senderFor('acme', senderFactory);

  assert.equal(runtimeA, runtimeB);
  assert.equal(senderA, senderB);
  assert.equal(runtimeBuilds, 1);
  assert.equal(senderBuilds, 1);

  cache.invalidate('acme');

  const runtimeAfter = cache.runtimeFor('acme', runtimeFactory);
  const senderAfter = cache.senderFor('acme', senderFactory);
  assert.notEqual(runtimeAfter, runtimeA);
  assert.notEqual(senderAfter, senderA);
  assert.equal(runtimeBuilds, 2);
  assert.equal(senderBuilds, 2);
});

test('TenantRuntimeCache isolates entries by tenant id', () => {
  const cache = new TenantRuntimeCache();
  const acme = cache.runtimeFor('acme', () => ({ tenant: 'acme' }));
  const beta = cache.runtimeFor('beta', () => ({ tenant: 'beta' }));

  cache.invalidate('acme');

  assert.equal(cache.runtimeFor('beta', () => ({ tenant: 'unexpected' })), beta);
  assert.notEqual(cache.runtimeFor('acme', () => ({ tenant: 'acme-new' })), acme);
});
