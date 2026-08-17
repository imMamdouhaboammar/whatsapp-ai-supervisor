import type { ActionEvent, AuditEvent, Conversation, ConversationControl, Overview, RuntimeInfo, Tenant, TenantCreatePayload, TenantUpdatePayload, WhatsAppNumber, WhatsAppSession } from './types';

const TOKEN_KEY = 'was-management-token';

export function managementToken() {
  return sessionStorage.getItem(TOKEN_KEY) ?? '';
}

export function setManagementToken(token: string) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = managementToken();
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body) headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(path, { ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error ?? `HTTP ${response.status}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return body as T;
}

export const api = {
  session: () => request<{ authenticated: boolean; authRequired: boolean }>('/api/management/session'),
  overview: () => request<Overview>('/api/management/overview'),

  // Tenants — list, CRUD
  tenants: () => request<{ tenants: Tenant[] }>('/api/management/tenants'),
  getTenant: (id: string) => request<{ tenant: Tenant }>(`/api/management/tenants/${encodeURIComponent(id)}`),
  createTenant: (payload: TenantCreatePayload) => request<{ tenant: Tenant }>('/api/management/tenants', {
    method: 'POST',
    body: JSON.stringify(payload)
  }),
  updateTenant: (id: string, patch: TenantUpdatePayload) => request<{ tenant: Tenant }>(`/api/management/tenants/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(patch)
  }),
  deleteTenant: (id: string) => request<{ deleted: boolean; id: string }>(`/api/management/tenants/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  }),

  // WhatsApp numbers (multi-number per tenant)
  getWhatsAppNumbers: (tenantId: string) => request<{ tenantId: string; numbers: WhatsAppNumber[] }>(`/api/management/tenants/${encodeURIComponent(tenantId)}/numbers`),
  addWhatsAppNumber: (tenantId: string, number: Omit<WhatsAppNumber, 'id'> & { id?: string }) => request<{ tenant: Tenant; number: WhatsAppNumber }>(`/api/management/tenants/${encodeURIComponent(tenantId)}/numbers`, {
    method: 'POST',
    body: JSON.stringify(number)
  }),
  removeWhatsAppNumber: (tenantId: string, numberId: string) => request<{ deleted: boolean; numberId: string; tenant: Tenant }>(`/api/management/tenants/${encodeURIComponent(tenantId)}/numbers/${encodeURIComponent(numberId)}`, {
    method: 'DELETE'
  }),

  // WhatsApp sessions
  whatsapp: () => request<{ sessions: WhatsAppSession[] }>('/api/management/whatsapp'),

  conversations: (tenantId: string) => request<{ conversations: Conversation[] }>(`/api/management/conversations?tenantId=${encodeURIComponent(tenantId)}`),
  setConversationControl: (tenantId: string, customerId: string, mode: ConversationControl) => request<{ mode: ConversationControl }>('/api/management/conversations/control', {
    method: 'POST',
    body: JSON.stringify({ tenantId, customerId, mode })
  }),
  sendManual: (tenantId: string, customerId: string, text: string) => request<{ sent: boolean }>('/api/management/conversations/send', {
    method: 'POST',
    body: JSON.stringify({ tenantId, customerId, text })
  }),
  audit: (tenantId = '') => request<{ events: AuditEvent[] }>(`/api/management/audit?limit=300${tenantId ? `&tenantId=${encodeURIComponent(tenantId)}` : ''}`),
  actions: (tenantId = '') => request<{ actions: ActionEvent[] }>(`/api/management/actions${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''}`),
  runtime: () => request<RuntimeInfo>('/api/management/runtime'),
  triggerModerator: (payload: { tenantId?: string; dryRun?: boolean; forceAll?: boolean; proactiveLimit?: number } = {}) =>
    request<{
      timestamp: string;
      dryRun: boolean;
      totalThreads: number;
      totalRepliesSent: number;
      totalFollowupsSent: number;
      totalHumanHandoffs: number;
      summaries: any[];
    }>('/api/management/moderator/trigger', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
};

