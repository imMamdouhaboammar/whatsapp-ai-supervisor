import { createHash } from 'node:crypto';
import { mkdir, open, readdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('SUPERVISOR_URL must use http or https');
  return url.toString().replace(/\/$/, '');
}

function keyFor(payload) {
  const sessionId = String(payload?.sessionId ?? '').trim();
  const messageId = String(payload?.message?.id ?? '').trim();
  if (!sessionId || !messageId) throw new Error('spool_payload_requires_session_and_message_id');
  return createHash('sha256').update(`${sessionId}:${messageId}`).digest('hex');
}

export class DiskInboundSpool {
  constructor({ dir, supervisorUrl, token, fetchImpl = fetch }) {
    if (!dir) throw new Error('spool_dir_required');
    if (!supervisorUrl) throw new Error('supervisor_url_required');
    if (!token) throw new Error('supervisor_ingress_token_required');
    this.dir = dir;
    this.supervisorUrl = normalizeBaseUrl(supervisorUrl);
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  async enqueue(payload) {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const path = join(this.dir, `${keyFor(payload)}.json`);
    let handle;
    try {
      handle = await open(path, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(payload), 'utf8');
      return true;
    } catch (error) {
      if (error?.code === 'EEXIST') return false;
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async listPending() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const names = (await readdir(this.dir)).filter((name) => name.endsWith('.json')).sort();
    const items = [];
    for (const name of names) {
      const path = join(this.dir, name);
      try {
        items.push({ path, payload: JSON.parse(await readFile(path, 'utf8')) });
      } catch {
        // Corrupt files remain on disk for operator inspection instead of being deleted silently.
      }
    }
    return items;
  }

  async deliver(item) {
    try {
      const response = await this.fetchImpl(`${this.supervisorUrl}/internal/transports/linked-device/message`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.token}`,
          'content-type': 'application/json',
          accept: 'application/json'
        },
        body: JSON.stringify(item.payload),
        signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok) return false;
      await unlink(item.path);
      return true;
    } catch {
      return false;
    }
  }

  async flushOnce() {
    const pending = await this.listPending();
    let delivered = 0;
    let retained = 0;
    for (const item of pending) {
      if (await this.deliver(item)) delivered += 1;
      else retained += 1;
    }
    return { delivered, retained };
  }
}
