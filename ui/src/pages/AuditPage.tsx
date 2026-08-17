import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import type { AuditEvent, Tenant } from '../api/types';
import { Status } from '../components/Status';
import { EmptyState } from '../components/EmptyState';
import { formatDateTime, percent } from '../app/format';

export function AuditPage({ refreshKey }: { refreshKey: number }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => { void api.tenants().then((r) => setTenants(r.tenants)); }, []);
  useEffect(() => { void api.audit(tenantId).then((r) => setEvents(r.events)); }, [tenantId, refreshKey]);
  const filtered = useMemo(() => events.filter((event) => !query || JSON.stringify(event).toLowerCase().includes(query.toLowerCase())), [events, query]);
  return <>
    <div className="page-header"><div><h1 className="page-title">Audit</h1><p className="page-description">Every supervisor decision, including the policy outcome that constrained it.</p></div></div>
    <div className="filter-row" style={{ marginBottom: 12 }}><select className="select" value={tenantId} onChange={(e) => setTenantId(e.target.value)}><option value="">All tenants</option>{tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select><input className="text-input" style={{ maxWidth: 360 }} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search audit events" /></div>
    {filtered.length ? <div className="surface table-wrap"><table><thead><tr><th>Time</th><th>Tenant</th><th>Customer</th><th>Intent</th><th>Decision</th><th>Confidence</th></tr></thead><tbody>{filtered.map((event) => <tr key={event.id}><td>{formatDateTime(event.at)}</td><td>{event.tenantId}</td><td className="mono">{event.customerId}</td><td>{event.model?.intent ?? 'Not set'}</td><td><Status value={event.result?.action ?? 'unknown'} /></td><td>{percent(event.model?.confidence)}</td></tr>)}</tbody></table></div> : <EmptyState title="No matching audit events" body="Adjust the tenant or search filter." />}
  </>;
}
