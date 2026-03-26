-- Migration 0021: Payment Methods Toggle + Pay-on-Arrival (CHK-R28)
--
-- Changes:
--   1. ALTER TABLE tenants ADD COLUMN payment_methods TEXT
--      JSON array of enabled/disabled payment channels.
--      Default shape (written on first PATCH):
--        [
--          { "id": "BANK_TRANSFER",  "label": "Chuyển khoản",    "enabled": true,  "category": "manual"  },
--          { "id": "MOMO",           "label": "MoMo",             "enabled": false, "category": "instant" },
--          { "id": "ZALOPAY",        "label": "ZaloPay",          "enabled": false, "category": "instant" },
--          { "id": "VNPAY",          "label": "VNPay",            "enabled": false, "category": "instant" },
--          { "id": "CREDIT_CARD",    "label": "Thẻ tín dụng",    "enabled": false, "category": "instant" },
--          { "id": "PAYPAL",         "label": "PayPal",           "enabled": false, "category": "instant" },
--          { "id": "GRABPAY",        "label": "GrabPay",          "enabled": false, "category": "instant" },
--          { "id": "CASH_AT_OFFICE", "label": "Thanh toán trực tiếp", "enabled": false, "category": "manual" },
--          { "id": "PAY_ON_ARRIVAL", "label": "Trả khi gặp mặt", "enabled": false, "category": "manual", "risk": "ghosting" }
--        ]
--
--   2. Extend booking_orders.status CHECK → add PENDING_ARRIVAL
--      (Pay-on-Arrival orders: identity locked, no proof required, manual unlock by agent)
--
--   3. ALTER TABLE booking_orders ADD COLUMN manual_unlock_at INTEGER
--      Records when agent explicitly unlocked a PENDING_ARRIVAL identity.

-- ── Step 1: Add payment_methods to tenants ────────────────────────────────────
ALTER TABLE tenants ADD COLUMN payment_methods TEXT;

-- ── Step 2: Extend booking_orders status → include PENDING_ARRIVAL ────────────
-- SQLite cannot alter a CHECK constraint; must recreate the table.
CREATE TABLE IF NOT EXISTS booking_orders_v2 (
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

  guest_name          TEXT,
  guest_email         TEXT,
  guest_phone         TEXT,

  grand_total_usd     REAL    NOT NULL,
  price_snapshot_json TEXT    NOT NULL,

  payment_method      TEXT    NOT NULL DEFAULT 'BANK_TRANSFER'
                      CHECK (payment_method IN (
                        'BANK_TRANSFER', 'CASH_AT_OFFICE', 'PAY_ON_ARRIVAL',
                        'CREDIT_CARD', 'MOMO', 'ZALOPAY', 'VNPAY', 'PAYPAL', 'GRABPAY'
                      )),

  payment_deadline    INTEGER NOT NULL DEFAULT 0,

  status              TEXT    NOT NULL DEFAULT 'AWAITING_PROOF'
                      CHECK (status IN (
                        'AWAITING_PROOF',
                        'AWAITING_PAYMENT',
                        'PENDING_ARRIVAL',
                        'PROOF_UPLOADED',
                        'CONFIRMED',
                        'EXPIRED',
                        'CANCELLED',
                        'PAID'
                      )),

  identity_unlocked   INTEGER NOT NULL DEFAULT 0,
  manual_unlock_at    INTEGER,           -- set when agent explicitly unlocks a PENDING_ARRIVAL

  proof_r2_key        TEXT,
  proof_content_type  TEXT,
  proof_uploaded_at   INTEGER,

  confirmed_at        INTEGER,
  confirmed_by        TEXT,

  secure_token        TEXT    UNIQUE,
  created_at          INTEGER NOT NULL,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

INSERT INTO booking_orders_v2
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
ALTER TABLE booking_orders_v2 RENAME TO booking_orders;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_booking_orders_purge
  ON booking_orders (status, payment_deadline)
  WHERE status IN ('AWAITING_PROOF', 'AWAITING_PAYMENT');

CREATE INDEX IF NOT EXISTS idx_booking_orders_tenant
  ON booking_orders (tenant_id, created_at);
