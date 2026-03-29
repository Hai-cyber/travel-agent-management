// src/lib/publishGuard.js
// Subscription + payment config guard for the headless publishing pipeline.
//
// Usage:
//   const guard = await checkPublishPermission(env, tenantId);
//   if (!guard.ok) return c.json({ error: guard.error, code: guard.code, checklist: guard.checklist }, 403);

// Electronic gateways — BANK_TRANSFER and manual methods are excluded.
// A tenant must have at least ONE of these enabled to publish.
const ELECTRONIC_GATEWAY_IDS = new Set([
  'STRIPE', 'MOMO', 'VNPAY', 'ZALOPAY', 'CREDIT_CARD', 'PAYPAL', 'GRABPAY',
]);

/**
 * Checks whether a tenant is allowed to publish / re-render tour pages.
 *
 * Four gates (all must pass):
 *   1. subscription_status === 'ACTIVE'
 *   2. terms_accepted === 1
 *   3. At least one electronic gateway in payment_methods has enabled: true
 *   4. subdomain OR custom_domain is set (not NULL / empty)
 *
 * @param {object} env      - Cloudflare Workers env (must have env.DB)
 * @param {string} tenantId
 * @returns {Promise<{
 *   ok: boolean,
 *   checklist: object,      // always present — UI renders this as a checklist
 *   blocks: string[],       // error codes for each failing gate
 *   error?: string,         // human-readable summary when ok=false
 *   code?: string,          // primary blocking code (first failure)
 *   tenant?: object,        // present when ok=true
 *   paymentConfig?: object  // parsed payment_config_json (may be null)
 * }>}
 */
export async function checkPublishPermission(env, tenantId) {
  const tenant = await env.DB
    .prepare(
      `SELECT id, subscription_status, terms_accepted,
              custom_domain, subdomain, payment_methods, payment_config_json,
              template_id, published_template_id, site_published_at
         FROM tenants WHERE id = ?`
    )
    .bind(tenantId)
    .first();

  if (!tenant) {
    return {
      ok:        false,
      code:      'TENANT_NOT_FOUND',
      error:     'Tenant not found.',
      blocks:    ['TENANT_NOT_FOUND'],
      checklist: {},
    };
  }

  // ── Gate 1: Active subscription ──────────────────────────────────────────
  const isActive = tenant.subscription_status === 'ACTIVE';

  // ── Gate 2: Terms & Conditions accepted ──────────────────────────────────
  const hasTerms = tenant.terms_accepted === 1;

  // ── Gate 3: ≥1 electronic gateway enabled ────────────────────────────────
  let hasGateway = false;
  let enabledGateway = null;
  try {
    const methods = tenant.payment_methods ? JSON.parse(tenant.payment_methods) : [];
    if (Array.isArray(methods)) {
      const found = methods.find(
        m => m.enabled === true && ELECTRONIC_GATEWAY_IDS.has((m.id ?? '').toUpperCase())
      );
      if (found) { hasGateway = true; enabledGateway = found.id; }
    }
  } catch {
    // Malformed JSON — treat as not configured
  }

  // ── Gate 4: Domain configured ─────────────────────────────────────────────
  const hasDomain = !!(
    (tenant.subdomain    && String(tenant.subdomain).trim())    ||
    (tenant.custom_domain && String(tenant.custom_domain).trim())
  );
  const domainValue = tenant.subdomain || tenant.custom_domain || null;

  // ── Build checklist object ────────────────────────────────────────────────
  const checklist = {
    subscription_active: {
      pass:    isActive,
      label:   'Subscription aktif',
      detail:  isActive
        ? `Status: ${tenant.subscription_status}`
        : `Status hiện tại: ${tenant.subscription_status}. Cần nâng cấp lên ACTIVE.`,
      action_url: isActive ? null : '/billing/upgrade',
    },
    terms_accepted: {
      pass:    hasTerms,
      label:   'Đã đồng ý Điều khoản dịch vụ',
      detail:  hasTerms
        ? 'T&C đã được chấp nhận.'
        : 'Chưa đồng ý T&C. Gọi POST /api/tenant/accept-terms để xác nhận.',
      action_url: hasTerms ? null : '/dashboard.html#terms',
    },
    has_electronic_gateway: {
      pass:    hasGateway,
      label:   'Cổng thanh toán điện tử',
      detail:  hasGateway
        ? `Gateway đang hoạt động: ${enabledGateway}`
        : 'Chưa có cổng điện tử nào được bật (MoMo, VNPay, Stripe, v.v.). Bank Transfer không tính.',
      action_url: hasGateway ? null : '/dashboard.html#payments',
    },
    has_domain: {
      pass:    hasDomain,
      label:   'Tên miền đã cấu hình',
      detail:  hasDomain
        ? `Domain: ${domainValue}`
        : 'Chưa đặt subdomain hoặc custom_domain. Gọi POST /api/tenant/claim-subdomain.',
      action_url: hasDomain ? null : '/dashboard.html#domain',
    },
  };

  // ── Collect failing gates ─────────────────────────────────────────────────
  const blocks = [];
  if (!isActive)   blocks.push('SUBSCRIPTION_INACTIVE');
  if (!hasTerms)   blocks.push('TERMS_NOT_ACCEPTED');
  if (!hasGateway) blocks.push('NO_ELECTRONIC_GATEWAY');
  if (!hasDomain)  blocks.push('NO_DOMAIN');

  if (blocks.length > 0) {
    const labels = blocks.map(b => ({
      SUBSCRIPTION_INACTIVE:   'subscription chưa ACTIVE',
      TERMS_NOT_ACCEPTED:      'chưa đồng ý T&C',
      NO_ELECTRONIC_GATEWAY:   'chưa có cổng thanh toán điện tử',
      NO_DOMAIN:               'chưa cấu hình tên miền',
    }[b] ?? b));

    return {
      ok:        false,
      code:      blocks[0],           // primary blocking code
      error:     `Không thể publish: ${labels.join(', ')}.`,
      blocks,
      checklist,
    };
  }

  // ── All gates pass ────────────────────────────────────────────────────────
  let paymentConfig = null;
  if (tenant.payment_config_json) {
    try { paymentConfig = JSON.parse(tenant.payment_config_json); }
    catch {
      console.warn(`[PUBLISH_GUARD] tenant=${tenantId} has malformed payment_config_json — ignoring.`);
    }
  }

  return { ok: true, checklist, blocks: [], tenant, paymentConfig };
}


