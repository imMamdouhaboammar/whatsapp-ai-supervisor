import { whatsappTransportMode } from '../channels/whatsapp-linked-device.js';

export function createLinkedDeviceStatusProvider({ tenantStore, workerUrlOverride = null, resolveSecret, timeoutMs = 2500 }) {
  return async function linkedDeviceStatus() {
    return Promise.all(tenantStore.list().map(async (tenant) => {
      const mode = whatsappTransportMode(tenant);
      if (mode === 'cloud') {
        return { tenantId: tenant.id, mode, status: 'configured', phoneNumberId: tenant.phoneNumberId ?? null };
      }

      const sessionId = tenant.whatsapp?.sessionId;
      const workerUrl = workerUrlOverride ?? tenant.whatsapp?.workerUrl;
      try {
        const token = resolveSecret(tenant.whatsapp ?? {}, 'workerTokenEnv');
        const response = await fetch(`${String(workerUrl).replace(/\/$/, '')}/v1/sessions/${encodeURIComponent(sessionId)}`, {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(timeoutMs)
        });
        if (!response.ok) throw new Error(`worker_http_${response.status}`);
        const state = await response.json();
        return {
          tenantId: tenant.id,
          mode,
          sessionId,
          status: state.status ?? 'unknown',
          qr: state.qr ?? null,
          pairingCode: state.pairingCode ?? null,
          reconnectAttempt: state.reconnectAttempt ?? 0,
          lastError: state.lastError ?? null
        };
      } catch (error) {
        return {
          tenantId: tenant.id,
          mode,
          sessionId,
          status: 'unavailable',
          qr: null,
          pairingCode: null,
          reconnectAttempt: 0,
          lastError: String(error?.message ?? error).slice(0, 200)
        };
      }
    }));
  };
}
