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
import { getMarketSkin, getMarketSkinCatalog, isSupportedMarketSkin } from '../lib/marketSkins.js';
import {
  EMAIL_RE,
  PASSWORD_RESET_TTL_SECONDS,
  clearAuthSessionCookie,
  consumePasswordResetToken,
  createPasswordResetToken,
  createAuthSession,
  getAuthSession,
  getPasswordResetTokenRecord,
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
const WEBHOOK_USER_AGENT = 'travel-agent-password-reset-webhook/1.0';
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const FORGOT_PASSWORD_COOLDOWN_SECONDS = 45;
const FORGOT_PASSWORD_EMAIL_WINDOW_SECONDS = 15 * 60;
const FORGOT_PASSWORD_EMAIL_WINDOW_MAX = 4;
const FORGOT_PASSWORD_IP_WINDOW_SECONDS = 15 * 60;
const FORGOT_PASSWORD_IP_WINDOW_MAX = 12;
const AUTH_ATTEMPT_RETENTION_SECONDS = 60 * 60 * 24;

const PASSWORD_RESET_EMAIL_COPY = {
  en: {
    subject: 'Reset your TravelAgent password',
    intro: 'We received a request to reset your TravelAgent password.',
    cta: 'Open the reset link below to choose a new password.',
    ignore: 'If you did not request this change, you can safely ignore this email.',
    expires: 'This reset link expires in 1 hour.',
  },
  vi: {
    subject: 'Khôi phục mật khẩu TravelAgent',
    intro: 'Chúng tôi đã nhận được yêu cầu khôi phục mật khẩu TravelAgent của bạn.',
    cta: 'Hãy mở link dưới đây để đặt mật khẩu mới.',
    ignore: 'Nếu bạn không yêu cầu thao tác này, bạn có thể bỏ qua email này.',
    expires: 'Link khôi phục này sẽ hết hạn sau 1 giờ.',
  },
  zh: {
    subject: '重置您的 TravelAgent 密码',
    intro: '我们收到了一个重置您 TravelAgent 密码的请求。',
    cta: '请打开下面的链接以设置新密码。',
    ignore: '如果这不是您发起的请求，您可以安全地忽略此邮件。',
    expires: '该重置链接将在 1 小时后失效。',
  },
};

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

function maskEmail(email) {
  const clean = normalizeEmail(email);
  const [localPart, domain = ''] = clean.split('@');
  if (!localPart || !domain) return '***';

  const visibleLocal = localPart.length <= 2
    ? `${localPart[0]}*`
    : `${localPart.slice(0, 2)}${'*'.repeat(Math.max(1, localPart.length - 2))}`;

  return `${visibleLocal}@${domain}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function resolvePasswordResetCopy(locale) {
  return PASSWORD_RESET_EMAIL_COPY[locale] || PASSWORD_RESET_EMAIL_COPY.en;
}

function getTurnstileConfig(c) {
  const siteKey = String(c.env.TURNSTILE_SITE_KEY || '').trim();
  const secretKey = String(c.env.TURNSTILE_SECRET_KEY || '').trim();
  return {
    enabled: Boolean(siteKey && secretKey),
    siteKey,
    secretKey,
  };
}

async function validateTurnstileToken(c, { token, expectedAction }) {
  const { enabled, secretKey } = getTurnstileConfig(c);
  if (!enabled) {
    return { ok: true, skipped: true };
  }

  const responseToken = String(token || '').trim();
  if (!responseToken) {
    return { ok: false, reason: 'missing-token' };
  }

  const body = new FormData();
  body.append('secret', secretKey);
  body.append('response', responseToken);

  const remoteIp = String(c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || '').trim();
  if (remoteIp) {
    body.append('remoteip', remoteIp);
  }
  body.append('idempotency_key', crypto.randomUUID());

  let result;
  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body,
    });
    result = await response.json();
    if (!response.ok) {
      return { ok: false, reason: 'verify-http', result };
    }
  } catch (error) {
    return { ok: false, reason: 'verify-network', error: String(error) };
  }

  if (!result?.success) {
    return { ok: false, reason: 'turnstile-failed', result };
  }

  if (expectedAction && result.action && result.action !== expectedAction) {
    return { ok: false, reason: 'action-mismatch', result };
  }

  const requestHost = resolveRequestHost(c);
  if (requestHost && !isLocalHost(requestHost) && result.hostname && result.hostname !== requestHost) {
    return { ok: false, reason: 'hostname-mismatch', result };
  }

  return { ok: true, result };
}

function resolveRequesterIp(c) {
  const forwarded = String(c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || '').trim();
  if (!forwarded) return '';
  return forwarded.split(',')[0].trim();
}

async function recordAuthActionAttempt(db, { action, email = null, ip = null, now = Math.floor(Date.now() / 1000) }) {
  await db.batch([
    db.prepare(
      `INSERT INTO auth_action_attempts (id, action, email, ip, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(nanoid(), action, email, ip, now),
    db.prepare('DELETE FROM auth_action_attempts WHERE created_at < ?').bind(now - AUTH_ATTEMPT_RETENTION_SECONDS),
  ]);
}

