-- Migration 0091: Property operator allotments / room blocks
--
-- Purpose:
--   - reserve room-type inventory for tour operators / sales contracts
--   - expose release-cutoff based inventory blocks separate from guest reservations

CREATE TABLE IF NOT EXISTS property_allotments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  room_type_id TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  operator_code TEXT,
  source_ref TEXT,
  check_in TEXT NOT NULL,
  check_out TEXT NOT NULL,
  rooms_blocked INTEGER NOT NULL,
  release_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_property_allotments_property_status_dates
  ON property_allotments (tenant_id, property_id, status, check_in, check_out);

CREATE INDEX IF NOT EXISTS idx_property_allotments_room_type_dates
  ON property_allotments (tenant_id, property_id, room_type_id, check_in, check_out);

CREATE INDEX IF NOT EXISTS idx_property_allotments_release_date
  ON property_allotments (tenant_id, property_id, status, release_date);
