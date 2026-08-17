import { mkdir, open, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export class FileClaimStore {
  constructor({ dataDir, now = () => new Date().toISOString() }) {
    if (!dataDir) throw new Error('FileClaimStore dataDir is required');
    this.claimDir = join(dataDir, 'claims');
    this.now = now;
  }

  fileForKey(key) {
    const digest = createHash('sha256').update(String(key)).digest('hex');
    return join(this.claimDir, `${digest}.json`);
  }

  async claim(key) {
    await mkdir(this.claimDir, { recursive: true });
    const file = this.fileForKey(key);
    let handle;
    try {
      handle = await open(file, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ key: String(key), claimedAt: this.now() }), 'utf8');
      return true;
    } catch (error) {
      if (error?.code === 'EEXIST') return false;
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async release(key) {
    try {
      await unlink(this.fileForKey(key));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}
