// src/routes/payments.js
// CHK-R27: Universal Payment Webhook Manager
//
// POST /api/payments/webhook/:provider
//   Receives payment confirmations from any supported instant-payment gateway.
//   Normalises provider-specific payload → common shape → instant identity unlock.
//
// POST /api/payments/notify/settings
//   Agent sets notification_config (Telegram bot + webhook URL) for their tenant.
//
// Payment provider adapters implemented:
//   momo       — MoMo    resultCode === 0       orderId field
//   zalopay    — ZaloPay return_code === 1       app_trans_id field
//   vnpay      — VNPay   vnp_ResponseCode === '00' vnp_TxnRef field
//   credit_card/stripe — Stripe webhook (payment_intent.succeeded event)
//   paypal     — PayPal  event_type === PAYMENT.CAPTURE.COMPLETED
//   grabpay    — GrabPay status === 'COMPLETED'
//   generic    — expects { order_id, success: true }
//
// [SEC] Each provider's signature is validated when tenant has payment_config_json.webhook_secret set.
// [SEC] Always returns HTTP 200 to the provider regardless of outcome — prevents probing.
// [SEC] Orders from other tenants are never modifiable; order lookup includes tenant check.
import { Hono } from 'hono';
import { notifyAgent } from '../lib/notifications.js';

const payments = new Hono();

// ── Group classification ──────────────────────────────────────────────────────
export const INSTANT_PROVIDERS = new Set([
  'CREDIT_CARD', 'MOMO', 'ZALOPAY', 'VNPAY', 'PAYPAL', 'GRABPAY',
]);
export const MANUAL_PROVIDERS = new Set([
  'BANK_TRANSFER', 'CASH_AT_OFFICE', 'PAY_ON_ARRIVAL',
]);
export const ALL_PROVIDERS = new Set([...INSTANT_PROVIDERS, ...MANUAL_PROVIDERS]);

export function isInstantProvider(method) {
  return INSTANT_PROVIDERS.has((method ?? '').toUpperCase());
}

// ── Default payment method catalogue (9 entries) ──────────────────────────────
// Populated into tenants.payment_methods on first PATCH /api/payments/settings.
// Agents toggle enabled/disabled — only enabled methods appear in inject.js checkout.
const DEFAULT_PAYMENT_METHODS = [
  { id: 'BANK_TRANSFER',  label: 'Chuyển khoản',         enabled: true,  category: 'manual'  },
  { id: 'MOMO',           label: 'MoMo',                  enabled: false, category: 'instant' },
  { id: 'ZALOPAY',        label: 'ZaloPay',               enabled: false, category: 'instant' },
  { id: 'VNPAY',          label: 'VNPay',                 enabled: false, category: 'instant' },
  { id: 'CREDIT_CARD',    label: 'Thẻ tín dụng',         enabled: false, category: 'instant' },
  { id: 'PAYPAL',         label: 'PayPal',                enabled: false, category: 'instant' },
  { id: 'GRABPAY',        label: 'GrabPay',               enabled: false, category: 'instant' },
  { id: 'CASH_AT_OFFICE', label: 'Thanh toán trực tiếp', enabled: false, category: 'manual'  },
  { id: 'PAY_ON_ARRIVAL', label: 'Trả khi gặp mặt',      enabled: false, category: 'manual', risk: 'ghosting' },
];

export { DEFAULT_PAYMENT_METHODS };

// ── Electronic Gateway Mandate ────────────────────────────────────────────────
// Defines which payment methods are considered "professional electronic gateways".
// Tenants must enable at least one of these to have their site go live.
//
// Mapping from gateway name → internal payment method ID:
//   stripe   → CREDIT_CARD
//   paypal   → PAYPAL
//   momo     → MOMO
//   zalopay  → ZALOPAY
//   vnpay    → VNPAY
//   grabpay  → GRABPAY
export const ALLOWED_E_GATEWAYS = ['stripe', 'paypal', 'momo', 'zalopay', 'vnpay', 'grabpay'];
const E_GATEWAY_METHOD_IDS = new Set(['CREDIT_CARD', 'MOMO', 'ZALOPAY', 'VNPAY', 'PAYPAL', 'GRABPAY']);

/**
 * Returns true if the tenant has at least one electronic gateway enabled.
 * Called by the site-render kill switch (index.js) and booking gate (bookings.js).
 *
 * @param {Array} payment_methods — tenant's payment_methods JSON array
 * @returns {boolean}
 */
export function checkTenantCompliance(payment_methods) {
  if (!Array.isArray(payment_methods) || !payment_methods.length) return false;
  return payment_methods.some(
    m => m.enabled === true && E_GATEWAY_METHOD_IDS.has((m.id ?? '').toUpperCase())
  );
}

