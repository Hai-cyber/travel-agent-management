// src/routes/suppliers.js
// ── Supplier Library ──────────────────────────────────────────────────────────
// Tenant-scoped supplier catalog: hotels, guides, transport companies,
// restaurants, airlines, and other service providers.
//
// Routes:
//   GET    /api/suppliers              list (optionally filter by type, search, is_active)
//   POST   /api/suppliers              create
//   GET    /api/suppliers/:id          get one
//   PATCH  /api/suppliers/:id          update
//   DELETE /api/suppliers/:id          soft-delete (is_active = 0)

import { Hono } from 'hono';

const suppliers = new Hono();

const VALID_TYPES = new Set(['hotel', 'guide', 'transport', 'restaurant', 'airline', 'other']);

function nanoid() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 21);
}

function tenantId(c) {
  return c.req.header('X-Tenant-ID')?.trim() || null;
}

// ── GET /api/suppliers ─────────────────────────────────────────────────────────
suppliers.get('/', async (c) => {
  const tid = tenantId(c);
  if (!tid) return c.json({ error: 'X-Tenant-ID header is required' }, 400);

  const type     = c.req.query('type')     || '';
  const q        = c.req.query('q')        || '';
  const inactive = c.req.query('inactive') === '1';

  let sql = 'SELECT id, name, type, contact_name, contact_phone, contact_email, contact_whatsapp, contact_zalo, address, notes, is_active, created_at FROM suppliers WHERE tenant_id = ?';
  const binds = [tid];

  if (!inactive) { sql += ' AND is_active = 1'; }
  if (type)      { sql += ' AND type = ?'; binds.push(type); }
  if (q)         { sql += ' AND (name LIKE ? OR contact_name LIKE ? OR contact_phone LIKE ?)'; const like = `%${q}%`; binds.push(like, like, like); }

  sql += ' ORDER BY name ASC';

  try {
    const rows = await c.env.DB.prepare(sql).bind(...binds).all();
    return c.json({ ok: true, suppliers: rows.results || [] });
  } catch (err) {
    console.error('[suppliers.list]', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// ── POST /api/suppliers ────────────────────────────────────────────────────────
suppliers.post('/', async (c) => {
  const tid = tenantId(c);
  if (!tid) return c.json({ error: 'X-Tenant-ID header is required' }, 400);

  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const name = String(body?.name || '').trim();
  if (!name) return c.json({ error: 'name is required' }, 422);

  const type = String(body?.type || 'other').trim().toLowerCase();
  if (!VALID_TYPES.has(type)) return c.json({ error: `type must be one of: ${[...VALID_TYPES].join(', ')}` }, 422);

  const id  = nanoid();
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(`
    INSERT INTO suppliers (id, tenant_id, name, type, contact, contact_name, contact_phone, contact_email, contact_whatsapp, contact_zalo, address, notes, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).bind(
    id, tid,
    name, type,
    body?.contact         ? String(body.contact).slice(0, 500)          : null,
    body?.contact_name    ? String(body.contact_name).slice(0, 200)     : null,
    body?.contact_phone   ? String(body.contact_phone).slice(0, 50)     : null,
    body?.contact_email   ? String(body.contact_email).slice(0, 200)    : null,
    body?.contact_whatsapp? String(body.contact_whatsapp).slice(0, 50)  : null,
    body?.contact_zalo    ? String(body.contact_zalo).slice(0, 100)     : null,
    body?.address         ? String(body.address).slice(0, 500)          : null,
    body?.notes           ? String(body.notes).slice(0, 1000)           : null,
    now,
  ).run();

  const created = await c.env.DB.prepare(
    'SELECT id, name, type, contact_name, contact_phone, contact_email, contact_whatsapp, contact_zalo, address, notes, is_active, created_at FROM suppliers WHERE id = ? AND tenant_id = ?'
  ).bind(id, tid).first();

  return c.json({ ok: true, supplier: created }, 201);
});

// ── GET /api/suppliers/:id ─────────────────────────────────────────────────────
suppliers.get('/:id', async (c) => {
  const tid = tenantId(c);
  if (!tid) return c.json({ error: 'X-Tenant-ID header is required' }, 400);

  const row = await c.env.DB.prepare(
    'SELECT id, name, type, contact, contact_name, contact_phone, contact_email, contact_whatsapp, contact_zalo, address, notes, is_active, created_at FROM suppliers WHERE id = ? AND tenant_id = ?'
  ).bind(c.req.param('id'), tid).first();

  if (!row) return c.json({ error: 'Supplier not found' }, 404);
  return c.json({ ok: true, supplier: row });
});

// ── PATCH /api/suppliers/:id ───────────────────────────────────────────────────
suppliers.patch('/:id', async (c) => {
  const tid = tenantId(c);
  if (!tid) return c.json({ error: 'X-Tenant-ID header is required' }, 400);

  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const ALLOWED = ['name', 'type', 'contact', 'contact_name', 'contact_phone', 'contact_email', 'contact_whatsapp', 'contact_zalo', 'address', 'notes', 'is_active'];
  const sets = [], binds = [];

  for (const key of ALLOWED) {
    if (!(key in body)) continue;
    if (key === 'type') {
      const t = String(body.type || '').trim().toLowerCase();
      if (!VALID_TYPES.has(t)) return c.json({ error: `type must be one of: ${[...VALID_TYPES].join(', ')}` }, 422);
      sets.push('type = ?'); binds.push(t);
    } else if (key === 'is_active') {
      sets.push('is_active = ?'); binds.push(body.is_active ? 1 : 0);
    } else {
      const val = body[key] ? String(body[key]).trim() : null;
      sets.push(`${key} = ?`); binds.push(val);
    }
  }

  if (!sets.length) return c.json({ error: 'No updatable fields provided' }, 400);

  binds.push(c.req.param('id'), tid);
  const result = await c.env.DB.prepare(`UPDATE suppliers SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...binds).run();
  if (!result.meta?.changes) return c.json({ error: 'Supplier not found' }, 404);

  const updated = await c.env.DB.prepare(
    'SELECT id, name, type, contact_name, contact_phone, contact_email, contact_whatsapp, contact_zalo, address, notes, is_active, created_at FROM suppliers WHERE id = ? AND tenant_id = ?'
  ).bind(c.req.param('id'), tid).first();

  return c.json({ ok: true, supplier: updated });
});

// ── DELETE /api/suppliers/:id — soft-delete ────────────────────────────────────
suppliers.delete('/:id', async (c) => {
  const tid = tenantId(c);
  if (!tid) return c.json({ error: 'X-Tenant-ID header is required' }, 400);

  const result = await c.env.DB.prepare(
    'UPDATE suppliers SET is_active = 0 WHERE id = ? AND tenant_id = ?'
  ).bind(c.req.param('id'), tid).run();

  if (!result.meta?.changes) return c.json({ error: 'Supplier not found' }, 404);
  return c.json({ ok: true });
});

export default function registerSupplierRoutes(app) {
  app.route('/api/suppliers', suppliers);
}
