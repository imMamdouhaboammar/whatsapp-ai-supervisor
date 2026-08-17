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
  const candidate = String(req.headers.authorization ?? '');
  const expectedValue = `Bearer ${token}`;
  const actual = Buffer.from(candidate);
  const expected = Buffer.from(expectedValue);
  if (!candidate.startsWith('Bearer ')) return false;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function requireTenant(tenantStore, tenantId) {
  const tenant = tenantStore.findById(tenantId);
  if (!tenant) throw Object.assign(new Error('tenant_not_found'), { statusCode: 404 });
  return tenant;
}

/** Extract :segment from a pathname pattern like /api/management/tenants/:id */
function matchPath(pathname, pattern) {
  const patParts = pattern.split('/');
  const urlParts = pathname.split('/');
  if (patParts.length !== urlParts.length) return null;
  const params = {};
  for (let i = 0; i < patParts.length; i++) {
    if (patParts[i].startsWith(':')) {
      params[patParts[i].slice(1)] = decodeURIComponent(urlParts[i]);
    } else if (patParts[i] !== urlParts[i]) {
      return null;
    }
  }
  return params;
}

export function createManagementRouter({
  token = null,
  tenantStore,
  auditStore,
  conversationStore,
  readiness,
  linkedDeviceStatus,
  manualSend,
  moderatorEngine = null, sseBroadcaster = null,
  onTenantChanged = () => {},
  runtimeSummary = () => ({})
}) {
  return async function handleManagementRequest(req, res, url) {
    if (!url.pathname.startsWith('/api/management/')) return false;

    if (req.method === 'GET' && url.pathname === '/api/management/session') {
      if (!authorized(req, token, url)) return sendJson(res, 401, { authenticated: false, authRequired: true });
      return sendJson(res, 200, { authenticated: true, authRequired: Boolean(token) });
    }

    if (req.method === 'GET' && url.pathname === '/api/management/events') {
      if (!authorized(req, token, url)) return sendJson(res, 401, { error: 'management_unauthorized' });
      if (!sseBroadcaster) return sendJson(res, 503, { error: 'realtime_unavailable' });
      sseBroadcaster.addClient(res);
      return true;
    }

    if (!authorized(req, token, url)) return sendJson(res, 401, { error: 'management_unauthorized' });

    try {
      // ── tenant list ──────────────────────────────────────────────────────────
      if (req.method === 'GET' && url.pathname === '/api/management/tenants') {
        return sendJson(res, 200, { tenants: tenantStore.list().map(sanitizeTenant) });
      }

      // ── tenant create ────────────────────────────────────────────────────────
      if (req.method === 'POST' && url.pathname === '/api/management/tenants') {
        const body = await readJson(req);
        const tenant = tenantStore.create(body);
        tenantStore.persist(); onTenantChanged(tenant.id);
        return sendJson(res, 201, { tenant: sanitizeTenant(tenant) });
      }

      // ── tenant get by id ─────────────────────────────────────────────────────
      const tenantIdMatch = matchPath(url.pathname, '/api/management/tenants/:id');
      if (tenantIdMatch) {
        const { id } = tenantIdMatch;

        if (req.method === 'GET') {
          const tenant = requireTenant(tenantStore, id);
          return sendJson(res, 200, { tenant: sanitizeTenant(tenant) });
        }

        // ── tenant update ──────────────────────────────────────────────────────
        if (req.method === 'PUT' || req.method === 'PATCH') {
          const body = await readJson(req);
          const tenant = tenantStore.update(id, body);
          tenantStore.persist(); onTenantChanged(id);
          return sendJson(res, 200, { tenant: sanitizeTenant(tenant) });
        }

        // ── tenant delete ──────────────────────────────────────────────────────
        if (req.method === 'DELETE') {
          tenantStore.delete(id);
          tenantStore.persist(); onTenantChanged(id);
          return sendJson(res, 200, { deleted: true, id });
        }
      }

      // ── WhatsApp numbers list + add ──────────────────────────────────────────
      const waNumbersMatch = matchPath(url.pathname, '/api/management/tenants/:id/numbers');
      if (waNumbersMatch) {
        const { id } = waNumbersMatch;

        if (req.method === 'GET') {
          const tenant = requireTenant(tenantStore, id);
          const numbers = Array.isArray(tenant.whatsapp?.numbers)
            ? tenant.whatsapp.numbers
            : tenant.whatsapp?.sessionId
              ? [{ id: 'primary', label: 'Primary', mode: 'linked-device', sessionId: tenant.whatsapp.sessionId, workerUrl: tenant.whatsapp.workerUrl }]
              : tenant.phoneNumberId
                ? [{ id: 'primary', label: 'Primary', mode: 'cloud', phoneNumberId: tenant.phoneNumberId }]
                : [];
          return sendJson(res, 200, { tenantId: id, numbers });
        }

        if (req.method === 'POST') {
          const body = await readJson(req);
          const { tenant, number } = tenantStore.addWhatsAppNumber(id, body);
          tenantStore.persist(); onTenantChanged(id);
          return sendJson(res, 201, { tenant: sanitizeTenant(tenant), number });
        }
      }

      // ── WhatsApp number delete ───────────────────────────────────────────────
      const waNumberMatch = matchPath(url.pathname, '/api/management/tenants/:id/numbers/:numberId');
      if (waNumberMatch) {
        const { id, numberId } = waNumberMatch;
        if (req.method === 'DELETE') {
          const tenant = tenantStore.removeWhatsAppNumber(id, numberId);
          tenantStore.persist(); onTenantChanged(id);
          return sendJson(res, 200, { deleted: true, tenantId: id, numberId, tenant: sanitizeTenant(tenant) });
        }
      }

      // ── existing routes ──────────────────────────────────────────────────────

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

      if (req.method === 'POST' && url.pathname === '/api/management/moderator/trigger') {
        if (!moderatorEngine) return sendJson(res, 503, { error: 'moderator_engine_unavailable' });
        const body = await readJson(req);
        const tenantId = body.tenantId ? String(body.tenantId).trim() : null;
        const dryRun = Boolean(body.dryRun);
        const forceAll = Boolean(body.forceAll);
        const proactiveLimit = Number(body.proactiveLimit) || 10;

        if (tenantId) requireTenant(tenantStore, tenantId);
        const report = await moderatorEngine.moderateAll({ tenantId, dryRun, forceAll, proactiveLimit });
        return sendJson(res, 200, report);
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
      const statusCode = Number(error?.statusCode || error?.status) || 500;
      if (statusCode >= 500) return sendJson(res, 500, { error: 'management_internal_error' });
      return sendJson(res, statusCode, {
        error: error?.message || 'management_request_failed'
      });
    }
  };
}

