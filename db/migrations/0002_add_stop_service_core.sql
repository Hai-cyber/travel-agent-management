-- 0002_add_stop_service_core.sql
-- Add canonical stop-based service core tables
-- Rescue-safe, additive only
-- No drops, no destructive renames

CREATE TABLE IF NOT EXISTS service_types (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tour_stop_service_flags (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  tour_stop_id INTEGER NOT NULL,
  service_type_id TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE (tour_stop_id, service_type_id),
  FOREIGN KEY (tour_stop_id) REFERENCES tour_stops(id),
  FOREIGN KEY (service_type_id) REFERENCES service_types(id)
);

-- Suggested verification after apply:
-- SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
-- SELECT * FROM service_types;
-- SELECT * FROM tour_stop_service_flags;