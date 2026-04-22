-- Migration 0089: Dashboard D1 hot-path indexes
--
-- Purpose:
--   - reduce tenant-scoped newest-first scans on dashboard startup
--   - tighten review-status category filtering
--   - support universal site bundle ordering by updated_at

CREATE INDEX IF NOT EXISTS idx_tours_tenant_created_at
  ON tours (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_orders_tenant_created_at
  ON booking_orders (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_review_cases_tenant_category_status_created
  ON tenant_review_cases (tenant_id, category, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_universal_tour_pages_tenant_updated_at
  ON tenant_universal_tour_pages (tenant_id, updated_at DESC);