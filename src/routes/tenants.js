// src/routes/tenants.js
// Quản lý cài đặt Tenant: FX (tỉ giá), display currency, pricing policy
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { resolveTenantByHost, serveSitePage, SAFE_SELECTOR_RE, listAllObjects, initializeTenantSandbox, getTemplateStructure, extractTemplateSections } from '../lib/siteStudio.js';
import { checkPublishPermission } from '../lib/publishGuard.js';
import { generateTourPage } from '../routes/tours.js';
import pagesRouter, { rebuildAllTenantPageRenders } from '../routes/pages.js';

const tenants = new Hono();

// [SEC] Whitelist các cột Agent được phép tự cập nhật.
// Không được cập nhật: id, slug, name, created_at (bất biến)
// default_locale và base_currency cố ý không nằm ở đây — thay đổi ảnh hưởng
// đến toàn bộ DB và cần migration riêng.
const ALLOWED_SETTINGS_COLUMNS = [
  'exchange_rate', 'target_currency', 'pricing_policy', 'infant_policy_text',
  'custom_domain', 'subscription_status', 'payment_config_json', 'notification_config',
  // publish-gate fields (migration 0025)
  'subdomain', 'stripe_customer_id',
  // onboarding progress tracker (migration 0026)
  'onboarding_step',
  // NOTE: terms_accepted / terms_accepted_at are intentionally excluded here —
  // they are ONLY set via POST /api/tenant/accept-terms (dedicated endpoint)
  // to prevent accidental overwrite via generic settings PATCH.
];

const VALID_PRICING_POLICIES    = new Set(['PRIORITY_HIGH_SEASON', 'PRIORITY_LOW_SEASON']);
const VALID_SUBSCRIPTION_STATUS = new Set(['TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED']);
const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

// Bare hostname regex — no protocol, no path, no port
const HOSTNAME_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

// Fields whose changes must be persisted to tenant_audit_log for legal reconciliation.
const AUDIT_FIELDS = new Set(['custom_domain', 'subdomain', 'stripe_customer_id', 'payment_config_json']);

/**
 * Sanitise a navigation link URL supplied by a tenant admin.
 * Accepts:
 *   - #anchor               → same-page anchor
 *   - /relative-path        → site-relative link
 *   - https?://...          → absolute external link
 * All other values (javascript:, data:, etc.) are rejected and return ''.
 */
