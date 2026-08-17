function sleepWithSignal(ms, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener?.('abort', done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener?.('abort', done, { once: true });
  });
}

export class DurableJobWorker {
  constructor({
    queue,
    handlers = {},
    pollMs = 500,
    infrastructureBackoffMs = 5_000,
    onInfrastructureError = () => {},
    sleep = sleepWithSignal
  } = {}) {
    if (!queue?.claimNext) throw new Error('DurableJobWorker queue is required');
    this.queue = queue;
    this.handlers = handlers;
    this.pollMs = Math.max(25, Number(pollMs) || 500);
    this.infrastructureBackoffMs = Math.max(this.pollMs, Number(infrastructureBackoffMs) || 5_000);
    this.onInfrastructureError = onInfrastructureError;
    this.sleep = sleep;
  }

  async runOnce() {
    const job = await this.queue.claimNext();
    if (!job) return { status: 'idle' };

    const handler = this.handlers[job.type];
    try {
      if (typeof handler !== 'function') throw new Error(`unsupported_job_type:${job.type}`);
      await handler(job.payload, job);
      const completed = await this.queue.complete(job);
      return { status: completed?.status ?? 'completed', jobId: job.id, type: job.type };
    } catch (error) {
      const failed = await this.queue.fail(job, error);
      return { status: failed?.status ?? 'queued', jobId: job.id, type: job.type };
    }
  }

  async run({ signal } = {}) {
    while (!signal?.aborted) {
      let result;
      try {
        result = await this.runOnce();
      } catch {
        this.onInfrastructureError('queue_unavailable');
        if (!signal?.aborted) await this.sleep(this.infrastructureBackoffMs, signal);
        continue;
      }
      if (signal?.aborted) break;
      if (result.status === 'idle') await this.sleep(this.pollMs, signal);
    }
  }
}
