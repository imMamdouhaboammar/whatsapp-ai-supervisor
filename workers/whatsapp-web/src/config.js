import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function required(env, name) {
  const value = env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function loadWorkerConfig({ cwd = process.cwd(), env = process.env } = {}) {
  const tenantsFile = resolve(cwd, env.TENANTS_FILE ?? './config/tenants.json');
  const tenants = JSON.parse(readFileSync(tenantsFile, 'utf8'));
  if (!Array.isArray(tenants)) throw new Error('Tenant configuration must be an array');
  const sessions = tenants
    .filter((tenant) => String(tenant?.whatsapp?.mode ?? 'cloud').toLowerCase() === 'linked-device')
    .map((tenant) => ({
      tenantId: tenant.id,
      sessionId: String(tenant.whatsapp.sessionId ?? '').trim(),
      allowGroups: tenant.whatsapp.allowGroups === true,
      pairingPhoneNumber: tenant.whatsapp.pairingPhoneNumber ? String(tenant.whatsapp.pairingPhoneNumber) : null
    }));
  if (sessions.length === 0) throw new Error('No linked-device tenant sessions configured');
  for (const session of sessions) {
    if (!/^[-_a-z0-9]+$/i.test(session.sessionId)) throw new Error(`Invalid linked-device sessionId: ${session.sessionId}`);
  }

  const port = Number(env.WHATSAPP_WEB_WORKER_PORT ?? 7441);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('WHATSAPP_WEB_WORKER_PORT must be an integer between 1 and 65535');

  return {
    host: env.WHATSAPP_WEB_WORKER_HOST ?? '127.0.0.1',
    port,
    dataDir: resolve(cwd, env.WHATSAPP_WEB_DATA_DIR ?? './data/whatsapp-web'),
    authToken: required(env, 'WHATSAPP_LINKED_DEVICE_WORKER_TOKEN'),
    supervisorUrl: required(env, 'SUPERVISOR_INTERNAL_URL'),
    supervisorIngressToken: required(env, 'LINKED_DEVICE_INGRESS_TOKEN'),
    spoolFlushIntervalMs: Number(env.WHATSAPP_WEB_SPOOL_FLUSH_MS ?? 5_000),
    minSendIntervalMs: Number(env.WHATSAPP_WEB_MIN_SEND_INTERVAL_MS ?? 350),
    maxSendQueue: Number(env.WHATSAPP_WEB_MAX_SEND_QUEUE ?? 100),
    sessions
  };
}
