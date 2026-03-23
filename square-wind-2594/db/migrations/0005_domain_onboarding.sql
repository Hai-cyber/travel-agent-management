-- CHK-401
-- Tenant domain onboarding and verification state.

CREATE TABLE IF NOT EXISTS tenant_domain_configs (
	tenant_id TEXT PRIMARY KEY,
	hostname TEXT UNIQUE,
	status TEXT NOT NULL CHECK (status IN ('no_domain', 'pending', 'verified')) DEFAULT 'no_domain',
	verification_record_type TEXT NOT NULL DEFAULT 'TXT',
	verification_record_name TEXT,
	verification_record_value TEXT,
	verified_at INTEGER,
	updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tenant_domain_configs_status
	ON tenant_domain_configs(status);