-- CHK-201 follow-up / operational service item fields
-- Add assignment, address, stage, and preferred communication channels

ALTER TABLE dest_accommodations ADD COLUMN person_in_charge TEXT;
ALTER TABLE dest_accommodations ADD COLUMN address TEXT;
ALTER TABLE dest_accommodations ADD COLUMN stage TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE dest_accommodations ADD COLUMN communication_channels_json TEXT;

ALTER TABLE dest_meals ADD COLUMN person_in_charge TEXT;
ALTER TABLE dest_meals ADD COLUMN address TEXT;
ALTER TABLE dest_meals ADD COLUMN stage TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE dest_meals ADD COLUMN communication_channels_json TEXT;

ALTER TABLE dest_guides ADD COLUMN person_in_charge TEXT;
ALTER TABLE dest_guides ADD COLUMN contact_name TEXT;
ALTER TABLE dest_guides ADD COLUMN address TEXT;
ALTER TABLE dest_guides ADD COLUMN stage TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE dest_guides ADD COLUMN communication_channels_json TEXT;

ALTER TABLE dest_local_transports ADD COLUMN person_in_charge TEXT;
ALTER TABLE dest_local_transports ADD COLUMN contact_name TEXT;
ALTER TABLE dest_local_transports ADD COLUMN address TEXT;
ALTER TABLE dest_local_transports ADD COLUMN stage TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE dest_local_transports ADD COLUMN communication_channels_json TEXT;

ALTER TABLE dest_intercity_legs ADD COLUMN person_in_charge TEXT;
ALTER TABLE dest_intercity_legs ADD COLUMN address TEXT;
ALTER TABLE dest_intercity_legs ADD COLUMN stage TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE dest_intercity_legs ADD COLUMN communication_channels_json TEXT;
