/**
 * CHK-R109: Email ingest endpoint
 *
 * Receives inbound email data (from Cloudflare Email Routing webhook,
 * make.com, or any forwarder) and saves it as an email_draft record.
 *
 * Routes:
 *   POST  /api/email/ingest          — receive & store an inbound email
 *   GET   /api/email/drafts          — list email drafts for a tenant
 *   GET   /api/email/drafts/:id      — get a single draft
 *   PATCH /api/email/drafts/:id      — update status / notes / assignment
 */

import { nanoid } from 'nanoid';
import {
  readAuthSessionToken,
  getAuthSession,
  clearAuthSessionCookie,
} from '../lib/auth.js';

// ── Auth helper ───────────────────────────────────────────────────────────────

async function requireTenantSession(c, tenantId) {
  const token = readAuthSessionToken(c);
  if (!token) return { error: c.json({ error: 'Authentication required.' }, 401) };

  const session = await getAuthSession(c.env.DB, token);
  if (!session) {
    clearAuthSessionCookie(c);
    return { error: c.json({ error: 'Session expired. Please log in again.' }, 401) };
  }

  if (tenantId && session.tenant_id !== tenantId) {
    return { error: c.json({ error: 'Forbidden for this tenant.' }, 403) };
  }

  return { session };
}

// ── Simple body-text parser ───────────────────────────────────────────────────

/**
 * Attempts to extract lead hints from the email body using simple heuristics.
 * Returns a JSON-serialisable object.
 */
function parseEmailBody(subject = '', bodyText = '') {
  const combined = `${subject}\n${bodyText}`.toLowerCase();

  const hints = {};

  // Phone number: look for common patterns
  const phoneMatch = bodyText.match(/(?:\+?[\d\s\-()]{7,15})/);
  if (phoneMatch) hints.phone = phoneMatch[0].trim();

  // Pax: "2 adults", "4 people", "group of 3", etc.
  const paxMatch = combined.match(/(\d+)\s*(?:adult|people|person|pax|guest|passenger)/);
  if (paxMatch) hints.pax = parseInt(paxMatch[1], 10);

  // Budget: any currency mention
  const budgetMatch = combined.match(/(?:budget|price|cost)[^$€£\d]*([€$£]?\s*[\d,]+(?:\s*(?:usd|eur|vnd|usd|gbp))?)/i);
  if (budgetMatch) hints.budget = budgetMatch[1].trim();

  // Tour interest: lines containing "tour", "trip", "package"
  const tourLine = bodyText.split('\n').find(l => /tour|trip|package|excursion/i.test(l));
  if (tourLine) hints.tour_interest = tourLine.trim().slice(0, 120);

  // Dates: ISO or common date patterns
  const dateMatch = combined.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})/);
  if (dateMatch) hints.dates = dateMatch[1];

  return Object.keys(hints).length ? hints : null;
}

// ── Ingest security: validate shared secret ────────────────────────────────

function validateIngestSecret(c) {
  const secret = String(c.env.EMAIL_INGEST_SECRET || '').trim();
  if (!secret) return true; // no secret configured — open (dev mode)

  const provided =
    c.req.header('X-Ingest-Secret') ||
    c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ||
    '';

  return provided === secret;
}

// ── Route registration ────────────────────────────────────────────────────────

