import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  formatMoney,
  formatDateTime,
  translate,
  resolveLocaleFromAcceptLanguage,
  getLocaleMessages,
  normalizeLocale,
  getSupportedLocales,
} from './utils/formatter.js';
import {
  handleCreateServiceItem,
  handleGetServiceItems,
  handleUpdateServiceItem
} from './routes/serviceItems.js';
import registerTaskRoutes from "./routes/tasks.js";
import registerTenantRoutes from './routes/tenants.js';
import registerBookingRoutes, { purgeExpiredOrders } from './routes/bookings.js';
import { runTodoReminders, runOpsDailyDigest } from './lib/bookingOps.js';
import registerTourRoutes from './routes/tours.js';
import registerCategoryRoutes from './routes/categories.js';
import registerPaymentRoutes, { checkTenantCompliance } from './routes/payments.js';
import registerAdminRoutes from './routes/admin.js';
import registerOnboardingRoutes from './routes/onboarding.js';
import registerBillingRoutes from './routes/billing.js';
import { dispatchTrialReminderEmail, dispatchAdminAlertEmail } from './lib/bookingEmails.js';
import registerDomainRoutes from './routes/domains.js';
import registerMarketingRoutes from './routes/marketing.js';
import registerUniversalSiteRoutes, { getSiteBundle, renderPublicHtml } from './routes/universalSites.js';
import registerReportsRoutes from './routes/reports.js';
import registerCalendarRoutes from './routes/calendar.js';
import registerBookingCalRoutes from './routes/bookingcal.js';
import registerDistributionRoutes from './routes/distribution.js';
import registerGuestPayRoutes from './routes/guestPay.js';
import { dispatchContactFormEmail } from './lib/bookingEmails.js';
import {
  handleListProperties,
  handleCreateProperty,
  handleUpdateProperty,
  handleListRoomTypes,
  handleCreateRoomType,
  handleUpdateRoomType,
  handleListRoomUnits,
  handleCreateRoomUnit,
  handleBulkCreateRoomUnits,
  handleUpdateRoomUnit,
  handleListRoomRates,
  handleCreateRoomRate,
  handleUpdateRoomRate,
  handleListPropertyAddonServicePresets,
  handleCreatePropertyAddonServicePreset,
  handleSeedPropertyAddonServicePresets,
  handleUpdatePropertyAddonServicePreset,
  handleListRateSeasons,
  handleCreateRateSeason,
  handleUpdateRateSeason,
  handleDeleteRateSeason,
  handleListSeasonRoomRates,
  handleCreateSeasonRoomRate,
  handleUpdateSeasonRoomRate,
  handleDeleteSeasonRoomRate,
  handleDeleteProperty,
  handleDeleteRoomType,
  handleDeleteRoomUnit,
  handleDeleteRoomRate,
  handleDeletePropertyAddonServicePreset,
  handleQuotePropertyRoomRate,
  handleCheckPropertyAvailability,
  handleCreatePropertyAvailabilityHold,
  handleReleasePropertyAvailabilityHold,
  handleCreatePropertyReservation,
  handleListPropertyReservations,
  handleGetPropertyReservation,
  handleCancelPropertyReservation,
  handleRebookPropertyReservation,
  handleCheckInPropertyReservation,
  handleCheckOutPropertyReservation,
  handleEarlyCheckOutPropertyReservation,
  handleNoShowPropertyReservation,
  handleUndoPropertyReservationStatus,
} from './routes/properties.js';
import registerPricingRoutes, { 
  handleCreatePricing, 
  handleGetPricing,
  handleGetPricingMetadata,
  handleUpdatePricing,
  handleDuplicateSeason,
  handleCopySeason,
  // [FIX] handleDeletePricing được dùng trong patterns[] nhưng trước đây bị thiếu import
  handleDeletePricing
} from './routes/pricing.js';
import registerSupplierRoutes from './routes/suppliers.js';
import registerSeoRoutes from './routes/seo.js';
import registerStaffRoutes from './routes/staff.js';
import registerEmailRoutes from './routes/emailIngest.js';
import { resolveTenantByHost, serveSitePage } from './lib/siteStudio.js';
import { slugify } from './lib/universalSite.js';
import { clearAuthSessionCookie, getAuthSession, readAuthSessionToken } from './lib/auth.js';
import { buildTenantTrustPolicy } from './lib/trustAbuse.js';

