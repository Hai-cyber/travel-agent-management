-- Migration 0022: Evolve tenant_audit_log for identity-unlock event tracking (CHK-R30)
--
-- The tenant_audit_log table was created in migration 0014 for settings-change
-- audit (custom_domain, payment_config_json) with columns:
--   id, tenant_id, field_name, old_value, new_value, changed_at, changed_by
--
-- This migration ADDS new columns to support identity-unlock events from the
-- Identity Lock system (CHK-R30). Old rows will have NULL in these columns.
-- New unlock events will have NULL in field_name/old_value/new_value/changed_at.
--
-- New columns serve three trust-tier actions:
--   actor       — 'webhook:<PROVIDER>' | 'agent:<CF-Connecting-IP>'
--   action      — 'INSTANT_UNLOCK_WEBHOOK' | 'IDENTITY_UNLOCK_CONFIRM_RECEIPT' | 'MANUAL_UNLOCK_ARRIVAL'
--   entity_type — 'booking_order' (default; reserved for future entity types)
--   entity_id   — booking_orders.id (nanoid)
--   meta_json   — provider, amount_usd, risk etc. (non-PII snapshot)
--   created_at  — UNIX epoch seconds (mirrors changed_at for the new rows)

ALTER TABLE tenant_audit_log ADD COLUMN actor       TEXT;
ALTER TABLE tenant_audit_log ADD COLUMN action      TEXT;
ALTER TABLE tenant_audit_log ADD COLUMN entity_type TEXT DEFAULT 'booking_order';
ALTER TABLE tenant_audit_log ADD COLUMN entity_id   TEXT;
ALTER TABLE tenant_audit_log ADD COLUMN meta_json   TEXT;
ALTER TABLE tenant_audit_log ADD COLUMN created_at  INTEGER;

-- Index on entity_id for fast per-order audit lookups
CREATE INDEX IF NOT EXISTS idx_audit_entity_id ON tenant_audit_log (entity_id);
-- Index for tenant-scoped unlock timeline queries
CREATE INDEX IF NOT EXISTS idx_audit_tenant_created ON tenant_audit_log (tenant_id, created_at);
