import { pbkdf2Sync } from 'node:crypto';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const SESSION_COOKIE_NAME = 'tam_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

const PASSWORD_ALGO = 'pbkdf2_sha256';
const PASSWORD_ITERATIONS = 210000;
const DERIVED_KEY_BYTES = 32;
const textEncoder = new TextEncoder();

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const clean = String(hex || '').trim();
  if (!clean || clean.length % 2 !== 0) return new Uint8Array();
  const bytes = new Uint8Array(clean.length / 2);
  for (let index = 0; index < clean.length; index += 2) {
    bytes[index / 2] = Number.parseInt(clean.slice(index, index + 2), 16);
  }
  return bytes;
}

function randomHex(byteLength) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return bytesToHex(bytes);
}

function randomToken() {
  return randomHex(32);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(String(value)));
  return bytesToHex(new Uint8Array(digest));
}

async function derivePasswordHex(password, saltHex, iterations) {
  const saltBytes = hexToBytes(saltHex);

  try {
    const baseKey = await crypto.subtle.importKey(
      'raw',
      textEncoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );

    const bits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltBytes,
        iterations,
        hash: 'SHA-256',
      },
      baseKey,
      DERIVED_KEY_BYTES * 8
    );

    return bytesToHex(new Uint8Array(bits));
  } catch {
    // Cloudflare WebCrypto currently rejects some higher PBKDF2 iteration counts.
    return bytesToHex(pbkdf2Sync(textEncoder.encode(password), saltBytes, iterations, DERIVED_KEY_BYTES, 'sha256'));
  }
}

function resolveCookieSecureFlag(c) {
  try {
    return new URL(c.req.url).protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function validatePassword(value) {
  const password = String(value || '');
  if (password.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  if (password.length > 200) {
    return 'Password is too long.';
  }
  return null;
}

export async function hashPassword(password) {
  const saltHex = randomHex(16);
  const hashHex = await derivePasswordHex(password, saltHex, PASSWORD_ITERATIONS);
  return `${PASSWORD_ALGO}$${PASSWORD_ITERATIONS}$${saltHex}$${hashHex}`;
}

export async function verifyPassword(password, storedHash) {
  const parts = String(storedHash || '').split('$');
  if (parts.length !== 4) return false;

  const [algo, iterationRaw, saltHex, expectedHex] = parts;
  const iterations = Number.parseInt(iterationRaw, 10);
  if (algo !== PASSWORD_ALGO || !Number.isFinite(iterations) || iterations < 100000) return false;

  const actualHex = await derivePasswordHex(password, saltHex, iterations);
  return actualHex === expectedHex;
}

export async function createAuthSession(db, { userId, tenantId, now = Math.floor(Date.now() / 1000), ttlSeconds = SESSION_TTL_SECONDS }) {
  const sessionId = crypto.randomUUID();
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = now + ttlSeconds;

  await db
    .prepare(
      `INSERT INTO auth_sessions
         (id, user_id, tenant_id, token_hash, created_at, expires_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(sessionId, userId, tenantId, tokenHash, now, expiresAt, now)
    .run();

  return { token, expiresAt };
}

export function setAuthSessionCookie(c, token, ttlSeconds = SESSION_TTL_SECONDS) {
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: resolveCookieSecureFlag(c),
    path: '/',
    maxAge: ttlSeconds,
  });
}

export function clearAuthSessionCookie(c) {
  deleteCookie(c, SESSION_COOKIE_NAME, {
    path: '/',
    sameSite: 'Lax',
    secure: resolveCookieSecureFlag(c),
  });
}

export function readAuthSessionToken(c) {
  const cookieToken = getCookie(c, SESSION_COOKIE_NAME);
  if (cookieToken) return cookieToken;

  const authHeader = c.req.header('Authorization') || c.req.header('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

export async function getAuthSession(db, token, now = Math.floor(Date.now() / 1000)) {
  if (!token) return null;

  const tokenHash = await sha256Hex(token);
  const session = await db
    .prepare(
      `SELECT s.id, s.user_id, s.tenant_id, s.created_at, s.expires_at, s.last_seen_at,
              u.email,
              COALESCE(m.role, 'owner') AS role,
              t.name AS tenant_name
         FROM auth_sessions s
         JOIN users u
           ON u.id = s.user_id
         LEFT JOIN memberships m
           ON m.user_id = s.user_id
          AND m.tenant_id = s.tenant_id
         LEFT JOIN tenants t
           ON t.id = s.tenant_id
        WHERE s.token_hash = ?
          AND s.expires_at > ?
        LIMIT 1`
    )
    .bind(tokenHash, now)
    .first();

  if (!session) return null;

  await db
    .prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?')
    .bind(now, session.id)
    .run();

  return session;
}

export async function getPrimaryMembership(db, userId) {
  if (!userId) return null;
  return db
    .prepare(
      `SELECT m.tenant_id, m.role, t.name AS tenant_name, t.slug AS tenant_slug
         FROM memberships m
         JOIN tenants t
           ON t.id = m.tenant_id
        WHERE m.user_id = ?
        ORDER BY CASE m.role
          WHEN 'owner' THEN 0
          WHEN 'manager' THEN 1
          WHEN 'staff' THEN 2
          ELSE 3
        END,
        t.created_at ASC
        LIMIT 1`
    )
    .bind(userId)
    .first();
}

export async function resolveLegacyTenantByEmail(db, email) {
  return db
    .prepare(
      `SELECT t.id, t.slug, t.name, t.email, t.created_at, t.subscription_status, t.template_id
         FROM tenants t
        WHERE t.email = ?
          AND NOT EXISTS (
            SELECT 1
              FROM memberships m
             WHERE m.tenant_id = t.id
          )
        LIMIT 1`
    )
    .bind(email)
    .first();
}

export async function verifyGoogleIdToken(idToken, expectedAudience = '') {
  const token = String(idToken || '').trim();
  if (!token) {
    throw new Error('Google credential is required.');
  }

  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
  if (!response.ok) {
    throw new Error('Google token verification failed.');
  }

  const payload = await response.json();
  const issuer = payload.iss || '';
  if (issuer !== 'accounts.google.com' && issuer !== 'https://accounts.google.com') {
    throw new Error('Unexpected Google token issuer.');
  }
  if (expectedAudience && payload.aud !== expectedAudience) {
    throw new Error('Google token audience mismatch.');
  }
  if (payload.email_verified !== 'true') {
    throw new Error('Google account email is not verified.');
  }
  if (!EMAIL_RE.test(normalizeEmail(payload.email))) {
    throw new Error('Google account email is invalid.');
  }

  return {
    sub: String(payload.sub || '').trim(),
    email: normalizeEmail(payload.email),
    name: String(payload.name || '').trim(),
    picture: String(payload.picture || '').trim(),
  };
}