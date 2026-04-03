/**
 * src/routes/onboarding.js
 *
 * Public signup + login flow.
 *
 * Supports:
 *   - email signup with password
 *   - email login with password
 *   - Google signup/login with ID token verification
 *   - httpOnly cookie sessions backed by D1 auth_sessions
 *   - legacy setup-token compatibility for earlier signup redirects
 */

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { initializeTenantSandbox } from '../lib/siteStudio.js';
import { bootstrapTenantStarterContent } from '../lib/tenantBootstrap.js';
import { resolveLocaleFromAcceptLanguage } from '../utils/formatter.js';
import {
  getDefaultSignupTierKey,
  getProductTierCatalogPayload,
  resolveSignupTierKey,
} from '../lib/productTiers.js';
import {
  EMAIL_RE,
  clearAuthSessionCookie,
  createAuthSession,
  getAuthSession,
  getPrimaryMembership,
  hashPassword,
  normalizeEmail,
  readAuthSessionToken,
  resolveLegacyTenantByEmail,
  setAuthSessionCookie,
  validatePassword,
  verifyGoogleIdToken,
  verifyPassword,
} from '../lib/auth.js';

const onboarding = new Hono();
const SIGNUP_GUIDED_DASHBOARD_URL = '/dashboard.html?welcome=1&step=subdomain';

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

