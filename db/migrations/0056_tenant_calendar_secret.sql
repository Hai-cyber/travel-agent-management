-- Migration 0056: per-tenant calendar subscription secret
-- Used to authenticate iCal feed requests without requiring a session cookie.
-- The secret is a UUID generated on first request to POST /api/tenants/calendar-secret.
-- Rotating the secret immediately invalidates all existing calendar subscriptions.
-- NOTE: SQLite does not support ADD COLUMN ... UNIQUE; add column then index separately.
ALTER TABLE tenants ADD COLUMN calendar_secret TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_calendar_secret
  ON tenants(calendar_secret) WHERE calendar_secret IS NOT NULL;
