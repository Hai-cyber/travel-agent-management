-- Migration 0016: Bank Transfer Booking Orders
-- Full order lifecycle with identity lock, proof-based unlock, and auto-purge.
--
-- State machine:
--   AWAITING_PROOF  ── guest uploads proof ──► PROOF_UPLOADED
--   PROOF_UPLOADED  ── agent confirms receipt ► CONFIRMED
--   AWAITING_PROOF  ── deadline exceeded ──────► EXPIRED   (scheduled purge)
--   AWAITING_PROOF
--   PROOF_UPLOADED  ── guest/agent cancels ───► CANCELLED  (optional)
--
-- Identity lock:
--   guest_name / guest_email / guest_phone are stored immediately on creation
--   but the API only returns them when identity_unlocked = 1.
--   identity_unlocked is set to 1 ONLY when proof_r2_key is written.
--
-- On EXPIRED purge: guest identity columns are NULLed (data minimisation).
-- grand_total_usd accumulates into tenants.total_revenue_tracked ONLY on CONFIRMED.

CREATE TABLE IF NOT EXISTS booking_orders (
  id                  TEXT    PRIMARY KEY,              -- nanoid

  -- Tenant + tour context
  tenant_id           TEXT    NOT NULL,
  draft_id            TEXT,                             -- optional source booking_drafts.id
  tour_id             TEXT    NOT NULL,
  travel_date         TEXT    NOT NULL,                 -- YYYY-MM-DD
  segment_id          TEXT    NOT NULL,

  -- Pax counts — ALWAYS visible to agent (needed for seat management)
  pax_shared          INTEGER NOT NULL DEFAULT 0,
  pax_private         INTEGER NOT NULL DEFAULT 0,
  pax_children        INTEGER NOT NULL DEFAULT 0,
  pax_infants         INTEGER NOT NULL DEFAULT 0,

  -- [SEC] Guest identity — API-locked until identity_unlocked = 1
  -- On EXPIRED: all three are set to NULL (GDPR data minimisation)
  guest_name          TEXT,
  guest_email         TEXT,
  guest_phone         TEXT,

  -- Pricing snapshot (server-authoritative; client price never trusted)
  grand_total_usd     REAL    NOT NULL,
  price_snapshot_json TEXT    NOT NULL,

  -- Payment method + deadline
  payment_method      TEXT    NOT NULL DEFAULT 'BANK_TRANSFER',
  -- Deadline is computed at insert time: 48 h normally, 72 h if 48 h lands on Sat/Sun (UTC)
  payment_deadline    INTEGER NOT NULL,                 -- UNIX seconds

  -- Status machine
  status              TEXT    NOT NULL DEFAULT 'AWAITING_PROOF'
                      CHECK (status IN (
                        'AWAITING_PROOF',
                        'PROOF_UPLOADED',
                        'CONFIRMED',
                        'EXPIRED',
                        'CANCELLED'
                      )),

  -- Identity gate: flipped to 1 only when proof is successfully uploaded to R2
  identity_unlocked   INTEGER NOT NULL DEFAULT 0,

  -- Proof of payment image (uploaded to BOOKING_PROOFS R2 bucket)
  proof_r2_key        TEXT,                             -- e.g. proofs/{orderId}
  proof_content_type  TEXT,                             -- image/jpeg | image/png | application/pdf …
  proof_uploaded_at   INTEGER,                         -- UNIX seconds

  -- Agent confirmation (triggers revenue tracking)
  confirmed_at        INTEGER,
  confirmed_by        TEXT,                            -- CF-Connecting-IP of confirming agent

  created_at          INTEGER NOT NULL,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Scheduled purge job: scan for overdue AWAITING_PROOF orders efficiently
CREATE INDEX IF NOT EXISTS idx_booking_orders_purge
  ON booking_orders (status, payment_deadline)
  WHERE status = 'AWAITING_PROOF';

-- Agent dashboard: orders per tenant newest-first
CREATE INDEX IF NOT EXISTS idx_booking_orders_agent
  ON booking_orders (tenant_id, status, created_at);
