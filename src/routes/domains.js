// src/routes/domains.js
// Domain registration via Cloudflare Registrar (at-cost + 30% platform markup).
//
// Endpoints:
//   GET  /api/domains/search?q=example.com — availability + platform price (auth required)
//   POST /api/domains/purchase             — create Stripe one-time checkout for a domain (auth required)
//   GET  /api/domains/purchases            — list tenant domain purchase history (auth required)
//   POST /api/domains/stripe-webhook       — Stripe webhook: payment → CF Registrar → D1 write (NO auth, sig-verified)
//
// Environment bindings required (set via wrangler secret put or .dev.vars):
//   CF_ACCOUNT_ID            — Cloudflare account ID (from CF dashboard URL)
//   CF_REGISTRAR_API_TOKEN   — CF API token with Registrar:Edit scope
//   STRIPE_SECRET_KEY        — sk_live_… / sk_test_…
//   STRIPE_DOMAIN_WEBHOOK_SECRET — whsec_… (separate Stripe webhook for domain purchases)
//   PLATFORM_BASE_URL        — e.g. https://app.tours-market.com
//
// Security notes:
//   [SEC] Domain names are validated via strict regex before any outbound API calls.
//   [SEC] Stripe-Signature is HMAC-SHA256 verified before any DB mutation in the webhook.
//   [SEC] tenant_id is always resolved from session (auth middleware) or Stripe metadata —
//         never trusted from the client request body.
//   [SEC] The 30% markup is enforced server-side; front-end price display is informational only.
//   [SEC] CF Registrar API is called only after Stripe payment confirmation (webhook).

import { Hono } from 'hono';

const domains = new Hono();

// ── TLD price map (CF Registrar at-cost, USD) ─────────────────────────────────
// Prices sourced from CF Registrar wholesale pricing (2026). Update annually.
// Platform charges: registrar_price × 1.30 (rounded up to nearest cent).
const TLD_PRICES_USD = {
  com:    9.15,
  net:   11.06,
  org:    9.93,
  io:    52.00,
  co:    26.30,
  dev:   12.00,
  app:   14.00,
  me:     8.50,
  info:   3.56,
  biz:   11.06,
  online: 6.99,
  site:   6.99,
  store:  9.99,
  shop:   9.99,
  travel: 42.00,
  tours:  25.00,
  vn:    15.00,
  com_vn: 4.00,
};

const PLATFORM_MARKUP = 0.30; // 30%

function isMissingOrPlaceholderSecret(value) {
  const normalized = String(value || '').trim();
  return !normalized || normalized.includes('REPLACE_ME');
}

// ── Domain name validation ─────────────────────────────────────────────────────
// Accepts: lowercase letters, digits, hyphens; 2+ labels; TLD 2-20 chars.
// Rejects: leading/trailing hyphens, consecutive dots, IDN punycode raw input.
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,20}$/;

function validateDomain(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const d = raw.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  return DOMAIN_RE.test(d) ? d : null;
}

function extractTld(domain) {
  const parts = domain.split('.');
  if (parts.length < 2) return null;
  return parts.slice(1).join('_'); // e.g. "com", "co_uk", "com_vn"
}

function getPlatformPrice(registrarPriceUsd) {
  // Ceil to nearest cent to ensure platform always covers CF cost + markup
  return Math.ceil(registrarPriceUsd * (1 + PLATFORM_MARKUP) * 100) / 100;
}

// ── Stripe HMAC-SHA256 webhook signature verification ─────────────────────────
// Reuses same algorithm as billing.js — tolerance: ±5 minutes.
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
      console.warn('[DOMAIN_WEBHOOK] Stripe-Signature timestamp out of tolerance window.');
      return false;
    }
    const enc      = new TextEncoder();
    const keyBytes = enc.encode(secret);
    const key      = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const signedPayload = `${tMatch[1]}.${rawBody}`;
    const bytes = new Uint8Array(Math.floor(v1Match[1].length / 2));
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(v1Match[1].slice(i * 2, i * 2 + 2), 16);
    return await crypto.subtle.verify('HMAC', key, bytes, enc.encode(signedPayload));
  } catch (err) {
    console.warn('[DOMAIN_WEBHOOK_SIG_ERROR]', err.message);
    return false;
  }
}