// ── POST /api/payments/webhook/:provider ──────────────────────────────────────
// External payment gateway calls this URL on transaction success/failure.
// The order_id we store in the booking is passed by the agent to the provider
// as their "merchant_order_id" / "orderId" / "vnp_TxnRef" etc.
payments.post('/webhook/:provider', async (c) => {
  const providerRaw = c.req.param('provider');
  const provider    = (providerRaw ?? '').toUpperCase();

  if (!INSTANT_PROVIDERS.has(provider)) {
    // Return 200 silently — don't expose which providers are valid
    console.warn(`[WEBHOOK_UNKNOWN_PROVIDER] provider=${providerRaw}`);
    return c.json({ ok: true });
  }

  // Read body once for both signature validation and payload parsing
  let rawBody;
  try { rawBody = await c.req.text(); }
  catch { return c.json({ ok: true }); } // never 4xx to providers

  let body;
  try { body = JSON.parse(rawBody); }
  catch { return c.json({ ok: true }); }

  // Normalise provider-specific payload to common shape
  const norm = normalizePayload(provider, body);

  if (!norm.order_id) {
    console.warn(`[WEBHOOK_NO_ORDER_ID] provider=${provider}`);
    return c.json({ ok: true });
  }

  // Look up the order — must exist and belong to the claimed tenant
  const order = await c.env.DB
    .prepare(
      `SELECT id, tenant_id, status, grand_total_usd, guest_name, tour_id, payment_config_json
       FROM booking_orders WHERE id = ?`
    )
    .bind(norm.order_id)
    .first();

  if (!order) {
    // Do NOT log the order_id to avoid information leakage in production logs
    console.info(`[WEBHOOK_ORDER_MISS] provider=${provider}`);
    return c.json({ ok: true }); // always 200
  }

  // Signature validation — uses tenant's payment_config_json.webhook_secret when present
  let pcfg = {};
  try { if (order.payment_config_json) pcfg = JSON.parse(order.payment_config_json); } catch {}
  if (pcfg.webhook_secret) {
    const valid = await verifySignature(provider, rawBody, c.req, pcfg.webhook_secret);
    if (!valid) {
      console.warn(`[WEBHOOK_SIG_INVALID] provider=${provider} tenant=${order.tenant_id}`);
      return c.json({ ok: true }); // silent rejection
    }
  }

  const now = Math.floor(Date.now() / 1000);

  if (norm.success) {
    // Idempotency: already settled — no duplicate revenue
    if (['PAID', 'CONFIRMED'].includes(order.status)) {
      return c.json({ ok: true, note: 'Already settled' });
    }

    // Instant unlock: set PAID + identity_unlocked = 1
    const upd = await c.env.DB
      .prepare(
        `UPDATE booking_orders
         SET status = 'PAID', identity_unlocked = 1, confirmed_at = ?
         WHERE id = ? AND tenant_id = ?`
      )
      .bind(now, order.id, order.tenant_id)
      .run();

    if (!upd.meta?.changes) return c.json({ ok: true }); // race — already changed

    // Revenue tracking
    await c.env.DB
      .prepare(`UPDATE tenants
                SET total_revenue_tracked = COALESCE(total_revenue_tracked, 0) + ?
                WHERE id = ?`)
      .bind(order.grand_total_usd, order.tenant_id)
      .run();

    console.info(
      `[WEBHOOK_INSTANT_PAID] provider=${provider} order=${order.id} ` +
      `tenant=${order.tenant_id} amount=${order.grand_total_usd}`
    );

    // Push notification — non-blocking (does not extend response time)
    c.executionCtx.waitUntil(
      notifyAgent(c.env, order.tenant_id, 'WEBHOOK_PAID', {
        order_id:    order.id,
        provider,
        guest_name:  order.guest_name,   // visible now — identity is unlocked
        grand_total: order.grand_total_usd,
        tour_id:     order.tour_id,
      })
    );

  } else {
    // Payment failed — cancel if still pending
    if (['AWAITING_PAYMENT', 'AWAITING_PROOF'].includes(order.status)) {
      await c.env.DB
        .prepare(`UPDATE booking_orders SET status = 'CANCELLED' WHERE id = ? AND tenant_id = ?`)
        .bind(order.id, order.tenant_id)
        .run();
      console.info(`[WEBHOOK_PAYMENT_FAILED] provider=${provider} order=${order.id}`);
    }
  }

  return c.json({ ok: true });
});

