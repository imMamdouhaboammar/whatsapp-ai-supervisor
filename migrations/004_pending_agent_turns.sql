CREATE TABLE IF NOT EXISTS pending_agent_turns (
  tenant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  runtime_id TEXT NOT NULL,
  dispatched_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'invalidated')),
  ownership_version BIGINT NOT NULL CHECK (ownership_version >= 0),
  invalidated_at TIMESTAMPTZ,
  reason_code TEXT,
  PRIMARY KEY (tenant_id, turn_id),
  CHECK (expires_at > dispatched_at)
);

CREATE INDEX IF NOT EXISTS pending_agent_turns_expiry_idx
  ON pending_agent_turns (status, expires_at);

CREATE INDEX IF NOT EXISTS pending_agent_turns_conversation_idx
  ON pending_agent_turns (tenant_id, conversation_id, status);
