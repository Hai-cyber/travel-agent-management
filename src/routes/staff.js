/**
 * CHK-R107: Staff invite flow API
 *
 * Routes:
 *   POST   /api/staff/invite          — owner/manager invites a new team member by email
 *   GET    /api/staff/invite/verify   — public: validate invite token, return email+role
 *   POST   /api/staff/invite/accept   — public: accept invite, set password, join tenant
 *   GET    /api/staff                 — list current team members for a tenant
 *   PATCH  /api/staff/:userId         — update role of a team member
 *   DELETE /api/staff/:userId         — remove a team member from the tenant
 */

import { nanoid } from 'nanoid';
import {
  readAuthSessionToken,
  getAuthSession,
  clearAuthSessionCookie,
  hashPassword,
  sha256Token,
  createOpaqueToken,
  EMAIL_RE,
} from '../lib/auth.js';

const INVITE_TTL_SECONDS = 72 * 60 * 60; // 72 hours
const ALLOWED_ROLES = new Set(['manager', 'staff', 'provider']);
const ALLOWED_PATCH_ROLES = new Set(['manager', 'staff', 'provider']);

// Maximum number of non-owner members allowed per tier (owner does not count against limit)
const TIER_TEAM_LIMITS = {
  starter_landing: 0,   // owner only — no additional members
  starter:         2,
  growth:          10,
  pro:             25,
  enterprise:      999,
};
const DEFAULT_TEAM_LIMIT = 0; // unknown tiers default to most restrictive

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

// ── Email helper ──────────────────────────────────────────────────────────────

