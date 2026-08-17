export class InMemoryTenantStore {
  constructor(tenants = []) {
    this.byId = new Map();
    this.byPhone = new Map();
    for (const tenant of tenants) this.upsert(tenant);
  }

  upsert(tenant) {
    if (!tenant?.id) throw new Error('Tenant id is required');
    this.byId.set(tenant.id, tenant);
    if (tenant.phoneNumberId) this.byPhone.set(tenant.phoneNumberId, tenant);
    return tenant;
  }

  findById(id) {
    return this.byId.get(id) ?? null;
  }

  findByPhoneNumberId(phoneNumberId) {
    return this.byPhone.get(phoneNumberId) ?? null;
  }
}