/**
 * Builds the pay-button HTML block to inject into a tour page.
 * Returns null when there is no usable payment config.
 *
 * Supported config keys (checked in priority order):
 *   stripe_price_id + stripe_pub_key  → Stripe Checkout redirect button
 *   checkout_url                       → Generic CTA anchor
 *   paypal_plan_id                     → PayPal Subscribe button
 *
 * [SEC] No secret keys are ever embedded — only publishable/public identifiers.
 *
 * @param {object|null} paymentConfig - Parsed payment_config_json object
 * @param {string} [tourSlug=''] - Tour slug for analytics / referral tracking
 * @returns {string|null} HTML fragment or null
 */
export function buildPayButton(paymentConfig, tourSlug = '') {
  if (!paymentConfig || typeof paymentConfig !== 'object') return null;

  // 1. Stripe Checkout (preferred)
  if (paymentConfig.stripe_price_id && paymentConfig.stripe_pub_key) {
    const priceId  = escapeAttr(paymentConfig.stripe_price_id);
    const pubKey   = escapeAttr(paymentConfig.stripe_pub_key);
    const slug     = escapeAttr(tourSlug);
    return `
<div class="pay-button-wrapper" data-tour="${slug}">
  <button
    class="btn-book-now stripe-checkout-btn"
    data-stripe-pub-key="${pubKey}"
    data-stripe-price-id="${priceId}"
    onclick="stripeCheckout(this)"
  >Book Now</button>
  <script>
    function stripeCheckout(btn) {
      const stripe = Stripe(btn.dataset.stripePubKey);
      stripe.redirectToCheckout({ lineItems: [{ price: btn.dataset.stripePriceId, quantity: 1 }], mode: 'payment', successUrl: location.origin + '/booking/success', cancelUrl: location.href });
    }
  </script>
</div>`.trim();
  }

  // 2. Generic checkout URL override
  if (paymentConfig.checkout_url) {
    const url  = escapeAttr(paymentConfig.checkout_url);
    const slug = escapeAttr(tourSlug);
    return `
<div class="pay-button-wrapper" data-tour="${slug}">
  <a class="btn-book-now" href="${url}" rel="noopener noreferrer">Book Now</a>
</div>`.trim();
  }

  // 3. PayPal Subscribe
  if (paymentConfig.paypal_plan_id) {
    const planId = escapeAttr(paymentConfig.paypal_plan_id);
    const slug   = escapeAttr(tourSlug);
    return `
<div class="pay-button-wrapper" data-tour="${slug}">
  <div id="paypal-button-container-${slug}"></div>
  <script src="https://www.paypal.com/sdk/js?client-id=sb&vault=true&intent=subscription" data-sdk-integration-source="button-factory"></script>
  <script>
    paypal.Buttons({ style: { shape: 'rect', color: 'gold', layout: 'vertical', label: 'subscribe' },
      createSubscription: (data, actions) => actions.subscription.create({ plan_id: '${planId}' }),
      onApprove: (data) => alert('Subscription ' + data.subscriptionID + ' activated!')
    }).render('#paypal-button-container-${slug}');
  </script>
</div>`.trim();
  }

  return null;
}

