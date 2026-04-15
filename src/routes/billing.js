// src/routes/billing.js
// Stripe billing integration: Checkout Session creation + webhook handler.
//
// Endpoints:
//   POST /api/billing/checkout  — creates a Stripe Checkout Session (Subscription mode)
//   POST /api/billing/webhook   — receives Stripe events, upgrades subscription on success
//   GET  /api/billing/status    — returns current subscription + trial info for the tenant
//
// Environment bindings required (set in wrangler.jsonc vars or .dev.vars):
//   STRIPE_SECRET_KEY       — sk_live_… / sk_test_…  (never exposed to client)
//   STRIPE_WEBHOOK_SECRET   — whsec_…  (from Stripe Dashboard → Webhooks)
//   STRIPE_PRICE_ID         — price_…  (the recurring Subscription price to checkout)
//   PLATFORM_BASE_URL       — e.g. https://app.platform.com  (for success/cancel URLs)
//
// Security notes:
//   [SEC] Raw body is read ONCE before any JSON parsing to ensure webhook signature
//         is computed over the exact bytes Stripe sent (not a re-serialised object).
//   [SEC] tenant_id is stored in client_reference_id on the Checkout Session so the
//         webhook can resolve it without trusting user-supplied payload fields.
//   [SEC] Stripe-Signature header is validated via HMAC-SHA256 with timestamp
//         tolerance (±5 minutes) before any DB mutation occurs.
//   [SEC] X-Tenant-ID header is required for /checkout — no anonymous sessions.

import { Hono } from 'hono';

const billing = new Hono();

// ── Stripe HMAC-SHA256 webhook signature verification ─────────────────────────
// Implements the standard Stripe-Signature format:
//   Stripe-Signature: t=<unix_ts>,v1=<hex_hmac>
// Signed payload: "<t>.<rawBody>"
//
// Tolerance: 300 seconds (5 minutes) to cover clock skew. Replayed events
// that are older than 5 min will be rejected even if the signature is valid.
const STRIPE_SIG_TOLERANCE_S = 300;

