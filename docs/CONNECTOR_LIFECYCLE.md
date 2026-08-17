# Connector Lifecycle

Operator-facing connector state uses one vocabulary regardless of transport implementation:

- `disabled`: connector intentionally not active.
- `disconnected`: connector had a session but is currently disconnected.
- `connecting`: connection or authentication is still in progress.
- `qr_required`: linked-device pairing requires operator action.
- `ready`: an observed connector session is ready for traffic.
- `degraded`: configuration exists, but health is unverified or the worker cannot currently be observed.
- `failed`: an observed session reached a terminal authentication or runtime failure.

The management API includes `state`, `reasonCode`, and `observedAt`. During the compatibility window it also includes `status`, which is an alias of the same canonical `state` value. Transport-specific raw status strings are adapter inputs only and must not reach the operator API.

## Linked-device mapping

The WhatsApp Web worker currently emits implementation states such as `starting`, `pairing`, `authenticated`, `ready`, `disconnected`, `auth-failure`, and `error`. The management adapter maps these to canonical states and fixed reason codes.

Pairing material (`qr` and `pairingCode`) is returned only while the canonical state is `qr_required`. Once the connector becomes ready, stale pairing material is removed from the public projection.

Raw worker `lastError`, exception messages, internal worker URLs, stack details, and provider diagnostics are not part of the public connector contract. Worker observation failures are represented by fixed reason codes such as `worker_timeout`, `worker_http_error`, and `worker_unavailable`.

## Cloud API semantics

Configuration is not equivalent to observed health. A configured Cloud API number is projected as `degraded` with reason `health_unverified` until a separate transport health observation is implemented. This prevents the control plane from displaying a false `ready` state based only on configuration presence.

## Compatibility

Existing UI code that reads `status` continues to work because `status` mirrors the canonical state. New code should use `state` and `reasonCode`. The compatibility alias can be removed in a later API-versioned change after all clients have migrated.
