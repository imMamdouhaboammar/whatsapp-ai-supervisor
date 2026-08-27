# Linked-device worker protocol

This protocol keeps unofficial WhatsApp linked-device connectivity outside the Supervisor core. The Phase 1 worker uses `whatsapp-web.js`, but another worker can replace it if it implements the same private HTTP contract and preserves the message-origin fields described below.

## Trust model

The worker is a private service. Do not expose it directly to the public internet.

Two tokens have different purposes:

- `WHATSAPP_LINKED_DEVICE_WORKER_TOKEN` authorizes Supervisor calls to the worker management and send endpoints.
- `LINKED_DEVICE_INGRESS_TOKEN` authorizes worker delivery to the Supervisor internal message endpoint.

Use different random values for the two tokens.

Linked-device auth files are also account-access credentials. Treat QR data, pairing codes, and persisted authentication state as secrets.

## Worker health

```http
GET /health
Authorization: Bearer <worker-token>
```

Example response:

```json
{
  "status": "ok",
  "sessions": 2,
  "readySessions": 1
}
```

A worker can be healthy while a session is still waiting for QR pairing. This prevents a container restart loop while the operator is authenticating WhatsApp.

## Session state

```http
GET /v1/sessions
Authorization: Bearer <worker-token>
```

```http
GET /v1/sessions/<sessionId>
Authorization: Bearer <worker-token>
```

A session can report one of these lifecycle states:

```text
starting
pairing
authenticated
ready
auth-failure
disconnected
error
```

During pairing, the state response can include `qr` or `pairingCode`. These values must remain private.

## Outbound text

```http
POST /v1/send-text
Authorization: Bearer <worker-token>
Content-Type: application/json
```

Request:

```json
{
  "sessionId": "store-egypt",
  "to": "201000000000@c.us",
  "text": "Your order is ready",
  "replyToId": null
}
```

Current worker behavior:

- A session must be `ready` or authenticated enough for the worker send path.
- Sends are serialized per session.
- A minimum spacing is applied between sends.
- Each session has a bounded pending-send queue.
- Queue overflow returns HTTP 429 instead of allowing unbounded memory growth.
- A successful response includes the WhatsApp platform message ID.

The Supervisor sender normalizes that result into an attribution-ready receipt containing `platformMessageId`, `sessionId`, and `transport: linked-device`.

The Phase 1 worker does not use `replyToId` to create a quoted WhatsApp reply. The field remains in the protocol so later worker implementations can support it without changing the Supervisor sender contract.

## Message delivery to the Supervisor

The worker writes accepted text observations to its disk spool before attempting delivery.

```http
POST /internal/transports/linked-device/message
Authorization: Bearer <ingress-token>
Content-Type: application/json
```

Customer inbound example:

```json
{
  "sessionId": "store-egypt",
  "message": {
    "id": "false_201000000000@c.us_ABC123",
    "from": "201000000000@c.us",
    "to": "201999999999@c.us",
    "customerName": "Customer",
    "text": "Where is my order?",
    "timestamp": 1786920000,
    "type": "chat",
    "fromMe": false,
    "isGroup": false
  }
}
```

Operator or supervisor outbound observation example:

```json
{
  "sessionId": "store-egypt",
  "message": {
    "id": "true_201000000000@c.us_DEF456",
    "from": "201999999999@c.us",
    "to": "201000000000@c.us",
    "customerName": "Customer",
    "text": "I will check that for you",
    "timestamp": 1786920010,
    "type": "chat",
    "fromMe": true,
    "isGroup": false
  }
}
```

The worker must preserve `fromMe` instead of converting outbound observations into customer inbound messages. For `fromMe: true`, the peer address is the conversation customer and is normalized independently from the account's own address.

A successful Supervisor response removes the spool item. Failed deliveries stay on disk and are retried.

## `fromMe` origin classification

`fromMe` means only that WhatsApp considers the message sent by the linked account. It does not prove a human operator sent it.

Before the Supervisor sends a linked-device reply, it records the returned WhatsApp platform message ID in its outbound-attribution store. The origin is one of:

```text
agent
operator_api
```

When the same platform message later arrives from the worker as `fromMe: true`:

1. The Supervisor looks up `(tenant, sessionId, platformMessageId)` in the attribution store.
2. A matched `agent` record is consumed as an agent echo and does not change ownership.
3. A matched `operator_api` record is consumed as the echo of a manual send already initiated through the operator API and does not create a second takeover event.
4. An unmatched `fromMe` observation is treated as real manual operator activity from WhatsApp or another linked client.

An attribution lookup failure fails closed toward human control. It must never cause the Supervisor to assume an unknown `fromMe` message was agent-originated.

## Manual human takeover

An unmatched direct-text `fromMe` observation never enters the normal customer inbound decision queue and never invokes the model.

Instead the Supervisor:

1. claims a dedicated human-outbound idempotency key
2. persists `human.outbound_observed`
3. reads the current versioned conversation ownership
4. applies `manual_takeover`
5. moves ownership to `HUMAN_ACTIVE` when needed
6. records the operator message in the conversation projection
7. preserves the legacy human-control projection for UI compatibility
8. persists and broadcasts `conversation.ownership_changed` when ownership changed

A duplicate worker delivery of the same platform message ID is ignored.

If the operator is already `HUMAN_ACTIVE`, the observation remains human-owned without creating a false return to AI. Returning control to the agent is always an explicit management action.

## Filtering rules

The worker and Supervisor both reject or ignore inputs that should not enter supported Phase 1 automation:

- `status@broadcast`
- non-text message types
- groups unless `allowGroups` is explicitly enabled for the tenant
- empty or malformed messages

Direct customer inbound messages use the normal model and policy path.

Non-self `fromMe` text messages are intentionally not filtered because they are required for echo attribution and human takeover detection.

Group handling remains disabled by default because a group message needs participant identity and conversation-policy decisions before it should be treated like a direct customer chat.

## Session persistence

The `whatsapp-web.js` worker uses `LocalAuth` with one `clientId` per configured session. Auth files live under the linked-device data directory, separate from Supervisor audit and claim data.

Back up linked-device auth data carefully. It contains authenticated browser-session material. Do not commit it to Git, copy it into build images, or expose it through the public API.

## Replacement worker requirements

A replacement worker can use Baileys or another linked-device implementation if it provides:

1. durable session identity matching the configured `sessionId`
2. authenticated private management endpoints
3. the outbound `/v1/send-text` contract with a stable platform message ID
4. the Supervisor delivery contract above
5. correct preservation of `fromMe` and peer identity
6. durable retry before acknowledging observations as delivered
7. reconnect and session-state reporting
8. bounded outbound concurrency and backpressure
9. secure persistence of linked-device authentication state

The replacement does not need to use a browser, Node.js, or the same local storage format.
