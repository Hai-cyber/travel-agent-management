-- Migration 0093: Deterministic property weekday pricing rules
--
-- Purpose:
--   - add explainable day-of-week pricing adjustments above base/seasonal rates
--   - support property-wide or room-type-scoped weekday rules without introducing inventory-aware logic

CREATE TABLE IF NOT EXISTS property_weekday_pricing_rules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  room_type_id TEXT,
  day_of_week INTEGER NOT NULL,
  name TEXT NOT NULL,
  pricing_mode TEXT NOT NULL,
  fixed_nightly_amount REAL,
  delta_amount REAL,
  delta_percent REAL,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  updated_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_property_weekday_pricing_rules_property_scope
  ON property_weekday_pricing_rules (tenant_id, property_id, day_of_week)
  WHERE room_type_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_property_weekday_pricing_rules_room_scope
  ON property_weekday_pricing_rules (tenant_id, property_id, room_type_id, day_of_week)
  WHERE room_type_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_property_weekday_pricing_rules_property_active
  ON property_weekday_pricing_rules (tenant_id, property_id, active, day_of_week, created_at);

CREATE INDEX IF NOT EXISTS idx_property_weekday_pricing_rules_room_type
  ON property_weekday_pricing_rules (tenant_id, property_id, room_type_id, active, day_of_week);