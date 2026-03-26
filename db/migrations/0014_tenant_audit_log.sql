-- Migration 0014: Tenant sensitive-field audit log
-- Purpose: Legal-grade audit trail for Custom Domain and Payment Gateway
--          configuration changes. Required for billing reconciliation and
--          dispute resolution.
--
-- Tracked fields: custom_domain, payment_config_json
-- Triggered by:  PATCH /api/tenants/settings (application layer)
--
-- Retention policy: rows are never auto-deleted — archive externally if needed.

CREATE TABLE IF NOT EXISTS tenant_audit_log (
  id          TEXT    PRIMARY KEY,                      -- nanoid
  tenant_id   TEXT    NOT NULL,
  field_name  TEXT    NOT NULL,                         -- 'custom_domain' | 'payment_config_json'
  old_value   TEXT,                                     -- NULL when field was previously unset
  new_value   TEXT,                                     -- NULL when field is being cleared
  changed_at  INTEGER NOT NULL,                         -- UNIX epoch seconds
  changed_by  TEXT,                                     -- CF-Connecting-IP or X-Forwarded-For (may be NULL)

  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Tenant-scoped lookup (newest first) — used by GET /api/tenants/audit-log
CREATE INDEX IF NOT EXISTS idx_tenant_audit_log_tenant_ts
  ON tenant_audit_log (tenant_id, changed_at DESC);
