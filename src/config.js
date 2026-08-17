import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function loadConfig() {
  const tenantsFile = resolve(process.env.TENANTS_FILE ?? './config/tenants.json');
  if (!existsSync(tenantsFile)) {
    throw new Error(`Tenant configuration file not found: ${tenantsFile}. Copy config/tenants.example.json to config/tenants.json.`);
  }
  const tenants = JSON.parse(readFileSync(tenantsFile, 'utf8'));
  if (!Array.isArray(tenants) || tenants.length === 0) throw new Error('Tenant configuration must be a non-empty JSON array');

  return {
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? '0.0.0.0',
    meta: {
      verifyToken: requiredEnv('META_WEBHOOK_VERIFY_TOKEN'),
      appSecret: requiredEnv('META_APP_SECRET'),
      graphVersion: requiredEnv('META_GRAPH_VERSION')
    },
    tenants
  };
}

export function resolveTenantSecret(tenant, envField, fallbackEnvName = null) {
  const envName = tenant?.[envField] ?? fallbackEnvName;
  if (!envName) throw new Error(`No environment variable reference configured for ${envField}`);
  return requiredEnv(envName);
}
