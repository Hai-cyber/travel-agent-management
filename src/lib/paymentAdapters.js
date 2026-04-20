// src/lib/paymentAdapters.js
// ── Payment Adapter Layer ─────────────────────────────────────────────────────
//
// Provides two outbound payment adapters:
//   createStripeCheckout(order, tenant, env, opts) → { session_id, url, expires_at }
//   createXenditInvoice(order, tenant, env, opts)  → { invoice_id, url, expires_at }
//
// Both adapters use the Stripe / Xendit REST APIs directly (no SDK needed —
// Cloudflare Workers run the standard fetch API).
//
// Env vars required:
//   STRIPE_SECRET_KEY          — platform-level Stripe secret key
//   STRIPE_WEBHOOK_SECRET      — platform webhook signing secret
//   XENDIT_API_KEY             — platform-level Xendit secret key
//   XENDIT_WEBHOOK_TOKEN       — Xendit callback verification token
//
// Tenant-level overrides (in tenants.payment_config_json):
//   { stripe: { secret_key, publishable_key }, xendit: { api_key } }
// If present, the tenant's own keys are used (for Connect / direct charges).
// If absent, the platform key is used (platform takes gateway on behalf of tenant).
//
// [SEC] Tenant payment configs are read from DB at request time — never cached in globals.
// [SEC] Line-item amounts are always re-derived from the DB order, never from the client.

const STRIPE_API = 'https://api.stripe.com/v1';
const XENDIT_API = 'https://api.xendit.co';

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeJsonParse(raw, fallback = {}) {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

/** Convert amount + currency to Stripe's integer "smallest unit" (cents, satang, etc.) */
function toStripeAmount(amount, currency) {
  const ZERO_DECIMAL = new Set(['BIF','CLP','DJF','GNF','JPY','KMF','KRW','MGA','PYG','RWF','UGX','VND','VUV','XAF','XOF','XPF']);
  const upper = (currency ?? 'USD').toUpperCase();
  if (ZERO_DECIMAL.has(upper)) return Math.round(amount);
  return Math.round(amount * 100);
}

/** Encode object as application/x-www-form-urlencoded for Stripe API */
function encodeForm(obj, prefix = '') {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v !== null && v !== undefined && typeof v === 'object' && !Array.isArray(v)) {
      parts.push(encodeForm(v, key));
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === 'object') {
          parts.push(encodeForm(item, `${key}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(item)}`);
        }
      });
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
    }
  }
  return parts.join('&');
}

// ── Stripe Checkout ───────────────────────────────────────────────────────────

/**
 * Create a Stripe Checkout Session for a booking order.
 *
 * @param {object} order  — row from booking_orders
 * @param {object} tenant — row from tenants (includes payment_config_json)
 * @param {object} env    — Cloudflare Worker env bindings
 * @param {object} opts   — { success_url, cancel_url }
 * @returns {{ session_id: string, url: string, expires_at: number }}
 */
export async function createStripeCheckout(order, tenant, env, opts) {
  const pcfg       = safeJsonParse(tenant.payment_config_json);
  const secretKey  = pcfg?.stripe?.secret_key ?? env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('Stripe is not configured for this account.');

  const currency   = (order.booking_currency ?? tenant.booking_currency ?? 'USD').toLowerCase();
  const amount     = order.grand_total_amount ?? order.grand_total_usd ?? 0;
  if (!amount || amount <= 0) throw new Error('Order has no payable amount.');

  const tourTitle  = order.tour_title ?? 'Tour Booking';
  const successUrl = opts?.success_url ?? `https://tours-market.com/pay-success.html?order=${encodeURIComponent(order.id)}`;
  const cancelUrl  = opts?.cancel_url  ?? `https://tours-market.com/pay-cancel.html?order=${encodeURIComponent(order.id)}`;

  const sessionParams = {
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: order.guest_email ?? undefined,
    line_items: [{
      price_data: {
        currency,
        unit_amount: toStripeAmount(amount, currency),
        product_data: {
          name: tourTitle,
          description: order.guest_name ? `Booking for ${order.guest_name}` : 'Tour booking',
        },
      },
      quantity: 1,
    }],
    metadata: {
      order_id:  order.id,
      tenant_id: order.tenant_id,
    },
    success_url: successUrl,
    cancel_url:  cancelUrl,
    // Session expires in 30 minutes
    expires_after: 1800,
  };

  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: encodeForm(sessionParams),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data?.error?.message ?? `Stripe error ${res.status}`);
  }

  return {
    session_id:  data.id,
    url:         data.url,
    expires_at:  data.expires_at, // UNIX timestamp
  };
}

// ── Xendit Invoice ────────────────────────────────────────────────────────────

