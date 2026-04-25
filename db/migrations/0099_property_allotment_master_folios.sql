-- Migration 0099: master folios for confirmed property allotments

CREATE TABLE IF NOT EXISTS property_allotment_master_folios (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  allotment_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  billing_mode TEXT NOT NULL DEFAULT 'master_only',
  currency TEXT NOT NULL,
  note TEXT,
  opened_at INTEGER NOT NULL,
  settled_at INTEGER,
  closed_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (property_id) REFERENCES properties(id),
  FOREIGN KEY (allotment_id) REFERENCES property_allotments(id),
  FOREIGN KEY (closed_by) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_property_allotment_master_folios_allotment
  ON property_allotment_master_folios (tenant_id, property_id, allotment_id);

CREATE INDEX IF NOT EXISTS idx_property_allotment_master_folios_status
  ON property_allotment_master_folios (tenant_id, property_id, status, created_at);