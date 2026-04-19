-- Migration 0063: Property inventory holds
--
-- Purpose:
--   - add temporary inventory protection for property availability flows
--   - support direct checkout holds, manual holds, and review holds

CREATE TABLE IF NOT EXISTS inventory_holds (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT    NOT NULL,
  property_id     TEXT    NOT NULL,
  room_type_id    TEXT    NOT NULL,
  hold_type       TEXT    NOT NULL
                         CHECK (hold_type IN ('soft_hold', 'manual_hold', 'review_hold')),
  source_type     TEXT    NOT NULL,
  source_id       TEXT,
  check_in        TEXT    NOT NULL,
  check_out       TEXT    NOT NULL,
  rooms_requested INTEGER NOT NULL DEFAULT 1,
  status          TEXT    NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'released', 'expired', 'consumed')),
  expires_at      INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (property_id) REFERENCES properties(id),
  FOREIGN KEY (room_type_id) REFERENCES room_types(id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_holds_active_window
  ON inventory_holds (tenant_id, property_id, room_type_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_inventory_holds_source
  ON inventory_holds (tenant_id, source_type, source_id);
