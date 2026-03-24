-- 0003_add_stop_service_detail_tables.sql
-- Add canonical stop-based service detail tables
-- Rescue-safe, additive only
-- No drops, no destructive renames
-- All detail tables reference tour_stop_id

CREATE TABLE IF NOT EXISTS stop_accommodations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  tour_stop_id INTEGER NOT NULL,
  supplier_id TEXT,
  person_in_charge TEXT NOT NULL,
  hotel_name TEXT NOT NULL,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  address TEXT NOT NULL,
  check_in INTEGER,
  check_out INTEGER,
  room_type TEXT,
  guests INTEGER,
  notes TEXT,
  stage TEXT NOT NULL CHECK (stage IN ('contacted','pending','confirmed','canceled')) DEFAULT 'pending',
  communication_channels_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('planned','booked','confirmed','canceled')) DEFAULT 'planned',
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (tour_stop_id) REFERENCES tour_stops(id)
);

CREATE TABLE IF NOT EXISTS stop_meals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  tour_stop_id INTEGER NOT NULL,
  supplier_id TEXT,
  person_in_charge TEXT NOT NULL,
  meal_type TEXT NOT NULL,
  restaurant_name TEXT NOT NULL,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  address TEXT NOT NULL,
  meal_datetime INTEGER,
  notes TEXT,
  stage TEXT NOT NULL CHECK (stage IN ('contacted','pending','confirmed','canceled')) DEFAULT 'pending',
  communication_channels_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('planned','booked','confirmed','canceled')) DEFAULT 'planned',
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (tour_stop_id) REFERENCES tour_stops(id)
);

CREATE TABLE IF NOT EXISTS stop_guides (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  tour_stop_id INTEGER NOT NULL,
  supplier_id TEXT,
  person_in_charge TEXT NOT NULL,
  guide_name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT NOT NULL,
  languages TEXT,
  time_from INTEGER,
  time_to INTEGER,
  notes TEXT,
  stage TEXT NOT NULL CHECK (stage IN ('contacted','pending','confirmed','canceled')) DEFAULT 'pending',
  communication_channels_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('planned','booked','confirmed','canceled')) DEFAULT 'planned',
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (tour_stop_id) REFERENCES tour_stops(id)
);

CREATE TABLE IF NOT EXISTS stop_local_transports (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  tour_stop_id INTEGER NOT NULL,
  supplier_id TEXT,
  person_in_charge TEXT NOT NULL,
  mode TEXT NOT NULL,
  supplier TEXT NOT NULL,
  contact_name TEXT,
  driver_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT NOT NULL,
  pickup_time INTEGER,
  pickup_place TEXT,
  dropoff_place TEXT,
  notes TEXT,
  stage TEXT NOT NULL CHECK (stage IN ('contacted','pending','confirmed','canceled')) DEFAULT 'pending',
  communication_channels_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('planned','booked','confirmed','canceled')) DEFAULT 'planned',
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (tour_stop_id) REFERENCES tour_stops(id)
);

CREATE TABLE IF NOT EXISTS stop_intercity_legs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  tour_stop_id INTEGER NOT NULL,
  supplier_id TEXT,
  person_in_charge TEXT NOT NULL,
  mode TEXT NOT NULL,
  supplier TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT NOT NULL,
  depart_time INTEGER,
  depart_point TEXT,
  arrive_point TEXT,
  ticket_ref TEXT,
  notes TEXT,
  stage TEXT NOT NULL CHECK (stage IN ('contacted','pending','confirmed','canceled')) DEFAULT 'pending',
  communication_channels_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('planned','booked','confirmed','canceled')) DEFAULT 'planned',
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (tour_stop_id) REFERENCES tour_stops(id)
);

-- Suggested verification after apply:
-- SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
-- SELECT * FROM stop_accommodations;
-- SELECT * FROM stop_meals;
-- SELECT * FROM stop_guides;
-- SELECT * FROM stop_local_transports;
-- SELECT * FROM stop_intercity_legs;