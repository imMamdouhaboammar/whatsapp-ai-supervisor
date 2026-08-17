export const CONNECTOR_STATES = Object.freeze([
  'disabled',
  'disconnected',
  'connecting',
  'qr_required',
  'ready',
  'degraded',
  'failed'
]);

const LINKED_DEVICE_STATE_MAP = Object.freeze({
  starting: ['connecting', 'session_starting'],
  pairing: ['qr_required', 'pairing_required'],
  authenticated: ['connecting', 'authenticated_waiting_ready'],
  ready: ['ready', 'session_ready'],
  disconnected: ['disconnected', 'session_disconnected'],
  'auth-failure': ['failed', 'authentication_failed'],
  error: ['failed', 'session_failed']
});

const PUBLIC_UNAVAILABLE_REASONS = new Set([
  'worker_timeout',
  'worker_http_error',
  'worker_unavailable'
]);

function observedAt(now) {
  const value = typeof now === 'function' ? now() : new Date().toISOString();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

export function normalizeLinkedDeviceConnectorState(rawState, {
  unavailableReason = null,
  now = () => new Date().toISOString()
} = {}) {
  if (!rawState) {
    const reasonCode = PUBLIC_UNAVAILABLE_REASONS.has(unavailableReason)
      ? unavailableReason
      : 'worker_unavailable';
    return Object.freeze({
      state: 'degraded',
      reasonCode,
      observedAt: observedAt(now),
      qr: null,
      pairingCode: null,
      reconnectAttempt: 0
    });
  }

  const rawStatus = String(rawState.status ?? '').trim().toLowerCase();
  const [state, reasonCode] = LINKED_DEVICE_STATE_MAP[rawStatus]
    ?? ['degraded', 'unknown_worker_state'];
  const pairingRequired = state === 'qr_required';
  const reconnectAttempt = Number.isFinite(Number(rawState.reconnectAttempt))
    ? Math.max(0, Math.trunc(Number(rawState.reconnectAttempt)))
    : 0;

  return Object.freeze({
    state,
    reasonCode,
    observedAt: observedAt(now),
    qr: pairingRequired && typeof rawState.qr === 'string' && rawState.qr ? rawState.qr : null,
    pairingCode: pairingRequired && typeof rawState.pairingCode === 'string' && rawState.pairingCode
      ? rawState.pairingCode
      : null,
    reconnectAttempt
  });
}

export function configuredCloudConnectorState({
  phoneNumberId = null,
  now = () => new Date().toISOString()
} = {}) {
  return Object.freeze({
    state: 'degraded',
    reasonCode: 'health_unverified',
    observedAt: observedAt(now),
    phoneNumberId: phoneNumberId ?? null
  });
}
