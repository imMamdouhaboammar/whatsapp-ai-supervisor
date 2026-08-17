import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { ActionEvent, Tenant } from '../api/types';
import { Status } from '../components/Status';
import { EmptyState } from '../components/EmptyState';
import { formatDateTime, percent } from '../app/format';

export function ActionsPage({ refreshKey }: { refreshKey: number }) {
  const [actions, setActions] = useState<ActionEvent[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  useEffect(() => { void api.tenants().then((r) => setTenants(r.tenants)); }, []);
  useEffect(() => { void api.actions(tenantId).then((r) => setActions(r.actions)); }, [tenantId, refreshKey]);
  return <>
    <div className="page-header"><div><h1 className="page-title">Actions</h1><p className="page-description">Business actions requested or executed through policy-bound capabilities.</p></div><select className="select" value={tenantId} onChange={(e) => setTenantId(e.target.value)}><option value="">All tenants</option>{tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
    {actions.length ? <div className="surface table-wrap"><table><thead><tr><th>Time</th><th>Tenant</th><th>Customer</th><th>Intent</th><th>Confidence</th><th>Status</th></tr></thead><tbody>{actions.map((a) => <tr key={a.id}><td>{formatDateTime(a.at)}</td><td>{a.tenantId}</td><td className="mono">{a.customerId}</td><td>{a.intent ?? 'Not set'}</td><td>{percent(a.confidence)}</td><td><Status value={a.status} /></td></tr>)}</tbody></table></div> : <EmptyState title="No action activity" body="Policy-bound browser or tool actions will appear here when requested." />}
  </>;
}
