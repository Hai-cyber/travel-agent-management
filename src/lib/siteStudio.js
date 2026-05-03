/**
 * Site Studio — per-tenant template rendering pipeline
 *
 * Flow:
 *   1. resolveTenantByHost(host, db)  → tenant row
 *   2. serveSitePage(tenant, env)     → streamed HTMLRewriter Response
 *
 * R2 key convention  (SITE_TEMPLATES bucket):
 *   {template_id}/index.html   ← base page layout
 *   {template_id}/style.css    ← per-template CSS (DROPPED — see cruip-global.css)
 *   shared/cruip-global.css    ← single shared Tailwind v4 stylesheet (all Cruip templates)
 *
 * HTMLRewriter pipeline applies:
 *   <title>                          → site_config.brand.name
 *   <meta name="description">        → site_config.content.hero_desc
 *   <meta property="og:title">       → site_config.brand.name
 *   <meta property="og:description"> → site_config.content.hero_desc
 *   <meta name="theme-color">        → site_config.brand.primary_color
 *   <link href="style.css">           REMOVED for Cruip (-html) templates
 *   </head>                          ← <link href="/css/cruip-global.css"> injected
 *   </body>                          ← <script src="/inject.js"> injected before
 *   custom_selectors                 → setInnerContent on matched CSS elements
 */

import { buildTenantTrustPolicy } from './trustAbuse.js';

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
 * Custom domains require ACTIVE + TRUSTED + verification.
 * Platform subdomains allow TRIAL or ACTIVE for showcase publishing.
 *
 * Returns { id, subscription_status, template_id, site_config, default_locale, booking_currency, market_skin_key, primary_market } or null.
 */
