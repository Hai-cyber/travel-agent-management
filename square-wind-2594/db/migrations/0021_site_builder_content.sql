-- CHK-404 follow-up
-- Persist builder content models for public site rendering.

ALTER TABLE tenant_site_configs ADD COLUMN builder_content_json TEXT;
