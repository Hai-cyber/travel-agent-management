#!/usr/bin/env node
/**
 * scripts/syncAllSnippets.mjs
 *
 * Full-featured snippet extractor for all 20 Cruip templates.
 * Supersedes seed-snippets-from-templates.mjs.
 *
 * Features:
 *   1. Image Path Fix      — relative src → absolute R2 URL; Unsplash fallback by category.
 *   2. Deep Categories     — 24 categories incl. Hero-Video, Gallery-Grid, Booking-Form,
 *                            Travel-Itinerary, Map-Section.
 *   3. Hybrid multi-label  — snippet tagged with ALL matching categories.
 *   4. Hero padding        — Hero/Hero-Video snippets get padding-top:80px injected.
 *   5. contenteditable     — <h1-h3>, <p>, <a href> in snippets gain data-ve-text.
 *   6. Button link editor  — <a> buttons gain data-ve-btn for link+text editing.
 *   7. Manifest rebuild    — public/snippets/index.json updated.
 *
 * Usage:
 *   node scripts/syncAllSnippets.mjs [options]
 *
 * Options:
 *   --templates <dir>    Template root dir      (default: templates)
 *   --out       <dir>    Snippets output dir    (default: src/snippets)
 *   --manifest  <file>   Manifest file          (default: public/snippets/index.json)
 *   --r2-base   <url>    R2 public base URL     (default: https://pub-PLACEHOLDER.r2.dev)
 *   --max-per-cat <n>    Max snippets/category  (default: 5)
 *   --min-len <n>        Min section HTML len   (default: 300)
 *   --clear              Delete existing snippets before writing
 *   --dry-run            Print plan, write nothing
 *   --verbose            Per-section details
 *   --keep-nav           Include header/footer sections
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');

// ── CLI opts ──────────────────────────────────────────────────────────────────
const argv    = process.argv.slice(2);
const flag    = (n) => argv.includes(n);
const opt     = (n, d) => { const i = argv.indexOf(n); return i !== -1 && argv[i+1] ? argv[i+1] : d; };

const TMPL_ROOT   = resolve(ROOT, opt('--templates', 'templates'));
const OUT_DIR     = resolve(ROOT, opt('--out',       'src/snippets'));
const MANIFEST    = resolve(ROOT, opt('--manifest',  'public/snippets/index.json'));
const R2_BASE     = opt('--r2-base', 'https://pub-PLACEHOLDER.r2.dev');
const MAX_PER_CAT = parseInt(opt('--max-per-cat', '5'), 10);
const MIN_LEN     = parseInt(opt('--min-len',     '300'), 10);
const KEEP_NAV    = flag('--keep-nav');
const CLEAR       = flag('--clear');
const DRY_RUN     = flag('--dry-run');
const VERBOSE     = flag('--verbose');

// ── Deep categories ──────────────────────────────────────────────────────────
// Each rule matches html text; a snippet can match MULTIPLE rules (hybrid tagging).
// Order determines the PRIMARY category (first match).
const DEEP_CATS = [
  // ── New travel/specific categories (high priority) ────────────────────────
  { id: 'hero-video',        re: /\bvideo\b.*\bhero\b|\bhero\b.*\bvideo\b|<video\b|autoplay|youtube\.com|vimeo\.com/i,
    label: 'Hero — Video',    icon: '🎬', primary: true },
  { id: 'booking-form',      re: /book(ing)?\s*form|check.?in|check.?out|arrival|departure|num.*guest|date.*picker|datepicker|reserve/i,
    label: 'Booking Form',    icon: '📅', primary: true },
  { id: 'travel-itinerary',  re: /itinerary|day\s*\d|day-by-day|schedule|agenda|timeline.*tour|tour.*timeline/i,
    label: 'Travel Itinerary',icon: '🗺', primary: true },
  { id: 'map-section',       re: /google.*map|leaflet|mapbox|openstreet|<iframe[^>]+google\.com\/maps|lat.*lng|longitude|latitude/i,
    label: 'Map Section',     icon: '📍', primary: true },
  { id: 'gallery-grid',      re: /\bgallery\b.*grid|grid.*gallery|masonry|photo.*grid|grid.*photo|image.*grid|grid.*image/i,
    label: 'Gallery — Grid',  icon: '🖼', primary: true },

  // ── Core categories ────────────────────────────────────────────────────────
  { id: 'hero',              re: /\bhero\b|\bbanner\b|\bjumbotron\b/i,
    label: 'Hero',            icon: '🌟' },
  { id: 'features',          re: /\bfeatures?\b|\bbuilt.?for\b|\bcapabilit/i,
    label: 'Features',        icon: '⚡' },
  { id: 'testimonials',      re: /\btestimonial|\breview\b|\btrust\b|\bquote\b|\brating\b/i,
    label: 'Testimonials',    icon: '⭐' },
  { id: 'pricing',           re: /\bpric(ing|e)\b|\bplan\b|\bper.?month\b|\bsubscription\b/i,
    label: 'Pricing',         icon: '💰' },
  { id: 'faq',               re: /\bfaq\b|\baccordion\b|\bfrequently\b/i,
    label: 'FAQ',             icon: '❓' },
  { id: 'team',              re: /\bteam\b|\bpeople\b|\bstaff\b|\bour.?team\b/i,
    label: 'Team',            icon: '👥' },
  { id: 'stats',             re: /\bstats?\b|\bnumbers?\b|\bcounter\b|\bmetric/i,
    label: 'Stats',           icon: '📊' },
  { id: 'gallery',           re: /\bgallerr?(y|ies)\b|\bslider\b|\bcarousel\b/i,
    label: 'Gallery',         icon: '🖼' },
  { id: 'contact',           re: /\bcontact\b|<form\b|<input\b|<textarea\b|\bsubmit\b/i,
    label: 'Contact',         icon: '📬' },
  { id: 'cta',               re: /\bcta\b|\bcall.?to.?action\b|\bget.?start\b|\bjoin\b/i,
    label: 'CTA',             icon: '🚀' },
  { id: 'logos',             re: /\blogos?\b|\bbrands?\b|\bpartners?\b|\bclients?\b|\blogo.?cloud\b/i,
    label: 'Logo Cloud',      icon: '🏷' },
  { id: 'blog',              re: /\bblog\b|\bpost(s)?\b|\barticle/i,
    label: 'Blog',            icon: '📝' },
  { id: 'steps',             re: /\bsteps?\b|\bhow.?it.?works?\b|\bprocess\b|\bworkflow\b/i,
    label: 'Steps',           icon: '🔄' },
  { id: 'newsletter',        re: /\bnewsletter\b|\bsubscribe\b|\bstay\s+up\b/i,
    label: 'Newsletter',      icon: '✉️' },
  { id: 'integrations',      re: /\bintegrations?\b|\bconnects?\b|\bplugin\b/i,
    label: 'Integrations',    icon: '🔌' },
  { id: 'about',             re: /\babout\b|\bour.?story\b|\bwho.?we.?are\b/i,
    label: 'About',           icon: 'ℹ️' },
  { id: 'section',           re: /.*/,
    label: 'Section',         icon: '▦' },  // catch-all always last
];

