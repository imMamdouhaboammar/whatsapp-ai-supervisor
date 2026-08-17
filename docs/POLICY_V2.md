# Policy v2

Policy v2 is opt-in. A tenant uses it only when `policy.version` is `2`. Policies without that version continue through the v1 evaluator and keep the existing result shape and behavior.

## Decision effects

A v2 rule has one of three effects:

- `deny`: fail closed to `human`. No reply or action is executed.
- `require_approval`: fail closed to `human`, set `requiresApproval: true`, and expose the policy-approved `intendedAction` for an operator approval workflow. The action is not executed automatically.
- `allow`: permit the configured action after all constraints pass. The model may request less autonomy, but it cannot raise the policy-granted authority.

When more than one rule matches the same intent, effect precedence is deterministic:

`deny` > `require_approval` > `allow`

Within the same effect, higher numeric `priority` wins. Equal priorities are resolved by rule id so JSON declaration order never changes authority.

## Example

```json
{
  "version": 2,
  "id": "customer-care-v2",
  "minConfidence": 0.8,
  "defaultEffect": "deny",
  "rules": [
    {
      "id": "faq-reply",
      "intent": "faq",
      "effect": "allow",
      "action": "reply",
      "priority": 10,
      "constraints": {
        "channels": ["whatsapp"],
        "minConfidence": 0.9
      }
    },
    {
      "id": "refund-approval",
      "intent": "refund",
      "effect": "require_approval",
      "action": "act",
      "reasonCode": "refund_needs_operator",
      "priority": 100,
      "capability": {
        "type": "browser",
        "task": "Issue approved refund",
        "allowedDomains": ["billing.example.com"]
      }
    }
  ]
}
```

Approval-required capabilities are not advertised to the model as automatically executable capabilities. The deterministic policy decision remains the authority boundary.

## Constraints

Current v2 constraints are:

- `channels`: allow the rule only on listed channels.
- `minConfidence`: an optional rule-specific confidence floor in addition to the policy-wide floor.

A constraint mismatch means the rule does not match. If no other rule matches, `defaultEffect` applies.

## Migration from v1

Do not add `version: 2` to an existing tenant until its rules have explicit effects. A safe migration is:

1. Copy the existing policy.
2. Add `version: 2` and a stable `id`.
3. Set `defaultEffect` to `deny` unless an explicit default is required.
4. Convert each old rule into `effect: allow` plus its existing action.
5. Move sensitive or irreversible `act` rules to `require_approval` first.
6. Validate in simulation or shadow mode before enabling live execution.

V1 policies can continue to run unchanged while tenants are migrated individually.
