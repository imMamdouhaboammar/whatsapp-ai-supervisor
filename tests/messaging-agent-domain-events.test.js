import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMAIN_EVENT_TYPES, createDomainEvent } from '../src/domain/domain-event.js';

const expectedMessagingAgentEvents = [
  'conversation.ownership_changed',
  'human.outbound_observed',
  'human.handoff_requested',
  'human.handoff_released'
];

test('domain event vocabulary includes ownership and human-observation events', () => {
  for (const eventType of expectedMessagingAgentEvents) {
    assert.equal(DOMAIN_EVENT_TYPES.has(eventType), true, eventType);
  }
});

test('ownership event can carry a canonical conversation state transition', () => {
  const event = createDomainEvent({
    eventType: 'conversation.ownership_changed',
    tenantId: 'acme',
    conversationId: 'whatsapp:20100',
    idempotencyKey: 'acme:whatsapp:20100:takeover-1',
    actor: { type: 'operator', id: 'phone' },
    payload: {
      previousState: 'AI_ACTIVE',
      state: 'HUMAN_ACTIVE',
      version: 1,
      reasonCode: 'manual_outbound_observed'
    }
  }, {
    idFactory: () => 'evt-ownership',
    now: () => '2026-08-27T08:30:00.000Z'
  });

  assert.equal(event.eventType, 'conversation.ownership_changed');
  assert.equal(event.payload.state, 'HUMAN_ACTIVE');
  assert.equal(event.payload.version, 1);
});
