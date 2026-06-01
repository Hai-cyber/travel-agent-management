/**
 * src/routes/admin.js
 * Internal SaaS-admin routes — NOT exposed to tenants.
 *
 * Auth model:
 *   Every request to /api/admin/* must include the header:
 *     X-Admin-Secret: <value>
 *   validated against the Cloudflare Worker Secret `ADMIN_SECRET`.
 *
 *   Set it once with:
 *     npx wrangler secret put ADMIN_SECRET
 *
 *   For local dev, add to .dev.vars:
 *     ADMIN_SECRET=your-local-dev-secret
 *
 * [SEC] `env.ADMIN_SECRET` must be a Workers Secret — never hardcode, never
 *       return it in any response, never log it (not even partial hashes).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/admin/templates/upload
 * ─────────────────────────────────────────────────────────────────────────────
 * Accepts a ZIP archive containing a site template, extracts every file, and
 * pushes them to the SITE_TEMPLATES R2 bucket under the prefix
 * `templates/{templateId}/`.  Also upserts the template catalog row in D1.
 *
 * Request: multipart/form-data
 *   file        (File, required)  — .zip archive of the template
 *   id          (string, required) — template ID; e.g. "tmpl-minimal-v1"
 *   name        (string, required) — display name shown in template picker
 *   description (string, optional)
 *   thumbnail   (File,   optional) — thumbnail image (png/jpg/webp)
 *   sort_order  (number, optional, default 0)
 *
 * Response 201:
 *   { ok, template_id, r2_prefix, files_uploaded, upserted }
 *
 * Limits:
 *   ZIP archive max 20 MB (after buffer read, before inflate).
 *   Single extracted file max 5 MB.
 *   Max 500 files per archive.
 */

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { unzipSync, strFromU8 } from 'fflate';
import {
  loadMarketingSiteConfig,
  saveMarketingSiteConfig,
  getMarketingSitePayload,
} from '../lib/marketingSite.js';
import {
  buildTenantTrustState,
  createTenantReviewCase,
  decideTenantModerationOutcome,
  mergeTrustReasons,
  normalizeReviewCaseStatus,
  normalizeTrustStatus,
  TRUST_STATUSES,
} from '../lib/trustAbuse.js';
import {
  buildTenantModerationPayload,
  moderateTenantContent,
  sendTelegramModerationAlert,
} from '../lib/aiModeration.js';
import { syncUniversalTourPage } from '../lib/universalSiteSync.js';
import {
  dispatchBookingCreatedEmail,
  dispatchNewBookingAgentEmail,
  dispatchProofUploadedEmail,
  dispatchBookingConfirmedEmail,
  dispatchManualPaymentLinkEmail,
} from '../lib/bookingEmails.js';
import {
  approveMembershipIntent,
  listMembershipBillingIntents,
  rejectMembershipIntent,
  voidMembershipIntent,
} from '../lib/membershipBilling.js';

const admin = new Hono();

// ── Constants ─────────────────────────────────────────────────────────────────
const MAX_ZIP_BYTES    = 20 * 1024 * 1024;   // 20 MB
const MAX_FILE_BYTES   =  5 * 1024 * 1024;   //  5 MB per extracted file
const MAX_FILES        = 500;
const VALID_MANUAL_PAYMENT_PURPOSES = new Set(['domain_request', 'pro_features', 'custom']);

// [SEC] Template IDs become R2 key path segments — only safe chars allowed.
const SAFE_ID_RE       = /^[a-zA-Z0-9_-]{1,128}$/;

// Path traversal guard: reject any entry whose resolved name escapes the root.
// ZIP entries using "../" or absolute paths are silently skipped.
const SAFE_ENTRY_RE    = /^[a-zA-Z0-9_./ -]+$/;

// Allowed MIME types for asset files inside the ZIP.
const MIME_MAP = {
  '.html':  'text/html; charset=utf-8',
  '.htm':   'text/html; charset=utf-8',
  '.css':   'text/css; charset=utf-8',
  '.js':    'application/javascript; charset=utf-8',
  '.mjs':   'application/javascript; charset=utf-8',
  '.json':  'application/json; charset=utf-8',
  '.svg':   'image/svg+xml',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.jpeg':  'image/jpeg',
  '.gif':   'image/gif',
  '.webp':  'image/webp',
  '.ico':   'image/x-icon',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':   'font/ttf',
  '.eot':   'application/vnd.ms-fontobject',
  '.otf':   'font/otf',
  '.map':   'application/json; charset=utf-8',
  '.txt':   'text/plain; charset=utf-8',
  '.xml':   'application/xml; charset=utf-8',
};

// Thumbnail MIME allowlist (separate upload field)
const THUMB_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

function getExtension(filename) {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

function getMime(filename) {
  return MIME_MAP[getExtension(filename)] ?? 'application/octet-stream';
}

// ── Admin auth middleware ──────────────────────────────────────────────────────
// Applied to every route on this router.
// [SEC] Uses timing-safe string comparison via Web Crypto to prevent timing attacks.
admin.use('*', async (c, next) => {
  const secret = c.env.ADMIN_SECRET;
  if (!secret) {
    // [SEC] If ADMIN_SECRET is not configured, lock down entirely.
    //       Never expose "secret not set" in production — return generic 401.
    console.error('[ADMIN_AUTH] ADMIN_SECRET env binding is not configured. All admin routes locked.');
    return c.json({ error: 'Unauthorized.' }, 401);
  }

  const provided = c.req.header('X-Admin-Secret') ?? '';
  if (!provided) {
    return c.json({ error: 'X-Admin-Secret header is required.' }, 401);
  }

  // [SEC] Timing-safe comparison via Web Crypto to prevent timing oracle attacks.
  const enc    = new TextEncoder();
  const aBytes = enc.encode(provided);
  const bBytes = enc.encode(secret);

  // Pad both to the same length with a constant to prevent length leaks.
  // crypto.subtle.timingSafeEqual is not available in all runtimes; implement
  // using HMAC-based comparison which is always constant-time.
  let match = false;
  try {
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['sign', 'verify']
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(provided));
    const expected = await crypto.subtle.sign('HMAC', key, enc.encode(secret));
    // Both are HMAC(secret, x) — equal only when provided === secret.
    // This pattern leaks nothing about secret length or content.
    match = provided === secret;

    // Belt-and-suspenders: verify using fixed-length HMAC comparison.
    const sigArr  = new Uint8Array(sig);
    const expArr  = new Uint8Array(expected);
    // HMAC lengths are always equal (SHA-256 → 32 bytes) so this is safe.
    let diff = 0;
    for (let i = 0; i < sigArr.length; i++) diff |= sigArr[i] ^ expArr[i];
    match = diff === 0;
  } catch {
    // Crypto API failure — reject to be safe.
    return c.json({ error: 'Unauthorized.' }, 401);
  }

  if (!match) {
    return c.json({ error: 'Unauthorized.' }, 401);
  }

  await next();
});