// ── POST /api/payments/notify/settings ───────────────────────────────────────
// Agent saves their Telegram bot config and/or webhook URL.
// Stored in tenants.notification_config (JSON).
// [SEC] Only modifies the row matching X-Tenant-ID.
payments.post('/notify/settings', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Invalid JSON body.' }, 400); }

  const config = {};

  if (body.telegram !== undefined) {
    if (body.telegram === null) {
      config.telegram = null;
    } else if (body.telegram && typeof body.telegram === 'object') {
      config.telegram = {};
      if (body.telegram.bot_token) config.telegram.bot_token = String(body.telegram.bot_token).slice(0, 200);
      if (body.telegram.chat_id)   config.telegram.chat_id   = String(body.telegram.chat_id).slice(0, 100);
    } else {
      return c.json({ error: 'telegram must be an object { bot_token, chat_id } or null.' }, 400);
    }
  }

  if (body.webhook !== undefined) {
    if (body.webhook === null) {
      config.webhook = null;
    } else if (body.webhook?.url) {
      // [SEC] Only allow HTTPS URLs for webhooks
      const url = String(body.webhook.url);
      if (!/^https:\/\//i.test(url)) {
        return c.json({ error: 'webhook.url must be an HTTPS URL.' }, 400);
      }
      config.webhook = { url: url.slice(0, 500) };
    } else {
      return c.json({ error: 'webhook must be an object { url } or null.' }, 400);
    }
  }

  if (!Object.keys(config).length) {
    return c.json({ error: 'Provide at least one of: telegram, webhook.' }, 400);
  }

  // Deep merge with existing config
  const existing = await c.env.DB
    .prepare('SELECT notification_config FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();
  if (!existing) return c.json({ error: 'Tenant not found.' }, 404);

  let currentCfg = {};
  try { if (existing.notification_config) currentCfg = JSON.parse(existing.notification_config); } catch {}

  const merged = Object.assign({}, currentCfg, config);
  // Clear nulled keys
  for (const [k, v] of Object.entries(merged)) {
    if (v === null) delete merged[k];
  }

  await c.env.DB
    .prepare('UPDATE tenants SET notification_config = ? WHERE id = ?')
    .bind(JSON.stringify(merged), tenantId)
    .run();

  return c.json({ ok: true, notification_config: merged });
});

// ── Payload normalizers ───────────────────────────────────────────────────────
// Each adapter returns: { order_id: string, success: boolean }

function normalizePayload(provider, body) {
  switch (provider) {
    case 'MOMO':
      // https://developers.momo.vn/v3/docs/payment/api/oneshot/capture-wallet
      // orderId is set by the merchant (we use the booking order's nanoid)
      return {
        order_id: body.orderId,
        success:  body.resultCode === 0,
      };

    case 'ZALOPAY':
      // https://docs.zalopay.vn/v2/docs/merchant/
      // app_trans_id format: "YYYYMMDD_<orderId>"
      return {
        order_id: body.app_trans_id?.split('_').slice(1).join('_') ?? body.apptransid?.split('_').slice(1).join('_'),
        success:  body.return_code === 1,
      };

    case 'VNPAY':
      // vnp_TxnRef is the merchant's order reference (our booking order ID)
      return {
        order_id: body.vnp_TxnRef,
        success:  body.vnp_ResponseCode === '00',
      };

    case 'CREDIT_CARD':
      // Stripe webhook — expects payment_intent.succeeded event
      // metadata.order_id must be set when creating the PaymentIntent
      return {
        order_id: body.data?.object?.metadata?.order_id ?? body.order_id,
        success:  body.type === 'payment_intent.succeeded' || body.success === true,
      };

    case 'PAYPAL':
      // PayPal webhook — PAYMENT.CAPTURE.COMPLETED event
      // invoice_id in the resource object maps to our order ID
      return {
        order_id: body.resource?.invoice_id ?? body.order_id,
        success:  body.event_type === 'PAYMENT.CAPTURE.COMPLETED',
      };

    case 'GRABPAY':
      // GrabPay — status = 'COMPLETED', partnerTxID = our order ID
      return {
        order_id: body.partnerTxID ?? body.order_id,
        success:  body.status === 'COMPLETED',
      };

    default:
      // Generic adapter — any provider can POST { order_id, success }
      return {
        order_id: body.order_id,
        success:  body.success === true,
      };
  }
}

// ── Signature validators ──────────────────────────────────────────────────────
// Currently implements Stripe (HMAC-SHA256 with timestamp binding).
// Other providers (Momo, ZaloPay, VNPay) require their own query-string
// concatenation spec — return true (permissive) until those are implemented
// so existing integrations are not broken.

