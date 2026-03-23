-- CHK-405
-- Growth & SEO baseline for tenant-level distribution and lead capture.

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
