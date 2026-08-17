import { createHttpServer } from './app.js';
import { loadConfig, resolveTenantSecret } from './config.js';
import { InMemoryTenantStore } from './core/tenant-store.js';
import { InMemoryAuditStore } from './core/audit-store.js';
import { SupervisorOrchestrator } from './core/orchestrator.js';
import { ModelGateway } from './ai/model-gateway.js';
import { OpenAIProvider } from './ai/openai-provider.js';
import { WhatsAppCloudSender } from './channels/whatsapp-cloud.js';

const config = loadConfig();
const tenantStore = new InMemoryTenantStore(config.tenants);
const auditStore = new InMemoryAuditStore();
const runtimes = new Map();

function orchestratorForTenant(tenant) {
  const cached = runtimes.get(tenant.id);
  if (cached) return cached;

  const openaiApiKey = resolveTenantSecret(tenant.ai ?? {}, 'apiKeyEnv', 'OPENAI_API_KEY');
  const whatsappAccessToken = resolveTenantSecret(tenant.whatsapp ?? {}, 'accessTokenEnv', 'META_WHATSAPP_ACCESS_TOKEN');

  const modelGateway = new ModelGateway({
    providers: {
      openai: new OpenAIProvider({ apiKey: openaiApiKey })
    }
  });

  const channelSender = new WhatsAppCloudSender({
    accessToken: whatsappAccessToken,
    phoneNumberId: tenant.phoneNumberId,
    graphVersion: config.meta.graphVersion
  });

  const orchestrator = new SupervisorOrchestrator({ modelGateway, channelSender, auditStore });
  runtimes.set(tenant.id, orchestrator);
  return orchestrator;
}

const server = createHttpServer({
  verifyToken: config.meta.verifyToken,
  appSecret: config.meta.appSecret,
  tenantStore,
  orchestratorForTenant,
  auditStore
});

server.listen(config.port, config.host, () => {
  console.log(`whatsapp-ai-supervisor listening on http://${config.host}:${config.port}`);
});
