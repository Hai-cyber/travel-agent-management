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
  getDefaultCtaLabels,
  buildDefaultMenuItems,
  buildDefaultSiteScaffold,
  buildDefaultThemeTokens,
  buildVariantRuntimeConfig,
  getUniversalGroups,
  getUniversalVariants,
  getUniversalSystemCopy,
  localizeUniversalContactLabel,
  localizeUniversalContacts,
  localizeUniversalMenuItems,
  localizeUniversalPages,
  localizeUniversalSystemText,
  resolveThemeCtaLabel,
  getVariantByKey,
  slugify,
} from '../lib/universalSite.js';
import { resolveLocaleFromAcceptLanguage } from '../utils/formatter.js';
import { ensureUniversalSiteInitialized, syncUniversalTourPage } from '../lib/universalSiteSync.js';
import {
  buildInterestDescription,
  getDestinationTaxonomy,
  getInterestDefinition,
  getTourTaxonomy,
  listInterestTaxonomy,
  replaceDestinationTaxonomy,
  replaceTourTaxonomy,
  syncInterestCollectionPages,
  validateInterestPayload,
} from '../lib/interestTaxonomy.js';
import { resolveUniversalTheme } from '../lib/themes/index.js';

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

function mergeNestedObjects(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return base;
  }

  const output = Array.isArray(base) ? [...base] : { ...(base || {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      output[key] = mergeNestedObjects(output[key], value);
      continue;
    }
    output[key] = value;
  }
  return output;
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
    current_theme: siteRow.current_theme || '',
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

function truncateSentences(text, max) {
  if (!text) return '';
  const sentences = String(text).match(/[^.!?]*[.!?]+["')\s]*/g) || [];
  if (!sentences.length) return String(text).trim();
  if (sentences.length <= max) return String(text).trim();
  return sentences.slice(0, max).join('').trim();
}

function normalizeHotel(row) {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    hotel_key: row.hotel_key,
    tour_id: row.tour_id || '',
    name: row.name,
    description: row.description || '',
    address: row.address || '',
    region: row.region || '',
    star_rating: row.star_rating != null ? Number(row.star_rating) : null,
    gallery: parseJsonSafe(row.gallery_json, []),
    status: row.status || 'draft',
    show_on_home: row.show_on_home ? 1 : 0,
    sort_order: Number(row.sort_order || 0),
    created_at: Number(row.created_at || 0),
    updated_at: Number(row.updated_at || 0),
  };
}

function normalizeTourCanonical(row) {
  return row ? {
    ...row,
    content_data: parseJsonSafe(row.content_data, {}),
  } : null;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function serializeDataAttributes(attributes) {
  return Object.entries(attributes || {})
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
    .map(([key, value]) => ` ${key}="${escapeHtml(value)}"`)
    .join('');
}

function buildOptimizedImageUrl(source, width = 1280, fit = 'cover') {
  if (!source || typeof source !== 'string') return '';
  const cleanSource = source.trim();
  if (!cleanSource) return '';
  if (cleanSource.startsWith('data:') || cleanSource.startsWith('/cdn-cgi/image/')) return cleanSource;

  try {
    const absolute = new URL(cleanSource, 'https://tours-market.com');
    const isSameOrigin = absolute.origin === 'https://tours-market.com';
    const isR2Asset = absolute.hostname.endsWith('.r2.dev');
    const isTenantAssetApi = absolute.pathname.startsWith('/api/tenant/assets/');

    if (isTenantAssetApi) {
      return isSameOrigin ? `${absolute.pathname}${absolute.search}` : absolute.href;
    }

    if (/^https?:\/\//i.test(cleanSource) && !isSameOrigin && !isR2Asset) {
      return cleanSource;
    }

    const sourcePath = isSameOrigin ? `${absolute.pathname}${absolute.search}` : absolute.href;
    const normalized = sourcePath.replace(/^\//, '');
    return `/cdn-cgi/image/fit=${fit},width=${width},quality=85,format=auto,metadata=none,anim=false/${normalized}`;
  } catch {
    const originPath = cleanSource.replace(/^\//, '');
    return `/cdn-cgi/image/fit=${fit},width=${width},quality=85,format=auto,metadata=none,anim=false/${originPath}`;
  }
}

function buildResponsiveImageMarkup(source, alt, className, fit = 'cover', sizes = '100vw') {
  const src640 = buildOptimizedImageUrl(source, 640, fit);
  const src960 = buildOptimizedImageUrl(source, 960, fit);
  const src1920 = buildOptimizedImageUrl(source, 1920, fit);
  const fallback = src960 || src1920 || src640 || source;
  return `<img src="${escapeHtml(fallback)}" srcset="${escapeHtml(src640)} 640w, ${escapeHtml(src960)} 960w, ${escapeHtml(src1920)} 1920w" sizes="${escapeHtml(sizes)}" alt="${escapeHtml(alt || '')}" class="${escapeHtml(className)}" loading="lazy" decoding="async" />`;
}

const LUXURY_SAMPLE_HERO_URL = 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=2200&q=80';
const LUXURY_SAMPLE_ACCOMMODATION_IMAGES = [
  'https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80',
];
const HOME_FEATURED_TOUR_CARD_LIMIT = 12;
const HOME_HOTEL_CARD_LIMIT = 12;

function normalizeStringValue(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function parseToggleValue(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return null;

  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
  return null;
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function uniqueBy(items, getKey) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = getKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function deriveTourModuleFlags(content, index) {
  const modules = content?.universal_modules || content?.homepage_modules || content?.site_modules || content?.homepage || {};
  const featured = parseToggleValue(
    modules.featured_tours ?? modules.featured ?? modules.show_in_featured_tours ?? content?.featured_tour ?? content?.is_featured ?? content?.show_in_featured_tours
  );
  const destination = parseToggleValue(
    modules.destinations ?? modules.destination ?? modules.show_in_destinations ?? content?.show_in_destinations ?? content?.destination_featured
  );
  const accommodation = parseToggleValue(
    modules.accommodation ?? modules.show_in_accommodation ?? content?.show_in_accommodation ?? content?.hotel_featured ?? content?.show_stay_cards
  );
  const hero = parseToggleValue(
    modules.hero ?? modules.hero_primary ?? content?.hero_featured ?? content?.show_in_hero
  );
  const homeDestination = parseToggleValue(
    modules.home_destinations ?? modules.show_on_home_destinations ?? content?.show_on_home_destinations ?? content?.home_destination_featured
  );
  const homeAccommodation = parseToggleValue(
    modules.home_accommodation ?? modules.show_on_home_accommodation ?? content?.show_on_home_accommodation ?? content?.home_hotel_featured
  );

  return {
    featured: featured ?? index === 0,
    destination: destination ?? true,
    accommodation: accommodation ?? index < 4,
    hero: hero ?? (featured ?? index === 0),
    homeDestination: homeDestination ?? false,
    homeAccommodation: homeAccommodation ?? false,
  };
}

function deriveDestinationTitle(title, snapshot, content) {
  const explicit = normalizeStringValue(
    content?.destination_name,
    content?.destination?.name,
    content?.destination_title,
    content?.region,
  );
  if (explicit) return explicit;

  const itineraryStops = Array.isArray(snapshot?.itinerary_stops) ? snapshot.itinerary_stops : [];
  if (itineraryStops.length) {
    return itineraryStops[itineraryStops.length - 1]?.title || itineraryStops[0]?.title || title;
  }

  const routeLabel = normalizeStringValue(snapshot?.route_label);
  if (routeLabel) {
    const segments = routeLabel.split(/\bto\b|\-/i).map((item) => item.trim()).filter(Boolean);
    return segments[segments.length - 1] || routeLabel;
  }

  const titleSegments = String(title || '').split('-').map((item) => item.trim()).filter(Boolean);
  return titleSegments[titleSegments.length - 1] || title || 'Destination';
}

function deriveAccommodationTitle(item, index) {
  const explicit = normalizeStringValue(
    item.content?.accommodation_title,
    item.content?.accommodation_name,
    item.content?.hotel_name,
    item.content?.stay_name,
  );
  if (explicit) return explicit;

  const destination = normalizeStringValue(item.destination_title);
  if (destination) return `${destination} House`;

  const fallbacks = ['Canopy Suite', 'Lagoon Villa', 'Garden Residence', 'Cliffside Pavilion'];
  return fallbacks[index % fallbacks.length];
}

function buildTourRuntimeCollections(tenantId, tours, syncedRows, hotels = [], priceLookup = new Map(), catalogDestinations = []) {
  const syncedByTourId = new Map(
    (syncedRows || []).map((row) => {
      const override = parseJsonSafe(row.content_override_json, {});
      return [row.tour_id, { row, override, snapshot: override.sync_snapshot || null }];
    })
  );
  const hotelByTourId = new Map(
    (hotels || []).filter((hotel) => hotel?.tour_id).map((hotel) => [String(hotel.tour_id), hotel])
  );

  const items = (tours || []).map((tour, index) => {
    const content = parseJsonSafe(tour.content_data, {});
    const synced = syncedByTourId.get(tour.id);
    const snapshot = synced?.snapshot || null;
    const galleryImages = Array.isArray(snapshot?.gallery_images) ? snapshot.gallery_images : [];
    const title = normalizeStringValue(snapshot?.title, content?.tour_name, tour.title, `Tour ${index + 1}`);
    const summary = normalizeStringValue(
      snapshot?.summary,
      snapshot?.about_section,
      content?.hero_desc,
      content?.description,
      content?.tour_desc,
    );
    const heroImage = normalizeStringValue(
      snapshot?.hero_image,
      content?.hero_image,
      galleryImages[0]?.src,
      LUXURY_SAMPLE_HERO_URL,
    );
    const destinationTitle = deriveDestinationTitle(title, snapshot, content);
    const flags = deriveTourModuleFlags(content, index);
    const publicSlug = normalizeStringValue(synced?.row?.slug);
    const href = publicSlug ? buildUniversalPublicPath(tenantId, publicSlug) : buildUniversalPublicPath(tenantId, 'featured-tours');
    const priceFrom = snapshot?.price_from ?? priceLookup.get(tour.id) ?? null;
    const highlights = Array.isArray(snapshot?.highlights) ? snapshot.highlights : [];
    const hotel = hotelByTourId.get(String(tour.id)) || null;

    return {
      tour_id: tour.id,
      title,
      summary,
      hero_image: heroImage,
      gallery_images: galleryImages,
      destination_title: destinationTitle,
      duration_text: normalizeStringValue(snapshot?.duration_text, tour.duration_text, content?.duration),
      route_label: normalizeStringValue(snapshot?.route_label, destinationTitle),
      booking_cta_label: normalizeStringValue(snapshot?.booking_cta_label, getDefaultCtaLabels('tour_operator').booking),
      price_from: priceFrom,
      href,
      content,
      override: synced?.override || {},
      hotel,
      highlights,
      flags,
      created_at: Number(tour.created_at || 0),
      public_slug: publicSlug || '',
    };
  });

  const sortedItems = [...items].sort((left, right) => right.created_at - left.created_at);
  const featuredBase = sortedItems.filter((item) => item.flags.featured);
  // Only fall back to all tours if no tour has ever had a featured flag explicitly configured
  const anyFeaturedConfigured = sortedItems.some((item) => {
    const mod = item.content?.universal_modules || {};
    return 'featured_tours' in mod || 'featured' in mod;
  });
  const featuredItems = (anyFeaturedConfigured ? featuredBase : (featuredBase.length ? featuredBase : sortedItems)).slice(0, HOME_FEATURED_TOUR_CARD_LIMIT);
  const heroItem = sortedItems.find((item) => item.flags.hero) || featuredItems[0] || sortedItems[0] || null;
  const destinationItems = uniqueBy(
    (sortedItems.filter((item) => item.flags.destination).length ? sortedItems.filter((item) => item.flags.destination) : sortedItems)
      .map((item) => ({
        eyebrow: 'Destination',
        title: item.destination_title,
        body: normalizeStringValue(item.content?.destination_summary, item.route_label, item.summary),
        image: normalizeStringValue(item.content?.destination_image, item.gallery_images[1]?.src, item.hero_image, LUXURY_SAMPLE_HERO_URL),
        href: item.href,
        entity_id: item.tour_id,
        entity_type: 'destination',
        entity_label: item.destination_title,
        entity_title: item.destination_title,
        entity_body: normalizeStringValue(item.content?.destination_summary, item.route_label, item.summary),
        entity_image: normalizeStringValue(item.content?.destination_image, item.gallery_images[1]?.src, item.hero_image, LUXURY_SAMPLE_HERO_URL),
        public_slug: item.public_slug,
      })),
    (item) => item.title.toLowerCase()
  ).slice(0, 4);
  // Use catalog destination entries with show_on_home=1 when available; fall back to tour-flag-based list
  const catalogHomeDestItems = Array.isArray(catalogDestinations)
    ? catalogDestinations
        .filter((d) => d.show_on_home === 1)
        .map((d) => {
          // Try to link to a tour that references this destination (via tour destination_title match or just use destinations page)
          const relatedTour = sortedItems.find((item) =>
            String(item.destination_title || '').toLowerCase() === String(d.name || '').toLowerCase()
          );
          const image = (Array.isArray(d.gallery) && d.gallery[0]?.src) ? d.gallery[0].src : LUXURY_SAMPLE_HERO_URL;
          return {
            eyebrow: 'Destination',
            title: d.name || '',
            body: truncateSentences(d.description || '', 3),
            image,
            href: relatedTour?.href || buildUniversalPublicPath(tenantId, 'destinations'),
            entity_id: d.id,
            entity_type: 'destination',
            entity_label: d.name || '',
            entity_title: d.name || '',
            entity_body: d.description || '',
            entity_image: image,
            public_slug: relatedTour?.public_slug || '',
          };
        })
    : [];
  const tourFlaggedDestItems = destinationItems.filter((item) => {
    const source = sortedItems.find((entry) => String(entry.tour_id) === String(item.entity_id));
    return Boolean(source?.flags.homeDestination);
  });
  const homeDestinationItems = catalogHomeDestItems.length ? catalogHomeDestItems : tourFlaggedDestItems;

  const accommodationBase = sortedItems.filter((item) => item.flags.accommodation);
  // Build home accommodation directly from hotels flagged show_on_home=1 — do NOT filter from accommodationItems
  // because those are capped and only include tours with the accommodation flag
  const homeAccommodationFromCatalog = (hotels || [])
    .filter((hotel) => hotel.show_on_home === 1)
    .map((hotel, index) => {
      const linkedTour = hotel.tour_id
        ? sortedItems.find((item) => String(item.tour_id) === String(hotel.tour_id))
        : null;
      const image = (Array.isArray(hotel.gallery) && hotel.gallery[0]?.src)
        ? hotel.gallery[0].src
        : LUXURY_SAMPLE_ACCOMMODATION_IMAGES[index % LUXURY_SAMPLE_ACCOMMODATION_IMAGES.length];
      return {
        eyebrow: 'Stay',
        title: hotel.name || '',
        body: truncateSentences(hotel.description || 'Design-led rooms, calmer pacing, and hotel partnerships tuned to the route.', 3),
        image,
        href: linkedTour?.href || buildUniversalPublicPath(tenantId, 'accommodation'),
        image_layout: 'portrait',
        address: hotel.address || '',
        entity_id: hotel.id,
        entity_type: 'hotel',
        entity_label: hotel.name || '',
        entity_title: hotel.name || '',
        entity_body: hotel.description || '',
        entity_image: image,
        public_slug: linkedTour?.public_slug || '',
      };
    });

  const accommodationItems = (accommodationBase.length ? accommodationBase : sortedItems.slice(0, HOME_HOTEL_CARD_LIMIT)).slice(0, HOME_HOTEL_CARD_LIMIT).map((item, index) => ({
    eyebrow: 'Stay',
    title: normalizeStringValue(
      item.hotel?.name,
      item.override?.accommodation_title,
      item.override?.hotel_name,
      deriveAccommodationTitle(item, index)
    ),
    body: normalizeStringValue(
      item.hotel?.description,
      item.override?.accommodation_summary,
      item.override?.stay_summary,
      item.content?.accommodation_summary,
      item.content?.stay_summary,
      item.summary,
      'Design-led rooms, calmer pacing, and hotel partnerships tuned to the route.'
    ),
    image: normalizeStringValue(
      Array.isArray(item.hotel?.gallery) ? item.hotel.gallery[0]?.src : '',
      item.override?.accommodation_image,
      item.override?.hotel_image,
      item.content?.accommodation_image,
      item.content?.hotel_image,
      item.gallery_images[2]?.src,
      item.gallery_images[1]?.src,
      LUXURY_SAMPLE_ACCOMMODATION_IMAGES[index % LUXURY_SAMPLE_ACCOMMODATION_IMAGES.length]
    ),
    href: item.href,
    image_layout: 'portrait',
    address: normalizeStringValue(item.hotel?.address),
    entity_id: item.hotel?.id || item.tour_id,
    entity_type: 'hotel',
    entity_label: normalizeStringValue(item.hotel?.name, item.override?.accommodation_title, item.override?.hotel_name, deriveAccommodationTitle(item, index)),
    entity_title: normalizeStringValue(item.hotel?.name, item.override?.accommodation_title, item.override?.hotel_name, deriveAccommodationTitle(item, index)),
    entity_body: normalizeStringValue(
      item.hotel?.description,
      item.override?.accommodation_summary,
      item.override?.stay_summary,
      item.content?.accommodation_summary,
      item.content?.stay_summary,
      item.summary
    ),
    entity_image: normalizeStringValue(
      Array.isArray(item.hotel?.gallery) ? item.hotel.gallery[0]?.src : '',
      item.override?.accommodation_image,
      item.override?.hotel_image,
      item.content?.accommodation_image,
      item.content?.hotel_image,
      item.gallery_images[2]?.src,
      item.gallery_images[1]?.src,
      item.hero_image
    ),
    public_slug: item.public_slug,
  }));
  // Tour-flag fallback: tours explicitly marked homeAccommodation
  const homeAccommodationFromTours = accommodationItems.filter((item) => {
    const source = sortedItems.find((entry) => String((entry.hotel?.id || entry.tour_id)) === String(item.entity_id));
    return Boolean(source?.flags.homeAccommodation);
  });
  // Prefer catalog-based (hotels with show_on_home=1) over tour-flag fallback
  const homeAccommodationItems = homeAccommodationFromCatalog.length ? homeAccommodationFromCatalog : homeAccommodationFromTours;

  const selectedHomeGalleryImages = uniqueBy(
    featuredItems
      .flatMap((item) => {
        const modules = item.content?.universal_modules || item.content?.homepage_modules || item.content?.site_modules || {};
        const selected = Array.isArray(modules.home_gallery_images)
          ? modules.home_gallery_images
          : (Array.isArray(item.content?.home_gallery_images) ? item.content.home_gallery_images : []);
        return selected
          .map((entry, index) => {
            if (typeof entry === 'string') {
              return {
                src: entry,
                alt: item.title,
                caption: index === 0 ? item.destination_title : item.title,
              };
            }
            if (entry?.src) return entry;
            return null;
          })
          .filter((entry) => entry?.src);
      }),
    (item) => item.src
  );

  const featuredCollectionImages = uniqueBy(
    (selectedHomeGalleryImages.length ? selectedHomeGalleryImages : featuredItems
      .flatMap((item) => item.gallery_images.length ? item.gallery_images : [{ src: item.hero_image, alt: item.title, caption: item.destination_title }])
      .filter((item) => item?.src)),
    (item) => item.src
  ).slice(0, 6);

  const operatorHighlights = heroItem?.highlights?.length
    ? heroItem.highlights.slice(0, 3)
    : featuredItems.slice(0, 3).map((item) => ({ title: item.title, body: item.summary }));

  return {
    featured_tour: heroItem,
    has_explicit_featured_tours: anyFeaturedConfigured,
    featured_tours: featuredItems.map((item) => ({
      eyebrow: item.duration_text || 'Featured itinerary',
      title: item.title,
      body: item.summary,
      image: item.hero_image,
      href: item.href,
      destination_title: item.destination_title,
      meta: item.price_from != null ? `From $${item.price_from}` : item.destination_title,
      entity_id: item.tour_id,
      entity_type: 'tour',
      entity_label: item.title,
      entity_title: item.title,
      entity_body: item.summary,
      entity_image: item.hero_image,
      public_slug: item.public_slug,
    })),
    home_featured_tours: featuredItems.map((item) => ({
      eyebrow: item.duration_text || 'Featured itinerary',
      title: item.title,
      body: truncateSentences(item.summary, 2),
      image: item.hero_image,
      href: item.href,
      destination_title: item.destination_title,
      meta: item.price_from != null ? `From $${item.price_from}` : item.destination_title,
      entity_id: item.tour_id,
      entity_type: 'tour',
      entity_label: item.title,
      entity_title: item.title,
      entity_body: item.summary,
      entity_image: item.hero_image,
      public_slug: item.public_slug,
    })),
    destination_listing: destinationItems,
    home_destination_listing: homeDestinationItems.length ? homeDestinationItems : destinationItems,
    accommodation_listing: accommodationItems,
    home_accommodation_listing: homeAccommodationItems.length ? homeAccommodationItems : accommodationItems,
    featured_collection: {
      gallery_images: featuredCollectionImages,
    },
    operator_highlights: operatorHighlights,
    tour_listing: sortedItems.map((item) => ({
      eyebrow: item.duration_text || 'Journey',
      title: item.title,
      body: item.summary,
      image: item.hero_image,
      href: item.href,
      destination_title: item.destination_title,
      meta: item.price_from != null ? `From $${item.price_from}` : item.destination_title,
      entity_id: item.tour_id,
      entity_type: 'tour',
      entity_label: item.title,
      entity_title: item.title,
      entity_body: item.summary,
      entity_image: item.hero_image,
      public_slug: item.public_slug,
    })),
  };
}

function buildInterestRuntimeCollections(tourRuntime, tagRows = []) {
  const tourCards = Array.isArray(tourRuntime?.tour_listing) ? tourRuntime.tour_listing : [];
  const cardByTourId = new Map(
    tourCards
      .filter((card) => card?.entity_id)
      .map((card) => [String(card.entity_id), card])
  );

  const buckets = new Map();
  for (const row of tagRows) {
    const interestKey = String(row.interest_key || '').trim().toLowerCase();
    const tourId = String(row.tour_id || '').trim();
    if (!interestKey || !tourId || row.tag_level !== 'top_level') continue;
    const card = cardByTourId.get(tourId);
    if (!card) continue;

    if (!buckets.has(interestKey)) {
      buckets.set(interestKey, []);
    }
    buckets.get(interestKey).push(card);
  }

  const collections = {};
  for (const [interestKey, cards] of buckets.entries()) {
    const definition = getInterestDefinition(interestKey);
    const deduped = uniqueBy(cards, (card) => String(card.entity_id || card.title || ''));
    collections[interestKey] = {
      interest_key: interestKey,
      label: definition?.label || interestKey,
      description: buildInterestDescription(interestKey),
      tour_listing: deduped,
      total_tours: deduped.length,
    };
  }

  return collections;
}

function buildTourTaxonomyLookup(tagRows = []) {
  const byTourId = new Map();
  for (const row of tagRows) {
    const tourId = String(row.tour_id || '').trim();
    if (!tourId) continue;
    if (!byTourId.has(tourId)) {
      byTourId.set(tourId, { interest_keys: [], sub_interest_keys: [] });
    }
    const bucket = byTourId.get(tourId);
    if (row.tag_level === 'sub_interest') {
      if (!bucket.sub_interest_keys.includes(row.interest_key)) bucket.sub_interest_keys.push(row.interest_key);
      continue;
    }
    if (!bucket.interest_keys.includes(row.interest_key)) bucket.interest_keys.push(row.interest_key);
  }
  return byTourId;
}

function annotateCardWithTaxonomy(card, taxonomyLookup) {
  const tourId = String(card?.entity_id || card?.tour_id || '').trim();
  if (!tourId || !taxonomyLookup.has(tourId)) return card;
  const taxonomy = taxonomyLookup.get(tourId);
  const interestLabels = (taxonomy.interest_keys || [])
    .map((key) => getInterestDefinition(key)?.label || key)
    .filter(Boolean);
  return {
    ...card,
    taxonomy_interest_keys: taxonomy.interest_keys || [],
    taxonomy_sub_interest_keys: taxonomy.sub_interest_keys || [],
    taxonomy_interest_labels: interestLabels,
  };
}

function annotateTourRuntimeWithTaxonomy(tourRuntime = {}, tagRows = []) {
  const taxonomyLookup = buildTourTaxonomyLookup(tagRows);
  const annotateCards = (cards) => Array.isArray(cards) ? cards.map((card) => annotateCardWithTaxonomy(card, taxonomyLookup)) : cards;
  return {
    ...tourRuntime,
    featured_tour: tourRuntime.featured_tour ? annotateCardWithTaxonomy(tourRuntime.featured_tour, taxonomyLookup) : tourRuntime.featured_tour,
    featured_tours: annotateCards(tourRuntime.featured_tours),
    home_featured_tours: annotateCards(tourRuntime.home_featured_tours),
    tour_listing: annotateCards(tourRuntime.tour_listing),
    destination_listing: annotateCards(tourRuntime.destination_listing),
    home_destination_listing: annotateCards(tourRuntime.home_destination_listing),
    accommodation_listing: annotateCards(tourRuntime.accommodation_listing),
    home_accommodation_listing: annotateCards(tourRuntime.home_accommodation_listing),
  };
}

function parseSearchState(requestUrl, tenantId) {
  const fallbackAction = buildUniversalPublicPath(tenantId, 'tours');
  if (!requestUrl) {
    return { q: '', start: '', end: '', pax: '', code: '', action: fallbackAction, active: false };
  }

  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return { q: '', start: '', end: '', pax: '', code: '', action: fallbackAction, active: false };
  }

  const q = String(url.searchParams.get('q') || '').trim();
  const start = String(url.searchParams.get('start') || '').trim();
  const end = String(url.searchParams.get('end') || '').trim();
  const pax = String(url.searchParams.get('pax') || '').trim();
  const code = String(url.searchParams.get('code') || '').trim();
  return {
    q,
    start,
    end,
    pax,
    code,
    action: fallbackAction,
    active: Boolean(q || start || end || pax || code),
  };
}

function buildSearchHaystack(card = {}) {
  return [
    card.title,
    card.body,
    card.meta,
    card.eyebrow,
    card.destination_title,
    ...(Array.isArray(card.taxonomy_interest_keys) ? card.taxonomy_interest_keys : []),
    ...(Array.isArray(card.taxonomy_sub_interest_keys) ? card.taxonomy_sub_interest_keys : []),
    ...(Array.isArray(card.taxonomy_interest_labels) ? card.taxonomy_interest_labels : []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function applySearchFilter(cards, searchState) {
  if (!Array.isArray(cards) || !cards.length || !searchState?.q) return cards;
  const tokens = String(searchState.q)
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (!tokens.length) return cards;
  return cards.filter((card) => {
    const haystack = buildSearchHaystack(card);
    return tokens.every((token) => haystack.includes(token));
  });
}

const GOOGLE_FONT_IMPORT_MAP = new Map([
  ['Cormorant Garamond', "@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&display=swap');"],
  ['Source Sans 3', "@import url('https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;500;600;700&display=swap');"],
  ['Bodoni Moda', "@import url('https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,400;6..96,500;6..96,600;6..96,700&display=swap');"],
  ['Manrope', "@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap');"],
  ['Playfair Display', "@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700&display=swap');"],
  ['Fraunces', "@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&display=swap');"],
  ['Work Sans', "@import url('https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;500;600;700&display=swap');"],
  ['Space Grotesk', "@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&display=swap');"],
  ['Inter', "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');"],
]);

function buildThemeFontImports(theme = {}) {
  const cssImports = new Set();
  const fontCandidates = [theme.fontHeading, theme.fontBody]
    .map((value) => String(value || '').split(',')[0].trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  for (const family of fontCandidates) {
    const cssImport = GOOGLE_FONT_IMPORT_MAP.get(family);
    if (cssImport) cssImports.add(cssImport);
  }
  return [...cssImports].join('\n    ');
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
        ${snapshot?.hero_image ? buildResponsiveImageMarkup(snapshot.hero_image, 'Hero', 'h-full w-full rounded-[20px] object-cover', 'cover', '(min-width: 768px) 36vw, 100vw') : '<div class="flex h-full min-h-[240px] items-center justify-center rounded-[20px] border border-dashed border-white/30 text-sm text-white/70">No hero image synced yet</div>'}
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
          ${gallery.length ? gallery.slice(0, 4).map((item) => buildResponsiveImageMarkup(item.src, item.alt || 'Gallery', 'aspect-square rounded-2xl object-cover', 'cover', '(min-width: 768px) 25vw, 50vw')).join('') : '<div class="col-span-2 rounded-2xl border border-dashed border-slate-300 p-6 text-center text-slate-500">No gallery images synced yet.</div>'}
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

function renderPublicHtml(siteBundle, page, tourPreview, options = {}) {
  const theme = siteBundle.theme || {};
  const site = siteBundle.site || {};
  const tourRuntime = siteBundle.tour_runtime || {};
  const interestRuntime = siteBundle.interest_runtime || {};
  const pages = Array.isArray(siteBundle.pages) ? siteBundle.pages : [];
  const pageMap = new Map(pages.map((entry) => [entry.page_key, entry]));
  const homePageKey = site.home_page_key || 'home';
  const homePage = pageMap.get(homePageKey) || pages.find((entry) => entry.slug === 'home') || null;
  const homeSlug = homePage?.slug || 'home';
  const isHomePage = page?.page_key === homePageKey || page?.slug === homeSlug;
  const menuItems = [...(Array.isArray(siteBundle.menu) ? siteBundle.menu : [])]
    .filter((item) => item?.visible)
    .sort((left, right) => Number(left.sort_order ?? 0) - Number(right.sort_order ?? 0));
  const runtime = siteBundle.variant_runtime || {};
  const profile = runtime.layout_profile || {};
  const groupConfig = UNIVERSAL_GROUPS[site.group_key] || UNIVERSAL_GROUPS.tour_operator;
  function buildPageHref(pageKey) {
    const linkedPage = pageMap.get(pageKey);
    if (!linkedPage) return buildUniversalPublicPath(site.tenant_id, homeSlug);
    return buildUniversalPublicPath(site.tenant_id, linkedPage.slug || linkedPage.page_key || homeSlug);
  }
  const configuredHeaderPrimaryPageKey = theme.ui?.header?.primaryPageKey || '';
  const headerPrimaryPageKey = pageMap.has(configuredHeaderPrimaryPageKey)
    ? configuredHeaderPrimaryPageKey
    : (groupConfig.listingPageKey || homeSlug);
  let requestUrlObject = null;
  try {
    requestUrlObject = options.requestUrl ? new URL(options.requestUrl) : null;
  } catch {
    requestUrlObject = null;
  }
  const requestedBookingTourId = normalizeStringValue(requestUrlObject?.searchParams.get('tour'));
  const activeTheme = resolveUniversalTheme(site, runtime, {
    escapeHtml,
    buildUniversalPublicPath,
    buildResponsiveImageMarkup,
    resolveThemeCtaLabel: (themeArg, groupKey, intent, explicitLabel = '') => resolveThemeCtaLabel(themeArg, groupKey, intent, explicitLabel, site.default_lang),
    normalizeStringValue,
    clampNumber,
  });
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
  const searchState = parseSearchState(options.requestUrl, site.tenant_id);
  const activeBookingTourId = normalizeStringValue(snapshot?.tour_id, requestedBookingTourId);
  const bookingPageHref = activeBookingTourId
    ? `${buildPageHref(groupConfig.reservationPageKey || 'booking')}?tour=${encodeURIComponent(activeBookingTourId)}`
    : buildPageHref(groupConfig.reservationPageKey || 'booking');
  const getPageTitle = (targetPage = page) => targetPage?.seo?.title || snapshot?.title || targetPage?.title || site.site_name || 'Travel Page';
  const getPageDescription = (targetPage = page) => targetPage?.seo?.description || snapshot?.about_section || snapshot?.summary || 'Travel experience page';
  const isLuxuryShell = activeTheme.key === 'six-senses';
  const channels = siteBundle.contacts?.channels || {};
  const legalPages = pages.filter((entry) => ['terms', 'privacy', 'impressum'].includes(entry.page_key) && entry.visible);
  const visibleContactEntries = Object.entries(channels).filter(([, value]) => value?.enabled && value?.value);
  const socialEntries = ['instagram', 'facebook', 'youtube', 'whatsapp']
    .map((key) => [key, channels[key]])
    .filter(([, value]) => value?.enabled && value?.value);
  const excludedHomeEmbeddedKeys = isLuxuryShell ? new Set(['about-us', 'contact-us']) : new Set();
  const adminMode = options.adminMode === true;
  const adminEditableTypes = new Set(['hero', 'gallery', 'features', 'rich_text']);
  const systemCopy = getUniversalSystemCopy(site.group_key, site.default_lang);
  theme.ui = theme.ui || {};
  theme.ui.cta = theme.ui.cta || {};
  theme.ui.header = theme.ui.header || {};
  theme.ui.hero = theme.ui.hero || {};
  theme.ui.footer = theme.ui.footer || {};
  theme.ui.menuDrawer = theme.ui.menuDrawer || {};
  theme.ui.bookNowLabel = localizeUniversalSystemText(theme.ui.bookNowLabel, 'universal_site.cta.booking', site.default_lang);
  theme.ui.cta.discoveryLabel = localizeUniversalSystemText(theme.ui.cta.discoveryLabel, 'universal_site.cta.discovery', site.default_lang);
  theme.ui.cta.bookingLabel = localizeUniversalSystemText(theme.ui.cta.bookingLabel, 'universal_site.cta.booking', site.default_lang);
  theme.ui.cta.contactLabel = localizeUniversalSystemText(theme.ui.cta.contactLabel, 'universal_site.cta.contact', site.default_lang);
  theme.ui.header.loginLabel = localizeUniversalSystemText(theme.ui.header.loginLabel, 'universal_site.header.login', site.default_lang);
  theme.ui.header.languageLabel = localizeUniversalSystemText(theme.ui.header.languageLabel, 'universal_site.header.language_chip', site.default_lang);
  theme.ui.hero.mapLinkLabel = localizeUniversalSystemText(theme.ui.hero.mapLinkLabel, 'universal_site.header.view_map', site.default_lang);
  theme.ui.hero.searchButtonLabel = localizeUniversalSystemText(theme.ui.hero.searchButtonLabel, 'universal_site.search.button', site.default_lang);
  theme.ui.menuDrawer.title = localizeUniversalSystemText(theme.ui.menuDrawer.title, 'universal_site.header.curated_menu', site.default_lang);
  theme.ui.footer.kickerText = localizeUniversalSystemText(theme.ui.footer.kickerText, 'universal_site.footer.kicker', site.default_lang);
  const localizedThemeCtaLabel = (intent, explicitLabel = '') => resolveThemeCtaLabel(theme, site.group_key, intent, explicitLabel, site.default_lang);

  function resolveManagementTarget(targetPage, block) {
    const pageKey = String(targetPage?.page_key || '').toLowerCase();
    const blockType = String(block?.type || '').toLowerCase();

    if (pageKey === 'accommodation') return 'hotel';
    if (pageKey === 'contact-us' || pageKey === 'contact' || blockType === 'contact') return 'contact';
    if (['tours', 'featured-tours', 'booking'].includes(pageKey) || ['hero', 'gallery', 'itinerary', 'pricing_spotlight', 'listing'].includes(blockType)) return 'tour';
    return 'site-content';
  }

  function resolveListingCards(source, targetPage = page) {
    const interestMatch = String(source || '').match(/^taxonomy\.interest\.([a-z0-9-]+)\.tour_listing$/i);
    if (interestMatch) {
      const interestKey = String(interestMatch[1] || '').toLowerCase();
      return applySearchFilter(interestRuntime?.[interestKey]?.tour_listing || [], searchState);
    }

    if (String(source || '').includes('featured_tours')) {
      const homeCards = page.page_key === 'home' && tourRuntime.home_featured_tours?.length ? tourRuntime.home_featured_tours : null;
      const cards = homeCards ?? (tourRuntime.featured_tours?.length ? tourRuntime.featured_tours : buildFallbackListingCards(source, targetPage));
      const filtered = applySearchFilter(cards, searchState);
      return page.page_key === 'home' ? filtered.slice(0, HOME_FEATURED_TOUR_CARD_LIMIT) : filtered;
    }

    if (String(source || '').includes('destination_listing')) {
      const homeList = page.page_key === 'home' && tourRuntime.home_destination_listing?.length ? tourRuntime.home_destination_listing : null;
      return applySearchFilter(homeList ?? (tourRuntime.destination_listing?.length ? tourRuntime.destination_listing : buildFallbackListingCards(source, targetPage)), searchState);
    }

    if (String(source || '').includes('tour_listing')) {
      return applySearchFilter(tourRuntime.tour_listing?.length ? tourRuntime.tour_listing : buildFallbackListingCards(source, targetPage), searchState);
    }

    if (targetPage.page_key === 'accommodation') {
      return applySearchFilter(tourRuntime.accommodation_listing?.length ? tourRuntime.accommodation_listing : buildFallbackListingCards(source, targetPage), searchState);
    }

    if (String(source || '').includes('accommodation_listing')) {
      const homeList = page.page_key === 'home' && tourRuntime.home_accommodation_listing?.length ? tourRuntime.home_accommodation_listing : null;
      const cards = homeList ?? (tourRuntime.accommodation_listing?.length ? tourRuntime.accommodation_listing : buildFallbackListingCards(source, targetPage));
      const filtered = applySearchFilter(cards, searchState);
      return page.page_key === 'home' ? filtered.slice(0, HOME_HOTEL_CARD_LIMIT) : filtered;
    }

    return applySearchFilter(buildFallbackListingCards(source, targetPage), searchState);
  }

  function resolveHeroModuleMenuItems() {
    return menuItems
      .filter((item) => {
        const linkedPage = pageMap.get(item.page_key);
        if (!item?.visible || !linkedPage?.visible || linkedPage.page_key === homePageKey) return false;
        if (linkedPage.page_type !== 'standard') return false;
        if (excludedHomeEmbeddedKeys.has(linkedPage.page_key)) return false;
        if (!linkedPage.seo?.home_embedded) return false;

        const listingBlock = Array.isArray(linkedPage.blocks)
          ? linkedPage.blocks.find((block) => block?.type === 'listing')
          : null;
        if (listingBlock) {
          return resolveListingCards(listingBlock.data_bindings?.cards?.source, linkedPage).length > 0;
        }

        if (linkedPage.page_key === 'accommodation') {
          return (tourRuntime.accommodation_listing?.length || 0) > 0;
        }

        return Boolean(linkedPage.seo?.home_embedded);
      })
      .slice(0, 3);
  }

  function buildChannelHref(key, channel) {
    const rawValue = String(channel?.value || '').trim();
    if (!rawValue && key !== 'address') return '#';

    switch (key) {
      case 'phone':
        return `tel:${rawValue.replace(/[^+\d]/g, '')}`;
      case 'email':
        return rawValue.startsWith('mailto:') ? rawValue : `mailto:${rawValue}`;
      case 'address':
        return String(channel?.mapUrl || '').trim() || '#';
      default:
        return rawValue;
    }
  }

  function buildChannelLabel(key, channel) {
    return localizeUniversalContactLabel(channel?.label, key, site.default_lang) || systemCopy.channel[key] || key;
  }

  function buildSocialMonogram(key) {
    const lookup = {
      instagram: 'IG',
      facebook: 'FB',
      youtube: 'YT',
      whatsapp: 'WA',
    };
    return lookup[key] || key.slice(0, 2).toUpperCase();
  }

  function buildLuxurySearchPanel() {
    return `<form class="luxury-search-panel" method="GET" action="${escapeHtml(searchState.action)}"><div class="luxury-search-grid"><label class="luxury-search-label-primary"><span>${escapeHtml(systemCopy.search.destinationLabel)}</span><input type="text" name="q" value="${escapeHtml(searchState.q)}" aria-label="${escapeHtml(systemCopy.search.destinationLabel)}" placeholder="${escapeHtml(systemCopy.search.destinationPlaceholder)}" /></label><label><span>${escapeHtml(systemCopy.search.travelStartsLabel)}</span><input type="text" name="start" value="${escapeHtml(searchState.start)}" aria-label="${escapeHtml(systemCopy.search.travelStartsLabel)}" placeholder="${escapeHtml(systemCopy.search.travelStartsPlaceholder)}" /></label><label><span>${escapeHtml(systemCopy.search.travelEndsLabel)}</span><input type="text" name="end" value="${escapeHtml(searchState.end)}" aria-label="${escapeHtml(systemCopy.search.travelEndsLabel)}" placeholder="${escapeHtml(systemCopy.search.travelEndsPlaceholder)}" /></label><label><span>${escapeHtml(systemCopy.search.guestsLabel)}</span><input type="text" name="pax" value="${escapeHtml(searchState.pax)}" aria-label="${escapeHtml(systemCopy.search.guestsLabel)}" placeholder="${escapeHtml(systemCopy.search.guestsPlaceholder)}" /></label><label><span>${escapeHtml(systemCopy.search.codeLabel)}</span><input type="text" name="code" value="${escapeHtml(searchState.code)}" aria-label="${escapeHtml(systemCopy.search.codeLabel)}" placeholder="${escapeHtml(systemCopy.search.codePlaceholder)}" /></label></div><button type="submit" class="luxury-search-cta">${escapeHtml(systemCopy.search.button)}</button></form>`;
  }

  function buildSearchEmptyState(targetPage = page, block = {}) {
    return `<section class="rounded-[26px] bg-white p-6 shadow-sm"><h2 class="text-3xl font-semibold text-slate-950">${escapeHtml(systemCopy.search.noMatchingTitle)}</h2><p class="mt-3 max-w-2xl text-slate-600">${escapeHtml(systemCopy.search.noMatchingBody.replace('{{query}}', searchState.q || systemCopy.search.button.toLowerCase()))}</p></section>`;
  }

  function buildLuxuryStoryImage(targetPage = page) {
    const galleryBlockImages = Array.isArray(targetPage?.blocks?.find?.((entry) => entry?.type === 'gallery')?.content?.images)
      ? targetPage.blocks.find((entry) => entry?.type === 'gallery').content.images
      : [];
    return galleryBlockImages[0]?.src
      || gallery[1]?.src
      || snapshot?.hero_image
      || LUXURY_SAMPLE_HERO_URL;
  }

  function buildFallbackListingCards(source, targetPage = page) {
    if (String(source || '').includes('featured_tours')) {
      return [
        {
          eyebrow: 'Featured itinerary',
          title: 'Saffron Coast Signature',
          body: 'A softly paced coastal route with private boat mornings, lantern dinners, and one hidden cove reserved for sunset.',
          image: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80',
        },
        {
          eyebrow: 'Featured itinerary',
          title: 'Highlands After Rain',
          body: 'Mist, terraces, and quiet lodges threaded into a long-form northbound journey for travelers who want space, story, and texture.',
          image: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80',
        },
        {
          eyebrow: 'Featured itinerary',
          title: 'Private Delta Reverie',
          body: 'Slow river bends, design-led stays, and market mornings shaped for guests who prefer fewer transfers and richer atmosphere.',
          image: 'https://images.unsplash.com/photo-1493558103817-58b2924bce98?auto=format&fit=crop&w=1200&q=80',
        },
      ];
    }

    if (String(source || '').includes('destination_listing')) {
      return [
        {
          eyebrow: 'Destination',
          title: 'Verdant Highlands',
          body: 'Tea hills, cooler air, and design-forward mountain lodges with private guides and softer pacing.',
          image: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1200&q=80',
        },
        {
          eyebrow: 'Destination',
          title: 'Limestone Bay',
          body: 'Cathedral cliffs, floating breakfasts, and hidden anchor points for couples and celebratory trips.',
          image: 'https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=1200&q=80',
        },
        {
          eyebrow: 'Destination',
          title: 'Terracotta Coast',
          body: 'Sun-soft villages and long afternoons where architecture, food, and salt air do most of the storytelling.',
          image: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1200&q=80',
        },
      ];
    }

    return [
      {
        eyebrow: targetPage.title || 'Journey',
        title: 'Aurelia Passage',
        body: 'Private transport, quiet shores, and one signature stay that turns the whole route into a memory anchor.',
        image: 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=1200&q=80',
      },
      {
        eyebrow: targetPage.title || 'Journey',
        title: 'Monsoon Light Escape',
        body: 'A contemplative route with fewer hotel changes, more breathing room, and a stronger sense of place.',
        image: 'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1200&q=80',
      },
      {
        eyebrow: targetPage.title || 'Journey',
        title: 'House of Tides Retreat',
        body: 'Built for travelers who care about architecture, service cadence, and evenings that land softly.',
        image: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1200&q=80',
      },
    ];
  }

  const renderRichText = (text) => `<div class="prose prose-slate max-w-none">${escapeHtml(text || '').replace(/\n/g, '<br>')}</div>`;

  const buildEditableEntityAttributes = ({ card, targetPage, block, managementTarget }) => {
    const entityType = normalizeStringValue(card?.entity_type, managementTarget);
    const entityId = normalizeStringValue(card?.entity_id, card?.tour_id, card?.channel_key);
    const entityLabel = normalizeStringValue(card?.entity_label, card?.entity_title, card?.title, block?.label, entityType || 'Entity');
    const entitySectionId = normalizeStringValue(card?.section_id, `${entityType || managementTarget}:${entityId || block?.id || block?.type}`);

    return serializeDataAttributes({
      'data-ve-entity': '1',
      'data-ve-section': '1',
      'data-section-id': entitySectionId,
      'data-section-type': normalizeStringValue(card?.section_type, `${entityType || managementTarget}-entity`),
      'data-section-label': entityLabel,
      'data-admin-page-key': targetPage.page_key || page.page_key || 'home',
      'data-admin-block-id': block.id || block.type,
      'data-admin-block-type': block.type,
      'data-admin-block-label': block.label || block.content?.heading || block.content?.headline || block.type,
      'data-admin-management-target': managementTarget,
      'data-entity-id': entityId,
      'data-entity-type': entityType,
      'data-entity-label': entityLabel,
      'data-entity-title': card?.entity_title || card?.title || '',
      'data-entity-body': card?.entity_body || card?.body || '',
      'data-entity-image': card?.entity_image || card?.image || '',
      'data-entity-value': card?.entity_value || '',
      'data-entity-channel-key': card?.channel_key || '',
      'data-entity-slug': card?.public_slug || '',
    });
  };

  const wrapEditableEntityCard = ({ block, card, targetPage, contentHtml, className = 'universal-entity-card' }) => {
    const managementTarget = resolveManagementTarget(targetPage, block);
    return `<article class="${escapeHtml(className)}"${buildEditableEntityAttributes({ card, targetPage, block, managementTarget })}>${contentHtml}</article>`;
  };

  const renderHero = (block, targetPage = page) => {
    const targetTitle = getPageTitle(targetPage);
    const targetDescription = getPageDescription(targetPage);
    const isTourDetailTarget = targetPage.page_type === 'tour_detail' || /^tour-/.test(String(targetPage.page_key || ''));
    const localizedPrimaryExplicit = localizeUniversalSystemText(block.content?.primary_cta_label, 'universal_site.cta.discovery', site.default_lang);
    const localizedSecondaryExplicit = localizeUniversalSystemText(block.content?.secondary_cta_label, 'universal_site.cta.plan_with_concierge', site.default_lang);
    const primaryHeroLabel = isTourDetailTarget
      ? localizedThemeCtaLabel('booking')
      : localizedThemeCtaLabel('discovery', localizedPrimaryExplicit);
    const primaryHeroHref = isTourDetailTarget
      ? bookingPageHref
      : (targetPage.page_key === homePageKey
          ? buildPageHref(headerPrimaryPageKey)
          : (block.content?.primary_cta_href || '#pricing'));
    const primaryHeroAttrs = isTourDetailTarget && activeBookingTourId ? ' data-open-public-booking="1"' : '';
    const themedHero = activeTheme.renderHero?.({
      block,
      targetPage,
      targetTitle,
      targetDescription,
      homePageKey,
      runtime,
      snapshot,
      site,
      tourRuntime,
      buildMenuHref,
      buildPageHref,
      bookingPageHref,
      headerPrimaryPageKey,
      resolveThemeCtaLabel: (_theme, _groupKey, intent, explicitLabel = '') => localizedThemeCtaLabel(intent, explicitLabel),
      resolveHeroModuleMenuItems,
      searchState,
      systemCopy,
    });
    if (themedHero) return themedHero;
    const content = block.content || {};
    const runtimeHero = targetPage.page_key === homePageKey ? tourRuntime.featured_tour : null;
    const image = content.hero_image || runtimeHero?.hero_image || snapshot?.hero_image || (isLuxuryShell ? LUXURY_SAMPLE_HERO_URL : '');
    const imageBrightness = clampNumber(content.image_brightness, 0.4, 1.4, 1);
    const overlayStrength = clampNumber(content.overlay_strength, 0.12, 0.92, 0.56);
    const imageMarkup = image
      ? buildResponsiveImageMarkup(image, content.headline || targetTitle, 'h-full w-full rounded-[22px] object-cover', 'cover', '(min-width: 1024px) 40vw, 100vw')
      : '<div class="flex min-h-[240px] items-center justify-center rounded-[22px] border border-dashed border-white/30 text-sm text-white/70">Image pending</div>';

    if (isLuxuryShell) {
      const isVideo = /\.(mp4|webm)(\?|#|$)/i.test(image);
      const mediaMarkup = image
        ? (isVideo
          ? `<video class="luxury-hero-media-asset" style="filter:brightness(${escapeHtml(String(imageBrightness))})" autoplay muted loop playsinline src="${escapeHtml(image)}"></video>`
          : `<div style="filter:brightness(${escapeHtml(String(imageBrightness))})">${buildResponsiveImageMarkup(image, content.headline || targetTitle, 'luxury-hero-media-asset', 'cover', '100vw')}</div>`)
        : '<div class="luxury-hero-media-fallback">Replace with a cinematic hero image or video.</div>';
      const searchMarkup = targetPage.page_key === homePageKey ? `<div class="luxury-hero-search-wrap">${buildLuxurySearchPanel()}</div>` : '';
      const heroButtons = targetPage.page_key === homePageKey
        ? resolveHeroModuleMenuItems()
            .map((item) => `<a href="${escapeHtml(buildMenuHref(item))}" class="luxury-hero-side-link">${escapeHtml(item.label || item.page_key || systemCopy.nav.page)}</a>`)
            .join('')
        : '';
      const heroSidePanel = heroButtons
        ? `<aside class="luxury-hero-side-panel"><div class="luxury-hero-side-links">${heroButtons}</div></aside>`
        : '';

      return `<section class="luxury-hero ${targetPage.page_key === homePageKey ? 'luxury-hero-home' : 'luxury-hero-inner'}"><div class="luxury-hero-media">${mediaMarkup}<div class="luxury-hero-overlay" style="opacity:${escapeHtml(String(overlayStrength))}"></div></div><div class="luxury-hero-copy"><a href="#section-destinations" class="luxury-map-link">${escapeHtml(systemCopy.header.viewMap)}</a><p class="luxury-hero-eyebrow">${escapeHtml(content.eyebrow || runtime.variant_label || '')}</p><h1>${escapeHtml(content.headline || runtimeHero?.title || targetTitle)}</h1><p class="luxury-hero-body">${escapeHtml(content.body || runtimeHero?.summary || targetDescription)}</p><div class="luxury-hero-actions"><a href="${escapeHtml(primaryHeroHref)}" class="luxury-primary-cta"${primaryHeroAttrs}>${escapeHtml(primaryHeroLabel)}</a><a href="${escapeHtml(content.secondary_cta_href || buildUniversalPublicPath(site.tenant_id, 'contact-us'))}" class="luxury-secondary-cta">${escapeHtml(localizedSecondaryExplicit || systemCopy.cta.planWithConcierge)}</a></div></div>${heroSidePanel}${searchMarkup}</section>`;
    }

    if (profile.hero === 'editorial') {
      return `<section class="grid gap-6 rounded-[32px] bg-white p-6 shadow-sm lg:grid-cols-[0.8fr_1.2fr]"><div class="rounded-[26px] bg-slate-950 p-6 text-white"><p class="text-xs uppercase tracking-[0.24em] text-white/60">${escapeHtml(content.eyebrow || runtime.variant_label || '')}</p><h1 class="mt-4 text-5xl font-semibold leading-tight">${escapeHtml(content.headline || targetTitle)}</h1><p class="mt-5 text-lg text-white/78">${escapeHtml(content.body || targetDescription)}</p><div class="mt-8 flex gap-3"><a href="${escapeHtml(primaryHeroHref)}" class="rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950"${primaryHeroAttrs}>${escapeHtml(primaryHeroLabel)}</a></div></div><div class="grid gap-4">${imageMarkup}<div class="grid gap-4 sm:grid-cols-2"><div class="rounded-[22px] bg-amber-50 p-5"><p class="text-xs uppercase tracking-[0.2em] text-slate-500">Layout</p><p class="mt-2 text-xl font-semibold text-slate-900">Editorial luxury composition</p></div><div class="rounded-[22px] bg-slate-50 p-5"><p class="text-xs uppercase tracking-[0.2em] text-slate-500">Starting price</p><p class="mt-2 text-xl font-semibold text-slate-900">${escapeHtml(snapshot?.price_from != null ? `$${snapshot.price_from}` : 'Request quote')}</p></div></div></div></section>`;
    }

    if (profile.hero === 'immersive') {
      return `<section class="relative overflow-hidden rounded-[36px] text-white shadow-sm" style="background:linear-gradient(135deg, ${escapeHtml(primaryColor)}, ${escapeHtml(secondaryColor)})"><div class="grid gap-6 p-6 lg:grid-cols-[1.1fr_0.9fr] lg:p-10"><div class="relative z-10"><p class="text-xs uppercase tracking-[0.24em] text-white/70">${escapeHtml(content.eyebrow || runtime.variant_label || '')}</p><h1 class="mt-4 max-w-3xl text-5xl font-semibold leading-tight lg:text-7xl">${escapeHtml(content.headline || targetTitle)}</h1><p class="mt-5 max-w-2xl text-lg text-white/82">${escapeHtml(content.body || targetDescription)}</p><div class="mt-8 flex flex-wrap gap-3"><a href="${escapeHtml(primaryHeroHref)}" class="rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950"${primaryHeroAttrs}>${escapeHtml(primaryHeroLabel)}</a><span class="rounded-full bg-white/15 px-4 py-3 text-sm">${escapeHtml(String(itinerary.length))} itinerary stops</span></div></div><div class="rounded-[28px] bg-white/10 p-3 backdrop-blur">${imageMarkup}</div></div></section>`;
    }

    if (profile.hero === 'compact' || profile.hero === 'utility') {
      return `<section class="grid gap-4 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm lg:grid-cols-[1.2fr_0.8fr]"><div><p class="text-xs uppercase tracking-[0.24em] text-slate-500">${escapeHtml(content.eyebrow || runtime.variant_label || '')}</p><h1 class="mt-3 text-4xl font-semibold text-slate-950">${escapeHtml(content.headline || targetTitle)}</h1><p class="mt-4 max-w-2xl text-base leading-7 text-slate-600">${escapeHtml(content.body || targetDescription)}</p><div class="mt-6 flex flex-wrap gap-3"><a href="${escapeHtml(primaryHeroHref)}" class="rounded-full px-4 py-2 text-sm font-semibold text-white" style="background:${escapeHtml(primaryColor)}"${primaryHeroAttrs}>${escapeHtml(primaryHeroLabel)}</a><span class="rounded-full bg-slate-100 px-4 py-2 text-sm text-slate-700">${escapeHtml(snapshot?.price_from != null ? `$${snapshot.price_from}` : systemCopy.cta.fastQuote)}</span></div></div><div class="rounded-[20px] bg-slate-50 p-2">${imageMarkup}</div></section>`;
    }

    return `<section class="grid gap-6 rounded-[30px] px-6 py-8 text-white shadow-sm lg:grid-cols-[1.1fr_0.9fr] lg:px-8 lg:py-10" style="background:linear-gradient(135deg, ${escapeHtml(primaryColor)}, ${escapeHtml(secondaryColor)})"><div><p class="text-xs uppercase tracking-[0.24em] text-white/75">${escapeHtml(content.eyebrow || runtime.variant_label || '')}</p><h1 class="mt-4 text-5xl font-semibold leading-tight lg:text-6xl">${escapeHtml(content.headline || targetTitle)}</h1><p class="mt-5 max-w-2xl text-lg text-white/85">${escapeHtml(content.body || targetDescription)}</p><div class="mt-8 flex flex-wrap gap-3"><a href="${escapeHtml(primaryHeroHref)}" class="rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950"${primaryHeroAttrs}>${escapeHtml(primaryHeroLabel)}</a><span class="rounded-full bg-white/15 px-4 py-3 text-sm">${escapeHtml(String(highlights.length || itinerary.length))} highlights</span></div></div><div class="rounded-[24px] bg-white/10 p-3 backdrop-blur">${imageMarkup}</div></section>`;
  };

  const renderGallery = (block, targetPage = page) => {
    const targetTitle = getPageTitle(targetPage);
    const themedGallery = activeTheme.renderGallery?.({
      block,
      targetPage,
      targetTitle,
      tourRuntime,
      gallery,
    });
    if (themedGallery) return themedGallery;
    const images = Array.isArray(block.content?.images) && block.content.images.length
      ? block.content.images
      : (tourRuntime.featured_collection?.gallery_images?.length ? tourRuntime.featured_collection.gallery_images : gallery);
    if (!images.length) return '';
    if (isLuxuryShell) {
      return `<section class="luxury-gallery-band" data-luxury-gallery><div class="luxury-gallery-head"><p class="luxury-section-kicker">${escapeHtml(block.label || 'Gallery')}</p><h2>${escapeHtml(block.content?.heading || 'Gallery')}</h2><p>${escapeHtml(block.content?.body || 'Move through the collection one frame at a time, with large left and right controls instead of a raw scroll bar.')}</p></div><div class="luxury-gallery-stage">${images.map((item, index) => `<figure class="luxury-gallery-slide ${index === 0 ? 'is-active' : ''}" data-gallery-item="${escapeHtml(String(index))}">${buildResponsiveImageMarkup(item.src, item.alt || targetTitle, 'luxury-gallery-image', 'cover', '(min-width: 1200px) 100vw, 100vw')}<figcaption>${escapeHtml(item.caption || item.alt || targetTitle)}</figcaption></figure>`).join('')}<button type="button" class="luxury-gallery-nav luxury-gallery-prev" data-gallery-nav="-1" aria-label="Previous image">&lt;</button><button type="button" class="luxury-gallery-nav luxury-gallery-next" data-gallery-nav="1" aria-label="Next image">&gt;</button></div><div class="luxury-gallery-thumbs">${images.map((item, index) => `<button type="button" class="luxury-gallery-thumb ${index === 0 ? 'is-active' : ''}" data-gallery-thumb="${escapeHtml(String(index))}"><span>${escapeHtml(String(index + 1).padStart(2, '0'))}</span><strong>${escapeHtml(item.alt || item.caption || targetTitle)}</strong></button>`).join('')}</div></section>`;
    }
    if (profile.gallery === 'panorama' || profile.gallery === 'cinematic') {
      const lead = images[0];
      const tail = images.slice(1, 4);
      return `<section class="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]"><div class="overflow-hidden rounded-[28px] bg-white shadow-sm">${buildResponsiveImageMarkup(lead.src, lead.alt || targetTitle, 'h-[420px] w-full object-cover', 'cover', '(min-width: 1024px) 60vw, 100vw')}</div><div class="grid gap-4">${tail.map((item) => `<div class="overflow-hidden rounded-[22px] bg-white shadow-sm">${buildResponsiveImageMarkup(item.src, item.alt || targetTitle, 'h-[128px] w-full object-cover', 'cover', '(min-width: 1024px) 30vw, 100vw')}</div>`).join('')}</div></section>`;
    }
    if (profile.gallery === 'filmstrip') {
      return `<section class="overflow-x-auto"><div class="flex gap-4 pb-2">${images.map((item) => `<div class="min-w-[280px] overflow-hidden rounded-[24px] bg-white shadow-sm">${buildResponsiveImageMarkup(item.src, item.alt || targetTitle, 'h-[220px] w-[280px] object-cover', 'cover', '280px')}</div>`).join('')}</div></section>`;
    }
    if (profile.gallery === 'minimal') {
      return `<section class="grid gap-3 sm:grid-cols-2">${images.slice(0, 2).map((item) => `<div class="overflow-hidden rounded-[20px] bg-white shadow-sm">${buildResponsiveImageMarkup(item.src, item.alt || targetTitle, 'h-[220px] w-full object-cover', 'cover', '(min-width: 640px) 50vw, 100vw')}</div>`).join('')}</section>`;
    }
    return `<section class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">${images.slice(0, 6).map((item) => `<div class="overflow-hidden rounded-[22px] bg-white shadow-sm">${buildResponsiveImageMarkup(item.src, item.alt || targetTitle, 'aspect-square w-full object-cover', 'cover', '(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw')}</div>`).join('')}</section>`;
  };

  const renderFeatures = (block) => {
    const themedFeatures = activeTheme.renderFeatures?.({
      block,
      targetPage: page,
      theme,
      gallery,
      highlights,
      snapshot,
    });
    if (themedFeatures) return themedFeatures;
    const items = Array.isArray(block.content?.items) ? block.content.items : highlights;
    if (!items.length) return '';
    if (isLuxuryShell) {
      const storyImage = block.content?.story_image || buildLuxuryStoryImage(page);
      return `<section class="luxury-story-block"><div class="luxury-story-media">${buildResponsiveImageMarkup(storyImage, block.content?.heading || 'Story image', 'luxury-story-image', 'cover', '(min-width: 1200px) 36vw, 100vw')}</div><div class="luxury-story-copy"><p class="luxury-section-kicker">${escapeHtml(block.label || 'Story')}</p><h2>${escapeHtml(block.content?.heading || 'Why travelers choose us')}</h2><p class="luxury-story-body">${escapeHtml(block.content?.body || 'Quiet service, slow pacing, and design-led travel planning replace the usual brochure rhythm.')}</p><div class="luxury-story-list">${items.slice(0, 3).map((item) => `<article><h3>${escapeHtml(item.title || '')}</h3><p>${escapeHtml(item.body || '')}</p></article>`).join('')}</div></div></section>`;
    }
    return `<section class="rounded-[26px] bg-white p-6 shadow-sm"><p class="text-xs uppercase tracking-[0.24em] text-slate-500">${escapeHtml(block.label || 'Highlights')}</p><h2 class="mt-3 text-3xl font-semibold text-slate-950">${escapeHtml(block.content?.heading || 'Highlights')}</h2><p class="mt-3 max-w-2xl text-slate-600">${escapeHtml(block.content?.body || '')}</p><div class="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">${items.map((item, index) => `<article class="rounded-[20px] border border-slate-200 p-4"><p class="text-xs uppercase tracking-[0.24em] text-slate-500">${escapeHtml(String(index + 1).padStart(2, '0'))}</p><h3 class="mt-2 text-lg font-semibold text-slate-900">${escapeHtml(item.title || '')}</h3><p class="mt-2 text-sm leading-6 text-slate-600">${escapeHtml(item.body || '')}</p></article>`).join('')}</div></section>`;
  };

  const renderRich = (block, targetPage = page) => {
    const themedRich = activeTheme.renderRich?.({
      block,
      targetPage,
      targetDescription: getPageDescription(targetPage),
      theme,
      site,
      homeSlug,
      resolveListingCards,
      wrapEditableEntityCard,
      systemCopy,
    });
    if (themedRich) return themedRich;
    if (isLuxuryShell && targetPage.page_key === 'accommodation') {
      const cards = resolveListingCards('tour_runtime.accommodation_listing', targetPage);
      return `<section class="luxury-collection" style="--luxury-accent:${escapeHtml(normalizeStringValue(block.content?.accent_color, theme.colorAccent, '#7f3f73'))}"><div class="luxury-collection-head"><div><p class="luxury-section-kicker">${escapeHtml(block.label || 'Accommodation')}</p><h2>${escapeHtml(block.content?.heading || 'Accommodation')}</h2></div><p>${escapeHtml(block.content?.body || getPageDescription(targetPage))}</p></div><div class="luxury-collection-grid luxury-collection-grid-portrait">${cards.map((card) => wrapEditableEntityCard({ block, card, targetPage, className: 'universal-entity-card luxury-entity-shell', contentHtml: `<a href="${escapeHtml(card.href || buildUniversalPublicPath(site.tenant_id, homeSlug))}" class="luxury-collection-card"><div class="luxury-collection-media is-portrait">${buildResponsiveImageMarkup(card.image, card.title, 'luxury-collection-image', 'cover', '(min-width: 1024px) 24vw, 100vw')}</div><div class="luxury-collection-copy"><p class="luxury-card-kicker">${escapeHtml(card.eyebrow || block.content?.card_label || 'Stay')}</p><h3>${escapeHtml(card.title)}</h3><p>${escapeHtml(card.body)}</p></div></a>` })).join('')}</div></section>`;
    }

    return `<section class="rounded-[26px] bg-white p-6 shadow-sm"><p class="text-xs uppercase tracking-[0.24em] text-slate-500">${escapeHtml(block.label || '')}</p><h2 class="mt-3 text-3xl font-semibold text-slate-950">${escapeHtml(block.content?.heading || block.label || '')}</h2><div class="mt-4 text-base leading-8 text-slate-700">${renderRichText(block.content?.body || getPageDescription(targetPage))}</div></section>`;
  };

  const renderItinerary = (block) => {
    const items = Array.isArray(block.content?.items) ? block.content.items : itinerary;
    if (!items.length) return '';
    if (profile.itinerary === 'numbered') {
      return `<section id="itinerary" class="rounded-[26px] bg-white p-6 shadow-sm"><h2 class="text-3xl font-semibold text-slate-950">${escapeHtml(block.content?.heading || 'Itinerary')}</h2><div class="mt-6 grid gap-4 md:grid-cols-2">${items.map((item, index) => `<article class="rounded-[22px] border border-slate-200 p-5"><p class="text-xs uppercase tracking-[0.24em] text-slate-500">Stage ${escapeHtml(String(index + 1))}</p><h3 class="mt-3 text-xl font-semibold text-slate-900">${escapeHtml(item.title || '')}</h3><p class="mt-1 text-sm text-slate-500">${escapeHtml(item.day_label || '')}</p><p class="mt-3 text-sm leading-7 text-slate-600">${escapeHtml(item.description || '')}</p></article>`).join('')}</div></section>`;
    }
    if (profile.itinerary === 'service-steps' || profile.itinerary === 'feature-list') {
      return `<section id="itinerary" class="rounded-[26px] bg-white p-6 shadow-sm"><h2 class="text-3xl font-semibold text-slate-950">${escapeHtml(block.content?.heading || 'Service flow')}</h2><div class="mt-6 space-y-3">${items.map((item, index) => `<div class="flex gap-4 rounded-[18px] bg-slate-50 p-4"><div class="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white" style="background:${escapeHtml(primaryColor)}">${escapeHtml(String(index + 1))}</div><div><h3 class="text-lg font-semibold text-slate-900">${escapeHtml(item.title || '')}</h3><p class="mt-1 text-sm leading-6 text-slate-600">${escapeHtml(item.description || '')}</p></div></div>`).join('')}</div></section>`;
    }
    return `<section id="itinerary" class="rounded-[26px] bg-white p-6 shadow-sm"><h2 class="text-3xl font-semibold text-slate-950">${escapeHtml(block.content?.heading || 'Itinerary')}</h2><div class="mt-6 space-y-5 border-l-2 border-slate-200 pl-6">${items.map((item) => `<article class="relative"><span class="absolute -left-[33px] top-2 h-4 w-4 rounded-full" style="background:${escapeHtml(secondaryColor)}"></span><h3 class="text-xl font-semibold text-slate-900">${escapeHtml(item.title || '')}</h3><p class="mt-1 text-sm text-slate-500">${escapeHtml(item.day_label || '')}</p><p class="mt-3 text-sm leading-7 text-slate-600">${escapeHtml(item.description || '')}</p></article>`).join('')}</div></section>`;
  };

  const renderPricing = (block) => {
    const activeTourId = normalizeStringValue(snapshot?.tour_id, activeBookingTourId);
    const isDayTour = snapshot?.tour_type === 'day_tour' || tourRuntime.tour_type_map?.[activeTourId] === 'day_tour';
    const cards = Array.isArray(block.content?.price_cards) ? block.content.price_cards : priceCards;
    const priceFromVal = snapshot?.price_from;
    if (!cards.length && priceFromVal == null) return '';
    const bookingCtaLabel = localizedThemeCtaLabel('booking', block.content?.cta_label);
    const bookingCtaHref = bookingPageHref || '#';
    const bookingCtaAttrs = bookingPageHref ? ' data-open-public-booking="1"' : '';
    const bookingCtaMarkup = `<div class="mt-6 flex justify-start"><a href="${escapeHtml(bookingCtaHref)}"${bookingCtaAttrs} class="inline-flex rounded-full px-5 py-3 text-sm font-semibold text-white" style="background:${escapeHtml(primaryColor)}">${escapeHtml(bookingCtaLabel)}</a></div>`;
    if (profile.pricing === 'table') {
      const thead = isDayTour
        ? `<tr><th class="px-6 py-3">${escapeHtml(systemCopy.pricing.segment)}</th><th class="px-6 py-3">${escapeHtml(systemCopy.pricing.season)}</th><th class="px-6 py-3">${escapeHtml(systemCopy.pricing.pax)}</th><th class="px-6 py-3">${escapeHtml(systemCopy.pricing.adult)}</th><th class="px-6 py-3">${escapeHtml(systemCopy.pricing.child)}</th><th class="px-6 py-3">${escapeHtml(systemCopy.pricing.infant)}</th></tr>`
        : `<tr><th class="px-6 py-3">${escapeHtml(systemCopy.pricing.segment)}</th><th class="px-6 py-3">${escapeHtml(systemCopy.pricing.season)}</th><th class="px-6 py-3">${escapeHtml(systemCopy.pricing.pax)}</th><th class="px-6 py-3">${escapeHtml(systemCopy.pricing.sharedRoom)}</th><th class="px-6 py-3">${escapeHtml(systemCopy.pricing.singleRoom)}</th><th class="px-6 py-3">${escapeHtml(systemCopy.pricing.child)}</th></tr>`;
      const tbody = cards.map((card) => isDayTour
        ? `<tr class="border-t border-slate-100"><td class="px-6 py-4 font-medium text-slate-900">${escapeHtml(card.segment_name || card.segment_code || '')}</td><td class="px-6 py-4 text-slate-600">${escapeHtml(card.season_name || '')}</td><td class="px-6 py-4 text-slate-600">${escapeHtml(card.pax_range_label || '')}</td><td class="px-6 py-4 text-slate-900">${escapeHtml(card.adult_shared_room_price != null ? String(card.adult_shared_room_price) : '—')}</td><td class="px-6 py-4 text-slate-900">${escapeHtml(card.child_shared_with_parents_price != null ? String(card.child_shared_with_parents_price) : '—')}</td><td class="px-6 py-4 text-slate-900">${escapeHtml(card.infant_price != null ? String(card.infant_price) : '—')}</td></tr>`
        : `<tr class="border-t border-slate-100"><td class="px-6 py-4 font-medium text-slate-900">${escapeHtml(card.segment_name || card.segment_code || '')}</td><td class="px-6 py-4 text-slate-600">${escapeHtml(card.season_name || '')}</td><td class="px-6 py-4 text-slate-600">${escapeHtml(card.pax_range_label || '')}</td><td class="px-6 py-4 text-slate-900">${escapeHtml(String(card.adult_shared_room_price ?? 'n/a'))}</td><td class="px-6 py-4 text-slate-900">${escapeHtml(String(card.adult_single_room_price ?? 'n/a'))}</td><td class="px-6 py-4 text-slate-900">${escapeHtml(card.child_shared_with_parents_price != null ? String(card.child_shared_with_parents_price) : '—')}</td></tr>`
      ).join('');
      return `<section id="pricing" class="overflow-hidden rounded-[26px] bg-white shadow-sm"><div class="border-b border-slate-200 px-6 py-5"><h2 class="text-3xl font-semibold text-slate-950">${escapeHtml(block.content?.heading || 'Pricing')}</h2></div><div class="overflow-x-auto"><table class="min-w-full text-sm"><thead class="bg-slate-50 text-left text-slate-500">${thead}</thead><tbody>${tbody}</tbody></table></div><div class="px-6 pb-6">${bookingCtaMarkup}</div></section>`;
    }
    if (profile.pricing === 'sidebar' || profile.pricing === 'spotlight') {
      const segmentGroups = Array.from(cards.reduce((map, card, index) => {
        const key = String(card.segment_id || card.segment_code || card.segment_name || `segment-${index}`);
        const sharedPrice = typeof card.adult_shared_room_price === 'number' && Number.isFinite(card.adult_shared_room_price) && card.adult_shared_room_price > 0
          ? card.adult_shared_room_price
          : null;
        const singlePrice = typeof card.adult_single_room_price === 'number' && Number.isFinite(card.adult_single_room_price) && card.adult_single_room_price > 0
          ? card.adult_single_room_price
          : null;
        const candidateRank = Math.min(sharedPrice ?? Number.POSITIVE_INFINITY, singlePrice ?? Number.POSITIVE_INFINITY);
        const current = map.get(key);
        const infantPriceVal = typeof card.infant_price === 'number' && Number.isFinite(card.infant_price) && card.infant_price > 0 ? card.infant_price : null;
        if (!current) {
          map.set(key, {
            segment_name: card.segment_name || card.segment_code || 'Segment',
            season_name: card.season_name || '',
            pax_range_label: card.pax_range_label || '',
            shared_price: sharedPrice,
            single_price: singlePrice,
            child_price: typeof card.child_shared_with_parents_price === 'number' && Number.isFinite(card.child_shared_with_parents_price) && card.child_shared_with_parents_price > 0 ? card.child_shared_with_parents_price : null,
            infant_price: infantPriceVal,
            rank: candidateRank,
          });
          return map;
        }
        if (sharedPrice != null && (current.shared_price == null || sharedPrice < current.shared_price)) current.shared_price = sharedPrice;
        if (singlePrice != null && (current.single_price == null || singlePrice < current.single_price)) current.single_price = singlePrice;
        const childPrice = typeof card.child_shared_with_parents_price === 'number' && Number.isFinite(card.child_shared_with_parents_price) && card.child_shared_with_parents_price > 0 ? card.child_shared_with_parents_price : null;
        if (childPrice != null && (current.child_price == null || childPrice < current.child_price)) current.child_price = childPrice;
        if (infantPriceVal != null && (current.infant_price == null || infantPriceVal < current.infant_price)) current.infant_price = infantPriceVal;
        if (candidateRank < current.rank) {
          current.rank = candidateRank;
          current.season_name = card.season_name || current.season_name;
          current.pax_range_label = card.pax_range_label || current.pax_range_label;
        }
        return map;
      }, new Map()).values()).sort((left, right) => left.rank - right.rank);

      const priceChip = priceFromVal != null ? `<span class="inline-flex items-center rounded-full px-4 py-1.5 text-sm font-semibold text-white" style="background:${escapeHtml(primaryColor)}">${escapeHtml(block.content?.price_from_label || systemCopy.pricing.from)} $${priceFromVal}</span>` : '';
      const pricingTableHtml = segmentGroups.length ? (isDayTour
        ? `<div class="mt-5 overflow-x-auto rounded-[18px] border border-slate-200"><table class="min-w-full text-sm"><thead class="bg-slate-50 text-left text-slate-500"><tr><th class="px-4 py-3 font-medium">${escapeHtml(systemCopy.pricing.segment)}</th><th class="px-4 py-3 font-medium">${escapeHtml(systemCopy.pricing.season)}</th><th class="px-4 py-3 font-medium">${escapeHtml(systemCopy.pricing.pax)}</th><th class="px-4 py-3 font-medium">${escapeHtml(systemCopy.pricing.adult)}</th><th class="px-4 py-3 font-medium">${escapeHtml(systemCopy.pricing.child)}</th><th class="px-4 py-3 font-medium">${escapeHtml(systemCopy.pricing.infant)}</th></tr></thead><tbody>${segmentGroups.map((card) => `<tr class="border-t border-slate-100"><td class="px-4 py-3 font-medium text-slate-900">${escapeHtml(card.segment_name)}</td><td class="px-4 py-3 text-slate-600">${escapeHtml(card.season_name)}</td><td class="px-4 py-3 text-slate-600">${escapeHtml(card.pax_range_label)}</td><td class="px-4 py-3 text-slate-900">${escapeHtml(card.shared_price != null ? String(card.shared_price) : '\u2014')}</td><td class="px-4 py-3 text-slate-900">${escapeHtml(card.child_price != null ? String(card.child_price) : '\u2014')}</td><td class="px-4 py-3 text-slate-900">${escapeHtml(card.infant_price != null ? String(card.infant_price) : '\u2014')}</td></tr>`).join('')}</tbody></table></div>`
        : `<div class="mt-5 overflow-x-auto rounded-[18px] border border-slate-200"><table class="min-w-full text-sm"><thead class="bg-slate-50 text-left text-slate-500"><tr><th class="px-4 py-3 font-medium">${escapeHtml(systemCopy.pricing.segment)}</th><th class="px-4 py-3 font-medium">${escapeHtml(systemCopy.pricing.season)}</th><th class="px-4 py-3 font-medium">${escapeHtml(systemCopy.pricing.pax)}</th><th class="px-4 py-3 font-medium">${escapeHtml(systemCopy.pricing.sharedRoom)}</th><th class="px-4 py-3 font-medium">${escapeHtml(systemCopy.pricing.singleRoom)}</th><th class="px-4 py-3 font-medium">${escapeHtml(systemCopy.pricing.child)}</th></tr></thead><tbody>${segmentGroups.map((card) => `<tr class="border-t border-slate-100"><td class="px-4 py-3 font-medium text-slate-900">${escapeHtml(card.segment_name)}</td><td class="px-4 py-3 text-slate-600">${escapeHtml(card.season_name)}</td><td class="px-4 py-3 text-slate-600">${escapeHtml(card.pax_range_label)}</td><td class="px-4 py-3 text-slate-900">${escapeHtml(String(card.shared_price ?? '\u2014'))}</td><td class="px-4 py-3 text-slate-900">${escapeHtml(String(card.single_price ?? '\u2014'))}</td><td class="px-4 py-3 text-slate-900">${escapeHtml(card.child_price != null ? String(card.child_price) : '\u2014')}</td></tr>`).join('')}</tbody></table></div>`) : '';
      return `<section id="pricing" class="rounded-[26px] bg-white p-6 shadow-sm overflow-hidden"><div class="flex flex-wrap items-center justify-between gap-3"><h2 class="text-2xl font-semibold text-slate-950">${escapeHtml(block.content?.heading || 'Pricing')}</h2>${priceChip}</div>${pricingTableHtml}${bookingCtaMarkup}</section>`;
    }
    const priceFromDisplay = priceFromVal != null ? `$${priceFromVal}` : null;
    const priceFromBar = priceFromDisplay ? `<div class="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[18px] p-4 text-white" style="background:linear-gradient(135deg,${escapeHtml(primaryColor)},${escapeHtml(secondaryColor)})"><div><p class="text-[11px] uppercase tracking-[0.2em] text-white/70">${escapeHtml(block.content?.price_from_label || systemCopy.pricing.from)}</p><p class="mt-1 text-3xl font-semibold leading-none">${escapeHtml(priceFromDisplay)}</p></div><a href="${escapeHtml(bookingCtaHref)}"${bookingCtaAttrs} class="inline-flex shrink-0 rounded-full px-5 py-2.5 text-sm font-semibold text-white ring-2 ring-white/40 hover:ring-white/70 transition">${escapeHtml(bookingCtaLabel)}</a></div>` : bookingCtaMarkup;
    return `<section id="pricing" class="rounded-[26px] bg-white p-6 shadow-sm"><h2 class="text-2xl font-semibold text-slate-950 mb-4">${escapeHtml(block.content?.heading || 'Pricing')}</h2>${priceFromBar}<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">${cards.map((card) => `<article class="rounded-[18px] border border-slate-200 p-4"><h3 class="font-semibold text-slate-900">${escapeHtml(card.segment_name || card.segment_code || '')}</h3><p class="mt-1 text-xs text-slate-500">${escapeHtml(card.season_name || '')} • ${escapeHtml(card.pax_range_label || '')}</p><p class="mt-2 text-sm text-slate-700">${escapeHtml(systemCopy.pricing.shared)}: <span class="font-semibold text-slate-900">${escapeHtml(String(card.adult_shared_room_price ?? 'n/a'))}</span></p><p class="text-sm text-slate-700">${escapeHtml(systemCopy.pricing.single)}: <span class="font-semibold text-slate-900">${escapeHtml(String(card.adult_single_room_price ?? 'n/a'))}</span></p>${card.child_shared_with_parents_price != null ? `<p class="text-sm text-slate-700">Child: <span class="font-semibold text-slate-900">${escapeHtml(String(card.child_shared_with_parents_price))}</span></p>` : ''}</article>`).join('')}</div></section>`;
  };

  const renderContact = (block) => {
    return `<section class="rounded-[26px] bg-white p-6 shadow-sm"><h2 class="text-3xl font-semibold text-slate-950">${escapeHtml(block.content?.heading || 'Contact')}</h2><p class="mt-3 text-slate-600">${escapeHtml(block.content?.body || '')}</p><div class="mt-6 grid gap-3 md:grid-cols-2">${visibleContactEntries.length ? visibleContactEntries.map(([key, value]) => wrapEditableEntityCard({ block, targetPage: page, card: { entity_id: key, entity_type: 'contact', entity_label: buildChannelLabel(key, value), entity_title: buildChannelLabel(key, value), entity_body: value.value, entity_value: value.value, channel_key: key }, className: 'universal-entity-card universal-contact-entity', contentHtml: `<a href="${escapeHtml(buildChannelHref(key, value))}" class="rounded-[18px] border border-slate-200 px-4 py-4 text-sm font-medium text-slate-900">${escapeHtml(buildChannelLabel(key, value))}: ${escapeHtml(value.value)}</a>` })).join('') : `<p class="text-slate-500">${escapeHtml(systemCopy.contact.noChannels)}</p>`}</div></section>`;
  };

  const renderListing = (block, targetPage = page) => {
    const cards = resolveListingCards(block.data_bindings?.cards?.source, targetPage);
    if (searchState.q && !cards.length) {
      return buildSearchEmptyState(targetPage, block);
    }

    const themedListing = activeTheme.renderListing?.({
      block,
      targetPage,
      theme,
      site,
      homeSlug,
      resolveListingCards,
      wrapEditableEntityCard,
      searchState,
      cards,
      systemCopy,
    });
    if (themedListing) return themedListing;
    if (isLuxuryShell) {
      const accentColor = normalizeStringValue(block.content?.accent_color, theme.colorAccent, '#7f3f73');
      return `<section class="luxury-collection" style="--luxury-accent:${escapeHtml(accentColor)}"><div class="luxury-collection-head"><div><p class="luxury-section-kicker">${escapeHtml(targetPage.title || block.label || 'Collection')}</p><h2>${escapeHtml(block.content?.heading || 'Collection')}</h2></div><p>${escapeHtml(block.content?.body || '')}</p></div><div class="luxury-collection-grid">${cards.map((card) => wrapEditableEntityCard({ block, card, targetPage, className: 'universal-entity-card luxury-entity-shell', contentHtml: `<a href="${escapeHtml(card.href || buildUniversalPublicPath(site.tenant_id, targetPage.slug || targetPage.page_key || homeSlug))}" class="luxury-collection-card"><div class="luxury-collection-media ${card.image_layout === 'portrait' ? 'is-portrait' : ''}">${buildResponsiveImageMarkup(card.image, card.title, 'luxury-collection-image', 'cover', '(min-width: 1024px) 30vw, 100vw')}</div><div class="luxury-collection-copy"><p class="luxury-card-kicker">${escapeHtml(card.eyebrow || block.content?.card_label || 'Collection')}</p><h3>${escapeHtml(card.title)}</h3><p>${escapeHtml(card.body)}</p>${card.meta ? `<span class="luxury-card-meta">${escapeHtml(card.meta)}</span>` : ''}</div></a>` })).join('')}</div></section>`;
    }

    return `<section class="rounded-[26px] bg-white p-6 shadow-sm"><h2 class="text-3xl font-semibold text-slate-950">${escapeHtml(block.content?.heading || 'Collection')}</h2><p class="mt-3 max-w-2xl text-slate-600">${escapeHtml(block.content?.body || '')}</p><div class="mt-6 rounded-[20px] border border-dashed border-slate-300 p-6 text-sm text-slate-500">Listing data binding placeholder: ${escapeHtml(block.data_bindings?.cards?.source || 'runtime collection')}</div></section>`;
  };
  const renderBookingSlot = () => '';

  const wrapAdminBlock = (block, targetPage, html) => {
    if (!adminMode || !html || !adminEditableTypes.has(block.type)) return html;
    const blockLabel = block.label || block.content?.heading || block.content?.headline || block.type;
    const managementTarget = resolveManagementTarget(targetPage, block);
    const sectionType = `${managementTarget}-${String(block.type || 'content')}`;
    return `<div class="universal-admin-slot" data-universal-editable="1" data-ve-section="1" data-section-id="${escapeHtml(block.id || block.type)}" data-section-type="${escapeHtml(sectionType)}" data-section-label="${escapeHtml(blockLabel)}" data-admin-page-key="${escapeHtml(targetPage.page_key || page.page_key || 'home')}" data-admin-block-id="${escapeHtml(block.id || block.type)}" data-admin-block-type="${escapeHtml(block.type)}" data-admin-block-label="${escapeHtml(blockLabel)}" data-admin-management-target="${escapeHtml(managementTarget)}">${html}</div>`;
  };

  const renderIncludesExcludes = (block) => {
    const inc = Array.isArray(block.content?.includes) ? block.content.includes : [];
    const exc = Array.isArray(block.content?.excludes) ? block.content.excludes : [];
    if (!inc.length && !exc.length) return '';
    const incHtml = inc.length ? `<div><h3 class="mb-3 text-base font-semibold text-slate-900">Included</h3><ul class="space-y-2">${inc.map((item) => `<li class="flex items-start gap-2 text-sm text-slate-700"><span class="mt-0.5 shrink-0 text-emerald-500">✓</span>${escapeHtml(item)}</li>`).join('')}</ul></div>` : '';
    const excHtml = exc.length ? `<div><h3 class="mb-3 text-base font-semibold text-slate-900">Not Included</h3><ul class="space-y-2">${exc.map((item) => `<li class="flex items-start gap-2 text-sm text-slate-700"><span class="mt-0.5 shrink-0 text-slate-400">✗</span>${escapeHtml(item)}</li>`).join('')}</ul></div>` : '';
    return `<section class="rounded-[26px] bg-white p-6 shadow-sm"><h2 class="mb-5 text-2xl font-semibold text-slate-950">${escapeHtml(block.content?.heading || 'Included & Excluded')}</h2><div class="grid gap-6 md:grid-cols-2">${incHtml}${excHtml}</div></section>`;
  };

  const renderDestinationCarousel = (block) => {
    const items = Array.isArray(block.content?.items) ? block.content.items : [];
    if (!items.length) return '';
    const slides = items.map((item, i) => `<article class="destination-slide shrink-0 w-[80vw] max-w-[360px] sm:w-[340px] snap-start overflow-hidden rounded-[22px] bg-white shadow-sm" aria-label="${escapeHtml(item.name || '')}"><div class="relative h-[220px] overflow-hidden bg-slate-200">${item.image ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name || '')}" class="h-full w-full object-cover" loading="${i === 0 ? 'eager' : 'lazy'}" />` : `<div class="h-full w-full flex items-center justify-center text-slate-400 text-4xl">✦</div>`}<span class="absolute bottom-3 left-3 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">${escapeHtml(item.day_label || '')}</span></div><div class="p-4"><h3 class="text-lg font-semibold text-slate-900">${escapeHtml(item.name || '')}</h3>${item.nights ? `<p class="mt-0.5 text-xs text-slate-500">${escapeHtml(String(item.nights))} night${item.nights !== 1 ? 's' : ''}</p>` : ''}<p class="mt-2 text-sm leading-6 text-slate-600 line-clamp-3">${escapeHtml(item.description || '')}</p></div></article>`).join('');
    return `<section class="rounded-[26px] bg-white p-6 shadow-sm" id="destinations"><h2 class="mb-5 text-2xl font-semibold text-slate-950">${escapeHtml(block.content?.heading || 'Destinations')}</h2><div class="relative"><div class="destination-track flex gap-4 overflow-x-auto pb-3 snap-x snap-mandatory" style="scroll-behavior:smooth;-ms-overflow-style:none;scrollbar-width:none" data-carousel="destination">${slides}</div><button type="button" class="carousel-prev absolute -left-3 top-1/2 -translate-y-1/2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-md text-slate-600 hover:bg-slate-50" data-carousel-target="destination" data-dir="-1" aria-label="Previous">‹</button><button type="button" class="carousel-next absolute -right-3 top-1/2 -translate-y-1/2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-md text-slate-600 hover:bg-slate-50" data-carousel-target="destination" data-dir="1" aria-label="Next">›</button></div></section>`;
  };

  const renderHotelCarousel = (block) => {
    const items = Array.isArray(block.content?.items) ? block.content.items : [];
    if (!items.length) return '';
    // Expand: each image of each hotel becomes a slide; hotel info overlaid at bottom
    const slides = items.flatMap((item, hotelIdx) => {
      const imgs = Array.isArray(item.images) && item.images.length ? item.images : [{ src: item.image || '', alt: item.name || '' }];
      return imgs.map((img, imgIdx) => {
        const isFirst = hotelIdx === 0 && imgIdx === 0;
        const photoCountBadge = imgs.length > 1 ? `<span class="absolute top-3 right-3 rounded-full bg-black/50 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">${imgIdx + 1}/${imgs.length}</span>` : '';
        return `<article class="hotel-slide shrink-0 w-[72vw] max-w-[300px] sm:w-[280px] snap-start rounded-[22px] overflow-hidden bg-white shadow-sm" aria-label="${escapeHtml(item.name || '')}"><div class="relative bg-slate-200" style="aspect-ratio:3/4">${img.src ? `<img src="${escapeHtml(img.src)}" alt="${escapeHtml(img.alt || item.name || '')}" class="h-full w-full object-cover" loading="${isFirst ? 'eager' : 'lazy'}" />` : `<div class="h-full w-full flex items-center justify-center text-slate-400 text-4xl">🏨</div>`}${photoCountBadge}<div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4"><h3 class="text-sm font-semibold text-white leading-snug">${escapeHtml(item.name || '')}</h3>${item.location ? `<p class="mt-0.5 text-[11px] text-white/70 truncate" title="${escapeHtml(item.location)}">${escapeHtml(item.location)}</p>` : ''}</div></div>${item.description && imgIdx === 0 ? `<div class="px-4 py-3"><p class="text-xs leading-5 text-slate-600 line-clamp-3">${escapeHtml(item.description)}</p></div>` : ''}</article>`;
      });
    }).join('');
    return `<section class="rounded-[26px] bg-white p-6 shadow-sm" id="hotels"><h2 class="mb-5 text-2xl font-semibold text-slate-950">${escapeHtml(block.content?.heading || 'Where You Stay')}</h2><div class="relative"><div class="hotel-track flex gap-4 overflow-x-auto pb-3 snap-x snap-mandatory" style="scroll-behavior:smooth;-ms-overflow-style:none;scrollbar-width:none" data-carousel="hotel">${slides}</div><button type="button" class="carousel-prev absolute -left-3 top-1/2 -translate-y-1/2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-md text-slate-600 hover:bg-slate-50" data-carousel-target="hotel" data-dir="-1" aria-label="Previous">‹</button><button type="button" class="carousel-next absolute -right-3 top-1/2 -translate-y-1/2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-md text-slate-600 hover:bg-slate-50" data-carousel-target="hotel" data-dir="1" aria-label="Next">›</button></div></section>`;
  };

  const renderBlocksList = (blockList, targetPage = page) => blockList.map((block) => {
    let html = '';
    switch (block.type) {
      case 'hero': html = renderHero(block, targetPage); break;
      case 'gallery': html = renderGallery(block, targetPage); break;
      case 'features': html = renderFeatures(block); break;
      case 'rich_text':
      case 'legal': html = renderRich(block, targetPage); break;
      case 'itinerary': html = renderItinerary(block); break;
      case 'pricing_spotlight': html = renderPricing(block); break;
      case 'contact': html = renderContact(block); break;
      case 'listing':
      case 'reservation_entry':
      case 'booking_entry': html = renderListing(block, targetPage); break;
      case 'booking_engine_slot': html = renderBookingSlot(block); break;
      case 'includes_excludes': html = renderIncludesExcludes(block); break;
      case 'destination_carousel': html = renderDestinationCarousel(block); break;
      case 'hotel_carousel': html = renderHotelCarousel(block); break;
      default: html = ''; break;
    }
    return wrapAdminBlock(block, targetPage, html);
  }).filter(Boolean).join('<div class="h-6"></div>');

  const buildMenuHref = (item) => {
    if (item.is_external) {
      return item.href || '#';
    }

    const linkedPage = pageMap.get(item.page_key);
    if (!linkedPage) {
      return item.href || '#';
    }

    if (linkedPage.page_key !== homePageKey && linkedPage.seo?.home_embedded && !excludedHomeEmbeddedKeys.has(linkedPage.page_key)) {
      const sectionHref = `#section-${linkedPage.page_key}`;
      return isHomePage ? sectionHref : `${buildUniversalPublicPath(site.tenant_id, homeSlug)}${sectionHref}`;
    }

    return buildUniversalPublicPath(site.tenant_id, linkedPage.slug || item.href?.replace(/^\//, '') || homeSlug);
  };

  const embeddedPages = [];
  const embeddedPageKeys = new Set();
  if (isHomePage) {
    for (const item of menuItems) {
      const linkedPage = pageMap.get(item.page_key);
      if (!linkedPage || linkedPage.page_key === homePageKey || embeddedPageKeys.has(linkedPage.page_key)) {
        continue;
      }
      if (excludedHomeEmbeddedKeys.has(linkedPage.page_key)) {
        continue;
      }
      if (!linkedPage.seo?.home_embedded) {
        continue;
      }
      embeddedPageKeys.add(linkedPage.page_key);
      embeddedPages.push({ page: linkedPage, menuItem: item });
    }
  }

  const activeTourType = snapshot?.tour_type || tourRuntime.tour_type_map?.[activeBookingTourId] || 'package';
  const bookingInlineMarkup = page.page_key === (groupConfig.reservationPageKey || 'booking') && requestedBookingTourId
    ? `<section data-public-booking-view="1" data-mode="inline" data-tour-id="${escapeHtml(requestedBookingTourId)}" data-tenant-id="${escapeHtml(site.tenant_id)}" data-currency="${escapeHtml(site.booking_currency || 'USD')}" data-tour-type="${escapeHtml(activeTourType)}" data-auto-open="1"></section>`
    : '';
  const renderedBlocks = `${bookingInlineMarkup}${renderBlocksList(blocks, page)}`;

  // Luxury home: inject featured tours, destination and accommodation sections
  // These are not in the home page's blocks_json, so they must be injected here.
  let luxuryHomeCatalogSections = '';
  if (isLuxuryShell && isHomePage) {
    const featuredTourCards = tourRuntime.featured_tours || [];
    const homeDestCards = tourRuntime.home_destination_listing || [];
    const homeHotelCards = tourRuntime.home_accommodation_listing || [];
    const featuredToursPage = pageMap.get('featured-tours') || pageMap.get('tours') || { page_key: 'tours', slug: 'tours', title: 'Tours', blocks: [], seo: {} };
    const destinationsPage = pageMap.get('destinations') || { page_key: 'destinations', slug: 'destinations', title: 'Destinations', blocks: [], seo: {} };
    const accommodationPage = pageMap.get('accommodation') || { page_key: 'accommodation', slug: 'accommodation', title: 'Accommodation', blocks: [], seo: {} };

    // Inject featured tours only if the operator has explicitly toggled tours as featured
    // Use title:'' on fake pages so the theme kicker falls back to block.label (preventing kicker == heading duplication)
    if (tourRuntime.has_explicit_featured_tours && featuredTourCards.length) {
      const fakeFeaturedBlock = {
        id: 'home-featured-tours',
        type: 'listing',
        label: 'Explore',
        content: { heading: 'Featured Tours', body: '' },
        data_bindings: { cards: { source: 'tour_runtime.featured_tours' } },
      };
      const featuredSection = renderListing(fakeFeaturedBlock, { page_key: 'featured-tours', slug: 'featured-tours', title: '', blocks: [], seo: {} });
      if (featuredSection) {
        luxuryHomeCatalogSections += `<div id="section-featured-tours" class="scroll-mt-28">${featuredSection}</div>`;
      }
    }

    if (homeDestCards.length) {
      const fakeDestBlock = {
        id: 'home-destinations',
        type: 'listing',
        label: 'Where we go',
        content: { heading: 'Destinations', body: '' },
        data_bindings: { cards: { source: 'tour_runtime.destination_listing' } },
      };
      const destSection = renderListing(fakeDestBlock, { page_key: 'destinations', slug: 'destinations', title: '', blocks: [], seo: {} });
      if (destSection) {
        luxuryHomeCatalogSections += `<div id="section-destinations" class="scroll-mt-28">${destSection}</div>`;
      }
    }

    if (homeHotelCards.length) {
      const fakeHotelBlock = {
        id: 'home-accommodation',
        type: 'listing',
        label: 'Where we stay',
        content: { heading: 'Accommodation', body: '' },
        data_bindings: { cards: { source: 'tour_runtime.accommodation_listing' } },
      };
      const hotelSection = renderListing(fakeHotelBlock, { page_key: 'accommodation', slug: 'accommodation', title: '', blocks: [], seo: {} });
      if (hotelSection) {
        luxuryHomeCatalogSections += `<div id="section-accommodation" class="scroll-mt-28">${hotelSection}</div>`;
      }
    }
  }

  const renderedEmbeddedSections = embeddedPages.map(({ page: embeddedPage, menuItem }) => {
    const embeddedBlocks = Array.isArray(embeddedPage.blocks) ? embeddedPage.blocks : [];
    const embeddedBody = renderBlocksList(embeddedBlocks, embeddedPage) || `<section class="rounded-[26px] bg-white p-6 shadow-sm"><h2 class="text-3xl font-semibold text-slate-950">${escapeHtml(getPageTitle(embeddedPage))}</h2><p class="mt-4 text-slate-600">${escapeHtml(getPageDescription(embeddedPage))}</p></section>`;
    return `<section id="section-${escapeHtml(embeddedPage.page_key)}" class="scroll-mt-28"><div class="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p class="text-xs uppercase tracking-[0.24em] text-slate-500">${escapeHtml(menuItem.label || embeddedPage.title)}</p><h2 class="mt-2 text-3xl font-semibold text-slate-950">${escapeHtml(embeddedPage.title)}</h2></div><a href="${escapeHtml(buildUniversalPublicPath(site.tenant_id, embeddedPage.slug || embeddedPage.page_key))}" class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900">${escapeHtml(systemCopy.cta.openStandalonePage)}</a></div>${embeddedBody}</section>`;
  }).join('<div class="h-10"></div>');

  const headerPrimaryHref = buildPageHref(headerPrimaryPageKey);
  const headerPrimaryLabel = localizedThemeCtaLabel('discovery');

  const navMarkup = menuItems.length
    ? `<nav class="flex flex-wrap items-center justify-end gap-2 lg:max-w-[60%]">${menuItems.map((item) => `<a href="${escapeHtml(buildMenuHref(item))}" target="${escapeHtml(item.target || '_self')}"${item.is_external ? ' rel="noreferrer"' : ''} class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-950">${escapeHtml(item.label || item.page_key || systemCopy.nav.page)}</a>`).join('')}</nav>`
    : '';
  const logoMarkup = theme.logoUrl
    ? buildResponsiveImageMarkup(theme.logoUrl, site.site_name || 'Logo', 'luxury-logo-image', 'contain', '160px')
    : `<span class="luxury-logo-text">${escapeHtml(site.site_name || 'Travel House')}</span>`;
  const footerMarkup = isLuxuryShell
    ? activeTheme.renderFooter?.({ site, homeSlug, menuItems, channels, socialEntries, legalPages, logoMarkup, buildMenuHref, buildChannelHref, buildSocialMonogram, buildChannelLabel, theme, systemCopy })
    : '';
  const headerMarkup = isLuxuryShell
    ? activeTheme.renderHeader?.({ site, homeSlug, menuItems, buildMenuHref, headerCtaHref: headerPrimaryHref, headerCtaLabel: headerPrimaryLabel, socialEntries, buildChannelHref, buildChannelLabel, buildSocialMonogram, logoMarkup, theme, systemCopy })
    : `<header class="sticky top-0 z-30 border-b border-slate-200/70 bg-white/90 backdrop-blur"><div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6"><div><p class="text-xs uppercase tracking-[0.24em] text-slate-500">${escapeHtml(site.site_name || 'Travel')}</p><p class="text-lg font-semibold text-slate-900">${escapeHtml(title)}</p></div>${navMarkup}<a href="${escapeHtml(headerPrimaryHref)}" class="rounded-full px-4 py-2 text-sm font-medium text-white" style="background:${escapeHtml(primaryColor)}">${escapeHtml(headerPrimaryLabel)}</a></div></header>`;
  const floatingBookNowMarkup = isLuxuryShell
    ? activeTheme.renderFloatingBookNow?.({ channels, buildChannelHref, buildChannelLabel, buildSocialMonogram, theme, systemCopy })
    : '';
  const adminPreviewScript = '';
  const bookingViewMarkup = site.group_key === 'tour_operator' && activeBookingTourId
    ? `<div data-public-booking-host="drawer" data-tour-id="${escapeHtml(activeBookingTourId)}" data-tenant-id="${escapeHtml(site.tenant_id)}" data-currency="${escapeHtml(site.booking_currency || 'USD')}" data-tour-type="${escapeHtml(activeTourType)}"></div>
  <script src="/tour-booking-view.js"></script>`
    : '';
  const shellScript = isLuxuryShell
    ? activeTheme.buildScript?.({ theme, systemCopy })
    : '';

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
    ${buildThemeFontImports(theme)}
    :root {
      --color-primary: ${escapeHtml(primaryColor)};
      --color-secondary: ${escapeHtml(secondaryColor)};
      --color-surface: ${escapeHtml(surfaceColor)};
      --color-text: ${escapeHtml(textColor)};
    }
    html { scroll-behavior: smooth; }
    body { background: var(--color-surface); color: var(--color-text); font-family: ${escapeHtml(theme.fontBody || 'Inter, system-ui, sans-serif')}; }
    h1, h2, h3 { font-family: ${escapeHtml(theme.fontHeading || 'Inter, system-ui, sans-serif')}; }
    .universal-entity-card {
      position: relative;
      display: block;
      min-width: 0;
    }
    .universal-entity-card > a,
    .universal-entity-card > div,
    .universal-entity-card > article {
      display: block;
      height: 100%;
    }
    ${isLuxuryShell ? `
    body.luxury-editorial {
      background:
        linear-gradient(180deg, #f7f2ea 0, #f3ede3 220px, #fbf8f2 221px, #fbf8f2 100%);
      min-height: 100vh;
    }
    body.luxury-editorial::before {
      content: '';
      position: fixed;
      inset: 0;
      pointer-events: none;
      background: linear-gradient(90deg, rgba(90,59,39,0.025) 1px, transparent 1px);
      background-size: 44px 44px;
      opacity: 0.14;
    }
    body.luxury-editorial[data-menu-open='true'] { overflow: hidden; }
    .luxury-header {
      position: fixed;
      inset: 0 0 auto;
      z-index: 60;
      padding: 0;
      pointer-events: none;
    }
    .luxury-header-inner {
      width: 100%;
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      padding: 28px 34px;
      background: transparent;
      border-bottom: 1px solid transparent;
      transition: background 220ms ease, border-color 220ms ease, box-shadow 220ms ease;
      pointer-events: auto;
    }
    body[data-header-solid='false'] .luxury-header-inner {
      background: transparent;
      border-color: transparent;
      box-shadow: none;
      backdrop-filter: none;
    }
    body[data-header-solid='true'] .luxury-header-inner {
      background: rgba(246, 240, 231, 0.88);
      border-color: rgba(90,59,39,0.12);
      box-shadow: 0 12px 28px rgba(40, 28, 19, 0.08);
      backdrop-filter: blur(18px);
    }
    .luxury-header-left,
    .luxury-header-right {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .luxury-header-right {
      justify-self: end;
    }
    .luxury-menu-toggle {
      width: 46px;
      height: 46px;
      border-radius: 6px;
      border: 1px solid rgba(255,255,255,0.22);
      background: rgba(12, 10, 8, 0.18);
      backdrop-filter: blur(12px);
      display: inline-flex;
      flex-direction: column;
      justify-content: center;
      gap: 5px;
      padding: 0 12px;
      cursor: pointer;
    }
    .luxury-menu-toggle span {
      display: block;
      height: 1px;
      background: #fbf6ef;
    }
    .luxury-lang-chip {
      font-size: 12px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: rgba(255,248,238,0.88);
    }
    body[data-header-solid='true'] .luxury-lang-chip,
    body[data-header-solid='true'] .luxury-login-link,
    body[data-header-solid='true'] .luxury-logo {
      color: rgba(45,34,25,0.88);
    }
    .luxury-logo {
      justify-self: center;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
      color: #fff8ee;
    }
    .luxury-logo-text {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 220px;
      padding: 8px 12px;
      font: 500 28px/1 'Cormorant Garamond', serif;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      text-align: center;
    }
    .luxury-logo-image {
      max-width: 180px;
      max-height: 72px;
      object-fit: contain;
      filter: brightness(0) invert(1);
    }
    body[data-header-solid='true'] .luxury-logo-image {
      filter: none;
    }
    .luxury-login-link {
      text-decoration: none;
      color: rgba(255,248,238,0.88);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }
    .luxury-book-now {
      text-decoration: none;
      color: #fffaf8;
      background: #7f3f73;
      border-radius: 8px;
      padding: 14px 24px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      box-shadow: 0 12px 28px rgba(127, 63, 115, 0.22);
    }
    .luxury-floating-book-now {
      position: fixed;
      right: 28px;
      bottom: 28px;
      z-index: 58;
      display: inline-flex;
      align-items: center;
      gap: 12px;
      padding: 16px 22px;
      border-radius: 999px;
      text-decoration: none;
      color: #fffaf8;
      background: linear-gradient(135deg, #7f3f73 0%, #5a3b27 100%);
      border: 1px solid rgba(255, 250, 248, 0.24);
      box-shadow: 0 18px 42px rgba(50, 26, 45, 0.24);
      backdrop-filter: blur(16px);
      transform: translateY(24px);
      opacity: 0;
      pointer-events: none;
      transition: opacity 220ms ease, transform 220ms ease, box-shadow 220ms ease;
    }
    body[data-book-now-visible='true'] .luxury-floating-book-now {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }
    .luxury-floating-book-now:hover {
      box-shadow: 0 22px 52px rgba(50, 26, 45, 0.3);
    }
    .luxury-floating-book-now-label {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }
    .luxury-floating-book-now-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      border-radius: 999px;
      background: rgba(255, 250, 248, 0.16);
      font-size: 16px;
      line-height: 1;
    }
    .luxury-drawer-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(17, 12, 9, 0.42);
      opacity: 0;
      pointer-events: none;
      transition: opacity 180ms ease;
      z-index: 54;
    }
    .luxury-drawer {
      position: fixed;
      inset: 18px auto 18px 18px;
      width: min(420px, calc(100vw - 40px));
      padding: 28px;
      border-radius: 8px;
      background: rgba(251, 247, 240, 0.97);
      color: #f6efe5;
      border: 1px solid rgba(90,59,39,0.08);
      transform: translateX(calc(-100% - 40px));
      transition: transform 220ms ease;
      z-index: 55;
      backdrop-filter: blur(18px);
      display: grid;
      gap: 20px;
    }
    body[data-menu-open='true'] .luxury-drawer { transform: translateX(0); }
    body[data-menu-open='true'] .luxury-drawer-backdrop { opacity: 1; pointer-events: auto; }
    .luxury-drawer-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-size: 12px;
      letter-spacing: 0.24em;
      text-transform: uppercase;
      color: rgba(59,43,32,0.72);
    }
    .luxury-drawer-close {
      border: 1px solid rgba(90,59,39,0.16);
      background: transparent;
      color: inherit;
      padding: 10px 14px;
      border-radius: 6px;
      cursor: pointer;
    }
    .luxury-drawer-nav {
      display: grid;
      gap: 10px;
    }
    .luxury-drawer-nav a {
      color: #2d2219;
      text-decoration: none;
      font: 600 28px/1.1 'Cormorant Garamond', serif;
      padding: 10px 0;
      border-bottom: 1px solid rgba(90,59,39,0.08);
    }
    .luxury-social-rail {
      position: fixed;
      right: 26px;
      top: 50%;
      transform: translateY(-50%);
      display: flex;
      flex-direction: column;
      gap: 10px;
      z-index: 48;
    }
    .luxury-social-rail a {
      width: 44px;
      height: 44px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.12em;
      color: #fdf9f1;
      background: rgba(42, 29, 22, 0.58);
      border: 1px solid rgba(255,255,255,0.16);
      backdrop-filter: blur(14px);
    }
    .luxury-hero {
      position: relative;
      min-height: 100vh;
      width: 100vw;
      margin: 0 calc(50% - 50vw);
      border-radius: 0;
      overflow: hidden;
      background: #1a1511;
    }
    .luxury-hero-inner { min-height: 76vh; }
    .luxury-hero-media {
      position: absolute;
      inset: 0;
      overflow: hidden;
    }
    .luxury-hero-media-asset {
      width: 100%;
      height: 100%;
      object-fit: cover;
      animation: luxuryKenBurns 18s ease-in-out infinite alternate;
    }
    .luxury-hero-media-fallback {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      color: rgba(255,255,255,0.7);
      font-size: 18px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .luxury-hero-overlay {
      position: absolute;
      inset: 0;
      background: linear-gradient(180deg, rgba(17,12,9,0.06) 0%, rgba(17,12,9,0.22) 34%, rgba(17,12,9,0.54) 68%, rgba(17,12,9,0.88) 100%);
    }
    .luxury-hero-copy {
      position: relative;
      z-index: 2;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      min-height: inherit;
      max-width: 1380px;
      margin: 0 auto;
      padding: 168px 34px 176px;
      color: #fff8ee;
    }
    .luxury-hero-side-panel {
      position: absolute;
      right: 34px;
      bottom: 188px;
      z-index: 4;
      width: auto;
    }
    .luxury-hero-side-links {
      display: grid;
      gap: 18px;
      justify-items: end;
    }
    .luxury-hero-side-link {
      display: inline-flex;
      align-items: center;
      justify-content: flex-end;
      padding: 0;
      text-decoration: none;
      color: #fff8ee;
      font: 600 28px/1 'Cormorant Garamond', serif;
      letter-spacing: 0.02em;
      text-shadow: 0 10px 30px rgba(17, 12, 9, 0.35);
    }
    .luxury-map-link {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: rgba(255,248,238,0.9);
      text-decoration: none;
      font-size: 12px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      margin-bottom: 24px;
    }
    .luxury-hero-eyebrow {
      margin: 0;
      font-size: 12px;
      letter-spacing: 0.28em;
      text-transform: uppercase;
      color: rgba(255,248,238,0.72);
    }
    .luxury-hero-copy h1 {
      margin: 18px 0 0;
      max-width: 920px;
      font: 600 clamp(46px, 6vw, 90px)/0.96 'Cormorant Garamond', serif;
      letter-spacing: -0.04em;
    }
    .luxury-hero-body {
      max-width: 700px;
      margin: 18px 0 0;
      font-size: 17px;
      line-height: 1.72;
      color: rgba(255,248,238,0.82);
    }
    .luxury-hero-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      margin-top: 28px;
    }
    .luxury-primary-cta,
    .luxury-secondary-cta {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      padding: 14px 22px;
      text-decoration: none;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }
    .luxury-primary-cta {
      color: #22170f;
      background: linear-gradient(135deg, #f4ddb1, #d7b27a);
    }
    .luxury-secondary-cta {
      color: #fff8ee;
      border: 1px solid rgba(255,255,255,0.22);
      background: rgba(255,255,255,0.08);
    }
    .luxury-search-panel {
      margin-top: 0;
      display: grid;
      gap: 0;
      grid-template-columns: minmax(0, 1fr) auto;
      padding: 0;
      border-radius: 8px;
      background: rgba(255,255,255,0.96);
      border: 1px solid rgba(90,59,39,0.08);
      box-shadow: 0 16px 40px rgba(38, 28, 20, 0.12);
      overflow: hidden;
    }
    .luxury-hero-search-wrap {
      position: absolute;
      left: 34px;
      right: 34px;
      bottom: 32px;
      z-index: 4;
      max-width: 1380px;
      margin: 0 auto;
    }
    .luxury-search-grid {
      display: grid;
      gap: 0;
      grid-template-columns: minmax(0, 2.1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 0.8fr) minmax(0, 0.8fr);
    }
    .luxury-search-grid label {
      display: grid;
      gap: 8px;
      color: #725e4f;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      padding: 16px 18px;
      border-right: 1px solid rgba(90,59,39,0.08);
    }
    .luxury-search-grid label.luxury-search-label-primary {
      padding-left: 22px;
      padding-right: 24px;
    }
    .luxury-search-grid input {
      width: 100%;
      padding: 0;
      border-radius: 0;
      border: 0;
      background: transparent;
      color: #2d2219;
    }
    .luxury-search-cta {
      justify-self: stretch;
      border: 0;
      border-radius: 6px;
      margin: 10px;
      padding: 0 28px;
      background: #7f3f73;
      color: #fffaf8;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      cursor: pointer;
    }
    .luxury-collection {
      border-radius: 8px;
      padding: 34px;
      background: rgba(255,251,245,0.72);
      border: 1px solid rgba(90,59,39,0.08);
      box-shadow: 0 18px 50px rgba(65, 43, 28, 0.08);
    }
    .luxury-collection-head {
      display: grid;
      gap: 14px;
      grid-template-columns: 1.1fr 0.9fr;
      margin-bottom: 22px;
      align-items: end;
    }
    .luxury-collection-head h2 {
      margin: 6px 0 0;
      font: 600 clamp(34px, 4vw, 54px)/0.98 'Cormorant Garamond', serif;
      color: #2e2218;
    }
    .luxury-collection-head p {
      margin: 0;
      color: rgba(52,36,27,0.78);
      font-size: 17px;
      line-height: 1.7;
    }
    .luxury-section-kicker,
    .luxury-card-kicker,
    .luxury-footer-kicker {
      margin: 0;
      font-size: 11px;
      letter-spacing: 0.24em;
      text-transform: uppercase;
      color: rgba(90,59,39,0.68);
    }
    .luxury-card-body {
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
      margin: 0;
    }
    .luxury-collection-grid {
      display: grid;
      gap: 18px;
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .luxury-collection-carousel {
      --luxury-carousel-visible: 3;
      --luxury-carousel-gap: 18px;
      display: grid;
      gap: 14px;
    }
    .luxury-collection-carousel.is-portrait {
      --luxury-carousel-visible: 4;
    }
    .luxury-collection-viewport {
      overflow: hidden;
    }
    .luxury-collection-track {
      display: flex;
      gap: var(--luxury-carousel-gap);
      transition: transform 240ms ease;
      will-change: transform;
    }
    .luxury-carousel-item {
      flex: 0 0 calc((100% - (var(--luxury-carousel-gap) * (var(--luxury-carousel-visible) - 1))) / var(--luxury-carousel-visible));
      min-width: 0;
    }
    .luxury-collection-controls {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }
    .luxury-collection-nav {
      width: 52px;
      height: 52px;
      border-radius: 999px;
      border: 1px solid rgba(90,59,39,0.12);
      background: rgba(255,251,245,0.82);
      color: #2d2219;
      font: 500 28px/1 'Cormorant Garamond', serif;
      cursor: pointer;
      transition: background 180ms ease, opacity 180ms ease, color 180ms ease;
    }
    .luxury-collection-nav:hover {
      background: rgba(127,63,115,0.12);
      color: var(--luxury-accent);
    }
    .luxury-collection-nav:disabled {
      opacity: 0.35;
      cursor: default;
    }
    .luxury-collection-card {
      overflow: hidden;
      border-radius: 6px;
      background: #fffdf8;
      border: 1px solid rgba(90,59,39,0.08);
      box-shadow: 0 20px 40px rgba(67, 45, 29, 0.08);
      text-decoration: none;
    }
    .luxury-collection-media { overflow: hidden; }
    .luxury-collection-media.is-portrait .luxury-collection-image {
      height: 420px;
    }
    .luxury-collection-image {
      width: 100%;
      height: 260px;
      object-fit: cover;
      transition: transform 280ms ease;
    }
    .luxury-collection-card:hover .luxury-collection-image { transform: scale(1.04); }
    .luxury-collection-copy {
      display: grid;
      gap: 10px;
      padding: 20px;
    }
    .luxury-collection-copy h3 {
      margin: 0;
      font: 600 28px/1.02 'Cormorant Garamond', serif;
      color: #2e2218;
    }
    .luxury-collection-copy p {
      margin: 0;
      color: rgba(52,36,27,0.76);
      line-height: 1.7;
    }
    .luxury-card-meta {
      color: var(--luxury-accent);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }
    .luxury-collection-grid-portrait {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .luxury-story-block {
      display: grid;
      grid-template-columns: minmax(320px, 0.85fr) minmax(0, 1.15fr);
      gap: 48px;
      align-items: center;
      padding: 48px 0;
    }
    .luxury-story-media {
      overflow: hidden;
      border-radius: 6px;
      box-shadow: 0 22px 60px rgba(43, 31, 22, 0.12);
      min-height: 720px;
    }
    .luxury-story-image {
      width: 100%;
      height: 100%;
      min-height: 720px;
      object-fit: cover;
      display: block;
    }
    .luxury-story-copy {
      display: grid;
      gap: 18px;
      max-width: 620px;
      padding-right: 32px;
    }
    .luxury-story-copy h2 {
      margin: 0;
      font: 500 clamp(40px, 5vw, 72px)/0.98 'Cormorant Garamond', serif;
      color: #2d2219;
    }
    .luxury-story-body {
      margin: 0;
      color: rgba(52,36,27,0.78);
      font-size: 20px;
      line-height: 1.8;
    }
    .luxury-story-list {
      display: grid;
      gap: 24px;
      margin-top: 18px;
    }
    .luxury-story-list article {
      display: grid;
      gap: 8px;
      padding-top: 18px;
      border-top: 1px solid rgba(90,59,39,0.12);
    }
    .luxury-story-list h3 {
      margin: 0;
      font: 500 28px/1.08 'Cormorant Garamond', serif;
      color: #2d2219;
    }
    .luxury-story-list p {
      margin: 0;
      color: rgba(52,36,27,0.76);
      line-height: 1.75;
    }
    .luxury-gallery-band {
      padding: 24px 0 10px;
    }
    .luxury-gallery-head {
      display: grid;
      gap: 10px;
      max-width: 760px;
      margin-bottom: 18px;
    }
    .luxury-gallery-head h2 {
      margin: 0;
      font: 500 clamp(36px, 5vw, 64px)/0.98 'Cormorant Garamond', serif;
      color: #2d2219;
    }
    .luxury-gallery-head p {
      margin: 0;
      color: rgba(52,36,27,0.76);
      line-height: 1.75;
    }
    .luxury-gallery-stage {
      position: relative;
      overflow: hidden;
      border-radius: 4px;
      background: #ddd;
      min-height: 520px;
    }
    .luxury-gallery-slide {
      position: absolute;
      inset: 0;
      opacity: 0;
      pointer-events: none;
      transition: opacity 220ms ease;
    }
    .luxury-gallery-slide.is-active {
      opacity: 1;
      pointer-events: auto;
    }
    .luxury-gallery-image {
      width: 100%;
      height: 520px;
      object-fit: cover;
      display: block;
    }
    .luxury-gallery-slide figcaption {
      position: absolute;
      inset: auto 0 0;
      padding: 18px 20px;
      color: #fff8ee;
      background: linear-gradient(180deg, rgba(17,12,9,0) 0%, rgba(17,12,9,0.72) 100%);
      font-size: 14px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .luxury-gallery-nav {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 96px;
      border: 0;
      background: transparent;
      color: rgba(255,248,238,0.92);
      font: 500 64px/1 'Cormorant Garamond', serif;
      cursor: pointer;
      opacity: 0;
      transition: opacity 180ms ease, background 180ms ease;
    }
    .luxury-gallery-stage:hover .luxury-gallery-nav {
      opacity: 1;
    }
    .luxury-gallery-nav:hover {
      background: rgba(17,12,9,0.14);
    }
    .luxury-gallery-prev { left: 0; }
    .luxury-gallery-next { right: 0; }
    .luxury-gallery-thumbs {
      display: none;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-top: 12px;
    }
    .luxury-gallery-thumb {
      display: grid;
      gap: 6px;
      text-align: left;
      padding: 12px 14px;
      border: 1px solid rgba(90,59,39,0.1);
      background: rgba(255,251,245,0.7);
      color: #2d2219;
      cursor: pointer;
    }
    .luxury-gallery-thumb.is-active {
      border-color: rgba(127,63,115,0.34);
      background: rgba(127,63,115,0.08);
    }
    .luxury-gallery-thumb span {
      font-size: 10px;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: rgba(90,59,39,0.68);
    }
    .luxury-gallery-thumb strong {
      font: 600 18px/1.1 'Cormorant Garamond', serif;
    }
    .luxury-footer {
      max-width: 1380px;
      margin: 56px auto 26px;
      border-radius: 0;
      padding: 56px 34px 44px;
      background: #fbf8f2;
      color: #35271d;
      border-top: 1px solid rgba(90,59,39,0.08);
    }
    .luxury-footer-grid {
      display: grid;
      gap: 24px;
      grid-template-columns: 1fr 1fr 1fr 1fr;
    }
    .luxury-footer-brand {
      display: grid;
      gap: 18px;
      align-content: start;
    }
    .luxury-footer-logo {
      color: inherit;
      text-decoration: none;
      width: fit-content;
    }
    .luxury-footer h2,
    .luxury-footer-heading {
      margin: 0 0 10px;
      font: 600 30px/1.02 'Cormorant Garamond', serif;
    }
    .luxury-footer-links {
      display: grid;
      gap: 10px;
    }
    .luxury-footer-links a,
    .luxury-footer-links span {
      color: rgba(53,39,29,0.84);
      text-decoration: none;
      line-height: 1.7;
    }
    .luxury-footer-socials {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 18px;
    }
    .luxury-footer-socials a {
      width: 38px;
      height: 38px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
      background: rgba(127,63,115,0.08);
      color: #7f3f73;
      border: 1px solid rgba(127,63,115,0.16);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.12em;
    }
    .luxury-footer-legal {
      margin-top: 10px;
    }
    @keyframes luxuryKenBurns {
      0% { transform: scale(1.04); }
      100% { transform: scale(1.14); }
    }
    @media (max-width: 1100px) {
      .luxury-header-inner,
      .luxury-collection-head,
      .luxury-footer-grid,
      .luxury-search-grid,
      .luxury-collection-grid {
        grid-template-columns: 1fr;
      }
      .luxury-collection-carousel {
        --luxury-carousel-visible: 1;
      }
      .luxury-collection-carousel.is-portrait {
        --luxury-carousel-visible: 2;
      }
      .luxury-gallery-thumbs,
      .luxury-collection-grid-portrait {
        grid-template-columns: 1fr;
      }
      .luxury-story-block {
        grid-template-columns: 1fr;
        gap: 24px;
      }
      .luxury-story-media,
      .luxury-story-image {
        min-height: 420px;
      }
      .luxury-logo-text {
        min-width: 112px;
        font-size: 18px;
      }
      .luxury-hero-copy {
        padding: 140px 26px 180px;
      }
      .luxury-hero-side-panel {
        position: static;
        width: auto;
        margin: 24px 26px 0;
      }
      .luxury-social-rail {
        display: none;
      }
      .luxury-book-now {
        padding: 12px 16px;
      }
      .luxury-floating-book-now {
        right: 16px;
        bottom: 16px;
        padding: 14px 18px;
      }
      .luxury-search-panel {
        grid-template-columns: 1fr;
      }
      .luxury-hero-search-wrap {
        left: 16px;
        right: 16px;
        bottom: 16px;
      }
      .luxury-gallery-stage,
      .luxury-gallery-image {
        min-height: 360px;
        height: 360px;
      }
    }
    ` : ''}
  </style>
</head>
<body class="min-h-screen ${escapeHtml(activeTheme.bodyClass || profile.shell || 'universal-shell')}" data-menu-open="false" data-header-solid="false" data-book-now-visible="false">
  ${headerMarkup}
  ${floatingBookNowMarkup}
  <main class="${isLuxuryShell ? 'luxury-main-shell mx-auto max-w-[1380px] px-4 pt-0 pb-0 sm:px-6' : 'mx-auto max-w-6xl px-4 py-8 sm:px-6'}">
    ${renderedBlocks || `<section class="rounded-[26px] bg-white p-6 shadow-sm"><h1 class="text-3xl font-semibold text-slate-950">${escapeHtml(title)}</h1><p class="mt-4 text-slate-600">${escapeHtml(description)}</p></section>`}
    ${luxuryHomeCatalogSections ? `<div class="luxury-home-catalog-sections">${luxuryHomeCatalogSections}</div>` : ''}
    ${renderedEmbeddedSections ? `<div class="h-10"></div>${renderedEmbeddedSections}` : ''}
  </main>
  ${footerMarkup}
  ${shellScript}
  <script>
    /* Destination & hotel carousel — scroll-snap prev/next */
    (function(){
      document.querySelectorAll('[data-carousel-target]').forEach(function(btn){
        btn.addEventListener('click',function(){
          var key=btn.dataset.carouselTarget;
          var dir=Number(btn.dataset.dir||1);
          var track=document.querySelector('[data-carousel="'+key+'"]');
          if(!track)return;
          var card=track.querySelector('article');
          var w=card?card.offsetWidth+16:320;
          track.scrollBy({left:dir*w,behavior:'smooth'});
        });
      });
      /* Hide scrollbar on carousel tracks (WebKit) */
      var style=document.createElement('style');
      style.textContent='[data-carousel]::-webkit-scrollbar{display:none}';
      document.head.appendChild(style);
    })();
  </script>
  ${bookingViewMarkup}
  ${adminPreviewScript}
</body>
</html>`;
}

async function requireTenant(c) {
  const tenantId = getTenantId(c);
  if (!tenantId) {
    return { error: jsonError(c, 400, 'X-Tenant-ID header is required') };
  }

  const tenant = await c.env.DB
    .prepare('SELECT id, name, template_id, site_config, default_locale, booking_currency, market_skin_key, primary_market FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();

  if (!tenant) {
    return { error: jsonError(c, 404, 'Tenant not found') };
  }

  return { tenantId, tenant };
}

async function listHotels(tenantId, db) {
  const { results } = await db
    .prepare(
      `SELECT *
       FROM tenant_universal_hotels
       WHERE tenant_id = ?
       ORDER BY region ASC,
                CASE WHEN star_rating IS NULL THEN 1 ELSE 0 END ASC,
                star_rating DESC,
                sort_order ASC,
                created_at ASC`
    )
    .bind(tenantId)
    .all();

  return (results || []).map(normalizeHotel);
}

async function ensureUniversalHotelsInitialized(tenantId, db, tours, syncedRows) {
  return listHotels(tenantId, db);
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

async function resetSitePreset(db, tenantId, groupKey, variantKey, siteName, defaultLang = 'en') {
  const scaffold = buildDefaultSiteScaffold(groupKey, variantKey, defaultLang);
  const now = Math.floor(Date.now() / 1000);

  await db.batch([
    db.prepare(
      `UPDATE tenant_universal_sites
          SET group_key = ?,
              variant_key = ?,
              site_name = ?,
              home_page_key = 'home',
              updated_at = ?
        WHERE tenant_id = ?`
    ).bind(groupKey, variantKey, siteName, now, tenantId),
    db.prepare('UPDATE tenant_universal_theme_tokens SET tokens_json = ?, updated_at = ? WHERE tenant_id = ?')
      .bind(JSON.stringify(scaffold.themeTokens), now, tenantId),
    db.prepare('UPDATE tenant_universal_contacts SET channels_json = ?, updated_at = ? WHERE tenant_id = ?')
      .bind(JSON.stringify(scaffold.contacts), now, tenantId),
    db.prepare('DELETE FROM tenant_universal_menu_items WHERE tenant_id = ?').bind(tenantId),
    db.prepare("DELETE FROM tenant_universal_pages WHERE tenant_id = ? AND page_type IN ('standard', 'legal', 'system')").bind(tenantId),
  ]);

  const statements = [];
  for (const [index, item] of scaffold.menuItems.entries()) {
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
        item.pageKey || null,
        item.target || '_self',
        item.isExternal ? 1 : 0,
        item.visible === 0 ? 0 : 1,
        Number.isFinite(item.sortOrder) ? Number(item.sortOrder) : index,
        now,
        now,
      )
    );
  }

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

  if (statements.length) {
    await db.batch(statements);
  }
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

async function getSiteBundle(tenantId, tenant, db, env = null) {
  const siteRow = await ensureUniversalSiteInitialized(db, tenantId, tenant.name);
  const themeRow = await db.prepare('SELECT * FROM tenant_universal_theme_tokens WHERE tenant_id = ?').bind(tenantId).first();
  const contactsRow = await db.prepare('SELECT * FROM tenant_universal_contacts WHERE tenant_id = ?').bind(tenantId).first();
  const bundleLang = typeof tenant.default_locale === 'string' && tenant.default_locale.trim()
    ? tenant.default_locale.trim()
    : 'en';
  const fallbackGroupKey = UNIVERSAL_GROUPS[siteRow.group_key] ? siteRow.group_key : 'tour_operator';
  const fallbackVariantKey = UNIVERSAL_VARIANTS.find((variant) => variant.group_key === fallbackGroupKey)?.key || 'tour-luxury';
  const runtime = buildVariantRuntimeConfig(siteRow.group_key, siteRow.variant_key, bundleLang)
    || buildVariantRuntimeConfig(fallbackGroupKey, fallbackVariantKey, bundleLang)
    || buildVariantRuntimeConfig('tour_operator', 'tour-luxury', bundleLang);
  const site = normalizeSite({
    ...siteRow,
    group_key: runtime?.group_key || fallbackGroupKey,
    variant_key: runtime?.variant_key || fallbackVariantKey,
  });
  site.default_lang = typeof tenant.default_locale === 'string' && tenant.default_locale.trim()
    ? tenant.default_locale.trim()
    : (site.default_lang || 'en');
  site.booking_currency = typeof tenant.booking_currency === 'string' && tenant.booking_currency.trim()
    ? tenant.booking_currency.trim().toUpperCase()
    : 'USD';
  site.market_skin_key = typeof tenant.market_skin_key === 'string' ? tenant.market_skin_key : 'global-default';
  site.primary_market = typeof tenant.primary_market === 'string' ? tenant.primary_market : 'GLOBAL';
  const tenantSiteConfig = parseJsonSafe(tenant.site_config, {});
  site.current_theme = typeof tenantSiteConfig.current_theme === 'string' ? tenantSiteConfig.current_theme.trim() : '';
  const theme = normalizeTheme(themeRow);
  const contacts = localizeUniversalContacts(normalizeContacts(contactsRow), site.default_lang);
  const menu = localizeUniversalMenuItems(await listMenuItems(tenantId, db), site.group_key, site.default_lang);
  const pages = localizeUniversalPages(await listPages(tenantId, db), site.group_key, site.default_lang);
  const activeTheme = resolveUniversalTheme(site, runtime);
  let tourRuntime = {};
  let interestRuntime = {};
  let hotels = [];

  if (site.group_key === 'tour_operator') {
    const [{ results: tours }, { results: priceRows }] = await db.batch([
      db.prepare(
        `SELECT id, title, slug, duration_text, start_date, status, content_data, category_id, tour_type, created_at
         FROM tours
         WHERE tenant_id = ?
         ORDER BY created_at DESC`
      ).bind(tenantId),
      db.prepare(
        `SELECT tour_id, MIN(COALESCE(adult_shared_room_price, adult_single_room_price)) AS price_from
         FROM tour_prices
         WHERE tenant_id = ? AND is_active = 1
         GROUP BY tour_id`
      ).bind(tenantId),
    ]);

    let syncedRows = (await db.prepare('SELECT * FROM tenant_universal_tour_pages WHERE tenant_id = ? ORDER BY updated_at DESC').bind(tenantId).all()).results || [];
    if (env && tours.length) {
      const syncedIds = new Set(syncedRows.map((row) => row.tour_id));
      const missingTours = tours.filter((tour) => !syncedIds.has(tour.id)).slice(0, 12);
      if (missingTours.length) {
        await Promise.allSettled(missingTours.map((tour) => syncUniversalTourPage(env, tenantId, tour.id)));
        syncedRows = (await db.prepare('SELECT * FROM tenant_universal_tour_pages WHERE tenant_id = ? ORDER BY updated_at DESC').bind(tenantId).all()).results || [];
      }
    }

    hotels = await ensureUniversalHotelsInitialized(tenantId, db, tours, syncedRows);
    const priceLookup = new Map(priceRows.map((row) => [row.tour_id, row.price_from]));
    // Fetch active destinations PLUS any draft/inactive destinations that are flagged show_on_home
    const catalogDestinations = (await db
      .prepare('SELECT id, tenant_id, name, description, region, gallery_json, status, show_on_home FROM tenant_destinations WHERE tenant_id = ? AND (status = ? OR show_on_home = 1) ORDER BY sort_order ASC, created_at ASC')
      .bind(tenantId, 'active')
      .all()
    ).results?.map((r) => ({
      id: r.id,
      name: r.name || '',
      description: r.description || '',
      region: r.region || '',
      gallery: parseJsonSafe(r.gallery_json, []),
      show_on_home: r.show_on_home ? 1 : 0,
    })) || [];
    tourRuntime = buildTourRuntimeCollections(tenantId, tours, syncedRows, hotels, priceLookup, catalogDestinations);
    tourRuntime.tour_type_map = Object.fromEntries(tours.map((t) => [String(t.id), t.tour_type || 'package']));

    const interestTagRows = (await db.prepare(
      `SELECT tour_id, interest_key, tag_level
         FROM tenant_tour_interest_tags
        WHERE tenant_id = ?`
    ).bind(tenantId).all()).results || [];
    tourRuntime = annotateTourRuntimeWithTaxonomy(tourRuntime, interestTagRows);
    interestRuntime = buildInterestRuntimeCollections(tourRuntime, interestTagRows);
  }

  return {
    site,
    theme,
    active_theme: {
      key: activeTheme.key,
      label: activeTheme.label,
      admin: activeTheme.admin,
    },
    contacts,
    menu,
    pages,
    hotels,
    tour_runtime: tourRuntime,
    interest_runtime: interestRuntime,
    ...buildEditorStoreBundle({ site, theme, contacts, menu, pages, runtime }),
    groups: getUniversalGroups(bundleLang),
    variants: getUniversalVariants(bundleLang),
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
  const lang = resolveLocaleFromAcceptLanguage(c.req.header('Accept-Language'));
  return c.json({ ok: true, groups: getUniversalGroups(lang), variants: getUniversalVariants(lang) });
});

router.get('/site/bootstrap', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  return c.json({ ok: true, ...(await getSiteBundle(ctx.tenantId, ctx.tenant, c.env.DB, c.env)) });
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

  const bootstrap = buildUniversalBootstrapMock(
    description,
    body.site_name || ctx.tenant.name,
    typeof ctx.tenant.default_locale === 'string' && ctx.tenant.default_locale.trim() ? ctx.tenant.default_locale.trim() : 'en'
  );
  bootstrap.site.tenant_id = ctx.tenantId;
  bootstrap.pages = bootstrap.pages.map((page) => ({ ...page, tenant_id: ctx.tenantId }));
  bootstrap.editor_model.site.tenant_id = ctx.tenantId;
  bootstrap.editor_model.pages.items = bootstrap.editor_model.pages.items.map((page) => ({ ...page, tenant_id: ctx.tenantId }));
  for (const page of Object.values(bootstrap.editor_model.pages.by_key || {})) {
    page.tenant_id = ctx.tenantId;
  }

  if (body.persist === true) {
    const persistConfirmation = String(c.req.header('X-Allow-Bootstrap-Persist') || body.persist_confirmation || '').trim().toLowerCase();
    if (persistConfirmation !== 'overwrite') {
      return jsonError(
        c,
        409,
        'Persisting bootstrap mock is locked by default. Re-send with X-Allow-Bootstrap-Persist: overwrite or persist_confirmation="overwrite" if you intentionally want to overwrite this tenant scaffold.'
      );
    }
    await persistBootstrapBundle(c.env.DB, ctx.tenantId, ctx.tenant.name, bootstrap);
    await purgeTenantPublicCache(c.env.DB, ctx.tenantId);
    return c.json({ ok: true, persisted: true, ...(await getSiteBundle(ctx.tenantId, ctx.tenant, c.env.DB, c.env)), recommendation: bootstrap.recommendation });
  }

  return c.json({ ok: true, ...bootstrap });
});

router.get('/site/config', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  return c.json({ ok: true, ...(await getSiteBundle(ctx.tenantId, ctx.tenant, c.env.DB, c.env)) });
});

router.get('/taxonomy/catalog', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  return c.json({ ok: true, interests: listInterestTaxonomy() });
});

router.get('/taxonomy/interest-pages', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;

  await syncInterestCollectionPages(c.env.DB, ctx.tenantId);
  const { results } = await c.env.DB.prepare(
    `SELECT *
       FROM tenant_universal_interest_pages
      WHERE tenant_id = ?
      ORDER BY interest_key ASC`
  ).bind(ctx.tenantId).all();

  return c.json({
    ok: true,
    pages: (results || []).map((row) => ({
      ...row,
      visible: Boolean(row.visible),
      rules: parseJsonSafe(row.rules_json, {}),
      seo: parseJsonSafe(row.seo_json, {}),
    })),
  });
});

router.get('/taxonomy/tours', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;

  const [toursResult, profilesResult, tagsResult] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT id, title, slug
         FROM tours
        WHERE tenant_id = ?
        ORDER BY created_at DESC`
    ).bind(ctx.tenantId),
    c.env.DB.prepare(
      `SELECT tour_id, primary_interest_key
         FROM tenant_tour_discovery_profiles
        WHERE tenant_id = ?`
    ).bind(ctx.tenantId),
    c.env.DB.prepare(
      `SELECT tour_id, interest_key, tag_level
         FROM tenant_tour_interest_tags
        WHERE tenant_id = ?
        ORDER BY updated_at DESC`
    ).bind(ctx.tenantId),
  ]);

  const profilesByTourId = new Map((profilesResult.results || []).map((row) => [String(row.tour_id), row]));
  const tagsByTourId = new Map();
  for (const row of (tagsResult.results || [])) {
    const tourId = String(row.tour_id || '');
    if (!tourId) continue;
    if (!tagsByTourId.has(tourId)) {
      tagsByTourId.set(tourId, { interest_keys: [], sub_interest_keys: [] });
    }
    const bucket = tagsByTourId.get(tourId);
    if (row.tag_level === 'sub_interest') {
      if (!bucket.sub_interest_keys.includes(row.interest_key)) bucket.sub_interest_keys.push(row.interest_key);
      continue;
    }
    if (!bucket.interest_keys.includes(row.interest_key)) bucket.interest_keys.push(row.interest_key);
  }

  return c.json({
    ok: true,
    items: (toursResult.results || []).map((tour) => {
      const tagBucket = tagsByTourId.get(String(tour.id)) || { interest_keys: [], sub_interest_keys: [] };
      const profile = profilesByTourId.get(String(tour.id)) || null;
      return {
        tour_id: tour.id,
        title: tour.title,
        slug: tour.slug,
        interest_keys: tagBucket.interest_keys,
        sub_interest_keys: tagBucket.sub_interest_keys,
        primary_interest_key: profile?.primary_interest_key || tagBucket.interest_keys[0] || null,
      };
    }),
  });
});

router.get('/taxonomy/tours/:tourId', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;

  const tour = await c.env.DB
    .prepare('SELECT id, title, slug FROM tours WHERE id = ? AND tenant_id = ?')
    .bind(c.req.param('tourId'), ctx.tenantId)
    .first();
  if (!tour) {
    return jsonError(c, 404, 'Tour not found');
  }

  return c.json({ ok: true, tour, taxonomy: await getTourTaxonomy(c.env.DB, ctx.tenantId, c.req.param('tourId')) });
});

router.put('/taxonomy/tours/:tourId', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;

  const tourId = c.req.param('tourId');
  const tour = await c.env.DB
    .prepare('SELECT id, title, slug FROM tours WHERE id = ? AND tenant_id = ?')
    .bind(tourId, ctx.tenantId)
    .first();
  if (!tour) {
    return jsonError(c, 404, 'Tour not found');
  }

  let body;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, 'Invalid JSON body');
  }

  const payload = validateInterestPayload(body);
  await replaceTourTaxonomy(c.env.DB, ctx.tenantId, tourId, payload);
  await syncInterestCollectionPages(c.env.DB, ctx.tenantId);
  await purgeTenantPublicCache(c.env.DB, ctx.tenantId);

  return c.json({ ok: true, tour, taxonomy: await getTourTaxonomy(c.env.DB, ctx.tenantId, tourId) });
});

router.get('/taxonomy/destinations/:destinationId', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;

  const destination = await c.env.DB
    .prepare('SELECT id, code, name FROM destinations WHERE id = ? AND tenant_id = ?')
    .bind(c.req.param('destinationId'), ctx.tenantId)
    .first();
  if (!destination) {
    return jsonError(c, 404, 'Destination not found');
  }

  return c.json({ ok: true, destination, taxonomy: await getDestinationTaxonomy(c.env.DB, ctx.tenantId, c.req.param('destinationId')) });
});

router.put('/taxonomy/destinations/:destinationId', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;

  const destinationId = c.req.param('destinationId');
  const destination = await c.env.DB
    .prepare('SELECT id, code, name FROM destinations WHERE id = ? AND tenant_id = ?')
    .bind(destinationId, ctx.tenantId)
    .first();
  if (!destination) {
    return jsonError(c, 404, 'Destination not found');
  }

  let body;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, 'Invalid JSON body');
  }

  const payload = validateInterestPayload(body);
  await replaceDestinationTaxonomy(c.env.DB, ctx.tenantId, destinationId, payload);

  return c.json({ ok: true, destination, taxonomy: await getDestinationTaxonomy(c.env.DB, ctx.tenantId, destinationId) });
});

