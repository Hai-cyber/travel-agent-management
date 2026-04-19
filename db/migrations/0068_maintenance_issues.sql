-- Migration 0068: Maintenance issues
--
-- Purpose:
--   - add maintenance/out-of-order tracking for property room operations
--   - support sellability blocking and return-to-service flow

CREATE TABLE IF NOT EXISTS maintenance_issues (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT    NOT NULL,
  property_id        TEXT    NOT NULL,
  room_unit_id       TEXT    NOT NULL,
  title              TEXT    NOT NULL,
  description        TEXT,
  block_state        TEXT    NOT NULL DEFAULT 'maintenance'
                              CHECK (block_state IN ('maintenance', 'out_of_order', 'returned_to_ready')),
  status             TEXT    NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open', 'in_progress', 'resolved', 'cancelled')),
  reported_by        TEXT,
  assigned_user_id   TEXT,
  target_restore_at  INTEGER,
  resolved_at        INTEGER,
  returned_ready_at  INTEGER,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (property_id) REFERENCES properties(id),
  FOREIGN KEY (room_unit_id) REFERENCES room_units(id),
  FOREIGN KEY (reported_by) REFERENCES users(id),
  FOREIGN KEY (assigned_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_maintenance_issues_room_status
  ON maintenance_issues (tenant_id, property_id, room_unit_id, status);

CREATE INDEX IF NOT EXISTS idx_maintenance_issues_block_state
  ON maintenance_issues (tenant_id, property_id, block_state, target_restore_at);
