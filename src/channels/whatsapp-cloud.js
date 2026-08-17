import { createHmac, timingSafeEqual } from 'node:crypto';
export function normalizeWhatsAppWebhook(payload) {
  if (payload?.object !== 'whatsapp_business_account') return [];
  const normalized = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const phoneNumberId = value.metadata?.phone_number_id;
      const contactsById = new Map((value.contacts ?? []).map((contact) => [contact.wa_id, contact]));

      for (const message of value.messages ?? []) {
        if (message.type !== 'text' || typeof message.text?.body !== 'string') continue;
        const contact = contactsById.get(message.from);
        normalized.push({
          id: message.id,
          channel: 'whatsapp',
          phoneNumberId,
          customerId: message.from,
          customerName: contact?.profile?.name ?? null,
          text: message.text.body,
          timestamp: Number(message.timestamp ?? 0)
        });
      }
    }
  }

  return normalized;
}


export function validateMetaSignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret || !signatureHeader?.startsWith('sha256=')) return false;
  const receivedHex = signatureHeader.slice('sha256='.length);
  if (!/^[a-f0-9]{64}$/i.test(receivedHex)) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const received = Buffer.from(receivedHex, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function verifyWebhookChallenge(query, verifyToken) {
  if (query?.['hub.mode'] !== 'subscribe') return null;
  if (query?.['hub.verify_token'] !== verifyToken) return null;
  return query?.['hub.challenge'] ?? null;
}

export class WhatsAppCloudSender {
  constructor({ accessToken, phoneNumberId, graphVersion, fetchImpl = fetch, baseUrl = 'https://graph.facebook.com' }) {
    if (!accessToken) throw new Error('META_WHATSAPP_ACCESS_TOKEN is required');
    if (!phoneNumberId) throw new Error('META_WHATSAPP_PHONE_NUMBER_ID is required');
    if (!graphVersion) throw new Error('META_GRAPH_VERSION is required');
    this.accessToken = accessToken;
    this.phoneNumberId = phoneNumberId;
    this.graphVersion = graphVersion;
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async sendText({ to, text, replyToId = null }) {
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: text }
    };
    if (replyToId) body.context = { message_id: replyToId };

    const response = await this.fetchImpl(`${this.baseUrl}/${this.graphVersion}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`WhatsApp send failed (${response.status}): ${detail.slice(0, 500)}`);
    }

    const payload = await response.json();
    return { id: payload.messages?.[0]?.id ?? null, raw: payload };
  }
}
