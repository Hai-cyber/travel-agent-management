-- Migration 0027: Add tenant_pages table for the Site Studio "Add Page" feature
--
-- Each tenant can create custom pages (About, Policy, Contact, FAQ, etc.)
-- that are rendered from a blank template and stored in R2 at:
--   sandbox/{tenantId}/pages/{slug}.html
-- and promoted to:
--   live/{tenantId}/pages/{slug}.html
-- during publish-site.
--
-- template_type values (enforced at application layer):
--   'generic'  — blank free-form page (from templates/common/generic.html)
--   'policy'   — terms / privacy stub
--
-- status values:
--   'draft'      — saved in sandbox, not yet published
--   'published'  — promoted to live/{tenantId}/pages/{slug}.html

CREATE TABLE IF NOT EXISTS tenant_pages (
  id           TEXT    NOT NULL PRIMARY KEY,
  tenant_id    TEXT    NOT NULL REFERENCES tenants(id),
  slug         TEXT    NOT NULL,
  title        TEXT    NOT NULL,
  content_html TEXT    NOT NULL DEFAULT '',
  template_type TEXT   NOT NULL DEFAULT 'generic',
  status       TEXT    NOT NULL DEFAULT 'draft',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  -- Slugs must be unique per tenant
  UNIQUE(tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_tenant_pages_tenant_id
  ON tenant_pages(tenant_id);

CREATE INDEX IF NOT EXISTS idx_tenant_pages_status
  ON tenant_pages(tenant_id, status);
