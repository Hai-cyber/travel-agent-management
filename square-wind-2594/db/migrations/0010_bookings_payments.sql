-- CHK-406
-- Traveler bookings and demo payment tables.

CREATE TABLE IF NOT EXISTS bookings (
	id TEXT PRIMARY KEY,
	tenant_id TEXT NOT NULL,
	tour_id TEXT NOT NULL,
	traveler_name TEXT NOT NULL,
	traveler_email TEXT,
	traveler_phone TEXT,
	pax INTEGER NOT NULL DEFAULT 1,
	message TEXT,
	status TEXT NOT NULL DEFAULT 'pending'
		CHECK (status IN ('pending', 'confirmed', 'rejected', 'completed', 'cancelled')),
	payment_status TEXT NOT NULL DEFAULT 'unpaid'
		CHECK (payment_status IN ('unpaid', 'paid')),
	payment_amount INTEGER,
	payment_currency TEXT NOT NULL DEFAULT 'VND',
	created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS demo_payments (
	id TEXT PRIMARY KEY,
	tenant_id TEXT NOT NULL,
	booking_id TEXT NOT NULL,
	amount INTEGER NOT NULL,
	currency TEXT NOT NULL DEFAULT 'VND',
	card_last4 TEXT,
	status TEXT NOT NULL DEFAULT 'paid',
	paid_at INTEGER NOT NULL
);
