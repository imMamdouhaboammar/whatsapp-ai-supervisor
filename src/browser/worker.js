import { createBrowserRuntime } from './runtime-factory.js';
import { createBrowserWorkerServer } from './worker-app.js';

const host = process.env.BROWSER_WORKER_HOST ?? '127.0.0.1';
const port = Number(process.env.BROWSER_WORKER_PORT ?? 7331);
const mode = process.env.BROWSER_WORKER_RUNTIME ?? 'agent-browser';
const authToken = process.env.BROWSER_WORKER_TOKEN || null;
const maxConcurrency = Number(process.env.BROWSER_WORKER_MAX_CONCURRENCY ?? 2);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('BROWSER_WORKER_PORT must be an integer between 1 and 65535');
}
if (mode === 'remote') throw new Error('Browser worker cannot use remote mode recursively');
if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 64) {
  throw new Error('BROWSER_WORKER_MAX_CONCURRENCY must be an integer between 1 and 64');
}

const runtime = createBrowserRuntime({
  mode,
  command: process.env.BROWSER_COMMAND ?? 'agent-browser',
  engine: process.env.BROWSER_ENGINE ?? 'chrome'
});
if (!runtime) throw new Error('Browser worker runtime cannot be disabled');

const server = createBrowserWorkerServer({ runtime, authToken, maxConcurrency });
server.listen(port, host, () => {
  console.log(`whatsapp-ai-supervisor browser worker listening on http://${host}:${port}`);
});
