import { Hono } from 'hono';
import { clearAuthSessionCookie, getAuthSession, readAuthSessionToken } from '../lib/auth.js';
import {
  createOrReuseMembershipIntent,
  getCurrentMembershipIntent,
  isSupportedMembershipProviderKey,
  markMembershipIntentSubmitted,
  MEMBERSHIP_PROVIDER_KEYS,
} from '../lib/membershipBilling.js';

const membershipBilling = new Hono();

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

membershipBilling.post('/intents', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const auth = await requireTenantSession(c, tenantId);
  if (auth.error) return auth.error;

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Invalid JSON body.' }, 400); }

  const providerKey = String(body?.provider_key || MEMBERSHIP_PROVIDER_KEYS.MANUAL_BANK_TRANSFER).trim();
  if (!isSupportedMembershipProviderKey(providerKey)) {
    return c.json({ error: 'Unsupported membership settlement provider.' }, 400);
  }

  try {
    const intent = await createOrReuseMembershipIntent(c.env, {
      tenantId,
      productTierKey: body?.product_tier_key,
      providerKey,
    });
    return c.json({ ok: true, intent, response_mode: intent.meta?.response_mode || 'show_manual_instructions' });
  } catch (err) {
    return c.json({ error: err.message || 'Failed to create membership billing intent.' }, 400);
  }
});

membershipBilling.get('/intents/current', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const auth = await requireTenantSession(c, tenantId);
  if (auth.error) return auth.error;

  const intent = await getCurrentMembershipIntent(c.env, { tenantId });
  return c.json({ ok: true, intent });
});

membershipBilling.post('/intents/:intentId/mark-submitted', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const auth = await requireTenantSession(c, tenantId);
  if (auth.error) return auth.error;

  const intentId = c.req.param('intentId')?.trim();
  if (!intentId) return c.json({ error: 'Intent ID is required.' }, 400);

  let body = {};
  try { body = await c.req.json(); } catch { /* optional */ }

  try {
    const intent = await markMembershipIntentSubmitted(c.env, {
      tenantId,
      intentId,
      note: body?.note || null,
    });
    return c.json({ ok: true, intent, response_mode: intent.meta?.response_mode || 'awaiting_review' });
  } catch (err) {
    return c.json({ error: err.message || 'Failed to submit membership billing intent.' }, 400);
  }
});

export default function registerMembershipBillingRoutes(app) {
  app.route('/api/membership-billing', membershipBilling);
}