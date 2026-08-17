const healthy = new Set(['ready', 'configured', 'ok', 'completed', 'ai']);
const warning = new Set(['pairing', 'starting', 'authenticated', 'degraded', 'requested', 'shadow']);

export function Status({ value, label }: { value: string; label?: string }) {
  const normalized = value || 'unknown';
  const tone = healthy.has(normalized) ? 'good' : warning.has(normalized) ? 'warn' : ['unavailable', 'error', 'auth-failure', 'failed', 'disconnected'].includes(normalized) ? 'bad' : 'neutral';
  return <span className={`status status-${tone}`}><span className="status-dot" />{label ?? normalized.replaceAll('-', ' ')}</span>;
}
