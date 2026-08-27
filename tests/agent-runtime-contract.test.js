import test from 'node:test';
import assert from 'node:assert/strict';

async function loadRuntimeContract() {
  try {
    return await import('../src/agents/agent-runtime.js');
  } catch {
    return null;
  }
}

const decision = {
  intent: 'faq',
  confidence: 0.9,
  proposedReply: 'Hello',
  requestedAction: 'reply',
  requestedControl: 'keep_agent',
  runtime: { runtimeId: 'responses-default', provider: 'openai', model: 'gpt-5.6' }
};

test('agent runtime contract exposes validation and base runtime surface', async () => {
  const contract = await loadRuntimeContract();
  assert.equal(typeof contract?.validateAgentRuntimeResult, 'function');
  assert.equal(typeof contract?.AgentRuntime, 'function');
  const runtime = new contract.AgentRuntime({ runtimeId: 'base' });
  await assert.rejects(runtime.dispatchTurn({}), /agent_runtime_dispatch_not_implemented/);
});

test('completed runtime result contains one canonical decision', async () => {
  const contract = await loadRuntimeContract();
  assert.equal(typeof contract?.validateAgentRuntimeResult, 'function');
  const result = contract.validateAgentRuntimeResult({
    status: 'completed',
    runtimeId: 'responses-default',
    turnId: 'turn-1',
    decision
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.runtimeId, 'responses-default');
  assert.equal(result.turnId, 'turn-1');
  assert.equal(result.decision.intent, 'faq');
  assert.equal(Object.isFrozen(result), true);
});

test('dispatched runtime result contains correlation but no speculative decision', async () => {
  const contract = await loadRuntimeContract();
  assert.equal(typeof contract?.validateAgentRuntimeResult, 'function');
  const result = contract.validateAgentRuntimeResult({
    status: 'dispatched',
    runtimeId: 'workspace-sales',
    turnId: 'turn-async-1',
    dispatchedAt: '2026-08-27T10:55:00.000Z',
    expiresAt: '2026-08-27T11:10:00.000Z'
  });

  assert.deepEqual(result, {
    status: 'dispatched',
    runtimeId: 'workspace-sales',
    turnId: 'turn-async-1',
    dispatchedAt: '2026-08-27T10:55:00.000Z',
    expiresAt: '2026-08-27T11:10:00.000Z'
  });
  assert.equal('decision' in result, false);
});

test('runtime result rejects ambiguous sync/async shapes and invalid timestamps', async () => {
  const contract = await loadRuntimeContract();
  assert.equal(typeof contract?.validateAgentRuntimeResult, 'function');

  assert.throws(() => contract.validateAgentRuntimeResult({
    status: 'dispatched', runtimeId: 'workspace-sales', turnId: 'turn-1', decision
  }), /agent_runtime_dispatched_decision_forbidden/);

  assert.throws(() => contract.validateAgentRuntimeResult({
    status: 'completed', runtimeId: 'responses-default', turnId: 'turn-1'
  }), /agent_runtime_completed_decision_required/);

  assert.throws(() => contract.validateAgentRuntimeResult({
    status: 'dispatched', runtimeId: 'workspace-sales', turnId: 'turn-1',
    dispatchedAt: 'not-a-date', expiresAt: '2026-08-27T11:10:00.000Z'
  }), /agent_runtime_dispatched_at_invalid/);

  assert.throws(() => contract.validateAgentRuntimeResult({
    status: 'unknown', runtimeId: 'x', turnId: 'turn-1'
  }), /unsupported_agent_runtime_status/);
});
