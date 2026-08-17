import { useState, useEffect, type FormEvent } from 'react';
import { api } from '../api/client';
import type { WhatsAppNumber } from '../api/types';
import { Icon } from './Icon';

interface Props {
  tenantId: string;
  tenantName: string;
  onClose: () => void;
  onChanged?: () => void;
}

export function WhatsAppNumbersPanel({ tenantId, tenantName, onClose, onChanged }: Props) {
  const [numbers, setNumbers] = useState<WhatsAppNumber[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState('');

  // form state
  const [fMode, setFMode] = useState<'linked-device' | 'cloud'>('linked-device');
  const [fLabel, setFLabel] = useState('');
  const [fId, setFId] = useState('');
  const [fSessionId, setFSessionId] = useState('');
  const [fWorkerUrl, setFWorkerUrl] = useState('http://127.0.0.1:7441');
  const [fWorkerTokenEnv, setFWorkerTokenEnv] = useState('WHATSAPP_LINKED_DEVICE_WORKER_TOKEN');
  const [fPhoneNumberId, setFPhoneNumberId] = useState('');
  const [fAllowGroups, setFAllowGroups] = useState(false);
  const [saving, setSaving] = useState(false);

  const slugify = (s: string) =>
    s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);

  const load = () => {
    api.getWhatsAppNumbers(tenantId).then((r) => { setNumbers(r.numbers); setLoaded(true); }).catch(() => setLoaded(true));
  };

  useEffect(load, [tenantId]);

  const handleAdd = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!fLabel.trim()) { setError('Label is required.'); return; }
    if (fMode === 'linked-device' && !fSessionId.trim()) { setError('Session ID is required.'); return; }
    if (fMode === 'linked-device' && !fWorkerTokenEnv.trim()) { setError('Worker token env is required.'); return; }
    if (fMode === 'cloud' && !fPhoneNumberId.trim()) { setError('Phone Number ID is required.'); return; }
    setSaving(true);
    try {
      const payload: Omit<WhatsAppNumber, 'id'> & { id?: string } = fMode === 'linked-device'
        ? { id: fId.trim() || undefined, label: fLabel.trim(), mode: 'linked-device', sessionId: fSessionId.trim(), workerUrl: fWorkerUrl.trim(), workerTokenEnv: fWorkerTokenEnv.trim(), allowGroups: fAllowGroups }
        : { id: fId.trim() || undefined, label: fLabel.trim(), mode: 'cloud', phoneNumberId: fPhoneNumberId.trim() };
      await api.addWhatsAppNumber(tenantId, payload);
      load();
      onChanged?.();
      setShowForm(false);
      setFLabel(''); setFId(''); setFSessionId(''); setFPhoneNumberId('');
    } catch (e: any) {
      setError(e?.message ?? 'Failed to add number.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (numberId: string) => {
    if (!confirm(`Delete WhatsApp number "${numberId}"? This cannot be undone.`)) return;
    setDeleting(numberId);
    try {
      await api.removeWhatsAppNumber(tenantId, numberId);
      load();
      onChanged?.();
    } catch (e: any) {
      alert(e?.message ?? 'Failed to delete number.');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-sheet modal-sheet-wide" role="dialog" aria-modal="true" aria-label="WhatsApp numbers" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 className="modal-title">WhatsApp Numbers</h2>
            <div className="modal-subtitle">{tenantName}</div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          {!loaded ? <div className="loading" style={{ padding: '24px 0' }}>Loading numbers…</div> : (
            <>
              {numbers.length === 0 && !showForm && (
                <div className="empty-state" style={{ minHeight: 100 }}>
                  <strong>No WhatsApp numbers yet</strong>
                  <span>Add a number to start routing messages for this tenant.</span>
                </div>
              )}

              {numbers.length > 0 && (
                <div className="surface table-wrap" style={{ marginBottom: 16 }}>
                  <table>
                    <thead><tr><th>Label / ID</th><th>Mode</th><th>Identifier</th><th></th></tr></thead>
                    <tbody>
                      {numbers.map((num) => (
                        <tr key={num.id}>
                          <td>
                            <div className="row-title">{num.label}</div>
                            <div className="row-sub mono">{num.id}</div>
                          </td>
                          <td>{num.mode === 'cloud' ? 'Cloud API' : 'Linked device'}</td>
                          <td className="mono" style={{ fontSize: 12 }}>{num.mode === 'cloud' ? num.phoneNumberId : num.sessionId}</td>
                          <td>
                            <button
                              className="button danger"
                              style={{ minHeight: 32, padding: '0 12px', fontSize: 12 }}
                              onClick={() => handleDelete(num.id)}
                              disabled={deleting === num.id}
                            >
                              {deleting === num.id ? '…' : 'Delete'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {!showForm && (
                <button className="button tonal" onClick={() => setShowForm(true)} style={{ gap: 6 }}>
                  <Icon name="add" size={18} /> Add WhatsApp Number
                </button>
              )}

              {showForm && (
                <form className="wa-number-form" onSubmit={handleAdd}>
                  <div className="form-section-title">New Number</div>

                  <label className="form-label">
                    Mode
                    <select className="select" value={fMode} onChange={(e) => setFMode(e.target.value as 'linked-device' | 'cloud')} style={{ width: '100%' }}>
                      <option value="linked-device">Linked Device (QR / Pairing)</option>
                      <option value="cloud">Cloud API (Meta)</option>
                    </select>
                  </label>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <label className="form-label">
                      Label <span className="form-required">*</span>
                      <input className="text-input" value={fLabel} onChange={(e) => { setFLabel(e.target.value); if (!fId) setFId(slugify(e.target.value)); }} placeholder="Support Line" />
                    </label>
                    <label className="form-label">
                      ID <span className="form-hint">(optional)</span>
                      <input className="text-input mono" value={fId} onChange={(e) => setFId(slugify(e.target.value))} placeholder="support" />
                    </label>
                  </div>

                  {fMode === 'linked-device' ? (<>
                    <label className="form-label">
                      Session ID <span className="form-required">*</span>
                      <input className="text-input mono" value={fSessionId} onChange={(e) => setFSessionId(e.target.value)} placeholder="my-business-support" />
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <label className="form-label">
                        Worker URL
                        <input className="text-input mono" value={fWorkerUrl} onChange={(e) => setFWorkerUrl(e.target.value)} placeholder="http://127.0.0.1:7441" />
                      </label>
                      <label className="form-label">
                        Worker Token Env <span className="form-required">*</span>
                        <input className="text-input mono" value={fWorkerTokenEnv} onChange={(e) => setFWorkerTokenEnv(e.target.value)} placeholder="WHATSAPP_TOKEN_SUPPORT" />
                      </label>
                    </div>
                    <label className="form-label form-row">
                      <input type="checkbox" checked={fAllowGroups} onChange={(e) => setFAllowGroups(e.target.checked)} />
                      Allow group messages
                    </label>
                  </>) : (
                    <label className="form-label">
                      Phone Number ID <span className="form-required">*</span>
                      <input className="text-input mono" value={fPhoneNumberId} onChange={(e) => setFPhoneNumberId(e.target.value)} placeholder="123456789012345" />
                    </label>
                  )}

                  {error && <div className="error-text">{error}</div>}

                  <div className="modal-actions" style={{ marginTop: 12 }}>
                    <button type="button" className="button text" onClick={() => { setShowForm(false); setError(''); }}>Cancel</button>
                    <button type="submit" className="button" disabled={saving}>{saving ? 'Adding…' : 'Add Number'}</button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
