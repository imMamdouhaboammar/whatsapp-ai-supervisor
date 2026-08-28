CREATE TABLE IF NOT EXISTS conversation_ownership (
  tenant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  state TEXT NOT NULL
    CHECK (state IN ('AI_ACTIVE', 'WAITING_APPROVAL', 'HUMAN_REQUESTED', 'HUMAN_ACTIVE', 'AI_PAUSED')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  changed_at TIMESTAMPTZ NOT NULL,
  changed_by TEXT NOT NULL,
  reason_code TEXT,
  transition_id TEXT,
  PRIMARY KEY (tenant_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS conversation_ownership_state_idx
  ON conversation_ownership (tenant_id, state, changed_at DESC);

CREATE TABLE IF NOT EXISTS conversation_ownership_transitions (
  tenant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  transition_id TEXT NOT NULL,
  command TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason_code TEXT,
  expected_version INTEGER,
  result JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, conversation_id, transition_id)
);

CREATE INDEX IF NOT EXISTS conversation_ownership_transitions_recorded_idx
  ON conversation_ownership_transitions (tenant_id, conversation_id, recorded_at ASC);
