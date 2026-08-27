import { randomUUID } from 'node:crypto';

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Linked-device worker must use http or https');
  return url.toString().replace(/\/$/, '');
}

function canonicalWhatsAppId(value) {
  return String(value).trim().replace(/@(c|lid)\.us$/i, '');
}

function linkedDeviceMessageParts(payload, { allowGroups = false } = {}) {
  const sessionId = String(payload?.sessionId ?? '').trim();
  const message = payload?.message;
  if (!sessionId || !message || typeof message !== 'object') throw new Error('invalid_linked_device_payload');
  const from = String(message.from ?? '').trim();
  const to = String(message.to ?? '').trim();
  const peer = message.fromMe ? (to || from) : from;
  if (from === 'status@broadcast' || to === 'status@broadcast' || peer === 'status@broadcast') return null;
  if (message.type !== 'chat') return null;
  if (message.isGroup && !allowGroups) return null;

  const id = String(message.id ?? '').trim();
  const customerId = canonicalWhatsAppId(peer);
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  if (!id || !customerId || !text) throw new Error('invalid_linked_device_message');
  const timestamp = Number(message.timestamp ?? 0);
  return {
    sessionId,
    message,
    id,
    customerId,
    customerName: typeof message.customerName === 'string' && message.customerName.trim() ? message.customerName.trim() : null,
    text,
    timestamp: Number.isFinite(timestamp) ? timestamp : 0
  };
}

function normalizedOperationId(value) {
  const operationId = String(value ?? '').trim();
  if (!operationId || operationId.length > 200) throw new Error('linked_device_operation_id_invalid');
  return operationId;
}

export function whatsappTransportMode(tenant) {
  return String(tenant?.whatsapp?.mode ?? 'cloud').toLowerCase();
}

export function normalizeLinkedDeviceInbound(payload, options = {}) {
  const parts = linkedDeviceMessageParts(payload, options);
  if (!parts || parts.message.fromMe) return null;
  return {
    id: parts.id,
    channel: 'whatsapp',
    transport: 'linked-device',
    sessionId: parts.sessionId,
    customerId: parts.customerId,
    customerName: parts.customerName,
    text: parts.text,
    timestamp: parts.timestamp
  };
}

export function normalizeLinkedDeviceOutboundObservation(payload, options = {}) {
  const parts = linkedDeviceMessageParts(payload, options);
  if (!parts || !parts.message.fromMe) return null;
  const originHint = parts.message.originHint === 'worker_api' ? 'worker_api' : null;
  const apiSendOperationId = originHint && parts.message.apiSendOperationId
    ? normalizedOperationId(parts.message.apiSendOperationId)
    : null;
  return {
    id: parts.id,
    platformMessageId: parts.id,
    channel: 'whatsapp',
    transport: 'linked-device',
    sessionId: parts.sessionId,
    customerId: parts.customerId,
    customerName: parts.customerName,
    text: parts.text,
    timestamp: parts.timestamp,
    fromMe: true,
    ...(originHint ? { originHint, apiSendOperationId } : {})
  };
}

export class WhatsAppLinkedDeviceSender {
  constructor({ baseUrl, token, sessionId, fetchImpl = fetch, idFactory = randomUUID }) {
    if (!baseUrl) throw new Error('Linked-device worker URL is required');
    if (!token) throw new Error('Linked-device worker token is required');
    if (!sessionId) throw new Error('Linked-device session id is required');
    if (typeof idFactory !== 'function') throw new Error('Linked-device operation id factory is required');
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.token = token;
    this.sessionId = sessionId;
    this.fetchImpl = fetchImpl;
    this.idFactory = idFactory;
  }

  async sendText({ to, text, replyToId = null }) {
    if (!to || typeof text !== 'string' || !text.trim()) throw new Error('linked_device_send_invalid');
    const operationId = normalizedOperationId(this.idFactory());
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
          replyToId,
          operationId
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

    const workerOperationId = body?.operationId == null ? operationId : normalizedOperationId(body.operationId);
    if (workerOperationId !== operationId) throw new Error('linked_device_operation_mismatch');

    const platformMessageId = String(body?.id ?? '').trim();
    return {
      ...body,
      id: platformMessageId || null,
      platformMessageId: platformMessageId || null,
      operationId,
      transport: 'linked-device',
      sessionId: this.sessionId
    };
  }
}
