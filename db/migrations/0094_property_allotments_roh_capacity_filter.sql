-- Migration 0094: allow ROH allotments and configurable capacity filters

PRAGMA foreign_keys = OFF;

ALTER TABLE property_allotments RENAME TO property_allotments_legacy_0094;

CREATE TABLE property_allotments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  room_type_id TEXT,
  operator_name TEXT NOT NULL,
  operator_code TEXT,
  source_ref TEXT,
  check_in TEXT NOT NULL,
  check_out TEXT NOT NULL,
  rooms_blocked INTEGER NOT NULL,
  roh_capacity_filter TEXT,
  release_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO property_allotments (
  id, tenant_id, property_id, room_type_id, operator_name, operator_code, source_ref,
  check_in, check_out, rooms_blocked, roh_capacity_filter, release_date, status, notes,
  created_by, updated_by, created_at, updated_at
)
SELECT
  id,
  tenant_id,
  property_id,
  NULLIF(room_type_id, ''),
  operator_name,
  operator_code,
  source_ref,
  check_in,
  check_out,
  rooms_blocked,
  CASE WHEN room_type_id IS NULL OR TRIM(room_type_id) = '' THEN 'max_2' ELSE NULL END,
  release_date,
  status,
  notes,
  created_by,
  updated_by,
  created_at,
  updated_at
FROM property_allotments_legacy_0094;

DROP TABLE property_allotments_legacy_0094;

CREATE INDEX IF NOT EXISTS idx_property_allotments_property_status_dates
  ON property_allotments (tenant_id, property_id, status, check_in, check_out);

CREATE INDEX IF NOT EXISTS idx_property_allotments_room_type_dates
  ON property_allotments (tenant_id, property_id, room_type_id, check_in, check_out);

CREATE INDEX IF NOT EXISTS idx_property_allotments_release_date
  ON property_allotments (tenant_id, property_id, status, release_date);

PRAGMA foreign_keys = ON;