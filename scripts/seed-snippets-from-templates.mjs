#!/usr/bin/env node
/**
 * scripts/seed-snippets-from-templates.mjs
 *
 * Reads the index.html of every Cruip template in templates/*-html/,
 * extracts all <section> elements, deduplicates them by category, and
 * saves the best N examples per category as JSON snippets in:
 *
 *   src/snippets/{template-slug}-{category}-{nn}.json
 *
 * Then rebuilds public/snippets/index.json (the runtime manifest loaded
 * by the Visual Editor's Snippets panel).
 *
 * Deduplication strategy:
 *   — At most MAX_PER_CAT (default 3) snippets per category are kept.
 *   — Winners are chosen from different templates (diversity > quantity).
 *   — Sections shorter than MIN_HTML_LEN chars are skipped (too trivial).
 *   — header / footer sections are excluded by default.
 *
 * Usage:
 *   node scripts/seed-snippets-from-templates.mjs [options]
 *
 * Options:
 *   --templates <dir>   Template root dir   (default: templates)
 *   --out       <dir>   Snippets output dir (default: src/snippets)
 *   --manifest  <file>  Manifest dest       (default: public/snippets/index.json)
 *   --max-per-cat <n>   Max snippets/cat    (default: 3)
 *   --min-len <n>       Min HTML length     (default: 300)
 *   --keep-nav          Also include header/footer sections
 *   --clear             Delete existing src/snippets files before writing
 *   --dry-run           Print plan, write nothing
 *   --verbose           Show per-section details
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath }          from 'node:url';
import { dirname }                from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');

// ── CLI opts ─────────────────────────────────────────────────────────────────
const argv     = process.argv.slice(2);
const flag     = (n) => argv.includes(n);
const opt      = (n, d) => { const i = argv.indexOf(n); return i !== -1 && argv[i+1] ? argv[i+1] : d; };

const TMPL_ROOT    = resolve(ROOT, opt('--templates', 'templates'));
const OUT_DIR      = resolve(ROOT, opt('--out',       'src/snippets'));
const MANIFEST     = resolve(ROOT, opt('--manifest',  'public/snippets/index.json'));
const MAX_PER_CAT  = parseInt(opt('--max-per-cat', '3'), 10);
const MIN_LEN      = parseInt(opt('--min-len',     '300'), 10);
const KEEP_NAV     = flag('--keep-nav');
const CLEAR        = flag('--clear');
const DRY_RUN      = flag('--dry-run');
const VERBOSE      = flag('--verbose');

// ── Category detection rules (order = priority) ───────────────────────────────
const CATEGORY_RULES = [
  { re: /\bhero\b/i,                        cat: 'hero'         },
  { re: /\bfeatures?\b/i,                   cat: 'features'     },
  { re: /\btestimonials?\b|\breviews?\b/i,  cat: 'testimonials' },
  { re: /\bpric(ing|e)\b/i,                 cat: 'pricing'      },
  { re: /\bfaq\b|\baccordion\b/i,           cat: 'faq'          },
  { re: /\bteam\b/i,                        cat: 'team'         },
  { re: /\bstats?\b|\bnumbers?\b/i,         cat: 'stats'        },
  { re: /\bgaller(y|ies)\b|\bslider\b/i,    cat: 'gallery'      },
  { re: /\bcontact\b/i,                     cat: 'contact'      },
  { re: /\bcta\b|\bcall-to-action\b/i,      cat: 'cta'          },
  { re: /\blogo(s|-cloud)?\b/i,             cat: 'logos'        },
  { re: /\bblog\b|\bpost(s)?\b/i,           cat: 'blog'         },
  { re: /\bintegrations?\b/i,               cat: 'integrations' },
  { re: /\bstep(s)?\b|\bhow.?it.?works?\b/i, cat: 'steps'      },
  { re: /\bnewsletter\b|\bsubscribe\b/i,    cat: 'newsletter'   },
  { re: /\bnavbar?\b|\bheader\b/i,          cat: 'header'       },
  { re: /\bfooter\b/i,                      cat: 'footer'       },
  { re: /\babout\b/i,                       cat: 'about'        },
];

const SKIP_CATS = KEEP_NAV ? new Set() : new Set(['header', 'footer']);

function guessCategory(html) {
  for (const rule of CATEGORY_RULES) {
    if (rule.re.test(html)) return rule.cat;
  }
  return 'section';
}

// ── Human label per category ──────────────────────────────────────────────────
const CATEGORY_LABELS = {
  hero: 'Hero', features: 'Features', testimonials: 'Testimonials',
  pricing: 'Pricing', faq: 'FAQ', team: 'Team', stats: 'Stats',
  gallery: 'Gallery', contact: 'Contact', cta: 'CTA', logos: 'Logo Cloud',
  blog: 'Blog', integrations: 'Integrations', steps: 'Steps',
  newsletter: 'Newsletter', header: 'Header', footer: 'Footer',
  about: 'About', section: 'Section',
};

// Template slug → human name
function templateLabel(slug) {
  return slug
    .replace(/-html$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ── Section extractor (same depth-counter approach as tools/extract-cruip-snippets.js) ──
function extractSections(html) {
  const sections = [];
  const events   = [];

  // Collect open / close positions
  const openRe  = /<section(\s[^>]*)?>|<section>/gi;
  const closeRe = /<\/section>/gi;
  let m;
  openRe.lastIndex = 0;
  closeRe.lastIndex = 0;
  while ((m = openRe.exec(html))  !== null) events.push({ t: 'o', pos: m.index, end: m.index + m[0].length, tag: m[0], attrStr: m[1] || '' });
  while ((m = closeRe.exec(html)) !== null) events.push({ t: 'c', pos: m.index, end: m.index + m[0].length });
  events.sort((a, b) => a.pos - b.pos);

  let depth = 0, startPos = 0, openTag = '', attrStr = '';
  for (const ev of events) {
    if (ev.t === 'o') {
      if (depth === 0) { startPos = ev.pos; openTag = ev.tag; attrStr = ev.attrStr; }
      depth++;
    } else {
      depth--;
      if (depth === 0 && startPos !== null) {
        sections.push({
          outer:   html.slice(startPos, ev.end).trim(),
          attrStr,
        });
        startPos = null;
      }
    }
  }
  return sections;
}

// ── Parse opening-tag attributes into {key:value} ────────────────────────────
function parseAttrs(attrStr) {
  const attrs = {};
  const re = /\b([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(attrStr)) !== null) {
    attrs[m[1]] = m[2] ?? m[3] ?? m[4] ?? true;
  }
  return attrs;
}

// ── Extract first heading text, stripped of tags ──────────────────────────────
function firstHeadingText(html) {
  const m = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
  if (!m) return '';
  return m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

// ── Structural fingerprint for dedup (count unique class tokens) ─────────────
function fingerprint(html) {
  const classes = (html.match(/class="([^"]+)"/g) || [])
    .flatMap(c => c.replace(/class="|"/g, '').split(/\s+/))
    .filter(Boolean);
  return new Set(classes).size;         // richer section = more unique classes
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('  Cruip Template → Snippets Seeder');
  console.log(`  Templates dir : ${relative(ROOT, TMPL_ROOT)}`);
  console.log(`  Snippets dir  : ${relative(ROOT, OUT_DIR)}`);
  console.log(`  Manifest      : ${relative(ROOT, MANIFEST)}`);
  console.log(`  Max / cat     : ${MAX_PER_CAT}   Min HTML length: ${MIN_LEN}`);
  console.log(`  Dry-run       : ${DRY_RUN}   Clear first: ${CLEAR}`);
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // ── 1. Collect all template index.html paths ─────────────────────────────────
  const tmplDirs = readdirSync(TMPL_ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.endsWith('-html'))
    .map(d => ({ slug: d.name, dir: join(TMPL_ROOT, d.name) }))
    .filter(({ dir }) => existsSync(join(dir, 'index.html')));

  if (!tmplDirs.length) {
    console.error('ERROR: No *-html template folders with index.html found in', TMPL_ROOT);
    process.exit(1);
  }
  console.log(`Found ${tmplDirs.length} templates:\n  ${tmplDirs.map(t => t.slug).join(', ')}\n`);

  // ── 2. Extract sections from every template ────────────────────────────────
  // Bucket: { category → [{ slug, label, html, chars, fp }] }
  const bucket = new Map();   // cat → candidates[]

  let totalSections = 0;
  let skippedShort  = 0;
  let skippedCat    = 0;

  for (const { slug, dir } of tmplDirs) {
    const indexPath = join(dir, 'index.html');
    const source    = readFileSync(indexPath, 'utf8');
    const sections  = extractSections(source);
    const tmplLabel = templateLabel(slug);

    VERBOSE && console.log(`  ${slug}: ${sections.length} sections found`);

    for (const sec of sections) {
      totalSections++;

      // Skip too-short sections
      if (sec.outer.length < MIN_LEN) { skippedShort++; continue; }

      const cat = guessCategory(sec.outer);

      // Skip nav/footer unless --keep-nav
      if (SKIP_CATS.has(cat)) { skippedCat++; continue; }

      const headingText = firstHeadingText(sec.outer);
      const fp          = fingerprint(sec.outer);

      const entry = {
        slug,
        tmplLabel,
        headingText,
        html: sec.outer,
        chars: sec.outer.length,
        fp,    // structural richness score
      };

      if (!bucket.has(cat)) bucket.set(cat, []);
      bucket.get(cat).push(entry);
    }
  }

  console.log(`Total raw sections : ${totalSections}`);
  console.log(`Skipped (too short): ${skippedShort}`);
  console.log(`Skipped (nav/foot) : ${skippedCat}`);
  console.log(`Categories found   : ${[...bucket.keys()].join(', ')}\n`);

  // ── 3. Select best MAX_PER_CAT per category (diversity across templates) ──
  // Strategy:
  //   a) Sort candidates by richness (fp desc) so the most visually complex wins.
  //   b) Greedily pick — once a template slug is used for this category, prefer
  //      a different one next round (but allow repeats if not enough variety).
  const selected = [];   // final list: { id, name, label, category, tags, html, thumbnail }

  for (const [cat, candidates] of [...bucket.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    // Sort by richness descending
    const ranked = [...candidates].sort((a, b) => b.fp - a.fp);

    const chosen   = [];
    const usedSlugs = new Set();
    let pass = 1;

    while (chosen.length < MAX_PER_CAT) {
      const remaining = ranked.filter(c =>
        !chosen.includes(c) && (pass === 1 ? !usedSlugs.has(c.slug) : true)
      );
      if (!remaining.length) break;

      const pick = remaining[0];
      chosen.push(pick);
      usedSlugs.add(pick.slug);

      // If we exhausted diversity but need more, allow repeats
      if (!ranked.some(c => !chosen.includes(c) && !usedSlugs.has(c.slug))) {
        pass = 2;
      }
    }

    chosen.forEach((c, i) => {
      const idx     = String(i + 1).padStart(2, '0');
      const id      = `${c.slug.replace(/-html$/, '')}-${cat}-${idx}`;
      const catLabel = CATEGORY_LABELS[cat] || cat;
      const heading  = c.headingText
        ? `${c.tmplLabel} — ${c.headingText.slice(0, 50)}`
        : `${c.tmplLabel} — ${catLabel} ${idx}`;

      selected.push({
        id,
        name:      heading,
        label:     heading,
        category:  cat,
        tags:      [...new Set([cat, c.slug.replace(/-html$/, ''), 'cruip'])],
        thumbnail: '',
        html:      c.html,
      });
    });
  }

  console.log(`\nSelected ${selected.length} snippets across ${bucket.size} categories:`);
  const catCounts = {};
  selected.forEach(s => { catCounts[s.category] = (catCounts[s.category] || 0) + 1; });
  for (const [cat, n] of Object.entries(catCounts).sort()) {
    console.log(`  ${cat.padEnd(16)} ${n}`);
  }

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] No files written.\n');
    return;
  }

  // ── 4. Write snippet files ─────────────────────────────────────────────────
  mkdirSync(OUT_DIR, { recursive: true });

  if (CLEAR) {
    const existing = readdirSync(OUT_DIR).filter(f => f.endsWith('.json'));
    existing.forEach(f => unlinkSync(join(OUT_DIR, f)));
    console.log(`\nCleared ${existing.length} existing snippet files.`);
  }

  let written = 0, skippedExist = 0;
  for (const snip of selected) {
    const dest = join(OUT_DIR, `${snip.id}.json`);
    if (existsSync(dest) && !CLEAR) {
      VERBOSE && console.log(`  SKIP (exists) ${snip.id}.json`);
      skippedExist++;
      continue;
    }
    writeFileSync(dest, JSON.stringify(snip, null, 2) + '\n', 'utf8');
    console.log(`  ✓ ${snip.id}.json  [${snip.category}]  "${snip.label}"`);
    written++;
  }

  // ── 5. Rebuild public/snippets/index.json ─────────────────────────────────
  // Merge: existing hand-crafted snippets + newly seeded ones (keep hand-crafted first)
  const allFiles = readdirSync(OUT_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => JSON.parse(readFileSync(join(OUT_DIR, f), 'utf8')));

  const manifestDir = join(MANIFEST, '..');
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(MANIFEST, JSON.stringify(allFiles, null, 2) + '\n', 'utf8');

  console.log(`\n───────────────────────────────────────────────────────────`);
  console.log(` ✓ Written:  ${written}  snippets`);
  console.log(` ✓ Skipped:  ${skippedExist}  (already exist — use --clear to replace)`);
  console.log(` ✓ Manifest: ${relative(ROOT, MANIFEST)}  (${allFiles.length} total snippets)`);
  console.log(`───────────────────────────────────────────────────────────\n`);
})();
