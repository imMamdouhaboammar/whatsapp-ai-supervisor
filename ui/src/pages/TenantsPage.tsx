import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';
import type { Tenant } from '../api/types';
import { Status } from '../components/Status';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { TenantFormModal } from '../components/TenantFormModal';
import { WhatsAppNumbersPanel } from '../components/WhatsAppNumbersPanel';

type Modal =
  | { type: 'create' }
  | { type: 'edit'; tenant: Tenant }
  | { type: 'numbers'; tenant: Tenant }
  | null;

export function TenantsPage({ refreshKey }: { refreshKey: number }) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(() => {
    api.tenants().then((r) => { setTenants(r.tenants); setLoaded(true); });
  }, []);

  useEffect(() => { load(); }, [refreshKey, load]);

  const handleDelete = async (tenant: Tenant) => {
    if (!confirm(`Delete tenant "${tenant.name}" (${tenant.id})?\n\nThis will remove the tenant and all its configuration. Conversation history is NOT deleted.`)) return;
    setDeletingId(tenant.id);
    try {
      await api.deleteTenant(tenant.id);
      load();
    } catch (e: any) {
      alert(`Failed to delete tenant: ${e?.message ?? 'unknown error'}`);
    } finally {
      setDeletingId(null);
    }
  };

  if (!loaded) return <div className="loading">Loading tenants...</div>;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Tenants</h1>
          <p className="page-description">Connection, model routing and permission footprint for every business. Changes are saved to <code>config/tenants.json</code> immediately.</p>
        </div>
        <button className="button" onClick={() => setModal({ type: 'create' })}>
          <Icon name="add" size={18} /> Add Tenant
        </button>
      </div>

      {tenants.length ? (
        <div className="surface table-wrap">
          <table>
            <thead>
              <tr>
                <th>Business</th>
                <th>WhatsApp</th>
                <th>AI route</th>
                <th>Rules</th>
                <th>Mode</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => {
                const numberCount = Array.isArray(tenant.whatsapp?.numbers) ? tenant.whatsapp.numbers.length : null;
                return (
                  <tr key={tenant.id}>
                    <td>
                      <div className="row-title">{tenant.name}</div>
                      <div className="row-sub mono">{tenant.id}</div>
                    </td>
                    <td>
                      <div className="row-title">
                        {tenant.whatsapp.mode === 'cloud' ? 'Cloud API' : 'Linked device'}
                      </div>
                      <div className="row-sub mono">{tenant.whatsapp.sessionId ?? tenant.whatsapp.phoneNumberId ?? 'Not set'}</div>
                      {numberCount !== null && (
                        <button
                          className="button text"
                          style={{ fontSize: 11, padding: '2px 6px', minHeight: 'unset', marginTop: 4 }}
                          onClick={() => setModal({ type: 'numbers', tenant })}
                        >
                          {numberCount} number{numberCount !== 1 ? 's' : ''} →
                        </button>
                      )}
                      {numberCount === null && (
                        <button
                          className="button text"
                          style={{ fontSize: 11, padding: '2px 6px', minHeight: 'unset', marginTop: 4 }}
                          onClick={() => setModal({ type: 'numbers', tenant })}
                        >
                          + Add number
                        </button>
                      )}
                    </td>
                    <td>
                      <div className="row-title">{tenant.ai.model ?? tenant.ai.route}</div>
                      <div className="row-sub">{tenant.ai.provider}</div>
                    </td>
                    <td>{tenant.policy.ruleCount}</td>
                    <td>
                      <Status value={tenant.shadowMode ? 'shadow' : 'ready'} label={tenant.shadowMode ? 'Shadow' : 'Active'} />
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <button
                          className="icon-button"
                          title="Edit tenant"
                          aria-label={`Edit ${tenant.name}`}
                          onClick={() => setModal({ type: 'edit', tenant })}
                        >
                          <Icon name="edit" size={18} />
                        </button>
                        <button
                          className="icon-button"
                          title="Manage WhatsApp numbers"
                          aria-label={`WhatsApp numbers for ${tenant.name}`}
                          onClick={() => setModal({ type: 'numbers', tenant })}
                          style={{ color: '#2e7d50' }}
                        >
                          <Icon name="whatsapp" size={18} />
                        </button>
                        <button
                          className="icon-button"
                          title="Delete tenant"
                          aria-label={`Delete ${tenant.name}`}
                          onClick={() => handleDelete(tenant)}
                          disabled={deletingId === tenant.id}
                          style={{ color: '#b3261e' }}
                        >
                          {deletingId === tenant.id ? <span style={{ fontSize: 12 }}>…</span> : <Icon name="delete" size={18} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="No tenants"
          body="Click 'Add Tenant' to create your first tenant, or edit config/tenants.json directly."
        />
      )}

      {modal?.type === 'create' && (
        <TenantFormModal
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}

      {modal?.type === 'edit' && (
        <TenantFormModal
          tenant={modal.tenant}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}

      {modal?.type === 'numbers' && (
        <WhatsAppNumbersPanel
          tenantId={modal.tenant.id}
          tenantName={modal.tenant.name}
          onClose={() => setModal(null)}
          onChanged={load}
        />
      )}
    </>
  );
}