router.patch('/site/config', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;

  const current = await ensureUniversalSiteInitialized(c.env.DB, ctx.tenantId, ctx.tenant.name);

  try {

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

  if (!updates.length && body.reset_theme !== true && body.reset_preset !== true && !body.theme && !body.contacts && !body.menu?.items && !body.pages) {
    return jsonError(c, 400, 'No valid fields provided');
  }

  const nextDefaultLang = typeof sitePatch.default_lang === 'string' && sitePatch.default_lang.trim()
    ? sitePatch.default_lang.trim()
    : (current.default_lang || 'en');

  if (body.reset_preset === true) {
    await resetSitePreset(
      c.env.DB,
      ctx.tenantId,
      nextGroupKey,
      nextVariantKey,
      typeof sitePatch.site_name === 'string' && sitePatch.site_name.trim() ? sitePatch.site_name.trim() : (ctx.tenant.name || current.site_name || 'Universal Site'),
      nextDefaultLang,
    );
  }

  if (updates.length) {
    updates.push('updated_at = ?');
    binds.push(Math.floor(Date.now() / 1000), ctx.tenantId);
    await c.env.DB.prepare(`UPDATE tenant_universal_sites SET ${updates.join(', ')} WHERE tenant_id = ?`).bind(...binds).run();
  }

  if (body.reset_preset === true) {
    if (body.theme) {
      await c.env.DB
        .prepare('UPDATE tenant_universal_theme_tokens SET tokens_json = ?, updated_at = ? WHERE tenant_id = ?')
        .bind(JSON.stringify(body.theme), Math.floor(Date.now() / 1000), ctx.tenantId)
        .run();
    }
  } else if (body.reset_theme === true || sitePatch.group_key || sitePatch.variant_key) {
    const tokens = buildDefaultThemeTokens(nextGroupKey, nextVariantKey, nextDefaultLang);
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

  if (!body.reset_preset && body.menu?.items) {
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

  if (!body.reset_preset && body.pages) {
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

  if (body.reset_preset === true || sitePatch.group_key || sitePatch.variant_key || body.theme || body.pages) {
    await purgeTenantPublicCache(c.env.DB, ctx.tenantId);
  }

  return c.json({ ok: true, ...(await getSiteBundle(ctx.tenantId, ctx.tenant, c.env.DB, c.env)) });
  } catch (error) {
    console.error('[universal/site/config PATCH]', error);
    return jsonError(c, 500, error?.message || 'Internal Server Error');
  }
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

router.get('/site/hotels', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  await ensureUniversalSiteInitialized(c.env.DB, ctx.tenantId, ctx.tenant.name);
  return c.json({ ok: true, hotels: await listHotels(ctx.tenantId, c.env.DB) });
});

router.post('/site/hotels', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  await ensureUniversalSiteInitialized(c.env.DB, ctx.tenantId, ctx.tenant.name);

  let body;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, 'Invalid JSON body');
  }

  const tourId = String(body.tour_id || '').trim();
  const name = String(body.name || '').trim();
  const address = String(body.address || '').trim();
  const region = String(body.region || '').trim();
  const description = String(body.description || '').trim();
  const gallery = Array.isArray(body.gallery) ? body.gallery : [];
  const status = String(body.status || 'draft').trim() || 'draft';
  const starRating = body.star_rating != null ? Math.min(5, Math.max(1, Number(body.star_rating))) : null;

  if (!name) return jsonError(c, 400, 'name is required');

  if (tourId) {
    const linkedTour = await c.env.DB
      .prepare('SELECT id FROM tours WHERE tenant_id = ? AND id = ?')
      .bind(ctx.tenantId, tourId)
      .first();
    if (!linkedTour) return jsonError(c, 404, 'Linked tour not found');
  }

  const now = Math.floor(Date.now() / 1000);
  const hotelId = nanoid();
  const hotelKey = slugify(body.hotel_key || name) || `hotel-${hotelId}`;

  await c.env.DB
    .prepare(
      `INSERT INTO tenant_universal_hotels
        (id, tenant_id, hotel_key, tour_id, name, description, address, region, star_rating, gallery_json, status, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      hotelId,
      ctx.tenantId,
      hotelKey,
      tourId || null,
      name,
      description,
      address,
      region,
      starRating,
      JSON.stringify(gallery),
      status,
      now,
      now,
      now
    )
    .run();

  const row = await c.env.DB
    .prepare('SELECT * FROM tenant_universal_hotels WHERE tenant_id = ? AND id = ?')
    .bind(ctx.tenantId, hotelId)
    .first();

  return c.json({ ok: true, hotel: normalizeHotel(row) }, 201);
});

router.get('/hotels/:hotelId', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  await ensureUniversalSiteInitialized(c.env.DB, ctx.tenantId, ctx.tenant.name);

  const row = await c.env.DB
    .prepare('SELECT * FROM tenant_universal_hotels WHERE tenant_id = ? AND id = ?')
    .bind(ctx.tenantId, c.req.param('hotelId'))
    .first();

  if (!row) {
    return jsonError(c, 404, 'Property not found');
  }

  return c.json({ ok: true, hotel: normalizeHotel(row) });
});

router.patch('/hotels/:hotelId', async (c) => {
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

  if ('name' in body) {
    const nextName = String(body.name || '').trim();
    if (!nextName) return jsonError(c, 400, 'name cannot be empty');
    setValue('name', nextName);
  }
  if ('description' in body) {
    setValue('description', String(body.description || '').trim());
  }
  if ('address' in body) {
    setValue('address', String(body.address || '').trim());
  }
  if ('region' in body) {
    setValue('region', String(body.region || '').trim());
  }
  if ('star_rating' in body) {
    const sr = body.star_rating;
    setValue('star_rating', sr != null ? Math.min(5, Math.max(1, Number(sr))) : null);
  }
  if ('gallery' in body) {
    if (!Array.isArray(body.gallery)) return jsonError(c, 400, 'gallery must be an array');
    setValue('gallery_json', JSON.stringify(body.gallery));
  }
  if ('tour_id' in body) {
    const nextTourId = String(body.tour_id || '').trim();
    if (nextTourId) {
      const linkedTour = await c.env.DB
        .prepare('SELECT id FROM tours WHERE tenant_id = ? AND id = ?')
        .bind(ctx.tenantId, nextTourId)
        .first();
      if (!linkedTour) return jsonError(c, 404, 'Linked tour not found');
      setValue('tour_id', nextTourId);
    } else {
      setValue('tour_id', null);
    }
  }
  if ('status' in body) {
    setValue('status', String(body.status || 'draft').trim() || 'draft');
  }
  if ('show_on_home' in body) {
    setValue('show_on_home', body.show_on_home ? 1 : 0);
  }

  if (!updates.length) {
    return jsonError(c, 400, 'No valid fields provided');
  }

  const now = Math.floor(Date.now() / 1000);
  updates.push('updated_at = ?');
  binds.push(now, ctx.tenantId, c.req.param('hotelId'));

  const result = await c.env.DB
    .prepare(`UPDATE tenant_universal_hotels SET ${updates.join(', ')} WHERE tenant_id = ? AND id = ?`)
    .bind(...binds)
    .run();

  if (!result.meta?.changes) {
    return jsonError(c, 404, 'Property not found');
  }

  await purgeTenantPublicCache(c.env.DB, ctx.tenantId);

  const row = await c.env.DB
    .prepare('SELECT * FROM tenant_universal_hotels WHERE tenant_id = ? AND id = ?')
    .bind(ctx.tenantId, c.req.param('hotelId'))
    .first();

  return c.json({ ok: true, hotel: normalizeHotel(row) });
});

// ── Destination catalog ──────────────────────────────────────────────────────

function normalizeDestination(row) {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    name: row.name || '',
    description: row.description || '',
    region: row.region || '',
    gallery: parseJsonSafe(row.gallery_json, []),
    status: row.status || 'draft',
    show_on_home: row.show_on_home ? 1 : 0,
    sort_order: Number(row.sort_order || 0),
    created_at: Number(row.created_at || 0),
    updated_at: Number(row.updated_at || 0),
  };
}

router.get('/destinations', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  const { results } = await c.env.DB
    .prepare('SELECT * FROM tenant_destinations WHERE tenant_id = ? ORDER BY sort_order ASC, created_at ASC')
    .bind(ctx.tenantId)
    .all();
  return c.json({ ok: true, destinations: (results || []).map(normalizeDestination) });
});

router.post('/destinations', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  let body;
  try { body = await c.req.json(); } catch { return jsonError(c, 400, 'Invalid JSON body'); }
  const name = String(body.name || '').trim();
  if (!name) return jsonError(c, 400, 'name is required');
  const now = Math.floor(Date.now() / 1000);
  const id = nanoid();
  await c.env.DB
    .prepare('INSERT INTO tenant_destinations (id, tenant_id, name, description, region, gallery_json, status, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, ctx.tenantId, name, String(body.description || '').trim(), String(body.region || '').trim(), JSON.stringify(Array.isArray(body.gallery) ? body.gallery : []), String(body.status || 'draft').trim() || 'draft', Number(body.sort_order || 0), now, now)
    .run();
  const row = await c.env.DB.prepare('SELECT * FROM tenant_destinations WHERE id = ? AND tenant_id = ?').bind(id, ctx.tenantId).first();
  return c.json({ ok: true, destination: normalizeDestination(row) }, 201);
});

router.get('/destinations/:destId', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  const row = await c.env.DB.prepare('SELECT * FROM tenant_destinations WHERE id = ? AND tenant_id = ?').bind(c.req.param('destId'), ctx.tenantId).first();
  if (!row) return jsonError(c, 404, 'Destination not found');
  return c.json({ ok: true, destination: normalizeDestination(row) });
});

router.patch('/destinations/:destId', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  let body;
  try { body = await c.req.json(); } catch { return jsonError(c, 400, 'Invalid JSON body'); }
  const updates = [];
  const binds = [];
  const sv = (col, val) => { if (val === undefined) return; updates.push(`${col} = ?`); binds.push(val); };
  if ('name' in body) { const n = String(body.name || '').trim(); if (!n) return jsonError(c, 400, 'name cannot be empty'); sv('name', n); }
  if ('description' in body) sv('description', String(body.description || '').trim());
  if ('region' in body) sv('region', String(body.region || '').trim());
  if ('gallery' in body) { if (!Array.isArray(body.gallery)) return jsonError(c, 400, 'gallery must be array'); sv('gallery_json', JSON.stringify(body.gallery)); }
  if ('status' in body) sv('status', String(body.status || 'draft').trim() || 'draft');
  if ('sort_order' in body) sv('sort_order', Number(body.sort_order || 0));
  if ('show_on_home' in body) sv('show_on_home', body.show_on_home ? 1 : 0);
  if (!updates.length) return jsonError(c, 400, 'No valid fields provided');
  const now = Math.floor(Date.now() / 1000);
  updates.push('updated_at = ?');
  binds.push(now, c.req.param('destId'), ctx.tenantId);
  const result = await c.env.DB.prepare(`UPDATE tenant_destinations SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...binds).run();
  if (!result.meta?.changes) return jsonError(c, 404, 'Destination not found');
  const row = await c.env.DB.prepare('SELECT * FROM tenant_destinations WHERE id = ? AND tenant_id = ?').bind(c.req.param('destId'), ctx.tenantId).first();
  return c.json({ ok: true, destination: normalizeDestination(row) });
});

