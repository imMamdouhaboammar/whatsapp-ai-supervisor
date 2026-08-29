import test from 'node:test';
import assert from 'node:assert/strict';

async function load(path) {
  try { return await import(path); } catch { return null; }
}

const legacyModelDecision = {
  intent: 'faq',
  confidence: 0.94,
  reply: 'Hello from the agent',
  requestedAction: 'reply',
  provider: 'openai',
  model: 'gpt-5.6',
  thinking: 'must never cross the runtime boundary'
};

test('OpenAIResponsesAgentRuntime adapts ModelGateway output into a canonical completed turn', async () => {
  const mod = await load('../src/agents/openai-responses-agent-runtime.js');
  assert.equal(typeof mod?.OpenAIResponsesAgentRuntime, 'function');
  const runtime = new mod.OpenAIResponsesAgentRuntime({
    runtimeId: 'responses-acme',
    modelGateway: { async decide() { return legacyModelDecision; } },
    idFactory: () => 'turn-generated'
  });

  const result = await runtime.dispatchTurn({
    turnId: 'turn-1',
    message: { id: 'm1', channel: 'whatsapp', customerId: '20100', text: 'hello' },
    routingConfig: { route: 'standard', routes: {} }
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.runtimeId, 'responses-acme');
  assert.equal(result.turnId, 'turn-1');
  assert.deepEqual(result.decision, {
    intent: 'faq',
    confidence: 0.94,
    proposedReply: 'Hello from the agent',
    requestedAction: 'reply',
    requestedControl: 'keep_agent',
    runtime: { runtimeId: 'responses-acme', provider: 'openai', model: 'gpt-5.6' }
  });
  assert.equal('thinking' in result.decision, false);
});

test('OpenAIResponsesAgentRuntime forwards routing context and generates a turn id when absent', async () => {
  const mod = await load('../src/agents/openai-responses-agent-runtime.js');
  assert.equal(typeof mod?.OpenAIResponsesAgentRuntime, 'function');
  let received;
  const runtime = new mod.OpenAIResponsesAgentRuntime({
    runtimeId: 'responses-acme',
    modelGateway: { async decide(message, routingConfig) { received = { message, routingConfig }; return legacyModelDecision; } },
    idFactory: () => 'turn-generated'
  });
  const message = { id: 'm1', channel: 'whatsapp', customerId: '20100', text: 'hello' };
  const routingConfig = { route: 'fast', routes: { fast: [{ provider: 'openai', model: 'gpt-5.6' }] } };
  const result = await runtime.dispatchTurn({ message, routingConfig });
  assert.equal(result.turnId, 'turn-generated');
  assert.deepEqual(received, { message, routingConfig });
});

test('AgentRuntimeGateway selects only an explicitly configured runtime and validates its result', async () => {
  const mod = await load('../src/agents/agent-runtime-gateway.js');
  assert.equal(typeof mod?.AgentRuntimeGateway, 'function');
  const calls = [];
  const runtime = {
    runtimeId: 'responses-acme',
    async dispatchTurn(turn) {
      calls.push(turn);
      return {
        status: 'completed', runtimeId: 'responses-acme', turnId: 'turn-1',
        decision: {
          intent: 'faq', confidence: 0.9, proposedReply: 'Hi', requestedAction: 'reply',
          requestedControl: 'keep_agent', runtime: { runtimeId: 'responses-acme' }
        }
      };
    }
  };
  const gateway = new mod.AgentRuntimeGateway({ runtimes: [runtime], defaultRuntimeId: 'responses-acme' });
  const result = await gateway.dispatchTurn({ turnId: 'turn-1', message: { text: 'workspace-sales' }, routingConfig: {} });
  assert.equal(result.runtimeId, 'responses-acme');
  assert.equal(calls.length, 1);

  await assert.rejects(
    gateway.dispatchTurn({ turnId: 'turn-2', message: { text: 'anything' }, routingConfig: {} }, { runtimeId: 'workspace-sales' }),
    /agent_runtime_unknown_runtime/
  );
});

test('AgentRuntimeGateway rejects runtime identity mismatch instead of trusting adapter output', async () => {
  const mod = await load('../src/agents/agent-runtime-gateway.js');
  assert.equal(typeof mod?.AgentRuntimeGateway, 'function');
  const runtime = {
    runtimeId: 'responses-acme',
    async dispatchTurn() {
      return {
        status: 'dispatched', runtimeId: 'workspace-other', turnId: 'turn-1',
        dispatchedAt: '2026-08-28T06:00:00.000Z', expiresAt: '2026-08-28T06:10:00.000Z'
      };
    }
  };
  const gateway = new mod.AgentRuntimeGateway({ runtimes: [runtime], defaultRuntimeId: 'responses-acme' });
  await assert.rejects(gateway.dispatchTurn({ turnId: 'turn-1', message: {}, routingConfig: {} }), /agent_runtime_identity_mismatch/);
});
