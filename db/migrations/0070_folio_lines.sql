-- Migration 0070: Folio lines
--
-- Purpose:
--   - add booking-derived and manual charge lines for property folios
--   - support room charges, add-ons, discounts, and refunds
--
-- Notes:
--   - payment records remain a later shared-kernel migration
--   - this table only stores charge/adjustment lines, not payment truth

CREATE TABLE IF NOT EXISTS folio_lines (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT    NOT NULL,
  property_id  TEXT    NOT NULL,
  folio_id     TEXT    NOT NULL,
  line_type    TEXT    NOT NULL
                        CHECK (line_type IN ('room_charge', 'service_charge', 'fee', 'discount', 'refund')),
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

CREATE INDEX IF NOT EXISTS idx_folio_lines_folio_posted
  ON folio_lines (tenant_id, folio_id, posted_at);

CREATE INDEX IF NOT EXISTS idx_folio_lines_type_status
  ON folio_lines (tenant_id, property_id, line_type, status);
