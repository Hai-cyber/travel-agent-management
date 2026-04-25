-- Migration 0100: charge routing for property allotment master vs guest scope

ALTER TABLE property_allotment_rooming_list_entries
  ADD COLUMN payer_scope TEXT NOT NULL DEFAULT 'guest';

CREATE TABLE IF NOT EXISTS property_allotment_master_folio_lines (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  master_folio_id TEXT NOT NULL,
  allotment_id TEXT NOT NULL,
  rooming_entry_id TEXT,
  line_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  category TEXT,
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_amount REAL NOT NULL DEFAULT 0,
  total_amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted',
  posted_at INTEGER NOT NULL,
  posted_by TEXT,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (property_id) REFERENCES properties(id),
  FOREIGN KEY (master_folio_id) REFERENCES property_allotment_master_folios(id),
  FOREIGN KEY (allotment_id) REFERENCES property_allotments(id),
  FOREIGN KEY (rooming_entry_id) REFERENCES property_allotment_rooming_list_entries(id),
  FOREIGN KEY (posted_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_property_allotment_master_folio_lines_folio_posted
  ON property_allotment_master_folio_lines (tenant_id, property_id, master_folio_id, posted_at);

CREATE TABLE IF NOT EXISTS property_allotment_deferred_guest_charges (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  allotment_id TEXT NOT NULL,
  rooming_entry_id TEXT NOT NULL,
  line_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  category TEXT,
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_amount REAL NOT NULL DEFAULT 0,
  total_amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  routing_status TEXT NOT NULL DEFAULT 'pending_guest_folio',
  note TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (property_id) REFERENCES properties(id),
  FOREIGN KEY (allotment_id) REFERENCES property_allotments(id),
  FOREIGN KEY (rooming_entry_id) REFERENCES property_allotment_rooming_list_entries(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_property_allotment_deferred_guest_charges_entry
  ON property_allotment_deferred_guest_charges (tenant_id, property_id, rooming_entry_id, routing_status, created_at);