export function createDurableServiceLifecycle({ worker = null, storageRuntime }) {
  if (!storageRuntime?.close) throw new Error('storageRuntime is required');
  const controller = new AbortController();
  let workerTask = null;
  let stopTask = null;

  return {
    start() {
      if (!worker) return null;
      if (!workerTask) workerTask = Promise.resolve(worker.run({ signal: controller.signal }));
      return workerTask;
    },

    stop() {
      if (stopTask) return stopTask;
      stopTask = (async () => {
        controller.abort();
        if (workerTask) {
          try { await workerTask; } catch {}
        }
        await storageRuntime.close();
      })();
      return stopTask;
    }
  };
}