// Escape HTML attribute values to prevent XSS when injecting config values.
function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Preview Mode / Whitelabel helpers ─────────────────────────────────────────

/**
 * Fixed banner injected at the top of the page when rendering in 'preview' mode
 * (platform subdomain). Makes it unambiguous to the agent — and any visitor —
 * that this is not the live, payment-enabled version of the page.
 */
const PREVIEW_BANNER_HTML = `<div id="platform-preview-banner" style="position:fixed;top:0;left:0;right:0;z-index:9999;background:#f59e0b;color:#1c1917;padding:10px 16px;font-family:system-ui,sans-serif;font-size:14px;font-weight:600;text-align:center;border-bottom:2px solid #d97706;box-shadow:0 2px 8px rgba(0,0,0,.15);">
  &#9888;&nbsp;PREVIEW MODE &mdash; Booking and payment features are disabled. This page is not yet live on a Custom Domain.
  <span style="float:right;font-weight:400;font-size:12px;opacity:.85;">Activate your subscription and configure a Custom Domain to go live.</span>
</div><div style="height:50px;" aria-hidden="true"></div>`;

/**
 * Disabled pay-button placeholder shown in preview mode.
 * Visually indicates the feature exists but is gated behind subscription + gateway setup.
 * [SEC] pointer-events:none + disabled attr prevent any accidental form submission.
 */
const PREVIEW_PAY_BUTTON_HTML = `<div class="pay-button-wrapper" style="opacity:.5;pointer-events:none;cursor:not-allowed;" aria-disabled="true" title="Payment unavailable in Preview Mode">
  <button class="btn-book-now" disabled style="background:#9ca3af;cursor:not-allowed;">Book &amp; Pay &mdash; Preview Only</button>
  <p style="font-size:.8rem;color:#6b7280;margin-top:.5rem;">Connect a payment gateway on your Custom Domain to enable live booking.</p>
</div>`;

/**
 * Platform attribution shown in preview mode only.
 * Cleared to an empty string in live/whitelabel mode so no platform branding
 * leaks to the agent's custom domain.
 */
const PLATFORM_BRAND_HTML = `<span class="platform-brand" style="display:inline-block;margin-left:.5rem;font-size:.75rem;color:#c0c0c0;">&bull; Powered by TravelStack</span>`;

/** Returns the preview mode banner HTML fragment. */
export function buildPreviewBanner() {
  return PREVIEW_BANNER_HTML;
}

/** Returns a disabled pay-button HTML fragment for preview mode. */
export function buildPreviewPayButton() {
  return PREVIEW_PAY_BUTTON_HTML;
}

/**
 * Returns the platform attribution HTML fragment.
 * Call this in preview mode only — must return '' in live/whitelabel mode.
 */
export function buildPlatformBrand() {
  return PLATFORM_BRAND_HTML;
}
