/**
 * src/routes/tours.js
 * Headless Publishing Pipeline — Cloudflare R2 backed.
 *
 * R2 bucket layout  (binding: env.TOUR_PAGES)
 * ─────────────────────────────────────────────────────────────────────────────
 *   templates/{template_id}.html       ← HTML templates (uploaded via API)
 *   {tenant_id}/{tour_slug}.html       ← published tour pages
 *
 * Placeholder convention  (UPPER_SNAKE_CASE, case-sensitive)
 * ─────────────────────────────────────────────────────────────────────────────
 *   {{TOUR_NAME}}   content_data.tour_name  || tours.title
 *   {{TOUR_CODE}}   content_data.tour_code
 *   {{ITINERARY}}   rendered <ol> from content_data.itinerary[]
 *   {{BASE_PRICE}}  content_data.base_price (raw number, format in template)
 *   {{DURATION}}    tours.duration_text || content_data.duration
 *   {{HIGHLIGHTS}}  rendered <ul> from content_data.highlights[]
 *   {{INCLUDES}}    rendered <ul> from content_data.includes[]
 *   {{EXCLUDES}}    rendered <ul> from content_data.excludes[]
 *   {{TOUR_SLUG}}   tours.slug
 *   {{TENANT_ID}}   tours.tenant_id
 *   {{LANG}}        tours.lang
 *
 * content_data shape (stored as JSON TEXT in D1)
 * ─────────────────────────────────────────────────────────────────────────────
 * {
 *   "tour_name":  "Hà Nội – Hạ Long 3N2Đ",
 *   "tour_code":  "HNX-HAL-3N2D",
 *   "base_price": 2500000,
 *   "itinerary":  [{ "day": 1, "title": "...", "description": "..." }],
 *   "highlights": ["Cave cruise", "Sunset views"],
 *   "includes":   ["Hotel", "Breakfast"],
 *   "excludes":   ["International flights"]
 * }
 */

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import {
  checkPublishPermission,
  buildPayButton,
  buildPreviewBanner,
  buildPreviewPayButton,
  buildPlatformBrand,
} from '../lib/publishGuard.js';

const tours = new Hono();

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Convert a display title to a URL-safe slug.
 * Handles Vietnamese ä diacritics and the special 'đ' character.
 */
function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/đ/g, 'd')                   // must precede NFD — no decomposition for đ
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')      // strip combining diacritics (à→a, etc.)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

/**
 * Sanitize a user-supplied identifier to be safe as an R2 key segment.
 * Allows only a–z, A–Z, 0–9, _ and -.
 */
function safeId(id) {
  return String(id ?? '').replace(/[^a-z0-9_-]/gi, '').slice(0, 80);
}

function renderList(items) {
  if (!Array.isArray(items) || items.length === 0) return '';
  return `<ul>\n${items.map(i => `  <li>${i}</li>`).join('\n')}\n</ul>`;
}

function renderItinerary(itinerary) {
  if (!Array.isArray(itinerary) || itinerary.length === 0) return '';
  return `<ol class="itinerary">\n${
    itinerary.map(item =>
      `  <li class="itinerary-day">\n` +
      `    <strong>Day ${item.day ?? ''}: ${item.title ?? ''}</strong>\n` +
      `    <p>${item.description ?? ''}</p>\n` +
      `  </li>`
    ).join('\n')
  }\n</ol>`;
}

/**
 * Replace all {{UPPER_SNAKE_KEY}} placeholders in an HTML template string.
 * Unknown placeholders are left as-is (transparent — safe for future extensions).
 */
function applyPlaceholders(html, vars) {
  return html.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key] ?? '') : match
  );
}

