#!/usr/bin/env node
/**
 * reset-sandbox.mjs
 *
 * Deletes all files under the  sandbox/  prefix in the TOUR_PAGES R2 bucket
 * for every tenant (or a specific tenant), preparing for a new template.
 *
 * The sandbox/ prefix structure is:
 *   sandbox/{tenantId}/index.html
 *   sandbox/{tenantId}/assets/css/main.css
 *   sandbox/{tenantId}/tours/{slug}.html
 *   …
 *
 * Usage:
 *   # Wipe sandbox for ALL tenants (dry-run preview first):
 *   node scripts/reset-sandbox.mjs --local --dry-run
 *   node scripts/reset-sandbox.mjs --local
 *
 *   # Wipe sandbox for a single tenant:
 *   node scripts/reset-sandbox.mjs --local --tenant ten-demo-001
 *
 *   # Production (no --local):
 *   node scripts/reset-sandbox.mjs --tenant ten-acme-001
 *
 * Options:
 *   --local          Target local Wrangler dev environment instead of production
 *   --tenant <id>    Only clear sandbox for this specific tenant ID
 *   --dry-run        List keys that would be deleted without actually deleting
 *
 * Requirements:
 *   wrangler must be installed and authenticated.
 *
 * Notes:
 *   - Only sandbox/{tenantId}/ keys are removed.
 *     assets/{tenantId}/ (uploaded images) and live/{tenantId}/ are NOT touched.
 *   - Wrangler's r2 object delete command is called in batches of 10 keys to
 *     avoid shell argument limits on all platforms.
 */

import { execSync } from 'node:child_process';

// ── Argument parsing ──────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const flag    = (name) => args.includes(name);
const opt     = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const LOCAL      = flag('--local');
const DRY_RUN    = flag('--dry-run');
const TENANT_ID  = opt('--tenant');

const BUCKET     = 'tour-pages';          // TOUR_PAGES binding
const LOCAL_FLAG = LOCAL ? ' --local' : '';

// ── Exec helper ───────────────────────────────────────────────────────────────
function run(cmd, silent = false) {
  if (DRY_RUN) {
    console.log('[dry-run]', cmd);
    return '';
  }
  if (!silent) console.log('▶', cmd);
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

// ── List all R2 keys under a prefix ──────────────────────────────────────────
function listKeys(prefix) {
  // wrangler r2 object list outputs JSON lines (one object per line)
  const raw = execSync(
    `npx wrangler r2 object list ${BUCKET} --prefix "${prefix}"${LOCAL_FLAG} --json`,
    { encoding: 'utf8' }
  ).trim();

  if (!raw) return [];
  // wrangler outputs a JSON array
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Fallback: try newline-delimited JSON
    parsed = raw.split('\n')
      .filter(Boolean)
      .flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  }
  // Normalise: result may be an array of objects or an object with a .objects field
  const objects = Array.isArray(parsed) ? parsed : (parsed.objects ?? []);
  return objects.map(o => o.key ?? o.Key).filter(Boolean);
}

// ── Delete keys in batches ────────────────────────────────────────────────────
function deleteKeys(keys) {
  const BATCH = 10;
  let deleted = 0;
  for (let i = 0; i < keys.length; i += BATCH) {
    const slice = keys.slice(i, i + BATCH);
    for (const key of slice) {
      if (DRY_RUN) {
        console.log(`  [dry-run] would delete: ${key}`);
      } else {
        console.log(`  🗑  ${key}`);
        execSync(
          `npx wrangler r2 object delete ${BUCKET} "${key}"${LOCAL_FLAG}`,
          { stdio: 'inherit' }
        );
      }
      deleted++;
    }
  }
  return deleted;
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async function main() {
  console.log('\n━━━ reset-sandbox.mjs ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(` Bucket  : ${BUCKET}  (TOUR_PAGES)`);
  console.log(` Tenant  : ${TENANT_ID ?? '(all tenants)'}`);
  console.log(` Mode    : ${LOCAL ? 'local (wrangler dev)' : 'production'}`);
  console.log(` Dry-run : ${DRY_RUN}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // ── Discover tenants to clear ───────────────────────────────────────────────
  let tenantIds = [];

  if (TENANT_ID) {
    // Single tenant: just use the provided ID
    tenantIds = [TENANT_ID];
  } else {
    // All tenants: list top-level virtual "directories" under sandbox/
    // wrangler r2 object list with --delimiter '/' returns CommonPrefixes
    console.log('Discovering tenants under sandbox/ …');
    const allKeys = listKeys('sandbox/');

    // Extract unique tenant IDs from  sandbox/{tenantId}/...  keys
    const seen = new Set();
    for (const key of allKeys) {
      const m = key.match(/^sandbox\/([^/]+)\//);
      if (m) seen.add(m[1]);
    }
    tenantIds = [...seen];

    if (tenantIds.length === 0) {
      console.log('No sandbox/ files found. Nothing to delete.\n');
      process.exit(0);
    }
    console.log(`Found ${tenantIds.length} tenant(s): ${tenantIds.join(', ')}\n`);
  }

  // ── Clear sandbox per tenant ────────────────────────────────────────────────
  let totalDeleted = 0;

  for (const tid of tenantIds) {
    const prefix = `sandbox/${tid}/`;
    console.log(`\n── Tenant: ${tid}  (prefix: ${prefix})`);

    const keys = listKeys(prefix);
    if (keys.length === 0) {
      console.log('  (empty — nothing to delete)');
      continue;
    }

    console.log(`  Found ${keys.length} file(s)`);
    const n = deleteKeys(keys);
    totalDeleted += n;
    if (!DRY_RUN) {
      console.log(`  ✓ Deleted ${n} file(s)`);
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (DRY_RUN) {
    console.log(` DRY-RUN complete. ${totalDeleted} file(s) would be deleted.`);
    console.log(' Re-run without --dry-run to apply.');
  } else {
    console.log(` ✓ Done. ${totalDeleted} sandbox file(s) deleted across ${tenantIds.length} tenant(s).`);
    console.log(' Next: upload new Cruip templates, then call POST /api/tenant/init-sandbox to re-initialise.');
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}());
