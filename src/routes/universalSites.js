import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import {
  buildUniversalBootstrapMock,
  UNIVERSAL_GROUPS,
  UNIVERSAL_VARIANTS,
  buildEditorStoreBundle,
  buildUniversalCacheKeyUrl,
  buildUniversalPublicPath,
  buildDefaultContacts,
  buildDefaultMenuItems,
  buildDefaultThemeTokens,
  buildVariantRuntimeConfig,
  getVariantByKey,
  slugify,
} from '../lib/universalSite.js';
import { ensureUniversalSiteInitialized, syncUniversalTourPage } from '../lib/universalSiteSync.js';

const router = new Hono();

const VALID_SITE_STATUS = new Set(['draft', 'active', 'archived']);
const VALID_PAGE_STATUS = new Set(['draft', 'published', 'archived']);
const VALID_PAGE_TYPES = new Set(['standard', 'legal', 'custom', 'tour_detail', 'system']);
const VALID_TARGETS = new Set(['_self', '_blank']);

function jsonError(c, status, error, details) {
  return c.json({ ok: false, error, ...(details ? { details } : {}) }, status);
}

function getTenantId(c) {
  return c.req.header('X-Tenant-ID')?.trim() || '';
}

function parseJsonSafe(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeSite(siteRow) {
  return siteRow ? {
    tenant_id: siteRow.tenant_id,
    group_key: siteRow.group_key,
    variant_key: siteRow.variant_key,
    status: siteRow.status,
    site_name: siteRow.site_name,
    default_lang: siteRow.default_lang,
    home_page_key: siteRow.home_page_key,
    created_at: siteRow.created_at,
    updated_at: siteRow.updated_at,
  } : null;
}

function normalizePage(row) {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    page_key: row.page_key,
    title: row.title,
    slug: row.slug,
    page_type: row.page_type,
    status: row.status,
    visible: Boolean(row.visible),
    blocks: parseJsonSafe(row.blocks_json, []),
    seo: parseJsonSafe(row.seo_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeMenuItem(row) {
  return {
    id: row.id,
    item_key: row.item_key,
    label: row.label,
    href: row.href,
    page_key: row.page_key,
    target: row.target,
    is_external: Boolean(row.is_external),
    visible: Boolean(row.visible),
    sort_order: row.sort_order,
  };
}

function normalizeTheme(row) {
  return parseJsonSafe(row?.tokens_json, {});
}

function normalizeContacts(row) {
  return parseJsonSafe(row?.channels_json, buildDefaultContacts());
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildOptimizedImageUrl(source, width = 1280, fit = 'cover') {
  if (!source || typeof source !== 'string') return '';
  if (source.startsWith('data:') || source.startsWith('/cdn-cgi/image/')) return source;
  const originPath = /^https?:\/\//i.test(source) ? source : source.replace(/^\//, '');
  return `/cdn-cgi/image/fit=${fit},width=${width},quality=85,format=auto,metadata=none,anim=false/${originPath}`;
}

function buildResponsiveImageMarkup(source, alt, className, fit = 'cover', sizes = '100vw') {
  const src640 = buildOptimizedImageUrl(source, 640, fit);
  const src960 = buildOptimizedImageUrl(source, 960, fit);
  const src1920 = buildOptimizedImageUrl(source, 1920, fit);
  const fallback = src960 || src1920 || src640 || source;
  return `<img src="${escapeHtml(fallback)}" srcset="${escapeHtml(src640)} 640w, ${escapeHtml(src960)} 960w, ${escapeHtml(src1920)} 1920w" sizes="${escapeHtml(sizes)}" alt="${escapeHtml(alt || '')}" class="${escapeHtml(className)}" loading="lazy" decoding="async" />`;
}

async function purgeTenantPublicCache(db, tenantId) {
  const [pagesResult, toursResult] = await db.batch([
    db.prepare('SELECT slug FROM tenant_universal_pages WHERE tenant_id = ?').bind(tenantId),
    db.prepare('SELECT slug FROM tenant_universal_tour_pages WHERE tenant_id = ?').bind(tenantId),
  ]);

  const slugs = [
    ...(pagesResult.results || []).map((row) => row.slug),
    ...(toursResult.results || []).map((row) => row.slug),
  ].filter(Boolean);

  await Promise.allSettled(
    [...new Set(slugs)].map((slug) => caches.default.delete(new Request(buildUniversalCacheKeyUrl(tenantId, slug))))
  );
}

function renderPreviewHtml(siteBundle, tourPreview) {
  const theme = siteBundle.theme || {};
  const site = siteBundle.site || {};
  const snapshot = tourPreview?.sync_snapshot || null;
  const itinerary = Array.isArray(snapshot?.itinerary_stops) ? snapshot.itinerary_stops : [];
  const highlights = Array.isArray(snapshot?.highlights) ? snapshot.highlights : [];
  const gallery = Array.isArray(snapshot?.gallery_images) ? snapshot.gallery_images : [];
  const priceCards = Array.isArray(snapshot?.pricing_cards) ? snapshot.pricing_cards : [];
  const primaryColor = theme.colorPrimary || '#0f5a3b';
  const secondaryColor = theme.colorSecondary || theme.colorAccent || '#ee9b00';
  const surfaceColor = theme.colorSurface || '#f8fafc';
  const textColor = theme.colorText || '#10212d';
  const heroTitle = snapshot?.title || site.site_name || 'Universal Preview';
  const heroBody = snapshot?.summary || 'Preview route for the universal site render contract.';
  const aboutBody = snapshot?.about_section || 'No synced about section yet.';
  const priceFrom = snapshot?.price_from != null ? `$${snapshot.price_from}` : 'Pending pricing';

  return `<!DOCTYPE html>
<html lang="${escapeHtml(site.default_lang || 'en')}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(site.site_name || 'Universal Preview')}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    :root {
      --color-primary: ${escapeHtml(primaryColor)};
      --color-secondary: ${escapeHtml(secondaryColor)};
      --color-surface: ${escapeHtml(surfaceColor)};
      --color-text: ${escapeHtml(textColor)};
    }
    body {
      background: var(--color-surface);
      color: var(--color-text);
      font-family: ${escapeHtml(theme.fontBody || 'Inter, system-ui, sans-serif')};
    }
    h1, h2, h3 {
      font-family: ${escapeHtml(theme.fontHeading || 'Inter, system-ui, sans-serif')};
    }
  </style>
</head>
<body class="min-h-screen">
  <main class="mx-auto max-w-6xl px-6 py-10">
    <div class="mb-6 rounded-full bg-white px-4 py-2 text-sm shadow">
      <span class="font-semibold">Universal Preview</span>
      <span class="ml-3 text-slate-500">tenant=${escapeHtml(site.tenant_id || '')}</span>
      <span class="ml-3 text-slate-500">variant=${escapeHtml(site.variant_key || '')}</span>
    </div>
    <section class="grid gap-8 rounded-[28px] px-8 py-10 text-white md:grid-cols-[1.2fr_0.8fr]" style="background: linear-gradient(135deg, ${escapeHtml(primaryColor)}, ${escapeHtml(secondaryColor)});">
      <div>
        <p class="mb-3 text-sm uppercase tracking-[0.24em] opacity-80">${escapeHtml(snapshot?.duration_text || site.group_key || 'Preview')}</p>
        <h1 class="max-w-3xl text-4xl font-semibold md:text-6xl">${escapeHtml(heroTitle)}</h1>
        <p class="mt-5 max-w-2xl text-lg text-white/85">${escapeHtml(heroBody)}</p>
        <div class="mt-8 flex flex-wrap gap-3">
          <span class="rounded-full bg-white/15 px-4 py-2 text-sm">Starting price: ${escapeHtml(priceFrom)}</span>
          <span class="rounded-full bg-white/15 px-4 py-2 text-sm">Stops: ${escapeHtml(String(itinerary.length))}</span>
        </div>
      </div>
      <div class="rounded-[24px] bg-white/10 p-4 backdrop-blur">
        ${snapshot?.hero_image ? `<img src="${escapeHtml(snapshot.hero_image)}" alt="Hero" class="h-full w-full rounded-[20px] object-cover" />` : '<div class="flex h-full min-h-[240px] items-center justify-center rounded-[20px] border border-dashed border-white/30 text-sm text-white/70">No hero image synced yet</div>'}
      </div>
    </section>

    <section class="mt-8 grid gap-8 md:grid-cols-2">
      <article class="rounded-[24px] bg-white p-6 shadow-sm">
        <h2 class="text-2xl font-semibold">About Section</h2>
        <p class="mt-4 leading-7 text-slate-700">${escapeHtml(aboutBody)}</p>
      </article>
      <article class="rounded-[24px] bg-white p-6 shadow-sm">
        <h2 class="text-2xl font-semibold">Slot Mapping Check</h2>
        <dl class="mt-4 space-y-3 text-sm text-slate-700">
          <div><dt class="font-semibold">tour.name -> hero_title</dt><dd>${escapeHtml(snapshot?.title || '')}</dd></div>
          <div><dt class="font-semibold">tour.description -> about_section</dt><dd>${escapeHtml(snapshot?.about_section || '')}</dd></div>
          <div><dt class="font-semibold">tour_stops -> itinerary_timeline</dt><dd>${escapeHtml(String(itinerary.length))} items</dd></div>
          <div><dt class="font-semibold">tour_prices lowest -> starting_price</dt><dd>${escapeHtml(priceFrom)}</dd></div>
        </dl>
      </article>
    </section>

    <section class="mt-8 rounded-[24px] bg-white p-6 shadow-sm">
      <h2 class="text-2xl font-semibold">Itinerary Timeline</h2>
      <div class="mt-6 space-y-4">
        ${itinerary.length ? itinerary.map((item) => `
          <div class="rounded-2xl border border-slate-200 p-4">
            <div class="flex items-center justify-between gap-4">
              <h3 class="text-lg font-semibold">${escapeHtml(item.title)}</h3>
              <span class="text-sm text-slate-500">${escapeHtml(item.day_label || '')}</span>
            </div>
            <p class="mt-2 text-slate-600">${escapeHtml(item.description || '')}</p>
          </div>
        `).join('') : '<p class="text-slate-500">No itinerary stops synced yet.</p>'}
      </div>
    </section>

    <section class="mt-8 grid gap-8 md:grid-cols-2">
      <article class="rounded-[24px] bg-white p-6 shadow-sm">
        <h2 class="text-2xl font-semibold">Pricing</h2>
        <div class="mt-6 space-y-3">
          ${priceCards.length ? priceCards.map((card) => `
            <div class="rounded-2xl border border-slate-200 p-4 text-sm">
              <div class="font-semibold">${escapeHtml(card.segment_name || card.segment_code || 'Segment')}</div>
              <div class="mt-1 text-slate-600">${escapeHtml(card.season_name || '')} • ${escapeHtml(card.pax_range_label || '')}</div>
              <div class="mt-2 text-slate-900">Shared: ${escapeHtml(String(card.adult_shared_room_price ?? 'n/a'))}</div>
              <div class="text-slate-900">Single: ${escapeHtml(String(card.adult_single_room_price ?? 'n/a'))}</div>
            </div>
          `).join('') : '<p class="text-slate-500">No pricing rows synced yet.</p>'}
        </div>
      </article>
      <article class="rounded-[24px] bg-white p-6 shadow-sm">
        <h2 class="text-2xl font-semibold">Gallery & Highlights</h2>
        <div class="mt-6 grid grid-cols-2 gap-3">
          ${gallery.length ? gallery.slice(0, 4).map((item) => `<img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.alt || 'Gallery')}" class="aspect-square rounded-2xl object-cover" />`).join('') : '<div class="col-span-2 rounded-2xl border border-dashed border-slate-300 p-6 text-center text-slate-500">No gallery images synced yet.</div>'}
        </div>
        <ul class="mt-6 space-y-2 text-slate-700">
          ${highlights.length ? highlights.map((item) => `<li class="rounded-xl bg-slate-50 px-4 py-3"><span class="font-semibold">${escapeHtml(item.title || '')}</span>${item.body ? `: ${escapeHtml(item.body)}` : ''}</li>`).join('') : '<li class="text-slate-500">No highlights synced yet.</li>'}
        </ul>
      </article>
    </section>
  </main>
</body>
</html>`;
}

function renderPublicHtml(siteBundle, page, tourPreview) {
  const theme = siteBundle.theme || {};
  const site = siteBundle.site || {};
  const runtime = siteBundle.variant_runtime || {};
  const profile = runtime.layout_profile || {};
  const snapshot = tourPreview?.sync_snapshot || null;
  const seo = page?.seo || {};
  const primaryColor = theme.colorPrimary || '#0f5a3b';
  const secondaryColor = theme.colorSecondary || theme.colorAccent || '#ee9b00';
  const surfaceColor = theme.colorSurface || '#f8fafc';
  const textColor = theme.colorText || '#10212d';
  const title = seo.title || snapshot?.title || page?.title || site.site_name || 'Travel Page';
  const description = seo.description || snapshot?.about_section || snapshot?.summary || 'Travel experience page';
  const ogImage = seo.og_image || snapshot?.hero_image || theme.logoUrl || '';
  const itinerary = Array.isArray(snapshot?.itinerary_stops) ? snapshot.itinerary_stops : [];
  const highlights = Array.isArray(snapshot?.highlights) ? snapshot.highlights : [];
  const gallery = Array.isArray(snapshot?.gallery_images) ? snapshot.gallery_images : [];
  const priceCards = Array.isArray(snapshot?.pricing_cards) ? snapshot.pricing_cards : [];
  const canonicalPath = buildUniversalPublicPath(site.tenant_id, page.slug);
  const blocks = Array.isArray(page?.blocks) ? page.blocks : [];

  const renderRichText = (text) => `<div class="prose prose-slate max-w-none">${escapeHtml(text || '').replace(/\n/g, '<br>')}</div>`;

  const renderHero = (block) => {
    const content = block.content || {};
    const image = content.hero_image || snapshot?.hero_image || '';
    const imageMarkup = image
      ? buildResponsiveImageMarkup(image, content.headline || title, 'h-full w-full rounded-[22px] object-cover', 'cover', '(min-width: 1024px) 40vw, 100vw')
      : '<div class="flex min-h-[240px] items-center justify-center rounded-[22px] border border-dashed border-white/30 text-sm text-white/70">Image pending</div>';

    if (profile.hero === 'editorial') {
      return `<section class="grid gap-6 rounded-[32px] bg-white p-6 shadow-sm lg:grid-cols-[0.8fr_1.2fr]"><div class="rounded-[26px] bg-slate-950 p-6 text-white"><p class="text-xs uppercase tracking-[0.24em] text-white/60">${escapeHtml(content.eyebrow || runtime.variant_label || '')}</p><h1 class="mt-4 text-5xl font-semibold leading-tight">${escapeHtml(content.headline || title)}</h1><p class="mt-5 text-lg text-white/78">${escapeHtml(content.body || description)}</p><div class="mt-8 flex gap-3"><a href="${escapeHtml(content.primary_cta_href || '#pricing')}" class="rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950">${escapeHtml(content.primary_cta_label || 'Explore')}</a></div></div><div class="grid gap-4">${imageMarkup}<div class="grid gap-4 sm:grid-cols-2"><div class="rounded-[22px] bg-amber-50 p-5"><p class="text-xs uppercase tracking-[0.2em] text-slate-500">Layout</p><p class="mt-2 text-xl font-semibold text-slate-900">Editorial luxury composition</p></div><div class="rounded-[22px] bg-slate-50 p-5"><p class="text-xs uppercase tracking-[0.2em] text-slate-500">Starting price</p><p class="mt-2 text-xl font-semibold text-slate-900">${escapeHtml(snapshot?.price_from != null ? `$${snapshot.price_from}` : 'Request quote')}</p></div></div></div></section>`;
    }

    if (profile.hero === 'immersive') {
      return `<section class="relative overflow-hidden rounded-[36px] text-white shadow-sm" style="background:linear-gradient(135deg, ${escapeHtml(primaryColor)}, ${escapeHtml(secondaryColor)})"><div class="grid gap-6 p-6 lg:grid-cols-[1.1fr_0.9fr] lg:p-10"><div class="relative z-10"><p class="text-xs uppercase tracking-[0.24em] text-white/70">${escapeHtml(content.eyebrow || runtime.variant_label || '')}</p><h1 class="mt-4 max-w-3xl text-5xl font-semibold leading-tight lg:text-7xl">${escapeHtml(content.headline || title)}</h1><p class="mt-5 max-w-2xl text-lg text-white/82">${escapeHtml(content.body || description)}</p><div class="mt-8 flex flex-wrap gap-3"><a href="${escapeHtml(content.primary_cta_href || '#pricing')}" class="rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950">${escapeHtml(content.primary_cta_label || 'Discover')}</a><span class="rounded-full bg-white/15 px-4 py-3 text-sm">${escapeHtml(String(itinerary.length))} itinerary stops</span></div></div><div class="rounded-[28px] bg-white/10 p-3 backdrop-blur">${imageMarkup}</div></div></section>`;
    }

    if (profile.hero === 'compact' || profile.hero === 'utility') {
      return `<section class="grid gap-4 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm lg:grid-cols-[1.2fr_0.8fr]"><div><p class="text-xs uppercase tracking-[0.24em] text-slate-500">${escapeHtml(content.eyebrow || runtime.variant_label || '')}</p><h1 class="mt-3 text-4xl font-semibold text-slate-950">${escapeHtml(content.headline || title)}</h1><p class="mt-4 max-w-2xl text-base leading-7 text-slate-600">${escapeHtml(content.body || description)}</p><div class="mt-6 flex flex-wrap gap-3"><a href="${escapeHtml(content.primary_cta_href || '#pricing')}" class="rounded-full px-4 py-2 text-sm font-semibold text-white" style="background:${escapeHtml(primaryColor)}">${escapeHtml(content.primary_cta_label || 'Get quote')}</a><span class="rounded-full bg-slate-100 px-4 py-2 text-sm text-slate-700">${escapeHtml(snapshot?.price_from != null ? `$${snapshot.price_from}` : 'Fast quote')}</span></div></div><div class="rounded-[20px] bg-slate-50 p-2">${imageMarkup}</div></section>`;
    }

    return `<section class="grid gap-6 rounded-[30px] px-6 py-8 text-white shadow-sm lg:grid-cols-[1.1fr_0.9fr] lg:px-8 lg:py-10" style="background:linear-gradient(135deg, ${escapeHtml(primaryColor)}, ${escapeHtml(secondaryColor)})"><div><p class="text-xs uppercase tracking-[0.24em] text-white/75">${escapeHtml(content.eyebrow || runtime.variant_label || '')}</p><h1 class="mt-4 text-5xl font-semibold leading-tight lg:text-6xl">${escapeHtml(content.headline || title)}</h1><p class="mt-5 max-w-2xl text-lg text-white/85">${escapeHtml(content.body || description)}</p><div class="mt-8 flex flex-wrap gap-3"><a href="${escapeHtml(content.primary_cta_href || '#pricing')}" class="rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950">${escapeHtml(content.primary_cta_label || 'Browse')}</a><span class="rounded-full bg-white/15 px-4 py-3 text-sm">${escapeHtml(String(highlights.length || itinerary.length))} highlights</span></div></div><div class="rounded-[24px] bg-white/10 p-3 backdrop-blur">${imageMarkup}</div></section>`;
  };

  const renderGallery = (block) => {
    const images = Array.isArray(block.content?.images) ? block.content.images : gallery;
    if (!images.length) return '';
    if (profile.gallery === 'panorama' || profile.gallery === 'cinematic') {
      const lead = images[0];
      const tail = images.slice(1, 4);
      return `<section class="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]"><div class="overflow-hidden rounded-[28px] bg-white shadow-sm">${buildResponsiveImageMarkup(lead.src, lead.alt || title, 'h-[420px] w-full object-cover', 'cover', '(min-width: 1024px) 60vw, 100vw')}</div><div class="grid gap-4">${tail.map((item) => `<div class="overflow-hidden rounded-[22px] bg-white shadow-sm">${buildResponsiveImageMarkup(item.src, item.alt || title, 'h-[128px] w-full object-cover', 'cover', '(min-width: 1024px) 30vw, 100vw')}</div>`).join('')}</div></section>`;
    }
    if (profile.gallery === 'filmstrip') {
      return `<section class="overflow-x-auto"><div class="flex gap-4 pb-2">${images.map((item) => `<div class="min-w-[280px] overflow-hidden rounded-[24px] bg-white shadow-sm">${buildResponsiveImageMarkup(item.src, item.alt || title, 'h-[220px] w-[280px] object-cover', 'cover', '280px')}</div>`).join('')}</div></section>`;
    }
    if (profile.gallery === 'minimal') {
      return `<section class="grid gap-3 sm:grid-cols-2">${images.slice(0, 2).map((item) => `<div class="overflow-hidden rounded-[20px] bg-white shadow-sm">${buildResponsiveImageMarkup(item.src, item.alt || title, 'h-[220px] w-full object-cover', 'cover', '(min-width: 640px) 50vw, 100vw')}</div>`).join('')}</section>`;
    }
    return `<section class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">${images.slice(0, 6).map((item) => `<div class="overflow-hidden rounded-[22px] bg-white shadow-sm">${buildResponsiveImageMarkup(item.src, item.alt || title, 'aspect-square w-full object-cover', 'cover', '(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw')}</div>`).join('')}</section>`;
  };

  const renderFeatures = (block) => {
    const items = Array.isArray(block.content?.items) ? block.content.items : highlights;
    if (!items.length) return '';
    return `<section class="rounded-[26px] bg-white p-6 shadow-sm"><p class="text-xs uppercase tracking-[0.24em] text-slate-500">${escapeHtml(block.label || 'Highlights')}</p><h2 class="mt-3 text-3xl font-semibold text-slate-950">${escapeHtml(block.content?.heading || 'Highlights')}</h2><p class="mt-3 max-w-2xl text-slate-600">${escapeHtml(block.content?.body || '')}</p><div class="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">${items.map((item, index) => `<article class="rounded-[20px] border border-slate-200 p-4"><p class="text-xs uppercase tracking-[0.24em] text-slate-500">${escapeHtml(String(index + 1).padStart(2, '0'))}</p><h3 class="mt-2 text-lg font-semibold text-slate-900">${escapeHtml(item.title || '')}</h3><p class="mt-2 text-sm leading-6 text-slate-600">${escapeHtml(item.body || '')}</p></article>`).join('')}</div></section>`;
  };

  const renderRich = (block) => `<section class="rounded-[26px] bg-white p-6 shadow-sm"><p class="text-xs uppercase tracking-[0.24em] text-slate-500">${escapeHtml(block.label || '')}</p><h2 class="mt-3 text-3xl font-semibold text-slate-950">${escapeHtml(block.content?.heading || block.label || '')}</h2><div class="mt-4 text-base leading-8 text-slate-700">${renderRichText(block.content?.body || description)}</div></section>`;

  const renderItinerary = (block) => {
    const items = Array.isArray(block.content?.items) ? block.content.items : itinerary;
    if (!items.length) return '';
    if (profile.itinerary === 'numbered') {
      return `<section class="rounded-[26px] bg-white p-6 shadow-sm"><h2 class="text-3xl font-semibold text-slate-950">${escapeHtml(block.content?.heading || 'Itinerary')}</h2><div class="mt-6 grid gap-4 md:grid-cols-2">${items.map((item, index) => `<article class="rounded-[22px] border border-slate-200 p-5"><p class="text-xs uppercase tracking-[0.24em] text-slate-500">Stage ${escapeHtml(String(index + 1))}</p><h3 class="mt-3 text-xl font-semibold text-slate-900">${escapeHtml(item.title || '')}</h3><p class="mt-1 text-sm text-slate-500">${escapeHtml(item.day_label || '')}</p><p class="mt-3 text-sm leading-7 text-slate-600">${escapeHtml(item.description || '')}</p></article>`).join('')}</div></section>`;
    }
    if (profile.itinerary === 'service-steps' || profile.itinerary === 'feature-list') {
      return `<section class="rounded-[26px] bg-white p-6 shadow-sm"><h2 class="text-3xl font-semibold text-slate-950">${escapeHtml(block.content?.heading || 'Service flow')}</h2><div class="mt-6 space-y-3">${items.map((item, index) => `<div class="flex gap-4 rounded-[18px] bg-slate-50 p-4"><div class="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white" style="background:${escapeHtml(primaryColor)}">${escapeHtml(String(index + 1))}</div><div><h3 class="text-lg font-semibold text-slate-900">${escapeHtml(item.title || '')}</h3><p class="mt-1 text-sm leading-6 text-slate-600">${escapeHtml(item.description || '')}</p></div></div>`).join('')}</div></section>`;
    }
    return `<section class="rounded-[26px] bg-white p-6 shadow-sm"><h2 class="text-3xl font-semibold text-slate-950">${escapeHtml(block.content?.heading || 'Itinerary')}</h2><div class="mt-6 space-y-5 border-l-2 border-slate-200 pl-6">${items.map((item) => `<article class="relative"><span class="absolute -left-[33px] top-2 h-4 w-4 rounded-full" style="background:${escapeHtml(secondaryColor)}"></span><h3 class="text-xl font-semibold text-slate-900">${escapeHtml(item.title || '')}</h3><p class="mt-1 text-sm text-slate-500">${escapeHtml(item.day_label || '')}</p><p class="mt-3 text-sm leading-7 text-slate-600">${escapeHtml(item.description || '')}</p></article>`).join('')}</div></section>`;
  };

  const renderPricing = (block) => {
    const cards = Array.isArray(block.content?.price_cards) ? block.content.price_cards : priceCards;
    if (!cards.length) return '';
    if (profile.pricing === 'table') {
      return `<section id="pricing" class="overflow-hidden rounded-[26px] bg-white shadow-sm"><div class="border-b border-slate-200 px-6 py-5"><h2 class="text-3xl font-semibold text-slate-950">${escapeHtml(block.content?.heading || 'Pricing')}</h2></div><div class="overflow-x-auto"><table class="min-w-full text-sm"><thead class="bg-slate-50 text-left text-slate-500"><tr><th class="px-6 py-3">Segment</th><th class="px-6 py-3">Season</th><th class="px-6 py-3">Pax</th><th class="px-6 py-3">Shared</th><th class="px-6 py-3">Single</th></tr></thead><tbody>${cards.map((card) => `<tr class="border-t border-slate-100"><td class="px-6 py-4 font-medium text-slate-900">${escapeHtml(card.segment_name || card.segment_code || '')}</td><td class="px-6 py-4 text-slate-600">${escapeHtml(card.season_name || '')}</td><td class="px-6 py-4 text-slate-600">${escapeHtml(card.pax_range_label || '')}</td><td class="px-6 py-4 text-slate-900">${escapeHtml(String(card.adult_shared_room_price ?? 'n/a'))}</td><td class="px-6 py-4 text-slate-900">${escapeHtml(String(card.adult_single_room_price ?? 'n/a'))}</td></tr>`).join('')}</tbody></table></div></section>`;
    }
    if (profile.pricing === 'sidebar' || profile.pricing === 'spotlight') {
      return `<section id="pricing" class="grid gap-4 lg:grid-cols-[0.7fr_1.3fr]"><article class="rounded-[26px] p-6 text-white shadow-sm" style="background:linear-gradient(135deg, ${escapeHtml(primaryColor)}, ${escapeHtml(secondaryColor)})"><p class="text-xs uppercase tracking-[0.24em] text-white/70">${escapeHtml(block.content?.price_from_label || 'From')}</p><p class="mt-4 text-5xl font-semibold">${escapeHtml(snapshot?.price_from != null ? `$${snapshot.price_from}` : 'Quote')}</p><p class="mt-4 text-sm text-white/78">Live price spotlight powered by canonical tour pricing.</p></article><article class="rounded-[26px] bg-white p-6 shadow-sm"><div class="grid gap-4 md:grid-cols-2">${cards.map((card) => `<div class="rounded-[20px] border border-slate-200 p-4"><h3 class="font-semibold text-slate-900">${escapeHtml(card.segment_name || card.segment_code || '')}</h3><p class="mt-1 text-sm text-slate-500">${escapeHtml(card.season_name || '')} • ${escapeHtml(card.pax_range_label || '')}</p><p class="mt-3 text-sm text-slate-700">Shared room: ${escapeHtml(String(card.adult_shared_room_price ?? 'n/a'))}</p><p class="text-sm text-slate-700">Single room: ${escapeHtml(String(card.adult_single_room_price ?? 'n/a'))}</p></div>`).join('')}</div></article></section>`;
    }
    return `<section id="pricing" class="rounded-[26px] bg-white p-6 shadow-sm"><h2 class="text-3xl font-semibold text-slate-950">${escapeHtml(block.content?.heading || 'Pricing')}</h2><div class="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">${cards.map((card) => `<article class="rounded-[20px] border border-slate-200 p-4"><h3 class="font-semibold text-slate-900">${escapeHtml(card.segment_name || card.segment_code || '')}</h3><p class="mt-1 text-sm text-slate-500">${escapeHtml(card.season_name || '')} • ${escapeHtml(card.pax_range_label || '')}</p><p class="mt-3 text-sm text-slate-700">Shared: ${escapeHtml(String(card.adult_shared_room_price ?? 'n/a'))}</p><p class="text-sm text-slate-700">Single: ${escapeHtml(String(card.adult_single_room_price ?? 'n/a'))}</p></article>`).join('')}</div></section>`;
  };

  const renderContact = (block) => {
    const channels = siteBundle.contacts?.channels || {};
    const visibleChannels = Object.entries(channels).filter(([, value]) => value?.enabled && value?.value);
    return `<section class="rounded-[26px] bg-white p-6 shadow-sm"><h2 class="text-3xl font-semibold text-slate-950">${escapeHtml(block.content?.heading || 'Contact')}</h2><p class="mt-3 text-slate-600">${escapeHtml(block.content?.body || '')}</p><div class="mt-6 grid gap-3 md:grid-cols-2">${visibleChannels.length ? visibleChannels.map(([key, value]) => `<a href="${escapeHtml(value.value)}" class="rounded-[18px] border border-slate-200 px-4 py-4 text-sm font-medium text-slate-900">${escapeHtml(key)}: ${escapeHtml(value.value)}</a>`).join('') : '<p class="text-slate-500">No contact channels configured yet.</p>'}</div></section>`;
  };

  const renderListing = (block) => `<section class="rounded-[26px] bg-white p-6 shadow-sm"><h2 class="text-3xl font-semibold text-slate-950">${escapeHtml(block.content?.heading || 'Collection')}</h2><p class="mt-3 max-w-2xl text-slate-600">${escapeHtml(block.content?.body || '')}</p><div class="mt-6 rounded-[20px] border border-dashed border-slate-300 p-6 text-sm text-slate-500">Listing data binding placeholder: ${escapeHtml(block.data_bindings?.cards?.source || 'runtime collection')}</div></section>`;
  const renderBookingSlot = (block) => `<section class="rounded-[26px] p-6 text-white shadow-sm" style="background:linear-gradient(135deg, ${escapeHtml(primaryColor)}, ${escapeHtml(secondaryColor)})"><h2 class="text-3xl font-semibold">${escapeHtml(block.content?.heading || 'Booking')}</h2><p class="mt-3 max-w-2xl text-white/80">${escapeHtml(block.content?.body || '')}</p><a href="#" class="mt-6 inline-flex rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950">${escapeHtml(block.content?.cta_label || 'Continue')}</a></section>`;

  const renderedBlocks = blocks.map((block) => {
    switch (block.type) {
      case 'hero': return renderHero(block);
      case 'gallery': return renderGallery(block);
      case 'features': return renderFeatures(block);
      case 'rich_text':
      case 'legal': return renderRich(block);
      case 'itinerary': return renderItinerary(block);
      case 'pricing_spotlight': return renderPricing(block);
      case 'contact': return renderContact(block);
      case 'listing':
      case 'reservation_entry':
      case 'booking_entry': return renderListing(block);
      case 'booking_engine_slot': return renderBookingSlot(block);
      default: return '';
    }
  }).filter(Boolean).join('<div class="h-6"></div>');

  return `<!DOCTYPE html>
<html lang="${escapeHtml(site.default_lang || 'en')}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:type" content="website">
  <meta property="og:image" content="${escapeHtml(ogImage)}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="canonical" href="${escapeHtml(canonicalPath)}">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    :root {
      --color-primary: ${escapeHtml(primaryColor)};
      --color-secondary: ${escapeHtml(secondaryColor)};
      --color-surface: ${escapeHtml(surfaceColor)};
      --color-text: ${escapeHtml(textColor)};
    }
    body { background: var(--color-surface); color: var(--color-text); font-family: ${escapeHtml(theme.fontBody || 'Inter, system-ui, sans-serif')}; }
    h1, h2, h3 { font-family: ${escapeHtml(theme.fontHeading || 'Inter, system-ui, sans-serif')}; }
  </style>
</head>
<body class="min-h-screen ${escapeHtml(profile.shell || 'universal-shell')}">
  <header class="sticky top-0 z-30 border-b border-slate-200/70 bg-white/90 backdrop-blur">
    <div class="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
      <div>
        <p class="text-xs uppercase tracking-[0.24em] text-slate-500">${escapeHtml(site.site_name || 'Travel')}</p>
        <p class="text-lg font-semibold text-slate-900">${escapeHtml(title)}</p>
      </div>
      <a href="#pricing" class="rounded-full px-4 py-2 text-sm font-medium text-white" style="background:${escapeHtml(primaryColor)}">${escapeHtml(snapshot?.booking_cta_label || 'Enquire')}</a>
    </div>
  </header>
  <main class="mx-auto max-w-6xl px-4 py-8 sm:px-6">
    ${renderedBlocks || `<section class="rounded-[26px] bg-white p-6 shadow-sm"><h1 class="text-3xl font-semibold text-slate-950">${escapeHtml(title)}</h1><p class="mt-4 text-slate-600">${escapeHtml(description)}</p></section>`}
  </main>
</body>
</html>`;
}

async function requireTenant(c) {
  const tenantId = getTenantId(c);
  if (!tenantId) {
    return { error: jsonError(c, 400, 'X-Tenant-ID header is required') };
  }

  const tenant = await c.env.DB
    .prepare('SELECT id, name, template_id, site_config FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();

  if (!tenant) {
    return { error: jsonError(c, 404, 'Tenant not found') };
  }

  return { tenantId, tenant };
}

async function listPages(tenantId, db) {
  const { results } = await db
    .prepare(
      `SELECT *
       FROM tenant_universal_pages
       WHERE tenant_id = ?
       ORDER BY CASE page_type
         WHEN 'standard' THEN 0
         WHEN 'legal' THEN 1
         WHEN 'custom' THEN 2
         WHEN 'tour_detail' THEN 3
         ELSE 9 END,
       created_at ASC`
    )
    .bind(tenantId)
    .all();

  return results.map(normalizePage);
}

async function listMenuItems(tenantId, db) {
  const { results } = await db
    .prepare(
      `SELECT *
       FROM tenant_universal_menu_items
       WHERE tenant_id = ?
       ORDER BY sort_order ASC, created_at ASC`
    )
    .bind(tenantId)
    .all();

  return results.map(normalizeMenuItem);
}

function validateVariant(groupKey, variantKey) {
  if (!UNIVERSAL_GROUPS[groupKey]) {
    return 'group_key is invalid';
  }
  const variant = getVariantByKey(variantKey);
  if (!variant || variant.groupKey !== groupKey) {
    return 'variant_key is invalid for the selected group_key';
  }
  return null;
}

function validateMenuPayload(items) {
  if (!Array.isArray(items) || !items.length) {
    return 'items must be a non-empty array';
  }

  for (const [index, item] of items.entries()) {
    if (!item.item_key || !item.label || typeof item.href !== 'string') {
      return `menu item ${index} must include item_key, label, and href`;
    }
    if (item.target && !VALID_TARGETS.has(item.target)) {
      return `menu item ${index} target must be _self or _blank`;
    }
  }

  return null;
}

async function getSiteBundle(tenantId, tenant, db) {
  const siteRow = await ensureUniversalSiteInitialized(db, tenantId, tenant.name);
  const themeRow = await db.prepare('SELECT * FROM tenant_universal_theme_tokens WHERE tenant_id = ?').bind(tenantId).first();
  const contactsRow = await db.prepare('SELECT * FROM tenant_universal_contacts WHERE tenant_id = ?').bind(tenantId).first();
  const runtime = buildVariantRuntimeConfig(siteRow.group_key, siteRow.variant_key);
  const site = normalizeSite(siteRow);
  const theme = normalizeTheme(themeRow);
  const contacts = normalizeContacts(contactsRow);
  const menu = await listMenuItems(tenantId, db);
  const pages = await listPages(tenantId, db);

  return {
    site,
    theme,
    contacts,
    menu,
    pages,
    ...buildEditorStoreBundle({ site, theme, contacts, menu, pages, runtime }),
    groups: Object.values(UNIVERSAL_GROUPS),
    variants: UNIVERSAL_VARIANTS,
    legacy: {
      site_studio_present: Boolean(tenant.template_id || tenant.site_config),
      mode: 'legacy-preserved',
    },
  };
}

function validateThemePayload(tokens) {
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) {
    return 'theme must be an object';
  }

  const colorFields = ['colorPrimary', 'colorSecondary', 'colorAccent', 'colorSurface', 'colorText'];
  for (const field of colorFields) {
    if (field in tokens && typeof tokens[field] !== 'string') {
      return `${field} must be a string`;
    }
  }

  if ('logoUrl' in tokens && typeof tokens.logoUrl !== 'string') {
    return 'logoUrl must be a string';
  }

  return null;
}

function validateContactsPayload(contacts) {
  if (!contacts || typeof contacts !== 'object' || Array.isArray(contacts)) {
    return 'contacts must be an object';
  }

  if (contacts.contactForm && typeof contacts.contactForm !== 'object') {
    return 'contactForm must be an object';
  }

  if (contacts.channels && typeof contacts.channels !== 'object') {
    return 'channels must be an object';
  }

  return null;
}

function validatePageUpdates(pageUpdates) {
  if (!Array.isArray(pageUpdates)) {
    return 'pages must be an array';
  }

  for (const [index, page] of pageUpdates.entries()) {
    if (!page.id && !page.page_key) {
      return `pages[${index}] must include id or page_key`;
    }
    if ('status' in page && !VALID_PAGE_STATUS.has(page.status)) {
      return `pages[${index}].status is invalid`;
    }
    if ('blocks' in page && !Array.isArray(page.blocks)) {
      return `pages[${index}].blocks must be an array`;
    }
    if ('seo' in page && (!page.seo || typeof page.seo !== 'object' || Array.isArray(page.seo))) {
      return `pages[${index}].seo must be an object`;
    }
  }

  return null;
}

function normalizePatchPayload(body) {
  if (!body?.editor_model) {
    return body;
  }

  const editorModel = body.editor_model;
  return {
    ...body,
    site: editorModel.site,
    theme: editorModel.theme,
    contacts: editorModel.contacts,
    menu: editorModel.menu,
    pages: Object.values(editorModel.pages?.by_key || {}).map((page) => ({
      id: page.id,
      page_key: page.page_key,
      title: page.title,
      slug: page.slug,
      status: page.status,
      visible: page.visible,
      blocks: Object.values(page.blocks || {}),
      seo: page.seo,
    })),
  };
}

async function persistBootstrapBundle(db, tenantId, tenantName, bootstrap) {
  await ensureUniversalSiteInitialized(db, tenantId, tenantName);

  const now = Math.floor(Date.now() / 1000);
  const statements = [
    db.prepare(
      `UPDATE tenant_universal_sites
       SET group_key = ?, variant_key = ?, status = ?, site_name = ?, default_lang = ?, home_page_key = ?, updated_at = ?
       WHERE tenant_id = ?`
    ).bind(
      bootstrap.site.group_key,
      bootstrap.site.variant_key,
      bootstrap.site.status || 'draft',
      bootstrap.site.site_name,
      bootstrap.site.default_lang || 'en',
      bootstrap.site.home_page_key || 'home',
      now,
      tenantId,
    ),
    db.prepare('UPDATE tenant_universal_theme_tokens SET tokens_json = ?, updated_at = ? WHERE tenant_id = ?')
      .bind(JSON.stringify(bootstrap.theme), now, tenantId),
    db.prepare('UPDATE tenant_universal_contacts SET channels_json = ?, updated_at = ? WHERE tenant_id = ?')
      .bind(JSON.stringify(bootstrap.contacts), now, tenantId),
    db.prepare('DELETE FROM tenant_universal_menu_items WHERE tenant_id = ?').bind(tenantId),
  ];

  for (const page of bootstrap.pages) {
    statements.push(
      db.prepare('DELETE FROM tenant_universal_pages WHERE tenant_id = ? AND page_key = ?')
        .bind(tenantId, page.page_key)
    );
  }

  for (const [index, item] of bootstrap.menu.entries()) {
    statements.push(
      db.prepare(
        `INSERT INTO tenant_universal_menu_items
         (id, tenant_id, item_key, label, href, page_key, target, is_external, visible, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        nanoid(),
        tenantId,
        item.item_key,
        item.label,
        item.href,
        item.page_key || null,
        item.target || '_self',
        item.is_external ? 1 : 0,
        item.visible === false ? 0 : 1,
        Number.isFinite(item.sort_order) ? Number(item.sort_order) : index,
        now,
        now,
      )
    );
  }

  for (const page of bootstrap.pages) {
    statements.push(
      db.prepare(
        `INSERT INTO tenant_universal_pages
         (id, tenant_id, page_key, title, slug, page_type, status, visible, blocks_json, seo_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        nanoid(),
        tenantId,
        page.page_key,
        page.title,
        page.slug,
        page.page_type,
        page.status || 'draft',
        page.visible === false ? 0 : 1,
        JSON.stringify(page.blocks || []),
        JSON.stringify(page.seo || {}),
        now,
        now,
      )
    );
  }

  await db.batch(statements);
}

router.get('/health', async (c) => {
  return c.json({ ok: true, system: 'universal-site', mode: 'parallel-with-legacy' });
});

router.get('/site/variants', async (c) => {
  return c.json({ ok: true, groups: Object.values(UNIVERSAL_GROUPS), variants: UNIVERSAL_VARIANTS });
});

router.get('/site/bootstrap', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  return c.json({ ok: true, ...(await getSiteBundle(ctx.tenantId, ctx.tenant, c.env.DB)) });
});

router.post('/site/bootstrap', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;

  let body;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, 'Invalid JSON body');
  }

  const description = String(body.description || '').trim();
  if (!description) {
    return jsonError(c, 400, 'description is required');
  }

  const bootstrap = buildUniversalBootstrapMock(description, body.site_name || ctx.tenant.name);
  bootstrap.site.tenant_id = ctx.tenantId;
  bootstrap.pages = bootstrap.pages.map((page) => ({ ...page, tenant_id: ctx.tenantId }));
  bootstrap.editor_model.site.tenant_id = ctx.tenantId;
  bootstrap.editor_model.pages.items = bootstrap.editor_model.pages.items.map((page) => ({ ...page, tenant_id: ctx.tenantId }));
  for (const page of Object.values(bootstrap.editor_model.pages.by_key || {})) {
    page.tenant_id = ctx.tenantId;
  }

  if (body.persist === true) {
    await persistBootstrapBundle(c.env.DB, ctx.tenantId, ctx.tenant.name, bootstrap);
    await purgeTenantPublicCache(c.env.DB, ctx.tenantId);
    return c.json({ ok: true, persisted: true, ...(await getSiteBundle(ctx.tenantId, ctx.tenant, c.env.DB)), recommendation: bootstrap.recommendation });
  }

  return c.json({ ok: true, ...bootstrap });
});

