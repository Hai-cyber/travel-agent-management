import { nanoid } from 'nanoid';

const RISK_RETENTION_SECONDS = 60 * 60 * 24 * 30;
const TEXT_ENCODER = new TextEncoder();
const SUSPICIOUS_ASSET_KEYWORDS = Object.freeze([
  'verify', 'account', 'password', 'wallet', 'secure', 'bank', 'billing', 'paypal', 'stripe', 'crypto', 'bonus', 'casino', 'loan', 'login',
]);
const SVG_ACTIVE_CONTENT_RE = /<script\b|onload\s*=|onerror\s*=|javascript:|<foreignObject\b|<iframe\b|<object\b|<embed\b|xlink:href\s*=\s*["']https?:/i;
const SVG_PHISHING_TEXT_RE = /\b(?:verify\s+your\s+account|confirm\s+your\s+password|wallet\s+verification|bank\s+login|secure\s+account\s+check)\b/i;
const DISPOSABLE_EMAIL_HINTS = Object.freeze([
  'mailinator.com', 'tempmail', '10minutemail', 'guerrillamail', 'yopmail', 'sharklasers.com', 'throwaway', 'trashmail', 'dispostable',
]);

function dedupe(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function truncate(value, maxLength) {
  const text = String(value || '');
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

function normalizeRiskScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function sha256HexRaw(value) {
  let bytes;
  if (value instanceof ArrayBuffer) {
    bytes = new Uint8Array(value);
  } else if (value instanceof Uint8Array) {
    bytes = value;
  } else {
    bytes = TEXT_ENCODER.encode(String(value || ''));
  }

  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashIdentifier(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  return sha256HexRaw(normalized);
}

export async function sha256HexBuffer(value) {
  return sha256HexRaw(value);
}

export function buildRiskRequestContext(c, extras = {}) {
  const forwardedIp = String(c?.req?.header('CF-Connecting-IP') || c?.req?.header('X-Forwarded-For') || '').trim();
  const ip = forwardedIp ? forwardedIp.split(',')[0].trim() : '';
  const userAgent = String(c?.req?.header('User-Agent') || '').trim();
  const country = String(c?.req?.header('CF-IPCountry') || '').trim().toUpperCase() || null;
  const asn = Number(c?.req?.raw?.cf?.asn || 0) || null;
  const colo = String(c?.req?.raw?.cf?.colo || '').trim().toUpperCase() || null;
  const authSession = typeof c?.get === 'function' ? c.get('authSession') : null;

  return {
    tenantId: extras.tenantId || authSession?.tenant_id || null,
    userId: extras.userId || authSession?.user_id || null,
    sessionId: extras.sessionId || authSession?.id || null,
    email: extras.email || null,
    ip,
    userAgent,
    country,
    asn,
    colo,
    signalKey: extras.signalKey || null,
    evidence: extras.evidence || null,
    assetSha256: extras.assetSha256 || null,
  };
}

export async function createRiskEvent(env, details = {}) {
  if (!env?.DB) return { ok: false, skipped: true };

  const now = Number(details.createdAt || Math.floor(Date.now() / 1000));
  const tenantId = details.tenantId || null;
  const userId = details.userId || null;
  const sessionId = details.sessionId || null;
  const eventType = String(details.eventType || 'unknown').trim().toLowerCase().slice(0, 80) || 'unknown';
  const severity = String(details.severity || 'info').trim().toLowerCase().slice(0, 24) || 'info';
  const action = String(details.action || 'observe').trim().toLowerCase().slice(0, 24) || 'observe';
  const ipHash = details.ipHash || await hashIdentifier(details.ip || '');
  const emailHash = details.emailHash || await hashIdentifier(details.email || '');
  const userAgentHash = details.userAgentHash || await hashIdentifier(details.userAgent || '');
  const assetSha256 = String(details.assetSha256 || '').trim() || null;
  const signalKey = String(details.signalKey || '').trim().slice(0, 255) || null;
  const evidenceJson = details.evidence ? JSON.stringify(details.evidence) : null;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO tenant_risk_events
         (id, tenant_id, user_id, session_id, event_type, severity, risk_score, action, ip_hash, email_hash, user_agent_hash, asset_sha256, signal_key, evidence_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      nanoid(),
      tenantId,
      userId,
      sessionId,
      eventType,
      severity,
      normalizeRiskScore(details.riskScore),
      action,
      ipHash || null,
      emailHash || null,
      userAgentHash || null,
      assetSha256,
      signalKey,
      evidenceJson,
      now,
    ),
    env.DB.prepare('DELETE FROM tenant_risk_events WHERE created_at < ?').bind(now - RISK_RETENTION_SECONDS),
  ]);

  return { ok: true };
}

export async function countRiskEvents(env, filters = {}) {
  if (!env?.DB) return 0;

  const conditions = ['created_at >= ?'];
  const binds = [Number(filters.since || 0)];

  if (filters.tenantId) {
    conditions.push('tenant_id = ?');
    binds.push(filters.tenantId);
  }
  if (filters.userId) {
    conditions.push('user_id = ?');
    binds.push(filters.userId);
  }
  if (filters.sessionId) {
    conditions.push('session_id = ?');
    binds.push(filters.sessionId);
  }
  if (filters.eventType) {
    conditions.push('event_type = ?');
    binds.push(String(filters.eventType).trim().toLowerCase());
  }
  if (filters.ipHash) {
    conditions.push('ip_hash = ?');
    binds.push(filters.ipHash);
  }
  if (filters.emailHash) {
    conditions.push('email_hash = ?');
    binds.push(filters.emailHash);
  }
  if (filters.assetSha256) {
    conditions.push('asset_sha256 = ?');
    binds.push(filters.assetSha256);
  }

  const row = await env.DB
    .prepare(`SELECT COUNT(*) AS total FROM tenant_risk_events WHERE ${conditions.join(' AND ')}`)
    .bind(...binds)
    .first();

  return Number(row?.total || 0);
}

export async function countAssetReuseAcrossTenants(env, assetSha256, since = 0) {
  if (!env?.DB || !assetSha256) return 0;
  const row = await env.DB
    .prepare(
      `SELECT COUNT(DISTINCT tenant_id) AS total
         FROM tenant_asset_inventory
        WHERE sha256 = ?
          AND deleted_at IS NULL
          AND created_at >= ?`
    )
    .bind(assetSha256, since)
    .first();
  return Number(row?.total || 0);
}

export function buildTenantVelocityLimits(trustStatus = 'PREVIEW_ONLY') {
  const normalized = String(trustStatus || 'PREVIEW_ONLY').trim().toUpperCase();
  if (normalized === 'TRUSTED') {
    return {
      assetUploadsPerHour: 120,
      configWritesPer10m: 60,
      publishAttemptsPerHour: 30,
    };
  }
  if (normalized === 'PROBATION') {
    return {
      assetUploadsPerHour: 50,
      configWritesPer10m: 30,
      publishAttemptsPerHour: 12,
    };
  }
  return {
    assetUploadsPerHour: 20,
    configWritesPer10m: 18,
    publishAttemptsPerHour: 6,
  };
}

export function analyzeAssetUpload({ filename, mime, sizeBytes = 0, buffer = new ArrayBuffer(0) } = {}) {
  const cleanFilename = String(filename || '').trim().toLowerCase();
  const cleanMime = String(mime || '').trim().toLowerCase();
  const maxTextBytes = 16000;
  const rawText = cleanMime === 'image/svg+xml'
    ? new TextDecoder('utf-8', { fatal: false }).decode(buffer instanceof Uint8Array ? buffer.slice(0, maxTextBytes) : new Uint8Array(buffer).slice(0, maxTextBytes))
    : '';
  const strippedText = truncate(stripHtml(rawText), 1500);
  const signals = [];

  const filenameKeyword = SUSPICIOUS_ASSET_KEYWORDS.find((keyword) => cleanFilename.includes(keyword));
  if (filenameKeyword) {
    signals.push({
      key: 'suspicious_filename_keyword',
      severity: 'review',
      summary: `filename contains suspicious keyword "${filenameKeyword}"`,
    });
  }

  if (cleanMime === 'image/svg+xml' && SVG_ACTIVE_CONTENT_RE.test(rawText)) {
    signals.push({
      key: 'svg_active_content',
      severity: 'block',
      summary: 'svg contains scriptable or externally linked active content',
    });
  }

  if (cleanMime === 'image/svg+xml' && SVG_PHISHING_TEXT_RE.test(rawText)) {
    signals.push({
      key: 'svg_phishing_text',
      severity: 'review',
      summary: 'svg text resembles credential capture or phishing copy',
    });
  }

  if ((cleanMime === 'video/mp4' || cleanMime === 'video/webm') && sizeBytes > 25 * 1024 * 1024) {
    signals.push({
      key: 'oversized_video',
      severity: 'review',
      summary: 'video upload is unusually large for a landing-page asset',
    });
  }

  const blocked = signals.some((signal) => signal.severity === 'block');
  const reviewRequired = !blocked && signals.some((signal) => signal.severity === 'review');
  const summaries = dedupe(signals.map((signal) => signal.summary));

  return {
    blocked,
    review_required: reviewRequired,
    signals,
    summaries,
    extracted_text_excerpt: strippedText,
    primary_code: blocked ? 'ASSET_BLOCKED' : reviewRequired ? 'ASSET_REVIEW_REQUIRED' : 'OK',
    reason: blocked
      ? `Asset blocked because it ${summaries.join(', ')}.`
      : reviewRequired
        ? `Asset requires review because it ${summaries.join(', ')}.`
        : '',
  };
}

export function decideAssetModerationOutcome({ ruleAnalysis = null, aiModeration = null, duplicateTenantCount = 0 } = {}) {
  const aiEnabled = Boolean(aiModeration?.enabled) && !aiModeration?.skipped;
  const aiRiskScore = aiEnabled ? normalizeRiskScore(aiModeration?.risk_score) : 0;
  const aiAction = aiEnabled ? String(aiModeration?.recommended_action || 'ALLOW').toUpperCase() : 'ALLOW';
  const aiReviewThreshold = 35;
  const blockedByAi = aiEnabled && (aiAction === 'BLOCK' || aiAction === 'QUARANTINE' || aiRiskScore >= 85);
  const reviewByAi = aiEnabled && !blockedByAi && (
    aiRiskScore >= 60
    || (aiAction === 'REVIEW' && aiRiskScore >= aiReviewThreshold)
  );
  const reviewByDuplicate = duplicateTenantCount >= 2;
  const blocked = Boolean(ruleAnalysis?.blocked) || blockedByAi;
  const reviewRequired = !blocked && (Boolean(ruleAnalysis?.review_required) || reviewByAi || reviewByDuplicate);
  const summaries = dedupe([
    ...(Array.isArray(ruleAnalysis?.summaries) ? ruleAnalysis.summaries : []),
    ...(Array.isArray(aiModeration?.reasons) ? aiModeration.reasons : []),
    aiModeration?.summary || '',
    reviewByDuplicate ? `same asset hash already appears across ${duplicateTenantCount} tenants` : '',
  ]).slice(0, 8);

  if (!blocked && !reviewRequired) {
    return {
      blocked: false,
      review_required: false,
      moderation_status: 'ALLOW',
      visibility: 'PUBLIC',
      risk_score: aiRiskScore,
      reason: '',
      summaries,
    };
  }

  return {
    blocked,
    review_required: !blocked,
    moderation_status: blocked ? 'BLOCK' : 'REVIEW',
    visibility: blocked ? 'BLOCKED' : 'AUTHENTICATED_ONLY',
    risk_score: blocked ? Math.max(aiRiskScore, 90) : Math.max(aiRiskScore, reviewByDuplicate ? 70 : aiReviewThreshold),
    reason: blocked
      ? (ruleAnalysis?.reason || aiModeration?.summary || 'Asset blocked due to risky active content or abuse signals.')
      : (ruleAnalysis?.reason || aiModeration?.summary || 'Asset requires review before public serving.'),
    summaries,
  };
}

export function assessEmailIdentityRisk(email) {
  const normalized = String(email || '').trim().toLowerCase();
  const domain = normalized.split('@')[1] || '';
  const reasons = [];
  let riskScore = 0;

  if (domain && DISPOSABLE_EMAIL_HINTS.some((entry) => domain.includes(entry))) {
    riskScore += 35;
    reasons.push('email domain resembles disposable or throwaway mail infrastructure');
  }
  if (normalized.includes('+')) {
    riskScore += 5;
    reasons.push('email uses plus-addressing pattern often seen in account farming');
  }

  return { risk_score: normalizeRiskScore(riskScore), reasons };
}

export async function fetchTenantAssetRecord(db, tenantId, filename) {
  if (!db || !tenantId || !filename) return null;
  return db
    .prepare(
      `SELECT id, tenant_id, r2_key, filename, mime, size_bytes, sha256, moderation_status, visibility, risk_score, reasons_json, created_at, deleted_at
         FROM tenant_asset_inventory
        WHERE tenant_id = ?
          AND filename = ?
        ORDER BY created_at DESC
        LIMIT 1`
    )
    .bind(tenantId, filename)
    .first();
}
