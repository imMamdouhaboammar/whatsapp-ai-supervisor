CREATE TABLE IF NOT EXISTS outbound_attributions (
  tenant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  platform_message_id TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('agent', 'operator_api')),
  source_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  echo_observed_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, session_id, platform_message_id)
);

CREATE INDEX IF NOT EXISTS outbound_attributions_match_window_idx
  ON outbound_attributions (tenant_id, session_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS outbound_attributions_conversation_idx
  ON outbound_attributions (tenant_id, conversation_id, created_at DESC);
