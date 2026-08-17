import { createHttpServer } from './app.js';
import { loadConfig, resolveTenantSecret } from './config.js';
import { InMemoryTenantStore } from './core/tenant-store.js';
import { FileAuditStore } from './core/file-audit-store.js';
import { FileClaimStore } from './core/file-claim-store.js';
import { SupervisorOrchestrator } from './core/orchestrator.js';
import { ModelGateway } from './ai/model-gateway.js';
import { OpenAIProvider } from './ai/openai-provider.js';
import { createWhatsAppSender } from './channels/whatsapp-sender-factory.js';
import { createBrowserRuntime } from './browser/runtime-factory.js';
import { ActionGateway } from './actions/action-gateway.js';
import { collectReadiness } from './runtime/readiness.js';

const config = loadConfig();
const tenantStore = new InMemoryTenantStore(config.tenants);
const auditStore = new FileAuditStore({ dataDir: config.dataDir });
const claimStore = new FileClaimStore({ dataDir: config.dataDir });
const browserRuntime = createBrowserRuntime(config.browser);
const actionGateway = browserRuntime ? new ActionGateway({ browserRuntime }) : null;
const runtimes = new Map();

function orchestratorForTenant(tenant) {
  const cached = runtimes.get(tenant.id);
  if (cached) return cached;

  const openaiApiKey = resolveTenantSecret(tenant.ai ?? {}, 'apiKeyEnv', 'OPENAI_API_KEY');
  const modelGateway = new ModelGateway({
    providers: {
      openai: new OpenAIProvider({ apiKey: openaiApiKey })
    }
  });

  const channelSender = createWhatsAppSender({
    tenant,
    metaGraphVersion: config.meta.graphVersion,
    resolveSecret: resolveTenantSecret,
    linkedDeviceWorkerUrlOverride: config.linkedDevice.workerUrlOverride
  });

  const orchestrator = new SupervisorOrchestrator({ modelGateway, channelSender, auditStore, actionGateway });
  runtimes.set(tenant.id, orchestrator);
  return orchestrator;
}

const server = createHttpServer({
  verifyToken: config.meta.verifyToken,
  appSecret: config.meta.appSecret,
  linkedDeviceIngressToken: config.linkedDevice.ingressToken,
  tenantStore,
  orchestratorForTenant,
  auditStore,
  claimStore,
  readiness: () => collectReadiness({
    dataDir: config.dataDir,
    tenantCount: config.tenants.length,
    browserRuntime,
    browserRequired: config.browser.required
  })
});

server.listen(config.port, config.host, () => {
  console.log(`whatsapp-ai-supervisor listening on http://${config.host}:${config.port}`);
});
