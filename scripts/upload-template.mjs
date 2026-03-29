#!/usr/bin/env node
/**
 * upload-template.mjs
 *
 * Uploads a local template directory to the SITE_TEMPLATES R2 bucket,
 * then registers the template in the site_templates D1 table.
 *
 * Usage:
 *   node scripts/upload-template.mjs [options]
 *
 * Options:
 *   --local          Target local Wrangler dev environment (default: false)
 *   --source <dir>   Local directory to upload (default: templates/test-v1)
 *   --prefix <key>   R2 key prefix inside the bucket  (default: default)
 *   --id <id>        site_templates.id                 (default: default)
 *   --name <name>    site_templates.name               (default: Standard Travel)
 *   --dry-run        Print commands without executing
 *
 * Examples:
 *   # Upload to local wrangler dev environment:
 *   node scripts/upload-template.mjs --local
 *
 *   # Upload to production with a custom id:
 *   node scripts/upload-template.mjs --prefix tmpl-bold-v2 --id tmpl-bold-v2 --name "Bold V2"
 */

import { execSync } from 'node:child_process';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Argument parsing ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag  = (name) => args.includes(name);
const opt   = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const LOCAL   = flag('--local');
const DRY_RUN = flag('--dry-run');
const SOURCE  = join(ROOT, opt('--source', 'templates/test-v1'));
const PREFIX  = opt('--prefix', 'default');
const TMPL_ID = opt('--id',     'default');
const TMPL_NAME = opt('--name', 'Standard Travel');

const BUCKET      = 'site-templates';
const D1_DB       = 'travel_agent_db';
const LOCAL_FLAG  = LOCAL ? '--local' : '';

// ── MIME type map ─────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':   'font/ttf',
  '.eot':   'application/vnd.ms-fontobject',
  '.otf':   'font/otf',
  '.txt':  'text/plain; charset=utf-8',
  '.map':  'application/json; charset=utf-8',
};

function getMime(file) {
  return MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

// ── Recursive file walk ───────────────────────────────────────────────────────
function walk(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...walk(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

// ── Exec helper ──────────────────────────────────────────────────────────────
function run(cmd) {
  if (DRY_RUN) {
    console.log('[dry-run]', cmd);
    return;
  }
  console.log('▶', cmd);
  execSync(cmd, { stdio: 'inherit', cwd: ROOT });
}

// ── Main ─────────────────────────────────────────────────────────────────────
(function main() {
  if (!existsSync(SOURCE)) {
    console.error(`ERROR: Source directory not found: ${SOURCE}`);
    process.exit(1);
  }

  const files = walk(SOURCE);
  const total = files.length;
  console.log(`\nUploading ${total} file(s) from ${SOURCE}`);
  console.log(`  Bucket  : ${BUCKET}  (binding SITE_TEMPLATES)`);
  console.log(`  Prefix  : ${PREFIX}/`);
  console.log(`  Mode    : ${LOCAL ? 'local (wrangler dev)' : 'production'}`);
  console.log(`  Dry-run : ${DRY_RUN}\n`);

  // ── Step 1: upload each file ────────────────────────────────────────────────
  let uploaded = 0;
  for (const filePath of files) {
    const rel  = relative(SOURCE, filePath);    // e.g. "assets/css/main.css"
    const key  = `${PREFIX}/${rel}`;             // e.g. "default/assets/css/main.css"
    const mime = getMime(filePath);

    run(
      `npx wrangler r2 object put "${BUCKET}/${key}" ` +
      `--file "${filePath}" ` +
      `--content-type "${mime}" ` +
      `${LOCAL_FLAG}`.trim()
    );
    uploaded++;
    process.stdout.write(`\r  [${uploaded}/${total}] ${key}                    `);
  }
  console.log('\n\n✓ R2 upload complete.\n');

  // ── Step 2: insert / replace site_templates row in D1 ──────────────────────
  const now  = Math.floor(Date.now() / 1000);
  const sql  = [
    `INSERT OR REPLACE INTO site_templates`,
    `  (id, name, description, r2_prefix, is_active, sort_order, created_at)`,
    `VALUES`,
    `  ('${TMPL_ID}', '${TMPL_NAME}', 'Uploaded via upload-template.mjs', '${PREFIX}', 1, 0, ${now});`,
  ].join(' ');

  console.log('Registering template in D1...');
  run(`npx wrangler d1 execute ${D1_DB} ${LOCAL_FLAG} --command "${sql}"`);

  console.log('\n✓ Done.');
  console.log(`  site_templates.id        = ${TMPL_ID}`);
  console.log(`  site_templates.name      = ${TMPL_NAME}`);
  console.log(`  site_templates.r2_prefix = ${PREFIX}`);
  console.log('\nTo verify:');
  console.log(`  npx wrangler d1 execute ${D1_DB} ${LOCAL_FLAG} --command "SELECT * FROM site_templates WHERE id='${TMPL_ID}';"`);
})();
