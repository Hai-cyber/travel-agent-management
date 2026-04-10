import { nanoid } from 'nanoid';
import {
  buildUniversalCacheKeyUrl,
  buildDefaultSiteScaffold,
  getDefaultCtaLabels,
  buildTourPageKey,
  buildVariantRuntimeConfig,
  slugify,
} from './universalSite.js';

function parseJsonSafe(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function buildStopMeals(stop) {
  const meals = [];
  if (Number(stop.meal_breakfast)) meals.push('Breakfast');
  if (Number(stop.meal_lunch)) meals.push('Lunch');
  if (Number(stop.meal_dinner)) meals.push('Dinner');
  return meals;
}

function normalizeImageItems(content, fallbackTitle) {
  const images = [];
  const gallery = Array.isArray(content.gallery_images) ? content.gallery_images : [];

  for (const entry of gallery) {
    if (typeof entry === 'string' && entry.trim()) {
      images.push({ src: entry.trim(), alt: fallbackTitle || 'Gallery image', caption: '' });
      continue;
    }

    if (entry && typeof entry === 'object' && typeof entry.src === 'string' && entry.src.trim()) {
      images.push({
        src: entry.src.trim(),
        alt: String(entry.alt || fallbackTitle || 'Gallery image'),
        caption: typeof entry.caption === 'string' ? entry.caption : '',
      });
    }
  }

  if (!images.length && typeof content.hero_image === 'string' && content.hero_image.trim()) {
    images.push({ src: content.hero_image.trim(), alt: fallbackTitle || 'Hero image', caption: '' });
  }

  return images;
}

function normalizeHighlights(content, stops) {
  if (Array.isArray(content.highlights) && content.highlights.length) {
    return content.highlights
      .filter((item) => typeof item === 'string' && item.trim())
      .map((item) => ({ title: item.trim(), body: '' }));
  }

  return stops.slice(0, 4).map((stop) => ({
    title: stop.label,
    body: stop.description || '',
  }));
}

function buildItineraryItems(content) {
  if (!Array.isArray(content.itinerary) || !content.itinerary.length) return [];
  return content.itinerary
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry, index) => {
      const dayNumber = Number(entry.day) || (index + 1);
      const dayEnd = Number(entry.day_end) || null;
      const dayLabel = dayEnd && dayEnd > dayNumber ? `Day ${dayNumber}\u2013${dayEnd}` : `Day ${dayNumber}`;
      return {
        id: `content-day-${dayNumber}`,
        title: String(entry.title || dayLabel).trim(),
        day_label: String(entry.day_label || dayLabel).trim(),
        description: String(entry.description || '').trim(),
        nights: 0,
        meals: [],
        day_number: dayNumber,
      };
    })
    .filter((entry) => entry.title || entry.description)
    .sort((left, right) => left.day_number - right.day_number);
}