async function countAuthActionAttempts(db, { action, email = null, ip = null, since }) {
  if (email) {
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS total
           FROM auth_action_attempts
          WHERE action = ?
            AND email = ?
            AND created_at >= ?`
      )
      .bind(action, email, since)
      .first();
    return Number(row?.total || 0);
  }

  if (ip) {
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS total
           FROM auth_action_attempts
          WHERE action = ?
            AND ip = ?
            AND created_at >= ?`
      )
      .bind(action, ip, since)
      .first();
    return Number(row?.total || 0);
  }

  return 0;
}

async function shouldSoftThrottleForgotPassword(db, { email, ip, now = Math.floor(Date.now() / 1000) }) {
  const emailCooldownHits = await countAuthActionAttempts(db, {
    action: 'forgot_password',
    email,
    since: now - FORGOT_PASSWORD_COOLDOWN_SECONDS,
  });
  if (emailCooldownHits >= 1) {
    return { throttled: true, reason: 'email_cooldown' };
  }

  const emailWindowHits = await countAuthActionAttempts(db, {
    action: 'forgot_password',
    email,
    since: now - FORGOT_PASSWORD_EMAIL_WINDOW_SECONDS,
  });
  if (emailWindowHits >= FORGOT_PASSWORD_EMAIL_WINDOW_MAX) {
    return { throttled: true, reason: 'email_window' };
  }

  if (ip) {
    const ipWindowHits = await countAuthActionAttempts(db, {
      action: 'forgot_password',
      ip,
      since: now - FORGOT_PASSWORD_IP_WINDOW_SECONDS,
    });
    if (ipWindowHits >= FORGOT_PASSWORD_IP_WINDOW_MAX) {
      return { throttled: true, reason: 'ip_window' };
    }
  }

  return { throttled: false };
}

async function hmacSha256Hex(secret, payload) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function resolveRequestHost(c) {
  return String(c.req.header('Host') || c.req.header('X-Forwarded-Host') || '').trim().toLowerCase();
}

function isLocalHost(host) {
  return host.startsWith('127.0.0.1') || host.startsWith('localhost');
}

function resolveRequestOriginHint(c) {
  const originHeader = String(c.req.header('Origin') || '').trim();
  if (originHeader) {
    try {
      return new URL(originHeader).origin;
    } catch {}
  }

  const refererHeader = String(c.req.header('Referer') || '').trim();
  if (refererHeader) {
    try {
      return new URL(refererHeader).origin;
    } catch {}
  }

  return '';
}

function resolveProvidedOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    return new URL(raw).origin;
  } catch {
    return '';
  }
}

function resolvePublicOrigin(c, providedOrigin = '') {
  const fallback = String(c.env.PLATFORM_BASE_URL || '').trim();
  const explicitOrigin = resolveProvidedOrigin(providedOrigin);
  const originHint = resolveRequestOriginHint(c);
  const host = resolveRequestHost(c);

  if (explicitOrigin) {
    try {
      const explicit = new URL(explicitOrigin);
      if (isLocalHost(explicit.host)) {
        return explicit.origin;
      }
    } catch {}
  }

  if (originHint) {
    try {
      const hinted = new URL(originHint);
      if (isLocalHost(hinted.host)) {
        return hinted.origin;
      }
    } catch {}
  }

  if (isLocalHost(host)) {
    return `http://${host}`;
  }

  try {
    const url = new URL(c.req.url);
    if (isLocalHost(url.host)) {
      return url.origin;
    }
    return fallback || url.origin;
  } catch {
    return fallback || '';
  }
}

