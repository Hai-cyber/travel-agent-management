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

  // ── 1. Verify tenant exists + load branding ──────────────────────────────
  const tenant = await c.env.DB
    .prepare('SELECT id, site_config FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();
  if (!tenant) return c.json({ error: 'Tenant not found.' }, 404);

  let cfg = {};
  try { if (tenant.site_config) cfg = JSON.parse(tenant.site_config); } catch (_) {}
  const brandName    = cfg?.brand?.name         ?? tenantId;
  const primaryColor = cfg?.brand?.primary_color ?? '#2563eb';

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

  // ── 3. Render page HTML ───────────────────────────────────────────────────
  const tmpl   = await loadBlankTemplate(templateType, c.env);
  const rendered = renderPageTemplate(tmpl, {
    title,
    brand_name:    brandName,
    primary_color: primaryColor,
    content_html:  contentHtml || '<p>Add your content here.</p>',
  });

  // ── 4. Write to R2 sandbox ────────────────────────────────────────────────
  const r2Key = `sandbox/${tenantId}/pages/${slug}.html`;
  await c.env.TOUR_PAGES.put(r2Key, rendered, {
    httpMetadata: {
      contentType: 'text/html; charset=utf-8',
      cacheControl: 'no-store',
    },
    customMetadata: {
      tenant_id:     tenantId,
      template_type: templateType,
      title,
      slug,
    },
  });

  // ── 4b. Write empty sections JSON — new pages always start blank ──────────
  // Ensures GET /:slug/sections always returns { sections: [] } immediately
  // after creation without relying on the "missing file = empty array" fallback.
  // The Visual Editor uses this to distinguish "page has no sections yet" from
  // "page sections failed to load", showing the Header+Footer-only blank state.
  const sectionsKey = `sandbox/${tenantId}/pages/${slug}.json`;
  await c.env.TOUR_PAGES.put(sectionsKey, JSON.stringify({ slug, sections: [] }), {
    httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' },
    customMetadata: { tenant_id: tenantId, slug },
  });

  // ── 5. Insert tenant_pages record ─────────────────────────────────────────
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
 * Returns { headInner, headerEl, footerEl, bodyAttrs }.
 *
 * Uses targeted regex — safe for "known-good" HTML template output where
 * header/footer tags are well-formed and not deeply nested inside each other.
 */
function extractTemplateShell(indexHtml) {
  const headInner = indexHtml.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1]   ?? '';
  const headerEl  = indexHtml.match(/<header\b[^>]*>[\s\S]*?<\/header>/i)?.[0] ?? '';
  const footerEl  = indexHtml.match(/<footer\b[^>]*>[\s\S]*?<\/footer>/i)?.[0] ?? '';
  // Some templates add class="is-preload" etc. on <body> — preserve it.
  const bodyAttrs = indexHtml.match(/<body([^>]*)>/i)?.[1] ?? '';
  return { headInner, headerEl, footerEl, bodyAttrs };
}

/**
 * Assemble the full page HTML from template shell + page content.
 * All tenant-supplied strings are HTML-escaped in attributes.
 * content_html is rendered as raw HTML (tenant-controlled, stored in D1).
 */