// ── Under Construction page (in-memory) ───────────────────────────────────────
// Served when a tenant has not enabled an electronic payment gateway.
// [UX] Minimal dark page — no template assets, loads instantly.
const UNDER_CONSTRUCTION_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Website Under Construction</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;display:flex;align-items:center;
         justify-content:center;min-height:100vh;background:#0f172a;color:#94a3b8;}
    .box{text-align:center;max-width:500px;padding:52px 36px;}
    .icon{font-size:56px;margin-bottom:28px;}
    h1{font-size:24px;font-weight:700;color:#e2e8f0;margin-bottom:16px;}
    p{font-size:15px;line-height:1.7;}
  </style>
</head>
<body>
  <div class="box">
    <div class="icon">🚧</div>
    <h1>Website Under Construction</h1>
    <p>This agent is currently setting up professional payment methods.<br>Please come back later.</p>
  </div>
</body>
</html>`;

const app = new Hono();

app.get('/api/i18n', (c) => {
  const lang = resolveLocaleFromAcceptLanguage(c.req.header('Accept-Language'));
  return c.json({ ok: true, lang, supported: getSupportedLocales(), messages: getLocaleMessages(lang) });
});

app.get('/api/i18n/:lang', (c) => {
  const lang = normalizeLocale(c.req.param('lang'));
  return c.json({ ok: true, lang, supported: getSupportedLocales(), messages: getLocaleMessages(lang) });
});

// ── CORS ─────────────────────────────────────────────────────────────────────
// Allow the admin dashboard (any origin) to call /api/* — handles OPTIONS
// preflights that browsers send when X-Tenant-ID or Content-Type headers are
// present, or when the page origin differs from the worker origin.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Tenant-ID, Authorization, X-Admin-Secret',
  'Access-Control-Max-Age':       '86400',
};
app.use('/api/*', cors({
  origin:         '*',
  allowMethods:   ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders:   ['Content-Type', 'X-Tenant-ID', 'Authorization', 'X-Admin-Secret'],
  maxAge:          86400,
}));
// Annotates all JSON responses with charset=utf-8 — critical for Vietnamese
// place names and special characters sent to international clients.
app.use('*', async (c, next) => {
  await next();
  const ct = c.res.headers.get('content-type') ?? '';
  if (ct.startsWith('application/json') && !ct.includes('charset')) {
    const headers = new Headers(c.res.headers);
    headers.set('content-type', 'application/json; charset=utf-8');
    c.res = new Response(c.res.body, { status: c.res.status, headers });
  }
});

// ── Tenant-context middleware ──────────────────────────────────────────────────
// Chạy trước mọi Hono route. Đọc X-Tenant-ID → truy vấn tenants → lưu config
// vào c.set('tenantConfig') và c.set('formatter').
// Nếu không có header hoặc tenant không tồn tại, tiếp tục (route tự xử lý 400).
app.use('*', async (c, next) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (tenantId) {
    const tenant = await c.env.DB
      .prepare(
        `SELECT t.default_locale, t.base_currency,
                t.target_currency AS secondary_display_currency, t.booking_currency, t.market_skin_key, t.primary_market, t.exchange_rate,
                t.pricing_policy, t.infant_policy_text, t.pricing_notes_text,
                COALESCE(tcc.timezone, 'Asia/Ho_Chi_Minh') AS timezone
         FROM tenants t
         LEFT JOIN tenant_calendar_configs tcc ON tcc.tenant_id = t.id
         WHERE t.id = ?`
      )
      .bind(tenantId)
      .first();

    if (tenant) {
      // Accept-Language → UI language for labels/error messages (fallback: 'en')
      // tenant locale → number/date formatting only
      const uiLang = resolveLocaleFromAcceptLanguage(c.req.header('Accept-Language'));

      const config = {
        tenant_id:          tenantId,
        locale:             tenant.default_locale    ?? 'en-US',
        base_currency:      tenant.base_currency     ?? 'USD',
        booking_currency:   tenant.booking_currency  ?? tenant.base_currency ?? 'USD',
        secondary_display_currency: tenant.secondary_display_currency ?? null,
        display_currency:   tenant.booking_currency  ?? tenant.base_currency ?? 'USD',
        exchange_rate:      tenant.exchange_rate      ?? 1,
        timezone:           tenant.timezone           ?? 'Asia/Ho_Chi_Minh',
        pricing_policy:     tenant.pricing_policy     ?? 'PRIORITY_HIGH_SEASON',
        infant_policy_text: tenant.infant_policy_text ?? null,
        pricing_notes_text: tenant.pricing_notes_text ?? null,
        market_skin_key:    tenant.market_skin_key    ?? 'global-default',
        primary_market:     tenant.primary_market     ?? 'GLOBAL',
        lang:               uiLang,
      };

      c.set('tenantConfig', config);

      // formatter: bound helpers — route chỉ cần gọi formatter.money(amount)
      c.set('formatter', {
        /** Số tiền USD → đồng nội địa của tenant, đã format */
        money: (amount) =>
          formatMoney(amount, config.locale, config.display_currency, config.exchange_rate),

        /** Số tiền USD → USD, đã format ($1,000.00) */
        moneyUSD: (amount) =>
          formatMoney(amount, 'en-US', 'USD'),

        /** Số tiền USD → object dual-currency { usd, local } */
        moneyBoth: (amount) => ({
          usd:   formatMoney(amount, 'en-US', 'USD'),
          local: formatMoney(amount, config.locale, config.display_currency, config.exchange_rate),
        }),

        /** Ngày (Date | UNIX giây | ISO string) → chuỗi theo locale tenant */
        date: (d, opts) => formatDateTime(d, config.locale, opts),

        /** Dịch key dot-notation theo ngôn ngữ client (Accept-Language) */
        t: (key, vars) => translate(key, uiLang, vars),
      });
    }
  }
  await next();
});

const PROTECTED_API_PREFIXES = [
  '/api/categories',
  '/api/payments',
  '/api/pricing',
  '/api/stops',
  '/api/tasks',
  '/api/tenants',
  '/api/tenant/pages',   // pages.js routes — all require an authenticated session
  '/api/tours',
  '/api/universal',
  '/api/billing/checkout',
  '/api/billing/portal',
  '/api/billing/addon',
  '/api/billing/status',
  '/api/domains/search',    // domain availability + price lookup
  '/api/domains/purchase',  // covers /purchase and /purchases (startsWith)
  '/api/reports',
  '/api/marketing',
  '/api/seo',
  '/api/distribution',
  '/api/suppliers',
  '/api/calendar',
  '/api/bookingcal',
];

app.use('/api/*', async (c, next) => {
  const pathname = new URL(c.req.url).pathname;
  // Public endpoints nested under otherwise-protected prefixes
  const PUBLIC_EXCEPTIONS = ['/api/universal/search', '/api/pay'];
  if (PUBLIC_EXCEPTIONS.some(p => pathname.startsWith(p))) { await next(); return; }
  const needsAuth = PROTECTED_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (!needsAuth) {
    await next();
    return;
  }

  const token = readAuthSessionToken(c);
  if (!token) {
    return c.json({ error: 'Authentication required.' }, 401);
  }

  const session = await getAuthSession(c.env.DB, token);
  if (!session) {
    clearAuthSessionCookie(c);
    return c.json({ error: 'Session expired. Please log in again.' }, 401);
  }

  const requestedTenantId = c.req.header('X-Tenant-ID')?.trim();
  if (requestedTenantId && requestedTenantId !== session.tenant_id) {
    return c.json({ error: 'Forbidden for this tenant.' }, 403);
  }

  c.set('authSession', session);

  // ── Role-based access control ─────────────────────────────────────────────
  // owner   (4) — full access including billing and account management
  // manager (3) — all config and operations, cannot touch billing/subscription
  // staff   (2) — operations only: tasks, bookings, calendar, reservations
  // provider(1) — own assigned tasks only
  const ROLE_RANK_MAP = { owner: 4, manager: 3, staff: 2, provider: 1 };
  const sessionRole = session.role ?? 'staff';
  const roleRank    = ROLE_RANK_MAP[sessionRole] ?? 0;

  // Owner-only: billing mutations (money / subscription management)
  const OWNER_ONLY_PATHS = [
    '/api/billing/checkout',
    '/api/billing/portal',
    '/api/billing/addon',
  ];
  if (OWNER_ONLY_PATHS.some(p => pathname.startsWith(p))) {
    if (sessionRole !== 'owner') {
      return c.json({ error: 'Only the account owner can perform this action.' }, 403);
    }
  }

  // Manager+ required to view billing status and reports
  const MANAGER_PLUS_ALL_PATHS = ['/api/billing/status', '/api/reports'];
  if (MANAGER_PLUS_ALL_PATHS.some(p => pathname.startsWith(p)) && roleRank < 3) {
    return c.json({ error: 'Manager or owner access required.' }, 403);
  }

  // Manager+ required for write operations on configuration routes
  // Staff can still read (GET) these routes for operational context.
  const MANAGER_PLUS_WRITE_PATHS = [
    '/api/tours',
    '/api/categories',
    '/api/tenants',
    '/api/tenant/pages',
    '/api/marketing',
    '/api/seo',
    '/api/distribution',
    '/api/suppliers',
  ];
  const WRITE_METHODS_SET = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  if (WRITE_METHODS_SET.has(c.req.method) && MANAGER_PLUS_WRITE_PATHS.some(p => pathname.startsWith(p)) && roleRank < 3) {
    return c.json({ error: 'Manager or owner access required.' }, 403);
  }


  // Block mutating operations for SUSPENDED, CANCELLED, and trial-expired tenants.
  // GET requests and /api/billing/* (so tenants can reactivate) are always allowed.
  const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  const BILLING_EXEMPT = '/api/billing';
  if (WRITE_METHODS.has(c.req.method) && !pathname.startsWith(BILLING_EXEMPT)) {
    const subStatus = session.subscription_status || 'TRIAL';
    const tenantCreatedAt = Number(session.tenant_created_at ?? 0);
    const TRIAL_DAYS_LIMIT = 180;
    const nowS = Math.floor(Date.now() / 1000);

    if (subStatus === 'SUSPENDED') {
      return c.json({
        error: 'Account suspended — update your payment method to restore access.',
        billing_status: 'SUSPENDED',
        billing_url: '/dashboard.html#billing',
      }, 402);
    }
    if (subStatus === 'CANCELLED') {
      return c.json({
        error: 'Subscription cancelled — reactivate your plan to continue.',
        billing_status: 'CANCELLED',
        billing_url: '/dashboard.html#billing',
      }, 402);
    }
    if (subStatus === 'TRIAL' && tenantCreatedAt > 0 && nowS > tenantCreatedAt + TRIAL_DAYS_LIMIT * 86400) {
      return c.json({
        error: 'Your free trial has ended — subscribe to continue using the platform.',
        billing_status: 'TRIAL_EXPIRED',
        billing_url: '/dashboard.html#billing',
      }, 402);
    }
  }

  await next();
});

// Đăng ký các route cho Hono (Task, Pricing, Tenants)
registerOnboardingRoutes && registerOnboardingRoutes(app);
registerTaskRoutes && registerTaskRoutes(app);
registerPricingRoutes && registerPricingRoutes(app);
registerTenantRoutes && registerTenantRoutes(app);
registerBookingRoutes && registerBookingRoutes(app);
registerTourRoutes && registerTourRoutes(app);
registerCategoryRoutes && registerCategoryRoutes(app);
registerPaymentRoutes && registerPaymentRoutes(app);
registerAdminRoutes && registerAdminRoutes(app);
registerBillingRoutes && registerBillingRoutes(app);
registerDomainRoutes && registerDomainRoutes(app);
registerMarketingRoutes && registerMarketingRoutes(app);
registerUniversalSiteRoutes && registerUniversalSiteRoutes(app);
registerReportsRoutes && registerReportsRoutes(app);
registerCalendarRoutes && registerCalendarRoutes(app);
registerBookingCalRoutes && registerBookingCalRoutes(app);
registerDistributionRoutes && registerDistributionRoutes(app);
registerGuestPayRoutes && registerGuestPayRoutes(app);
registerSupplierRoutes && registerSupplierRoutes(app);
registerSeoRoutes && registerSeoRoutes(app);
registerStaffRoutes && registerStaffRoutes(app);
registerEmailRoutes && registerEmailRoutes(app);

// ── Platform-wide tour search (public, no auth) ───────────────────────────────
// GET /api/universal/search?q=&page=&limit=
// Searches published/on_sale tours across all tenants.
app.get('/api/universal/search', async (c) => {
  const q     = (c.req.query('q') || '').trim();
  const page  = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '18', 10)));
  const offset = (page - 1) * limit;

  if (!q || q.length < 2) {
    return c.json({ ok: true, results: [], total: 0, page, limit, query: q });
  }

  try {
    const db = c.env.DB;
    // Keyword match against title + duration_text; safe parameterized LIKE
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;

    const [rows, countRow] = await Promise.all([
      db.prepare(`
        SELECT t.id, t.title, t.status, t.duration_text, t.tour_type,
               tn.name   AS tenant_name,
               tn.custom_domain,
               tn.subdomain,
               COALESCE(tgs.slug, t.slug) AS tour_slug
          FROM tours t
          JOIN tenants tn ON tn.id = t.tenant_id
          LEFT JOIN tour_growth_slugs tgs
                 ON tgs.tour_id = t.id AND tgs.tenant_id = t.tenant_id
         WHERE t.status IN ('published','on_sale')
           AND (t.title LIKE ? OR t.duration_text LIKE ?)
         ORDER BY t.title ASC
         LIMIT ? OFFSET ?
      `).bind(like, like, limit, offset).all(),

      db.prepare(`
        SELECT COUNT(*) AS cnt
          FROM tours t
         WHERE t.status IN ('published','on_sale')
           AND (t.title LIKE ? OR t.duration_text LIKE ?)
      `).bind(like, like).first(),
    ]);

    const results = (rows.results ?? []).map(r => {
      let tour_url = '#';
      const slug = r.tour_slug;
      if (slug) {
        if (r.custom_domain) {
          tour_url = `https://${r.custom_domain}/tours/${slug}`;
        } else if (r.subdomain) {
          tour_url = `https://${r.subdomain}.tours-market.com/tours/${slug}`;
        }
      }
      return {
        id:            r.id,
        title:         r.title,
        duration_text: r.duration_text,
        tour_type:     r.tour_type,
        tenant_name:   r.tenant_name,
        tour_url,
      };
    });

    return c.json({ ok: true, results, total: countRow?.cnt ?? 0, page, limit, query: q });
  } catch (err) {
    console.error('[SEARCH] error', err);
    return c.json({ error: 'Search failed.' }, 500);
  }
});


