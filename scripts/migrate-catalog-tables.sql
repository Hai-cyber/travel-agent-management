-- Catalog: standalone destination records owned at tenant level
CREATE TABLE IF NOT EXISTS tenant_destinations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  region TEXT DEFAULT '',
  gallery_json TEXT DEFAULT '[]',
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tenant_destinations_tenant ON tenant_destinations (tenant_id);

-- Junction: link tours → destinations (ordered)
CREATE TABLE IF NOT EXISTS tour_destination_links (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  tour_id TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tour_destination_links_tour ON tour_destination_links (tour_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_tour_destination_links_dest ON tour_destination_links (destination_id);

-- Junction: link tours → hotels (ordered, with nights)
CREATE TABLE IF NOT EXISTS tour_hotel_links (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  tour_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  nights INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tour_hotel_links_tour ON tour_hotel_links (tour_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_tour_hotel_links_hotel ON tour_hotel_links (hotel_id);
