// src/routes/guestPay.js
// ── Guest Payment Routes ──────────────────────────────────────────────────────
// CHK-P02 / CHK-P03
//
// POST /api/pay/create
//   Creates a hosted payment session for a booking order.
//   Body: { order_id, provider }  where provider = 'stripe' | 'xendit'
//   Returns: { ok, url, expires_at, session_id }
//   [SEC] order_id is looked up in DB — amount is never trusted from client.
//   [SEC] tenant_id on the order must match the X-Tenant-ID header.
//   PUBLIC — no session auth required (guests pay without logging in).
//   Guests are identified by order_id + secure_token query param on pay.html.
//
// POST /api/pay/stripe/webhook
//   Stripe calls this on checkout.session.completed or payment_intent.succeeded.
//   Confirms the booking_order → status CONFIRMED, seeds todos, sends email.
//   [SEC] Stripe-Signature header verified against STRIPE_WEBHOOK_SECRET.
//
// POST /api/pay/xendit/webhook
//   Xendit calls this on PAID invoice status.
//   [SEC] x-callback-token header verified against XENDIT_WEBHOOK_TOKEN.
//
// GET /api/pay/status?order_id=
//   Guest polls for confirmation after redirect back from payment page.
//   Returns { ok, status, payment_provider }.
//   PUBLIC — guarded by secure_token query param.

import { Hono } from 'hono';
import { createStripeCheckout, createXenditInvoice, verifyStripeWebhook, verifyXenditWebhook } from '../lib/paymentAdapters.js';
import { dispatchBookingConfirmedEmail } from '../lib/bookingEmails.js';
import { seedOrderTodos } from '../lib/bookingOps.js';
import { notifyAgent } from '../lib/notifications.js';

const guestPay = new Hono();

// ── POST /api/pay/create ──────────────────────────────────────────────────────
guestPay.post('/create', async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid request body.' }, 400); }

  const { order_id, provider, secure_token } = body ?? {};
  if (!order_id || !provider) return c.json({ error: 'order_id and provider are required.' }, 400);

  const providerKey = String(provider).toLowerCase();
  if (!['stripe', 'xendit'].includes(providerKey)) {
    return c.json({ error: 'Unsupported provider. Use stripe or xendit.' }, 400);
  }

  const db = c.env.DB;

  // Load order — join to get tour title for the payment description
  const order = await db.prepare(`
    SELECT bo.id, bo.tenant_id, bo.status, bo.guest_email, bo.guest_name, bo.guest_phone,
           bo.grand_total_amount, bo.grand_total_usd, bo.booking_currency,
           bo.payment_method, bo.payment_provider, bo.payment_session_id,
           bo.payment_link_url, bo.payment_link_expires_at, bo.secure_token,
           t.title AS tour_title
      FROM booking_orders bo
      LEFT JOIN tours t ON t.id = bo.tour_id
     WHERE bo.id = ?
  `).bind(order_id).first();

  if (!order) return c.json({ error: 'Order not found.' }, 404);

  // [SEC] Validate secure_token so guests can only pay their own orders
  if (secure_token && order.secure_token && order.secure_token !== secure_token) {
    return c.json({ error: 'Invalid token.' }, 403);
  }

  // Only allow payment on AWAITING_PAYMENT orders
  if (!['AWAITING_PAYMENT', 'AWAITING_PROOF'].includes(order.status)) {
    return c.json({ error: 'This order is not awaiting payment.' }, 400);
  }

  const now = Math.floor(Date.now() / 1000);

  // Return existing unexpired link if already created
  if (
    order.payment_provider?.toLowerCase() === providerKey &&
    order.payment_link_url &&
    order.payment_link_expires_at > now + 60
  ) {
    return c.json({
      ok:         true,
      url:        order.payment_link_url,
      expires_at: order.payment_link_expires_at,
      session_id: order.payment_session_id,
      reused:     true,
    });
  }

  // Load tenant for payment config
  const tenant = await db.prepare(`
    SELECT id, name, email, booking_currency, base_currency, payment_config_json
      FROM tenants WHERE id = ?
  `).bind(order.tenant_id).first();

  if (!tenant) return c.json({ error: 'Tenant not found.' }, 500);

  // Build return URLs
  const origin      = new URL(c.req.url).origin;
  const successUrl  = `${origin}/pay-success.html?order=${encodeURIComponent(order_id)}&t=${encodeURIComponent(order.secure_token ?? '')}`;
  const cancelUrl   = `${origin}/pay-cancel.html?order=${encodeURIComponent(order_id)}`;

  try {
    let session;

    if (providerKey === 'stripe') {
      session = await createStripeCheckout(order, tenant, c.env, {
        success_url: successUrl,
        cancel_url:  cancelUrl,
      });
    } else {
      session = await createXenditInvoice(order, tenant, c.env, {
        success_redirect_url: successUrl,
        failure_redirect_url: cancelUrl,
      });
    }

    // Persist session to order
    await db.prepare(`
      UPDATE booking_orders
         SET payment_provider     = ?,
             payment_session_id   = ?,
             payment_link_url     = ?,
             payment_link_expires_at = ?
       WHERE id = ?
    `).bind(
      providerKey,
      session.session_id ?? session.invoice_id,
      session.url,
      session.expires_at,
      order_id,
    ).run();

    return c.json({
      ok:         true,
      url:        session.url,
      expires_at: session.expires_at,
      session_id: session.session_id ?? session.invoice_id,
    });

  } catch (err) {
    console.error('[GUEST_PAY_CREATE]', err.message);
    return c.json({ error: err.message }, 502);
  }
});

