-- Migration 0018: Site Studio foundation
-- Purpose: Enable per-tenant No-code site customisation (Site Studio module).
--          Tenants can claim a platform subdomain, select a base HTML template,
--          and configure visual/content overrides via a structured JSON blob.
--
-- ⚠ Additive only — no existing columns or tables are modified.
-- NOTE: custom_domain already exists from migration 0013. Not re-added here.
--
-- New tenant columns:
--   subdomain    — platform subdomain  (e.g. "myagency" → myagency.tourplatform.vn)
--   template_id  — FK (soft) to site_templates.id
--   site_config  — JSON blob with brand / content / features / custom_selectors
--
-- New table:
--   site_templates — catalog of base HTML/CSS templates stored in R2.
--
-- R2 key convention for templates (bucket: SITE_TEMPLATES):
--   templates/[template_id]/index.html   — base page layout
--   templates/[template_id]/style.css    — base stylesheet
--   templates/[template_id]/thumb.webp   — preview thumbnail shown in UI
--
-- site_config JSON schema:
-- {
--   "brand": {
--     "name":          "My Agency",
--     "logo_url":      "https://r2.example.com/logos/ten-xxx.png",
--     "primary_color": "#2563eb"
--   },
--   "content": {
--     "hero_title":    "Discover Vietnam with us",
--     "hero_desc":     "Handcrafted tours from local experts.",
--     "contact_phone": "+84 901 234 567"
--   },
--   "features": {
--     "whatsapp_toggle":      true,
--     "review_toggle":        true,
--     "hotel_module_active":  false
--   },
--   "custom_selectors": {
--     ".hero-title":  "Custom hero override text",
--     "#logo-img":    "https://cdn.example.com/new-logo.png"
--   }
-- }
--
-- [SEC] site_config is tenant-writable. Sanitise all selector keys server-side
--       before using them to substitute content in rendered HTML — prevent XSS.

-- ─────────────────────────────────────────
-- TENANTS: add subdomain column
-- ─────────────────────────────────────────
-- Platform subdomain this tenant has claimed.
-- e.g. "myagency" → routed to /api/sites/myagency or myagency.tourplatform.vn
-- Must be lowercase alphanumeric + hyphens. Null = not yet claimed.
ALTER TABLE tenants ADD COLUMN subdomain TEXT;

-- The base HTML template this tenant is using.
-- Soft FK to site_templates.id. Null = using system default.
ALTER TABLE tenants ADD COLUMN template_id TEXT;

-- No-code customisation overrides (JSON).
-- See schema comment above. Null = all defaults from template apply.
ALTER TABLE tenants ADD COLUMN site_config TEXT;

-- Unique partial index: each subdomain belongs to exactly one tenant.
-- NULL subdomains are excluded so unclaimed tenants don't conflict.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_subdomain
  ON tenants (subdomain)
  WHERE subdomain IS NOT NULL;

-- Index for fast template → tenant lookup (e.g. "all tenants on this template")
CREATE INDEX IF NOT EXISTS idx_tenants_template_id
  ON tenants (template_id)
  WHERE template_id IS NOT NULL;

-- ─────────────────────────────────────────
-- SITE_TEMPLATES: base template catalog
-- ─────────────────────────────────────────
-- Describes each HTML/CSS template available to tenants.
-- The actual files live in R2 under the SITE_TEMPLATES bucket.
-- R2 prefix format: "templates/[id]/"
--
-- Fields:
--   id            — e.g. "tmpl-minimal-v1", "tmpl-bold-v2"
--   name          — display name shown in Site Studio UI
--   description   — short description for the template picker
--   thumbnail_url — public URL of the preview image
--   r2_prefix     — key prefix in SITE_TEMPLATES bucket (e.g. "templates/tmpl-minimal-v1")
--   is_active     — 0 = hidden from tenant template picker (deprecated/WIP)
--   sort_order    — display order in picker (lower = first)
--   created_at    — unix epoch seconds
CREATE TABLE IF NOT EXISTS site_templates (
  id            TEXT    PRIMARY KEY,
  name          TEXT    NOT NULL,
  description   TEXT,
  thumbnail_url TEXT,
  r2_prefix     TEXT    NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

-- Seed the first two built-in templates so tenants can pick on day 1.
-- Actual HTML/CSS files are uploaded to R2 separately via wrangler r2 or CI.
INSERT OR IGNORE INTO site_templates (id, name, description, thumbnail_url, r2_prefix, is_active, sort_order, created_at)
VALUES
  (
    'tmpl-minimal-v1',
    'Minimal',
    'Clean, white-space-heavy layout. Ideal for premium tour brands.',
    NULL,
    'templates/tmpl-minimal-v1',
    1,
    10,
    strftime('%s', 'now')
  ),
  (
    'tmpl-bold-v1',
    'Bold',
    'High-contrast hero image with strong CTA. Best for adventure tours.',
    NULL,
    'templates/tmpl-bold-v1',
    1,
    20,
    strftime('%s', 'now')
  );
