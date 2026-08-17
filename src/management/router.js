import { timingSafeEqual } from 'node:crypto';
import { buildActions, buildOverview, recentAuditEvents, sanitizeTenant } from './dashboard.js';

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store'
  });
  res.end(payload);
}

async function readJson(req, limit = 128_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('request_body_too_large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function authorized(req, token) {
  if (!token) return true;
  const actual = Buffer.from(String(req.headers.authorization ?? ''));
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function requireTenant(tenantStore, tenantId) {
  const tenant = tenantStore.findById(tenantId);
  if (!tenant) throw Object.assign(new Error('tenant_not_found'), { statusCode: 404 });
  return tenant;
}

export function createManagementRouter({
  token = null,
  tenantStore,
  auditStore,
  conversationStore,
  readiness,
  linkedDeviceStatus,
  manualSend,
  runtimeSummary = () => ({})
}) {
  return async function handleManagementRequest(req, res, url) {
    if (!url.pathname.startsWith('/api/management/')) return false;

    if (req.method === 'GET' && url.pathname === '/api/management/session') {
      if (!authorized(req, token)) return sendJson(res, 401, { authenticated: false, authRequired: true });
      return sendJson(res, 200, { authenticated: true, authRequired: Boolean(token) });
    }

    if (!authorized(req, token)) return sendJson(res, 401, { error: 'management_unauthorized' });

    try {
      if (req.method === 'GET' && url.pathname === '/api/management/tenants') {
        return sendJson(res, 200, { tenants: tenantStore.list().map(sanitizeTenant) });
      }

      if (req.method === 'GET' && url.pathname === '/api/management/whatsapp') {
        return sendJson(res, 200, { sessions: await linkedDeviceStatus() });
      }

      if (req.method === 'GET' && url.pathname === '/api/management/overview') {
        const [readinessReport, whatsappSessions] = await Promise.all([readiness(), linkedDeviceStatus()]);
        return sendJson(res, 200, buildOverview({ tenantStore, auditStore, conversationStore, readinessReport, whatsappSessions }));
      }

      if (req.method === 'GET' && url.pathname === '/api/management/conversations') {
        const tenantId = url.searchParams.get('tenantId');
        if (!tenantId) return sendJson(res, 400, { error: 'tenantId_required' });
        requireTenant(tenantStore, tenantId);
        return sendJson(res, 200, { conversations: conversationStore.list(tenantId) });
      }

      if (req.method === 'POST' && url.pathname === '/api/management/conversations/control') {
        const body = await readJson(req);
        const tenantId = String(body.tenantId ?? '').trim();
        const customerId = String(body.customerId ?? '').trim();
        const mode = String(body.mode ?? '').trim();
        if (!tenantId || !customerId || !['ai', 'human'].includes(mode)) {
          return sendJson(res, 400, { error: 'invalid_conversation_control' });
        }
        requireTenant(tenantStore, tenantId);
        conversationStore.setControl(tenantId, customerId, mode);
        return sendJson(res, 200, { tenantId, customerId, mode });
      }

      if (req.method === 'POST' && url.pathname === '/api/management/conversations/send') {
        const body = await readJson(req);
        const tenantId = String(body.tenantId ?? '').trim();
        const customerId = String(body.customerId ?? '').trim();
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (!tenantId || !customerId || !text) return sendJson(res, 400, { error: 'invalid_manual_send' });
        const tenant = requireTenant(tenantStore, tenantId);
        if (!conversationStore.isHumanControlled(tenantId, customerId)) {
          return sendJson(res, 409, { error: 'human_takeover_required' });
        }
        const outbound = await manualSend(tenant, { to: customerId, text });
        conversationStore.recordManualOutbound({
          tenantId,
          customerId,
          text,
          messageId: outbound?.messages?.[0]?.id ?? outbound?.id ?? null
        });
        return sendJson(res, 200, { sent: true, outbound });
      }

      if (req.method === 'GET' && url.pathname === '/api/management/audit') {
        const tenantId = url.searchParams.get('tenantId');
        if (tenantId) requireTenant(tenantStore, tenantId);
        const limit = Number(url.searchParams.get('limit') ?? 200);
        return sendJson(res, 200, { events: recentAuditEvents(tenantStore, auditStore, tenantId, limit) });
      }

      if (req.method === 'GET' && url.pathname === '/api/management/actions') {
        const tenantId = url.searchParams.get('tenantId');
        if (tenantId) requireTenant(tenantStore, tenantId);
        const events = recentAuditEvents(tenantStore, auditStore, tenantId, 500);
        return sendJson(res, 200, { actions: buildActions(events) });
      }

      if (req.method === 'GET' && url.pathname === '/api/management/runtime') {
        return sendJson(res, 200, {
          ...runtimeSummary(),
          readiness: await readiness(),
          managementAuth: Boolean(token)
        });
      }

      return sendJson(res, 404, { error: 'not_found' });
    } catch (error) {
      if (error instanceof SyntaxError) return sendJson(res, 400, { error: 'invalid_json' });
      if (error?.message === 'request_body_too_large') return sendJson(res, 413, { error: error.message });
      if (error?.message === 'invalid_conversation_control_mode') return sendJson(res, 400, { error: error.message });
      return sendJson(res, error?.statusCode ?? 500, {
        error: error?.statusCode ? error.message : 'management_internal_error',
        detail: error?.statusCode ? undefined : String(error?.message ?? error)
      });
    }
  };
}
