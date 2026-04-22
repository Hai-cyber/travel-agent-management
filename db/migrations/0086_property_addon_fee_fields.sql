-- Migration 0086: Property addon fee fields
--
-- Purpose:
--   - let tenants configure dedicated early-arrival and late-checkout fee amounts on addon presets
--   - expose these fees as first-class property pricing inputs instead of burying them in config_json

ALTER TABLE property_addon_service_presets
  ADD COLUMN early_arrival_fee REAL NOT NULL DEFAULT 0;

ALTER TABLE property_addon_service_presets
  ADD COLUMN late_checkout_fee REAL NOT NULL DEFAULT 0;