async function ensureTemplateExists(db, templateId) {
  if (!templateId) return null;

  const cleanId = String(templateId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  if (!cleanId) {
    throw new Error('Invalid selected_template_id.');
  }

  const template = await db
    .prepare('SELECT id FROM site_templates WHERE id = ? AND is_active = 1')
    .bind(cleanId)
    .first();

  if (!template) {
    throw new Error(`Template "${cleanId}" not found or is inactive.`);
  }

  return cleanId;
}

async function createSetupToken(kv, tenantId, emailClean, now) {
  const setupToken = nanoid(32);
  await kv.put(
    `setup:${setupToken}`,
    JSON.stringify({ tenant_id: tenantId, email: emailClean, created_at: now }),
    { expirationTtl: 3600 }
  );
  return setupToken;
}

async function startSession(c, db, userId, tenantId) {
  const session = await createAuthSession(db, { userId, tenantId });
  setAuthSessionCookie(c, session.token);
  return session;
}

async function fetchUserByEmail(db, emailClean) {
  return db
    .prepare(
      `SELECT u.id, u.email, u.hash, u.google_sub,
              EXISTS(
                SELECT 1
                  FROM memberships m
                 WHERE m.user_id = u.id
              ) AS has_memberships
         FROM users u
        WHERE u.email = ?
        LIMIT 1`
    )
    .bind(emailClean)
    .first();
}

async function fetchUserByGoogleOrEmail(db, googleSub, emailClean) {
  return db
    .prepare(
      `SELECT u.id, u.email, u.hash, u.google_sub,
              EXISTS(
                SELECT 1
                  FROM memberships m
                 WHERE m.user_id = u.id
              ) AS has_memberships
         FROM users u
        WHERE u.google_sub = ? OR u.email = ?
        ORDER BY CASE WHEN u.google_sub = ? THEN 0 ELSE 1 END
        LIMIT 1`
    )
    .bind(googleSub, emailClean, googleSub)
    .first();
}

async function insertTenantWithUniqueSlug(db, nameClean, emailClean, tmplId, productTierKey, now) {
  const tenantId = nanoid();
  const baseSlug = slugify(nameClean) || `tenant-${nanoid(8)}`;
  const slugConflict = await db.prepare('SELECT id FROM tenants WHERE slug = ?').bind(baseSlug).first();
  const tenantSlug = slugConflict ? `${baseSlug}-${nanoid(6)}` : baseSlug;

  await db
    .prepare(
      `INSERT INTO tenants
         (id, slug, name, email, subscription_status, template_id, product_tier_key, created_at)
       VALUES (?, ?, ?, ?, 'TRIAL', ?, ?, ?)`
    )
    .bind(tenantId, tenantSlug, nameClean, emailClean, tmplId, productTierKey, now)
    .run();

  return { tenantId, tenantSlug, tenantName: nameClean };
}

async function maybeInitializeSandbox(c, tenantId, tmplId) {
  if (!tmplId) {
    return { ok: true, skipped: true, reason: 'template_deferred' };
  }

  try {
    return await initializeTenantSandbox(tenantId, tmplId, c.env, c.env.DB);
  } catch (sandboxErr) {
    console.error('[onboarding] initializeTenantSandbox failed:', sandboxErr.message);
    return { ok: false, reason: sandboxErr.message };
  }
}

async function maybeSeedStarterContent(c, tenantId, tenantName) {
  try {
    return await bootstrapTenantStarterContent(c.env, tenantId, tenantName);
  } catch (seedErr) {
    console.error('[onboarding] bootstrapTenantStarterContent failed:', seedErr.message);
    return { ok: false, reason: seedErr.message };
  }
}

async function finishEmailSignup(c, { db, kv, emailClean, nameClean, password, tmplId, productTierKey }) {
  const now = Math.floor(Date.now() / 1000);
  const existingUser = await fetchUserByEmail(db, emailClean);
  const legacyTenant = await resolveLegacyTenantByEmail(db, emailClean);

  if (existingUser && !legacyTenant) {
    return c.json({ error: 'An account with this email already exists. Please log in instead.' }, 409);
  }

  let tenantId;
  let tenantSlug;
  let tenantName;
  let sandbox;
  let starter_content = { ok: true, skipped: true, reason: 'existing_tenant_attached' };
  let createdNewTenant = false;

  if (legacyTenant) {
    tenantId = legacyTenant.id;
    tenantSlug = legacyTenant.slug;
    tenantName = legacyTenant.name;
    sandbox = { ok: true, skipped: true, reason: 'legacy_tenant_attached' };
  } else {
    createdNewTenant = true;
    const created = await insertTenantWithUniqueSlug(db, nameClean, emailClean, tmplId, productTierKey, now);
    tenantId = created.tenantId;
    tenantSlug = created.tenantSlug;
    tenantName = created.tenantName;
  }

  const userId = existingUser?.id || nanoid();
  const passwordHash = await hashPassword(password);

  try {
    const statements = [];
    if (existingUser) {
      statements.push(db.prepare('UPDATE users SET hash = ? WHERE id = ?').bind(passwordHash, userId));
    } else {
      statements.push(
        db.prepare('INSERT INTO users (id, email, hash, created_at) VALUES (?, ?, ?, ?)')
          .bind(userId, emailClean, passwordHash, now)
      );
    }
    statements.push(
      db.prepare('INSERT INTO memberships (user_id, tenant_id, role) VALUES (?, ?, ?)')
        .bind(userId, tenantId, 'owner')
    );
    await db.batch(statements);
  } catch (err) {
    if (err.message?.includes('UNIQUE')) {
      return c.json({ error: 'Account creation conflict. Please try again.' }, 409);
    }
    throw err;
  }

  if (createdNewTenant) {
    sandbox = await maybeInitializeSandbox(c, tenantId, tmplId);
    starter_content = await maybeSeedStarterContent(c, tenantId, tenantName);
  }

  const setupToken = await createSetupToken(kv, tenantId, emailClean, now);
  await startSession(c, db, userId, tenantId);

  return c.json({
    ok: true,
    tenant_id: tenantId,
    setup_token: setupToken,
    redirect_url: SIGNUP_GUIDED_DASHBOARD_URL,
    tenant: {
      id: tenantId,
      slug: tenantSlug,
      name: tenantName,
      email: emailClean,
      subscription_status: 'TRIAL',
      template_id: tmplId,
      product_tier_key: productTierKey,
    },
    sandbox,
    starter_content,
  }, createdNewTenant ? 201 : 200);
}

async function finishGoogleAuth(c, { mode }) {
  const db = c.env.DB;
  const kv = c.env.TOUR_PRESETS;

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Request body must be valid JSON.' }, 400); }

  const tenantNameRaw = String(body?.tenant_name || '').trim();
  if (mode === 'signup' && (tenantNameRaw.length < 2 || tenantNameRaw.length > 80)) {
    return c.json({ error: 'tenant_name must be 2–80 characters.' }, 400);
  }

  let tmplId = null;
  try {
    tmplId = await ensureTemplateExists(db, body?.selected_template_id);
  } catch (err) {
    return c.json({ error: err.message || 'Invalid selected_template_id.' }, 400);
  }

  const productTierKey = resolveSignupTierKey(body?.product_tier_key);
  if (!productTierKey) {
    return c.json({ error: 'Invalid or unavailable product_tier_key.' }, 400);
  }

  const profile = await verifyGoogleIdToken(body?.id_token, c.env.GOOGLE_CLIENT_ID || '');
  const now = Math.floor(Date.now() / 1000);
  const legacyTenant = await resolveLegacyTenantByEmail(db, profile.email);
  const existingUser = await fetchUserByGoogleOrEmail(db, profile.sub, profile.email);

  if (mode === 'signup' && existingUser && !legacyTenant) {
    return c.json({ error: 'An account with this Google email already exists. Please log in instead.' }, 409);
  }

  if (mode === 'login' && !existingUser && !legacyTenant) {
    return c.json({ error: 'No account found for this Google email. Please sign up first.' }, 404);
  }

  let tenantId = legacyTenant?.id || null;
  let tenantSlug = legacyTenant?.slug || null;
  let tenantName = legacyTenant?.name || null;
  let sandbox = { ok: true, skipped: true, reason: 'login_existing_tenant' };
  let starter_content = { ok: true, skipped: true, reason: 'login_existing_tenant' };
  let createdNewTenant = false;

  if (!tenantId && mode === 'signup') {
    createdNewTenant = true;
    const created = await insertTenantWithUniqueSlug(db, tenantNameRaw, profile.email, tmplId, productTierKey, now);
    tenantId = created.tenantId;
    tenantSlug = created.tenantSlug;
    tenantName = created.tenantName;
  }

  const userId = existingUser?.id || nanoid();

  try {
    const statements = [];
    if (!existingUser) {
      statements.push(
        db.prepare('INSERT INTO users (id, email, hash, google_sub, created_at) VALUES (?, ?, NULL, ?, ?)')
          .bind(userId, profile.email, profile.sub, now)
      );
    } else if (!existingUser.google_sub) {
      statements.push(
        db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').bind(profile.sub, userId)
      );
    }

    const membership = existingUser ? await getPrimaryMembership(db, userId) : null;
    if (!membership) {
      if (!tenantId) {
        return c.json({ error: 'No tenant found for this Google account. Please sign up first.' }, 404);
      }
      statements.push(
        db.prepare('INSERT INTO memberships (user_id, tenant_id, role) VALUES (?, ?, ?)')
          .bind(userId, tenantId, 'owner')
      );
    } else {
      tenantId = membership.tenant_id;
      tenantSlug = membership.tenant_slug;
      tenantName = membership.tenant_name;
    }

    if (statements.length) {
      await db.batch(statements);
    }
  } catch (err) {
    if (err.message?.includes('UNIQUE')) {
      return c.json({ error: 'Google account conflict. Please try logging in instead.' }, 409);
    }
    throw err;
  }

  if (createdNewTenant) {
    sandbox = await maybeInitializeSandbox(c, tenantId, tmplId);
    starter_content = await maybeSeedStarterContent(c, tenantId, tenantName);
  }

  const setupToken = await createSetupToken(kv, tenantId, profile.email, now);
  await startSession(c, db, userId, tenantId);

  return c.json({
    ok: true,
    tenant_id: tenantId,
    setup_token: setupToken,
    redirect_url: SIGNUP_GUIDED_DASHBOARD_URL,
    tenant: {
      id: tenantId,
      slug: tenantSlug,
      name: tenantName,
      email: profile.email,
      product_tier_key: productTierKey,
    },
    sandbox,
    starter_content,
    user: {
      email: profile.email,
      google_sub: profile.sub,
      name: profile.name,
      picture: profile.picture,
    },
  }, createdNewTenant ? 201 : 200);
}

onboarding.post('/signup-onboarding', async (c) => {
  const db = c.env.DB;
  const kv = c.env.TOUR_PRESETS;

  if (!db) return c.json({ error: 'Database binding unavailable.' }, 503);
  if (!kv) return c.json({ error: 'KV binding unavailable.' }, 503);

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Request body must be valid JSON.' }, 400); }

  const { email, tenant_name, selected_template_id, password } = body ?? {};

  const missing = [];
  if (!email) missing.push('email');
  if (!tenant_name) missing.push('tenant_name');
  if (!password) missing.push('password');
  if (missing.length) {
    return c.json({ error: `Missing required fields: ${missing.join(', ')}.` }, 400);
  }

  const emailClean = normalizeEmail(email);
  if (!EMAIL_RE.test(emailClean)) {
    return c.json({ error: 'Invalid email address.' }, 400);
  }

  const nameClean = String(tenant_name).trim();
  if (nameClean.length < 2 || nameClean.length > 80) {
    return c.json({ error: 'tenant_name must be 2–80 characters.' }, 400);
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    return c.json({ error: passwordError }, 400);
  }

  let tmplId = null;
  try {
    tmplId = await ensureTemplateExists(db, selected_template_id);
  } catch (err) {
    return c.json({ error: err.message || 'Invalid selected_template_id.' }, 400);
  }

  const productTierKey = resolveSignupTierKey(body?.product_tier_key);
  if (!productTierKey) {
    return c.json({ error: 'Invalid or unavailable product_tier_key.' }, 400);
  }

  return finishEmailSignup(c, { db, kv, emailClean, nameClean, password, tmplId, productTierKey });
});

onboarding.get('/product-tiers', async (c) => {
  const lang = resolveLocaleFromAcceptLanguage(c.req.header('Accept-Language'));
  const payload = getProductTierCatalogPayload(lang);
  return c.json({ ok: true, ...payload, default_tier_key: getDefaultSignupTierKey() });
});

onboarding.post('/signup-google', async (c) => {
  try {
    return await finishGoogleAuth(c, { mode: 'signup' });
  } catch (err) {
    return c.json({ error: err.message || 'Google signup failed.' }, 400);
  }
});

onboarding.post('/login', async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: 'Database binding unavailable.' }, 503);

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Request body must be valid JSON.' }, 400); }

  const emailClean = normalizeEmail(body?.email);
  const password = String(body?.password || '');

  if (!EMAIL_RE.test(emailClean)) {
    return c.json({ error: 'Invalid email address.' }, 400);
  }
  if (!password) {
    return c.json({ error: 'Password is required.' }, 400);
  }

  const user = await fetchUserByEmail(db, emailClean);
  if (!user) {
    return c.json({ error: 'Invalid email or password.' }, 401);
  }
  if (!user.hash) {
    return c.json({ error: 'This account does not have an email password yet. Please use Google sign-in or sign up again to set one.' }, 400);
  }

  const passwordValid = await verifyPassword(password, user.hash);
  if (!passwordValid) {
    return c.json({ error: 'Invalid email or password.' }, 401);
  }

  const membership = await getPrimaryMembership(db, user.id);
  if (!membership) {
    return c.json({ error: 'This account is not attached to a tenant yet.' }, 409);
  }

  await startSession(c, db, user.id, membership.tenant_id);
  return c.json({
    ok: true,
    redirect_url: '/dashboard.html',
    tenant_id: membership.tenant_id,
    tenant: {
      id: membership.tenant_id,
      name: membership.tenant_name,
      slug: membership.tenant_slug,
    },
    user: {
      email: user.email,
    },
  });
});

