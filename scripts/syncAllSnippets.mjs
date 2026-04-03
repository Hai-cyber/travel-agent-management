#!/usr/bin/env node
/**
 * Deep crawl snippet extractor for Cruip templates.
 *
 * Goals:
 *   1. Crawl more than top-level <section> blocks.
 *   2. Extract reusable micro components (buttons, forms, cards, icon boxes).
 *   3. Strip runtime-only behavior (scripts, Alpine attrs, demo glue).
 *   4. Rewrite every asset URL to the local template-asset proxy or a public R2 base.
 *   5. Ensure snippets are immediately editable inside Site Studio.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback) => {
  const index = argv.indexOf(name);
  return index !== -1 && argv[index + 1] ? argv[index + 1] : fallback;
};

const TMPL_ROOT = resolve(ROOT, opt('--templates', 'templates'));
const OUT_DIR = resolve(ROOT, opt('--out', 'src/snippets'));
const MANIFEST = resolve(ROOT, opt('--manifest', 'public/snippets/index.json'));
const R2_BASE = opt('--r2-base', '/api/tenant/template-assets');
const MAX_PER_CAT = Number.parseInt(opt('--max-per-cat', '12'), 10);
const MIN_LEN = Number.parseInt(opt('--min-len', '120'), 10);
const CLEAR = flag('--clear');
const DRY_RUN = flag('--dry-run');
const VERBOSE = flag('--verbose');
const KEEP_NAV = flag('--keep-nav');

const CATEGORY_RULES = [
  { id: 'hero', re: /<h1\b|\bhero\b|\bbanner\b|\bjumbotron\b/i, label: 'Hero', icon: '[hero]' },
  { id: 'booking-form', re: /booking|check.?in|check.?out|travel date|arrival|departure|guest|traveler/i, label: 'Booking Form', icon: '[book]' },
  { id: 'travel-itinerary', re: /itinerary|day\s*\d|timeline|schedule|agenda/i, label: 'Travel Itinerary', icon: '[route]' },
  { id: 'map-section', re: /google.*map|mapbox|leaflet|latitude|longitude|<iframe[^>]+maps/i, label: 'Map Section', icon: '[map]' },
  { id: 'gallery-grid', re: /grid-cols-[1234]|masonry|gallery|photo grid|image grid/i, label: 'Gallery Grid', icon: '[gallery]' },
  { id: 'buttons', re: /<(a|button)\b[^>]*(btn|button|rounded-full|rounded-md|rounded-lg|inline-flex)/i, label: 'Buttons', icon: '[btn]' },
  { id: 'forms', re: /<form\b|<input\b|<select\b|<textarea\b/i, label: 'Forms', icon: '[form]' },
  { id: 'input-groups', re: /<input\b[\s\S]*<(a|button)\b|<(a|button)\b[\s\S]*<input\b|input-group/i, label: 'Input Groups', icon: '[input]' },
  { id: 'icon-boxes', re: /<(svg|img)\b[\s\S]*<h[2-6]\b|<(svg|img)\b[\s\S]*<p\b/i, label: 'Icon Boxes', icon: '[icon]' },
  { id: 'grid-cards', re: /grid-cols-[1234]|<article\b|shadow|rounded-[a-z0-9-]*|border[^>]+p-[0-9]/i, label: 'Grid / Cards', icon: '[grid]' },
  { id: 'features', re: /feature|capabilit|why choose|benefit/i, label: 'Features', icon: '[feat]' },
  { id: 'testimonials', re: /testimonial|review|quote|rating|trust/i, label: 'Testimonials', icon: '[star]' },
  { id: 'pricing', re: /pricing|plan|subscription|per month|price/i, label: 'Pricing', icon: '[money]' },
  { id: 'faq', re: /faq|accordion|frequently asked/i, label: 'FAQ', icon: '[faq]' },
  { id: 'stats', re: /stats?|numbers?|metrics?|counter/i, label: 'Stats', icon: '[stats]' },
  { id: 'logos', re: /logo|partners?|clients?|brands?/i, label: 'Logos', icon: '[logo]' },
  { id: 'team', re: /team|staff|people|our team/i, label: 'Team', icon: '[team]' },
  { id: 'blog', re: /blog|post|article/i, label: 'Blog', icon: '[blog]' },
  { id: 'newsletter', re: /newsletter|subscribe|stay updated/i, label: 'Newsletter', icon: '[mail]' },
  { id: 'cta', re: /call to action|get started|join now|book now|contact us/i, label: 'CTA', icon: '[cta]' },
  { id: 'about', re: /about us|our story|who we are/i, label: 'About', icon: '[about]' },
  { id: 'section', re: /.*/, label: 'Section', icon: '[sec]' },
];

