import { whatsappTransportMode } from '../channels/whatsapp-linked-device.js';
import {
  configuredCloudConnectorState,
  normalizeLinkedDeviceConnectorState
} from '../connectors/connector-state.js';

function withStatusAlias(state) {
  return { ...state, status: state.state };
}

function unavailableReason(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'worker_timeout';
  if (error?.code === 'worker_http_error') return 'worker_http_error';
  return 'worker_unavailable';
}

async function linkedDeviceState({
  workerUrl,
  sessionId,
  token,
  timeoutMs,
  fetchImpl,
  now
}) {
  try {
    const response = await fetchImpl(
      `${String(workerUrl).replace(/\/$/, '')}/v1/sessions/${encodeURIComponent(sessionId)}`,
      {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeoutMs)
      }
    );
    if (!response.ok) {
      const error = new Error('linked_device_worker_http_error');
      error.code = 'worker_http_error';
      throw error;
    }
    const rawState = await response.json();
    return withStatusAlias(normalizeLinkedDeviceConnectorState(rawState, { now }));
  } catch (error) {
    return withStatusAlias(normalizeLinkedDeviceConnectorState(null, {
      unavailableReason: unavailableReason(error),
      now
    }));
  }
}

function numberConfigurations(tenant) {
  const numbers = tenant.whatsapp?.numbers;
  if (Array.isArray(numbers) && numbers.length > 0) return numbers;

  const mode = whatsappTransportMode(tenant);
  if (mode === 'cloud') {
    return [{
      mode,
      phoneNumberId: tenant.phoneNumberId ?? tenant.whatsapp?.phoneNumberId ?? null,
      legacy: true
    }];
  }

  return [{
    mode,
    sessionId: tenant.whatsapp?.sessionId ?? null,
    workerUrl: tenant.whatsapp?.workerUrl ?? null,
    workerTokenEnv: tenant.whatsapp?.workerTokenEnv ?? null,
    legacy: true
  }];
}

export function createLinkedDeviceStatusProvider({
  tenantStore,
  workerUrlOverride = null,
  resolveSecret,
  timeoutMs = 6000,
  fetchImpl = fetch,
  now = () => new Date().toISOString()
}) {
  return async function linkedDeviceStatus() {
    const results = [];

    for (const tenant of tenantStore.list()) {
      for (const number of numberConfigurations(tenant)) {
        const identity = number.legacy
          ? { tenantId: tenant.id, mode: number.mode }
          : {
              tenantId: tenant.id,
              id: number.id,
              numberId: number.id,
              label: number.label,
              mode: number.mode
            };

        if (number.mode === 'cloud') {
          const state = configuredCloudConnectorState({
            phoneNumberId: number.phoneNumberId ?? null,
            now
          });
          results.push({ ...identity, phoneNumberId: state.phoneNumberId, ...withStatusAlias(state) });
          continue;
        }

        if (number.mode !== 'linked-device' || !number.sessionId) {
          results.push({
            ...identity,
            sessionId: number.sessionId ?? null,
            ...withStatusAlias(normalizeLinkedDeviceConnectorState(null, {
              unavailableReason: 'worker_unavailable',
              now
            }))
          });
          continue;
        }

        const workerUrl = workerUrlOverride
          ?? number.workerUrl
          ?? tenant.whatsapp?.workerUrl
          ?? 'http://127.0.0.1:7441';
        let token;
        try {
          const secretSource = number.workerTokenEnv
            ? { workerTokenEnv: number.workerTokenEnv }
            : (tenant.whatsapp ?? {});
          token = resolveSecret(secretSource, 'workerTokenEnv');
        } catch {
          results.push({
            ...identity,
            sessionId: number.sessionId,
            ...withStatusAlias(normalizeLinkedDeviceConnectorState(null, {
              unavailableReason: 'worker_unavailable',
              now
            }))
          });
          continue;
        }

        const state = await linkedDeviceState({
          workerUrl,
          sessionId: number.sessionId,
          token,
          timeoutMs,
          fetchImpl,
          now
        });
        results.push({
          ...identity,
          sessionId: number.sessionId,
          ...state
        });
      }
    }

    return results;
  };
}
