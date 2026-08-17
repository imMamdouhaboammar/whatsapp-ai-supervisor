import { assertAutonomyAction } from './types.js';

const AUTHORITY_RANK = Object.freeze({ draft: 1, reply: 2, act: 3 });

function applyModelCeiling(policyAction, requestedAction) {
  if (!requestedAction) return { action: policyAction, downgraded: false };
  const requested = assertAutonomyAction(requestedAction);

  if (policyAction === 'human' || policyAction === 'ignore') {
    return { action: policyAction, downgraded: false };
  }

  if (requested === 'human' || requested === 'ignore') {
    return { action: requested, downgraded: true };
  }

  const policyRank = AUTHORITY_RANK[policyAction];
  const requestedRank = AUTHORITY_RANK[requested];
  if (requestedRank !== undefined && policyRank !== undefined && requestedRank < policyRank) {
    return { action: requested, downgraded: true };
  }

  return { action: policyAction, downgraded: false };
}

export function evaluatePermission(policy, modelDecision) {
  const minConfidence = policy.minConfidence ?? 0.8;
  const confidence = Number(modelDecision.confidence ?? 0);

  if (confidence < minConfidence) {
    return {
      action: 'human',
      reason: 'low_confidence',
      matchedRuleId: null
    };
  }

  const rule = (policy.rules ?? []).find((candidate) => candidate.intent === modelDecision.intent);
  if (!rule) {
    const action = assertAutonomyAction(policy.defaultAction ?? 'human');
    return {
      action,
      reason: 'no_matching_rule',
      matchedRuleId: null
    };
  }

  const policyAction = assertAutonomyAction(rule.action);
  const resolved = applyModelCeiling(policyAction, modelDecision.requestedAction);

  return {
    action: resolved.action,
    reason: resolved.downgraded ? 'model_requested_less_autonomy' : 'matched_rule',
    matchedRuleId: rule.id
  };
}