export async function resolveTenantByHost(host, db) {
  // Strip port suffix present during local dev (e.g. "localhost:8787" → "localhost")
  const bareHost = host.split(':')[0];

  // 1. Exact custom_domain lookup
  const byDomain = await db
    .prepare(
            `SELECT id, subscription_status, template_id, site_config, payment_methods, terms_accepted, default_locale, booking_currency, market_skin_key, primary_market,
              'custom_domain' AS resolved_host_type,
              trust_status, public_indexing_enabled, custom_domain_verified_at, subdomain, custom_domain, promo_activated
         FROM tenants
        WHERE custom_domain = ?
          AND subscription_status = 'ACTIVE'
          AND trust_status = 'TRUSTED'
          AND custom_domain_verified_at IS NOT NULL`
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
      `SELECT id, subscription_status, template_id, site_config, payment_methods, terms_accepted, default_locale, booking_currency, market_skin_key, primary_market,
              'platform_subdomain' AS resolved_host_type,
              trust_status, public_indexing_enabled, custom_domain_verified_at, subdomain, custom_domain, promo_activated
         FROM tenants
        WHERE subdomain = ?
          AND subscription_status IN ('ACTIVE', 'TRIAL')
          AND trust_status IN ('PREVIEW_ONLY', 'PROBATION', 'TRUSTED')`
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
  // Try both key conventions:
  //   1. "templates/{id}/index.html"  — documented convention (original)
  //   2. "{id}/index.html"            — direct prefix (used by seed-site-templates.mjs)
  const keys = [
    `templates/${templateId}/index.html`,
    `${templateId}/index.html`,
  ];
  const fallbacks = [
    'templates/tmpl-minimal-v1/index.html',
    'tmpl-minimal-v1/index.html',
  ];

  let obj = null;
  for (const key of keys) {
    obj = await r2Bucket.get(key);
    if (obj) break;
  }
  if (!obj && templateId !== 'tmpl-minimal-v1') {
    for (const key of fallbacks) {
      obj = await r2Bucket.get(key);
      if (obj) break;
    }
  }
  if (!obj) return null;

  return new Response(obj.body, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Template chrome extraction  (header + footer + stylesheet for canvas mode)
// ─────────────────────────────────────────────────────────────────────────────
// Reads the template's index.html from R2 once, extracts the <header> and
// <footer> blocks with a depth-aware walker (handles nested tags correctly),
// and rewrites all relative asset paths → template-asset proxy before
// returning.  Also extracts the template's primary compiled stylesheet link
// so canvas mode applies the correct Tailwind CSS without loading the entire
// template HTML.
//
// Returns { headerHtml, footerHtml, styleLinkHtml }.
// Any field is an empty string if the element is absent or R2 read fails.

async function extractTemplateChrome(templateId, r2Bucket) {
  const keys = [
    `templates/${templateId}/index.html`,
    `${templateId}/index.html`,
  ];
  let text = null;
  for (const key of keys) {
    try {
      const obj = await r2Bucket.get(key);
      if (obj) { text = await obj.text(); break; }
    } catch { /* continue */ }
  }
  if (!text) return { headerHtml: '', footerHtml: '', styleLinkHtml: '' };

  // Depth-aware tag extractor — handles <header> inside <header> etc.
  function extractTag(tagName, html) {
    const startRe = new RegExp(`<${tagName}(\\b[^>]*)>`, 'i');
    const startIdx = html.search(startRe);
    if (startIdx === -1) return '';
    let depth = 0;
    let i = startIdx;
    while (i < html.length) {
      if (html[i] !== '<') { i++; continue; }
      const gt = html.indexOf('>', i);
      if (gt === -1) break;
      const tag = html.slice(i, gt + 1);
      if (new RegExp(`^<${tagName}(\\s|>)`, 'i').test(tag))          depth++;
      else if (new RegExp(`^<\\/${tagName}\\s*>`, 'i').test(tag)) {
        depth--;
        if (depth === 0) return html.slice(startIdx, gt + 1);
      }
      i = gt + 1;
    }
    return '';
  }

  let headerHtml = extractTag('header', text);
  let footerHtml = extractTag('footer', text);

  // Rewrite relative src / style url() references → template-asset proxy.
  if (headerHtml) headerHtml = rewriteHtmlRelativePaths(headerHtml, templateId);
  if (footerHtml) footerHtml = rewriteHtmlRelativePaths(footerHtml, templateId);

  // Extract the template's primary compiled stylesheet link.
  // This brings in Open Pro's Tailwind output and custom CSS variables
  // so sections rendered in canvas mode look identical to the real template.
  let styleLinkHtml = '';
  const linkMatch = text.match(
    /<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["'][^>]*>/i
  );
  if (linkMatch) {
    const href = linkMatch[1].trim();
    if (!isAbsoluteOrSkip(href)) {
      styleLinkHtml =
        `<link rel="stylesheet" href="/api/tenant/template-assets/${templateId}/${href}">`;
    }
  }

  return { headerHtml, footerHtml, styleLinkHtml };
}


// ─────────────────────────────────────────────────────────────────────────────
// HTMLRewriter pipeline
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true for paths that must NOT be rewritten to template-asset proxy URLs:
 *   - empty strings
 *   - http / https absolute URLs
 *   - protocol-relative  //
 *   - data: URIs         data:
 *   - blob: URIs         blob:
 *   - already-absolute paths that start with /  (e.g. already proxied)
 */
function isAbsoluteOrSkip(path) {
  if (!path) return true;
  return (
    path.startsWith('http://') ||
    path.startsWith('https://') ||
    path.startsWith('//') ||
    path.startsWith('data:') ||
    path.startsWith('blob:') ||
    path.startsWith('/')
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic nav injection into extracted template header (canvas mode)
// ─────────────────────────────────────────────────────────────────────────────
// The HTMLRewriter .on('nav ul') handler rewrites nav links in template mode
// (where the full template HTML streams through the rewriter).  Canvas mode
// builds the page as a string and injects the extracted <header> directly —
// HTMLRewriter never sees it.  This function fills that gap.
//
// Strategy: find the first <ul> that appears after a <nav opening tag inside
// the header HTML string, then replace its inner content with the pre-built
// navLinksHtml.  The opening/closing <ul> tags (with any classes or attrs)
// are preserved wholesale.  When navLinksHtml is empty the header is returned
// unchanged so the template’s default placeholder links are kept.
//
// [SEC] navLinksHtml is built from site_config.navigation which is already
//       sanitised by the PATCH handler (sanitizeNavUrl + escAttr on label).

function injectMenuIntoHeader(headerHtml, navLinksHtml) {
  if (!navLinksHtml) return headerHtml;

  // Find the first <nav opening in the header.
  const navIdx = headerHtml.search(/<nav\b/i);
  if (navIdx === -1) return headerHtml;

  const preNav  = headerHtml.slice(0, navIdx);
  const fromNav = headerHtml.slice(navIdx);

  // Replace the first <ul>...</ul> found after the <nav with navLinksHtml.
  const replaced = fromNav.replace(
    /(<ul\b[^>]*>)([\s\S]*?)(<\/ul\s*>)/i,
    (_, openTag, _inner, closeTag) => openTag + navLinksHtml + closeTag
  );
  return preNav + replaced;
}

// ─────────────────────────────────────────────────────────────────────────────
// Header UI controls — showPhone, showCart, showContactForm
// ─────────────────────────────────────────────────────────────────────────────
//
// Appends zero or more action widgets into the header's action zone.
// Strategy: find the </nav> closing tag (or failing that, </header>), then
// insert the widgets HTML immediately before that closing tag.
//
// Generated HTML uses only Tailwind v4 utility classes that are already
// present in cruip-global.css so no extra CSS is loaded.
//
// [SEC] navConfig values are boolean — only the true/false branch is used,
//       no tenant-supplied strings are interpolated.
//
function injectHeaderUiControls(headerHtml, navConfig = {}) {
  const { showPhone, showCart, showContactForm } = navConfig;
  if (!showPhone && !showCart && !showContactForm) return headerHtml;

  const parts = [];

  if (showPhone) {
    parts.push(
      `<a href="tel:" class="inline-flex items-center gap-1.5 text-sm font-medium` +
      ` text-gray-300 hover:text-white transition" data-ve-nav-phone aria-label="Phone">` +
      `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none"` +
      ` viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">` +
      `<path stroke-linecap="round" stroke-linejoin="round"` +
      ` d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257` +
      ` 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1` +
      ` 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/>` +
      `</svg><span class="hidden sm:inline">Call Us</span></a>`
    );
  }

  if (showCart) {
    parts.push(
      `<button type="button" class="relative inline-flex items-center justify-center` +
      ` h-9 w-9 rounded-full text-gray-300 hover:text-white hover:bg-gray-800/60` +
      ` transition" data-ve-nav-cart aria-label="Cart">` +
      `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"` +
      ` viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">` +
      `<path stroke-linecap="round" stroke-linejoin="round"` +
      ` d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293` +
      ` 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2` +
      ` 2 0 11-4 0 2 2 0 014 0z"/>` +
      `</svg></button>`
    );
  }

  if (showContactForm) {
    parts.push(
      `<button type="button" class="inline-flex items-center gap-1.5 rounded-full` +
      ` bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-4 py-1.5` +
      ` transition" data-ve-nav-contact aria-label="Contact">` +
      `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none"` +
      ` viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">` +
      `<path stroke-linecap="round" stroke-linejoin="round"` +
      ` d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5` +
      ` a2 2 0 00-2 2v10a2 2 0 002 2z"/>` +
      `</svg>Contact</button>`
    );
  }

  if (!parts.length) return headerHtml;

  const widgetsHtml =
    `\n<div class="flex items-center gap-3 ml-auto" data-ve-nav-controls>\n  ` +
    parts.join('\n  ') +
    `\n</div>`;

  // Insert before </nav>, fallback to before </header>.
  if (/<\/nav\s*>/i.test(headerHtml)) {
    return headerHtml.replace(/<\/nav\s*>/i, widgetsHtml + '\n</nav>');
  }
  return headerHtml.replace(/<\/header\s*>/i, widgetsHtml + '\n</header>');
}

export function normalizeChromeConfig(value) {
  const chrome = value && typeof value === 'object' ? value : {};
  return {
    useMinimalHeader: chrome.useMinimalHeader !== false,
    useMinimalFooter: chrome.useMinimalFooter !== false,
    showFooterMenu: chrome.showFooterMenu === true,
    showLogo: chrome.showLogo !== false,
    effectStyle: typeof chrome.effectStyle === 'string'
      && ['glass', 'frost', 'shadow', 'outline'].includes(chrome.effectStyle)
      ? chrome.effectStyle
      : 'glass',
    shapeStyle: typeof chrome.shapeStyle === 'string'
      && ['bar', 'rounded', 'capsule', 'floating'].includes(chrome.shapeStyle)
      ? chrome.shapeStyle
      : 'bar',
    menuFontStyle: typeof chrome.menuFontStyle === 'string'
      && ['clean', 'elegant', 'compact'].includes(chrome.menuFontStyle)
      ? chrome.menuFontStyle
      : 'clean',
    logoFontStyle: typeof chrome.logoFontStyle === 'string'
      && ['brand', 'floral', 'luxe', 'script'].includes(chrome.logoFontStyle)
      ? chrome.logoFontStyle
      : 'brand',
    logoSize: typeof chrome.logoSize === 'string'
      && ['sm', 'md', 'lg', 'xl'].includes(chrome.logoSize)
      ? chrome.logoSize
      : 'md',
    ornamentStyle: typeof chrome.ornamentStyle === 'string'
      && ['none', 'glow', 'divider', 'dots'].includes(chrome.ornamentStyle)
      ? chrome.ornamentStyle
      : 'none',
  };
}

export function buildMinimalHeaderHtml({
  brandName,
  logoUrl,
  navItems,
  navConfig = {},
  contactPhone,
  effectStyle = 'glass',
  shapeStyle = 'bar',
  menuFontStyle = 'clean',
  logoFontStyle = 'brand',
  logoSize = 'md',
  ornamentStyle = 'none',
  showLogo = true,
}) {
  const menuHtml = navItems.length > 0
    ? navItems
        .map(({ label, url }) =>
          `<li><a href="${escAttr(String(url ?? '/'))}">${escAttr(String(label ?? ''))}</a></li>`
        )
        .join('')
    : '<li><a href="/">Home</a></li>';

  const logoImg = showLogo && logoUrl
    ? `<img src="${escAttr(logoUrl)}" alt="${escAttr(brandName || 'Brand')}" class="site-chrome-logo">`
    : '';

  const actions = [];
  if (navConfig.showPhone) {
    const href = contactPhone ? `tel:${escAttr(String(contactPhone).replace(/\s+/g, ''))}` : 'tel:';
    actions.push(`<a href="${href}" class="chrome-action chrome-action-link" data-ve-nav-phone>Phone</a>`);
  }
  if (navConfig.showContactForm) {
    actions.push('<a href="#contact" class="chrome-action chrome-action-primary" data-ve-nav-contact>Contact Us</a>');
  }
  if (navConfig.showCart) {
    actions.push('<button type="button" class="chrome-action chrome-action-icon" data-ve-nav-cart aria-label="Cart">Cart</button>');
  }

  const ornament = ornamentStyle === 'dots'
    ? '<div class="site-chrome-ornament site-chrome-ornament-dots" aria-hidden="true"><span></span><span></span><span></span></div>'
    : ornamentStyle === 'divider'
      ? '<div class="site-chrome-ornament site-chrome-ornament-divider" aria-hidden="true"></div>'
      : ornamentStyle === 'glow'
        ? '<div class="site-chrome-ornament site-chrome-ornament-glow" aria-hidden="true"></div>'
        : '';

  return `<header class="site-chrome site-chrome-header site-chrome-effect-${escAttr(effectStyle)} site-chrome-shape-${escAttr(shapeStyle)} site-chrome-font-${escAttr(menuFontStyle)} site-chrome-logo-font-${escAttr(logoFontStyle)} site-chrome-logo-size-${escAttr(logoSize)} site-chrome-ornament-${escAttr(ornamentStyle)}" data-ve-chrome="minimal-header">
  <div class="site-chrome-inner">
    <a href="/" class="site-chrome-brand">${logoImg}<span class="site-chrome-brand-text">${escAttr(brandName || 'Brand')}</span></a>
    <button type="button" class="site-chrome-menu-toggle" data-chrome-menu-toggle aria-expanded="false" aria-label="Open menu">
      <span class="site-chrome-menu-toggle-icon">☰</span>
      <span class="site-chrome-menu-toggle-label">Menu</span>
    </button>
    <div class="site-chrome-panel">
      <nav class="site-chrome-nav" aria-label="Primary">
        <ul>${menuHtml}</ul>
      </nav>
      <div class="site-chrome-actions">${actions.join('')}</div>
    </div>
  </div>
  ${ornament}
</header>`;
}

export function buildChromeMenuScript() {
  return `<script>
(function(){
  document.addEventListener('click', function (event) {
    var btn = event.target.closest('[data-chrome-menu-toggle]');
    if (!btn) return;
    var header = btn.closest('.site-chrome-header');
    if (!header) return;
    var isOpen = header.getAttribute('data-mobile-menu-open') === '1';
    header.setAttribute('data-mobile-menu-open', isOpen ? '0' : '1');
    btn.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
  });
}());
</script>`;
}

export function buildMinimalFooterHtml({
  brandName,
  logoUrl,
  navItems,
  showFooterMenu,
  effectStyle = 'glass',
  shapeStyle = 'bar',
  menuFontStyle = 'clean',
  logoFontStyle = 'brand',
  logoSize = 'md',
  ornamentStyle = 'none',
  showLogo = true,
}) {
  const year = new Date().getFullYear();
  const menuHtml = showFooterMenu && navItems.length > 0
    ? `<nav class="site-chrome-footer-nav" aria-label="Footer"><ul>${navItems
        .map(({ label, url }) =>
          `<li><a href="${escAttr(String(url ?? '/'))}">${escAttr(String(label ?? ''))}</a></li>`
        )
        .join('')}</ul></nav>`
    : '';
  const logoImg = showLogo && logoUrl
    ? `<img src="${escAttr(logoUrl)}" alt="${escAttr(brandName || 'Brand')}" class="site-chrome-logo site-chrome-logo-sm">`
    : '';

  return `<footer class="site-chrome site-chrome-footer site-chrome-effect-${escAttr(effectStyle)} site-chrome-shape-${escAttr(shapeStyle)} site-chrome-font-${escAttr(menuFontStyle)} site-chrome-logo-font-${escAttr(logoFontStyle)} site-chrome-logo-size-${escAttr(logoSize)} site-chrome-ornament-${escAttr(ornamentStyle)}" data-ve-chrome="minimal-footer">
  <div class="site-chrome-inner site-chrome-footer-inner">
    <div class="site-chrome-footer-copy">${logoImg}<span class="site-chrome-brand-text">${escAttr(brandName || 'Brand')} · ${year}</span></div>
    ${menuHtml}
    <a href="https://tours-market.com" target="_blank" rel="noopener" class="site-chrome-powered" style="font-size:10px;opacity:.55;text-decoration:none;margin-left:auto;white-space:nowrap">Powered by Tours Market</a>
  </div>
</footer>`;
}

// Script stripping for appended HTML strings (editor / preview mode only)
// ─────────────────────────────────────────────────────────────────────────────
// HTMLRewriter's .on('script') handler only processes the original template
// stream — it does NOT touch HTML injected later via el.append().
// custom_sections[].html blocks can contain Cruip/Alpine inline scripts
// (e.g. the video-modal Alpine.data() block in the Hero section).  Those
// scripts cause "Page Unresponsive" in the editor iframe because:
//   • Alpine.js itself is already stripped (via .on('script') above) so any
//     Alpine.data() / Alpine.store() call throws immediately.
//   • AOS.init() and similar loop-based init scripts burn CPU on every frame.
//
// This function removes ALL <script> tags — both external-src and inline —
// from a raw HTML string using a single regex pass.  It is intentionally
// applied ONLY when stripTemplateScripts = true so live public pages are
// never affected.
//
// Structured-data scripts (type="application/ld+json" etc.) are preserved
// because they contain no executable code and are needed for SEO.

function stripHtmlScripts(html) {
  // Remove <script ...>...</script> — covers external src and inline blocks.
  // Preserves <script type="application/ld+json"> and other data-only types.
  return html.replace(
    /<script(\b[^>]*)>([\s\S]*?)<\/script>/gi,
    (match, attrs) => {
      // Keep structured-data / import-map / text-template scripts unchanged.
      const typeMatch  = attrs.match(/type\s*=\s*['"]([^'"]+)['"]/i);
      const scriptType = typeMatch ? typeMatch[1].toLowerCase().trim() : '';
      if (scriptType.includes('json') || scriptType === 'importmap' ||
          scriptType === 'text/template' || scriptType === 'text/x-template') {
        return match;  // keep
      }
      return '';  // strip
    }
  );
}

// HTMLRewriter does NOT re-process HTML injected via el.append().
// We apply equivalent logic to the raw HTML string before passing it to
// el.append() so images, data-src, and style url() references resolve.
//
// [SEC] Only rewrites bare relative paths; absolute/data/blob URIs are left
//       untouched.  templateId is validated upstream before reaching here.

function rewriteHtmlRelativePaths(html, templateId) {
  const base = `/api/tenant/template-assets/${templateId}/`;

  // <img src="relative"> and <img data-src="relative">
  html = html.replace(
    /(<img\b[^>]*?\s)(src|data-src)(=)(["']?)([^"'>\s]+)\4/gi,
    (match, pre, attr, eq, q, rawPath) => {
      const path = rawPath.trim();
      if (isAbsoluteOrSkip(path)) return match;
      return `${pre}${attr}${eq}${q}${base}${path}${q}`;
    }
  );

  // style="... url(relative) ..."
  html = html.replace(
    /url\(\s*(['"]?)([^'"()\s]+)\1\s*\)/gi,
    (match, q, rawPath) => {
      const path = rawPath.trim();
      if (isAbsoluteOrSkip(path)) return match;
      return `url(${q}${base}${path}${q})`;
    }
  );

  return html;
}

// When a custom section contains <img data-ve-stock-img="travel">, the server
// replaces the src attribute with a random travel image from the tenant's own
// SITE_TEMPLATES bucket.  This makes freshly-added Gallery sections look great
// immediately without requiring any manual image uploads.
//
// Images are picked from the template's /images/ folder.  We list the R2 keys
// filtered to jpg/png/webp and shuffle using a fast seeded approach.
//
// Fallback: if R2 listing fails or returns no images, we use the Unsplash
// placeholders so the section is never empty.

const TRAVEL_FALLBACK_IMAGES = [
  'https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=600&q=80',
  'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&q=80',
  'https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=600&q=80',
  'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=600&q=80',
  'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=600&q=80',
  'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=600&q=80',
];

async function listTravelImages(templateId, r2Bucket) {
  try {
    const list = await r2Bucket.list({ prefix: `${templateId}/images/` });
    const imgs = list.objects
      .map(o => o.key)
      .filter(k => /\.(jpg|jpeg|png|webp)$/i.test(k) && !/overlay|bg\./.test(k))
      .map(k => `/api/tenant/template-assets/${templateId}/${k.slice(k.indexOf('/images/')  + 1)}`);
    return imgs.length ? imgs : TRAVEL_FALLBACK_IMAGES;
  } catch {
    return TRAVEL_FALLBACK_IMAGES;
  }
}

// Simple deterministic shuffle (Fisher-Yates seeded by Date.now() % array length)
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Replace all data-ve-stock-img="travel" placeholders with real template image URLs.
// Also rewrites src="" or src="data:..." placeholder next to the attribute.
function injectStockImages(html, travelImages) {
  const pool = shuffled(travelImages);
  let idx = 0;
  return html.replace(
    // Match <img ...> tags that carry data-ve-stock-img attribute
    /<img\b([^>]*?)data-ve-stock-img=["']travel["']([^>]*?)>/gi,
    (match, before, after) => {
      const src = pool[idx % pool.length];
      idx++;
      // Remove any existing src / data-src attrs, inject the real one
      const cleaned = (before + after).replace(/(?:src|data-src)=["'][^"']*["']/gi, '').trim();
      return `<img ${cleaned} src="${src}" data-ve-user-replaceable="1">`;
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// serveCanvasPage — Empty Canvas renderer
// ─────────────────────────────────────────────────────────────────────────────
//
// Builds a minimal HTML shell in memory — no R2 template fetch, no
// HTMLRewriter — and injects custom_sections directly into the body.
//
// Architecture:
//   1. DOCTYPE + <head>  — only cruip-global.css + brand color token override.
//   2. <nav>             — injected from cfg.navigation (if present).
//   3. <main id="canvas"> — custom_sections baked in order, each wrapped
//      with data-ve-section / data-ve-section-index sentinel attributes so
//      editor-bridge.js can still manage move / delete toolbars.
//   4. <script>          — inject.js or editor-bridge.js before </body>.
//
// Benefits vs template mode:
//   • Zero R2 reads per request (sub-millisecond rendering).
//   • Page structure is 100% determined by custom_sections — no hidden
//     template markup bleeds through.
//   • Trivially reorderable blocks: the order of the array IS the page.
//
// Activated when:
//   • options.canvasMode === true   (explicit)
//   • custom_sections.length > 0   (page built via Visual Editor, implicit)
//
// [SEC] All tenant-supplied values pass through escAttr() before interpolation.
//       custom_sections[].html is sanitised by the PATCH handler upstream.
//
async function serveCanvasPage({
  templateId,
  brandName,
  logoUrl,
  heroDesc,
  themeColor,
  themeClass,
  navItems,
  navConfig,          // { showPhone, showCart, showContactForm }
  chromeConfig,
  contactPhone,
  customSections,
  travelImagesPromise,
  injectScript,
  r2Bucket,
  stripTemplateScripts,
  bgH,   // integer 0–360 or null — background hue
  bgS,   // integer 0–100 or null — background saturation %
  bgL,   // integer 0–100 or null — background lightness %
  headerHeight, // integer px or null — measured by editor-bridge, stored in cfg
  responseHeaders,
  metaRobotsContent,
}) {
  // Kick off both async operations in parallel.
  const [travelImages, chrome] = await Promise.all([
    travelImagesPromise,
    r2Bucket
      ? extractTemplateChrome(templateId, r2Bucket)
      : Promise.resolve({ headerHtml: '', footerHtml: '', styleLinkHtml: '' }),
  ]);

  // ── Strip template scripts from header/footer when in editor/preview mode
  // (same reason we strip them from sections: Alpine.js is already removed
  //  by the outer HTMLRewriter pass, so any Alpine.data() call would throw).
  let { headerHtml, footerHtml, styleLinkHtml } = chrome;
  if (stripTemplateScripts) {
    if (headerHtml) headerHtml = stripHtmlScripts(headerHtml);
    if (footerHtml) footerHtml = stripHtmlScripts(footerHtml);
  }

  const normalizedChrome = normalizeChromeConfig(chromeConfig);
  if (normalizedChrome.useMinimalHeader) {
    headerHtml = buildMinimalHeaderHtml({
      brandName,
      logoUrl,
      navItems,
      navConfig: navConfig ?? {},
      contactPhone,
      effectStyle: normalizedChrome.effectStyle,
      shapeStyle: normalizedChrome.shapeStyle,
      menuFontStyle: normalizedChrome.menuFontStyle,
      logoFontStyle: normalizedChrome.logoFontStyle,
      logoSize: normalizedChrome.logoSize,
      ornamentStyle: normalizedChrome.ornamentStyle,
      showLogo: normalizedChrome.showLogo,
    });
  }
  if (normalizedChrome.useMinimalFooter) {
    footerHtml = buildMinimalFooterHtml({
      brandName,
      logoUrl,
      navItems,
      showFooterMenu: normalizedChrome.showFooterMenu,
      effectStyle: normalizedChrome.effectStyle,
      shapeStyle: normalizedChrome.shapeStyle,
      menuFontStyle: normalizedChrome.menuFontStyle,
      logoFontStyle: normalizedChrome.logoFontStyle,
      logoSize: normalizedChrome.logoSize,
      ornamentStyle: normalizedChrome.ornamentStyle,
      showLogo: normalizedChrome.showLogo,
    });
  }

  // ── Build nav links HTML (same escaping logic as serveSitePage) ───────────
  // Applies the tenant’s site_config.navigation items to the extracted header.
  // Falls back gracefully: empty navLinksHtml → template’s original links kept.
  const navLinksHtml = navItems.length > 0
    ? navItems
        .map(({ label, url }) =>
          `<li><a href="${escAttr(String(url ?? '/'))}">` +
          `${escAttr(String(label ?? ''))}</a></li>`
        )
        .join('')
    : '';

  // Inject tenant nav items into the extracted header’s first <nav><ul>.
  if (!normalizedChrome.useMinimalHeader && headerHtml && navLinksHtml) {
    headerHtml = injectMenuIntoHeader(headerHtml, navLinksHtml);
  }

  // Inject conditional UI controls (phone / cart / contact) into the header.
  if (!normalizedChrome.useMinimalHeader && headerHtml && navConfig) {
    headerHtml = injectHeaderUiControls(headerHtml, navConfig);
  }

  // ── Brand token + HSL background override ────────────────────────────────
  // Builds an inline :root { } block with all user-configurable CSS tokens.
  //
  // Architecture note (separation of concerns):
  //   --brand-primary / --brand-secondary  — brand.primary_color
  //   --bg-h  (0–360)                      — brand.bg_h (BG palette swatch hue)
  //   --bg-s  (0–100 %)                    — brand.bg_s (BG palette swatch saturation)
  //   --bg-l  (0–100 %)                    — brand.bg_l (Luminance slider)
  //
  //   Background is INDEPENDENT of data-theme. Themes only set --p/--s/--t.
  //   The three --bg-* vars together drive --bg via hsl() in theme-presets.css :root.
  //
  // [SEC] All three values are clamped integers before use as CSS values.
  const _tsv = [];   // token:value pairs
  if (themeColor && /^#[0-9a-fA-F]{3,6}$/.test(themeColor)) {
    _tsv.push(`--brand-primary:${themeColor}`);
    _tsv.push(`--brand-secondary:${themeColor}dd`);
  }
  if (bgH != null) _tsv.push(`--bg-h:${bgH}`);
  if (bgS != null) _tsv.push(`--bg-s:${bgS}%`);
  if (bgL != null) _tsv.push(`--bg-l:${bgL}%`);
  const themeStyle = _tsv.length
    ? `\n  <style>:root{${_tsv.join(';')};}</style>`
    : '';

  // ── Fallback nav — only shown when the template has no <header> ────────────
  // If we successfully extracted a real header from the template, this is skipped.
  const fallbackNavHtml = (!headerHtml && navItems.length > 0)
    ? `\n<nav class="fixed top-0 inset-x-0 z-30 bg-white/90 backdrop-blur-sm border-b border-gray-100">` +
      `<div class="max-w-7xl mx-auto px-4 sm:px-6 flex items-center h-14">` +
      `<ul class="flex gap-6 text-sm font-medium text-gray-700">` +
      navItems
        .map(({ label, url }) =>
          `<li><a href="${escAttr(String(url ?? '/'))}" class="hover:text-gray-900 transition">` +
          `${escAttr(String(label ?? ''))}</a></li>`
        )
        .join('') +
      `</ul></div></nav>`
    : '';

  // ── Custom sections ────────────────────────────────────────────────────────
  const sectionsHtml = customSections
    .map((s, i) => {
      let html = String(s.html ?? '').trim();
      if (!html) return '';

      // 1. Substitute travel stock-image placeholders.
      html = injectStockImages(html, travelImages);

      // 2. Rewrite relative asset paths → template-asset proxy.
      html = rewriteHtmlRelativePaths(html, templateId);

      // 3. Strip executable scripts in editor/preview mode.
      if (stripTemplateScripts) html = stripHtmlScripts(html);

      const safeId = escAttr(String(s.id ?? `sec-${i}`));
      return `  <div data-ve-section="${safeId}" data-ve-section-index="${i}">\n${html}\n  </div>`;
    })
    .filter(Boolean)
    .join('\n\n');

  // ── Assemble page ──────────────────────────────────────────────────────────
  // Structure:
  //   <head>   — cruip-global.css  +  template's own compiled CSS  +  brand tokens
  //   <header> — extracted from template (real Open Pro nav/logo) or fallback nav
  //   <main id="canvas"> — custom_sections baked in order
  //   <footer> — extracted from template
  //   <script> — inject.js or editor-bridge.js
  const page = `<!DOCTYPE html>
<html lang="en" class="scroll-smooth"${themeClass ? ` data-theme="${escAttr(themeClass)}"` : ''}>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escAttr(brandName)}</title>
  <meta name="description" content="${escAttr(heroDesc)}">
  ${metaRobotsContent ? `<meta name="robots" content="${escAttr(metaRobotsContent)}">` : ''}
  <meta property="og:title" content="${escAttr(brandName)}">
  <meta property="og:description" content="${escAttr(heroDesc)}">
  <link rel="stylesheet" href="/css/cruip-global.css">${styleLinkHtml ? `\n  ${styleLinkHtml}` : ''}
  <link rel="stylesheet" href="/css/theme-presets.css">${themeStyle}
  <style>
    html {
      background: var(--bg);
    }
    .site-chrome {
      width: 100%;
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      position: relative;
      isolation: isolate;
      background: color-mix(in srgb, var(--bg, #0f172a) 84%, white 16%);
    }
    .site-chrome-header {
      border-bottom: none;
    }
    .site-chrome-footer {
      border-top: none;
      margin-top: 3rem;
    }
    .site-chrome-inner {
      max-width: 1180px;
      margin: 0 auto;
      padding: 14px 20px;
      display: flex;
      flex-direction: row !important;
      flex-wrap: nowrap;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
    }
    .site-chrome-brand {
      flex: 0 0 auto;
      display: inline-flex;
      flex-direction: row !important;
      align-items: center;
      gap: 12px;
      font-size: 0.9rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--t, #e5e7eb);
      text-decoration: none;
      white-space: nowrap !important;
      width: auto !important;
      max-width: none !important;
    }
    .site-chrome-brand span {
      white-space: nowrap !important;
      width: auto !important;
      max-width: none !important;
    }
    .site-chrome-brand-text {
      display: inline-block;
      white-space: nowrap !important;
      line-height: 1;
      transform-origin: left center;
    }
    .site-chrome-logo {
      width: 38px;
      height: 38px;
      object-fit: contain;
      border-radius: 12px;
      background: color-mix(in srgb, var(--brand-primary, #2563eb) 14%, white 86%);
      padding: 6px;
      box-shadow: 0 10px 25px rgba(15, 23, 42, 0.18);
    }
    .site-chrome-logo-sm {
      width: 28px;
      height: 28px;
      border-radius: 10px;
      padding: 4px;
    }
    .site-chrome-nav {
      flex: 1 1 auto;
      min-width: 0;
      width: auto !important;
      max-width: none !important;
    }
    .site-chrome-panel {
      display: flex;
      align-items: center;
      gap: 20px;
      flex: 1 1 auto;
      min-width: 0;
    }
    .site-chrome-menu-toggle {
      display: none;
      align-items: center;
      gap: 8px;
      margin-left: auto;
      border: 1px solid color-mix(in srgb, var(--brand-primary, #2563eb) 20%, white 80%);
      background: transparent;
      color: var(--t, #e5e7eb);
      border-radius: 999px;
      padding: 8px 12px;
      font: 700 0.82rem/1 ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
    }
    .site-chrome-menu-toggle-icon {
      font-size: 1rem;
      line-height: 1;
    }
    .site-chrome-nav ul,
    .site-chrome-footer-nav ul {
      display: flex;
      flex-direction: row !important;
      flex-wrap: wrap;
      align-items: center;
      gap: 14px;
      list-style: none;
      margin: 0;
      padding: 0;
      width: auto !important;
      max-width: none !important;
    }
    .site-chrome-nav a,
    .site-chrome-footer-nav a {
      color: color-mix(in srgb, var(--t, #e5e7eb) 85%, white 15%);
      text-decoration: none;
      font-size: 0.92rem;
      white-space: nowrap !important;
    .site-chrome-panel {
      display: flex;
      align-items: center;
      gap: 20px;
      flex: 1 1 auto;
      min-width: 0;
    }
    .site-chrome-menu-toggle {
      display: none;
      align-items: center;
      gap: 8px;
      margin-left: auto;
      border: 1px solid color-mix(in srgb, var(--brand-primary, #2563eb) 20%, white 80%);
      background: transparent;
      color: var(--t, #e5e7eb);
      border-radius: 999px;
      padding: 8px 12px;
      font: 700 0.82rem/1 ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
    }
    .site-chrome-menu-toggle-icon {
      font-size: 1rem;
      line-height: 1;
    }
      width: auto !important;
      max-width: none !important;
    }
    .site-chrome-actions {
      display: flex;
      flex-direction: row !important;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      flex: 0 0 auto;
      white-space: nowrap !important;
      width: auto !important;
      max-width: none !important;
    }
    .chrome-action {
      border: 1px solid color-mix(in srgb, var(--brand-primary, #2563eb) 22%, white 78%);
      background: transparent;
      color: var(--t, #e5e7eb);
      border-radius: 999px;
      padding: 8px 12px;
      font: inherit;
      font-size: 0.84rem;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
      white-space: nowrap !important;
      width: auto !important;
      max-width: none !important;
    }
    .chrome-action-primary {
      background: var(--brand-primary, #2563eb);
      color: white;
      border-color: transparent;
    }
    .chrome-action-icon {
      min-width: 52px;
    }
    .site-chrome-footer-inner {
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      color: color-mix(in srgb, var(--t, #e5e7eb) 72%, white 28%);
      font-size: 0.86rem;
    }
    .site-chrome-footer-copy {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      white-space: nowrap;
    }
    .site-chrome-nav a,
    .site-chrome-footer-nav a,
    .site-chrome-brand,
    .chrome-action {
      transition: color .18s ease, background-color .18s ease, transform .18s ease;
    }
    .site-chrome-font-clean .site-chrome-nav a,
    .site-chrome-font-clean .site-chrome-footer-nav a {
      font-family: ui-sans-serif, system-ui, sans-serif;
      letter-spacing: 0.01em;
      font-weight: 600;
    }
    .site-chrome-font-elegant .site-chrome-nav a,
    .site-chrome-font-elegant .site-chrome-footer-nav a {
      font-family: Georgia, 'Times New Roman', serif;
      letter-spacing: 0.03em;
      font-weight: 700;
      text-transform: none;
    }
    .site-chrome-font-compact .site-chrome-nav a,
    .site-chrome-font-compact .site-chrome-footer-nav a {
      font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
      letter-spacing: 0.08em;
      font-size: 0.84rem;
      text-transform: uppercase;
    }
    .site-chrome-logo-font-brand .site-chrome-brand-text {
      font-family: 'Avenir Next', 'Helvetica Neue', ui-sans-serif, system-ui, sans-serif;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .site-chrome-logo-font-floral .site-chrome-brand-text {
      font-family: 'Snell Roundhand', 'Apple Chancery', 'URW Chancery L', cursive;
      font-weight: 700;
      letter-spacing: 0.02em;
      text-transform: none;
    }
    .site-chrome-logo-font-luxe .site-chrome-brand-text {
      font-family: 'Didot', 'Bodoni 72', 'Times New Roman', serif;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .site-chrome-logo-font-script .site-chrome-brand-text {
      font-family: 'Brush Script MT', 'Segoe Script', cursive;
      font-weight: 700;
      letter-spacing: 0.01em;
      text-transform: none;
    }
    .site-chrome-logo-size-sm .site-chrome-brand-text {
      font-size: 0.95rem;
    }
    .site-chrome-logo-size-md .site-chrome-brand-text {
      font-size: 1.15rem;
    }
    .site-chrome-logo-size-lg .site-chrome-brand-text {
      font-size: 1.38rem;
    }
    .site-chrome-logo-size-xl .site-chrome-brand-text {
      font-size: 1.68rem;
    }
    .site-chrome-shape-rounded {
      margin: 14px auto 0;
      max-width: min(1220px, calc(100% - 28px));
      border-radius: 24px;
      overflow: hidden;
    }
    .site-chrome-shape-capsule {
      margin: 16px auto 0;
      max-width: min(1180px, calc(100% - 40px));
      border-radius: 999px;
      overflow: hidden;
    }
    .site-chrome-shape-floating {
      margin: 18px auto 0;
      max-width: min(1140px, calc(100% - 48px));
      border-radius: 28px;
      overflow: hidden;
      transform: translateY(0);
    }
    .site-chrome-shape-bar {
      margin: 0;
      max-width: none;
      border-radius: 0;
    }
    .site-chrome-header.site-chrome-shape-bar + #canvas {
      margin-top: 0;
    }
    .site-chrome-ornament {
      position: absolute;
      inset: auto 20px 0 20px;
      pointer-events: none;
    }
    .site-chrome-ornament-divider {
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.28), transparent);
      bottom: 0;
    }
    .site-chrome-ornament-glow {
      height: 28px;
      bottom: -12px;
      filter: blur(18px);
      background: radial-gradient(circle at center, color-mix(in srgb, var(--brand-primary, #2563eb) 36%, white 64%), transparent 70%);
      opacity: .35;
    }
    .site-chrome-ornament-dots {
      display: flex;
      justify-content: center;
      gap: 8px;
      bottom: 10px;
    }
    .site-chrome-ornament-dots span {
      width: 5px;
      height: 5px;
      border-radius: 999px;
      background: rgba(255,255,255,0.38);
      display: inline-block;
    }
    .site-chrome-effect-glass {
      background: linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.08));
      box-shadow: 0 18px 50px rgba(15, 23, 42, 0.18);
    }
    .site-chrome-effect-frost {
      background: linear-gradient(180deg, rgba(255,255,255,0.26), rgba(255,255,255,0.12));
      box-shadow: 0 20px 45px rgba(15, 23, 42, 0.14);
    }
    .site-chrome-effect-shadow {
      background: color-mix(in srgb, var(--bg, #0f172a) 72%, white 28%);
      box-shadow: 0 24px 60px rgba(2, 6, 23, 0.28);
    }
    .site-chrome-effect-outline {
      background: color-mix(in srgb, var(--bg, #0f172a) 88%, white 12%);
      box-shadow: 0 18px 44px rgba(15, 23, 42, 0.12);
    }
    @media (max-width: 900px) {
      .site-chrome-inner {
        flex-wrap: wrap;
      }
      .site-chrome-menu-toggle {
        display: inline-flex;
      }
      .site-chrome-panel {
        display: none;
        order: 3;
        width: 100%;
        flex-direction: column;
        align-items: stretch;
        gap: 14px;
        padding-top: 12px;
      }
      .site-chrome-header[data-mobile-menu-open="1"] .site-chrome-panel {
        display: flex;
      }
      .site-chrome-nav,
      .site-chrome-actions {
        width: 100%;
      }
      .site-chrome-nav ul {
        flex-direction: column !important;
        align-items: flex-start;
        gap: 10px;
      }
      .site-chrome-actions {
        margin-left: 0;
        justify-content: flex-start;
        flex-wrap: wrap;
      }
      .site-chrome-footer-inner {
        flex-direction: column;
        align-items: flex-start;
      }
    }
    @media (max-width: 520px) {
      .site-chrome-menu-toggle-label {
        display: none;
      }
      .site-chrome-menu-toggle {
        padding-inline: 10px;
      }
    }
    /*
     * VE Canvas Layout Guard
     * ──────────────────────────────────────────────────────────────────────
     * Injected by siteStudio.js into every canvas render (editor + preview).
     *
     * Problem: Cruip template headers use various positions (absolute, sticky,
     * fixed, static). When position:absolute is used the header overlaps the
     * first snippet because absolute elements are out of normal flow.
     *
     * Solution — CSS-level, no JS timing required:
     *   1. body becomes a flex column → header is always a flex item
     *   2. body > header is forced sticky so it:
     *        a) stays at the top of the viewport on scroll, AND
     *        b) occupies space in the flex column (unlike absolute)
     *   3. #canvas gets flex-grow:1 so it fills remaining space naturally
     *   4. explicit z-index layering so header always paints above snippets
     *
     * cfg.header_height (optional) is also injected as padding-top on
     * #canvas — a server-side guarantee, zero JS timing required.
     */
    body {
      display: flex;
      flex-direction: column;
      min-height: 100vh;
      margin: 0;
      background-color: var(--bg);
      color: var(--t);
    }
    body > header {
      position: sticky !important;
      top: 0 !important;
      z-index: 9999 !important;
      flex-shrink: 0;
      isolation: isolate;
    }
    #canvas {
      flex-grow: 1;
      position: relative;
      z-index: 1;
    }
    #canvas > [data-ve-section]:first-child {
      margin-top: 0 !important;
      padding-top: 0 !important;
    }
    #canvas > [data-ve-section]:first-child > *:first-child {
      margin-top: 0 !important;
    }
  </style>
</head>
<body style="background-color:var(--bg);color:var(--t)" class="font-inter antialiased overflow-x-hidden">
${headerHtml || fallbackNavHtml}
<main id="canvas">
${sectionsHtml || '  <!-- empty canvas — add sections via the Visual Editor -->'}
</main>
${footerHtml}
${buildChromeMenuScript()}
<script src="${escAttr(injectScript)}"></script>
</body>
</html>`;

  return new Response(page, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...(responseHeaders || {}) },
  });
}

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
 * @param {boolean} [options.stripTemplateScripts=false]
 *   When true, strip ALL <script> tags originating from the template (both
 *   external src references and inline blocks).  Enabled automatically when
 *   injectScript is '/editor-bridge.js' (Visual Editor preview mode).
 *   Purpose: Cruip/Tailwind templates include Alpine.js, AOS, and similar
 *   animation scripts that can conflict with editor-bridge.js or consume
 *   excess CPU.  The editor only needs CSS to render the UI.
 * @returns {Response}
 */
export async function serveSitePage(tenant, env, options = {}) {
  const injectScript         = options.injectScript ?? '/inject.js';
  // Auto-enable script stripping for editor/preview mode
  const stripTemplateScripts = options.stripTemplateScripts ?? (injectScript === '/editor-bridge.js');
  const trustPolicy = buildTenantTrustPolicy(tenant);
  const responseHeaders = Object.assign(
    {},
    options.responseHeaders || {},
    trustPolicy.force_noindex ? { 'X-Robots-Tag': trustPolicy.robots_directive } : {}
  );
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

  // Pre-fetch travel images for stock-photo substitution in new (unfilled) sections.
  // Done in parallel with the template fetch; result consumed by body handler below.
  const travelImagesPromise = listTravelImages(templateId, env.SITE_TEMPLATES);

  const brand    = cfg.brand    ?? {};
  const content  = cfg.content  ?? {};
  const selectors         = cfg.custom_selectors ?? {};
  const imgs              = cfg.custom_imgs      ?? {};
  const customSections    = Array.isArray(cfg.custom_sections) ? cfg.custom_sections : [];
  const navItems          = Array.isArray(cfg.navigation)      ? cfg.navigation      : [];
  // Header UI config — boolean toggles stored in site_config.navigation_config.
  const navConfig = cfg.navigation_config && typeof cfg.navigation_config === 'object'
    ? {
        showPhone:       cfg.navigation_config.showPhone       === true,
        showCart:        cfg.navigation_config.showCart        === true,
        showContactForm: cfg.navigation_config.showContactForm === true,
      }
    : null;
  const chromeConfig = normalizeChromeConfig(cfg.chrome_config);

  const brandName  = brand.name          ?? '';
  const logoUrl    = brand.logo_url      ?? '';
  const heroDesc   = content.hero_desc   ?? '';
  const contactPhone = content.contact_phone ?? '';
  const themeColor = brand.primary_color ?? '';
  // [SEC] HSL background components — independent of accent theme.
  //       Stored in site_config.brand as bg_h / bg_s / bg_l by the VE.
  //       All three clamped to valid integer ranges before use as CSS values.
  const bgH = typeof brand.bg_h === 'number' && isFinite(brand.bg_h)
    ? Math.max(0, Math.min(360, Math.round(brand.bg_h))) : null;
  const bgS = typeof brand.bg_s === 'number' && isFinite(brand.bg_s)
    ? Math.max(0, Math.min(100, Math.round(brand.bg_s))) : null;
  const bgL = typeof brand.bg_l === 'number' && isFinite(brand.bg_l)
    ? Math.max(0, Math.min(100, Math.round(brand.bg_l))) : null;
  // Stored header height — measured by editor-bridge.js when a snippet is first
  // inserted, persisted via PATCH to cfg.header_height, injected as CSS padding-top
  // on #canvas to guarantee clearance without any client-side JS timing.
  const headerHeight = typeof cfg.header_height === 'number' && isFinite(cfg.header_height)
    ? Math.max(0, Math.min(400, Math.round(cfg.header_height))) : null;
  // Theme key from site_config.current_theme — e.g. "ocean-blue", "jungle-trek".
  // Applied as data-theme="<key>" on <html> so /css/theme-presets.css takes effect.
  const themeClass = typeof cfg.current_theme === 'string'
    ? cfg.current_theme.trim().slice(0, 40)
    : '';

  // Pre-build the nav <ul> inner HTML from tenant navigation items.
  // Built once here so the HTMLRewriter closure is allocation-free.
  // [SEC] escAttr() on both label and href; url validated in PATCH handler.
  const navLinksHtml = navItems.length > 0
    ? navItems
        .map(({ label, url }) =>
          `<li><a href="${escAttr(String(url ?? '/'))}">` +
          `${escAttr(String(label ?? ''))}</a></li>`
        )
        .join('')
    : '';

  // ── Canvas mode — ALWAYS active ─────────────────────────────────────────────
  //
  // Template chrome (header + footer) is extracted from the R2 template via
  // extractTemplateChrome().  The section content is 100% controlled by the
  // custom_sections array — the template's own body sections are NEVER injected
  // automatically.  When custom_sections is empty this renders only
  // Header + (empty <main>) + Footer — the correct blank slate for a new page.
  //
  // Switching templates therefore changes only:
  //   • template_id on the tenant → new CSS/assets / new chrome
  //   • custom_sections is UNCHANGED — the user must drag sections from Snippets
  return serveCanvasPage({
    templateId,
    brandName,
    logoUrl,
    heroDesc,
    themeColor,
    themeClass,
    navItems,
    navConfig,
    chromeConfig,
    contactPhone,
    customSections,
    travelImagesPromise,
    injectScript,
    r2Bucket:            env.SITE_TEMPLATES,
    stripTemplateScripts,
    bgH,
    bgS,
    bgL,
    headerHeight,
    responseHeaders,
    metaRobotsContent: trustPolicy.force_noindex ? trustPolicy.robots_directive : null,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Sandbox initialisation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default site_config — applied when a tenant has no existing config or when a
 * top-level section is absent. Existing values are always preserved — only
 * missing keys are back-filled.
 *
 * custom_selectors and custom_imgs are intentionally empty here; they
 * are populated per-template by TEMPLATE_RICH_DEFAULTS during sandbox init.
 */
const DEFAULT_SITE_CONFIG = {
  brand: {
    name:          'Horizon Travel',
    logo_url:      '',
    primary_color: '#0ea5e9',
  },
  content: {
    hero_title:    'The World Is Yours to Explore',
    hero_desc:     'Handcrafted journeys to extraordinary destinations — curated by experts who live to travel.',
    contact_phone: '',
  },
  features: {
    whatsapp_toggle:     true,
    review_toggle:       true,
    hotel_module_active: false,
  },
  chrome_config: {
    useMinimalHeader: true,
    useMinimalFooter: true,
    showFooterMenu:   false,
    showLogo:         true,
    effectStyle:      'glass',
    shapeStyle:       'bar',
    menuFontStyle:    'clean',
    logoFontStyle:    'brand',
    logoSize:         'md',
    ornamentStyle:    'none',
  },
  custom_selectors: {},
  custom_imgs:      {},
};

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE_RICH_DEFAULTS
//
// Per-template CSS selector → content maps applied the FIRST TIME a sandbox
// is initialised. Think of it as "demo content" that makes the template look
// like a real travel-agency website straight away.
//
// Cruip templates use Tailwind utility classes + Alpine.js x-data attributes
// so CSS selector targeting is fragile. The _fallback entry provides safe
// generic h1/h2 defaults that Cruip templates will honour.
//
// custom_selectors: { cssSelector → inner text }
// custom_imgs:      { cssSelector → new src URL (Unsplash or CDN, no API key) }
//
// [SEC] All selector keys are validated by SAFE_SELECTOR_RE before use in
//       HTMLRewriter. Image URLs are clamped to https:// only.
// ─────────────────────────────────────────────────────────────────────────────
const TEMPLATE_RICH_DEFAULTS = {

  // All Cruip (-html) templates use the _fallback defaults below.
  // html5up-* templates were retired 2026-03 — all entries removed.

  // ── Fallback — used by all Cruip templates and any unlisted template ───────
  _fallback: {
    brand: {
      name:          'Horizon Travel',
      primary_color: '#0ea5e9',
    },
    custom_selectors: {
      'h1':   'The World Is Yours to Explore',
      'h2':   'Extraordinary Destinations, Expertly Curated',
      '#header p':  'Premium travel experiences across 6 continents.',
    },
    custom_imgs: {},
  },
};

// [SEC] Only allow alphanumeric characters, hyphens, and underscores in any
//       identifier used to build R2 key paths. Prevents path traversal.
const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * Collect all R2 objects under a prefix, following pagination cursors.
 * Returns an array of R2Object metadata (with .key, .httpMetadata, etc.).
 * Exported so other route handlers (e.g. tenants.js publish-site) can reuse
 * without duplicating the pagination loop.
 *
 * @param {R2Bucket} bucket
 * @param {string}   prefix
 * @returns {Promise<Array<{key: string, httpMetadata?: object}>>}
 */
export async function listAllObjects(bucket, prefix) {
  const results = [];
  let cursor;

  do {
    const opts = cursor ? { prefix, cursor } : { prefix };
    const page  = await bucket.list(opts);
    results.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return results;
}

/**
 * initializeTenantSandbox — copy a site template into a tenant-scoped sandbox
 * inside the TOUR_PAGES R2 bucket, then wire up the tenant's D1 record.
 *
 * Steps:
 *  1. Input validation (safe-ID check, tenant existence, template existence).
 *  2. List  existing sandbox/{tenantId}/ files in TOUR_PAGES → batch delete.
 *  3. List  all template files in SITE_TEMPLATES under prefix `templateId/`.
 *  4. Stream-copy each file to TOUR_PAGES at sandbox/{tenantId}/{relPath}.
 *  5. UPDATE tenants: set template_id, deep-merge site_config with defaults.
 *
 * @param {string}    tenantId    — tenant primary key (e.g. "ten-demo-001")
 * @param {string}    templateId  — site_templates.id / R2 prefix (e.g. "default")
 * @param {object}    env         — Worker env bindings (SITE_TEMPLATES, TOUR_PAGES, DB)
 * @param {D1Database} db         — D1 database binding (alias for env.DB)
 * @returns {Promise<{copied: number, deleted: number, tenantId: string, templateId: string}>}
 */
export async function initializeTenantSandbox(tenantId, templateId, env, db, options = {}) {
  // options.preserveSections {boolean} — when true (template switch path):
  //   • custom_sections in site_config are left entirely untouched.
  //   • custom_selectors / custom_imgs are NOT overwritten with template
  //     rich-defaults — only the template_id column is changed.
  //   Use false (default) only on first-time tenant onboarding where
  //   injecting demo content is desired to show a populated preview.
  const preserveSections = options.preserveSections === true;

  // ── 1. Validate inputs ────────────────────────────────────────────────────
  if (!SAFE_ID_RE.test(tenantId)) {
    throw new Error(`[SANDBOX] Invalid tenantId: "${tenantId}". Only [a-zA-Z0-9_-] allowed.`);
  }
  if (!SAFE_ID_RE.test(templateId)) {
    throw new Error(`[SANDBOX] Invalid templateId: "${templateId}". Only [a-zA-Z0-9_-] allowed.`);
  }
  if (!env.SITE_TEMPLATES) throw new Error('[SANDBOX] SITE_TEMPLATES R2 binding is not configured.');
  if (!env.TOUR_PAGES)     throw new Error('[SANDBOX] TOUR_PAGES R2 binding is not configured.');

  const _db = db ?? env.DB;
  if (!_db) throw new Error('[SANDBOX] D1 database binding (DB) is not available.');

  // Confirm tenant exists — also loads current site_config to merge against.
  const tenant = await _db
    .prepare('SELECT id, site_config FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();
  if (!tenant) throw new Error(`[SANDBOX] Tenant "${tenantId}" not found.`);

  // Confirm the template has files in the SITE_TEMPLATES bucket.
  // Use prefix = templateId + '/' so a template called "default" matches
  // "default/index.html" but not an unrelated "defaultXYZ/…".
  const templatePrefix = `${templateId}/`;
  const templateFiles  = await listAllObjects(env.SITE_TEMPLATES, templatePrefix);
  if (templateFiles.length === 0) {
    throw new Error(
      `[SANDBOX] Template "${templateId}" has no files in SITE_TEMPLATES ` +
      `(looked for prefix "${templatePrefix}").`
    );
  }

  const sandboxPrefix = `sandbox/${tenantId}/`;

  // ── 2. Delete existing sandbox files ─────────────────────────────────────
  // [SEC] Deleting by prefix scoped to sandbox/{tenantId}/ — can never affect
  //       other tenants or published tour pages.
  const oldFiles = await listAllObjects(env.TOUR_PAGES, sandboxPrefix);
  let deleted = 0;

  if (oldFiles.length > 0) {
    // R2 batch delete accepts an array of keys (up to 1000 per call).
    const BATCH = 1000;
    for (let i = 0; i < oldFiles.length; i += BATCH) {
      const keysSlice = oldFiles.slice(i, i + BATCH).map(o => o.key);
      await env.TOUR_PAGES.delete(keysSlice);
    }
    deleted = oldFiles.length;
  }

  // ── 3. Copy template files into sandbox ──────────────────────────────────
  // Relative path: strip the templateId prefix (e.g. "default/assets/css/main.css"
  // → "assets/css/main.css"), then write to "sandbox/{tenantId}/assets/css/main.css".
  let copied = 0;

  for (const obj of templateFiles) {
    const relPath  = obj.key.slice(templatePrefix.length); // strip "default/"
    if (!relPath) continue;                                  // skip the prefix itself if listed

    const destKey  = `${sandboxPrefix}${relPath}`;          // "sandbox/{tenantId}/..."

    // Fetch the source object — body is a ReadableStream.
    const srcObj = await env.SITE_TEMPLATES.get(obj.key);
    if (!srcObj) {
      // Object disappeared between list and get (race) — skip silently.
      console.warn(`[SANDBOX] Source object disappeared during copy: ${obj.key}`);
      continue;
    }

    // Preserve content-type from source metadata, fall back to octet-stream.
    const contentType = srcObj.httpMetadata?.contentType ?? 'application/octet-stream';

    await env.TOUR_PAGES.put(destKey, srcObj.body, {
      httpMetadata: { contentType },
    });
    copied++;
  }

  // ── 4. Update tenants record ──────────────────────────────────────────────
  // Merge priority:
  //   existing tenant values > template-specific rich defaults > base defaults
  //
  // "First-time" detection: if the tenant has no custom_selectors yet (empty
  // object or absent), we inject the template splash content so they see a
  // beautiful preview immediately. On subsequent re-inits (template switch),
  // we always overwrite custom_selectors/custom_imgs with the new template's
  // defaults — the tenant's text edits live in individual field values, not in
  // custom_selectors, so resetting selectors is safe.

  let cfg = {};
  try {
    if (tenant.site_config) cfg = JSON.parse(tenant.site_config);
  } catch {
    cfg = {}; // Corrupt JSON → reset to defaults entirely.
  }

  // Pick the best matching rich-default set
  const richDefaults = TEMPLATE_RICH_DEFAULTS[templateId] ?? TEMPLATE_RICH_DEFAULTS._fallback;

  // 4a. Back-fill base scalar sections (brand / content / features)
  for (const [section, defaults] of Object.entries(DEFAULT_SITE_CONFIG)) {
    if (section === 'custom_selectors' || section === 'custom_imgs') continue;
    if (typeof defaults === 'object' && !Array.isArray(defaults)) {
      cfg[section] = Object.assign({}, defaults, cfg[section] ?? {});
    } else if (!(section in cfg)) {
      cfg[section] = defaults;
    }
  }

  // 4b. Apply template-specific brand overrides (name, primary_color) only if
  //     the brand sub-section is still using the bare DEFAULT (name === '')
  if (richDefaults.brand) {
    if (!cfg.brand.name) cfg.brand.name = richDefaults.brand.name;
    if (cfg.brand.primary_color === '#2563eb' || cfg.brand.primary_color === '#0ea5e9')
      cfg.brand.primary_color = richDefaults.brand.primary_color;
  }

  // 4c. Overwrite custom_selectors / custom_imgs with the new template defaults.
  //     Skipped when preserveSections=true (template switch path) — the tenant's
  //     existing selector edits and page sections are always kept intact.
  //     custom_sections is intentionally never touched here (no section in the
  //     template is auto-injected — sections must be dragged from the Snippet panel).
  if (!preserveSections) {
    cfg.custom_selectors = Object.assign(
      {},
      richDefaults.custom_selectors ?? {},
      // Preserve any selectors the tenant manually added (non-template keys)
      // identified as those NOT present in the richDefaults map.
      Object.fromEntries(
        Object.entries(cfg.custom_selectors ?? {}).filter(
          ([k]) => !(k in (richDefaults.custom_selectors ?? {}))
        )
      )
    );

    cfg.custom_imgs = Object.assign(
      {},
      richDefaults.custom_imgs ?? {},
      Object.fromEntries(
        Object.entries(cfg.custom_imgs ?? {}).filter(
          ([k]) => !(k in (richDefaults.custom_imgs ?? {}))
        )
      )
    );
  }
  // When preserveSections=true: cfg.custom_selectors / cfg.custom_imgs left unchanged.

  await _db
    .prepare('UPDATE tenants SET template_id = ?, site_config = ? WHERE id = ?')
    .bind(templateId, JSON.stringify(cfg), tenantId)
    .run();

  console.info(
    `[SANDBOX] Initialized sandbox for tenant=${tenantId} template=${templateId} ` +
    `copied=${copied} deleted=${deleted}`
  );

  return { tenantId, templateId, copied, deleted };
}

// ─────────────────────────────────────────────────────────────────────────────
// getTemplateStructure — extract section/component tree from a template
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a template's index.html and return a structured list of page
 * components (sections, header, footer, nav) that can be displayed in the
 * Visual Editor sidebar as a navigable tree.
 *
 * Detection strategy (in priority order):
 *   1. <section>, <header>, <footer>, <nav>, <main>, <aside>, <article>
 *      that carry an `id` attribute  → id used as anchor + display name
 *   2. Same block elements with a recognisable `class` (first class token
 *      that matches a human-readable word list)
 *   3. Fallback: tag name + ordinal index ("section-3")
 *
 * Additional signal extraction per element:
 *   - `aria-label` → used as display label when available
 *   - `data-section` / `data-name` → explicit override label
 *   - First child <h1>…<h4> text → used as heading hint
 *
 * R2 key tried:
 *   SITE_TEMPLATES: {templateId}/index.html
 *
 * @param {string} templateId   safe template id, e.g. "simple-html"
 * @param {object} env          Worker env bindings (SITE_TEMPLATES required)
 * @returns {Promise<{
 *   ok:         boolean,
 *   templateId: string,
 *   components: Array<{
 *     id:        string|null,   // CSS anchor (prefer id attr, fallback generated)
 *     tag:       string,        // lowercase tag name
 *     label:     string,        // human-readable display name
 *     heading:   string|null,   // inner heading text hint
 *     classes:   string[],
 *     scrollTarget: string,     // CSS selector to use for scroll (id-based if possible)
 *   }>,
 *   error?:     string,
 * }>}
 */
export async function getTemplateStructure(templateId, env) {
  if (!env.SITE_TEMPLATES) {
    return { ok: false, templateId, components: [], error: 'SITE_TEMPLATES binding missing.' };
  }
  if (!SAFE_ID_RE.test(templateId)) {
    return { ok: false, templateId, components: [], error: 'Invalid templateId.' };
  }

  const r2Key = `${templateId}/index.html`;
  const obj   = await env.SITE_TEMPLATES.get(r2Key);
  if (!obj) {
    return { ok: false, templateId, components: [], error: `Template not found: ${r2Key}` };
  }

  // State accumulated across HTMLRewriter callbacks
  const components = [];
  const BLOCK_TAGS = new Set(['section', 'header', 'footer', 'nav', 'main', 'aside', 'article']);

  // Ordinal counter per tag (for fallback anchor generation)
  const tagCounters = {};

  // Per-element scratch state — HTMLRewriter visits elements top-down,
  // one at a time; we track the current "open" component to fill in heading.
  let current = null;

  // Heading text collector — text() strips the HTML, receives chunks
  let _headingText = '';
  let _collectingHeading = false;

  const rewriter = new HTMLRewriter()
    .on(Array.from(BLOCK_TAGS).join(','), {
      element(el) {
        const tag = el.tagName.toLowerCase();

        // Increment ordinal
        tagCounters[tag] = (tagCounters[tag] ?? 0) + 1;
        const ordinal    = tagCounters[tag];

        const rawId      = el.getAttribute('id');
        const rawClasses = (el.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean);
        const ariaLabel  = el.getAttribute('aria-label') ?? null;
        const dataName   = el.getAttribute('data-section') ?? el.getAttribute('data-name') ?? null;

        // Derive a clean anchor
        // [SEC] id/class values are stripped to safe characters only before
        //       being returned to the frontend — never used in DB or DOM directly here.
        const safeId = rawId ? rawId.replace(/[^a-zA-Z0-9_-]/g, '') : null;

        // Choose display label (priority: data-name > aria-label > id > first readable class > tag+ordinal)
        let label = dataName ?? ariaLabel ?? null;
        if (!label && safeId) {
          // Humanise: "hero-section" → "Hero Section"
          label = safeId.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        }
        if (!label && rawClasses.length) {
          const readable = rawClasses.find(c => c.length > 2 && /^[a-zA-Z]/.test(c));
          if (readable) {
            label = readable.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          }
        }
        if (!label) {
          label = `${tag.charAt(0).toUpperCase() + tag.slice(1)} ${ordinal}`;
        }

        const scrollTarget = safeId ? `#${safeId}` : (
          rawClasses.length
            ? `.${rawClasses[0].replace(/[^a-zA-Z0-9_-]/g, '')}`
            : `${tag}:nth-of-type(${ordinal})`
        );

        current = {
          id:           safeId,
          tag,
          label,
          heading:      null,
          classes:      rawClasses.filter(c => /^[a-zA-Z0-9_-]+$/.test(c)).slice(0, 4),
          scrollTarget,
        };

        components.push(current);
        _headingText       = '';
        _collectingHeading = false;
      },
    })
    // Capture heading text for the most recently opened block element
    .on('h1,h2,h3,h4', {
      element() { _collectingHeading = true; _headingText = ''; },
    })
    .on('h1 *,h2 *,h3 *,h4 *,h1,h2,h3,h4', {
      text(chunk) {
        if (!_collectingHeading) return;
        _headingText += chunk.text;
        if (chunk.lastInTextNode && current && !current.heading) {
          const trimmed = _headingText.trim().slice(0, 80);
          if (trimmed) {
            current.heading  = trimmed;
            // Promote heading to label if label was auto-generated from tag+ordinal
            if (!current.id && !current.classes.length) {
              current.label = trimmed;
            }
          }
          _collectingHeading = false;
        }
      },
    });

  // Run the rewriter (we consume the body; result HTML is discarded)
  const html    = await obj.text();
  const dummy   = new Response(html, { headers: { 'Content-Type': 'text/html' } });
  await rewriter.transform(dummy).text(); // consume to trigger all callbacks

  return {
    ok:         true,
    templateId,
    components: components.filter(c => c.label), // prune empty
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// extractTemplateSections — Snippet Manager
// ─────────────────────────────────────────────────────────────────────────────
//
// Parse the raw index.html of a template from R2, extract every top-level
// <section> block and annotate it with label / icon / thumbnail metadata so
// the Visual Editor snippet sidebar can display a rich card for each block.
//
// Returns an array of snippet objects ready to be stored as custom_sections[]:
//   { id, type, label, icon, desc, thumbnail, category, html }
//

// Icon emojis for common section types (first regex match wins).
const _SNIP_ICONS = [
  [/hero|banner|jumbotron/i,         '🌟'],
  [/feature|built|tool|capabilit/i,  '⚡'],
  [/workflow|process|how it/i,       '🔄'],
  [/pricing|plan|cost/i,             '💰'],
  [/cta|join|start|launch|get start/i,'🚀'],
  [/testimonial|review|trust|quote/i,'⭐'],
  [/carousel|gallery|split/i,        '🖼'],
  [/team|people|staff/i,             '👥'],
  [/contact|reach|message/i,         '📬'],
  [/faq|question/i,                  '❓'],
];

// Unsplash thumbnail URLs keyed to section type (first regex match wins).
const _SNIP_THUMBS = [
  [/hero|banner/i,         'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=480&q=60'],
  [/feature|built/i,       'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=480&q=60'],
  [/workflow|process/i,    'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=480&q=60'],
  [/pricing|plan/i,        'https://images.unsplash.com/photo-1579621970563-ebec7560ff3e?w=480&q=60'],
  [/cta|join|start/i,      'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=480&q=60'],
  [/testimonial|review/i,  'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=480&q=60'],
  [/carousel|split/i,      'https://images.unsplash.com/photo-1551836022-d5d88e9218df?w=480&q=60'],
  [/contact/i,             'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=480&q=60'],
];
const _SNIP_THUMB_FALLBACK = 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=480&q=60';

function _snipIcon(label)  { for (const [re, v] of _SNIP_ICONS)  if (re.test(label)) return v; return '▦'; }
function _snipThumb(label) { for (const [re, v] of _SNIP_THUMBS) if (re.test(label)) return v; return _SNIP_THUMB_FALLBACK; }

// ── Category classifier ────────────────────────────────────────────────────
//
// Priority order: label check first (fast), then HTML content scan.
// Returns one of: 'commerce' | 'contact' | 'trust' | 'essential'
//
// HTML signals (checked on stripped lowercase text):
//   commerce → price / pricing / plan / per month / buy / checkout / subscribe / usd / vnd / €/$
//   contact  → <form / <input / <textarea / contact / email / phone / submit / message
//   trust    → testimonial / review / rating / stars / trust / award / partner / client
//
const _CAT_LABEL = [
  [/pricing|plan|cost|commerce|checkout|buy|subscribe/i,  'commerce'],
  [/contact|reach|message|form|email|phone/i,             'contact'],
  [/testimonial|review|trust|award|partner|client|rating/i,'trust'],
];
const _CAT_HTML_SIGNAL = [
  // commerce: monetary patterns or pricing markup
  [/<(?:del|s)[^>]*>|per\s*month|per\s*year|\bprice\b|\bpricing\b|\bplan\b|\bcheckout\b|\bsubscri|\busd\b|\bvnd\b|[$€£¥]/i, 'commerce'],
  // contact: form elements or contact keywords
  [/<form\b|<input\b|<textarea\b|\bcontact\b|\bsubmit\b|\bemail\b|\bphone\b|\bmessage\b|\breach\b/i, 'contact'],
  // trust: social proof signals
  [/testimonial|review|\brating\b|★|⭐|trust|award|partner|client|logo/i, 'trust'],
];

function _snipCategory(label, html) {
  // 1. Label is the quickest signal — if it matches, use it.
  for (const [re, cat] of _CAT_LABEL) if (re.test(label)) return cat;
  // 2. Scan HTML content (lowercase, strip tags for text signals only).
  const text = html.replace(/<[^>]+>/g, ' ');
  for (const [re, cat] of _CAT_HTML_SIGNAL) if (re.test(html) || re.test(text)) return cat;
  return 'essential';
}

/**
 * Depth-aware extraction of top-level <section>…</section> blocks.
 * Returns [{html, start, end}] — handles nested sections correctly.
 */
function _parseSections(html) {
  const sections = [];
  let pos = 0;

  while (pos < html.length) {
    const tagStart = html.indexOf('<section', pos);
    if (tagStart === -1) break;

    // Guard against <sectionHeader>, <section-card>, etc.
    const peek = html[tagStart + 8];
    if (peek !== '>' && peek !== ' ' && peek !== '\n' && peek !== '\t' && peek !== '\r') {
      pos = tagStart + 8;
      continue;
    }

    const tagEnd = html.indexOf('>', tagStart);
    if (tagEnd === -1) break;

    let depth = 1;
    let cur   = tagEnd + 1;
    let closeEnd = -1;

    while (depth > 0 && cur < html.length) {
      const nextOpen  = html.indexOf('<section', cur);
      const nextClose = html.indexOf('</section>', cur);

      if (nextClose === -1) { cur = html.length; break; }

      let realOpen = nextOpen !== -1;
      if (realOpen) {
        const c2 = html[nextOpen + 8];
        realOpen  = c2 === '>' || c2 === ' ' || c2 === '\n' || c2 === '\t' || c2 === '\r';
      }

      if (realOpen && nextOpen < nextClose) {
        depth++;
        cur = nextOpen + 8;
      } else {
        depth--;
        if (depth === 0) {
          closeEnd = nextClose + 10; // '</section>'.length === 10
          sections.push({ html: html.slice(tagStart, closeEnd), start: tagStart });
          pos = closeEnd;
          break;
        }
        cur = nextClose + 10;
      }
    }

    if (closeEnd === -1) pos = tagEnd + 1; // malformed — skip
  }

  return sections;
}

/**
 * extractTemplateSections
 *
 * Reads `{templateId}/index.html` (or `templates/{templateId}/index.html`)
 * from R2, splits into top-level <section> blocks and annotates each with
 * display metadata suitable for the Visual Editor snippet sidebar.
 *
 * @param {string}   templateId  — e.g. "open-pro-html"
 * @param {R2Bucket} r2Bucket    — SITE_TEMPLATES binding
 * @returns {Promise<Array<{id,type,label,icon,desc,thumbnail,category,html}>>}
 */
export async function extractTemplateSections(templateId, r2Bucket) {
  if (!r2Bucket) return [];

  // [GUARD] Only scan Cruip templates (suffix "-html").
  // Rejects html5up-*, html5up-forty, html5up-massively, html5up-dimension, etc.
  // The html5up templates use a completely different HTML structure and their
  // sections are incompatible with the Cruip canvas render pipeline.
  if (!/^[a-z0-9-]+-html$/.test(templateId)) {
    console.warn(`[extractTemplateSections] Blocked non-Cruip template: "${templateId}"`);
    return [];
  }

  // Try both R2 key conventions (mirrors fetchTemplateResponse).
  let obj = await r2Bucket.get(`${templateId}/index.html`);
  if (!obj) obj = await r2Bucket.get(`templates/${templateId}/index.html`);
  if (!obj) return [];

  const html     = await obj.text();
  const rawSecs  = _parseSections(html);
  // Derive a short prefix (strip "-html" suffix) for type slugs.
  const pfx = templateId.replace(/-html$/, '');

  return rawSecs.map((s, i) => {
    // Pull label from the HTML comment immediately before the <section> tag
    // (look up to 250 chars back to skip whitespace).
    const before       = html.slice(Math.max(0, s.start - 250), s.start);
    const commentMatch = before.match(/<!--\s*([^-\n>][^\n>]*?)\s*-->\s*$/);
    let label = commentMatch ? commentMatch[1].trim() : '';

    // Fallback: first h1/h2/h3 inside the section (strip all tags).
    if (!label) {
      const hm = s.html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
      if (hm) label = hm[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 50);
    }

    if (!label) label = `Block ${i + 1}`;

    // First <p> as description hint.
    const pm   = s.html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const desc = pm ? pm[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) : '';

    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `block-${i}`;
    const type = `${pfx}-${slug}`;

    return {
      id:        `${type}-${i}`,
      type,
      label,
      icon:      _snipIcon(label),
      desc,
      thumbnail: _snipThumb(label),
      category:  _snipCategory(label, s.html),
      html:      s.html,
    };
  });
}
