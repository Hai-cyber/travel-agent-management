-- Migration: 0052_booking_order_todos_service_fields.sql
-- Extend booking_order_todos with service-specific operational fields.
-- Enables rich todo cards seeded from service items (accommodations, meals,
-- guides, local-transports, intercity-legs) instead of generic tour_stops.
-- All existing rows keep their data; new columns default to NULL / 'pending'.

-- Service type / link back to origin service item
ALTER TABLE booking_order_todos ADD COLUMN service_type TEXT;
-- values: accommodation | meal | guide | local_transport | intercity_leg | custom

ALTER TABLE booking_order_todos ADD COLUMN service_item_id TEXT;
-- FK to stop_accommodations.id / stop_meals.id / etc. (all TEXT nanoids)

-- Operational status replacing binary done/done_at
ALTER TABLE booking_order_todos ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
-- values: pending | contacted | confirmed | cancelled | rebooked

-- Contact / responsibility fields (denormalized from service item at seed time)
ALTER TABLE booking_order_todos ADD COLUMN person_in_charge TEXT;
ALTER TABLE booking_order_todos ADD COLUMN contact_name      TEXT;
ALTER TABLE booking_order_todos ADD COLUMN contact_phone     TEXT;
ALTER TABLE booking_order_todos ADD COLUMN contact_email     TEXT;

-- Service-specific extra data (JSON) — hotel_name/check_in/check_out for hotel,
-- restaurant_name/meal_type/meal_datetime for meal, etc.
ALTER TABLE booking_order_todos ADD COLUMN service_meta_json TEXT;

-- Reminder tracking — unix seconds of last reminder sent for this todo
ALTER TABLE booking_order_todos ADD COLUMN last_reminded_at INTEGER;

-- Index to help reminder cron queries
CREATE INDEX IF NOT EXISTS idx_bot_status_order ON booking_order_todos(tenant_id, status, order_id);
