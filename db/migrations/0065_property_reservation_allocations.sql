-- Migration 0065: Property reservation allocations
--
-- Purpose:
--   - add room-night allocation truth for selected property stay plans
--   - provide the clearest source for lane occupancy by date

CREATE TABLE IF NOT EXISTS reservation_allocations (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT    NOT NULL,
  property_id       TEXT    NOT NULL,
  reservation_id    TEXT    NOT NULL,
  stay_plan_id      TEXT    NOT NULL,
  room_unit_id      TEXT    NOT NULL,
  stay_date         TEXT    NOT NULL,
  allocation_status TEXT    NOT NULL DEFAULT 'soft_allocated'
                           CHECK (allocation_status IN ('soft_allocated', 'locked', 'released')),
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (property_id) REFERENCES properties(id),
  FOREIGN KEY (reservation_id) REFERENCES property_reservations(id),
  FOREIGN KEY (stay_plan_id) REFERENCES reservation_stay_plans(id),
  FOREIGN KEY (room_unit_id) REFERENCES room_units(id)
);

CREATE INDEX IF NOT EXISTS idx_reservation_allocations_room_date
  ON reservation_allocations (tenant_id, property_id, room_unit_id, stay_date);

CREATE INDEX IF NOT EXISTS idx_reservation_allocations_reservation_date
  ON reservation_allocations (tenant_id, reservation_id, stay_date);

CREATE INDEX IF NOT EXISTS idx_reservation_allocations_plan_status
  ON reservation_allocations (tenant_id, stay_plan_id, allocation_status);
