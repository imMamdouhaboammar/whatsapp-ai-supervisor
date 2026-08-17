import test from 'node:test';
import assert from 'node:assert/strict';
import { SseBroadcaster } from '../src/realtime/sse-broadcaster.js';
import { createDomainEvent } from '../src/domain/domain-event.js';

class FakeResponse {
  constructor() {
    this.headers = null;
    this.status = null;
    this.writes = [];
    this.listeners = new Map();
  }
  writeHead(status, headers) {
    this.status = status;
    this.headers = headers;
  }
  write(chunk) {
    this.writes.push(String(chunk));
    return true;
  }
  on(name, listener) {
    this.listeners.set(name, listener);
  }
}

test('SseBroadcaster emits canonical domain event envelope without flattening it', () => {
  const broadcaster = new SseBroadcaster({ heartbeatMs: 0 });
  const response = new FakeResponse();
  broadcaster.addClient(response);
  response.writes.length = 0;

  const event = createDomainEvent({
    eventType: 'message.received',
    tenantId: 'acme',
    conversationId: 'whatsapp:20100',
    messageId: 'wamid.in',
    actor: { type: 'connector', id: 'whatsapp-cloud' },
    payload: { text: 'Hello' }
  });

  broadcaster.broadcastDomainEvent(event);

  assert.equal(response.writes.length, 1);
  const frame = response.writes[0];
  assert.match(frame, /^event: message\.received\n/);
  const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
  assert.ok(dataLine);
  assert.deepEqual(JSON.parse(dataLine.slice(6)), event);
});

test('SseBroadcaster rejects malformed domain events at the realtime boundary', () => {
  const broadcaster = new SseBroadcaster({ heartbeatMs: 0 });
  assert.throws(() => broadcaster.broadcastDomainEvent({
    eventId: 'evt-bad',
    eventType: 'made.up',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    tenantId: 'acme',
    correlationId: 'evt-bad',
    actor: { type: 'connector' },
    payload: {}
  }), /unsupported_domain_event_type/);
});
