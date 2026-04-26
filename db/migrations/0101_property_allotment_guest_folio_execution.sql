-- Migration 0101: guest-folio execution link for allotment rooming entries and deferred guest charges

ALTER TABLE property_allotment_rooming_list_entries
  ADD COLUMN reservation_id TEXT;

ALTER TABLE property_allotment_deferred_guest_charges
  ADD COLUMN reservation_id TEXT;

ALTER TABLE property_allotment_deferred_guest_charges
  ADD COLUMN consumed_folio_id TEXT;

ALTER TABLE property_allotment_deferred_guest_charges
  ADD COLUMN consumed_folio_line_id TEXT;

ALTER TABLE property_allotment_deferred_guest_charges
  ADD COLUMN consumed_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_property_allotment_rooming_reservation
  ON property_allotment_rooming_list_entries (tenant_id, property_id, reservation_id, rooming_status, updated_at);

CREATE INDEX IF NOT EXISTS idx_property_allotment_deferred_guest_charges_reservation
  ON property_allotment_deferred_guest_charges (tenant_id, property_id, reservation_id, routing_status, created_at);