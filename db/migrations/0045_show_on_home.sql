-- Add show_on_home flag to hotel catalog and destination catalog
-- Allows per-entry control over homepage section visibility

-- Ensure tenant_destinations exists before altering it.
-- The table was introduced in CHK-R48 (applied directly to remote D1 without
-- a migration file). This guard makes the migration safe for fresh local DBs.
CREATE TABLE IF NOT EXISTS tenant_destinations (
  id          TEXT    NOT NULL PRIMARY KEY,
  tenant_id   TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  description TEXT,
  region      TEXT,
  gallery_json TEXT,
  status      TEXT    NOT NULL DEFAULT 'active',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tour_destination_links (
  id             TEXT    NOT NULL PRIMARY KEY,
  tenant_id      TEXT    NOT NULL,
  tour_id        TEXT    NOT NULL,
  destination_id TEXT    NOT NULL,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  UNIQUE (tour_id, destination_id, tenant_id)
);

CREATE TABLE IF NOT EXISTS tour_hotel_links (
  id         TEXT    NOT NULL PRIMARY KEY,
  tenant_id  TEXT    NOT NULL,
  tour_id    TEXT    NOT NULL,
  hotel_id   TEXT    NOT NULL,
  nights     INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (tour_id, hotel_id, tenant_id)
);

ALTER TABLE tenant_universal_hotels ADD COLUMN show_on_home INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenant_destinations ADD COLUMN show_on_home INTEGER NOT NULL DEFAULT 0;
