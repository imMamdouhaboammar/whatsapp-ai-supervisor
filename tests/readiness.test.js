import test from 'node:test';
import assert from 'node:assert/strict';
import { collectReadiness } from '../src/runtime/readiness.js';

test('readiness is ready when storage works and browser is disabled', async () => {
  const report = await collectReadiness({
    tenantCount: 2,
    browserRuntime: null,
    storageProbe: async () => ({ available: true, detail: 'writable' })
  });
  assert.equal(report.ready, true);
  assert.equal(report.status, 'ready');
  assert.equal(report.browser.status, 'disabled');
  assert.equal(report.tenants.count, 2);
});

test('optional browser failure degrades but does not make supervisor unready', async () => {
  const report = await collectReadiness({
    tenantCount: 1,
    browserRequired: false,
    browserRuntime: { async probe() { return { available: false, backend: 'agent-browser', detail: 'missing' }; } },
    storageProbe: async () => ({ available: true, detail: 'writable' })
  });
  assert.equal(report.ready, true);
  assert.equal(report.status, 'degraded');
  assert.equal(report.browser.available, false);
});

test('required browser failure makes supervisor unready', async () => {
  const report = await collectReadiness({
    tenantCount: 1,
    browserRequired: true,
    browserRuntime: { async probe() { return { available: false, backend: 'agent-browser', detail: 'missing' }; } },
    storageProbe: async () => ({ available: true, detail: 'writable' })
  });
  assert.equal(report.ready, false);
  assert.equal(report.status, 'not_ready');
});

test('storage failure always makes supervisor unready', async () => {
  const report = await collectReadiness({
    tenantCount: 1,
    browserRuntime: null,
    storageProbe: async () => ({ available: false, detail: 'read_only' })
  });
  assert.equal(report.ready, false);
  assert.equal(report.status, 'not_ready');
});