onboarding.post('/google', async (c) => {
  try {
    return await finishGoogleAuth(c, { mode: 'login' });
  } catch (err) {
    return c.json({ error: err.message || 'Google login failed.' }, 400);
  }
});

onboarding.get('/google/config', async (c) => {
  const clientId = String(c.env.GOOGLE_CLIENT_ID || '').trim();
  return c.json({ ok: true, enabled: Boolean(clientId), client_id: clientId || null });
});

onboarding.get('/session', async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: 'Database binding unavailable.' }, 503);

  const token = readAuthSessionToken(c);
  const session = await getAuthSession(db, token);
  if (!session) {
    clearAuthSessionCookie(c);
    return c.json({ ok: true, authenticated: false });
  }

  return c.json({
    ok: true,
    authenticated: true,
    session: {
      user_id: session.user_id,
      email: session.email,
      tenant_id: session.tenant_id,
      tenant_name: session.tenant_name,
      role: session.role,
      expires_at: session.expires_at,
    },
  });
});

onboarding.post('/logout', async (c) => {
  const db = c.env.DB;
  if (db) {
    const token = readAuthSessionToken(c);
    const session = await getAuthSession(db, token);
    if (session) {
      await db.prepare('DELETE FROM auth_sessions WHERE id = ?').bind(session.id).run();
    }
  }

  clearAuthSessionCookie(c);
  return c.json({ ok: true });
});

onboarding.get('/setup-token/:token', async (c) => {
  const kv = c.env.TOUR_PRESETS;
  const token = c.req.param('token');

  if (!kv) return c.json({ error: 'KV binding unavailable.' }, 503);
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