app.post('/api/contact', async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }

  const { name, email, type, message, website: honeypot, turnstile_token } = body ?? {};

  // Honeypot: bots fill the hidden "website" field
  if (honeypot && String(honeypot).trim()) {
    return c.json({ ok: true }); // silent accept to confuse bots
  }

  if (!name || !email || !message || message.length < 20) {
    return c.json({ error: 'missing_fields' }, 400);
  }

  // Rate limit: max 3 submissions per IP per hour via KV
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  const kvKey = `contact_rl:${ip}`;
  try {
    const stored = await c.env.TOUR_PRESETS.get(kvKey);
    const count = stored ? parseInt(stored, 10) : 0;
    if (count >= 3) {
      return c.json({ error: 'rate_limited' }, 429);
    }
    await c.env.TOUR_PRESETS.put(kvKey, String(count + 1), { expirationTtl: 3600 });
  } catch (_) { /* KV unavailable — allow through */ }

  // Turnstile verification
  const tsSecretKey = String(c.env.TURNSTILE_SECRET_KEY || '').trim();
  if (tsSecretKey) {
    const token = String(turnstile_token || '').trim();
    if (!token) return c.json({ error: 'turnstile_required' }, 400);
    try {
      const tsForm = new FormData();
      tsForm.append('secret', tsSecretKey);
      tsForm.append('response', token);
      const remoteIp = c.req.header('CF-Connecting-IP') || '';
      if (remoteIp) tsForm.append('remoteip', remoteIp);
      const tsRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: tsForm });
      const tsData = await tsRes.json();
      if (!tsData?.success) return c.json({ error: 'turnstile_failed' }, 403);
    } catch (_) { /* network error — allow through */ }
  }

  const result = await dispatchContactFormEmail(c.env, { name, email, type: type || 'General', message });
  if (!result.ok) {
    console.warn('[CONTACT_FORM] dispatch failed', result);
    return c.json({ error: 'send_failed' }, 502);
  }
  return c.json({ ok: true });
});

