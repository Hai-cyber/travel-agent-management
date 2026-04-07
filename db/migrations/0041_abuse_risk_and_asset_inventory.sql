-- 0041_abuse_risk_and_asset_inventory.sql
-- Purpose:
--   Add a durable risk-event ledger plus tenant asset inventory / scan results
--   so the platform can score behavior quietly, correlate repeated abuse, and
--   gate suspicious assets without blocking normal tenant editing flows.

CREATE TABLE IF NOT EXISTS tenant_risk_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  user_id TEXT,
  session_id TEXT,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  risk_score INTEGER NOT NULL DEFAULT 0,
  action TEXT NOT NULL DEFAULT 'observe',
  ip_hash TEXT,
  email_hash TEXT,
  user_agent_hash TEXT,
  asset_sha256 TEXT,
  signal_key TEXT,
  evidence_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (session_id) REFERENCES auth_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_risk_events_tenant_created
  ON tenant_risk_events (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_risk_events_type_created
  ON tenant_risk_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_risk_events_ip_created
  ON tenant_risk_events (ip_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_risk_events_email_created
  ON tenant_risk_events (email_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_risk_events_asset_created
  ON tenant_risk_events (asset_sha256, created_at DESC);

CREATE TABLE IF NOT EXISTS tenant_asset_inventory (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  moderation_status TEXT NOT NULL DEFAULT 'ALLOW',
  visibility TEXT NOT NULL DEFAULT 'PUBLIC',
  risk_score INTEGER NOT NULL DEFAULT 0,
  reasons_json TEXT,
  uploaded_by_user_id TEXT,
  uploaded_by_session_id TEXT,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id),
  FOREIGN KEY (uploaded_by_session_id) REFERENCES auth_sessions(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_asset_inventory_tenant_r2
  ON tenant_asset_inventory (tenant_id, r2_key);

CREATE INDEX IF NOT EXISTS idx_tenant_asset_inventory_tenant_created
  ON tenant_asset_inventory (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_asset_inventory_sha_created
  ON tenant_asset_inventory (sha256, created_at DESC);

CREATE TABLE IF NOT EXISTS tenant_asset_scan_results (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  risk_score INTEGER NOT NULL DEFAULT 0,
  reasons_json TEXT,
  evidence_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (asset_id) REFERENCES tenant_asset_inventory(id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_asset_scan_results_asset_created
  ON tenant_asset_scan_results (asset_id, created_at DESC);
