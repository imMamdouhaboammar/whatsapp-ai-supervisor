/** Interpolate only policy-approved identifiers, inserting replacement values literally. */
function interpolateTrustedValue(value, replacements) {
  if (typeof value === 'string') {
    return value
      .replaceAll('{{tenantId}}', () => replacements.tenantId)
      .replaceAll('{{customerId}}', () => replacements.customerId)
      .replaceAll('{{messageId}}', () => replacements.messageId)
      .replaceAll('{{correlationId}}', () => replacements.correlationId);
  }
  if (Array.isArray(value)) return value.map((item) => interpolateTrustedValue(item, replacements));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, interpolateTrustedValue(child, replacements)]));
  }
  return value;
}

export class ActionGateway {
  /** Bind browser and registered-tool execution adapters without changing policy authority. */
  constructor({ browserRuntime = null, toolRegistry = null } = {}) {
    this.browserRuntime = browserRuntime;
    this.toolRegistry = toolRegistry;
  }

  /** Execute only the capability attached to the already-matched policy rule. */
  async execute({ tenant, message, rule }) {
    const capability = rule?.capability;
    if (!capability) throw new Error('action_capability_missing');

    if (capability.toolId) {
      if (!this.toolRegistry) throw new Error('tool_registry_unavailable');
      const replacements = {
        tenantId: String(tenant.id ?? ''),
        customerId: String(message.customerId ?? ''),
        messageId: String(message.id ?? ''),
        correlationId: String(message.correlationId ?? '')
      };
      const parameters = interpolateTrustedValue(capability.parameters ?? {}, replacements);
      const toolId = String(capability.toolId).trim();
      return this.toolRegistry.execute(toolId, {
        tenantId: replacements.tenantId,
        customerId: replacements.customerId,
        messageId: replacements.messageId,
        correlationId: replacements.correlationId,
        parameters
      });
    }

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
