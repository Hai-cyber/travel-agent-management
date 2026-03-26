import { Hono } from 'hono';
import { formatMoney, formatDateTime, translate, resolveLocaleFromAcceptLanguage } from './utils/formatter.js';
import {
  handleCreateServiceItem,
  handleGetServiceItems,
  handleUpdateServiceItem
} from './routes/serviceItems.js';
import registerTaskRoutes from "./routes/tasks.js";
import registerTenantRoutes from './routes/tenants.js';
import registerBookingRoutes, { purgeExpiredOrders } from './routes/bookings.js';
import registerTourRoutes from './routes/tours.js';
import registerCategoryRoutes from './routes/categories.js';
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
import { resolveTenantByHost, serveSitePage } from './lib/siteStudio.js';

const app = new Hono();

// ── UTF-8 enforcement middleware ─────────────────────────────────────────────
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
                t.target_currency AS display_currency, t.exchange_rate,
                t.pricing_policy, t.infant_policy_text,
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
        display_currency:   tenant.display_currency  ?? 'USD',
        exchange_rate:      tenant.exchange_rate      ?? 1,
        timezone:           tenant.timezone           ?? 'Asia/Ho_Chi_Minh',
        pricing_policy:     tenant.pricing_policy     ?? 'PRIORITY_HIGH_SEASON',
        infant_policy_text: tenant.infant_policy_text ?? null,
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

// Đăng ký các route cho Hono (Task, Pricing, Tenants)
registerTaskRoutes && registerTaskRoutes(app);
registerPricingRoutes && registerPricingRoutes(app);
registerTenantRoutes && registerTenantRoutes(app);
registerBookingRoutes && registerBookingRoutes(app);
registerTourRoutes && registerTourRoutes(app);
registerCategoryRoutes && registerCategoryRoutes(app);

const SERVICE_GROUPS = ['accommodations', 'meals', 'guides', 'local-transports', 'intercity-legs'];
const PRICING_GROUPS = ['tenant-seasons', 'pricing-segments', 'pax-bands', 'tour-prices'];

// ĐỊNH NGHĨA MẢNG PATTERNS ĐÚNG CÚ PHÁP
const patterns = [
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
  
  // Các route cho Pricing (POST)
  ...PRICING_GROUPS.map(group => ({
    method: 'POST',
    pattern: new URLPattern({ pathname: `/api/pricing/${group}` }),
    handler: (req, env, match) => handleCreatePricing(req, env, { group })
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
    handler: (req, env, match) => handleUpdatePricing(req, env, { 
      group, 
      itemId: match.pathname.groups.itemId 
    })
  })),

  // Xóa sau thử
  ...PRICING_GROUPS.map(group => ({
    method: 'DELETE',
    pattern: new URLPattern({ pathname: `/api/pricing/${group}/:itemId` }),
    handler: (req, env, match) => handleDeletePricing(req, env, { group, itemId: match.pathname.groups.itemId })
  })),
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ── Domain-based tenant routing ──────────────────────────────────────────
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
        // ── Path 1: Site Studio — live template render ────────────────────
        if (tenant.template_id) {
          return serveSitePage(tenant, env);
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
            return new Response(await obj.text(), {
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
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
        return p.handler(request, env, match);
      }
    }

    // Các route đặc biệt khác
    if (url.pathname === "/api/tours-preview") {
      const rows = await env.DB.prepare("SELECT * FROM tours LIMIT 5").all();
      return Response.json(rows.results);
    }

    // Nếu không khớp pattern nào, chuyển cho Hono xử lý
    return app.fetch(request, env, ctx);
  },

  // Scheduled purge — cron "*/15 * * * *" (configured in wrangler.jsonc triggers.crons)
  // Expires AWAITING_PROOF orders past payment_deadline; NULLs guest identity (data minimisation).
  async scheduled(event, env, ctx) {
    ctx.waitUntil(purgeExpiredOrders(env));
  },
};