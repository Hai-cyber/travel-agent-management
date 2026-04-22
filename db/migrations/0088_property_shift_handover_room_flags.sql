-- Migration 0088: Property shift handover + room flags
--
-- Purpose:
--   - persist one current shift handover note per property for front-desk turnover
--   - persist lightweight per-room overlay flags for DND and room-service requests

ALTER TABLE properties
  ADD COLUMN shift_handover_note TEXT;

ALTER TABLE properties
  ADD COLUMN shift_handover_updated_at INTEGER;

ALTER TABLE properties
  ADD COLUMN shift_handover_updated_by TEXT;

ALTER TABLE room_units
  ADD COLUMN do_not_disturb INTEGER NOT NULL DEFAULT 0;

ALTER TABLE room_units
  ADD COLUMN room_service_requested INTEGER NOT NULL DEFAULT 0;