export class InMemoryAuditStore {
  constructor() {
    this.events = [];
  }

  append(event) {
    const frozen = Object.freeze({ ...event });
    this.events.push(frozen);
    return frozen;
  }

  list(tenantId) {
    return this.events.filter((event) => event.tenantId === tenantId);
  }
}
