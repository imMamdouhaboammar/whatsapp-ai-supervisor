import test from 'node:test';
import assert from 'node:assert/strict';
import { DurableJobWorker } from '../src/jobs/durable-job-worker.js';

test('DurableJobWorker completes a claimed job only after its registered handler succeeds', async () => {
  const calls = [];
  const job = { id: 'job-1', type: 'process_inbound', payload: { messageId: 'm1' }, attemptCount: 1, maxAttempts: 5 };
  const queue = {
    async claimNext() { calls.push('claim'); return job; },
    async complete(value) { calls.push(['complete', value.id]); return { ...value, status: 'completed' }; },
    async fail() { throw new Error('fail_should_not_run'); }
  };
  const worker = new DurableJobWorker({
    queue,
    handlers: { process_inbound: async (payload, claimed) => { calls.push(['handle', payload.messageId, claimed.id]); } }
  });

  const result = await worker.runOnce();

  assert.deepEqual(calls, ['claim', ['handle', 'm1', 'job-1'], ['complete', 'job-1']]);
  assert.deepEqual(result, { status: 'completed', jobId: 'job-1', type: 'process_inbound' });
});

test('DurableJobWorker delegates failures to bounded queue retry/dead-letter handling without throwing the raw error', async () => {
  const raw = new Error('private-provider-secret:/srv/tenant');
  const calls = [];
  const job = { id: 'job-2', type: 'process_inbound', payload: {}, attemptCount: 2, maxAttempts: 5 };
  const queue = {
    async claimNext() { return job; },
    async complete() { throw new Error('complete_should_not_run'); },
    async fail(value, error) {
      calls.push([value.id, error]);
      return { ...value, status: 'queued' };
    }
  };
  const worker = new DurableJobWorker({
    queue,
    handlers: { process_inbound: async () => { throw raw; } },
    logger: { error() { throw new Error('raw_errors_must_not_be_logged_by_worker'); } }
  });

  const result = await worker.runOnce();

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'job-2');
  assert.equal(calls[0][1], raw);
  assert.deepEqual(result, { status: 'queued', jobId: 'job-2', type: 'process_inbound' });
});

test('DurableJobWorker treats an empty queue as idle and unknown job types as bounded failures', async () => {
  const idle = new DurableJobWorker({ queue: { async claimNext() { return null; } }, handlers: {} });
  assert.deepEqual(await idle.runOnce(), { status: 'idle' });

  const job = { id: 'job-3', type: 'unknown', payload: {}, attemptCount: 1, maxAttempts: 1 };
  let failedWith;
  const worker = new DurableJobWorker({
    queue: {
      async claimNext() { return job; },
      async fail(_job, error) { failedWith = error; return { ...job, status: 'dead' }; }
    },
    handlers: {}
  });
  assert.deepEqual(await worker.runOnce(), { status: 'dead', jobId: 'job-3', type: 'unknown' });
  assert.match(failedWith.message, /unsupported_job_type/);
});

test('DurableJobWorker polling loop stops through AbortSignal and does not busy-loop while idle', async () => {
  let claims = 0;
  let sleeps = 0;
  const controller = new AbortController();
  const worker = new DurableJobWorker({
    queue: { async claimNext() { claims += 1; return null; } },
    handlers: {},
    pollMs: 25,
    sleep: async (_ms, signal) => {
      sleeps += 1;
      controller.abort();
      assert.equal(signal, controller.signal);
    }
  });

  await worker.run({ signal: controller.signal });
  assert.equal(claims, 1);
  assert.equal(sleeps, 1);
});

test('DurableJobWorker backs off and continues after a transient queue infrastructure failure', async () => {
  let claims = 0;
  const sleeps = [];
  const infrastructureSignals = [];
  const controller = new AbortController();
  const worker = new DurableJobWorker({
    queue: {
      async claimNext() {
        claims += 1;
        if (claims === 1) throw new Error('postgres://secret@db/internal');
        return null;
      }
    },
    handlers: {},
    pollMs: 25,
    infrastructureBackoffMs: 1000,
    onInfrastructureError: (code) => infrastructureSignals.push(code),
    sleep: async (ms) => {
      sleeps.push(ms);
      if (claims >= 2) controller.abort();
    }
  });

  await worker.run({ signal: controller.signal });

  assert.equal(claims, 2);
  assert.deepEqual(sleeps, [1000, 25]);
  assert.deepEqual(infrastructureSignals, ['queue_unavailable']);
  assert.equal(infrastructureSignals.join(' ').includes('secret'), false);
});
