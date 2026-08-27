import { randomUUID } from 'node:crypto';

export const DOMAIN_EVENT_SCHEMA_VERSION = 1;

export const DOMAIN_ACTOR_TYPES = new Set([
  'customer',
  'ai',
  'operator',
  'connector',
  'scheduler'
]);

export const DOMAIN_EVENT_TYPES = new Set([
  'message.received',
  'message.normalized',
  'decision.requested',
  'decision.completed',
  'policy.evaluated',
  'reply.requested',
  'reply.sent',
  'reply.failed',
  'tool.requested',
  'tool.approved',
  'tool.started',
  'tool.completed',
  'tool.failed',
  'human.handoff_started',
  'human.handoff_ended',
  'human.outbound_observed',
  'human.handoff_requested',
  'human.handoff_released',
  'conversation.ownership_changed',
  'connector.state_changed',
  'browser.session_started',
  'browser.step_completed',
  'browser.session_failed'
]);

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`domain_event_${field}_required`);
  }
  return value.trim();
}

function optionalString(value, field) {
  if (value === undefined || value === null) return undefined;
  return requiredString(value, field);
}

function cloneValue(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertActor(actor) {
  if (!actor || typeof actor !== 'object' || Array.isArray(actor)) {
    throw new Error('domain_event_actor_required');
  }
  if (!DOMAIN_ACTOR_TYPES.has(actor.type)) {
    throw new Error(`unsupported_domain_actor_type: ${String(actor.type ?? '')}`);
  }
  if (actor.id !== undefined) requiredString(actor.id, 'actor_id');
  return actor;
}

export function assertDomainEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new Error('domain_event_required');
  }

  requiredString(event.eventId, 'eventId');
  if (!DOMAIN_EVENT_TYPES.has(event.eventType)) {
    throw new Error(`unsupported_domain_event_type: ${String(event.eventType ?? '')}`);
  }
  if (event.schemaVersion !== DOMAIN_EVENT_SCHEMA_VERSION) {
    throw new Error(`unsupported_domain_event_schema_version: ${String(event.schemaVersion ?? '')}`);
  }
  requiredString(event.occurredAt, 'occurredAt');
  if (!Number.isFinite(Date.parse(event.occurredAt))) {
    throw new Error('domain_event_occurredAt_invalid');
  }
  requiredString(event.tenantId, 'tenantId');
  requiredString(event.correlationId, 'correlationId');
  optionalString(event.conversationId, 'conversationId');
  optionalString(event.messageId, 'messageId');
  optionalString(event.causationId, 'causationId');
  optionalString(event.idempotencyKey, 'idempotencyKey');
  assertActor(event.actor);
  if (!Object.prototype.hasOwnProperty.call(event, 'payload')) {
    throw new Error('domain_event_payload_required');
  }

  return event;
}

export function createDomainEvent(input, {
  now = () => new Date().toISOString(),
  idFactory = randomUUID
} = {}) {
  const eventId = requiredString(idFactory(), 'eventId');
  const event = {
    eventId,
    eventType: input?.eventType,
    schemaVersion: DOMAIN_EVENT_SCHEMA_VERSION,
    occurredAt: now(),
    tenantId: input?.tenantId,
    conversationId: input?.conversationId,
    messageId: input?.messageId,
    correlationId: input?.correlationId ?? eventId,
    causationId: input?.causationId,
    idempotencyKey: input?.idempotencyKey,
    actor: cloneValue(input?.actor),
    payload: cloneValue(input?.payload)
  };

  assertDomainEvent(event);
  return deepFreeze(event);
}

export function deriveDomainEvent(parent, input, dependencies = {}) {
  assertDomainEvent(parent);
  return createDomainEvent({
    eventType: input?.eventType,
    tenantId: parent.tenantId,
    conversationId: input?.conversationId ?? parent.conversationId,
    messageId: input?.messageId ?? parent.messageId,
    correlationId: parent.correlationId,
    causationId: parent.eventId,
    idempotencyKey: input?.idempotencyKey,
    actor: input?.actor,
    payload: input?.payload
  }, dependencies);
}
