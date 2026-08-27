import { assertDomainEvent, deriveDomainEvent } from '../domain/domain-event.js';

function createDecisionDomainEvent(inboundEvent, result) {
  const idempotencyRoot = inboundEvent.idempotencyKey ?? inboundEvent.eventId;
  const payload = {
    action: result.action,
    wouldAction: result.wouldAction ?? null,
    reason: result.reason ?? null,
    intent: result.model?.intent ?? null,
    confidence: result.model?.confidence ?? null,
    provider: result.model?.provider ?? null,
    model: result.model?.model ?? null
  };
  if (result.ownershipState) payload.ownershipState = result.ownershipState;

  return deriveDomainEvent(inboundEvent, {
    eventType: 'decision.completed',
    idempotencyKey: `${idempotencyRoot}:decision.completed`,
    actor: { type: 'ai', id: 'supervisor' },
    payload
  });
}

function ownershipBlockResult(state) {
  const reason = `ownership_${String(state).toLowerCase()}`;
  return {
    action: 'human',
    reason,
    ownershipState: state,
    model: null,
    permission: { action: 'human', reason }
  };
}

export function createInboundDecisionHandler({
  orchestratorForTenant,
  auditStore,
  conversationStore = null,
  ownershipStore = null,
  domainEventStore = null,
  sseBroadcaster = null
}) {
  if (typeof orchestratorForTenant !== 'function') throw new Error('orchestratorForTenant is required');
  if (!auditStore?.append) throw new Error('auditStore is required');

  return async function handleInboundDecision({ message, tenant, inboundEvent }) {
    if (!message?.id || !tenant?.id) throw new Error('inbound_decision_identity_required');
    assertDomainEvent(inboundEvent);
    if (message.tenantId !== tenant.id || inboundEvent.tenantId !== tenant.id) {
      throw new Error('inbound_decision_tenant_mismatch');
    }

    let result;
    if (ownershipStore?.get) {
      const conversationId = inboundEvent.conversationId ?? `${message.channel}:${message.customerId}`;
      const ownership = await ownershipStore.get(tenant.id, conversationId);
      if (ownership.state !== 'AI_ACTIVE') {
        result = ownershipBlockResult(ownership.state);
      }
    }

    if (!result && !ownershipStore?.get && conversationStore?.isHumanControlled(tenant.id, message.customerId)) {
      result = {
        action: 'human',
        reason: 'human_takeover',
        model: null,
        permission: { action: 'human', reason: 'human_takeover' }
      };
    }

    if (!result) {
      result = await orchestratorForTenant(tenant).handle(message, tenant);
    }

    const attemptedDecisionEvent = createDecisionDomainEvent(inboundEvent, result);
    const decisionDomainEvent = await domainEventStore?.append(attemptedDecisionEvent) ?? attemptedDecisionEvent;

    if (result.action === 'human' && (result.reason === 'human_takeover' || String(result.reason ?? '').startsWith('ownership_'))) {
      auditStore.append({
        id: crypto.randomUUID(),
        tenantId: tenant.id,
        messageId: message.id,
        customerId: message.customerId,
        channel: message.channel,
        at: decisionDomainEvent.occurredAt,
        model: null,
        permission: result.permission,
        result: { action: 'human', reason: result.reason, wouldAction: null }
      });
    }

    conversationStore?.recordDecision(message, result, decisionDomainEvent);
    sseBroadcaster?.broadcastDomainEvent?.(decisionDomainEvent);
    return result;
  };
}

export function createProcessInboundJobHandler({ tenantStore, decisionHandler }) {
  if (!tenantStore?.findById) throw new Error('tenantStore is required');
  if (typeof decisionHandler !== 'function') throw new Error('decisionHandler is required');

  return async function processInboundJob(payload) {
    const message = payload?.message;
    const inboundEvent = payload?.inboundEvent;
    if (!message?.id || !message?.tenantId) throw new Error('durable_job_message_invalid');
    assertDomainEvent(inboundEvent);
    if (inboundEvent.tenantId !== message.tenantId) throw new Error('durable_job_tenant_mismatch');

    const tenant = tenantStore.findById(message.tenantId);
    if (!tenant) throw new Error('durable_job_tenant_not_found');
    return decisionHandler({ message, tenant, inboundEvent });
  };
}