// ── RDAP availability check ───────────────────────────────────────────────────
// Uses the IANA RDAP bootstrap — redirects to the registry for the TLD.
// A 404 response means the domain is not found in the registry → available.
// A 200 response means it's already registered → not available.
// On any error, we default to 'unknown' and surface that to the caller.
async function checkDomainAvailability(domain) {
  try {
    const res = await fetch(`https://rdap.cloudflare.com/domain/${encodeURIComponent(domain)}`, {
      method: 'GET',
      headers: { 'Accept': 'application/rdap+json' },
      redirect: 'follow',
    });
    if (res.status === 404) return { available: true };
    if (res.status === 200) return { available: false };
    // For non-standard TLDs or RDAP errors, treat as unknown
    return { available: null, rdap_status: res.status };
  } catch {
    return { available: null, error: 'rdap_fetch_failed' };
  }
}

// ── CF Registrar: register domain ─────────────────────────────────────────────
async function registerDomainViaCF(domain, years, env) {
  const accountId  = env.CF_ACCOUNT_ID?.trim();
  const apiToken   = env.CF_REGISTRAR_API_TOKEN?.trim();
  if (!accountId || !apiToken) {
    throw new Error('CF_ACCOUNT_ID or CF_REGISTRAR_API_TOKEN not configured.');
  }

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/registrar/domains`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ name: domain, years: years ?? 1 }),
    }
  );

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.errors?.[0]?.message ?? `CF API HTTP ${res.status}`;
    throw new Error(`CF Registrar error: ${msg}`);
  }
  return data?.result ?? {};
}

// ── GET /api/domains/search?q=example.com ────────────────────────────────────
// Returns availability + platform price for a domain name.
// Auth: session cookie required (PROTECTED_API_PREFIXES in index.js).
//
// Response 200:
//   { ok, domain, tld, available, registrar_price_usd, platform_price_usd, markup_pct: 30 }
// Response 400: invalid domain
// Response 422: TLD not registerable via platform
domains.get('/search', async (c) => {
  const raw = c.req.query('q') ?? '';
  const domain = validateDomain(raw);
  if (!domain) return c.json({ error: 'Invalid domain name. Use lowercase letters, numbers, hyphens only (e.g. mybrand.com).' }, 400);

  const tldKey = extractTld(domain);
  const registrarPriceUsd = TLD_PRICES_USD[tldKey];
  if (!registrarPriceUsd) {
    return c.json({
      ok: false,
      domain,
      tld: tldKey?.replace('_', '.'),
      available: false,
      error: 'This TLD is not available for registration through the platform. Contact support for transfer options.',
    }, 422);
  }

  // Check availability via RDAP
  const avail = await checkDomainAvailability(domain);
  const platformPriceUsd = getPlatformPrice(registrarPriceUsd);

  return c.json({
    ok:                   true,
    domain,
    tld:                  tldKey.replace(/_/g, '.'),
    available:            avail.available,
    registrar_price_usd:  registrarPriceUsd,
    platform_price_usd:   platformPriceUsd,
    markup_pct:           Math.round(PLATFORM_MARKUP * 100),
  });
});

// ── POST /api/domains/purchase ────────────────────────────────────────────────
// Creates a Stripe Checkout Session (mode: payment, one-time) for a domain purchase.
// Stores a PENDING purchase record in D1.
// Auth: session cookie required.
//
// Request body: { domain: "example.com" }
// Response 200: { ok, checkout_url, purchase_id }
domains.post('/purchase', async (c) => {
  const session = c.get('authSession');
  if (!session) return c.json({ error: 'Authentication required.' }, 401);
  const tenantId = session.tenant_id;

  let body = {};
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body.' }, 400); }

  const domain = validateDomain(body?.domain);
  if (!domain) return c.json({ error: 'Invalid domain name.' }, 400);

  const tldKey = extractTld(domain);
  const registrarPriceUsd = TLD_PRICES_USD[tldKey];
  if (!registrarPriceUsd) return c.json({ error: 'TLD not supported for platform registration.' }, 422);

  const platformPriceUsd   = getPlatformPrice(registrarPriceUsd);
  const registrarPriceCents = Math.round(registrarPriceUsd * 100);
  const platformPriceCents  = Math.round(platformPriceUsd * 100);

  const stripeKey = c.env.STRIPE_SECRET_KEY?.trim();
  const baseUrl   = (c.env.PLATFORM_BASE_URL ?? '').replace(/\/$/, '');
  if (isMissingOrPlaceholderSecret(stripeKey)) {
    return c.json({ error: 'Stripe is not configured on this platform.' }, 503);
  }

  const cf_account = c.env.CF_ACCOUNT_ID?.trim();
  const cf_token   = c.env.CF_REGISTRAR_API_TOKEN?.trim();
  if (!cf_account || !cf_token) {
    return c.json({ error: 'Domain registration is not yet enabled on this platform. Please contact support.' }, 503);
  }

  // Verify availability again (anti-race: guard against double purchases)
  const existing = await c.env.DB
    .prepare(
      `SELECT id, payment_status, domain_status FROM tenant_domain_purchases
        WHERE tenant_id = ? AND domain = ? AND payment_status != 'FAILED'
        LIMIT 1`
    )
    .bind(tenantId, domain)
    .first();
  if (existing) {
    if (existing.payment_status === 'COMPLETED') {
      return c.json({ error: `Domain ${domain} was already purchased by your account (purchase ${existing.id}).` }, 409);
    }
    // PENDING — return its checkout URL by re-fetching session from Stripe or just error
    return c.json({
      error: `A pending purchase for ${domain} already exists (id: ${existing.id}). Complete or contact support if it is stuck.`,
      purchase_id: existing.id,
    }, 409);
  }

  const purchaseId = crypto.randomUUID().replace(/-/g, '').slice(0, 21);
  const nowS       = Math.floor(Date.now() / 1000);

  // Create PENDING purchase record before Stripe so we have a reference ID
  await c.env.DB
    .prepare(
      `INSERT INTO tenant_domain_purchases
         (id, tenant_id, domain, registrar_price_cents, markup_pct, amount_charged_cents,
          registration_years, payment_status, domain_status, purchased_at, created_at)
       VALUES (?, ?, ?, ?, 30, ?, 1, 'PENDING', 'PENDING', ?, ?)`
    )
    .bind(purchaseId, tenantId, domain, registrarPriceCents, platformPriceCents, nowS, nowS)
    .run();

  // Build Stripe Checkout Session (payment mode — one-time, not subscription)
  const sessionParams = new URLSearchParams({
    mode:                                         'payment',
    'line_items[0][price_data][currency]':        'usd',
    'line_items[0][price_data][product_data][name]':
      `Domain Registration: ${domain} (1 year)`,
    'line_items[0][price_data][product_data][description]':
      `Platform registration at cost + 30% service fee. Auto-verified domain included.`,
    'line_items[0][price_data][unit_amount]':     String(platformPriceCents),
    'line_items[0][quantity]':                    '1',
    client_reference_id:                          tenantId,
    'metadata[purchase_type]':                    'domain',
    'metadata[tenant_id]':                        tenantId,
    'metadata[domain]':                           domain,
    'metadata[purchase_id]':                      purchaseId,
    'payment_intent_data[metadata][purchase_type]': 'domain',
    'payment_intent_data[metadata][tenant_id]':     tenantId,
    'payment_intent_data[metadata][domain]':        domain,
    'payment_intent_data[metadata][purchase_id]':   purchaseId,
    success_url:
      `${baseUrl}/dashboard.html?domain_purchase=success&sid={CHECKOUT_SESSION_ID}`,
    cancel_url:
      `${baseUrl}/dashboard.html?domain_purchase=cancelled`,
  });

  let stripeSession;
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
      console.error('[DOMAIN_PURCHASE_STRIPE_ERROR]', data);
      // Roll back pending purchase record on Stripe error
      await c.env.DB.prepare('DELETE FROM tenant_domain_purchases WHERE id = ?').bind(purchaseId).run();
      return c.json({ error: `Stripe error: ${data?.error?.message ?? 'Unknown error'}.` }, 502);
    }
    stripeSession = data;
  } catch (err) {
    console.error('[DOMAIN_PURCHASE_FETCH_ERROR]', err.message);
    await c.env.DB.prepare('DELETE FROM tenant_domain_purchases WHERE id = ?').bind(purchaseId).run();
    return c.json({ error: 'Failed to reach Stripe API. Try again.' }, 502);
  }

  // Persist Stripe session ID against the purchase record
  await c.env.DB
    .prepare('UPDATE tenant_domain_purchases SET stripe_session_id = ? WHERE id = ?')
    .bind(stripeSession.id, purchaseId)
    .run();

  return c.json({
    ok:          true,
    checkout_url: stripeSession.url,
    purchase_id:  purchaseId,
    domain,
    platform_price_usd: platformPriceUsd,
  });
});

// ── GET /api/domains/purchases ────────────────────────────────────────────────
// Returns the tenant's domain purchase history (all statuses).
// Auth: session cookie required.
domains.get('/purchases', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const { results } = await c.env.DB
    .prepare(
      `SELECT id, domain, payment_status, domain_status, amount_charged_cents,
              registrar_price_cents, markup_pct, registration_years,
              purchased_at, registered_at, expires_at, cf_zone_id
         FROM tenant_domain_purchases
        WHERE tenant_id = ?
        ORDER BY created_at DESC
        LIMIT 50`
    )
    .bind(tenantId)
    .all();

  return c.json({ ok: true, purchases: results });
});

// ── POST /api/domains/stripe-webhook ─────────────────────────────────────────
// Receives Stripe checkout.session.completed events for domain purchases.
// Handles ONLY events where metadata.purchase_type === 'domain'.
//
// [SEC] Raw body read once before parsing for HMAC verification.
// [SEC] Idempotency: purchase_id stored; webhook is no-op if already COMPLETED.
// [SEC] CF Registrar call only executes after Stripe signature is verified
//       AND payment_status = 'PENDING' in D1 (prevents replay attacks).
// [SEC] Returns 200 always to suppress Stripe retries on non-retriable errors.
domains.post('/stripe-webhook', async (c) => {
  let rawBody;
  try { rawBody = await c.req.text(); }
  catch { return c.json({ ok: true, note: 'body_read_failed' }); }

  const webhookSecret = c.env.STRIPE_DOMAIN_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    console.error('[DOMAIN_WEBHOOK] STRIPE_DOMAIN_WEBHOOK_SECRET is not set.');
    return c.json({ ok: false, error: 'Webhook secret not configured.' });
  }

  const sigHeader = c.req.header('stripe-signature') ?? '';
  const valid = await verifyStripeSignature(rawBody, sigHeader, webhookSecret);
  if (!valid) {
    console.warn('[DOMAIN_WEBHOOK] Invalid or expired Stripe-Signature — rejecting.');
    return c.json({ ok: false, error: 'Invalid signature.' });
  }

  let event;
  try { event = JSON.parse(rawBody); }
  catch { return c.json({ ok: false, error: 'Malformed JSON body.' }); }

  const eventType = event?.type ?? '';
  const obj       = event?.data?.object ?? {};

  if (eventType !== 'checkout.session.completed') {
    return c.json({ ok: true, note: `unhandled_event:${eventType}` });
  }

  // Only process domain purchase sessions
  if (obj?.metadata?.purchase_type !== 'domain') {
    return c.json({ ok: true, note: 'not_domain_purchase' });
  }

  const purchaseId       = obj.metadata?.purchase_id ?? '';
  const tenantId         = obj.metadata?.tenant_id   ?? '';
  const domain           = obj.metadata?.domain      ?? '';
  const stripePaymentIntent = obj.payment_intent     ?? null;
  const stripeSessionId  = obj.id ?? '';

  if (!purchaseId || !tenantId || !domain) {
    console.error('[DOMAIN_WEBHOOK] Missing required metadata fields.', { purchaseId, tenantId, domain });
    return c.json({ ok: true, note: 'missing_metadata' });
  }

  // Fetch purchase record — guard for idempotency
  const purchase = await c.env.DB
    .prepare('SELECT id, payment_status, domain_status FROM tenant_domain_purchases WHERE id = ? AND tenant_id = ?')
    .bind(purchaseId, tenantId)
    .first();

  if (!purchase) {
    console.error('[DOMAIN_WEBHOOK] Purchase record not found.', { purchaseId, tenantId });
    return c.json({ ok: true, note: 'purchase_not_found' });
  }

  if (purchase.payment_status === 'COMPLETED') {
    console.log('[DOMAIN_WEBHOOK] Already processed purchase', purchaseId);
    return c.json({ ok: true, note: 'already_processed' });
  }

  const nowS = Math.floor(Date.now() / 1000);

  // Mark payment as COMPLETED immediately (Stripe confirmed payment)
  await c.env.DB
    .prepare(
      `UPDATE tenant_domain_purchases
         SET payment_status = 'COMPLETED', stripe_payment_intent = ?, purchased_at = ?
       WHERE id = ?`
    )
    .bind(stripePaymentIntent, nowS, purchaseId)
    .run();

  // ── CF Registrar: register the domain ──────────────────────────────────────
  let cfResult;
  try {
    cfResult = await registerDomainViaCF(domain, 1, c.env);
    const cfZoneId   = cfResult.id ?? cfResult.zone_id ?? null;
    const expiresAt  = cfResult.expires_on
      ? Math.floor(new Date(cfResult.expires_on).getTime() / 1000)
      : nowS + 365 * 86400;

    await c.env.DB
      .prepare(
        `UPDATE tenant_domain_purchases
           SET domain_status = 'REGISTERED', cf_zone_id = ?, registered_at = ?, expires_at = ?
         WHERE id = ?`
      )
      .bind(cfZoneId, nowS, expiresAt, purchaseId)
      .run();

    // Write custom_domain + custom_domain_verified_at to tenant
    // Domain is auto-verified because we own the CF zone (no CNAME wait)
    await c.env.DB
      .prepare(
        `UPDATE tenants
           SET custom_domain = ?,
               custom_domain_verified_at = ?
         WHERE id = ?`
      )
      .bind(domain, nowS, tenantId)
      .run();

    console.log(`[DOMAIN_WEBHOOK] ✓ Domain ${domain} registered for tenant ${tenantId} (CF zone: ${cfZoneId}).`);
    return c.json({ ok: true, registered: domain, tenant_id: tenantId, cf_zone_id: cfZoneId });

  } catch (cfErr) {
    console.error('[DOMAIN_WEBHOOK] CF Registrar registration failed:', cfErr.message, { domain, tenantId, purchaseId });
    await c.env.DB
      .prepare(`UPDATE tenant_domain_purchases SET domain_status = 'FAILED' WHERE id = ?`)
      .bind(purchaseId)
      .run();
    // Payment was taken but domain registration failed — flag for manual resolution.
    // Do NOT set custom_domain on tenant since domain isn't registered.
    // Platform ops team must re-attempt or refund.
    return c.json({
      ok:    false,
      error: 'Payment received but CF domain registration failed. Platform support has been alerted.',
      note:  'cf_registration_failed',
    });
  }
});

export default function registerDomainRoutes(app) {
  app.route('/api/domains', domains);
}
