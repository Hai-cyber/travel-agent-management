-- CHK-406 follow-up
-- Add structured pricing tiers for season+pax based auto quote.

ALTER TABLE booking_settings ADD COLUMN pricing_tiers_json TEXT;
