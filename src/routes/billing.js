// src/routes/billing.js
// Stripe billing integration: Checkout Session creation + webhook handler.
//
// Endpoints:
//   POST /api/billing/checkout  — creates a Stripe Checkout Session (Subscription mode)
//   POST /api/billing/portal    — creates a Stripe Customer Portal session (manage/cancel/invoices)
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
//   [SEC] X-Tenant-ID header is required for /checkout and /portal — no anonymous sessions.

import { Hono } from 'hono';
import { dispatchBillingPaymentEmail, dispatchBillingActivationEmail, dispatchBillingStatusEmail, dispatchAdminAlertEmail } from '../lib/bookingEmails.js';
import { getAllowedMembershipUpgradeTargets } from '../lib/membershipBilling.js';

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

// ── POST /api/billing/addon ───────────────────────────────────────────────────
// Creates a Stripe Checkout Session to purchase one or more paid add-on slots.
//
// Request headers:
//   X-Tenant-ID  (required)
//
// Request body:
//   { addon_type: 'property' | 'staff', quantity?: number (default 1) }
//
// On checkout.session.completed with purchase_type='addon':
//   addon_type='property' → increments tenants.extra_property_slots
//   addon_type='staff'    → increments tenants.extra_staff_slots
//
// Pricing:
//   property slot: STRIPE_PRICE_ID_EXTRA_PROPERTY (4.99 EUR/month recurring)
//   staff slot:    STRIPE_PRICE_ID_EXTRA_STAFF    (1.00 EUR/month recurring)
billing.post('/addon', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const stripeKey = c.env.STRIPE_SECRET_KEY?.trim();
  const baseUrl   = (c.env.PLATFORM_BASE_URL ?? '').replace(/\/$/, '');
  if (!stripeKey) return c.json({ error: 'Stripe is not configured on this platform.' }, 503);

  const tenant = await c.env.DB
    .prepare('SELECT id, subscription_status, stripe_customer_id FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();
  if (!tenant) return c.json({ error: 'Tenant not found.' }, 404);

  if (!['ACTIVE', 'TRIAL'].includes(tenant.subscription_status)) {
    return c.json({ error: 'An active subscription is required to purchase add-ons.' }, 402);
  }

  let body = {};
  try { body = await c.req.json(); } catch { /* optional */ }

  const addonType = String(body.addon_type || '').trim();
  if (!['property', 'staff'].includes(addonType)) {
    return c.json({ error: 'addon_type must be "property" or "staff".' }, 400);
  }

  const quantity = Math.max(1, Math.min(50, parseInt(body.quantity ?? '1', 10) || 1));

  const priceId = addonType === 'property'
    ? c.env.STRIPE_PRICE_ID_EXTRA_PROPERTY?.trim()
    : c.env.STRIPE_PRICE_ID_EXTRA_STAFF?.trim();

  if (!priceId || priceId.startsWith('price_REPLACE_ME')) {
    return c.json({ error: `Add-on price for "${addonType}" is not configured yet. Contact support.` }, 503);
  }

  const sessionParams = new URLSearchParams({
    mode:                         'subscription',
    'line_items[0][price]':       priceId,
    'line_items[0][quantity]':    String(quantity),
    client_reference_id:          tenantId,
    'success_url':                `${baseUrl}/dashboard.html?addon_success=1&addon=${encodeURIComponent(addonType)}&qty=${quantity}`,
    'cancel_url':                 `${baseUrl}/dashboard.html?addon_cancelled=1`,
    'subscription_data[metadata][tenant_id]':  tenantId,
    'subscription_data[metadata][purchase_type]': 'addon',
    'subscription_data[metadata][addon_type]': addonType,
    'subscription_data[metadata][quantity]':   String(quantity),
    'metadata[purchase_type]': 'addon',
    'metadata[addon_type]':    addonType,
    'metadata[quantity]':      String(quantity),
  });

  if (tenant.stripe_customer_id) {
    sessionParams.set('customer', tenant.stripe_customer_id);
  }

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
      console.error('[BILLING_ADDON_ERROR]', data);
      return c.json({ error: `Stripe error: ${data?.error?.message ?? 'Unknown error'}.`, stripe_code: data?.error?.code }, 502);
    }
    session = data;
  } catch (err) {
    console.error('[BILLING_ADDON_FETCH_ERROR]', err.message);
    return c.json({ error: 'Failed to reach Stripe API. Try again.' }, 502);
  }

  if (!tenant.stripe_customer_id && session.customer) {
    await c.env.DB
      .prepare('UPDATE tenants SET stripe_customer_id = ? WHERE id = ?')
      .bind(session.customer, tenantId)
      .run();
  }

  return c.json({ ok: true, checkout_url: session.url, session_id: session.id, addon_type: addonType, quantity });
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

      // ── Add-on slot purchase ──────────────────────────────────────────────
      // purchase_type='addon' increments extra_property_slots or extra_staff_slots.
      if (obj.metadata?.purchase_type === 'addon') {
        const addonType = obj.metadata?.addon_type ?? '';
        const qty       = Math.max(1, parseInt(obj.metadata?.quantity ?? '1', 10) || 1);
        const col       = addonType === 'property' ? 'extra_property_slots'
                        : addonType === 'staff'    ? 'extra_staff_slots'
                        : null;

        if (!col) {
          console.warn(`[BILLING_WEBHOOK] addon session ${sessionId} unknown addon_type="${addonType}"`);
          return c.json({ ok: true, note: 'addon_unknown_type' });
        }

        // Idempotency
        const addonAlready = await c.env.DB
          .prepare(
            `SELECT id FROM tenant_audit_log
              WHERE tenant_id = ? AND action = 'BILLING_ADDON_PURCHASED' AND old_value = ?
              LIMIT 1`
          )
          .bind(tenantId, sessionId)
          .first();
        if (addonAlready) {
          console.log(`[BILLING_WEBHOOK] addon session ${sessionId} already processed.`);
          return c.json({ ok: true, note: 'already_processed' });
        }

        await c.env.DB
          .prepare(`UPDATE tenants SET ${col} = ${col} + ? WHERE id = ?`)
          .bind(qty, tenantId)
          .run();

        if (customerId) {
          await c.env.DB
            .prepare('UPDATE tenants SET stripe_customer_id = COALESCE(stripe_customer_id, ?) WHERE id = ?')
            .bind(customerId, tenantId)
            .run();
        }

        await c.env.DB
          .prepare(
            `INSERT INTO tenant_audit_log (id, tenant_id, action, field_name, old_value, new_value, created_at)
             VALUES (?, ?, 'BILLING_ADDON_PURCHASED', ?, ?, ?, ?)`
          )
          .bind(
            crypto.randomUUID().replace(/-/g, '').slice(0, 21),
            tenantId,
            col,
            sessionId,      // old_value used as idempotency key
            String(qty),
            Math.floor(Date.now() / 1000)
          )
          .run();

        console.log(`[BILLING_WEBHOOK] ✓ Tenant ${tenantId} addon=${addonType} qty=${qty} col=${col}`);
        return c.json({ ok: true, addon_credited: addonType, quantity: qty, tenant_id: tenantId });
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

      // Send welcome / activation email to the tenant
      const activatedTenant = await c.env.DB
        .prepare('SELECT name, email FROM tenants WHERE id = ?')
        .bind(tenantId)
        .first();
      if (activatedTenant?.email) {
        c.executionCtx.waitUntil(
          dispatchBillingActivationEmail(c.env, {
            tenantId,
            tenantName:  activatedTenant.name,
            tenantEmail: activatedTenant.email,
          })
        );
      }

      return c.json({ ok: true, activated: tenantId });
    }

    // ── Subscription cancelled ────────────────────────────────────────────────
    case 'customer.subscription.deleted': {
      const customerId = obj.customer ?? null;
      if (!customerId) return c.json({ ok: true, note: 'no_customer' });

      const tenant = await c.env.DB
        .prepare('SELECT id, name, email, subscription_status FROM tenants WHERE stripe_customer_id = ?')
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

      // Notify tenant
      if (tenant.email) {
        c.executionCtx.waitUntil(
          dispatchBillingStatusEmail(c.env, {
            tenantId:    tenant.id,
            tenantName:  tenant.name,
            tenantEmail: tenant.email,
            status:      'CANCELLED',
          })
        );
      }

      console.log(`[BILLING_WEBHOOK] ✓ Tenant ${tenant.id} subscription cancelled.`);
      return c.json({ ok: true, cancelled: tenant.id });
    }

    // ── Payment failed → suspend (soft block, not full cancellation) ──────────
    case 'invoice.payment_failed': {
      const customerId = obj.customer ?? null;
      if (!customerId) return c.json({ ok: true, note: 'no_customer' });

      const tenant = await c.env.DB
        .prepare('SELECT id, name, email, subscription_status FROM tenants WHERE stripe_customer_id = ?')
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

      // Notify tenant
      if (tenant.email) {
        c.executionCtx.waitUntil(
          dispatchBillingStatusEmail(c.env, {
            tenantId:    tenant.id,
            tenantName:  tenant.name,
            tenantEmail: tenant.email,
            status:      'SUSPENDED',
          })
        );
      }

      // Notify platform admin
      c.executionCtx.waitUntil(
        dispatchAdminAlertEmail(c.env, {
          subject:  `[Tours Market] Tenant SUSPENDED — payment failed`,
          bodyText: `Tenant ID: ${tenant.id}\nName: ${tenant.name || '—'}\nEmail: ${tenant.email || '—'}\nStatus: SUSPENDED\n\nAction required: check Stripe for failed invoice details.`,
        })
      );

      console.warn(`[BILLING_WEBHOOK] ⚠ Tenant ${tenant.id} SUSPENDED due to payment failure.`);
      return c.json({ ok: true, suspended: tenant.id });
    }

    // ── Invoice paid → send confirmation email ────────────────────────────────
    case 'invoice.payment_succeeded': {
      const customerId     = obj.customer ?? null;
      const amountPaid     = obj.amount_paid ?? 0;          // in cents
      const currency       = (obj.currency ?? 'eur').toUpperCase();
      const periodEnd      = obj.lines?.data?.[0]?.period?.end ?? null; // Unix timestamp
      const invoiceUrl     = obj.hosted_invoice_url ?? null;
      const billingReason  = obj.billing_reason ?? '';

      // Skip the very first invoice that's part of checkout.session.completed
      // to avoid duplicate "you're activated" + "payment confirmed" emails.
      if (billingReason === 'subscription_create') {
        return c.json({ ok: true, note: 'first_invoice_skip' });
      }

      if (!customerId) return c.json({ ok: true, note: 'no_customer' });

      const tenant = await c.env.DB
        .prepare('SELECT id, name, email, subscription_status FROM tenants WHERE stripe_customer_id = ?')
        .bind(customerId)
        .first();

      if (!tenant) return c.json({ ok: true, note: 'tenant_not_found' });

      // Format amount: cents → human-readable
      const amountFormatted = `${currency} ${(amountPaid / 100).toFixed(2)}`;

      c.executionCtx.waitUntil(
        dispatchBillingPaymentEmail(c.env, {
          tenantId:        tenant.id,
          tenantName:      tenant.name,
          tenantEmail:     tenant.email,
          amountFormatted,
          periodEnd,
          invoiceUrl,
        })
      );

      console.log(`[BILLING_WEBHOOK] ✓ Invoice paid for tenant ${tenant.id}: ${amountFormatted}`);
      return c.json({ ok: true, notified: tenant.id });
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
    .prepare('SELECT id, subscription_status, stripe_customer_id, created_at, extra_property_slots, extra_staff_slots, product_tier_key FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();

  if (!tenant) return c.json({ error: 'Tenant not found.' }, 404);

  const TRIAL_DAYS   = 180;
  const createdAt    = tenant.created_at ?? 0;
  const trialEndsAt  = createdAt + TRIAL_DAYS * 86400;
  const nowS         = Math.floor(Date.now() / 1000);
  const trialDaysLeft = Math.max(0, Math.ceil((trialEndsAt - nowS) / 86400));
  const productTierKey = String(tenant.product_tier_key || 'starter_landing').trim() || 'starter_landing';

  return c.json({
    ok:                  true,
    subscription_status: tenant.subscription_status,
    stripe_customer_id:  tenant.stripe_customer_id ?? null,
    product_tier_key:    productTierKey,
    available_membership_targets: getAllowedMembershipUpgradeTargets(productTierKey, tenant.subscription_status),
    trial_info: {
      trial_days_total: TRIAL_DAYS,
      trial_ends_at:    trialEndsAt,
      trial_days_left:  trialDaysLeft,
      trial_expired:    tenant.subscription_status === 'TRIAL' && nowS > trialEndsAt,
    },
    addons: {
      extra_property_slots: tenant.extra_property_slots ?? 0,
      extra_staff_slots:    tenant.extra_staff_slots ?? 0,
      pricing: {
        property_slot_eur: 4.99,
        staff_slot_eur:    1.00,
      },
      addon_url_hint: '/api/billing/addon',
    },
    checkout_url_hint: '/api/billing/checkout',
  });
});