router.delete('/destinations/:destId', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  await c.env.DB.prepare('DELETE FROM tour_destination_links WHERE destination_id = ? AND tenant_id = ?').bind(c.req.param('destId'), ctx.tenantId).run();
  const result = await c.env.DB.prepare('DELETE FROM tenant_destinations WHERE id = ? AND tenant_id = ?').bind(c.req.param('destId'), ctx.tenantId).run();
  if (!result.meta?.changes) return jsonError(c, 404, 'Destination not found');
  return c.json({ ok: true });
});

// ── Tour → destination links ──────────────────────────────────────────────────

router.get('/tours/:tourId/destination-links', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  const { results } = await c.env.DB
    .prepare(`SELECT l.*, d.name, d.description, d.region, d.gallery_json, d.status
              FROM tour_destination_links l
              JOIN tenant_destinations d ON d.id = l.destination_id
              WHERE l.tour_id = ? AND l.tenant_id = ?
              ORDER BY l.sort_order ASC, l.created_at ASC`)
    .bind(c.req.param('tourId'), ctx.tenantId)
    .all();
  return c.json({ ok: true, links: results || [] });
});

router.post('/tours/:tourId/destination-links', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  let body;
  try { body = await c.req.json(); } catch { return jsonError(c, 400, 'Invalid JSON body'); }
  const destId = String(body.destination_id || '').trim();
  if (!destId) return jsonError(c, 400, 'destination_id is required');
  const dest = await c.env.DB.prepare('SELECT id FROM tenant_destinations WHERE id = ? AND tenant_id = ?').bind(destId, ctx.tenantId).first();
  if (!dest) return jsonError(c, 404, 'Destination not found');
  const existing = await c.env.DB.prepare('SELECT id FROM tour_destination_links WHERE tour_id = ? AND destination_id = ? AND tenant_id = ?').bind(c.req.param('tourId'), destId, ctx.tenantId).first();
  if (existing) return c.json({ ok: true, link: existing });
  const now = Math.floor(Date.now() / 1000);
  const id = nanoid();
  await c.env.DB.prepare('INSERT INTO tour_destination_links (id, tenant_id, tour_id, destination_id, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, ctx.tenantId, c.req.param('tourId'), destId, Number(body.sort_order || 0), now).run();
  return c.json({ ok: true, link: { id, tour_id: c.req.param('tourId'), destination_id: destId } }, 201);
});

