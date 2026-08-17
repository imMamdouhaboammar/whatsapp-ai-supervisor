import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONNECTOR_STATES,
  normalizeLinkedDeviceConnectorState,
  configuredCloudConnectorState
} from '../src/connectors/connector-state.js';

test('connector lifecycle vocabulary is intentionally small and stable', () => {
  assert.deepEqual(CONNECTOR_STATES, [
    'disabled', 'disconnected', 'connecting', 'qr_required', 'ready', 'degraded', 'failed'
  ]);
});

test('linked-device raw worker states map to canonical lifecycle and fixed reason codes', () => {
  const cases = [
    ['starting', 'connecting', 'session_starting'],
    ['pairing', 'qr_required', 'pairing_required'],
    ['authenticated', 'connecting', 'authenticated_waiting_ready'],
    ['ready', 'ready', 'session_ready'],
    ['disconnected', 'disconnected', 'session_disconnected'],
    ['auth-failure', 'failed', 'authentication_failed'],
    ['error', 'failed', 'session_failed'],
    ['unknown-library-state', 'degraded', 'unknown_worker_state']
  ];
  for (const [rawStatus, state, reasonCode] of cases) {
    const normalized = normalizeLinkedDeviceConnectorState({ status: rawStatus, reconnectAttempt: 2 });
    assert.equal(normalized.state, state);
    assert.equal(normalized.reasonCode, reasonCode);
    assert.equal(normalized.reconnectAttempt, 2);
    assert.equal(Object.hasOwn(normalized, 'lastError'), false);
  }
});

test('pairing material is exposed only while pairing is actually required', () => {
  const pairing = normalizeLinkedDeviceConnectorState({ status: 'pairing', qr: 'secret-qr', pairingCode: '123-456' });
  assert.equal(pairing.qr, 'secret-qr');
  assert.equal(pairing.pairingCode, '123-456');

  const ready = normalizeLinkedDeviceConnectorState({ status: 'ready', qr: 'stale-qr', pairingCode: 'stale-code' });
  assert.equal(ready.qr, null);
  assert.equal(ready.pairingCode, null);
});

test('worker unavailability becomes degraded with a bounded machine-readable reason, not raw exception detail', () => {
  const normalized = normalizeLinkedDeviceConnectorState(null, { unavailableReason: 'worker_timeout' });
  assert.equal(normalized.state, 'degraded');
  assert.equal(normalized.reasonCode, 'worker_timeout');
  assert.equal(Object.values(normalized).join(' ').includes('private'), false);
});

test('Cloud API configuration is not reported as ready without a health observation', () => {
  const state = configuredCloudConnectorState({ phoneNumberId: 'pn-1' });
  assert.equal(state.state, 'degraded');
  assert.equal(state.reasonCode, 'health_unverified');
  assert.equal(state.phoneNumberId, 'pn-1');
  assert.ok(Date.parse(state.observedAt));
});
