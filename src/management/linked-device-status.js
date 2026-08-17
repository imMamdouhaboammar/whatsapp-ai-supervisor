import { whatsappTransportMode } from '../channels/whatsapp-linked-device.js';

export function createLinkedDeviceStatusProvider({ tenantStore, workerUrlOverride = null, resolveSecret, timeoutMs = 6000 }) {
  return async function linkedDeviceStatus() {
    const list = tenantStore.list();
    const results = [];

    for (const tenant of list) {
      // Check if tenant has multiple numbers configured
      const numbers = Array.isArray(tenant.whatsapp?.numbers) && tenant.whatsapp.numbers.length > 0
        ? tenant.whatsapp.numbers
        : null;

      if (numbers) {
        for (const num of numbers) {
          if (num.mode === 'cloud') {
            results.push({
              tenantId: tenant.id,
              numberId: num.id,
              label: num.label,
              mode: 'cloud',
              status: 'configured',
              phoneNumberId: num.phoneNumberId ?? null
            });
          } else if (num.mode === 'linked-device' && num.sessionId) {
            const sessionId = num.sessionId;
            const workerUrl = workerUrlOverride ?? num.workerUrl ?? tenant.whatsapp?.workerUrl ?? 'http://127.0.0.1:7441';
            try {
              const token = resolveSecret(num.workerTokenEnv ? { workerTokenEnv: num.workerTokenEnv } : (tenant.whatsapp ?? {}), 'workerTokenEnv');
              const response = await fetch(`${String(workerUrl).replace(/\/$/, '')}/v1/sessions/${encodeURIComponent(sessionId)}`, {
                headers: { authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(timeoutMs)
              });
              if (!response.ok) throw new Error(`worker_http_${response.status}`);
              const state = await response.json();
              results.push({
                tenantId: tenant.id,
                numberId: num.id,
                label: num.label,
                mode: 'linked-device',
                sessionId,
                status: state.status ?? 'unknown',
                qr: state.qr ?? null,
                pairingCode: state.pairingCode ?? null,
                reconnectAttempt: state.reconnectAttempt ?? 0,
                lastError: state.lastError ?? null
              });
            } catch (error) {
              results.push({
                tenantId: tenant.id,
                numberId: num.id,
                label: num.label,
                mode: 'linked-device',
                sessionId,
                status: 'unavailable',
                qr: null,
                pairingCode: null,
                reconnectAttempt: 0,
                lastError: String(error?.message ?? error).slice(0, 200)
              });
            }
          }
        }
        continue;
      }

      // Legacy fallback (flat tenant format)
      const mode = whatsappTransportMode(tenant);
      if (mode === 'cloud') {
        results.push({ tenantId: tenant.id, mode, status: 'configured', phoneNumberId: tenant.phoneNumberId ?? null });
        continue;
      }

      const sessionId = tenant.whatsapp?.sessionId;
      const workerUrl = workerUrlOverride ?? tenant.whatsapp?.workerUrl ?? 'http://127.0.0.1:7441';
      try {
        const token = resolveSecret(tenant.whatsapp ?? {}, 'workerTokenEnv');
        const response = await fetch(`${String(workerUrl).replace(/\/$/, '')}/v1/sessions/${encodeURIComponent(sessionId)}`, {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(timeoutMs)
        });
        if (!response.ok) throw new Error(`worker_http_${response.status}`);
        const state = await response.json();
        results.push({
          tenantId: tenant.id,
          mode,
          sessionId,
          status: state.status ?? 'unknown',
          qr: state.qr ?? null,
          pairingCode: state.pairingCode ?? null,
          reconnectAttempt: state.reconnectAttempt ?? 0,
          lastError: state.lastError ?? null
        });
      } catch (error) {
        results.push({
          tenantId: tenant.id,
          mode,
          sessionId,
          status: 'unavailable',
          qr: null,
          pairingCode: null,
          reconnectAttempt: 0,
          lastError: String(error?.message ?? error).slice(0, 200)
        });
      }
    }

    return results;
  };
}
