-- Migration 0102: allow allotments to carry a planner-only pricing profile

ALTER TABLE property_allotments
  ADD COLUMN pricing_profile_id TEXT;

CREATE INDEX IF NOT EXISTS idx_property_allotments_pricing_profile
  ON property_allotments (tenant_id, property_id, pricing_profile_id, status, check_in, check_out);