const VISUAL_IMAGE_CATS = new Set([
  'hero',
  'gallery-grid',
  'grid-cards',
  'features',
  'cta',
  'blog',
  'about',
  'team',
  'travel-itinerary',
  'booking-form',
]);

const UNSPLASH_BY_CAT = {
  hero: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=1600&q=80&fit=crop',
  'booking-form': 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1600&q=80&fit=crop',
  'travel-itinerary': 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=1600&q=80&fit=crop',
  'map-section': 'https://images.unsplash.com/photo-1526778548025-fa2f459cd5c1?w=1600&q=80&fit=crop',
  'gallery-grid': 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=1600&q=80&fit=crop',
  'grid-cards': 'https://images.unsplash.com/photo-1488085061387-422e29b40080?w=1600&q=80&fit=crop',
  features: 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=1600&q=80&fit=crop',
  testimonials: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1600&q=80&fit=crop',
  pricing: 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=1600&q=80&fit=crop',
  team: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=1600&q=80&fit=crop',
  blog: 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=1600&q=80&fit=crop',
  cta: 'https://images.unsplash.com/photo-1493558103817-58b2924bce98?w=1600&q=80&fit=crop',
  about: 'https://images.unsplash.com/photo-1503220317375-aaad61436b1b?w=1600&q=80&fit=crop',
};
const UNSPLASH_FALLBACK = 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1600&q=80&fit=crop';

const BLOCK_TAGS = ['section', 'div', 'article', 'aside', 'form', 'ul', 'ol'];
const COMPONENT_TAGS = ['a', 'button', 'form', 'article', 'li'];
const WRAP_COMPONENT_KINDS = new Set(['button', 'form', 'input-group', 'icon-box', 'card', 'micro-block']);

function unsplashFor(category) {
  return UNSPLASH_BY_CAT[category] || UNSPLASH_FALLBACK;
}

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function textOnly(html) {
  return normalizeWhitespace(html.replace(/<[^>]+>/g, ' '));
}

