-- 0004_add_pricing_foundation.sql
-- Add canonical pricing foundation tables
-- Rescue-safe, additive only
-- No drops, no destructive renames
--
-- INTEGRITY FIXES (2026-03-25):
--   [1] tour_prices.tour_id changed to TEXT (matches canonical tours.id)
--   [2] tour_prices: UNIQUE(tenant_id, tour_id, season_id, segment_id, pax_band_id)
--       prevents duplicate price rows for same combination
--   [3] pax_bands: CHECK(min_pax < max_pax) prevents invalid ranges
--   [4] tenant_seasons: CHECK on month/day ranges prevents bad calendar values
--   [5] Indexes on all FK columns for join performance and lookup integrity
--
-- Run full integrity verification after applying:
--   npx wrangler d1 execute DB --local --file=db/integrity_check_pricing.sql

-- ------------------------------------------------
-- TENANT SEASONS
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_seasons (
  id          TEXT    PRIMARY KEY,
  tenant_id   TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  start_month INTEGER NOT NULL CHECK (start_month BETWEEN 1 AND 12),
  start_day   INTEGER NOT NULL CHECK (start_day   BETWEEN 1 AND 31),
  end_month   INTEGER NOT NULL CHECK (end_month   BETWEEN 1 AND 12),
  end_day     INTEGER NOT NULL CHECK (end_day     BETWEEN 1 AND 31),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  notes       TEXT,
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_seasons_tenant ON tenant_seasons(tenant_id);

-- ------------------------------------------------
-- PRICING SEGMENTS
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS pricing_segments (
  id          TEXT    PRIMARY KEY,
  tenant_id   TEXT    NOT NULL,
  code        TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_pricing_segments_tenant ON pricing_segments(tenant_id);

-- ------------------------------------------------
-- PAX BANDS
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS pax_bands (
  id         TEXT    PRIMARY KEY,
  tenant_id  TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  min_pax    INTEGER NOT NULL CHECK (min_pax >= 1),
  max_pax    INTEGER NOT NULL CHECK (max_pax >= 1),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  -- [3] Enforce valid range: min must be strictly less than max
  CHECK (min_pax < max_pax),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_pax_bands_tenant ON pax_bands(tenant_id);

-- ------------------------------------------------
-- TOUR PRICES
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS tour_prices (
  id                              TEXT  PRIMARY KEY,
  tenant_id                       TEXT  NOT NULL,
  -- [1] TEXT to match canonical tours.id (not INTEGER)
  tour_id                         TEXT  NOT NULL,
  season_id                       TEXT  NOT NULL,
  segment_id                      TEXT  NOT NULL,
  pax_band_id                     TEXT  NOT NULL,
  base_currency                   TEXT  NOT NULL DEFAULT 'USD',
  adult_shared_room_price         REAL,
  adult_single_room_price         REAL,
  child_shared_with_parents_price REAL,
  notes                           TEXT,
  is_active                       INTEGER NOT NULL DEFAULT 1,
  created_at                      INTEGER NOT NULL,
  -- [2] Prevent duplicate price rows for the same combination
  UNIQUE (tenant_id, tour_id, season_id, segment_id, pax_band_id),
  FOREIGN KEY (tenant_id)   REFERENCES tenants(id),
  FOREIGN KEY (tour_id)     REFERENCES tours(id),
  FOREIGN KEY (season_id)   REFERENCES tenant_seasons(id),
  FOREIGN KEY (segment_id)  REFERENCES pricing_segments(id),
  FOREIGN KEY (pax_band_id) REFERENCES pax_bands(id)
);

-- [5] Indexes on all FK/lookup columns
CREATE INDEX IF NOT EXISTS idx_tour_prices_tenant   ON tour_prices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tour_prices_tour     ON tour_prices(tour_id);
CREATE INDEX IF NOT EXISTS idx_tour_prices_season   ON tour_prices(season_id);
CREATE INDEX IF NOT EXISTS idx_tour_prices_segment  ON tour_prices(segment_id);
CREATE INDEX IF NOT EXISTS idx_tour_prices_pax_band ON tour_prices(pax_band_id);

-- Suggested verification after apply:
-- npx wrangler d1 execute DB --local --file=db/integrity_check_pricing.sql
--
-- Quick spot checks:
-- SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
-- SELECT name FROM sqlite_master WHERE type='index' ORDER BY tbl_name, name;
-- SELECT * FROM tenant_seasons;
-- SELECT * FROM pricing_segments;
-- SELECT * FROM pax_bands;
-- SELECT * FROM tour_prices;