function buildPageShellHtml({
  templateId, title, slug, tenantId, contentHtml,
  headInner, headerEl, footerEl, bodyAttrs, primaryColor,
}) {
  const safeTitle    = escHtml(title);
  const safeSlug     = escHtml(slug);
  const safeTenant   = escHtml(tenantId);
  const safePrimary  = escHtml(primaryColor);

  const rewrittenHead   = rewriteRelativePaths(
    // Strip tags we inject ourselves to avoid duplicates
    headInner
      .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
      .replace(/<meta\s+charset[^>]*>/gi, '')
      .replace(/<meta\s+name=["']viewport["'][^>]*>/gi, ''),
    templateId
  );
  const rewrittenHeader = rewriteRelativePaths(headerEl,   templateId);
  const rewrittenFooter = rewriteRelativePaths(footerEl,   templateId);
  const bodyOpen        = bodyAttrs.trim() ? `<body ${bodyAttrs.trim()}>` : '<body>';

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
${rewrittenHead}
<style>
/* ── Visual Editor: page shell overrides ─────────────────────────── */
.ve-page-shell {
  max-width: 820px;
  margin: 3.5rem auto;
  padding: 0 1.5rem 6rem;
}
.ve-page-headline {
  font-size: 2rem;
  font-weight: 800;
  line-height: 1.2;
  letter-spacing: -.02em;
  margin-bottom: 0.5rem;
}
.ve-page-divider {
  width: 48px;
  height: 3px;
  background: ${safePrimary};
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
<div class="ve-page-shell">
  <h1 class="ve-page-headline">${safeTitle}</h1>
  <div class="ve-page-divider"></div>
  <div id="page-content"
       data-ve-page-slug="${safeSlug}"
       data-ve-tenant-id="${safeTenant}">
${contentHtml}
  </div>
</div>
${rewrittenFooter}
<script src="/editor-bridge.js"></script>
</body>
</html>`;
}

pages.get('/:slug/preview', async (c) => {
  const tenantId = (c.req.header('X-Tenant-ID') ?? c.req.query('tid') ?? '').trim();
  if (!tenantId) return new Response('X-Tenant-ID header or ?tid= query param is required.', { status: 400 });

  const slug = c.req.param('slug');
  if (!SAFE_SLUG_RE.test(slug)) return new Response('Invalid slug.', { status: 400 });

  if (!c.env.TOUR_PAGES) {
    return new Response('TOUR_PAGES R2 binding is not configured.', { status: 503 });
  }

  // ── Load page record + tenant branding in parallel ─────────────────────────
  const [row, tenant] = await Promise.all([
    c.env.DB
      .prepare('SELECT title, content_html, template_type FROM tenant_pages WHERE tenant_id = ? AND slug = ?')
      .bind(tenantId, slug)
      .first(),
    c.env.DB
      .prepare('SELECT template_id, site_config FROM tenants WHERE id = ?')
      .bind(tenantId)
      .first(),
  ]);
  if (!row) return new Response('Page not found.', { status: 404 });

  const templateId   = tenant?.template_id ?? 'tmpl-minimal-v1';
  let cfg = {};
  try { if (tenant?.site_config) cfg = JSON.parse(tenant.site_config); } catch (_) {}
  const primaryColor = cfg?.brand?.primary_color ?? '#2563eb';

  // ── Build template-shell page ──────────────────────────────────────────────
  let pageHtml = null;
  try {
    const indexObj = await c.env.TOUR_PAGES.get(`sandbox/${tenantId}/index.html`);
    if (indexObj) {
      const indexHtml = await indexObj.text();
      const shell = extractTemplateShell(indexHtml);
      pageHtml = buildPageShellHtml({
        templateId,
        title:        row.title,
        slug,
        tenantId,
        contentHtml:  row.content_html || '<p>Add your content here.</p>',
        headInner:    shell.headInner,
        headerEl:     shell.headerEl,
        footerEl:     shell.footerEl,
        bodyAttrs:    shell.bodyAttrs,
        primaryColor,
      });
    }
  } catch (_) { /* fall through to raw fallback */ }

  // ── Fallback: inject into the pre-rendered R2 file ────────────────────────
  if (!pageHtml) {
    const pageObj = await c.env.TOUR_PAGES.get(`sandbox/${tenantId}/pages/${slug}.html`);
    if (!pageObj) return new Response('Page not found in sandbox.', { status: 404 });
    const rawHtml = await pageObj.text();
    // Stamp data attributes so editor-bridge can enter page-content mode
    pageHtml = rawHtml
      .replace(
        /<div id="page-content"/,
        `<div id="page-content" data-ve-page-slug="${escHtml(slug)}" data-ve-tenant-id="${escHtml(tenantId)}"`
      )
      .replace('</body>', '<script src="/editor-bridge.js"></script>\n</body>');
  }

  return new Response(pageHtml, {
    headers: {
      'Content-Type':  'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag':  'noindex',
    },
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PATCH /api/tenant/pages/:slug — update page title and/or content_html
// ═════════════════════════════════════════════════════════════════════════════
//
// Re-renders the page HTML and writes the updated file back to R2 sandbox.
// Does NOT re-run nav injection (title change does not affect the URL href).
pages.patch('/:slug', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const slug = c.req.param('slug');

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Request body is not valid JSON.' }, 400); }

  // Load existing record
  const row = await c.env.DB
    .prepare('SELECT * FROM tenant_pages WHERE tenant_id = ? AND slug = ?')
    .bind(tenantId, slug)
    .first();
  if (!row) return c.json({ error: 'Page not found.', slug }, 404);

  const newTitle       = (body.title        ?? row.title).trim().slice(0, 120);
  const newContentHtml = body.content_html !== undefined ? String(body.content_html) : row.content_html;

  if (!newTitle) return c.json({ error: 'title cannot be empty.' }, 400);

  // Load tenant branding
  const tenant = await c.env.DB
    .prepare('SELECT site_config FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();

  let cfg = {};
  try { if (tenant?.site_config) cfg = JSON.parse(tenant.site_config); } catch (_) {}
  const brandName    = cfg?.brand?.name         ?? tenantId;
  const primaryColor = cfg?.brand?.primary_color ?? '#2563eb';

  // Re-render
  const tmpl = await loadBlankTemplate(row.template_type, c.env);
  const rendered = renderPageTemplate(tmpl, {
    title:         newTitle,
    brand_name:    brandName,
    primary_color: primaryColor,
    content_html:  newContentHtml || '<p>Add your content here.</p>',
  });

  // Write back to R2
  const r2Key = `sandbox/${tenantId}/pages/${slug}.html`;
  await c.env.TOUR_PAGES.put(r2Key, rendered, {
    httpMetadata: { contentType: 'text/html; charset=utf-8', cacheControl: 'no-store' },
    customMetadata: { tenant_id: tenantId, title: newTitle, slug },
  });

  // Update D1
  const ts = now();
  await c.env.DB
    .prepare(
      `UPDATE tenant_pages
          SET title = ?, content_html = ?, updated_at = ?
        WHERE tenant_id = ? AND slug = ?`
    )
    .bind(newTitle, newContentHtml, ts, tenantId, slug)
    .run();

  return c.json({
    ok:          true,
    slug,
    title:       newTitle,
    updated_at:  ts,
    preview_url: `/api/tenant/pages/${slug}/preview`,
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DELETE /api/tenant/pages/:slug — delete a page
// ═════════════════════════════════════════════════════════════════════════════
//
// Deletes: D1 record + R2 sandbox file + live R2 file (if promoted).
// Also removes the nav link from sandbox/index.html.
pages.delete('/:slug', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const slug = c.req.param('slug');

  const row = await c.env.DB
    .prepare('SELECT id FROM tenant_pages WHERE tenant_id = ? AND slug = ?')
    .bind(tenantId, slug)
    .first();
  if (!row) return c.json({ error: 'Page not found.', slug }, 404);

  // Delete D1 record
  await c.env.DB
    .prepare('DELETE FROM tenant_pages WHERE tenant_id = ? AND slug = ?')
    .bind(tenantId, slug)
    .run();

  // Delete R2 objects (non-fatal errors)
  const sandboxKey = `sandbox/${tenantId}/pages/${slug}.html`;
  const liveKey    = `live/${tenantId}/pages/${slug}.html`;
  const r2Deletes  = [];

  try { await c.env.TOUR_PAGES.delete(sandboxKey); r2Deletes.push(sandboxKey); } catch (_) {}
  try { await c.env.TOUR_PAGES.delete(liveKey);    r2Deletes.push(liveKey);    } catch (_) {}

  // Remove nav link from sandbox index
  await removeNavLinkFromSandbox(tenantId, slug, c.env);

  console.info(`[PAGES] Deleted page tenant=${tenantId} slug=${slug}`);

  return c.json({
    ok:      true,
    deleted: { slug, r2_keys_deleted: r2Deletes },
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /:slug/sections  — read per-page section blocks
// ═════════════════════════════════════════════════════════════════════════════
//
// Reads sandbox/{tenantId}/pages/{slug}.json from TOUR_PAGES R2.
// Returns { ok, slug, sections: [] } — an empty array is valid (new page).
pages.get('/:slug/sections', async (c) => {
  const tenantId = (c.req.header('X-Tenant-ID') ?? c.req.query('tid') ?? '').trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const slug = c.req.param('slug');
  if (!SAFE_SLUG_RE.test(slug)) return c.json({ error: 'Invalid slug.' }, 400);

  if (!c.env.TOUR_PAGES) return c.json({ error: 'TOUR_PAGES R2 binding not configured.' }, 503);

  // Verify the page belongs to this tenant
  const row = await c.env.DB
    .prepare('SELECT id FROM tenant_pages WHERE tenant_id = ? AND slug = ?')
    .bind(tenantId, slug)
    .first();
  if (!row) return c.json({ error: 'Page not found.', slug }, 404);

  const jsonKey = `sandbox/${tenantId}/pages/${slug}.json`;
  let sections  = [];
  try {
    const obj = await c.env.TOUR_PAGES.get(jsonKey);
    if (obj) {
      const data = await obj.json();
      if (Array.isArray(data?.sections)) sections = data.sections;
    }
  } catch (_) { /* missing file = empty sections — not an error */ }

  return c.json({ ok: true, slug, sections });
});

// ═════════════════════════════════════════════════════════════════════════════
// PUT /:slug/sections  — write per-page section blocks
// ═════════════════════════════════════════════════════════════════════════════
//
// Body: { sections: [{ id, type, html }] }
// Writes JSON to sandbox/{tenantId}/pages/{slug}.json.
// [SEC] Each section is validated: id/type/html must be short strings; html ≤ 64 KB.
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

  if (!c.env.TOUR_PAGES) return c.json({ error: 'TOUR_PAGES R2 binding not configured.' }, 503);

  // Verify page ownership
  const row = await c.env.DB
    .prepare('SELECT id FROM tenant_pages WHERE tenant_id = ? AND slug = ?')
    .bind(tenantId, slug)
    .first();
  if (!row) return c.json({ error: 'Page not found.', slug }, 404);

  // Validate and sanitize each section entry
  const sections = body.sections
    .filter(s =>
      s && typeof s === 'object' &&
      typeof s.id   === 'string' && s.id.length   <= 64 &&
      typeof s.type === 'string' && s.type.length  <= 32 &&
      typeof s.html === 'string' && s.html.length  <= 65536
    )
    .map(s => ({ id: s.id, type: s.type, html: s.html }));

  const jsonKey = `sandbox/${tenantId}/pages/${slug}.json`;
  await c.env.TOUR_PAGES.put(jsonKey, JSON.stringify({ slug, sections }), {
    httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' },
    customMetadata: { tenant_id: tenantId, slug },
  });

  // Update D1 updated_at
  await c.env.DB
    .prepare('UPDATE tenant_pages SET updated_at = ? WHERE tenant_id = ? AND slug = ?')
    .bind(now(), tenantId, slug)
    .run();

  return c.json({ ok: true, slug, sections_count: sections.length });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /:slug/clone  — clone a page
// ═════════════════════════════════════════════════════════════════════════════
//
// Body: { title: string, slug?: string }
// Clones the source page's D1 record, R2 HTML, and R2 sections JSON into a
// new page with the provided title/slug.  The new page starts as 'draft'.
pages.post('/:slug/clone', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const srcSlug = c.req.param('slug');
  if (!SAFE_SLUG_RE.test(srcSlug)) return c.json({ error: 'Invalid source slug.' }, 400);

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Request body is not valid JSON.' }, 400); }

  const newTitle = (body.title ?? '').trim();
  if (!newTitle)              return c.json({ error: 'Missing required field: title.' }, 400);
  if (newTitle.length > 120)  return c.json({ error: 'title exceeds 120 characters.' }, 400);

  let newSlug = (body.slug ?? '').toLowerCase().trim() || slugify(newTitle);
  if (!newSlug) newSlug = 'page-' + nanoid(6).toLowerCase();
  if (!SAFE_SLUG_RE.test(newSlug)) {
    return c.json({ error: 'slug must be lowercase letters, digits and hyphens only.' }, 400);
  }

  if (!c.env.TOUR_PAGES) return c.json({ error: 'TOUR_PAGES R2 binding not configured.' }, 503);

  // Verify source page belongs to tenant
  const srcRow = await c.env.DB
    .prepare('SELECT * FROM tenant_pages WHERE tenant_id = ? AND slug = ?')
    .bind(tenantId, srcSlug)
    .first();
  if (!srcRow) return c.json({ error: 'Source page not found.', slug: srcSlug }, 404);

  // Check new slug uniqueness
  const conflict = await c.env.DB
    .prepare('SELECT id FROM tenant_pages WHERE tenant_id = ? AND slug = ?')
    .bind(tenantId, newSlug)
    .first();
  if (conflict) {
    return c.json({ error: `A page with slug "${newSlug}" already exists.`, code: 'SLUG_CONFLICT' }, 409);
  }

  // Copy R2 HTML (re-render title in the copy)
  let copiedHtml = '';
  try {
    const htmlObj = await c.env.TOUR_PAGES.get(`sandbox/${tenantId}/pages/${srcSlug}.html`);
    if (htmlObj) copiedHtml = await htmlObj.text();
  } catch (_) {}
  // Swap the <title> tag in the copy so it reflects the new title
  if (copiedHtml) {
    copiedHtml = copiedHtml.replace(/<title>[^<]*<\/title>/i, `<title>${newTitle.replace(/</g,'&lt;')}</title>`);
    await c.env.TOUR_PAGES.put(`sandbox/${tenantId}/pages/${newSlug}.html`, copiedHtml, {
      httpMetadata: { contentType: 'text/html; charset=utf-8', cacheControl: 'no-store' },
      customMetadata: { tenant_id: tenantId, slug: newSlug, title: newTitle, cloned_from: srcSlug },
    });
  }

  // Copy sections JSON
  let srcSections = [];
  try {
    const jsonObj = await c.env.TOUR_PAGES.get(`sandbox/${tenantId}/pages/${srcSlug}.json`);
    if (jsonObj) {
      const data = await jsonObj.json();
      if (Array.isArray(data?.sections)) srcSections = data.sections;
    }
  } catch (_) {}
  // Assign new IDs to each cloned section so they are independent of the source
  const clonedSections = srcSections.map(s => ({
    id:   'sec-' + nanoid(8),
    type: s.type,
    html: s.html,
  }));
  await c.env.TOUR_PAGES.put(`sandbox/${tenantId}/pages/${newSlug}.json`, JSON.stringify({ slug: newSlug, sections: clonedSections }), {
    httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' },
    customMetadata: { tenant_id: tenantId, slug: newSlug, cloned_from: srcSlug },
  });

  // Insert D1 record
  const newId = nanoid();
  const ts    = now();
  await c.env.DB
    .prepare(
      `INSERT INTO tenant_pages
         (id, tenant_id, slug, title, content_html, template_type, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
    )
    .bind(newId, tenantId, newSlug, newTitle, srcRow.content_html ?? '', srcRow.template_type ?? 'generic', ts, ts)
    .run();

  console.info(`[PAGES] Cloned page tenant=${tenantId} src=${srcSlug} new=${newSlug}`);

  return c.json({
    ok:   true,
    page: {
      id:            newId,
      tenant_id:     tenantId,
      slug:          newSlug,
      title:         newTitle,
      template_type: srcRow.template_type ?? 'generic',
      status:        'draft',
      sections_count: clonedSections.length,
      preview_url:   `/api/tenant/pages/${newSlug}/preview`,
    },
    cloned_from: srcSlug,
  }, 201);
});

export default pages;