async function verifyStripeSignature(rawBody, stripeSignatureHeader, secret) {
  try {
    if (!stripeSignatureHeader || !secret) return false;

    const tMatch  = stripeSignatureHeader.match(/t=(\d+)/);
    const v1Match = stripeSignatureHeader.match(/v1=([a-f0-9]+)/);
    if (!tMatch || !v1Match) return false;

    const timestamp = parseInt(tMatch[1], 10);
    const nowS      = Math.floor(Date.now() / 1000);
    if (Math.abs(nowS - timestamp) > STRIPE_SIG_TOLERANCE_S) {
      console.warn('[BILLING_WEBHOOK] Stripe-Signature timestamp out of tolerance window.');
      return false;
    }

    const enc      = new TextEncoder();
    const keyBytes = enc.encode(secret);
    const key      = await crypto.subtle.importKey(
      'raw', keyBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['verify']
    );

    const signedPayload = `${tMatch[1]}.${rawBody}`;
    const sigBytes      = hexToBytes(v1Match[1]);

    return await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(signedPayload));
  } catch (err) {
    console.warn('[BILLING_WEBHOOK_SIG_ERROR]', err.message);
    return false;
  }
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ── POST /api/billing/checkout ────────────────────────────────────────────────
// Creates a Stripe Checkout Session in Subscription mode.
//
// Request headers:
//   X-Tenant-ID  (required)
//
// Request body (optional overrides):
//   { price_id?: string }   — override default STRIPE_PRICE_ID for this session
//
// Response 200:
//   { ok: true, checkout_url: "https://checkout.stripe.com/..." }
//
// [SEC] tenant_id stored in client_reference_id — webhook resolves it server-side.
// [SEC] STRIPE_SECRET_KEY never sent to client in any response field.
billing.post('/checkout', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const stripeKey   = c.env.STRIPE_SECRET_KEY?.trim();
  const defaultPrice = c.env.STRIPE_PRICE_ID?.trim();
  const baseUrl     = (c.env.PLATFORM_BASE_URL ?? '').replace(/\/$/, '');

  if (!stripeKey)    return c.json({ error: 'Stripe is not configured on this platform.' }, 503);
  if (!defaultPrice) return c.json({ error: 'No Stripe Price ID configured. Contact platform support.' }, 503);

  // Validate tenant exists
  const tenant = await c.env.DB
    .prepare('SELECT id, subscription_status, stripe_customer_id FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();
  if (!tenant) return c.json({ error: 'Tenant not found.' }, 404);

  // Already active — no need to checkout again (idempotency guard)
  if (tenant.subscription_status === 'ACTIVE') {
    return c.json({
      ok:      true,
      skipped: true,
      message: 'Subscription is already ACTIVE.',
      subscription_status: 'ACTIVE',
    });
  }

  let body = {};
  try { body = await c.req.json(); } catch { /* optional body */ }

  // Allow per-request price override (e.g. different plan tiers) but
  // validate format to prevent injection into Stripe API call.
  const priceId = (body.price_id && /^price_[a-zA-Z0-9_]+$/.test(body.price_id))
    ? body.price_id
    : defaultPrice;

  // Build Checkout Session params
  const sessionParams = new URLSearchParams({
    mode:                        'subscription',
    'line_items[0][price]':      priceId,
    'line_items[0][quantity]':   '1',
    client_reference_id:         tenantId,          // [SEC] resolved in webhook — do not trust body
    'success_url':               `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}&tenant=${encodeURIComponent(tenantId)}`,
    'cancel_url':                `${baseUrl}/billing/cancel?tenant=${encodeURIComponent(tenantId)}`,
    'subscription_data[metadata][tenant_id]': tenantId,
  });

  // Attach existing Stripe customer to avoid duplicate customer records
  if (tenant.stripe_customer_id) {
    sessionParams.set('customer', tenant.stripe_customer_id);
  }

  // Call Stripe API (Workers-compatible fetch — no Node SDK needed)
  let session;
  try {
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: sessionParams.toString(),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('[BILLING_CHECKOUT_ERROR]', data);
      return c.json({
        error: `Stripe error: ${data?.error?.message ?? 'Unknown error'}.`,
        stripe_code: data?.error?.code,
      }, 502);
    }
    session = data;
  } catch (err) {
    console.error('[BILLING_CHECKOUT_FETCH_ERROR]', err.message);
    return c.json({ error: 'Failed to reach Stripe API. Try again.' }, 502);
  }

  // Persist stripe_customer_id if this is the first session for this tenant
  if (!tenant.stripe_customer_id && session.customer) {
    await c.env.DB
      .prepare('UPDATE tenants SET stripe_customer_id = ? WHERE id = ?')
      .bind(session.customer, tenantId)
      .run();
  }

  return c.json({
    ok:           true,
    checkout_url: session.url,
    session_id:   session.id,
  });
});

