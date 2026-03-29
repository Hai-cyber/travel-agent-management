#!/usr/bin/env node
/**
 * extract-sections.mjs — Bulk section extractor for Site Studio snippet library.
 *
 * Scans all HTML files under templates/, extracts <section> blocks, classifies
 * them into the 4 Odoo-style categories, and emits ready-to-paste <template>
 * blocks compatible with public/common-sections.html.
 *
 * Usage:
 *   node scripts/extract-sections.mjs                        # print to stdout
 *   node scripts/extract-sections.mjs >> public/common-sections.html
 *
 * Requirements: Node.js ≥18 (node:fs, node:path — no npm dependencies).
 *
 * To extract Cruip zips first (run from project root):
 *   cd templates && for f in *.zip; do unzip -q "$f" -d "${f%.zip}"; done && cd ..
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, basename, dirname }    from 'node:path';
import { fileURLToPath }                        from 'node:url';

const ROOT         = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_DIR = join(ROOT, 'templates');
const MIN_LEN      = 250;     // skip tiny dividers / spacers
const MAX_LEN      = 60_000;  // skip enormous multi-section blobs
const MAX_PER_TYPE = 3;       // limit per type per template to avoid noise

// ── Category classification rules ─────────────────────────────────────────
// p: regex patterns; score = # of patterns that match the raw section HTML.
// Rule with highest score wins; ties resolved by order.
const RULES = [
  // ── Essential ────────────────────────────────────────────────────────────
  {
    cat: 'essential', type: 'hero', label: 'Hero Banner', icon: '🌄',
    p: [/\bhero\b/i, /<h1[\s>]/i, /get\s+started/i, /\bslogan\b/i,
        /discover\b/i, /\bwelcome\b/i, /\bheadline\b/i],
  },
  {
    cat: 'essential', type: 'intro', label: 'Introduction', icon: '📖',
    p: [/\bintro\b/i, /\babout[_\s-]us\b/i, /our\s+story/i, /who\s+we\s+are/i,
        /our\s+mission/i, /\babout\s+section\b/i],
  },
  {
    cat: 'essential', type: 'features', label: 'Features Grid', icon: '✨',
    p: [/\bfeature[s]?\b/i, /\bbenefit[s]?\b/i, /\badvantage[s]?\b/i,
        /checkmark/i, /icon.*grid/i, /why\s+choose/i],
  },
  // ── Commerce ─────────────────────────────────────────────────────────────
  {
    cat: 'commerce', type: 'tours', label: 'Tours / Services', icon: '✈️',
    p: [/\btour[s]?\b/i, /\bpackage[s]?\b/i, /\bdestination[s]?\b/i,
        /\bservice[s]?\b/i, /\btravel\b.*\bcard\b/i, /\bexcursion[s]?\b/i],
  },
  {
    cat: 'commerce', type: 'pricing', label: 'Pricing Table', icon: '💰',
    p: [/\bpric(?:e|ing)\b/i, /\bplan[s]?\b/i, /per\s+month/i,
        /free\s+trial/i, /\btier[s]?\b/i, /monthly.*annual/i],
  },
  {
    cat: 'commerce', type: 'booking', label: 'Booking CTA', icon: '📅',
    p: [/\bbooking\b/i, /\breservation[s]?\b/i, /book\s+now/i,
        /enquire\s+now/i, /\bavailability\b/i, /book\s+a\s+trip/i],
  },
  // ── Trust ─────────────────────────────────────────────────────────────────
  {
    cat: 'trust', type: 'testimonials', label: 'Testimonials', icon: '⭐',
    p: [/\btestimonial[s]?\b/i, /\breview[s]?\b/i, /what\s+(?:our\s+)?clients\s+say/i,
        /[""][^""]{15,}[""]/, /\brating[s]?\b/i, /\bquote[s]?\b/i],
  },
  {
    cat: 'trust', type: 'partners', label: 'Partners / Logos', icon: '🤝',
    p: [/\bpartner[s]?\b/i, /\bsponsor[s]?\b/i, /\blogo[s]?\b/i,
        /trusted\s+by/i, /as\s+seen\s+(?:on|in)/i, /\bbrand[s]?\b/i],
  },
  {
    cat: 'trust', type: 'faq', label: 'FAQ', icon: '❓',
    p: [/\bfaq\b/i, /frequently\s+asked/i, /\baccordion\b/i, /common\s+questions/i],
  },
  // ── Contact ───────────────────────────────────────────────────────────────
  {
    cat: 'contact', type: 'contact', label: 'Contact Form', icon: '📬',
    p: [/<form[\s>]/i, /send.*message/i, /get\s+in\s+touch/i,
        /\bcontact\s+us\b/i, /\enquiry/i, /\bsubmit\b/i],
  },
  {
    cat: 'contact', type: 'footer', label: 'Footer', icon: '🏷️',
    p: [/<footer[\s>]/i, /copyright/i, /all\s+rights\s+reserved/i,
        /privacy\s+policy/i, /\bsitemap\b/i],
  },
];
const FALLBACK = { cat: 'essential', type: 'content', label: 'Content Block', icon: '▦' };
const CAT_ORDER = ['essential', 'commerce', 'trust', 'contact'];
const CAT_TITLES = {
  essential: '✅ ESSENTIAL — Hero, Intro, Features',
  commerce:  '💰 COMMERCE — Tours, Pricing, Booking',
  trust:     '⭐ TRUST — Testimonials, Partners, FAQ',
  contact:   '📬 CONTACT — Contact Forms, Footer',
};

// ── Helpers ────────────────────────────────────────────────────────────────
function scanDir(dir, acc = []) {
  try {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      try {
        const s = statSync(full);
        if (s.isDirectory()) scanDir(full, acc);
        else if (extname(e).toLowerCase() === '.html') acc.push(full);
      } catch (_) {}
    }
  } catch (_) {}
  return acc;
}

// Depth-aware <section>…</section> extractor — handles nested sections.
function extractSections(html) {
  const out = [];
  let i = 0;
  while (i < html.length) {
    const s = html.indexOf('<section', i);
    if (s === -1) break;
    let depth = 0, j = s;
    let found = false;
    while (j < html.length) {
      const lt = html.indexOf('<', j);
      if (lt === -1) break;
      const gt = html.indexOf('>', lt);
      if (gt === -1) break;
      const tag = html.slice(lt, gt + 1);
      if (/^<section(\s|>)/i.test(tag)) {
        depth++;
      } else if (/^<\/section\s*>/i.test(tag)) {
        depth--;
        if (depth === 0) { out.push(html.slice(s, gt + 1)); i = gt + 1; found = true; break; }
      }
      j = gt + 1;
    }
    if (!found) break;
  }
  return out;
}

function classify(html) {
  let best = FALLBACK, bestScore = 0;
  for (const r of RULES) {
    const score = r.p.filter(p => p.test(html)).length;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best;
}

function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function esc(s)  { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── Main ──────────────────────────────────────────────────────────────────
const files = scanDir(TEMPLATE_DIR);
if (!files.length) {
  process.stderr.write(
    `No HTML files found in ${TEMPLATE_DIR}.\n\n` +
    `Extract Cruip template zips first (run from project root):\n` +
    `  cd templates && for f in *.zip; do unzip -q "$f" -d "\${f%.zip}"; done && cd ..\n\n` +
    `Then re-run:\n  node scripts/extract-sections.mjs >> public/common-sections.html\n`
  );
  process.exit(1);
}

const seen    = new Set();
const groups  = { essential: [], commerce: [], trust: [], contact: [] };

for (const file of files) {
  let html;
  try { html = readFileSync(file, 'utf8'); } catch (_) { continue; }
  const tmplName = slug(basename(dirname(file)));
  const perType  = {};

  for (const sec of extractSections(html)) {
    if (sec.length < MIN_LEN || sec.length > MAX_LEN) continue;
    // Fingerprint: first 120 chars of whitespace-normalised HTML
    const fp = sec.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (seen.has(fp)) continue;
    seen.add(fp);

    const rule = classify(sec);
    perType[rule.type] = (perType[rule.type] || 0) + 1;
    if (perType[rule.type] > MAX_PER_TYPE) continue;

    (groups[rule.cat] = groups[rule.cat] || []).push({ tmplName, rule, html: sec });
  }
}

const counters = {};
const total    = Object.values(groups).reduce((n, g) => n + g.length, 0);
process.stderr.write(`Scanned ${files.length} HTML files — extracted ${total} sections\n\n`);

const lines = [
  '',
  '<!-- ═══════════════════════════════════════════════════════════════════',
  '     AUTO-EXTRACTED — scripts/extract-sections.mjs',
  `     Generated:       ${new Date().toISOString()}`,
  `     Files scanned:   ${files.length}`,
  `     Sections found:  ${total}`,
  '     ═══════════════════════════════════════════════════════════════════ -->',
  '',
];

for (const cat of CAT_ORDER) {
  const items = groups[cat] || [];
  if (!items.length) continue;
  lines.push(`<!-- ════ ${CAT_TITLES[cat]} ════ -->`);
  lines.push('');

  for (const item of items) {
    counters[item.rule.type] = (counters[item.rule.type] || 0) + 1;
    const n      = counters[item.rule.type];
    const suffix = n > 1 ? `-${n}` : '';
    const typeId = `${item.tmplName}-${item.rule.type}${suffix}`;
    const id     = `section-${typeId}`;

    lines.push(`<template`);
    lines.push(`  id="${id}"`);
    lines.push(`  data-type="${typeId}"`);
    lines.push(`  data-category="${cat}"`);
    lines.push(`  data-label="${esc(item.rule.label)} (${item.tmplName})"`);
    lines.push(`  data-icon="${item.rule.icon}"`);
    lines.push(`  data-desc="Extracted from ${item.tmplName} template">`);
    lines.push(item.html);
    lines.push(`</template>`);
    lines.push('');
  }
}

const body = lines.join('\n') + '\n<!-- end of auto-extracted sections -->\n';
process.stdout.write(body);
