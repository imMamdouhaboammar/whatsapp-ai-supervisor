const RISKS = new Set(['low', 'medium', 'high']);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function cloneContext(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}

function validateDefinition(tool) {
  if (!tool || typeof tool !== 'object') throw new Error('tool_registry_invalid_definition');
  const id = String(tool.id ?? '').trim();
  if (!id) throw new Error('tool_registry_invalid_id');
  const type = String(tool.type ?? '').trim();
  if (!type) throw new Error('tool_registry_invalid_type');
  if (typeof tool.execute !== 'function') throw new Error('tool_registry_execute_required');
  if (tool.risk !== undefined && !RISKS.has(tool.risk)) throw new Error('tool_registry_invalid_risk');
  const timeoutMs = Number(tool.timeoutMs ?? 30_000);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300_000) throw new Error('tool_registry_invalid_timeout');
  return {
    definition: tool,
    metadata: Object.freeze({
      id,
      type,
      ...(tool.risk ? { risk: tool.risk } : {}),
      ...(typeof tool.description === 'string' && tool.description.trim() ? { description: tool.description.trim().slice(0, 300) } : {})
    }),
    timeoutMs
  };
}

export class ToolRegistry {
  constructor({ tools = [], setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {}) {
    this.tools = new Map();
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;
    for (const raw of tools) {
      const validated = validateDefinition(raw);
      const id = validated.metadata.id;
      if (this.tools.has(id)) throw new Error(`tool_registry_duplicate_id: ${id}`);
      this.tools.set(id, validated);
    }
  }

  has(id) {
    return this.tools.has(String(id ?? ''));
  }

  describe(id) {
    const entry = this.tools.get(String(id ?? ''));
    if (!entry) throw new Error(`tool_registry_unknown_tool: ${String(id ?? '')}`);
    return entry.metadata;
  }

  list() {
    return [...this.tools.values()].map((entry) => entry.metadata);
  }

  async execute(id, context = {}) {
    const key = String(id ?? '');
    const entry = this.tools.get(key);
    if (!entry) throw new Error(`tool_registry_unknown_tool: ${key}`);
    const boundedContext = deepFreeze(cloneContext(context ?? {}));
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = this.setTimeoutImpl(() => reject(new Error(`tool_execution_timeout: ${key}`)), entry.timeoutMs);
    });
    try {
      return await Promise.race([Promise.resolve(entry.definition.execute(boundedContext)), timeout]);
    } finally {
      if (timer !== null) this.clearTimeoutImpl(timer);
    }
  }
}
