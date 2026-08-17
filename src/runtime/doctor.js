import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';

const execFileAsync = promisify(execFile);

async function defaultCommandProbe(command, args = []) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout: 5_000, windowsHide: true });
    return { ok: true, detail: String(stdout || stderr || 'available').trim().slice(0, 200) || 'available' };
  } catch (error) {
    return { ok: false, detail: error?.code === 'ENOENT' ? 'command not found' : String(error?.message ?? error).slice(0, 200) };
  }
}

function add(checks, name, status, detail) {
  checks.push({ name, status, detail });
}

function nodeMajor(version) {
  return Number(String(version).split('.')[0]);
}

function transportMode(tenant) {
  return String(tenant?.whatsapp?.mode ?? 'cloud').toLowerCase();
}

function requiredTenantEnvNames(tenants) {
  const names = new Set();
  for (const tenant of tenants) {
    const meta = tenant?.whatsapp?.accessTokenEnv;
    const worker = tenant?.whatsapp?.workerTokenEnv;
    const ai = tenant?.ai?.apiKeyEnv;
    if (meta) names.add(meta);
    if (worker) names.add(worker);
    if (ai) names.add(ai);
  }
  return [...names];
}

export async function runDoctor({
  cwd = process.cwd(),
  env = process.env,
  nodeVersion = process.versions.node,
  commandProbe = defaultCommandProbe
} = {}) {
  const checks = [];
  const major = nodeMajor(nodeVersion);
  add(checks, 'node', major >= 22 ? 'ok' : 'fail', `Node ${nodeVersion}; requires >=22`);

  try {
    await access(join(cwd, '.env'), constants.R_OK);
    add(checks, 'env-file', 'ok', '.env readable');
  } catch {
    add(checks, 'env-file', 'warn', '.env not found; environment variables may still be provided by the host');
  }

  let tenants = null;
  const tenantsFile = resolve(cwd, env.TENANTS_FILE ?? 'config/tenants.json');
  try {
    const parsed = JSON.parse(await readFile(tenantsFile, 'utf8'));
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('must be a non-empty JSON array');
    tenants = parsed;
    add(checks, 'tenant-config', 'ok', `${parsed.length} tenant(s) loaded`);
  } catch (error) {
    add(checks, 'tenant-config', 'fail', `Cannot load ${tenantsFile}: ${error?.message ?? error}`);
  }

  const dataDir = resolve(cwd, env.DATA_DIR ?? 'data');
  try {
    await access(dataDir, constants.R_OK | constants.W_OK);
    add(checks, 'data-dir', 'ok', `${dataDir} is readable and writable`);
  } catch {
    add(checks, 'data-dir', 'fail', `${dataDir} is missing or not writable; run 'was init' or mount a writable volume`);
  }

  if (tenants) {
    const cloudTenants = tenants.filter((tenant) => transportMode(tenant) === 'cloud');
    if (cloudTenants.length) {
      const globalNames = ['META_WEBHOOK_VERIFY_TOKEN', 'META_APP_SECRET', 'META_GRAPH_VERSION'];
      const missingGlobal = globalNames.filter((name) => !env[name]);
      add(
        checks,
        'meta-secrets',
        missingGlobal.length ? 'fail' : 'ok',
        missingGlobal.length ? `Missing: ${missingGlobal.join(', ')}` : 'Meta webhook configuration present'
      );
    } else {
      add(checks, 'meta-secrets', 'ok', 'Meta Cloud API secrets not required for linked-device-only configuration');
    }

    const linkedTenants = tenants.filter((tenant) => transportMode(tenant) === 'linked-device');
    if (linkedTenants.length) {
      const problems = [];
      if (!env.LINKED_DEVICE_INGRESS_TOKEN) problems.push('LINKED_DEVICE_INGRESS_TOKEN missing');
      for (const tenant of linkedTenants) {
        if (!String(tenant?.whatsapp?.sessionId ?? '').trim()) problems.push(`${tenant?.id ?? 'tenant'} missing sessionId`);
        try {
          const url = new URL(tenant?.whatsapp?.workerUrl ?? '');
          if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid protocol');
        } catch {
          problems.push(`${tenant?.id ?? 'tenant'} has invalid workerUrl`);
        }
        if (!tenant?.whatsapp?.workerTokenEnv) problems.push(`${tenant?.id ?? 'tenant'} missing workerTokenEnv`);
      }
      add(
        checks,
        'linked-device',
        problems.length ? 'fail' : 'ok',
        problems.length ? problems.join('; ') : `${linkedTenants.length} linked-device tenant session(s) configured`
      );
    } else {
      add(checks, 'linked-device', 'ok', 'linked-device transport not configured');
    }

    const tenantEnvNames = requiredTenantEnvNames(tenants);
    const missingTenant = tenantEnvNames.filter((name) => !env[name]);
    add(
      checks,
      'tenant-secrets',
      missingTenant.length ? 'fail' : 'ok',
      missingTenant.length ? `Missing: ${missingTenant.join(', ')}` : `${tenantEnvNames.length} referenced tenant secret(s) present`
    );
  }

  const browserMode = String(env.BROWSER_RUNTIME ?? 'none').toLowerCase();
  if (browserMode === 'none' || browserMode === 'disabled') {
    add(checks, 'browser', 'ok', 'browser runtime disabled');
  } else if (browserMode === 'agent-browser') {
    const command = env.BROWSER_COMMAND ?? 'agent-browser';
    const probe = await commandProbe(command, ['--version']);
    add(checks, 'browser', probe.ok ? 'ok' : 'fail', `agent-browser: ${probe.detail}`);
  } else if (browserMode === 'remote') {
    try {
      const url = new URL(env.BROWSER_WORKER_URL ?? '');
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('must use http or https');
      add(checks, 'browser', 'ok', `remote browser worker configured at ${url.origin}`);
      add(
        checks,
        'browser-auth',
        env.BROWSER_WORKER_TOKEN ? 'ok' : 'warn',
        env.BROWSER_WORKER_TOKEN
          ? 'remote browser worker bearer token configured'
          : 'No BROWSER_WORKER_TOKEN configured; only use this on a trusted private network'
      );
    } catch (error) {
      add(checks, 'browser', 'fail', `Invalid BROWSER_WORKER_URL: ${error?.message ?? error}`);
    }
  } else {
    add(checks, 'browser', 'fail', `Unsupported BROWSER_RUNTIME: ${browserMode}`);
  }

  return {
    ok: !checks.some((check) => check.status === 'fail'),
    checks
  };
}
