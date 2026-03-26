// src/routes/categories.js
// Tour Category CRUD — CHK-R25
//
// GET  /api/categories          — public; resolves tenant from Host header (used by inject.js)
// POST /api/categories          — authenticated (X-Tenant-ID); create a category
// PATCH /api/categories/:id     — authenticated; partial update (dynamic SQL)
// DELETE /api/categories/:id    — authenticated; hard delete
//
// [SEC] All write endpoints enforce tenant isolation via WHERE tenant_id = ?
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { resolveTenantByHost } from '../lib/siteStudio.js';

const router = new Hono();

// Slug must be lowercase alphanumeric + hyphens only — safe for URLs and HTML attributes
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ── GET /api/categories ────────────────────────────────────────────────────
// Public endpoint — inject.js calls this on every tour listing page.
// Returns active categories sorted by sort_order ASC, then name ASC.
// Resolves tenant from the Host header so no auth token is needed.
router.get('/', async (c) => {
  try {
    const host = c.req.header('host') ?? '';
    const tenant = await resolveTenantByHost(host, c.env.DB);
    // Unknown host → empty list (never an error — graceful degradation)
    if (!tenant) return c.json({ ok: true, categories: [] });

    const { results } = await c.env.DB
      .prepare(
        `SELECT id, name, slug, sort_order
         FROM   tour_categories
         WHERE  tenant_id = ? AND is_active = 1
         ORDER  BY sort_order ASC, name ASC`
      )
      .bind(tenant.id)
      .all();

    return c.json({ ok: true, categories: results });
  } catch (err) {
    console.error('[CATEGORIES_GET_ERROR]', err.message);
    // Fail gracefully — inject.js will simply skip filter rendering
    return c.json({ ok: true, categories: [] });
  }
});

// ── POST /api/categories ───────────────────────────────────────────────────
// Create a new category for the authenticated tenant.
// Required body: { name, slug }   Optional: { sort_order }
router.post('/', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) {
    return c.json({ ok: false, error: 'X-Tenant-ID header is required' }, 400);
  }

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ ok: false, error: 'Invalid JSON body' }, 400); }

  const { name, slug, sort_order = 0 } = body ?? {};

  if (!name?.trim()) {
    return c.json({ ok: false, error: 'name is required' }, 400);
  }
  const trimmedSlug = slug?.trim() ?? '';
  if (!trimmedSlug || !SLUG_RE.test(trimmedSlug)) {
    return c.json(
      { ok: false, error: 'slug must be lowercase alphanumeric with optional hyphens (e.g. beach-tours)' },
      400
    );
  }

  const id  = nanoid();
  const now = Math.floor(Date.now() / 1000);

  try {
    await c.env.DB
      .prepare(
        `INSERT INTO tour_categories (id, tenant_id, name, slug, sort_order, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)`
      )
      .bind(id, tenantId, name.trim(), trimmedSlug, Number(sort_order), now)
      .run();

    return c.json(
      { ok: true, category: { id, name: name.trim(), slug: trimmedSlug, sort_order: Number(sort_order) } },
      201
    );
  } catch (err) {
    if (err.message?.includes('UNIQUE')) {
      return c.json(
        { ok: false, error: `A category with slug "${trimmedSlug}" already exists for this tenant` },
        409
      );
    }
    console.error('[CATEGORIES_POST_ERROR]', err.message);
    return c.json({ ok: false, error: 'Internal server error' }, 500);
  }
});

// ── PATCH /api/categories/:id ──────────────────────────────────────────────
// Partial update — only fields present in the request body are changed.
// Allowed: name, slug, sort_order, is_active
// [SEC] WHERE id = ? AND tenant_id = ? prevents cross-tenant writes
router.patch('/:id', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) {
    return c.json({ ok: false, error: 'X-Tenant-ID header is required' }, 400);
  }

  const categoryId = c.req.param('id');

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ ok: false, error: 'Invalid JSON body' }, 400); }

  // Dynamic SQL — only update fields that are explicitly provided
  const ALLOWED_COLS = ['name', 'slug', 'sort_order', 'is_active'];
  const sets  = [];
  const binds = [];

  for (const col of ALLOWED_COLS) {
    if (!(col in body)) continue;

    if (col === 'slug') {
      const s = body.slug?.trim() ?? '';
      if (!s || !SLUG_RE.test(s)) {
        return c.json(
          { ok: false, error: 'slug must be lowercase alphanumeric with optional hyphens (e.g. beach-tours)' },
          400
        );
      }
      sets.push('slug = ?');
      binds.push(s);
    } else if (col === 'name') {
      const n = String(body.name ?? '').trim();
      if (!n) return c.json({ ok: false, error: 'name cannot be empty' }, 400);
      sets.push('name = ?');
      binds.push(n);
    } else if (col === 'sort_order' || col === 'is_active') {
      sets.push(`${col} = ?`);
      binds.push(Number(body[col]));
    }
  }

  if (!sets.length) {
    return c.json({ ok: false, error: 'No valid fields provided to update' }, 400);
  }

  // [SEC] Tenant isolation enforced in WHERE clause
  binds.push(categoryId, tenantId);

  try {
    const result = await c.env.DB
      .prepare(`UPDATE tour_categories SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`)
      .bind(...binds)
      .run();

    if (!result.meta?.changes) {
      return c.json({ ok: false, error: 'Category not found or no changes made' }, 404);
    }
    return c.json({ ok: true });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) {
      return c.json(
        { ok: false, error: 'A category with this slug already exists for this tenant' },
        409
      );
    }
    console.error('[CATEGORIES_PATCH_ERROR]', err.message);
    return c.json({ ok: false, error: 'Internal server error' }, 500);
  }
});

// ── DELETE /api/categories/:id ─────────────────────────────────────────────
// Hard delete. Tours with this category_id will have a dangling soft-FK (NULL
// is the effective fallback since category_id has no ON DELETE CASCADE).
// [SEC] WHERE id = ? AND tenant_id = ? prevents cross-tenant deletes
router.delete('/:id', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) {
    return c.json({ ok: false, error: 'X-Tenant-ID header is required' }, 400);
  }

  const categoryId = c.req.param('id');

  try {
    const result = await c.env.DB
      .prepare(`DELETE FROM tour_categories WHERE id = ? AND tenant_id = ?`)
      .bind(categoryId, tenantId)
      .run();

    if (!result.meta?.changes) {
      return c.json({ ok: false, error: 'Category not found' }, 404);
    }
    return c.json({ ok: true });
  } catch (err) {
    console.error('[CATEGORIES_DELETE_ERROR]', err.message);
    return c.json({ ok: false, error: 'Internal server error' }, 500);
  }
});

export default function registerCategoryRoutes(app) {
  app.route('/api/categories', router);
}