function buildPricingCards(rows) {
  const seen = new Set();
  const cards = [];
  let priceFrom = null;

  for (const row of rows) {
    const candidateValues = [row.adult_shared_room_price, row.adult_single_room_price]
      .filter((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);

    for (const candidate of candidateValues) {
      if (priceFrom == null || candidate < priceFrom) {
        priceFrom = candidate;
      }
    }

    const key = `${row.segment_id}:${row.season_id}:${row.pax_band_id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    cards.push({
      segment_id: row.segment_id,
      segment_code: row.segment_code,
      segment_name: row.segment_name,
      season_id: row.season_id,
      season_name: row.season_name,
      pax_band_id: row.pax_band_id,
      pax_band_name: row.pax_band_name,
      pax_range_label: row.pax_band_name || `${row.min_pax}-${row.max_pax} pax`,
      adult_shared_room_price: row.adult_shared_room_price,
      adult_single_room_price: row.adult_single_room_price,
      child_shared_with_parents_price: row.child_shared_with_parents_price,
      infant_price: row.infant_price,
    });
  }

  return { cards, priceFrom };
}

function buildHighlightsWithImages(content, stops, images) {
  const rawHighlights = normalizeHighlights(content, stops);
  return rawHighlights.map((h, i) => ({
    ...h,
    image: images[i]?.src || '',
  }));
}

function buildDestinationStops(stops, images) {
  if (!stops.length) return [];
  return stops.map((stop, i) => ({
    name: stop.label,
    day_label: stop.day_from === stop.day_to ? `Day ${stop.day_from}` : `Day ${stop.day_from}–${stop.day_to}`,
    nights: Number(stop.nights || 0),
    description: stop.description || '',
    image: images[i % Math.max(images.length, 1)]?.src || '',
  }));
}

function buildHotelCardsFromRows(hotelRows) {
  return hotelRows
    .filter((h) => h && h.name)
    .map((h) => {
      const gallery = parseJsonSafe(h.gallery_json, []);
      const images = Array.isArray(gallery)
        ? gallery.filter((img) => img?.src).map((img) => ({ src: img.src, alt: img.alt || h.name, caption: img.caption || '' }))
        : [];
      return {
        name: String(h.name || '').trim(),
        images,
        image: images[0]?.src || '',
        location: String(h.address || '').trim(),
        description: String(h.description || '').trim(),
        category: '',
      };
    })
    .filter((h) => h.name);
}

function buildDestinationCatalogCards(destinationRows) {
  return destinationRows
    .filter((d) => d && d.name)
    .map((d) => {
      const gallery = parseJsonSafe(d.gallery_json, []);
      const images = Array.isArray(gallery)
        ? gallery.filter((img) => img?.src).map((img) => ({ src: img.src, alt: img.alt || d.name, caption: img.caption || '' }))
        : [];
      return {
        name: String(d.name || '').trim(),
        region: String(d.region || '').trim(),
        description: String(d.description || '').trim(),
        images,
        image: images[0]?.src || '',
      };
    })
    .filter((d) => d.name);
}

function buildTourSyncSnapshot(tour, stops, pricingRows, hotelRows = [], destinationRows = [], gallerySections = []) {
  const content = parseJsonSafe(tour.content_data, {});
  const ctaDefaults = getDefaultCtaLabels('tour_operator');
  const title = content.tour_name || tour.title;
  const images = normalizeImageItems(content, title);
  const itineraryStops = buildItineraryItems(content);
  const pricing = buildPricingCards(pricingRows);

  return {
    tour_id: tour.id,
    title,
    slug: tour.slug,
    lang: tour.lang || 'vi',
    duration_text: tour.duration_text || content.duration || '',
    summary: content.hero_desc || content.description || content.tour_desc || itineraryStops[0]?.description || '',
    about_section: content.tour_desc || content.description || content.hero_desc || itineraryStops[0]?.description || '',
    hero_image: typeof content.hero_image === 'string' ? content.hero_image : (images[0]?.src || ''),
    gallery_images: images,
    highlights: buildHighlightsWithImages(content, stops, images),
    includes: Array.isArray(content.includes) ? content.includes.filter(Boolean) : [],
    excludes: Array.isArray(content.excludes) ? content.excludes.filter(Boolean) : [],
    itinerary_stops: itineraryStops,
    destination_stops: buildDestinationStops(stops, images),
    destination_catalog_cards: destinationRows.length ? buildDestinationCatalogCards(destinationRows) : [],
    hotel_cards: hotelRows.length ? buildHotelCardsFromRows(hotelRows) : [],
    gallery_sections: gallerySections,
    hotel_cards_fallback: [],  // kept for schema compat
    tour_type: tour.tour_type || 'package',
    pricing_cards: pricing.cards,
    price_from: pricing.priceFrom ?? (typeof content.base_price === 'number' && content.base_price > 0 ? content.base_price : null),
    booking_cta_label: ctaDefaults.booking,
    route_label: itineraryStops.length
      ? `${itineraryStops[0].title} to ${itineraryStops[itineraryStops.length - 1].title}`
      : title,
    start_date: tour.start_date || null,
    content_data: content,
  };
}

function buildTourDetailBlocks(snapshot, variantRuntime) {
  const blocks = JSON.parse(JSON.stringify(variantRuntime.default_config.page_blueprints.tour_detail || []));

  for (const block of blocks) {
    if (block.id === 'hero') {
      block.content.eyebrow = snapshot.duration_text || block.content.eyebrow;
      block.content.headline = snapshot.title;
      block.content.body = snapshot.summary || block.content.body;
      block.content.hero_image = snapshot.hero_image || block.content.hero_image;
      block.content.primary_cta_label = snapshot.booking_cta_label;
      block.content.primary_cta_href = '#booking-engine';
      block.content.secondary_cta_href = '#itinerary';
    } else if (block.id === 'gallery') {
      if (snapshot.gallery_sections?.length) {
        const flatImages = snapshot.gallery_sections.flatMap((s) => s.items);
        block.content.sections = snapshot.gallery_sections;
        block.content.images = flatImages;
      } else {
        block.content.images = snapshot.gallery_images;
      }
    } else if (block.id === 'about') {
      block.content.body = snapshot.about_section;
    } else if (block.id === 'features') {
      block.content.items = snapshot.highlights;
    } else if (block.id === 'itinerary') {
      block.content.items = snapshot.itinerary_stops;
    } else if (block.id === 'pricing') {
      block.content.price_cards = snapshot.pricing_cards;
      block.content.price_from = snapshot.price_from;
    }
  }

  // Append dynamic blocks after the blueprint blocks
  if (snapshot.includes?.length || snapshot.excludes?.length) {
    blocks.push({
      id: 'includes_excludes',
      type: 'includes_excludes',
      label: 'Included & Excluded',
      content: { includes: snapshot.includes, excludes: snapshot.excludes },
    });
  }

  if (snapshot.destination_catalog_cards?.length) {
    blocks.push({
      id: 'destination_carousel',
      type: 'destination_carousel',
      label: 'Destinations',
      content: { items: snapshot.destination_catalog_cards },
    });
  } else if (snapshot.destination_stops?.length > 1) {
    blocks.push({
      id: 'destination_carousel',
      type: 'destination_carousel',
      label: 'Destinations',
      content: { items: snapshot.destination_stops },
    });
  }

  if (snapshot.hotel_cards?.length) {
    blocks.push({
      id: 'hotel_carousel',
      type: 'hotel_carousel',
      label: 'Where You Stay',
      content: { items: snapshot.hotel_cards },
    });
  }

  return blocks;
}

export function syncTourToUniversalPageSlots(snapshot) {
  return {
    page: {
      hero_title: snapshot.title,
      about_section: snapshot.about_section,
      itinerary_timeline: snapshot.itinerary_stops,
      starting_price: snapshot.price_from,
    },
  };
}

async function purgeUniversalPublicCache(slugs) {
  await Promise.allSettled(
    slugs
      .filter(Boolean)
      .map(({ tenantId, slug }) => caches.default.delete(new Request(buildUniversalCacheKeyUrl(tenantId, slug))))
  );
}

export async function ensureUniversalSiteInitialized(db, tenantId, tenantName, preferred = {}) {
  let siteRow = await db
    .prepare('SELECT * FROM tenant_universal_sites WHERE tenant_id = ?')
    .bind(tenantId)
    .first();

  if (siteRow) return siteRow;

  const groupKey = preferred.groupKey || 'tour_operator';
  const variantKey = preferred.variantKey || 'tour-luxury';
  const defaultLang = String(preferred.defaultLang || 'en').trim() || 'en';
  const siteName = tenantName || 'Universal Site';
  const scaffold = buildDefaultSiteScaffold(groupKey, variantKey, defaultLang);
  const now = Math.floor(Date.now() / 1000);

  const statements = [
    db.prepare(
      `INSERT INTO tenant_universal_sites (tenant_id, group_key, variant_key, status, site_name, default_lang, home_page_key, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, ?, 'home', ?, ?)`
     ).bind(tenantId, groupKey, variantKey, siteName, defaultLang, now, now),
    db.prepare(
      `INSERT INTO tenant_universal_theme_tokens (tenant_id, tokens_json, created_at, updated_at)
       VALUES (?, ?, ?, ?)`
    ).bind(tenantId, JSON.stringify(scaffold.themeTokens), now, now),
    db.prepare(
      `INSERT INTO tenant_universal_contacts (tenant_id, channels_json, created_at, updated_at)
       VALUES (?, ?, ?, ?)`
    ).bind(tenantId, JSON.stringify(scaffold.contacts), now, now),
  ];

  for (const page of scaffold.pages) {
    statements.push(
      db.prepare(
        `INSERT INTO tenant_universal_pages
         (id, tenant_id, page_key, title, slug, page_type, status, visible, blocks_json, seo_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        nanoid(),
        tenantId,
        page.pageKey,
        page.title,
        page.slug,
        page.pageType,
        page.status,
        page.visible,
        JSON.stringify(page.blocks || []),
        JSON.stringify(page.seo || {}),
        now,
        now,
      )
    );
  }

  for (const item of scaffold.menuItems) {
    statements.push(
      db.prepare(
        `INSERT INTO tenant_universal_menu_items
         (id, tenant_id, item_key, label, href, page_key, target, is_external, visible, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        nanoid(),
        tenantId,
        item.itemKey,
        item.label,
        item.href,
        item.pageKey,
        item.target,
        item.isExternal,
        item.visible,
        item.sortOrder,
        now,
        now,
      )
    );
  }

  try {
    await db.batch(statements);
  } catch {
    siteRow = await db.prepare('SELECT * FROM tenant_universal_sites WHERE tenant_id = ?').bind(tenantId).first();
    if (siteRow) return siteRow;
    throw new Error('Failed to initialize universal site state');
  }

  siteRow = await db.prepare('SELECT * FROM tenant_universal_sites WHERE tenant_id = ?').bind(tenantId).first();
  return siteRow;
}

export async function syncUniversalTourPage(env, tenantId, tourId) {
  const tenant = await env.DB
    .prepare('SELECT id, name FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();

  if (!tenant) {
    return { ok: false, status: 404, error: 'Tenant not found' };
  }

  const site = await ensureUniversalSiteInitialized(env.DB, tenantId, tenant.name);
  if (site.group_key !== 'tour_operator') {
    return {
      ok: false,
      status: 409,
      error: 'Universal site group is not tour_operator; travel tour sync is disabled for this tenant',
    };
  }

  const tour = await env.DB
    .prepare(
      `SELECT id, tenant_id, title, slug, lang, duration_text, start_date, status, content_data, tour_type
       FROM tours
       WHERE id = ? AND tenant_id = ?`
    )
    .bind(tourId, tenantId)
    .first();

  if (!tour) {
    return { ok: false, status: 404, error: 'Tour not found' };
  }

  const [{ results: stops }, { results: pricingRows }] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, label, day_from, day_to, nights, meal_breakfast, meal_lunch, meal_dinner, description
       FROM tour_stops
       WHERE tour_id = ? AND tenant_id = ?
       ORDER BY sort_order ASC, day_from ASC`
    ).bind(tourId, tenantId),
    env.DB.prepare(
      `SELECT tp.season_id, tp.segment_id, tp.pax_band_id,
              tp.adult_shared_room_price, tp.adult_single_room_price, tp.child_shared_with_parents_price,
              tp.infant_price,
              ts.name AS season_name,
              ps.code AS segment_code,
              ps.name AS segment_name,
              pb.name AS pax_band_name,
              pb.min_pax,
              pb.max_pax
       FROM tour_prices tp
       LEFT JOIN tenant_seasons ts
         ON ts.id = tp.season_id AND ts.tenant_id = tp.tenant_id
       LEFT JOIN pricing_segments ps
         ON ps.id = tp.segment_id AND ps.tenant_id = tp.tenant_id
       LEFT JOIN pax_bands pb
         ON pb.id = tp.pax_band_id AND pb.tenant_id = tp.tenant_id
       WHERE tp.tenant_id = ? AND tp.tour_id = ? AND tp.is_active = 1
       ORDER BY COALESCE(tp.adult_shared_room_price, tp.adult_single_room_price, 999999999) ASC`
    ).bind(tenantId, tourId),
  ]);

  const [{ results: hotelLinkRows }, { results: destinationLinkRows }, { results: libraryLinkRows }] = await env.DB.batch([
    env.DB.prepare(`SELECT h.id, h.name, h.description, h.address, h.gallery_json
              FROM tour_hotel_links thl
              JOIN tenant_universal_hotels h ON h.id = thl.hotel_id
              WHERE thl.tour_id = ? AND thl.tenant_id = ? AND h.status = 'active'
              ORDER BY thl.sort_order ASC, thl.created_at ASC`)
      .bind(tourId, tenantId),
    env.DB.prepare(`SELECT d.id, d.name, d.description, d.region, d.gallery_json
              FROM tour_destination_links tdl
              JOIN tenant_destinations d ON d.id = tdl.destination_id
              WHERE tdl.tour_id = ? AND tdl.tenant_id = ? AND d.status = 'active'
              ORDER BY tdl.sort_order ASC, tdl.created_at ASC`)
      .bind(tourId, tenantId),
    env.DB.prepare(`SELECT tml.section_hint, tml.sort_order, ml.title, ml.items_json
              FROM tour_media_library_links tml
              JOIN tenant_media_libraries ml ON ml.id = tml.library_id
              WHERE tml.tour_id = ? AND tml.tenant_id = ? AND ml.status = 'active'
              ORDER BY tml.sort_order ASC, tml.created_at ASC`)
      .bind(tourId, tenantId),
  ]);

  const destinationRows = destinationLinkRows || [];
  const gallerySections = (libraryLinkRows || []).map((row) => ({
    title: row.title || '',
    section_hint: row.section_hint || '',
    items: parseJsonSafe(row.items_json, []).filter((img) => img?.src),
  })).filter((s) => s.items.length > 0);

  // Fallback: use legacy tour_id-linked hotels if no junction links exist
  let hotelRows = hotelLinkRows || [];
  if (!hotelRows.length) {
    const { results: legacyRows } = await env.DB
      .prepare('SELECT id, name, description, address, gallery_json FROM tenant_universal_hotels WHERE tenant_id = ? AND tour_id = ? AND status = ? ORDER BY sort_order ASC')
      .bind(tenantId, tourId, 'active')
      .all();
    hotelRows = legacyRows || [];
  }

  const variantRuntime = buildVariantRuntimeConfig(site.group_key, site.variant_key);
  const snapshot = buildTourSyncSnapshot(tour, stops, pricingRows, hotelRows || [], destinationRows, gallerySections);
  const slotMapping = syncTourToUniversalPageSlots(snapshot);
  const blocks = buildTourDetailBlocks(snapshot, variantRuntime);
  const now = Math.floor(Date.now() / 1000);
  const pageKey = buildTourPageKey(tourId);
  const existing = await env.DB
    .prepare('SELECT * FROM tenant_universal_tour_pages WHERE tenant_id = ? AND tour_id = ?')
    .bind(tenantId, tourId)
    .first();

  const slugBase = slugify(snapshot.title || tour.title || `tour-${tourId}`) || `tour-${tourId}`;
  const previousSlug = existing?.slug || null;
  const nextSlug = String(existing?.slug || `${slugBase}-${tourId.slice(0, 6).toLowerCase()}`).toLowerCase();
  const publicUrl = `/${nextSlug}`;
  const override = {
    ...parseJsonSafe(existing?.content_override_json, {}),
    sync_snapshot: snapshot,
    slot_mapping: slotMapping,
    public_url: publicUrl,
    last_synced_at: now,
  };

  if (existing) {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE tenant_universal_tour_pages
         SET slug = ?, content_override_json = ?, updated_at = ?
         WHERE tenant_id = ? AND tour_id = ?`
      ).bind(nextSlug, JSON.stringify(override), now, tenantId, tourId),
      env.DB.prepare(
        `UPDATE tenant_universal_pages
         SET title = ?, slug = ?, blocks_json = ?, updated_at = ?
         WHERE tenant_id = ? AND page_key = ?`
      ).bind(snapshot.title, nextSlug, JSON.stringify(blocks), now, tenantId, pageKey),
    ]);
  } else {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO tenant_universal_tour_pages
         (id, tenant_id, tour_id, page_key, slug, status, booking_cta_label, content_override_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`
      ).bind(nanoid(), tenantId, tourId, pageKey, nextSlug, snapshot.booking_cta_label, JSON.stringify(override), now, now),
      env.DB.prepare(
        `INSERT INTO tenant_universal_pages
         (id, tenant_id, page_key, title, slug, page_type, status, visible, blocks_json, seo_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'tour_detail', 'draft', 1, ?, '{}', ?, ?)`
      ).bind(nanoid(), tenantId, pageKey, snapshot.title, nextSlug, JSON.stringify(blocks), now, now),
    ]);
  }

  const synced = await env.DB
    .prepare('SELECT * FROM tenant_universal_tour_pages WHERE tenant_id = ? AND tour_id = ?')
    .bind(tenantId, tourId)
    .first();

  await purgeUniversalPublicCache([
    { tenantId, slug: previousSlug },
    { tenantId, slug: nextSlug },
  ]);

  return {
    ok: true,
    status: existing ? 200 : 201,
    public_url: publicUrl,
    sync_snapshot: snapshot,
    slot_mapping: slotMapping,
    tour_page: {
      ...synced,
      content_override: parseJsonSafe(synced.content_override_json, {}),
      booking_binding: {
        tour_id: tourId,
        action_id: 'like_this_tour',
        cta_label: synced.booking_cta_label,
      },
    },
  };
}