// ── POST /api/admin/templates/upload ─────────────────────────────────────────
admin.post('/templates/upload', async (c) => {
  if (!c.env.SITE_TEMPLATES) {
    return c.json({ error: 'SITE_TEMPLATES R2 binding is not configured.' }, 503);
  }

  // ── Parse multipart form ──────────────────────────────────────────────────
  let form;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: 'Request must be multipart/form-data.' }, 400);
  }

  const templateId = (form.get('id') ?? '').trim();
  const name       = (form.get('name') ?? '').trim();
  const description = (form.get('description') ?? '').trim() || null;
  const sortOrder  = parseInt(form.get('sort_order') ?? '0', 10);
  const zipFile    = form.get('file');
  const thumbFile  = form.get('thumbnail');   // optional

  // ── Validate required fields ─────────────────────────────────────────────
  if (!templateId) return c.json({ error: 'Field "id" is required.' }, 400);
  if (!SAFE_ID_RE.test(templateId)) {
    return c.json({
      error: 'Template ID may only contain [a-zA-Z0-9_-] (max 128 chars). ' +
             'Example: "tmpl-minimal-v1".',
    }, 400);
  }
  if (!name) return c.json({ error: 'Field "name" is required.' }, 400);

  if (!zipFile || typeof zipFile === 'string') {
    return c.json({ error: 'Field "file" is required and must be a .zip archive.' }, 400);
  }

  // ── ZIP size guard ────────────────────────────────────────────────────────
  if (zipFile.size > MAX_ZIP_BYTES) {
    return c.json({
      error: `ZIP archive too large (${(zipFile.size / 1024 / 1024).toFixed(1)} MB). Maximum is 20 MB.`,
    }, 413);
  }

  // ── Read & decompress ZIP ─────────────────────────────────────────────────
  const zipBuffer = await zipFile.arrayBuffer();
  let entries;
  try {
    entries = unzipSync(new Uint8Array(zipBuffer));
  } catch (err) {
    return c.json({
      error: `Failed to decompress ZIP archive: ${err.message}. Ensure the file is a valid .zip.`,
    }, 422);
  }

  const entryPaths = Object.keys(entries);
  if (entryPaths.length === 0) {
    return c.json({ error: 'ZIP archive is empty.' }, 422);
  }
  if (entryPaths.length > MAX_FILES) {
    return c.json({
      error: `ZIP contains too many entries (${entryPaths.length}). Maximum is ${MAX_FILES}.`,
    }, 422);
  }

  // ── Upload each file to R2 ────────────────────────────────────────────────
  // R2 prefix: templates/{templateId}/
  // Entry paths inside the ZIP may optionally have a single top-level directory
  // (e.g. "my-template/assets/css/main.css").  We strip the first path component
  // if ALL entries share the same root directory; otherwise keep paths as-is.
  // This mirrors how common ZIP tools bundle a folder.

  // Detect common top-level prefix shared by all entries.
  function detectZipRoot(paths) {
    const firstSlash = paths[0].indexOf('/');
    if (firstSlash < 0) return '';             // files at root — no strip needed
    const candidate = paths[0].slice(0, firstSlash + 1); // "my-template/"
    return paths.every(p => p.startsWith(candidate)) ? candidate : '';
  }

  const zipRoot  = detectZipRoot(entryPaths);
  const r2Prefix = `templates/${templateId}`;

  let filesUploaded = 0;
  const skipped     = [];
  const warnings    = [];

  for (const entryPath of entryPaths) {
    const data = entries[entryPath];

    // Skip directory markers (entries that end with /)
    if (entryPath.endsWith('/') || data.length === 0) continue;

    // Strip common root prefix
    const relPath = zipRoot ? entryPath.slice(zipRoot.length) : entryPath;
    if (!relPath) continue;

    // [SEC] Reject any path containing '..' or absolute paths.
    if (relPath.includes('..') || relPath.startsWith('/') || !SAFE_ENTRY_RE.test(relPath)) {
      skipped.push({ entry: entryPath, reason: 'unsafe path' });
      continue;
    }

    // Per-file size guard
    if (data.length > MAX_FILE_BYTES) {
      skipped.push({
        entry:  entryPath,
        reason: `file too large (${(data.length / 1024 / 1024).toFixed(2)} MB, max 5 MB)`,
      });
      continue;
    }

    const r2Key      = `${r2Prefix}/${relPath}`;
    const contentType = getMime(relPath);

    await c.env.SITE_TEMPLATES.put(r2Key, data.buffer, {
      httpMetadata: {
        contentType,
        cacheControl: 'public, max-age=31536000, immutable',
      },
      customMetadata: {
        template_id:    templateId,
        uploaded_at:    new Date().toISOString(),
        original_entry: entryPath,
      },
    });
    filesUploaded++;
  }

  if (filesUploaded === 0) {
    return c.json({
      error:   'No files were uploaded. All ZIP entries were skipped.',
      skipped,
    }, 422);
  }

  // ── Optional thumbnail upload ─────────────────────────────────────────────
  let thumbnailUrl = null;
  if (thumbFile && typeof thumbFile !== 'string') {
    const thumbMime = (thumbFile.type ?? '').toLowerCase().split(';')[0].trim();
    if (!THUMB_MIME.has(thumbMime)) {
      warnings.push(`Thumbnail ignored: unsupported MIME "${thumbMime}". Allowed: ${[...THUMB_MIME].join(', ')}.`);
    } else if (thumbFile.size > MAX_FILE_BYTES) {
      warnings.push(`Thumbnail ignored: too large (${(thumbFile.size / 1024 / 1024).toFixed(2)} MB, max 5 MB).`);
    } else {
      const thumbExt = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[thumbMime];
      const thumbKey = `${r2Prefix}/thumb.${thumbExt}`;
      const thumbBuf = await thumbFile.arrayBuffer();
      await c.env.SITE_TEMPLATES.put(thumbKey, thumbBuf, {
        httpMetadata: { contentType: thumbMime, cacheControl: 'public, max-age=31536000, immutable' },
      });
      thumbnailUrl = thumbKey;
      filesUploaded++;
    }
  }

  // ── Upsert site_templates D1 row ─────────────────────────────────────────
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB
    .prepare(
      `INSERT OR REPLACE INTO site_templates
         (id, name, description, thumbnail_url, r2_prefix, is_active, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .bind(templateId, name, description, thumbnailUrl, r2Prefix, isNaN(sortOrder) ? 0 : sortOrder, now)
    .run();

  console.info(
    `[ADMIN_TEMPLATE_UPLOAD] id=${templateId} name="${name}" files=${filesUploaded} ` +
    `skipped=${skipped.length} prefix=${r2Prefix}`
  );

  return c.json({
    ok:             true,
    template_id:    templateId,
    name,
    r2_prefix:      r2Prefix,
    files_uploaded: filesUploaded,
    upserted:       true,
    ...(skipped.length  > 0 ? { skipped }  : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  }, 201);
});

// ── GET /api/admin/templates — List all templates in D1 ──────────────────────
admin.get('/templates', async (c) => {
  const { results } = await c.env.DB
    .prepare('SELECT id, name, description, r2_prefix, is_active, sort_order, created_at FROM site_templates ORDER BY sort_order ASC, created_at DESC')
    .all();

  return c.json({ ok: true, templates: results });
});

// ── DELETE /api/admin/templates/:id ──────────────────────────────────────────
// Soft-deactivate (is_active = 0) — keeps R2 files intact.
admin.delete('/templates/:id', async (c) => {
  const tmplId = c.req.param('id').trim();
  if (!SAFE_ID_RE.test(tmplId)) return c.json({ error: 'Invalid template ID.' }, 400);

  const result = await c.env.DB
    .prepare('UPDATE site_templates SET is_active = 0 WHERE id = ?')
    .bind(tmplId)
    .run();

  if (result.meta.changes === 0) {
    return c.json({ error: `Template "${tmplId}" not found.` }, 404);
  }

  return c.json({ ok: true, template_id: tmplId, is_active: false });
});

admin.get('/marketing-site', async (c) => {
  const config = await loadMarketingSiteConfig(c.env.DB);
  const preview = await getMarketingSitePayload(c.env.DB, 'en');
  return c.json({ ok: true, config, preview });
});

admin.put('/marketing-site', async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Request body is not valid JSON.' }, 400);
  }

  const config = await saveMarketingSiteConfig(c.env.DB, body);
  const preview = await getMarketingSitePayload(c.env.DB, 'en');
  return c.json({ ok: true, config, preview });
});

admin.get('/tenant-review-cases', async (c) => {
  const status = normalizeReviewCaseStatus(c.req.query('status'), 'OPEN');
  const tenantId = String(c.req.query('tenant_id') || '').trim();
  const limit = Math.max(1, Math.min(200, Number(c.req.query('limit') || 50) || 50));

  const conditions = ['rc.status = ?'];
  const binds = [status];
  if (tenantId) {
    conditions.push('rc.tenant_id = ?');
    binds.push(tenantId);
  }

  const query = `SELECT rc.id, rc.tenant_id, rc.status, rc.category, rc.severity, rc.signal_key, rc.summary, rc.evidence_json,
                        rc.auto_created, rc.created_at, rc.resolved_at, rc.resolved_by, rc.resolution_note,
                        t.name AS tenant_name, t.email AS tenant_email, t.trust_status, t.public_indexing_enabled, t.custom_domain_verified_at
                   FROM tenant_review_cases rc
                   JOIN tenants t ON t.id = rc.tenant_id
                  WHERE ${conditions.join(' AND ')}
                  ORDER BY rc.created_at DESC
                  LIMIT ?`;

  const { results } = await c.env.DB.prepare(query).bind(...binds, limit).all();
  const review_cases = (results || []).map((row) => ({
    ...row,
    evidence: row.evidence_json ? JSON.parse(row.evidence_json) : null,
    trust_state: buildTenantTrustState(row),
  }));

  return c.json({ ok: true, review_cases, status });
});

admin.get('/tenants/:id/trust', async (c) => {
  const tenantId = c.req.param('id').trim();
  const tenant = await c.env.DB
    .prepare('SELECT id, name, email, subdomain, custom_domain, trust_status, trust_score, trust_reasons_json, trust_reviewed_at, trust_reviewed_by, custom_domain_verified_at, public_indexing_enabled, subscription_status FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();

  if (!tenant) return c.json({ error: 'Tenant not found.' }, 404);

  const openCases = await c.env.DB
    .prepare('SELECT id, category, severity, signal_key, summary, created_at FROM tenant_review_cases WHERE tenant_id = ? AND status = ? ORDER BY created_at DESC')
    .bind(tenantId, 'OPEN')
    .all();

  return c.json({ ok: true, tenant, trust_state: buildTenantTrustState(tenant), open_review_cases: openCases.results || [] });
});

admin.patch('/tenants/:id/trust', async (c) => {
  const tenantId = c.req.param('id').trim();
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Request body must be valid JSON.' }, 400);
  }

  const trustStatus = normalizeTrustStatus(body?.trust_status, '');
  if (!TRUST_STATUSES.includes(trustStatus)) {
    return c.json({ error: `trust_status must be one of: ${TRUST_STATUSES.join(', ')}` }, 400);
  }

  const publicIndexingEnabled = body?.public_indexing_enabled === true || body?.public_indexing_enabled === 1 ? 1 : 0;
  const verifyCurrentDomain = body?.verify_current_domain === true;
  const reviewedBy = String(body?.reviewed_by || 'admin:secret').trim().slice(0, 80);
  const resolutionNote = String(body?.resolution_note || '').trim() || null;
  const closeOpenCases = body?.close_open_cases !== false;
  const now = Math.floor(Date.now() / 1000);

  const current = await c.env.DB
    .prepare('SELECT id, custom_domain, trust_status FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();

  if (!current) return c.json({ error: 'Tenant not found.' }, 404);

  const customDomainVerifiedAt = verifyCurrentDomain && current.custom_domain ? now : null;

  await c.env.DB
    .prepare(
      `UPDATE tenants
          SET trust_status = ?,
              public_indexing_enabled = ?,
              trust_reviewed_at = ?,
              trust_reviewed_by = ?,
              custom_domain_verified_at = CASE
                WHEN ? = 1 AND custom_domain IS NOT NULL AND TRIM(custom_domain) <> '' THEN ?
                WHEN ? = 0 THEN custom_domain_verified_at
                ELSE NULL
              END
        WHERE id = ?`
    )
    .bind(trustStatus, publicIndexingEnabled, now, reviewedBy, verifyCurrentDomain ? 1 : 0, customDomainVerifiedAt, verifyCurrentDomain ? 1 : 0, tenantId)
    .run();

  if (closeOpenCases) {
    const reviewStatus = trustStatus === 'TRUSTED' ? 'APPROVED' : trustStatus === 'QUARANTINED' || trustStatus === 'SUSPENDED' ? 'REJECTED' : 'RESOLVED';
    await c.env.DB
      .prepare('UPDATE tenant_review_cases SET status = ?, resolved_at = ?, resolved_by = ?, resolution_note = ? WHERE tenant_id = ? AND status = ?')
      .bind(reviewStatus, now, reviewedBy, resolutionNote, tenantId, 'OPEN')
      .run();
  }

  const updated = await c.env.DB
    .prepare('SELECT id, name, email, subdomain, custom_domain, trust_status, trust_score, trust_reasons_json, trust_reviewed_at, trust_reviewed_by, custom_domain_verified_at, public_indexing_enabled, subscription_status FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();

  return c.json({ ok: true, tenant: updated, trust_state: buildTenantTrustState(updated) });
});

admin.post('/tenants/:id/moderate-ai', async (c) => {
  const tenantId = c.req.param('id').trim();
  let body = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const tenant = await c.env.DB
    .prepare('SELECT id, name, email, subdomain, custom_domain, subscription_status, trust_status, trust_score, trust_reasons_json, site_config FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();
  if (!tenant) return c.json({ error: 'Tenant not found.' }, 404);

  let siteConfig = {};
  try {
    if (tenant.site_config) siteConfig = JSON.parse(tenant.site_config);
  } catch {
    siteConfig = {};
  }

  const payload = buildTenantModerationPayload({ tenant, siteConfig, stage: 'admin_review' });
  const aiModeration = await moderateTenantContent(c.env, payload, { stage: 'admin_review' });
  const moderationOutcome = decideTenantModerationOutcome({ aiModeration });
  const applyDecision = body?.apply_decision === true;
  const notifyTelegram = body?.notify_telegram !== false;

  let reviewCase = null;
  if (applyDecision && moderationOutcome.flagged) {
    reviewCase = await createTenantReviewCase(c.env, {
      tenantId,
      category: moderationOutcome.blocked ? 'admin_ai_block' : 'admin_ai_review',
      severity: moderationOutcome.blocked ? 'block' : 'review',
      signalKey: `admin-ai:${moderationOutcome.code}`,
      summary: moderationOutcome.reason,
      evidence: { ai: aiModeration, outcome: moderationOutcome },
    });

    const reasons = mergeTrustReasons(tenant.trust_reasons_json, moderationOutcome.summaries);
    await c.env.DB
      .prepare('UPDATE tenants SET trust_status = ?, trust_score = ?, trust_reasons_json = ?, trust_reviewed_at = ?, trust_reviewed_by = ?, public_indexing_enabled = 0 WHERE id = ?')
      .bind(moderationOutcome.next_trust_status, moderationOutcome.risk_score, JSON.stringify(reasons), Math.floor(Date.now() / 1000), 'admin:ai-moderation', tenantId)
      .run();

    if (notifyTelegram) {
      await sendTelegramModerationAlert(c.env, {
        tenantId,
        tenantName: tenant.name,
        stage: 'admin_review',
        recommendedAction: moderationOutcome.blocked ? 'QUARANTINE' : 'REVIEW',
        riskScore: moderationOutcome.risk_score,
        summary: moderationOutcome.reason,
        reasons: moderationOutcome.summaries,
        reviewCaseId: reviewCase?.id || null,
      });
    }
  }

  const updated = applyDecision
    ? await c.env.DB
        .prepare('SELECT id, name, email, subdomain, custom_domain, trust_status, trust_score, trust_reasons_json, trust_reviewed_at, trust_reviewed_by, custom_domain_verified_at, public_indexing_enabled, subscription_status FROM tenants WHERE id = ?')
        .bind(tenantId)
        .first()
    : tenant;

  return c.json({
    ok: true,
    applied: applyDecision && moderationOutcome.flagged,
    tenant: updated,
    trust_state: buildTenantTrustState(updated),
    ai_moderation: aiModeration,
    moderation_outcome: moderationOutcome,
    review_case_id: reviewCase?.id || null,
  });
});

admin.post('/tenants/:id/send-review-alert', async (c) => {
  const tenantId = c.req.param('id').trim();
  const tenant = await c.env.DB
    .prepare('SELECT id, name, trust_status FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();
  if (!tenant) return c.json({ error: 'Tenant not found.' }, 404);

  const reviewCase = await c.env.DB
    .prepare('SELECT id, category, severity, signal_key, summary, evidence_json, created_at FROM tenant_review_cases WHERE tenant_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1')
    .bind(tenantId, 'OPEN')
    .first();
  if (!reviewCase) return c.json({ error: 'No open review case found for this tenant.' }, 404);

  let evidence = null;
  try {
    evidence = reviewCase.evidence_json ? JSON.parse(reviewCase.evidence_json) : null;
  } catch {
    evidence = null;
  }

  const alertResult = await sendTelegramModerationAlert(c.env, {
    tenantId,
    tenantName: tenant.name,
    stage: reviewCase.category || 'manual_review',
    recommendedAction: reviewCase.severity === 'block' ? 'QUARANTINE' : 'REVIEW',
    riskScore: evidence?.outcome?.risk_score ?? evidence?.ai?.risk_score ?? null,
    summary: reviewCase.summary,
    reasons: Array.isArray(evidence?.outcome?.summaries) ? evidence.outcome.summaries : [],
    reviewCaseId: reviewCase.id,
  });

  if (!alertResult.ok) {
    return c.json({ error: alertResult.reason || 'Telegram alert failed.', telegram: alertResult }, 502);
  }

  return c.json({ ok: true, review_case_id: reviewCase.id, telegram: alertResult });
});

// ── GET /api/admin/tenants/:id/broken-assets ─────────────────────────────────
// Scans all D1 JSON surfaces for this tenant's asset URLs
// (/api/tenant/assets/{tenantId}/...) and identifies which ones are broken:
// either deleted in the asset inventory, blocked by moderation, or absent from
// R2 entirely (when ?check_r2=1 is passed).
//
// Surfaces scanned:
//   tours.content_data           — hero_image, destination_image, gallery_images, home_gallery_images
//   tenant_universal_hotels.gallery_json — hotel gallery entries
//   tenant_universal_tour_pages.content_override_json — per-tour content overrides
//   tenant_universal_pages.blocks_json — universal page blocks
//   tenants.site_config          — custom_imgs, custom_sections, brand images
//
// Query params:
//   check_r2=1  (optional) — also HEAD-check each unique URL against TOUR_PAGES R2;
//                            adds network cost but catches untracked orphaned files
//
// Response:
//   { ok, tenant_id, scanned_surfaces, total_urls_found, broken_count, live_count, broken[], live[] }
//
// broken[] entries include { url, r2_key, reason, inventory, references[] }
//   reason: "deleted" | "blocked" | "not_in_r2" | "not_in_inventory_or_r2"
//
// [SEC] Admin-only via X-Admin-Secret middleware above.
// [SEC] tenantId from URL param — never from caller-supplied body.
admin.get('/tenants/:id/broken-assets', async (c) => {
  const tenantId = c.req.param('id').trim();
  const checkR2 = c.req.query('check_r2') === '1';

  // Verify tenant exists
  const tenant = await c.env.DB
    .prepare('SELECT id FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();
  if (!tenant) return c.json({ error: 'Tenant not found.' }, 404);

  // Asset URL prefix owned by this tenant
  const assetPrefix = `/api/tenant/assets/${tenantId}/`;

  // Extract all asset URLs matching the tenant prefix from a raw text blob.
  // Stops at quote, whitespace, or JSON structural characters to avoid over-reading.
  function extractAssetUrls(text) {
    if (!text || typeof text !== 'string' || !text.includes(assetPrefix)) return [];
    const urls = new Set();
    let idx = 0;
    while (true) {
      const pos = text.indexOf(assetPrefix, idx);
      if (pos < 0) break;
      let end = pos + assetPrefix.length;
      while (end < text.length && !/[\s"'<>{}[\]\\]/.test(text[end])) end++;
      const url = text.slice(pos, end);
      if (url.length > assetPrefix.length) urls.add(url); // discard bare prefix
      idx = end;
    }
    return [...urls];
  }

  // Accumulates { url, surface, source_id, field } triples from one text blob.
  const references = [];
  function collectFromText(text, surface, sourceId, field) {
    for (const url of extractAssetUrls(text)) {
      references.push({ url, surface, source_id: sourceId, field });
    }
  }

  // ── Scan all D1 surfaces ──────────────────────────────────────────────────

  const [toursResult, hotelsResult, tourPagesResult, uniPagesResult, tenantRow] = await Promise.all([
    c.env.DB.prepare('SELECT id, content_data FROM tours WHERE tenant_id = ?').bind(tenantId).all(),
    c.env.DB.prepare('SELECT id, gallery_json FROM tenant_universal_hotels WHERE tenant_id = ?').bind(tenantId).all(),
    c.env.DB.prepare('SELECT id, content_override_json FROM tenant_universal_tour_pages WHERE tenant_id = ?').bind(tenantId).all(),
    c.env.DB.prepare('SELECT id, page_key, blocks_json FROM tenant_universal_pages WHERE tenant_id = ?').bind(tenantId).all(),
    c.env.DB.prepare('SELECT site_config FROM tenants WHERE id = ?').bind(tenantId).first(),
  ]);

  for (const tour of (toursResult.results || [])) {
    collectFromText(tour.content_data, 'tours', tour.id, 'content_data');
  }
  for (const hotel of (hotelsResult.results || [])) {
    collectFromText(hotel.gallery_json, 'tenant_universal_hotels', hotel.id, 'gallery_json');
  }
  for (const page of (tourPagesResult.results || [])) {
    collectFromText(page.content_override_json, 'tenant_universal_tour_pages', page.id, 'content_override_json');
  }
  for (const page of (uniPagesResult.results || [])) {
    collectFromText(page.blocks_json, 'tenant_universal_pages', page.id, 'blocks_json');
  }
  if (tenantRow?.site_config) {
    collectFromText(tenantRow.site_config, 'tenants', tenantId, 'site_config');
  }

  // ── Build URL → references map ────────────────────────────────────────────
  const urlRefMap = new Map();
  for (const ref of references) {
    if (!urlRefMap.has(ref.url)) urlRefMap.set(ref.url, []);
    urlRefMap.get(ref.url).push({ surface: ref.surface, source_id: ref.source_id, field: ref.field });
  }

  // ── Bulk load asset inventory for this tenant ─────────────────────────────
  const { results: inventoryRows } = await c.env.DB
    .prepare('SELECT r2_key, moderation_status, visibility, deleted_at FROM tenant_asset_inventory WHERE tenant_id = ?')
    .bind(tenantId)
    .all();
  const inventoryMap = new Map();
  for (const row of (inventoryRows || [])) {
    inventoryMap.set(row.r2_key, row);
  }

  // ── Classify each unique URL ──────────────────────────────────────────────
  const broken = [];
  const live = [];

  for (const [url, refs] of urlRefMap) {
    const filename = url.slice(assetPrefix.length);
    const r2Key = `assets/${tenantId}/${filename}`;
    const inventory = inventoryMap.get(r2Key) ?? null;

    if (inventory) {
      if (inventory.deleted_at !== null && inventory.deleted_at !== undefined) {
        broken.push({ url, r2_key: r2Key, reason: 'deleted', inventory, references: refs });
        continue;
      }
      if (inventory.visibility === 'BLOCKED') {
        broken.push({ url, r2_key: r2Key, reason: 'blocked', inventory, references: refs });
        continue;
      }
      // Inventory says it's live. Optionally validate against R2.
      if (checkR2 && c.env.TOUR_PAGES) {
        const obj = await c.env.TOUR_PAGES.head(r2Key);
        if (!obj) {
          broken.push({ url, r2_key: r2Key, reason: 'not_in_r2', inventory, references: refs });
          continue;
        }
      }
      live.push({ url, references: refs });
      continue;
    }

    // Not in inventory at all.
    if (checkR2 && c.env.TOUR_PAGES) {
      const obj = await c.env.TOUR_PAGES.head(r2Key);
      if (!obj) {
        broken.push({ url, r2_key: r2Key, reason: 'not_in_inventory_or_r2', inventory: null, references: refs });
        continue;
      }
      // Present in R2 but not tracked in inventory — treat as live but flag it.
      live.push({ url, references: refs, note: 'untracked_in_inventory' });
      continue;
    }

    // Not in inventory, R2 not checked — treat as unknown/live.
    live.push({ url, references: refs, note: 'not_in_inventory' });
  }

  return c.json({
    ok: true,
    tenant_id: tenantId,
    scanned_surfaces: [
      'tours:content_data',
      'tenant_universal_hotels:gallery_json',
      'tenant_universal_tour_pages:content_override_json',
      'tenant_universal_pages:blocks_json',
      'tenants:site_config',
    ],
    total_urls_found: urlRefMap.size,
    broken_count: broken.length,
    live_count: live.length,
    check_r2: checkR2,
    broken,
    live,
  });
});

// [SEC] Admin-only via X-Admin-Secret middleware above.
// Force re-sync a tour's universal page (picks up latest content_data, stops, images).
admin.post('/tenants/:tenantId/tours/:tourId/sync', async (c) => {
  const tenantId = c.req.param('tenantId').trim();
  const tourId = c.req.param('tourId').trim();

  const tenant = await c.env.DB.prepare('SELECT id FROM tenants WHERE id = ?').bind(tenantId).first();
  if (!tenant) return c.json({ error: 'Tenant not found.' }, 404);

  const result = await syncUniversalTourPage(c.env, tenantId, tourId);
  if (!result.ok) return c.json({ error: result.error || 'Sync failed', details: result.details }, result.status || 500);

  return c.json({ ok: true, tour_id: tourId, tenant_id: tenantId, message: 'Tour page synced.' });
});

// [SEC] Admin-only via X-Admin-Secret middleware above.
// POST /api/admin/test-email  — fire a test email through the configured webhook.
// Body: { "to": "saophuongbac@gmail.com" }
admin.post('/test-email', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const to = String(body?.to || '').trim().toLowerCase();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return c.json({ error: 'Provide a valid "to" email address.' }, 400);
  }

  const webhookUrl = String(c.env.PASSWORD_RESET_WEBHOOK_URL || '').trim();
  if (!webhookUrl) {
    return c.json({ error: 'PASSWORD_RESET_WEBHOOK_URL secret is not configured.' }, 503);
  }

  const webhookSecret = String(c.env.PASSWORD_RESET_WEBHOOK_SECRET || '').trim();
  const eventId = crypto.randomUUID();
  const timestamp = Math.floor(Date.now() / 1000);

  const payload = {
    event:      'password_reset.requested',          // reuse the same event the mailer already handles
    event_id:   eventId,
    occurred_at: timestamp,
    tenant_id:  null,
    locale:     'vi',
    recipient:  { email: to },
    reset: {
      url:        'https://tours-market.com/reset-password.html?token=TEST_TOKEN_IGNORE',
      expires_at: new Date((timestamp + 3600) * 1000).toISOString(),
    },
    email_content: {
      subject: '[TEST] TravelAgent email test',
      text: 'This is a test email from the TravelAgent platform. If you received this, email delivery is working correctly.',
      html: '<p>This is a <strong>test email</strong> from the <a href="https://tours-market.com">TravelAgent</a> platform.</p><p>If you received this, email delivery is working correctly. <strong>No action needed.</strong></p>',
    },
    source: {
      app:      'travel-agent-management',
      base_url: String(c.env.PLATFORM_BASE_URL || '').trim() || null,
    },
  };

  const payloadText = JSON.stringify(payload);
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'travel-agent-test-email/1.0',
    'X-TravelAgent-Event':    payload.event,
    'X-TravelAgent-Event-Id': eventId,
    'X-TravelAgent-Timestamp': String(timestamp),
  };

  try {
    const destinationUrl = new URL(webhookUrl);
    destinationUrl.searchParams.set('ta_event', payload.event);
    destinationUrl.searchParams.set('ta_event_id', eventId);
    destinationUrl.searchParams.set('ta_ts', String(timestamp));

    if (webhookSecret) {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey('raw', encoder.encode(webhookSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const signature = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payloadText}`)))).map(b => b.toString(16).padStart(2, '0')).join('');
      headers['X-TravelAgent-Signature'] = `v1=${signature}`;
      // GAS Web Apps cannot read custom headers — pass signature via query params too
      destinationUrl.searchParams.set('ta_sig_v', 'v1');
      destinationUrl.searchParams.set('ta_sig', signature);
    }

    const res = await fetch(destinationUrl.toString(), { method: 'POST', headers, body: payloadText });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      return c.json({ ok: false, error: `Webhook returned HTTP ${res.status}`, body: text.slice(0, 500) }, 502);
    }

    console.info(`[TEST_EMAIL_SENT] to=${to} event_id=${eventId} webhook_status=${res.status}`);
    return c.json({ ok: true, to, event_id: eventId, webhook_status: res.status, message: 'Test email dispatched to webhook. Check your inbox.' });
  } catch (err) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// POST /api/admin/test-booking-emails  — smoke test all 3 booking email types.
