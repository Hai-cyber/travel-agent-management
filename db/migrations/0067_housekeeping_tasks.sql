-- Migration 0067: Housekeeping tasks
--
-- Purpose:
--   - add housekeeping work items for the property operations layer
--   - support cleaning, inspection, and arrival-priority sequencing

CREATE TABLE IF NOT EXISTS housekeeping_tasks (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT    NOT NULL,
  property_id      TEXT    NOT NULL,
  room_unit_id     TEXT    NOT NULL,
  reservation_id   TEXT,
  priority         TEXT    NOT NULL DEFAULT 'routine'
                            CHECK (priority IN ('arrival_today_high', 'arrival_today_normal', 'departure_clean', 'routine', 'blocked_maintenance')),
  status           TEXT    NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'in_progress', 'waiting_inspection', 'completed', 'cancelled')),
  scheduled_for    INTEGER,
  started_at       INTEGER,
  completed_at     INTEGER,
  assigned_user_id TEXT,
  note             TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (property_id) REFERENCES properties(id),
  FOREIGN KEY (room_unit_id) REFERENCES room_units(id),
  FOREIGN KEY (reservation_id) REFERENCES property_reservations(id),
  FOREIGN KEY (assigned_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_housekeeping_tasks_room_status
  ON housekeeping_tasks (tenant_id, property_id, room_unit_id, status);

CREATE INDEX IF NOT EXISTS idx_housekeeping_tasks_priority_schedule
  ON housekeeping_tasks (tenant_id, property_id, priority, scheduled_for);
