-- 0037_tenant_booking_currency_and_market_skin.sql
-- Introduce tenant-controlled booking currency semantics and market-skin presets.

ALTER TABLE tenants ADD COLUMN booking_currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE tenants ADD COLUMN market_skin_key TEXT NOT NULL DEFAULT 'global-default';
ALTER TABLE tenants ADD COLUMN primary_market TEXT NOT NULL DEFAULT 'GLOBAL';

ALTER TABLE booking_drafts ADD COLUMN quoted_total_amount REAL;
ALTER TABLE booking_drafts ADD COLUMN quoted_currency TEXT;
ALTER TABLE booking_drafts ADD COLUMN quoted_base_currency TEXT;
ALTER TABLE booking_drafts ADD COLUMN quoted_exchange_rate REAL;

ALTER TABLE booking_orders ADD COLUMN grand_total_amount REAL;
ALTER TABLE booking_orders ADD COLUMN booking_currency TEXT;
ALTER TABLE booking_orders ADD COLUMN quoted_base_currency TEXT;
ALTER TABLE booking_orders ADD COLUMN quoted_exchange_rate REAL;

UPDATE tenants
   SET booking_currency = COALESCE(NULLIF(target_currency, ''), COALESCE(NULLIF(base_currency, ''), 'USD'))
 WHERE booking_currency IS NULL OR booking_currency = '';

UPDATE booking_drafts
   SET quoted_total_amount = COALESCE(quoted_total_amount, 0),
       quoted_currency = COALESCE(NULLIF(quoted_currency, ''), 'USD'),
       quoted_base_currency = COALESCE(NULLIF(quoted_base_currency, ''), 'USD'),
       quoted_exchange_rate = COALESCE(quoted_exchange_rate, 1);

UPDATE booking_orders
   SET grand_total_amount = COALESCE(grand_total_amount, grand_total_usd),
       booking_currency = COALESCE(NULLIF(booking_currency, ''), 'USD'),
       quoted_base_currency = COALESCE(NULLIF(quoted_base_currency, ''), 'USD'),
       quoted_exchange_rate = COALESCE(quoted_exchange_rate, 1);

CREATE INDEX IF NOT EXISTS idx_tenants_market_skin_key
  ON tenants (market_skin_key);