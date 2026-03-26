-- Migration 0017: Add secure_token to booking_orders for Guest Portal access
--
-- Purpose: Guest receives a one-time secure URL after creating an order.
-- They use it to view their booking status and upload proof of payment —
-- no account or X-Tenant-ID header required.
--
-- Design:
--   - nanoid(32) generated at INSERT time in application layer
--   - Partial UNIQUE index: WHERE secure_token IS NOT NULL
--     (safe for rows created before this migration or in legacy tests)
--   - GET /api/bookings/public/:secure_token — guest view
--   - POST /api/bookings/public/:secure_token/proof — guest proof upload

ALTER TABLE booking_orders ADD COLUMN secure_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_orders_token
  ON booking_orders (secure_token)
  WHERE secure_token IS NOT NULL;
