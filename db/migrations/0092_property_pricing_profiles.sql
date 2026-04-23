-- Migration 0092: Planner-only property pricing profiles
--
-- Purpose:
--   - define internal-only commercial profiles such as ROH / group / tour company
--   - keep profile scope at property or room-type level without creating fake inventory room types

CREATE TABLE IF NOT EXISTS property_pricing_profiles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  room_type_id TEXT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'planner_only',
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_property_pricing_profiles_property_code
  ON property_pricing_profiles (tenant_id, property_id, code);

CREATE INDEX IF NOT EXISTS idx_property_pricing_profiles_property_active
  ON property_pricing_profiles (tenant_id, property_id, active, created_at);

CREATE INDEX IF NOT EXISTS idx_property_pricing_profiles_room_type
  ON property_pricing_profiles (tenant_id, property_id, room_type_id, active);
