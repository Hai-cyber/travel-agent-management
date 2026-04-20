-- Migration 0080: Add booking_source to booking_orders
-- Tracks which channel a booking originated from.
-- Used by Reports to show channel breakdown.
--
-- Values (not enforced by CHECK to allow forward-compat additions):
--   direct           -- booked via the tenant's own website
--   ota_booking_com  -- from Booking.com (email ingest)
--   ota_viator       -- from Viator (email ingest)
--   ota_agoda        -- from Agoda (email ingest)
--   ota_other        -- from another OTA (email ingest)
--   agent_forward    -- forwarded by a travel agent
--   social           -- from a social media lead (Instagram, Facebook, WhatsApp)
--   phone            -- phone or in-person booking entered manually
--   email_direct     -- guest emailed directly (not via OTA)
--   other            -- any other source

ALTER TABLE booking_orders ADD COLUMN booking_source TEXT;
