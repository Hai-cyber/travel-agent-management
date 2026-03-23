-- CHK-406 follow-up
-- Destination-level service blueprint (toggle-only setup in admin shell).

ALTER TABLE destinations ADD COLUMN service_blueprint_json TEXT;
