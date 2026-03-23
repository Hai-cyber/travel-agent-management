-- CHK-209 supplier system baseline

CREATE TABLE IF NOT EXISTS suppliers (
	id TEXT PRIMARY KEY,
	tenant_id TEXT NOT NULL,
	name TEXT NOT NULL,
	type TEXT NOT NULL,
	contact TEXT,
	notes TEXT,
	created_at INTEGER NOT NULL
);

ALTER TABLE dest_accommodations ADD COLUMN supplier_id TEXT;
ALTER TABLE dest_meals ADD COLUMN supplier_id TEXT;
ALTER TABLE dest_guides ADD COLUMN supplier_id TEXT;
ALTER TABLE dest_local_transports ADD COLUMN supplier_id TEXT;
ALTER TABLE dest_intercity_legs ADD COLUMN supplier_id TEXT;
