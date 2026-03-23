-- CHK-404
-- Tenant site studio configuration and multilingual public-site content.

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
