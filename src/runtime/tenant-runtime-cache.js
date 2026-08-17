export class TenantRuntimeCache {
  constructor() {
    this.runtimes = new Map();
    this.senders = new Map();
  }

  runtimeFor(tenantId, factory) {
    const cached = this.runtimes.get(tenantId);
    if (cached) return cached;
    const runtime = factory();
    this.runtimes.set(tenantId, runtime);
    return runtime;
  }

  senderFor(tenantId, factory) {
    const cached = this.senders.get(tenantId);
    if (cached) return cached;
    const sender = factory();
    this.senders.set(tenantId, sender);
    return sender;
  }

  invalidate(tenantId) {
    this.runtimes.delete(tenantId);
    this.senders.delete(tenantId);
  }
}
