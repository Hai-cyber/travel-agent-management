-- Migration 0030: Password auth sessions + Google account linkage
--
-- Adds:
--   - users.google_sub for Google Sign-In mapping
--   - auth_sessions for httpOnly session cookies

ALTER TABLE users ADD COLUMN google_sub TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub
  ON users (google_sub)
  WHERE google_sub IS NOT NULL;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  tenant_id    TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_expires
  ON auth_sessions (user_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_tenant_expires
  ON auth_sessions (tenant_id, expires_at);