// Body: { "to": "email@example.com" }
admin.post('/test-booking-emails', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const to = String(body?.to || '').trim().toLowerCase();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return c.json({ error: 'Provide a valid "to" email address.' }, 400);
  }

  const platformBase = String(c.env.PLATFORM_BASE_URL || '').trim();
  const fakeOrderId  = 'TEST0001';

  const [r1, r1b, r2, r3] = await Promise.all([
    dispatchBookingCreatedEmail(c.env, {
      orderId:      fakeOrderId,
      tenantId:     'test-tenant',
      tenantName:   'Tours Market (TEST)',
      tourTitle:    'BEST OF VIETNAM: ART & CULTURE (8 DAYS)',
      travelDate:   '2026-06-15',
      segmentName:  '4-star hotel',
      paxSummary:   '2 adults (shared room), 1 child',
      grandTotal:   1980.00,
      currency:     'USD',
      paymentMethod: 'BANK_TRANSFER',
      deadlineUnix:  Math.floor(Date.now() / 1000) + 48 * 3600,
      deadlineHours: 48,
      guestName:    'Test Guest',
      guestEmail:   to,
      guestPortalUrl: `${platformBase}/bookings/public/TEST_TOKEN_PORTAL`,
      platformBaseUrl: platformBase,
    }),
    dispatchNewBookingAgentEmail(c.env, {
      orderId:      fakeOrderId,
      tenantId:     'test-tenant',
      tenantName:   'Tours Market (TEST)',
      agentEmail:   to,
      tourTitle:    'BEST OF VIETNAM: ART & CULTURE (8 DAYS)',
      travelDate:   '2026-06-15',
      segmentName:  '4-star hotel',
      paxSummary:   '2 adults (shared room), 1 child',
      grandTotal:   1980.00,
      currency:     'USD',
      paymentMethod: 'BANK_TRANSFER',
      guestName:    'Test Guest',
      guestEmail:   'guest@example.com',
      guestPhone:   '+84 123 456 789',
      dashboardUrl: `${platformBase}/dashboard.html`,
      platformBaseUrl: platformBase,
    }),
    dispatchProofUploadedEmail(c.env, {
      orderId:     fakeOrderId,
      tenantId:    'test-tenant',
      agentEmail:  to,
      agentName:   'Tours Market Team',
      tourTitle:   'BEST OF VIETNAM: ART & CULTURE (8 DAYS)',
      travelDate:  '2026-06-15',
      grandTotal:  1980.00,
      currency:    'USD',
      dashboardUrl: `${platformBase}/dashboard.html`,
      platformBaseUrl: platformBase,
    }),
    dispatchBookingConfirmedEmail(c.env, {
      orderId:     fakeOrderId,
      tenantId:    'test-tenant',
      tenantName:  'Tours Market (TEST)',
      guestName:   'Test Guest',
      guestEmail:  to,
      tourTitle:   'BEST OF VIETNAM: ART & CULTURE (8 DAYS)',
      travelDate:  '2026-06-15',
      segmentName: '4-star hotel',
      paxSummary:  '2 adults (shared room), 1 child',
      grandTotal:  1980.00,
      currency:    'USD',
      platformBaseUrl: platformBase,
    }),
  ]);

  return c.json({ ok: true, to,
    booking_created:            r1,
    new_booking_agent:          r1b,
    proof_uploaded:             r2,
    booking_confirmed:          r3,
    note: 'Sent 4 test emails: booking.created + new_booking (agent) + booking.proof_uploaded + booking.confirmed. Check your inbox.',
  });
});

