import { createServer } from 'node:http';
import { normalizeWhatsAppWebhook, validateMetaSignature, verifyWebhookChallenge } from './channels/whatsapp-cloud.js';

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

export function createHttpServer({ verifyToken, appSecret, tenantStore, orchestratorForTenant, auditStore }) {
  const claimedMessages = new Set();
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');

      if (req.method === 'GET' && url.pathname === '/health') {
        return sendJson(res, 200, { status: 'ok', service: 'whatsapp-ai-supervisor' });
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
          const claimKey = `${tenant.id}:${message.id}`;
          if (claimedMessages.has(claimKey)) {
            duplicates += 1;
            continue;
          }
          claimedMessages.add(claimKey);
          try {
            await orchestratorForTenant(tenant).handle({ ...message, tenantId: tenant.id }, tenant);
            processed += 1;
          } catch (error) {
            claimedMessages.delete(claimKey);
            failures.push({ messageId: message.id, error: error instanceof Error ? error.message : String(error) });
          }
        }
        return sendJson(res, 200, { received: inbound.length, processed, duplicates, failures });
      }

      if (req.method === 'POST' && url.pathname === '/v1/simulate') {
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

      if (req.method === 'GET' && url.pathname === '/v1/audit') {
        const tenantId = url.searchParams.get('tenantId');
        if (!tenantId) return sendJson(res, 400, { error: 'tenantId_required' });
        return sendJson(res, 200, { events: auditStore.list(tenantId) });
      }

      return sendJson(res, 404, { error: 'not_found' });
    } catch (error) {
      if (error instanceof SyntaxError) return sendJson(res, 400, { error: 'invalid_json' });
      if (error instanceof Error && error.message === 'request_body_too_large') return sendJson(res, 413, { error: error.message });
      return sendJson(res, 500, { error: 'internal_error', detail: error instanceof Error ? error.message : String(error) });
    }
  });
}
