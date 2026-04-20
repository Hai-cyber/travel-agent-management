-- Migration 0081: Add payment session tracking to booking_orders
-- payment_provider: which gateway handled this payment (STRIPE, XENDIT, MOMO, etc.)
-- payment_session_id: gateway's session/invoice/charge ID for lookup and webhook matching
-- payment_link_url: the hosted payment page URL (Stripe Checkout URL, Xendit invoice URL)
-- payment_link_expires_at: UNIX timestamp when the link expires (Stripe/Xendit both have expiry)

ALTER TABLE booking_orders ADD COLUMN payment_provider TEXT;
ALTER TABLE booking_orders ADD COLUMN payment_session_id TEXT;
ALTER TABLE booking_orders ADD COLUMN payment_link_url TEXT;
ALTER TABLE booking_orders ADD COLUMN payment_link_expires_at INTEGER;
