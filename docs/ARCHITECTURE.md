# Architecture

## Product boundary

The supervisor has four independent concerns:

```text
WhatsApp transport
Model provider
Permission authority
Optional business action runtime
```

A tenant can change WhatsApp transport or LLM provider without changing permission semantics.

## WhatsApp transport contract

The current transport implementations are:

```text
cloud          official Meta Cloud API
linked-device  authenticated remote worker using WhatsApp Web
```

The linked-device worker protocol is intentionally HTTP-based and implementation-neutral. The first worker uses `whatsapp-web.js`. A future `whatsmeow` worker can implement the same protocol without changing the supervisor orchestration path.

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

## Linked-device trust boundaries

1. Worker management and send endpoints require `WHATSAPP_LINKED_DEVICE_WORKER_TOKEN`.
2. Supervisor internal linked-device ingress requires `LINKED_DEVICE_INGRESS_TOKEN`.
3. The two tokens are separate so compromise of one direction does not automatically grant the other direction.
4. Session status including QR and pairing code is available only through the authenticated worker API.
5. LocalAuth data is stored outside source control and treated as sensitive account-access material.
6. Group messages are ignored by default.
7. The supervisor resolves the tenant from configured `sessionId`; the worker cannot select an arbitrary tenant ID.

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

## Linked-device session lifecycle

Each configured session gets its own `LocalAuth` client ID and browser profile.

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

## Outbound linked-device queue

Each session owns a serialized Promise chain. Only one `sendMessage` call runs at a time for that session.

Two bounds are configurable:

```text
WHATSAPP_WEB_MIN_SEND_INTERVAL_MS
WHATSAPP_WEB_MAX_SEND_QUEUE
```

The queue cap returns `send_queue_full`, mapped to HTTP 429 by the worker API.

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

## Permission boundary

Tenant policy is the maximum authority:

```text
ignore
human
draft
reply
act
```

Low confidence becomes `human`. Unknown intents use `defaultAction`. A model may request less authority than policy permits, never more.

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

Supervisor:

```text
data/audit
data/claims
data/browser
```

WhatsApp Web worker:

```text
data/whatsapp-web/auth
data/whatsapp-web/spool
```

The file-backed supervisor store is single-instance. Multi-replica deployment requires a shared atomic claim store and shared audit repository.

## Future transport workers

The current remote worker protocol makes these possible without changing the orchestration core:

- a Go `whatsmeow` worker
- a managed linked-device worker service
- another WhatsApp bridge implementation with compatible inbound and send endpoints

Any new worker must preserve authentication, session isolation, durable inbound delivery, and deterministic tenant mapping.
