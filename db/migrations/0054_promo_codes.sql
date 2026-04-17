-- Migration 0054: Promo code system
-- Allows SaaS admin to generate access codes that tenants can redeem to
-- activate their subscription without going through Stripe.

CREATE TABLE IF NOT EXISTS promo_codes (
  id           TEXT PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  note         TEXT,                      -- admin note e.g. "for cousin Nam"
  max_uses     INTEGER,                   -- NULL = unlimited
  uses_count   INTEGER NOT NULL DEFAULT 0,
  duration_days INTEGER,                  -- NULL = permanent ACTIVE; else days from redemption
  expires_at   INTEGER,                   -- unix ts: code itself expires (NULL = never)
  created_by   TEXT NOT NULL DEFAULT 'platform_admin',
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS promo_code_redemptions (
  id           TEXT PRIMARY KEY,
  code_id      TEXT NOT NULL REFERENCES promo_codes(id),
  tenant_id    TEXT NOT NULL,
  redeemed_at  INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_redemptions_tenant_code
  ON promo_code_redemptions(tenant_id, code_id);

CREATE INDEX IF NOT EXISTS idx_promo_redemptions_code
  ON promo_code_redemptions(code_id);
