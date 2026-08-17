# WhatsApp AI Supervisor

A model-agnostic control plane for business WhatsApp conversations. WhatsApp is the channel, the LLM is replaceable, and deterministic policy decides what AI is allowed to do.

## What this MVP already does

- Receives official WhatsApp Cloud API webhooks
- Validates Meta webhook signatures with `X-Hub-Signature-256`
- Normalizes incoming text messages
- Sends replies through the official Graph `/PHONE_NUMBER_ID/messages` endpoint
- Calls OpenAI through the Responses API with `store: false`
- Defaults to `gpt-5.6`, configurable per tenant and route
- Supports BYOK per tenant through environment-variable references
- Separates model recommendations from deterministic permissions
- Supports `ignore`, `draft`, `reply`, `act`, and `human` permission decisions
- Fails closed on unknown intents or low confidence
- Supports Shadow Mode that observes decisions but never sends
- Keeps an audit event for every processed decision
- Supports provider fallback in the model gateway
- Includes a dry-run simulator endpoint
- Uses only Node.js 22 built-ins, with no runtime packages

## Architecture

```text
WhatsApp Cloud API
        |
        v
Webhook verification + normalization
        |
        v
Tenant resolver
        |
        v
Model Gateway
  |             |
OpenAI      future providers
GPT-5.6     Claude / Gemini / local
        |
        v
Model Decision
intent + confidence + draft + requested action
        |
        v
Deterministic Permission Engine
        |
   +----+-----------------------------+
   |          |          |            |
 Shadow     Draft      Reply        Human
                         |
                         v
                 WhatsApp Cloud API

Every decision -> Audit Store
```

## Important design rule

The model cannot grant itself authority. It can recommend an action, but `src/domain/permission-engine.js` is the final authority for whether the system replies, drafts, ignores, acts, or hands the conversation to a human.

## Run

Requirements: Node.js 22+

```bash
cp config/tenants.example.json config/tenants.json
cp .env.example .env
# fill the secrets and the current Meta Graph API version
node --env-file=.env src/server.js
```

Run tests:

```bash
npm test
```

Full verification:

```bash
npm run check
```

## Configure a tenant

Each tenant selects its own model key and WhatsApp token by environment-variable name, not by putting secrets in JSON.

```json
{
  "id": "client-a",
  "phoneNumberId": "123456789",
  "shadowMode": true,
  "whatsapp": { "accessTokenEnv": "CLIENT_A_META_TOKEN" },
  "ai": {
    "apiKeyEnv": "CLIENT_A_OPENAI_KEY",
    "route": "standard",
    "routes": {
      "standard": [
        { "provider": "openai", "model": "gpt-5.6" }
      ]
    }
  }
}
```

This is the BYOK path. A later provider adapter only needs to implement `decide()` and be registered in `ModelGateway`; WhatsApp, policies, shadow mode, and audit do not change.

## Permission examples

```json
{
  "minConfidence": 0.82,
  "defaultAction": "human",
  "rules": [
    { "id": "hours", "intent": "working_hours", "action": "reply" },
    { "id": "pricing", "intent": "pricing", "action": "draft" },
    { "id": "refund", "intent": "refund", "action": "human" }
  ]
}
```

Unknown intent plus high confidence still falls back to `defaultAction`. Low confidence always goes to `human`.

## Dry-run simulation

The simulator forces Shadow Mode even if the tenant is live.

```bash
curl -s http://localhost:3000/v1/simulate \
  -H 'content-type: application/json' \
  -d '{"tenantId":"demo-business","customerId":"201000000000","text":"What are your working hours?"}'
```

Audit:

```bash
curl -s 'http://localhost:3000/v1/audit?tenantId=demo-business'
```

## Meta webhook

Configure the callback URL as:

```text
https://YOUR_DOMAIN/webhooks/whatsapp
```

Use the same value as `META_WEBHOOK_VERIFY_TOKEN` during webhook verification. POST payloads are rejected if the Meta signature does not match `META_APP_SECRET`.

## Current MVP boundaries

- Text messages only. Media, voice notes, interactive messages, and orders are intentionally not processed yet.
- Audit and tenant stores are in memory. Duplicate message claims are also process-local. Production should move these to Postgres/Redis or another durable store.
- `act` exists in the permission vocabulary but business tool execution is not enabled yet. The next safe step is an allowlisted Action Gateway, beginning with webhooks and calendar booking.
- There is no admin UI or authentication yet. Tenant policy is configuration-driven in this release.
- The default channel is the official Cloud API. A WhatsApp Web / linked-device adapter should remain isolated and optional because it has different reliability and platform-policy risk.

## Next implementation slice

1. Durable Postgres stores and idempotency for webhook message IDs
2. Action Gateway with allowlisted webhook and calendar actions
3. Conversation memory and rolling summaries
4. Admin UI for autonomy rules and Shadow Mode review
5. Human takeover state and resume-AI control
6. Additional providers: Anthropic, Gemini, OpenRouter, local inference
7. Embedded Signup / Coexistence onboarding
8. Media and voice-note handling
