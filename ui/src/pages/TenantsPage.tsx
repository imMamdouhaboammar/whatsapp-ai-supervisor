import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Tenant } from '../api/types';
import { Status } from '../components/Status';
import { EmptyState } from '../components/EmptyState';

export function TenantsPage({ refreshKey }: { refreshKey: number }) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { void api.tenants().then((r) => { setTenants(r.tenants); setLoaded(true); }); }, [refreshKey]);
  if (!loaded) return <div className="loading">Loading tenants...</div>;
  return <>
    <div className="page-header"><div><h1 className="page-title">Tenants</h1><p className="page-description">Connection, model routing and permission footprint for every business.</p></div></div>
    {tenants.length ? <div className="surface table-wrap"><table>
      <thead><tr><th>Business</th><th>WhatsApp</th><th>AI route</th><th>Rules</th><th>Browser</th><th>Mode</th></tr></thead>
      <tbody>{tenants.map((tenant) => <tr key={tenant.id}>
        <td><div className="row-title">{tenant.name}</div><div className="row-sub mono">{tenant.id}</div></td>
        <td><div className="row-title">{tenant.whatsapp.mode === 'cloud' ? 'Cloud API' : 'Linked device'}</div><div className="row-sub mono">{tenant.whatsapp.sessionId ?? tenant.whatsapp.phoneNumberId ?? 'Not set'}</div></td>
        <td><div className="row-title">{tenant.ai.model ?? tenant.ai.route}</div><div className="row-sub">{tenant.ai.provider}</div></td>
        <td>{tenant.policy.ruleCount}</td><td>{tenant.policy.browserCapabilities}</td>
        <td><Status value={tenant.shadowMode ? 'shadow' : 'ready'} label={tenant.shadowMode ? 'Shadow' : 'Active'} /></td>
      </tr>)}</tbody>
    </table></div> : <EmptyState title="No tenants" body="Add a tenant to config/tenants.json and restart the supervisor." />}
  </>;
}
