# Architecture

For the generated module-level view (import graph, hub modules, per-module test coverage), see [CODE_GRAPH.md](CODE_GRAPH.md), regenerated with `npm run graph`.

For the proposed ChatGPT-as-messaging-agent evolution, see [CHATGPT_MESSAGING_AGENT_ARCHITECTURE.md](CHATGPT_MESSAGING_AGENT_ARCHITECTURE.md).

## Product boundary

The supervisor has four independent concerns:

```text
WhatsApp transport
Model provider
Permission authority
Optional business action runtime
```

A tenant can change WhatsApp transport or LLM provider without changing permission semantics.

The target messaging-agent architecture adds a fifth boundary above individual model providers:

```text
Agent runtime
```

The long-term direction is:

```text
messaging channel -> supervisor -> agent runtime -> deterministic policy -> delivery/action
```

The channel and agent runtime are independently replaceable. A ChatGPT Workspace Agent can therefore become the persistent decision identity without giving it direct authority over WhatsApp or business side effects.

## WhatsApp transport contract

The current transport implementations are:

```text
cloud          official Meta Cloud API
linked-device  authenticated remote worker using WhatsApp Web
```

The linked-device worker protocol is intentionally HTTP-based and implementation-neutral. The first worker uses `whatsapp-web.js`. A future Baileys or `whatsmeow` worker can implement the same protocol without changing the supervisor orchestration path.

For the messaging-agent target, Baileys is the preferred linked-device v2 candidate because it connects directly through WhatsApp WebSockets, supports normal Linked Devices QR/pairing, and does not require Chromium. The current worker remains supported during migration until parity and reliability are verified.

## Cloud API flow

```text
Meta webhook
  -> raw-body signature validation
  -> WhatsApp payload normalization
  -> durable message claim
  -> tenant resolution by phone_number_id
  -> model decision
  -> PermissionEngine
  -> optional Graph API reply
  -> durable audit event
```

## Linked-device flow

```text
WhatsApp Web message event
  -> worker input filtering
  -> disk spool write
  -> authenticated POST to supervisor internal ingress
  -> tenant resolution by sessionId
  -> durable supervisor message claim
  -> model decision
  -> PermissionEngine
  -> authenticated POST to worker send endpoint
  -> per-session outbound queue
  -> WhatsApp Web send
  -> durable audit event
```

Worker delivery is at-least-once. Supervisor processing is idempotent for a single instance through the durable claim store.

In Postgres mode, durable domain events and jobs provide the production event-processing boundary described in [DURABLE_RUNTIME.md](DURABLE_RUNTIME.md).

## Linked-device trust boundaries

1. Worker management and send endpoints require `WHATSAPP_LINKED_DEVICE_WORKER_TOKEN`.
2. Supervisor internal linked-device ingress requires `LINKED_DEVICE_INGRESS_TOKEN`.
3. The two tokens are separate so compromise of one direction does not automatically grant the other direction.
4. Session status including QR and pairing code is available only through the authenticated worker API.
5. LocalAuth data is stored outside source control and treated as sensitive account-access material.
6. Group messages are ignored by default.
7. The supervisor resolves the tenant from configured `sessionId`; the worker cannot select an arbitrary tenant ID.

The proposed Baileys worker keeps the same isolation boundary. Its auth and Signal key state must be treated as account-access material and moved behind an encrypted durable provider before it is considered production-grade.

## Linked-device durability

The worker writes inbound payloads to:

```text
data/whatsapp-web/spool/<sha256>.json
```

The file key is derived from session ID and WhatsApp message ID.

A file is deleted only after the supervisor returns a successful HTTP response. Network errors and supervisor errors retain the file for retry.

The supervisor creates its own claim under:

```text
data/claims/<sha256>.json
```

This second boundary prevents a retained or retried spool item from creating a second AI decision or duplicate outbound reply after normal restarts.

Production Postgres mode replaces single-instance correctness with transactional claims, canonical events, and leased jobs.

## Linked-device session lifecycle

Each configured session gets its own `LocalAuth` client ID and browser profile in the current worker.

Tracked states include:

```text
starting
pairing
authenticated
ready
auth-failure
disconnected
error
```

