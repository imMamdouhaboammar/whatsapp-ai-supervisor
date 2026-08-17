import { access, mkdir, open, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function probeDataDirectory(dataDir) {
  try {
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    await access(dataDir, constants.R_OK | constants.W_OK);
    const probeFile = join(dataDir, `.ready-${randomUUID()}`);
    const handle = await open(probeFile, 'wx', 0o600);
    await handle.writeFile('ok');
    await handle.close();
    await unlink(probeFile);
    return { available: true, detail: 'writable' };
  } catch (error) {
    return { available: false, detail: String(error?.code ?? error?.message ?? error).slice(0, 160) };
  }
}

export async function collectReadiness({
  dataDir = './data',
  tenantCount = 0,
  browserRuntime = null,
  browserRequired = false,
  storageProbe = () => probeDataDirectory(dataDir)
} = {}) {
  const storage = await storageProbe();
  let browser;

  if (!browserRuntime) {
    browser = { status: 'disabled', available: true, required: false };
  } else {
    try {
      const probe = await browserRuntime.probe();
      browser = {
        status: probe.available ? 'ready' : 'unavailable',
        available: Boolean(probe.available),
        required: Boolean(browserRequired),
        backend: probe.backend ?? 'unknown',
        detail: probe.detail ?? null
      };
    } catch (error) {
      browser = {
        status: 'unavailable',
        available: false,
        required: Boolean(browserRequired),
        backend: 'unknown',
        detail: String(error?.message ?? error).slice(0, 160)
      };
    }
  }

  const ready = Boolean(storage.available) && (!browserRequired || browser.available);
  const degraded = ready && browserRuntime && !browser.available;
  return {
    ready,
    status: ready ? (degraded ? 'degraded' : 'ready') : 'not_ready',
    storage,
    browser,
    tenants: { count: Number(tenantCount) || 0 }
  };
}
