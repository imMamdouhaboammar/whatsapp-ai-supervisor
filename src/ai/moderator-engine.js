/**
 * Autonomous Moderator Engine
 * Scans active customer conversation threads, dispatches subagents to evaluate
 * conversation state and context, and executes authoritative actions (replies,
 * proactive follow-ups, capability actions, or human escalations).
 */

export class AutonomousModeratorEngine {
  constructor({
    tenantStore,
    conversationStore,
    auditStore,
    orchestratorForTenant,
    channelSenderForTenant,
    logger = console,
    now = () => new Date().toISOString()
  }) {
    this.tenantStore = tenantStore;
    this.conversationStore = conversationStore;
    this.auditStore = auditStore;
    this.orchestratorForTenant = orchestratorForTenant;
    this.channelSenderForTenant = channelSenderForTenant;
    this.logger = logger;
    this.now = now;
  }

  async moderateTenant(tenant, { dryRun = false, forceAll = false, proactiveLimit = 10 } = {}) {
    const tenantId = tenant.id;
    const threads = this.conversationStore.list(tenantId);
    const orchestrator = this.orchestratorForTenant(tenant);
    const sender = this.channelSenderForTenant(tenant);

    const report = {
      tenantId,
      tenantName: tenant.businessContext?.name ?? tenantId,
      totalThreads: threads.length,
      scannedThreads: 0,
      repliesSent: 0,
      followupsSent: 0,
      humanHandoffs: 0,
      skipped: 0,
      results: []
    };

    for (const thread of threads) {
      report.scannedThreads += 1;

      // If thread is under human control and not forced, skip
      if (thread.control === 'human' && !forceAll) {
        report.skipped += 1;
        report.results.push({
          customerId: thread.customerId,
          customerName: thread.customerName,
          status: 'skipped',
          reason: 'human_control'
        });
        continue;
      }

      const messages = thread.messages ?? [];
      if (messages.length === 0) {
        report.skipped += 1;
        continue;
      }

      const lastMessage = messages[messages.length - 1];
      const isUnansweredInbound = lastMessage.direction === 'inbound';

      // 1. Unanswered Inbound Customer Message
      if (isUnansweredInbound) {
        try {
          const inboundMessage = {
            id: lastMessage.id || crypto.randomUUID(),
            tenantId,
            customerId: thread.customerId,
            customerName: thread.customerName,
            channel: 'whatsapp',
            text: lastMessage.text ?? '',
            timestamp: Math.floor(new Date(lastMessage.at || Date.now()).getTime() / 1000),
            context: messages.slice(-6).map((m) => ({
              direction: m.direction === 'inbound' ? 'user' : 'assistant',
              text: m.text,
              at: m.at
            }))
          };

          const result = await orchestrator.handle(inboundMessage, tenant);

          // If not dry run and action is reply, ensure it's recorded and sent
          if (!dryRun && result.action === 'reply' && result.model?.reply?.trim()) {
            this.conversationStore.recordDecision(inboundMessage, result);
            report.repliesSent += 1;
          } else if (result.action === 'human') {
            report.humanHandoffs += 1;
          }

          report.results.push({
            customerId: thread.customerId,
            customerName: thread.customerName,
            type: 'inbound_resolution',
            action: result.action,
            reply: result.model?.reply ?? null,
            thinking: result.model?.thinking ?? null,
            proactiveOffer: result.model?.proactiveOffer ?? null,
            provider: result.model?.provider ?? null,
            model: result.model?.model ?? null
          });
        } catch (error) {
          this.logger.error?.(`[moderator] error moderating inbound for ${thread.customerId}:`, error);
          report.results.push({
            customerId: thread.customerId,
            customerName: thread.customerName,
            status: 'error',
            error: String(error?.message ?? error)
          });
        }
        continue;
      }

      // 2. Stalled Conversation / Proactive Follow-up Opportunity
      // If last message was assistant or decision and customer didn't reply for some time
      if (!isUnansweredInbound && report.followupsSent < proactiveLimit) {
        try {
          const lastAssistantText = lastMessage.text || '';
          const subagentPrompt = {
            id: `proactive_${crypto.randomUUID().slice(0, 8)}`,
            tenantId,
            customerId: thread.customerId,
            customerName: thread.customerName,
            channel: 'whatsapp',
            text: `[SYSTEM_MODERATOR_PROACTIVE_EVALUATION]: The customer previously talked to us. Last message was: "${lastAssistantText}". Evaluate if a proactive check-in, gentle follow-up, or helpful assistance is beneficial. If so, draft a natural, warm follow-up in customer's language. If no follow-up is needed, set requestedAction to "ignore".`,
            context: messages.slice(-6).map((m) => ({
              direction: m.direction === 'inbound' ? 'user' : 'assistant',
              text: m.text,
              at: m.at
            }))
          };

          const decision = await orchestrator.modelGateway.decide(subagentPrompt, {
            route: tenant.ai?.route ?? 'standard',
            routes: tenant.ai?.routes ?? {},
            businessContext: tenant.businessContext ?? null
          });

          if (decision.requestedAction === 'reply' && decision.reply?.trim()) {
            if (!dryRun) {
              await sender.sendText({
                to: thread.customerId,
                text: decision.reply
              });
              this.conversationStore.appendEvent({
                id: crypto.randomUUID(),
                tenantId,
                customerId: String(thread.customerId),
                customerName: thread.customerName,
                type: 'message',
                direction: 'assistant',
                text: decision.reply,
                at: this.now(),
                action: 'proactive_followup',
                intent: decision.intent ?? 'proactive_reengagement',
                confidence: decision.confidence ?? 0.95,
                thinking: decision.thinking ?? null,
                proactiveOffer: decision.proactiveOffer ?? null,
                modelName: decision.model ?? null,
                provider: decision.provider ?? null
              });
              report.followupsSent += 1;
            }

            report.results.push({
              customerId: thread.customerId,
              customerName: thread.customerName,
              type: 'proactive_followup',
              action: 'proactive_sent',
              reply: decision.reply,
              thinking: decision.thinking ?? null,
              proactiveOffer: decision.proactiveOffer ?? null,
              provider: decision.provider ?? null,
              model: decision.model ?? null
            });
          } else {
            report.results.push({
              customerId: thread.customerId,
              customerName: thread.customerName,
              type: 'proactive_evaluation',
              action: 'no_followup_needed',
              thinking: decision.thinking ?? null
            });
          }
        } catch (error) {
          this.logger.error?.(`[moderator] error in proactive check for ${thread.customerId}:`, error);
        }
      }
    }

    return report;
  }

  async moderateAll({ tenantId = null, dryRun = false, forceAll = false, proactiveLimit = 10 } = {}) {
    const tenants = tenantId
      ? [this.tenantStore.findById(tenantId)].filter(Boolean)
      : this.tenantStore.list();

    const summaries = [];
    for (const tenant of tenants) {
      const summary = await this.moderateTenant(tenant, { dryRun, forceAll, proactiveLimit });
      summaries.push(summary);
    }

    return {
      timestamp: this.now(),
      dryRun,
      tenantsProcessed: summaries.length,
      totalThreads: summaries.reduce((acc, s) => acc + s.totalThreads, 0),
      totalRepliesSent: summaries.reduce((acc, s) => acc + s.repliesSent, 0),
      totalFollowupsSent: summaries.reduce((acc, s) => acc + s.followupsSent, 0),
      totalHumanHandoffs: summaries.reduce((acc, s) => acc + s.humanHandoffs, 0),
      summaries
    };
  }
}