async function dispatchInviteEmail(env, { recipientEmail, inviteUrl, tenantName, inviterName, role, expiresAt }) {
  const webhookUrl = String(env.PASSWORD_RESET_WEBHOOK_URL || '').trim();
  const webhookSecret = String(env.PASSWORD_RESET_WEBHOOK_SECRET || '').trim();

  const roleLabel = role === 'manager' ? 'Manager' : role === 'provider' ? 'Provider' : 'Staff';
  const subject = `You're invited to join ${tenantName} as ${roleLabel}`;
  const text = `Hi,\n\nYou have been invited to join ${tenantName} on the Tours platform as ${roleLabel}.\n\nAccept your invitation here:\n${inviteUrl}\n\nThis link expires in 72 hours.\n\nIf you did not expect this invitation, you can ignore this email.`;
  const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
<h2 style="color:#0f172a">You're invited to join ${htmlEsc(tenantName)}</h2>
<p style="color:#475569">Hello,</p>
<p style="color:#475569"><strong>${htmlEsc(inviterName)}</strong> has invited you to join <strong>${htmlEsc(tenantName)}</strong> as <strong>${htmlEsc(roleLabel)}</strong>.</p>
<p style="margin:24px 0"><a href="${htmlEsc(inviteUrl)}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">Accept Invitation</a></p>
<p style="color:#94a3b8;font-size:13px">Or copy this link: ${htmlEsc(inviteUrl)}</p>
<p style="color:#94a3b8;font-size:13px">This invitation expires in 72 hours. If you did not expect this email, you can safely ignore it.</p>
</div>`;

  if (!webhookUrl) {
    console.info(`[STAFF_INVITE] webhook not configured — invite_url=${inviteUrl}`);
    return { delivered: false };
  }

  const eventId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    event: 'staff.invited',
    event_id: eventId,
    occurred_at: now,
    tenant_id: null,
    locale: 'en',
    recipient: { email: recipientEmail },
    email_content: { subject, text, html },
    invite: { url: inviteUrl, expires_at: expiresAt, role, tenant_name: tenantName },
    source: { app: 'travel-agent-management', base_url: String(env.PLATFORM_BASE_URL || '').trim() || null },
  };

  try {
    const headers = {
      'Content-Type': 'application/json',
      'X-TravelAgent-Event': payload.event,
      'X-TravelAgent-Event-Id': eventId,
    };
    if (webhookSecret) {
      // sign: timestamp.payload
      const sig = await hmacSha256Hex(webhookSecret, `${now}.${JSON.stringify(payload)}`);
      headers['X-TravelAgent-Signature'] = `v1=${sig}`;
    }
    const resp = await fetch(webhookUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
    if (resp.ok) return { delivered: true };
    console.warn(`[STAFF_INVITE] webhook status=${resp.status}`);
    return { delivered: false };
  } catch (err) {
    console.warn('[STAFF_INVITE] webhook error:', err.message);
    return { delivered: false };
  }
}

function htmlEsc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Routes ────────────────────────────────────────────────────────────────────

export default function registerStaffRoutes(app) {
  // POST /api/staff/invite — send invite
  app.post('/api/staff/invite', async (c) => {
    const tenantId = c.req.header('X-Tenant-ID')?.trim();
    if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

    const { session, error } = await requireTenantSession(c, tenantId);
    if (error) return error;

    if (!['owner', 'manager'].includes(session.role)) {
      return c.json({ error: 'Only owners and managers can invite staff.' }, 403);
    }

    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Request body required.' }, 400);

    const email = String(body.email || '').trim().toLowerCase();
    const role = String(body.role || 'staff').trim();

    if (!email || !EMAIL_RE.test(email)) return c.json({ error: 'Valid email is required.' }, 400);
    if (!ALLOWED_ROLES.has(role)) return c.json({ error: 'role must be manager, staff, or provider.' }, 400);

    const db = c.env.DB;
    const now = Math.floor(Date.now() / 1000);

    // Enforce team size limit for tenant's subscription tier
    const tenantRow = await db.prepare('SELECT product_tier_key FROM tenants WHERE id = ?').bind(tenantId).first();
    const tierKey = tenantRow?.product_tier_key ?? '';
    const teamLimit = TIER_TEAM_LIMITS[tierKey] ?? DEFAULT_TEAM_LIMIT;
    const { count: currentNonOwnerCount } = await db.prepare(
      `SELECT COUNT(*) AS count FROM memberships WHERE tenant_id = ? AND role != 'owner'`
    ).bind(tenantId).first() ?? { count: 0 };
    if (currentNonOwnerCount >= teamLimit) {
      return c.json({
        error: 'Team member limit reached for your current plan. Upgrade to add more members.',
        upgrade_required: true,
        current_tier: tierKey,
        team_limit: teamLimit,
      }, 403);
    }

    // Check if user is already a member
    const existing = await db.prepare(
      `SELECT m.role FROM memberships m
       INNER JOIN users u ON u.id = m.user_id
       WHERE m.tenant_id = ? AND u.email = ?`
    ).bind(tenantId, email).first();

    if (existing) {
      return c.json({ error: 'This email is already a team member.' }, 409);
    }

    // Check for a live (non-expired, non-accepted) pending invite
    const pendingInvite = await db.prepare(
      `SELECT id FROM staff_invites
       WHERE tenant_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?`
    ).bind(tenantId, email, now).first();

    if (pendingInvite) {
      return c.json({ error: 'A pending invite already exists for this email. Revoke it first or wait for expiry.' }, 409);
    }

    // Get tenant name for the email
    const tenant = await db.prepare('SELECT name FROM tenants WHERE id = ?').bind(tenantId).first();
    const tenantName = tenant?.name || tenantId;

    // Get inviter display name
    const inviter = await db.prepare('SELECT email FROM users WHERE id = ?').bind(session.user_id).first();
    const inviterName = inviter?.email || 'Your team';

    // Generate invite token
    const rawToken = createOpaqueToken();
    const tokenHash = await sha256Token(rawToken);
    const inviteId = nanoid();
    const expiresAt = now + INVITE_TTL_SECONDS;

    await db.prepare(
      `INSERT INTO staff_invites (id, tenant_id, email, role, token_hash, invited_by, invited_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(inviteId, tenantId, email, role, tokenHash, session.user_id, now, expiresAt).run();

    // Build invite URL
    const baseUrl = String(c.env.PLATFORM_BASE_URL || '').trim() || `https://${c.req.header('host')}`;
    const inviteUrl = `${baseUrl}/staff-accept.html?token=${rawToken}`;

    await dispatchInviteEmail(c.env, {
      recipientEmail: email,
      inviteUrl,
      tenantName,
      inviterName,
      role,
      expiresAt,
    });

    return c.json({ ok: true, invite_id: inviteId, expires_at: expiresAt });
  });

  // GET /api/staff/invite/verify?token=XXX — validate token (public)
  app.get('/api/staff/invite/verify', async (c) => {
    const rawToken = c.req.query('token')?.trim();
    if (!rawToken) return c.json({ error: 'token query parameter is required.' }, 400);

    const tokenHash = await sha256Token(rawToken);
    const now = Math.floor(Date.now() / 1000);

    const invite = await c.env.DB.prepare(
      `SELECT si.id, si.tenant_id, si.email, si.role, si.expires_at,
              t.name AS tenant_name
       FROM staff_invites si
       INNER JOIN tenants t ON t.id = si.tenant_id
       WHERE si.token_hash = ?
         AND si.accepted_at IS NULL
         AND si.revoked_at IS NULL
         AND si.expires_at > ?`
    ).bind(tokenHash, now).first();

    if (!invite) {
      return c.json({ error: 'Invite not found, expired, or already used.' }, 404);
    }

    return c.json({
      ok: true,
      email: invite.email,
      role: invite.role,
      tenant_name: invite.tenant_name,
      expires_at: invite.expires_at,
    });
  });

  // POST /api/staff/invite/accept — accept invite, set password, join tenant (public)
  app.post('/api/staff/invite/accept', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Request body required.' }, 400);

    const rawToken = String(body.token || '').trim();
    const password = String(body.password || '').trim();

    if (!rawToken) return c.json({ error: 'token is required.' }, 400);
    if (!password || password.length < 8) return c.json({ error: 'password must be at least 8 characters.' }, 400);

    const tokenHash = await sha256Token(rawToken);
    const now = Math.floor(Date.now() / 1000);
    const db = c.env.DB;

    const invite = await db.prepare(
      `SELECT id, tenant_id, email, role FROM staff_invites
       WHERE token_hash = ?
         AND accepted_at IS NULL
         AND revoked_at IS NULL
         AND expires_at > ?`
    ).bind(tokenHash, now).first();

    if (!invite) {
      return c.json({ error: 'Invite not found, expired, or already used.' }, 404);
    }

    // Find or create user
    const existingUser = await db.prepare('SELECT id FROM users WHERE email = ?').bind(invite.email).first();
    const userId = existingUser?.id || nanoid();

    const passwordHash = await hashPassword(password);

    if (existingUser) {
      // Update their password hash (they're joining a new tenant)
      await db.prepare('UPDATE users SET hash = ? WHERE id = ?').bind(passwordHash, userId).run();
    } else {
      await db.prepare('INSERT INTO users (id, email, hash, created_at) VALUES (?, ?, ?, ?)')
        .bind(userId, invite.email, passwordHash, now).run();
    }

    // Check if membership already exists (edge case)
    const existingMembership = await db.prepare(
      'SELECT user_id FROM memberships WHERE user_id = ? AND tenant_id = ?'
    ).bind(userId, invite.tenant_id).first();

    if (!existingMembership) {
      await db.prepare('INSERT INTO memberships (user_id, tenant_id, role) VALUES (?, ?, ?)')
        .bind(userId, invite.tenant_id, invite.role).run();
    }

    // Mark invite as accepted
    await db.prepare('UPDATE staff_invites SET accepted_at = ? WHERE id = ?')
      .bind(now, invite.id).run();

    return c.json({ ok: true, message: 'Invitation accepted. You can now log in.' });
  });

  // GET /api/staff — list team members
  app.get('/api/staff', async (c) => {
    const tenantId = c.req.header('X-Tenant-ID')?.trim();
    if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

    const { session, error } = await requireTenantSession(c, tenantId);
    if (error) return error;

    if (!['owner', 'manager', 'staff'].includes(session.role)) {
      return c.json({ error: 'Forbidden.' }, 403);
    }

    const db = c.env.DB;

    const members = await db.prepare(
      `SELECT u.id, u.email, m.role, m.rowid AS membership_rowid
       FROM memberships m
       INNER JOIN users u ON u.id = m.user_id
       WHERE m.tenant_id = ?
       ORDER BY m.role, u.email`
    ).bind(tenantId).all();

    // Also fetch pending invites
    const now = Math.floor(Date.now() / 1000);
    const pendingInvites = await db.prepare(
      `SELECT id, email, role, invited_at, expires_at
       FROM staff_invites
       WHERE tenant_id = ?
         AND accepted_at IS NULL
         AND revoked_at IS NULL
         AND expires_at > ?
       ORDER BY invited_at DESC`
    ).bind(tenantId, now).all();

    // Include tier limit info so UI can show upgrade prompts
    const tenantRow = await db.prepare('SELECT product_tier_key FROM tenants WHERE id = ?').bind(tenantId).first();
    const tierKey = tenantRow?.product_tier_key ?? '';
    const teamLimit = TIER_TEAM_LIMITS[tierKey] ?? DEFAULT_TEAM_LIMIT;

    return c.json({
      members: members.results ?? [],
      pending_invites: pendingInvites.results ?? [],
      tier: { key: tierKey, team_limit: teamLimit },
    });
  });

  // PATCH /api/staff/:userId — update role
  app.patch('/api/staff/:userId', async (c) => {
    const tenantId = c.req.header('X-Tenant-ID')?.trim();
    if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

    const { session, error } = await requireTenantSession(c, tenantId);
    if (error) return error;

    if (!['owner', 'manager'].includes(session.role)) {
      return c.json({ error: 'Only owners and managers can change roles.' }, 403);
    }

    const targetUserId = c.req.param('userId');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Request body required.' }, 400);

    const role = String(body.role || '').trim();
    if (!ALLOWED_PATCH_ROLES.has(role)) return c.json({ error: 'role must be manager, staff, or provider.' }, 400);

    // Prevent changing owner's role
    const targetMembership = await c.env.DB.prepare(
      'SELECT role FROM memberships WHERE user_id = ? AND tenant_id = ?'
    ).bind(targetUserId, tenantId).first();

    if (!targetMembership) return c.json({ error: 'Team member not found.' }, 404);
    if (targetMembership.role === 'owner') return c.json({ error: 'Cannot change role of the tenant owner.' }, 403);

    await c.env.DB.prepare(
      'UPDATE memberships SET role = ? WHERE user_id = ? AND tenant_id = ?'
    ).bind(role, targetUserId, tenantId).run();

    return c.json({ ok: true });
  });

  // DELETE /api/staff/:userId — remove from tenant
  app.delete('/api/staff/:userId', async (c) => {
    const tenantId = c.req.header('X-Tenant-ID')?.trim();
    if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

    const { session, error } = await requireTenantSession(c, tenantId);
    if (error) return error;

    if (!['owner', 'manager'].includes(session.role)) {
      return c.json({ error: 'Only owners and managers can remove team members.' }, 403);
    }

    const targetUserId = c.req.param('userId');

    // Prevent removing owner
    const targetMembership = await c.env.DB.prepare(
      'SELECT role FROM memberships WHERE user_id = ? AND tenant_id = ?'
    ).bind(targetUserId, tenantId).first();

    if (!targetMembership) return c.json({ error: 'Team member not found.' }, 404);
    if (targetMembership.role === 'owner') return c.json({ error: 'Cannot remove the tenant owner.' }, 403);
    if (targetUserId === session.user_id) return c.json({ error: 'Cannot remove yourself.' }, 403);

    await c.env.DB.prepare(
      'DELETE FROM memberships WHERE user_id = ? AND tenant_id = ?'
    ).bind(targetUserId, tenantId).run();

    return c.json({ ok: true });
  });

  // DELETE /api/staff/invites/:inviteId — revoke a pending invite
  app.delete('/api/staff/invites/:inviteId', async (c) => {
    const tenantId = c.req.header('X-Tenant-ID')?.trim();
    if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

    const { session, error } = await requireTenantSession(c, tenantId);
    if (error) return error;

    if (!['owner', 'manager'].includes(session.role)) {
      return c.json({ error: 'Only owners and managers can revoke invites.' }, 403);
    }

    const inviteId = c.req.param('inviteId');
    const now = Math.floor(Date.now() / 1000);

    const invite = await c.env.DB.prepare(
      'SELECT id FROM staff_invites WHERE id = ? AND tenant_id = ? AND accepted_at IS NULL AND revoked_at IS NULL'
    ).bind(inviteId, tenantId).first();

    if (!invite) return c.json({ error: 'Invite not found or already used/revoked.' }, 404);

    await c.env.DB.prepare(
      'UPDATE staff_invites SET revoked_at = ? WHERE id = ?'
    ).bind(now, inviteId).run();

    return c.json({ ok: true });
  });
}
