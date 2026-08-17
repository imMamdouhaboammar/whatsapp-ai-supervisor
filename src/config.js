import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { whatsappTransportMode } from './channels/whatsapp-linked-device.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

function envFlag(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function envNumber(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric environment variable: ${name}`);
  return parsed;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function validateWorkerUrl(value, tenantId) {
  if (!value) throw new Error(`Linked-device tenant ${tenantId} requires whatsapp.workerUrl`);
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Linked-device tenant ${tenantId} workerUrl must use http or https`);
  }
}

function validateTenants(tenants) {
  for (const tenant of tenants) {
    if (!tenant?.id) throw new Error('Tenant id is required');
    const mode = whatsappTransportMode(tenant);
    if (!['cloud', 'linked-device'].includes(mode)) {
      throw new Error(`Unsupported WhatsApp transport mode for ${tenant.id}: ${mode}`);
    }
    if (mode === 'cloud') {
      if (!tenant.phoneNumberId) throw new Error(`Cloud tenant ${tenant.id} requires phoneNumberId`);
      continue;
    }
    if (!String(tenant.whatsapp?.sessionId ?? '').trim()) {
      throw new Error(`Linked-device tenant ${tenant.id} requires whatsapp.sessionId`);
    }
    validateWorkerUrl(tenant.whatsapp?.workerUrl, tenant.id);
    if (!tenant.whatsapp?.workerTokenEnv) {
      throw new Error(`Linked-device tenant ${tenant.id} requires whatsapp.workerTokenEnv`);
    }
  }
}

export function loadConfig() {
  const tenantsFile = resolve(process.env.TENANTS_FILE ?? './config/tenants.json');
  if (!existsSync(tenantsFile)) {
    throw new Error(`Tenant configuration file not found: ${tenantsFile}. Copy config/tenants.example.json to config/tenants.json.`);
  }

  const tenants = JSON.parse(readFileSync(tenantsFile, 'utf8'));
  if (!Array.isArray(tenants) || tenants.length === 0) {
    throw new Error('Tenant configuration must be a non-empty JSON array');
  }
  validateTenants(tenants);

  const hasCloudTenants = tenants.some((tenant) => whatsappTransportMode(tenant) === 'cloud');
  const hasLinkedDeviceTenants = tenants.some((tenant) => whatsappTransportMode(tenant) === 'linked-device');
  const meta = hasCloudTenants
    ? {
        enabled: true,
        verifyToken: requiredEnv('META_WEBHOOK_VERIFY_TOKEN'),
        appSecret: requiredEnv('META_APP_SECRET'),
        graphVersion: requiredEnv('META_GRAPH_VERSION')
      }
    : {
        enabled: false,
        verifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN ?? null,
        appSecret: process.env.META_APP_SECRET ?? null,
        graphVersion: process.env.META_GRAPH_VERSION ?? null
      };

  const host = process.env.HOST ?? '127.0.0.1';
  const managementToken = process.env.MANAGEMENT_TOKEN || null;
  if (!LOOPBACK_HOSTS.has(host) && !managementToken) {
    throw new Error('MANAGEMENT_TOKEN is required for external host binding');
  }

  return {
    port: Number(process.env.PORT ?? 3000),
    host,
    dataDir: resolve(process.env.DATA_DIR ?? './data'),
    uiDir: resolve(process.env.UI_DIR ?? './ui/dist'),
    management: { token: managementToken },
    meta,
    linkedDevice: {
      enabled: hasLinkedDeviceTenants,
      ingressToken: hasLinkedDeviceTenants
        ? requiredEnv('LINKED_DEVICE_INGRESS_TOKEN')
        : (process.env.LINKED_DEVICE_INGRESS_TOKEN ?? null),
      workerUrlOverride: process.env.LINKED_DEVICE_WORKER_URL_OVERRIDE || null
    },
    browser: {
      mode: process.env.BROWSER_RUNTIME ?? 'none',
      command: process.env.BROWSER_COMMAND ?? 'agent-browser',
      engine: process.env.BROWSER_ENGINE ?? 'chrome',
      workerUrl: process.env.BROWSER_WORKER_URL ?? null,
      workerToken: process.env.BROWSER_WORKER_TOKEN || null,
      required: envFlag('BROWSER_REQUIRED', false),
      taskTimeoutMs: envNumber('BROWSER_TASK_TIMEOUT_MS', 60_000)
    },
    tenants
  };
}

export function resolveTenantSecret(tenant, envField, fallbackEnvName = null) {
  const envName = tenant?.[envField] ?? fallbackEnvName;
  if (!envName) throw new Error(`No environment variable reference configured for ${envField}`);
  return requiredEnv(envName);
}
