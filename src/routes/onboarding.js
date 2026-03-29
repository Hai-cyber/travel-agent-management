/**
 * src/routes/onboarding.js
 *
 * Public signup/onboarding flow.
 *
 * POST /api/auth/signup-onboarding
 *   Body: { email, tenant_name, selected_template_id }
 *
 *   1. Validate inputs & check email uniqueness.
 *   2. Verify selected_template_id exists in site_templates.
 *   3. INSERT new tenant (subscription_status = 'TRIAL').
 *   4. Call initializeTenantSandbox() — copies template assets into
 *      sandbox/{tenant_id}/ inside TOUR_PAGES R2.
 *   5. Issue a setup_token (nanoid 32) stored in TOUR_PRESETS KV,
 *      TTL 1 hour — used by the dashboard for the initial session.
 *   6. Return { tenant_id, setup_token, redirect_url, sandbox }.
 *
 * [SEC] No authentication required (public endpoint).
 * [SEC] Email validated via regex; all string inputs sanitized before use.
 * [SEC] Rate-limiting should be applied at the edge / Cloudflare rules layer.
 * [SEC] Tenant isolation is enforced from the first INSERT onward.
 */

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { initializeTenantSandbox } from '../lib/siteStudio.js';

const onboarding = new Hono();

// ── Helpers ───────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Convert an arbitrary display name to a URL-safe slug.
 * Handles Vietnamese diacritics and the special 'đ' character.
 */
function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/đ/g, 'd')                  // must precede NFD — no decomposition for đ
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')     // strip combining diacritics (à→a, etc.)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

// ── POST /api/auth/signup-onboarding ─────────────────────────────────────────

onboarding.post('/signup-onboarding', async (c) => {
  const db = c.env.DB;
  const kv = c.env.TOUR_PRESETS;

  if (!db) return c.json({ error: 'Database binding unavailable.' }, 503);
  if (!kv) return c.json({ error: 'KV binding unavailable.' }, 503);

  // ── 1. Parse & validate body ──────────────────────────────────────────────
  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Request body must be valid JSON.' }, 400); }

  const { email, tenant_name, selected_template_id } = body ?? {};

  const missing = [];
  if (!email)                missing.push('email');
  if (!tenant_name)          missing.push('tenant_name');
  if (!selected_template_id) missing.push('selected_template_id');
  if (missing.length) {
    return c.json({ error: `Missing required fields: ${missing.join(', ')}.` }, 400);
  }

  const emailClean = String(email).trim().toLowerCase();
  if (!EMAIL_RE.test(emailClean)) {
    return c.json({ error: 'Invalid email address.' }, 400);
  }

  const nameClean = String(tenant_name).trim();
  if (nameClean.length < 2 || nameClean.length > 80) {
    return c.json({ error: 'tenant_name must be 2–80 characters.' }, 400);
  }

  // Sanitize template ID to prevent path traversal in R2 prefix lookup.
  const tmplId = String(selected_template_id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  if (!tmplId) {
    return c.json({ error: 'Invalid selected_template_id.' }, 400);
  }

  // ── 2. Verify template exists & is active ─────────────────────────────────
  const tmpl = await db
    .prepare('SELECT id, name FROM site_templates WHERE id = ? AND is_active = 1')
    .bind(tmplId)
    .first();
  if (!tmpl) {
    return c.json({ error: `Template "${tmplId}" not found or is inactive.` }, 400);
  }

  // ── 3. Check email uniqueness ─────────────────────────────────────────────
  const emailConflict = await db
    .prepare('SELECT id FROM tenants WHERE email = ?')
    .bind(emailClean)
    .first();
  if (emailConflict) {
    return c.json({ error: 'An account with this email already exists.' }, 409);
  }

  // ── 4. Generate IDs & resolve unique slug ─────────────────────────────────
  const tenantId = nanoid();
  const baseSlug = slugify(nameClean) || `tenant-${nanoid(8)}`;

  // Ensure slug uniqueness — append nanoid(6) on collision (extremely rare).
  const slugConflict = await db
    .prepare('SELECT id FROM tenants WHERE slug = ?')
    .bind(baseSlug)
    .first();
  const finalSlug = slugConflict ? `${baseSlug}-${nanoid(6)}` : baseSlug;

  const now = Math.floor(Date.now() / 1000);

  // ── 5. INSERT tenant ──────────────────────────────────────────────────────
  try {
    await db
      .prepare(
        `INSERT INTO tenants
           (id, slug, name, email, subscription_status, template_id, created_at)
         VALUES (?, ?, ?, ?, 'TRIAL', ?, ?)`
      )
      .bind(tenantId, finalSlug, nameClean, emailClean, tmplId, now)
      .run();
  } catch (err) {
    // [SEC] Catch UNIQUE constraint race — slug or email collision.
    if (err.message?.includes('UNIQUE')) {
      return c.json({ error: 'Account creation conflict. Please try again.' }, 409);
    }
    throw err;
  }

  // ── 6. Initialize tenant sandbox ──────────────────────────────────────────
  // initializeTenantSandbox requires the tenant row to already exist (it does
  // a SELECT to load site_config before copying template files).
  let sandbox;
  try {
    sandbox = await initializeTenantSandbox(tenantId, tmplId, c.env, db);
  } catch (sandboxErr) {
    // Sandbox init failing should not block account creation — the tenant row
    // is already committed.  Surface the error in the response so the client
    // can trigger a retry (e.g., POST /api/tenant/reinitialize-sandbox).
    console.error('[onboarding] initializeTenantSandbox failed:', sandboxErr.message);
    sandbox = { ok: false, reason: sandboxErr.message };
  }

  // ── 7. Issue setup_token (stored in KV, TTL 1 hour) ──────────────────────
  // [SEC] nanoid(32) → 32 URL-safe chars, ~192 bits entropy.
  // Token is single-use conceptually; dashboard should exchange it for a
  // proper session cookie / JWT once auth is implemented.
  const setupToken = nanoid(32);
  await kv.put(
    `setup:${setupToken}`,
    JSON.stringify({ tenant_id: tenantId, email: emailClean, created_at: now }),
    { expirationTtl: 3600 }   // 1 hour
  );

  // ── 8. Return ─────────────────────────────────────────────────────────────
  return c.json({
    ok:          true,
    tenant_id:   tenantId,
    setup_token: setupToken,
    redirect_url: `/dashboard.html?tenant=${encodeURIComponent(tenantId)}&token=${encodeURIComponent(setupToken)}`,
    tenant: {
      id:                  tenantId,
      slug:                finalSlug,
      name:                nameClean,
      email:               emailClean,
      subscription_status: 'TRIAL',
      template_id:         tmplId,
    },
    sandbox,
  }, 201);
});

// ── GET /api/auth/setup-token/:token — Verify & redeem a setup token ─────────
// Called by the dashboard on first load to confirm the token is valid and
// retrieve the associated tenant_id without exposing credentials.

onboarding.get('/setup-token/:token', async (c) => {
  const kv    = c.env.TOUR_PRESETS;
  const token = c.req.param('token');

  if (!kv)    return c.json({ error: 'KV binding unavailable.' }, 503);
  if (!token) return c.json({ error: 'Token required.' }, 400);

  const raw = await kv.get(`setup:${token}`);
  if (!raw) return c.json({ error: 'Token not found or expired.' }, 404);

  let data;
  try { data = JSON.parse(raw); }
  catch { return c.json({ error: 'Malformed token data.' }, 500); }

  return c.json({ ok: true, tenant_id: data.tenant_id, email: data.email });
});

export default function registerOnboardingRoutes(app) {
  app.route('/api/auth', onboarding);
}
