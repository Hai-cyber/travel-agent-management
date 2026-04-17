-- Migration 0055: Add promo_activated flag to tenants
-- Promo-code-redeemed tenants bypass commercial-activation gates (domain/gateway)
-- so they can sell tours on the platform subdomain during testing.
ALTER TABLE tenants ADD COLUMN promo_activated INTEGER NOT NULL DEFAULT 0;
