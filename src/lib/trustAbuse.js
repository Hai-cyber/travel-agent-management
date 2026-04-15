import { nanoid } from 'nanoid';

export const TRUST_STATUSES = Object.freeze([
  'PREVIEW_ONLY',
  'PROBATION',
  'TRUSTED',
  'SUSPENDED',
  'QUARANTINED',
]);

export const REVIEW_CASE_STATUSES = Object.freeze([
  'OPEN',
  'APPROVED',
  'REJECTED',
  'RESOLVED',
]);

const TRUST_STATUS_SET = new Set(TRUST_STATUSES);
const REVIEW_CASE_STATUS_SET = new Set(REVIEW_CASE_STATUSES);
const PLATFORM_PUBLIC_STATUSES = new Set(['PROBATION', 'TRUSTED']);
const BLOCKED_PUBLIC_STATUSES = new Set(['SUSPENDED', 'QUARANTINED']);

const BLOCK_CONTENT_PATTERNS = Object.freeze([
  {
    key: 'credential_form',
    category: 'content_phishing',
    severity: 'block',
    summary: 'contains credential capture fields',
    pattern: /type\s*=\s*["']password["']|autocomplete\s*=\s*["'](?:current|new)-password["']|name\s*=\s*["']password["']/i,
  },
  {
    key: 'adult_content',
    category: 'content_adult',
    severity: 'block',
    summary: 'contains explicit adult content markers',
    pattern: /\b(?:escort|camgirl|porn(?:hub)?|xxx|sex\s*cam|adult\s*video)\b/i,
  },
  {
    key: 'credential_theft_copy',
    category: 'content_phishing',
    severity: 'block',
    summary: 'contains account takeover style copy',
    pattern: /\b(?:verify\s+your\s+account|confirm\s+your\s+password|wallet\s+verification|bank\s+login|secure\s+account\s+check)\b/i,
  },
]);

const REVIEW_CONTENT_PATTERNS = Object.freeze([
  {
    key: 'gambling_terms',
    category: 'content_review',
    severity: 'review',
    summary: 'contains gambling-related keywords',
    pattern: /\b(?:casino|sportsbook|betting|online\s+poker|slot\s+machine)\b/i,
  },
  {
    key: 'pharma_terms',
    category: 'content_review',
    severity: 'review',
    summary: 'contains pharma affiliate keywords',
    pattern: /\b(?:viagra|cialis|levitra|pharmacy\s+deal|prescription\s+free)\b/i,
  },
  {
    key: 'finance_bait_terms',
    category: 'content_review',
    severity: 'review',
    summary: 'contains finance bait keywords',
    pattern: /\b(?:crypto\s+giveaway|airdrop\s+bonus|forex\s+signal|instant\s+loan|payday\s+loan)\b/i,
  },
]);

