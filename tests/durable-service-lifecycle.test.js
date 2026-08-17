import test from 'node:test';
import assert from 'node:assert/strict';
import { createDurableServiceLifecycle } from '../src/runtime/durable-service-lifecycle.js';

test('durable service lifecycle starts worker once and aborts it before closing storage', async () => {
  const calls = [];
  let resolveRun;
  const runPromise = new Promise((resolve) => { resolveRun = resolve; });
  let seenSignal;
  const worker = {
    async run({ signal }) {
      calls.push('worker:start');
      seenSignal = signal;
      signal.addEventListener('abort', () => {
        calls.push('worker:abort');
        resolveRun();
      }, { once: true });
      return runPromise;
    }
  };
  const storageRuntime = { async close() { calls.push('storage:close'); } };
  const lifecycle = createDurableServiceLifecycle({ worker, storageRuntime });

  lifecycle.start();
  lifecycle.start();
  assert.equal(seenSignal.aborted, false);
  await lifecycle.stop();

  assert.deepEqual(calls, ['worker:start', 'worker:abort', 'storage:close']);
  assert.equal(seenSignal.aborted, true);
});

test('file-mode lifecycle closes storage without creating a worker task and stop is idempotent', async () => {
  let closes = 0;
  const lifecycle = createDurableServiceLifecycle({
    worker: null,
    storageRuntime: { async close() { closes += 1; } }
  });
  assert.equal(lifecycle.start(), null);
  await lifecycle.stop();
  await lifecycle.stop();
  assert.equal(closes, 1);
});
