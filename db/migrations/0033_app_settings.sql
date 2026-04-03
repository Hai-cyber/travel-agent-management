-- 0033_app_settings.sql
-- Platform-level key/value JSON settings for SaaS-owned surfaces.

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);