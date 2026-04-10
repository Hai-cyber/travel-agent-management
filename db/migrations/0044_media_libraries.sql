-- Named photo libraries (reusable across tours)
CREATE TABLE IF NOT EXISTS tenant_media_libraries (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  cover_image TEXT NOT NULL DEFAULT '',
  items_json  TEXT NOT NULL DEFAULT '[]',
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tenant_media_libraries_tenant
  ON tenant_media_libraries (tenant_id, status, sort_order);

-- Junction: link tours to media libraries (ordered)
CREATE TABLE IF NOT EXISTS tour_media_library_links (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  tour_id      TEXT NOT NULL,
  library_id   TEXT NOT NULL,
  section_hint TEXT NOT NULL DEFAULT '',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tour_media_library_links_tour
  ON tour_media_library_links (tour_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_tour_media_library_links_lib
  ON tour_media_library_links (library_id);
