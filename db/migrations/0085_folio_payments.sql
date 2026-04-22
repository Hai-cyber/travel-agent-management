-- Migration 0085: Allow payment lines in folio_lines
--
-- Purpose:
--   - support manual settlement rows directly in folio_lines
--   - keep payment recording in the same folio surface for the current property baseline

PRAGMA foreign_keys = OFF;

ALTER TABLE folio_lines RENAME TO folio_lines_legacy_0085;

CREATE TABLE IF NOT EXISTS folio_lines (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT    NOT NULL,
  property_id  TEXT    NOT NULL,
  folio_id     TEXT    NOT NULL,
  line_type    TEXT    NOT NULL
                        CHECK (line_type IN ('room_charge', 'service_charge', 'fee', 'discount', 'refund', 'payment')),
  source_type  TEXT    NOT NULL
                        CHECK (source_type IN ('reservation_system', 'manual_frontdesk', 'manual_manager', 'imported')),
  category     TEXT,
  description  TEXT    NOT NULL,
  quantity     REAL    NOT NULL DEFAULT 1,
  unit_amount  REAL    NOT NULL DEFAULT 0,
  total_amount REAL    NOT NULL DEFAULT 0,
  currency     TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'posted'
                        CHECK (status IN ('posted', 'voided', 'refunded')),
  posted_at    INTEGER NOT NULL,
  posted_by    TEXT,
  note         TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (property_id) REFERENCES properties(id),
  FOREIGN KEY (folio_id) REFERENCES folios(id),
  FOREIGN KEY (posted_by) REFERENCES users(id)
);

INSERT INTO folio_lines (
  id, tenant_id, property_id, folio_id, line_type, source_type, category, description,
  quantity, unit_amount, total_amount, currency, status, posted_at, posted_by, note, created_at, updated_at
)
SELECT
  id, tenant_id, property_id, folio_id, line_type, source_type, category, description,
  quantity, unit_amount, total_amount, currency, status, posted_at, posted_by, note, created_at, updated_at
FROM folio_lines_legacy_0085;

DROP TABLE folio_lines_legacy_0085;

CREATE INDEX IF NOT EXISTS idx_folio_lines_folio_posted
  ON folio_lines (tenant_id, folio_id, posted_at);

CREATE INDEX IF NOT EXISTS idx_folio_lines_type_status
  ON folio_lines (tenant_id, property_id, line_type, status);

PRAGMA foreign_keys = ON;