/**
 * Create a Xendit Invoice for a booking order.
 * Xendit Invoices support cards + all SEA e-wallets + virtual accounts.
 *
 * @param {object} order   — row from booking_orders
 * @param {object} tenant  — row from tenants
 * @param {object} env     — Cloudflare Worker env bindings
 * @param {object} opts    — { success_redirect_url, failure_redirect_url }
 * @returns {{ invoice_id: string, url: string, expires_at: number }}
 */
export async function createXenditInvoice(order, tenant, env, opts) {
  const pcfg    = safeJsonParse(tenant.payment_config_json);
  const apiKey  = pcfg?.xendit?.api_key ?? env.XENDIT_API_KEY;
  if (!apiKey) throw new Error('Xendit is not configured for this account.');

  const currency = (order.booking_currency ?? tenant.booking_currency ?? 'USD').toUpperCase();
  const amount   = order.grand_total_amount ?? order.grand_total_usd ?? 0;
  if (!amount || amount <= 0) throw new Error('Order has no payable amount.');

  const successUrl = opts?.success_redirect_url ?? `https://tours-market.com/pay-success.html?order=${encodeURIComponent(order.id)}`;
  const failureUrl = opts?.failure_redirect_url  ?? `https://tours-market.com/pay-cancel.html?order=${encodeURIComponent(order.id)}`;

  // Determine which payment methods to show based on currency
  const SEA_CURRENCIES = new Set(['IDR', 'PHP', 'MYR', 'THB', 'VND', 'SGD']);
  const paymentMethods = SEA_CURRENCIES.has(currency)
    ? ['CREDIT_CARD', 'DEBIT_CARD', 'OVO', 'DANA', 'SHOPEEPAY', 'GCASH', 'MAYA', 'PAYMAYA',
       'TRUEMONEY', 'GRABPAY', 'QRIS', 'DD_BCA', 'BA_BRI', 'VA_BCA', 'VA_BNI', 'VA_BRI',
       'VA_MANDIRI', 'VA_PERMATA']
    : ['CREDIT_CARD', 'DEBIT_CARD'];

  const invoiceParams = {
    external_id:           order.id,
    amount:                Math.round(amount),
    currency,
    description:           order.tour_title ?? 'Tour Booking',
    payer_email:           order.guest_email ?? undefined,
    customer: order.guest_name ? {
      given_names: order.guest_name,
      email:       order.guest_email ?? undefined,
      mobile_number: order.guest_phone ?? undefined,
    } : undefined,
    payment_methods:       paymentMethods,
    success_redirect_url:  successUrl,
    failure_redirect_url:  failureUrl,
    // Xendit invoice valid for 24 hours
    invoice_duration:      86400,
    metadata: {
      order_id:  order.id,
      tenant_id: order.tenant_id,
    },
  };

  // Remove undefined values (Xendit is strict about extra nulls)
  const cleanParams = JSON.parse(JSON.stringify(invoiceParams));

  const res = await fetch(`${XENDIT_API}/v2/invoices`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${btoa(apiKey + ':')}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(cleanParams),
  });

  const data = await res.json();
  if (!res.ok || data.error_code) {
    throw new Error(data?.message ?? data?.error_code ?? `Xendit error ${res.status}`);
  }

  // invoice_url is the hosted page; expiry_date is ISO8601
  const expiresAt = data.expiry_date
    ? Math.floor(new Date(data.expiry_date).getTime() / 1000)
    : Math.floor(Date.now() / 1000) + 86400;

  return {
    invoice_id: data.id,
    url:        data.invoice_url,
    expires_at: expiresAt,
  };
}

// ── Stripe webhook verification ───────────────────────────────────────────────
// Used by POST /api/pay/stripe/webhook

function hexToBytes(hex) {
  const bytes = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function verifyStripeWebhook(rawBody, sigHeader, secret) {
  try {
    const enc      = new TextEncoder();
    const tMatch   = sigHeader.match(/t=(\d+)/);
    const v1Match  = sigHeader.match(/v1=([a-f0-9]+)/);
    if (!tMatch || !v1Match) return false;

    const payload  = `${tMatch[1]}.${rawBody}`;
    const key      = await crypto.subtle.importKey(
      'raw', enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['verify']
    );
    return await crypto.subtle.verify('HMAC', key, hexToBytes(v1Match[1]), enc.encode(payload));
  } catch {
    return false;
  }
}

// ── Xendit webhook verification ───────────────────────────────────────────────
// Xendit sends x-callback-token header; just compare to env var.

export function verifyXenditWebhook(req, env) {
  const token = req.header('x-callback-token');
  return token && token === env.XENDIT_WEBHOOK_TOKEN;
}
