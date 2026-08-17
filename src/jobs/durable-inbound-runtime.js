import { DurableJobWorker } from './durable-job-worker.js';
import { createInboundDecisionHandler, createProcessInboundJobHandler } from './inbound-decision-handler.js';

export function createInboundProcessingRuntime({
  tenantStore,
  orchestratorForTenant,
  auditStore,
  conversationStore = null,
  domainEventStore = null,
  sseBroadcaster = null,
  jobQueue = null,
  pollMs = 500
}) {
  const decisionHandler = createInboundDecisionHandler({
    orchestratorForTenant,
    auditStore,
    conversationStore,
    domainEventStore,
    sseBroadcaster
  });

  if (!jobQueue) return { decisionHandler, worker: null };

  const processInbound = createProcessInboundJobHandler({ tenantStore, decisionHandler });
  const worker = new DurableJobWorker({
    queue: jobQueue,
    handlers: { process_inbound: processInbound },
    pollMs
  });
  return { decisionHandler, worker };
}
