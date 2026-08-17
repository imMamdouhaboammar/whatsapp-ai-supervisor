import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePermission } from '../src/domain/permission-engine.js';

const basePolicy = {
  version: 2,
  id: 'customer-care-v2',
  minConfidence: 0.75,
  defaultEffect: 'deny',
  rules: []
};

function evaluate(policy, model, context = {}) {
  return evaluatePermission(policy, model, { channel: 'whatsapp', ...context });
}

test('policy v2 deny overrides approval and allow matches regardless of declaration order', () => {
  const policy = {
    ...basePolicy,
    rules: [
      { id: 'allow-refund', intent: 'refund', effect: 'allow', action: 'act', priority: 100 },
      { id: 'approve-refund', intent: 'refund', effect: 'require_approval', action: 'act', priority: 200 },
      { id: 'deny-refund', intent: 'refund', effect: 'deny', reasonCode: 'refund_locked', priority: 1 }
    ]
  };

  const result = evaluate(policy, { intent: 'refund', confidence: 0.98, requestedAction: 'act' });
  assert.deepEqual(result, {
    action: 'human',
    effect: 'deny',
    reason: 'policy_denied',
    reasonCode: 'refund_locked',
    matchedRuleId: 'deny-refund',
    policyVersion: 2,
    policyId: 'customer-care-v2',
    requiresApproval: false,
    intendedAction: null
  });
});

test('require_approval returns a fail-closed human action with explicit intended action', () => {
  const policy = {
    ...basePolicy,
    rules: [
      { id: 'approve-refund', intent: 'refund', effect: 'require_approval', action: 'act', reasonCode: 'refund_needs_operator' }
    ]
  };

  const result = evaluate(policy, { intent: 'refund', confidence: 0.96, requestedAction: 'act' });
  assert.equal(result.action, 'human');
  assert.equal(result.effect, 'require_approval');
  assert.equal(result.requiresApproval, true);
  assert.equal(result.intendedAction, 'act');
  assert.equal(result.reasonCode, 'refund_needs_operator');
  assert.equal(result.matchedRuleId, 'approve-refund');
});

test('v2 contextual constraints prevent a rule from matching outside its channel and confidence floor', () => {
  const policy = {
    ...basePolicy,
    minConfidence: 0.5,
    rules: [
      {
        id: 'whatsapp-order-action',
        intent: 'order_status',
        effect: 'allow',
        action: 'act',
        priority: 10,
        constraints: { channels: ['whatsapp'], minConfidence: 0.9 }
      }
    ]
  };

  const wrongChannel = evaluate(policy, { intent: 'order_status', confidence: 0.97, requestedAction: 'act' }, { channel: 'email' });
  assert.equal(wrongChannel.action, 'human');
  assert.equal(wrongChannel.reason, 'no_matching_rule');
  assert.equal(wrongChannel.effect, 'deny');

  const lowForRule = evaluate(policy, { intent: 'order_status', confidence: 0.8, requestedAction: 'act' });
  assert.equal(lowForRule.action, 'human');
  assert.equal(lowForRule.reason, 'no_matching_rule');

  const allowed = evaluate(policy, { intent: 'order_status', confidence: 0.97, requestedAction: 'act' });
  assert.equal(allowed.action, 'act');
  assert.equal(allowed.effect, 'allow');
  assert.equal(allowed.matchedRuleId, 'whatsapp-order-action');
});

test('same-effect rules use explicit priority instead of declaration order', () => {
  const policy = {
    ...basePolicy,
    rules: [
      { id: 'low', intent: 'faq', effect: 'allow', action: 'draft', priority: 1 },
      { id: 'high', intent: 'faq', effect: 'allow', action: 'reply', priority: 50 }
    ]
  };
  const result = evaluate(policy, { intent: 'faq', confidence: 0.99, requestedAction: 'reply' });
  assert.equal(result.action, 'reply');
  assert.equal(result.matchedRuleId, 'high');
});

test('model can lower v2 allow authority but can never bypass deny or approval', () => {
  const allow = evaluate({
    ...basePolicy,
    rules: [{ id: 'faq', intent: 'faq', effect: 'allow', action: 'reply' }]
  }, { intent: 'faq', confidence: 0.95, requestedAction: 'human' });
  assert.equal(allow.action, 'human');
  assert.equal(allow.reason, 'model_requested_less_autonomy');

  const approval = evaluate({
    ...basePolicy,
    rules: [{ id: 'pay', intent: 'payment', effect: 'require_approval', action: 'act' }]
  }, { intent: 'payment', confidence: 0.99, requestedAction: 'reply' });
  assert.equal(approval.action, 'human');
  assert.equal(approval.requiresApproval, true);
  assert.equal(approval.intendedAction, 'act');
});

test('v2 rejects unsafe or malformed policy documents instead of guessing', () => {
  assert.throws(() => evaluate({ ...basePolicy, rules: [{ id: 'x', intent: 'faq', effect: 'allow', action: 'delete' }] }, { intent: 'faq', confidence: 1 }), /Invalid autonomy action/);
  assert.throws(() => evaluate({ ...basePolicy, rules: [{ id: 'x', intent: 'faq', effect: 'mystery', action: 'reply' }] }, { intent: 'faq', confidence: 1 }), /Invalid policy effect/);
  assert.throws(() => evaluate({ ...basePolicy, defaultEffect: 'allow', rules: [] }, { intent: 'unknown', confidence: 1 }), /defaultAction/);
});

test('v1 policy result shape remains exactly backward compatible', () => {
  const legacy = {
    minConfidence: 0.8,
    defaultAction: 'human',
    rules: [{ id: 'faq', intent: 'faq', action: 'reply' }]
  };
  assert.deepEqual(
    evaluatePermission(legacy, { intent: 'faq', confidence: 0.93 }),
    { action: 'reply', reason: 'matched_rule', matchedRuleId: 'faq' }
  );
});
