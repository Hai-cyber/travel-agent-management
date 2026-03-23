-- CHK-406 follow-up
-- Add class definition text for traveler pricing configuration.

ALTER TABLE booking_settings ADD COLUMN class_descriptions_json TEXT;
