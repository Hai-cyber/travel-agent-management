CREATE TABLE IF NOT EXISTS tenant_universal_hotels (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  hotel_key TEXT NOT NULL,
  tour_id TEXT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  gallery_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (tenant_id, hotel_key),
  UNIQUE (tenant_id, tour_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_universal_hotels_tenant
  ON tenant_universal_hotels (tenant_id, status, sort_order, created_at);
