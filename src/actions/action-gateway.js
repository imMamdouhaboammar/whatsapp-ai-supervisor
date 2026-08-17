export class ActionGateway {
  constructor({ browserRuntime = null } = {}) {
    this.browserRuntime = browserRuntime;
  }

  async execute({ tenant, message, rule }) {
    const capability = rule?.capability;
    if (!capability) throw new Error('action_capability_missing');
    if (capability.type !== 'browser') throw new Error(`action_capability_unsupported: ${capability.type ?? 'unknown'}`);
    if (!this.browserRuntime) throw new Error('browser_runtime_unavailable');

    const task = String(capability.task ?? '')
      .replaceAll('{{tenantId}}', () => String(tenant.id ?? ''))
      .replaceAll('{{customerId}}', () => String(message.customerId ?? ''))
      .replaceAll('{{messageId}}', () => String(message.id ?? ''));

    return this.browserRuntime.runTask({
      task,
      sessionId: `${tenant.id}:${message.customerId}`,
      allowedDomains: capability.allowedDomains,
      timeoutMs: capability.timeoutMs ?? 60_000
    });
  }
}