export default function registerEmailRoutes(app) {
  /**
   * POST /api/email/ingest
   *
   * Accepts any of these body formats:
   *   { from, to, subject, body_text, body_html, headers?, tenant_id? }
   *   { from_email, to_email, subject, text, html, ... }
   *   Cloudflare Email Worker format: { from, to, raw, ... }
   *
   * The endpoint is intentionally permissive about the shape — it adapts to
   * various forwarding services. A shared secret ENV var (EMAIL_INGEST_SECRET)
   * provides a lightweight gate.
   */
  app.post('/api/email/ingest', async (c) => {
    if (!validateIngestSecret(c)) {
      return c.json({ error: 'Unauthorized.' }, 401);
    }

    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'JSON body required.' }, 400);
    }

    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Invalid body.' }, 400);
    }

    const now = Math.floor(Date.now() / 1000);

    // Normalise fields from multiple possible naming conventions
    const fromEmail  = String(body.from_email  || body.from    || '').trim().slice(0, 320);
    const fromName   = String(body.from_name   || body.sender_name || '').trim().slice(0, 200);
    const toEmail    = String(body.to_email    || body.to      || '').trim().slice(0, 320);
    const subject    = String(body.subject     || '').trim().slice(0, 500);
    const bodyText   = String(body.body_text   || body.text    || body.body || '').slice(0, 50000);
    const bodyHtml   = String(body.body_html   || body.html    || '').slice(0, 100000);
    const rawHeaders = body.headers ? JSON.stringify(body.headers).slice(0, 4000) : null;
    const source     = String(body.source      || 'webhook').slice(0, 64);

    // Tenant routing: explicit tenant_id in body, or resolve by to_email domain
    let tenantId = String(body.tenant_id || '').trim() || null;

    // If no explicit tenant_id, attempt to resolve by the To address domain
    if (!tenantId && toEmail) {
      const toHost = toEmail.split('@')[1]?.toLowerCase();
      if (toHost) {
        const tenantRow = await c.env.DB.prepare(
          `SELECT t.id FROM tenants t
           INNER JOIN tenant_domains td ON td.tenant_id = t.id
           WHERE td.domain = ? AND t.deleted_at IS NULL
           LIMIT 1`
        ).bind(toHost).first().catch(() => null);
        if (tenantRow) tenantId = tenantRow.id;
      }
    }

    // Auto-parse lead hints
    const parsedHints = parseEmailBody(subject, bodyText);

    const draftId = nanoid();

    await c.env.DB.prepare(`
      INSERT INTO email_drafts
        (id, tenant_id, received_at, from_email, from_name, to_email, subject,
         body_text, body_html, parsed_json, status, raw_headers, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)
    `).bind(
      draftId,
      tenantId,
      now,
      fromEmail || null,
      fromName  || null,
      toEmail   || null,
      subject   || null,
      bodyText  || null,
      bodyHtml  || null,
      parsedHints ? JSON.stringify(parsedHints) : null,
      rawHeaders,
      source,
      now,
    ).run();

    return c.json({ ok: true, id: draftId });
  });

  // GET /api/email/drafts — list email drafts for a tenant
  app.get('/api/email/drafts', async (c) => {
    const tenantId = c.req.header('X-Tenant-ID')?.trim();
    if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

    const { session, error } = await requireTenantSession(c, tenantId);
    if (error) return error;

    const status = c.req.query('status') || 'new';
    const limit  = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
    const offset = parseInt(c.req.query('offset') || '0', 10);

    const validStatuses = new Set(['new', 'reviewed', 'replied', 'archived', 'all']);
    const statusFilter = validStatuses.has(status) ? status : 'new';

    const rows = await c.env.DB.prepare(
      statusFilter === 'all'
        ? `SELECT id, received_at, from_email, from_name, subject, status, parsed_json
           FROM email_drafts WHERE tenant_id = ?
           ORDER BY received_at DESC LIMIT ? OFFSET ?`
        : `SELECT id, received_at, from_email, from_name, subject, status, parsed_json
           FROM email_drafts WHERE tenant_id = ? AND status = ?
           ORDER BY received_at DESC LIMIT ? OFFSET ?`
    ).bind(
      ...(statusFilter === 'all' ? [tenantId, limit, offset] : [tenantId, statusFilter, limit, offset])
    ).all();

    return c.json({ drafts: rows.results ?? [] });
  });

  // GET /api/email/drafts/:id — get a single draft
  app.get('/api/email/drafts/:id', async (c) => {
    const tenantId = c.req.header('X-Tenant-ID')?.trim();
    if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

    const { session, error } = await requireTenantSession(c, tenantId);
    if (error) return error;

    const draft = await c.env.DB.prepare(
      'SELECT * FROM email_drafts WHERE id = ? AND tenant_id = ?'
    ).bind(c.req.param('id'), tenantId).first();

    if (!draft) return c.json({ error: 'Draft not found.' }, 404);

    return c.json({ draft });
  });

  // PATCH /api/email/drafts/:id — update status / notes / assignment
  app.patch('/api/email/drafts/:id', async (c) => {
    const tenantId = c.req.header('X-Tenant-ID')?.trim();
    if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

    const { session, error } = await requireTenantSession(c, tenantId);
    if (error) return error;

    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Request body required.' }, 400);

    const VALID_STATUSES = new Set(['new', 'reviewed', 'replied', 'archived']);

    const updates = {};
    if (body.status    !== undefined && VALID_STATUSES.has(body.status)) updates.status = body.status;
    if (body.notes     !== undefined) updates.notes = String(body.notes || '').slice(0, 2000) || null;
    if (body.assigned_to !== undefined) updates.assigned_to = body.assigned_to || null;

    if (!Object.keys(updates).length) {
      return c.json({ error: 'No valid fields to update.' }, 400);
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), c.req.param('id'), tenantId];

    const result = await c.env.DB.prepare(
      `UPDATE email_drafts SET ${setClauses} WHERE id = ? AND tenant_id = ?`
    ).bind(...values).run();

    if (!result.meta?.changes) return c.json({ error: 'Draft not found.' }, 404);

    return c.json({ ok: true });
  });
}
