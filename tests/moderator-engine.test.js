import test from 'node:test';
import assert from 'node:assert/strict';
import { AutonomousModeratorEngine } from '../src/ai/moderator-engine.js';
import { SupervisorOrchestrator } from '../src/core/orchestrator.js';
import { InMemoryAuditStore } from '../src/core/audit-store.js';

test('AutonomousModeratorEngine resolves unanswered inbound messages and triggers replies', async () => {
  const tenant = {
    id: 'test-tenant',
    businessContext: { name: 'Test Business' },
    policy: { defaultAction: 'reply', rules: [{ id: 'faq', intent: 'faq', action: 'reply' }] }
  };

  const sentMessages = [];
  const fakeSender = {
    sendText: async (msg) => { sentMessages.push(msg); return { id: 'sent-1' }; }
  };

  const threadList = [
    {
      customerId: '12345',
      customerName: 'Alice',
      control: 'ai',
      messages: [
        { id: 'msg-1', direction: 'inbound', text: 'Hello, need help' }
      ]
    }
  ];

  const recordedDecisions = [];
  const fakeConversationStore = {
    list: () => threadList,
    recordDecision: (msg, result) => recordedDecisions.push({ msg, result }),
    appendEvent: () => {}
  };

  const fakeOrchestrator = {
    handle: async () => ({
      action: 'reply',
      model: {
        intent: 'faq',
        confidence: 0.95,
        reply: 'Hello! How can I assist you?',
        thinking: 'Direct reply to greeting',
        proactiveOffer: 'offer_catalog'
      }
    }),
    modelGateway: {
      decide: async () => ({})
    }
  };

  const engine = new AutonomousModeratorEngine({
    tenantStore: { list: () => [tenant], findById: () => tenant },
    conversationStore: fakeConversationStore,
    auditStore: { append: () => {} },
    orchestratorForTenant: () => fakeOrchestrator,
    channelSenderForTenant: () => fakeSender
  });

  const report = await engine.moderateAll({ tenantId: 'test-tenant', dryRun: false });

  assert.equal(report.totalRepliesSent, 1);
  assert.equal(recordedDecisions.length, 1);
  assert.equal(report.summaries[0].results[0].reply, 'Hello! How can I assist you?');
});

test('AutonomousModeratorEngine skips human-controlled threads unless forced', async () => {
  const tenant = { id: 'test-tenant' };
  const threadList = [
    {
      customerId: '99999',
      customerName: 'Bob',
      control: 'human',
      messages: [{ id: 'msg-1', direction: 'inbound', text: 'Where is my order?' }]
    }
  ];

  const engine = new AutonomousModeratorEngine({
    tenantStore: { list: () => [tenant], findById: () => tenant },
    conversationStore: { list: () => threadList },
    auditStore: { append: () => {} },
    orchestratorForTenant: () => ({ handle: async () => ({ action: 'reply' }) }),
    channelSenderForTenant: () => ({ sendText: async () => {} })
  });

  const report = await engine.moderateAll({ tenantId: 'test-tenant', forceAll: false });
  assert.equal(report.summaries[0].skipped, 1);
  assert.equal(report.totalRepliesSent, 0);
});

test('moderator dry run evaluates an unanswered inbound without sending it', async () => {
  const tenant = {
    id: 'test-tenant',
    ai: { route: 'standard', routes: { standard: [{ provider: 'fake', model: 'fake' }] } },
    policy: { minConfidence: 0.8, defaultAction: 'human', rules: [{ id: 'faq', intent: 'faq', action: 'reply' }] }
  };
  const sent = [];
  const auditStore = new InMemoryAuditStore();
  const conversationStore = {
    list: () => [{ customerId: '12345', customerName: 'Alice', control: 'ai', messages: [{ id: 'msg-1', direction: 'inbound', text: 'Hello' }] }],
    readEvents: () => [],
    recordDecision() {},
    appendEvent() {}
  };
  const orchestrator = new SupervisorOrchestrator({
    modelGateway: { async decide() { return { intent: 'faq', confidence: 0.96, reply: 'Hi Alice', requestedAction: 'reply' }; } },
    channelSender: { async sendText(message) { sent.push(message); return { id: 'sent-1' }; } },
    auditStore,
    conversationStore
  });
  const engine = new AutonomousModeratorEngine({
    tenantStore: { list: () => [tenant], findById: () => tenant },
    conversationStore,
    auditStore,
    orchestratorForTenant: () => orchestrator,
    channelSenderForTenant: () => ({ sendText: async () => { throw new Error('unexpected_direct_send'); } })
  });

  const report = await engine.moderateAll({ tenantId: 'test-tenant', dryRun: true });

  assert.equal(sent.length, 0);
  assert.equal(report.totalRepliesSent, 0);
  assert.equal(report.summaries[0].results[0].action, 'simulation');
  assert.equal(report.summaries[0].results[0].wouldAction, 'reply');
});
