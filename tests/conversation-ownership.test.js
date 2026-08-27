import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONVERSATION_OWNERSHIP_STATES,
  createInitialOwnership,
  transitionOwnership,
  assertConversationOwnership
} from '../src/domain/conversation-ownership.js';

const fixedNow = () => '2026-08-27T08:00:00.000Z';
const later = () => '2026-08-27T08:01:00.000Z';

function initial() {
  return createInitialOwnership({ tenantId: 'acme', conversationId: 'whatsapp:20100' }, {
    now: fixedNow,
    actor: 'supervisor'
  });
}

test('createInitialOwnership defaults a new conversation to AI_ACTIVE version zero', () => {
  const ownership = initial();
  assert.deepEqual(ownership, {
    tenantId: 'acme',
    conversationId: 'whatsapp:20100',
    state: 'AI_ACTIVE',
    version: 0,
    changedAt: '2026-08-27T08:00:00.000Z',
    changedBy: 'supervisor',
    reasonCode: 'default_ai_active',
    transitionId: null
  });
  assert.equal(Object.isFrozen(ownership), true);
});

test('manual takeover wins from every canonical ownership state', () => {
  for (const state of CONVERSATION_OWNERSHIP_STATES) {
    const current = { ...initial(), state, version: state === 'AI_ACTIVE' ? 0 : 4 };
    const next = transitionOwnership(current, 'manual_takeover', {
      transitionId: `takeover-${state}`,
      actor: 'operator:phone',
      reasonCode: 'manual_outbound_observed',
      now: later
    });
    assert.equal(next.state, 'HUMAN_ACTIVE');
    if (state === 'HUMAN_ACTIVE') {
      assert.equal(next.version, 4);
    } else {
      assert.equal(next.version, current.version + 1);
      assert.equal(next.changedBy, 'operator:phone');
      assert.equal(next.reasonCode, 'manual_outbound_observed');
    }
  }
});

test('human ownership can return to AI only through explicit release', () => {
  const human = { ...initial(), state: 'HUMAN_ACTIVE', version: 3, changedAt: later() };

  const implicitResume = transitionOwnership(human, 'resume_agent', {
    transitionId: 'resume-wrong-command', actor: 'scheduler', now: later
  });
  assert.equal(implicitResume.state, 'HUMAN_ACTIVE');
  assert.equal(implicitResume.version, 3);

  const released = transitionOwnership(human, 'release_to_agent', {
    transitionId: 'release-1', actor: 'operator:console', reasonCode: 'explicit_release', now: later
  });
  assert.equal(released.state, 'AI_ACTIVE');
  assert.equal(released.version, 4);
});

test('approval, handoff and pause transitions follow the architecture state machine', () => {
  const ai = initial();
  const waiting = transitionOwnership(ai, 'wait_for_approval', {
    transitionId: 'approval-1', actor: 'permission-engine', now: later
  });
  assert.equal(waiting.state, 'WAITING_APPROVAL');

  const resolved = transitionOwnership(waiting, 'approval_resolved', {
    transitionId: 'approval-resolved-1', actor: 'operator:console', now: later
  });
  assert.equal(resolved.state, 'AI_ACTIVE');

  const handoff = transitionOwnership(ai, 'request_handoff', {
    transitionId: 'handoff-1', actor: 'agent', now: later
  });
  assert.equal(handoff.state, 'HUMAN_REQUESTED');

  const paused = transitionOwnership(handoff, 'pause_agent', {
    transitionId: 'pause-1', actor: 'supervisor', now: later
  });
  assert.equal(paused.state, 'AI_PAUSED');

  const resumed = transitionOwnership(paused, 'resume_agent', {
    transitionId: 'resume-1', actor: 'operator:console', now: later
  });
  assert.equal(resumed.state, 'AI_ACTIVE');
});

test('no-op transitions do not change version or mutation metadata', () => {
  const ai = initial();
  const noOp = transitionOwnership(ai, 'approval_resolved', {
    transitionId: 'no-op', actor: 'operator:console', reasonCode: 'not_waiting', now: later
  });
  assert.deepEqual(noOp, ai);
});

test('assertConversationOwnership rejects malformed records and transitionOwnership rejects unknown commands', () => {
  const valid = initial();
  assert.equal(assertConversationOwnership(valid), valid);
  assert.throws(() => assertConversationOwnership({ ...valid, state: 'UNKNOWN' }), /unsupported_ownership_state/);
  assert.throws(() => assertConversationOwnership({ ...valid, version: -1 }), /ownership_version_invalid/);
  assert.throws(() => assertConversationOwnership({ ...valid, changedAt: 'tomorrow' }), /ownership_changed_at_invalid/);
  assert.throws(() => transitionOwnership(valid, 'steal_control', {
    transitionId: 'bad-command', actor: 'operator'
  }), /unsupported_ownership_command/);
});
