-- Migration: 0051_tenant_domain_purchases.sql
-- Domain purchases via the platform registrar integration.
-- Records each domain registered or renewed through the platform
-- (CF Registrar at-cost + 30% platform markup, paid via Stripe one-time checkout).
--
-- Column notes:
--   registrar_price_cents   CF at-cost price (USD cents, e.g. 915 = $9.15 for .com)
--   markup_pct              Platform markup percentage applied (default 30)
--   amount_charged_cents    What the tenant paid (rounded up to nearest cent)
--   payment_status          PENDING → COMPLETED | FAILED
--   domain_status           PENDING → REGISTERED | FAILED (CF API call result)
--   cf_zone_id              Cloudflare Zone ID returned by CF Registrar API on success
--   stripe_session_id       Stripe checkout.session.id for audit / idempotency
--   stripe_payment_intent   Stripe payment_intent.id for refund reference

CREATE TABLE IF NOT EXISTS tenant_domain_purchases (
  id                      TEXT    PRIMARY KEY,
  tenant_id               TEXT    NOT NULL,
  domain                  TEXT    NOT NULL,
  cf_zone_id              TEXT,
  stripe_session_id       TEXT,
  stripe_payment_intent   TEXT,
  registrar_price_cents   INTEGER NOT NULL,
  markup_pct              INTEGER NOT NULL DEFAULT 30,
  amount_charged_cents    INTEGER NOT NULL,
  registration_years      INTEGER NOT NULL DEFAULT 1,
  payment_status          TEXT    NOT NULL DEFAULT 'PENDING',
  domain_status           TEXT    NOT NULL DEFAULT 'PENDING',
  purchased_at            INTEGER NOT NULL,
  registered_at           INTEGER,
  expires_at              INTEGER,
  created_at              INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tdp_tenant  ON tenant_domain_purchases(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tdp_domain  ON tenant_domain_purchases(domain);
CREATE INDEX IF NOT EXISTS idx_tdp_session ON tenant_domain_purchases(stripe_session_id);
