-- 0001_foundation.sql
-- Foundation tables: tenants, users, memberships, tours, destinations, tour_stops
-- Rescue-safe, additive only. Must run BEFORE all other migrations.

-- =========================
-- TENANCY
-- =========================

CREATE TABLE IF NOT EXISTS tenants (
  id          TEXT    PRIMARY KEY,
  slug        TEXT    UNIQUE NOT NULL,
  name        TEXT    NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id          TEXT    PRIMARY KEY,
  email       TEXT    UNIQUE NOT NULL,
  hash        TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  user_id    TEXT NOT NULL,
  tenant_id  TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('owner','manager','staff','provider')),
  PRIMARY KEY (user_id, tenant_id),
  FOREIGN KEY (user_id)   REFERENCES users(id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- =========================
-- TOUR CORE
-- =========================

CREATE TABLE IF NOT EXISTS tours (
  id             TEXT    PRIMARY KEY,
  tenant_id      TEXT    NOT NULL,
  title          TEXT    NOT NULL,
  lang           TEXT    DEFAULT 'vi',
  start_date     INTEGER,
  duration_text  TEXT,
  status         TEXT    NOT NULL CHECK (status IN ('draft','on_sale','booked','completed','archived')) DEFAULT 'draft',
  created_at     INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Destination catalog/reference only — NOT an itinerary segment
CREATE TABLE IF NOT EXISTS destinations (
  id          TEXT    PRIMARY KEY,
  tenant_id   TEXT    NOT NULL,
  code        TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Canonical itinerary segment
CREATE TABLE IF NOT EXISTS tour_stops (
  id              TEXT    PRIMARY KEY,
  tenant_id       TEXT    NOT NULL,
  tour_id         TEXT    NOT NULL,
  destination_id  TEXT,
  label           TEXT    NOT NULL,
  day_from        INTEGER NOT NULL,
  day_to          INTEGER NOT NULL,
  nights          INTEGER NOT NULL DEFAULT 0,
  meal_breakfast  INTEGER NOT NULL DEFAULT 0,
  meal_lunch      INTEGER NOT NULL DEFAULT 0,
  meal_dinner     INTEGER NOT NULL DEFAULT 0,
  description     TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (tenant_id)      REFERENCES tenants(id),
  FOREIGN KEY (tour_id)        REFERENCES tours(id),
  FOREIGN KEY (destination_id) REFERENCES destinations(id)
);

-- =========================
-- SUPPLIERS
-- =========================

CREATE TABLE IF NOT EXISTS suppliers (
  id          TEXT    PRIMARY KEY,
  tenant_id   TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  type        TEXT    NOT NULL,
  contact     TEXT,
  notes       TEXT,
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