function templateHumanLabel(slug) {
  return slug.replace(/-html$/, '').replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function headingLabel(html) {
  const match = html.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
  return match ? textOnly(match[1]).slice(0, 72) : '';
}

function shortDescription(html) {
  const match = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  if (match) return textOnly(match[1]).slice(0, 140);
  return textOnly(html).slice(0, 140);
}

function richness(html) {
  const classMatches = [...html.matchAll(/class=(['"])(.*?)\1/gi)];
  const tokens = classMatches.flatMap((match) => match[2].split(/\s+/)).filter(Boolean);
  const unique = new Set(tokens);
  const headings = (html.match(/<h[1-6]\b/gi) || []).length;
  const images = (html.match(/<(img|svg)\b/gi) || []).length;
  const ctas = (html.match(/<(a|button)\b/gi) || []).length;
  return unique.size + headings * 4 + images * 3 + ctas * 2;
}

function clipBlock(html, maxLen = 28000) {
  return html.length > maxLen ? html.slice(0, maxLen) : html;
}

function stripCommentsAndScripts(html) {
  return html
    .replace(/<!--([\s\S]*?)-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '');
}

function stripBehavioralAttributes(html) {
  return html
    .replace(/\s(?:x-[^\s=]+|@[^\s=]+|:[^\s=]+|v-[^\s=]+|data-aos(?:-[^\s=]+)?|x-cloak)(?:=(['"])[\s\S]*?\1|=[^\s>]+)?/gi, '')
    .replace(/\s(?:aria-expanded|aria-controls|role)(?:=(['"])[\s\S]*?\1|=[^\s>]+)?/gi, '');
}

function sanitizeLinkTargets(html) {
  return html.replace(/href=(['"])#0\1/gi, 'href="#"');
}

function cleanSnippetHtml(html) {
  return sanitizeLinkTargets(stripBehavioralAttributes(stripCommentsAndScripts(html))).trim();
}

function assetUrl(templateSlug, rawPath) {
  const cleaned = String(rawPath ?? '').trim();
  if (!cleaned) return '';
  if (/^(https?:|data:|blob:|\/\/)/i.test(cleaned)) return cleaned;
  if (cleaned.startsWith('#')) return cleaned;
  const rel = cleaned.replace(/^\.\//, '').replace(/^\//, '');
  return `${R2_BASE.replace(/\/$/, '')}/${templateSlug}/${rel}`;
}

function rewriteSrcset(srcset, templateSlug) {
  return srcset
    .split(',')
    .map((entry) => {
      const parts = entry.trim().split(/\s+/);
      if (!parts[0]) return '';
      parts[0] = assetUrl(templateSlug, parts[0]);
      return parts.join(' ');
    })
    .filter(Boolean)
    .join(', ');
}

function fixAssetPaths(html, templateSlug, category) {
  let out = html;

  out = out.replace(/(<(?:img|source|video)\b[^>]*?\s)(src|poster)=(['"])(.*?)\3/gi, (match, prefix, attr, quote, raw) => {
    const next = assetUrl(templateSlug, raw) || unsplashFor(category);
    return `${prefix}${attr}=${quote}${next}${quote}`;
  });

  out = out.replace(/(<img\b[^>]*?\s)data-src=(['"])(.*?)\2/gi, (match, prefix, quote, raw) => {
    return `${prefix}data-src=${quote}${assetUrl(templateSlug, raw)}${quote}`;
  });

  out = out.replace(/\ssrcset=(['"])(.*?)\1/gi, (match, quote, raw) => {
    return ` srcset=${quote}${rewriteSrcset(raw, templateSlug)}${quote}`;
  });

  out = out.replace(/url\((['"]?)([^'"()\s]+)\1\)/gi, (match, quote, raw) => {
    const next = assetUrl(templateSlug, raw);
    return next ? `url(${quote}${next}${quote})` : match;
  });

  out = out.replace(/<(use|image)\b([^>]*?)\s(href|xlink:href)=(['"])(.*?)\4/gi, (match, tag, before, attr, quote, raw) => {
    return `<${tag}${before} ${attr}=${quote}${assetUrl(templateSlug, raw)}${quote}`;
  });

  if (!/(<img\b|background-image\s*:|url\(|<image\b)/i.test(out) && VISUAL_IMAGE_CATS.has(category)) {
    const injected = `<img src="${unsplashFor(category)}" alt="Travel visual" class="w-full h-72 object-cover rounded-3xl mb-8" data-ve-img="1">`;
    if (/^<section\b/i.test(out)) {
      out = out.replace(/^(<section\b[^>]*>)/i, `$1\n  <div class="max-w-6xl mx-auto px-4 sm:px-6">${injected}</div>`);
    } else {
      out = `${injected}\n${out}`;
    }
  }

  return out;
}

function injectHeroPadding(html, categories) {
  if (!categories.includes('hero')) return html;
  if (html.includes('data-ve-hero-padded')) return html;
  return html.replace(/^(<section\b[^>]*?)(>)/i, (match, start, end) => {
    const styleMatch = start.match(/\bstyle=(['"])(.*?)\1/i);
    if (styleMatch) {
      const styleValue = styleMatch[2].replace(/;?\s*$/, '; padding-top: 96px');
      return start.replace(/\bstyle=(['"])(.*?)\1/i, `style="${styleValue}"`) + ' data-ve-hero-padded="1"' + end;
    }
    return `${start} style="padding-top: 96px" data-ve-hero-padded="1"${end}`;
  });
}

function injectEditableMarkers(html) {
  let out = html;
  out = out.replace(/<(h[1-6]|p|span|li|label|small|strong|em)(\b[^>]*)>/gi, (match, tag, attrs) => {
    if (/data-ve-text/.test(attrs)) return match;
    return `<${tag}${attrs} data-ve-text="1">`;
  });
  out = out.replace(/<(a|button)(\b[^>]*)>/gi, (match, tag, attrs) => {
    if (/data-ve-btn/.test(attrs)) return match;
    const extra = /data-ve-text/.test(attrs) ? '' : ' data-ve-text="1"';
    return `<${tag}${attrs}${extra} data-ve-btn="1">`;
  });
  out = out.replace(/<(input)(\b[^>]*?)(\s*\/?)>/gi, (match, tag, attrs, selfClose) => {
    if (/data-ve-input/.test(attrs)) return match;
    return `<${tag}${attrs} data-ve-input="1"${selfClose}>`;
  });
  out = out.replace(/<(select|textarea)(\b[^>]*)>/gi, (match, tag, attrs) => {
    if (/data-ve-input/.test(attrs)) return match;
    return `<${tag}${attrs} data-ve-input="1">`;
  });
  out = out.replace(/<img(\b[^>]*?)(\s*\/?)>/gi, (match, attrs, selfClose) => {
    if (/data-ve-img/.test(attrs)) return match;
    return `<img${attrs} data-ve-img="1"${selfClose}>`;
  });
  return out;
}

function wrapStandaloneBlock(html, kind) {
  if (/^<section\b/i.test(html)) return html;
  if (!WRAP_COMPONENT_KINDS.has(kind)) return html;
  return [
    '<section class="py-12 md:py-20">',
    '  <div class="max-w-6xl mx-auto px-4 sm:px-6">',
    html,
    '  </div>',
    '</section>',
  ].join('\n');
}

function sectionThumbnail(html, category) {
  const imgMatch = html.match(/<img\b[^>]*\ssrc=(['"])(.*?)\1/i);
  if (imgMatch) return imgMatch[2];
  const bgMatch = html.match(/url\((['"]?)(https?:[^)'"\s]+)\1\)/i);
  if (bgMatch) return bgMatch[2];
  return unsplashFor(category);
}

function detectCategories(html, meta = {}) {
  const matches = [];
  const source = `${meta.kind || ''} ${html}`;
  const topBoost = meta.order <= 2 && /<h1\b/i.test(html);
  for (const rule of CATEGORY_RULES) {
    if (rule.id === 'hero' && topBoost) {
      matches.push(rule.id);
      continue;
    }
    if (rule.re.test(source)) matches.push(rule.id);
  }
  if (meta.kind === 'button' && !matches.includes('buttons')) matches.unshift('buttons');
  if (meta.kind === 'form' && !matches.includes('forms')) matches.unshift('forms');
  if (meta.kind === 'input-group' && !matches.includes('input-groups')) matches.unshift('input-groups');
  if (meta.kind === 'icon-box' && !matches.includes('icon-boxes')) matches.unshift('icon-boxes');
  if (meta.kind === 'card' && !matches.includes('grid-cards')) matches.unshift('grid-cards');
  return [...new Set(matches.length ? matches : ['section'])];
}

function isNavLike(html) {
  return /<(header|footer|nav)\b/i.test(html) || /\b(site-header|site-footer|navbar|navigation)\b/i.test(html);
}

function findMatchingTag(html, tagName, fromIndex) {
  const openRe = new RegExp(`<${tagName}\\b`, 'gi');
  const closeRe = new RegExp(`</${tagName}>`, 'gi');
  openRe.lastIndex = fromIndex;
  closeRe.lastIndex = fromIndex;
  let depth = 1;
  while (depth > 0) {
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    if (!nextClose) return -1;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      continue;
    }
    depth -= 1;
    if (depth === 0) return nextClose.index + nextClose[0].length;
  }
  return -1;
}

function extractTagBlocks(html, tagNames) {
  const blocks = [];
  const re = new RegExp(`<(${tagNames.join('|')})\\b[^>]*>`, 'gi');
  let match;
  while ((match = re.exec(html))) {
    const tagName = match[1].toLowerCase();
    const start = match.index;
    const end = findMatchingTag(html, tagName, re.lastIndex);
    if (end === -1) continue;
    blocks.push({ tagName, start, end, html: html.slice(start, end) });
    re.lastIndex = start + 1;
  }
  return blocks;
}

function classValue(html) {
  const match = html.match(/class=(['"])(.*?)\1/i);
  return match ? match[2] : '';
}

function likelyIndependentBlock(block, order) {
  const classes = classValue(block.html);
  const html = block.html;
  const score = [
    /\bpy-(10|12|16|20|24|28|32)\b/.test(classes),
    /\brelative\b/.test(classes),
    /\bgrid\b|grid-cols-/.test(classes),
    /\brounded\b|\bshadow\b|\bborder\b/.test(classes),
    /<(h[1-6]|img|svg|form|button|a)\b/i.test(html),
    order <= 3 && /<h1\b/i.test(html),
  ].filter(Boolean).length;
  return score >= 2 && html.length >= MIN_LEN;
}

function looksLikeButton(html) {
  return /^(<(a|button)\b)/i.test(html) && /class=(['"])(.*?)\3/i.test(html);
}

function looksLikeInputGroup(html) {
  return /<input\b/i.test(html) && /<(a|button)\b/i.test(html);
}

function looksLikeForm(html) {
  return /<form\b/i.test(html) || ((html.match(/<(input|select|textarea)\b/gi) || []).length >= 2);
}

function looksLikeIconBox(html) {
  return /<(svg|img)\b/i.test(html) && /<(h[2-6]|p)\b/i.test(html) && html.length <= 5000;
}

function looksLikeCard(html) {
  return (/\bshadow\b|\brounded\b|\bborder\b/.test(classValue(html)) || /<article\b/i.test(html)) && /<(h[2-6]|img|p)\b/i.test(html);
}

function fingerprint(html) {
  return normalizeWhitespace(html).slice(0, 1200);
}

function categoryAffinity(entry, category) {
  let score = 0;
  const html = entry.rawHtml;
  const length = html.length;

  if (category === 'hero') {
    if (entry.order <= 2 && /<h1\b/i.test(html)) score += 200;
    if (entry.kind === 'section') score += 40;
  }
  if (category === 'buttons') {
    if (entry.kind === 'button') score += 300;
    if (/^<(a|button)\b/i.test(html)) score += 180;
    if (length < 1200) score += 80;
  }
  if (category === 'forms') {
    if (entry.kind === 'form') score += 320;
    if (entry.kind === 'input-group') score += 220;
    if (/<form\b/i.test(html)) score += 180;
  }
  if (category === 'input-groups') {
    if (entry.kind === 'input-group') score += 320;
    if (/<input\b/i.test(html) && /<(a|button)\b/i.test(html)) score += 180;
    if (length < 2400) score += 60;
  }
  if (category === 'icon-boxes') {
    if (entry.kind === 'icon-box') score += 260;
    if (length < 3200) score += 60;
  }
  if (category === 'grid-cards') {
    if (entry.kind === 'card') score += 220;
    if (/<article\b/i.test(html)) score += 100;
    if (/grid-cols-[1234]/.test(html)) score += 80;
  }
  if (category === 'gallery-grid' && /grid-cols-[1234]/.test(html)) score += 120;
  if (category === 'booking-form' && /booking|travel date|reserve|guest/i.test(html)) score += 180;
  if (category === 'travel-itinerary' && /itinerary|day\s*\d|timeline/i.test(html)) score += 180;
  if (category === 'section' && entry.kind === 'section') score += 160;

  if (entry.kind !== 'section' && length > 9000) score -= 80;
  if (entry.kind === 'button' && length > 2400) score -= 120;
  if (entry.kind === 'form' && !/<form\b/i.test(html) && length > 5000) score -= 120;
  return score;
}

function collectCandidates(source, templateSlug) {
  const sections = extractTagBlocks(source, ['section']).map((block, index) => ({
    ...block,
    kind: 'section',
    order: index,
  }));

  const blocks = extractTagBlocks(source, BLOCK_TAGS)
    .filter((block) => block.tagName !== 'section')
    .map((block, index) => ({
      ...block,
      kind: 'micro-block',
      order: index,
    }))
    .filter((block) => likelyIndependentBlock(block, block.order));

  const components = extractTagBlocks(source, COMPONENT_TAGS)
    .map((block, index) => {
      let kind = '';
      if (looksLikeButton(block.html)) kind = 'button';
      else if (looksLikeInputGroup(block.html)) kind = 'input-group';
      else if (looksLikeForm(block.html)) kind = 'form';
      else if (looksLikeIconBox(block.html)) kind = 'icon-box';
      else if (looksLikeCard(block.html)) kind = 'card';
      return { ...block, kind, order: index };
    })
    .filter((block) => block.kind)
    .filter((block) => block.html.length >= 48 && block.html.length <= 10000);

  const seen = new Set();
  const picked = [];
  for (const item of [...sections, ...blocks, ...components]) {
    if (!KEEP_NAV && isNavLike(item.html)) continue;
    const key = fingerprint(item.html);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(item);
  }

  return picked.map((item) => {
    const categories = detectCategories(item.html, item);
    return {
      templateSlug,
      templateKey: templateSlug.replace(/-html$/, ''),
      templateLabel: templateHumanLabel(templateSlug),
      kind: item.kind,
      order: item.order,
      categories,
      primaryCategory: categories[0],
      heading: headingLabel(item.html),
      desc: shortDescription(item.html),
      score: richness(item.html),
      rawHtml: clipBlock(item.html),
    };
  });
}

function buildSnippet(entry, rankIndex) {
  const idx = String(rankIndex + 1).padStart(2, '0');
  const id = `${entry.templateKey}-${entry.primaryCategory}-${idx}`;
  const label = entry.heading
    ? `${entry.templateLabel} - ${entry.heading}`
    : `${entry.templateLabel} - ${entry.primaryCategory.replace(/-/g, ' ')} ${idx}`;

  let html = cleanSnippetHtml(entry.rawHtml);
  html = wrapStandaloneBlock(html, entry.kind);
  html = fixAssetPaths(html, entry.templateSlug, entry.primaryCategory);
  html = injectHeroPadding(html, entry.categories);
  html = injectEditableMarkers(html);

  return {
    id,
    type: id,
    name: label,
    label,
    desc: entry.desc,
    icon: (CATEGORY_RULES.find((rule) => rule.id === entry.primaryCategory) || CATEGORY_RULES[CATEGORY_RULES.length - 1]).icon,
    category: entry.primaryCategory,
    categories: entry.categories,
    tags: [...new Set([...entry.categories, entry.kind, entry.templateKey, 'cruip'])].filter(Boolean),
    templateId: entry.templateSlug,
    thumbnail: sectionThumbnail(html, entry.primaryCategory),
    html,
  };
}

function ensureCleanOutputDir(dir) {
  mkdirSync(dir, { recursive: true });
  if (!CLEAR) return;
  const existing = readdirSync(dir).filter((name) => name.endsWith('.json'));
  for (const file of existing) unlinkSync(join(dir, file));
  console.log(`Cleared ${existing.length} existing snippet files.`);
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function summarizeCounts(items) {
  const counts = {};
  for (const item of items) counts[item.category] = (counts[item.category] || 0) + 1;
  return counts;
}

async function main() {
  console.log('\n=== syncAllSnippets.mjs ===');
  console.log(`Templates : ${relative(ROOT, TMPL_ROOT)}`);
  console.log(`Output    : ${relative(ROOT, OUT_DIR)}`);
  console.log(`Manifest  : ${relative(ROOT, MANIFEST)}`);
  console.log(`R2 base   : ${R2_BASE}`);
  console.log(`Max/cat   : ${MAX_PER_CAT}`);
  console.log(`Min len   : ${MIN_LEN}`);
  console.log(`Dry run   : ${DRY_RUN}`);
  console.log(`Clear     : ${CLEAR}`);

  const templateDirs = readdirSync(TMPL_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('-html'))
    .map((entry) => ({ slug: entry.name, dir: join(TMPL_ROOT, entry.name) }))
    .filter(({ dir }) => existsSync(join(dir, 'index.html')));

  if (!templateDirs.length) {
    console.error('No Cruip template directories found.');
    process.exit(1);
  }

  const allCandidates = [];
  for (const template of templateDirs) {
    const source = readFileSync(join(template.dir, 'index.html'), 'utf8');
    const found = collectCandidates(source, template.slug);
    allCandidates.push(...found);
    if (VERBOSE) console.log(`${template.slug}: ${found.length} candidates`);
  }

  const grouped = new Map();
  for (const entry of allCandidates) {
    for (const category of entry.categories) {
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category).push(entry);
    }
  }

  const selected = [];
  for (const [category, entries] of grouped.entries()) {
    const ranked = [...entries].sort((left, right) => {
      const affinityDelta = categoryAffinity(right, category) - categoryAffinity(left, category);
      if (affinityDelta !== 0) return affinityDelta;
      if (right.score !== left.score) return right.score - left.score;
      return left.order - right.order;
    });
    const usedTemplateKinds = new Set();
    const chosen = [];

    for (const entry of ranked) {
      if (chosen.length >= MAX_PER_CAT) break;
      const diversityKey = `${entry.templateKey}:${entry.kind}`;
      if (usedTemplateKinds.has(diversityKey)) continue;
      usedTemplateKinds.add(diversityKey);
      chosen.push({ ...entry, primaryCategory: category });
    }
    for (const entry of ranked) {
      if (chosen.length >= MAX_PER_CAT) break;
      if (chosen.some((item) => item.rawHtml === entry.rawHtml && item.templateSlug === entry.templateSlug)) continue;
      chosen.push({ ...entry, primaryCategory: category });
    }

    chosen.forEach((entry, index) => {
      selected.push(buildSnippet(entry, index));
    });
  }

  selected.sort((left, right) => left.id.localeCompare(right.id));

  console.log(`Templates found : ${templateDirs.length}`);
  console.log(`Candidates      : ${allCandidates.length}`);
  console.log(`Snippets chosen : ${selected.length}`);
  const counts = summarizeCounts(selected);
  Object.keys(counts).sort().forEach((category) => {
    console.log(`  ${category.padEnd(18)} ${counts[category]}`);
  });

  if (DRY_RUN) {
    console.log('Dry run complete. No files written.');
    return;
  }

  ensureCleanOutputDir(OUT_DIR);

  let written = 0;
  for (const snippet of selected) {
    writeJson(join(OUT_DIR, `${snippet.id}.json`), snippet);
    written += 1;
  }

  mkdirSync(dirname(MANIFEST), { recursive: true });
  writeJson(MANIFEST, selected);

  console.log(`Written         : ${written}`);
  console.log(`Manifest items  : ${selected.length}`);
  console.log('Done.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
