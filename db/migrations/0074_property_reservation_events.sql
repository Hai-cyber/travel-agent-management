-- Migration 0074: Property reservation events
--
-- Purpose:
--   - add an operational audit trail for property reservation lifecycle changes
--   - support safer undo paths for checked_out / no_show / early-check-out transitions

CREATE TABLE IF NOT EXISTS property_reservation_events (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT    NOT NULL,
  property_id    TEXT    NOT NULL,
  reservation_id TEXT    NOT NULL,
  action         TEXT    NOT NULL,
  from_status    TEXT,
  to_status      TEXT,
  actor_user_id  TEXT,
  payload_json   TEXT,
  created_at     INTEGER NOT NULL,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (property_id) REFERENCES properties(id),
  FOREIGN KEY (reservation_id) REFERENCES property_reservations(id),
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_property_reservation_events_reservation_time
  ON property_reservation_events (tenant_id, property_id, reservation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_property_reservation_events_action
  ON property_reservation_events (tenant_id, property_id, action, created_at DESC);