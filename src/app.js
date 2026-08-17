import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { normalizeWhatsAppWebhook, validateMetaSignature, verifyWebhookChallenge } from './channels/whatsapp-cloud.js';
import { normalizeLinkedDeviceInbound } from './channels/whatsapp-linked-device.js';
import { serveStaticUi } from './management/static-ui.js';

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

async function readRawBody(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('request_body_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function bearerMatches(req, expectedToken) {
  if (!expectedToken) return false;
  const actual = String(req.headers.authorization ?? '');
  const expected = `Bearer ${expectedToken}`;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createHttpServer({
  verifyToken,
  appSecret,
  tenantStore,
  orchestratorForTenant,
  auditStore,
  claimStore = null,
  readiness = null,
  linkedDeviceIngressToken = null, managementToken = null,
  conversationStore = null,
  managementRouter = null,
  sseBroadcaster = null,
  uiDir = null
}) {
  const claimedMessages = new Set();
  const claims = claimStore ?? {
    async claim(key) {
      if (claimedMessages.has(key)) return false;
      claimedMessages.add(key);
      return true;
    },
    async release(key) { claimedMessages.delete(key); }
  };

  async function processMessage(message, tenant) {
    const claimKey = `${tenant.id}:${message.id}`;
    if (!(await claims.claim(claimKey))) return { processed: 0, duplicates: 1, failures: [] };
    const normalizedMessage = { ...message, tenantId: tenant.id };
    try {
      conversationStore?.recordInbound(normalizedMessage);
      sseBroadcaster?.broadcast('message:inbound', {
        tenantId: tenant.id,
        customerId: normalizedMessage.customerId,
        customerName: normalizedMessage.customerName,
        text: normalizedMessage.text,
        messageId: normalizedMessage.id,
        at: new Date().toISOString()
      });

      if (conversationStore?.isHumanControlled(tenant.id, normalizedMessage.customerId)) {
        const result = { action: 'human', reason: 'human_takeover', model: null, permission: { action: 'human', reason: 'human_takeover' } };
        const at = new Date().toISOString();
        auditStore.append({
          id: crypto.randomUUID(),
          tenantId: tenant.id,
          messageId: normalizedMessage.id,
          customerId: normalizedMessage.customerId,
          channel: normalizedMessage.channel,
          at,
          model: null,
          permission: result.permission,
          result: { action: 'human', reason: 'human_takeover', wouldAction: null }
        });
        conversationStore?.recordDecision(normalizedMessage, result, at);
        sseBroadcaster?.broadcast('message:decision', {
          tenantId: tenant.id,
          customerId: normalizedMessage.customerId,
          customerName: normalizedMessage.customerName,
          messageId: normalizedMessage.id,
          result,
          at
        });
        return { processed: 1, duplicates: 0, failures: [] };
      }

      const result = await orchestratorForTenant(tenant).handle(normalizedMessage, tenant);
      conversationStore?.recordDecision(normalizedMessage, result);
      sseBroadcaster?.broadcast('message:decision', {
        tenantId: tenant.id,
        customerId: normalizedMessage.customerId,
        customerName: normalizedMessage.customerName,
        messageId: normalizedMessage.id,
        result,
        at: new Date().toISOString()
      });
      return { processed: 1, duplicates: 0, failures: [] };
    } catch (error) {
      await claims.release(claimKey);
      return {
        processed: 0,
        duplicates: 0,
        failures: [{ messageId: message.id, error: 'processing_failed' }]
      };
    }
  }

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');

      if (managementRouter && url.pathname.startsWith('/api/management/')) {
        return await managementRouter(req, res, url);
      }

      if (req.method === 'GET' && url.pathname === '/health') {
        return sendJson(res, 200, { status: 'ok', service: 'whatsapp-ai-supervisor' });
      }

      if (req.method === 'GET' && url.pathname === '/ready') {
        if (!readiness) return sendJson(res, 200, { ready: true, status: 'ready' });
        const report = await readiness();
        return sendJson(res, report.ready ? 200 : 503, report);
      }

      if (req.method === 'GET' && url.pathname === '/webhooks/whatsapp') {
        const query = Object.fromEntries(url.searchParams.entries());
        const challenge = verifyWebhookChallenge(query, verifyToken);
        if (challenge === null) return sendJson(res, 403, { error: 'webhook_verification_failed' });
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end(challenge);
      }

      if (req.method === 'POST' && url.pathname === '/webhooks/whatsapp') {
        const raw = await readRawBody(req);
        if (appSecret) {
          const signature = req.headers['x-hub-signature-256'];
          if (!validateMetaSignature(raw, signature, appSecret)) {
            return sendJson(res, 401, { error: 'invalid_webhook_signature' });
          }
        }
        const payload = JSON.parse(raw.toString('utf8') || '{}');
        const inbound = normalizeWhatsAppWebhook(payload);
        let processed = 0;
        let duplicates = 0;
        const failures = [];
        for (const message of inbound) {
          const tenant = tenantStore.findByPhoneNumberId(message.phoneNumberId);
          if (!tenant) {
            failures.push({ messageId: message.id, error: 'unknown_phone_number_id' });
            continue;
          }
          const result = await processMessage(message, tenant);
          processed += result.processed;
          duplicates += result.duplicates;
          failures.push(...result.failures);
        }
        return sendJson(res, 200, { received: inbound.length, processed, duplicates, failures });
      }

      if (req.method === 'POST' && url.pathname === '/internal/transports/linked-device/message') {
        if (!linkedDeviceIngressToken) return sendJson(res, 404, { error: 'not_found' });
        if (!bearerMatches(req, linkedDeviceIngressToken)) return sendJson(res, 401, { error: 'unauthorized' });

        const raw = await readRawBody(req, 256_000);
        const payload = JSON.parse(raw.toString('utf8') || '{}');
        const sessionId = String(payload?.sessionId ?? '').trim();
        if (!sessionId) return sendJson(res, 400, { error: 'session_id_required' });
        const tenant = tenantStore.findByLinkedDeviceSessionId?.(sessionId);
        if (!tenant) return sendJson(res, 404, { error: 'linked_device_session_not_found' });

        const message = normalizeLinkedDeviceInbound(payload, { allowGroups: tenant.whatsapp?.allowGroups === true });
        if (!message) return sendJson(res, 202, { ignored: true });
        const result = await processMessage(message, tenant);
        return sendJson(res, 200, { received: 1, ...result });
      }

      if (req.method === 'POST' && url.pathname === '/v1/simulate') { if (managementToken && !bearerMatches(req, managementToken)) return sendJson(res, 401, { error: 'unauthorized' });
        const raw = await readRawBody(req);
        const body = JSON.parse(raw.toString('utf8') || '{}');
        const tenant = tenantStore.findById(body.tenantId);
        if (!tenant) return sendJson(res, 404, { error: 'tenant_not_found' });
        if (typeof body.text !== 'string' || !body.text.trim()) return sendJson(res, 400, { error: 'text_required' });
        const dryRunTenant = { ...tenant, shadowMode: true };
        const message = {
          id: `sim-${crypto.randomUUID()}`,
          tenantId: tenant.id,
          channel: 'whatsapp',
          phoneNumberId: tenant.phoneNumberId,
          customerId: body.customerId ?? 'simulated-user',
          customerName: body.customerName ?? 'Simulation',
          text: body.text,
          timestamp: Math.floor(Date.now() / 1000)
        };
        const result = await orchestratorForTenant(dryRunTenant).handle(message, dryRunTenant);
        return sendJson(res, 200, { dryRun: true, result });
      }

      if (req.method === 'GET' && url.pathname === '/v1/audit') { if (managementToken && !bearerMatches(req, managementToken)) return sendJson(res, 401, { error: 'unauthorized' });
        const tenantId = url.searchParams.get('tenantId');
        if (!tenantId) return sendJson(res, 400, { error: 'tenantId_required' });
        return sendJson(res, 200, { events: auditStore.list(tenantId) });
      }

      if (serveStaticUi(req, res, { uiDir })) return;
      return sendJson(res, 404, { error: 'not_found' });
    } catch (error) {
      if (error instanceof SyntaxError) return sendJson(res, 400, { error: 'invalid_json' });
      if (error instanceof Error && error.message === 'request_body_too_large') return sendJson(res, 413, { error: error.message });
      if (error instanceof Error && error.message.startsWith('invalid_linked_device')) return sendJson(res, 400, { error: error.message });
      return sendJson(res, 500, { error: 'internal_error' });
    }
  });
}
