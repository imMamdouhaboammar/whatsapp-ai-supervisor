export type TransportMode = 'cloud' | 'linked-device';
export type ConversationControl = 'ai' | 'human';

export interface Tenant {
  id: string;
  name: string;
  whatsapp: {
    mode: TransportMode;
    phoneNumberId: string | null;
    sessionId: string | null;
    allowGroups: boolean;
  };
  ai: { provider: string; route: string; model: string | null };
  shadowMode: boolean;
  policy: { ruleCount: number; browserCapabilities: number };
}

export interface WhatsAppSession {
  tenantId: string;
  mode: TransportMode;
  status: string;
  phoneNumberId?: string | null;
  sessionId?: string | null;
  qr?: string | null;
  pairingCode?: string | null;
  reconnectAttempt?: number;
  lastError?: string | null;
}

export interface AuditEvent {
  id: string;
  tenantId: string;
  customerId: string;
  messageId?: string;
  at: string;
  model?: { intent?: string; confidence?: number; reply?: string; requestedAction?: string } | null;
  permission?: { action?: string; reason?: string } | null;
  result?: { action?: string; reason?: string; wouldAction?: string | null } | null;
}

export interface ConversationMessage {
  id: string;
  tenantId: string;
  customerId: string;
  customerName?: string;
  direction: 'inbound' | 'assistant' | 'human';
  type: 'message' | 'decision';
  text: string | null;
  at: string;
  action?: string | null;
  wouldAction?: string | null;
  reason?: string | null;
  intent?: string | null;
  confidence?: number | null;
}

export interface Conversation {
  tenantId: string;
  customerId: string;
  customerName: string;
  control: ConversationControl;
  lastActivityAt: string;
  preview: string;
  messages: ConversationMessage[];
}

export interface Overview {
  generatedAt: string;
  ready: boolean;
  readiness: Record<string, unknown>;
  metrics: {
    tenants: number;
    whatsappOnline: number;
    conversations: number;
    processedToday: number;
    autonomousToday: number;
    humanToday: number;
    shadowToday: number;
    failedActionsToday: number;
  };
  tenants: Array<Tenant & { connection: WhatsAppSession }>;
  recentActivity: AuditEvent[];
}

export interface ActionEvent {
  id: string;
  tenantId: string;
  customerId: string;
  at: string;
  intent: string | null;
  status: 'completed' | 'failed' | 'requested';
  action: string | null;
  reason: string | null;
  confidence: number | null;
}

export interface RuntimeInfo {
  service: string;
  ui: string;
  tenantCount: number;
  metaEnabled: boolean;
  linkedDeviceEnabled: boolean;
  browser: { mode: string; engine: string; required: boolean };
  managementAuth: boolean;
  readiness: Record<string, unknown> & { ready?: boolean; status?: string };
}
