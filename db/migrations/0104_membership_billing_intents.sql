CREATE TABLE IF NOT EXISTS membership_billing_intents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  product_tier_key TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  status TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL,
  reference_code TEXT NOT NULL,
  instructions_json TEXT,
  proof_asset_key TEXT,
  provider_session_id TEXT,
  provider_reference TEXT,
  requested_at INTEGER NOT NULL,
  expires_at INTEGER,
  submitted_at INTEGER,
  reviewed_at INTEGER,
  reviewed_by TEXT,
  review_note TEXT,
  settled_at INTEGER,
  voided_at INTEGER,
  meta_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_membership_billing_intents_tenant_requested
  ON membership_billing_intents (tenant_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_membership_billing_intents_tenant_status
  ON membership_billing_intents (tenant_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_billing_intents_reference_code
  ON membership_billing_intents (reference_code);