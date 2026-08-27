import { evaluatePermission } from '../domain/permission-engine.js';
import { createOutboundAttribution } from '../domain/outbound-attribution.js';

const EXECUTION_MODES = new Set(['live', 'shadow', 'simulation']);

function availableCapabilities(policy) {
  const isV2 = Number(policy?.version) === 2;
  return (policy?.rules ?? [])
    .filter((rule) => rule.action === 'act' && rule.capability?.type && (!isV2 || rule.effect === 'allow'))
    .map((rule) => ({ intent: rule.intent, type: rule.capability.type }));
}

function resolveExecutionMode(tenant, requestedMode = null) {
  const requested = requestedMode ?? 'live';
  if (!EXECUTION_MODES.has(requested)) throw new Error(`invalid_execution_mode: ${requested}`);
  if (requested === 'simulation') return 'simulation';
  return tenant.shadowMode ? 'shadow' : requested;
}

export class SupervisorOrchestrator {
  constructor({
    modelGateway,
    channelSender,
    auditStore,
    actionGateway = null,
    conversationStore = null,
    outboundAttributionStore = null,
    now = () => new Date().toISOString()
  }) {
    this.modelGateway = modelGateway;
    this.channelSender = channelSender;
    this.auditStore = auditStore;
    this.actionGateway = actionGateway;
    this.conversationStore = conversationStore;
    this.outboundAttributionStore = outboundAttributionStore;
    this.now = now;
  }

  buildConversationContext(tenantId, customerId) {
    if (!this.conversationStore || typeof this.conversationStore.readEvents !== 'function') return [];
    try {
      const events = this.conversationStore.readEvents(tenantId)
        .filter((e) => String(e.customerId) === String(customerId))
        .slice(-6);
      return events.map((e) => ({
        direction: e.direction === 'inbound' ? 'user' : 'assistant',
        text: e.text,
        at: e.at,
        intent: e.intent ?? null
      }));
    } catch {
      return [];
    }
  }

  async recordAgentAttribution({ tenant, message, outbound }) {
    if (
      outbound?.transport !== 'linked-device' ||
      !outbound?.platformMessageId ||
      !outbound?.sessionId ||
      !this.outboundAttributionStore?.record
    ) {
      return null;
    }

    try {
      const attribution = createOutboundAttribution({
        tenantId: tenant.id,
        sessionId: outbound.sessionId,
        conversationId: `${message.channel}:${message.customerId}`,
        customerId: message.customerId,
        platformMessageId: outbound.platformMessageId,
        origin: 'agent',
        sourceMessageId: message.id
      }, { now: this.now });
      await this.outboundAttributionStore.record(attribution);
      return { recorded: true };
    } catch {
      return { recorded: false, reason: 'attribution_failed' };
    }
  }

  async handle(message, tenant, { executionMode = null } = {}) {
    const resolvedExecutionMode = resolveExecutionMode(tenant, executionMode);
    const context = message.context && Array.isArray(message.context) && message.context.length > 0
      ? message.context
      : this.buildConversationContext(tenant.id, message.customerId);

    const enrichedMessage = { ...message, context };
    const model = await this.modelGateway.decide(enrichedMessage, {
      route: tenant.ai?.route ?? 'standard',
      routes: tenant.ai?.routes ?? {},
      businessContext: tenant.businessContext ?? null,
      availableCapabilities: availableCapabilities(tenant.policy)
    });

    const permission = evaluatePermission(tenant.policy ?? {}, model, { channel: message.channel });
    let result;

    if (resolvedExecutionMode !== 'live') {
      result = { action: resolvedExecutionMode, wouldAction: permission.action, model, permission };
    } else if (permission.action === 'reply') {
      if (!model.reply?.trim()) {
        result = { action: 'human', reason: 'empty_reply', model, permission };
      } else {
        const outbound = await this.channelSender.sendText({
          to: message.customerId,
          text: model.reply,
          replyToId: message.id
        });
        const attribution = await this.recordAgentAttribution({ tenant, message, outbound });
        result = { action: 'reply', outbound, model, permission, ...(attribution ? { attribution } : {}) };
      }
    } else if (permission.action === 'act') {
      if (!this.actionGateway) {
        result = { action: 'human', reason: 'action_gateway_unavailable', model, permission };
      } else {
        const rule = (tenant.policy?.rules ?? []).find((candidate) => candidate.id === permission.matchedRuleId);
        try {
          const actionResult = await this.actionGateway.execute({ tenant, message: enrichedMessage, rule });
          result = { action: 'act', actionResult, model, permission };
        } catch (error) {
          result = {
            action: 'human',
            reason: 'action_failed',
            actionError: String(error?.message ?? error).slice(0, 300),
            model,
            permission
          };
        }
      }
    } else {
      result = { action: permission.action, model, permission };
    }

    this.auditStore.append({
      id: crypto.randomUUID(),
      tenantId: tenant.id,
      messageId: message.id,
      customerId: message.customerId,
      channel: message.channel,
      at: this.now(),
      model,
      permission,
      result: {
        action: result.action,
        wouldAction: result.wouldAction ?? null,
        reason: result.reason ?? null
      }
    });

    return result;
  }
}