// ── POST /api/billing/webhook ─────────────────────────────────────────────────
// Receives Stripe events and updates tenant subscription status.
//
// Handled events:
//   checkout.session.completed  → subscription_status = 'ACTIVE', save stripe_customer_id
//   customer.subscription.deleted → subscription_status = 'CANCELLED'
//   invoice.payment_failed        → subscription_status = 'SUSPENDED' (soft block)
//
// [SEC] Raw body is consumed BEFORE parsing so the HMAC is computed over
//       exact wire bytes, not a re-serialised JSON string.
// [SEC] Idempotency: digest of session_id stored in tenant_audit_log prevents
//       double-processing replayed events.
// [SEC] Always returns 200 to Stripe (even on rejection) to suppress retries
//       for non-actionable events. Malformed / invalid-signature events return
//       200 with ok:false in the body for debugging, never 4xx.
billing.post('/webhook', async (c) => {
  // Read raw body before any parsing
  let rawBody;
  try { rawBody = await c.req.text(); }
  catch { return c.json({ ok: true, note: 'body_read_failed' }); }

  const webhookSecret = c.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    // Webhook secret not configured — reject silently but log loudly
    console.error('[BILLING_WEBHOOK] STRIPE_WEBHOOK_SECRET is not set. Cannot process webhooks.');
    return c.json({ ok: false, error: 'Webhook secret not configured.' });
  }

  // ── Signature validation ──────────────────────────────────────────────────
  const sigHeader = c.req.header('stripe-signature') ?? '';
  const valid = await verifyStripeSignature(rawBody, sigHeader, webhookSecret);
  if (!valid) {
    console.warn('[BILLING_WEBHOOK] Invalid or expired Stripe-Signature — rejecting event.');
    return c.json({ ok: false, error: 'Invalid signature.' });
  }

  // ── Parse event ───────────────────────────────────────────────────────────
  let event;
  try { event = JSON.parse(rawBody); }
  catch { return c.json({ ok: false, error: 'Malformed JSON body.' }); }

  const eventType = event?.type ?? '';
  const obj       = event?.data?.object ?? {};

  // ── Route by event type ───────────────────────────────────────────────────
  switch (eventType) {

    // ── Checkout completed → activate subscription ──────────────────────────
    case 'checkout.session.completed': {
      const sessionId  = obj.id ?? '';
      const tenantId   = obj.client_reference_id ?? '';
      const customerId = obj.customer ?? null;

      if (!tenantId) {
        console.warn('[BILLING_WEBHOOK] checkout.session.completed missing client_reference_id', sessionId);
        return c.json({ ok: true, note: 'no_tenant_ref' });
      }

      // Domain purchases are handled by /api/domains/stripe-webhook — skip here.
      if (obj.metadata?.purchase_type === 'domain') {
        return c.json({ ok: true, note: 'domain_purchase_skip' });
      }

      // Idempotency: check if this session was already processed
      const alreadyProcessed = await c.env.DB
        .prepare(
          `SELECT id FROM tenant_audit_log
            WHERE tenant_id = ? AND action = 'BILLING_CHECKOUT_COMPLETE'
              AND old_value = ?
            LIMIT 1`
        )
        .bind(tenantId, sessionId)
        .first();

      if (alreadyProcessed) {
        console.log(`[BILLING_WEBHOOK] session ${sessionId} already processed — skipping.`);
        return c.json({ ok: true, note: 'already_processed' });
      }

      // Activate tenant
      await c.env.DB
        .prepare(
          `UPDATE tenants
             SET subscription_status = 'ACTIVE',
                 stripe_customer_id  = COALESCE(stripe_customer_id, ?)
           WHERE id = ?`
        )
        .bind(customerId, tenantId)
        .run();

      // Audit log for idempotency + legal record
      await c.env.DB
        .prepare(
          `INSERT INTO tenant_audit_log (id, tenant_id, action, field_name, old_value, new_value, created_at)
           VALUES (?, ?, 'BILLING_CHECKOUT_COMPLETE', 'subscription_status', ?, 'ACTIVE', ?)`
        )
        .bind(
          /* nanoid via crypto */ crypto.randomUUID().replace(/-/g, '').slice(0, 21),
          tenantId,
          sessionId,   // stored in old_value for idempotency lookup
          Math.floor(Date.now() / 1000)
        )
        .run();

      console.log(`[BILLING_WEBHOOK] ✓ Tenant ${tenantId} activated via session ${sessionId}`);
      return c.json({ ok: true, activated: tenantId });
    }

    // ── Subscription cancelled ────────────────────────────────────────────────
    case 'customer.subscription.deleted': {
      const customerId = obj.customer ?? null;
      if (!customerId) return c.json({ ok: true, note: 'no_customer' });

      const tenant = await c.env.DB
        .prepare('SELECT id, subscription_status FROM tenants WHERE stripe_customer_id = ?')
        .bind(customerId)
        .first();

      if (!tenant) return c.json({ ok: true, note: 'tenant_not_found' });

      await c.env.DB
        .prepare("UPDATE tenants SET subscription_status = 'CANCELLED' WHERE id = ?")
        .bind(tenant.id)
        .run();

      await c.env.DB
        .prepare(
          `INSERT INTO tenant_audit_log (id, tenant_id, action, field_name, old_value, new_value, created_at)
           VALUES (?, ?, 'BILLING_SUB_CANCELLED', 'subscription_status', ?, 'CANCELLED', ?)`
        )
        .bind(
          crypto.randomUUID().replace(/-/g, '').slice(0, 21),
          tenant.id,
          tenant.subscription_status,
          Math.floor(Date.now() / 1000)
        )
        .run();

      console.log(`[BILLING_WEBHOOK] ✓ Tenant ${tenant.id} subscription cancelled.`);
      return c.json({ ok: true, cancelled: tenant.id });
    }

    // ── Payment failed → suspend (soft block, not full cancellation) ──────────
    case 'invoice.payment_failed': {
      const customerId = obj.customer ?? null;
      if (!customerId) return c.json({ ok: true, note: 'no_customer' });

      const tenant = await c.env.DB
        .prepare('SELECT id, subscription_status FROM tenants WHERE stripe_customer_id = ?')
        .bind(customerId)
        .first();

      // Only suspend ACTIVE tenants — don't overwrite TRIAL or CANCELLED
      if (!tenant || tenant.subscription_status !== 'ACTIVE') {
        return c.json({ ok: true, note: 'not_active_skip' });
      }

      await c.env.DB
        .prepare("UPDATE tenants SET subscription_status = 'SUSPENDED' WHERE id = ?")
        .bind(tenant.id)
        .run();

      await c.env.DB
        .prepare(
          `INSERT INTO tenant_audit_log (id, tenant_id, action, field_name, old_value, new_value, created_at)
           VALUES (?, ?, 'BILLING_PAYMENT_FAILED', 'subscription_status', 'ACTIVE', 'SUSPENDED', ?)`
        )
        .bind(
          crypto.randomUUID().replace(/-/g, '').slice(0, 21),
          tenant.id,
          Math.floor(Date.now() / 1000)
        )
        .run();

      console.warn(`[BILLING_WEBHOOK] ⚠ Tenant ${tenant.id} SUSPENDED due to payment failure.`);
      return c.json({ ok: true, suspended: tenant.id });
    }

    // ── Unhandled event type — return 200 silently ─────────────────────────
    default:
      return c.json({ ok: true, note: `unhandled_event:${eventType}` });
  }
});

