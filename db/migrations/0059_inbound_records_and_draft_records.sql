-- Migration 0059: Shared inbound records and draft records
--
-- Purpose:
--   - add a shared inbound-capture envelope for both tour and property engines
--   - add a shared draft-review pattern without replacing engine-owned truth tables
--
-- Notes:
--   - booking_drafts remains the canonical tour draft table for current runtime flows
--   - these new tables support future email ingest and cross-engine review workflows

CREATE TABLE IF NOT EXISTS inbound_records (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT    NOT NULL,
  source         TEXT    NOT NULL,
  source_ref     TEXT,
  source_payload TEXT,
  status         TEXT    NOT NULL DEFAULT 'received'
                         CHECK (status IN ('received', 'draft_created', 'ignored', 'consumed', 'rejected')),
  received_at    INTEGER NOT NULL,
  created_at     INTEGER NOT NULL,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_inbound_records_tenant_status
  ON inbound_records (tenant_id, status, received_at);

CREATE INDEX IF NOT EXISTS idx_inbound_records_source_ref
  ON inbound_records (tenant_id, source, source_ref);

CREATE TABLE IF NOT EXISTS draft_records (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT    NOT NULL,
  inbound_record_id TEXT,
  draft_type        TEXT    NOT NULL,
  draft_payload     TEXT    NOT NULL,
  status            TEXT    NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'needs_review', 'confirmed', 'ignored', 'rejected')),
  reviewed_by       TEXT,
  reviewed_at       INTEGER,
  created_at        INTEGER NOT NULL,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (inbound_record_id) REFERENCES inbound_records(id),
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_draft_records_tenant_status
  ON draft_records (tenant_id, draft_type, status, created_at);

CREATE INDEX IF NOT EXISTS idx_draft_records_inbound
  ON draft_records (inbound_record_id);
