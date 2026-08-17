import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function safeTenantId(value) {
  return String(value).replace(/[^a-z0-9._-]/gi, '_');
}

function displayName(event) {
  return event.customerName || event.customerId;
}

function lineageFields(domainEvent) {
  if (!domainEvent) return {};
  return {
    domainEventId: domainEvent.eventId,
    domainEventType: domainEvent.eventType,
    domainSchemaVersion: domainEvent.schemaVersion,
    conversationId: domainEvent.conversationId ?? null,
    correlationId: domainEvent.correlationId,
    causationId: domainEvent.causationId ?? null,
    idempotencyKey: domainEvent.idempotencyKey ?? null
  };
}

function decisionArguments(domainEventOrAt, atOverride) {
  if (typeof domainEventOrAt === 'string') {
    return { domainEvent: null, at: domainEventOrAt };
  }
  const domainEvent = domainEventOrAt ?? null;
  return {
    domainEvent,
    at: atOverride ?? domainEvent?.occurredAt ?? new Date().toISOString()
  };
}

export class FileConversationStore {
  constructor({ dataDir }) {
    this.dir = join(dataDir, 'conversations');
    mkdirSync(this.dir, { recursive: true });
  }

  fileFor(tenantId) {
    return join(this.dir, `${safeTenantId(tenantId)}.ndjson`);
  }

  appendEvent(event) {
    if (!event?.tenantId) throw new Error('conversation_event_tenant_required');
    if (!event?.customerId) throw new Error('conversation_event_customer_required');
    appendFileSync(this.fileFor(event.tenantId), `${JSON.stringify(event)}\n`, 'utf8');
    return event;
  }

  recordInbound(message, domainEvent = null, at = domainEvent?.occurredAt ?? new Date().toISOString()) {
    return this.appendEvent({
      id: message.id,
      tenantId: message.tenantId,
      customerId: String(message.customerId),
      customerName: message.customerName ?? null,
      type: 'message',
      direction: 'inbound',
      text: message.text ?? '',
      at,
      ...lineageFields(domainEvent)
    });
  }

  recordDecision(message, result, domainEventOrAt = null, atOverride = null) {
    const { domainEvent, at } = decisionArguments(domainEventOrAt, atOverride);
    const decisionEvent = this.appendEvent({
      id: crypto.randomUUID(),
      tenantId: message.tenantId,
      customerId: String(message.customerId),
      customerName: message.customerName ?? null,
      type: 'decision',
      direction: 'system',
      text: result.model?.reply ?? '',
      at,
      action: result.action,
      intent: result.model?.intent ?? null,
      confidence: result.model?.confidence ?? null,
      thinking: result.model?.thinking ?? null,
      proactiveOffer: result.model?.proactiveOffer ?? null,
      modelName: result.model?.model ?? null,
      provider: result.model?.provider ?? null,
      ...lineageFields(domainEvent)
    });

    if (result.action === 'reply' && result.model?.reply) {
      this.appendEvent({
        id: result.outbound?.messages?.[0]?.id ?? result.outbound?.id ?? crypto.randomUUID(),
        tenantId: message.tenantId,
        customerId: String(message.customerId),
        customerName: message.customerName ?? null,
        type: 'message',
        direction: 'assistant',
        text: result.model.reply,
        at,
        action: result.action,
        intent: result.model?.intent ?? null,
        confidence: result.model?.confidence ?? null,
        thinking: result.model?.thinking ?? null,
        proactiveOffer: result.model?.proactiveOffer ?? null,
        modelName: result.model?.model ?? null,
        provider: result.model?.provider ?? null
      });
    }

    return decisionEvent;
  }

  recordManualOutbound({ tenantId, customerId, customerName = null, text, messageId = null, at = new Date().toISOString() }) {
    return this.appendEvent({
      id: messageId ?? crypto.randomUUID(),
      tenantId,
      customerId: String(customerId),
      customerName,
      type: 'message',
      direction: 'operator',
      text,
      at,
      action: 'human'
    });
  }

  setControl(tenantId, customerId, mode, at = new Date().toISOString()) {
    if (!['ai', 'human'].includes(mode)) throw new Error('invalid_conversation_control_mode');
    return this.appendEvent({
      id: crypto.randomUUID(),
      tenantId,
      customerId: String(customerId),
      customerName: null,
      type: 'control',
      direction: 'system',
      text: '',
      at,
      mode
    });
  }

  readEvents(tenantId) {
    const file = this.fileFor(tenantId);
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  getControl(tenantId, customerId) {
    let mode = 'ai';
    for (const event of this.readEvents(tenantId)) {
      if (String(event.customerId) === String(customerId) && event.type === 'control') mode = event.mode;
    }
    return mode;
  }

  isHumanControlled(tenantId, customerId) {
    return this.getControl(tenantId, customerId) === 'human';
  }

  list(tenantId, { limit = 200 } = {}) {
    const events = this.readEvents(tenantId);
    const threads = new Map();
    for (const event of events) {
      if (!threads.has(event.customerId)) {
        threads.set(event.customerId, {
          tenantId,
          customerId: event.customerId,
          customerName: displayName(event),
          control: 'ai',
          lastActivityAt: event.at,
          lastAction: null,
          lastIntent: null,
          lastConfidence: null,
          messages: []
        });
      }
      const thread = threads.get(event.customerId);
      thread.customerName = event.customerName || thread.customerName;
      thread.lastActivityAt = event.at || thread.lastActivityAt;

      if (event.type === 'control') {
        thread.control = event.mode;
        continue;
      }

      if (event.action) thread.lastAction = event.action;
      if (event.intent) thread.lastIntent = event.intent;
      if (event.confidence !== null && event.confidence !== undefined) thread.lastConfidence = event.confidence;
      if (event.type === 'decision') continue;

      thread.messages.push({
        id: event.id,
        direction: event.direction,
        text: event.text,
        at: event.at,
        action: event.action ?? null,
        intent: event.intent ?? null,
        confidence: event.confidence ?? null,
        thinking: event.thinking ?? null,
        proactiveOffer: event.proactiveOffer ?? null,
        modelName: event.modelName ?? null,
        provider: event.provider ?? null
      });
    }

    return [...threads.values()]
      .sort((a, b) => String(b.lastActivityAt).localeCompare(String(a.lastActivityAt)))
      .slice(0, limit)
      .map((thread) => ({
        ...thread,
        preview: thread.messages.at(-1)?.text ?? '',
        messageCount: thread.messages.length
      }));
  }

  listRecentEvents(tenantId, limit = 200) {
    return this.readEvents(tenantId).slice(-limit).reverse();
  }
}