function dedupe(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function parseJsonValue(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeLinkHost(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function stripHtmlTags(value) {
  return String(value || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
}

function summarizeSignals(signals) {
  return dedupe(signals.map((signal) => signal.summary)).slice(0, 4);
}

const TENANT_REVIEW_GUIDANCE_MAP = Object.freeze({
  credential_form: 'Remove any password/login/credential fields from public pages.',
  credential_theft_copy: 'Avoid copy such as "verify account", "confirm password", or similar security-verification prompts on public pages.',
  adult_content: 'Remove explicit adult wording or media from public pages.',
  gambling_terms: 'Remove gambling, betting, casino, poker, or sportsbook wording unless explicitly approved by platform policy.',
  pharma_terms: 'Remove pharma affiliate wording such as Viagra/Cialis/pharmacy deal claims.',
  finance_bait_terms: 'Remove crypto giveaway, forex signal, instant loan, payday loan, or similar finance-bait wording.',
  excessive_external_links: 'Reduce outbound links and keep public navigation focused on your own travel site and normal contact channels.',
  phishing: 'Avoid public content that looks like account verification, secure login, wallet verification, or credential capture.',
  impersonation: 'Make sure branding clearly matches your own travel business and does not imitate other brands or services.',
  seo_spam: 'Remove keyword stuffing, repetitive sales bait, and link-heavy SEO pages that do not look like a normal travel storefront.',
});

function extractAbsoluteLinks(value) {
  const links = [];
  const regex = /(?:href|src)\s*=\s*["'](https?:\/\/[^"']+)["']/gi;
  const input = String(value || '');
  let match;
  while ((match = regex.exec(input))) {
    links.push(match[1]);
  }
  return links;
}

export function normalizeTrustStatus(value, fallback = 'PREVIEW_ONLY') {
  const normalized = String(value || '').trim().toUpperCase();
  return TRUST_STATUS_SET.has(normalized) ? normalized : fallback;
}

export function normalizeReviewCaseStatus(value, fallback = 'OPEN') {
  const normalized = String(value || '').trim().toUpperCase();
  return REVIEW_CASE_STATUS_SET.has(normalized) ? normalized : fallback;
}

export function parseTrustReasons(value) {
  const parsed = parseJsonValue(value, []);
  return Array.isArray(parsed) ? parsed.map((entry) => String(entry).trim()).filter(Boolean) : [];
}

export function mergeTrustReasons(existingValue, newReasons = []) {
  return dedupe([
    ...parseTrustReasons(existingValue),
    ...newReasons.map((entry) => String(entry).trim()),
  ]).slice(0, 12);
}

export function buildTenantTrustPolicy(tenant = {}) {
  const trustStatus = normalizeTrustStatus(tenant.trust_status);
  const publicIndexingEnabled = tenant.public_indexing_enabled === 1 || tenant.public_indexing_enabled === true;
  const customDomainVerified = Number(tenant.custom_domain_verified_at || 0) > 0;

  return {
    trust_status: trustStatus,
    public_indexing_enabled: publicIndexingEnabled,
    custom_domain_verified: customDomainVerified,
    custom_domain_verified_at: tenant.custom_domain_verified_at ?? null,
    can_use_platform_subdomain: PLATFORM_PUBLIC_STATUSES.has(trustStatus),
    can_use_custom_domain: trustStatus === 'TRUSTED' && customDomainVerified,
    can_bind_custom_domain: trustStatus === 'TRUSTED',
    force_noindex: trustStatus !== 'TRUSTED' || !publicIndexingEnabled,
    robots_directive: trustStatus === 'TRUSTED' && publicIndexingEnabled
      ? 'index, follow'
      : 'noindex, nofollow, noarchive',
    public_surface_blocked: BLOCKED_PUBLIC_STATUSES.has(trustStatus),
    allow_publish: !BLOCKED_PUBLIC_STATUSES.has(trustStatus) && trustStatus !== 'PREVIEW_ONLY',
  };
}

export function buildTenantTrustState(tenant = {}) {
  const policy = buildTenantTrustPolicy(tenant);
  return {
    status: policy.trust_status,
    score: Number(tenant.trust_score || 0),
    reasons: parseTrustReasons(tenant.trust_reasons_json),
    reviewed_at: tenant.trust_reviewed_at ?? null,
    reviewed_by: tenant.trust_reviewed_by ?? null,
    public_indexing_enabled: policy.public_indexing_enabled,
    custom_domain_verified_at: policy.custom_domain_verified_at,
    policy,
  };
}

export async function createTenantReviewCase(env, details = {}) {
  if (!env?.DB || !details.tenantId) return { ok: false, created: false, skipped: true };

  const tenantId = String(details.tenantId).trim();
  const status = normalizeReviewCaseStatus(details.status, 'OPEN');
  const category = String(details.category || 'general_review').trim().toLowerCase();
  const severity = String(details.severity || 'review').trim().toLowerCase();
  const signalKey = String(details.signalKey || `${category}:${details.summary || 'review'}`).trim().slice(0, 255);
  const summary = String(details.summary || 'Manual review required.').trim().slice(0, 500);
  const now = Math.floor(Date.now() / 1000);
  const evidenceJson = JSON.stringify(details.evidence || null);

  const existing = await env.DB
    .prepare(
      `SELECT id
         FROM tenant_review_cases
        WHERE tenant_id = ?
          AND signal_key = ?
          AND status = 'OPEN'
        LIMIT 1`
    )
    .bind(tenantId, signalKey)
    .first();

  if (existing?.id) {
    return { ok: true, created: false, id: existing.id };
  }

  const id = nanoid();
  await env.DB
    .prepare(
      `INSERT INTO tenant_review_cases
         (id, tenant_id, status, category, severity, signal_key, summary, evidence_json, created_at, auto_created)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .bind(id, tenantId, status, category, severity, signalKey, summary, evidenceJson, now)
    .run();

  return { ok: true, created: true, id };
}

export function analyzeTenantSiteAbuse({ tenant = {}, siteConfig = {} } = {}) {
  const navigation = Array.isArray(siteConfig.navigation) ? siteConfig.navigation : [];
  const customSections = Array.isArray(siteConfig.custom_sections) ? siteConfig.custom_sections : [];
  const stringParts = [
    tenant.name,
    tenant.subdomain,
    tenant.custom_domain,
    JSON.stringify(siteConfig.brand || {}),
    JSON.stringify(siteConfig.content || {}),
    ...navigation.map((entry) => `${entry?.label || ''} ${entry?.url || ''}`),
    ...customSections.map((entry) => String(entry?.html || '')),
  ];

  const combinedHtml = stringParts.join('\n');
  const combinedText = stripHtmlTags(combinedHtml);
  const signals = [];

  for (const pattern of BLOCK_CONTENT_PATTERNS) {
    if (pattern.pattern.test(combinedHtml) || pattern.pattern.test(combinedText)) {
      signals.push({
        key: pattern.key,
        category: pattern.category,
        severity: pattern.severity,
        summary: pattern.summary,
      });
    }
  }

  for (const pattern of REVIEW_CONTENT_PATTERNS) {
    if (pattern.pattern.test(combinedHtml) || pattern.pattern.test(combinedText)) {
      signals.push({
        key: pattern.key,
        category: pattern.category,
        severity: pattern.severity,
        summary: pattern.summary,
      });
    }
  }

  const absoluteLinks = dedupe([
    ...extractAbsoluteLinks(combinedHtml),
    ...navigation.map((entry) => String(entry?.url || '').trim()).filter((url) => /^https?:\/\//i.test(url)),
  ]);
  const uniqueHosts = dedupe(absoluteLinks.map(normalizeLinkHost).filter(Boolean));
  if (absoluteLinks.length >= 8 || uniqueHosts.length >= 3) {
    signals.push({
      key: 'excessive_external_links',
      category: 'content_review',
      severity: 'review',
      summary: 'contains an unusually high number of outbound links',
      metrics: {
        absolute_link_count: absoluteLinks.length,
        unique_external_hosts: uniqueHosts.length,
      },
    });
  }

  const blockedSignals = signals.filter((signal) => signal.severity === 'block');
  const reviewSignals = signals.filter((signal) => signal.severity === 'review');
  const summary = summarizeSignals(signals);
  const blocked = blockedSignals.length > 0;
  const reviewRequired = !blocked && reviewSignals.length > 0;

  return {
    blocked,
    review_required: reviewRequired,
    signals,
    summaries: summary,
    primary_code: blocked ? 'PUBLISH_CONTENT_BLOCKED' : reviewRequired ? 'PUBLISH_REVIEW_REQUIRED' : 'OK',
    reason: blocked
      ? `Publish blocked because the site content ${summary.join(', ')}.`
      : reviewRequired
        ? `Publish requires manual review because the site content ${summary.join(', ')}.`
        : '',
    metrics: {
      absolute_link_count: absoluteLinks.length,
      unique_external_hosts: uniqueHosts.length,
    },
  };
}

export function decideTenantModerationOutcome({ ruleAnalysis = null, aiModeration = null } = {}) {
  const summaries = dedupe([
    ...(Array.isArray(ruleAnalysis?.summaries) ? ruleAnalysis.summaries : []),
    ...(Array.isArray(aiModeration?.reasons) ? aiModeration.reasons : []),
    aiModeration?.summary ? aiModeration.summary : '',
  ]).slice(0, 6);

  const aiEnabled = Boolean(aiModeration?.enabled) && !aiModeration?.skipped;
  const aiRiskScore = aiEnabled ? Number(aiModeration?.risk_score || 0) : 0;
  const aiAction = aiEnabled ? String(aiModeration?.recommended_action || 'ALLOW').toUpperCase() : 'ALLOW';
  const aiReviewThreshold = 35;

  const blockedByAi = aiEnabled && (aiAction === 'BLOCK' || aiAction === 'QUARANTINE' || aiRiskScore >= 80);
  const reviewByAi = aiEnabled && !blockedByAi && (
    aiRiskScore >= 55
    || (aiAction === 'REVIEW' && aiRiskScore >= aiReviewThreshold)
  );
  const blocked = Boolean(ruleAnalysis?.blocked) || blockedByAi;
  const reviewRequired = !blocked && (Boolean(ruleAnalysis?.review_required) || reviewByAi);

  if (!blocked && !reviewRequired) {
    return {
      flagged: false,
      blocked: false,
      review_required: false,
      code: 'OK',
      next_trust_status: null,
      reason: '',
      summaries,
      risk_score: aiEnabled ? aiRiskScore : 0,
    };
  }

  const blockedByRule = Boolean(ruleAnalysis?.blocked);
  const code = blocked
    ? blockedByRule
      ? ruleAnalysis?.primary_code || 'PUBLISH_CONTENT_BLOCKED'
      : aiAction === 'QUARANTINE'
        ? 'AI_CONTENT_QUARANTINE'
        : 'AI_CONTENT_BLOCKED'
    : ruleAnalysis?.review_required
      ? ruleAnalysis?.primary_code || 'PUBLISH_REVIEW_REQUIRED'
      : 'AI_CONTENT_REVIEW_REQUIRED';

  const reason = blocked
    ? (blockedByRule ? ruleAnalysis?.reason : aiModeration?.summary || 'AI moderation blocked public exposure for this tenant.')
    : (ruleAnalysis?.reason || aiModeration?.summary || 'AI moderation requires manual review before public publish.');

  return {
    flagged: true,
    blocked,
    review_required: !blocked,
    code,
    next_trust_status: blocked ? 'QUARANTINED' : 'PREVIEW_ONLY',
    reason,
    summaries,
    risk_score: aiEnabled ? aiRiskScore : blocked ? 90 : 65,
  };
}

export function buildTenantModerationUserMessage(outcome = {}, options = {}) {
  const stage = String(options.stage || 'publish').trim().toLowerCase();
  const blocked = outcome?.blocked === true;
  const reviewRequired = outcome?.review_required === true || (!blocked && outcome?.flagged === true);

  if (stage === 'config_save') {
    if (blocked) {
      return 'Your latest site changes were saved, but public exposure is temporarily paused while our team reviews the content.';
    }
    if (reviewRequired) {
      return 'Your latest site changes were saved and queued for manual review before public publishing continues.';
    }
    return 'Your latest site changes were saved.';
  }

  if (blocked) {
    return 'Public publishing is temporarily paused while our team reviews this tenant.';
  }
  if (reviewRequired) {
    return 'Public publishing requires a manual review before it can continue.';
  }
  return 'No moderation issues detected.';
}

export function buildTenantSafeReviewFeedback(evidence = {}, options = {}) {
  const rulesSignals = Array.isArray(evidence?.rules?.signals) ? evidence.rules.signals : [];
  const aiCategories = Array.isArray(evidence?.ai?.categories) ? evidence.ai.categories : [];
  const aiReasons = Array.isArray(evidence?.ai?.reasons) ? evidence.ai.reasons : [];
  const source = rulesSignals.length > 0 && aiCategories.length > 0
    ? 'mixed'
    : aiCategories.length > 0
      ? 'ai'
      : rulesSignals.length > 0
        ? 'rules'
        : 'unknown';
  const summaries = dedupe([
    ...rulesSignals.map((signal) => String(signal?.summary || '').trim()),
    ...aiReasons.map((reason) => String(reason || '').trim()),
    String(evidence?.outcome?.reason || '').trim(),
  ]).filter(Boolean).slice(0, 6);

  const signals = dedupe([
    ...rulesSignals.map((signal) => `${String(signal?.key || '').trim()}|${String(signal?.severity || '').trim()}|${String(signal?.summary || '').trim()}`),
    ...aiCategories.map((category) => `${String(category?.key || '').trim()}|ai|${String(category?.score ?? '').trim()}`),
  ]).map((entry) => {
    const [key, severity, detail] = entry.split('|');
    return { key, severity, detail };
  }).filter((entry) => entry.key);

  const guidance = dedupe([
    ...rulesSignals.map((signal) => TENANT_REVIEW_GUIDANCE_MAP[String(signal?.key || '').trim()] || ''),
    ...aiCategories.map((category) => TENANT_REVIEW_GUIDANCE_MAP[String(category?.key || '').trim()] || ''),
    ...(summaries.length ? [] : ['Review the public copy, outbound links, forms, and brand language to ensure the site reads like a normal travel storefront.']),
  ]).filter(Boolean).slice(0, 6);

  return {
    stage: String(options.stage || evidence?.outcome?.code || '').trim() || null,
    source,
    risk_score: Number(evidence?.outcome?.risk_score || evidence?.ai?.risk_score || 0),
    summaries,
    signals,
    guidance,
  };
}
