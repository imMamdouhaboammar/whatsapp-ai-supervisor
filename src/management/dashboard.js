import { whatsappTransportMode } from '../channels/whatsapp-linked-device.js';

function tenantName(tenant) {
  return tenant.businessContext?.name || tenant.businessContext?.brandName || tenant.name || tenant.id;
}

export function sanitizeTenant(tenant) {
  const mode = whatsappTransportMode(tenant);
  const route = tenant.ai?.route ?? 'standard';
  const routeConfig = tenant.ai?.routes?.[route];
  const primaryModel = Array.isArray(routeConfig) ? routeConfig[0] : routeConfig;
  return {
    id: tenant.id,
    name: tenantName(tenant),
    whatsapp: {
      mode,
      phoneNumberId: mode === 'cloud' ? tenant.phoneNumberId ?? null : null,
      sessionId: mode === 'linked-device' ? tenant.whatsapp?.sessionId ?? null : null,
      allowGroups: mode === 'linked-device' ? tenant.whatsapp?.allowGroups === true : false
    },
    ai: {
      provider: tenant.ai?.provider ?? primaryModel?.provider ?? 'openai',
      route,
      model: tenant.ai?.model ?? primaryModel?.model ?? null
    },
    shadowMode: tenant.shadowMode === true,
    policy: {
      ruleCount: Array.isArray(tenant.policy?.rules) ? tenant.policy.rules.length : 0,
      browserCapabilities: (tenant.policy?.rules ?? []).filter((rule) => rule.action === 'act' && rule.capability?.type === 'browser').length
    }
  };
}

export function recentAuditEvents(tenantStore, auditStore, tenantId = null, limit = 200) {
  const tenants = tenantId ? [tenantStore.findById(tenantId)].filter(Boolean) : tenantStore.list();
  return tenants
    .flatMap((tenant) => auditStore.list(tenant.id))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, Math.min(Math.max(Number(limit) || 200, 1), 500));
}

export function buildOverview({ tenantStore, auditStore, conversationStore, readinessReport, whatsappSessions, now = new Date() }) {
  const tenants = tenantStore.list();
  const day = now.toISOString().slice(0, 10);
  const events = recentAuditEvents(tenantStore, auditStore, null, 5000).filter((event) => String(event.at).startsWith(day));
  const conversations = tenants.flatMap((tenant) => conversationStore.list(tenant.id));
  const sessionByTenant = new Map((whatsappSessions ?? []).map((session) => [session.tenantId, session]));

  return {
    generatedAt: new Date().toISOString(),
    ready: readinessReport?.ready ?? true,
    readiness: readinessReport ?? { ready: true, status: 'ready' },
    metrics: {
      tenants: tenants.length,
      whatsappOnline: tenants.filter((tenant) => {
        const session = sessionByTenant.get(tenant.id);
        if (whatsappTransportMode(tenant) === 'cloud') return session?.status !== 'unavailable';
        return session?.status === 'ready';
      }).length,
      conversations: conversations.length,
      processedToday: events.length,
      autonomousToday: events.filter((event) => ['reply', 'act'].includes(event.result?.action)).length,
      humanToday: events.filter((event) => event.result?.action === 'human').length,
      shadowToday: events.filter((event) => event.result?.action === 'shadow').length,
      failedActionsToday: events.filter((event) => event.result?.action === 'human' && event.result?.reason === 'action_failed').length
    },
    tenants: tenants.map((tenant) => ({
      ...sanitizeTenant(tenant),
      connection: sessionByTenant.get(tenant.id) ?? { tenantId: tenant.id, mode: whatsappTransportMode(tenant), status: 'unknown' }
    })),
    recentActivity: events.slice(0, 8)
  };
}

export function buildActions(events) {
  return events
    .filter((event) => event.result?.action === 'act' || event.result?.reason === 'action_failed' || event.model?.requestedAction === 'act')
    .map((event) => ({
      id: event.id,
      tenantId: event.tenantId,
      customerId: event.customerId,
      at: event.at,
      intent: event.model?.intent ?? null,
      status: event.result?.action === 'act' ? 'completed' : event.result?.reason === 'action_failed' ? 'failed' : 'requested',
      action: event.result?.action ?? null,
      reason: event.result?.reason ?? null,
      confidence: event.model?.confidence ?? null
    }));
}
