-- Migration 0058: Shared staff assignments
--
-- Purpose:
--   - add a shared assignment primitive usable by both tour and property engines
--   - support scoped staff roles without creating separate tenant identities
--
-- Notes:
--   - scope_type/scope_id allow gradual adoption by different engine surfaces
--   - permissions_json is intentionally flexible for early rollout

CREATE TABLE IF NOT EXISTS staff_assignments (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT    NOT NULL,
  user_id          TEXT    NOT NULL,
  scope_type       TEXT    NOT NULL,
  scope_id         TEXT    NOT NULL,
  role             TEXT    NOT NULL,
  permissions_json TEXT    NOT NULL DEFAULT '[]',
  created_at       INTEGER NOT NULL,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE (tenant_id, user_id, scope_type, scope_id, role)
);

CREATE INDEX IF NOT EXISTS idx_staff_assignments_tenant_user
  ON staff_assignments (tenant_id, user_id);

CREATE INDEX IF NOT EXISTS idx_staff_assignments_scope
  ON staff_assignments (tenant_id, scope_type, scope_id);
