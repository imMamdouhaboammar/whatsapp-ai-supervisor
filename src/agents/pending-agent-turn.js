const STATUSES = new Set(['pending', 'invalidated']);

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

function validTimestamp(value, code) {
  const normalized = requiredString(value, code.replace('_invalid', '_required'));
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(code);
  return normalized;
}

export function validatePendingAgentTurn(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('pending_agent_turn_required');
  }

  const status = requiredString(value.status, 'pending_agent_turn_status_required');
  if (!STATUSES.has(status)) throw new Error(`unsupported_pending_agent_turn_status: ${status}`);

  const ownershipVersion = Number(value.ownershipVersion);
  if (!Number.isInteger(ownershipVersion) || ownershipVersion < 0) {
    throw new Error('pending_agent_turn_ownership_version_invalid');
  }

  const dispatchedAt = validTimestamp(value.dispatchedAt, 'pending_agent_turn_dispatched_at_invalid');
  const expiresAt = validTimestamp(value.expiresAt, 'pending_agent_turn_expires_at_invalid');
  if (Date.parse(expiresAt) <= Date.parse(dispatchedAt)) {
    throw new Error('pending_agent_turn_expiry_invalid');
  }

  const result = {
    tenantId: requiredString(value.tenantId, 'pending_agent_turn_tenant_id_required'),
    conversationId: requiredString(value.conversationId, 'pending_agent_turn_conversation_id_required'),
    messageId: requiredString(value.messageId, 'pending_agent_turn_message_id_required'),
    turnId: requiredString(value.turnId, 'pending_agent_turn_turn_id_required'),
    runtimeId: requiredString(value.runtimeId, 'pending_agent_turn_runtime_id_required'),
    dispatchedAt,
    expiresAt,
    status,
    ownershipVersion
  };

  const invalidatedAt = optionalString(value.invalidatedAt, 'pending_agent_turn_invalidated_at_invalid');
  const reasonCode = optionalString(value.reasonCode, 'pending_agent_turn_reason_code_invalid');

  if (status === 'invalidated') {
    if (!invalidatedAt || !Number.isFinite(Date.parse(invalidatedAt))) {
      throw new Error('pending_agent_turn_invalidated_at_invalid');
    }
    if (!reasonCode) throw new Error('pending_agent_turn_reason_code_required');
    result.invalidatedAt = invalidatedAt;
    result.reasonCode = reasonCode;
  } else if (invalidatedAt || reasonCode) {
    throw new Error('pending_agent_turn_invalidation_metadata_forbidden');
  }

  return Object.freeze(result);
}