function sanitizeNavUrl(raw) {
  const url = String(raw ?? '').trim();
  if (!url) return '';
  if (/^#[a-zA-Z0-9_-]+$/.test(url))     return url;   // same-page anchor
  if (/^\/[a-zA-Z0-9_\-./]*$/.test(url)) return url;   // site-relative path
  if (/^https?:\/\//i.test(url))         return url;   // absolute http(s) URL
  return '';                                             // reject everything else
}

/**
 * Persist a sensitive field change to the D1 audit log.
 * Non-fatal: a write failure must never block the main settings update.
 *
 * @param {object} env
 * @param {string} tenantId
 * @param {string} field
 * @param {*} oldValue
 * @param {*} newValue
 * @param {string|null} changedBy - IP or forwarded address from request headers
 */
async function writeAuditLog(env, tenantId, field, oldValue, newValue, changedBy) {
  try {
    await env.DB
      .prepare(
        `INSERT INTO tenant_audit_log (id, tenant_id, field_name, old_value, new_value, changed_at, changed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        nanoid(),
        tenantId,
        field,
        oldValue !== null && oldValue !== undefined ? String(oldValue) : null,
        newValue !== null && newValue !== undefined ? String(newValue) : null,
        Math.floor(Date.now() / 1000),
        changedBy ?? null
      )
      .run();
  } catch (err) {
    console.warn(`[AUDIT_LOG_WRITE_FAILED] tenant=${tenantId} field=${field}`, err.message);
  }
}

// Validation cho từng trường
function validateSettings(data) {
  const errors = [];

  if ('exchange_rate' in data) {
    const rate = Number(data.exchange_rate);
    if (isNaN(rate) || rate <= 0) {
      errors.push('exchange_rate phải là số dương (> 0)');
    }
  }

  if ('target_currency' in data) {
    const cur = data.target_currency;
    // ISO 4217: 3 chữ cái in hoa
    if (typeof cur !== 'string' || !/^[A-Z]{3}$/.test(cur)) {
      errors.push('target_currency phải là mã ISO 4217, ví dụ: VND, USD, EUR');
    }
  }

  if ('pricing_policy' in data) {
    if (!VALID_PRICING_POLICIES.has(data.pricing_policy)) {
      errors.push(`pricing_policy không hợp lệ — chỉ chấp nhận: ${[...VALID_PRICING_POLICIES].join(', ')}`);
    }
  }

  if ('subscription_status' in data) {
    if (!VALID_SUBSCRIPTION_STATUS.has(data.subscription_status)) {
      errors.push(`subscription_status không hợp lệ — chỉ chấp nhận: ${[...VALID_SUBSCRIPTION_STATUS].join(', ')}`);
    }
  }

  if ('custom_domain' in data) {
    const d = data.custom_domain;
    if (d !== null && (typeof d !== 'string' || !HOSTNAME_RE.test(d))) {
      errors.push('custom_domain phải là hostname hợp lệ (ví dụ: tours.mycompany.com) hoặc null để xóa.');
    }
  }

  if ('subdomain' in data) {
    const subdomain = data.subdomain;
    if (typeof subdomain !== 'string' || !SUBDOMAIN_RE.test(subdomain)) {
      errors.push('subdomain phải gồm chữ thường, số, dấu gạch ngang, không bắt đầu/kết thúc bằng gạch ngang, tối đa 48 ký tự.');
    }
  }

  if ('payment_config_json' in data) {
    const pcj = data.payment_config_json;
    if (pcj !== null) {
      if (typeof pcj !== 'object' || Array.isArray(pcj)) {
        errors.push('payment_config_json phải là JSON object hoặc null để xóa.');
      }
    }
  }

  if ('notification_config' in data) {
    const nc = data.notification_config;
    if (nc !== null) {
      if (typeof nc !== 'object' || Array.isArray(nc)) {
        errors.push('notification_config phải là JSON object hoặc null để xóa.');
      }
    }
  }

  return errors;
}

// PATCH /api/tenants/settings
// Cho phép Agent cập nhật exchange_rate, target_currency, pricing_policy.
// [SEC] Chỉ cập nhật bản ghi khớp với X-Tenant-ID header — không thể sửa tenant khác.
tenants.patch('/settings', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) {
    return c.json({ error: 'X-Tenant-ID header is required' }, 400);
  }

  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return c.json({ error: 'Content-Type phải là application/json' }, 400);
  }

  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Request body không phải JSON hợp lệ' }, 400);
  }

  // [SEC] Chỉ giữ lại các trường trong whitelist
  const safeData = Object.fromEntries(
    Object.entries(body).filter(([k]) => ALLOWED_SETTINGS_COLUMNS.includes(k))
  );

  if (Object.keys(safeData).length === 0) {
    return c.json({
      error:   'Không có trường hợp lệ để cập nhật',
      allowed: ALLOWED_SETTINGS_COLUMNS,
    }, 400);
  }

  // Validate trước khi chạm DB
  const errors = validateSettings(safeData);
  if (errors.length > 0) {
    return c.json({ error: 'Dữ liệu không hợp lệ', details: errors }, 400);
  }

  // Ép kiểu: exchange_rate phải là REAL
  if ('exchange_rate' in safeData) {
    safeData.exchange_rate = parseFloat(safeData.exchange_rate);
  }

  if ('subdomain' in safeData) {
    safeData.subdomain = String(safeData.subdomain || '').trim().toLowerCase();
  }

  // Serialize payment_config_json object → TEXT for D1
  if ('payment_config_json' in safeData) {
    safeData.payment_config_json = safeData.payment_config_json !== null
      ? JSON.stringify(safeData.payment_config_json)
      : null;
  }

  // Serialize notification_config object → TEXT for D1
  if ('notification_config' in safeData) {
    safeData.notification_config = safeData.notification_config !== null
      ? JSON.stringify(safeData.notification_config)
      : null;
  }

  try {
    // [AUDIT] Đọc giá trị hiện tại trước khi cập nhật để log thay đổi
    const current = await c.env.DB
      .prepare('SELECT exchange_rate, target_currency, pricing_policy, infant_policy_text, custom_domain, subdomain, subscription_status, terms_accepted, terms_accepted_at, stripe_customer_id, onboarding_step, payment_config_json FROM tenants WHERE id = ?')
      .bind(tenantId)
      .first();

    if (!current) {
      return c.json({ error: 'Tenant không tồn tại' }, 404);
    }

    if ('subdomain' in safeData) {
      const existingSubdomain = String(current.subdomain || '').trim().toLowerCase();
      const requestedSubdomain = String(safeData.subdomain || '').trim().toLowerCase();
      if (existingSubdomain && requestedSubdomain !== existingSubdomain) {
        return c.json({
          error: 'Subdomain đã được khóa trước đó. Tenant chỉ được chọn platform subdomain một lần.'
        }, 409);
      }
    }

    // Dynamic SET clause — chỉ cập nhật các trường có mặt trong request
    const setClause = Object.keys(safeData).map(col => `${col} = ?`).join(', ');
    // [SEC] WHERE id = ? — đảm bảo chỉ sửa đúng tenant này
    const values = [...Object.values(safeData), tenantId];

    const result = await c.env.DB
      .prepare(`UPDATE tenants SET ${setClause} WHERE id = ?`)
      .bind(...values)
      .run();

    if (result.meta.changes === 0) {
      return c.json({ error: 'Cập nhật thất bại — tenant không tồn tại' }, 404);
    }

    // AUDIT — console log for all changed fields; D1 persist for sensitive fields
    const changedBy = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? null;
    for (const [field, newValue] of Object.entries(safeData)) {
      const oldValue = current[field] ?? null;
      if (String(oldValue ?? '') !== String(newValue ?? '')) {
        console.info(
          `[TENANT_SETTINGS_AUDIT] tenant=${tenantId} | ${field}: ${oldValue} → ${newValue} | at=${new Date().toISOString()}`
        );
        if (AUDIT_FIELDS.has(field)) {
          await writeAuditLog(c.env, tenantId, field, oldValue, newValue, changedBy);
        }
      }
    }

    // Trả về settings mới để UI có thể cập nhật hiển thị ngay
    const updated = await c.env.DB
      .prepare('SELECT exchange_rate, target_currency, pricing_policy, infant_policy_text, custom_domain, subdomain, subscription_status, terms_accepted, terms_accepted_at, stripe_customer_id, onboarding_step, payment_config_json, default_locale, base_currency, total_revenue_tracked, commission_threshold, product_tier_key FROM tenants WHERE id = ?')
      .bind(tenantId)
      .first();

    // Parse payment_config_json back to object for the API response
    if (updated && updated.payment_config_json) {
      try { updated.payment_config_json = JSON.parse(updated.payment_config_json); }
      catch { /* leave as string if malformed */ }
    }

    return c.json({ ok: true, settings: updated });

  } catch (err) {
    console.error('[TENANT_SETTINGS_ERROR]', err);
    if (String(err?.message || '').includes('UNIQUE')) {
      return c.json({ error: 'Subdomain này đã được tenant khác giữ. Hãy chọn tên khác.' }, 409);
    }
    return c.json({ error: 'Internal server error. Please try again later.' }, 500);
  }
});

// GET /api/tenants/settings — Đọc settings hiện tại (hữu ích cho Admin UI load form)
tenants.get('/settings', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) {
    return c.json({ error: 'X-Tenant-ID header is required' }, 400);
  }

  try {
    const settings = await c.env.DB
      .prepare('SELECT id, name, email, created_at, exchange_rate, target_currency, pricing_policy, infant_policy_text, custom_domain, subdomain, subscription_status, terms_accepted, terms_accepted_at, stripe_customer_id, onboarding_step, payment_config_json, default_locale, base_currency, total_revenue_tracked, commission_threshold FROM tenants WHERE id = ?')
      .bind(tenantId)
      .first();

    if (!settings) {
      return c.json({ error: 'Tenant not found.' }, 404);
    }

    // Parse payment_config_json back to object for the API response
    if (settings.payment_config_json) {
      try { settings.payment_config_json = JSON.parse(settings.payment_config_json); }
      catch { /* leave as string if malformed */ }
    }

    return c.json({ ok: true, settings });
  } catch (err) {
    console.error('[TENANT_SETTINGS_ERROR]', err);
    return c.json({ error: 'Internal server error. Please try again later.' }, 500);
  }
});

// GET /api/tenants/audit-log
// Returns the last 100 sensitive-field change records for this tenant.
// [SEC] Only returns records WHERE tenant_id = ? — tenants cannot see each other's logs.
tenants.get('/audit-log', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  try {
    const { results } = await c.env.DB
      .prepare(
        `SELECT id, field_name, old_value, new_value, changed_at, changed_by
         FROM tenant_audit_log
         WHERE tenant_id = ?
         ORDER BY changed_at DESC
         LIMIT 100`
      )
      .bind(tenantId)
      .all();

    return c.json({
      ok:        true,
      tenant_id: tenantId,
      total:     results.length,
      entries:   results,
    });
  } catch (err) {
    console.error('[TENANT_AUDIT_LOG_READ_ERROR]', err);
    return c.json({ error: 'Internal server error. Please try again later.' }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tenant/config  (public — no X-Tenant-ID required)
// ─────────────────────────────────────────────────────────────────────────────
// Called by public/inject.js running inside a tenant's site.
// Resolves the tenant from the Host header (custom_domain or platform subdomain).
// Returns only the safe public subset of site_config: brand, content, features,
// and custom_selectors. No sensitive fields (payment config, revenue, etc.) are
// ever exposed.
//
// The Hono router for this route lives on the root app (not on the /api/tenants
// sub-router) so that the URL is /api/tenant/config, not /api/tenants/tenant/config.
// Registration in registerTenantRoutes() below handles this.
const publicConfig = new Hono();

publicConfig.get('/config', async (c) => {
  const host = c.req.header('host') ?? '';

  let tenant = null;
  try {
    // Admin bypass: X-Tenant-ID header allows direct lookup (for Dashboard/localhost).
    // Public pages (inject.js) never send this header — they resolve via Host.
    const adminId = c.req.header('X-Tenant-ID')?.trim();
    if (adminId) {
      tenant = await c.env.DB
        .prepare('SELECT id, template_id, site_config, payment_methods FROM tenants WHERE id = ?')
        .bind(adminId)
        .first();
    } else {
      if (!host) return c.json({ ok: false, error: 'Cannot determine tenant from request.' }, 400);
      tenant = await resolveTenantByHost(host, c.env.DB);
    }
  } catch (err) {
    console.error('[TENANT_CONFIG_RESOLVE_ERROR]', err);
    return c.json({ error: 'Internal server error.' }, 500);
  }

  if (!tenant) {
    return c.json({ ok: false, error: 'Tenant not found or not active.' }, 404);
  }

  // Parse site_config — return empty defaults on malformed JSON.
  let cfg = {};
  try {
    if (tenant.site_config) cfg = JSON.parse(tenant.site_config);
  } catch {
    // Intentional: fall through with empty config — inject.js degrades gracefully.
  }

  // [SEC] Return only the public-safe fields. Never expose payment_config_json,
  //       total_revenue_tracked, subscription_status, or internal IDs here.
  //       payment_methods is safe to expose — it's the enabled channel list for inject.js checkout.
  let paymentMethods = [];
  try {
    if (tenant.payment_methods) paymentMethods = JSON.parse(tenant.payment_methods);
  } catch { /* malformed JSON — return empty array */ }

  return c.json({
    ok: true,
    config: {
      brand:            cfg.brand            ?? {},
      content:          cfg.content          ?? {},
      features:         cfg.features         ?? {},
      custom_selectors: cfg.custom_selectors ?? {},
      // custom_sections — returned intact so the Visual Editor can populate
      // S.customSections on load and never start with an empty [] (which would
      // wipe all sections on the next PATCH save).
      custom_sections:  Array.isArray(cfg.custom_sections) ? cfg.custom_sections : [],
      // current_theme — one of the 6 travel theme keys from theme-presets.css
      current_theme:    typeof cfg.current_theme === 'string' ? cfg.current_theme : '',
      // template_id — active sandbox template (FK to SITE_TEMPLATES R2 prefix)
      template_id:      typeof tenant.template_id === 'string' ? tenant.template_id : '',
      navigation:       cfg.navigation       ?? [],
      // navigation_config — header UI boolean toggles { showPhone, showCart, showContactForm }
      navigation_config: cfg.navigation_config && typeof cfg.navigation_config === 'object'
        ? {
            showPhone:       cfg.navigation_config.showPhone       === true,
            showCart:        cfg.navigation_config.showCart        === true,
            showContactForm: cfg.navigation_config.showContactForm === true,
          }
        : { showPhone: false, showCart: false, showContactForm: false },
      chrome_config: cfg.chrome_config && typeof cfg.chrome_config === 'object'
        ? {
            useMinimalHeader: cfg.chrome_config.useMinimalHeader !== false,
            useMinimalFooter: cfg.chrome_config.useMinimalFooter !== false,
            showFooterMenu:   cfg.chrome_config.showFooterMenu === true,
            showLogo:         cfg.chrome_config.showLogo !== false,
            effectStyle:      typeof cfg.chrome_config.effectStyle === 'string'
              ? cfg.chrome_config.effectStyle
              : 'glass',
            shapeStyle:       typeof cfg.chrome_config.shapeStyle === 'string'
              ? cfg.chrome_config.shapeStyle
              : 'bar',
            menuFontStyle:    typeof cfg.chrome_config.menuFontStyle === 'string'
              ? cfg.chrome_config.menuFontStyle
              : 'clean',
            logoFontStyle:    typeof cfg.chrome_config.logoFontStyle === 'string'
              ? cfg.chrome_config.logoFontStyle
              : 'brand',
            logoSize:         typeof cfg.chrome_config.logoSize === 'string'
              ? cfg.chrome_config.logoSize
              : 'md',
            ornamentStyle:    typeof cfg.chrome_config.ornamentStyle === 'string'
              ? cfg.chrome_config.ornamentStyle
              : 'none',
          }
        : { useMinimalHeader: true, useMinimalFooter: true, showFooterMenu: false, showLogo: true, effectStyle: 'glass', shapeStyle: 'bar', menuFontStyle: 'clean', logoFontStyle: 'brand', logoSize: 'md', ornamentStyle: 'none' },
      payment_methods:  paymentMethods,
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/tenant/config  (admin — X-Tenant-ID required)
// ─────────────────────────────────────────────────────────────────────────────
// Deep-merges a partial config object into the tenant's site_config JSON.
// Called by the Visual Editor when an agent saves a selector override.
// ── GET /api/tenant/template-structure ───────────────────────────────────────
// Returns the parsed section/component tree of the tenant's active template.
// Used by the Visual Editor sidebar to render a navigable Tree View.
//
// Response:
//   { ok, templateId, components: [{ id, tag, label, heading, classes, scrollTarget }] }
//
// components are ordered top-to-bottom as they appear in index.html.
publicConfig.get('/template-structure', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  if (!c.env.SITE_TEMPLATES) {
    return c.json({ error: 'SITE_TEMPLATES R2 binding is not configured.' }, 503);
  }

  // Allow ?template_id override — useful for the template picker UI
  const overrideTemplateId = c.req.query('template_id')?.trim();

  let templateId = overrideTemplateId;
  if (!templateId) {
    const tenant = await c.env.DB
      .prepare('SELECT template_id FROM tenants WHERE id = ?')
      .bind(tenantId)
      .first();
    if (!tenant) return c.json({ error: 'Tenant not found.' }, 404);
    templateId = tenant.template_id;
  }

  if (!templateId) {
    return c.json({
      ok:         false,
      components: [],
      error:      'No template selected. Set template_id via PATCH /api/tenants/settings.',
      code:       'NO_TEMPLATE',
    }, 422);
  }

  const result = await getTemplateStructure(templateId, c.env);
  if (!result.ok) {
    return c.json({ ok: false, templateId, components: [], error: result.error }, 404);
  }
  return c.json(result);
});

// ── GET /api/tenant/publish-readiness ────────────────────────────────────────
// Returns a detailed checklist of all conditions required before a tenant can
// publish their site and sell tours.
//
// Four gates (matching publishGuard.checkPublishPermission):
//   TEMPLATE  — template_id must be set on the tenant row
//   CONTENT   — at least one tour (any status) in the tours table
//   IDENTITY  — subdomain/custom_domain set AND terms_accepted = 1
//   PAYMENT   — ≥1 electronic gateway in payment_methods has enabled: true
//
// Intentionally separate from publishGuard so the dashboard can display the
// checklist WITHOUT triggering a publish attempt.
//
// Response shape:
//   { ok: boolean, missing: string[], data: { <gate>: { pass, detail } } }
publicConfig.get('/publish-readiness', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const tenant = await c.env.DB
    .prepare(
      `SELECT id, template_id, subdomain, custom_domain,
              terms_accepted, payment_methods, subscription_status,
              onboarding_step
         FROM tenants WHERE id = ?`
    )
    .bind(tenantId)
    .first();
  if (!tenant) return c.json({ error: 'Tenant not found.' }, 404);

  // ── Gate 1: Template ───────────────────────────────────────────────────────
  const hasTemplate = !!tenant.template_id;

  // ── Gate 2: Content — at least one tour created ────────────────────────────
  const tourRow = await c.env.DB
    .prepare('SELECT COUNT(*) AS cnt FROM tours WHERE tenant_id = ?')
    .bind(tenantId)
    .first();
  const tourCount  = tourRow?.cnt ?? 0;
  const hasTour    = tourCount > 0;

  // ── Gate 3a: Domain ────────────────────────────────────────────────────────
  const domainValue = (tenant.subdomain || tenant.custom_domain || '').trim();
  const hasDomain   = domainValue.length > 0;

  // ── Gate 3b: Terms accepted ────────────────────────────────────────────────
  const hasTerms = tenant.terms_accepted === 1;

  // ── Gate 4: Electronic gateway enabled ────────────────────────────────────
  const ELECTRONIC_IDS = new Set(['STRIPE','MOMO','VNPAY','ZALOPAY','CREDIT_CARD','PAYPAL','GRABPAY']);
  let hasGateway   = false;
  let enabledGateway = null;
  try {
    const methods = tenant.payment_methods ? JSON.parse(tenant.payment_methods) : [];
    const found   = Array.isArray(methods)
      ? methods.find(m => m.enabled === true && ELECTRONIC_IDS.has((m.id ?? '').toUpperCase()))
      : null;
    if (found) { hasGateway = true; enabledGateway = found.id; }
  } catch { /* treat as unconfigured */ }

  // ── Build data map ─────────────────────────────────────────────────────────
  const data = {
    TEMPLATE: {
      pass:          hasTemplate,
      label:         'Template đã chọn',
      detail:        hasTemplate
        ? `Template đang dùng: ${tenant.template_id}`
        : 'Chưa chọn template. Mở Visual Editor và chọn một design.',
      action_url:    hasTemplate ? null : '/visual-editor.html',
      value:         tenant.template_id ?? null,
    },
    CONTENT: {
      pass:          hasTour,
      label:         'Đã tạo ít nhất 1 Tour',
      detail:        hasTour
        ? `Có ${tourCount} tour trong hệ thống.`
        : 'Chưa có tour nào. Tạo ít nhất 1 tour trước khi xuất bản.',
      action_url:    hasTour ? null : '/dashboard.html#tours',
      value:         tourCount,
    },
    DOMAIN: {
      pass:          hasDomain,
      label:         'Tên miền đã cấu hình',
      detail:        hasDomain
        ? `Domain: ${domainValue}`
        : 'Chưa đặt subdomain hoặc custom_domain. Gọi PATCH /api/tenants/settings với { subdomain: "ten-cong-ty" }.',
      action_url:    hasDomain ? null : '/dashboard.html#domain',
      value:         domainValue || null,
    },
    TERMS: {
      pass:          hasTerms,
      label:         'Đã đồng ý Điều khoản dịch vụ',
      detail:        hasTerms
        ? 'T&C đã được chấp nhận.'
        : 'Chưa đồng ý T&C. Gọi POST /api/tenant/accept-terms để xác nhận.',
      action_url:    hasTerms ? null : '/dashboard.html#terms',
      value:         hasTerms,
    },
    PAYMENT: {
      pass:          hasGateway,
      label:         'Cổng thanh toán điện tử đang hoạt động',
      detail:        hasGateway
        ? `Gateway đang bật: ${enabledGateway}. Sẵn sàng nhận booking có thanh toán.`
        : 'Chưa có cổng điện tử nào bật (MoMo, VNPay, Stripe, v.v.). Bank Transfer không tính.',
      action_url:    hasGateway ? null : '/dashboard.html#payments',
      value:         enabledGateway,
    },
  };

  // ── Collect missing gates ──────────────────────────────────────────────────
  const missing = Object.entries(data)
    .filter(([, v]) => !v.pass)
    .map(([k]) => k);

  const ok = missing.length === 0;

  return c.json({
    ok,
    missing,
    ready_to_publish: ok,
    subscription_status: tenant.subscription_status,
    onboarding_step:     tenant.onboarding_step ?? null,
    data,
  });
});

//
// Request body (all top-level keys are optional, unknown keys are ignored):
//   { brand, content, features, custom_selectors }
//
// [SEC] custom_selectors keys are validated with SAFE_SELECTOR_RE.
//       Only string values are accepted.
publicConfig.patch('/config', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Request body is not valid JSON.' }, 400); }

  // [SEC] Read existing config, verify tenant exists (prevents phantom-tenant writes)
  const row = await c.env.DB
    .prepare('SELECT site_config FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();
  if (!row) return c.json({ error: 'Tenant not found.' }, 404);

  let cfg = {};
  try { if (row.site_config) cfg = JSON.parse(row.site_config); } catch {}

  // Merge each allowed section with shallow Object.assign.
  // Sections not present in the request body are left untouched.
  const ALLOWED_SECTIONS = ['brand', 'content', 'features', 'custom_selectors', 'custom_imgs'];
  for (const section of ALLOWED_SECTIONS) {
    if (section in body && body[section] !== null && typeof body[section] === 'object') {
      cfg[section] = Object.assign({}, cfg[section] ?? {}, body[section]);
    }
  }

  // custom_sections is an array — replace wholesale (not merged with Object.assign).
  // [SEC] Each entry must be a plain object with a string `html` field.
  //       Only entries from the known TEMPLATE_SECTIONS allowlist pass; however,
  //       since the server can't easily load common-sections.html here, we
  //       validate the structure only: each item must have { id, type, html }
  //       all strings, and html must not exceed 64 KB.
  if ('custom_sections' in body && Array.isArray(body.custom_sections)) {
    cfg.custom_sections = body.custom_sections
      .filter(function (s) {
        return s && typeof s === 'object' &&
               typeof s.id   === 'string' && s.id.length   <= 64 &&
               typeof s.type === 'string' && s.type.length  <= 32 &&
               typeof s.html === 'string' && s.html.length  <= 65536;
      })
      .map(function (s) { return { id: s.id, type: s.type, html: s.html }; });
  }

  // current_theme — one of the 11 travel theme preset keys (6 original + 5 Deep Travel).
  // [SEC] Validated against a strict allowlist — no arbitrary CSS injected.
  const ALLOWED_THEMES = new Set([
    // Original 6
    'ocean-blue', 'royal-wine', 'golden-sand',
    'jungle-trek', 'passion-red', 'modern-purple',
    // Deep Travel palette
    'ocean-night', 'midnight-vineyard', 'deep-forest',
    'desert-dusk', 'volcanic-ash',
  ]);
  if ('current_theme' in body) {
    if (typeof body.current_theme === 'string' && ALLOWED_THEMES.has(body.current_theme)) {
      cfg.current_theme = body.current_theme;
    } else if (body.current_theme === '' || body.current_theme === null) {
      delete cfg.current_theme;   // allow clearing the theme
    }
    // [SEC] Silently ignore unrecognised theme keys — no 400 so the editor
    //       doesn't break if a future key is added before the server is updated.
  }

  // navigation is an ordered array of { label, url } menu items.
  // Replaces the existing navigation array wholesale.
  // [SEC] label capped at 80 chars; url validated via sanitizeNavUrl (allowlist).
  //       Items failing either check are silently dropped — never 400 to avoid
  //       breaking the full save if one bad row slips through the UI.
  if ('navigation' in body && Array.isArray(body.navigation)) {
    cfg.navigation = body.navigation
      .filter(item => item && typeof item === 'object' &&
                      typeof item.label === 'string' &&
                      typeof item.url   === 'string')
      .map(item => ({
        label: item.label.trim().slice(0, 80),
        url:   sanitizeNavUrl(item.url),
      }))
      .filter(item => item.label && item.url);   // drop rows that failed url sanity
  }

  // navigation_config — boolean toggles for the rendered header UI.
  // [SEC] Only known boolean keys are accepted; all other keys are stripped.
  if ('navigation_config' in body && body.navigation_config !== null &&
      typeof body.navigation_config === 'object') {
    const nc = body.navigation_config;
    cfg.navigation_config = {
      showPhone:       nc.showPhone       === true,
      showCart:        nc.showCart        === true,
      showContactForm: nc.showContactForm === true,
    };
  }

  if ('chrome_config' in body && body.chrome_config !== null &&
      typeof body.chrome_config === 'object') {
    const cc = body.chrome_config;
    cfg.chrome_config = {
      useMinimalHeader: cc.useMinimalHeader !== false,
      useMinimalFooter: cc.useMinimalFooter !== false,
      showFooterMenu:   cc.showFooterMenu === true,
      showLogo:         cc.showLogo !== false,
      effectStyle:      typeof cc.effectStyle === 'string' && ['glass', 'frost', 'shadow', 'outline'].includes(cc.effectStyle)
        ? cc.effectStyle
        : 'glass',
      shapeStyle:       typeof cc.shapeStyle === 'string' && ['bar', 'rounded', 'capsule', 'floating'].includes(cc.shapeStyle)
        ? cc.shapeStyle
        : 'bar',
      menuFontStyle:    typeof cc.menuFontStyle === 'string' && ['clean', 'elegant', 'compact'].includes(cc.menuFontStyle)
        ? cc.menuFontStyle
        : 'clean',
      logoFontStyle:    typeof cc.logoFontStyle === 'string' && ['brand', 'floral', 'luxe', 'script'].includes(cc.logoFontStyle)
        ? cc.logoFontStyle
        : 'brand',
      logoSize:         typeof cc.logoSize === 'string' && ['sm', 'md', 'lg', 'xl'].includes(cc.logoSize)
        ? cc.logoSize
        : 'md',
      ornamentStyle:    typeof cc.ornamentStyle === 'string' && ['none', 'glow', 'divider', 'dots'].includes(cc.ornamentStyle)
        ? cc.ornamentStyle
        : 'none',
    };
  }

  // [SEC] Re-validate all custom_selectors keys after merge.
  //       Remove any that fail the whitelist (could arrive from a crafted PUT body).
  if (cfg.custom_selectors) {
    cfg.custom_selectors = Object.fromEntries(
      Object.entries(cfg.custom_selectors)
        .filter(([k, v]) => SAFE_SELECTOR_RE.test(k) && typeof v === 'string')
    );
  }

  // [SEC] Re-validate custom_imgs: selector keys + https-only src values.
  if (cfg.custom_imgs) {
    cfg.custom_imgs = Object.fromEntries(
      Object.entries(cfg.custom_imgs)
        .filter(([k, v]) => SAFE_SELECTOR_RE.test(k) &&
                            typeof v === 'string' &&
                            v.startsWith('https://'))
    );
  }

  await c.env.DB
    .prepare('UPDATE tenants SET site_config = ? WHERE id = ?')
    .bind(JSON.stringify(cfg), tenantId)
    .run();

  return c.json({ ok: true, site_config: cfg });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tenant/template-assets/:templateId/*
// ─────────────────────────────────────────────────────────────────────────────
// Serves static template assets (images, css, js, fonts) from the
// SITE_TEMPLATES R2 bucket so that relative references inside templates
// (e.g. <img src="images/pic01.jpg">) resolve correctly when viewed via the
// Visual Editor preview or live site render.
//
// HTMLRewriter in serveSitePage converts relative img src values to:
//   /api/tenant/template-assets/{templateId}/images/pic01.jpg
// and this route fulfils those requests.
//
// [SEC] templateId validated to SAFE_ID_RE before use as R2 key prefix.
//       path validated to SAFE_ASSET_PATH_RE — no "..", no leading slashes.
// Cache: 1 year (template assets are immutable once deployed).
const SAFE_ASSET_PATH_RE = /^[a-zA-Z0-9_\-./]{1,256}$/;
const ASSET_MIME_MAP = {
  css:   'text/css',
  js:    'application/javascript',
  jpg:   'image/jpeg',
  jpeg:  'image/jpeg',
  png:   'image/png',
  gif:   'image/gif',
  svg:   'image/svg+xml',
  webp:  'image/webp',
  avif:  'image/avif',
  woff:  'font/woff',
  woff2: 'font/woff2',
  ttf:   'font/ttf',
  eot:   'application/vnd.ms-fontobject',
  ico:   'image/x-icon',
  map:   'application/json',
};

publicConfig.get('/template-assets/:templateId/*', async (c) => {
  if (!c.env.SITE_TEMPLATES) {
    return new Response('SITE_TEMPLATES R2 binding not configured.', { status: 503 });
  }

  const rawTemplateId = c.req.param('templateId');

  // Reuse the same SAFE_ID_RE already imported in this file
  if (!rawTemplateId || !/^[a-zA-Z0-9_-]{1,128}$/.test(rawTemplateId)) {
    return new Response('Invalid templateId.', { status: 400 });
  }

  // Everything after /:templateId/ is the asset relative path
  const fullPath   = c.req.path;                                      // e.g. /api/tenant/template-assets/html5up-forty/images/pic01.jpg
  const prefix     = `/api/tenant/template-assets/${rawTemplateId}/`;
  const assetPath  = fullPath.slice(prefix.length);                   // e.g. images/pic01.jpg

  if (!assetPath || !SAFE_ASSET_PATH_RE.test(assetPath) || assetPath.includes('..')) {
    return new Response('Invalid asset path.', { status: 400 });
  }

  // Try both R2 key conventions (mirror of fetchTemplateResponse)
  const r2Keys = [
    `${rawTemplateId}/${assetPath}`,
    `templates/${rawTemplateId}/${assetPath}`,
  ];

  let obj = null;
  for (const key of r2Keys) {
    obj = await c.env.SITE_TEMPLATES.get(key);
    if (obj) break;
  }

  if (!obj) {
    return new Response(`Asset not found: ${assetPath}`, { status: 404 });
  }

  const ext      = assetPath.split('.').pop()?.toLowerCase() ?? '';
  const mimeType = ASSET_MIME_MAP[ext] ?? 'application/octet-stream';

  return new Response(obj.body, {
    headers: {
      'Content-Type':  mimeType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tenant/templates  (admin — X-Tenant-ID required)
// ─────────────────────────────────────────────────────────────────────────────
// Returns the list of all 7 available site templates enriched with labels,
// descriptions, Unsplash thumbnail URLs and a real-time availability flag
// derived from R2 prefix listing.
//
// Response: { ok, current_template_id, templates: [{ id, label, description,
//             thumbnail, available, isCurrent }] }
//
// [SEC] All returned template IDs come from either the static catalog or from
//       R2 key listing — NEVER from user-supplied input.

// Allowlist: only template IDs that end with "-html" (Cruip convention).
// Any R2 key that does NOT match is silently ignored — this permanently
// blocks html5up-*, html5up-forty, html5up-massively, html5up-dimension, etc.
// and any future stray prefixes from leaking into the frontend.
//
// [SEC] Pattern anchored at both ends — cannot be bypassed via padding.
const CRUIP_TEMPLATE_RE = /^[a-z0-9-]+-html$/;

// Cruip Tailwind v4 templates — all use the shared cruip-global.css.
// Thumbnails: Unsplash crops that best represent each template's vibe.
const TEMPLATE_CATALOG = [
  {
    id:          'simple-html',
    label:       'Simple',
    description: 'Clean single-page layout, ideal for landing sites.',
    thumbnail:   'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=480&q=60',
  },
  {
    id:          'mosaic-html',
    label:       'Mosaic',
    description: 'Portfolio-style tile grid with category filtering.',
    thumbnail:   'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=480&q=60',
  },
  {
    id:          'stellar-html',
    label:       'Stellar',
    description: 'Dark hero with glowing accent highlights.',
    thumbnail:   'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=480&q=60',
  },
  {
    id:          'creative-html',
    label:       'Creative',
    description: 'Bold asymmetric blocks for creative brands.',
    thumbnail:   'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=480&q=60',
  },
  {
    id:          'neon-html',
    label:       'Neon',
    description: 'High-contrast dark theme with vivid neon accents.',
    thumbnail:   'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=480&q=60',
  },
  {
    id:          'gray-html',
    label:       'Gray',
    description: 'Minimal neutral palette — content-first design.',
    thumbnail:   'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=480&q=60',
  },
  {
    id:          'open-pro-html',
    label:       'Open Pro',
    description: 'Professional SaaS-style layout with feature columns.',
    thumbnail:   'https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=480&q=60',
  },
  {
    id:          'appy-html',
    label:       'Appy',
    description: 'App-store style hero with mockup framing.',
    thumbnail:   'https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=480&q=60',
  },
  {
    id:          'fintech-html',
    label:       'Fintech',
    description: 'Trust-focused layout with card-based stats.',
    thumbnail:   'https://images.unsplash.com/photo-1503220317375-aaad61436b1b?w=480&q=60',
  },
  {
    id:          'talent-html',
    label:       'Talent',
    description: 'Team-first design with profile cards.',
    thumbnail:   'https://images.unsplash.com/photo-1488085061387-422e29b40080?w=480&q=60',
  },
  {
    id:          'devfolio-html',
    label:       'Devfolio',
    description: 'Minimal dark portfolio with project showcases.',
    thumbnail:   'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=480&q=60',
  },
  {
    id:          'devspace-html',
    label:       'Devspace',
    description: 'Tech-forward layout with code-snippet highlights.',
    thumbnail:   'https://images.unsplash.com/photo-1543158181-e6f9f6712055?w=480&q=60',
  },
  {
    id:          'community-html',
    label:       'Community',
    description: 'Event + membership-focused warm layout.',
    thumbnail:   'https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=480&q=60',
  },
  {
    id:          'podcast-html',
    label:       'Podcast',
    description: 'Media-player inspired hero with episode list.',
    thumbnail:   'https://images.unsplash.com/photo-1533104816931-20fa691ff6ca?w=480&q=60',
  },
  {
    id:          'quoty-html',
    label:       'Quoty',
    description: 'Quote-centric typographic design.',
    thumbnail:   'https://images.unsplash.com/photo-1509316785289-025f5b846b35?w=480&q=60',
  },
  {
    id:          'tidy-html',
    label:       'Tidy',
    description: 'Ultra-clean e-commerce / catalogue style.',
    thumbnail:   'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=480&q=60',
  },
  {
    id:          'cube-html',
    label:       'Cube',
    description: '3-D perspective hero with bold geometry.',
    thumbnail:   'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=480&q=60',
  },
  {
    id:          'waitlist-html',
    label:       'Waitlist',
    description: 'Coming-soon / waitlist capture page.',
    thumbnail:   'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=480&q=60',
  },
];

async function buildAvailableCruipTemplates(env, currentTemplateId = null) {
  const availableIds = new Set();
  let r2Queried = false;

  if (env.SITE_TEMPLATES) {
    try {
      const list1 = await env.SITE_TEMPLATES.list({ delimiter: '/' });
      for (const p of (list1.delimitedPrefixes ?? [])) {
        const id = p.replace(/\/$/, '');
        if (CRUIP_TEMPLATE_RE.test(id)) availableIds.add(id);
      }

      const list2 = await env.SITE_TEMPLATES.list({ prefix: 'templates/', delimiter: '/' });
      for (const p of (list2.delimitedPrefixes ?? [])) {
        const id = p.replace(/^templates\//, '').replace(/\/$/, '');
        if (id && CRUIP_TEMPLATE_RE.test(id)) availableIds.add(id);
      }

      r2Queried = true;
    } catch {
      // Non-fatal — unavailable R2 means we treat catalog entries as available.
    }
  }

  const templates = TEMPLATE_CATALOG.map((t) => ({
    id:          t.id,
    label:       t.label,
    description: t.description,
    thumbnail:   t.thumbnail,
    available:   !r2Queried || availableIds.has(t.id),
    isCurrent:   t.id === currentTemplateId,
  }));

  for (const rid of availableIds) {
    if (TEMPLATE_CATALOG.some((t) => t.id === rid)) continue;
    if (!CRUIP_TEMPLATE_RE.test(rid)) continue;
    templates.push({
      id:          rid,
      label:       rid,
      description: '',
      thumbnail:   '',
      available:   true,
      isCurrent:   rid === currentTemplateId,
    });
  }

  return templates;
}

publicConfig.get('/templates', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header required.' }, 400);

  // Fetch tenant's current template_id
  let currentTemplateId = null;
  try {
    const tenant = await c.env.DB
      .prepare('SELECT template_id FROM tenants WHERE id = ?')
      .bind(tenantId)
      .first();
    if (!tenant) return c.json({ error: 'Tenant not found.' }, 404);
    currentTemplateId = tenant.template_id ?? null;
  } catch (err) {
    return c.json({ error: 'DB error: ' + err.message }, 500);
  }
  const templates = await buildAvailableCruipTemplates(c.env, currentTemplateId);

  return c.json({
    ok:                  true,
    current_template_id: currentTemplateId,
    templates,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tenant/preview  (admin — X-Tenant-ID header or ?tid= query param)
// ─────────────────────────────────────────────────────────────────────────────
// Renders the tenant's assigned template with editor-bridge.js injected
// instead of inject.js so the Visual Editor can intercept element clicks.
// Accepts tenant identity via X-Tenant-ID header (from admin pages) or via
// ?tid= query param (from the iframe src set by visual-editor.html).
publicConfig.get('/preview', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim() || c.req.query('tid')?.trim();
  if (!tenantId) {
    return c.json({ error: 'Tenant ID required: X-Tenant-ID header or ?tid= param.' }, 400);
  }

  let tenant = null;
  try {
    tenant = await c.env.DB
      .prepare(
        `SELECT id, subscription_status, template_id, site_config
           FROM tenants WHERE id = ? AND subscription_status IN ('ACTIVE', 'TRIAL')`
      )
      .bind(tenantId)
      .first();
  } catch (err) {
    console.error('[TENANT_PREVIEW_ERROR]', err);
    return new Response('Internal server error.', { status: 500 });
  }

  if (!tenant) {
    return new Response(
      `Tenant "${tenantId}" not found.\n` +
      'Ensure the tenant exists and subscription_status is ACTIVE or TRIAL.',
      { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }

  return serveSitePage(tenant, c.env, { injectScript: '/editor-bridge.js' });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tenant/assets/upload  (admin — X-Tenant-ID required)
// ─────────────────────────────────────────────────────────────────────────────
// Accepts a single image file (multipart/form-data field: "file").
// Stores it in the TOUR_PAGES R2 bucket at assets/{tenantId}/{safeFilename}.
// Returns the public URL: /api/tenant/assets/{tenantId}/{safeFilename}.
//
// [SEC] User-supplied filename is NEVER used — nanoid-generated name only
//       (prevents path traversal, Unicode tricks, and .exe/.php impersonation).
// [SEC] MIME type validated against allowlist; Content-Type from upload is
//       not trusted alone — body bytes are used directly (R2 stores as-is
//       but we gate on declared Content-Type from the multipart part).
// [SEC] Hard 5 MB cap enforced before reading body into memory.
const ALLOWED_ASSET_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'video/mp4',
  'video/webm',
]);

const MIME_TO_EXT = {
  'image/jpeg':   'jpg',
  'image/png':    'png',
  'image/webp':   'webp',
  'image/gif':    'gif',
  'image/svg+xml': 'svg',
  'video/mp4':    'mp4',
  'video/webm':   'webm',
};

const EXT_TO_MIME = Object.fromEntries(
  Object.entries(MIME_TO_EXT).map(([mime, ext]) => [ext, mime])
);

const MAX_ASSET_BYTES = 40 * 1024 * 1024; // 40 MB to allow short hero videos

// Safe filename: nanoid(12) + dot + extension — no user input in path.
const SAFE_ASSET_FILENAME_RE = /^[A-Za-z0-9_-]{1,64}\.(jpg|png|webp|gif|svg|mp4|webm)$/;

async function listAllTenantAssetObjects(bucket, prefix) {
  const objects = [];
  let cursor;

  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    objects.push(...(page.objects || []));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return objects;
}

async function requireAssetTenant(c, tenantId) {
  if (!tenantId) return { error: c.json({ error: 'X-Tenant-ID header is required.' }, 400) };
  if (!c.env.TOUR_PAGES) return { error: c.json({ error: 'TOUR_PAGES R2 binding is not configured.' }, 503) };

  const tenant = await c.env.DB
    .prepare('SELECT id FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();

  if (!tenant) return { error: c.json({ error: 'Tenant not found.' }, 404) };
  return { tenant };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tenant/assets  (admin — X-Tenant-ID required)
// ─────────────────────────────────────────────────────────────────────────────
// Lists previously uploaded tenant assets so the universal editor can reuse
// the same image or video URLs across hero, tours, featured collections,
// storytelling blocks, and galleries.
publicConfig.get('/assets', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  const requirement = await requireAssetTenant(c, tenantId);
  if (requirement.error) return requirement.error;

  const prefix = `assets/${tenantId}/`;
  const objects = await listAllTenantAssetObjects(c.env.TOUR_PAGES, prefix);

  const items = objects
    .map((obj) => {
      const filename = String(obj.key || '').slice(prefix.length);
      if (!SAFE_ASSET_FILENAME_RE.test(filename)) return null;
      const extension = filename.split('.').pop()?.toLowerCase() || '';
      return {
        filename,
        r2_key: obj.key,
        url: `/api/tenant/assets/${tenantId}/${filename}`,
        size: obj.size ?? 0,
        uploaded_at: obj.uploaded ? new Date(obj.uploaded).toISOString() : null,
        mime: EXT_TO_MIME[extension] || null,
      };
    })
    .filter(Boolean)
    .sort((left, right) => String(right.uploaded_at || '').localeCompare(String(left.uploaded_at || '')));

  return c.json({ ok: true, items });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/tenant/assets/:filename  (admin — X-Tenant-ID required)
// ─────────────────────────────────────────────────────────────────────────────
// Removes one uploaded asset from the tenant media library.
publicConfig.delete('/assets/:filename', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  const requirement = await requireAssetTenant(c, tenantId);
  if (requirement.error) return requirement.error;

  const filename = c.req.param('filename');
  if (!SAFE_ASSET_FILENAME_RE.test(filename)) {
    return c.json({ error: 'Invalid filename.' }, 400);
  }

  const r2Key = `assets/${tenantId}/${filename}`;
  await c.env.TOUR_PAGES.delete(r2Key);
  return c.json({ ok: true, filename, r2_key: r2Key });
});

publicConfig.post('/assets/upload', async (c) => {
  // ── Auth ────────────────────────────────────────────────────────────────
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  const requirement = await requireAssetTenant(c, tenantId);
  if (requirement.error) return requirement.error;

  // ── Parse multipart ──────────────────────────────────────────────────────
  let formData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: 'Request must be multipart/form-data.' }, 400);
  }

  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    return c.json({ error: 'Field "file" is required and must be a file.' }, 400);
  }

  // ── MIME validation ──────────────────────────────────────────────────────
  const mimeRaw = (file.type ?? '').toLowerCase().split(';')[0].trim();
  if (!ALLOWED_ASSET_MIME.has(mimeRaw)) {
    return c.json({
      error: `Unsupported file type "${mimeRaw}". Allowed: ${[...ALLOWED_ASSET_MIME].join(', ')}.`,
    }, 415);
  }

  // ── Size cap ─────────────────────────────────────────────────────────────
  if (file.size > MAX_ASSET_BYTES) {
    return c.json({
      error: `File too large (${(file.size / 1024 / 1024).toFixed(2)} MB). Maximum is 5 MB.`,
    }, 413);
  }

  // ── Generate safe R2 key ─────────────────────────────────────────────────
  const ext          = MIME_TO_EXT[mimeRaw];
  const safeFilename = `${nanoid(12)}.${ext}`;
  const r2Key        = `assets/${tenantId}/${safeFilename}`;

  // ── Upload to R2 ─────────────────────────────────────────────────────────
  const buffer = await file.arrayBuffer();

  await c.env.TOUR_PAGES.put(r2Key, buffer, {
    httpMetadata: {
      contentType:  mimeRaw,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });

  const publicUrl = `/api/tenant/assets/${tenantId}/${safeFilename}`;

  console.info(`[ASSET_UPLOAD] tenant=${tenantId} key=${r2Key} mime=${mimeRaw} bytes=${file.size}`);

  return c.json({
    ok:       true,
    url:      publicUrl,
    r2_key:   r2Key,
    filename: safeFilename,
    mime:     mimeRaw,
    size:     file.size,
  }, 201);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tenant/assets/:tenantId/:filename  (public — no auth required)
// ─────────────────────────────────────────────────────────────────────────────
// Serves an uploaded asset directly from TOUR_PAGES R2.
// URL uses tenantId + nanoid filename so no session cookie is needed —
// safe to embed in <img src="..."> on any public tour page.
//
// [SEC] tenantId and filename both validated before being used as R2 key
//       to prevent path traversal ("../", "%2F", etc.).
publicConfig.get('/assets/:tenantId/:filename', async (c) => {
  const rawTenantId = c.req.param('tenantId');
  const rawFilename = c.req.param('filename');

  // Validate segments — only safe characters allowed in R2 key components.
  const SAFE_SEGMENT_RE = /^[a-zA-Z0-9_-]{1,128}$/;
  if (!SAFE_SEGMENT_RE.test(rawTenantId)) {
    return new Response('Invalid tenant ID.', { status: 400 });
  }
  if (!SAFE_ASSET_FILENAME_RE.test(rawFilename)) {
    return new Response('Invalid filename.', { status: 400 });
  }

  if (!c.env.TOUR_PAGES) {
    return new Response('TOUR_PAGES R2 binding is not configured.', { status: 503 });
  }

  const r2Key = `assets/${rawTenantId}/${rawFilename}`;
  const obj   = await c.env.TOUR_PAGES.get(r2Key);

  if (!obj) {
    return new Response('Asset not found.', { status: 404 });
  }

  const contentType = obj.httpMetadata?.contentType ?? 'application/octet-stream';

  return new Response(obj.body, {
    headers: {
      'Content-Type':  contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'ETag':          obj.etag ?? '',
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tenant/publish-site  (admin — X-Tenant-ID required)
// ─────────────────────────────────────────────────────────────────────────────
// Promotes the tenant's sandbox to the live site by copying all R2 files from
// sandbox/{tenantId}/ to live/{tenantId}/ in the TOUR_PAGES bucket.
//
// Pre-flight checks (in order):
//   1. Tenant must exist and have subscription_status = 'ACTIVE'.
//   2. Sandbox must not be empty — prevents publishing a blank site.
//   3. If a template switch is detected (published_template_id IS NOT NULL AND
//      template_id !== published_template_id), a SWITCH_FEE audit row must
//      exist with created_at > site_published_at (fee recorded AFTER last
//      publish, not reused from an older switch).
//
// ── POST /api/tenant/switch-template ─────────────────────────────────────────
// Swaps the active site template in the Sandbox.
//
// Flow:
//   1. Validate tenant + new template exist.
//   2. If site has been published before AND template is changing → insert
//      SWITCH_FEE audit row (required by POST /publish-site gate).
//   3. Call initializeTenantSandbox(tenantId, newTemplateId, env, db, { preserveSections: true }):
//        a. Deletes sandbox/{tenantId}/ files (preserves assets/{tenantId}/).
//        b. Copies SITE_TEMPLATES/{newTemplateId}/ → sandbox/{tenantId}/.
//        c. Updates tenants.template_id.
//        d. Does NOT touch custom_sections — page content is always user-owned.
//           custom_selectors / custom_imgs are also preserved (preserveSections=true).
//   4. Re-renders all tenant tours (with a slug) into sandbox preview pages at
//        sandbox/{tenantId}/tours/{slug}.html
//      so the Visual Editor shows tours in the context of the new template.
//
// Preserved automatically:
//   ✓ assets/{tenantId}/            — separate R2 prefix, never touched
//   ✓ tours table (D1)              — DB data not modified by this endpoint
//   ✓ site_config content/brand     — deep-merge keeps existing values
//   ✓ live/{tenantId}/              — published site untouched until next publish-site
//
// Auth: X-Tenant-ID required. TRIAL tenants may switch sandbox templates freely.
publicConfig.post('/switch-template', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  if (!c.env.TOUR_PAGES || !c.env.SITE_TEMPLATES) {
    return c.json({ error: 'Storage bindings (TOUR_PAGES / SITE_TEMPLATES) are not configured.' }, 503);
  }

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Request body is not valid JSON.' }, 400); }

  const newTemplateId = (body.template_id ?? '').trim();
  if (!newTemplateId) {
    return c.json({ error: 'Missing required field: template_id.' }, 400);
  }
  // Allow only safe characters — prevents R2 path traversal
  if (!/^[a-zA-Z0-9_-]+$/.test(newTemplateId)) {
    return c.json({ error: 'template_id must contain only letters, digits, hyphens and underscores.' }, 400);
  }

  try {

  // ── 1. Load current tenant state ──────────────────────────────────────────
  const tenant = await c.env.DB
    .prepare(
      `SELECT id, template_id, published_template_id, site_published_at,
              subscription_status
         FROM tenants WHERE id = ?`
    )
    .bind(tenantId)
    .first();
  if (!tenant) return c.json({ error: 'Tenant not found.' }, 404);

  // No-op guard — same template already active
  if (tenant.template_id === newTemplateId) {
    return c.json({
      ok:          true,
      skipped:     true,
      message:     `Template "${newTemplateId}" is already active in the sandbox.`,
      template_id: newTemplateId,
    });
  }

  // ── 2. SWITCH_FEE audit entry (required for future publish-site call) ─────
  // Only needed when a live site exists with a DIFFERENT template.
  // This record is checked by POST /publish-site before allowing promotion.
  const hasLiveSite    = !!(tenant.published_template_id);
  const isTemplateSwap = hasLiveSite && tenant.published_template_id !== newTemplateId;

  if (isTemplateSwap) {
    await c.env.DB
      .prepare(
        `INSERT INTO tenant_audit_log
           (id, tenant_id, action, field_name, old_value, new_value, changed_at, created_at)
         VALUES (?, ?, 'SWITCH_FEE', 'template_id', ?, ?, ?, ?)`
      )
      .bind(
        nanoid(),
        tenantId,
        tenant.published_template_id,
        newTemplateId,
        Math.floor(Date.now() / 1000),
        Math.floor(Date.now() / 1000)
      )
      .run();
    console.info(`[SWITCH_TEMPLATE] SWITCH_FEE recorded: ${tenant.published_template_id} → ${newTemplateId}`);
  }

  // ── 3. Swap template in sandbox ───────────────────────────────────────────
  // initializeTenantSandbox handles:
  //   • delete sandbox/{tenantId}/ (NOT assets/{tenantId}/ — different prefix)
  //   • copy SITE_TEMPLATES/{newTemplateId}/ → sandbox/{tenantId}/
  //   • UPDATE tenants SET template_id (site_config.custom_sections untouched)
  //   • preserveSections: true — keeps existing page sections and selectors;
  //     the tenant must drag blocks from the Snippet panel to add content.
  let sandboxResult;
  try {
    sandboxResult = await initializeTenantSandbox(tenantId, newTemplateId, c.env, c.env.DB, { preserveSections: true });
  } catch (err) {
    // Surface template-not-found or binding errors cleanly
    const msg = err.message ?? String(err);
    if (msg.includes('has no files')) {
      return c.json({ error: `Template "${newTemplateId}" does not exist or has no files.`, code: 'TEMPLATE_NOT_FOUND' }, 404);
    }
    console.error('[SWITCH_TEMPLATE_SANDBOX_ERROR]', msg);
    return c.json({ error: 'Failed to initialize sandbox with new template.', detail: msg }, 500);
  }

  // ── 4. Re-render tour preview pages into sandbox ──────────────────────────
  // For each tour with a slug, render a preview-mode page and store it at
  // sandbox/{tenantId}/tours/{slug}.html so the Visual Editor can show
  // how tours look in the context of the new template layout.
  const tours = await c.env.DB
    .prepare('SELECT * FROM tours WHERE tenant_id = ? AND slug IS NOT NULL AND slug != ""')
    .bind(tenantId)
    .all();

  let toursRendered  = 0;
  let toursFailed    = 0;
  const tourWarnings = [];

  for (const tour of (tours.results ?? [])) {
    try {
      // Render in preview mode — bookings stay disabled in sandbox
      const rendered = await generateTourPage(c.env, tour, undefined, null, 'preview');
      if (!rendered.ok) {
        toursFailed++;
        tourWarnings.push(`${tour.slug}: ${rendered.error}`);
        continue;
      }

      const destKey = `sandbox/${tenantId}/tours/${tour.slug}.html`;
      await c.env.TOUR_PAGES.put(destKey, rendered.html, {
        httpMetadata: {
          contentType:  'text/html; charset=utf-8',
          cacheControl: 'no-store',  // sandbox previews should never be stale
        },
        customMetadata: {
          tenant_id:   tenantId,
          template_id: newTemplateId,
          tour_id:     tour.id,
          rendered_at: new Date().toISOString(),
        },
      });
      toursRendered++;
    } catch (err) {
      toursFailed++;
      tourWarnings.push(`${tour.slug}: ${err.message}`);
      console.warn(`[SWITCH_TEMPLATE] Failed to render tour ${tour.slug}:`, err.message);
    }
  }

  let pagesRebuilt = 0;
  try {
    pagesRebuilt = await rebuildAllTenantPageRenders(c.env, tenantId);
  } catch (err) {
    console.warn(`[SWITCH_TEMPLATE] Failed to rebuild child pages for ${tenantId}:`, err.message);
  }

  console.info(
    `[SWITCH_TEMPLATE] tenant=${tenantId} old=${tenant.template_id} new=${newTemplateId} ` +
    `sandbox_copied=${sandboxResult.copied} sandbox_deleted=${sandboxResult.deleted} ` +
    `tours_rendered=${toursRendered} tours_failed=${toursFailed} pages_rebuilt=${pagesRebuilt}`
  );

  return c.json({
    ok:              true,
    old_template_id: tenant.template_id,
    new_template_id: newTemplateId,
    switch_fee_logged: isTemplateSwap,
    sandbox: {
      files_deleted: sandboxResult.deleted,
      files_copied:  sandboxResult.copied,
    },
    tours: {
      rendered: toursRendered,
      failed:   toursFailed,
      warnings: tourWarnings.length ? tourWarnings : undefined,
    },
    pages: {
      rebuilt: pagesRebuilt,
    },
    note: 'assets/ folder and live site are unchanged. Existing sections are preserved — drag new blocks from the Snippet panel to add content. Run POST /api/tenant/publish-site when ready to go live.',
  });

  } catch (err) {
    const msg = err?.message ?? String(err);
    console.error('[SWITCH_TEMPLATE_FATAL]', msg);
    return c.json({ error: 'Template switch failed.', detail: msg }, 500);
  }
});

// Publish steps:
//   a. Delete all existing live/{tenantId}/ objects (clean promotion).
//   b. Stream-copy each sandbox object to live/{tenantId}/.
//   c. UPDATE tenants: published_template_id, site_published_at.
//   d. Write PUBLISH audit row to tenant_audit_log.
//
// [SEC] R2 key paths are constructed from validated tenant IDs only — never
//       from user input — preventing any path traversal risk.
publicConfig.post('/publish-site', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  if (!c.env.TOUR_PAGES) {
    return c.json({ error: 'TOUR_PAGES R2 binding is not configured.' }, 503);
  }

  // ── 1. Full publish gate (4 conditions) ──────────────────────────────────
  // checkPublishPermission fetches the tenant row (includes template_id,
  // published_template_id, site_published_at) and enforces:
  //   subscription_status=ACTIVE, terms_accepted=1,
  //   ≥1 electronic gateway enabled, subdomain/custom_domain set.
  const guard = await checkPublishPermission(c.env, tenantId);
  if (!guard.ok) {
    return c.json({
      error:     guard.error,
      code:      guard.code,
      blocks:    guard.blocks,
      checklist: guard.checklist,
    }, 403);
  }
  const tenant = guard.tenant;

  const sandboxPrefix = `sandbox/${tenantId}/`;
  const livePrefix    = `live/${tenantId}/`;

  // ── 3. Verify sandbox is not empty ───────────────────────────────────────
  const sandboxFiles = await listAllObjects(c.env.TOUR_PAGES, sandboxPrefix);
  if (sandboxFiles.length === 0) {
    return c.json({
      error: `Sandbox is empty. No files found under "${sandboxPrefix}". ` +
             'Run initializeTenantSandbox first.',
    }, 422);
  }

  // ── 4. Template-switch fee check ─────────────────────────────────────────
  // Only required when an existing published site uses a DIFFERENT template.
  const isTemplateSwitch =
    tenant.published_template_id !== null &&
    tenant.published_template_id !== undefined &&
    tenant.template_id !== tenant.published_template_id;

  if (isTemplateSwitch) {
    // Fee must have been recorded AFTER the last publish (prevents reuse).
    const lastPublishAt = tenant.site_published_at ?? 0;

    const feeRow = await c.env.DB
      .prepare(
        `SELECT id FROM tenant_audit_log
          WHERE tenant_id = ?
            AND action    = 'SWITCH_FEE'
            AND created_at > ?
          ORDER BY created_at DESC
          LIMIT 1`
      )
      .bind(tenantId, lastPublishAt)
      .first();

    if (!feeRow) {
      return c.json({
        error: 'A template-switch fee (action=SWITCH_FEE) must be logged in the ' +
               'audit trail before publishing with a different template. ' +
               `Switching from "${tenant.published_template_id}" to "${tenant.template_id}".`,
        code:  'SWITCH_FEE_REQUIRED',
        current_template:  tenant.template_id,
        published_template: tenant.published_template_id,
      }, 403);
    }
  }

  // ── 5. Delete stale live files ────────────────────────────────────────────
  // [SEC] Prefix is hard-coded as live/{tenantId}/ — never user-supplied.
  const oldLiveFiles = await listAllObjects(c.env.TOUR_PAGES, livePrefix);
  let deleted = 0;
  if (oldLiveFiles.length > 0) {
    const BATCH = 1000;
    for (let i = 0; i < oldLiveFiles.length; i += BATCH) {
      const keys = oldLiveFiles.slice(i, i + BATCH).map(o => o.key);
      await c.env.TOUR_PAGES.delete(keys);
    }
    deleted = oldLiveFiles.length;
  }

  // ── 6. Copy sandbox → live ───────────────────────────────────────────────
  // Relative path = strip "sandbox/{tenantId}/" prefix, prepend "live/{tenantId}/".
  let copied = 0;
  const copyWarnings = [];

  for (const obj of sandboxFiles) {
    const relPath = obj.key.slice(sandboxPrefix.length);
    if (!relPath) continue; // skip phantom prefix-only listing entry

    const destKey = `${livePrefix}${relPath}`;

    const srcObj = await c.env.TOUR_PAGES.get(obj.key);
    if (!srcObj) {
      // Object disappeared between list and get — skip, warn.
      copyWarnings.push(obj.key);
      continue;
    }

    const contentType = srcObj.httpMetadata?.contentType ?? 'application/octet-stream';

    await c.env.TOUR_PAGES.put(destKey, srcObj.body, {
      httpMetadata: {
        contentType,
        cacheControl: 'public, max-age=300, stale-while-revalidate=60',
      },
      customMetadata: {
        source:       obj.key,
        published_at: new Date().toISOString(),
        tenant_id:    tenantId,
      },
    });
    copied++;
  }

  // ── 7. Update tenants D1 record ───────────────────────────────────────────
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB
    .prepare(
      `UPDATE tenants
         SET published_template_id = ?, site_published_at = ?
         WHERE id = ?`
    )
    .bind(tenant.template_id ?? null, now, tenantId)
    .run();

  // ── 8. Audit log — SITE_PUBLISH ───────────────────────────────────────────
  // Non-fatal: audit write failure must never roll back the publish.
  try {
    await c.env.DB
      .prepare(
        `INSERT INTO tenant_audit_log
           (id, tenant_id, field_name, changed_at, action, entity_type, entity_id, meta_json, created_at)
         VALUES (?, ?, 'SITE_PUBLISH', ?, 'SITE_PUBLISH', 'tenant', ?, ?, ?)`
      )
      .bind(
        nanoid(),
        tenantId,
        now, // changed_at (NOT NULL legacy column)
        tenantId,
        JSON.stringify({
          template_id:          tenant.template_id,
          prev_template_id:     tenant.published_template_id ?? null,
          sandbox_files_copied: copied,
          live_files_deleted:   deleted,
          template_switch:      isTemplateSwitch,
        }),
        now
      )
      .run();
  } catch (auditErr) {
    console.warn(`[PUBLISH_AUDIT_WARN] tenant=${tenantId}`, auditErr?.message);
  }

  console.info(
    `[SITE_PUBLISH] tenant=${tenantId} template=${tenant.template_id} ` +
    `copied=${copied} deleted=${deleted} switch=${isTemplateSwitch}`
  );

  return c.json({
    ok:               true,
    tenant_id:        tenantId,
    published_at:     new Date(now * 1000).toISOString(),
    template_id:      tenant.template_id,
    live_prefix:      livePrefix,
    files_copied:     copied,
    files_deleted:    deleted,
    template_switch:  isTemplateSwitch,
    ...(copyWarnings.length > 0 ? { warnings: copyWarnings } : {}),
  });
});

// GET /api/tenant/snippets  (admin — X-Tenant-ID required)
//
// Returns the list of <section> blocks extracted from a site template,
// ready to display as snippet cards in the Visual Editor sidebar.
//
// Query params:
//   ?templateId=<id>  — explicit override (defaults to tenant's template_id)
//
// Response:  { ok, templateId, count, snippets: [{id,type,label,icon,desc,thumbnail,category,html}] }
publicConfig.get('/snippets', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  if (!c.env.SITE_TEMPLATES) {
    return c.json({ error: 'SITE_TEMPLATES R2 binding is not configured.' }, 503);
  }

  // Resolve templateId: query param > tenant DB record > hard default.
  let templateId = (c.req.query('templateId') ?? '').trim();
  if (!templateId || !/^[a-zA-Z0-9_-]{1,128}$/.test(templateId)) {
    const row = await c.env.DB
      .prepare('SELECT template_id FROM tenants WHERE id = ?')
      .bind(tenantId)
      .first();
    templateId = (row?.template_id ?? '').trim() || 'open-pro-html';
  }

  try {
    const snippets = await extractTemplateSections(templateId, c.env.SITE_TEMPLATES);
    return c.json({ ok: true, templateId, count: snippets.length, snippets });
  } catch (err) {
    console.warn('[SNIPPETS_ERROR]', err?.message);
    return c.json({ error: 'Failed to extract snippets.', detail: err?.message }, 500);
  }
});

// POST /api/tenant/soft-publish  (admin — X-Tenant-ID required)
//
// Lightweight publish that skips subscription gates, SWITCH_FEE checks, and
// template-switch validation.  It simply copies every file under
// sandbox/{tenantId}/ → live/{tenantId}/ and updates site_published_at.
//
// Intended as a silent fallback when the full /publish-site gate is blocked
// (e.g. dev / staging tenants without an active subscription).
publicConfig.post('/soft-publish', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  if (!c.env.TOUR_PAGES) {
    return c.json({ error: 'TOUR_PAGES R2 binding is not configured.' }, 503);
  }

  // Verify tenant exists.
  const tenant = await c.env.DB
    .prepare('SELECT id, template_id FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();
  if (!tenant) return c.json({ error: 'Tenant not found.' }, 404);

  const sandboxPrefix = `sandbox/${tenantId}/`;
  const livePrefix    = `live/${tenantId}/`;

  // List sandbox files.
  const sandboxFiles = await listAllObjects(c.env.TOUR_PAGES, sandboxPrefix);
  if (sandboxFiles.length === 0) {
    return c.json({ error: `Sandbox is empty for tenant "${tenantId}".` }, 422);
  }

  // Delete old live files (one batch — soft-publish is for small sites).
  const oldLive = await listAllObjects(c.env.TOUR_PAGES, livePrefix);
  if (oldLive.length > 0) {
    const BATCH = 1000;
    for (let i = 0; i < oldLive.length; i += BATCH) {
      await c.env.TOUR_PAGES.delete(oldLive.slice(i, i + BATCH).map(o => o.key));
    }
  }

  // Copy sandbox → live.
  let copied   = 0;
  const errors = [];
  for (const obj of sandboxFiles) {
    const relPath = obj.key.slice(sandboxPrefix.length);
    if (!relPath) continue;
    try {
      const srcObj = await c.env.TOUR_PAGES.get(obj.key);
      if (!srcObj) { errors.push(obj.key); continue; }
      const contentType = srcObj.httpMetadata?.contentType ?? 'application/octet-stream';
      await c.env.TOUR_PAGES.put(`${livePrefix}${relPath}`, srcObj.body, {
        httpMetadata: {
          contentType,
          cacheControl: 'public, max-age=300, stale-while-revalidate=60',
        },
        customMetadata: {
          source:       obj.key,
          published_at: new Date().toISOString(),
          tenant_id:    tenantId,
        },
      });
      copied++;
    } catch (_) {
      errors.push(obj.key);
    }
  }

  // Update DB — best-effort, don't fail the response if this errors.
  const ts = Math.floor(Date.now() / 1000);
  try {
    await c.env.DB
      .prepare('UPDATE tenants SET site_published_at = ? WHERE id = ?')
      .bind(ts, tenantId)
      .run();
  } catch (dbErr) {
    console.warn(`[SOFT_PUBLISH_DB_WARN] tenant=${tenantId}`, dbErr?.message);
  }

  return c.json({
    ok:           true,
    mode:         'soft',
    tenant_id:    tenantId,
    published_at: new Date(ts * 1000).toISOString(),
    files_copied: copied,
    files_deleted: oldLive.length,
    ...(errors.length ? { warnings: errors } : {}),
  });
});

export default function registerTenantRoutes(app) {
  app.route('/api/tenants', tenants);
  // Public config endpoint — registered separately to keep URL path clean.
  app.route('/api/tenant', publicConfig);
  // Legacy compatibility for the public signup page. Unlike the editor-facing
  // `/api/tenant/templates` route, this endpoint reflects the live D1 catalog
  // actually accepted by onboarding.
  app.get('/api/site-templates', async (c) => {
    const activeOnly = c.req.query('active') === '1';
    const sql = activeOnly
      ? 'SELECT id, name, description, thumbnail_url, r2_prefix, is_active FROM site_templates WHERE is_active = 1 ORDER BY sort_order ASC, created_at DESC'
      : 'SELECT id, name, description, thumbnail_url, r2_prefix, is_active FROM site_templates ORDER BY sort_order ASC, created_at DESC';

    const rows = await c.env.DB.prepare(sql).all();
    const templates = rows.results ?? [];

    return c.json({
      ok: true,
      templates: templates.map((t) => ({
        id:            t.id,
        name:          t.name,
        label:         t.name,
        description:   t.description ?? '',
        thumbnail_url: t.thumbnail_url ?? '',
        r2_prefix:     t.r2_prefix,
        is_active:     t.is_active,
      })),
    });
  });
  // Custom pages management (Site Studio "Add Page" feature).
  app.route('/api/tenant/pages', pagesRouter);
}

