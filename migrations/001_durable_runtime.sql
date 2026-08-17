CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS domain_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  tenant_id TEXT NOT NULL,
  conversation_id TEXT,
  message_id TEXT,
  correlation_id TEXT NOT NULL,
  causation_id TEXT,
  idempotency_key TEXT,
  actor JSONB NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, event_type, idempotency_key)
);

CREATE INDEX IF NOT EXISTS domain_events_tenant_occurred_idx
  ON domain_events (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS domain_events_correlation_idx
  ON domain_events (correlation_id, occurred_at ASC);

CREATE TABLE IF NOT EXISTS inbound_claims (
  claim_key TEXT PRIMARY KEY,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS durable_jobs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_owner TEXT,
  leased_until TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (tenant_id, type, idempotency_key)
);

CREATE INDEX IF NOT EXISTS durable_jobs_status_available_at_idx
  ON durable_jobs (status, available_at, created_at);
CREATE INDEX IF NOT EXISTS durable_jobs_lease_idx
  ON durable_jobs (status, leased_until)
  WHERE status = 'running';
