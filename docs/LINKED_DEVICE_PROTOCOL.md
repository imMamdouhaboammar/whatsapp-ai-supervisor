# Linked-device worker protocol

This protocol keeps unofficial WhatsApp linked-device connectivity outside the Supervisor core. The first worker implementation uses `whatsapp-web.js`, but another worker can replace it if it implements the same HTTP contract.

## Trust model

The worker is a private service. Do not expose it directly to the public internet.

Two tokens have different purposes:

- `WHATSAPP_LINKED_DEVICE_WORKER_TOKEN` authorizes Supervisor calls to the worker management and send endpoints.
- `LINKED_DEVICE_INGRESS_TOKEN` authorizes worker delivery to the Supervisor internal inbound endpoint.

Use different random values for the two tokens.

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

During pairing, the state response can include `qr` or `pairingCode`. These values are credentials for linking a device and must remain private.

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

- A session must be `ready`.
- Sends are serialized per session.
- A minimum spacing is applied between sends.
- Each session has a bounded pending-send queue.
- Queue overflow returns HTTP 429 instead of allowing unbounded memory growth.

The first worker does not currently use `replyToId` to create a quoted WhatsApp reply. The field is kept in the protocol so later worker implementations can support it without changing the Supervisor sender contract.

## Inbound delivery

The worker writes a normalized event to its disk spool before attempting delivery.

```http
POST /internal/transports/linked-device/message
Authorization: Bearer <ingress-token>
Content-Type: application/json
```

Payload:

```json
{
  "sessionId": "store-egypt",
  "message": {
    "id": "true_201000000000@c.us_ABC123",
    "from": "201000000000@c.us",
    "customerName": "Customer",
    "text": "Where is my order?",
    "timestamp": 1786920000,
    "type": "chat",
    "fromMe": false,
    "isGroup": false
  }
}
```

The Supervisor resolves `sessionId` to a tenant, normalizes the event into its channel-neutral inbound message shape, then uses the same durable claim store, model gateway, permission engine, action gateway, and audit path used by Cloud API messages.

A successful delivery removes the spool file. Failed deliveries stay on disk and are retried. If the same message is delivered more than once, the Supervisor durable claim prevents duplicate processing.

## Filtering rules

The worker and Supervisor both reject or ignore inputs that should not enter normal business automation:

- self-sent messages
- `status@broadcast`
- non-text message types in this first implementation
- groups unless `allowGroups` is explicitly enabled for the tenant
- empty or malformed messages

Group handling is disabled by default because a group message needs additional participant identity and conversation policy decisions before it should be treated like a direct customer chat.

## Session persistence

The `whatsapp-web.js` worker uses `LocalAuth` with one `clientId` per configured session. Auth files live under the linked-device data directory, separate from Supervisor audit and claim data.

Back up linked-device auth data carefully. It contains authenticated browser session material. Do not commit it to Git, copy it into build images, or expose it through the public API.

## Replacement worker requirements

A future `whatsmeow`, BrowserOS, or another linked-device worker can replace the current worker if it provides:

1. durable session identity matching the configured `sessionId`
2. authenticated private management endpoints
3. the outbound `/v1/send-text` contract
4. the inbound Supervisor delivery contract above
5. durable retry before acknowledging inbound messages as delivered
6. reconnect and session-state reporting
7. bounded outbound concurrency and backpressure

The replacement does not need to use a browser, Node.js, or the same local storage format.
