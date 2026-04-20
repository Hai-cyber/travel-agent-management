// src/routes/tenants.js
// Quản lý cài đặt Tenant: FX (tỉ giá), display currency, pricing policy
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { resolveTenantByHost, serveSitePage, SAFE_SELECTOR_RE, listAllObjects, initializeTenantSandbox, getTemplateStructure, extractTemplateSections } from '../lib/siteStudio.js';
import {
  buildTenantCommercialPolicy,
  checkPublishPermission,
  hasEnabledElectronicGateway,
  hasEnabledPaymentMethod,
  parseTenantPaymentMethods,
} from '../lib/publishGuard.js';
import { generateTourPage } from '../routes/tours.js';
import pagesRouter, { rebuildAllTenantPageRenders } from '../routes/pages.js';
import { getSupportedLocales, resolveLocaleFromAcceptLanguage } from '../utils/formatter.js';
import { getTenantCurrencyCatalog, isSupportedTenantCurrency } from '../lib/tenantMarketCatalog.js';
import { getMarketSkinCatalog, getMarketSkin, isSupportedMarketSkin } from '../lib/marketSkins.js';
import {
  buildSubdomainPolicy,
  dispatchSubdomainReviewAlert,
  validateSubdomainCandidate,
} from '../lib/subdomainPolicy.js';
import {
  analyzeTenantSiteAbuse,
  buildTenantSafeReviewFeedback,
  buildTenantTrustPolicy,
  buildTenantTrustState,
  buildTenantModerationUserMessage,
  createTenantReviewCase,
  decideTenantModerationOutcome,
  mergeTrustReasons,
  parseTrustReasons,
  normalizeTrustStatus,
} from '../lib/trustAbuse.js';
import {
  buildAssetModerationPayload,
  buildSignedReviewActionSignature,
  buildTenantModerationPayload,
  moderateAssetWithAI,
  moderateTenantContent,
  sendTelegramModerationAlert,
} from '../lib/aiModeration.js';
import {
  analyzeAssetUpload,
  assessEmailIdentityRisk,
  buildRiskRequestContext,
  buildTenantVelocityLimits,
  countAssetReuseAcrossTenants,
  countRiskEvents,
  createRiskEvent,
  decideAssetModerationOutcome,
  fetchTenantAssetRecord,
  hashIdentifier,
  sha256HexBuffer,
} from '../lib/abuseRisk.js';
import {
  clearAuthSessionCookie,
  getAuthSession,
  readAuthSessionToken,
} from '../lib/auth.js';

const tenants = new Hono();

