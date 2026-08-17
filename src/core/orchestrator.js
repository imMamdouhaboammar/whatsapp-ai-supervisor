import { evaluatePermission } from '../domain/permission-engine.js';

function availableCapabilities(policy) {
  return (policy?.rules ?? [])
    .filter((rule) => rule.action === 'act' && rule.capability?.type)
    .map((rule) => ({ intent: rule.intent, type: rule.capability.type }));
}

export class SupervisorOrchestrator {
  constructor({ modelGateway, channelSender, auditStore, actionGateway = null, now = () => new Date().toISOString() }) {
    this.modelGateway = modelGateway;
    this.channelSender = channelSender;
    this.auditStore = auditStore;
    this.actionGateway = actionGateway;
    this.now = now;
  }

  async handle(message, tenant) {
    const model = await this.modelGateway.decide(message, {
      route: tenant.ai?.route ?? 'standard',
      routes: tenant.ai?.routes ?? {},
      businessContext: tenant.businessContext ?? null,
      availableCapabilities: availableCapabilities(tenant.policy)
    });

    const permission = evaluatePermission(tenant.policy ?? {}, model);
    let result;

    if (tenant.shadowMode) {
      result = { action: 'shadow', wouldAction: permission.action, model, permission };
    } else if (permission.action === 'reply') {
      if (!model.reply?.trim()) {
        result = { action: 'human', reason: 'empty_reply', model, permission };
      } else {
        const outbound = await this.channelSender.sendText({
          to: message.customerId,
          text: model.reply,
          replyToId: message.id
        });
        result = { action: 'reply', outbound, model, permission };
      }
    } else if (permission.action === 'act') {
      if (!this.actionGateway) {
        result = { action: 'human', reason: 'action_gateway_unavailable', model, permission };
      } else {
        const rule = (tenant.policy?.rules ?? []).find((candidate) => candidate.id === permission.matchedRuleId);
        try {
          const actionResult = await this.actionGateway.execute({ tenant, message, rule });
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
