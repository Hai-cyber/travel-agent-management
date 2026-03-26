/**
 * Site Studio — per-tenant template rendering pipeline
 *
 * Flow:
 *   1. resolveTenantByHost(host, db)  → tenant row
 *   2. serveSitePage(tenant, env)     → streamed HTMLRewriter Response
 *
 * R2 key convention  (SITE_TEMPLATES bucket):
 *   templates/[template_id]/index.html   ← base page layout
 *   templates/[template_id]/style.css    ← base stylesheet
 *   templates/[template_id]/thumb.webp   ← picker thumbnail
 *
 * HTMLRewriter pipeline applies:
 *   <title>                          → site_config.brand.name
 *   <meta name="description">        → site_config.content.hero_desc
 *   <meta property="og:title">       → site_config.brand.name
 *   <meta property="og:description"> → site_config.content.hero_desc
 *   <meta name="theme-color">        → site_config.brand.primary_color
 *   </body>                          ← <script src="/inject.js"> injected before
 *   custom_selectors                 → setInnerContent on matched CSS elements
 */

// ─────────────────────────────────────────────────────────────────────────────
// Security helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Escape HTML attribute special characters.
 * [SEC] Pre-escape tenant-supplied strings before passing to setAttribute() —
 *       HTMLRewriter inserts attribute values verbatim in some edge cases.
 */
function escAttr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Allowed CSS selector pattern for custom_selectors keys.
 * Only permits characters that appear in valid CSS class/id/attribute selectors.
 * [SEC] Tenant-controlled keys are validated here before being passed to
 *       HTMLRewriter's .on() — prevents selector injection or engine panics.
 */
