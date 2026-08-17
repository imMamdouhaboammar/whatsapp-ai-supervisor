# Durable Postgres Runtime

The supervisor supports two storage modes.

- `file`: local development compatibility. Webhook processing remains synchronous and the existing file-backed claim/audit/conversation stores stay available.
- `postgres`: durable production processing. Ingress persists a canonical `message.received` event, enqueues a `process_inbound` job, and returns before model, policy, browser, or WhatsApp side effects run.

## Processing contract

In Postgres mode the request path is:

1. Verify and normalize the connector message.
2. Atomically claim the inbound idempotency key.
3. Persist or recover the canonical `message.received` domain event.
4. Append the legacy conversation projection used by the operator UI.
5. Enqueue one idempotent `process_inbound` job.
6. Return to the connector.

A worker later claims the job using one PostgreSQL transaction and `FOR UPDATE SKIP LOCKED`. The claim sets a lease owner and expiry before commit. The worker then executes the same decision handler used by synchronous file mode, including policy evaluation, action authority, sending, audit, and canonical `decision.completed` persistence.

## Retry and recovery

Jobs have bounded attempts. A failed attempt is returned to `queued` with capped exponential delay. The terminal attempt becomes `dead`. Raw provider or browser exception text is not stored as `last_error`; the durable row stores the fixed code `job_failed`.

A worker that disappears while holding a job does not permanently own it. After `leased_until`, another worker may claim the same row. PostgreSQL row locking plus `SKIP LOCKED` prevents concurrent workers from receiving the same available job.

Webhook retry identity is stable. `PostgresDomainEventStore.append()` returns the persisted canonical event selected by `(tenant_id, event_type, idempotency_key)`, so child events derive their correlation and causation IDs from the original root even after a partial failure or process restart.

## Migrations

Startup runs numbered SQL files from `migrations/`. Migration execution uses a PostgreSQL advisory lock so multiple supervisor replicas cannot apply schema changes concurrently. Every migration runs in its own transaction and is recorded in `schema_migrations` only after the SQL succeeds.

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

The `postgres-integration` CI job starts a real PostgreSQL service and verifies migrations, claims, event idempotency, enqueue idempotency, concurrent worker exclusion, expired-lease recovery, bounded retry, dead-lettering, and error redaction.
