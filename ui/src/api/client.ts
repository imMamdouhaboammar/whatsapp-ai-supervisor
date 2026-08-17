import type { ActionEvent, AuditEvent, Conversation, ConversationControl, Overview, RuntimeInfo, Tenant, WhatsAppSession } from './types';

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
  tenants: () => request<{ tenants: Tenant[] }>('/api/management/tenants'),
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
  runtime: () => request<RuntimeInfo>('/api/management/runtime')
};