// ── generateTourPage ──────────────────────────────────────────────────────────
/**
 * Core publishing function.
 * 1. Fetches the HTML template from R2 at templates/{template_id}.html
 * 2. Parses content_data JSON
 * 3. Builds the placeholder map
 * 4. Returns rendered HTML string
 *
 * @param {object} env              - Worker env (env.TOUR_PAGES R2 binding required)
 * @param {object} tour             - DB row from tours (content_data as raw string)
 * @param {string} [templateIdOverride] - Use this template instead of tour.template_id
 * @param {object|null} [paymentConfig] - Parsed payment_config_json for pay-button injection
 * @param {'live'|'preview'} [renderMode='live']
 *   'live'    — clean whitelabel output (no platform branding, pay button active if configured)
 *   'preview' — platform subdomain view (preview banner, pay button disabled, attribution shown)
 * @returns {Promise<{ok: true, html: string} | {ok: false, error: string}>}
 */
export async function generateTourPage(env, tour, templateIdOverride, paymentConfig = null, renderMode = 'live') {
  if (!env.TOUR_PAGES) {
    return { ok: false, error: 'R2 binding TOUR_PAGES is not configured on this Worker.' };
  }

  const tmplId  = safeId(templateIdOverride ?? tour.template_id ?? 'default');
  const tmplKey = `templates/${tmplId}.html`;

  const tmplObj = await env.TOUR_PAGES.get(tmplKey);
  if (!tmplObj) {
    return {
      ok:    false,
      error: `Template not found in R2: "${tmplKey}". Upload it via PUT /api/tours/templates/${tmplId}`,
    };
  }
  const templateHtml = await tmplObj.text();

  // Parse content_data — stored as JSON TEXT in D1
  let content = {};
  if (tour.content_data) {
    try {
      content = typeof tour.content_data === 'string'
        ? JSON.parse(tour.content_data)
        : tour.content_data;
    } catch {
      return { ok: false, error: 'content_data is not valid JSON.' };
    }
  }

  const vars = {
    TOUR_NAME:  content.tour_name  ?? tour.title ?? '',
    TOUR_CODE:  content.tour_code  ?? '',
    ITINERARY:  renderItinerary(content.itinerary  ?? []),
    BASE_PRICE: content.base_price != null ? String(content.base_price) : '',
    DURATION:   tour.duration_text ?? content.duration ?? '',
    HIGHLIGHTS: renderList(content.highlights),
    INCLUDES:   renderList(content.includes),
    EXCLUDES:   renderList(content.excludes),
    TOUR_SLUG:       tour.slug      ?? '',
    TENANT_ID:       tour.tenant_id ?? '',
    LANG:            tour.lang      ?? 'vi',
    // Environment-aware slots — differ between live (whitelabel) and preview (platform subdomain)
    PAY_BUTTON:      renderMode === 'preview'
                       ? buildPreviewPayButton()
                       : (buildPayButton(paymentConfig, tour.slug ?? '') ?? ''),
    PREVIEW_BANNER:  renderMode === 'preview' ? buildPreviewBanner()  : '',
    PLATFORM_BRAND:  renderMode === 'preview' ? buildPlatformBrand() : '',
  };

  return { ok: true, html: applyPlaceholders(templateHtml, vars) };
}

// ── Template management ───────────────────────────────────────────────────────

// PUT /api/tours/templates/:templateId — Upload an HTML template to R2
tours.put('/templates/:templateId', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  if (!c.env.TOUR_PAGES) {
    return c.json({ error: 'R2 binding TOUR_PAGES is not configured on this Worker.' }, 503);
  }

  const tmplId = safeId(c.req.param('templateId'));
  if (!tmplId) return c.json({ error: 'Invalid template ID.' }, 400);

  const ct = c.req.header('content-type') ?? '';
  if (!ct.includes('text/html') && !ct.includes('text/plain')) {
    return c.json({ error: 'Content-Type must be text/html or text/plain.' }, 400);
  }

  const body = await c.req.text();
  if (!body.trim()) return c.json({ error: 'Template HTML body is empty.' }, 400);

  const key = `templates/${tmplId}.html`;
  await c.env.TOUR_PAGES.put(key, body, {
    httpMetadata:   { contentType: 'text/html; charset=utf-8' },
    customMetadata: { uploaded_by: tenantId, uploaded_at: new Date().toISOString() },
  });

  return c.json({ ok: true, template_id: tmplId, r2_key: key }, 201);
});

