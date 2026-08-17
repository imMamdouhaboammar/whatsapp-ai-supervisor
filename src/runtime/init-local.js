import { constants } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

async function copyIfMissing(source, target, label, created, skipped) {
  try {
    await copyFile(source, target, constants.COPYFILE_EXCL);
    created.push(label);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      skipped.push(label);
      return;
    }
    if (error?.code === 'ENOENT') {
      throw new Error(`Template not found: ${source}`);
    }
    throw error;
  }
}

export async function initializeLocalWorkspace({ cwd = process.cwd() } = {}) {
  const created = [];
  const skipped = [];

  await mkdir(join(cwd, 'config'), { recursive: true });
  await copyIfMissing(join(cwd, '.env.example'), join(cwd, '.env'), '.env', created, skipped);
  await copyIfMissing(
    join(cwd, 'config', 'tenants.example.json'),
    join(cwd, 'config', 'tenants.json'),
    'config/tenants.json',
    created,
    skipped
  );

  for (const relative of ['data/audit', 'data/claims', 'data/browser', 'data/whatsapp-web/auth', 'data/whatsapp-web/spool']) {
    await mkdir(join(cwd, relative), { recursive: true });
    created.push(relative);
  }

  return { created, skipped };
}
