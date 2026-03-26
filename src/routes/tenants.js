// src/routes/tenants.js
// Quản lý cài đặt Tenant: FX (tỉ giá), display currency, pricing policy
import { Hono } from 'hono';
import { nanoid } from 'nanoid';

const tenants = new Hono();

// [SEC] Whitelist các cột Agent được phép tự cập nhật.
// Không được cập nhật: id, slug, name, created_at (bất biến)
// default_locale và base_currency cố ý không nằm ở đây — thay đổi ảnh hưởng
// đến toàn bộ DB và cần migration riêng.
const ALLOWED_SETTINGS_COLUMNS = [
  'exchange_rate', 'target_currency', 'pricing_policy', 'infant_policy_text',
  'custom_domain', 'subscription_status', 'payment_config_json',
];

const VALID_PRICING_POLICIES    = new Set(['PRIORITY_HIGH_SEASON', 'PRIORITY_LOW_SEASON']);
const VALID_SUBSCRIPTION_STATUS = new Set(['TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED']);

// Bare hostname regex — no protocol, no path, no port
const HOSTNAME_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

// Fields whose changes must be persisted to tenant_audit_log for legal reconciliation.
const AUDIT_FIELDS = new Set(['custom_domain', 'payment_config_json']);

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

  if ('payment_config_json' in data) {
    const pcj = data.payment_config_json;
    if (pcj !== null) {
      if (typeof pcj !== 'object' || Array.isArray(pcj)) {
        errors.push('payment_config_json phải là JSON object hoặc null để xóa.');
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

  // Serialize payment_config_json object → TEXT for D1
  if ('payment_config_json' in safeData) {
    safeData.payment_config_json = safeData.payment_config_json !== null
      ? JSON.stringify(safeData.payment_config_json)
      : null;
  }

  try {
    // [AUDIT] Đọc giá trị hiện tại trước khi cập nhật để log thay đổi
    const current = await c.env.DB
      .prepare('SELECT exchange_rate, target_currency, pricing_policy, infant_policy_text, custom_domain, subscription_status, payment_config_json FROM tenants WHERE id = ?')
      .bind(tenantId)
      .first();

    if (!current) {
      return c.json({ error: 'Tenant không tồn tại' }, 404);
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
      .prepare('SELECT exchange_rate, target_currency, pricing_policy, infant_policy_text, custom_domain, subscription_status, payment_config_json, default_locale, base_currency, total_revenue_tracked, commission_threshold FROM tenants WHERE id = ?')
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
      .prepare('SELECT exchange_rate, target_currency, pricing_policy, infant_policy_text, custom_domain, subscription_status, payment_config_json, default_locale, base_currency, total_revenue_tracked, commission_threshold FROM tenants WHERE id = ?')
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

export default function registerTenantRoutes(app) {
  app.route('/api/tenants', tenants);
}
