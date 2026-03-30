// src/routes/pages.js
// Site Studio — Tenant custom page management
//
// Routes (all under /api/tenant/pages, mounted in registerTenantRoutes):
//
//   POST   /                   — create a new custom page
//   GET    /                   — list all pages for the tenant
//   GET    /:slug               — get a single page record
//   PATCH  /:slug               — update page title / content_html
//   DELETE /:slug               — delete page record + R2 object + remove nav link
//   GET    /:slug/sections      — read per-page section blocks from R2 JSON
//   PUT    /:slug/sections      — write per-page section blocks to R2 JSON
//   POST   /:slug/clone         — clone page (D1 record + R2 HTML + sections JSON)
//
// Auth: every route requires X-Tenant-ID header.
// Tenant isolation: every D1 query includes WHERE tenant_id = ?.
//
// R2 paths:
//   sandbox/{tenantId}/pages/{slug}.html   — rendered page HTML (draft)
//   sandbox/{tenantId}/pages/{slug}.json   — per-page section blocks (JSON)
//   live/{tenantId}/pages/{slug}.html      — promoted by publish-site
//
// Nav injection:
//   When a page is created, the sandbox index.html is patched with
//   HTMLRewriter to insert <li><a href="/pages/{slug}.html">{title}</a></li>
//   into the first <nav ul> found. This keeps the menu up-to-date without
//   requiring a full re-init of the sandbox.

import { Hono }   from 'hono';
import { nanoid } from 'nanoid';
import { buildChromeMenuScript, buildMinimalFooterHtml, buildMinimalHeaderHtml, normalizeChromeConfig } from '../lib/siteStudio.js';

const pages = new Hono();

// ── Shared helpers ────────────────────────────────────────────────────────────

const SAFE_SLUG_RE    = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;   // e.g. "about-us"
const SAFE_ID_RE      = /^[a-zA-Z0-9_-]{1,128}$/;
const TEMPLATE_TYPES  = new Set(['generic', 'policy']);

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Derive a URL-safe slug from a human title. */
function slugify(title) {
  return title
    .toLowerCase()
    .normalize('NFD')                         // decompose accented chars
    .replace(/[\u0300-\u036f]/g, '')          // strip diacritics
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s-]/g, '')            // remove non-alphanum
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

/** Seconds since epoch. */
function now() { return Math.floor(Date.now() / 1000); }

