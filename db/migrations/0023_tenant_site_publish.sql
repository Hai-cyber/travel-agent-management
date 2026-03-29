-- Migration 0023: Tenant-level site publish tracking
-- Purpose: Track which template is currently LIVE vs. which is staged in the sandbox,
--          and when the site was last published.
--
-- Context:
--   tenants.template_id          — the active/sandbox template (set by Site Studio).
--   tenants.published_template_id — the template that is currently LIVE (set on publish-site).
--   tenants.site_published_at     — Unix epoch of the last successful site publish.
--
-- Rules (enforced by POST /api/tenant/publish-site):
--   1. subscription_status must be 'ACTIVE'.
--   2. If published_template_id IS NOT NULL AND template_id != published_template_id,
--      a SWITCH_FEE audit row (action = 'SWITCH_FEE') must exist in tenant_audit_log
--      with created_at > site_published_at (fee recorded AFTER last publish).
--   3. On success: sandbox/{tenantId}/ → live/{tenantId}/ in TOUR_PAGES R2.
--
-- ⚠ Additive only — no existing columns or data are modified.

ALTER TABLE tenants ADD COLUMN published_template_id TEXT;
ALTER TABLE tenants ADD COLUMN site_published_at      INTEGER;
