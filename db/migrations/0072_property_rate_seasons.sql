-- Migration 0072: Property rate seasons and seasonal room prices
--
-- Purpose:
--   - expand the minimal property room-rate layer into pricing v2
--   - keep pricing independent from availability while supporting season/date-specific nightly pricing

CREATE TABLE IF NOT EXISTS property_rate_seasons (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT    NOT NULL,
  property_id TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  start_date  TEXT    NOT NULL,
  end_date    TEXT    NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (property_id) REFERENCES properties(id)
);

CREATE INDEX IF NOT EXISTS idx_property_rate_seasons_property_active
  ON property_rate_seasons (tenant_id, property_id, active, sort_order, start_date, end_date);

CREATE TABLE IF NOT EXISTS property_room_rate_season_prices (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT    NOT NULL,
  property_id    TEXT    NOT NULL,
  season_id      TEXT    NOT NULL,
  room_type_id   TEXT    NOT NULL,
  currency       TEXT    NOT NULL DEFAULT 'VND',
  nightly_amount REAL    NOT NULL,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (property_id) REFERENCES properties(id),
  FOREIGN KEY (season_id) REFERENCES property_rate_seasons(id),
  FOREIGN KEY (room_type_id) REFERENCES room_types(id)
);

CREATE INDEX IF NOT EXISTS idx_property_room_rate_season_prices_lookup
  ON property_room_rate_season_prices (tenant_id, property_id, season_id, room_type_id, active);

CREATE UNIQUE INDEX IF NOT EXISTS idx_property_room_rate_season_prices_one_active
  ON property_room_rate_season_prices (season_id, room_type_id)
  WHERE active = 1;