# Durable Postgres Runtime

The supervisor supports two storage modes.

- `file`: local development compatibility. Webhook processing remains synchronous and the file-backed claim, conversation, ownership, attribution, and audit projections stay available.
- `postgres`: durable production processing. Ingress persists canonical events, uses transactional ownership and attribution repositories, enqueues durable inbound work, and returns before model, policy, browser, or WhatsApp side effects run.

## Processing contract

In Postgres mode the customer-inbound request path is:

1. Verify and normalize the connector message.
2. Atomically claim the inbound idempotency key.
3. Persist or recover the canonical `message.received` domain event.
4. Append the legacy conversation projection used by the operator UI.
5. Enqueue one idempotent `process_inbound` job.
6. Return to the connector.

A worker later claims the job using one PostgreSQL transaction and `FOR UPDATE SKIP LOCKED`. The claim sets a lease owner and expiry before commit. The worker executes the same decision handler used by synchronous file mode.

Before any model call, the decision handler reads canonical conversation ownership. Automatic model execution is allowed only while the conversation is `AI_ACTIVE`. A stale queued job therefore cannot resume autonomous work after a human operator has taken control.

## Conversation ownership

Conversation ownership is a versioned compare-and-set record keyed by `(tenant_id, conversation_id)`.

Canonical states are:

```text
AI_ACTIVE
WAITING_APPROVAL
HUMAN_REQUESTED
HUMAN_ACTIVE
AI_PAUSED
```

A missing conversation begins at `AI_ACTIVE`, version `0`.

Every effective transition increments the version. Callers may supply `expectedVersion`; a stale value fails with `ownership_version_conflict` instead of overwriting a newer state. Transition IDs are durable idempotency keys, so a retry of the same transition returns its original result.

Manual operator activity has priority over every other state and moves the conversation to `HUMAN_ACTIVE`. Returning from `HUMAN_ACTIVE` to `AI_ACTIVE` requires an explicit `release_to_agent` transition. There is no timer-based or implicit human-to-AI release.

PostgreSQL stores current ownership in `conversation_ownership` and its idempotent transition history in `conversation_ownership_transitions`. File mode keeps an append-only NDJSON transition ledger under `data/ownership` for local development compatibility.

## Outbound origin attribution

Linked-device messages sent by the supervisor are observed again by WhatsApp as `fromMe` events. A raw `fromMe` flag therefore cannot distinguish an agent reply from a real operator reply.

After a successful linked-device send, the supervisor records an attribution keyed by tenant, linked-device session, and WhatsApp platform message ID. Supported origins in Phase 1 are:

```text
agent
operator_api
```

The record includes the conversation, customer, source message where applicable, creation time, expiry metadata, and the first observed echo time.

When the worker later delivers the matching `fromMe` event, the supervisor consumes the echo idempotently and does not change conversation ownership. An unmatched `fromMe` event is treated as real operator activity and enters the human-takeover path.

PostgreSQL stores this data in `outbound_attributions`. File mode keeps an append-only local ledger under `data/outbound-attribution`.

If an attribution write fails after WhatsApp has already accepted the send, the supervisor does not retry the send. A later unmatched echo fails closed toward human ownership rather than risking a duplicate outbound message.

## Human outbound durability

An unmatched linked-device `fromMe` observation never enters the customer-to-agent decision queue.

The supervisor:

1. claims a dedicated human-outbound idempotency key
2. persists `human.outbound_observed`
3. performs a versioned `manual_takeover` transition
4. projects the manual outbound message into the operator conversation history
5. projects legacy `human` control for compatibility
6. emits `conversation.ownership_changed` when ownership actually changes

Duplicate delivery of the same platform message ID is ignored. If a compare-and-set conflict occurs, the supervisor reloads ownership once; if another writer already moved the conversation to `HUMAN_ACTIVE`, it safely keeps human ownership.

## Retry and recovery

Jobs have bounded attempts. A failed attempt is returned to `queued` with capped exponential delay. The terminal attempt becomes `dead`. Raw provider or browser exception text is not stored as `last_error`; the durable row stores the fixed code `job_failed`.

A worker that disappears while holding a job does not permanently own it. After `leased_until`, another worker may claim the same row. PostgreSQL row locking plus `SKIP LOCKED` prevents concurrent workers from receiving the same available job.

Webhook retry identity is stable. `PostgresDomainEventStore.append()` returns the persisted canonical event selected by `(tenant_id, event_type, idempotency_key)`, so child events derive their correlation and causation IDs from the original root even after a partial failure or process restart.

## Migrations

Startup runs numbered SQL files from `migrations/`. Migration execution uses a PostgreSQL advisory lock so multiple supervisor replicas cannot apply schema changes concurrently. Every migration runs in its own transaction and is recorded in `schema_migrations` only after the SQL succeeds.

Phase 1 adds durable ownership and outbound-attribution migrations in addition to the original event, claim, and job tables.

## Configuration

Local process mode defaults to:

```env
STORAGE_BACKEND=file
```

Postgres mode requires:

```env
STORAGE_BACKEND=postgres
DATABASE_URL=postgres://user:password@host:5432/database
DATABASE_POOL_MAX=10
```

`DATABASE_POOL_MAX` must be an integer from 1 through 100.

Docker Compose starts PostgreSQL 18 internally and uses Postgres storage by default. The database has no published host port. Replace the Compose development password before any VPS or externally reachable deployment.

## Readiness and shutdown

`/ready` probes the selected storage backend. In Postgres mode readiness executes a real database query.

On SIGTERM or SIGINT the HTTP server stops accepting new requests, SSE clients close, the durable worker receives an abort signal, the worker task exits, and only then is the PostgreSQL pool closed.

## CI evidence

The `postgres-integration` CI job starts a real PostgreSQL service and verifies migrations, claims, event idempotency, enqueue idempotency, concurrent worker exclusion, expired-lease recovery, bounded retry, dead-lettering, error redaction, conversation ownership compare-and-set behavior, transition idempotency, explicit release, outbound attribution, and echo consumption.