function shouldExposeDevResetLink(c, providedOrigin = '') {
  const cfConnectingIp = String(c.req.header('CF-Connecting-IP') || '').trim();
  const explicitOrigin = resolveProvidedOrigin(providedOrigin);

  if (!cfConnectingIp && explicitOrigin) {
    try {
      if (isLocalHost(new URL(explicitOrigin).host)) {
        return true;
      }
    } catch {}
  }

  const originHint = resolveRequestOriginHint(c);
  if (originHint) {
    try {
      if (isLocalHost(new URL(originHint).host)) {
        return true;
      }
    } catch {}
  }

  const host = resolveRequestHost(c);
  if (isLocalHost(host)) {
    return true;
  }

  try {
    const url = new URL(c.req.url);
    return isLocalHost(url.host);
  } catch {
    return false;
  }
}

async function dispatchPasswordResetLink(c, { email, resetUrl, expiresAt, tenantId = null, locale = 'en' }) {
  const webhookUrl = String(c.env.PASSWORD_RESET_WEBHOOK_URL || '').trim();
  const webhookSecret = String(c.env.PASSWORD_RESET_WEBHOOK_SECRET || '').trim();
  const copy = resolvePasswordResetCopy(locale);
  const eventId = crypto.randomUUID();
  const timestamp = Math.floor(Date.now() / 1000);

  const payload = {
    event: 'password_reset.requested',
    event_id: eventId,
    occurred_at: timestamp,
    tenant_id: tenantId,
    locale,
    recipient: {
      email,
    },
    reset: {
      url: resetUrl,
      expires_at: expiresAt,
    },
    email_content: {
      subject: copy.subject,
      text: `${copy.intro}\n\n${copy.cta}\n${resetUrl}\n\n${copy.expires}\n\n${copy.ignore}`,
      html: `<p>${escapeHtml(copy.intro)}</p><p>${escapeHtml(copy.cta)}</p><p><a href="${escapeHtml(resetUrl)}">${escapeHtml(resetUrl)}</a></p><p>${escapeHtml(copy.expires)}</p><p>${escapeHtml(copy.ignore)}</p>`,
    },
    source: {
      app: 'travel-agent-management',
      base_url: String(c.env.PLATFORM_BASE_URL || '').trim() || null,
    },
  };

  const payloadText = JSON.stringify(payload);

  if (webhookUrl) {
    try {
      const destinationUrl = new URL(webhookUrl);
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': WEBHOOK_USER_AGENT,
        'X-TravelAgent-Event': payload.event,
        'X-TravelAgent-Event-Id': eventId,
        'X-TravelAgent-Timestamp': String(timestamp),
      };

      destinationUrl.searchParams.set('ta_event', payload.event);
      destinationUrl.searchParams.set('ta_event_id', eventId);
      destinationUrl.searchParams.set('ta_ts', String(timestamp));

      if (webhookSecret) {
        const signature = await hmacSha256Hex(webhookSecret, `${timestamp}.${payloadText}`);
        headers['X-TravelAgent-Signature'] = `v1=${signature}`;
        destinationUrl.searchParams.set('ta_sig_v', 'v1');
        destinationUrl.searchParams.set('ta_sig', signature);
      }

      const response = await fetch(destinationUrl.toString(), {
        method: 'POST',
        headers,
        body: payloadText,
      });

      if (response.ok) {
        return { channel: 'webhook', delivered: true };
      }

      console.warn(`[password-reset] webhook delivery failed: status=${response.status}`);
    } catch (error) {
      console.warn('[password-reset] webhook delivery error:', error.message);
    }
  }

  console.info(`[PASSWORD_RESET_LINK] email=${email} reset_url=${resetUrl} expires_at=${expiresAt}`);
  return { channel: 'log_only', delivered: false };
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

