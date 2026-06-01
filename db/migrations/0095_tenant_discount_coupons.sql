-- Migration 0095: Tenant marketing discount coupons
--
-- Purpose:
--   - let tenants create shareable discount coupons for customer acquisition
--   - support all-tour or per-tour coupon scope
--   - support fixed-amount and percentage discounts during pricing and booking

CREATE TABLE IF NOT EXISTS tenant_discount_coupons (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  tour_id TEXT,
  code TEXT NOT NULL,
  label TEXT,
  discount_type TEXT NOT NULL,
  discount_value REAL NOT NULL,
  currency TEXT,
  min_order_total REAL NOT NULL DEFAULT 0,
  max_uses INTEGER,
  uses_count INTEGER NOT NULL DEFAULT 0,
  starts_at INTEGER,
  expires_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (discount_type IN ('amount', 'percent')),
  CHECK (discount_value > 0),
  CHECK (min_order_total >= 0),
  CHECK (status IN ('active', 'paused'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_discount_coupons_tenant_code
  ON tenant_discount_coupons (tenant_id, code);

CREATE INDEX IF NOT EXISTS idx_discount_coupons_tenant_tour
  ON tenant_discount_coupons (tenant_id, tour_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_discount_coupons_status
  ON tenant_discount_coupons (tenant_id, status, created_at DESC);

ALTER TABLE booking_orders ADD COLUMN discount_coupon_id TEXT;
ALTER TABLE booking_orders ADD COLUMN discount_coupon_code TEXT;
ALTER TABLE booking_orders ADD COLUMN discount_coupon_applied_amount REAL NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_booking_orders_discount_coupon
  ON booking_orders (tenant_id, discount_coupon_id, created_at DESC);