// ── GET /api/admin/tenants ────────────────────────────────────────────────────
// Lists all tenants with key operational fields + computed trial_days_left.
// Supports optional query params:
//   ?status=TRIAL|ACTIVE|SUSPENDED|CANCELLED  — filter by subscription_status
//   ?trust=PREVIEW_ONLY|PROBATION|TRUSTED|SUSPENDED — filter by trust_status
//   ?q=<string>  — search name/email/subdomain/custom_domain (case-insensitive LIKE)
//   ?page=<n>&limit=<n>  — pagination (default limit 50, max 200)
// [SEC] Admin-only via X-Admin-Secret middleware above.
admin.get('/tenants', async (c) => {
  const TRIAL_DAYS = 180;
  const nowS = Math.floor(Date.now() / 1000);

  const status = c.req.query('status')?.toUpperCase()?.trim() || null;
  const trust  = c.req.query('trust')?.toUpperCase()?.trim() || null;
  const q      = c.req.query('q')?.trim() || null;
  const page   = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const limit  = Math.min(200, Math.max(1, parseInt(c.req.query('limit') || '50', 10)));
  const offset = (page - 1) * limit;

  let sql = `SELECT id, name, email, subdomain, custom_domain, custom_domain_verified_at,
                    subscription_status, trust_status, trust_score, product_tier_key,
                    payment_methods, terms_accepted, created_at, stripe_customer_id
             FROM tenants WHERE 1=1`;
  const params = [];

  if (status) { sql += ` AND subscription_status = ?`; params.push(status); }
  if (trust)  { sql += ` AND trust_status = ?`;        params.push(trust); }
  if (q) {
    const like = `%${q}%`;
    sql += ` AND (name LIKE ? OR email LIKE ? OR subdomain LIKE ? OR custom_domain LIKE ?)`;
    params.push(like, like, like, like);
  }

  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const rows = (await c.env.DB.prepare(sql).bind(...params).all()).results ?? [];

  const tenants = rows.map((t) => {
    const createdAt = Number(t.created_at || 0);
    const trialEndsAt = createdAt + TRIAL_DAYS * 86400;
    const trialDaysLeft = t.subscription_status === 'TRIAL'
      ? Math.max(0, Math.ceil((trialEndsAt - nowS) / 86400))
      : null;
    return {
      id:                       t.id,
      name:                     t.name,
      email:                    t.email,
      subdomain:                t.subdomain,
      custom_domain:            t.custom_domain || null,
      domain_verified:          Boolean(Number(t.custom_domain_verified_at) > 0),
      subscription_status:      t.subscription_status,
      trust_status:             t.trust_status,
      trust_score:              t.trust_score,
      product_tier_key:         t.product_tier_key,
      terms_accepted:           Boolean(t.terms_accepted),
      has_stripe_customer:      Boolean(t.stripe_customer_id),
      trial_days_left:          trialDaysLeft,
      trial_ends_at:            t.subscription_status === 'TRIAL' ? trialEndsAt : null,
      created_at:               createdAt,
    };
  });

  return c.json({ ok: true, tenants, page, limit, count: tenants.length });
});

