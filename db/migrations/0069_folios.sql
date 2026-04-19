-- Migration 0069: Folios
--
-- Purpose:
--   - add the primary folio table for the property billing layer
--   - keep one default folio per reservation in the first implementation

CREATE TABLE IF NOT EXISTS folios (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT    NOT NULL,
  property_id    TEXT    NOT NULL,
  reservation_id TEXT    NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open', 'settled', 'cancelled', 'voided')),
  currency       TEXT    NOT NULL,
  note           TEXT,
  opened_at      INTEGER NOT NULL,
  settled_at     INTEGER,
  closed_by      TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (property_id) REFERENCES properties(id),
  FOREIGN KEY (reservation_id) REFERENCES property_reservations(id),
  FOREIGN KEY (closed_by) REFERENCES users(id),
  UNIQUE (reservation_id)
);

CREATE INDEX IF NOT EXISTS idx_folios_property_status
  ON folios (tenant_id, property_id, status, opened_at);
