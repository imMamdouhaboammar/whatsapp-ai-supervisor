import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { RuntimeInfo } from '../api/types';
import { Status } from '../components/Status';

export function SettingsPage({ refreshKey }: { refreshKey: number }) {
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  useEffect(() => { void api.runtime().then(setRuntime); }, [refreshKey]);
  if (!runtime) return <div className="loading">Loading runtime configuration...</div>;
  return <>
    <div className="page-header"><div><h1 className="page-title">Settings</h1><p className="page-description">Safe operational summary. Secrets and environment-variable values are never exposed here.</p></div></div>
    <div className="surface table-wrap"><table><tbody>
      <tr><td className="row-title">Runtime readiness</td><td><Status value={runtime.readiness.ready === false ? 'degraded' : 'ready'} /></td></tr>
      <tr><td className="row-title">Tenants</td><td>{runtime.tenantCount}</td></tr>
      <tr><td className="row-title">Meta Cloud API</td><td>{runtime.metaEnabled ? 'Enabled' : 'Not required'}</td></tr>
      <tr><td className="row-title">Linked-device transport</td><td>{runtime.linkedDeviceEnabled ? 'Enabled' : 'Not required'}</td></tr>
      <tr><td className="row-title">Browser runtime</td><td>{runtime.browser.mode} · {runtime.browser.engine}</td></tr>
      <tr><td className="row-title">Management authentication</td><td>{runtime.managementAuth ? 'Bearer token enabled' : 'Open on bound interface'}</td></tr>
    </tbody></table></div>
  </>;
}
