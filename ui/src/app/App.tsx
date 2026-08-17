import { useEffect, useState, type FormEvent } from 'react';
import { api, managementToken, setManagementToken } from '../api/client';
import { Shell } from '../components/Shell';
import { Icon } from '../components/Icon';
import { routeFromHash, type RouteKey } from './nav';
import { OverviewPage } from '../pages/OverviewPage';
import { TenantsPage } from '../pages/TenantsPage';
import { WhatsAppPage } from '../pages/WhatsAppPage';
import { InboxPage } from '../pages/InboxPage';
import { ActionsPage } from '../pages/ActionsPage';
import { AuditPage } from '../pages/AuditPage';
import { SettingsPage } from '../pages/SettingsPage';
import { useRealtime } from '../hooks/useRealtime';

function Login({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [token, setToken] = useState(managementToken());
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setManagementToken(token.trim());
    try {
      await api.session();
      setError('');
      onAuthenticated();
    } catch {
      setManagementToken('');
      setError('That management token was not accepted.');
    }
  };
  return <div className="login-shell"><div className="login-card">
    <div className="login-mark"><Icon name="smart" size={24} /></div>
    <h1>WhatsApp AI Supervisor</h1>
    <p>Enter the management token configured on this deployment. It stays in this browser tab only.</p>
    <form className="login-form" onSubmit={submit}>
      <input className="text-input" type="password" autoFocus value={token} onChange={(e) => setToken(e.target.value)} placeholder="Management token" />
      {error ? <div className="error-text">{error}</div> : null}
      <button className="button" type="submit">Open console</button>
    </form>
  </div></div>;
}

export function App() {
  const [route, setRoute] = useState<RouteKey>(routeFromHash());
  const [refreshKey, setRefreshKey] = useState(0);
  const [authState, setAuthState] = useState<'checking' | 'authenticated' | 'login'>('checking');

  const { connected: realtimeConnected } = useRealtime((event) => {
    // When any live event arrives, trigger smooth state refresh across pages
    if (event.type.startsWith('message:') || event.type.startsWith('whatsapp:')) {
      setRefreshKey((value) => value + 1);
    }
  });

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    void api.session().then(() => setAuthState('authenticated')).catch((error: Error & { status?: number }) => {
      setAuthState(error.status === 401 ? 'login' : 'login');
    });
  }, []);

  const navigate = (next: RouteKey) => {
    location.hash = `/${next}`;
    setRoute(next);
  };

  if (authState === 'checking') return <div className="loading" style={{ minHeight: '100vh' }}>Opening operator console...</div>;
  if (authState === 'login') return <Login onAuthenticated={() => setAuthState('authenticated')} />;

  const page = (() => {
    switch (route) {
      case 'tenants': return <TenantsPage refreshKey={refreshKey} />;
      case 'whatsapp': return <WhatsAppPage refreshKey={refreshKey} />;
      case 'inbox': return <InboxPage refreshKey={refreshKey} />;
      case 'actions': return <ActionsPage refreshKey={refreshKey} />;
      case 'audit': return <AuditPage refreshKey={refreshKey} />;
      case 'settings': return <SettingsPage refreshKey={refreshKey} />;
      default: return <OverviewPage refreshKey={refreshKey} />;
    }
  })();

  return <Shell route={route} onRoute={navigate} onRefresh={() => setRefreshKey((value) => value + 1)} realtimeConnected={realtimeConnected}>{page}</Shell>;
}
