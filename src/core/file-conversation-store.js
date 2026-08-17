import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

function safeTenantFile(tenantId) {
  const safe = String(tenantId).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'tenant';
  const suffix = createHash('sha256').update(String(tenantId)).digest('hex').slice(0, 12);
  return `${safe}-${suffix}`;
}

function isoFromMessage(message) {
  const timestamp = Number(message?.timestamp);
  if (Number.isFinite(timestamp) && timestamp > 0) return new Date(timestamp * 1000).toISOString();
  return new Date().toISOString();
}

function cleanText(value) {
  return typeof value === 'string' ? value.slice(0, 20_000) : null;
}

export class FileConversationStore {
  constructor({ dataDir }) {
    if (!dataDir) throw new Error('FileConversationStore dataDir is required');
    this.root = join(dataDir, 'conversations');
    this.eventsDir = join(this.root, 'events');
    this.controlsDir = join(this.root, 'controls');
    mkdirSync(this.eventsDir, { recursive: true });
    mkdirSync(this.controlsDir, { recursive: true });
  }

  eventsFile(tenantId) {
    return join(this.eventsDir, `${safeTenantFile(tenantId)}.ndjson`);
  }

  controlsFile(tenantId) {
    return join(this.controlsDir, `${safeTenantFile(tenantId)}.json`);
  }

  appendEvent(event) {
    if (!event?.tenantId || !event?.customerId) throw new Error('Conversation event tenantId and customerId are required');
    appendFileSync(this.eventsFile(event.tenantId), `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
    return event;
  }

  recordInbound(message) {
    return this.appendEvent({
      id: String(message.id),
      tenantId: message.tenantId,
      customerId: String(message.customerId),
      customerName: cleanText(message.customerName) ?? String(message.customerId),
      type: 'message',
      direction: 'inbound',
      text: cleanText(message.text) ?? '',
      at: isoFromMessage(message),
      action: null,
      intent: null,
      confidence: null
    });
  }

  recordDecision(message, result, at = new Date().toISOString()) {
    const model = result?.model ?? null;
    const permission = result?.permission ?? null;
    return this.appendEvent({
      id: `${message.id}:decision`,
      tenantId: message.tenantId,
      customerId: String(message.customerId),
      customerName: cleanText(message.customerName) ?? String(message.customerId),
      type: 'decision',
      direction: 'assistant',
      text: cleanText(model?.reply),
      at,
      action: result?.action ?? null,
      wouldAction: result?.wouldAction ?? null,
      reason: result?.reason ?? null,
      intent: model?.intent ?? permission?.intent ?? null,
      confidence: Number.isFinite(model?.confidence) ? model.confidence : null
    });
  }

  recordManualOutbound({ tenantId, customerId, customerName = null, text, messageId = null, at = new Date().toISOString() }) {
    return this.appendEvent({
      id: messageId ?? crypto.randomUUID(),
      tenantId,
      customerId: String(customerId),
      customerName: cleanText(customerName) ?? String(customerId),
      type: 'message',
      direction: 'human',
      text: cleanText(text) ?? '',
      at,
      action: 'human_reply',
      intent: null,
      confidence: null
    });
  }

  readEvents(tenantId) {
    try {
      const text = readFileSync(this.eventsFile(tenantId), 'utf8');
      const events = [];
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event?.tenantId === tenantId) events.push(event);
        } catch {
          // Keep readable events even when one line is damaged.
        }
      }
      return events;
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  readControls(tenantId) {
    try {
      const parsed = JSON.parse(readFileSync(this.controlsFile(tenantId), 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) return {};
      throw error;
    }
  }

  getControl(tenantId, customerId) {
    const controls = this.readControls(tenantId);
    return controls[String(customerId)] === 'human' ? 'human' : 'ai';
  }

  isHumanControlled(tenantId, customerId) {
    return this.getControl(tenantId, customerId) === 'human';
  }

  setControl(tenantId, customerId, mode) {
    if (!['ai', 'human'].includes(mode)) throw new Error('invalid_conversation_control_mode');
    const controls = this.readControls(tenantId);
    controls[String(customerId)] = mode;
    writeFileSync(this.controlsFile(tenantId), `${JSON.stringify(controls, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return mode;
  }

  list(tenantId) {
    const controls = this.readControls(tenantId);
    const threads = new Map();
    const seen = new Set();
    for (const event of this.readEvents(tenantId)) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      const customerId = String(event.customerId);
      let thread = threads.get(customerId);
      if (!thread) {
        thread = {
          tenantId,
          customerId,
          customerName: event.customerName || customerId,
          control: controls[customerId] === 'human' ? 'human' : 'ai',
          lastActivityAt: event.at,
          preview: '',
          messages: []
        };
        threads.set(customerId, thread);
      }
      if (event.customerName && (event.customerName !== customerId || thread.customerName === customerId)) {
        thread.customerName = event.customerName;
      }
      thread.lastActivityAt = event.at || thread.lastActivityAt;
      if (event.text) thread.preview = event.text;
      thread.messages.push(event);
    }
    return [...threads.values()]
      .map((thread) => ({ ...thread, messages: thread.messages.sort((a, b) => String(a.at).localeCompare(String(b.at))) }))
      .sort((a, b) => String(b.lastActivityAt).localeCompare(String(a.lastActivityAt)));
  }
}