router.get('/site/config', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  return c.json({ ok: true, ...(await getSiteBundle(ctx.tenantId, ctx.tenant, c.env.DB)) });
});

router.patch('/site/config', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;

  const current = await ensureUniversalSiteInitialized(c.env.DB, ctx.tenantId, ctx.tenant.name);

  let body;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, 'Invalid JSON body');
  }

  body = normalizePatchPayload(body);

  const sitePatch = body.site && typeof body.site === 'object' ? body.site : body;

  const nextGroupKey = sitePatch.group_key || current.group_key;
  const nextVariantKey = sitePatch.variant_key || current.variant_key;
  const variantError = validateVariant(nextGroupKey, nextVariantKey);
  if (variantError) return jsonError(c, 400, variantError);

  if (sitePatch.status && !VALID_SITE_STATUS.has(sitePatch.status)) {
    return jsonError(c, 400, 'status must be draft, active, or archived');
  }

  if (body.theme) {
    const themeError = validateThemePayload(body.theme);
    if (themeError) return jsonError(c, 400, themeError);
  }

  if (body.contacts) {
    const contactsError = validateContactsPayload(body.contacts);
    if (contactsError) return jsonError(c, 400, contactsError);
  }

  if (body.menu?.items) {
    const menuError = validateMenuPayload(body.menu.items);
    if (menuError) return jsonError(c, 400, menuError);
  }

  if (body.pages) {
    const pagesError = validatePageUpdates(body.pages);
    if (pagesError) return jsonError(c, 400, pagesError);
  }

  const updates = [];
  const binds = [];
  const setValue = (column, value) => {
    if (value === undefined) return;
    updates.push(`${column} = ?`);
    binds.push(typeof value === 'string' ? value.trim() : value);
  };

  setValue('group_key', sitePatch.group_key);
  setValue('variant_key', sitePatch.variant_key);
  setValue('status', sitePatch.status);
  setValue('site_name', sitePatch.site_name);
  setValue('default_lang', sitePatch.default_lang);
  setValue('home_page_key', sitePatch.home_page_key);

  if (!updates.length && body.reset_theme !== true && !body.theme && !body.contacts && !body.menu?.items && !body.pages) {
    return jsonError(c, 400, 'No valid fields provided');
  }

  if (updates.length) {
    updates.push('updated_at = ?');
    binds.push(Math.floor(Date.now() / 1000), ctx.tenantId);
    await c.env.DB.prepare(`UPDATE tenant_universal_sites SET ${updates.join(', ')} WHERE tenant_id = ?`).bind(...binds).run();
  }

  if (body.reset_theme === true || sitePatch.group_key || sitePatch.variant_key) {
    const tokens = buildDefaultThemeTokens(nextGroupKey, nextVariantKey);
    await c.env.DB
      .prepare('UPDATE tenant_universal_theme_tokens SET tokens_json = ?, updated_at = ? WHERE tenant_id = ?')
      .bind(JSON.stringify(tokens), Math.floor(Date.now() / 1000), ctx.tenantId)
      .run();
  } else if (body.theme) {
    await c.env.DB
      .prepare('UPDATE tenant_universal_theme_tokens SET tokens_json = ?, updated_at = ? WHERE tenant_id = ?')
      .bind(JSON.stringify(body.theme), Math.floor(Date.now() / 1000), ctx.tenantId)
      .run();
  }

  if (body.contacts) {
    await c.env.DB
      .prepare('UPDATE tenant_universal_contacts SET channels_json = ?, updated_at = ? WHERE tenant_id = ?')
      .bind(JSON.stringify(body.contacts), Math.floor(Date.now() / 1000), ctx.tenantId)
      .run();
  }

  if (body.menu?.items) {
    const now = Math.floor(Date.now() / 1000);
    const menuStatements = [
      c.env.DB.prepare('DELETE FROM tenant_universal_menu_items WHERE tenant_id = ?').bind(ctx.tenantId),
    ];

    for (const [index, item] of body.menu.items.entries()) {
      menuStatements.push(
        c.env.DB.prepare(
          `INSERT INTO tenant_universal_menu_items
           (id, tenant_id, item_key, label, href, page_key, target, is_external, visible, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          item.id || nanoid(),
          ctx.tenantId,
          item.item_key,
          item.label,
          item.href,
          item.page_key || null,
          item.target || '_self',
          item.is_external ? 1 : 0,
          item.visible === false ? 0 : 1,
          Number.isFinite(item.sort_order) ? Number(item.sort_order) : index,
          now,
          now,
        ),
      );
    }

    await c.env.DB.batch(menuStatements);
  }

  if (body.pages) {
    const now = Math.floor(Date.now() / 1000);
    for (const page of body.pages) {
      const pageRefValue = page.id || page.page_key;
      const pageRefColumn = page.id ? 'id' : 'page_key';
      const pageUpdates = [];
      const pageBinds = [];

      if ('title' in page) {
        pageUpdates.push('title = ?');
        pageBinds.push(String(page.title || '').trim());
      }
      if ('slug' in page) {
        const slug = slugify(page.slug);
        if (!slug) return jsonError(c, 400, `slug is invalid for page ${pageRefValue}`);
        pageUpdates.push('slug = ?');
        pageBinds.push(slug);
      }
      if ('status' in page) {
        pageUpdates.push('status = ?');
        pageBinds.push(page.status);
      }
      if ('visible' in page) {
        pageUpdates.push('visible = ?');
        pageBinds.push(page.visible ? 1 : 0);
      }
      if ('blocks' in page) {
        pageUpdates.push('blocks_json = ?');
        pageBinds.push(JSON.stringify(page.blocks));
      }
      if ('seo' in page) {
        pageUpdates.push('seo_json = ?');
        pageBinds.push(JSON.stringify(page.seo));
      }

      if (!pageUpdates.length) {
        continue;
      }

      pageUpdates.push('updated_at = ?');
      pageBinds.push(now, pageRefValue, ctx.tenantId);
      await c.env.DB.prepare(
        `UPDATE tenant_universal_pages SET ${pageUpdates.join(', ')} WHERE ${pageRefColumn} = ? AND tenant_id = ?`
      ).bind(...pageBinds).run();
    }
  }

  if (sitePatch.group_key || sitePatch.variant_key || body.theme || body.pages) {
    await purgeTenantPublicCache(c.env.DB, ctx.tenantId);
  }

  return c.json({ ok: true, ...(await getSiteBundle(ctx.tenantId, ctx.tenant, c.env.DB)) });
});

router.get('/site/theme', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  await ensureUniversalSiteInitialized(c.env.DB, ctx.tenantId, ctx.tenant.name);

  const row = await c.env.DB.prepare('SELECT * FROM tenant_universal_theme_tokens WHERE tenant_id = ?').bind(ctx.tenantId).first();
  return c.json({ ok: true, tokens: normalizeTheme(row) });
});

router.put('/site/theme', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  await ensureUniversalSiteInitialized(c.env.DB, ctx.tenantId, ctx.tenant.name);

  let body;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, 'Invalid JSON body');
  }

  const tokens = body.tokens;
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) {
    return jsonError(c, 400, 'tokens must be an object');
  }

  await c.env.DB
    .prepare('UPDATE tenant_universal_theme_tokens SET tokens_json = ?, updated_at = ? WHERE tenant_id = ?')
    .bind(JSON.stringify(tokens), Math.floor(Date.now() / 1000), ctx.tenantId)
    .run();

  return c.json({ ok: true, tokens });
});

router.get('/site/contact', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  await ensureUniversalSiteInitialized(c.env.DB, ctx.tenantId, ctx.tenant.name);

  const row = await c.env.DB.prepare('SELECT * FROM tenant_universal_contacts WHERE tenant_id = ?').bind(ctx.tenantId).first();
  return c.json({ ok: true, contacts: normalizeContacts(row) });
});

router.put('/site/contact', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  await ensureUniversalSiteInitialized(c.env.DB, ctx.tenantId, ctx.tenant.name);

  let body;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, 'Invalid JSON body');
  }

  const contacts = body.contacts;
  if (!contacts || typeof contacts !== 'object' || Array.isArray(contacts)) {
    return jsonError(c, 400, 'contacts must be an object');
  }

  await c.env.DB
    .prepare('UPDATE tenant_universal_contacts SET channels_json = ?, updated_at = ? WHERE tenant_id = ?')
    .bind(JSON.stringify(contacts), Math.floor(Date.now() / 1000), ctx.tenantId)
    .run();

  return c.json({ ok: true, contacts });
});

router.get('/site/menu', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  await ensureUniversalSiteInitialized(c.env.DB, ctx.tenantId, ctx.tenant.name);
  return c.json({ ok: true, items: await listMenuItems(ctx.tenantId, c.env.DB) });
});

router.put('/site/menu', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  const site = await ensureUniversalSiteInitialized(c.env.DB, ctx.tenantId, ctx.tenant.name);

  let body;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, 'Invalid JSON body');
  }

  const items = body.items;
  const payloadError = validateMenuPayload(items);
  if (payloadError) return jsonError(c, 400, payloadError);

  const now = Math.floor(Date.now() / 1000);
  const statements = [
    c.env.DB.prepare('DELETE FROM tenant_universal_menu_items WHERE tenant_id = ?').bind(ctx.tenantId),
  ];

  for (const [index, item] of items.entries()) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO tenant_universal_menu_items
         (id, tenant_id, item_key, label, href, page_key, target, is_external, visible, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        item.id || nanoid(),
        ctx.tenantId,
        item.item_key,
        item.label,
        item.href,
        item.page_key || null,
        item.target || '_self',
        item.is_external ? 1 : 0,
        item.visible === false ? 0 : 1,
        Number.isFinite(item.sort_order) ? Number(item.sort_order) : index,
        now,
        now,
      ),
    );
  }

  await c.env.DB.batch(statements);

  if (body.reset_to_variant_defaults === true) {
    const defaults = buildDefaultMenuItems(site.group_key, site.variant_key);
    const resetStatements = [
      c.env.DB.prepare('DELETE FROM tenant_universal_menu_items WHERE tenant_id = ?').bind(ctx.tenantId),
    ];
    for (const [index, item] of defaults.entries()) {
      resetStatements.push(
        c.env.DB.prepare(
          `INSERT INTO tenant_universal_menu_items
           (id, tenant_id, item_key, label, href, page_key, target, is_external, visible, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          nanoid(),
          ctx.tenantId,
          item.itemKey,
          item.label,
          item.href,
          item.pageKey,
          item.target,
          item.isExternal,
          item.visible,
          index,
          now,
          now,
        ),
      );
    }
    await c.env.DB.batch(resetStatements);
  }

  return c.json({ ok: true, items: await listMenuItems(ctx.tenantId, c.env.DB) });
});

