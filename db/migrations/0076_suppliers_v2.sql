-- Migration 0076: Suppliers v2 — structured contact fields + active flag
--
-- Purpose:
--   - extend the existing minimal suppliers table (from 0001_foundation.sql)
--     with per-channel contact fields, address, and a soft-delete flag
--   - keep backward compat: existing 'contact' TEXT column is preserved
--     as a legacy/notes field; structured fields are additive
--
-- Safe to re-run (ALTER TABLE RENAME adds nothing on duplicate; ignored by D1).

ALTER TABLE suppliers ADD COLUMN contact_name    TEXT;
ALTER TABLE suppliers ADD COLUMN contact_phone   TEXT;
ALTER TABLE suppliers ADD COLUMN contact_email   TEXT;
ALTER TABLE suppliers ADD COLUMN contact_whatsapp TEXT;
ALTER TABLE suppliers ADD COLUMN contact_zalo    TEXT;
ALTER TABLE suppliers ADD COLUMN address         TEXT;
ALTER TABLE suppliers ADD COLUMN is_active       INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_suppliers_tenant ON suppliers (tenant_id);
