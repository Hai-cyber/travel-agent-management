-- CHK-404 strategy pivot follow-up
-- Persist GrapesJS-style hosted site layouts per tenant.

CREATE TABLE IF NOT EXISTS tenant_site_layouts (
	tenant_id TEXT PRIMARY KEY,
	template_engine TEXT NOT NULL DEFAULT 'grapesjs',
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
	html TEXT NOT NULL,
	css TEXT NOT NULL,
	project_json TEXT,
	updated_at INTEGER NOT NULL,
	published_at INTEGER
);
