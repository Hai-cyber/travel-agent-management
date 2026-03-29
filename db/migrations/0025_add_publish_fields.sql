-- Migration 0025: Add publish-gate fields to tenants
--
-- Rationale (from Gap Analysis):
--   GAP 3 — terms_accepted / terms_accepted_at: no DB field existed; the
--            publish gate could not enforce T&C agreement at runtime.
--   GAP 3 — subdomain: schema column existed in 0018 via DATA_MODEL.sql doc
--            but was NEVER actually migrated. Added here for real.
--   GAP 7 — stripe_customer_id: tenant_billing_configs table was designed in
--            DATA_MODEL.sql but no migration existed. Storing the Stripe
--            customer reference directly on tenants is simpler and avoids a
--            separate table for a single-tenant relationship.
--
-- All four columns are ADDITIVE — no existing rows or constraints are modified.
--
-- Column semantics:
--   terms_accepted      INTEGER  0 = not accepted, 1 = accepted by tenant owner.
--   terms_accepted_at   INTEGER  Unix epoch when T&C were first accepted. NULL until accepted.
--   subdomain           TEXT     Platform-issued subdomain slug (e.g. "sunsettravel").
--                                The public preview URL becomes subdomain.platform.com.
--                                UNIQUE + partial index (NULL rows excluded).
--                                NOTE: column + unique index already added in 0018_site_studio_foundation.sql.
--                                This migration does NOT re-add them.
--   stripe_customer_id  TEXT     Stripe Customer object ID (cus_…). Set on first
--                                Stripe Checkout Session creation. NULL for TRIAL tenants
--                                that have not started billing.
--
-- Publish gate enforcement (POST /api/tenant/publish-site):
--   All four conditions must be true before a tenant can go LIVE:
--     1. subscription_status = 'ACTIVE'           (existing check)
--     2. terms_accepted = 1                        (new — this migration)
--     3. subdomain IS NOT NULL OR custom_domain IS NOT NULL  (new — this migration)
--     4. payment_methods has ≥1 enabled instant gateway      (new — payments.js)
--
-- ⚠ Additive only — no existing columns, indexes, or data are modified.

ALTER TABLE tenants ADD COLUMN terms_accepted     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN terms_accepted_at  INTEGER;
-- subdomain column + unique index already exist from migration 0018_site_studio_foundation.sql
ALTER TABLE tenants ADD COLUMN stripe_customer_id TEXT;

-- Enforce global uniqueness on subdomain (partial — NULL rows are excluded,
-- so unregistered tenants do not conflict with each other).
-- SKIP: CREATE UNIQUE INDEX idx_tenants_subdomain — already created in 0018.

-- Non-unique index for Stripe customer lookups (webhook reconciliation).
CREATE INDEX IF NOT EXISTS idx_tenants_stripe_customer
  ON tenants (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