router.delete('/destination-links/:linkId', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  const result = await c.env.DB.prepare('DELETE FROM tour_destination_links WHERE id = ? AND tenant_id = ?').bind(c.req.param('linkId'), ctx.tenantId).run();
  if (!result.meta?.changes) return jsonError(c, 404, 'Link not found');
  return c.json({ ok: true });
});

// ── Tour → hotel links ────────────────────────────────────────────────────────

router.get('/tours/:tourId/hotel-links', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  const { results } = await c.env.DB
    .prepare(`SELECT l.*, h.name, h.address, h.description, h.gallery_json, h.status
              FROM tour_hotel_links l
              JOIN tenant_universal_hotels h ON h.id = l.hotel_id
              WHERE l.tour_id = ? AND l.tenant_id = ?
              ORDER BY l.sort_order ASC, l.created_at ASC`)
    .bind(c.req.param('tourId'), ctx.tenantId)
    .all();
  return c.json({ ok: true, links: results || [] });
});

router.post('/tours/:tourId/hotel-links', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  let body;
  try { body = await c.req.json(); } catch { return jsonError(c, 400, 'Invalid JSON body'); }
  const hotelId = String(body.hotel_id || '').trim();
  if (!hotelId) return jsonError(c, 400, 'hotel_id is required');
  const hotel = await c.env.DB.prepare('SELECT id FROM tenant_universal_hotels WHERE id = ? AND tenant_id = ?').bind(hotelId, ctx.tenantId).first();
  if (!hotel) return jsonError(c, 404, 'Hotel not found');
  const existing = await c.env.DB.prepare('SELECT id FROM tour_hotel_links WHERE tour_id = ? AND hotel_id = ? AND tenant_id = ?').bind(c.req.param('tourId'), hotelId, ctx.tenantId).first();
  if (existing) return c.json({ ok: true, link: existing });
  const now = Math.floor(Date.now() / 1000);
  const id = nanoid();
  await c.env.DB.prepare('INSERT INTO tour_hotel_links (id, tenant_id, tour_id, hotel_id, nights, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, ctx.tenantId, c.req.param('tourId'), hotelId, Number(body.nights || 0), Number(body.sort_order || 0), now).run();
  return c.json({ ok: true, link: { id, tour_id: c.req.param('tourId'), hotel_id: hotelId, nights: Number(body.nights || 0) } }, 201);
});

