-- CHK-406 follow-up
-- Traveler selects desired departure date; enables payment-time auto-confirm rules.

ALTER TABLE bookings ADD COLUMN desired_departure_date INTEGER;
