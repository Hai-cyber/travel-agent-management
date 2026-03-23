-- CHK-403
-- Tenant trial/subscription standing used to restrict publish and new bookings.

CREATE TABLE IF NOT EXISTS tenant_billing_configs (
	tenant_id TEXT PRIMARY KEY,
	trial_started_at INTEGER NOT NULL,
	trial_ends_at INTEGER NOT NULL,
	subscription_status TEXT NOT NULL CHECK (subscription_status IN ('trialing', 'active', 'unpaid')) DEFAULT 'trialing',
	updated_at INTEGER NOT NULL
);