// [SEC] Whitelist các cột Agent được phép tự cập nhật.
// Không được cập nhật: id, slug, name, created_at (bất biến)
const ALLOWED_SETTINGS_COLUMNS = [
  'exchange_rate', 'target_currency', 'booking_currency', 'default_locale', 'market_skin_key', 'primary_market', 'pricing_policy', 'infant_policy_text', 'pricing_notes_text',
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

// Bare hostname regex — no protocol, no path, no port
const HOSTNAME_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

// Fields whose changes must be persisted to tenant_audit_log for legal reconciliation.
const AUDIT_FIELDS = new Set(['custom_domain', 'subdomain', 'stripe_customer_id', 'payment_config_json']);

function resolveTenantCatalogLocale(headerValue, tenantSettings = {}) {
  const requested = String(headerValue || '').trim();
  if (requested) return resolveLocaleFromAcceptLanguage(requested);

  const marketSkinLocale = String(getMarketSkin(tenantSettings?.market_skin_key).ui_locale || '').trim();
  const tenantLocale = String(tenantSettings?.default_locale || '').trim();
  return resolveLocaleFromAcceptLanguage(marketSkinLocale || tenantLocale || 'en');
}

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

function safeParseJson(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function isTenantModerationCategory(category) {
  const normalized = String(category || '').trim().toLowerCase();
  return [
    'publish_content_review',
    'asset_upload_review',
    'custom_domain_verification',
    'admin_ai_review',
    'admin_ai_block',
    'subdomain_review',
  ].includes(normalized);
}

async function buildPublishModerationInput(env, tenant) {
  const tenantRecord = { ...(tenant || {}) };
  const siteConfig = safeParseJson(tenantRecord.site_config, {}) || {};
  siteConfig.brand = siteConfig.brand && typeof siteConfig.brand === 'object' ? siteConfig.brand : {};
  siteConfig.content = siteConfig.content && typeof siteConfig.content === 'object' ? siteConfig.content : {};

  const [homePage, menuRowsResult, contactsRow, siteRow] = await Promise.all([
    env.DB.prepare('SELECT title, seo_json, blocks_json FROM tenant_universal_pages WHERE tenant_id = ? AND page_key = ? LIMIT 1').bind(tenantRecord.id, 'home').first(),
    env.DB.prepare('SELECT label, href, page_key, visible FROM tenant_universal_menu_items WHERE tenant_id = ? ORDER BY sort_order ASC').bind(tenantRecord.id).all(),
    env.DB.prepare('SELECT channels_json FROM tenant_universal_contacts WHERE tenant_id = ?').bind(tenantRecord.id).first(),
    env.DB.prepare('SELECT site_name FROM tenant_universal_sites WHERE tenant_id = ? LIMIT 1').bind(tenantRecord.id).first(),
  ]);

  const seo = safeParseJson(homePage?.seo_json, {});
  const blocks = safeParseJson(homePage?.blocks_json, []);
  const heroBlock = Array.isArray(blocks) ? blocks.find((block) => block?.type === 'hero') : null;
  const heroContent = heroBlock?.content && typeof heroBlock.content === 'object' ? heroBlock.content : {};
  const contactChannels = safeParseJson(contactsRow?.channels_json, {})?.email || {};
  const navigation = Array.isArray(menuRowsResult?.results)
    ? menuRowsResult.results
        .filter((row) => row?.visible)
        .map((row) => ({
          label: String(row?.label || row?.page_key || '').trim(),
          url: String(row?.href || '').trim(),
        }))
    : [];
  const customSections = Array.isArray(blocks)
    ? blocks.map((block, index) => ({
        id: String(block?.id || `section-${index + 1}`).trim(),
        html: [
          String(block?.label || '').trim(),
          String(block?.content?.heading || '').trim(),
          String(block?.content?.headline || '').trim(),
          String(block?.content?.body || '').trim(),
        ].filter(Boolean).join('\n'),
      })).filter((entry) => entry.html)
    : [];

  siteConfig.brand.name = String(siteConfig.brand.name || siteRow?.site_name || tenantRecord.name || '').trim();
  siteConfig.content.hero_title = String(siteConfig.content.hero_title || heroContent.headline || seo.title || homePage?.title || '').trim();
  siteConfig.content.hero_desc = String(siteConfig.content.hero_desc || heroContent.body || seo.description || '').trim();
  siteConfig.navigation = navigation;
  siteConfig.custom_sections = customSections;

  if (!tenantRecord.email && contactChannels?.value) {
    tenantRecord.email = String(contactChannels.value || '').trim();
  }

  return { tenant: tenantRecord, siteConfig };
}

async function refreshOpenPublishReviewCase(env, tenantRecord) {
  if (!tenantRecord?.id) return { tenant: tenantRecord, refreshed: false, resolution: 'skipped' };

  const openPublishCase = await env.DB
    .prepare(`SELECT id, summary, evidence_json
                FROM tenant_review_cases
               WHERE tenant_id = ?
                 AND status = 'OPEN'
                 AND category = 'publish_content_review'
               ORDER BY created_at DESC
               LIMIT 1`)
    .bind(tenantRecord.id)
    .first();
  if (!openPublishCase) return { tenant: tenantRecord, refreshed: false, resolution: 'none' };

  let existingEvidence = null;
  try {
    existingEvidence = openPublishCase.evidence_json ? JSON.parse(openPublishCase.evidence_json) : null;
  } catch {
    existingEvidence = null;
  }

  const moderationInput = await buildPublishModerationInput(env, tenantRecord);
  const abuseAnalysis = analyzeTenantSiteAbuse(moderationInput);
  const moderationPayload = buildTenantModerationPayload({ ...moderationInput, stage: 'publish' });
  const aiModeration = await moderateTenantContent(env, moderationPayload, { stage: 'publish' });
  const moderationOutcome = decideTenantModerationOutcome({ ruleAnalysis: abuseAnalysis, aiModeration });
  const now = Math.floor(Date.now() / 1000);
  const staleReasons = new Set([
    ...((existingEvidence?.outcome?.summaries || []).map((entry) => String(entry || '').trim())),
    String(existingEvidence?.outcome?.reason || '').trim(),
    String(openPublishCase.summary || '').trim(),
  ].filter(Boolean));
  const existingTrustReasons = parseTrustReasons(tenantRecord.trust_reasons_json);
  const preservedReasons = existingTrustReasons.filter((entry) => !staleReasons.has(String(entry || '').trim()));

  if (!moderationOutcome.flagged) {
    const nextReasons = preservedReasons;
    await env.DB.batch([
      env.DB.prepare('UPDATE tenant_review_cases SET status = ?, resolved_at = ?, resolved_by = ?, resolution_note = ? WHERE id = ? AND tenant_id = ?').bind('RESOLVED', now, 'system:review-status-refresh', 'Current publish moderation no longer flags this tenant.', openPublishCase.id, tenantRecord.id),
      env.DB.prepare('UPDATE tenants SET trust_reasons_json = ?, trust_reviewed_at = ?, trust_reviewed_by = ? WHERE id = ?').bind(JSON.stringify(nextReasons), now, 'system:review-status-refresh', tenantRecord.id),
    ]);
    return {
      tenant: {
        ...tenantRecord,
        trust_reasons_json: JSON.stringify(nextReasons),
        trust_reviewed_at: now,
        trust_reviewed_by: 'system:review-status-refresh',
      },
      refreshed: true,
      resolution: 'resolved',
    };
  }

  const nextReasons = mergeTrustReasons(JSON.stringify(preservedReasons), moderationOutcome.summaries);
  const nextEvidence = {
    rules: abuseAnalysis,
    ai: aiModeration,
    outcome: moderationOutcome,
  };
  await env.DB.batch([
    env.DB.prepare('UPDATE tenant_review_cases SET summary = ?, evidence_json = ? WHERE id = ? AND tenant_id = ?').bind(moderationOutcome.reason, JSON.stringify(nextEvidence), openPublishCase.id, tenantRecord.id),
    env.DB.prepare('UPDATE tenants SET trust_reasons_json = ?, trust_reviewed_at = ?, trust_reviewed_by = ? WHERE id = ?').bind(JSON.stringify(nextReasons), now, 'system:review-status-refresh', tenantRecord.id),
  ]);
  return {
    tenant: {
      ...tenantRecord,
      trust_reasons_json: JSON.stringify(nextReasons),
      trust_reviewed_at: now,
      trust_reviewed_by: 'system:review-status-refresh',
    },
    refreshed: true,
    resolution: 'updated',
  };
}

function isLowRiskAiAssetCase(evidence = {}) {
  const rulesBlocked = evidence?.rules?.blocked === true;
  const rulesReview = evidence?.rules?.review_required === true;
  const ruleSignals = Array.isArray(evidence?.rules?.signals) ? evidence.rules.signals : [];
  const aiRiskScore = Number(evidence?.ai?.risk_score || 0);
  const aiAction = String(evidence?.ai?.recommended_action || '').trim().toUpperCase();
  const duplicateTenantCount = Number(evidence?.duplicate_tenant_count || 0);
  return !rulesBlocked
    && !rulesReview
    && ruleSignals.length === 0
    && duplicateTenantCount < 2
    && aiAction === 'REVIEW'
    && aiRiskScore > 0
    && aiRiskScore < 35;
}

async function refreshOpenAssetReviewCases(env, tenantRecord) {
  if (!tenantRecord?.id) return { tenant: tenantRecord, refreshed: false };

  const { results } = await env.DB
    .prepare(`SELECT id, summary, evidence_json
                FROM tenant_review_cases
               WHERE tenant_id = ?
                 AND status = 'OPEN'
                 AND category = 'asset_upload_review'
               ORDER BY created_at DESC`)
    .bind(tenantRecord.id)
    .all();
  if (!Array.isArray(results) || results.length === 0) {
    return { tenant: tenantRecord, refreshed: false };
  }

  let trustReasons = parseTrustReasons(tenantRecord.trust_reasons_json);
  let changed = false;
  const now = Math.floor(Date.now() / 1000);

  for (const row of results) {
    let evidence = null;
    try {
      evidence = row.evidence_json ? JSON.parse(row.evidence_json) : null;
    } catch {
      evidence = null;
    }
    if (!isLowRiskAiAssetCase(evidence)) continue;

    const staleReasons = new Set([
      String(row.summary || '').trim(),
      ...(Array.isArray(evidence?.ai?.reasons) ? evidence.ai.reasons.map((entry) => String(entry || '').trim()) : []),
      String(evidence?.ai?.summary || '').trim(),
    ].filter(Boolean));
    trustReasons = trustReasons.filter((entry) => !staleReasons.has(String(entry || '').trim()));

    await env.DB.batch([
      env.DB.prepare('UPDATE tenant_review_cases SET status = ?, resolved_at = ?, resolved_by = ?, resolution_note = ? WHERE id = ? AND tenant_id = ?').bind('RESOLVED', now, 'system:asset-review-refresh', 'Resolved low-risk AI-only asset review case.', row.id, tenantRecord.id),
      env.DB.prepare('UPDATE tenant_asset_inventory SET moderation_status = ?, visibility = ?, risk_score = ?, reasons_json = ? WHERE tenant_id = ? AND filename = ? AND deleted_at IS NULL').bind('ALLOW', 'PUBLIC', Number(evidence?.ai?.risk_score || 0), JSON.stringify([]), tenantRecord.id, String(evidence?.filename || '').trim()),
    ]);
    changed = true;
  }

  if (!changed) return { tenant: tenantRecord, refreshed: false };

  await env.DB
    .prepare('UPDATE tenants SET trust_reasons_json = ?, trust_reviewed_at = ?, trust_reviewed_by = ? WHERE id = ?')
    .bind(JSON.stringify(trustReasons), now, 'system:asset-review-refresh', tenantRecord.id)
    .run();

  return {
    tenant: {
      ...tenantRecord,
      trust_reasons_json: JSON.stringify(trustReasons),
      trust_reviewed_at: now,
      trust_reviewed_by: 'system:asset-review-refresh',
    },
    refreshed: true,
  };
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

async function requireTenantActor(c, tenantId) {
  const token = readAuthSessionToken(c);
  if (!token) {
    return { error: c.json({ error: 'Authentication required.' }, 401) };
  }

  const cached = typeof c.get === 'function' ? c.get('authSession') : null;
  const session = cached || await getAuthSession(c.env.DB, token);
  if (!session) {
    clearAuthSessionCookie(c);
    return { error: c.json({ error: 'Session expired. Please log in again.' }, 401) };
  }

  if (tenantId && session.tenant_id !== tenantId) {
    return { error: c.json({ error: 'Forbidden for this tenant.' }, 403) };
  }

  if (!cached && typeof c.set === 'function') {
    c.set('authSession', session);
  }

  return { session };
}

function deriveSoftHoldTrustStatus(currentStatus) {
  const normalized = normalizeTrustStatus(currentStatus);
  if (normalized === 'SUSPENDED' || normalized === 'QUARANTINED') return normalized;
  if (normalized === 'TRUSTED') return 'PROBATION';
  return 'PREVIEW_ONLY';
}

async function applySoftTrustHold(env, tenant, { reasons = [], reviewedBy = 'system:risk-hold', riskScore = 0 } = {}) {
  if (!env?.DB || !tenant?.id) return;

  const mergedReasons = mergeTrustReasons(tenant.trust_reasons_json, reasons);
  const nextStatus = deriveSoftHoldTrustStatus(tenant.trust_status);
  await env.DB
    .prepare('UPDATE tenants SET trust_status = ?, trust_score = ?, trust_reasons_json = ?, trust_reviewed_at = ?, trust_reviewed_by = ?, public_indexing_enabled = 0 WHERE id = ?')
    .bind(nextStatus, Number(riskScore || 0), JSON.stringify(mergedReasons), Math.floor(Date.now() / 1000), reviewedBy, tenant.id)
    .run();
}

async function insertOrReplaceAssetInventory(env, details = {}) {
  const now = Math.floor(Date.now() / 1000);
  const existing = await env.DB
    .prepare('SELECT id FROM tenant_asset_inventory WHERE tenant_id = ? AND r2_key = ? LIMIT 1')
    .bind(details.tenantId, details.r2Key)
    .first();
  const assetId = existing?.id || nanoid();

  await env.DB
    .prepare(
      `INSERT OR REPLACE INTO tenant_asset_inventory
         (id, tenant_id, r2_key, filename, mime, size_bytes, sha256, moderation_status, visibility, risk_score, reasons_json, uploaded_by_user_id, uploaded_by_session_id, created_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    )
    .bind(
      assetId,
      details.tenantId,
      details.r2Key,
      details.filename,
      details.mime,
      details.sizeBytes,
      details.sha256,
      details.moderationStatus,
      details.visibility,
      Number(details.riskScore || 0),
      JSON.stringify(details.reasons || []),
      details.userId || null,
      details.sessionId || null,
      now,
    )
    .run();

  return assetId;
}

async function appendAssetScanResult(env, details = {}) {
  await env.DB
    .prepare(
      `INSERT INTO tenant_asset_scan_results
         (id, asset_id, provider, stage, status, risk_score, reasons_json, evidence_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      nanoid(),
      details.assetId,
      String(details.provider || 'rules').trim(),
      String(details.stage || 'upload').trim(),
      String(details.status || 'ALLOW').trim(),
      Number(details.riskScore || 0),
      JSON.stringify(details.reasons || []),
      JSON.stringify(details.evidence || null),
      Math.floor(Date.now() / 1000),
    )
    .run();
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
    if (typeof cur !== 'string' || !isSupportedTenantCurrency(cur)) {
      errors.push('target_currency phải thuộc curated currency basket: USD, EUR, VND, CNY, JPY, KRW, GBP, AUD, SGD, THB');
    }
  }

  if ('booking_currency' in data) {
    const cur = data.booking_currency;
    if (typeof cur !== 'string' || !isSupportedTenantCurrency(cur)) {
      errors.push('booking_currency phải thuộc curated currency basket: USD, EUR, VND, CNY, JPY, KRW, GBP, AUD, SGD, THB');
    }
  }

  if ('default_locale' in data) {
    const locale = String(data.default_locale || '').trim();
    const supported = new Set(getSupportedLocales());
    if (!supported.has(locale)) {
      errors.push(`default_locale phải thuộc locale catalog hiện có: ${[...supported].join(', ')}`);
    }
  }

  if ('market_skin_key' in data) {
    if (!isSupportedMarketSkin(data.market_skin_key)) {
      errors.push('market_skin_key không thuộc curated market skin catalog.');
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
    const validation = validateSubdomainCandidate(data.subdomain, {
      allowReserved: true,
      lockOnce: false,
      enforceRiskChecks: false,
    });
    if (!validation.ok) {
      errors.push('subdomain phải gồm chữ thường, số, dấu gạch ngang, không bắt đầu/kết thúc bằng gạch ngang, và dài từ 3 đến 63 ký tự.');
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
    safeData.subdomain = validateSubdomainCandidate(safeData.subdomain, {
      allowReserved: true,
      lockOnce: false,
      enforceRiskChecks: false,
    }).normalized;
  }

  if ('target_currency' in safeData) {
    safeData.target_currency = String(safeData.target_currency || '').trim().toUpperCase();
  }

  if ('booking_currency' in safeData) {
    safeData.booking_currency = String(safeData.booking_currency || '').trim().toUpperCase();
  }

  if ('default_locale' in safeData) {
    safeData.default_locale = String(safeData.default_locale || '').trim();
  }

  if ('market_skin_key' in safeData) {
    safeData.market_skin_key = String(safeData.market_skin_key || '').trim();
    const preset = getMarketSkin(safeData.market_skin_key);
    if (!('booking_currency' in safeData)) safeData.booking_currency = preset.booking_currency;
    if (!('default_locale' in safeData)) safeData.default_locale = preset.default_locale;
    if (!('primary_market' in safeData)) safeData.primary_market = preset.primary_market;
  }

  if ('primary_market' in safeData) {
    safeData.primary_market = String(safeData.primary_market || '').trim().toUpperCase();
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
      .prepare('SELECT name, exchange_rate, target_currency, booking_currency, default_locale, market_skin_key, primary_market, pricing_policy, infant_policy_text, pricing_notes_text, custom_domain, subdomain, subscription_status, terms_accepted, terms_accepted_at, stripe_customer_id, onboarding_step, payment_config_json, trust_status, trust_score, trust_reasons_json, trust_reviewed_at, trust_reviewed_by, custom_domain_verified_at, public_indexing_enabled FROM tenants WHERE id = ?')
      .bind(tenantId)
      .first();

    if (!current) {
      return c.json({ error: 'Tenant không tồn tại' }, 404);
    }

    if ('subdomain' in safeData) {
      const validation = validateSubdomainCandidate(safeData.subdomain, {
        currentSubdomain: current.subdomain,
        tenantName: current.name,
        env: c.env,
      });
      if (!validation.ok) {
        if (validation.review_required) {
          await createTenantReviewCase(c.env, {
            tenantId,
            category: 'subdomain_review',
            severity: 'review',
            signalKey: `subdomain:${validation.normalized}`,
            summary: validation.reason,
            evidence: {
              attempted_subdomain: validation.normalized,
              review: validation.review,
              suggestions: validation.suggestions,
            },
          });
          await dispatchSubdomainReviewAlert(c.env, {
            tenantId,
            tenantName: current.name,
            attemptedSubdomain: validation.normalized || String(safeData.subdomain || '').trim().toLowerCase(),
            currentSubdomain: current.subdomain || null,
            suggestions: validation.suggestions,
            review: validation.review,
            ip: c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? null,
            userAgent: c.req.header('User-Agent') ?? null,
          });
        }
        return c.json({
          error: validation.reason,
          code: validation.code,
          review_required: validation.review_required,
          review: validation.review,
          subdomain_policy: validation.policy,
          suggestions: validation.suggestions,
        }, 409);
      }
      safeData.subdomain = validation.normalized;

      if (!current.subdomain && normalizeTrustStatus(current.trust_status) === 'PREVIEW_ONLY') {
        safeData.trust_status = 'PROBATION';
        safeData.trust_reviewed_at = Math.floor(Date.now() / 1000);
        safeData.trust_reviewed_by = 'system:auto-probation';
      }
    }

    if ('custom_domain' in safeData) {
      const requestedDomain = safeData.custom_domain === null
        ? null
        : String(safeData.custom_domain || '').trim().toLowerCase();
      const trustPolicy = buildTenantTrustPolicy(current);

      if (requestedDomain && !trustPolicy.can_bind_custom_domain) {
        await createTenantReviewCase(c.env, {
          tenantId,
          category: 'custom_domain_request',
          severity: 'review',
          signalKey: `custom-domain:${requestedDomain}`,
          summary: `Custom domain "${requestedDomain}" requested before tenant reached TRUSTED status.`,
          evidence: {
            requested_domain: requestedDomain,
            current_trust_status: current.trust_status,
          },
        });
        return c.json({
          error: 'Custom domain is only available after this tenant reaches TRUSTED status. Continue with the platform subdomain first.',
          code: 'CUSTOM_DOMAIN_TRUST_REQUIRED',
          trust_state: buildTenantTrustState(current),
        }, 409);
      }

      safeData.custom_domain = requestedDomain;
      if (requestedDomain && requestedDomain !== String(current.custom_domain || '').trim().toLowerCase()) {
        safeData.custom_domain_verified_at = null;
        safeData.public_indexing_enabled = 0;
        await createTenantReviewCase(c.env, {
          tenantId,
          category: 'custom_domain_verification',
          severity: 'review',
          signalKey: `custom-domain-verify:${requestedDomain}`,
          summary: `Custom domain "${requestedDomain}" requires manual ownership verification before going live.`,
          evidence: {
            requested_domain: requestedDomain,
            trust_status: current.trust_status,
          },
        });
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
      .prepare('SELECT exchange_rate, target_currency, booking_currency, pricing_policy, infant_policy_text, pricing_notes_text, custom_domain, subdomain, subscription_status, terms_accepted, terms_accepted_at, stripe_customer_id, onboarding_step, payment_config_json, default_locale, base_currency, primary_market, market_skin_key, total_revenue_tracked, commission_threshold, product_tier_key, trust_status, trust_score, trust_reasons_json, trust_reviewed_at, trust_reviewed_by, custom_domain_verified_at, public_indexing_enabled, site_published_at, published_template_id FROM tenants WHERE id = ?')
      .bind(tenantId)
      .first();

    // Parse payment_config_json back to object for the API response
    if (updated && updated.payment_config_json) {
      try { updated.payment_config_json = JSON.parse(updated.payment_config_json); }
      catch { /* leave as string if malformed */ }
    }

    const lang = resolveTenantCatalogLocale(c.req.header('Accept-Language'), updated);
    return c.json({
      ok: true,
      settings: updated,
      catalogs: { locales: getSupportedLocales(), currencies: getTenantCurrencyCatalog(), market_skins: getMarketSkinCatalog(lang) },
      subdomain_policy: buildSubdomainPolicy(c.env),
      trust_state: buildTenantTrustState(updated),
    });

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
      .prepare('SELECT id, name, email, created_at, exchange_rate, target_currency, booking_currency, pricing_policy, infant_policy_text, pricing_notes_text, custom_domain, subdomain, subscription_status, terms_accepted, terms_accepted_at, stripe_customer_id, onboarding_step, payment_config_json, payment_methods, product_tier_key, default_locale, base_currency, primary_market, market_skin_key, total_revenue_tracked, commission_threshold, trust_status, trust_score, trust_reasons_json, trust_reviewed_at, trust_reviewed_by, custom_domain_verified_at, public_indexing_enabled, site_published_at, published_template_id FROM tenants WHERE id = ?')
      .bind(tenantId)
      .first();

    if (!settings) {
      return c.json({ error: 'Tenant not found.' }, 404);
    }

    // Parse JSON columns back to objects for the API response
    if (settings.payment_config_json) {
      try { settings.payment_config_json = JSON.parse(settings.payment_config_json); }
      catch { /* leave as string if malformed */ }
    }
    if (settings.payment_methods) {
      try { settings.payment_methods = JSON.parse(settings.payment_methods); }
      catch { settings.payment_methods = []; }
    }

    const lang = resolveTenantCatalogLocale(c.req.header('Accept-Language'), settings);
    return c.json({
      ok: true,
      settings,
      catalogs: { locales: getSupportedLocales(), currencies: getTenantCurrencyCatalog(), market_skins: getMarketSkinCatalog(lang) },
      subdomain_policy: buildSubdomainPolicy(c.env),
      trust_state: buildTenantTrustState(settings),
    });
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

// GET /api/tenants/review-status
// Tenant-safe moderation visibility: returns current trust state, recent open/recent
// review cases, compact summaries, and actionable guidance without exposing
// raw AI prompts or full internal evidence payloads.
tenants.get('/review-status', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const actor = await requireTenantActor(c, tenantId);
  if (actor.error) return actor.error;

  let tenant = await c.env.DB
    .prepare('SELECT id, name, email, trust_status, trust_score, trust_reasons_json, trust_reviewed_at, trust_reviewed_by, custom_domain_verified_at, public_indexing_enabled, subscription_status FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();
  if (!tenant) return c.json({ error: 'Tenant not found.' }, 404);

  const refreshedPublish = await refreshOpenPublishReviewCase(c.env, tenant);
  tenant = refreshedPublish.tenant || tenant;
  const refreshedAssets = await refreshOpenAssetReviewCases(c.env, tenant);
  tenant = refreshedAssets.tenant || tenant;

  const { results } = await c.env.DB
    .prepare(
      `SELECT id, status, category, severity, signal_key, summary, evidence_json, created_at, resolved_at, resolved_by, resolution_note
         FROM tenant_review_cases
        WHERE tenant_id = ?
        ORDER BY created_at DESC
        LIMIT 10`
    )
    .bind(tenantId)
    .all();

  const reviewCases = (results || []).map((row) => {
    let evidence = null;
    try {
      evidence = row.evidence_json ? JSON.parse(row.evidence_json) : null;
    } catch {
      evidence = null;
    }
    return {
      id: row.id,
      status: row.status,
      category: row.category,
      severity: row.severity,
      signal_key: row.signal_key,
      summary: row.summary,
      created_at: row.created_at,
      resolved_at: row.resolved_at,
      resolved_by: row.resolved_by,
      resolution_note: row.resolution_note,
      feedback: buildTenantSafeReviewFeedback(evidence, { stage: row.category }),
    };
  });
  const moderationCases = reviewCases.filter((entry) => isTenantModerationCategory(entry.category));

  return c.json({
    ok: true,
    tenant_id: tenantId,
    trust_state: buildTenantTrustState(tenant),
    has_open_review: moderationCases.some((entry) => entry.status === 'OPEN'),
    review_cases: moderationCases,
    other_open_cases: reviewCases.filter((entry) => entry.status === 'OPEN' && !isTenantModerationCategory(entry.category)),
  });
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

function buildReviewActionHtml(title, message) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>body{font-family:ui-sans-serif,system-ui,sans-serif;background:#f8fafc;color:#0f172a;padding:32px}main{max-width:680px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:24px;box-shadow:0 12px 30px rgba(15,23,42,.08)}h1{margin:0 0 12px;font-size:24px}p{margin:0;font-size:15px;line-height:1.6;color:#475569}</style></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;
}

publicConfig.get('/review-action/:action', async (c) => {
  const action = String(c.req.param('action') || '').trim().toLowerCase();
  const tenantId = String(c.req.query('tenant_id') || '').trim();
  const reviewCaseId = String(c.req.query('review_case_id') || '').trim();
  const expiresAt = Number(c.req.query('expires') || 0);
  const sig = String(c.req.query('sig') || '').trim();

  if (!['approve', 'disapprove'].includes(action) || !tenantId || !reviewCaseId || !expiresAt || !sig) {
    return c.html(buildReviewActionHtml('Invalid review action', 'This review action link is incomplete or invalid.'), 400);
  }
  if (!c.env.ADMIN_SECRET) {
    return c.html(buildReviewActionHtml('Review actions unavailable', 'ADMIN_SECRET is not configured on this environment.'), 503);
  }
  if (expiresAt < Math.floor(Date.now() / 1000)) {
    return c.html(buildReviewActionHtml('Review action expired', 'This Telegram review action link has expired. Send a new review alert and try again.'), 410);
  }

  const expectedSig = await buildSignedReviewActionSignature(c.env.ADMIN_SECRET, {
    action,
    tenantId,
    reviewCaseId,
    expiresAt,
  });
  if (sig !== expectedSig) {
    return c.html(buildReviewActionHtml('Unauthorized review action', 'The review action signature is invalid.'), 401);
  }

  const tenant = await c.env.DB
    .prepare('SELECT id, trust_status, public_indexing_enabled FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();
  if (!tenant) {
    return c.html(buildReviewActionHtml('Tenant not found', 'The tenant attached to this review action no longer exists.'), 404);
  }

  const reviewCase = await c.env.DB
    .prepare('SELECT id, status, category, severity, signal_key, summary FROM tenant_review_cases WHERE id = ? AND tenant_id = ? LIMIT 1')
    .bind(reviewCaseId, tenantId)
    .first();
  if (!reviewCase) {
    return c.html(buildReviewActionHtml('Review case not found', 'The review case attached to this action could not be found.'), 404);
  }
  if (reviewCase.status !== 'OPEN') {
    return c.html(buildReviewActionHtml('Review case already resolved', 'This review case has already been resolved.'), 200);
  }

  const now = Math.floor(Date.now() / 1000);
  const nextTrustStatus = action === 'approve'
    ? (normalizeTrustStatus(tenant.trust_status) === 'PREVIEW_ONLY' ? 'PROBATION' : normalizeTrustStatus(tenant.trust_status))
    : 'PREVIEW_ONLY';
  const nextPublicIndexing = action === 'approve' ? tenant.public_indexing_enabled === 1 || tenant.public_indexing_enabled === true ? 1 : 0 : 0;
  const caseStatus = action === 'approve' ? 'APPROVED' : 'REJECTED';
  const resolutionNote = action === 'approve'
    ? 'Approved from Telegram review action.'
    : 'Rejected from Telegram review action.';

  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE tenants SET trust_status = ?, public_indexing_enabled = ?, trust_reviewed_at = ?, trust_reviewed_by = ? WHERE id = ?').bind(nextTrustStatus, nextPublicIndexing, now, `telegram:${action}`, tenantId),
    c.env.DB.prepare('UPDATE tenant_review_cases SET status = ?, resolved_at = ?, resolved_by = ?, resolution_note = ? WHERE id = ? AND tenant_id = ?').bind(caseStatus, now, `telegram:${action}`, resolutionNote, reviewCaseId, tenantId),
  ]);

  return c.html(
    buildReviewActionHtml(
      action === 'approve' ? 'Review approved' : 'Review rejected',
      action === 'approve'
        ? 'The review case was approved successfully. The tenant can retry publishing with the updated moderation flow.'
        : 'The review case was rejected successfully. The tenant remains blocked until the flagged content is corrected and reviewed again.'
    ),
    200
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tenant/accept-terms  (admin — X-Tenant-ID required)
// ─────────────────────────────────────────────────────────────────────────────
// Dedicated legal-consent endpoint. Idempotent.
publicConfig.post('/accept-terms', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const actor = await requireTenantActor(c, tenantId);
  if (actor.error) return actor.error;

  const existing = await c.env.DB
    .prepare('SELECT id, terms_accepted, terms_accepted_at, onboarding_step, trust_status, subdomain FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();

  if (!existing) {
    return c.json({ error: 'Tenant not found.' }, 404);
  }

  const now = Math.floor(Date.now() / 1000);
  const acceptedAt = Number(existing.terms_accepted_at || 0) > 0 ? Number(existing.terms_accepted_at) : now;
  const nextOnboardingStep = (!existing.onboarding_step || String(existing.onboarding_step).trim() === '' || existing.onboarding_step === 'SUBDOMAIN_SELECTED')
    ? 'TERMS_ACCEPTED'
    : existing.onboarding_step;
  const autoProbation = normalizeTrustStatus(existing.trust_status) === 'PREVIEW_ONLY' && String(existing.subdomain || '').trim();

  await c.env.DB
    .prepare(
      `UPDATE tenants
          SET terms_accepted = 1,
              terms_accepted_at = ?,
              onboarding_step = ?,
              trust_status = CASE WHEN ? = 1 THEN 'PROBATION' ELSE trust_status END,
              trust_reviewed_at = CASE WHEN ? = 1 THEN ? ELSE trust_reviewed_at END,
              trust_reviewed_by = CASE WHEN ? = 1 THEN 'system:auto-probation-terms' ELSE trust_reviewed_by END
        WHERE id = ?`
    )
    .bind(acceptedAt, nextOnboardingStep, autoProbation ? 1 : 0, autoProbation ? 1 : 0, now, autoProbation ? 1 : 0, tenantId)
    .run();

  if (existing.terms_accepted !== 1) {
    try {
      await c.env.DB
        .prepare(
          `INSERT INTO tenant_audit_log
             (id, tenant_id, field_name, old_value, new_value, changed_at, changed_by, action, entity_type, entity_id, created_at)
           VALUES (?, ?, 'terms_accepted', ?, ?, ?, ?, 'TERMS_ACCEPTED', 'tenant', ?, ?)`
        )
        .bind(
          nanoid(),
          tenantId,
          String(existing.terms_accepted ?? 0),
          '1',
          now,
          actor.session?.user_id ?? null,
          tenantId,
          now,
        )
        .run();
    } catch (err) {
      console.warn('[TERMS_ACCEPT_AUDIT_WARN]', err?.message);
    }
  }

  return c.json({
    ok: true,
    terms_accepted: true,
    terms_accepted_at: acceptedAt,
    accepted_at: new Date(acceptedAt * 1000).toISOString(),
    onboarding_step: nextOnboardingStep,
  });
});

function classifyTenantHostType(host, tenant) {
  const bareHost = String(host || '').split(':')[0].trim().toLowerCase();
  const customDomain = String(tenant?.custom_domain || '').trim().toLowerCase();
  const subdomain = String(tenant?.subdomain || '').trim().toLowerCase();
  if (customDomain && bareHost === customDomain) return 'custom_domain';
  if (subdomain && bareHost) {
    const firstLabel = bareHost.split('.')[0];
    if (firstLabel === subdomain) return 'platform_subdomain';
  }
  return bareHost ? 'unknown' : 'admin_preview';
}

publicConfig.get('/config', async (c) => {
  const host = c.req.header('host') ?? '';

  let tenant = null;
  try {
    // Admin bypass: X-Tenant-ID header allows direct lookup (for Dashboard/localhost).
    // Public pages (inject.js) never send this header — they resolve via Host.
    const adminId = c.req.header('X-Tenant-ID')?.trim();
    if (adminId) {
      tenant = await c.env.DB
        .prepare('SELECT id, template_id, site_config, payment_methods, default_locale, booking_currency, market_skin_key, primary_market, subscription_status, terms_accepted, trust_status, custom_domain_verified_at, subdomain, custom_domain, promo_activated FROM tenants WHERE id = ?')
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
  const paymentMethods = parseTenantPaymentMethods(tenant.payment_methods);
  const hostType = tenant.resolved_host_type || classifyTenantHostType(host, tenant);
  const commercialPolicy = buildTenantCommercialPolicy(tenant, { paymentMethods, hostType });

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
        chrome_config: {
          useMinimalHeader: cfg.chrome_config?.useMinimalHeader !== false,
          useMinimalFooter: cfg.chrome_config?.useMinimalFooter !== false,
          showFooterMenu:   cfg.chrome_config?.showFooterMenu === true,
          showLogo:         cfg.chrome_config?.showLogo !== false,
          effectStyle:      typeof cfg.chrome_config?.effectStyle === 'string'
            ? cfg.chrome_config.effectStyle
            : 'glass',
          shapeStyle:       typeof cfg.chrome_config?.shapeStyle === 'string'
            ? cfg.chrome_config.shapeStyle
            : 'bar',
          menuFontStyle:    typeof cfg.chrome_config?.menuFontStyle === 'string'
            ? cfg.chrome_config.menuFontStyle
            : 'clean',
          logoFontStyle:    typeof cfg.chrome_config?.logoFontStyle === 'string'
            ? cfg.chrome_config.logoFontStyle
            : 'brand',
          logoSize:         typeof cfg.chrome_config?.logoSize === 'string'
            ? cfg.chrome_config.logoSize
            : 'md',
          ornamentStyle:    typeof cfg.chrome_config?.ornamentStyle === 'string'
            ? cfg.chrome_config.ornamentStyle
            : 'none',
        },
      default_locale: typeof tenant.default_locale === 'string' ? tenant.default_locale : 'en-US',
      booking_currency: typeof tenant.booking_currency === 'string' ? tenant.booking_currency : 'USD',
      market_skin_key: typeof tenant.market_skin_key === 'string' ? tenant.market_skin_key : 'global-default',
      primary_market: typeof tenant.primary_market === 'string' ? tenant.primary_market : 'GLOBAL',
      payment_methods:  paymentMethods,
      commercial_policy: commercialPolicy,
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
  const actor = await requireTenantActor(c, tenantId);
  if (actor.error) return actor.error;

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
// Showcase publish gates:
//   TEMPLATE  — template_id must be set on the tenant row
//   CONTENT   — at least one tour (any status) in the tours table
//   IDENTITY  — subdomain/custom_domain set AND terms_accepted = 1
//   TRUST     — trust ladder allows public exposure
//
// Commercial activation gates are returned separately:
//   custom domain verified + ACTIVE + TRUSTED + >=1 payment method enabled
//
// Intentionally separate from publishGuard so the dashboard can display the
// checklist WITHOUT triggering a publish attempt.
//
// Response shape:
//   { ok: boolean, missing: string[], data: { <gate>: { pass, detail } } }
publicConfig.get('/publish-readiness', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);
  const actor = await requireTenantActor(c, tenantId);
  if (actor.error) return actor.error;

  const tenant = await c.env.DB
    .prepare(
       `SELECT t.id, t.template_id, t.subdomain, t.custom_domain,
              terms_accepted, payment_methods, subscription_status,
            trust_status, public_indexing_enabled, custom_domain_verified_at,
            onboarding_step, us.variant_key
          FROM tenants t
          LEFT JOIN tenant_universal_sites us ON us.tenant_id = t.id
         WHERE t.id = ?`
    )
    .bind(tenantId)
    .first();
  if (!tenant) return c.json({ error: 'Tenant not found.' }, 404);

  const hasTemplate = !!(
    (tenant.template_id && String(tenant.template_id).trim())
    || (tenant.variant_key && String(tenant.variant_key).trim())
  );
  const activeDesignKey = String(tenant.variant_key || tenant.template_id || '').trim();

  if (normalizeTrustStatus(tenant.trust_status) === 'PREVIEW_ONLY' && String(tenant.subdomain || '').trim()) {
    const autoProbationAt = Math.floor(Date.now() / 1000);
    await c.env.DB
      .prepare('UPDATE tenants SET trust_status = ?, trust_reviewed_at = ?, trust_reviewed_by = ? WHERE id = ?')
      .bind('PROBATION', autoProbationAt, 'system:auto-probation-readiness', tenantId)
      .run();
    tenant.trust_status = 'PROBATION';
  }

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
  const paymentMethods = parseTenantPaymentMethods(tenant.payment_methods);
  const hasGateway = hasEnabledElectronicGateway(paymentMethods);
  const hasPaymentMethod = hasEnabledPaymentMethod(paymentMethods);
  const commercialPolicy = buildTenantCommercialPolicy(tenant, {
    paymentMethods,
    hostType: tenant.custom_domain ? 'custom_domain' : (tenant.subdomain ? 'platform_subdomain' : 'unknown'),
  });

  // ── Build data map ─────────────────────────────────────────────────────────
  const data = {
    TEMPLATE: {
      pass:          hasTemplate,
      label:         'Template đã chọn',
      detail:        hasTemplate
        ? `Website skin hiện tại: ${activeDesignKey}`
        : 'Chưa chọn website skin. Mở Website Design và chọn một skin/sample trước khi xuất bản.',
      action_url:    hasTemplate ? null : '/universal-admin.html?panel=system&onboarding=skin',
      value:         activeDesignKey || null,
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
    TRUST: {
      pass:          buildTenantTrustPolicy(tenant).allow_publish,
      label:         'Trust ladder cho phep public exposure',
      detail:        buildTenantTrustPolicy(tenant).allow_publish
        ? `Trust status: ${tenant.trust_status || 'PREVIEW_ONLY'}`
        : `Trust status hiện tại: ${tenant.trust_status || 'PREVIEW_ONLY'}. Tenant cần qua review trước khi public publish.`,
      action_url:    buildTenantTrustPolicy(tenant).allow_publish ? null : '/dashboard.html#launch',
      value:         tenant.trust_status || 'PREVIEW_ONLY',
    },
    COMMERCIAL: {
      pass:          commercialPolicy.commercial_activation_enabled,
      label:         'Commercial activation',
      detail:        commercialPolicy.commercial_activation_enabled
        ? 'Custom domain da verify va it nhat 1 payment method da bat. Tenant co the kinh doanh tren domain rieng.'
        : commercialPolicy.message,
      action_url:    commercialPolicy.commercial_activation_enabled ? null : '/dashboard.html#domain',
      value:         {
        custom_domain_verified: commercialPolicy.custom_domain_verified,
        payment_configured: hasPaymentMethod,
        electronic_gateway_configured: hasGateway,
      },
    },
  };

  // ── Collect missing gates ──────────────────────────────────────────────────
  const missing = Object.entries(data)
    .filter(([, v]) => !v.pass)
    .map(([k]) => k);

  const ok = ['TEMPLATE', 'CONTENT', 'DOMAIN', 'TERMS', 'TRUST'].every((key) => data[key].pass);

  return c.json({
    ok,
    missing,
    ready_to_publish: ok,
    commercial_ready: commercialPolicy.commercial_activation_enabled,
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
  const actor = await requireTenantActor(c, tenantId);
  if (actor.error) return actor.error;
  const session = actor.session;

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Request body is not valid JSON.' }, 400); }

  // [SEC] Read existing config, verify tenant exists (prevents phantom-tenant writes)
  const row = await c.env.DB
    .prepare('SELECT id, name, subscription_status, trust_status, trust_score, trust_reasons_json, public_indexing_enabled, subdomain, custom_domain, site_config FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();
  if (!row) return c.json({ error: 'Tenant not found.' }, 404);

  let cfg = {};
  try { if (row.site_config) cfg = JSON.parse(row.site_config); } catch {}

  // Merge each allowed section with shallow Object.assign.
  // Sections not present in the request body are left untouched.
  const ALLOWED_SECTIONS = ['brand', 'content', 'features', 'custom_selectors', 'custom_imgs', 'analytics'];
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

  // [SEC] Validate analytics: only well-known ID patterns accepted to prevent script injection.
  //   GA4:  G-XXXXXXXXXX  (letters/digits, 1-12 chars after G-)
  //   GTM:  GTM-XXXXXXX   (letters/digits, 1-10 chars after GTM-)
  //   FB pixel: numeric only, 1-20 digits
  if (cfg.analytics && typeof cfg.analytics === 'object') {
    const clean = {};
    if (typeof cfg.analytics.ga4_id === 'string') {
      const v = cfg.analytics.ga4_id.trim().toUpperCase();
      if (/^G-[A-Z0-9]{1,12}$/.test(v) || v === '') clean.ga4_id = v;
    }
    if (typeof cfg.analytics.gtm_id === 'string') {
      const v = cfg.analytics.gtm_id.trim().toUpperCase();
      if (/^GTM-[A-Z0-9]{1,10}$/.test(v) || v === '') clean.gtm_id = v;
    }
    if (typeof cfg.analytics.fb_pixel_id === 'string') {
      const v = cfg.analytics.fb_pixel_id.trim();
      if (/^\d{1,20}$/.test(v) || v === '') clean.fb_pixel_id = v;
    }
    cfg.analytics = clean;
  }

  await c.env.DB
    .prepare('UPDATE tenants SET site_config = ? WHERE id = ?')
    .bind(JSON.stringify(cfg), tenantId)
    .run();

  const now = Math.floor(Date.now() / 1000);
  const requestContext = buildRiskRequestContext(c, {
    tenantId,
    userId: session.user_id,
    sessionId: session.id,
  });
  const limits = buildTenantVelocityLimits(row.trust_status);
  const recentConfigWrites = await countRiskEvents(c.env, {
    tenantId,
    eventType: 'site_config_saved',
    since: now - 600,
  });
  const configVelocityScore = recentConfigWrites >= limits.configWritesPer10m
    ? Math.min(45, (recentConfigWrites - limits.configWritesPer10m + 1) * 5)
    : 0;
  const contentRules = analyzeTenantSiteAbuse({ tenant: row, siteConfig: cfg });
  const contentPayload = buildTenantModerationPayload({ tenant: row, siteConfig: cfg, stage: 'config_save' });
  const aiModeration = await moderateTenantContent(c.env, contentPayload, { stage: 'config_save' });
  const moderationOutcome = decideTenantModerationOutcome({ ruleAnalysis: contentRules, aiModeration });
  const riskScore = Math.max(configVelocityScore, moderationOutcome.flagged ? moderationOutcome.risk_score : 0);
  const riskSummaries = [...new Set([
    ...moderationOutcome.summaries,
    configVelocityScore > 0 ? `config save velocity reached ${recentConfigWrites + 1} writes in 10 minutes` : '',
  ].filter(Boolean))].slice(0, 8);

  await createRiskEvent(c.env, {
    ...requestContext,
    eventType: 'site_config_saved',
    severity: moderationOutcome.blocked ? 'high' : moderationOutcome.flagged || configVelocityScore > 0 ? 'review' : 'info',
    riskScore,
    action: moderationOutcome.blocked ? 'trust_hold' : moderationOutcome.flagged || configVelocityScore > 0 ? 'review' : 'observe',
    signalKey: moderationOutcome.flagged ? `config:${moderationOutcome.code}` : configVelocityScore > 0 ? 'config:velocity' : 'config:ok',
    evidence: {
      rules: contentRules,
      ai: aiModeration,
      outcome: moderationOutcome,
      recent_config_writes_10m: recentConfigWrites + 1,
      limits,
    },
    createdAt: now,
  });

  let reviewCaseId = null;
  if (moderationOutcome.flagged || configVelocityScore >= 25) {
    const caseRecord = await createTenantReviewCase(c.env, {
      tenantId,
      category: moderationOutcome.blocked ? 'config_content_blocked' : moderationOutcome.flagged ? 'config_content_review' : 'config_velocity_review',
      severity: moderationOutcome.blocked ? 'block' : 'review',
      signalKey: moderationOutcome.flagged ? `config:${moderationOutcome.code}` : `config-velocity:${Math.floor(now / 600)}`,
      summary: moderationOutcome.flagged
        ? moderationOutcome.reason
        : `Config save velocity is unusually high for this tenant (${recentConfigWrites + 1} writes in 10 minutes).`,
      evidence: {
        rules: contentRules,
        ai: aiModeration,
        outcome: moderationOutcome,
        recent_config_writes_10m: recentConfigWrites + 1,
        limits,
      },
    });
    reviewCaseId = caseRecord.id || null;
    await applySoftTrustHold(c.env, row, {
      reasons: riskSummaries,
      reviewedBy: moderationOutcome.flagged ? 'system:config-risk' : 'system:config-velocity',
      riskScore,
    });
  }

  return c.json({
    ok: true,
    site_config: cfg,
    review_required: Boolean(reviewCaseId),
    review_case_id: reviewCaseId,
    review_message: reviewCaseId ? buildTenantModerationUserMessage(moderationOutcome, { stage: 'config_save' }) : '',
    risk_evaluation: {
      rules: contentRules,
      ai: aiModeration,
      outcome: moderationOutcome,
      config_velocity_score: configVelocityScore,
      recent_config_writes_10m: recentConfigWrites + 1,
      limits,
    },
  });
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
  const actor = await requireTenantActor(c, tenantId);
  if (actor.error) return actor.error;

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
  const actor = await requireTenantActor(c, tenantId);
  if (actor.error) return actor.error;

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

  const actor = await requireTenantActor(c, tenantId);
  if (actor.error) return actor;

  const tenant = await c.env.DB
    .prepare('SELECT id, name, subscription_status, trust_status, trust_score, trust_reasons_json, public_indexing_enabled, subdomain, custom_domain FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();

  if (!tenant) return { error: c.json({ error: 'Tenant not found.' }, 404) };
  return { tenant, session: actor.session };
}

function stripDeletedAssetFromGalleryList(items, assetUrl) {
  return (Array.isArray(items) ? items : []).filter((entry) => {
    if (typeof entry === 'string') return entry !== assetUrl;
    if (entry && typeof entry === 'object') return String(entry.src || '').trim() !== assetUrl;
    return false;
  });
}

function cleanupDeletedAssetFromTourContent(rawContent, assetUrl) {
  let content;
  try {
    content = rawContent ? JSON.parse(rawContent) : {};
  } catch {
    return { changed: false, content: rawContent };
  }

  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return { changed: false, content: rawContent };
  }

  let changed = false;
  if (String(content.destination_image || '').trim() === assetUrl) {
    content.destination_image = '';
    changed = true;
  }
  if (String(content.hero_image || '').trim() === assetUrl) {
    content.hero_image = '';
    changed = true;
  }

  const nextGalleryImages = stripDeletedAssetFromGalleryList(content.gallery_images, assetUrl);
  if (JSON.stringify(nextGalleryImages) !== JSON.stringify(Array.isArray(content.gallery_images) ? content.gallery_images : [])) {
    content.gallery_images = nextGalleryImages;
    changed = true;
  }

  const nextHomeGalleryImages = stripDeletedAssetFromGalleryList(content.home_gallery_images, assetUrl);
  if (JSON.stringify(nextHomeGalleryImages) !== JSON.stringify(Array.isArray(content.home_gallery_images) ? content.home_gallery_images : [])) {
    content.home_gallery_images = nextHomeGalleryImages;
    changed = true;
  }

  const modules = content.universal_modules && typeof content.universal_modules === 'object' ? content.universal_modules : null;
  if (modules) {
    const nextModuleHomeGallery = stripDeletedAssetFromGalleryList(modules.home_gallery_images, assetUrl);
    if (JSON.stringify(nextModuleHomeGallery) !== JSON.stringify(Array.isArray(modules.home_gallery_images) ? modules.home_gallery_images : [])) {
      modules.home_gallery_images = nextModuleHomeGallery;
      changed = true;
    }
  }

  return {
    changed,
    content: changed ? JSON.stringify(content) : rawContent,
  };
}

async function cleanupDeletedAssetReferences(db, tenantId, assetUrl) {
  const { results: tours } = await db
    .prepare('SELECT id, content_data FROM tours WHERE tenant_id = ?')
    .bind(tenantId)
    .all();

  let updatedTours = 0;
  for (const tour of tours || []) {
    if (!String(tour.content_data || '').includes(assetUrl)) continue;
    const cleaned = cleanupDeletedAssetFromTourContent(tour.content_data, assetUrl);
    if (!cleaned.changed) continue;
    await db
      .prepare('UPDATE tours SET content_data = ? WHERE id = ? AND tenant_id = ?')
      .bind(cleaned.content, tour.id, tenantId)
      .run();
    updatedTours += 1;
  }

  return { updatedTours };
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
  const { results: inventoryRows } = await c.env.DB
    .prepare('SELECT filename, moderation_status, visibility, risk_score, reasons_json FROM tenant_asset_inventory WHERE tenant_id = ? AND deleted_at IS NULL')
    .bind(tenantId)
    .all();
  const inventoryByFilename = new Map((inventoryRows || []).map((row) => [row.filename, row]));

  const items = objects
    .map((obj) => {
      const filename = String(obj.key || '').slice(prefix.length);
      if (!SAFE_ASSET_FILENAME_RE.test(filename)) return null;
      const extension = filename.split('.').pop()?.toLowerCase() || '';
      const inventory = inventoryByFilename.get(filename) || null;
      return {
        filename,
        r2_key: obj.key,
        url: `/api/tenant/assets/${tenantId}/${filename}`,
        size: obj.size ?? 0,
        uploaded_at: obj.uploaded ? new Date(obj.uploaded).toISOString() : null,
        mime: EXT_TO_MIME[extension] || null,
        moderation_status: inventory?.moderation_status || 'ALLOW',
        visibility: inventory?.visibility || 'PUBLIC',
        risk_score: Number(inventory?.risk_score || 0),
        reasons: inventory?.reasons_json ? JSON.parse(inventory.reasons_json) : [],
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
  const publicUrl = `/api/tenant/assets/${tenantId}/${filename}`;
  await c.env.TOUR_PAGES.delete(r2Key);
  await c.env.DB
    .prepare('UPDATE tenant_asset_inventory SET deleted_at = ? WHERE tenant_id = ? AND filename = ?')
    .bind(Math.floor(Date.now() / 1000), tenantId, filename)
    .run();
  const cleanup = await cleanupDeletedAssetReferences(c.env.DB, tenantId, publicUrl);
  return c.json({ ok: true, filename, r2_key: r2Key, cleaned_asset_url: publicUrl, cleaned_tours: cleanup.updatedTours });
});

publicConfig.post('/assets/upload', async (c) => {
  // ── Auth ────────────────────────────────────────────────────────────────
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  const requirement = await requireAssetTenant(c, tenantId);
  if (requirement.error) return requirement.error;
  const tenant = requirement.tenant;
  const session = requirement.session;
  const now = Math.floor(Date.now() / 1000);
  const requestContext = buildRiskRequestContext(c, {
    tenantId,
    userId: session.user_id,
    sessionId: session.id,
  });
  const limits = buildTenantVelocityLimits(tenant.trust_status);
  const recentUploads = await countRiskEvents(c.env, {
    tenantId,
    eventType: 'asset_uploaded',
    since: now - 3600,
  });
  if (recentUploads >= limits.assetUploadsPerHour) {
    await createRiskEvent(c.env, {
      ...requestContext,
      eventType: 'asset_upload_throttled',
      severity: 'review',
      riskScore: 65,
      action: 'throttle',
      evidence: {
        recent_uploads_last_hour: recentUploads,
        limit: limits.assetUploadsPerHour,
      },
      createdAt: now,
    });
    return c.json({
      error: 'Upload velocity is temporarily throttled for this tenant. Continue editing and retry in a few minutes.',
      code: 'ASSET_UPLOAD_THROTTLED',
      review_required: true,
    }, 429);
  }

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
  const sha256 = await sha256HexBuffer(buffer);
  const ruleAnalysis = analyzeAssetUpload({
    filename: safeFilename,
    mime: mimeRaw,
    sizeBytes: file.size,
    buffer,
  });
  const duplicateTenantCount = await countAssetReuseAcrossTenants(c.env, sha256, now - (60 * 60 * 24 * 30));
  const aiPayload = buildAssetModerationPayload({
    tenant,
    asset: {
      filename: safeFilename,
      mime: mimeRaw,
      size_bytes: file.size,
      sha256,
    },
    extractedText: ruleAnalysis.extracted_text_excerpt,
    stage: 'asset_upload',
  });
  const aiModeration = await moderateAssetWithAI(c.env, aiPayload, { stage: 'asset_upload' });
  const assetOutcome = decideAssetModerationOutcome({
    ruleAnalysis,
    aiModeration,
    duplicateTenantCount,
  });

  if (assetOutcome.blocked) {
    await createRiskEvent(c.env, {
      ...requestContext,
      eventType: 'asset_upload_blocked',
      severity: 'high',
      riskScore: assetOutcome.risk_score,
      action: 'block',
      assetSha256: sha256,
      signalKey: `asset:${assetOutcome.moderation_status}`,
      evidence: {
        filename: safeFilename,
        mime: mimeRaw,
        size_bytes: file.size,
        rules: ruleAnalysis,
        ai: aiModeration,
        duplicate_tenant_count: duplicateTenantCount,
      },
      createdAt: now,
    });
    await createTenantReviewCase(c.env, {
      tenantId,
      category: 'asset_upload_blocked',
      severity: 'block',
      signalKey: `asset-block:${sha256}`,
      summary: assetOutcome.reason,
      evidence: {
        filename: safeFilename,
        mime: mimeRaw,
        size_bytes: file.size,
        rules: ruleAnalysis,
        ai: aiModeration,
        duplicate_tenant_count: duplicateTenantCount,
      },
    });
    await applySoftTrustHold(c.env, tenant, {
      reasons: assetOutcome.summaries,
      reviewedBy: 'system:asset-upload-block',
      riskScore: assetOutcome.risk_score,
    });
    return c.json({
      error: assetOutcome.reason,
      code: ruleAnalysis.primary_code || 'ASSET_BLOCKED',
      review_required: true,
      analysis: {
        rules: ruleAnalysis,
        ai: aiModeration,
        outcome: assetOutcome,
      },
    }, 403);
  }

  await c.env.TOUR_PAGES.put(r2Key, buffer, {
    httpMetadata: {
      contentType:  mimeRaw,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });

  const publicUrl = `/api/tenant/assets/${tenantId}/${safeFilename}`;
  const assetId = await insertOrReplaceAssetInventory(c.env, {
    tenantId,
    r2Key,
    filename: safeFilename,
    mime: mimeRaw,
    sizeBytes: file.size,
    sha256,
    moderationStatus: assetOutcome.moderation_status,
    visibility: assetOutcome.visibility,
    riskScore: assetOutcome.risk_score,
    reasons: assetOutcome.summaries,
    userId: session.user_id,
    sessionId: session.id,
  });
  await appendAssetScanResult(c.env, {
    assetId,
    provider: 'rules',
    stage: 'asset_upload',
    status: ruleAnalysis.blocked ? 'BLOCK' : ruleAnalysis.review_required ? 'REVIEW' : 'ALLOW',
    riskScore: assetOutcome.risk_score,
    reasons: ruleAnalysis.summaries,
    evidence: ruleAnalysis,
  });
  await appendAssetScanResult(c.env, {
    assetId,
    provider: aiModeration.provider || 'cloudflare-ai',
    stage: 'asset_upload',
    status: aiModeration.skipped ? 'SKIPPED' : aiModeration.recommended_action || 'ALLOW',
    riskScore: aiModeration.risk_score || 0,
    reasons: aiModeration.reasons || [],
    evidence: aiModeration,
  });
  await createRiskEvent(c.env, {
    ...requestContext,
    eventType: 'asset_uploaded',
    severity: assetOutcome.review_required ? 'review' : 'info',
    riskScore: assetOutcome.risk_score,
    action: assetOutcome.review_required ? 'review' : 'observe',
    assetSha256: sha256,
    evidence: {
      filename: safeFilename,
      mime: mimeRaw,
      size_bytes: file.size,
      visibility: assetOutcome.visibility,
      duplicate_tenant_count: duplicateTenantCount,
    },
    createdAt: now,
  });

  if (assetOutcome.review_required) {
    await createTenantReviewCase(c.env, {
      tenantId,
      category: 'asset_upload_review',
      severity: 'review',
      signalKey: `asset-review:${sha256}`,
      summary: assetOutcome.reason,
      evidence: {
        filename: safeFilename,
        mime: mimeRaw,
        size_bytes: file.size,
        rules: ruleAnalysis,
        ai: aiModeration,
        duplicate_tenant_count: duplicateTenantCount,
      },
    });
    await applySoftTrustHold(c.env, tenant, {
      reasons: assetOutcome.summaries,
      reviewedBy: 'system:asset-upload-review',
      riskScore: assetOutcome.risk_score,
    });
  }

  console.info(`[ASSET_UPLOAD] tenant=${tenantId} key=${r2Key} mime=${mimeRaw} bytes=${file.size}`);

  return c.json({
    ok:       true,
    url:      publicUrl,
    r2_key:   r2Key,
    filename: safeFilename,
    mime:     mimeRaw,
    size:     file.size,
    moderation_status: assetOutcome.moderation_status,
    visibility: assetOutcome.visibility,
    review_required: assetOutcome.review_required,
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
  const assetRecord = await fetchTenantAssetRecord(c.env.DB, rawTenantId, rawFilename);
  if (assetRecord?.deleted_at) {
    return new Response('Asset not found.', { status: 404 });
  }
  if (assetRecord && (assetRecord.moderation_status === 'BLOCK' || assetRecord.visibility === 'BLOCKED')) {
    return new Response('Asset not found.', { status: 404 });
  }
  if (assetRecord?.visibility === 'AUTHENTICATED_ONLY') {
    const actor = await requireTenantActor(c, rawTenantId);
    if (actor.error) {
      return new Response('Asset not found.', { status: 404 });
    }
  }
  const obj   = await c.env.TOUR_PAGES.get(r2Key);

  if (!obj) {
    return new Response('Asset not found.', { status: 404 });
  }

  const contentType = obj.httpMetadata?.contentType ?? 'application/octet-stream';

  return new Response(obj.body, {
    headers: {
      'Content-Type':  contentType,
      'Cache-Control': assetRecord?.visibility === 'AUTHENTICATED_ONLY'
        ? 'private, no-store'
        : 'public, max-age=31536000, immutable',
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
  const actor = await requireTenantActor(c, tenantId);
  if (actor.error) return actor.error;

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
  const actor = await requireTenantActor(c, tenantId);
  if (actor.error) return actor.error;
  const session = actor.session;

  const publishNow = Math.floor(Date.now() / 1000);
  const publishLimits = buildTenantVelocityLimits('PROBATION');
  const publishAttempts = await countRiskEvents(c.env, {
    tenantId,
    eventType: 'publish_attempt',
    since: publishNow - 3600,
  });
  if (publishAttempts >= publishLimits.publishAttemptsPerHour) {
    await createRiskEvent(c.env, {
      ...buildRiskRequestContext(c, { tenantId, userId: session.user_id, sessionId: session.id }),
      eventType: 'publish_throttled',
      severity: 'review',
      riskScore: 70,
      action: 'throttle',
      evidence: {
        recent_publish_attempts_last_hour: publishAttempts,
        limit: publishLimits.publishAttemptsPerHour,
      },
      createdAt: publishNow,
    });
    return c.json({
      error: 'Publish attempts are temporarily throttled for this tenant. Continue editing and retry later.',
      code: 'PUBLISH_THROTTLED',
      review_required: true,
    }, 429);
  }

  await createRiskEvent(c.env, {
    ...buildRiskRequestContext(c, { tenantId, userId: session.user_id, sessionId: session.id }),
    eventType: 'publish_attempt',
    severity: 'info',
    riskScore: 0,
    action: 'observe',
    createdAt: publishNow,
  });

  if (!c.env.TOUR_PAGES) {
    return c.json({ error: 'TOUR_PAGES R2 binding is not configured.' }, 503);
  }

  // ── 1. Full publish gate (4 conditions) ──────────────────────────────────
  // checkPublishPermission fetches the tenant row (includes template_id,
  // published_template_id, site_published_at) and enforces showcase publish:
  //   subscription_status in (TRIAL, ACTIVE), terms_accepted=1,
  //   subdomain/custom_domain set, trust ladder allows public exposure.
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

  const universalSiteRow = await c.env.DB
    .prepare('SELECT variant_key FROM tenant_universal_sites WHERE tenant_id = ? LIMIT 1')
    .bind(tenantId)
    .first();
  const usesDynamicUniversalPublish = !tenant.template_id && String(universalSiteRow?.variant_key || '').trim() !== '';

  const tenantSite = await c.env.DB
    .prepare('SELECT id, name, email, subdomain, custom_domain, site_config, trust_status, trust_score, trust_reasons_json FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();

  const moderationInput = await buildPublishModerationInput(c.env, tenantSite || tenant);
  const abuseAnalysis = analyzeTenantSiteAbuse(moderationInput);
  const moderationPayload = buildTenantModerationPayload({ ...moderationInput, stage: 'publish' });
  const aiModeration = await moderateTenantContent(c.env, moderationPayload, { stage: 'publish' });
  const moderationOutcome = decideTenantModerationOutcome({ ruleAnalysis: abuseAnalysis, aiModeration });

  if (moderationOutcome.flagged) {
    const userFacingModerationMessage = buildTenantModerationUserMessage(moderationOutcome, { stage: 'publish' });
    const reasons = mergeTrustReasons(tenantSite?.trust_reasons_json, moderationOutcome.summaries);
    const caseRecord = await createTenantReviewCase(c.env, {
      tenantId,
      category: moderationOutcome.blocked ? 'publish_content_blocked' : 'publish_content_review',
      severity: moderationOutcome.blocked ? 'block' : 'review',
      signalKey: `publish:${moderationOutcome.code}`,
      summary: moderationOutcome.reason,
      evidence: {
        rules: abuseAnalysis,
        ai: aiModeration,
        outcome: moderationOutcome,
      },
    });

    await c.env.DB
      .prepare('UPDATE tenants SET trust_status = ?, trust_score = ?, trust_reasons_json = ?, trust_reviewed_at = ?, trust_reviewed_by = ?, public_indexing_enabled = 0 WHERE id = ?')
      .bind(moderationOutcome.next_trust_status, moderationOutcome.risk_score, JSON.stringify(reasons), Math.floor(Date.now() / 1000), aiModeration?.enabled && !aiModeration?.skipped ? 'system:publish-ai-scan' : 'system:publish-abuse-scan', tenantId)
      .run();

    await sendTelegramModerationAlert(c.env, {
      tenantId,
      tenantName: tenantSite?.name || tenant.name,
      stage: 'publish',
      recommendedAction: moderationOutcome.blocked ? 'QUARANTINE' : 'REVIEW',
      riskScore: moderationOutcome.risk_score,
      summary: moderationOutcome.reason,
      reasons: moderationOutcome.summaries,
      reviewCaseId: caseRecord.id || null,
    });

    return c.json({
      error: userFacingModerationMessage,
      code: moderationOutcome.code,
      review_required: true,
      review_case_id: caseRecord.id || null,
      review_message: userFacingModerationMessage,
      analysis: {
        rules: abuseAnalysis,
        ai: aiModeration,
        outcome: moderationOutcome,
      },
    }, 403);
  }

  const sandboxPrefix = `sandbox/${tenantId}/`;
  const livePrefix    = `live/${tenantId}/`;

  if (usesDynamicUniversalPublish) {
    const now = Math.floor(Date.now() / 1000);
    await c.env.DB
      .prepare(
        `UPDATE tenants
            SET published_template_id = NULL,
                site_published_at = ?
          WHERE id = ?`
      )
      .bind(now, tenantId)
      .run();

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
          now,
          tenantId,
          JSON.stringify({
            mode: 'dynamic_universal',
            variant_key: String(universalSiteRow?.variant_key || '').trim() || null,
            sandbox_files_copied: 0,
            live_files_deleted: 0,
            template_switch: false,
          }),
          now,
        )
        .run();
    } catch (auditErr) {
      console.warn(`[PUBLISH_AUDIT_WARN] tenant=${tenantId}`, auditErr?.message);
    }

    console.info(
      `[SITE_PUBLISH] tenant=${tenantId} mode=dynamic_universal variant=${String(universalSiteRow?.variant_key || '').trim() || 'unknown'}`
    );

    return c.json({
      ok: true,
      tenant_id: tenantId,
      published_at: new Date(now * 1000).toISOString(),
      template_id: null,
      live_prefix: null,
      files_copied: 0,
      files_deleted: 0,
      template_switch: false,
      publish_mode: 'dynamic_universal',
    });
  }

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
  const actor = await requireTenantActor(c, tenantId);
  if (actor.error) return actor.error;

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
  return c.json({
    error: 'Soft publish is disabled. Use POST /api/tenant/publish-site, which now supports showcase publishing on platform subdomains without opening commerce.',
    code: 'SOFT_PUBLISH_DISABLED',
  }, 410);
});

// ─── Trust upgrade request ────────────────────────────────────────────────────
// POST /api/tenants/request-trust-upgrade
// Lets a PROBATION tenant request manual review to become TRUSTED.
// Creates a tenant_review_case (category: trust_upgrade_request).
// Idempotent: repeated requests within 7 days skip case creation and return ok.
tenants.post('/request-trust-upgrade', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required' }, 400);

  const { error: authError } = await requireTenantActor(c, tenantId);
  if (authError) return authError;

  const tenant = await c.env.DB
    .prepare('SELECT trust_status, subdomain, custom_domain FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();
  if (!tenant) return c.json({ error: 'Tenant not found' }, 404);

  const status = normalizeTrustStatus(tenant.trust_status);
  if (status === 'TRUSTED') {
    return c.json({ ok: true, already_trusted: true, message: 'Your account is already verified.' });
  }
  if (status === 'SUSPENDED' || status === 'QUARANTINED') {
    return c.json({ error: 'Account is suspended. Contact support.' }, 403);
  }

  // Idempotency: skip if an open trust_upgrade_request case already exists in the last 7 days.
  const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
  const existing = await c.env.DB
    .prepare(`SELECT id FROM tenant_review_cases
              WHERE tenant_id = ? AND category = 'trust_upgrade_request' AND status = 'OPEN' AND created_at > ?
              LIMIT 1`)
    .bind(tenantId, sevenDaysAgo)
    .first();

  if (existing) {
    return c.json({ ok: true, already_requested: true, message: 'Your verification request is already under review.' });
  }

  const caseResult = await createTenantReviewCase(c.env, {
    tenantId,
    category: 'trust_upgrade_request',
    reason:   `Tenant (subdomain: ${tenant.subdomain ?? 'none'}) submitted a manual trust upgrade request via the dashboard.`,
    status:   'OPEN',
    summary:  'Trust upgrade request — tenant wants TRUSTED status to bind a custom domain.',
  });

  console.info(`[TRUST_UPGRADE_REQUEST] tenant=${tenantId} case_created=${caseResult.created}`);
  return c.json({
    ok:      true,
    requested: true,
    message: 'Your request has been submitted. We will review your account and follow up by email, usually within 1–2 business days.',
  });
});

// ─── Custom-domain DNS verification ──────────────────────────────────────────
// Token value tenants must add as a DNS TXT record to prove ownership.
// Derived from HMAC-SHA256(tenantId:domain, ADMIN_SECRET) — deterministic,
// no extra D1 column needed. First 16 hex chars only (64-bit entropy).
async function buildDomainVerifyToken(adminSecret, tenantId, domain) {
  const raw = `${tenantId.toLowerCase()}:${String(domain || '').trim().toLowerCase()}`;
  if (!adminSecret) {
    // Fallback for local dev without ADMIN_SECRET — readable but insecure
    return `tm-verify-${raw.slice(0, 12)}`;
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(String(adminSecret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(raw));
  const hex = Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 16);
}

// GET /api/tenants/custom-domain-verify
// Returns current domain + verification token + status.
tenants.get('/custom-domain-verify', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required' }, 400);

  const { error: authError } = await requireTenantActor(c, tenantId);
  if (authError) return authError;

  const row = await c.env.DB
    .prepare('SELECT custom_domain, custom_domain_verified_at FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();
  if (!row) return c.json({ error: 'Tenant not found' }, 404);

  const domain = row.custom_domain ? String(row.custom_domain).trim().toLowerCase() : null;
  const token  = await buildDomainVerifyToken(c.env.ADMIN_SECRET, tenantId, domain);
  const txtName = domain ? `_tours-market-verify.${domain}` : null;

  return c.json({
    ok: true,
    domain,
    verified: Boolean(Number(row.custom_domain_verified_at) > 0),
    verified_at: row.custom_domain_verified_at ? new Date(Number(row.custom_domain_verified_at) * 1000).toISOString() : null,
    token,
    txt_record_name:  txtName,
    txt_record_value: token,
    cname_target:     'proxy.tours-market.com',
    instructions: domain ? {
      step1: `Log in to your DNS provider (e.g. Cloudflare, GoDaddy).`,
      step2: `Add a TXT record: name = "${txtName}", value = "${token}"`,
      step3: `Add a CNAME record: name = "${domain}", target = "proxy.tours-market.com"`,
      step4: `Click "Check DNS" below once the records have propagated (may take up to 24 h).`,
    } : null,
  });
});

// POST /api/tenants/custom-domain-verify
// Performs a live DNS TXT lookup. Marks verified on success.
tenants.post('/custom-domain-verify', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required' }, 400);

  const { error: authError } = await requireTenantActor(c, tenantId);
  if (authError) return authError;

  const row = await c.env.DB
    .prepare('SELECT custom_domain, custom_domain_verified_at, trust_status FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();
  if (!row) return c.json({ error: 'Tenant not found' }, 404);

  const domain = row.custom_domain ? String(row.custom_domain).trim().toLowerCase() : null;
  if (!domain) {
    return c.json({ error: 'No custom domain set. Save a custom domain first.', code: 'NO_DOMAIN' }, 400);
  }

  const expectedToken = await buildDomainVerifyToken(c.env.ADMIN_SECRET, tenantId, domain);
  const txtName = `_tours-market-verify.${domain}`;

  // DNS-over-HTTPS lookup via Cloudflare public resolver
  let dnsAnswer = null;
  try {
    const dohUrl = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(txtName)}&type=TXT`;
    const dohRes = await fetch(dohUrl, {
      headers: { Accept: 'application/dns-json' },
      cf: { cacheEverything: false },
    });
    if (dohRes.ok) {
      const dohJson = await dohRes.json();
      // Answers are arrays of { data: '"value"' } — Cloudflare wraps TXT data in quotes
      dnsAnswer = dohJson?.Answer ?? [];
    }
  } catch (dnsErr) {
    console.warn('[DOMAIN_VERIFY_DNS_FETCH_ERR]', dnsErr?.message);
  }

  const verified = Array.isArray(dnsAnswer) && dnsAnswer.some((record) => {
    const val = String(record?.data ?? '').replace(/^"|"$/g, '').trim();
    return val === expectedToken;
  });

  if (!verified) {
    return c.json({
      ok: false,
      verified: false,
      domain,
      expected_txt_name: txtName,
      expected_txt_value: expectedToken,
      message: 'TXT record not found yet. DNS changes can take up to 24 hours to propagate.',
    }, 200);
  }

  // Mark as verified
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB
    .prepare('UPDATE tenants SET custom_domain_verified_at = ? WHERE id = ?')
    .bind(now, tenantId)
    .run();

  // Promote trust: PREVIEW_ONLY → PROBATION once domain ownership is proven
  let trustPromoted = false;
  const currentTrust = normalizeTrustStatus(row.trust_status);
  if (currentTrust === 'PREVIEW_ONLY') {
    await c.env.DB
      .prepare('UPDATE tenants SET trust_status = ? WHERE id = ?')
      .bind('PROBATION', tenantId)
      .run();
    trustPromoted = true;
    console.info(`[DOMAIN_VERIFY_TRUST_PROMOTED] tenant=${tenantId} PREVIEW_ONLY → PROBATION`);
  }

  console.info(`[DOMAIN_VERIFIED] tenant=${tenantId} domain=${domain}`);
  return c.json({
    ok: true,
    verified: true,
    domain,
    verified_at: new Date(now * 1000).toISOString(),
    trust_promoted: trustPromoted,
    message: `Domain ${domain} successfully verified!`,
  });
});

// ── POST /api/tenants/calendar-secret ─────────────────────────────────────
// Generate (or return existing) iCal subscription secret for the tenant.
// POST with ?rotate=1 to invalidate existing subscriptions and issue a new secret.
// [SEC] Requires authenticated session; secret is tenant-scoped.
tenants.post('/calendar-secret', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required' }, 400);

  const rotate = c.req.query('rotate') === '1';
  const tenant = await c.env.DB
    .prepare('SELECT id, calendar_secret FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();
  if (!tenant) return c.json({ error: 'Tenant not found' }, 404);

  // Return existing secret unless caller is rotating
  if (tenant.calendar_secret && !rotate) {
    return c.json({ ok: true, secret: tenant.calendar_secret, rotated: false });
  }

  // Generate a new secret (UUID v4 without hyphens for clean URLs)
  const secret = crypto.randomUUID().replace(/-/g, '');
  await c.env.DB
    .prepare('UPDATE tenants SET calendar_secret = ? WHERE id = ?')
    .bind(secret, tenantId)
    .run();

  return c.json({ ok: true, secret, rotated: rotate });
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

