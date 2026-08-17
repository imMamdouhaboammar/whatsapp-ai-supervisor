import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InMemoryTenantStore } from '../src/core/tenant-store.js';

test('InMemoryTenantStore CRUD and multi-number functionality', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'tenant-crud-test-'));
  const filePath = join(tmpDir, 'tenants.json');

  try {
    const initialTenants = [
      {
        id: 'tenant-1',
        businessContext: { name: 'Tenant One' },
        whatsapp: { mode: 'linked-device', sessionId: 's1' }
      }
    ];

    const store = new InMemoryTenantStore(initialTenants, filePath);

    // 1. Initial lookup
    assert.equal(store.findById('tenant-1').businessContext.name, 'Tenant One');
    assert.equal(store.findByLinkedDeviceSessionId('s1').id, 'tenant-1');

    // 2. Create new tenant
    const created = store.create({
      id: 'tenant-2',
      businessContext: { name: 'Tenant Two' },
      whatsapp: {
        mode: 'cloud',
        phoneNumberId: 'phone-99',
        numbers: [
          { id: 'num-1', label: 'Support', mode: 'cloud', phoneNumberId: 'phone-99' },
          { id: 'num-2', label: 'Sales', mode: 'linked-device', sessionId: 's2-sales' }
        ]
      }
    });

    assert.equal(created.id, 'tenant-2');
    assert.equal(store.list().length, 2);
    assert.equal(store.findByPhoneNumberId('phone-99').id, 'tenant-2');
    assert.equal(store.findByLinkedDeviceSessionId('s2-sales').id, 'tenant-2');

    // 3. Add number to existing tenant
    const { number } = store.addWhatsAppNumber('tenant-1', {
      label: 'Secondary',
      mode: 'linked-device',
      sessionId: 's1-sec'
    });

    assert.equal(number.sessionId, 's1-sec');
    assert.equal(store.findByLinkedDeviceSessionId('s1-sec').id, 'tenant-1');

    // 4. Update tenant
    const updated = store.update('tenant-1', {
      businessContext: { name: 'Tenant One Updated' }
    });
    assert.equal(updated.businessContext.name, 'Tenant One Updated');

    // 5. Remove number
    store.removeWhatsAppNumber('tenant-1', number.id);
    assert.equal(store.findByLinkedDeviceSessionId('s1-sec'), null);

    // 6. Persist to disk
    store.persist();
    const persisted = JSON.parse(readFileSync(filePath, 'utf8'));
    assert.equal(persisted.length, 2);
    const t1 = persisted.find((t) => t.id === 'tenant-1');
    const t2 = persisted.find((t) => t.id === 'tenant-2');
    assert.ok(t1);
    assert.ok(t2);
    assert.equal(t1.businessContext.name, 'Tenant One Updated');
    assert.equal(t2.id, 'tenant-2');

    // 7. Delete tenant
    store.delete('tenant-1');
    assert.equal(store.list().length, 1);
    assert.equal(store.findById('tenant-1'), null);
    assert.equal(store.findByLinkedDeviceSessionId('s1'), null);

    store.persist();
    const persistedAfterDelete = JSON.parse(readFileSync(filePath, 'utf8'));
    assert.equal(persistedAfterDelete.length, 1);
    assert.equal(persistedAfterDelete[0].id, 'tenant-2');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
