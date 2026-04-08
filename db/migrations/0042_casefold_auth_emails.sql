-- 0042_casefold_auth_emails.sql
-- Purpose:
--   Canonicalize stored auth/tenant emails to lowercase and enforce
--   case-insensitive uniqueness so email-password and Google auth cannot
--   diverge into separate identities because of email casing differences.

UPDATE users
   SET email = lower(email)
 WHERE email IS NOT NULL
   AND email != lower(email);

UPDATE tenants
   SET email = lower(email)
 WHERE email IS NOT NULL
   AND email != lower(email);

UPDATE password_reset_tokens
   SET email = lower(email)
 WHERE email IS NOT NULL
   AND email != lower(email);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_casefold
  ON users (lower(email));

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_email_casefold
  ON tenants (lower(email))
  WHERE email IS NOT NULL;