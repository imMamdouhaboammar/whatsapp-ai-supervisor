import { useEffect, useMemo, useState, useRef } from 'react';
import { api } from '../api/client';
import type { Conversation, Tenant } from '../api/types';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { Status } from '../components/Status';
import { formatDateTime, formatTime, percent } from '../app/format';

export function InboxPage({ refreshKey }: { refreshKey: number }) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api.tenants().then((result) => {
      setTenants(result.tenants);
      if (!tenantId && result.tenants[0]) setTenantId(result.tenants[0].id);
    });
  }, []);

  const load = async () => {
    if (!tenantId) return;
    try {
      const result = await api.conversations(tenantId);
      setConversations(result.conversations);
      if (!selectedId && result.conversations[0]) setSelectedId(result.conversations[0].customerId);
      if (selectedId && !result.conversations.some((item) => item.customerId === selectedId)) setSelectedId(result.conversations[0]?.customerId ?? '');
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => { void load(); }, [tenantId, refreshKey]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedId, conversations]);

  const selected = conversations.find((item) => item.customerId === selectedId) ?? null;
  const filtered = useMemo(() => conversations.filter((item) => {
    const haystack = `${item.customerName} ${item.customerId} ${item.preview}`.toLowerCase();
    return !query || haystack.includes(query.toLowerCase());
  }), [conversations, query]);

  const setControl = async (mode: 'ai' | 'human') => {
    if (!selected) return;
    setBusy(true);
    try {
      await api.setConversationControl(tenantId, selected.customerId, mode);
      await load();
    } finally { setBusy(false); }
  };

  const send = async () => {
    if (!selected || !draft.trim()) return;
    setBusy(true);
    try {
      await api.sendManual(tenantId, selected.customerId, draft.trim());
      setDraft('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleModerate = async () => {
    try {
      setBusy(true);
      setError('');
      await api.triggerModerator({ tenantId });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return <>
    <div className="page-header">
      <div><h1 className="page-title">Inbox</h1><p className="page-description">Real conversation activity with explicit AI or human control.</p></div>
      <button className="button" disabled={busy} onClick={() => void handleModerate()}>
        <Icon name="smart" size={18} />
        {busy ? 'Moderating...' : '⚡ Moderate Active Chats'}
      </button>
    </div>
    {error ? <div className="health-banner bad"><div><strong>Inbox action failed</strong><br /><span>{error}</span></div></div> : null}
    <div className="inbox-layout">
      <aside className="conversation-list">
        <div className="conversation-toolbar">
          <select className="select" value={tenantId} onChange={(e) => { setTenantId(e.target.value); setSelectedId(''); }}>
            {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
          </select>
          <input className="text-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search conversations" />
        </div>
        <div className="conversation-scroll">
          {filtered.length ? filtered.map((item) => <button key={item.customerId} className={`conversation-item ${selectedId === item.customerId ? 'selected' : ''}`} onClick={() => setSelectedId(item.customerId)}>
            <div className="conversation-item-head"><span className="conversation-name">{item.customerName}</span><span className="conversation-time">{formatTime(item.lastActivityAt)}</span></div>
            <div className="conversation-preview">{item.preview || 'No text preview'}</div>
          </button>) : <EmptyState title="No conversations" body="Incoming WhatsApp messages will appear here after the supervisor receives them." />}
        </div>
      </aside>
      <section className="thread">
        {selected ? <>
          <header className="thread-head">
            <div><div className="thread-title">{selected.customerName}</div><div className="thread-sub mono">{selected.customerId}</div></div>
            <div className="filter-row">
              <Status value={selected.control} label={selected.control === 'human' ? 'Human control' : 'AI control'} />
              {selected.control === 'ai'
                ? <button className="button tonal" disabled={busy} onClick={() => void setControl('human')}><Icon name="person" size={17} />Take over</button>
                : <button className="button tonal" disabled={busy} onClick={() => void setControl('ai')}><Icon name="smart" size={17} />Return to AI</button>}
            </div>
          </header>
          <div className="thread-messages">
            {selected.messages.map((message) => <div key={message.id} className={`message ${message.direction}`}>
              {message.text ? <div className="message-text">{message.text}</div> : <div className="decision-only">No customer-facing text for this decision</div>}
              {message.thinking ? <details className="thinking-details" style={{ margin: '8px 0', padding: '6px 10px', background: 'rgba(0,0,0,0.04)', borderRadius: 6, fontSize: '0.82rem' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 500, color: '#444' }}>💭 Agent Thinking & Reasoning</summary>
                <div style={{ marginTop: 4, whiteSpace: 'pre-wrap', color: '#555' }}>{message.thinking}</div>
              </details> : null}
              {message.proactiveOffer ? <div style={{ fontSize: '0.8rem', color: '#0d652d', marginTop: 4, fontWeight: 500 }}>💡 Proactive: {message.proactiveOffer}</div> : null}
              <div className="message-meta">
                <span>{formatDateTime(message.at)}</span>
                {message.provider ? <span style={{ fontWeight: 600 }}>{message.provider}</span> : null}
                {message.modelName ? <span>{message.modelName}</span> : null}
                {message.intent ? <span>{message.intent}</span> : null}
                {message.action ? <span>{message.action}</span> : null}
                {message.confidence != null ? <span>{percent(message.confidence)}</span> : null}
              </div>
            </div>)}
            <div ref={messagesEndRef} style={{ height: 1 }} />
          </div>
          <div className="composer">
            <textarea className="text-input" disabled={selected.control !== 'human' || busy} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={selected.control === 'human' ? 'Reply as a human operator' : 'Take over the conversation to reply manually'} />
            <button className="button" disabled={selected.control !== 'human' || !draft.trim() || busy} onClick={() => void send()}><Icon name="send" size={18} />Send</button>
          </div>
        </> : <EmptyState title="Select a conversation" body="Choose a customer thread to inspect the messages and supervisor decisions." />}
      </section>
    </div>
  </>;
}
