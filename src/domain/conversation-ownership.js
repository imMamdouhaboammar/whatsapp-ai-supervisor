export const CONVERSATION_OWNERSHIP_STATES = Object.freeze([
  'AI_ACTIVE',
  'WAITING_APPROVAL',
  'HUMAN_REQUESTED',
  'HUMAN_ACTIVE',
  'AI_PAUSED'
]);

export const CONVERSATION_OWNERSHIP_COMMANDS = Object.freeze([
  'manual_takeover',
  'request_handoff',
  'wait_for_approval',
  'approval_resolved',
  'pause_agent',
  'release_to_agent',
  'resume_agent'
]);

const STATES = new Set(CONVERSATION_OWNERSHIP_STATES);
const COMMANDS = new Set(CONVERSATION_OWNERSHIP_COMMANDS);

function requiredString(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`ownership_${field}_required`);
  return normalized;
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('conversation_ownership_required');
  }
  const normalized = {
    tenantId: requiredString(record.tenantId, 'tenant_id'),
    conversationId: requiredString(record.conversationId, 'conversation_id'),
    state: requiredString(record.state, 'state'),
    version: Number(record.version),
    changedAt: requiredString(record.changedAt, 'changed_at'),
    changedBy: requiredString(record.changedBy, 'changed_by'),
    reasonCode: record.reasonCode == null ? null : requiredString(record.reasonCode, 'reason_code'),
    transitionId: record.transitionId == null ? null : requiredString(record.transitionId, 'transition_id')
  };
  if (!STATES.has(normalized.state)) throw new Error(`unsupported_ownership_state: ${normalized.state}`);
  if (!Number.isInteger(normalized.version) || normalized.version < 0) throw new Error('ownership_version_invalid');
  if (!Number.isFinite(Date.parse(normalized.changedAt))) throw new Error('ownership_changed_at_invalid');
  return normalized;
}

export function assertConversationOwnership(record) {
  normalizeRecord(record);
  return record;
}

export function createInitialOwnership({ tenantId, conversationId }, {
  now = () => new Date().toISOString(),
  actor = 'system'
} = {}) {
  return Object.freeze(normalizeRecord({
    tenantId,
    conversationId,
    state: 'AI_ACTIVE',
    version: 0,
    changedAt: now(),
    changedBy: actor,
    reasonCode: 'default_ai_active',
    transitionId: null
  }));
}

function nextStateFor(state, command) {
  if (command === 'manual_takeover') return 'HUMAN_ACTIVE';
  if (command === 'request_handoff' && state === 'AI_ACTIVE') return 'HUMAN_REQUESTED';
  if (command === 'wait_for_approval' && state === 'AI_ACTIVE') return 'WAITING_APPROVAL';
  if (command === 'approval_resolved' && state === 'WAITING_APPROVAL') return 'AI_ACTIVE';
  if (command === 'pause_agent' && state !== 'HUMAN_ACTIVE') return 'AI_PAUSED';
  if (command === 'release_to_agent' && state === 'HUMAN_ACTIVE') return 'AI_ACTIVE';
  if (command === 'resume_agent' && state === 'AI_PAUSED') return 'AI_ACTIVE';
  return state;
}

export function transitionOwnership(current, command, {
  transitionId,
  actor,
  reasonCode = null,
  now = () => new Date().toISOString()
} = {}) {
  const record = normalizeRecord(current);
  const normalizedCommand = requiredString(command, 'command');
  if (!COMMANDS.has(normalizedCommand)) throw new Error(`unsupported_ownership_command: ${normalizedCommand}`);
  const normalizedTransitionId = requiredString(transitionId, 'transition_id');
  const normalizedActor = requiredString(actor, 'actor');

  if (record.transitionId === normalizedTransitionId) return Object.freeze(record);

  const nextState = nextStateFor(record.state, normalizedCommand);
  if (nextState === record.state) return Object.freeze(record);

  return Object.freeze(normalizeRecord({
    ...record,
    state: nextState,
    version: record.version + 1,
    changedAt: now(),
    changedBy: normalizedActor,
    reasonCode,
    transitionId: normalizedTransitionId
  }));
}