async function insertTenantWithUniqueSlug(db, nameClean, emailClean, tmplId, productTierKey, marketSkinKey, now) {
  const tenantId = nanoid();
  const baseSlug = slugify(nameClean) || `tenant-${nanoid(8)}`;
  const slugConflict = await db.prepare('SELECT id FROM tenants WHERE slug = ?').bind(baseSlug).first();
  const tenantSlug = slugConflict ? `${baseSlug}-${nanoid(6)}` : baseSlug;
  const preset = getMarketSkin(marketSkinKey);

  await db
    .prepare(
      `INSERT INTO tenants
         (id, slug, name, email, subscription_status, template_id, product_tier_key, booking_currency, default_locale, market_skin_key, primary_market, created_at)
       VALUES (?, ?, ?, ?, 'TRIAL', ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(tenantId, tenantSlug, nameClean, emailClean, tmplId, productTierKey, preset.booking_currency, preset.default_locale, preset.key, preset.primary_market, now)
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

async function maybeSeedStarterContent(c, tenantId, tenantName, marketSkinKey) {
  try {
    return await bootstrapTenantStarterContent(c.env, tenantId, tenantName, { marketSkinKey });
  } catch (seedErr) {
    console.error('[onboarding] bootstrapTenantStarterContent failed:', seedErr.message);
    return { ok: false, reason: seedErr.message };
  }
}

async function finishEmailSignup(c, { db, kv, emailClean, nameClean, password, tmplId, productTierKey, marketSkinKey }) {
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
    const created = await insertTenantWithUniqueSlug(db, nameClean, emailClean, tmplId, productTierKey, marketSkinKey, now);
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
    starter_content = await maybeSeedStarterContent(c, tenantId, tenantName, marketSkinKey);
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
      market_skin_key: marketSkinKey,
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

  const turnstile = await validateTurnstileToken(c, {
    token: body?.turnstile_token,
    expectedAction: mode === 'signup' ? 'signup' : 'login',
  });
  if (!turnstile.ok) {
    return c.json({ error: 'Verification failed. Please try again.' }, 400);
  }

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

  const marketSkinKey = isSupportedMarketSkin(body?.market_skin_key)
    ? String(body.market_skin_key).trim()
    : 'global-default';

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
    const created = await insertTenantWithUniqueSlug(db, tenantNameRaw, profile.email, tmplId, productTierKey, marketSkinKey, now);
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
    starter_content = await maybeSeedStarterContent(c, tenantId, tenantName, marketSkinKey);
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
      market_skin_key: marketSkinKey,
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

  const turnstile = await validateTurnstileToken(c, {
    token: body?.turnstile_token,
    expectedAction: 'signup',
  });
  if (!turnstile.ok) {
    return c.json({ error: 'Verification failed. Please try again.' }, 400);
  }

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

  const marketSkinKey = isSupportedMarketSkin(body?.market_skin_key)
    ? String(body.market_skin_key).trim()
    : 'global-default';

  return finishEmailSignup(c, { db, kv, emailClean, nameClean, password, tmplId, productTierKey, marketSkinKey });
});

onboarding.get('/product-tiers', async (c) => {
  const lang = resolveLocaleFromAcceptLanguage(c.req.header('Accept-Language'));
  const payload = getProductTierCatalogPayload(lang);
  return c.json({ ok: true, ...payload, default_tier_key: getDefaultSignupTierKey() });
});

onboarding.get('/market-skins', async (c) => {
  const lang = resolveLocaleFromAcceptLanguage(c.req.header('Accept-Language'));
  return c.json({
    ok: true,
    market_skins: getMarketSkinCatalog(lang),
    default_market_skin_key: 'global-default',
  });
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

  const turnstile = await validateTurnstileToken(c, {
    token: body?.turnstile_token,
    expectedAction: 'login',
  });
  if (!turnstile.ok) {
    return c.json({ error: 'Verification failed. Please try again.' }, 400);
  }

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

onboarding.post('/forgot-password', async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: 'Database binding unavailable.' }, 503);

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Request body must be valid JSON.' }, 400); }

  const emailClean = normalizeEmail(body?.email);
  const returnOrigin = String(body?.return_origin || '').trim();
  const turnstileToken = String(body?.turnstile_token || '').trim();
  const requesterIp = resolveRequesterIp(c);
  if (!EMAIL_RE.test(emailClean)) {
    return c.json({ error: 'Invalid email address.' }, 400);
  }

  const turnstile = await validateTurnstileToken(c, {
    token: turnstileToken,
    expectedAction: 'forgot_password',
  });
  if (!turnstile.ok) {
    console.warn('[TURNSTILE_FORGOT_PASSWORD]', JSON.stringify({ reason: turnstile.reason, result: turnstile.result || null }));
    return c.json({ error: 'Verification failed. Please try again.' }, 400);
  }

  const callerToken = readAuthSessionToken(c);
  const callerSession = callerToken ? await getAuthSession(db, callerToken) : null;

  const genericResponse = {
    ok: true,
    message: 'If an account exists for that email, a password reset link has been prepared.',
  };

  const now = Math.floor(Date.now() / 1000);
  const throttle = await shouldSoftThrottleForgotPassword(db, {
    email: emailClean,
    ip: requesterIp,
    now,
  });
  await recordAuthActionAttempt(db, {
    action: 'forgot_password',
    email: emailClean,
    ip: requesterIp || null,
    now,
  });
  if (throttle.throttled) {
    console.info(`[FORGOT_PASSWORD_SOFT_THROTTLE] reason=${throttle.reason}`);
    return c.json(genericResponse);
  }

  const user = await fetchUserByEmail(db, emailClean);
  if (!user) {
    return c.json(genericResponse);
  }

  const membership = await getPrimaryMembership(db, user.id);
  const locale = resolveLocaleFromAcceptLanguage(c.req.header('Accept-Language'));
  const { token, expiresAt } = await createPasswordResetToken(db, {
    userId: user.id,
    tenantId: membership?.tenant_id || null,
    email: user.email,
    now,
    ttlSeconds: PASSWORD_RESET_TTL_SECONDS,
    requestedIp: requesterIp || null,
    requestedUserAgent: c.req.header('User-Agent') || null,
  });

  const publicOrigin = resolvePublicOrigin(c, returnOrigin);
  const resetUrl = `${publicOrigin}/reset-password.html?token=${encodeURIComponent(token)}`;
  const delivery = await dispatchPasswordResetLink(c, {
    email: user.email,
    resetUrl,
    expiresAt,
    tenantId: membership?.tenant_id || null,
    locale,
  });
  const response = { ...genericResponse };
  const canExposeResetLink = shouldExposeDevResetLink(c, returnOrigin)
    || normalizeEmail(callerSession?.email || '') === emailClean;

  if (canExposeResetLink) {
    response.dev_reset_url = resetUrl;
    response.delivery = delivery.channel;
    response.expires_at = expiresAt;
  }

  return c.json(response);
});

onboarding.get('/turnstile-config', async (c) => {
  const { enabled, siteKey } = getTurnstileConfig(c);
  return c.json({
    ok: true,
    login: {
      enabled,
      site_key: enabled ? siteKey : null,
      action: enabled ? 'login' : null,
    },
    signup: {
      enabled,
      site_key: enabled ? siteKey : null,
      action: enabled ? 'signup' : null,
    },
    forgot_password: {
      enabled,
      site_key: enabled ? siteKey : null,
      action: enabled ? 'forgot_password' : null,
    },
  });
});

onboarding.get('/reset-password/:token', async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: 'Database binding unavailable.' }, 503);

  const token = c.req.param('token');
  const record = await getPasswordResetTokenRecord(db, token);
  if (!record) {
    return c.json({ error: 'Reset link is invalid or expired.' }, 404);
  }

  return c.json({
    ok: true,
    email_hint: maskEmail(record.user_email || record.email),
    expires_at: record.expires_at,
  });
});

onboarding.post('/reset-password', async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: 'Database binding unavailable.' }, 503);

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Request body must be valid JSON.' }, 400); }

  const token = String(body?.token || '').trim();
  const password = String(body?.password || '');
  const passwordError = validatePassword(password);

  if (!token) {
    return c.json({ error: 'Reset token is required.' }, 400);
  }
  if (passwordError) {
    return c.json({ error: passwordError }, 400);
  }

  const record = await getPasswordResetTokenRecord(db, token);
  if (!record) {
    return c.json({ error: 'Reset link is invalid or expired.' }, 404);
  }

  const passwordHash = await hashPassword(password);
  await consumePasswordResetToken(db, {
    tokenRecordId: record.id,
    userId: record.user_id,
    passwordHash,
  });

  return c.json({
    ok: true,
    redirect_url: '/login.html?reset=1',
    email_hint: maskEmail(record.user_email || record.email),
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
