import { readFileSync, writeFileSync } from 'fs';
const src = readFileSync('templates/open-pro-html/index.html', 'utf8');

// Map each comment label to snippet metadata
const META = {
  'Hero':           { id: 'op-hero',      type: 'op-hero',      label: 'Hero Banner',       icon: '🌄', category: 'hero',       desc: 'Full-width hero with headline, video modal and dual CTAs.', thumbnail: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=480&q=60' },
  'Workflows':      { id: 'op-workflows', type: 'op-workflows', label: 'Spotlight Cards',    icon: '⚡', category: 'content',    desc: '3-column spotlight card grid with hover-glow effect.', thumbnail: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=480&q=60' },
  'Features':       { id: 'op-features',  type: 'op-features',  label: 'Features Grid',     icon: '✨', category: 'content',    desc: '6-item icon+text feature grid for product capabilities.', thumbnail: 'https://images.unsplash.com/photo-1518186285589-2f7649de83e0?w=480&q=60' },
  'Split carousel': { id: 'op-carousel',  type: 'op-carousel',  label: 'Feature Carousel',  icon: '🔄', category: 'content',    desc: 'Tab-driven split layout with image carousel and testimonial.', thumbnail: 'https://images.unsplash.com/photo-1487017159836-4e23ece2e4cf?w=480&q=60' },
  'Pricing':        { id: 'op-pricing',   type: 'op-pricing',   label: 'Pricing Table',     icon: '💰', category: 'conversion', desc: '4-column pricing cards with annual/monthly toggle.', thumbnail: 'https://images.unsplash.com/photo-1565514020179-026b92b84bb6?w=480&q=60' },
  'CTA':            { id: 'op-cta',       type: 'op-cta',       label: 'CTA Banner',        icon: '🚀', category: 'conversion', desc: 'Centred call-to-action with primary and secondary buttons.', thumbnail: 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=480&q=60' },
};

// Regex: match <!-- Label --> ... <section ...>...</section>
// Using greedy match up to </section> — but sections can be nested, so we need to count depth
function extractSections(html) {
  const results = [];
  const commentNames = Object.keys(META);

  for (const name of commentNames) {
    const escapedName = name.replace('(', '\\(').replace(')', '\\)');
    const pattern = new RegExp(`<!-- ${escapedName} -->\\s*(<section[^>]*>)`, 'i');
    const startMatch = pattern.exec(html);
    if (!startMatch) { console.warn('NOT FOUND:', name); continue; }

    const sectionStart = startMatch.index + startMatch[0].indexOf('<section');
    // Walk forward counting <section and </section> to find the matching close
    let depth = 0;
    let i = sectionStart;
    while (i < html.length) {
      if (html[i] === '<') {
        const tagClose = html.indexOf('>', i);
        const tag = html.slice(i, tagClose + 1);
        if (/^<section(\s|>)/i.test(tag)) depth++;
        else if (/^<\/section>/i.test(tag)) {
          depth--;
          if (depth === 0) {
            const sectionHtml = html.slice(sectionStart, tagClose + 1);
            results.push({ name, html: sectionHtml });
            break;
          }
        }
        i = tagClose + 1;
      } else {
        i++;
      }
    }
  }
  return results;
}

const sections = extractSections(src);
console.log('Extracted:', sections.map(s => s.name + ' (' + s.html.length + ' chars)').join('\n'));

// Rewrite relative paths → template-asset proxy
function rewritePaths(html) {
  return html
    .replace(/src="\.\//g, 'src="/api/tenant/template-assets/open-pro-html/')
    .replace(/src='\.\//g, "src='/api/tenant/template-assets/open-pro-html/")
    .replace(/href="\.\//g, 'href="/api/tenant/template-assets/open-pro-html/')
    .replace(/href='\.\//g, "href='/api/tenant/template-assets/open-pro-html/");
}

// Build common-sections.html
let out = `<!DOCTYPE html>
<!--
  common-sections.html — Open Pro (Cruip) Section Library for Site Studio
  ─────────────────────────────────────────────────────────────────────────
  Sections extracted from templates/open-pro-html/index.html.
  All image paths rewritten to /api/tenant/template-assets/open-pro-html/…
  so they resolve correctly when inserted as custom_sections into a tenant page.

  Attributes on <template>:
    id              — unique key  (section-{type})
    data-type       — slug stored in site_config.custom_sections[].type
    data-label      — human label shown in the snippet panel
    data-icon       — emoji icon for the snippet card
    data-desc       — short description
    data-thumbnail  — preview image URL for the snippet card
    data-category   — logical group (hero|content|conversion)
-->
<html lang="en">
<head><meta charset="UTF-8"><title>Section Library — Open Pro</title></head>
<body>
`;

for (const sec of sections) {
  const m = META[sec.name];
  if (!m) continue;
  const rewritten = rewritePaths(sec.html);
  out += `
<!-- ${'═'.repeat(68)}
     ${sec.name.toUpperCase()}
     ${'═'.repeat(68)} -->
<template
  id="section-${m.type}"
  data-type="${m.type}"
  data-category="${m.category}"
  data-label="${m.label}"
  data-icon="${m.icon}"
  data-desc="${m.desc}"
  data-thumbnail="${m.thumbnail}">
${rewritten}
</template>

`;
}

out += `\n</body>\n</html>\n`;

writeFileSync('public/common-sections.html', out, 'utf8');
console.log('\nWritten public/common-sections.html (' + out.length + ' bytes)');