// ── POST /api/billing/portal ──────────────────────────────────────────────────
// Creates a Stripe Customer Portal session so the tenant can:
//   - View and download past invoices
//   - Update their payment method (card)
//   - Cancel their subscription
//
// Request headers:
//   X-Tenant-ID  (required)
//
// Response 200:
//   { ok: true, portal_url: "https://billing.stripe.com/..." }
//
// [SEC] tenant_id resolved from session header — never trusted from body.
// [SEC] STRIPE_SECRET_KEY never exposed to client.
// [SEC] Tenant must have an existing stripe_customer_id (i.e. they have paid before).
billing.post('/portal', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const stripeKey = c.env.STRIPE_SECRET_KEY?.trim();
  const baseUrl   = (c.env.PLATFORM_BASE_URL ?? '').replace(/\/$/, '');

  if (!stripeKey) return c.json({ error: 'Stripe is not configured on this platform.' }, 503);

  const tenant = await c.env.DB
    .prepare('SELECT id, stripe_customer_id, subscription_status FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();

  if (!tenant) return c.json({ error: 'Tenant not found.' }, 404);

  if (!tenant.stripe_customer_id) {
    return c.json({ error: 'No billing account found. Please complete checkout first.' }, 400);
  }

  const portalParams = new URLSearchParams({
    customer:   tenant.stripe_customer_id,
    return_url: `${baseUrl}/dashboard.html`,
  });

  let portalSession;
  try {
    const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: portalParams.toString(),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('[BILLING_PORTAL_ERROR]', data);
      return c.json({
        error: `Stripe error: ${data?.error?.message ?? 'Unknown error'}.`,
        stripe_code: data?.error?.code,
      }, 502);
    }
    portalSession = data;
  } catch (err) {
    console.error('[BILLING_PORTAL_FETCH_ERROR]', err.message);
    return c.json({ error: 'Failed to reach Stripe API. Try again.' }, 502);
  }

  return c.json({ ok: true, portal_url: portalSession.url });
});

