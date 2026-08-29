import test from 'node:test';
import assert from 'node:assert/strict';

async function loadContract() {
  try {
    return await import('../src/agents/agent-decision.js');
  } catch {
    return null;
  }
}

test('agent decision contract exports a validator', async () => {
  const contract = await loadContract();
  assert.equal(typeof contract?.validateAgentDecision, 'function');
});

test('canonical agent decision preserves permission inputs and bounded runtime metadata', async () => {
  const contract = await loadContract();
  assert.equal(typeof contract?.validateAgentDecision, 'function');

  const decision = contract.validateAgentDecision({
    intent: 'faq',
    confidence: 0.91,
    proposedReply: 'Hello',
    requestedAction: 'reply',
    requestedControl: 'keep_agent',
    conciseRationale: 'Known FAQ answer',
    runtime: {
      runtimeId: 'responses-default',
      provider: 'openai',
      model: 'gpt-5.6'
    }
  });

  assert.deepEqual(decision, {
    intent: 'faq',
    confidence: 0.91,
    proposedReply: 'Hello',
    requestedAction: 'reply',
    requestedControl: 'keep_agent',
    conciseRationale: 'Known FAQ answer',
    runtime: {
      runtimeId: 'responses-default',
      provider: 'openai',
      model: 'gpt-5.6'
    }
  });
  assert.equal(Object.isFrozen(decision), true);
  assert.equal(Object.isFrozen(decision.runtime), true);
});

test('agent decision contract rejects malformed authority and hidden reasoning fields', async () => {
  const contract = await loadContract();
  assert.equal(typeof contract?.validateAgentDecision, 'function');

  const valid = {
    intent: 'faq', confidence: 0.9, proposedReply: 'Hi', requestedAction: 'reply',
    requestedControl: 'keep_agent', runtime: { runtimeId: 'responses-default' }
  };

  assert.throws(() => contract.validateAgentDecision({ ...valid, confidence: 1.1 }), /agent_decision_confidence_invalid/);
  assert.throws(() => contract.validateAgentDecision({ ...valid, requestedAction: 'send_money' }), /unsupported_agent_requested_action/);
  assert.throws(() => contract.validateAgentDecision({ ...valid, requestedControl: 'force_agent' }), /unsupported_agent_requested_control/);
  assert.throws(() => contract.validateAgentDecision({ ...valid, runtime: { runtimeId: '' } }), /agent_runtime_id_required/);
  assert.throws(() => contract.validateAgentDecision({ ...valid, chainOfThought: 'private reasoning' }), /agent_decision_hidden_reasoning_forbidden/);
  assert.throws(() => contract.validateAgentDecision({ ...valid, thinking: 'private reasoning' }), /agent_decision_hidden_reasoning_forbidden/);
  assert.throws(() => contract.validateAgentDecision({ ...valid, reasoning_content: 'private reasoning' }), /agent_decision_hidden_reasoning_forbidden/);
});

test('agent decision allows an explicit capability request but not arbitrary side-effect payloads', async () => {
  const contract = await loadContract();
  assert.equal(typeof contract?.validateAgentDecision, 'function');

  const decision = contract.validateAgentDecision({
    intent: 'order_status',
    confidence: 0.88,
    proposedReply: '',
    requestedAction: 'act',
    requestedControl: 'keep_agent',
    requestedCapability: {
      capabilityId: 'lookup_order',
      arguments: { orderId: 'A-100' }
    },
    runtime: { runtimeId: 'responses-default' }
  });

  assert.deepEqual(decision.requestedCapability, {
    capabilityId: 'lookup_order',
    arguments: { orderId: 'A-100' }
  });
  assert.throws(() => contract.validateAgentDecision({
    ...decision,
    rawToolCall: { url: 'https://example.com', method: 'DELETE' }
  }), /agent_decision_raw_side_effect_forbidden/);
});
