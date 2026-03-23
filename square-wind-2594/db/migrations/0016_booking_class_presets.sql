-- CHK-406 follow-up
-- Dynamic class presets (add/delete) for booking settings.

ALTER TABLE booking_settings ADD COLUMN class_presets_json TEXT;
