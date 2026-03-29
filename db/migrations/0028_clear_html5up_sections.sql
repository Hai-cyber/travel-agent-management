-- Migration 0028: Clear HTML5UP-era custom_sections from all tenants
--
-- HTML5UP templates used jQuery, Skel.js and template-specific CSS classes that
-- are 100% incompatible with Cruip Tailwind v4 templates.  Any persisted
-- custom_sections blocks from the HTML5UP era:
--   • reference css classes that do not exist in Cruip (→ broken layout)
--   • embed script tags for skel.min.js / jquery.scrolly which 404 in Cruip
--   • cause "vỡ trang" (broken page) and spurious 404 errors in the editor
--
-- This one-time migration resets every tenant's canvas to empty so they can
-- rebuild with Cruip-compatible blocks from the Site Studio Snippet library.
--
-- Preserved:
--   ✓ site_config.brand            — name, logo, primary_color
--   ✓ site_config.content          — hero_title, hero_desc, contact_phone
--   ✓ site_config.navigation       — nav links
--   ✓ site_config.features         — feature toggles
--
-- Cleared:
--   ✗ site_config.custom_sections  — reset to []
--
-- Only rows that actually have a non-empty custom_sections array are touched
-- (avoids unnecessary writes for tenants with no sections).

UPDATE tenants
   SET site_config = json_patch(COALESCE(site_config, '{}'), '{"custom_sections":[]}')
 WHERE COALESCE(
         json_array_length(json_extract(COALESCE(site_config, '{}'), '$.custom_sections')),
         0
       ) > 0;
