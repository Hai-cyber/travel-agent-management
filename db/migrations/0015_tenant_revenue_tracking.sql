-- Migration 0015: Tenant revenue tracking and commission threshold
-- Purpose: Platform-level SaaS metrics. Track how much gross booking revenue
--          each tenant has processed through the platform (for billing
--          reconciliation, tier upgrades, and commission gate logic).
--
-- total_revenue_tracked  REAL  — Running total of confirmed booking value (USD).
--                                Incremented at the application layer each time
--                                a booking_draft is converted to a confirmed booking.
--                                NULL = not yet initialised (treat as 0).
--
-- commission_threshold   REAL  — USD amount at which the platform charges commission,
--                                or at which a pricing tier upgrade is triggered.
--                                NULL = no threshold configured (flat subscription only).
--
-- [SEC] These columns are READ-ONLY from the tenant-facing settings API.
--       Only the platform billing pipeline (internal) may increment total_revenue_tracked.

ALTER TABLE tenants ADD COLUMN total_revenue_tracked REAL NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN commission_threshold  REAL;

-- Partial index: quickly find tenants who have crossed their commission threshold.
-- Used by the billing reconciliation job.
CREATE INDEX IF NOT EXISTS idx_tenants_commission_check
  ON tenants (total_revenue_tracked, commission_threshold)
  WHERE commission_threshold IS NOT NULL;
