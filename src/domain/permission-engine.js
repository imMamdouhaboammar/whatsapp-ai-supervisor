import { assertAutonomyAction } from './types.js';

const AUTHORITY_RANK = Object.freeze({ draft: 1, reply: 2, act: 3 });
const POLICY_EFFECTS = new Set(['allow', 'require_approval', 'deny']);
const EFFECT_RANK = Object.freeze({ allow: 1, require_approval: 2, deny: 3 });

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

function evaluateV1(policy, modelDecision) {
  const minConfidence = policy.minConfidence ?? 0.8;
  const confidence = Number(modelDecision.confidence ?? 0);

  if (confidence < minConfidence) {
    return { action: 'human', reason: 'low_confidence', matchedRuleId: null };
  }

  const rule = (policy.rules ?? []).find((candidate) => candidate.intent === modelDecision.intent);
  if (!rule) {
    const action = assertAutonomyAction(policy.defaultAction ?? 'human');
    return { action, reason: 'no_matching_rule', matchedRuleId: null };
  }

  const policyAction = assertAutonomyAction(rule.action);
  const resolved = applyModelCeiling(policyAction, modelDecision.requestedAction);
  return {
    action: resolved.action,
    reason: resolved.downgraded ? 'model_requested_less_autonomy' : 'matched_rule',
    matchedRuleId: rule.id
  };
}

function assertEffect(value) {
  if (!POLICY_EFFECTS.has(value)) throw new Error(`Invalid policy effect: ${value}`);
  return value;
}

function validateV2Rule(rule) {
  if (!rule || typeof rule !== 'object') throw new Error('Invalid policy rule');
  if (!String(rule.id ?? '').trim()) throw new Error('Policy rule id is required');
  const intents = rule.intents ?? (rule.intent ? [rule.intent] : []);
  if (!Array.isArray(intents) || intents.length === 0 || intents.some((intent) => !String(intent ?? '').trim())) {
    throw new Error(`Policy rule intent is required: ${rule.id}`);
  }
  const effect = assertEffect(rule.effect);
  if (effect !== 'deny' || rule.action !== undefined) {
    if (effect !== 'deny' && rule.action === undefined) throw new Error(`Policy rule action is required: ${rule.id}`);
    if (rule.action !== undefined) assertAutonomyAction(rule.action);
  }
  const constraints = rule.constraints ?? {};
  if (constraints.channels !== undefined && (!Array.isArray(constraints.channels) || constraints.channels.some((channel) => !String(channel ?? '').trim()))) {
    throw new Error(`Invalid policy channels constraint: ${rule.id}`);
  }
  if (constraints.minConfidence !== undefined) {
    const value = Number(constraints.minConfidence);
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Invalid policy confidence constraint: ${rule.id}`);
  }
  return { ...rule, intents, effect, constraints };
}

function ruleMatches(rule, modelDecision, context, confidence) {
  if (!rule.intents.includes(modelDecision.intent)) return false;
  const channels = rule.constraints.channels;
  if (channels?.length && !channels.includes(context.channel)) return false;
  if (rule.constraints.minConfidence !== undefined && confidence < Number(rule.constraints.minConfidence)) return false;
  return true;
}

function selectRule(policy, modelDecision, context, confidence) {
  return (policy.rules ?? [])
    .map(validateV2Rule)
    .filter((rule) => ruleMatches(rule, modelDecision, context, confidence))
    .sort((a, b) => {
      const effectDifference = EFFECT_RANK[b.effect] - EFFECT_RANK[a.effect];
      if (effectDifference !== 0) return effectDifference;
      const priorityDifference = Number(b.priority ?? 0) - Number(a.priority ?? 0);
      if (priorityDifference !== 0) return priorityDifference;
      return String(a.id).localeCompare(String(b.id));
    })[0] ?? null;
}

function v2Result(policy, values) {
  return {
    ...values,
    policyVersion: 2,
    policyId: policy.id ?? null
  };
}

function deniedResult(policy, rule = null, reason = 'policy_denied') {
  return v2Result(policy, {
    action: 'human',
    effect: 'deny',
    reason,
    reasonCode: rule?.reasonCode ?? (rule ? 'policy_denied' : 'no_matching_rule'),
    matchedRuleId: rule?.id ?? null,
    requiresApproval: false,
    intendedAction: null
  });
}

function approvalResult(policy, rule) {
  const intendedAction = assertAutonomyAction(rule.action);
  return v2Result(policy, {
    action: 'human',
    effect: 'require_approval',
    reason: 'approval_required',
    reasonCode: rule.reasonCode ?? 'approval_required',
    matchedRuleId: rule.id,
    requiresApproval: true,
    intendedAction
  });
}

function defaultV2Result(policy) {
  const effect = assertEffect(policy.defaultEffect ?? 'deny');
  if (effect === 'deny') return deniedResult(policy, null, 'no_matching_rule');
  if (effect === 'require_approval') {
    if (!policy.defaultAction) throw new Error('Policy v2 defaultAction is required for default approval');
    return approvalResult(policy, { id: null, action: policy.defaultAction, reasonCode: 'default_approval_required' });
  }
  if (!policy.defaultAction) throw new Error('Policy v2 defaultAction is required when defaultEffect is allow');
  const action = assertAutonomyAction(policy.defaultAction);
  return v2Result(policy, {
    action,
    effect: 'allow',
    reason: 'no_matching_rule',
    reasonCode: 'default_allow',
    matchedRuleId: null,
    requiresApproval: false,
    intendedAction: null
  });
}

function evaluateV2(policy, modelDecision, context) {
  assertEffect(policy.defaultEffect ?? 'deny');
  for (const rule of policy.rules ?? []) validateV2Rule(rule);

  const confidence = Number(modelDecision.confidence ?? 0);
  const minConfidence = Number(policy.minConfidence ?? 0.8);
  if (!Number.isFinite(confidence) || confidence < minConfidence) {
    return v2Result(policy, {
      action: 'human',
      effect: 'deny',
      reason: 'low_confidence',
      reasonCode: 'low_confidence',
      matchedRuleId: null,
      requiresApproval: false,
      intendedAction: null
    });
  }

  const rule = selectRule(policy, modelDecision, context, confidence);
  if (!rule) return defaultV2Result(policy);
  if (rule.effect === 'deny') return deniedResult(policy, rule);
  if (rule.effect === 'require_approval') return approvalResult(policy, rule);

  const policyAction = assertAutonomyAction(rule.action);
  const resolved = applyModelCeiling(policyAction, modelDecision.requestedAction);
  return v2Result(policy, {
    action: resolved.action,
    effect: 'allow',
    reason: resolved.downgraded ? 'model_requested_less_autonomy' : 'matched_rule',
    reasonCode: resolved.downgraded ? 'model_requested_less_autonomy' : (rule.reasonCode ?? 'matched_rule'),
    matchedRuleId: rule.id,
    requiresApproval: false,
    intendedAction: null
  });
}

export function evaluatePermission(policy, modelDecision, context = {}) {
  if (Number(policy?.version) === 2) return evaluateV2(policy ?? {}, modelDecision ?? {}, context ?? {});
  return evaluateV1(policy ?? {}, modelDecision ?? {});
}
