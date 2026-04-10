-- Add show_on_home flag to hotel catalog and destination catalog
-- Allows per-entry control over homepage section visibility
ALTER TABLE tenant_universal_hotels ADD COLUMN show_on_home INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenant_destinations ADD COLUMN show_on_home INTEGER NOT NULL DEFAULT 0;
