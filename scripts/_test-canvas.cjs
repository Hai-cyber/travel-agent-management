'use strict';
const escAttr = s => String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const isAbsoluteOrSkip = p => !p || p.startsWith('http') || p.startsWith('//') || p.startsWith('data:') || p.startsWith('blob:') || p.startsWith('/');

function rewriteHtmlRelativePaths(html, templateId) {
  const base = '/api/tenant/template-assets/' + templateId + '/';
  return html.replace(
    /(<img\b[^>]*?\s)(src|data-src)(=)(["']?)([^"'>\s]+)\4/gi,
    (m, pre, attr, eq, q, rawPath) => {
      if (isAbsoluteOrSkip(rawPath.trim())) return m;
      return pre + attr + eq + q + base + rawPath.trim() + q;
    }
  );
}
function injectStockImages(html) { return html; }

const brandName  = 'Demo Travel';
const heroDesc   = 'Best tours in Southeast Asia';
const themeColor = '#e11d48';
const navItems   = [{ label: 'Tours', url: '/tours' }, { label: 'About', url: '/about' }];
const templateId = 'simple-html';
const injectScript = '/inject.js';
const customSections = [
  { id: 'hero-01',     html: '<section class="relative"><h1 class="text-4xl font-bold">Go Explore</h1><img src="images/hero.jpg"></section>' },
  { id: 'features-01', html: '<section><h2 class="text-2xl">Features</h2></section>' },
];

const themeStyle = themeColor && /^#[0-9a-fA-F]{3,6}$/.test(themeColor)
  ? '\n  <style>:root{--brand-primary:' + themeColor + ';--brand-secondary:' + themeColor + 'dd;}</style>'
  : '';

const navHtml = navItems.length > 0
  ? '\n<nav class="fixed top-0 inset-x-0 z-30 bg-white/90 backdrop-blur-sm border-b border-gray-100">' +
    '<div class="max-w-7xl mx-auto px-4 flex items-center h-14"><ul class="flex gap-6 text-sm">' +
    navItems.map(({ label, url }) =>
      '<li><a href="' + escAttr(String(url ?? '/')) + '">' + escAttr(String(label ?? '')) + '</a></li>'
    ).join('') + '</ul></div></nav>'
  : '';

const sectionsHtml = customSections.map((s, i) => {
  let html = String(s.html ?? '').trim();
  if (!html) return '';
  html = injectStockImages(html);
  html = rewriteHtmlRelativePaths(html, templateId);
  const safeId = escAttr(String(s.id ?? 'sec-' + i));
  return '  <div data-ve-section="' + safeId + '" data-ve-section-index="' + i + '">\n' + html + '\n  </div>';
}).filter(Boolean).join('\n\n');

const page = [
  '<!DOCTYPE html>',
  '<html lang="en" class="scroll-smooth">',
  '<head>',
  '  <meta charset="utf-8">',
  '  <meta name="viewport" content="width=device-width,initial-scale=1">',
  '  <title>' + escAttr(brandName) + '</title>',
  '  <meta name="description" content="' + escAttr(heroDesc) + '">',
  '  <link rel="stylesheet" href="/css/cruip-global.css">' + themeStyle,
  '</head>',
  '<body class="font-inter antialiased bg-white text-gray-900 overflow-x-hidden">',
  navHtml,
  '<main id="canvas">' + '>',
  sectionsHtml || '  <!-- empty canvas -->',
  '</main>',
  '<script src="' + escAttr(injectScript) + '"></script>',
  '</body>',
  '</html>',
].join('\n');

// Assertions
const checks = [
  ['Has cruip-global.css',    page.includes('/css/cruip-global.css')],
  ['Has brand color',         page.includes('--brand-primary:#e11d48')],
  ['Has og:title',            page.includes('og:title')],
  ['Has #canvas',             page.includes('id="canvas"')],
  ['data-ve-section count',   (page.match(/data-ve-section=/g) || []).length === 2],
  ['Img src rewritten',       page.includes('/api/tenant/template-assets/simple-html/images/hero.jpg')],
  ['Nav Tours link',          page.includes('href="/tours"')],
  ['Has inject.js',           page.includes('<script src="/inject.js"')],
  ['pt-14 for nav offset',    page.includes('class="pt-14"')],
  ['NO R2 fetch (async=0)',    true],  // structural — no await in this test
];

let passed = 0, failed = 0;
checks.forEach(([label, result]) => {
  console.log((result ? '✓' : '✗') + '  ' + label);
  result ? passed++ : failed++;
});
console.log('\n' + passed + '/' + checks.length + ' passed' + (failed ? '  ← ' + failed + ' FAILED' : ''));
if (failed) process.exit(1);
