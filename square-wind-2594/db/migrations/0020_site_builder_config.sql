-- CHK-404 follow-up
-- Persist builder template, blocks, and utilities in tenant site config.

ALTER TABLE tenant_site_configs ADD COLUMN builder_template TEXT;
ALTER TABLE tenant_site_configs ADD COLUMN builder_blocks_json TEXT;
ALTER TABLE tenant_site_configs ADD COLUMN builder_utilities_json TEXT;
