import { AUTONOMY_ACTIONS } from '../domain/types.js';

const REQUESTED_CONTROLS = new Set(['keep_agent', 'handoff_human']);
const HIDDEN_REASONING_FIELDS = ['chainOfThought', 'thinking', 'reasoning_content'];
const RAW_SIDE_EFFECT_FIELDS = ['rawToolCall', 'rawSend', 'rawHttpRequest'];

function requiredString(value, code) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function optionalString(value, code) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function assertPlainObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(code);
  return value;
}

function cloneJson(value, path = 'arguments') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`agent_decision_${path}_invalid`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => cloneJson(item, `${path}_${index}`));
  assertPlainObject(value, `agent_decision_${path}_invalid`);
  const copy = {};
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error(`agent_decision_${path}_unsafe_key`);
    copy[key] = cloneJson(child, `${path}_${key}`);
  }
  return copy;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeRuntime(runtime) {
  assertPlainObject(runtime, 'agent_runtime_metadata_required');
  const result = {
    runtimeId: requiredString(runtime.runtimeId, 'agent_runtime_id_required')
  };
  const provider = optionalString(runtime.provider, 'agent_runtime_provider_invalid');
  const model = optionalString(runtime.model, 'agent_runtime_model_invalid');
  if (provider) result.provider = provider;
  if (model) result.model = model;
  return result;
}

function normalizeCapability(value) {
  if (value === undefined || value === null) return null;
  assertPlainObject(value, 'agent_decision_capability_invalid');
  return {
    capabilityId: requiredString(value.capabilityId, 'agent_decision_capability_id_required'),
    arguments: cloneJson(value.arguments ?? {})
  };
}

export function validateAgentDecision(value) {
  assertPlainObject(value, 'agent_decision_required');

  for (const field of HIDDEN_REASONING_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error('agent_decision_hidden_reasoning_forbidden');
    }
  }
  for (const field of RAW_SIDE_EFFECT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error('agent_decision_raw_side_effect_forbidden');
    }
  }

  const confidence = Number(value.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error('agent_decision_confidence_invalid');
  }

  const requestedAction = requiredString(value.requestedAction, 'agent_decision_requested_action_required');
  if (!AUTONOMY_ACTIONS.includes(requestedAction)) {
    throw new Error(`unsupported_agent_requested_action: ${requestedAction}`);
  }

  const requestedControl = value.requestedControl == null
    ? 'keep_agent'
    : requiredString(value.requestedControl, 'agent_decision_requested_control_required');
  if (!REQUESTED_CONTROLS.has(requestedControl)) {
    throw new Error(`unsupported_agent_requested_control: ${requestedControl}`);
  }

  const decision = {
    intent: requiredString(value.intent, 'agent_decision_intent_required'),
    confidence,
    proposedReply: typeof value.proposedReply === 'string' ? value.proposedReply : '',
    requestedAction,
    requestedControl,
    runtime: normalizeRuntime(value.runtime)
  };

  const requestedCapability = normalizeCapability(value.requestedCapability);
  if (requestedCapability) decision.requestedCapability = requestedCapability;

  const conciseRationale = optionalString(value.conciseRationale, 'agent_decision_concise_rationale_invalid');
  if (conciseRationale) decision.conciseRationale = conciseRationale;

  return deepFreeze(decision);
}
