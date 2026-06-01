-- Migration 0094: Tour gift cards with tenant-scoped balances
--
-- Purpose:
--   - let tenants issue per-tour gift cards with contact metadata and a generated ID code
--   - support server-side application of gift card balance during pricing and booking

CREATE TABLE IF NOT EXISTS tour_gift_cards (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  tour_id TEXT NOT NULL,
  id_code TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  face_value REAL NOT NULL,
  remaining_value REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (face_value >= 0),
  CHECK (remaining_value >= 0),
  CHECK (status IN ('active', 'redeemed', 'cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tour_gift_cards_tenant_code
  ON tour_gift_cards (tenant_id, id_code);

CREATE INDEX IF NOT EXISTS idx_tour_gift_cards_tenant_tour
  ON tour_gift_cards (tenant_id, tour_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tour_gift_cards_status
  ON tour_gift_cards (tenant_id, status, remaining_value, created_at DESC);

ALTER TABLE booking_orders ADD COLUMN gift_card_id TEXT;
ALTER TABLE booking_orders ADD COLUMN gift_card_id_code TEXT;
ALTER TABLE booking_orders ADD COLUMN gift_card_applied_amount REAL NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_booking_orders_gift_card
  ON booking_orders (tenant_id, gift_card_id, created_at DESC);