const SKIP_CATS = KEEP_NAV ? new Set() : new Set(['header', 'footer',
  'nav', 'navbar']);

// ── Unsplash fallback images keyed to snippet category ───────────────────────
// 1600×900 images, q=70 — good quality, cached by Unsplash CDN
const UNSPLASH_BY_CAT = {
  'hero':              'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=1600&q=70',
  'hero-video':        'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1600&q=70',
  'gallery':           'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=1600&q=70',
  'gallery-grid':      'https://images.unsplash.com/photo-1530521954074-e64f6810b32d?w=1600&q=70',
  'features':          'https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=1600&q=70',
  'testimonials':      'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=1600&q=70',
  'pricing':           'https://images.unsplash.com/photo-1579621970563-ebec7560ff3e?w=1600&q=70',
  'team':              'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1600&q=70',
  'contact':           'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=1600&q=70',
  'booking-form':      'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=1600&q=70',
  'travel-itinerary':  'https://images.unsplash.com/photo-1507608616759-54f48f0af0ee?w=1600&q=70',
  'map-section':       'https://images.unsplash.com/photo-1524661135-423995f22d0b?w=1600&q=70',
  'cta':               'https://images.unsplash.com/photo-1426604966848-d7adac402bff?w=1600&q=70',
  'blog':              'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=1600&q=70',
  'stats':             'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1600&q=70',
  'logos':             'https://images.unsplash.com/photo-1497366754035-f200968a6e72?w=1600&q=70',
  'faq':               'https://images.unsplash.com/photo-1516321497487-e288fb19713f?w=1600&q=70',
  'steps':             'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=1600&q=70',
  'newsletter':        'https://images.unsplash.com/photo-1432821596592-e2c18b78144f?w=1600&q=70',
  'about':             'https://images.unsplash.com/photo-1506197061069-4f5e4e8e7c3f?w=1600&q=70',
  'integrations':      'https://images.unsplash.com/photo-1558346490-a72e53ae2d4f?w=1600&q=70',
};
const UNSPLASH_FALLBACK = 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=1600&q=70';