const SERVICE_GROUPS = ['accommodations', 'meals', 'guides', 'local-transports', 'intercity-legs'];
const PRICING_GROUPS = ['tenant-seasons', 'pricing-segments', 'pax-bands', 'tour-prices'];

// ĐỊNH NGHĨA MẢNG PATTERNS ĐÚNG CÚ PHÁP
const patterns = [
  ...(app.taskRoutes || []),

  // Route đặc biệt: duplicate season (phải đứng trước PRICING_GROUPS patterns)
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/pricing/duplicate-season' }),
    handler: (req, env) => handleDuplicateSeason(req, env)
  },
  // Route đặc biệt: copy season
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/pricing/tenant-seasons/:sourceSeasonId/copy' }),
    handler: (req, env, match) => handleCopySeason(req, env, { sourceSeasonId: match.pathname.groups.sourceSeasonId })
  },
  // Route đặc biệt: metadata (phải đứng trước GET /:group)
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/pricing/metadata' }),
    handler: (req, env) => handleGetPricingMetadata(req, env)
  },

  // Các route cho Service Items
  ...SERVICE_GROUPS.map(group => ({
    method: 'POST',
    pattern: new URLPattern({ pathname: `/api/stops/:stopId/${group}` }),
    handler: (req, env, match) => handleCreateServiceItem(req, env, { group, stopId: match.pathname.groups.stopId })
  })),
  ...SERVICE_GROUPS.map(group => ({
    method: 'GET',
    pattern: new URLPattern({ pathname: `/api/stops/:stopId/${group}` }),
    handler: (req, env, match) => handleGetServiceItems(req, env, { group, stopId: match.pathname.groups.stopId })
  })),
  ...SERVICE_GROUPS.map(group => ({
    method: 'PATCH',
    pattern: new URLPattern({ pathname: `/api/stops/:stopId/${group}/:itemId` }),
    handler: (req, env, match) => handleUpdateServiceItem(req, env, { group, itemId: match.pathname.groups.itemId })
  })),

  // Các route cho Pricing (POST)
  ...PRICING_GROUPS.map(group => ({
    method: 'POST',
    pattern: new URLPattern({ pathname: `/api/pricing/${group}` }),
    handler: (req, env, match, ctx) => handleCreatePricing(req, env, { group }, ctx)
  })),

  // Các route cho Pricing (GET)
  ...PRICING_GROUPS.map(group => ({
    method: 'GET',
    pattern: new URLPattern({ pathname: `/api/pricing/${group}` }),
    handler: (req, env, match) => handleGetPricing(req, env, { group })
  })),

  // Update
  ...PRICING_GROUPS.map(group => ({
    method: 'PATCH',
    pattern: new URLPattern({ pathname: `/api/pricing/${group}/:itemId` }),
    handler: (req, env, match, ctx) => handleUpdatePricing(req, env, { 
      group, 
      itemId: match.pathname.groups.itemId 
    }, ctx)
  })),

  // Xóa sau thử
  ...PRICING_GROUPS.map(group => ({
    method: 'DELETE',
    pattern: new URLPattern({ pathname: `/api/pricing/${group}/:itemId` }),
    handler: (req, env, match, ctx) => handleDeletePricing(req, env, { group, itemId: match.pathname.groups.itemId }, ctx)
  })),

  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/properties' }),
    handler: (req, env) => handleListProperties(req, env)
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/properties' }),
    handler: (req, env) => handleCreateProperty(req, env)
  },
  {
    method: 'PATCH',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId' }),
    handler: (req, env, match) => handleUpdateProperty(req, env, { propertyId: match.pathname.groups.propertyId })
  },
  {
    method: 'DELETE',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId' }),
    handler: (req, env, match) => handleDeleteProperty(req, env, { propertyId: match.pathname.groups.propertyId })
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/room-types' }),
    handler: (req, env, match) => handleListRoomTypes(req, env, { propertyId: match.pathname.groups.propertyId })
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/room-types' }),
    handler: (req, env, match) => handleCreateRoomType(req, env, { propertyId: match.pathname.groups.propertyId })
  },
  {
    method: 'PATCH',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/room-types/:roomTypeId' }),
    handler: (req, env, match) => handleUpdateRoomType(req, env, { propertyId: match.pathname.groups.propertyId, roomTypeId: match.pathname.groups.roomTypeId })
  },
  {
    method: 'DELETE',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/room-types/:roomTypeId' }),
    handler: (req, env, match) => handleDeleteRoomType(req, env, { propertyId: match.pathname.groups.propertyId, roomTypeId: match.pathname.groups.roomTypeId })
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/room-units' }),
    handler: (req, env, match) => handleListRoomUnits(req, env, { propertyId: match.pathname.groups.propertyId })
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/room-units' }),
    handler: (req, env, match) => handleCreateRoomUnit(req, env, { propertyId: match.pathname.groups.propertyId })
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/room-units/bulk-create' }),
    handler: (req, env, match) => handleBulkCreateRoomUnits(req, env, { propertyId: match.pathname.groups.propertyId })
  },
  {
    method: 'PATCH',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/room-units/:roomUnitId' }),
    handler: (req, env, match) => handleUpdateRoomUnit(req, env, { propertyId: match.pathname.groups.propertyId, roomUnitId: match.pathname.groups.roomUnitId })
  },
  {
    method: 'DELETE',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/room-units/:roomUnitId' }),
    handler: (req, env, match) => handleDeleteRoomUnit(req, env, { propertyId: match.pathname.groups.propertyId, roomUnitId: match.pathname.groups.roomUnitId })
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/room-rates' }),
    handler: (req, env, match) => handleListRoomRates(req, env, { propertyId: match.pathname.groups.propertyId })
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/room-rates' }),
    handler: (req, env, match) => handleCreateRoomRate(req, env, { propertyId: match.pathname.groups.propertyId })
  },
  {
    method: 'PATCH',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/room-rates/:roomRateId' }),
    handler: (req, env, match) => handleUpdateRoomRate(req, env, { propertyId: match.pathname.groups.propertyId, roomRateId: match.pathname.groups.roomRateId })
  },
  {
    method: 'DELETE',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/room-rates/:roomRateId' }),
    handler: (req, env, match) => handleDeleteRoomRate(req, env, { propertyId: match.pathname.groups.propertyId, roomRateId: match.pathname.groups.roomRateId })
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/addon-service-presets' }),
    handler: (req, env, match) => handleListPropertyAddonServicePresets(req, env, { propertyId: match.pathname.groups.propertyId })
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/addon-service-presets' }),
    handler: (req, env, match) => handleCreatePropertyAddonServicePreset(req, env, { propertyId: match.pathname.groups.propertyId })
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/addon-service-presets/seed-defaults' }),
    handler: (req, env, match) => handleSeedPropertyAddonServicePresets(req, env, { propertyId: match.pathname.groups.propertyId })
  },
  {
    method: 'PATCH',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/addon-service-presets/:presetId' }),
    handler: (req, env, match) => handleUpdatePropertyAddonServicePreset(req, env, { propertyId: match.pathname.groups.propertyId, presetId: match.pathname.groups.presetId })
  },
  {
    method: 'DELETE',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/addon-service-presets/:presetId' }),
    handler: (req, env, match) => handleDeletePropertyAddonServicePreset(req, env, { propertyId: match.pathname.groups.propertyId, presetId: match.pathname.groups.presetId })
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/rate-seasons' }),
    handler: (req, env, match) => handleListRateSeasons(req, env, { propertyId: match.pathname.groups.propertyId })
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/rate-seasons' }),
    handler: (req, env, match) => handleCreateRateSeason(req, env, { propertyId: match.pathname.groups.propertyId })
  },
  {
    method: 'PATCH',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/rate-seasons/:seasonId' }),
    handler: (req, env, match) => handleUpdateRateSeason(req, env, { propertyId: match.pathname.groups.propertyId, seasonId: match.pathname.groups.seasonId })
  },
  {
    method: 'DELETE',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/rate-seasons/:seasonId' }),
    handler: (req, env, match) => handleDeleteRateSeason(req, env, { propertyId: match.pathname.groups.propertyId, seasonId: match.pathname.groups.seasonId })
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/season-room-rates' }),
    handler: (req, env, match) => handleListSeasonRoomRates(req, env, { propertyId: match.pathname.groups.propertyId })
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/season-room-rates' }),
    handler: (req, env, match) => handleCreateSeasonRoomRate(req, env, { propertyId: match.pathname.groups.propertyId })
  },
  {
    method: 'PATCH',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/season-room-rates/:seasonRoomRateId' }),
    handler: (req, env, match) => handleUpdateSeasonRoomRate(req, env, { propertyId: match.pathname.groups.propertyId, seasonRoomRateId: match.pathname.groups.seasonRoomRateId })
  },
  {
    method: 'DELETE',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/season-room-rates/:seasonRoomRateId' }),
    handler: (req, env, match) => handleDeleteSeasonRoomRate(req, env, { propertyId: match.pathname.groups.propertyId, seasonRoomRateId: match.pathname.groups.seasonRoomRateId })
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/rates/quote' }),
    handler: (req, env, match) => handleQuotePropertyRoomRate(req, env, { propertyId: match.pathname.groups.propertyId })
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/availability' }),
    handler: (req, env, match) => handleCheckPropertyAvailability(req, env, { propertyId: match.pathname.groups.propertyId })
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/availability/hold' }),
    handler: (req, env, match) => handleCreatePropertyAvailabilityHold(req, env, { propertyId: match.pathname.groups.propertyId })
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/availability/hold/:holdId/release' }),
    handler: (req, env, match) => handleReleasePropertyAvailabilityHold(req, env, { propertyId: match.pathname.groups.propertyId, holdId: match.pathname.groups.holdId })
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/reservations' }),
    handler: (req, env, match) => handleCreatePropertyReservation(req, env, { propertyId: match.pathname.groups.propertyId })
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/reservations' }),
    handler: (req, env, match) => handleListPropertyReservations(req, env, { propertyId: match.pathname.groups.propertyId })
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/reservations/:reservationId' }),
    handler: (req, env, match) => handleGetPropertyReservation(req, env, { propertyId: match.pathname.groups.propertyId, reservationId: match.pathname.groups.reservationId })
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/reservations/:reservationId/cancel' }),
    handler: (req, env, match) => handleCancelPropertyReservation(req, env, { propertyId: match.pathname.groups.propertyId, reservationId: match.pathname.groups.reservationId })
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/reservations/:reservationId/rebook' }),
    handler: (req, env, match) => handleRebookPropertyReservation(req, env, { propertyId: match.pathname.groups.propertyId, reservationId: match.pathname.groups.reservationId })
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/reservations/:reservationId/check-in' }),
    handler: (req, env, match) => handleCheckInPropertyReservation(req, env, { propertyId: match.pathname.groups.propertyId, reservationId: match.pathname.groups.reservationId })
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/reservations/:reservationId/check-out' }),
    handler: (req, env, match) => handleCheckOutPropertyReservation(req, env, { propertyId: match.pathname.groups.propertyId, reservationId: match.pathname.groups.reservationId })
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/reservations/:reservationId/early-check-out' }),
    handler: (req, env, match) => handleEarlyCheckOutPropertyReservation(req, env, { propertyId: match.pathname.groups.propertyId, reservationId: match.pathname.groups.reservationId })
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/reservations/:reservationId/no-show' }),
    handler: (req, env, match) => handleNoShowPropertyReservation(req, env, { propertyId: match.pathname.groups.propertyId, reservationId: match.pathname.groups.reservationId })
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/properties/:propertyId/reservations/:reservationId/undo-status' }),
    handler: (req, env, match) => handleUndoPropertyReservationStatus(req, env, { propertyId: match.pathname.groups.propertyId, reservationId: match.pathname.groups.reservationId })
  },
];

