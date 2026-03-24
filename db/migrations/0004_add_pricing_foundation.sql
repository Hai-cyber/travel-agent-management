-- 0004_add_pricing_foundation.sql
-- Add canonical pricing foundation tables
-- Rescue-safe, additive only
-- No drops, no destructive renames

CREATE TABLE IF NOT EXISTS tenant_seasons (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  start_month INTEGER NOT NULL,
  start_day INTEGER NOT NULL,
  end_month INTEGER NOT NULL,
  end_day INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE IF NOT EXISTS pricing_segments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE IF NOT EXISTS pax_bands (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  min_pax INTEGER NOT NULL,
  max_pax INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE IF NOT EXISTS tour_prices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  tour_id INTEGER NOT NULL,
  season_id TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  pax_band_id TEXT NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'USD',
  adult_shared_room_price REAL,
  adult_single_room_price REAL,
  child_shared_with_parents_price REAL,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (tour_id) REFERENCES tours(id),
  FOREIGN KEY (season_id) REFERENCES tenant_seasons(id),
  FOREIGN KEY (segment_id) REFERENCES pricing_segments(id),
  FOREIGN KEY (pax_band_id) REFERENCES pax_bands(id)
);

-- Suggested verification after apply:
-- SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
-- SELECT * FROM tenant_seasons;
-- SELECT * FROM pricing_segments;
-- SELECT * FROM pax_bands;
-- SELECT * FROM tour_prices;