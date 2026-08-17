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
    orchestratorForTenant,
    logger = console,
    now = () => new Date().toISOString()
  }) {
    this.tenantStore = tenantStore;
    this.conversationStore = conversationStore;
    this.orchestratorForTenant = orchestratorForTenant;
    this.logger = logger;
    this.now = now;
  }

  async moderateTenant(tenant, { dryRun = false, forceAll = false, proactiveLimit = 10 } = {}) {
    const tenantId = tenant.id;
    const threads = this.conversationStore.list(tenantId);
    const orchestrator = this.orchestratorForTenant(tenant);
    const executionMode = dryRun ? 'simulation' : 'live';

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
            context: messages.slice(-6).map((message) => ({
              direction: message.direction === 'inbound' ? 'user' : 'assistant',
              text: message.text,
              at: message.at
            }))
          };

          const result = await orchestrator.handle(inboundMessage, tenant, { executionMode });

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
            wouldAction: result.wouldAction ?? null,
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

      if (!isUnansweredInbound && report.followupsSent < proactiveLimit) {
        try {
          const lastAssistantText = lastMessage.text || '';
          const proactiveMessage = {
            id: `proactive_${crypto.randomUUID().slice(0, 8)}`,
            tenantId,
            customerId: thread.customerId,
            customerName: thread.customerName,
            channel: 'whatsapp',
            text: `[SYSTEM_MODERATOR_PROACTIVE_EVALUATION]: The customer previously talked to us. Last message was: "${lastAssistantText}". Evaluate if a proactive check-in, gentle follow-up, or helpful assistance is beneficial. If so, draft a natural, warm follow-up in customer's language. If no follow-up is needed, set requestedAction to "ignore".`,
            context: messages.slice(-6).map((message) => ({
              direction: message.direction === 'inbound' ? 'user' : 'assistant',
              text: message.text,
              at: message.at
            }))
          };

          const result = await orchestrator.handle(proactiveMessage, tenant, { executionMode });

          if (result.action === 'reply' && result.model?.reply?.trim()) {
            this.conversationStore.recordDecision(proactiveMessage, result);
            report.followupsSent += 1;
            report.results.push({
              customerId: thread.customerId,
              customerName: thread.customerName,
              type: 'proactive_followup',
              action: 'reply',
              reply: result.model.reply,
              proactiveOffer: result.model?.proactiveOffer ?? null,
              provider: result.model?.provider ?? null,
              model: result.model?.model ?? null
            });
          } else if (result.action === 'human') {
            report.humanHandoffs += 1;
            report.results.push({
              customerId: thread.customerId,
              customerName: thread.customerName,
              type: 'proactive_evaluation',
              action: 'human',
              reason: result.reason ?? null,
              reply: result.model?.reply ?? null,
              provider: result.model?.provider ?? null,
              model: result.model?.model ?? null
            });
          } else if (result.action === 'simulation') {
            report.results.push({
              customerId: thread.customerId,
              customerName: thread.customerName,
              type: 'proactive_evaluation',
              action: 'simulation',
              wouldAction: result.wouldAction ?? null,
              reply: result.model?.reply ?? null,
              provider: result.model?.provider ?? null,
              model: result.model?.model ?? null
            });
          } else {
            report.results.push({
              customerId: thread.customerId,
              customerName: thread.customerName,
              type: 'proactive_evaluation',
              action: result.action === 'ignore' ? 'no_followup_needed' : result.action,
              reason: result.reason ?? null,
              reply: result.model?.reply ?? null,
              thinking: result.model?.thinking ?? null,
              proactiveOffer: result.model?.proactiveOffer ?? null,
              provider: result.model?.provider ?? null,
              model: result.model?.model ?? null
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
      totalThreads: summaries.reduce((total, summary) => total + summary.totalThreads, 0),
      totalRepliesSent: summaries.reduce((total, summary) => total + summary.repliesSent, 0),
      totalFollowupsSent: summaries.reduce((total, summary) => total + summary.followupsSent, 0),
      totalHumanHandoffs: summaries.reduce((total, summary) => total + summary.humanHandoffs, 0),
      summaries
    };
  }
}
