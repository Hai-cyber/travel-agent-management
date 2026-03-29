// @ts-nocheck
/**
 * scripts/seed-site-templates.mjs
 *
 * Uploads every folder inside ./templates/ to local R2 `site-templates`
 * (wrangler binding: SITE_TEMPLATES) using the wrangler CLI, then upserts
 * a row into the D1 table `site_templates`.
 *
 * R2 key layout  →  {template-id}/index.html
 *                    {template-id}/assets/css/main.css
 *                    {template-id}/images/pic01.jpg  …
 *
 * D1 row  →  id, name, r2_prefix, is_active=1, sort_order=0, created_at
 *
 * Usage:
 *   node scripts/seed-site-templates.mjs [--dry-run] [--folder test-v1]
 *
 * No wrangler dev server needed — CLI accesses .wrangler/state directly.
 */

import { readdirSync, statSync } from 'fs';
import { join, extname, relative, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const ROOT      = join(dirname(fileURLToPath(import.meta.url)), '..');
const TMPL_ROOT = join(ROOT, 'templates');
const argv      = process.argv.slice(2);
const DRY       = argv.includes('--dry-run');
const ONLY      = argv.includes('--folder') ? argv[argv.indexOf('--folder') + 1] : null;

const D1_DB  = 'travel_agent_db';
const BUCKET = 'site-templates';   // wrangler.jsonc → bucket_name (NOT binding name)

// ── MIME map ──────────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',  '.woff2': 'font/woff2',
  '.ttf':  'font/ttf',   '.eot':   'application/vnd.ms-fontobject',
  '.otf':  'font/otf',   '.txt':   'text/plain; charset=utf-8',
  '.scss': 'text/plain; charset=utf-8',
};
const mime = f => MIME[extname(f).toLowerCase()] ?? 'application/octet-stream';

// ── Helpers ───────────────────────────────────────────────────────────────────
const slug  = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const title = s => s.replace(/[-_]+/g, ' ').split(' ')
  .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

function walk(dir, base = dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) out.push(...walk(f, base));
    else out.push({ abs: f, rel: relative(base, f).replace(/\\/g, '/') });
  }
  return out;
}

// ── R2 upload via wrangler CLI ────────────────────────────────────────────────
function r2Put(r2Key, absPath, contentType) {
  // Escape paths for shell safety (no spaces expected in project path, but safe anyway)
  execSync(
    `npx wrangler r2 object put "${BUCKET}/${r2Key}" --local --file="${absPath}" --content-type "${contentType}"`,
    { cwd: ROOT, stdio: 'pipe' }
  );
}

// ── D1 upsert via wrangler CLI ────────────────────────────────────────────────
function d1Upsert(id, name, r2Prefix) {
  const now     = Math.floor(Date.now() / 1000);
  const safeName = name.replace(/'/g, "''");
  const sql =
    `INSERT INTO site_templates (id,name,r2_prefix,is_active,sort_order,created_at) ` +
    `VALUES ('${id}','${safeName}','${r2Prefix}',1,0,${now}) ` +
    `ON CONFLICT(id) DO UPDATE SET ` +
    `name=excluded.name, r2_prefix=excluded.r2_prefix, is_active=1;`;

  execSync(
    `npx wrangler d1 execute ${D1_DB} --local --command "${sql.replace(/"/g, '\\"')}"`,
    { cwd: ROOT, stdio: 'pipe' }
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n📂  Template root : ${TMPL_ROOT}`);
  console.log(`☁️   R2 bucket    : ${BUCKET} (local)`);
  console.log(`🗄️   D1 database  : ${D1_DB} (local)`);
  if (DRY)  console.log('🔍  DRY RUN — nothing written');
  if (ONLY) console.log(`🎯  Only folder  : ${ONLY}`);
  console.log('');

  let folders = readdirSync(TMPL_ROOT).filter(f => statSync(join(TMPL_ROOT, f)).isDirectory());
  if (ONLY) folders = folders.filter(f => f === ONLY);
  if (!folders.length) { console.log('⚠️  No folders found.'); return; }

  let totalFiles = 0, totalBytes = 0, done = 0, failed = 0;

  for (const folder of folders) {
    const id   = slug(folder);
    const name = title(folder);
    const all  = walk(join(TMPL_ROOT, folder));
    console.log(`── ${folder}  →  "${id}"  (${all.length} files)`);

    if (DRY) {
      all.forEach(({ rel, abs }) => console.log(`   [dry] ${id}/${rel}  (${mime(abs)})`));
      console.log(`   [dry] D1 → id="${id}" name="${name}"`);
      continue;
    }

    let ok = true;
    for (const { abs, rel } of all) {
      const key  = `${id}/${rel}`;
      const ct   = mime(abs);
      const size = statSync(abs).size;
      try {
        r2Put(key, abs, ct);
        totalFiles++; totalBytes += size;
        console.log(`   ✓  ${key}  [${ct}]  ${size}B`);
      } catch (e) {
        console.error(`   ✗  ${key}  — ${(e.stderr?.toString() ?? e.message).trim()}`);
        ok = false;
      }
    }

    if (ok) {
      try {
        d1Upsert(id, name, id);
        console.log(`   🗄️  D1 → id="${id}"  name="${name}"  r2_prefix="${id}"`);
        done++;
      } catch (e) {
        console.error(`   ⚠️  D1 fail: ${(e.stderr?.toString() ?? e.message).trim()}`);
        failed++;
      }
    } else {
      console.warn('   ⚠️  D1 skipped (upload errors above)');
      failed++;
    }
    console.log('');
  }

  const sep = '─'.repeat(58);
  console.log(sep);
  if (DRY) { console.log(`🔍  Dry run — ${folders.length} template(s) found`); return; }
  console.log(`✅  Templates : ${done}  ❌ failed: ${failed}`);
  console.log(`✅  Files     : ${totalFiles}  (${(totalBytes / 1024).toFixed(1)} KB)`);
  console.log(`\n📋  Verify D1:`);
  console.log(`  npx wrangler d1 execute ${D1_DB} --local --command "SELECT id,name,r2_prefix FROM site_templates;"`);
})().catch(e => { console.error('💥', e.message); process.exit(1); });