// Exported so tenants.js PATCH handler can validate incoming selector keys
// with the same rule used by the HTMLRewriter pipeline.
export const SAFE_SELECTOR_RE = /^[a-zA-Z0-9_\-#.[\]="': >+~^$*|()]+$/;

// ─────────────────────────────────────────────────────────────────────────────
// Tenant resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a tenant from the incoming Host header.
 *
 * Match priority:
 *   1. Exact custom_domain match  — e.g. "tours.mycompany.com"
 *   2. Platform subdomain match   — leftmost label of host,
 *      e.g. "myagency" from "myagency.tourplatform.vn"
 *
 * Both paths require subscription_status = 'ACTIVE'.
 *
 * Returns { id, subscription_status, template_id, site_config } or null.
 */
export async function resolveTenantByHost(host, db) {
  // Strip port suffix present during local dev (e.g. "localhost:8787" → "localhost")
  const bareHost = host.split(':')[0];

  // 1. Exact custom_domain lookup
  const byDomain = await db
    .prepare(
      `SELECT id, subscription_status, template_id, site_config, payment_methods
         FROM tenants
        WHERE custom_domain = ? AND subscription_status = 'ACTIVE'`
    )
    .bind(bareHost)
    .first();
  if (byDomain) return byDomain;

  // 2. Platform subdomain lookup — requires at least two labels ("sub.platform.tld")
  //    Single-label hosts like "localhost" are silently skipped.
  const labels = bareHost.split('.');
  if (labels.length < 2) return null;

  const subLabel = labels[0];
  return db
    .prepare(
      `SELECT id, subscription_status, template_id, site_config, payment_methods
         FROM tenants
        WHERE subdomain = ? AND subscription_status = 'ACTIVE'`
    )
    .bind(subLabel)
    .first();
}

// ─────────────────────────────────────────────────────────────────────────────
// Template fetch
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch the site template's index.html from the SITE_TEMPLATES R2 bucket.
 * Falls back to tmpl-minimal-v1 when the assigned template key is missing.
 * Returns a Response suitable for streaming into HTMLRewriter, or null.
 */
async function fetchTemplateResponse(templateId, r2Bucket) {
  const primaryKey  = `templates/${templateId}/index.html`;
  const fallbackKey = 'templates/tmpl-minimal-v1/index.html';

  let obj = await r2Bucket.get(primaryKey);
  if (!obj && templateId !== 'tmpl-minimal-v1') {
    obj = await r2Bucket.get(fallbackKey);
  }
  if (!obj) return null;

  return new Response(obj.body, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// HTMLRewriter pipeline
// ─────────────────────────────────────────────────────────────────────────────

/**
 * serveSitePage — main Site Studio rendering entry point.
 *
 * 1. Parses the tenant's site_config JSON (falls back to empty defaults on error).
 * 2. Fetches the assigned HTML template from SITE_TEMPLATES R2.
 * 3. Streams the HTML through an HTMLRewriter pipeline that:
 *      • Replaces <title> with brand.name
 *      • Updates description / og:title / og:description / theme-color meta tags
 *      • Appends <script src="/inject.js"></script> before </body>
 *      • Replaces inner text of any elements matching custom_selectors keys
 *
 * @param {object} tenant          — row returned by resolveTenantByHost
 * @param {object} env             — Worker env bindings (must include SITE_TEMPLATES)
 * @param {object} [options={}]
 * @param {string} [options.injectScript='/inject.js']
 *   Override the script injected before </body>. Pass '/editor-bridge.js' to
 *   activate the Visual Editor click-to-select bridge.
 * @returns {Response}
 */
export async function serveSitePage(tenant, env, options = {}) {
  const injectScript = options.injectScript ?? '/inject.js';
  if (!env.SITE_TEMPLATES) {
    return new Response(
      'SITE_TEMPLATES R2 binding is not configured in wrangler.jsonc.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }

  const templateId = tenant.template_id ?? 'tmpl-minimal-v1';

  // Parse site_config — malformed JSON silently falls back to empty defaults.
  let cfg = {};
  try {
    if (tenant.site_config) cfg = JSON.parse(tenant.site_config);
  } catch {
    // Intentional: serve template with bare defaults rather than 500-ing.
  }

  const brand    = cfg.brand    ?? {};
  const content  = cfg.content  ?? {};
  const selectors = cfg.custom_selectors ?? {};

  const brandName  = brand.name          ?? '';
  const heroDesc   = content.hero_desc   ?? '';
  const themeColor = brand.primary_color ?? '';

  // Fetch the base HTML template
  const templateRes = await fetchTemplateResponse(templateId, env.SITE_TEMPLATES);
  if (!templateRes) {
    return new Response(
      `Site template "${templateId}" not found.\n` +
      `Upload templates/${templateId}/index.html to the SITE_TEMPLATES R2 bucket.`,
      { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }

  // ── HTMLRewriter pipeline ─────────────────────────────────────────────────
  //
  // setInnerContent(text)         → html:false by default, engine escapes text safely.
  // setAttribute('content', val)  → pre-escaped via escAttr() as an extra safety belt.
  //
  const rewriter = new HTMLRewriter()

    // <title> → brand name
    .on('title', {
      element(el) {
        if (brandName) el.setInnerContent(brandName);
      },
    })

    // <meta name="description"> → hero description
    .on('meta[name="description"]', {
      element(el) {
        if (heroDesc) el.setAttribute('content', escAttr(heroDesc));
      },
    })

    // <meta property="og:title"> → brand name
    .on('meta[property="og:title"]', {
      element(el) {
        if (brandName) el.setAttribute('content', escAttr(brandName));
      },
    })

    // <meta property="og:description"> → hero description
    .on('meta[property="og:description"]', {
      element(el) {
        if (heroDesc) el.setAttribute('content', escAttr(heroDesc));
      },
    })

    // <meta name="theme-color"> → primary brand colour
    .on('meta[name="theme-color"]', {
      element(el) {
        if (themeColor) el.setAttribute('content', escAttr(themeColor));
      },
    })

    // Inject client-side customisation script just before </body>
    .on('body', {
      element(el) {
        el.append(`<script src="${escAttr(injectScript)}"></script>`, { html: true });
      },
    });

  // Apply custom_selectors — replace inner text of each matched element.
  // [SEC] Selector keys are validated against SAFE_SELECTOR_RE before use.
  //       Values are treated as plain text (setInnerContent html:false).
  for (const [rawSelector, rawValue] of Object.entries(selectors)) {
    if (!SAFE_SELECTOR_RE.test(rawSelector)) continue;
    // Capture per-iteration binding — each closure captures its own textValue.
    const textValue = String(rawValue ?? '');
    rewriter.on(rawSelector, {
      element(el) {
        el.setInnerContent(textValue);
      },
    });
  }

  return rewriter.transform(templateRes);
}
