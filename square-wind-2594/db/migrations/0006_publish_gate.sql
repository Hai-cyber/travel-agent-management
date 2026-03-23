-- CHK-402
-- Publish gate checklist state per tenant.

CREATE TABLE IF NOT EXISTS tenant_publish_configs (
	tenant_id TEXT PRIMARY KEY,
	payment_method_added INTEGER NOT NULL DEFAULT 0,
	terms_accepted INTEGER NOT NULL DEFAULT 0,
	commission_agreement_accepted INTEGER NOT NULL DEFAULT 0,
	updated_at INTEGER NOT NULL
);