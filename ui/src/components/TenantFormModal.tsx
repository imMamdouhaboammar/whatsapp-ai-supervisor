import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import type { Tenant, TenantCreatePayload } from '../api/types';

interface Props {
  tenant?: Tenant | null;  // null = create mode, Tenant = edit mode
  onClose: () => void;
  onSaved: (tenant: Tenant) => void;
}

const DEFAULT_WORKER_URL = 'http://127.0.0.1:7441';

export function TenantFormModal({ tenant, onClose, onSaved }: Props) {
  const isEdit = Boolean(tenant);

  const [name, setName] = useState(tenant?.name ?? '');
  const [id, setId] = useState(tenant?.id ?? '');
  const [language, setLanguage] = useState('Arabic and English');
  const [mode, setMode] = useState<'linked-device' | 'cloud'>(
    (tenant?.whatsapp?.mode as 'linked-device' | 'cloud') ?? 'linked-device'
  );
  const [sessionId, setSessionId] = useState(tenant?.whatsapp?.sessionId ?? '');
  const [workerUrl, setWorkerUrl] = useState(DEFAULT_WORKER_URL);
  const [workerTokenEnv, setWorkerTokenEnv] = useState('WHATSAPP_LINKED_DEVICE_WORKER_TOKEN');
  const [phoneNumberId, setPhoneNumberId] = useState(tenant?.whatsapp?.phoneNumberId ?? '');
  const [aiRoute, setAiRoute] = useState(tenant?.ai?.route ?? 'standard');
  const [shadowMode, setShadowMode] = useState(tenant?.shadowMode ?? false);
  const [allowGroups, setAllowGroups] = useState(tenant?.whatsapp?.allowGroups ?? false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const slugify = (s: string) =>
    s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

  const handleNameChange = (v: string) => {
    setName(v);
    if (!isEdit && !id) setId(slugify(v));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!name.trim()) { setError('Business name is required.'); return; }
    if (!isEdit && !id.trim()) { setError('Tenant ID is required.'); return; }
    if (mode === 'linked-device' && !sessionId.trim()) { setError('Session ID is required.'); return; }
    if (mode === 'linked-device' && !workerTokenEnv.trim()) { setError('Worker token env variable name is required.'); return; }
    if (mode === 'cloud' && !phoneNumberId.trim()) { setError('Phone Number ID is required.'); return; }

    setSaving(true);
    try {
      const payload: TenantCreatePayload = {
        id: isEdit ? undefined : id.trim(),
        businessContext: { name: name.trim(), language },
        shadowMode,
        whatsapp: mode === 'linked-device'
          ? { mode: 'linked-device', sessionId: sessionId.trim(), workerUrl: workerUrl.trim(), workerTokenEnv: workerTokenEnv.trim(), allowGroups }
          : { mode: 'cloud', phoneNumberId: phoneNumberId.trim() },
        ai: { route: aiRoute }
      };

      let saved: Tenant;
      if (isEdit && tenant) {
        const res = await api.updateTenant(tenant.id, payload);
        saved = res.tenant;
      } else {
        const res = await api.createTenant(payload);
        saved = res.tenant;
      }
      onSaved(saved);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save tenant.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-sheet" role="dialog" aria-modal="true" aria-label={isEdit ? 'Edit tenant' : 'Add tenant'} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="modal-title">{isEdit ? `Edit — ${tenant!.name}` : 'Add Tenant'}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form className="modal-body" onSubmit={handleSubmit}>
          <div className="form-section-title">Business</div>

          <label className="form-label">
            Business Name <span className="form-required">*</span>
            <input className="text-input" value={name} onChange={(e) => handleNameChange(e.target.value)} placeholder="My Business" autoFocus />
          </label>

          {!isEdit && (
            <label className="form-label">
              Tenant ID <span className="form-required">*</span>
              <input className="text-input mono" value={id} onChange={(e) => setId(slugify(e.target.value))} placeholder="my-business" />
              <span className="form-hint">Lowercase letters, numbers, hyphens only. Cannot be changed later.</span>
            </label>
          )}

          <label className="form-label">
            Language
            <input className="text-input" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="Arabic and English" />
          </label>

          <div className="form-section-title" style={{ marginTop: 16 }}>WhatsApp Connection</div>

          <label className="form-label">
            Mode
            <select className="select" value={mode} onChange={(e) => setMode(e.target.value as 'linked-device' | 'cloud')} style={{ width: '100%' }}>
              <option value="linked-device">Linked Device (QR / Pairing)</option>
              <option value="cloud">Cloud API (Meta)</option>
            </select>
          </label>

          {mode === 'linked-device' ? (<>
            <label className="form-label">
              Session ID <span className="form-required">*</span>
              <input className="text-input mono" value={sessionId} onChange={(e) => setSessionId(e.target.value)} placeholder="my-business" />
            </label>
            <label className="form-label">
              Worker URL
              <input className="text-input mono" value={workerUrl} onChange={(e) => setWorkerUrl(e.target.value)} placeholder="http://127.0.0.1:7441" />
            </label>
            <label className="form-label">
              Worker Token Env <span className="form-required">*</span>
              <input className="text-input mono" value={workerTokenEnv} onChange={(e) => setWorkerTokenEnv(e.target.value)} placeholder="WHATSAPP_LINKED_DEVICE_WORKER_TOKEN" />
              <span className="form-hint">Name of the environment variable holding the worker token.</span>
            </label>
            <label className="form-label form-row">
              <input type="checkbox" checked={allowGroups} onChange={(e) => setAllowGroups(e.target.checked)} />
              Allow group messages
            </label>
          </>) : (
            <label className="form-label">
              Phone Number ID <span className="form-required">*</span>
              <input className="text-input mono" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} placeholder="123456789012345" />
              <span className="form-hint">Found in the Meta for Developers dashboard.</span>
            </label>
          )}

          <div className="form-section-title" style={{ marginTop: 16 }}>AI Configuration</div>

          <label className="form-label">
            AI Route
            <select className="select" value={aiRoute} onChange={(e) => setAiRoute(e.target.value)} style={{ width: '100%' }}>
              <option value="fast">Fast (speed-optimised)</option>
              <option value="standard">Standard (balanced)</option>
              <option value="critical">Critical (highest quality)</option>
            </select>
          </label>

          <label className="form-label form-row" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={shadowMode} onChange={(e) => setShadowMode(e.target.checked)} />
            Shadow mode — AI decides but never sends replies
          </label>

          {error && <div className="error-text" style={{ marginTop: 10 }}>{error}</div>}

          <div className="modal-actions">
            <button type="button" className="button tonal" onClick={onClose}>Cancel</button>
            <button type="submit" className="button" disabled={saving}>{saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create tenant'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
