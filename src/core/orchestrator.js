import { evaluatePermission } from '../domain/permission-engine.js';

export class SupervisorOrchestrator {
  constructor({ modelGateway, channelSender, auditStore, now = () => new Date().toISOString() }) {
    this.modelGateway = modelGateway;
    this.channelSender = channelSender;
    this.auditStore = auditStore;
    this.now = now;
  }

  async handle(message, tenant) {
    const model = await this.modelGateway.decide(message, {
      route: tenant.ai?.route ?? 'standard',
      routes: tenant.ai?.routes ?? {},
      businessContext: tenant.businessContext ?? null
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
      result: { action: result.action, wouldAction: result.wouldAction ?? null }
    });

    return result;
  }
}
