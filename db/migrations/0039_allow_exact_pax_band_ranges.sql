-- 0039_allow_exact_pax_band_ranges.sql
-- Allow exact pax-band ranges such as 1-1 for single-traveller pricing.

PRAGMA defer_foreign_keys = on;

CREATE TABLE pax_bands__new (
  id         TEXT    PRIMARY KEY,
  tenant_id  TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  min_pax    INTEGER NOT NULL CHECK (min_pax >= 1),
  max_pax    INTEGER NOT NULL CHECK (max_pax >= 1),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  CHECK (min_pax <= max_pax),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE tour_prices__new (
  id                              TEXT  PRIMARY KEY,
  tenant_id                       TEXT  NOT NULL,
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
  infant_price                    REAL NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, tour_id, season_id, segment_id, pax_band_id),
  FOREIGN KEY (tenant_id)   REFERENCES tenants(id),
  FOREIGN KEY (tour_id)     REFERENCES tours(id),
  FOREIGN KEY (season_id)   REFERENCES tenant_seasons(id),
  FOREIGN KEY (segment_id)  REFERENCES pricing_segments(id),
  FOREIGN KEY (pax_band_id) REFERENCES pax_bands__new(id)
);

INSERT INTO pax_bands__new (
  id,
  tenant_id,
  name,
  min_pax,
  max_pax,
  sort_order,
  is_active,
  created_at
)
SELECT
  id,
  tenant_id,
  name,
  min_pax,
  max_pax,
  sort_order,
  is_active,
  created_at
FROM pax_bands;

INSERT INTO tour_prices__new (
  id,
  tenant_id,
  tour_id,
  season_id,
  segment_id,
  pax_band_id,
  base_currency,
  adult_shared_room_price,
  adult_single_room_price,
  child_shared_with_parents_price,
  notes,
  is_active,
  created_at,
  infant_price
)
SELECT
  id,
  tenant_id,
  tour_id,
  season_id,
  segment_id,
  pax_band_id,
  base_currency,
  adult_shared_room_price,
  adult_single_room_price,
  child_shared_with_parents_price,
  notes,
  is_active,
  created_at,
  infant_price
FROM tour_prices;

DROP TABLE tour_prices;
DROP TABLE pax_bands;
ALTER TABLE pax_bands__new RENAME TO pax_bands;
ALTER TABLE tour_prices__new RENAME TO tour_prices;

CREATE INDEX IF NOT EXISTS idx_pax_bands_tenant ON pax_bands(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tour_prices_tenant   ON tour_prices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tour_prices_tour     ON tour_prices(tour_id);
CREATE INDEX IF NOT EXISTS idx_tour_prices_season   ON tour_prices(season_id);
CREATE INDEX IF NOT EXISTS idx_tour_prices_segment  ON tour_prices(segment_id);
CREATE INDEX IF NOT EXISTS idx_tour_prices_pax_band ON tour_prices(pax_band_id);