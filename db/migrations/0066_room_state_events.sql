-- Migration 0066: Room state events
--
-- Purpose:
--   - add operational room-state history for the property engine
--   - support readiness, occupancy, cleaning, and blocking transitions

CREATE TABLE IF NOT EXISTS room_state_events (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT    NOT NULL,
  property_id    TEXT    NOT NULL,
  room_unit_id   TEXT    NOT NULL,
  reservation_id TEXT,
  previous_state TEXT,
  new_state      TEXT    NOT NULL
                         CHECK (new_state IN ('ready', 'occupied', 'dirty', 'cleaning', 'inspected', 'maintenance', 'out_of_order')),
  note           TEXT,
  changed_by     TEXT,
  created_at     INTEGER NOT NULL,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (property_id) REFERENCES properties(id),
  FOREIGN KEY (room_unit_id) REFERENCES room_units(id),
  FOREIGN KEY (reservation_id) REFERENCES property_reservations(id),
  FOREIGN KEY (changed_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_room_state_events_room_time
  ON room_state_events (tenant_id, property_id, room_unit_id, created_at);

CREATE INDEX IF NOT EXISTS idx_room_state_events_reservation
  ON room_state_events (tenant_id, reservation_id, created_at);
