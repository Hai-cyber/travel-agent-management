-- Migration 0064: Property stay plans
--
-- Purpose:
--   - add ranked candidate/selected stay-plan structures for property reservations
--   - support contiguous, split, and upgrade-preserve planning

CREATE TABLE IF NOT EXISTS reservation_stay_plans (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT    NOT NULL,
  property_id      TEXT    NOT NULL,
  reservation_id   TEXT    NOT NULL,
  plan_type        TEXT    NOT NULL
                           CHECK (plan_type IN ('contiguous_same_type', 'contiguous_upgrade', 'split_same_type', 'split_with_upgrade')),
  score            INTEGER NOT NULL DEFAULT 0,
  move_count       INTEGER NOT NULL DEFAULT 0,
  upgrade_segments INTEGER NOT NULL DEFAULT 0,
  public_visible   INTEGER NOT NULL DEFAULT 0,
  is_selected      INTEGER NOT NULL DEFAULT 0,
  status           TEXT    NOT NULL DEFAULT 'candidate'
                           CHECK (status IN ('candidate', 'selected', 'locked', 'discarded')),
  meta_json        TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (property_id) REFERENCES properties(id),
  FOREIGN KEY (reservation_id) REFERENCES property_reservations(id)
);

CREATE INDEX IF NOT EXISTS idx_stay_plans_reservation_status
  ON reservation_stay_plans (tenant_id, reservation_id, status, score);

CREATE INDEX IF NOT EXISTS idx_stay_plans_selected
  ON reservation_stay_plans (tenant_id, reservation_id, is_selected);

-- At most one selected/locked stay plan should exist per reservation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_stay_plans_one_selected_per_reservation
  ON reservation_stay_plans (reservation_id)
  WHERE is_selected = 1 AND status IN ('selected', 'locked');

CREATE TABLE IF NOT EXISTS reservation_stay_plan_segments (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT    NOT NULL,
  property_id     TEXT    NOT NULL,
  reservation_id  TEXT    NOT NULL,
  stay_plan_id    TEXT    NOT NULL,
  segment_order   INTEGER NOT NULL DEFAULT 0,
  room_type_id    TEXT    NOT NULL,
  room_unit_id    TEXT,
  check_in        TEXT    NOT NULL,
  check_out       TEXT    NOT NULL,
  segment_type    TEXT    NOT NULL DEFAULT 'base'
                         CHECK (segment_type IN ('base', 'upgrade', 'split_move')),
  upgrade_applied INTEGER NOT NULL DEFAULT 0,
  ops_notes       TEXT,
  created_at      INTEGER NOT NULL,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (property_id) REFERENCES properties(id),
  FOREIGN KEY (reservation_id) REFERENCES property_reservations(id),
  FOREIGN KEY (stay_plan_id) REFERENCES reservation_stay_plans(id),
  FOREIGN KEY (room_type_id) REFERENCES room_types(id),
  FOREIGN KEY (room_unit_id) REFERENCES room_units(id)
);

CREATE INDEX IF NOT EXISTS idx_stay_plan_segments_plan_order
  ON reservation_stay_plan_segments (tenant_id, stay_plan_id, segment_order);
