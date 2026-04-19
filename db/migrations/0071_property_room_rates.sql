-- Migration 0071: Property room rates baseline
--
-- Purpose:
--   - add a minimal commercial rate layer for the property builder
--   - keep room pricing separate from inventory truth while giving tenants
--     one clean nightly price anchor per room type

CREATE TABLE IF NOT EXISTS property_room_rates (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT    NOT NULL,
  property_id    TEXT    NOT NULL,
  room_type_id   TEXT    NOT NULL,
  rate_name      TEXT    NOT NULL DEFAULT 'Standard Rate',
  currency       TEXT    NOT NULL DEFAULT 'VND',
  nightly_amount REAL    NOT NULL,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (property_id) REFERENCES properties(id),
  FOREIGN KEY (room_type_id) REFERENCES room_types(id)
);

CREATE INDEX IF NOT EXISTS idx_property_room_rates_property_active
  ON property_room_rates (tenant_id, property_id, active, room_type_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_property_room_rates_one_active_per_room_type
  ON property_room_rates (room_type_id)
  WHERE active = 1;