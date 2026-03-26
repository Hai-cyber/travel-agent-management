-- Migration 0020: Universal Payment Methods (CHK-R27)
--
-- Changes:
--   1. ALTER TABLE tenants ADD COLUMN notification_config TEXT
--      JSON shape: { telegram: { bot_token, chat_id }, webhook: { url } }
--
--   2. Recreate booking_orders with:
--      a) Expanded status CHECK → adds AWAITING_PAYMENT + PAID
--      b) Adds payment_method CHECK for all known providers
--
-- Status machine (full):
--   Group A (Instant)  : AWAITING_PAYMENT ──webhook success──► PAID     (identity_unlocked = 1)
--                        AWAITING_PAYMENT ──webhook failure──► CANCELLED
--   Group B (Manual)   : AWAITING_PROOF   ──proof upload────► PROOF_UPLOADED (identity_unlocked = 1)
--                        PROOF_UPLOADED   ──agent confirm───► CONFIRMED
--                        AWAITING_PROOF   ──deadline───────► EXPIRED
--
-- IMPORTANT: SQLite cannot ALTER a CHECK constraint; table recreation is required.

-- ── Step 1: Tenant notification config ───────────────────────────────────────
ALTER TABLE tenants ADD COLUMN notification_config TEXT;

-- ── Step 2: Recreate booking_orders with expanded CHECK constraints ───────────
CREATE TABLE IF NOT EXISTS booking_orders_new (
  id                  TEXT    PRIMARY KEY,
  tenant_id           TEXT    NOT NULL,
  draft_id            TEXT,
  tour_id             TEXT    NOT NULL,
  travel_date         TEXT    NOT NULL,
  segment_id          TEXT    NOT NULL,

  pax_shared          INTEGER NOT NULL DEFAULT 0,
  pax_private         INTEGER NOT NULL DEFAULT 0,
  pax_children        INTEGER NOT NULL DEFAULT 0,
  pax_infants         INTEGER NOT NULL DEFAULT 0,

  -- [SEC] Identity locked until payment confirmed (Group A webhook) or proof uploaded (Group B)
  guest_name          TEXT,
  guest_email         TEXT,
  guest_phone         TEXT,

  grand_total_usd     REAL    NOT NULL,
  price_snapshot_json TEXT    NOT NULL,

  -- Expanded payment method catalog
  payment_method      TEXT    NOT NULL DEFAULT 'BANK_TRANSFER'
                      CHECK (payment_method IN (
                        'BANK_TRANSFER', 'CASH_AT_OFFICE',
                        'CREDIT_CARD', 'MOMO', 'ZALOPAY', 'VNPAY', 'PAYPAL', 'GRABPAY'
                      )),

  payment_deadline    INTEGER NOT NULL DEFAULT 0,

  -- Expanded status: AWAITING_PAYMENT (Group A pending) + PAID (Group A confirmed)
  status              TEXT    NOT NULL DEFAULT 'AWAITING_PROOF'
                      CHECK (status IN (
                        'AWAITING_PROOF',
                        'AWAITING_PAYMENT',
                        'PROOF_UPLOADED',
                        'CONFIRMED',
                        'EXPIRED',
                        'CANCELLED',
                        'PAID'
                      )),

  identity_unlocked   INTEGER NOT NULL DEFAULT 0,

  proof_r2_key        TEXT,
  proof_content_type  TEXT,
  proof_uploaded_at   INTEGER,

  confirmed_at        INTEGER,
  confirmed_by        TEXT,

  secure_token        TEXT    UNIQUE,

  created_at          INTEGER NOT NULL,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Copy all existing rows (payment_method CHECK accepts existing 'BANK_TRANSFER' values)
INSERT INTO booking_orders_new
  (id, tenant_id, draft_id, tour_id, travel_date, segment_id,
   pax_shared, pax_private, pax_children, pax_infants,
   guest_name, guest_email, guest_phone,
   grand_total_usd, price_snapshot_json,
   payment_method, payment_deadline,
   status, identity_unlocked,
   proof_r2_key, proof_content_type, proof_uploaded_at,
   confirmed_at, confirmed_by, secure_token, created_at)
SELECT
  id, tenant_id, draft_id, tour_id, travel_date, segment_id,
  pax_shared, pax_private, pax_children, pax_infants,
  guest_name, guest_email, guest_phone,
  grand_total_usd, price_snapshot_json,
  payment_method, payment_deadline,
  status, identity_unlocked,
  proof_r2_key, proof_content_type, proof_uploaded_at,
  confirmed_at, confirmed_by, secure_token, created_at
FROM booking_orders;

DROP TABLE booking_orders;
ALTER TABLE booking_orders_new RENAME TO booking_orders;

-- Recreate indexes (must be done after rename)
CREATE INDEX IF NOT EXISTS idx_booking_orders_purge
  ON booking_orders (status, payment_deadline)
  WHERE status IN ('AWAITING_PROOF', 'AWAITING_PAYMENT');

CREATE INDEX IF NOT EXISTS idx_booking_orders_tenant
  ON booking_orders (tenant_id, created_at);
