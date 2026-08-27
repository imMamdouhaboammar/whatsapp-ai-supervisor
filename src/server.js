import { createHttpServer } from './app.js';
import { resolve } from 'node:path';
import { loadConfig, resolveTenantSecret } from './config.js';
import { InMemoryTenantStore } from './core/tenant-store.js';
import { FileAuditStore } from './core/file-audit-store.js';
import { FileConversationStore } from './core/file-conversation-store.js';
import { SupervisorOrchestrator } from './core/orchestrator.js';
import { ModelGateway } from './ai/model-gateway.js';
import { OpenAIProvider } from './ai/openai-provider.js';
import { AnthropicProvider } from './ai/anthropic-provider.js';
import { AgentRouterProvider } from './ai/agentrouter-provider.js';
import { createWhatsAppSender } from './channels/whatsapp-sender-factory.js';
import { createBrowserRuntime } from './browser/runtime-factory.js';
import { ActionGateway } from './actions/action-gateway.js';
import { collectReadiness } from './runtime/readiness.js';
import { TenantRuntimeCache } from './runtime/tenant-runtime-cache.js';
import { createDurableServiceLifecycle } from './runtime/durable-service-lifecycle.js';
import { createStorageRuntime } from './storage/storage-runtime.js';
import { createInboundProcessingRuntime } from './jobs/durable-inbound-runtime.js';
import { createManagementRouter } from './management/router.js';
import { createLinkedDeviceStatusProvider } from './management/linked-device-status.js';
import { AutonomousModeratorEngine } from './ai/moderator-engine.js';
import { SseBroadcaster } from './realtime/sse-broadcaster.js';

const config = loadConfig();
const sseBroadcaster = new SseBroadcaster();
const tenantsFile = resolve(process.env.TENANTS_FILE ?? './config/tenants.json');
const tenantStore = new InMemoryTenantStore(config.tenants, tenantsFile);
const auditStore = new FileAuditStore({ dataDir: config.dataDir });
const conversationStore = new FileConversationStore({ dataDir: config.dataDir });
const storageRuntime = await createStorageRuntime({ ...config.storage, dataDir: config.dataDir });
const browserRuntime = createBrowserRuntime(config.browser);
const actionGateway = browserRuntime ? new ActionGateway({ browserRuntime }) : null;
const runtimeCache = new TenantRuntimeCache();

function senderForTenant(tenant) {
  return runtimeCache.senderFor(tenant.id, () => createWhatsAppSender({
    tenant,
    metaGraphVersion: config.meta.graphVersion,
    resolveSecret: resolveTenantSecret,
    linkedDeviceWorkerUrlOverride: config.linkedDevice.workerUrlOverride
  }));
}

function buildModelProviders(tenant) {
  const providers = {};

  try {
    const openaiApiKey = resolveTenantSecret(tenant.ai ?? {}, 'apiKeyEnv', 'OPENAI_API_KEY');
    providers.openai = new OpenAIProvider({ apiKey: openaiApiKey });
  } catch {}

  const tabitokenKeys = process.env.TABITOKEN_API_KEYS || process.env.TABITOKEN_API_KEY || null;
  if (tabitokenKeys) {
    const anthropic = new AnthropicProvider({
      apiKeys: tabitokenKeys.split(',').map((key) => key.trim()).filter(Boolean),
      baseUrl: process.env.TABITOKEN_BASE_URL || 'https://tabitoken.com/v1'
    });
    providers.tabitoken = anthropic;
    providers.anthropic = anthropic;
  }

  const agentrouterKeys = process.env.AGENTROUTER_API_KEYS || process.env.AGENTROUTER_API_KEY || null;
  if (agentrouterKeys) {
    providers.agentrouter = new AgentRouterProvider({
      apiKeys: agentrouterKeys.split(',').map((key) => key.trim()).filter(Boolean),
      baseUrl: process.env.AGENTROUTER_BASE_URL || 'https://agentrouter.org/v1'
    });
  }

  return providers;
}

function orchestratorForTenant(tenant) {
  return runtimeCache.runtimeFor(tenant.id, () => {
    const modelGateway = new ModelGateway({ providers: buildModelProviders(tenant) });
    return new SupervisorOrchestrator({
      modelGateway,
      channelSender: senderForTenant(tenant),
      auditStore,
      actionGateway,
      conversationStore
    });
  });
}

const inboundProcessing = createInboundProcessingRuntime({
  tenantStore,
  orchestratorForTenant,
  auditStore,
  conversationStore,
  ownershipStore: storageRuntime.ownershipStore,
  domainEventStore: storageRuntime.domainEventStore,
  sseBroadcaster,
  jobQueue: storageRuntime.jobQueue
});
const durableLifecycle = createDurableServiceLifecycle({
  worker: inboundProcessing.worker,
  storageRuntime
});

const readiness = () => collectReadiness({
  dataDir: config.dataDir,
  tenantCount: tenantStore.list().length,
  browserRuntime,
  browserRequired: config.browser.required,
  storageProbe: storageRuntime.probe
});

const linkedDeviceStatus = createLinkedDeviceStatusProvider({
  tenantStore,
  workerUrlOverride: config.linkedDevice.workerUrlOverride,
  resolveSecret: resolveTenantSecret
});

const moderatorEngine = new AutonomousModeratorEngine({
  tenantStore,
  conversationStore,
  orchestratorForTenant
});

const managementRouter = createManagementRouter({
  token: config.management.token,
  tenantStore,
  auditStore,
  conversationStore,
  readiness,
  linkedDeviceStatus,
  manualSend: (tenant, message) => senderForTenant(tenant).sendText(message),
  onTenantChanged: (tenantId) => runtimeCache.invalidate(tenantId),
  moderatorEngine,
  sseBroadcaster,
  runtimeSummary: () => ({
    service: 'whatsapp-ai-supervisor',
    ui: 'material3-operator',
    tenantCount: tenantStore.list().length,
    storage: storageRuntime.backend,
    metaEnabled: config.meta.enabled,
    linkedDeviceEnabled: config.linkedDevice.enabled,
    browser: {
      mode: config.browser.mode,
      engine: config.browser.engine,
      required: config.browser.required
    }
  })
});

const server = createHttpServer({
  verifyToken: config.meta.verifyToken,
  appSecret: config.meta.appSecret,
  linkedDeviceIngressToken: config.linkedDevice.ingressToken,
  managementToken: config.management.token,
  tenantStore,
  orchestratorForTenant,
  auditStore,
  claimStore: storageRuntime.claimStore,
  domainEventStore: storageRuntime.domainEventStore,
  jobQueue: storageRuntime.jobQueue,
  inboundDecisionHandler: inboundProcessing.decisionHandler,
  readiness,
  conversationStore,
  managementRouter,
  sseBroadcaster,
  uiDir: config.uiDir
});

server.listen(config.port, config.host, () => {
  durableLifecycle.start();
  console.log(`whatsapp-ai-supervisor listening on http://${config.host}:${config.port}`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`whatsapp-ai-supervisor shutting down (${signal})`);
  await new Promise((resolveClose) => server.close(() => resolveClose()));
  sseBroadcaster.close();
  await durableLifecycle.stop();
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    shutdown(signal)
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}
