import test from 'node:test';
import assert from 'node:assert/strict';
import { SupervisorOrchestrator } from '../src/core/orchestrator.js';
import { InMemoryAuditStore } from '../src/core/audit-store.js';

function tenant() {
  return {
    id: 'acme',
    ai: { route: 'standard', routes: {} },
    policy: {
      minConfidence: 0.8,
      defaultAction: 'human',
      rules: [{ id: 'faq', intent: 'faq', action: 'reply' }]
    }
  };
}

function completedGateway() {
  return {
    async dispatchTurn() {
      return {
        status: 'completed',
        runtimeId: 'responses-acme',
        turnId: 'turn-1',
        decision: {
          intent: 'faq', confidence: 0.95, proposedReply: 'Hello', requestedAction: 'reply',
          requestedControl: 'keep_agent', runtime: { runtimeId: 'responses-acme', provider: 'openai', model: 'gpt-5.6' }
        }
      };
    }
  };
}

test('orchestrator consumes completed AgentDecision while PermissionEngine remains final authority', async () => {
  let sends = 0;
  const orchestrator = new SupervisorOrchestrator({
    agentRuntimeGateway: completedGateway(),
    channelSender: { async sendText() { sends += 1; return { id: 'out-1' }; } },
    auditStore: new InMemoryAuditStore()
  });
  const result = await orchestrator.handle(
    { id: 'm1', channel: 'whatsapp', customerId: '20100', text: 'hello' },
    tenant(),
    { turnContext: { turnId: 'turn-1', conversationId: 'whatsapp:20100', eventId: 'event-1', ownershipVersion: 2 } }
  );
  assert.equal(result.action, 'reply');
  assert.equal(result.model.reply, 'Hello');
  assert.equal(result.model.provider, 'openai');
  assert.equal(result.model.model, 'gpt-5.6');
  assert.equal(result.permission.action, 'reply');
  assert.equal(sends, 1);
});

test('policy can still downgrade a completed runtime decision and prevent sending', async () => {
  let sends = 0;
  const orchestrator = new SupervisorOrchestrator({
    agentRuntimeGateway: completedGateway(),
    channelSender: { async sendText() { sends += 1; return {}; } },
    auditStore: new InMemoryAuditStore()
  });
  const restricted = tenant();
  restricted.policy = { minConfidence: 0.99, defaultAction: 'human', rules: [{ id: 'faq', intent: 'faq', action: 'reply' }] };
  const result = await orchestrator.handle({ id: 'm1', channel: 'whatsapp', customerId: '20100', text: 'hello' }, restricted);
  assert.equal(result.action, 'human');
  assert.equal(sends, 0);
});

test('dispatched async runtime persists one pending turn and performs no policy or outbound side effect', async () => {
  const recorded = [];
  let sends = 0;
  const orchestrator = new SupervisorOrchestrator({
    agentRuntimeGateway: {
      async dispatchTurn() {
        return {
          status: 'dispatched', runtimeId: 'workspace-sales', turnId: 'turn-async-1',
          dispatchedAt: '2026-08-28T06:00:00.000Z', expiresAt: '2026-08-28T06:10:00.000Z'
        };
      }
    },
    pendingAgentTurnStore: { async record(value) { recorded.push(value); return value; } },
    channelSender: { async sendText() { sends += 1; return {}; } },
    auditStore: new InMemoryAuditStore()
  });

  const result = await orchestrator.handle(
    { id: 'm1', channel: 'whatsapp', customerId: '20100', text: 'hello' },
    tenant(),
    { turnContext: { conversationId: 'whatsapp:20100', eventId: 'event-1', ownershipVersion: 7 } }
  );

  assert.equal(result.action, 'pending');
  assert.equal(result.reason, 'agent_turn_dispatched');
  assert.equal(result.permission, null);
  assert.equal(result.model, null);
  assert.equal(sends, 0);
  assert.equal(recorded.length, 1);
  assert.deepEqual(recorded[0], {
    tenantId: 'acme', conversationId: 'whatsapp:20100', messageId: 'm1',
    turnId: 'turn-async-1', runtimeId: 'workspace-sales',
    dispatchedAt: '2026-08-28T06:00:00.000Z', expiresAt: '2026-08-28T06:10:00.000Z',
    status: 'pending', ownershipVersion: 7
  });
});

test('async dispatch fails closed when no pending turn store is configured', async () => {
  const orchestrator = new SupervisorOrchestrator({
    agentRuntimeGateway: {
      async dispatchTurn() {
        return {
          status: 'dispatched', runtimeId: 'workspace-sales', turnId: 'turn-async-1',
          dispatchedAt: '2026-08-28T06:00:00.000Z', expiresAt: '2026-08-28T06:10:00.000Z'
        };
      }
    },
    channelSender: { async sendText() { throw new Error('should_not_send'); } },
    auditStore: new InMemoryAuditStore()
  });
  await assert.rejects(
    orchestrator.handle({ id: 'm1', channel: 'whatsapp', customerId: '20100', text: 'hello' }, tenant()),
    /pending_agent_turn_store_required/
  );
});
