-- Migration 0036: taxonomy-first discovery foundation

CREATE TABLE IF NOT EXISTS tenant_tour_discovery_profiles (
  tenant_id TEXT NOT NULL,
  tour_id TEXT NOT NULL,
  primary_interest_key TEXT,
  toggles_json TEXT NOT NULL DEFAULT '{}',
  scores_json TEXT NOT NULL DEFAULT '{}',
  ranking_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, tour_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (tour_id) REFERENCES tours(id)
);

CREATE INDEX IF NOT EXISTS idx_tour_discovery_profiles_tenant_primary
  ON tenant_tour_discovery_profiles (tenant_id, primary_interest_key, updated_at);

CREATE TABLE IF NOT EXISTS tenant_tour_interest_tags (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  tour_id TEXT NOT NULL,
  interest_key TEXT NOT NULL,
  tag_level TEXT NOT NULL DEFAULT 'top_level',
  source TEXT NOT NULL DEFAULT 'manual',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (tenant_id, tour_id, interest_key),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (tour_id) REFERENCES tours(id)
);

CREATE INDEX IF NOT EXISTS idx_tour_interest_tags_tenant_interest
  ON tenant_tour_interest_tags (tenant_id, interest_key, updated_at);

CREATE INDEX IF NOT EXISTS idx_tour_interest_tags_tenant_tour
  ON tenant_tour_interest_tags (tenant_id, tour_id, updated_at);

CREATE TABLE IF NOT EXISTS tenant_destination_discovery_profiles (
  tenant_id TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  primary_interest_key TEXT,
  toggles_json TEXT NOT NULL DEFAULT '{}',
  scores_json TEXT NOT NULL DEFAULT '{}',
  ranking_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, destination_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (destination_id) REFERENCES destinations(id)
);

CREATE INDEX IF NOT EXISTS idx_destination_discovery_profiles_tenant_primary
  ON tenant_destination_discovery_profiles (tenant_id, primary_interest_key, updated_at);

CREATE TABLE IF NOT EXISTS tenant_destination_interest_tags (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  interest_key TEXT NOT NULL,
  tag_level TEXT NOT NULL DEFAULT 'top_level',
  source TEXT NOT NULL DEFAULT 'manual',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (tenant_id, destination_id, interest_key),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (destination_id) REFERENCES destinations(id)
);

CREATE INDEX IF NOT EXISTS idx_destination_interest_tags_tenant_interest
  ON tenant_destination_interest_tags (tenant_id, interest_key, updated_at);

CREATE INDEX IF NOT EXISTS idx_destination_interest_tags_tenant_destination
  ON tenant_destination_interest_tags (tenant_id, destination_id, updated_at);

CREATE TABLE IF NOT EXISTS tenant_universal_interest_pages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  interest_key TEXT NOT NULL,
  page_key TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  visible INTEGER NOT NULL DEFAULT 0,
  rules_json TEXT NOT NULL DEFAULT '{}',
  seo_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (tenant_id, interest_key),
  UNIQUE (tenant_id, page_key),
  UNIQUE (tenant_id, slug),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_universal_interest_pages_tenant_visible
  ON tenant_universal_interest_pages (tenant_id, visible, status, updated_at);
