-- Migration 0024: Add email to tenants
-- Purpose: Store the owner email collected during signup/onboarding.
--          Used for: uniqueness check at signup, future magic-link auth,
--          notifications, and billing contact.
--
-- ⚠ Additive only — no existing rows or columns are modified.
-- Historical note: Cloudflare D1/SQLite does not support
-- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so drift rescue for local
-- databases that already contain `tenants.email` is handled in
-- scripts/apply_universal_migration.sh before migrations are applied.

ALTER TABLE tenants ADD COLUMN email TEXT;

-- Unique index: one email per tenant account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_email ON tenants (email)
  WHERE email IS NOT NULL;