router.get('/site/pages', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  await ensureUniversalSiteInitialized(c.env.DB, ctx.tenantId, ctx.tenant.name);
  return c.json({ ok: true, pages: await listPages(ctx.tenantId, c.env.DB) });
});

router.post('/site/pages', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  await ensureUniversalSiteInitialized(c.env.DB, ctx.tenantId, ctx.tenant.name);

  let body;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, 'Invalid JSON body');
  }

  const title = String(body.title || '').trim();
  const slug = slugify(body.slug || title);
  const pageType = body.page_type || 'custom';
  const status = body.status || 'draft';
  const pageKey = slugify(body.page_key || `custom-${title}`);

  if (!title) return jsonError(c, 400, 'title is required');
  if (!slug) return jsonError(c, 400, 'slug is required');
  if (!pageKey) return jsonError(c, 400, 'page_key is required');
  if (!VALID_PAGE_TYPES.has(pageType)) return jsonError(c, 400, 'page_type is invalid');
  if (!VALID_PAGE_STATUS.has(status)) return jsonError(c, 400, 'status is invalid');

  const now = Math.floor(Date.now() / 1000);
  try {
    await c.env.DB.prepare(
      `INSERT INTO tenant_universal_pages
       (id, tenant_id, page_key, title, slug, page_type, status, visible, blocks_json, seo_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      nanoid(),
      ctx.tenantId,
      pageKey,
      title,
      slug,
      pageType,
      status,
      body.visible === false ? 0 : 1,
      JSON.stringify(Array.isArray(body.blocks) ? body.blocks : []),
      JSON.stringify(body.seo && typeof body.seo === 'object' ? body.seo : {}),
      now,
      now,
    ).run();
  } catch (error) {
    if (String(error.message || '').includes('UNIQUE')) {
      return jsonError(c, 409, 'page_key or slug already exists for this tenant');
    }
    throw error;
  }

  return c.json({ ok: true, pages: await listPages(ctx.tenantId, c.env.DB) }, 201);
});

router.patch('/site/pages/:pageId', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  await ensureUniversalSiteInitialized(c.env.DB, ctx.tenantId, ctx.tenant.name);

  let body;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, 'Invalid JSON body');
  }

  const updates = [];
  const binds = [];
  const setValue = (column, value) => {
    if (value === undefined) return;
    updates.push(`${column} = ?`);
    binds.push(value);
  };

  if ('title' in body) {
    const title = String(body.title || '').trim();
    if (!title) return jsonError(c, 400, 'title cannot be empty');
    setValue('title', title);
  }
  if ('slug' in body) {
    const slug = slugify(body.slug);
    if (!slug) return jsonError(c, 400, 'slug is invalid');
    setValue('slug', slug);
  }
  if ('status' in body) {
    if (!VALID_PAGE_STATUS.has(body.status)) return jsonError(c, 400, 'status is invalid');
    setValue('status', body.status);
  }
  if ('visible' in body) {
    setValue('visible', body.visible ? 1 : 0);
  }
  if ('blocks' in body) {
    if (!Array.isArray(body.blocks)) return jsonError(c, 400, 'blocks must be an array');
    setValue('blocks_json', JSON.stringify(body.blocks));
  }
  if ('seo' in body) {
    if (!body.seo || typeof body.seo !== 'object' || Array.isArray(body.seo)) {
      return jsonError(c, 400, 'seo must be an object');
    }
    setValue('seo_json', JSON.stringify(body.seo));
  }

  if (!updates.length) return jsonError(c, 400, 'No valid fields provided');

  updates.push('updated_at = ?');
  binds.push(Math.floor(Date.now() / 1000), c.req.param('pageId'), ctx.tenantId);

  try {
    const result = await c.env.DB.prepare(
      `UPDATE tenant_universal_pages SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`
    ).bind(...binds).run();

    if (!result.meta?.changes) return jsonError(c, 404, 'Page not found');
  } catch (error) {
    if (String(error.message || '').includes('UNIQUE')) {
      return jsonError(c, 409, 'slug already exists for this tenant');
    }
    throw error;
  }

  return c.json({ ok: true, pages: await listPages(ctx.tenantId, c.env.DB) });
});

router.post('/tours/:tourId/page/sync', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;

  const result = await syncUniversalTourPage(c.env, ctx.tenantId, c.req.param('tourId'));
  if (!result.ok) {
    return jsonError(c, result.status || 500, result.error, result.details);
  }

  return c.json(result, result.status);
});

router.get('/tours/:tourId/page', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  await ensureUniversalSiteInitialized(c.env.DB, ctx.tenantId, ctx.tenant.name);

  const row = await c.env.DB
    .prepare('SELECT * FROM tenant_universal_tour_pages WHERE tenant_id = ? AND tour_id = ?')
    .bind(ctx.tenantId, c.req.param('tourId'))
    .first();

  if (!row) {
    return jsonError(c, 404, 'Universal tour page not found. Call sync first.');
  }

  return c.json({
    ok: true,
    tour_page: {
      ...row,
      content_override: parseJsonSafe(row.content_override_json, {}),
      booking_binding: {
        tour_id: c.req.param('tourId'),
        action_id: 'like_this_tour',
        cta_label: row.booking_cta_label,
      },
    },
  });
});

router.get('/render/:tenantId', async (c) => {
  const tenantId = c.req.param('tenantId');
  const callerTenantId = getTenantId(c);
  if (!callerTenantId || callerTenantId !== tenantId) {
    return jsonError(c, 403, 'Forbidden');
  }

  const tenant = await c.env.DB
    .prepare('SELECT id, name, template_id, site_config FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();

  if (!tenant) {
    return jsonError(c, 404, 'Tenant not found');
  }

  const siteBundle = await getSiteBundle(tenantId, tenant, c.env.DB);
  const requestedTourId = c.req.query('tourId')?.trim();

  const tourPageRow = requestedTourId
    ? await c.env.DB
        .prepare('SELECT * FROM tenant_universal_tour_pages WHERE tenant_id = ? AND tour_id = ?')
        .bind(tenantId, requestedTourId)
        .first()
    : await c.env.DB
        .prepare('SELECT * FROM tenant_universal_tour_pages WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT 1')
        .bind(tenantId)
        .first();

  const previewHtml = renderPreviewHtml(siteBundle, tourPageRow ? parseJsonSafe(tourPageRow.content_override_json, {}) : null);
  return new Response(previewHtml, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
});

export default function registerUniversalSiteRoutes(app) {
  app.route('/api/universal', router);

  app.get('/p/:tenantId/:slug', async (c) => {
    const tenantId = c.req.param('tenantId');
    const slug = slugify(c.req.param('slug'));
    if (!tenantId || !slug) {
      return new Response('Not found', { status: 404 });
    }

    const cacheKey = new Request(buildUniversalCacheKeyUrl(tenantId, slug));
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      return cached;
    }

    const tenant = await c.env.DB
      .prepare('SELECT id, name, template_id, site_config FROM tenants WHERE id = ?')
      .bind(tenantId)
      .first();
    if (!tenant) {
      return new Response('Not found', { status: 404 });
    }

    let pageRow = await c.env.DB
      .prepare('SELECT * FROM tenant_universal_pages WHERE tenant_id = ? AND slug = ?')
      .bind(tenantId, slug)
      .first();
    if (!pageRow && slug === 'home') {
      pageRow = await c.env.DB
        .prepare('SELECT * FROM tenant_universal_pages WHERE tenant_id = ? AND slug = ?')
        .bind(tenantId, '')
        .first();
    }
    if (!pageRow) {
      return new Response('Not found', { status: 404 });
    }

    const page = normalizePage(pageRow);
    const siteBundle = await getSiteBundle(tenantId, tenant, c.env.DB);
    const tourPageRow = page.page_type === 'tour_detail'
      ? await c.env.DB
          .prepare('SELECT * FROM tenant_universal_tour_pages WHERE tenant_id = ? AND slug = ?')
          .bind(tenantId, slug)
          .first()
      : null;

    const html = renderPublicHtml(siteBundle, page, tourPageRow ? parseJsonSafe(tourPageRow.content_override_json, {}) : null);
    const response = new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=600',
      },
    });

    c.executionCtx.waitUntil(caches.default.put(cacheKey, response.clone()));
    return response;
  });
}