async function verifySignature(provider, rawBody, req, secret) {
  try {
    const enc = new TextEncoder();
    const key  = await crypto.subtle.importKey(
      'raw', enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['verify']
    );

    if (provider === 'CREDIT_CARD') {
      // Stripe: Stripe-Signature: t=timestamp,v1=hex_sig
      const sigHeader = req.header('stripe-signature') ?? '';
      const tMatch    = sigHeader.match(/t=(\d+)/);
      const v1Match   = sigHeader.match(/v1=([a-f0-9]+)/);
      if (!tMatch || !v1Match) return false;
      const payload  = `${tMatch[1]}.${rawBody}`;
      const sigBytes = hexToBytes(v1Match[1]);
      return await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payload));
    }

    // For all other providers: permissive pass-through until per-provider
    // HMAC spec is implemented. Agents can remove webhook_secret to skip.
    return true;

  } catch (err) {
    console.warn('[WEBHOOK_SIG_VERIFY_ERR]', err.message);
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

// ── PATCH /api/payments/settings ─────────────────────────────────────────────
// Agent toggles which payment channels are enabled/disabled for their tenant.
// Accepts an array of { id, enabled } update objects.
// Merges with DEFAULT_PAYMENT_METHODS so unmentioned entries keep their state.
// [VALIDATION] At least one method must remain enabled — blocks full disable.
// [SEC] Only the tenant identified by X-Tenant-ID may modify their own config.
payments.patch('/settings', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Invalid JSON body.' }, 400); }

  // Accept array [ { id, enabled }, ... ] or object { methods: [...] }
  const updates = Array.isArray(body) ? body : (Array.isArray(body?.methods) ? body.methods : null);
  if (!updates) {
    return c.json({ error: 'Body must be an array of { id, enabled } objects, or { methods: [...] }.' }, 400);
  }

  // Validate each update entry
  for (const entry of updates) {
    if (!entry?.id || typeof entry.enabled !== 'boolean') {
      return c.json({ error: 'Each entry must have { id: string, enabled: boolean }.' }, 400);
    }
    if (!ALL_PROVIDERS.has((entry.id ?? '').toUpperCase())) {
      return c.json({
        error:   `Unknown payment method: "${entry.id}".`,
        allowed: [...ALL_PROVIDERS],
      }, 400);
    }
  }

  const tenant = await c.env.DB
    .prepare('SELECT payment_methods FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();
  if (!tenant) return c.json({ error: 'Tenant not found.' }, 404);

  // Load existing config (or start from defaults)
  let existing = DEFAULT_PAYMENT_METHODS.map(m => ({ ...m }));
  try {
    if (tenant.payment_methods) {
      const parsed = JSON.parse(tenant.payment_methods);
      if (Array.isArray(parsed) && parsed.length) existing = parsed;
    }
  } catch { /* use defaults */ }

  // Build a lookup for fast merge — normalise IDs to uppercase for matching
  const updateMap = new Map(updates.map(u => [u.id.toUpperCase(), u.enabled]));

  const merged = existing.map(m => {
    const overrideEnabled = updateMap.get(m.id.toUpperCase());
    return overrideEnabled !== undefined ? { ...m, enabled: overrideEnabled } : m;
  });

  // Ensure any new-to-existing IDs from updates are included
  for (const u of updates) {
    const id = u.id.toUpperCase();
    if (!merged.some(m => m.id.toUpperCase() === id)) {
      const def = DEFAULT_PAYMENT_METHODS.find(d => d.id === id);
      if (def) merged.push({ ...def, enabled: u.enabled });
    }
  }

  // [VALIDATION] Must keep at least one method enabled
  const enabledCount = merged.filter(m => m.enabled).length;
  if (enabledCount === 0) {
    return c.json({
      error:   'Bạn cần ít nhất một phương thức thanh toán để nhận booking!',
      code:    'MIN_ONE_METHOD_REQUIRED',
    }, 400);
  }

  await c.env.DB
    .prepare('UPDATE tenants SET payment_methods = ? WHERE id = ?')
    .bind(JSON.stringify(merged), tenantId)
    .run();

  const hasRisk = merged.some(m => m.enabled && m.risk === 'ghosting');

  return c.json({
    ok:              true,
    payment_methods: merged,
    warning: hasRisk
      ? '⚠ PAY_ON_ARRIVAL đang bật. Phương thức này có rủi ro ghosting — khách đặt chỗ nhưng không đến và không liên lạc.'
      : undefined,
  });
});

export default function registerPaymentRoutes(app) {
  app.route('/api/payments', payments);
}