// ── POST /api/admin/tenants/:id/set-subscription ──────────────────────────────
// Manually override a tenant's subscription_status. Useful for:
//   - Granting early-access ACTIVE status without Stripe
//   - Extending trial (set back to TRIAL)
//   - Suspending / cancelling accounts
// Body: { status: 'TRIAL'|'ACTIVE'|'SUSPENDED'|'CANCELLED', note?: string }
// [SEC] Admin-only via X-Admin-Secret middleware above.
const VALID_SUB_STATUSES = new Set(['TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED']);

admin.post('/tenants/:id/set-subscription', async (c) => {
  const tenantId = c.req.param('id')?.trim();
  if (!tenantId) return c.json({ error: 'Tenant ID is required.' }, 400);

  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'JSON body required.' }, 400); }

  const newStatus = String(body?.status || '').toUpperCase().trim();
  if (!VALID_SUB_STATUSES.has(newStatus)) {
    return c.json({ error: `status must be one of: ${[...VALID_SUB_STATUSES].join(', ')}` }, 400);
  }

  const note = String(body?.note || '').trim().slice(0, 500) || null;

  const tenant = await c.env.DB
    .prepare('SELECT id, name, subscription_status FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();
  if (!tenant) return c.json({ error: 'Tenant not found.' }, 404);

  const oldStatus = tenant.subscription_status;
  if (oldStatus === newStatus) {
    return c.json({ ok: true, unchanged: true, status: newStatus });
  }

  const nowS = Math.floor(Date.now() / 1000);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE tenants SET subscription_status = ? WHERE id = ?')
      .bind(newStatus, tenantId),
    c.env.DB.prepare(
      `INSERT INTO tenant_audit_log (id, tenant_id, field_name, old_value, new_value, changed_at, changed_by)
       VALUES (?, ?, 'subscription_status', ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), tenantId, oldStatus, newStatus, nowS, 'platform_admin'),
  ]);

  console.info(`[ADMIN_SET_SUBSCRIPTION] tenant=${tenantId} ${oldStatus}→${newStatus} note=${note}`);
  return c.json({ ok: true, tenant_id: tenantId, status: newStatus, previous_status: oldStatus, note });
});

// ── Membership billing review queue ─────────────────────────────────────────

admin.get('/membership-billing/intents', async (c) => {
  const status = c.req.query('status') || null;
  const productTierKey = c.req.query('product_tier_key') || null;
  const limit = c.req.query('limit') || 50;

  const intents = await listMembershipBillingIntents(c.env, {
    status,
    productTierKey,
    limit,
  });

  return c.json({ ok: true, intents, count: intents.length });
});

admin.post('/membership-billing/intents/:intentId/approve', async (c) => {
  const intentId = c.req.param('intentId')?.trim();
  if (!intentId) return c.json({ error: 'Intent ID is required.' }, 400);

  let body = {};
  try { body = await c.req.json(); } catch { /* optional */ }

  try {
    const intent = await approveMembershipIntent(c.env, {
      intentId,
      actor: 'platform_admin',
      note: body?.note || null,
    });
    return c.json({ ok: true, intent });
  } catch (err) {
    return c.json({ error: err.message || 'Failed to approve membership billing intent.' }, 400);
  }
});

admin.post('/membership-billing/intents/:intentId/reject', async (c) => {
  const intentId = c.req.param('intentId')?.trim();
  if (!intentId) return c.json({ error: 'Intent ID is required.' }, 400);

  let body = {};
  try { body = await c.req.json(); } catch { /* optional */ }

  try {
    const intent = await rejectMembershipIntent(c.env, {
      intentId,
      actor: 'platform_admin',
      note: body?.note || null,
    });
    return c.json({ ok: true, intent });
  } catch (err) {
    return c.json({ error: err.message || 'Failed to reject membership billing intent.' }, 400);
  }
});

admin.post('/membership-billing/intents/:intentId/void', async (c) => {
  const intentId = c.req.param('intentId')?.trim();
  if (!intentId) return c.json({ error: 'Intent ID is required.' }, 400);

  let body = {};
  try { body = await c.req.json(); } catch { /* optional */ }

  try {
    const intent = await voidMembershipIntent(c.env, {
      intentId,
      actor: 'platform_admin',
      note: body?.note || null,
    });
    return c.json({ ok: true, intent });
  } catch (err) {
    return c.json({ error: err.message || 'Failed to void membership billing intent.' }, 400);
  }
});

admin.post('/tenants/:id/send-manual-payment-link', async (c) => {
  const tenantId = c.req.param('id')?.trim();
  if (!tenantId) return c.json({ error: 'Tenant ID is required.' }, 400);

  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'JSON body required.' }, 400); }

  const purpose = String(body?.purpose || 'custom').trim().toLowerCase();
  if (!VALID_MANUAL_PAYMENT_PURPOSES.has(purpose)) {
    return c.json({ error: `purpose must be one of: ${[...VALID_MANUAL_PAYMENT_PURPOSES].join(', ')}` }, 400);
  }

  const paymentLinkRaw = String(body?.payment_link || '').trim();
  let paymentLink;
  try {
    paymentLink = new URL(paymentLinkRaw);
  } catch {
    paymentLink = null;
  }
  if (!paymentLink || paymentLink.protocol !== 'https:') {
    return c.json({ error: 'payment_link must be a valid https URL.' }, 400);
  }

  const requestLabel = String(body?.request_label || '').trim().slice(0, 200) || null;
  const amountLabel  = String(body?.amount_label || '').trim().slice(0, 120) || null;
  const note         = String(body?.note || '').trim().slice(0, 600) || null;

  const tenant = await c.env.DB
    .prepare('SELECT id, name, email FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();
  if (!tenant) return c.json({ error: 'Tenant not found.' }, 404);
  if (!tenant.email) return c.json({ error: 'Tenant does not have an email address.' }, 422);

  const result = await dispatchManualPaymentLinkEmail(c.env, {
    tenantId,
    tenantName: tenant.name,
    tenantEmail: tenant.email,
    purpose,
    requestLabel,
    amountLabel,
    paymentLink: paymentLink.toString(),
    note,
  });

  if (!result?.ok) {
    const status = result?.reason === 'webhook_not_configured' ? 503 : 502;
    return c.json({ error: 'Manual payment link email could not be sent.', detail: result?.reason || result?.gas_body || 'unknown_error' }, status);
  }

  console.info(`[ADMIN_MANUAL_PAYMENT_LINK] tenant=${tenantId} email=${tenant.email} purpose=${purpose} request=${requestLabel || '—'}`);
  return c.json({
    ok: true,
    tenant_id: tenantId,
    email: tenant.email,
    purpose,
    request_label: requestLabel,
    amount_label: amountLabel,
    event_id: result.event_id || null,
  });
});

// ── Promo code helpers ────────────────────────────────────────────────────────

function generatePromoCode() {
  // Format: XXXX-XXXX  (8 uppercase alphanumeric chars, no ambiguous 0/O/I/1)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) code += '-';
    const idx = Math.floor(Math.random() * chars.length);
    code += chars[idx];
  }
  return code;
}

// ── POST /api/admin/promo-codes ───────────────────────────────────────────────
// Generate a new promo code. Admin only.
admin.post('/promo-codes', async (c) => {
  let body; try { body = await c.req.json(); } catch { body = {}; }

  const note         = String(body?.note         || '').trim().slice(0, 200) || null;
  const maxUses      = body?.max_uses != null ? parseInt(body.max_uses, 10) : 1;
  const durationDays = body?.duration_days != null ? parseInt(body.duration_days, 10) : null;
  const expiresInDays = body?.expires_in_days != null ? parseInt(body.expires_in_days, 10) : null;

  if (maxUses !== null && (isNaN(maxUses) || maxUses < 1)) {
    return c.json({ error: 'max_uses must be a positive integer or null' }, 400);
  }

  const now       = Math.floor(Date.now() / 1000);
  const expiresAt = expiresInDays ? now + expiresInDays * 86400 : null;
  const id        = crypto.randomUUID();

  // Retry up to 5 times on the unlikely UNIQUE collision
  let code, attempts = 0;
  while (attempts < 5) {
    code = generatePromoCode();
    const existing = await c.env.DB
      .prepare('SELECT id FROM promo_codes WHERE code = ?')
      .bind(code)
      .first();
    if (!existing) break;
    attempts++;
  }
  if (attempts === 5) return c.json({ error: 'Could not generate unique code. Try again.' }, 500);

  await c.env.DB
    .prepare(`INSERT INTO promo_codes (id, code, note, max_uses, uses_count, duration_days, expires_at, created_by, created_at)
              VALUES (?, ?, ?, ?, 0, ?, ?, 'platform_admin', ?)`)
    .bind(id, code, note, maxUses ?? null, durationDays ?? null, expiresAt, now)
    .run();

  console.info(`[PROMO_CREATED] id=${id} code=${code} max_uses=${maxUses} duration_days=${durationDays}`);
  return c.json({ ok: true, id, code, note, max_uses: maxUses, duration_days: durationDays, expires_at: expiresAt });
});

// ── GET /api/admin/promo-codes ────────────────────────────────────────────────
// List all promo codes with redemption counts and redeemers.
admin.get('/promo-codes', async (c) => {
  const { results: codes } = await c.env.DB
    .prepare(`SELECT pc.*,
                (SELECT GROUP_CONCAT(t.name, ', ')
                 FROM promo_code_redemptions pcr
                 JOIN tenants t ON t.id = pcr.tenant_id
                 WHERE pcr.code_id = pc.id
                ) AS redeemed_by
              FROM promo_codes pc
              ORDER BY pc.created_at DESC`)
    .all();
  return c.json({ ok: true, codes: codes || [] });
});

// ── DELETE /api/admin/promo-codes/:id ─────────────────────────────────────────
// Revoke (delete) a promo code. Existing redemptions are unaffected.
admin.delete('/promo-codes/:id', async (c) => {
  const id = c.req.param('id');
  const result = await c.env.DB
    .prepare('DELETE FROM promo_codes WHERE id = ?')
    .bind(id)
    .run();
  if (!result.meta?.changes) return c.json({ error: 'Code not found' }, 404);
  console.info(`[PROMO_REVOKED] id=${id}`);
  return c.json({ ok: true, revoked: id });
});

export default function registerAdminRoutes(app) {
  app.route('/api/admin', admin);
}
