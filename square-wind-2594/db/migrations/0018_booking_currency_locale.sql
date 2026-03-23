-- CHK-406 follow-up
-- Currency and locale controls for traveler auto display.

ALTER TABLE booking_settings ADD COLUMN pricing_currency_mode TEXT;
ALTER TABLE booking_settings ADD COLUMN pricing_base_currency TEXT;
ALTER TABLE booking_settings ADD COLUMN usd_to_vnd_rate REAL;