router.patch('/hotel-links/:linkId', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  let body;
  try { body = await c.req.json(); } catch { return jsonError(c, 400, 'Invalid JSON body'); }
  const updates = [];
  const binds = [];
  if ('nights' in body) { updates.push('nights = ?'); binds.push(Number(body.nights || 0)); }
  if ('sort_order' in body) { updates.push('sort_order = ?'); binds.push(Number(body.sort_order || 0)); }
  if (!updates.length) return jsonError(c, 400, 'No valid fields provided');
  binds.push(c.req.param('linkId'), ctx.tenantId);
  const result = await c.env.DB.prepare(`UPDATE tour_hotel_links SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...binds).run();
  if (!result.meta?.changes) return jsonError(c, 404, 'Link not found');
  return c.json({ ok: true });
});

router.delete('/hotel-links/:linkId', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  const result = await c.env.DB.prepare('DELETE FROM tour_hotel_links WHERE id = ? AND tenant_id = ?').bind(c.req.param('linkId'), ctx.tenantId).run();
  if (!result.meta?.changes) return jsonError(c, 404, 'Link not found');
  return c.json({ ok: true });
});

// ── Media libraries ───────────────────────────────────────────────────────────

function normalizeMediaLibrary(row) {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    title: row.title || '',
    description: row.description || '',
    cover_image: row.cover_image || '',
    items: parseJsonSafe(row.items_json, []),
    status: row.status || 'active',
    sort_order: Number(row.sort_order || 0),
    created_at: Number(row.created_at || 0),
    updated_at: Number(row.updated_at || 0),
  };
}

router.get('/media-libraries', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  const { results } = await c.env.DB
    .prepare('SELECT * FROM tenant_media_libraries WHERE tenant_id = ? ORDER BY sort_order ASC, created_at ASC')
    .bind(ctx.tenantId)
    .all();
  return c.json({ ok: true, libraries: (results || []).map(normalizeMediaLibrary) });
});

router.post('/media-libraries', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  let body;
  try { body = await c.req.json(); } catch { return jsonError(c, 400, 'Invalid JSON body'); }
  const title = String(body.title || '').trim();
  if (!title) return jsonError(c, 400, 'title is required');
  const now = Math.floor(Date.now() / 1000);
  const id = nanoid();
  await c.env.DB
    .prepare('INSERT INTO tenant_media_libraries (id, tenant_id, title, description, cover_image, items_json, status, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, ctx.tenantId, title, String(body.description || '').trim(), String(body.cover_image || '').trim(), JSON.stringify(Array.isArray(body.items) ? body.items : []), 'active', Number(body.sort_order || 0), now, now)
    .run();
  const row = await c.env.DB.prepare('SELECT * FROM tenant_media_libraries WHERE tenant_id = ? AND id = ?').bind(ctx.tenantId, id).first();
  return c.json({ ok: true, library: normalizeMediaLibrary(row) }, 201);
});

router.get('/media-libraries/:libraryId', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  const row = await c.env.DB.prepare('SELECT * FROM tenant_media_libraries WHERE tenant_id = ? AND id = ?').bind(ctx.tenantId, c.req.param('libraryId')).first();
  if (!row) return jsonError(c, 404, 'Library not found');
  return c.json({ ok: true, library: normalizeMediaLibrary(row) });
});

router.patch('/media-libraries/:libraryId', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  let body;
  try { body = await c.req.json(); } catch { return jsonError(c, 400, 'Invalid JSON body'); }
  const updates = [];
  const binds = [];
  const sv = (col, val) => { updates.push(`${col} = ?`); binds.push(val); };
  if ('title' in body) {
    const t = String(body.title || '').trim();
    if (!t) return jsonError(c, 400, 'title cannot be empty');
    sv('title', t);
  }
  if ('description' in body) sv('description', String(body.description || '').trim());
  if ('cover_image' in body) sv('cover_image', String(body.cover_image || '').trim());
  if ('items' in body) {
    if (!Array.isArray(body.items)) return jsonError(c, 400, 'items must be an array');
    sv('items_json', JSON.stringify(body.items));
  }
  if ('status' in body) sv('status', String(body.status || 'active').trim() || 'active');
  if ('sort_order' in body) sv('sort_order', Number(body.sort_order || 0));
  if (!updates.length) return jsonError(c, 400, 'No valid fields provided');
  const now = Math.floor(Date.now() / 1000);
  updates.push('updated_at = ?');
  binds.push(now, ctx.tenantId, c.req.param('libraryId'));
  const result = await c.env.DB
    .prepare(`UPDATE tenant_media_libraries SET ${updates.join(', ')} WHERE tenant_id = ? AND id = ?`)
    .bind(...binds).run();
  if (!result.meta?.changes) return jsonError(c, 404, 'Library not found');
  const row = await c.env.DB.prepare('SELECT * FROM tenant_media_libraries WHERE tenant_id = ? AND id = ?').bind(ctx.tenantId, c.req.param('libraryId')).first();
  return c.json({ ok: true, library: normalizeMediaLibrary(row) });
});

router.delete('/media-libraries/:libraryId', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  await c.env.DB.prepare('DELETE FROM tour_media_library_links WHERE library_id = ? AND tenant_id = ?').bind(c.req.param('libraryId'), ctx.tenantId).run();
  const result = await c.env.DB.prepare('DELETE FROM tenant_media_libraries WHERE tenant_id = ? AND id = ?').bind(ctx.tenantId, c.req.param('libraryId')).run();
  if (!result.meta?.changes) return jsonError(c, 404, 'Library not found');
  return c.json({ ok: true });
});

router.get('/tours/:tourId/library-links', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  const { results } = await c.env.DB
    .prepare(`SELECT tml.id, tml.library_id, tml.section_hint, tml.sort_order, tml.created_at,
                     ml.title, ml.cover_image, ml.description,
                     (SELECT COUNT(*) FROM json_each(ml.items_json)) AS item_count
              FROM tour_media_library_links tml
              JOIN tenant_media_libraries ml ON ml.id = tml.library_id
              WHERE tml.tour_id = ? AND tml.tenant_id = ? AND ml.status = 'active'
              ORDER BY tml.sort_order ASC, tml.created_at ASC`)
    .bind(c.req.param('tourId'), ctx.tenantId)
    .all();
  return c.json({ ok: true, links: (results || []).map((r) => ({
    id: r.id, library_id: r.library_id, title: r.title || '', description: r.description || '',
    cover_image: r.cover_image || '', section_hint: r.section_hint || '',
    sort_order: Number(r.sort_order || 0), item_count: Number(r.item_count || 0),
  })) });
});

router.post('/tours/:tourId/library-links', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  let body;
  try { body = await c.req.json(); } catch { return jsonError(c, 400, 'Invalid JSON body'); }
  const libraryId = String(body.library_id || '').trim();
  if (!libraryId) return jsonError(c, 400, 'library_id is required');
  const lib = await c.env.DB.prepare('SELECT id FROM tenant_media_libraries WHERE tenant_id = ? AND id = ?').bind(ctx.tenantId, libraryId).first();
  if (!lib) return jsonError(c, 404, 'Library not found');
  const tour = await c.env.DB.prepare('SELECT id FROM tours WHERE tenant_id = ? AND id = ?').bind(ctx.tenantId, c.req.param('tourId')).first();
  if (!tour) return jsonError(c, 404, 'Tour not found');
  const now = Math.floor(Date.now() / 1000);
  const id = nanoid();
  await c.env.DB
    .prepare('INSERT OR IGNORE INTO tour_media_library_links (id, tenant_id, tour_id, library_id, section_hint, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, ctx.tenantId, c.req.param('tourId'), libraryId, String(body.section_hint || '').trim(), Number(body.sort_order || 0), now)
    .run();
  return c.json({ ok: true, link: { id, library_id: libraryId, tour_id: c.req.param('tourId') } }, 201);
});

router.delete('/library-links/:linkId', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  const result = await c.env.DB.prepare('DELETE FROM tour_media_library_links WHERE id = ? AND tenant_id = ?').bind(c.req.param('linkId'), ctx.tenantId).run();
  if (!result.meta?.changes) return jsonError(c, 404, 'Link not found');
  return c.json({ ok: true });
});

// ── Tour canonical ────────────────────────────────────────────────────────────

router.get('/tours/:tourId/canonical', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;

  const row = await c.env.DB
    .prepare('SELECT * FROM tours WHERE id = ? AND tenant_id = ?')
    .bind(c.req.param('tourId'), ctx.tenantId)
    .first();

  if (!row) {
    return jsonError(c, 404, 'Tour not found');
  }

  return c.json({ ok: true, tour: normalizeTourCanonical(row) });
});

router.patch('/tours/:tourId/canonical', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;

  let body;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, 'Invalid JSON body');
  }

  const current = await c.env.DB
    .prepare('SELECT * FROM tours WHERE id = ? AND tenant_id = ?')
    .bind(c.req.param('tourId'), ctx.tenantId)
    .first();

  if (!current) {
    return jsonError(c, 404, 'Tour not found');
  }

  const updates = [];
  const binds = [];
  const setValue = (column, value) => {
    if (value === undefined) return;
    updates.push(`${column} = ?`);
    binds.push(value);
  };

  if ('title' in body) {
    const nextTitle = String(body.title || '').trim();
    if (!nextTitle) return jsonError(c, 400, 'title cannot be empty');
    setValue('title', nextTitle);
  }

  if ('slug' in body) {
    const nextSlug = slugify(body.slug);
    if (!nextSlug) return jsonError(c, 400, 'slug is invalid');
    setValue('slug', nextSlug);
  }

  if ('duration_text' in body) {
    setValue('duration_text', String(body.duration_text || '').trim());
  }

  if ('content_data' in body) {
    if (!body.content_data || typeof body.content_data !== 'object' || Array.isArray(body.content_data)) {
      return jsonError(c, 400, 'content_data must be an object');
    }
    const nextContent = mergeNestedObjects(parseJsonSafe(current.content_data, {}), body.content_data);
    setValue('content_data', JSON.stringify(nextContent));
  }

  if (!updates.length) {
    return jsonError(c, 400, 'No valid fields provided');
  }

  binds.push(c.req.param('tourId'), ctx.tenantId);
  await c.env.DB
    .prepare(`UPDATE tours SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`)
    .bind(...binds)
    .run();

  const syncResult = await syncUniversalTourPage(c.env, ctx.tenantId, c.req.param('tourId'));
  if (!syncResult.ok) {
    return jsonError(c, syncResult.status || 500, syncResult.error || 'Failed to sync universal tour page');
  }

  const refreshed = await c.env.DB
    .prepare('SELECT * FROM tours WHERE id = ? AND tenant_id = ?')
    .bind(c.req.param('tourId'), ctx.tenantId)
    .first();

  return c.json({ ok: true, tour: normalizeTourCanonical(refreshed), sync: syncResult });
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

router.patch('/tours/:tourId/page', async (c) => {
  const ctx = await requireTenant(c);
  if (ctx.error) return ctx.error;
  await ensureUniversalSiteInitialized(c.env.DB, ctx.tenantId, ctx.tenant.name);

  let body;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, 'Invalid JSON body');
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonError(c, 400, 'Body must be an object');
  }

  const row = await c.env.DB
    .prepare('SELECT * FROM tenant_universal_tour_pages WHERE tenant_id = ? AND tour_id = ?')
    .bind(ctx.tenantId, c.req.param('tourId'))
    .first();

  if (!row) {
    return jsonError(c, 404, 'Universal tour page not found. Call sync first.');
  }

  if ('content_override' in body && (!body.content_override || typeof body.content_override !== 'object' || Array.isArray(body.content_override))) {
    return jsonError(c, 400, 'content_override must be an object');
  }

  const currentOverride = parseJsonSafe(row.content_override_json, {});
  const nextOverride = body.content_override ? mergeNestedObjects(currentOverride, body.content_override) : currentOverride;
  const nextBookingCta = normalizeStringValue(body.booking_cta_label, nextOverride?.sync_snapshot?.booking_cta_label, row.booking_cta_label);
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB
    .prepare('UPDATE tenant_universal_tour_pages SET content_override_json = ?, booking_cta_label = ?, updated_at = ? WHERE tenant_id = ? AND tour_id = ?')
    .bind(JSON.stringify(nextOverride), nextBookingCta || row.booking_cta_label, now, ctx.tenantId, c.req.param('tourId'))
    .run();

  await purgeTenantPublicCache(c.env.DB, ctx.tenantId);

  return c.json({
    ok: true,
    tour_page: {
      ...row,
      content_override: nextOverride,
      booking_cta_label: nextBookingCta || row.booking_cta_label,
      updated_at: now,
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
    .prepare('SELECT id, name, template_id, site_config, default_locale, booking_currency, market_skin_key, primary_market FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();

  if (!tenant) {
    return jsonError(c, 404, 'Tenant not found');
  }

  const siteBundle = await getSiteBundle(tenantId, tenant, c.env.DB, c.env);
  const requestedTourId = c.req.query('tourId')?.trim();
  const requestedSlug = slugify(c.req.query('slug') || '') || siteBundle.site?.home_page_key || 'home';
  const adminMode = c.req.query('admin') === '1';

  let pageRow = await c.env.DB
    .prepare('SELECT * FROM tenant_universal_pages WHERE tenant_id = ? AND slug = ? LIMIT 1')
    .bind(tenantId, requestedSlug)
    .first();

  if (!pageRow) {
    pageRow = await c.env.DB
      .prepare('SELECT * FROM tenant_universal_pages WHERE tenant_id = ? AND page_key = ? LIMIT 1')
      .bind(tenantId, requestedSlug)
      .first();
  }

  if (!pageRow) {
    pageRow = await c.env.DB
      .prepare('SELECT * FROM tenant_universal_pages WHERE tenant_id = ? ORDER BY CASE WHEN page_key = ? THEN 0 ELSE 1 END, created_at ASC LIMIT 1')
      .bind(tenantId, siteBundle.site?.home_page_key || 'home')
      .first();
  }

  if (!pageRow) {
    return jsonError(c, 404, 'Universal page not found');
  }

  const page = normalizePage(pageRow);

  const tourPageRow = requestedTourId
    ? await c.env.DB
        .prepare('SELECT * FROM tenant_universal_tour_pages WHERE tenant_id = ? AND tour_id = ?')
        .bind(tenantId, requestedTourId)
        .first()
    : page.page_type === 'tour_detail'
      ? await c.env.DB
          .prepare('SELECT * FROM tenant_universal_tour_pages WHERE tenant_id = ? AND slug = ? LIMIT 1')
          .bind(tenantId, page.slug)
          .first()
    : await c.env.DB
        .prepare('SELECT * FROM tenant_universal_tour_pages WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT 1')
        .bind(tenantId)
        .first();

  const previewHtml = renderPublicHtml(siteBundle, page, tourPageRow ? parseJsonSafe(tourPageRow.content_override_json, {}) : null, { adminMode, requestUrl: c.req.url });
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
      .prepare('SELECT id, name, template_id, site_config, default_locale, booking_currency, market_skin_key, primary_market FROM tenants WHERE id = ?')
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
    const siteBundle = await getSiteBundle(tenantId, tenant, c.env.DB, c.env);
    const tourPageRow = page.page_type === 'tour_detail'
      ? await c.env.DB
          .prepare('SELECT * FROM tenant_universal_tour_pages WHERE tenant_id = ? AND slug = ?')
          .bind(tenantId, slug)
          .first()
      : null;

    const html = renderPublicHtml(siteBundle, page, tourPageRow ? parseJsonSafe(tourPageRow.content_override_json, {}) : null, { requestUrl: c.req.url });
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
