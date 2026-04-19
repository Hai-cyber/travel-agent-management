-- Migration 0075: Property addon service presets
--
-- Purpose:
--   - let each tenant preset commercial addon services per property
--   - keep addon catalog configuration separate from reservation runtime and folio posting

CREATE TABLE IF NOT EXISTS property_addon_service_presets (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT    NOT NULL,
  property_id         TEXT    NOT NULL,
  code                TEXT    NOT NULL,
  name                TEXT    NOT NULL,
  service_type        TEXT    NOT NULL,
  pricing_mode        TEXT    NOT NULL,
  currency            TEXT    NOT NULL,
  default_unit_price  REAL    NOT NULL DEFAULT 0,
  default_unit_label  TEXT,
  scope               TEXT    NOT NULL DEFAULT 'per_stay',
  active              INTEGER NOT NULL DEFAULT 1,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  notes               TEXT,
  config_json         TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (property_id) REFERENCES properties(id),
  UNIQUE (property_id, code)
);

CREATE INDEX IF NOT EXISTS idx_property_addon_service_presets_property
  ON property_addon_service_presets (tenant_id, property_id, active, sort_order, created_at DESC);