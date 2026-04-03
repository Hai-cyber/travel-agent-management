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

const admin = new Hono();

// ── Constants ─────────────────────────────────────────────────────────────────
const MAX_ZIP_BYTES    = 20 * 1024 * 1024;   // 20 MB
const MAX_FILE_BYTES   =  5 * 1024 * 1024;   //  5 MB per extracted file
const MAX_FILES        = 500;

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

export default function registerAdminRoutes(app) {
  app.route('/api/admin', admin);
}