// GET /api/tours/templates/:templateId — Read an HTML template from R2
tours.get('/templates/:templateId', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  if (!c.env.TOUR_PAGES) {
    return c.json({ error: 'R2 binding TOUR_PAGES is not configured on this Worker.' }, 503);
  }

  const tmplId = safeId(c.req.param('templateId'));
  const obj    = await c.env.TOUR_PAGES.get(`templates/${tmplId}.html`);
  if (!obj) return c.json({ error: `Template "${tmplId}" not found.` }, 404);

  return new Response(await obj.text(), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
});

// ── Tour CRUD ─────────────────────────────────────────────────────────────────

// GET /api/tours — List all tours for a tenant
tours.get('/', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const { results } = await c.env.DB
    .prepare(
      `SELECT id, title, slug, template_id, status, category_id,
              published_at, published_url, lang, duration_text, start_date, created_at
       FROM tours WHERE tenant_id = ? ORDER BY created_at DESC`
    )
    .bind(tenantId)
    .all();

  return c.json({ ok: true, tours: results });
});

// POST /api/tours — Create a tour with optional content_data
tours.post('/', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Request body is not valid JSON.' }, 400); }

  if (!body.title) return c.json({ error: 'Missing required field: title.' }, 400);

  const id        = nanoid();
  const now       = Math.floor(Date.now() / 1000);
  const slug      = safeId(slugify(body.slug ?? body.title)) + '-' + id.slice(0, 6);
  const tmplId    = safeId(body.template_id ?? 'default');

  // Serialize content_data — accept object or pre-stringified JSON
  let contentData = null;
  if (body.content_data != null) {
    contentData = typeof body.content_data === 'string'
      ? body.content_data
      : JSON.stringify(body.content_data);
  }

  // Slug uniqueness guard (belt-and-suspenders alongside the DB unique index)
  const clash = await c.env.DB
    .prepare('SELECT id FROM tours WHERE tenant_id = ? AND slug = ?')
    .bind(tenantId, slug)
    .first();
  if (clash) return c.json({ error: `Slug "${slug}" already exists for this tenant.` }, 409);

  await c.env.DB
    .prepare(
      `INSERT INTO tours
         (id, tenant_id, title, lang, duration_text, start_date, status,
          slug, content_data, template_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id, tenantId, body.title,
      body.lang          ?? 'vi',
      body.duration_text ?? null,
      body.start_date    ?? null,
      body.status        ?? 'draft',
      slug, contentData, tmplId, now
    )
    .run();

  return c.json({ ok: true, id, slug, template_id: tmplId }, 201);
});

// GET /api/tours/:id — Read a single tour (content_data auto-parsed)
tours.get('/:id', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const tour = await c.env.DB
    .prepare('SELECT * FROM tours WHERE id = ? AND tenant_id = ?')
    .bind(c.req.param('id'), tenantId)
    .first();
  if (!tour) return c.json({ error: 'Tour not found.' }, 404);

  // Return content_data as a parsed object for convenience
  if (tour.content_data) {
    try { tour.content_data = JSON.parse(tour.content_data); } catch { /* keep raw */ }
  }
  return c.json({ ok: true, tour });
});

// PATCH /api/tours/:id — Update metadata and/or content_data
tours.patch('/:id', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Request body is not valid JSON.' }, 400); }

  // Whitelist prevents column-injection; tenant_id / id / created_at are immutable
  const ALLOWED = ['title', 'lang', 'duration_text', 'start_date', 'status', 'content_data', 'template_id', 'slug', 'category_id'];
  const updates  = {};
  for (const key of ALLOWED) {
    if (!(key in body)) continue;
    if (key === 'content_data') {
      updates.content_data = typeof body.content_data === 'string'
        ? body.content_data
        : JSON.stringify(body.content_data);
    } else if (key === 'template_id') {
      updates.template_id = safeId(body.template_id);
    } else if (key === 'slug') {
      updates.slug = safeId(slugify(body.slug));
    } else if (key === 'category_id') {
      // Accept null (clear assignment) or a non-empty string
      if (body.category_id === null) {
        updates.category_id = null;
      } else if (typeof body.category_id === 'string' && body.category_id.trim()) {
        // [SEC] Verify category belongs to this tenant before assigning
        const cat = await c.env.DB
          .prepare('SELECT id FROM tour_categories WHERE id = ? AND tenant_id = ?')
          .bind(body.category_id.trim(), tenantId)
          .first();
        if (!cat) return c.json({ error: 'category_id not found for this tenant.' }, 404);
        updates.category_id = body.category_id.trim();
      }
    } else {
      updates[key] = body[key];
    }
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No updatable fields provided.' }, 400);
  }

  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values     = [...Object.values(updates), c.req.param('id'), tenantId];

  const result = await c.env.DB
    .prepare(`UPDATE tours SET ${setClauses} WHERE id = ? AND tenant_id = ?`)
    .bind(...values)
    .run();

  if (result.meta.changes === 0) return c.json({ error: 'Tour not found.' }, 404);
  return c.json({ ok: true, updated: Object.keys(updates) });
});

// ── Publishing endpoints ──────────────────────────────────────────────────────

// GET /api/tours/:id/preview
// Re-renders the tour ON THE FLY in 'preview' mode — always shows the
// preview banner + disabled pay button. Serves both draft and published tours.
// [IMPORTANT] Does NOT serve from R2 cache — so agents can preview even before
// publishing, and the preview is never confused with the live whitelabel page.
tours.get('/:id/preview', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);
  if (!c.env.TOUR_PAGES) return c.json({ error: 'R2 binding TOUR_PAGES is not configured.' }, 503);

  // Fetch full row — preview works for draft (no slug) and published tours alike
  const tour = await c.env.DB
    .prepare('SELECT * FROM tours WHERE id = ? AND tenant_id = ?')
    .bind(c.req.param('id'), tenantId)
    .first();
  if (!tour) return c.json({ error: 'Tour not found.' }, 404);

  // No subscription gate for preview — render with no payment config, preview mode
  const rendered = await generateTourPage(c.env, tour, undefined, null, 'preview');
  if (!rendered.ok) return c.json({ error: rendered.error }, 422);

  return new Response(rendered.html, {
    headers: {
      'Content-Type':  'text/html; charset=utf-8',
      'X-Render-Mode': 'preview',
      'Cache-Control': 'no-store, no-cache',
    },
  });
});

// POST /api/tours/:id/publish — Render HTML from template + content_data, save to R2
tours.post('/:id/publish', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);
  if (!c.env.TOUR_PAGES) return c.json({ error: 'R2 binding TOUR_PAGES is not configured.' }, 503);

  // Subscription + payment configuration check
  const guard = await checkPublishPermission(c.env, tenantId);
  if (!guard.ok) return c.json({ error: guard.error, code: guard.code, upgrade_url: guard.upgrade_url ?? null }, 403);

  const tour = await c.env.DB
    .prepare('SELECT * FROM tours WHERE id = ? AND tenant_id = ?')
    .bind(c.req.param('id'), tenantId)
    .first();
  if (!tour)      return c.json({ error: 'Tour not found.' }, 404);
  if (!tour.slug) return c.json({ error: 'Tour must have a slug before publishing. Use PATCH /api/tours/:id to set one.' }, 422);

  const rendered = await generateTourPage(c.env, tour, undefined, guard.paymentConfig, 'live');
  if (!rendered.ok) return c.json({ error: rendered.error }, 422);

  // /{tenant_id}/{tour_slug}.html — the canonical published path
  const r2Key = `${tenantId}/${tour.slug}.html`;
  await c.env.TOUR_PAGES.put(r2Key, rendered.html, {
    httpMetadata:   { contentType: 'text/html; charset=utf-8' },
    customMetadata: {
      tour_id:      tour.id,
      tenant_id:    tenantId,
      template_id:  tour.template_id ?? 'default',
      published_at: new Date().toISOString(),
    },
  });

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB
    .prepare('UPDATE tours SET published_at = ?, published_url = ?, status = ? WHERE id = ? AND tenant_id = ?')
    .bind(now, r2Key, 'on_sale', tour.id, tenantId)
    .run();

  return c.json({
    ok:           true,
    tour_id:      tour.id,
    slug:         tour.slug,
    r2_key:       r2Key,
    template_id:  tour.template_id ?? 'default',
    published_at: new Date(now * 1000).toISOString(),
  });
});

// POST /api/tours/:id/switch-template — Swap template, re-render, preserve published URL
tours.post('/:id/switch-template', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);
  if (!c.env.TOUR_PAGES) return c.json({ error: 'R2 binding TOUR_PAGES is not configured.' }, 503);

  // Subscription check — template swap re-renders the page so it needs the same gate
  const guard = await checkPublishPermission(c.env, tenantId);
  if (!guard.ok) return c.json({ error: guard.error, code: guard.code, upgrade_url: guard.upgrade_url ?? null }, 403);

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Request body is not valid JSON.' }, 400); }

  const newTemplateId = safeId(body.template_id ?? '');
  if (!newTemplateId) return c.json({ error: 'Missing required field: template_id.' }, 400);

  // Validate template exists BEFORE making any DB changes
  const tmplObj = await c.env.TOUR_PAGES.get(`templates/${newTemplateId}.html`);
  if (!tmplObj) {
    return c.json({
      error: `Template "${newTemplateId}" not found in R2. Upload it first via PUT /api/tours/templates/${newTemplateId}`,
    }, 404);
  }

  const tour = await c.env.DB
    .prepare('SELECT * FROM tours WHERE id = ? AND tenant_id = ?')
    .bind(c.req.param('id'), tenantId)
    .first();
  if (!tour)      return c.json({ error: 'Tour not found.' }, 404);
  if (!tour.slug) return c.json({ error: 'Tour must have a slug. Use PATCH /api/tours/:id to set one.' }, 422);

  // Re-render with the new template — content_data is unchanged
  const rendered = await generateTourPage(c.env, tour, newTemplateId, guard.paymentConfig, 'live');
  if (!rendered.ok) return c.json({ error: rendered.error }, 422);

  // Write to the SAME R2 key — the published URL is preserved
  const r2Key = `${tenantId}/${tour.slug}.html`;
  await c.env.TOUR_PAGES.put(r2Key, rendered.html, {
    httpMetadata:   { contentType: 'text/html; charset=utf-8' },
    customMetadata: {
      tour_id:      tour.id,
      tenant_id:    tenantId,
      template_id:  newTemplateId,
      published_at: new Date().toISOString(),
    },
  });

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB
    .prepare('UPDATE tours SET template_id = ?, published_at = ?, published_url = ? WHERE id = ? AND tenant_id = ?')
    .bind(newTemplateId, now, r2Key, tour.id, tenantId)
    .run();

  return c.json({
    ok:              true,
    tour_id:         tour.id,
    slug:            tour.slug,
    r2_key:          r2Key,
    old_template_id: tour.template_id ?? 'default',
    new_template_id: newTemplateId,
    published_at:    new Date(now * 1000).toISOString(),
    note:            'Published URL unchanged. content_data preserved.',
  });
});

// ── Register ──────────────────────────────────────────────────────────────────
export default function registerTourRoutes(app) {
  app.route('/api/tours', tours);
}
