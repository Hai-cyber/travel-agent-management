-- CHK-R107: Staff invite flow
-- Stores pending staff invitations (token-based, single-use, TTL 72h)
CREATE TABLE IF NOT EXISTS staff_invites (
  id          TEXT    PRIMARY KEY,
  tenant_id   TEXT    NOT NULL REFERENCES tenants(id),
  email       TEXT    NOT NULL,
  role        TEXT    NOT NULL DEFAULT 'staff' CHECK (role IN ('manager','staff','provider')),
  token_hash  TEXT    NOT NULL UNIQUE,
  invited_by  TEXT    NOT NULL,            -- user_id of the owner/manager who sent it
  invited_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  accepted_at INTEGER,
  revoked_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_staff_invites_tenant  ON staff_invites (tenant_id);
CREATE INDEX IF NOT EXISTS idx_staff_invites_token   ON staff_invites (token_hash);
CREATE INDEX IF NOT EXISTS idx_staff_invites_email   ON staff_invites (tenant_id, email);
