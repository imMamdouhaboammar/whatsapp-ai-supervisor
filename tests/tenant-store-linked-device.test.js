import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryTenantStore } from '../src/core/tenant-store.js';

test('tenant store resolves linked-device tenant by session id', () => {
  const tenant = { id: 'a', whatsapp: { mode: 'linked-device', sessionId: 'acme-sales' } };
  const store = new InMemoryTenantStore([tenant]);
  assert.equal(store.findByLinkedDeviceSessionId('acme-sales'), tenant);
});

test('tenant store rejects duplicate linked-device session ids', () => {
  assert.throws(() => new InMemoryTenantStore([
    { id: 'a', whatsapp: { mode: 'linked-device', sessionId: 'same' } },
    { id: 'b', whatsapp: { mode: 'linked-device', sessionId: 'same' } }
  ]), /Duplicate linked-device session id/);
});
