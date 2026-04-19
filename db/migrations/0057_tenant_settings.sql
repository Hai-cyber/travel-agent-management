-- Migration 0057: Shared tenant settings
--
-- Purpose:
--   - add tenant-scoped key/value JSON settings for shared-kernel policy/config
--   - avoid overloading app_settings (platform-owned) with tenant-specific values
--
-- Notes:
--   - use for shared policy/config patterns only
--   - do not use this table as a substitute for canonical domain tables

CREATE TABLE IF NOT EXISTS tenant_settings (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT    NOT NULL,
  setting_key TEXT    NOT NULL,
  value_json  TEXT    NOT NULL,
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  UNIQUE (tenant_id, setting_key)
);

CREATE INDEX IF NOT EXISTS idx_tenant_settings_tenant
  ON tenant_settings (tenant_id);