function unsplashFor(primaryCat) {
  return UNSPLASH_BY_CAT[primaryCat] || UNSPLASH_FALLBACK;
}

// ── Image path rewriting ──────────────────────────────────────────────────────
/**
 * Convert every relative image/video/poster src in `html` to an absolute R2 URL.
 * Absolute paths (http/https/data/blob//) are left untouched.
 * Empty or missing src attributes are replaced with an Unsplash fallback.
 *
 * @param {string} html         - raw section HTML
 * @param {string} templateSlug - e.g. "open-pro-html"
 * @param {string} primaryCat   - used to pick thematic Unsplash fallback
 */
function fixImagePaths(html, templateSlug, primaryCat) {
  const base = `${R2_BASE}/${templateSlug}/`;

  // 1. <img src="relative/path"> or <img src="">  → absolute or Unsplash
  html = html.replace(
    /(<img\b[^>]*?\s)(src)(=)(["']?)([^"'>\s]*)\4/gi,
    (match, pre, attr, eq, q, rawSrc) => {
      const src = rawSrc.trim();
      if (!src) {
        // Empty src → Unsplash fallback
        return `${pre}src=${q}${unsplashFor(primaryCat)}${q}`;
      }
      if (/^(https?:|data:|blob:|\/\/)/.test(src)) return match; // already absolute
      if (src.startsWith('/')) return match;                      // root-relative — keep (server-side proxy handles it)
      return `${pre}${attr}${eq}${q}${base}${src}${q}`;
    }
  );

  // 2. <img data-src="relative"> (lazy-load patterns)
  html = html.replace(
    /(<img\b[^>]*?\s)(data-src)(=)(["']?)([^"'>\s]*)\4/gi,
    (match, pre, attr, eq, q, rawSrc) => {
      const src = rawSrc.trim();
      if (!src || /^(https?:|data:|blob:|\/\/)/.test(src) || src.startsWith('/')) return match;
      return `${pre}${attr}${eq}${q}${base}${src}${q}`;
    }
  );

  // 3. background-image: url("relative") in style attributes
  html = html.replace(
    /url\(\s*(["']?)([^"'()\s]+)\1\s*\)/gi,
    (match, q, rawPath) => {
      const p = rawPath.trim();
      if (!p || /^(https?:|data:|blob:|\/\/)/.test(p) || p.startsWith('/')) return match;
      return `url(${q}${base}${p}${q})`;
    }
  );

  // 4. <video src / poster>
  html = html.replace(
    /(<(?:video|source)\b[^>]*?\s)(src|poster)(=)(["']?)([^"'>\s]*)\4/gi,
    (match, pre, attr, eq, q, rawSrc) => {
      const src = rawSrc.trim();
      if (!src || /^(https?:|data:|blob:|\/\/)/.test(src) || src.startsWith('/')) return match;
      return `${pre}${attr}${eq}${q}${base}${src}${q}`;
    }
  );

  return html;
}

// ── Hero padding injection ────────────────────────────────────────────────────
/**
 * If the section is a Hero or Hero-Video, inject padding-top:80px so it clears
 * the fixed/sticky site header. Uses data-ve-hero-padded to avoid double-applying.
 */
function injectHeroPadding(html, categories) {
  if (!categories.includes('hero') && !categories.includes('hero-video')) return html;
  if (html.includes('data-ve-hero-padded')) return html;
  // Inject into the opening <section> tag's style attribute if it exists, else add one.
  return html.replace(
    /^(<section\b[^>]*?)>/i,
    (match, openTag) => {
      const styleMatch = openTag.match(/\bstyle="([^"]*)"/i);
      if (styleMatch) {
        const existing = styleMatch[1];
        if (/padding-top/.test(existing)) return match; // already has padding
        return openTag.replace(
          /\bstyle="([^"]*)"/i,
          `style="${existing.trimEnd().replace(/;$/, '')}; padding-top:80px"`
        ) + ' data-ve-hero-padded="1">';
      }
      return `${openTag} style="padding-top:80px" data-ve-hero-padded="1">`;
    }
  );
}

// ── contenteditable + data-ve-text on headings / paragraphs ──────────────────
/**
 * Mark editable text nodes with data-ve-text so editor-bridge.js knows to
 * activate inline editing on them.
 * Headings: <h1>–<h3>
 * Paragraphs: <p>
 * Buttons/links: <a> gains data-ve-btn for text+link editing
 */
function injectEditableMarkers(html) {
  // Headings
  html = html.replace(
    /<(h[1-3])(\b[^>]*)>/gi,
    (m, tag, attrs) => {
      if (/data-ve-text/.test(attrs)) return m;
      return `<${tag}${attrs} data-ve-text="1">`;
    }
  );

  // Paragraphs (but not inside <head> or <script>)
  html = html.replace(
    /<(p)(\b[^>]*)>/gi,
    (m, tag, attrs) => {
      if (/data-ve-text/.test(attrs)) return m;
      return `<${tag}${attrs} data-ve-text="1">`;
    }
  );

  // Buttons / CTAs — anchor tags that look like buttons (have class btn/button,
  // or contain "btn" in class, or are direct CTA links)
  html = html.replace(
    /<(a)(\b[^>]*\bhref=["'][^"']*["'][^>]*)>/gi,
    (m, tag, attrs) => {
      if (/data-ve-btn|data-ve-text/.test(attrs)) return m;
      // Mark all <a> tags for link editing; editor-bridge decides on click
      return `<${tag}${attrs} data-ve-btn="1">`;
    }
  );

  return html;
}

// ── Section extractor (depth-aware, handles nested <section>) ────────────────
function extractSections(html) {
  const sections = [];
  let pos = 0;
  while (pos < html.length) {
    const tagStart = html.indexOf('<section', pos);
    if (tagStart === -1) break;
    const peek = html[tagStart + 8];
    if (peek !== '>' && peek !== ' ' && peek !== '\n' && peek !== '\t' && peek !== '\r') {
      pos = tagStart + 8; continue;
    }
    const tagEnd = html.indexOf('>', tagStart);
    if (tagEnd === -1) break;
    let depth = 1, cur = tagEnd + 1, closeEnd = -1;
    while (depth > 0 && cur < html.length) {
      const nextOpen  = html.indexOf('<section', cur);
      const nextClose = html.indexOf('</section>', cur);
      if (nextClose === -1) { cur = html.length; break; }
      let realOpen = nextOpen !== -1;
      if (realOpen) {
        const c2 = html[nextOpen + 8];
        realOpen = c2 === '>' || c2 === ' ' || c2 === '\n' || c2 === '\t' || c2 === '\r';
      }
      if (realOpen && nextOpen < nextClose) {
        depth++; cur = nextOpen + 8;
      } else {
        depth--;
        if (depth === 0) {
          closeEnd = nextClose + 10;
          sections.push({ html: html.slice(tagStart, closeEnd), start: tagStart });
          pos = closeEnd; break;
        }
        cur = nextClose + 10;
      }
    }
    if (closeEnd === -1) pos = tagEnd + 1;
  }
  return sections;
}

// ── Multi-label category detection ───────────────────────────────────────────
/**
 * Returns an ordered array of ALL matching category IDs.
 * First element is the PRIMARY category (used for file naming, icon, Unsplash).
 */
function detectCategories(html) {
  const matches = [];
  for (const cat of DEEP_CATS) {
    if (cat.re.test(html)) {
      matches.push(cat.id);
      if (cat.id === 'section') break; // catch-all only added once, always last
    }
  }
  return matches.length ? matches : ['section'];
}

// Skip header / footer / nav sections by id/class/role attributes
const SKIP_ATTR_RE = /\b(header|footer|navbar?|site-header|site-footer)\b/i;
function isNavSection(html) {
  const tagEnd = html.indexOf('>');
  if (tagEnd === -1) return false;
  const opening = html.slice(0, tagEnd);
  return SKIP_ATTR_RE.test(opening);
}

// ── Structural richness score (for ranking candidates) ───────────────────────
function richness(html) {
  // Count unique Tailwind class tokens (more = richer visual design)
  const classes = (html.match(/class="([^"]+)"/g) || [])
    .flatMap(c => c.replace(/class="|"/g, '').split(/\s+/))
    .filter(Boolean);
  return new Set(classes).size;
}

// ── Heading label extraction ──────────────────────────────────────────────────
function headingLabel(html) {
  const m = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
  if (!m) return '';
  return m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 70);
}

function templateHumanLabel(slug) {
  return slug.replace(/-html$/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Thumbnail from section's own image ───────────────────────────────────────
/**
 * Use the first <img> in the section as thumbnail if it's already absolute.
 * Otherwise return empty string (caller will use Unsplash).
 */
function sectionThumbnail(html, templateSlug) {
  const m = html.match(/<img\b[^>]+\bsrc=(["']?)([^"'>\s]+)\1/i);
  if (!m) return '';
  const src = m[2].trim();
  if (/^https?:/.test(src)) return src + '&w=480&q=60'; // already absolute
  if (src.startsWith('/') || src.startsWith(R2_BASE)) return '';
  // Relative — build R2 URL
  return `${R2_BASE}/${templateSlug}/${src}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════
(async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('  syncAllSnippets.mjs — Cruip Deep Snippet Extractor');
  console.log(`  Templates : ${relative(ROOT, TMPL_ROOT)}`);
  console.log(`  Output    : ${relative(ROOT, OUT_DIR)}`);
  console.log(`  Manifest  : ${relative(ROOT, MANIFEST)}`);
  console.log(`  R2 base   : ${R2_BASE}`);
  console.log(`  Max/cat   : ${MAX_PER_CAT}   Min HTML len : ${MIN_LEN}`);
  console.log(`  Dry-run   : ${DRY_RUN}   Clear first : ${CLEAR}`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // ── 1. Discover template dirs ──────────────────────────────────────────────
  const tmplDirs = readdirSync(TMPL_ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.endsWith('-html'))
    .map(d => ({ slug: d.name, dir: join(TMPL_ROOT, d.name) }))
    .filter(({ dir }) => existsSync(join(dir, 'index.html')));

  if (!tmplDirs.length) {
    console.error('ERROR: No *-html folders with index.html found at', TMPL_ROOT);
    process.exit(1);
  }
  console.log(`Templates found: ${tmplDirs.length}`);
  tmplDirs.forEach(t => console.log(`  • ${t.slug}`));
  console.log();

  // ── 2. Extract + annotate all sections ────────────────────────────────────
  // bucket: Map<primaryCat, candidate[]>
  const bucket = new Map();
  let totalRaw = 0, skippedShort = 0, skippedNav = 0;

  for (const { slug, dir } of tmplDirs) {
    const source    = readFileSync(join(dir, 'index.html'), 'utf8');
    const sections  = extractSections(source);
    const tmplLabel = templateHumanLabel(slug);

    VERBOSE && console.log(`  ${slug}: ${sections.length} raw sections`);

    for (const sec of sections) {
      totalRaw++;
      if (sec.html.length < MIN_LEN) { skippedShort++; continue; }

      // Detect if this is a nav/footer block
      if (!KEEP_NAV && isNavSection(sec.html)) { skippedNav++; continue; }

      const categories  = detectCategories(sec.html);
      const primaryCat  = categories[0];

      // Skip nav/footer by category name
      if (!KEEP_NAV && SKIP_CATS.has(primaryCat)) { skippedNav++; continue; }

      const heading = headingLabel(sec.html);
      const score   = richness(sec.html);

      const entry = {
        slug,
        tmplLabel,
        categories,
        primaryCat,
        heading,
        score,
        rawHtml: sec.html,
      };

      // Register under ALL matched categories (hybrid tagging)
      for (const cat of categories) {
        if (!bucket.has(cat)) bucket.set(cat, []);
        bucket.get(cat).push(entry);
      }
    }
  }

  console.log(`Raw sections    : ${totalRaw}`);
  console.log(`Too short       : ${skippedShort}`);
  console.log(`Nav/footer skip : ${skippedNav}`);
  const validCount = [...bucket.values()].reduce((a, v) => a + new Set(v.map(e => e.rawHtml)).size, 0);
  console.log(`Candidate slots : ${validCount}  (with multi-label duplication)`);
  console.log(`Categories hit  : ${[...bucket.keys()].join(', ')}\n`);

  // ── 3. Select best MAX_PER_CAT per category ────────────────────────────────
  const selected = [];   // { id, name, label, category, tags, icon, thumbnail, html }
  const writtenIds = new Set();

  for (const [cat, candidates] of [...bucket.entries()]) {
    // Sort by richness desc — more complex layouts preferred
    const ranked    = [...candidates].sort((a, b) => b.score - a.score);
    const chosen    = [];
    const usedSlugs = new Set();

    // Pass 1: diversity — one per template
    for (const c of ranked) {
      if (chosen.length >= MAX_PER_CAT) break;
      if (!usedSlugs.has(c.slug)) { chosen.push(c); usedSlugs.add(c.slug); }
    }
    // Pass 2: fill remaining slots from any template
    for (const c of ranked) {
      if (chosen.length >= MAX_PER_CAT) break;
      if (!chosen.includes(c)) chosen.push(c);
    }

    const catMeta = DEEP_CATS.find(d => d.id === cat) || { label: cat, icon: '▦' };

    chosen.forEach((c, i) => {
      const idx     = String(i + 1).padStart(2, '0');
      const tmplKey = c.slug.replace(/-html$/, '');
      const id      = `${tmplKey}-${cat}-${idx}`;
      if (writtenIds.has(id)) return;
      writtenIds.add(id);

      const displayLabel = c.heading
        ? `${c.tmplLabel} — ${c.heading.slice(0, 50)}`
        : `${c.tmplLabel} — ${catMeta.label} ${idx}`;

      // Build processed HTML:
      //  a) Fix image paths to absolute R2 URLs
      let html = fixImagePaths(c.rawHtml, c.slug, c.primaryCat);
      //  b) Inject hero padding for Hero/* sections
      html = injectHeroPadding(html, c.categories);
      //  c) Mark headings/paragraphs/buttons as editable
      html = injectEditableMarkers(html);

      // Thumbnail: try section's own first image, else Unsplash
      const thumb = sectionThumbnail(html, c.slug) || unsplashFor(c.primaryCat);

      selected.push({
        id,
        name:      displayLabel,
        label:     displayLabel,
        category:  cat,             // primary category (for sidebar grouping)
        categories: c.categories,   // all matching categories (for search/filter)
        tags:      [...new Set([...c.categories, tmplKey, 'cruip'])],
        icon:      catMeta.icon,
        thumbnail: thumb,
        html,
      });
    });
  }

  console.log(`Selected: ${selected.length} snippets`);
  const catCounts = {};
  selected.forEach(s => { catCounts[s.category] = (catCounts[s.category] || 0) + 1; });
  for (const [cat, n] of Object.entries(catCounts).sort()) {
    const meta = DEEP_CATS.find(d => d.id === cat);
    console.log(`  ${(meta?.icon || ' ')} ${cat.padEnd(20)} ${n}`);
  }
  console.log();

  if (DRY_RUN) {
    console.log('[DRY-RUN] No files written.\n');
    return;
  }

  // ── 4. Write snippet JSON files ────────────────────────────────────────────
  mkdirSync(OUT_DIR, { recursive: true });

  if (CLEAR) {
    const existing = readdirSync(OUT_DIR).filter(f => f.endsWith('.json'));
    existing.forEach(f => unlinkSync(join(OUT_DIR, f)));
    console.log(`Cleared ${existing.length} existing snippet files.`);
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
    VERBOSE && console.log(`  ✓ ${snip.id}.json  [${snip.category}]  "${snip.label}"`);
    written++;
  }
  if (!VERBOSE) console.log(`Written: ${written}  Skipped (exists): ${skippedExist}`);

  // ── 5. Rebuild public/snippets/index.json ─────────────────────────────────
  const allFiles = readdirSync(OUT_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => JSON.parse(readFileSync(join(OUT_DIR, f), 'utf8')));

  mkdirSync(join(MANIFEST, '..'), { recursive: true });
  writeFileSync(MANIFEST, JSON.stringify(allFiles, null, 2) + '\n', 'utf8');

  console.log(`\n─────────────────────────────────────────────────────────────`);
  console.log(` ✓  Written  : ${written} snippets  (${skippedExist} skipped — already exist)`);
  console.log(` ✓  Manifest : ${relative(ROOT, MANIFEST)}  (${allFiles.length} total)`);
  console.log(`─────────────────────────────────────────────────────────────\n`);
  console.log('Tip: run with --clear to regenerate all from scratch.');
  console.log(`Tip: pass --r2-base https://pub-<id>.r2.dev for production R2 URLs.\n`);
})();
