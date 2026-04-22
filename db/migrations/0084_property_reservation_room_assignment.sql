-- Migration 0084: Persist room assignment on property reservations
--
-- Purpose:
--   - remove room-rack ambiguity for same-type room units
--   - persist the currently assigned room unit on the reservation itself

ALTER TABLE property_reservations
  ADD COLUMN assigned_room_unit_id TEXT REFERENCES room_units(id);

CREATE INDEX IF NOT EXISTS idx_property_reservations_assigned_room_unit
  ON property_reservations (tenant_id, property_id, assigned_room_unit_id, status);