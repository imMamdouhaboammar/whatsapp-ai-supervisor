import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { validateBrowserTask } from './browser-runtime.js';

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

async function readRawBody(req, limit = 256_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('request_body_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function statusForRuntimeError(error) {
  const message = String(error?.message ?? error);
  if (message === 'browser_task_timeout') return 504;
  if (message.startsWith('browser_runtime_unavailable')) return 503;
  if (message.startsWith('browser_task_failed')) return 502;
  return 500;
}

function tokenMatches(req, authToken) {
  if (!authToken) return true;
  const header = req.headers.authorization ?? '';
  const expected = `Bearer ${authToken}`;
  const actualBuffer = Buffer.from(header);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export function createBrowserWorkerServer({ runtime, authToken = null, maxConcurrency = 2 }) {
  if (!runtime) throw new Error('browser_worker_runtime_required');
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 64) {
    throw new Error('browser_worker_max_concurrency_invalid');
  }
  let activeTasks = 0;

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');

      if (!tokenMatches(req, authToken)) {
        return sendJson(res, 401, { error: 'unauthorized' });
      }

      if (req.method === 'GET' && url.pathname === '/health') {
        const probe = await runtime.probe();
        return sendJson(res, probe.available ? 200 : 503, {
          status: probe.available ? 'ok' : 'unavailable',
          backend: probe.backend ?? 'unknown',
          detail: probe.detail ?? null
        });
      }

      if (req.method === 'POST' && url.pathname === '/v1/browser/task') {
        if (activeTasks >= maxConcurrency) {
          return sendJson(res, 429, { error: 'browser_worker_busy' });
        }
        const raw = await readRawBody(req);
        const body = JSON.parse(raw.toString('utf8') || '{}');
        const task = validateBrowserTask(body);
        activeTasks += 1;
        try {
          const result = await runtime.runTask(task);
          return sendJson(res, 200, result);
        } catch (error) {
          return sendJson(res, statusForRuntimeError(error), { error: String(error?.message ?? error) });
        } finally {
          activeTasks -= 1;
        }
      }

      return sendJson(res, 404, { error: 'not_found' });
    } catch (error) {
      if (error instanceof SyntaxError) return sendJson(res, 400, { error: 'invalid_json' });
      if (error instanceof Error && error.message === 'request_body_too_large') return sendJson(res, 413, { error: error.message });
      if (error instanceof Error && (error.message.startsWith('browser_') || error.message.startsWith('Invalid allowed domain'))) {
        return sendJson(res, 400, { error: error.message });
      }
      return sendJson(res, 500, { error: 'internal_error' });
    }
  });
}
