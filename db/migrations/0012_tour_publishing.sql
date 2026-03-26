-- 0012_tour_publishing.sql
-- Adds Headless Publishing support columns to the tours table.
-- D1 (SQLite) supports only additive ALTER TABLE; one statement per column.

-- URL-friendly slug for published pages (e.g. "ha-noi-ha-long-3n2d")
ALTER TABLE tours ADD COLUMN slug TEXT;

-- JSON blob: tour_name, tour_code, itinerary[], base_price, highlights[], includes[], excludes[]
ALTER TABLE tours ADD COLUMN content_data TEXT;

-- R2 template identifier (maps to templates/{template_id}.html in the TOUR_PAGES bucket)
ALTER TABLE tours ADD COLUMN template_id TEXT NOT NULL DEFAULT 'default';

-- UNIX timestamp of the last successful publish to R2
ALTER TABLE tours ADD COLUMN published_at INTEGER;

-- R2 object key of the published page — e.g.  "T001/ha-noi-ha-long-3n2d.html"
ALTER TABLE tours ADD COLUMN published_url TEXT;

-- Partial unique index: enforce (tenant_id, slug) uniqueness only for non-NULL slugs
CREATE UNIQUE INDEX IF NOT EXISTS idx_tours_tenant_slug
  ON tours (tenant_id, slug)
  WHERE slug IS NOT NULL;
