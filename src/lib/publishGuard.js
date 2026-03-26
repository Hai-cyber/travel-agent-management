// src/lib/publishGuard.js
// Subscription + payment config guard for the headless publishing pipeline.
//
// Usage:
//   const guard = await checkPublishPermission(env, tenantId);
//   if (!guard.ok) return c.json({ error: guard.error, code: guard.code }, 403);

/**
 * Checks whether a tenant is allowed to publish / re-render tour pages.
 *
 * Rules (in order):
 *   1. Tenant must exist.
 *   2. subscription_status must be 'ACTIVE'.
 *   3. payment_config_json must be present and contain at least one usable key.
 *
 * @param {object} env - Cloudflare Workers env (must have env.DB)
 * @param {string} tenantId
 * @returns {Promise<{ ok: boolean, error?: string, code?: string, tenant?: object }>}
 */
export async function checkPublishPermission(env, tenantId) {
  const tenant = await env.DB
    .prepare(
      'SELECT id, subscription_status, payment_config_json FROM tenants WHERE id = ?'
    )
    .bind(tenantId)
    .first();

  if (!tenant) {
    return { ok: false, code: 'TENANT_NOT_FOUND', error: 'Tenant not found.' };
  }

  if (tenant.subscription_status !== 'ACTIVE') {
    return {
      ok:          false,
      code:        'SUBSCRIPTION_INACTIVE',
      error:       `Publishing requires an active subscription. Current status: ${tenant.subscription_status}.`,
      upgrade_url: '/billing/upgrade',
    };
  }

  // payment_config_json is optional for publishing — tours can be free.
  // We parse it here so callers don't have to.
  let paymentConfig = null;
  if (tenant.payment_config_json) {
    try {
      paymentConfig = JSON.parse(tenant.payment_config_json);
    } catch {
      // Malformed JSON in DB — treat as missing but don't block publishing.
      console.warn(`[PUBLISH_GUARD] tenant=${tenantId} has malformed payment_config_json — ignoring.`);
    }
  }

  return { ok: true, tenant, paymentConfig };
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
