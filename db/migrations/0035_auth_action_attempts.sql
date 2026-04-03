-- Migration 0035: auth action attempt ledger for soft throttling

CREATE TABLE IF NOT EXISTS auth_action_attempts (
  id         TEXT PRIMARY KEY,
  action     TEXT NOT NULL,
  email      TEXT,
  ip         TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_action_attempts_action_email_created
  ON auth_action_attempts (action, email, created_at);

CREATE INDEX IF NOT EXISTS idx_auth_action_attempts_action_ip_created
  ON auth_action_attempts (action, ip, created_at);

CREATE INDEX IF NOT EXISTS idx_auth_action_attempts_created
  ON auth_action_attempts (created_at);
