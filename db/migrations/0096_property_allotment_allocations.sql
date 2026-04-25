-- Migration 0096: persisted room allocations materialized from property allotments

CREATE TABLE IF NOT EXISTS property_allotment_allocations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  allotment_id TEXT NOT NULL,
  room_type_id TEXT NOT NULL,
  room_unit_id TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  check_in TEXT NOT NULL,
  check_out TEXT NOT NULL,
  allocation_status TEXT NOT NULL DEFAULT 'allocated',
  allocation_source TEXT NOT NULL DEFAULT 'manual_allocate',
  released_reason TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_property_allotment_allocations_allotment
  ON property_allotment_allocations (tenant_id, property_id, allotment_id, allocation_status, created_at);

CREATE INDEX IF NOT EXISTS idx_property_allotment_allocations_room_unit_dates
  ON property_allotment_allocations (tenant_id, property_id, room_unit_id, allocation_status, check_in, check_out);

CREATE INDEX IF NOT EXISTS idx_property_allotment_allocations_property_dates
  ON property_allotment_allocations (tenant_id, property_id, allocation_status, check_in, check_out);