import { writeFileSync } from 'node:fs';
import { whatsappTransportMode } from '../channels/whatsapp-linked-device.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function tenantPhoneNumberIds(tenant) {
  if (Array.isArray(tenant.whatsapp?.numbers)) {
    return tenant.whatsapp.numbers.filter((n) => n.mode === 'cloud' && n.phoneNumberId).map((n) => n.phoneNumberId);
  }
  return tenant.phoneNumberId ? [tenant.phoneNumberId] : [];
}

function tenantSessionIds(tenant) {
  if (Array.isArray(tenant.whatsapp?.numbers)) {
    return tenant.whatsapp.numbers.filter((n) => n.mode === 'linked-device' && n.sessionId).map((n) => n.sessionId);
  }
  const mode = whatsappTransportMode(tenant);
  return mode === 'linked-device' && tenant.whatsapp?.sessionId ? [tenant.whatsapp.sessionId] : [];
}

function slugify(name) {
  return String(name ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || `tenant-${Date.now()}`;
}

// ─── store ───────────────────────────────────────────────────────────────────

export class InMemoryTenantStore {
  /**
   * @param {object[]} tenants  Initial tenant list
   * @param {string|null} [tenantsFile]  Absolute path to config/tenants.json for persistence
   */
  constructor(tenants = [], tenantsFile = null) {
    this.byId = new Map();
    this.byPhone = new Map();
    this.byLinkedSession = new Map();
    this.tenantsFile = tenantsFile;
    for (const tenant of tenants) this._index(tenant);
  }

  // ─── private ────────────────────────────────────────────────────────────────

  _deindex(tenant) {
    if (!tenant) return;
    for (const id of tenantPhoneNumberIds(tenant)) this.byPhone.delete(id);
    for (const id of tenantSessionIds(tenant)) this.byLinkedSession.delete(id);
    this.byId.delete(tenant.id);
  }

  _index(tenant) {
    if (!tenant?.id) throw new Error('Tenant id is required');
    this._deindex(this.byId.get(tenant.id));

    for (const phoneId of tenantPhoneNumberIds(tenant)) {
      const owner = this.byPhone.get(phoneId);
      if (owner && owner.id !== tenant.id) throw new Error(`Duplicate WhatsApp phone number id: ${phoneId}`);
      this.byPhone.set(phoneId, tenant);
    }

    for (const sessionId of tenantSessionIds(tenant)) {
      const owner = this.byLinkedSession.get(sessionId);
      if (owner && owner.id !== tenant.id) throw new Error(`Duplicate linked-device session id: ${sessionId}`);
      this.byLinkedSession.set(sessionId, tenant);
    }

    this.byId.set(tenant.id, tenant);
    return tenant;
  }

  /** @deprecated kept for backward compat — use _index */
  upsert(tenant) { return this._index(tenant); }

  // ─── read ────────────────────────────────────────────────────────────────────

  list() { return [...this.byId.values()]; }
  findById(id) { return this.byId.get(id) ?? null; }
  findByPhoneNumberId(phoneNumberId) { return this.byPhone.get(phoneNumberId) ?? null; }
  findByLinkedDeviceSessionId(sessionId) { return this.byLinkedSession.get(sessionId) ?? null; }

  // ─── create / update / delete ────────────────────────────────────────────────

  create(data) {
    const id = String(data?.id ?? slugify(data?.businessContext?.name ?? data?.name ?? '')).trim();
    if (!id) throw Object.assign(new Error('Tenant id is required'), { statusCode: 400 });
    if (this.byId.has(id)) throw Object.assign(new Error(`Tenant id already exists: ${id}`), { statusCode: 409 });
    const tenant = { ...data, id };
    this._index(tenant);
    return tenant;
  }

  update(id, patch) {
    const existing = this.findById(id);
    if (!existing) throw Object.assign(new Error('tenant_not_found'), { statusCode: 404 });
    const updated = {
      ...existing,
      ...patch,
      id: existing.id, // immutable
      whatsapp: patch.whatsapp ? { ...existing.whatsapp, ...patch.whatsapp } : existing.whatsapp,
      ai: patch.ai ? { ...existing.ai, ...patch.ai } : existing.ai,
      businessContext: patch.businessContext ? { ...existing.businessContext, ...patch.businessContext } : existing.businessContext,
      policy: patch.policy ? { ...existing.policy, ...patch.policy } : existing.policy,
    };
    this._index(updated);
    return updated;
  }

  delete(id) {
    const existing = this.findById(id);
    if (!existing) throw Object.assign(new Error('tenant_not_found'), { statusCode: 404 });
    this._deindex(existing);
    return existing;
  }

  // ─── WhatsApp multi-number management ────────────────────────────────────────

  addWhatsAppNumber(tenantId, number) {
    const tenant = this.findById(tenantId);
    if (!tenant) throw Object.assign(new Error('tenant_not_found'), { statusCode: 404 });

    const mode = String(number.mode ?? 'linked-device');
    if (!['cloud', 'linked-device'].includes(mode)) {
      throw Object.assign(new Error(`Invalid WhatsApp mode: ${mode}`), { statusCode: 400 });
    }
    if (mode === 'linked-device') {
      if (!number.sessionId) throw Object.assign(new Error('sessionId is required for linked-device'), { statusCode: 400 });
      number.workerUrl = number.workerUrl || 'http://127.0.0.1:7441';
      number.workerTokenEnv = number.workerTokenEnv || 'WHATSAPP_LINKED_DEVICE_WORKER_TOKEN';
    }
    if (mode === 'cloud' && !number.phoneNumberId) {
      throw Object.assign(new Error('phoneNumberId is required for cloud'), { statusCode: 400 });
    }

    // Migrate legacy flat format → numbers[] if needed
    let numbers = Array.isArray(tenant.whatsapp?.numbers) ? [...tenant.whatsapp.numbers] : [];
    if (numbers.length === 0) {
      const legacyMode = whatsappTransportMode(tenant);
      if (legacyMode === 'linked-device' && tenant.whatsapp?.sessionId) {
        numbers.push({ id: 'primary', label: 'Primary', mode: 'linked-device', sessionId: tenant.whatsapp.sessionId, workerUrl: tenant.whatsapp.workerUrl, workerTokenEnv: tenant.whatsapp.workerTokenEnv, allowGroups: tenant.whatsapp.allowGroups ?? false });
      } else if (legacyMode === 'cloud' && tenant.phoneNumberId) {
        numbers.push({ id: 'primary', label: 'Primary', mode: 'cloud', phoneNumberId: tenant.phoneNumberId });
      }
    }

    const numberId = String(number.id ?? `num-${Date.now()}`).trim();
    if (numbers.some((n) => n.id === numberId)) {
      throw Object.assign(new Error(`WhatsApp number id already exists: ${numberId}`), { statusCode: 409 });
    }

    const newNumber = { ...number, id: numberId, label: number.label ?? numberId, mode };
    numbers.push(newNumber);
    const updated = this.update(tenantId, { whatsapp: { ...tenant.whatsapp, numbers } });
    return { tenant: updated, number: newNumber };
  }

  removeWhatsAppNumber(tenantId, numberId) {
    const tenant = this.findById(tenantId);
    if (!tenant) throw Object.assign(new Error('tenant_not_found'), { statusCode: 404 });
    const numbers = Array.isArray(tenant.whatsapp?.numbers) ? tenant.whatsapp.numbers : [];
    if (!numbers.some((n) => n.id === numberId)) {
      throw Object.assign(new Error('whatsapp_number_not_found'), { statusCode: 404 });
    }
    const updated = this.update(tenantId, { whatsapp: { ...tenant.whatsapp, numbers: numbers.filter((n) => n.id !== numberId) } });
    return updated;
  }

  // ─── persistence ─────────────────────────────────────────────────────────────

  persist() {
    if (!this.tenantsFile) throw new Error('No tenantsFile configured — cannot persist changes');
    writeFileSync(this.tenantsFile, JSON.stringify(this.list(), null, 2) + '\n', 'utf8');
  }
}
