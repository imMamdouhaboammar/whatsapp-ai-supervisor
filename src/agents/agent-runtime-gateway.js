import { validateAgentRuntimeResult } from './agent-runtime.js';

function requiredString(value, code) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

export class AgentRuntimeGateway {
  constructor({ runtimes = [], defaultRuntimeId }) {
    if (!Array.isArray(runtimes) || runtimes.length === 0) {
      throw new Error('agent_runtime_runtimes_required');
    }

    this.runtimes = new Map();
    for (const runtime of runtimes) {
      const runtimeId = requiredString(runtime?.runtimeId, 'agent_runtime_id_required');
      if (typeof runtime?.dispatchTurn !== 'function') {
        throw new Error(`agent_runtime_dispatch_required: ${runtimeId}`);
      }
      if (this.runtimes.has(runtimeId)) {
        throw new Error(`agent_runtime_duplicate_runtime: ${runtimeId}`);
      }
      this.runtimes.set(runtimeId, runtime);
    }

    this.defaultRuntimeId = requiredString(defaultRuntimeId, 'agent_runtime_default_id_required');
    if (!this.runtimes.has(this.defaultRuntimeId)) {
      throw new Error(`agent_runtime_unknown_runtime: ${this.defaultRuntimeId}`);
    }
  }

  async dispatchTurn(turn, { runtimeId } = {}) {
    const selectedRuntimeId = runtimeId == null
      ? this.defaultRuntimeId
      : requiredString(runtimeId, 'agent_runtime_id_required');
    const runtime = this.runtimes.get(selectedRuntimeId);
    if (!runtime) throw new Error(`agent_runtime_unknown_runtime: ${selectedRuntimeId}`);

    const result = validateAgentRuntimeResult(await runtime.dispatchTurn(turn));
    if (result.runtimeId !== selectedRuntimeId) {
      throw new Error('agent_runtime_identity_mismatch');
    }
    return result;
  }
}
