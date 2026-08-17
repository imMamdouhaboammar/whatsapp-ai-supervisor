import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../api/client';
import type { Tenant, WhatsAppSession } from '../api/types';
import { Status } from '../components/Status';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';

export function WhatsAppPage({ refreshKey }: { refreshKey: number }) {
  const [sessions, setSessions] = useState<WhatsAppSession[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loaded, setLoaded] = useState(false);
  const load = () => Promise.all([api.whatsapp(), api.tenants()]).then(([a, b]) => { setSessions(a.sessions); setTenants(b.tenants); setLoaded(true); });
  useEffect(() => { void load(); }, [refreshKey]);
  if (!loaded) return <div className="loading">Checking WhatsApp connections...</div>;
  const byTenant = new Map(tenants.map((t) => [t.id, t]));
  return <>
    <div className="page-header"><div><h1 className="page-title">WhatsApp</h1><p className="page-description">Cloud API configuration and live linked-device pairing state.</p></div><button className="button tonal" onClick={() => void load()}><Icon name="refresh" size={18} />Refresh</button></div>
    {sessions.length ? <div className="session-grid">{sessions.map((session) => {
      const tenant = byTenant.get(session.tenantId);
      const key = `${session.tenantId}-${session.sessionId ?? session.phoneNumberId ?? 'primary'}`;
      const title = tenant ? (session.sessionId ? `${tenant.name} (${session.sessionId})` : tenant.name) : session.tenantId;
      return <article className="session-card" key={key}>
        <div className="session-head"><div><div className="session-title">{title}</div><div className="session-meta">{session.mode === 'cloud' ? 'WhatsApp Cloud API' : `Linked device · ${session.sessionId}`}</div></div><Status value={session.status} /></div>
        {session.qr ? <div className="qr-box"><QRCodeSVG value={session.qr} size={176} level="M" /></div> : null}
        {session.pairingCode ? <div className="pairing-code">{session.pairingCode}</div> : null}
        {session.mode === 'cloud' ? <div className="empty-state" style={{ minHeight: 140 }}><strong>Managed through Meta</strong><span>Inbound webhooks and outbound Graph API messaging are configured for this tenant.</span></div> : null}
        {session.lastError ? <div className="error-text">{session.lastError}</div> : null}
      </article>;
    })}</div> : <EmptyState title="No WhatsApp connections" body="Configured transports will appear here." />}
  </>;
}
