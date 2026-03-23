-- CHK-406 follow-up
-- Tenant-level admin date/time display format.

ALTER TABLE booking_settings ADD COLUMN date_time_format TEXT;
