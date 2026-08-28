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

function legacyModelFromAgentDecision(decision) {
  const model = {
    intent: decision.intent,
    confidence: decision.confidence,
    reply: decision.proposedReply,
    requestedAction: decision.requestedAction,
    requestedControl: decision.requestedControl
  };
  if (decision.runtime?.provider) model.provider = decision.runtime.provider;
  if (decision.runtime?.model) model.model = decision.runtime.model;
  if (decision.requestedCapability) model.requestedCapability = decision.requestedCapability;
  if (decision.conciseRationale) model.conciseRationale = decision.conciseRationale;
  return model;
}

function ownershipVersion(value) {
  const version = Number(value ?? 0);
  if (!Number.isInteger(version) || version < 0) throw new Error('pending_agent_turn_ownership_version_invalid');
  return version;
}

export class SupervisorOrchestrator {
  constructor({
    modelGateway = null,
    agentRuntimeGateway = null,
    pendingAgentTurnStore = null,
    channelSender,
    auditStore,
    actionGateway = null,
    conversationStore = null,
    outboundAttributionStore = null,
    logger = console,
    now = () => new Date().toISOString()
  }) {
    this.modelGateway = modelGateway;
    this.agentRuntimeGateway = agentRuntimeGateway;
    this.pendingAgentTurnStore = pendingAgentTurnStore;
    this.channelSender = channelSender;
    this.auditStore = auditStore;
    this.actionGateway = actionGateway;
    this.conversationStore = conversationStore;
    this.outboundAttributionStore = outboundAttributionStore;
    this.logger = logger;
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
      this.logger?.warn?.('outbound_attribution_failed', {
        tenantId: tenant.id,
        sessionId: outbound.sessionId,
        platformMessageId: outbound.platformMessageId
      });
      return { recorded: false, reason: 'attribution_failed' };
    }
  }

  appendAudit({ tenant, message, model, permission, result }) {
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
  }

  async resolveModel(enrichedMessage, tenant, turnContext) {
    const routingConfig = {
      route: tenant.ai?.route ?? 'standard',
      routes: tenant.ai?.routes ?? {},
      businessContext: tenant.businessContext ?? null,
      availableCapabilities: availableCapabilities(tenant.policy)
    };

    if (this.agentRuntimeGateway) {
      const dispatch = await this.agentRuntimeGateway.dispatchTurn(
        {
          ...(turnContext?.turnId ? { turnId: turnContext.turnId } : {}),
          message: enrichedMessage,
          routingConfig
        },
        tenant.ai?.runtimeId ? { runtimeId: tenant.ai.runtimeId } : undefined
      );
      if (dispatch.status === 'dispatched') return { dispatch, model: null };
      return { dispatch, model: legacyModelFromAgentDecision(dispatch.decision) };
    }

    if (!this.modelGateway?.decide) throw new Error('agent_runtime_gateway_or_model_gateway_required');
    return {
      dispatch: null,
      model: await this.modelGateway.decide(enrichedMessage, routingConfig)
    };
  }

  async handle(message, tenant, { executionMode = null, turnContext = null } = {}) {
    const resolvedExecutionMode = resolveExecutionMode(tenant, executionMode);
    const context = message.context && Array.isArray(message.context) && message.context.length > 0
      ? message.context
      : this.buildConversationContext(tenant.id, message.customerId);

    const enrichedMessage = { ...message, context };
    const { dispatch, model } = await this.resolveModel(enrichedMessage, tenant, turnContext);

    if (dispatch?.status === 'dispatched') {
      if (!this.pendingAgentTurnStore?.record) throw new Error('pending_agent_turn_store_required');
      const pendingTurn = {
        tenantId: tenant.id,
        conversationId: turnContext?.conversationId ?? `${message.channel}:${message.customerId}`,
        messageId: message.id,
        turnId: dispatch.turnId,
        runtimeId: dispatch.runtimeId,
        dispatchedAt: dispatch.dispatchedAt,
        expiresAt: dispatch.expiresAt,
        status: 'pending',
        ownershipVersion: ownershipVersion(turnContext?.ownershipVersion)
      };
      await this.pendingAgentTurnStore.record(pendingTurn);
      const pendingResult = {
        action: 'pending',
        reason: 'agent_turn_dispatched',
        model: null,
        permission: null,
        runtime: { runtimeId: dispatch.runtimeId, turnId: dispatch.turnId }
      };
      this.appendAudit({ tenant, message, model: null, permission: null, result: pendingResult });
      return pendingResult;
    }

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

    this.appendAudit({ tenant, message, model, permission, result });
    return result;
  }
}