// ── POST /api/billing/redeem-promo ────────────────────────────────────────────
// Tenant redeems a promo code to activate their subscription without Stripe.
// Body: { code: string }
billing.post('/redeem-promo', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header required.' }, 400);

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Invalid JSON body.' }, 400); }

  const code = String(body?.code || '').toUpperCase().trim().replace(/\s+/g, '');
  if (!code) return c.json({ error: 'code is required.' }, 400);

  const promo = await c.env.DB
    .prepare('SELECT * FROM promo_codes WHERE code = ?')
    .bind(code)
    .first();
  if (!promo) return c.json({ error: 'Invalid promo code.' }, 400);

  const now = Math.floor(Date.now() / 1000);

  if (promo.expires_at && promo.expires_at < now) {
    return c.json({ error: 'This promo code has expired.' }, 400);
  }
  if (promo.max_uses !== null && promo.uses_count >= promo.max_uses) {
    return c.json({ error: 'This promo code has reached its usage limit.' }, 400);
  }

  // Idempotent: prevent double-redemption per tenant
  const already = await c.env.DB
    .prepare('SELECT id FROM promo_code_redemptions WHERE code_id = ? AND tenant_id = ?')
    .bind(promo.id, tenantId)
    .first();
  if (already) return c.json({ error: 'You have already redeemed this promo code.' }, 400);

  const tenant = await c.env.DB
    .prepare('SELECT id, subscription_status FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();
  if (!tenant) return c.json({ error: 'Tenant not found.' }, 404);

  const redemptionId = crypto.randomUUID().replace(/-/g, '').slice(0, 21);
  const oldStatus    = tenant.subscription_status;

  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE tenants SET subscription_status = ?, promo_activated = 1 WHERE id = ?')
      .bind('ACTIVE', tenantId),
    c.env.DB.prepare('INSERT INTO promo_code_redemptions (id, code_id, tenant_id, redeemed_at) VALUES (?, ?, ?, ?)')
      .bind(redemptionId, promo.id, tenantId, now),
    c.env.DB.prepare('UPDATE promo_codes SET uses_count = uses_count + 1 WHERE id = ?')
      .bind(promo.id),
    c.env.DB.prepare(
      `INSERT INTO tenant_audit_log (id, tenant_id, field_name, old_value, new_value, changed_at, changed_by)
       VALUES (?, ?, 'subscription_status', ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), tenantId, oldStatus, 'ACTIVE', now, `promo:${code}`),
  ]);

  console.info(`[PROMO_REDEEMED] tenant=${tenantId} code=${code} duration_days=${promo.duration_days}`);

  const message = promo.duration_days
    ? `Promo code accepted! Your account is active for ${promo.duration_days} days.`
    : 'Promo code accepted! Your account is now active.';

  return c.json({ ok: true, message, duration_days: promo.duration_days ?? null });
});

export default function registerBillingRoutes(app) {
  app.route('/api/billing', billing);
}
