-- 0040_tenant_trust_and_review.sql
-- Purpose:
--   Add tenant trust ladder + review queue so signup stays low-friction while
--   public exposure, custom domains, and suspicious publish attempts can be
--   moderated safely.

ALTER TABLE tenants ADD COLUMN trust_status TEXT;
ALTER TABLE tenants ADD COLUMN trust_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN trust_reasons_json TEXT;
ALTER TABLE tenants ADD COLUMN trust_reviewed_at INTEGER;
ALTER TABLE tenants ADD COLUMN trust_reviewed_by TEXT;
ALTER TABLE tenants ADD COLUMN custom_domain_verified_at INTEGER;
ALTER TABLE tenants ADD COLUMN public_indexing_enabled INTEGER NOT NULL DEFAULT 0;

UPDATE tenants
   SET trust_status = CASE
     WHEN subscription_status IN ('SUSPENDED', 'CANCELLED') THEN 'SUSPENDED'
     WHEN custom_domain IS NOT NULL AND TRIM(custom_domain) <> '' THEN 'TRUSTED'
     WHEN subdomain IS NOT NULL AND TRIM(subdomain) <> '' THEN 'PROBATION'
     ELSE 'PREVIEW_ONLY'
   END
 WHERE trust_status IS NULL;

UPDATE tenants
   SET custom_domain_verified_at = COALESCE(custom_domain_verified_at, created_at)
 WHERE custom_domain IS NOT NULL
   AND TRIM(custom_domain) <> '';

UPDATE tenants
   SET public_indexing_enabled = 1
 WHERE custom_domain IS NOT NULL
   AND TRIM(custom_domain) <> '';

CREATE TABLE IF NOT EXISTS tenant_review_cases (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  category TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'review',
  signal_key TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence_json TEXT,
  auto_created INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by TEXT,
  resolution_note TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_review_cases_tenant_status
  ON tenant_review_cases (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_review_cases_status_created
  ON tenant_review_cases (status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_review_cases_open_signal
  ON tenant_review_cases (tenant_id, signal_key)
  WHERE status = 'OPEN';
