#!/usr/bin/env node
/**
 * tools/extract-cruip-snippets.js
 *
 * Reads a Cruip (or any Tailwind-based) HTML file, extracts every <section>
 * block, and saves each one as a separate JSON snippet in src/snippets/.
 *
 * The output format matches the existing snippet schema used by the
 * Visual Editor Section Picker:
 *
 *   {
 *     "id":        "hero-01",               // slugified name + auto-index
 *     "name":      "Hero 01",               // human label (alias: label)
 *     "label":     "Hero 01",               // same as name (kept for compat)
 *     "category":  "hero",                  // guessed from classes / heading text
 *     "tags":      ["hero", "section"],     // derived from category + data attrs
 *     "thumbnail": "",                      // empty — set manually or via screenshot tool
 *     "html":      "<section …>…</section>" // full outer HTML of the section
 *   }
 *
 * Usage:
 *   node tools/extract-cruip-snippets.js [options]
 *
 * Options:
 *   --input  <file>     Path to source HTML file  (default: stdin — pipe HTML)
 *   --out    <dir>      Output directory           (default: src/snippets)
 *   --prefix <slug>     Filename prefix            (default: "section")
 *   --start  <n>        Start numbering from N     (default: auto-detect from existing files)
 *   --dry-run           Print JSON to stdout without writing files
 *   --overwrite         Overwrite existing snippet files with same id
 *   --verbose           Print extra diagnostic output
 *
 * Examples:
 *   # Extract from a downloaded Cruip page:
 *   node tools/extract-cruip-snippets.js --input ~/Downloads/cruip-saas.html --prefix features
 *
 *   # Pipe from curl + preview before writing:
 *   curl -sL https://example.com/template | node tools/extract-cruip-snippets.js --dry-run
 *
 *   # Extract with custom output dir and start index:
 *   node tools/extract-cruip-snippets.js --input page.html --out src/snippets --prefix hero --start 3
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Argument parsing ──────────────────────────────────────────────────────────
const args      = process.argv.slice(2);
const flag      = (name) => args.includes(name);
const opt       = (name, fallback = null) => {
  const i = args.indexOf(name);
  return (i !== -1 && args[i + 1] !== undefined) ? args[i + 1] : fallback;
};

const INPUT_FILE  = opt('--input');
const OUT_DIR     = opt('--out', path.join(__dirname, '..', 'src', 'snippets'));
const PREFIX      = opt('--prefix', 'section');
const START_IDX   = opt('--start') !== null ? parseInt(opt('--start'), 10) : null;
const DRY_RUN     = flag('--dry-run');
const OVERWRITE   = flag('--overwrite');
const VERBOSE     = flag('--verbose');

// ── Category detection ────────────────────────────────────────────────────────
// Guesses the category from a section's CSS classes, aria-label, id, or first
// heading text.  Order matters — more specific patterns first.
const CATEGORY_RULES = [
  // Explicit data-category attribute (set manually on Cruip demos)
  { test: (html, attrs) => attrs['data-category'],           resolve: (html, attrs) => attrs['data-category'] },

  // Common Cruip / Tailwind section patterns via class names
  { test: (html) => /\bhero\b/i.test(html),                  resolve: () => 'hero' },
  { test: (html) => /\bfeatures?\b/i.test(html),             resolve: () => 'features' },
  { test: (html) => /\btestimonials?\b/i.test(html),         resolve: () => 'testimonials' },
  { test: (html) => /\breviews?\b/i.test(html),              resolve: () => 'testimonials' },
  { test: (html) => /\bpric(ing|e)\b/i.test(html),           resolve: () => 'pricing' },
  { test: (html) => /\bfaq\b/i.test(html),                   resolve: () => 'faq' },
  { test: (html) => /\bteam\b/i.test(html),                  resolve: () => 'team' },
  { test: (html) => /\bstats?\b|\bnumbers?\b/i.test(html),   resolve: () => 'stats' },
  { test: (html) => /\bgaller(y|ies)\b/i.test(html),         resolve: () => 'gallery' },
  { test: (html) => /\bcontact\b/i.test(html),               resolve: () => 'contact' },
  { test: (html) => /\bcta\b|\bcall-to-action\b/i.test(html),resolve: () => 'cta' },
  { test: (html) => /\blogo(s|-cloud)?\b/i.test(html),       resolve: () => 'logos' },
  { test: (html) => /\bblog\b|\bpost(s)?\b/i.test(html),     resolve: () => 'blog' },
  { test: (html) => /\bintegrations?\b/i.test(html),         resolve: () => 'integrations' },
  { test: (html) => /\bsteps?\b|\bhow.?it.?works?\b/i.test(html), resolve: () => 'steps' },
  { test: (html) => /\bform\b|\bnewsletter\b/i.test(html),   resolve: () => 'newsletter' },
  { test: (html) => /\bnavbar?\b|\bheader\b/i.test(html),    resolve: () => 'header' },
  { test: (html) => /\bfooter\b/i.test(html),                resolve: () => 'footer' },
  { test: (html) => /\baccordion\b/i.test(html),             resolve: () => 'faq' },
  { test: (html) => /\bcarousel\b|\bslider\b/i.test(html),   resolve: () => 'gallery' },
  { test: (html) => /\babout\b/i.test(html),                 resolve: () => 'about' },
];

function guessCategory(sectionHtml, attrs) {
  for (const rule of CATEGORY_RULES) {
    if (rule.test(sectionHtml, attrs)) return rule.resolve(sectionHtml, attrs);
  }
  return 'section';
}

// ── Name / label generation ───────────────────────────────────────────────────
// Tries to extract a human name from:
//   1. data-ve-label attribute
//   2. aria-label attribute
//   3. id attribute (slugs to title-case)
//   4. First <h1>–<h3> text content (stripped of tags)
//   5. Falls back to "{Category} {n}"
function extractName(html, attrs, category, index) {
  // Explicit label attribute
  if (attrs['data-ve-label']) return attrs['data-ve-label'];
  if (attrs['aria-label'])    return attrs['aria-label'];
  if (attrs['id'])            return titleCase(attrs['id'].replace(/[-_]/g, ' '));

  // First heading text
  const headingMatch = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
  if (headingMatch) {
    const text = headingMatch[1]
      .replace(/<[^>]+>/g, '')   // strip inner tags
      .replace(/&[a-z#0-9]+;/gi, ' ')  // decode HTML entities roughly
      .replace(/\s+/g, ' ')
      .trim();
    if (text && text.length <= 80) return text;
  }

  return `${titleCase(category)} ${String(index).padStart(2, '0')}`;
}

function titleCase(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

// ── HTML attribute parser ─────────────────────────────────────────────────────
// Extracts attributes from an opening tag string into a plain object.
function parseAttrs(openingTag) {
  const attrs = {};
  // Match key="value", key='value', key=value, and boolean key
  const re = /\b([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(openingTag)) !== null) {
    if (m[1] === openingTag.slice(0, 7)) continue; // skip 'section'
    attrs[m[1]] = m[2] ?? m[3] ?? m[4] ?? true;
  }
  return attrs;
}

// ── Core section extractor ────────────────────────────────────────────────────
// Parses raw HTML and returns an array of { openTag, innerHtml, outerHtml, attrs }.
// Uses a simple depth counter — does NOT need a full DOM parser.
//
// Handles:
//   • Nested <section> inside <section>  (depth counter)
//   • Self-closing sequences mistakenly written as <section/>  (ignored)
//   • Attributes spread across multiple lines
function extractSections(html) {
  const sections = [];
  const openRe   = /<section(\s[^>]*)?>|<section>/gi;
  const closeRe  = /<\/section>/gi;

  // Combine open/close events with position info, then process in order
  const events = [];

  let m;
  // Reset lastIndex before each scan
  openRe.lastIndex  = 0;
  closeRe.lastIndex = 0;

  while ((m = openRe.exec(html)) !== null) {
    events.push({ type: 'open',  pos: m.index, end: m.index + m[0].length, tag: m[0], attrs: m[1] ?? '' });
  }
  while ((m = closeRe.exec(html)) !== null) {
    events.push({ type: 'close', pos: m.index, end: m.index + m[0].length });
  }

  // Sort by position
  events.sort((a, b) => a.pos - b.pos);

  let depth = 0;
  let startPos = 0;
  let openTag  = '';
  let openAttrs = '';

  for (const ev of events) {
    if (ev.type === 'open') {
      if (depth === 0) {
        startPos  = ev.pos;
        openTag   = ev.tag;
        openAttrs = ev.attrs;
      }
      depth++;
    } else {
      depth--;
      if (depth === 0 && startPos !== null) {
        const outerHtml = html.slice(startPos, ev.end);
        const innerHtml = html.slice(startPos + openTag.length, ev.pos);
        sections.push({
          openTag,
          outerHtml: outerHtml.trim(),
          innerHtml: innerHtml.trim(),
          attrs:     parseAttrs(openTag),
        });
        startPos = null;
      }
    }
  }

  if (VERBOSE && depth !== 0) {
    console.warn(`[WARN] Unmatched <section> tags detected (depth=${depth}). Output may be incomplete.`);
  }

  return sections;
}

// ── Slugify ───────────────────────────────────────────────────────────────────
function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ── Detect next available index for a prefix ─────────────────────────────────
function detectStartIndex(outDir, prefix) {
  if (START_IDX !== null) return START_IDX;
  if (!fs.existsSync(outDir)) return 1;

  const existing = fs.readdirSync(outDir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const m = f.match(new RegExp('^' + escapeRegex(prefix) + '-(\\d+)\\.json$'));
      return m ? parseInt(m[1], 10) : 0;
    })
    .filter(n => n > 0);

  return existing.length ? Math.max(...existing) + 1 : 1;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Main ──────────────────────────────────────────────────────────────────────
(function main() {
  // ── 1. Read input ──────────────────────────────────────────────────────────
  let sourceHtml = '';

  if (INPUT_FILE) {
    const absInput = path.resolve(INPUT_FILE);
    if (!fs.existsSync(absInput)) {
      console.error(`ERROR: Input file not found: ${absInput}`);
      process.exit(1);
    }
    sourceHtml = fs.readFileSync(absInput, 'utf8');
    if (VERBOSE) console.log(`[INFO] Reading from: ${absInput}`);
  } else if (!process.stdin.isTTY) {
    // Read from stdin (piped HTML)
    const chunks = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => chunks.push(c));
    process.stdin.on('end', () => {
      run(chunks.join(''));
    });
    return; // run() called asynchronously
  } else {
    console.error([
      'ERROR: No input provided.',
      '',
      'Usage:',
      '  node tools/extract-cruip-snippets.js --input <file.html>',
      '  curl -sL https://example.com | node tools/extract-cruip-snippets.js',
      '',
      'Run with --help for full options.',
    ].join('\n'));
    process.exit(1);
  }

  run(sourceHtml);
})();

function run(sourceHtml) {
  // ── 2. Extract sections ────────────────────────────────────────────────────
  if (VERBOSE) console.log('[INFO] Scanning for <section> elements…');
  const sections = extractSections(sourceHtml);

  if (sections.length === 0) {
    console.warn('[WARN] No <section> elements found in the provided HTML.');
    process.exit(0);
  }

  console.log(`\nFound ${sections.length} <section>(s)\n`);

  // ── 3. Ensure output directory ─────────────────────────────────────────────
  const absOutDir = path.resolve(OUT_DIR);
  if (!DRY_RUN && !fs.existsSync(absOutDir)) {
    fs.mkdirSync(absOutDir, { recursive: true });
    if (VERBOSE) console.log(`[INFO] Created output directory: ${absOutDir}`);
  }

  // ── 4. Determine start index ───────────────────────────────────────────────
  let idx = detectStartIndex(absOutDir, PREFIX);

  // ── 5. Process each section ────────────────────────────────────────────────
  const written = [];
  const skipped = [];

  for (const sec of sections) {
    const category = guessCategory(sec.outerHtml, sec.attrs);
    const name     = extractName(sec.outerHtml, sec.attrs, category, idx);
    const id       = `${PREFIX}-${String(idx).padStart(2, '0')}`;

    // Tags: category + any data-tags attr
    const extraTags = sec.attrs['data-tags']
      ? String(sec.attrs['data-tags']).split(',').map(t => t.trim()).filter(Boolean)
      : [];
    const tags = [...new Set([category, PREFIX, ...extraTags])];

    const snippet = {
      id,
      name,
      label:     name,            // alias for Visual Editor compatibility
      category,
      tags,
      thumbnail: '',              // populated manually or via screenshot pipeline
      html:      sec.outerHtml,
    };

    const filename = `${id}.json`;
    const filepath = path.join(absOutDir, filename);

    if (DRY_RUN) {
      console.log(`── [${id}]  category=${category}  name="${name}"`);
      if (VERBOSE) console.log(JSON.stringify(snippet, null, 2));
      written.push(id);
    } else if (fs.existsSync(filepath) && !OVERWRITE) {
      console.log(`  ⤳ SKIP  ${filename}  (already exists — use --overwrite to replace)`);
      skipped.push(id);
    } else {
      fs.writeFileSync(filepath, JSON.stringify(snippet, null, 2) + '\n', 'utf8');
      console.log(`  ✓ WROTE ${filename}  [${category}]  "${name}"`);
      written.push(id);
    }

    idx++;
  }

  // ── 6. Summary ─────────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────────────────────');
  if (DRY_RUN) {
    console.log(` DRY-RUN: ${written.length} snippet(s) would be written to ${absOutDir}`);
  } else {
    console.log(` Done: ${written.length} written, ${skipped.length} skipped`);
    console.log(` Output: ${absOutDir}`);
  }
  console.log('─────────────────────────────────────────────────────\n');
}
