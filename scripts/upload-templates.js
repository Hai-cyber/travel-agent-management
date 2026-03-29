#!/usr/bin/env node
/**
 * scripts/upload-templates.js
 *
 * Uploads HTML templates from templates/<folder>/ into the local R2 TOUR_PAGES
 * bucket via PUT /api/tours/templates/:templateId
 *
 * Usage:
 *   node scripts/upload-templates.js [--base http://127.0.0.1:8787] [--tenant ten-demo-001]
 *
 * What it does:
 *   - Scans each subdirectory inside templates/
 *   - For each .html file found at the TOP level of that folder, inlines the
 *     <link rel="stylesheet"> and <script src="..."> assets (from the same folder
 *     on disk) so the template works as a single self-contained file in R2.
 *   - Uploads with template ID = "<folder>-<basename>" e.g. "test-v1-index"
 *     (or just "<folder>" when the file is index.html)
 *   - Workers's generateTourPage reads templates/{templateId}.html from TOUR_PAGES
 *
 * Worker must be running before you run this script.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, basename, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir     = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dir, '..');
const TMPL_ROOT = join(ROOT, 'templates');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const base   = argVal(args, '--base')   ?? 'http://127.0.0.1:8787';
const tenant = argVal(args, '--tenant') ?? 'ten-demo-001';

function argVal(arr, flag) {
  const i = arr.indexOf(flag);
  return i !== -1 ? arr[i + 1] : null;
}

// ── Inline local assets into HTML ─────────────────────────────────────────────
// Replaces <link rel="stylesheet" href="assets/..."> with <style>…</style>
// and <script src="assets/..."> with <script>…</script>
// Only handles relative paths within the same template folder.
function inlineAssets(html, tmplDir) {
  // Inline CSS
  html = html.replace(
    /<link\s[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*\/?>/gi,
    (match, href) => {
      if (/^https?:\/\//.test(href)) return match; // external — keep
      const path = join(tmplDir, href);
      if (!existsSync(path)) {
        console.warn(`  ⚠  CSS not found on disk, keeping <link>: ${href}`);
        return match;
      }
      const css = readFileSync(path, 'utf8');
      return `<style>/* inlined: ${href} */\n${css}\n</style>`;
    }
  );

  // Inline JS (only local <script src="..."></script>, not modules)
  html = html.replace(
    /<script\s[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi,
    (match, src) => {
      if (/^https?:\/\//.test(src)) return match; // external CDN — keep
      const path = join(tmplDir, src);
      if (!existsSync(path)) {
        console.warn(`  ⚠  JS not found on disk, keeping <script src>: ${src}`);
        return match;
      }
      const js = readFileSync(path, 'utf8');
      return `<script>/* inlined: ${src} */\n${js}\n</script>`;
    }
  );

  return html;
}

// ── Upload one template ───────────────────────────────────────────────────────
async function uploadTemplate(templateId, html) {
  const url = `${base}/api/tours/templates/${templateId}`;
  const res = await fetch(url, {
    method:  'PUT',
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Tenant-ID':  tenant,
    },
    body: html,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n📦  Upload templates → ${base}  (tenant: ${tenant})\n`);

  let uploaded = 0, skipped = 0, failed = 0;

  // Each subdirectory of templates/ = one template family
  for (const folder of readdirSync(TMPL_ROOT)) {
    const folderPath = join(TMPL_ROOT, folder);
    if (!statSync(folderPath).isDirectory()) continue;

    // Find all .html files at top level of folder
    const htmlFiles = readdirSync(folderPath).filter(f => extname(f) === '.html');
    if (!htmlFiles.length) {
      console.log(`⏭  ${folder}/ — no HTML files, skipping`);
      skipped++;
      continue;
    }

    for (const file of htmlFiles) {
      const filePath   = join(folderPath, file);
      const baseName   = basename(file, '.html'); // e.g. "index", "left-sidebar"
      const templateId = baseName === 'index' ? folder : `${folder}-${baseName}`;

      console.log(`→  ${folder}/${file}  →  template ID: "${templateId}"`);

      let html = readFileSync(filePath, 'utf8');

      // Inline local CSS/JS so it works as a standalone R2 object
      html = inlineAssets(html, folderPath);

      const { status, ok, data } = await uploadTemplate(templateId, html);
      if (ok) {
        console.log(`   ✓  ${status} — r2_key: ${data.r2_key ?? '?'}`);
        uploaded++;
      } else {
        console.error(`   ✗  ${status} — ${JSON.stringify(data)}`);
        failed++;
      }
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`✅ Uploaded: ${uploaded}  ⏭ Skipped: ${skipped}  ❌ Failed: ${failed}`);
  console.log(`\nVerify with:`);
  console.log(`  curl http://127.0.0.1:8787/api/tours/templates/test-v1 -H "X-Tenant-ID: ${tenant}" | head -c 200`);

  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
