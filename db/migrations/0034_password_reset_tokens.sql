-- Migration 0034: password reset tokens for email password recovery

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  tenant_id     TEXT,
  email         TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  used_at       INTEGER,
  requested_ip  TEXT,
  requested_ua  TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_expires
  ON password_reset_tokens (user_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_tenant_expires
  ON password_reset_tokens (tenant_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_unused_expires
  ON password_reset_tokens (used_at, expires_at);