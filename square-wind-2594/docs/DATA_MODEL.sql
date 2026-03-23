-- Data Model (Canonical Schema v1)
-- CHK-101
-- Source: synced from db/migrations/0001_schema_v1.sql

-- =========================
-- SCHEMA (minimum)
-- =========================

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

CREATE TABLE IF NOT EXISTS suppliers (
	id TEXT PRIMARY KEY,
	tenant_id TEXT NOT NULL,
	name TEXT NOT NULL,
	type TEXT NOT NULL,
	contact TEXT,
	notes TEXT,
	created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_domain_configs (
	tenant_id TEXT PRIMARY KEY,
	hostname TEXT UNIQUE,
	status TEXT NOT NULL CHECK (status IN ('no_domain', 'pending', 'verified')) DEFAULT 'no_domain',
	verification_record_type TEXT NOT NULL DEFAULT 'TXT',
	verification_record_name TEXT,
	verification_record_value TEXT,
	verified_at INTEGER,
	updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_publish_configs (
	tenant_id TEXT PRIMARY KEY,
	payment_method_added INTEGER NOT NULL DEFAULT 0,
	terms_accepted INTEGER NOT NULL DEFAULT 0,
	commission_agreement_accepted INTEGER NOT NULL DEFAULT 0,
	updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_billing_configs (
	tenant_id TEXT PRIMARY KEY,
	trial_started_at INTEGER NOT NULL,
	trial_ends_at INTEGER NOT NULL,
	subscription_status TEXT NOT NULL CHECK (subscription_status IN ('trialing', 'active', 'unpaid')) DEFAULT 'trialing',
	updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_site_configs (
	tenant_id TEXT PRIMARY KEY,
	theme TEXT NOT NULL,
	primary_color TEXT NOT NULL,
	font_family TEXT NOT NULL,
	header_title TEXT NOT NULL,
	footer_text TEXT,
	contact_email TEXT,
	contact_phone TEXT,
	whatsapp_url TEXT,
	default_public_lang TEXT NOT NULL DEFAULT 'vi',
	search_enabled INTEGER NOT NULL DEFAULT 1,
	updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_site_pages (
	id TEXT PRIMARY KEY,
	tenant_id TEXT NOT NULL,
	page_key TEXT NOT NULL CHECK (page_key IN ('terms', 'privacy', 'impressum')),
	lang TEXT NOT NULL,
	title TEXT NOT NULL,
	content TEXT NOT NULL,
	updated_at INTEGER NOT NULL,
	UNIQUE (tenant_id, page_key, lang)
);

CREATE TABLE IF NOT EXISTS tour_public_contents (
	id TEXT PRIMARY KEY,
	tenant_id TEXT NOT NULL,
	tour_id TEXT NOT NULL,
	lang TEXT NOT NULL,
	headline TEXT,
	summary TEXT,
	body TEXT,
	updated_at INTEGER NOT NULL,
	UNIQUE (tenant_id, tour_id, lang)
);

CREATE TABLE IF NOT EXISTS tenant_growth_configs (
	tenant_id TEXT PRIMARY KEY,
	google_analytics_id TEXT,
	facebook_pixel_id TEXT,
	tripadvisor_url TEXT,
	google_reviews_url TEXT,
	whatsapp_url TEXT,
	call_phone TEXT,
	contact_email TEXT,
	trust_badges_json TEXT,
	updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tour_growth_slugs (
	tenant_id TEXT NOT NULL,
	tour_id TEXT NOT NULL,
	slug TEXT NOT NULL,
	updated_at INTEGER NOT NULL,
	PRIMARY KEY (tenant_id, tour_id),
	UNIQUE (tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS tour_growth_seo_metas (
	id TEXT PRIMARY KEY,
	tenant_id TEXT NOT NULL,
	tour_id TEXT NOT NULL,
	lang TEXT NOT NULL,
	meta_title TEXT,
	meta_description TEXT,
	keywords TEXT,
	og_title TEXT,
	og_description TEXT,
	og_image TEXT,
	snippet_template TEXT,
	updated_at INTEGER NOT NULL,
	UNIQUE (tenant_id, tour_id, lang)
);

CREATE TABLE IF NOT EXISTS growth_leads (
	id TEXT PRIMARY KEY,
	tenant_id TEXT NOT NULL,
	tour_id TEXT,
	channel TEXT NOT NULL CHECK (channel IN ('contact_form', 'whatsapp', 'call')),
	name TEXT,
	email TEXT,
	phone TEXT,
	message TEXT NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS growth_events (
	id TEXT PRIMARY KEY,
	tenant_id TEXT NOT NULL,
	tour_id TEXT,
	event_name TEXT NOT NULL CHECK (event_name IN ('view_tour', 'click_contact', 'submit_booking')),
	channel TEXT,
	metadata_json TEXT,
	created_at INTEGER NOT NULL
);

-- Service groups per destination
CREATE TABLE IF NOT EXISTS dest_accommodations (
	id TEXT PRIMARY KEY,
	tenant_id TEXT NOT NULL,
	destination_id TEXT NOT NULL,
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
	position INTEGER NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dest_meals (
	id TEXT PRIMARY KEY,
	tenant_id TEXT NOT NULL,
	destination_id TEXT NOT NULL,
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
	position INTEGER NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dest_guides (
	id TEXT PRIMARY KEY,
	tenant_id TEXT NOT NULL,
	destination_id TEXT NOT NULL,
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
	position INTEGER NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dest_local_transports (
	id TEXT PRIMARY KEY,
	tenant_id TEXT NOT NULL,
	destination_id TEXT NOT NULL,
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
	position INTEGER NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dest_intercity_legs (
	id TEXT PRIMARY KEY,
	tenant_id TEXT NOT NULL,
	destination_id TEXT NOT NULL,
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