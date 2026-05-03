ALTER TABLE tenant_universal_hotels
  ADD COLUMN property_id TEXT;

CREATE INDEX IF NOT EXISTS idx_tenant_universal_hotels_property
  ON tenant_universal_hotels (tenant_id, property_id, status, sort_order, created_at);