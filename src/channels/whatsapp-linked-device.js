function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Linked-device worker must use http or https');
  return url.toString().replace(/\/$/, '');
}

function canonicalWhatsAppId(value) {
  return String(value).trim().replace(/@(c|lid)\.us$/i, '');
}

export function whatsappTransportMode(tenant) {
  return String(tenant?.whatsapp?.mode ?? 'cloud').toLowerCase();
}

export function normalizeLinkedDeviceInbound(payload, { allowGroups = false } = {}) {
  const sessionId = String(payload?.sessionId ?? '').trim();
  const message = payload?.message;
  if (!sessionId || !message || typeof message !== 'object') throw new Error('invalid_linked_device_payload');
  if (message.fromMe) return null;
  if (message.from === 'status@broadcast') return null;
  if (message.type !== 'chat') return null;
  if (message.isGroup && !allowGroups) return null;

  const id = String(message.id ?? '').trim();
  const from = String(message.from ?? '').trim();
  const customerId = canonicalWhatsAppId(from);
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  if (!id || !customerId || !text) throw new Error('invalid_linked_device_message');

  const timestamp = Number(message.timestamp ?? 0);
  return {
    id,
    channel: 'whatsapp',
    transport: 'linked-device',
    sessionId,
    customerId,
    customerName: typeof message.customerName === 'string' && message.customerName.trim() ? message.customerName.trim() : null,
    text,
    timestamp: Number.isFinite(timestamp) ? timestamp : 0
  };
}

export class WhatsAppLinkedDeviceSender {
  constructor({ baseUrl, token, sessionId, fetchImpl = fetch }) {
    if (!baseUrl) throw new Error('Linked-device worker URL is required');
    if (!token) throw new Error('Linked-device worker token is required');
    if (!sessionId) throw new Error('Linked-device session id is required');
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.token = token;
    this.sessionId = sessionId;
    this.fetchImpl = fetchImpl;
  }

  async sendText({ to, text, replyToId = null }) {
    if (!to || typeof text !== 'string' || !text.trim()) throw new Error('linked_device_send_invalid');
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/send-text`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.token}`,
          'content-type': 'application/json',
          accept: 'application/json'
        },
        body: JSON.stringify({
          sessionId: this.sessionId,
          to,
          text,
          replyToId
        }),
        signal: AbortSignal.timeout(30_000)
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new Error('Linked-device send timed out');
      }
      throw new Error(`Linked-device worker unreachable: ${error?.message ?? error}`);
    }

    const raw = await response.text();
    let body;
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = { error: raw }; }
    if (!response.ok) {
      throw new Error(`Linked-device send failed (${response.status}): ${body.error ?? 'unknown_error'}`);
    }

    const platformMessageId = String(body?.id ?? '').trim();
    return {
      ...body,
      id: platformMessageId || null,
      platformMessageId: platformMessageId || null,
      transport: 'linked-device',
      sessionId: this.sessionId
    };
  }
}
