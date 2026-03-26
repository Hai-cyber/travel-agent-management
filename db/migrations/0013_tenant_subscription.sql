-- Migration 0013: Tenant subscription control + custom domain + payment config
-- Purpose: Enable headless publishing gating by subscription tier,
--          custom domain routing, and per-tenant payment gateway config.
-- ⚠ Additive only — no existing columns are modified.

-- Subscription status for publishing access control.
-- Values: 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED'
-- Default TRIAL allows limited access before a paid plan is confirmed.
ALTER TABLE tenants ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'TRIAL';

-- The tenant's custom domain (e.g. "tours.mycompany.com").
-- Must be a bare hostname — no protocol, no path segments.
-- Null when not configured. Enforced unique at the application layer via
-- the index below so that domain → tenant lookups are always unambiguous.
ALTER TABLE tenants ADD COLUMN custom_domain TEXT;

-- Payment gateway configuration stored as a JSON blob.
-- Supported keys (all optional):
--   stripe_price_id   TEXT  — Stripe Price/Product ID for booking CTA
--   stripe_pub_key    TEXT  — Stripe publishable key (safe to embed in HTML)
--   paypal_plan_id    TEXT  — PayPal subscription plan ID
--   checkout_url      TEXT  — Absolute URL override (custom checkout page)
-- [SEC] Private keys (stripe_secret_key etc.) MUST NOT be stored here.
--       Use Cloudflare Workers Secrets for those.
ALTER TABLE tenants ADD COLUMN payment_config_json TEXT;

-- Unique index: one custom domain cannot belong to more than one tenant.
-- Partial (WHERE custom_domain IS NOT NULL) — NULL rows are not indexed,
-- so tenants without a custom domain don't compete with each other.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_custom_domain
  ON tenants (custom_domain)
  WHERE custom_domain IS NOT NULL;
