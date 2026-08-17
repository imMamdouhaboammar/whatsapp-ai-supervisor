import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Overview } from '../api/types';
import { Metric } from '../components/Metric';
import { Status } from '../components/Status';
import { EmptyState } from '../components/EmptyState';
import { formatDateTime, percent } from '../app/format';

export function OverviewPage({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void api.overview().then(setData).catch((e) => setError(e.message)); }, [refreshKey]);
  if (error) return <EmptyState title="Overview unavailable" body={error} />;
  if (!data) return <div className="loading">Loading operational state...</div>;

  return <>
    <div className={`health-banner ${data.ready ? '' : 'bad'}`}>
      <div><strong>{data.ready ? 'Everything required is ready' : 'Supervisor needs attention'}</strong><br /><span>Generated {formatDateTime(data.generatedAt)}</span></div>
      <Status value={data.ready ? 'ready' : 'degraded'} />
    </div>
    <div className="metrics">
      <Metric label="Tenants" value={data.metrics.tenants} />
      <Metric label="WhatsApp online" value={data.metrics.whatsappOnline} note={`${data.metrics.tenants} configured`} />
      <Metric label="Conversations" value={data.metrics.conversations} />
      <Metric label="Processed today" value={data.metrics.processedToday} />
      <Metric label="Autonomous today" value={data.metrics.autonomousToday} note={`${data.metrics.humanToday} human`} />
    </div>

    <section className="section">
      <div className="section-heading"><h2>WhatsApp connections</h2><span>Live worker state where available</span></div>
      <div className="surface table-wrap">
        <table>
          <thead><tr><th>Business</th><th>Transport</th><th>Status</th><th>AI</th><th>Mode</th></tr></thead>
          <tbody>{data.tenants.map((tenant) => <tr key={tenant.id}>
            <td><div className="row-title">{tenant.name}</div><div className="row-sub">{tenant.id}</div></td>
            <td>{tenant.whatsapp.mode === 'cloud' ? 'Cloud API' : 'Linked device'}</td>
            <td><Status value={tenant.connection.status} /></td>
            <td><div className="row-title">{tenant.ai.model ?? tenant.ai.route}</div><div className="row-sub">{tenant.ai.provider}</div></td>
            <td><Status value={tenant.shadowMode ? 'shadow' : 'ready'} label={tenant.shadowMode ? 'Shadow' : 'Active'} /></td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>

    <section className="section">
      <div className="section-heading"><h2>Recent decisions</h2><span>Latest supervisor activity</span></div>
      <div className="surface activity-list">
        {data.recentActivity.length ? data.recentActivity.map((event) => <div className="activity-row" key={event.id}>
          <div className="activity-main"><div className="activity-title">{event.model?.intent ?? event.result?.reason ?? 'Conversation decision'}</div><div className="activity-meta">{event.tenantId} · {event.customerId}</div></div>
          <div className="row-sub">Confidence {percent(event.model?.confidence)}</div>
          <div><Status value={event.result?.action ?? 'unknown'} /></div>
        </div>) : <EmptyState title="No decisions yet" body="Activity will appear here after WhatsApp messages are processed." />}
      </div>
    </section>
  </>;
}