// ── GET /api/billing/status ───────────────────────────────────────────────────
// Returns current subscription status + trial context for the dashboard.
//
// Response:
//   { ok, subscription_status, stripe_customer_id, trial_info }
billing.get('/status', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const tenant = await c.env.DB
    .prepare('SELECT id, subscription_status, stripe_customer_id, created_at FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();

  if (!tenant) return c.json({ error: 'Tenant not found.' }, 404);

  const TRIAL_DAYS   = 180;
  const createdAt    = tenant.created_at ?? 0;
  const trialEndsAt  = createdAt + TRIAL_DAYS * 86400;
  const nowS         = Math.floor(Date.now() / 1000);
  const trialDaysLeft = Math.max(0, Math.ceil((trialEndsAt - nowS) / 86400));

  return c.json({
    ok:                  true,
    subscription_status: tenant.subscription_status,
    stripe_customer_id:  tenant.stripe_customer_id ?? null,
    trial_info: {
      trial_days_total: TRIAL_DAYS,
      trial_ends_at:    trialEndsAt,
      trial_days_left:  trialDaysLeft,
      trial_expired:    tenant.subscription_status === 'TRIAL' && nowS > trialEndsAt,
    },
    checkout_url_hint: '/api/billing/checkout',
  });
});

export default function registerBillingRoutes(app) {
  app.route('/api/billing', billing);
}
