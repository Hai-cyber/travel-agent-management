-- Migration 0061: Property room inventory
--
-- Purpose:
--   - add commercial room categories and physical room units for the property engine
--   - establish the lane foundation required by night-based availability

CREATE TABLE IF NOT EXISTS room_types (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT    NOT NULL,
  property_id   TEXT    NOT NULL,
  code          TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  description   TEXT,
  base_capacity INTEGER NOT NULL DEFAULT 1,
  max_occupancy INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (property_id) REFERENCES properties(id),
  UNIQUE (property_id, code)
);

CREATE INDEX IF NOT EXISTS idx_room_types_property_active
  ON room_types (tenant_id, property_id, active, sort_order);

CREATE TABLE IF NOT EXISTS room_units (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT    NOT NULL,
  property_id        TEXT    NOT NULL,
  room_type_id       TEXT    NOT NULL,
  room_number        TEXT    NOT NULL,
  floor_label        TEXT,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  active             INTEGER NOT NULL DEFAULT 1,
  operational_status TEXT    NOT NULL DEFAULT 'ready'
                            CHECK (operational_status IN ('ready', 'maintenance', 'out_of_order')),
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (property_id) REFERENCES properties(id),
  FOREIGN KEY (room_type_id) REFERENCES room_types(id),
  UNIQUE (property_id, room_number)
);

CREATE INDEX IF NOT EXISTS idx_room_units_property_type_active
  ON room_units (tenant_id, property_id, room_type_id, active, sort_order);

CREATE INDEX IF NOT EXISTS idx_room_units_property_status
  ON room_units (tenant_id, property_id, operational_status);
