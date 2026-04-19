-- Migration 0062: Property reservations
--
-- Purpose:
--   - add canonical reservation truth for the property engine
--   - support direct, manual, and imported reservation flows

CREATE TABLE IF NOT EXISTS property_reservations (
  id                             TEXT PRIMARY KEY,
  tenant_id                      TEXT    NOT NULL,
  property_id                    TEXT    NOT NULL,
  source                         TEXT    NOT NULL,
  source_ref                     TEXT,
  source_payload                 TEXT,
  status                         TEXT    NOT NULL DEFAULT 'pending_payment'
                                          CHECK (status IN ('pending_payment', 'confirmed', 'cancelled', 'no_show', 'checked_in', 'checked_out')),
  guest_name                     TEXT    NOT NULL,
  guest_email                    TEXT,
  guest_phone                    TEXT,
  check_in                       TEXT    NOT NULL,
  check_out                      TEXT    NOT NULL,
  room_type_id                   TEXT    NOT NULL,
  rooms_requested                INTEGER NOT NULL DEFAULT 1,
  adults                         INTEGER NOT NULL DEFAULT 1,
  children                       INTEGER NOT NULL DEFAULT 0,
  pricing_snapshot               TEXT    NOT NULL,
  special_requests               TEXT,
  expected_arrival_time          TEXT,
  expected_flight_ref            TEXT,
  expected_arrival_channel       TEXT,
  airport_transfer_requested     INTEGER NOT NULL DEFAULT 0,
  airport_transfer_price_snapshot TEXT,
  cancellation_policy_snapshot   TEXT,
  confirmed_at                   INTEGER,
  confirmed_by                   TEXT,
  cancelled_at                   INTEGER,
  cancelled_by                   TEXT,
  cancel_reason                  TEXT,
  created_at                     INTEGER NOT NULL,
  updated_at                     INTEGER NOT NULL,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (property_id) REFERENCES properties(id),
  FOREIGN KEY (room_type_id) REFERENCES room_types(id),
  FOREIGN KEY (confirmed_by) REFERENCES users(id),
  FOREIGN KEY (cancelled_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_property_reservations_property_status_checkin
  ON property_reservations (tenant_id, property_id, status, check_in);

CREATE INDEX IF NOT EXISTS idx_property_reservations_property_dates
  ON property_reservations (tenant_id, property_id, check_in, check_out);

CREATE INDEX IF NOT EXISTS idx_property_reservations_source_ref
  ON property_reservations (tenant_id, source, source_ref);
