import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

function tenantFileName(tenantId) {
  const safe = String(tenantId).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'tenant';
  const suffix = createHash('sha256').update(String(tenantId)).digest('hex').slice(0, 12);
  return `${safe}-${suffix}.ndjson`;
}

export class FileAuditStore {
  constructor({ dataDir }) {
    if (!dataDir) throw new Error('FileAuditStore dataDir is required');
    this.auditDir = join(dataDir, 'audit');
    mkdirSync(this.auditDir, { recursive: true });
  }

  fileForTenant(tenantId) {
    return join(this.auditDir, tenantFileName(tenantId));
  }

  append(event) {
    if (!event?.tenantId) throw new Error('Audit event tenantId is required');
    const frozen = Object.freeze({ ...event });
    appendFileSync(this.fileForTenant(event.tenantId), `${JSON.stringify(frozen)}\n`, { encoding: 'utf8', mode: 0o600 });
    return frozen;
  }

  list(tenantId) {
    try {
      const text = readFileSync(this.fileForTenant(tenantId), 'utf8');
      const events = [];
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event?.tenantId === tenantId) events.push(event);
        } catch {
          // A damaged line should not make the complete audit history unreadable.
        }
      }
      return events;
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }
}
