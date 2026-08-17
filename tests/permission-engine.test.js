import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePermission } from '../src/domain/permission-engine.js';

const policy = {
  minConfidence: 0.8,
  defaultAction: 'human',
  rules: [
    { id: 'faq', intent: 'faq', action: 'reply' },
    { id: 'refund', intent: 'refund', action: 'human' },
    { id: 'pricing', intent: 'pricing', action: 'draft' }
  ]
};

test('exact intent rule permits automatic reply', () => {
  const result = evaluatePermission(policy, { intent: 'faq', confidence: 0.93 });
  assert.deepEqual(result, { action: 'reply', reason: 'matched_rule', matchedRuleId: 'faq' });
});

test('low confidence fails closed to human', () => {
  const result = evaluatePermission(policy, { intent: 'faq', confidence: 0.6 });
  assert.equal(result.action, 'human');
  assert.equal(result.reason, 'low_confidence');
});

test('unknown intent fails closed to configured default', () => {
  const result = evaluatePermission(policy, { intent: 'something_new', confidence: 0.99 });
  assert.equal(result.action, 'human');
  assert.equal(result.reason, 'no_matching_rule');
});

test('human-only rule overrides model requested action', () => {
  const result = evaluatePermission(policy, { intent: 'refund', confidence: 0.98, requestedAction: 'reply' });
  assert.equal(result.action, 'human');
  assert.equal(result.matchedRuleId, 'refund');
});

test('model can request less autonomy but can never upgrade policy authority', () => {
  const conservative = evaluatePermission(policy, { intent: 'faq', confidence: 0.95, requestedAction: 'human' });
  assert.equal(conservative.action, 'human');
  assert.equal(conservative.reason, 'model_requested_less_autonomy');

  const cannotUpgrade = evaluatePermission(policy, { intent: 'pricing', confidence: 0.95, requestedAction: 'act' });
  assert.equal(cannotUpgrade.action, 'draft');
});
