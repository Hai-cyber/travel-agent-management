-- Migration 0087: Property reservation guest photos
--
-- Purpose:
--   - persist one primary guest photo reference per property reservation
--   - let the staff desk load photos from Worker-managed R2 storage instead of session-only memory

ALTER TABLE property_reservations
  ADD COLUMN guest_photo_key TEXT;

ALTER TABLE property_reservations
  ADD COLUMN guest_photo_uploaded_at INTEGER;