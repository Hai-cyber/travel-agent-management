CREATE TABLE IF NOT EXISTS tenant_universal_sites (
  tenant_id TEXT PRIMARY KEY,
  group_key TEXT NOT NULL,
  variant_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  site_name TEXT NOT NULL,
  default_lang TEXT NOT NULL DEFAULT 'en',
  home_page_key TEXT NOT NULL DEFAULT 'home',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_universal_theme_tokens (
  tenant_id TEXT PRIMARY KEY,
  tokens_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_universal_contacts (
  tenant_id TEXT PRIMARY KEY,
  channels_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_universal_pages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  page_key TEXT NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  page_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  visible INTEGER NOT NULL DEFAULT 1,
  blocks_json TEXT NOT NULL DEFAULT '[]',
  seo_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (tenant_id, page_key),
  UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_tenant_universal_pages_tenant
  ON tenant_universal_pages (tenant_id, page_type, visible);

CREATE TABLE IF NOT EXISTS tenant_universal_menu_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  label TEXT NOT NULL,
  href TEXT NOT NULL,
  page_key TEXT,
  target TEXT NOT NULL DEFAULT '_self',
  is_external INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (tenant_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_tenant_universal_menu_items_tenant
  ON tenant_universal_menu_items (tenant_id, visible, sort_order);

CREATE TABLE IF NOT EXISTS tenant_universal_tour_pages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  tour_id TEXT NOT NULL,
  page_key TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  booking_cta_label TEXT NOT NULL DEFAULT 'I like this tour',
  content_override_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (tenant_id, tour_id),
  UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_tenant_universal_tour_pages_tenant
  ON tenant_universal_tour_pages (tenant_id, status);