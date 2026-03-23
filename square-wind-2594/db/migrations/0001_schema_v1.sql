-- Canonical Migration Schema v1
-- CHK-101
-- Nguon: dong bo tu docs/DATA_MODEL.sql

-- Tenancy & users
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  hash TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','manager','staff','provider')),
  PRIMARY KEY (user_id, tenant_id)
);

-- Tours
CREATE TABLE IF NOT EXISTS tours (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  title TEXT NOT NULL,
  lang TEXT DEFAULT 'vi',
  start_date INTEGER,
  duration_text TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft','on_sale','booked','completed','archived')) DEFAULT 'draft',
  created_at INTEGER NOT NULL
);

-- Destinations
CREATE TABLE IF NOT EXISTS destinations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  tour_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  nights INTEGER NOT NULL DEFAULT 0,
  arrival_date INTEGER,
  departure_date INTEGER,
  created_at INTEGER NOT NULL
);

-- Destination text
CREATE TABLE IF NOT EXISTS destination_texts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  summary TEXT,
  details TEXT,
  notes TEXT,
  lang TEXT DEFAULT 'vi',
  updated_at INTEGER NOT NULL
);

-- Service groups per destination
CREATE TABLE IF NOT EXISTS dest_accommodations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  hotel_name TEXT NOT NULL,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  check_in INTEGER,
  check_out INTEGER,
  room_type TEXT,
  guests INTEGER,
  notes TEXT,
  status TEXT NOT NULL CHECK (status IN ('planned','booked','confirmed','canceled')) DEFAULT 'planned',
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dest_meals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  meal_type TEXT NOT NULL,
  restaurant_name TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  meal_datetime INTEGER,
  notes TEXT,
  status TEXT NOT NULL CHECK (status IN ('planned','booked','confirmed','canceled')) DEFAULT 'planned',
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dest_guides (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  guide_name TEXT,
  phone TEXT,
  email TEXT,
  languages TEXT,
  time_from INTEGER,
  time_to INTEGER,
  notes TEXT,
  status TEXT NOT NULL CHECK (status IN ('planned','booked','confirmed','canceled')) DEFAULT 'planned',
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dest_local_transports (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  supplier TEXT,
  driver_name TEXT,
  phone TEXT,
  email TEXT,
  pickup_time INTEGER,
  pickup_place TEXT,
  dropoff_place TEXT,
  notes TEXT,
  status TEXT NOT NULL CHECK (status IN ('planned','booked','confirmed','canceled')) DEFAULT 'planned',
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dest_intercity_legs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  supplier TEXT,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  depart_time INTEGER,
  depart_point TEXT,
  arrive_point TEXT,
  ticket_ref TEXT,
  notes TEXT,
  status TEXT NOT NULL CHECK (status IN ('planned','booked','confirmed','canceled')) DEFAULT 'planned',
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Pricing & policy
CREATE TABLE IF NOT EXISTS tour_prices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  tour_id TEXT NOT NULL,
  season TEXT,
  pax_from INTEGER,
  pax_to INTEGER,
  adult_price REAL,
  child_price REAL,
  infant_price REAL,
  single_supp REAL,
  weekend_surcharge REAL,
  currency TEXT DEFAULT 'VND',
  effective_from INTEGER,
  effective_to INTEGER
);

CREATE TABLE IF NOT EXISTS tour_policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  tour_id TEXT NOT NULL,
  deposit_pct REAL,
  pay_deadline_days INTEGER,
  cancel_terms_text TEXT
);

-- Visual / presentation
CREATE TABLE IF NOT EXISTS tour_visuals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  tour_id TEXT NOT NULL,
  intro_text TEXT,
  terms_text TEXT,
  faq_text TEXT,
  theme TEXT,
  primary_color TEXT,
  font TEXT,
  hero_url TEXT
);

CREATE TABLE IF NOT EXISTS tour_media (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  tour_id TEXT NOT NULL,
  url TEXT NOT NULL,
  caption TEXT,
  position INTEGER NOT NULL,
  for_destination_id TEXT
);

-- Threads & messages
CREATE TABLE IF NOT EXISTS comm_threads (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comm_messages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  direction TEXT NOT NULL,
  subject TEXT,
  body TEXT,
  to_addr TEXT,
  from_addr TEXT,
  attachments_json TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL
);

-- Tasks
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  booking_id TEXT,
  service_entity_type TEXT,
  service_entity_id TEXT,
  title TEXT NOT NULL,
  due_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','completed','canceled')) DEFAULT 'pending',
  last_notice_at INTEGER
);
