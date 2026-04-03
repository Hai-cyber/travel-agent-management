-- Migration 0032: Persist selected product tier on tenants
--
-- Purpose:
--   - store which product tier a tenant selected during onboarding
--   - support future plan-based billing, capability gating, and upgrade flows

ALTER TABLE tenants ADD COLUMN product_tier_key TEXT NOT NULL DEFAULT 'starter_landing';

CREATE INDEX IF NOT EXISTS idx_tenants_product_tier_key
  ON tenants (product_tier_key);