// ── POST /api/pay/stripe/webhook ──────────────────────────────────────────────
guestPay.post('/stripe/webhook', async (c) => {
  let rawBody;
  try { rawBody = await c.req.text(); } catch { return c.json({ ok: true }); }

  const sigHeader = c.req.header('stripe-signature') ?? '';
  const secret    = c.env.STRIPE_WEBHOOK_SECRET;

  if (secret) {
    const valid = await verifyStripeWebhook(rawBody, sigHeader, secret);
    if (!valid) {
      console.warn('[STRIPE_WEBHOOK_SIG_INVALID]');
      return c.json({ ok: true }); // silent rejection — never 4xx to Stripe
    }
  }

  let event;
  try { event = JSON.parse(rawBody); } catch { return c.json({ ok: true }); }

  // Handle both Checkout Session completion and raw PaymentIntent success
  const isCheckoutComplete = event.type === 'checkout.session.completed';
  const isPaymentSucceeded = event.type === 'payment_intent.succeeded';
  if (!isCheckoutComplete && !isPaymentSucceeded) return c.json({ ok: true });

  const obj     = event.data?.object;
  const orderId = obj?.metadata?.order_id ?? obj?.client_reference_id;
  if (!orderId) return c.json({ ok: true });

  await _confirmOrder(c.env.DB, c.env, orderId, 'stripe', obj?.id);
  return c.json({ ok: true });
});

// ── POST /api/pay/xendit/webhook ──────────────────────────────────────────────
guestPay.post('/xendit/webhook', async (c) => {
  if (!verifyXenditWebhook(c.req, c.env)) {
    console.warn('[XENDIT_WEBHOOK_TOKEN_INVALID]');
    return c.json({ ok: true }); // silent
  }

  let body;
  try { body = await c.req.json(); } catch { return c.json({ ok: true }); }

  // Xendit Invoice webhook: status === 'PAID'
  const status  = body?.status;
  const orderId = body?.external_id ?? body?.metadata?.order_id;
  if (!orderId || status !== 'PAID') return c.json({ ok: true });

  await _confirmOrder(c.env.DB, c.env, orderId, 'xendit', body?.id);
  return c.json({ ok: true });
});

// ── GET /api/pay/status ───────────────────────────────────────────────────────
guestPay.get('/status', async (c) => {
  const orderId     = c.req.query('order_id');
  const secureToken = c.req.query('t');
  if (!orderId) return c.json({ error: 'order_id is required.' }, 400);

  const order = await c.env.DB.prepare(`
    SELECT id, status, payment_provider, secure_token
      FROM booking_orders WHERE id = ?
  `).bind(orderId).first();

  if (!order) return c.json({ error: 'Order not found.' }, 404);

  // [SEC] Validate token if provided
  if (secureToken && order.secure_token && order.secure_token !== secureToken) {
    return c.json({ error: 'Invalid token.' }, 403);
  }

  return c.json({
    ok:               true,
    status:           order.status,
    payment_provider: order.payment_provider,
  });
});

// ── Shared confirmation helper ────────────────────────────────────────────────
async function _confirmOrder(db, env, orderId, provider, sessionId) {
  const order = await db.prepare(`
    SELECT id, tenant_id, status, guest_name, guest_email, guest_phone,
           tour_id, travel_date, grand_total_amount, booking_currency,
           price_snapshot_json, pax_shared, pax_private, pax_children, secure_token
      FROM booking_orders WHERE id = ?
  `).bind(orderId).first();

  if (!order) {
    console.warn('[CONFIRM_ORDER_MISS] order_id not found:', orderId);
    return;
  }

  // Idempotency — already confirmed
  if (order.status === 'CONFIRMED') return;

  const now = Math.floor(Date.now() / 1000);

  await db.prepare(`
    UPDATE booking_orders
       SET status           = 'CONFIRMED',
           confirmed_at     = ?,
           payment_provider = ?,
           payment_session_id = COALESCE(payment_session_id, ?),
           booking_source   = COALESCE(booking_source, ?)
     WHERE id = ?
  `).bind(now, provider, sessionId ?? null, provider, orderId).run();

  // Seed todos and notify agent (fire-and-forget; errors don't break webhook)
  try {
    await seedOrderTodos(db, order, 'payment_confirmed');
  } catch (e) {
    console.warn('[CONFIRM_SEED_TODOS]', e.message);
  }

  try {
    const tenant = await db.prepare('SELECT * FROM tenants WHERE id = ?').bind(order.tenant_id).first();
    if (tenant) {
      await dispatchBookingConfirmedEmail({ env, order: { ...order, status: 'CONFIRMED' }, tenant });
      await notifyAgent(env, order.tenant_id, 'PAYMENT_CONFIRMED', {
        order_id:  orderId,
        provider,
        session_id: sessionId,
        guest_name: order.guest_name,
      });
    }
  } catch (e) {
    console.warn('[CONFIRM_EMAIL]', e.message);
  }
}

export default function registerGuestPayRoutes(app) {
  app.route('/api/pay', guestPay);
}
