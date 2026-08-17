import { whatsappTransportMode } from '../channels/whatsapp-linked-device.js';

export class InMemoryTenantStore {
  constructor(tenants = []) {
    this.byId = new Map();
    this.byPhone = new Map();
    this.byLinkedSession = new Map();
    for (const tenant of tenants) this.upsert(tenant);
  }

  upsert(tenant) {
    if (!tenant?.id) throw new Error('Tenant id is required');

    const existing = this.byId.get(tenant.id);
    if (existing?.phoneNumberId) this.byPhone.delete(existing.phoneNumberId);
    if (existing?.whatsapp?.sessionId) this.byLinkedSession.delete(existing.whatsapp.sessionId);

    const mode = whatsappTransportMode(tenant);
    if (tenant.phoneNumberId) {
      const owner = this.byPhone.get(tenant.phoneNumberId);
      if (owner && owner.id !== tenant.id) throw new Error(`Duplicate WhatsApp phone number id: ${tenant.phoneNumberId}`);
    }
    if (mode === 'linked-device') {
      const sessionId = String(tenant.whatsapp?.sessionId ?? '').trim();
      if (!sessionId) throw new Error(`Linked-device tenant ${tenant.id} requires whatsapp.sessionId`);
      const owner = this.byLinkedSession.get(sessionId);
      if (owner && owner.id !== tenant.id) throw new Error(`Duplicate linked-device session id: ${sessionId}`);
    }

    this.byId.set(tenant.id, tenant);
    if (tenant.phoneNumberId) this.byPhone.set(tenant.phoneNumberId, tenant);
    if (mode === 'linked-device') this.byLinkedSession.set(tenant.whatsapp.sessionId, tenant);
    return tenant;
  }

  list() {
    return [...this.byId.values()];
  }

  findById(id) {
    return this.byId.get(id) ?? null;
  }

  findByPhoneNumberId(phoneNumberId) {
    return this.byPhone.get(phoneNumberId) ?? null;
  }

  findByLinkedDeviceSessionId(sessionId) {
    return this.byLinkedSession.get(sessionId) ?? null;
  }
}