On disconnect, the worker destroys the previous client and restarts the session with capped exponential backoff. A valid LocalAuth profile reconnects without new pairing. Invalid auth returns to pairing.

A future Baileys worker should project its native socket states into the same canonical connector lifecycle rather than exposing library-specific states to the rest of the application.

## Outbound linked-device queue

Each session owns a serialized Promise chain. Only one `sendMessage` call runs at a time for that session.

Two bounds are configurable:

```text
WHATSAPP_WEB_MIN_SEND_INTERVAL_MS
WHATSAPP_WEB_MAX_SEND_QUEUE
```

The queue cap returns `send_queue_full`, mapped to HTTP 429 by the worker API.

The messaging-agent evolution adds outbound origin attribution. Every supervisor-originated send records the platform message ID. A later `fromMe` echo that matches the outbox is classified as agent/operator-API output. An unmatched `fromMe` message from the paired account is treated as manual human activity and can move conversation ownership to `HUMAN_ACTIVE`.

## Model boundary

A model provider returns a constrained decision:

```js
{
  intent,
  confidence,
  reply,
  requestedAction,
  model,
  provider
}
```

`requestedAction` is a recommendation, not authority.

## Agent runtime boundary

The target architecture introduces an `AgentRuntime` above model providers.

This distinction matters because a persistent ChatGPT Workspace Agent is not equivalent to a raw model API call. Agent identity can include reusable instructions, connected apps, tools, files, skills, and workspace context.

Planned runtime types include:

```text
chatgpt-workspace-agent   asynchronous persistent agent identity
openai-responses          synchronous compatibility/fallback runtime
future                    other agent runtimes behind the same contract
```

The current `ModelGateway` remains valid and should be wrapped as the synchronous Responses agent runtime rather than removed.

As documented by OpenAI on 2026-08-27, a Workspace Agent API trigger returns HTTP 202 without a retrievable run response. The target architecture therefore uses an asynchronous pending-turn record plus a supervisor MCP callback such as `submit_decision`.

See [CHATGPT_MESSAGING_AGENT_ARCHITECTURE.md](CHATGPT_MESSAGING_AGENT_ARCHITECTURE.md) for the full callback contract and failure behavior.

## Permission boundary

Tenant policy is the maximum authority:

```text
ignore
human
draft
reply
act
```

Low confidence becomes `human`. Unknown intents use `defaultAction`. A model or agent may request less authority than policy permits, never more.

The messaging-agent architecture does not expose a raw autonomous `send_whatsapp_message` primitive as the normal Workspace Agent path. The agent submits a decision; `PermissionEngine` decides whether a reply/action may proceed.

## Conversation ownership boundary

The target architecture adds durable conversation ownership:

```text
AI_ACTIVE
WAITING_APPROVAL
HUMAN_REQUESTED
HUMAN_ACTIVE
AI_PAUSED
```

Automatic agent turns run only while ownership allows them. Manual human activity invalidates older pending autonomous turns before they can send.

This state belongs to the supervisor domain, not the WhatsApp worker and not the agent runtime.

## Browser action boundary

Business browsing is not the same thing as WhatsApp Web transport.

The browser action runtime supports:

```text
none
agent-browser
remote browser worker
```

Browser tasks require policy-defined instructions and explicit domain allowlists. Raw customer message text is not interpolated into browser task templates.

## State ownership

Supervisor local-development state:

```text
data/audit
data/claims
data/browser
```

WhatsApp Web worker local state:

```text
data/whatsapp-web/auth
data/whatsapp-web/spool
```

Production state uses the durable Postgres contracts where implemented. The target messaging-agent architecture extends durable storage with conversation ownership, pending agent turns, approvals, outbound origin attribution, and canonical contact identities.

## Future transport workers

The current remote worker protocol makes these possible without changing the orchestration core:

- a Baileys linked-device worker
- a Go `whatsmeow` worker
- a managed linked-device worker service
- another WhatsApp bridge implementation with compatible inbound and send endpoints

Any new worker must preserve authentication, session isolation, durable inbound delivery, deterministic tenant mapping, outbound attribution, and connector lifecycle projection.
