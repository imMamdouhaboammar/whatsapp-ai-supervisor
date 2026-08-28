import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';

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

function authorized(req, authToken) {
  if (!authToken) return true;
  const actual = Buffer.from(String(req.headers.authorization ?? ''));
  const expected = Buffer.from(`Bearer ${authToken}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function operationIdFor(value) {
  const operationId = String(value ?? '').trim() || randomUUID();
  if (operationId.length > 200) throw new Error('invalid_send_payload');
  return operationId;
}

function statusForError(error) {
  const message = String(error?.message ?? error);
  if (message === 'session_not_ready') return 409;
  if (message === 'session_not_found') return 404;
  if (message === 'invalid_send_payload') return 400;
  if (message === 'send_queue_full') return 429;
  return 500;
}

export function createWhatsAppWebWorkerServer({ manager, authToken = null }) {
  if (!manager) throw new Error('session_manager_required');

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!authorized(req, authToken)) return sendJson(res, 401, { error: 'unauthorized' });

      if (req.method === 'GET' && url.pathname === '/health') {
        const sessions = manager.listSessions();
        const readySessions = sessions.filter((session) => session.status === 'ready').length;
        const status = sessions.length === 0 ? 'idle' : readySessions === sessions.length ? 'ready' : 'degraded';
        return sendJson(res, 200, { status, sessions: sessions.length, readySessions });
      }

      if (req.method === 'GET' && url.pathname === '/v1/sessions') {
        return sendJson(res, 200, { sessions: manager.listSessions() });
      }

      const sessionMatch = url.pathname.match(/^\/v1\/sessions\/([-_a-zA-Z0-9]+)$/);
      if (req.method === 'GET' && sessionMatch) {
        const session = manager.getSession(sessionMatch[1]);
        if (!session) return sendJson(res, 404, { error: 'session_not_found' });
        return sendJson(res, 200, session);
      }

      if (req.method === 'POST' && url.pathname === '/v1/send-text') {
        const raw = await readRawBody(req);
        const body = JSON.parse(raw.toString('utf8') || '{}');
        const sessionId = String(body.sessionId ?? '').trim();
        const to = String(body.to ?? '').trim();
        const text = typeof body.text === 'string' ? body.text : '';
        if (!sessionId || !to || !text.trim()) return sendJson(res, 400, { error: 'invalid_send_payload' });
        try {
          const operationId = operationIdFor(body.operationId);
          const result = await manager.sendText({
            sessionId,
            to,
            text,
            replyToId: body.replyToId ?? null,
            operationId
          });
          return sendJson(res, 200, { ...result, operationId: result?.operationId ?? operationId });
        } catch (error) {
          return sendJson(res, statusForError(error), { error: String(error?.message ?? error) });
        }
      }

      return sendJson(res, 404, { error: 'not_found' });
    } catch (error) {
      if (error instanceof SyntaxError) return sendJson(res, 400, { error: 'invalid_json' });
      if (error?.message === 'request_body_too_large') return sendJson(res, 413, { error: 'request_body_too_large' });
      return sendJson(res, 500, { error: 'internal_error' });
    }
  });
}
