-- Migration 0098: rooming list entries for confirmed property allotments

CREATE TABLE IF NOT EXISTS property_allotment_rooming_list_entries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  allotment_id TEXT NOT NULL,
  allotment_allocation_id TEXT NOT NULL,
  room_type_id TEXT NOT NULL,
  room_unit_id TEXT NOT NULL,
  rooming_status TEXT NOT NULL DEFAULT 'pending',
  display_name TEXT NOT NULL,
  guest_name TEXT,
  note TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (property_id) REFERENCES properties(id),
  FOREIGN KEY (allotment_id) REFERENCES property_allotments(id),
  FOREIGN KEY (allotment_allocation_id) REFERENCES property_allotment_allocations(id),
  FOREIGN KEY (room_type_id) REFERENCES room_types(id),
  FOREIGN KEY (room_unit_id) REFERENCES room_units(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_property_allotment_rooming_unique_allocation
  ON property_allotment_rooming_list_entries (tenant_id, property_id, allotment_allocation_id);

CREATE INDEX IF NOT EXISTS idx_property_allotment_rooming_by_allotment
  ON property_allotment_rooming_list_entries (tenant_id, property_id, allotment_id, rooming_status, created_at);