// ── Trial maintenance — runs on every cron tick (*/15 * * * *) ────────────────
// 1. Expire TRIAL tenants whose 180-day trial has ended → set SUSPENDED
// 2. Send reminder emails at 30 / 7 / 1 days before trial ends (deduplicated via audit_log)
async function runTrialMaintenance(env) {
  const TRIAL_DAYS = 180;
  const REMINDER_MILESTONES = [30, 7, 1]; // days before expiry
  const nowS = Math.floor(Date.now() / 1000);

  let trials;
  try {
    const result = await env.DB
      .prepare("SELECT id, name, email, created_at FROM tenants WHERE subscription_status = 'TRIAL'")
      .all();
    trials = result.results ?? [];
  } catch (err) {
    console.error('[TRIAL_MAINTENANCE] DB query failed:', err.message);
    return;
  }

  for (const tenant of trials) {
    if (!tenant.id || !tenant.email) continue;
    const trialEndsAt  = Number(tenant.created_at) + TRIAL_DAYS * 86400;
    const trialDaysLeft = Math.max(0, Math.ceil((trialEndsAt - nowS) / 86400));
    const expired = nowS >= trialEndsAt;

    // ── Auto-expire: trial ended → SUSPENDED ─────────────────────────────
    if (expired) {
      try {
        // Guard: only process if still TRIAL (race-safe re-check)
        const alreadyProcessed = await env.DB
          .prepare(
            `SELECT id FROM tenant_audit_log
              WHERE tenant_id = ? AND action = 'BILLING_TRIAL_EXPIRED'
              LIMIT 1`
          )
          .bind(tenant.id)
          .first();
        if (alreadyProcessed) continue;

        await env.DB
          .prepare("UPDATE tenants SET subscription_status = 'SUSPENDED' WHERE id = ? AND subscription_status = 'TRIAL'")
          .bind(tenant.id)
          .run();

        await env.DB
          .prepare(
            `INSERT INTO tenant_audit_log (id, tenant_id, action, field_name, old_value, new_value, created_at)
             VALUES (?, ?, 'BILLING_TRIAL_EXPIRED', 'subscription_status', 'TRIAL', 'SUSPENDED', ?)`
          )
          .bind(
            crypto.randomUUID().replace(/-/g, '').slice(0, 21),
            tenant.id,
            nowS
          )
          .run();

        await dispatchTrialReminderEmail(env, {
          tenantId:    tenant.id,
          tenantName:  tenant.name,
          tenantEmail: tenant.email,
          daysLeft:    0,
          expired:     true,
        });

        await dispatchAdminAlertEmail(env, {
          subject:  `[Tours Market] Trial expired — ${tenant.name || tenant.id}`,
          bodyText: `Tenant: ${tenant.name || '—'} (${tenant.id})\nEmail: ${tenant.email}\nTrial ended. Status set to SUSPENDED.`,
        });

        console.log(`[TRIAL_MAINTENANCE] ✓ Tenant ${tenant.id} trial expired — set to SUSPENDED.`);
      } catch (err) {
        console.error(`[TRIAL_MAINTENANCE] Failed to expire tenant ${tenant.id}:`, err.message);
      }
      continue;
    }

    // ── Reminder emails at 30 / 7 / 1 days before expiry ─────────────────
    for (const milestone of REMINDER_MILESTONES) {
      if (trialDaysLeft > milestone) continue; // not yet in window

      const auditAction = `BILLING_TRIAL_REMINDER_${milestone}`;
      try {
        const alreadySent = await env.DB
          .prepare(
            `SELECT id FROM tenant_audit_log
              WHERE tenant_id = ? AND action = ?
              LIMIT 1`
          )
          .bind(tenant.id, auditAction)
          .first();
        if (alreadySent) break; // already sent this (and lower milestones) — skip

        await dispatchTrialReminderEmail(env, {
          tenantId:    tenant.id,
          tenantName:  tenant.name,
          tenantEmail: tenant.email,
          daysLeft:    trialDaysLeft,
          expired:     false,
        });

        await env.DB
          .prepare(
            `INSERT INTO tenant_audit_log (id, tenant_id, action, field_name, old_value, new_value, created_at)
             VALUES (?, ?, ?, 'subscription_status', ?, ?, ?)`
          )
          .bind(
            crypto.randomUUID().replace(/-/g, '').slice(0, 21),
            tenant.id,
            auditAction,
            'TRIAL',
            String(trialDaysLeft),
            nowS
          )
          .run();

        console.log(`[TRIAL_MAINTENANCE] ✓ Sent ${milestone}-day reminder to tenant ${tenant.id} (${trialDaysLeft} days left).`);
        break; // only send one milestone per cron tick per tenant
      } catch (err) {
        console.error(`[TRIAL_MAINTENANCE] Reminder failed for tenant ${tenant.id}:`, err.message);
      }
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ── CORS preflight for URLPattern routes (patterns[]) ────────────────────
    // Hono's cors middleware covers app.route() handlers, but the manual
    // patterns[] loop is matched BEFORE Hono. Return 204 for any OPTIONS hit.
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Handles requests arriving on a tenant's custom domain OR platform subdomain.
    // API calls (/api/*) always bypass this block and route normally below.
    //
    // Priority:
    //   1. Site Studio  — tenant.template_id set → live HTMLRewriter render
    //                     from SITE_TEMPLATES R2 bucket
    //   2. Legacy pages — pre-rendered HTML from TOUR_PAGES R2 bucket
    //                     (backward-compatible for tenants without template_id)
    const host      = request.headers.get('host') ?? '';
    const isApiPath = url.pathname.startsWith('/api/');

    if (host && !isApiPath && !host.includes('workers.dev') && !host.includes('localhost')) {
      const tenant = await resolveTenantByHost(host, env.DB);

      if (tenant) {
        const trustPolicy = buildTenantTrustPolicy(tenant);
        // ── Path 1: Site Studio — live template render ────────────────────
        if (tenant.template_id) {
          return serveSitePage(tenant, env, {
            responseHeaders: trustPolicy.force_noindex ? { 'X-Robots-Tag': trustPolicy.robots_directive } : {},
          });
        }

        // ── Path 1b: Universal site render on platform/custom host ───────
        // Strip /t/ prefix used for tour detail deep-links (e.g. /t/my-tour-slug)
        const rawPath = url.pathname.replace(/^\/+/, '').replace(/\.html$/, '');
        const pathForSlug = rawPath.startsWith('t/') ? rawPath.slice(2) : rawPath;
        const requestedSlug = slugify(pathForSlug || 'home');
        let pageRow = await env.DB
          .prepare('SELECT * FROM tenant_universal_pages WHERE tenant_id = ? AND slug = ?')
          .bind(tenant.id, requestedSlug)
          .first();
        if (!pageRow && requestedSlug === 'home') {
          pageRow = await env.DB
            .prepare('SELECT * FROM tenant_universal_pages WHERE tenant_id = ? AND slug = ?')
            .bind(tenant.id, '')
            .first();
        }
        if (pageRow) {
          const siteBundle = await getSiteBundle(tenant.id, tenant, env.DB, env, {
            hostType: tenant.resolved_host_type || 'platform_subdomain',
          });
          const page = {
            id: pageRow.id,
            tenant_id: pageRow.tenant_id,
            page_key: pageRow.page_key,
            title: pageRow.title,
            slug: pageRow.slug,
            page_type: pageRow.page_type,
            status: pageRow.status,
            visible: Boolean(pageRow.visible),
            blocks: pageRow.blocks_json ? JSON.parse(pageRow.blocks_json) : [],
            seo: pageRow.seo_json ? JSON.parse(pageRow.seo_json) : {},
            created_at: pageRow.created_at,
            updated_at: pageRow.updated_at,
          };
          const html = renderPublicHtml(siteBundle, page, null, { requestUrl: request.url });
          const headers = { 'Content-Type': 'text/html; charset=utf-8' };
          if (trustPolicy.force_noindex) headers['X-Robots-Tag'] = trustPolicy.robots_directive;
          return new Response(html, { headers });
        }

        // ── Path 2: Legacy TOUR_PAGES — pre-rendered HTML ─────────────────
        // Map /  →  index.html,  /ha-long-3n2d  →  ha-long-3n2d.html
        const rawSlug  = url.pathname.replace(/^\/+/, '').replace(/\.html$/, '') || 'index';
        // [SEC] Prevent path traversal — allow only slug-safe characters
        const safeSlug = rawSlug.replace(/[^a-z0-9_-]/gi, '');
        if (safeSlug) {
          const r2Key = `${tenant.id}/${safeSlug}.html`;
          const obj   = await env.TOUR_PAGES?.get(r2Key);
          if (obj) {
            const headers = { 'Content-Type': 'text/html; charset=utf-8' };
            if (trustPolicy.force_noindex) headers['X-Robots-Tag'] = trustPolicy.robots_directive;
            return new Response(await obj.text(), {
              headers,
            });
          }
        }
        // No page found — fall through to API routing
      }
    }

    // Kiểm tra mảng patterns thủ công
    for (const p of patterns) {
      const match = p.pattern.exec(url.pathname);
      if (match && request.method === p.method) {
        const res = await p.handler(request, env, match, ctx);
        // Attach CORS headers so browser receives them on the actual response too
        const headers = new Headers(res.headers);
        Object.entries(CORS_HEADERS).forEach(([k, v]) => headers.set(k, v));
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
      }
    }

    // Các route đặc biệt khác
    if (url.pathname === "/api/tours-preview") {
      const rows = await env.DB.prepare("SELECT * FROM tours LIMIT 5").all();
      return Response.json(rows.results);
    }

    // Nếu không khớp pattern nào, chuyển cho Hono xử lý.
    // For Workers static assets, let the Worker run first and explicitly fall back
    // to ASSETS only when Hono/manual routes do not handle the request.
    const appResponse = await app.fetch(request, env, ctx);
    if (appResponse.status !== 404 || !env.ASSETS || typeof env.ASSETS.fetch !== 'function') {
      return appResponse;
    }
    return env.ASSETS.fetch(request);
  },

  // Scheduled purge — cron "*/15 * * * *" (configured in wrangler.jsonc triggers.crons)
  // Expires AWAITING_PROOF orders past payment_deadline; NULLs guest identity (data minimisation).
  // Daily digest — cron "0 8 * * *" — morning email per tenant with pending ops todos.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(purgeExpiredOrders(env));
    ctx.waitUntil(runTrialMaintenance(env));
    ctx.waitUntil(runTodoReminders(env));
    // Only run daily digest on the 8am cron, not the 15-min tick
    if (event.cron === '0 8 * * *') {
      ctx.waitUntil(runOpsDailyDigest(env));
    }
  },
};