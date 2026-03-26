-- Migration 0019: Tour Categories
-- Purpose: Allow tenants to organise tours into named categories
--          (e.g. "Beach Tours", "Culture Tours") for homepage layout control
--          and future filtering / SEO URL generation.
--
-- ⚠ Additive only — no existing columns or tables are modified.
--
-- Changes:
--   1. New table  tour_categories  — per-tenant category catalog
--   2. ALTER TABLE tours           — add nullable category_id (soft FK)
--
-- homepage_layout in site_config (no migration required — JSON field):
--   Agents pick which category slugs appear on the homepage and in what order.
--   Schema extension to site_config.content:
--   {
--     "content": {
--       ...,
--       "homepage_layout": ["culture-tours", "beach-tours", "adventure-tours"]
--     }
--   }
--   inject.js consumes this array to reorder / filter category sections client-side.
--   The HTMLRewriter pipeline can also use it server-side to render only chosen
--   categories into the static template.
--
-- Slug rules (enforced at application layer):
--   - Lowercase a-z, digits, hyphens only
--   - Max 100 characters
--   - Unique per tenant
--
-- [SEC] EVERY query on tour_categories must include WHERE tenant_id = ?
--       to prevent cross-tenant data leakage.

-- ─────────────────────────────────────────────────────────────
-- TOUR CATEGORIES
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tour_categories (
  id         TEXT    PRIMARY KEY,             -- nanoid
  tenant_id  TEXT    NOT NULL,
  name       TEXT    NOT NULL,                -- display name, e.g. "Beach Tours"
  slug       TEXT    NOT NULL,                -- URL-safe, e.g. "beach-tours"
  sort_order INTEGER NOT NULL DEFAULT 0,      -- lower = shown first
  is_active  INTEGER NOT NULL DEFAULT 1,      -- 0 = hidden from all surfaces
  created_at INTEGER NOT NULL,

  UNIQUE (tenant_id, slug),
  FOREIGN KEY (tenant_id) REFERENCES tenants (id)
);

-- Fast listing in sort order for a given tenant
CREATE INDEX IF NOT EXISTS idx_tour_categories_tenant_sort
  ON tour_categories (tenant_id, sort_order);

-- ─────────────────────────────────────────────────────────────
-- TOURS: add category_id
-- ─────────────────────────────────────────────────────────────
-- Soft FK to tour_categories.id.  NULL = uncategorised.
-- No FOREIGN KEY constraint — categories may be deleted independently
-- of their tours (orphaned tours simply become uncategorised).
ALTER TABLE tours ADD COLUMN category_id TEXT;

-- Index: fast lookup of all tours in a category (listing page, homepage widget)
CREATE INDEX IF NOT EXISTS idx_tours_category_id
  ON tours (tenant_id, category_id)
  WHERE category_id IS NOT NULL;
