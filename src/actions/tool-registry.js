const RISKS = new Set(['low', 'medium', 'high']);

/** Normalize a tool identifier exactly once for registration and lookup. */
function normalizeToolId(value) {
  return String(value ?? '').trim();
}

/** Deep-freeze the cloned execution context exposed to a tool handler. */
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** Clone caller-owned execution data before crossing the tool boundary. */
function cloneContext(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}

/** Validate and normalize a tool definition before registration. */
function validateDefinition(tool) {
  if (!tool || typeof tool !== 'object') throw new Error('tool_registry_invalid_definition');
  const id = normalizeToolId(tool.id);
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
  /** Register the explicit set of tools that policy may select. */
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

  /** Return whether a normalized tool identifier is registered. */
  has(id) {
    return this.tools.has(normalizeToolId(id));
  }

  /** Return safe model-facing metadata for one registered tool. */
  describe(id) {
    const key = normalizeToolId(id);
    const entry = this.tools.get(key);
    if (!entry) throw new Error(`tool_registry_unknown_tool: ${key}`);
    return entry.metadata;
  }

  /** List safe metadata for all registered tools. */
  list() {
    return [...this.tools.values()].map((entry) => entry.metadata);
  }

  /** Execute one registered tool with immutable context and a cooperative deadline signal. */
  async execute(id, context = {}) {
    const key = normalizeToolId(id);
    const entry = this.tools.get(key);
    if (!entry) throw new Error(`tool_registry_unknown_tool: ${key}`);

    const boundedContext = deepFreeze(cloneContext(context ?? {}));
    const controller = new AbortController();
    let timer = null;
    const timeoutError = new Error(`tool_execution_timeout: ${key}`);
    const timeout = new Promise((_, reject) => {
      timer = this.setTimeoutImpl(() => {
        controller.abort(timeoutError);
        reject(timeoutError);
      }, entry.timeoutMs);
    });

    try {
      return await Promise.race([
        Promise.resolve(entry.definition.execute(boundedContext, controller.signal)),
        timeout
      ]);
    } finally {
      if (timer !== null) this.clearTimeoutImpl(timer);
    }
  }
}
