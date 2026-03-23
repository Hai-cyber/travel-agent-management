-- CHK-406 follow-up
-- Tenant-configurable auto-confirm rules and traveler quote fields.

CREATE TABLE IF NOT EXISTS booking_settings (
	tenant_id TEXT PRIMARY KEY,
	auto_confirm_min_days INTEGER NOT NULL DEFAULT 30,
	auto_confirm_max_pax INTEGER NOT NULL DEFAULT 16,
	class_prices_json TEXT,
	single_room_supplement_json TEXT,
	child_discount_pct REAL NOT NULL DEFAULT 0.5,
	updated_at INTEGER NOT NULL
);

ALTER TABLE bookings ADD COLUMN child_count INTEGER;
ALTER TABLE bookings ADD COLUMN single_room_count INTEGER;
ALTER TABLE bookings ADD COLUMN tour_class TEXT;
ALTER TABLE bookings ADD COLUMN quoted_total REAL;
