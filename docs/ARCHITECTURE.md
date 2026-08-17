# Architecture

## Product boundary

The service treats WhatsApp as one channel adapter and the LLM as one model adapter. Business authority lives in deterministic application code, not in the model prompt.

## Trust boundaries

1. **Meta boundary**: inbound webhook payloads are accepted only after webhook verification and, for POST requests, signature validation when `META_APP_SECRET` is configured.
2. **Tenant boundary**: the WhatsApp `phone_number_id` resolves to exactly one tenant before model access or outbound messaging.
3. **Model boundary**: model output is parsed and validated into a constrained decision object. Invalid output is rejected.
4. **Authority boundary**: `PermissionEngine` evaluates intent, confidence, and tenant rules. The model cannot raise the allowed autonomy level.
5. **Delivery boundary**: only the orchestrator can invoke the channel sender, and only after permission evaluation.
6. **Audit boundary**: every successful orchestration result is recorded with the model decision and policy decision.

## Inbound flow

```text
Meta webhook
  -> raw-body signature validation
  -> WhatsApp payload normalization
  -> duplicate message claim
  -> tenant resolution by phone_number_id
  -> ModelGateway
  -> provider decision
  -> output validation
  -> PermissionEngine
  -> Shadow / Draft / Reply / Human / Ignore / Act
  -> optional WhatsApp send
  -> audit event
```

If orchestration fails after a message ID is claimed, the in-memory claim is released so Meta can retry.

## Model provider contract

A provider implements:

```js
async decide({ model, message, businessContext }) => ({
  intent,
  confidence,
  reply,
  requestedAction,
  model,
  provider
})
```

`ModelGateway` receives an ordered route such as:

```json
{
  "standard": [
    { "provider": "openai", "model": "gpt-5.6" },
    { "provider": "another-provider", "model": "fallback-model" }
  ]
}
```

If one provider fails, the next configured candidate is tried. Adding Anthropic, Gemini, OpenRouter, Azure OpenAI, or a local model does not require changes to WhatsApp or permission logic.

## Permission semantics

Tenant policy is the maximum authority:

```text
ignore  -> send nothing
human   -> require a human
 draft  -> create a draft only
 reply  -> allow an outbound reply
 act    -> allow an action executor
```

Rules are intent-specific. Unknown intents use `defaultAction`. Confidence below `minConfidence` always becomes `human`.

The model may reduce autonomy. For example, if policy allows `reply` but the model requests `human`, the final action is `human`. The reverse is not allowed: a model request for `act` cannot upgrade a policy rule from `draft` to `act`.

## Shadow Mode

Shadow Mode runs classification, drafting, policy evaluation, and audit, but never calls the outbound WhatsApp sender. The result exposes `wouldAction` so real conversations can be reviewed before enabling automation.

## Idempotency

The current process keeps an in-memory set keyed by `tenantId:messageId`. A repeated webhook message is not processed twice. Claims are removed on orchestration failure so retries remain possible.

For horizontal production deployment, replace the in-memory claim set with a durable atomic store such as Postgres `INSERT ... ON CONFLICT DO NOTHING` or Redis `SET NX` with a retention window.

## BYOK

Tenant files reference secret environment-variable names rather than containing secrets directly:

```json
{
  "whatsapp": { "accessTokenEnv": "CLIENT_A_META_TOKEN" },
  "ai": { "apiKeyEnv": "CLIENT_A_OPENAI_KEY" }
}
```

This is the first implementation of Bring Your Own Key. A production control plane should move secret values into a managed secret store and keep only secret references in tenant configuration.

## Production upgrades

The next backend slice should replace the in-memory stores with durable repositories, add human takeover state, and introduce an allowlisted Action Gateway. The Action Gateway should never accept arbitrary URLs or arbitrary tool definitions from model output. A tenant administrator must register allowed actions first, and policy rules must authorize them explicitly.
