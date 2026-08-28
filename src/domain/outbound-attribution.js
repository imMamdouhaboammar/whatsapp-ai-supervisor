export const OUTBOUND_ORIGINS = Object.freeze(['agent', 'operator_api']);
const ORIGINS = new Set(OUTBOUND_ORIGINS);

function requiredString(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`outbound_${field}_required`);
  return normalized;
}

function optionalString(value, field) {
  if (value === undefined || value === null) return null;
  return requiredString(value, field);
}

function validTimestamp(value, field) {
  const normalized = requiredString(value, field);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(`outbound_${field}_invalid`);
  return normalized;
}

export function assertOutboundAttribution(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('outbound_attribution_required');
  }
  requiredString(record.tenantId, 'tenant_id');
  requiredString(record.sessionId, 'session_id');
  requiredString(record.conversationId, 'conversation_id');
  requiredString(record.customerId, 'customer_id');
  requiredString(record.platformMessageId, 'platform_message_id');
  if (!ORIGINS.has(record.origin)) throw new Error(`unsupported_outbound_origin: ${String(record.origin ?? '')}`);
  validTimestamp(record.createdAt, 'created_at');
  validTimestamp(record.expiresAt, 'expires_at');
  if (record.echoObservedAt !== null && record.echoObservedAt !== undefined) validTimestamp(record.echoObservedAt, 'echo_observed_at');
  optionalString(record.sourceMessageId, 'source_message_id');
  return record;
}

export function createOutboundAttribution(input, {
  now = () => new Date().toISOString(),
  ttlMs = 24 * 60 * 60 * 1000
} = {}) {
  const createdAt = now();
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error('outbound_created_at_invalid');
  const ttl = Number(ttlMs);
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error('outbound_ttl_invalid');
  const record = {
    tenantId: requiredString(input?.tenantId, 'tenant_id'),
    sessionId: requiredString(input?.sessionId, 'session_id'),
    conversationId: requiredString(input?.conversationId, 'conversation_id'),
    customerId: requiredString(input?.customerId, 'customer_id'),
    platformMessageId: requiredString(input?.platformMessageId, 'platform_message_id'),
    origin: input?.origin,
    sourceMessageId: optionalString(input?.sourceMessageId, 'source_message_id'),
    createdAt,
    expiresAt: new Date(Date.parse(createdAt) + ttl).toISOString(),
    echoObservedAt: null
  };
  assertOutboundAttribution(record);
  return Object.freeze(record);
}