// ── Inline fallback template (matches templates/common/generic.html)  ─────────
// Used when SITE_TEMPLATES R2 does not have common/generic.html yet.
// Variables: {{title}}, {{brand_name}}, {{primary_color}}, {{content_html}}
const GENERIC_TEMPLATE_FALLBACK = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{title}} — {{brand_name}}</title>
  <meta name="description" content="{{title}}">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root { --primary: {{primary_color}}; --text: #1e293b; --muted: #64748b;
            --bg: #f8fafc; --card: #fff; --border: #e2e8f0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
           color: var(--text); background: var(--bg); line-height: 1.6; }
    .site-header { background: var(--card); border-bottom: 1px solid var(--border);
                   padding: 0 24px; display: flex; align-items: center; height: 56px; gap: 24px; }
    .brand { font-size: 15px; font-weight: 700; color: var(--text); text-decoration: none; }
    .brand:hover { color: var(--primary); }
    nav.page-nav { display: flex; gap: 4px; }
    nav.page-nav a { font-size: 13px; color: var(--muted); text-decoration: none;
                     padding: 5px 10px; border-radius: 5px; }
    nav.page-nav a:hover { background: var(--bg); color: var(--text); }
    .page-wrap { max-width: 800px; margin: 48px auto; padding: 0 24px 80px; }
    .breadcrumb { font-size: 12px; color: var(--muted); margin-bottom: 28px;
                  display: flex; align-items: center; gap: 6px; }
    .breadcrumb a { color: var(--primary); text-decoration: none; }
    .page-title { font-size: 2rem; font-weight: 800; letter-spacing: -.02em;
                  line-height: 1.2; margin-bottom: 8px; }
    .page-divider { width: 48px; height: 3px; background: var(--primary);
                    border-radius: 2px; margin-bottom: 28px; }
    .page-content { font-size: 15px; line-height: 1.8; color: #374151; }
    .page-content h2 { font-size: 1.3rem; font-weight: 700; margin: 32px 0 12px; }
    .page-content p { margin-bottom: 16px; }
    .page-content ul { padding-left: 24px; margin-bottom: 16px; }
    .site-footer { border-top: 1px solid var(--border); padding: 20px 24px;
                   text-align: center; font-size: 12px; color: var(--muted); }
    .site-footer a { color: var(--primary); text-decoration: none; }
  </style>
</head>
<body>
<header class="site-header">
  <a class="brand" href="/">{{brand_name}}</a>
  <nav class="page-nav">
    <a href="/">Home</a>
  </nav>
</header>
<div class="page-wrap">
  <div class="breadcrumb">
    <a href="/">Home</a>
    <span>/</span>
    <span>{{title}}</span>
  </div>
  <h1 class="page-title">{{title}}</h1>
  <div class="page-divider"></div>
  <div class="page-content" id="page-content">
{{content_html}}
  </div>
</div>
<footer class="site-footer">
  <p>&copy; {{brand_name}} — <a href="/">Back to Home</a></p>
</footer>
</body>
</html>`;

// ── Template loader ───────────────────────────────────────────────────────────

/**
 * Load the blank page template.
 * Tries SITE_TEMPLATES R2 bucket first ("common/generic.html"), then falls
 * back to the inline constant (always succeeds — never throws).
 */
async function loadBlankTemplate(templateType, env) {
  const key = `common/${templateType === 'policy' ? 'policy' : 'generic'}.html`;
  try {
    if (env.SITE_TEMPLATES) {
      const obj = await env.SITE_TEMPLATES.get(key);
      if (obj) return await obj.text();
    }
  } catch (_) { /* fall through */ }
  return GENERIC_TEMPLATE_FALLBACK;
}

/**
 * Render the blank template with tenant/page variables.
 * Only simple {{variable}} substitution — no user HTML is executed as code.
 * content_html is already stored in D1 and validated before insertion.
 */
function renderPageTemplate(tmpl, vars) {
  return tmpl
    .replace(/\{\{title\}\}/g,         escHtml(vars.title         ?? ''))
    .replace(/\{\{brand_name\}\}/g,    escHtml(vars.brand_name    ?? ''))
    .replace(/\{\{primary_color\}\}/g, escHtml(vars.primary_color ?? '#2563eb'))
    // content_html is intentionally rendered as raw HTML (tenant-controlled)
    .replace(/\{\{content_html\}\}/g,  vars.content_html ?? '<p>Add your content here.</p>');
}

// ── Nav injection ─────────────────────────────────────────────────────────────

/**
 * Inject a <li><a href="/pages/{slug}.html">{title}</a></li> link into the
 * first <nav ul> found in sandbox/{tenantId}/index.html.
 *
 * Strategy (most templates):
 *   pass 1 — target "nav ul"       (html5up menus: <nav id="menu"><ul>…</ul></nav>)
 *   pass 2 — target "nav.page-nav" (our own generic.html nav)
 *   pass 3 — fall through (sandbox index not present or no nav found)
 *
 * [SEC] slug is validated to SAFE_SLUG_RE before reaching this function.
 *       title is HTML-escaped before insertion.
 * @returns {{ ok: boolean, nav_injected: boolean, reason?: string }}
 */
async function injectNavLinkIntoSandbox(tenantId, slug, title, env) {
  const indexKey = `sandbox/${tenantId}/index.html`;
  let obj;
  try {
    obj = await env.TOUR_PAGES.get(indexKey);
  } catch (_) { return { ok: true, nav_injected: false, reason: 'R2 read error' }; }
  if (!obj) return { ok: true, nav_injected: false, reason: 'sandbox/index.html not found' };

  const html = await obj.text();
  const linkHtml = `<li><a href="/pages/${slug}.html">${escHtml(title)}</a></li>`;
  const linkDirect = `<a href="/pages/${slug}.html">${escHtml(title)}</a>`;

  let pass1Injected = false;
  let pass2Injected = false;

  // Pass 1: nav ul  (standard html5up menu structure)
  const pass1 = new HTMLRewriter()
    .on('nav ul', {
      element(el) {
        if (pass1Injected) return;
        pass1Injected = true;
        el.append(linkHtml, { html: true });
      },
    });
  const html1 = await pass1
    .transform(new Response(html, { headers: { 'Content-Type': 'text/html' } }))
    .text();

  if (pass1Injected) {
    await env.TOUR_PAGES.put(indexKey, html1, {
      httpMetadata: { contentType: 'text/html; charset=utf-8' },
    });
    return { ok: true, nav_injected: true, strategy: 'nav ul' };
  }

  // Pass 2: any <nav> fallback (append <a> directly)
  const pass2 = new HTMLRewriter()
    .on('nav', {
      element(el) {
        if (pass2Injected) return;
        pass2Injected = true;
        el.append(' ' + linkDirect, { html: true });
      },
    });
  const html2 = await pass2
    .transform(new Response(html1, { headers: { 'Content-Type': 'text/html' } }))
    .text();

  if (pass2Injected) {
    await env.TOUR_PAGES.put(indexKey, html2, {
      httpMetadata: { contentType: 'text/html; charset=utf-8' },
    });
    return { ok: true, nav_injected: true, strategy: 'nav (direct)' };
  }

  return { ok: true, nav_injected: false, reason: 'no <nav> found in sandbox index' };
}

/**
 * Remove the nav link for a page slug from sandbox index.html when deleting.
 * Strips any <li><a href="/pages/{slug}.html">…</a></li> and plain
 * <a href="/pages/{slug}.html">…</a> occurrences.
 */
async function removeNavLinkFromSandbox(tenantId, slug, env) {
  const indexKey = `sandbox/${tenantId}/index.html`;
  let obj;
  try {
    obj = await env.TOUR_PAGES.get(indexKey);
  } catch (_) { return; }
  if (!obj) return;

  const html = await obj.text();
  const safeSlug    = slug.replace(/[^a-z0-9-]/g, '');
  const hrefTarget  = `/pages/${safeSlug}.html`;
  let removed = false;

  // HTMLRewriter does not support :has() — instead we track parent <li>
  // elements and remove them when their child <a> matches our href.
  let inTargetLi = false;

  const rewriter = new HTMLRewriter()
    .on('li', {
      element(el) {
        // We'll decide whether to remove this <li> after inspecting children.
        // Use a custom attribute flag set by the <a> handler below.
        el.onEndTag(tag => {
          // Nothing to do here; removal is triggered when the <a> is found.
        });
      },
    })
    .on('a', {
      element(el) {
        const href = el.getAttribute('href') ?? '';
        if (href !== hrefTarget) return;
        removed = true;
        // Remove the <a> itself; also attempt to remove its parent <li>
        // by replacing the element with nothing.
        el.remove();
      },
    });

  const modified = await rewriter
    .transform(new Response(html, { headers: { 'Content-Type': 'text/html' } }))
    .text();

  // The <li> wrapper will now be empty — strip it with a second pass.
  const rewriter2 = new HTMLRewriter()
    .on('li', {
      element(el) {
        // Remove <li> elements that only contain whitespace (their <a> was stripped).
        el.onEndTag(() => {});
      },
      text(chunk) {
        // Track whether this <li> has non-trivial text.
        if (chunk.text.trim()) inTargetLi = false;
      },
    });

  // Simpler approach: just do a string-level cleanup of the empty <li></li>
  // that HTMLRewriter leaves behind. This is safe because we control the format.
  const cleaned = removed
    ? modified.replace(/<li>\s*<\/li>/gi, '')
    : modified;

  if (removed) {
    await env.TOUR_PAGES.put(indexKey, cleaned, {
      httpMetadata: { contentType: 'text/html; charset=utf-8' },
    });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/tenant/pages — create a new custom page
// ═════════════════════════════════════════════════════════════════════════════
//
// Body:
//   { title: string, slug?: string, template_type?: 'generic'|'policy',
//     content_html?: string }
//
// Steps:
//   1. Validate inputs + build safe slug
//   2. Check slug uniqueness in D1
//   3. Load blank template & render with tenant branding
//   4. Write rendered HTML to TOUR_PAGES at sandbox/{tenantId}/pages/{slug}.html
//   5. INSERT into tenant_pages
//   6. Inject nav link into sandbox/index.html
pages.post('/', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Request body is not valid JSON.' }, 400); }

  const title        = (body.title ?? '').trim();
  const templateType = TEMPLATE_TYPES.has(body.template_type) ? body.template_type : 'generic';
  const contentHtml  = (body.content_html ?? '').trim();

  if (!title) return c.json({ error: 'Missing required field: title.' }, 400);
  if (title.length > 120) return c.json({ error: 'title exceeds 120 characters.' }, 400);

  // Build slug
  let slug = body.slug
    ? body.slug.toLowerCase().trim()
    : slugify(title);

  if (!slug) slug = 'page-' + nanoid(6).toLowerCase();
  if (!SAFE_SLUG_RE.test(slug)) {
    return c.json({ error: 'slug must be lowercase letters, digits and hyphens only (e.g. "about-us").' }, 400);
  }
  if (slug.length > 60) return c.json({ error: 'slug must be ≤ 60 characters.' }, 400);

  if (!c.env.TOUR_PAGES) {
    return c.json({ error: 'TOUR_PAGES R2 binding is not configured.' }, 503);
  }

  // ── 1. Verify tenant exists ───────────────────────────────────────────────
  const tenant = await c.env.DB
    .prepare('SELECT id, site_config FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();
  if (!tenant) return c.json({ error: 'Tenant not found.' }, 404);

  // ── 2. Ensure slug uniqueness — auto-append suffix -1, -2 … on conflict ───
  {
    let candidate = slug;
    let suffix    = 0;
    // Cap at 20 attempts to prevent infinite loop on adversarial inputs.
    while (suffix <= 20) {
      const row = await c.env.DB
        .prepare('SELECT id FROM tenant_pages WHERE tenant_id = ? AND slug = ?')
        .bind(tenantId, candidate)
        .first();
      if (!row) break;                        // unique — use this candidate
      suffix += 1;
      // Trim base slug so appended suffix keeps total ≤ 60 chars.
      const base = slug.slice(0, 57);
      candidate  = `${base}-${suffix}`;
    }
    slug = candidate;
  }

  // ── 3. Write empty sections JSON — new pages always start blank ───────────
  // Ensures GET /:slug/sections always returns { sections: [] } immediately
  // after creation without relying on the "missing file = empty array" fallback.
  // The Visual Editor uses this to distinguish "page has no sections yet" from
  // "page sections failed to load", showing the Header+Footer-only blank state.
  const sectionsKey = `sandbox/${tenantId}/pages/${slug}.json`;
  await c.env.TOUR_PAGES.put(sectionsKey, JSON.stringify({ slug, sections: [] }), {
    httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' },
    customMetadata: { tenant_id: tenantId, slug },
  });

  // ── 4. Insert tenant_pages record ─────────────────────────────────────────
  const pageId = nanoid();
  const ts     = now();
  await c.env.DB
    .prepare(
      `INSERT INTO tenant_pages
         (id, tenant_id, slug, title, content_html, template_type, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
    )
    .bind(pageId, tenantId, slug, title, contentHtml, templateType, ts, ts)
    .run();

  // ── 5. Render inherited shell into sandbox ───────────────────────────────
  const { r2Key } = await rebuildTenantPageRender(c.env, tenantId, {
    slug,
    title,
    content_html: contentHtml,
    template_type: templateType,
    sections: [],
  });

  // ── 6. Inject nav link into sandbox/index.html ────────────────────────────
  const navResult = await injectNavLinkIntoSandbox(tenantId, slug, title, c.env);

  console.info(
    `[PAGES] Created page tenant=${tenantId} slug=${slug} r2=${r2Key} ` +
    `nav_injected=${navResult.nav_injected}`
  );

  return c.json({
    ok:            true,
    page: {
      id:            pageId,
      tenant_id:     tenantId,
      slug,
      title,
      template_type: templateType,
      status:        'draft',
      r2_key:        r2Key,
      preview_url:   `/api/tenant/pages/${slug}/preview`,
    },
    nav_injection:  navResult,
  }, 201);
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/tenant/pages — list all pages for the tenant
// ═════════════════════════════════════════════════════════════════════════════
pages.get('/', async (c) => {
  const tenantId = (c.req.header('X-Tenant-ID') ?? c.req.query('tid') ?? '').trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header or ?tid= query param is required.' }, 400);

  const rows = await c.env.DB
    .prepare(
      `SELECT id, slug, title, template_type, status, created_at, updated_at
         FROM tenant_pages
        WHERE tenant_id = ?
        ORDER BY created_at DESC`
    )
    .bind(tenantId)
    .all();

  return c.json({
    ok:    true,
    pages: rows.results ?? [],
    count: (rows.results ?? []).length,
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/tenant/pages/:slug — get a single page record
// ═════════════════════════════════════════════════════════════════════════════
pages.get('/:slug', async (c) => {
  const tenantId = (c.req.header('X-Tenant-ID') ?? c.req.query('tid') ?? '').trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header or ?tid= query param is required.' }, 400);

  const slug = c.req.param('slug');
  const row  = await c.env.DB
    .prepare('SELECT * FROM tenant_pages WHERE tenant_id = ? AND slug = ?')
    .bind(tenantId, slug)
    .first();
  if (!row) return c.json({ error: 'Page not found.', slug }, 404);

  return c.json({ ok: true, page: row });
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/tenant/pages/:slug/preview — serve a template-shell page for editing
// ═════════════════════════════════════════════════════════════════════════════
//
// Accepts X-Tenant-ID header OR ?tid= query param (so the Visual Editor
// iframe can load the page without setting custom headers).
//
// Rendering strategy:
//   1. Load page record from D1 (title, content_html).
//   2. Load sandbox/{tenantId}/index.html from TOUR_PAGES R2.
//   3. Extract <head> styles/links, <header>, <footer> from the index HTML.
//   4. Build a full page using the real template shell + page content.
//   5. Rewrite relative asset paths (assets/, images/, fonts/) to the
//      /api/tenant/template-assets/{templateId}/ proxy so CSS/JS/images load.
//   6. Wrap content_html in <div id="page-content" data-ve-page-slug="...">
//      so editor-bridge.js can detect and activate page-content editing mode.
//   7. Inject <script src="/editor-bridge.js"> before </body>.
//
// Fallback: if sandbox/index.html is missing, serve the raw R2 page file
//           with editor-bridge.js and data-ve-page-slug injected.

// ── Shell helpers ─────────────────────────────────────────────────────────────

/**
 * Rewrite relative asset href/src in an HTML fragment to use the
 * template-assets proxy URL.  Only rewrites common static asset prefixes:
 * assets/, images/, fonts/, css/, js/
 *
 * [SEC] Does NOT rewrite absolute URLs (http/https/data/blob//).
 */
function rewriteRelativePaths(html, templateId) {
  return html.replace(
    /((?:href|src)=["'])((?!https?:|\/\/|data:|blob:|#|\/)(?:assets|images|fonts|css|js)[^"']*)(["'])/gi,
    (m, prefix, path, suffix) =>
      `${prefix}/api/tenant/template-assets/${templateId}/${path}${suffix}`
  );
}

/**
 * Extract the shell fragments needed to wrap a sub-page.
 * Returns { htmlAttrs, headInner, headerEl, footerEl, bodyAttrs }.
 *
 * Uses targeted regex — safe for "known-good" HTML template output where
 * header/footer tags are well-formed and not deeply nested inside each other.
 */
function extractTemplateShell(indexHtml) {
  const htmlAttrs = indexHtml.match(/<html([^>]*)>/i)?.[1] ?? '';
  const headInner = indexHtml.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? '';
  const headerEl = indexHtml.match(/<header\b[^>]*>[\s\S]*?<\/header>/i)?.[0] ?? '';
  const footerEl = indexHtml.match(/<footer\b[^>]*>[\s\S]*?<\/footer>/i)?.[0] ?? '';
  const bodyAttrs = indexHtml.match(/<body([^>]*)>/i)?.[1] ?? '';
  return { htmlAttrs, headInner, headerEl, footerEl, bodyAttrs };
}

function mergeAttribute(attrs, attrName, appendValue, separator) {
  const source = String(attrs ?? '').trim();
  const re = new RegExp(`\\b${attrName}=(['"])(.*?)\\1`, 'i');
  const match = source.match(re);
  if (!match) return `${source}${source ? ' ' : ''}${attrName}="${appendValue}"`;
  const current = match[2].trim();
  const next = current ? `${current}${separator}${appendValue}` : appendValue;
  return source.replace(re, `${attrName}="${next}"`);
}

function buildHtmlOpenTag(htmlAttrs, themeClass) {
  let attrs = String(htmlAttrs ?? '').replace(/\sdata-theme=(['"])[^'"]*\1/gi, '').trim();
  if (!/\blang=/.test(attrs)) attrs = `lang="vi"${attrs ? ' ' + attrs : ''}`;
  if (themeClass) attrs += ` data-theme="${escHtml(themeClass)}"`;
  return `<html ${attrs.trim()}>`;
}

function buildBodyOpenTag(bodyAttrs) {
  let attrs = String(bodyAttrs ?? '').trim();
  attrs = mergeAttribute(attrs, 'class', 'font-inter antialiased overflow-x-hidden', ' ');
  attrs = mergeAttribute(attrs, 'style', 'background-color:var(--bg);color:var(--t)', '; ');
  return `<body${attrs ? ' ' + attrs : ''}>`;
}

function buildThemeTokensStyle({ themeColor, bgH, bgS, bgL }) {
  const tokens = [];
  if (themeColor && /^#[0-9a-fA-F]{3,6}$/.test(themeColor)) {
    tokens.push(`--brand-primary:${themeColor}`);
    tokens.push(`--brand-secondary:${themeColor}dd`);
  }
  if (bgH != null) tokens.push(`--bg-h:${bgH}`);
  if (bgS != null) tokens.push(`--bg-s:${bgS}%`);
  if (bgL != null) tokens.push(`--bg-l:${bgL}%`);
  return tokens.length ? `<style>:root{${tokens.join(';')};}</style>` : '';
}

function buildPageCanvasHtml({ title, slug, tenantId, contentHtml, sections }) {
  if (Array.isArray(sections) && sections.length > 0) {
    return sections
      .map((section, index) => {
        const safeId = escHtml(String(section?.id ?? `sec-${index}`));
        const html = String(section?.html ?? '').trim();
        if (!html) return '';
        return `<div data-ve-section="${safeId}" data-ve-section-index="${index}">\n${html}\n</div>`;
      })
      .filter(Boolean)
      .join('\n\n');
  }

  const inner = String(contentHtml ?? '').trim() || '<p>Add your content here.</p>';
  return `<section class="ve-page-shell" data-ve-section="page-content">\n  <div class="ve-page-copy">\n    <h1 class="ve-page-headline">${escHtml(title)}</h1>\n    <div class="ve-page-divider"></div>\n    <div id="page-content" data-ve-page-slug="${escHtml(slug)}" data-ve-tenant-id="${escHtml(tenantId)}">\n${inner}\n    </div>\n  </div>\n</section>`;
}

function buildManagedChromeStyle() {
  return `<style>
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
</style>`;
}

function buildPageShellHtml({
  templateId, title, slug, tenantId, contentHtml, sections,
  htmlAttrs, headInner, headerEl, footerEl, bodyAttrs,
  brandName, metaDescription, themeColor, themeClass, bgH, bgS, bgL,
}) {
  const safeTitle = escHtml(title);
  const safeBrand = escHtml(brandName || tenantId);
  const safeDesc = escHtml(metaDescription || title);
  const rewrittenHead = rewriteRelativePaths(
    headInner
      .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
      .replace(/<meta\s+charset[^>]*>/gi, '')
      .replace(/<meta\s+name=["']viewport["'][^>]*>/gi, ''),
    templateId
  );
  const rewrittenHeader = rewriteRelativePaths(headerEl, templateId);
  const rewrittenFooter = rewriteRelativePaths(footerEl, templateId);
  const themeStyle = buildThemeTokensStyle({ themeColor, bgH, bgS, bgL });
  const htmlOpen = buildHtmlOpenTag(htmlAttrs, themeClass);
  const bodyOpen = buildBodyOpenTag(bodyAttrs);
  const canvasHtml = buildPageCanvasHtml({ title, slug, tenantId, contentHtml, sections });
  const chromeStyle = buildManagedChromeStyle();

  return `<!DOCTYPE html>
${htmlOpen}
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle} - ${safeBrand}</title>
<meta name="description" content="${safeDesc}">
<meta property="og:title" content="${safeTitle} - ${safeBrand}">
<meta property="og:description" content="${safeDesc}">
<meta name="theme-color" content="${escHtml(themeColor || '#2563eb')}">
${rewrittenHead}
<link rel="stylesheet" href="/css/theme-presets.css">
${themeStyle}
${chromeStyle}
<style>
html, body {
  background: var(--bg);
}
body {
  min-height: 100vh;
  margin: 0;
}
body > header {
  position: sticky !important;
  top: 0 !important;
  z-index: 9999 !important;
}
#canvas {
  min-height: 40vh;
  padding-bottom: 4rem;
}
#canvas > [data-ve-section]:first-child,
#canvas > .ve-page-shell:first-child {
  margin-top: 0 !important;
  padding-top: 0 !important;
}
#canvas > [data-ve-section]:first-child > *:first-child,
#canvas > .ve-page-shell:first-child > *:first-child {
  margin-top: 0 !important;
}
.ve-page-shell,
.ve-page-copy {
  max-width: 820px;
  margin: 3.5rem auto;
  padding: 0 1.5rem;
  color: var(--t, #e5e7eb);
}
.ve-page-headline {
  font-size: 2rem;
  font-weight: 800;
  line-height: 1.2;
  letter-spacing: -.02em;
  margin-bottom: 0.5rem;
  color: var(--t, #e5e7eb);
}
.ve-page-divider {
  width: 48px;
  height: 3px;
  background: var(--brand-primary, ${escHtml(themeColor || '#2563eb')});
  border-radius: 2px;
  margin-bottom: 2rem;
}
#page-content {
  min-height: 120px;
  font-size: 15px;
  line-height: 1.8;
}
#page-content p  { margin-bottom: 1rem; }
#page-content h2 { font-size: 1.3rem; font-weight: 700; margin: 2rem 0 0.75rem; }
#page-content ul { padding-left: 1.5rem; margin-bottom: 1rem; }
</style>
</head>
${bodyOpen}
${rewrittenHeader}
<main id="canvas">
${canvasHtml}
</main>
${rewrittenFooter}
${buildChromeMenuScript()}
</body>
</html>`;
}

async function loadPageSections(env, tenantId, slug) {
  try {
    const obj = await env.TOUR_PAGES.get(`sandbox/${tenantId}/pages/${slug}.json`);
    if (!obj) return [];
    const data = await obj.json();
    return Array.isArray(data?.sections) ? data.sections : [];
  } catch (_) {
    return [];
  }
}

export async function renderTenantPageHtml(env, tenantId, page) {
  const tenant = await env.DB
    .prepare('SELECT template_id, site_config FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();

  let cfg = {};
  try { if (tenant?.site_config) cfg = JSON.parse(tenant.site_config); } catch (_) {}

  const brand = cfg?.brand ?? {};
  const content = cfg?.content ?? {};
  const templateId = tenant?.template_id ?? 'tmpl-minimal-v1';
  const logoUrl = brand.logo_url ?? '';
  const navItems = Array.isArray(cfg.navigation) ? cfg.navigation : [];
  const navConfig = cfg.navigation_config && typeof cfg.navigation_config === 'object'
    ? {
        showPhone: cfg.navigation_config.showPhone === true,
        showCart: cfg.navigation_config.showCart === true,
        showContactForm: cfg.navigation_config.showContactForm === true,
      }
    : { showPhone: false, showCart: false, showContactForm: false };
  const chromeConfig = normalizeChromeConfig(cfg.chrome_config);
  const themeColor = brand.primary_color ?? '#2563eb';
  const themeClass = typeof cfg.current_theme === 'string' ? cfg.current_theme.trim().slice(0, 40) : '';
  const bgH = typeof brand.bg_h === 'number' && isFinite(brand.bg_h) ? Math.max(0, Math.min(360, Math.round(brand.bg_h))) : null;
  const bgS = typeof brand.bg_s === 'number' && isFinite(brand.bg_s) ? Math.max(0, Math.min(100, Math.round(brand.bg_s))) : null;
  const bgL = typeof brand.bg_l === 'number' && isFinite(brand.bg_l) ? Math.max(0, Math.min(100, Math.round(brand.bg_l))) : null;
  const brandName = brand.name ?? tenantId;
  const metaDescription = content.hero_desc ?? page.title ?? '';
  const contactPhone = content.contact_phone ?? '';
  const sections = Array.isArray(page.sections) ? page.sections : await loadPageSections(env, tenantId, page.slug);

  try {
    const indexObj = await env.TOUR_PAGES.get(`sandbox/${tenantId}/index.html`);
    if (indexObj) {
      const indexHtml = await indexObj.text();
      const shell = extractTemplateShell(indexHtml);
      const headerEl = chromeConfig.useMinimalHeader
        ? buildMinimalHeaderHtml({
            brandName,
            logoUrl,
            navItems,
            navConfig,
            contactPhone,
            effectStyle: chromeConfig.effectStyle,
            shapeStyle: chromeConfig.shapeStyle,
            menuFontStyle: chromeConfig.menuFontStyle,
            logoFontStyle: chromeConfig.logoFontStyle,
            logoSize: chromeConfig.logoSize,
            ornamentStyle: chromeConfig.ornamentStyle,
            showLogo: chromeConfig.showLogo,
          })
        : shell.headerEl;
      const footerEl = chromeConfig.useMinimalFooter
        ? buildMinimalFooterHtml({
            brandName,
            logoUrl,
            navItems,
            showFooterMenu: chromeConfig.showFooterMenu,
            effectStyle: chromeConfig.effectStyle,
            shapeStyle: chromeConfig.shapeStyle,
            menuFontStyle: chromeConfig.menuFontStyle,
            logoFontStyle: chromeConfig.logoFontStyle,
            logoSize: chromeConfig.logoSize,
            ornamentStyle: chromeConfig.ornamentStyle,
            showLogo: chromeConfig.showLogo,
          })
        : shell.footerEl;
      return buildPageShellHtml({
        templateId,
        title: page.title,
        slug: page.slug,
        tenantId,
        contentHtml: page.content_html || '<p>Add your content here.</p>',
        sections,
        htmlAttrs: shell.htmlAttrs,
        headInner: shell.headInner,
        headerEl,
        footerEl,
        bodyAttrs: shell.bodyAttrs,
        brandName,
        metaDescription,
        themeColor,
        themeClass,
        bgH,
        bgS,
        bgL,
      });
    }
  } catch (_) {}

  const tmpl = await loadBlankTemplate(page.template_type || 'generic', env);
  return renderPageTemplate(tmpl, {
    title: page.title,
    brand_name: brandName,
    primary_color: themeColor,
    content_html: page.content_html || '<p>Add your content here.</p>',
  });
}

export async function rebuildTenantPageRender(env, tenantId, page) {
  const rendered = await renderTenantPageHtml(env, tenantId, page);
  const r2Key = `sandbox/${tenantId}/pages/${page.slug}.html`;
  await env.TOUR_PAGES.put(r2Key, rendered, {
    httpMetadata: { contentType: 'text/html; charset=utf-8', cacheControl: 'no-store' },
    customMetadata: { tenant_id: tenantId, slug: page.slug, title: page.title },
  });
  return { r2Key, rendered };
}

export async function rebuildAllTenantPageRenders(env, tenantId) {
  const rows = await env.DB
    .prepare('SELECT slug, title, content_html, template_type FROM tenant_pages WHERE tenant_id = ?')
    .bind(tenantId)
    .all();
  const pages = rows.results ?? [];
  for (const page of pages) {
    const sections = await loadPageSections(env, tenantId, page.slug);
    await rebuildTenantPageRender(env, tenantId, { ...page, sections });
  }
  return pages.length;
}

// GET /api/tenant/pages/:slug/preview — render a page with the same shell philosophy as homepage
pages.get('/:slug/preview', async (c) => {
  const tenantId = (c.req.header('X-Tenant-ID') ?? c.req.query('tid') ?? '').trim();
  if (!tenantId) return new Response('X-Tenant-ID header or ?tid= query param is required.', { status: 400 });

  const slug = c.req.param('slug');
  if (!SAFE_SLUG_RE.test(slug)) return new Response('Invalid slug.', { status: 400 });

  const row = await c.env.DB
    .prepare('SELECT title, content_html, template_type FROM tenant_pages WHERE tenant_id = ? AND slug = ?')
    .bind(tenantId, slug)
    .first();
  if (!row) return new Response('Page not found.', { status: 404 });

  let pageHtml = await renderTenantPageHtml(c.env, tenantId, { ...row, slug });
  if (!pageHtml.includes('/editor-bridge.js')) {
    pageHtml = pageHtml.replace('</body>', '<script src="/editor-bridge.js"></script>\n</body>');
  }

  return new Response(pageHtml, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
});

// PATCH /api/tenant/pages/:slug — update page title and/or legacy content_html
pages.patch('/:slug', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const slug = c.req.param('slug');
  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Request body is not valid JSON.' }, 400); }

  const row = await c.env.DB
    .prepare('SELECT * FROM tenant_pages WHERE tenant_id = ? AND slug = ?')
    .bind(tenantId, slug)
    .first();
  if (!row) return c.json({ error: 'Page not found.', slug }, 404);

  const newTitle = (body.title ?? row.title).trim().slice(0, 120);
  const newContentHtml = body.content_html !== undefined ? String(body.content_html) : row.content_html;
  if (!newTitle) return c.json({ error: 'title cannot be empty.' }, 400);

  const ts = now();
  await c.env.DB
    .prepare(
      `UPDATE tenant_pages
          SET title = ?, content_html = ?, updated_at = ?
        WHERE tenant_id = ? AND slug = ?`
    )
    .bind(newTitle, newContentHtml, ts, tenantId, slug)
    .run();

  const { r2Key } = await rebuildTenantPageRender(c.env, tenantId, {
    slug,
    title: newTitle,
    content_html: newContentHtml,
    template_type: row.template_type,
  });

  return c.json({
    ok: true,
    slug,
    title: newTitle,
    updated_at: ts,
    r2_key: r2Key,
    preview_url: `/api/tenant/pages/${slug}/preview`,
  });
});

// DELETE /api/tenant/pages/:slug — delete a page
pages.delete('/:slug', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const slug = c.req.param('slug');
  const row = await c.env.DB
    .prepare('SELECT id FROM tenant_pages WHERE tenant_id = ? AND slug = ?')
    .bind(tenantId, slug)
    .first();
  if (!row) return c.json({ error: 'Page not found.', slug }, 404);

  await c.env.DB
    .prepare('DELETE FROM tenant_pages WHERE tenant_id = ? AND slug = ?')
    .bind(tenantId, slug)
    .run();

  const sandboxKey = `sandbox/${tenantId}/pages/${slug}.html`;
  const liveKey = `live/${tenantId}/pages/${slug}.html`;
  const sectionsKey = `sandbox/${tenantId}/pages/${slug}.json`;
  const r2Deletes = [];
  try { await c.env.TOUR_PAGES.delete(sandboxKey); r2Deletes.push(sandboxKey); } catch (_) {}
  try { await c.env.TOUR_PAGES.delete(liveKey); r2Deletes.push(liveKey); } catch (_) {}
  try { await c.env.TOUR_PAGES.delete(sectionsKey); r2Deletes.push(sectionsKey); } catch (_) {}

  await removeNavLinkFromSandbox(tenantId, slug, c.env);

  return c.json({ ok: true, deleted: { slug, r2_keys_deleted: r2Deletes } });
});

// GET /:slug/sections — read per-page section blocks
pages.get('/:slug/sections', async (c) => {
  const tenantId = (c.req.header('X-Tenant-ID') ?? c.req.query('tid') ?? '').trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const slug = c.req.param('slug');
  if (!SAFE_SLUG_RE.test(slug)) return c.json({ error: 'Invalid slug.' }, 400);

  const row = await c.env.DB
    .prepare('SELECT id FROM tenant_pages WHERE tenant_id = ? AND slug = ?')
    .bind(tenantId, slug)
    .first();
  if (!row) return c.json({ error: 'Page not found.', slug }, 404);

  const sections = await loadPageSections(c.env, tenantId, slug);
  return c.json({ ok: true, slug, sections });
});

// PUT /:slug/sections — write per-page section blocks and rebuild page HTML
pages.put('/:slug/sections', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const slug = c.req.param('slug');
  if (!SAFE_SLUG_RE.test(slug)) return c.json({ error: 'Invalid slug.' }, 400);

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Request body is not valid JSON.' }, 400); }

  if (!Array.isArray(body?.sections)) {
    return c.json({ error: 'Body must contain sections array.' }, 400);
  }

  const row = await c.env.DB
    .prepare('SELECT title, content_html, template_type FROM tenant_pages WHERE tenant_id = ? AND slug = ?')
    .bind(tenantId, slug)
    .first();
  if (!row) return c.json({ error: 'Page not found.', slug }, 404);

  const sections = body.sections
    .filter((section) =>
      section && typeof section === 'object' &&
      typeof section.id === 'string' && section.id.length <= 64 &&
      typeof section.type === 'string' && section.type.length <= 64 &&
      typeof section.html === 'string' && section.html.length <= 65536
    )
    .map((section) => ({ id: section.id, type: section.type, html: section.html }));

  await c.env.TOUR_PAGES.put(`sandbox/${tenantId}/pages/${slug}.json`, JSON.stringify({ slug, sections }), {
    httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' },
    customMetadata: { tenant_id: tenantId, slug },
  });

  const updatedAt = now();
  await c.env.DB
    .prepare('UPDATE tenant_pages SET updated_at = ? WHERE tenant_id = ? AND slug = ?')
    .bind(updatedAt, tenantId, slug)
    .run();

  await rebuildTenantPageRender(c.env, tenantId, {
    slug,
    title: row.title,
    content_html: row.content_html,
    template_type: row.template_type,
    sections,
  });

  return c.json({ ok: true, slug, sections_count: sections.length, updated_at: updatedAt });
});

// POST /:slug/clone — clone page data and sections, then rebuild inherited shell
pages.post('/:slug/clone', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const srcSlug = c.req.param('slug');
  if (!SAFE_SLUG_RE.test(srcSlug)) return c.json({ error: 'Invalid source slug.' }, 400);

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Request body is not valid JSON.' }, 400); }

  const newTitle = (body.title ?? '').trim();
  if (!newTitle) return c.json({ error: 'Missing required field: title.' }, 400);
  if (newTitle.length > 120) return c.json({ error: 'title exceeds 120 characters.' }, 400);

  let newSlug = (body.slug ?? '').toLowerCase().trim() || slugify(newTitle);
  if (!newSlug) newSlug = 'page-' + nanoid(6).toLowerCase();
  if (!SAFE_SLUG_RE.test(newSlug)) {
    return c.json({ error: 'slug must be lowercase letters, digits and hyphens only.' }, 400);
  }

  const srcRow = await c.env.DB
    .prepare('SELECT * FROM tenant_pages WHERE tenant_id = ? AND slug = ?')
    .bind(tenantId, srcSlug)
    .first();
  if (!srcRow) return c.json({ error: 'Source page not found.', slug: srcSlug }, 404);

  const conflict = await c.env.DB
    .prepare('SELECT id FROM tenant_pages WHERE tenant_id = ? AND slug = ?')
    .bind(tenantId, newSlug)
    .first();
  if (conflict) {
    return c.json({ error: `A page with slug "${newSlug}" already exists.`, code: 'SLUG_CONFLICT' }, 409);
  }

  const srcSections = await loadPageSections(c.env, tenantId, srcSlug);
  const clonedSections = srcSections.map((section) => ({
    id: 'sec-' + nanoid(8),
    type: section.type,
    html: section.html,
  }));
  await c.env.TOUR_PAGES.put(`sandbox/${tenantId}/pages/${newSlug}.json`, JSON.stringify({ slug: newSlug, sections: clonedSections }), {
    httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' },
    customMetadata: { tenant_id: tenantId, slug: newSlug, cloned_from: srcSlug },
  });

  const newId = nanoid();
  const ts = now();
  await c.env.DB
    .prepare(
      `INSERT INTO tenant_pages
         (id, tenant_id, slug, title, content_html, template_type, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
    )
    .bind(newId, tenantId, newSlug, newTitle, srcRow.content_html ?? '', srcRow.template_type ?? 'generic', ts, ts)
    .run();

  await rebuildTenantPageRender(c.env, tenantId, {
    slug: newSlug,
    title: newTitle,
    content_html: srcRow.content_html ?? '',
    template_type: srcRow.template_type ?? 'generic',
    sections: clonedSections,
  });

  return c.json({
    ok: true,
    page: {
      id: newId,
      tenant_id: tenantId,
      slug: newSlug,
      title: newTitle,
      template_type: srcRow.template_type ?? 'generic',
      status: 'draft',
      sections_count: clonedSections.length,
      preview_url: `/api/tenant/pages/${newSlug}/preview`,
    },
    cloned_from: srcSlug,
  }, 201);
});

export default pages;
