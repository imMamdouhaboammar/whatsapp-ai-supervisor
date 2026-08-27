import { validateAgentDecision } from './agent-decision.js';

const STATUSES = new Set(['completed', 'dispatched']);

function requiredString(value, code) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function validTimestamp(value, code) {
  const normalized = requiredString(value, code.replace('_invalid', '_required'));
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(code);
  return normalized;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function validateAgentRuntimeResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('agent_runtime_result_required');
  }

  const status = requiredString(value.status, 'agent_runtime_status_required');
  if (!STATUSES.has(status)) throw new Error(`unsupported_agent_runtime_status: ${status}`);

  const runtimeId = requiredString(value.runtimeId, 'agent_runtime_id_required');
  const turnId = requiredString(value.turnId, 'agent_runtime_turn_id_required');

  if (status === 'completed') {
    if (!value.decision) throw new Error('agent_runtime_completed_decision_required');
    if (value.dispatchedAt !== undefined || value.expiresAt !== undefined) {
      throw new Error('agent_runtime_completed_async_metadata_forbidden');
    }

    const decision = validateAgentDecision(value.decision);
    if (decision.runtime.runtimeId !== runtimeId) {
      throw new Error('agent_runtime_decision_runtime_mismatch');
    }

    return deepFreeze({
      status,
      runtimeId,
      turnId,
      decision
    });
  }

  if (Object.prototype.hasOwnProperty.call(value, 'decision')) {
    throw new Error('agent_runtime_dispatched_decision_forbidden');
  }

  const dispatchedAt = validTimestamp(value.dispatchedAt, 'agent_runtime_dispatched_at_invalid');
  const expiresAt = validTimestamp(value.expiresAt, 'agent_runtime_expires_at_invalid');
  if (Date.parse(expiresAt) <= Date.parse(dispatchedAt)) {
    throw new Error('agent_runtime_expiry_invalid');
  }

  return deepFreeze({
    status,
    runtimeId,
    turnId,
    dispatchedAt,
    expiresAt
  });
}

export class AgentRuntime {
  constructor({ runtimeId }) {
    this.runtimeId = requiredString(runtimeId, 'agent_runtime_id_required');
  }

  async dispatchTurn(_turn) {
    throw new Error('agent_runtime_dispatch_not_implemented');
  }
}
