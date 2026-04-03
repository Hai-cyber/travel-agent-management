import { nanoid } from 'nanoid';
import { ensureUniversalSiteInitialized, syncUniversalTourPage } from './universalSiteSync.js';

const DEFAULT_TEMPLATE_ID = 'default';
const DEFAULT_CURRENCY = 'USD';

const SAMPLE_HERO_IMAGES = [
  'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=2200&q=80',
  'https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=2200&q=80',
  'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=2200&q=80',
  'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=2200&q=80',
];

const SAMPLE_HOTEL_IMAGES = [
  'https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1445019980597-93fa8acb246c?auto=format&fit=crop&w=1200&q=80',
];

const STARTER_TOUR_SEEDS = [
  {
    title: 'Signature Vietnam Escape',
    featured: true,
    durationText: '8 days / 7 nights',
    summary: 'A polished introduction to Vietnam with old-quarter energy, bay cruising, and lantern-lit evenings that immediately make the storefront feel premium.',
    about: 'Designed as a high-conversion sample itinerary, this journey layers culture, soft luxury, and easy edit points so a new tenant starts with believable storytelling and strong visual rhythm.',
    heroImage: SAMPLE_HERO_IMAGES[0],
    destinationImage: 'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=1600&q=80',
    accommodationTitle: 'Lotus Heritage Suites',
    accommodationSummary: 'Riverside suites with warm timber interiors, private transfers, and concierge-ready add-ons for premium traveler journeys.',
    accommodationImage: SAMPLE_HOTEL_IMAGES[0],
    accommodationAddress: 'Hoan Kiem District, Hanoi, Vietnam',
    galleryImages: [
      SAMPLE_HERO_IMAGES[0],
      'https://images.unsplash.com/photo-1528181304800-259b08848526?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=1400&q=80',
    ],
    highlights: ['Private airport greeting', 'Halong overnight cruise', 'Old town dining and culture'],
    destinationName: 'Hoi An',
    basePrice: 1680,
    singlePrice: 2140,
    childPrice: 840,
    stops: [
      { code: 'hanoi', name: 'Hanoi', label: 'Hanoi arrival and old quarter', dayFrom: 1, dayTo: 2, nights: 2, breakfast: 1, lunch: 0, dinner: 1, description: 'Street food orientation, colonial avenues, and a welcome dinner that sets the tone.' },
      { code: 'halong-bay', name: 'Ha Long Bay', label: 'Ha Long Bay cruise', dayFrom: 3, dayTo: 4, nights: 1, breakfast: 1, lunch: 1, dinner: 1, description: 'Limestone bay cruising with kayaking, sunset deck service, and premium cabin styling.' },
      { code: 'hoi-an', name: 'Hoi An', label: 'Hoi An heritage nights', dayFrom: 5, dayTo: 8, nights: 4, breakfast: 1, lunch: 0, dinner: 1, description: 'Lantern streets, beach downtime, and tailor-made free time for upsell moments.' },
    ],
  },
  {
    title: 'Mekong River Slow Luxury',
    featured: true,
    durationText: '6 days / 5 nights',
    summary: 'A calm southern itinerary with floating markets, river lodges, and wellness pacing built for elegant storytelling out of the box.',
    about: 'This sample helps a new tenant showcase softer pacing, couple-friendly visuals, and high-margin stay moments without needing to draft copy from zero.',
    heroImage: SAMPLE_HERO_IMAGES[1],
    destinationImage: 'https://images.unsplash.com/photo-1502082553048-f009c37129b9?auto=format&fit=crop&w=1600&q=80',
    accommodationTitle: 'River Palm Retreat',
    accommodationSummary: 'Garden villas and sunrise boat departures curated for serene, photo-rich client journeys in the Mekong delta.',
    accommodationImage: SAMPLE_HOTEL_IMAGES[1],
    accommodationAddress: 'Ninh Kieu Waterfront, Can Tho, Vietnam',
    galleryImages: [
      SAMPLE_HERO_IMAGES[1],
      'https://images.unsplash.com/photo-1518546305927-5a555bb7020d?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1517760444937-f6397edcbbcd?auto=format&fit=crop&w=1400&q=80',
    ],
    highlights: ['Floating market sunrise', 'Private river transfers', 'Wellness-focused pacing'],
    destinationName: 'Phu Quoc',
    basePrice: 1420,
    singlePrice: 1810,
    childPrice: 710,
    stops: [
      { code: 'can-tho', name: 'Can Tho', label: 'Can Tho river arrival', dayFrom: 1, dayTo: 2, nights: 2, breakfast: 1, lunch: 1, dinner: 0, description: 'Boutique riverfront check-in and a guided market immersion.' },
      { code: 'chau-doc', name: 'Chau Doc', label: 'Chau Doc cultural stretch', dayFrom: 3, dayTo: 4, nights: 1, breakfast: 1, lunch: 0, dinner: 1, description: 'Slow temple visits, local crafts, and cross-border river heritage storytelling.' },
      { code: 'phu-quoc', name: 'Phu Quoc', label: 'Phu Quoc beach finale', dayFrom: 5, dayTo: 6, nights: 2, breakfast: 1, lunch: 0, dinner: 1, description: 'Coastal rest days with enough premium feel to anchor upsell offers.' },
    ],
  },
  {
    title: 'Highland Wellness Circuit',
    featured: true,
    durationText: '5 days / 4 nights',
    summary: 'An elevated sample itinerary for wellness and nature operators, mixing cool-climate stays, coffee country, and restorative pacing.',
    about: 'This route gives a brand-new tenant a second tone of voice on day one: slower, greener, and ideal for editorial storytelling around wellness travel.',
    heroImage: SAMPLE_HERO_IMAGES[2],
    destinationImage: 'https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=1600&q=80',
    accommodationTitle: 'Pine Cloud Lodge',
    accommodationSummary: 'Forest-edge villas, spa-ready bathrooms, and sunrise decks to support a more restorative travel brand from the first login.',
    accommodationImage: SAMPLE_HOTEL_IMAGES[2],
    accommodationAddress: 'Xuan Huong Lake, Da Lat, Vietnam',
    galleryImages: [
      SAMPLE_HERO_IMAGES[2],
      'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1400&q=80',
    ],
    highlights: ['Wellness retreat framing', 'Coffee and farm storytelling', 'Cool-climate premium stay'],
    destinationName: 'Buon Ma Thuot',
    basePrice: 1290,
    singlePrice: 1640,
    childPrice: 645,
    stops: [
      { code: 'da-lat', name: 'Da Lat', label: 'Da Lat wellness arrival', dayFrom: 1, dayTo: 2, nights: 2, breakfast: 1, lunch: 0, dinner: 1, description: 'Flower gardens, spa rituals, and pine-lined drives for calm brand imagery.' },
      { code: 'lak-lake', name: 'Lak Lake', label: 'Lak Lake nature reset', dayFrom: 3, dayTo: 3, nights: 1, breakfast: 1, lunch: 1, dinner: 0, description: 'Lake-facing downtime with gentle nature activities and strong photography cues.' },
      { code: 'buon-ma-thuot', name: 'Buon Ma Thuot', label: 'Coffee capital finale', dayFrom: 4, dayTo: 5, nights: 1, breakfast: 1, lunch: 0, dinner: 1, description: 'Coffee tastings, design-led cafes, and a modern inland luxury angle.' },
    ],
  },
  {
    title: 'Central Coast Signature Journey',
    featured: false,
    durationText: '7 days / 6 nights',
    summary: 'A beach-and-culture sample that gives the homepage movement immediately, with editorial imagery across coastlines, dining, and heritage cities.',
    about: 'Built to make a fresh storefront feel commercially ready, this route balances aspirational coast imagery with structured, editable stop content.',
    heroImage: SAMPLE_HERO_IMAGES[3],
    destinationImage: 'https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=1600&q=80',
    accommodationTitle: 'Azure Coast Villas',
    accommodationSummary: 'Ocean-facing suites with design-led interiors and partner-ready positioning for beach, honeymoon, and family offers.',
    accommodationImage: SAMPLE_HOTEL_IMAGES[3],
    accommodationAddress: 'Beachfront Boulevard, Quy Nhon, Vietnam',
    galleryImages: [
      SAMPLE_HERO_IMAGES[3],
      'https://images.unsplash.com/photo-1501594907352-04cda38ebc29?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1501555088652-021faa106b9b?auto=format&fit=crop&w=1400&q=80',
    ],
    highlights: ['Beachfront premium imagery', 'Heritage and cuisine mix', 'Family and honeymoon positioning'],
    destinationName: 'Hoi An',
    basePrice: 1560,
    singlePrice: 1980,
    childPrice: 780,
    stops: [
      { code: 'nha-trang', name: 'Nha Trang', label: 'Nha Trang sea start', dayFrom: 1, dayTo: 2, nights: 2, breakfast: 1, lunch: 0, dinner: 1, description: 'Sea-view arrival, beach club options, and crisp visual anchors for the homepage.' },
      { code: 'quy-nhon', name: 'Quy Nhon', label: 'Quy Nhon villa stay', dayFrom: 3, dayTo: 4, nights: 2, breakfast: 1, lunch: 1, dinner: 0, description: 'Quiet bays, boutique resort stays, and strong accommodation storytelling.' },
      { code: 'hoi-an', name: 'Hoi An', label: 'Hoi An closing chapter', dayFrom: 5, dayTo: 7, nights: 2, breakfast: 1, lunch: 0, dinner: 1, description: 'A familiar, high-conversion closer with food, walking streets, and lantern ambience.' },
    ],
  },
];

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function buildGalleryImages(seed, fallbackTitle) {
  const sources = Array.isArray(seed.galleryImages) ? seed.galleryImages : [];
  return sources.filter(Boolean).map((src, index) => ({
    id: `${slugify(seed.title || fallbackTitle || 'gallery')}-${index + 1}`,
    src,
    alt: fallbackTitle || seed.title || `Gallery image ${index + 1}`,
    caption: index === 0 ? (seed.destinationName || seed.title || '') : '',
  }));
}

function buildStarterItinerary(seed) {
  return (Array.isArray(seed.stops) ? seed.stops : []).map((stop, index) => ({
    day: Number(stop.dayFrom || index + 1),
    title: stop.label || stop.name || `Stop ${index + 1}`,
    description: stop.description || `Planned stop ${index + 1} for ${seed.title}.`,
  }));
}

function buildTourCode(seed) {
  return String(seed.title || 'tour')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .slice(0, 4)
    .map((part) => part.slice(0, 3).toUpperCase())
    .join('-') || 'TOUR';
}

function buildTourContent(seed) {
  const galleryImages = buildGalleryImages(seed, seed.title);
  return {
    tour_name: seed.title,
    tour_code: buildTourCode(seed),
    base_price: seed.basePrice,
    duration: seed.durationText,
    hero_desc: seed.summary,
    tour_desc: seed.about,
    hero_image: seed.heroImage,
    gallery_images: galleryImages,
    home_gallery_images: galleryImages.slice(0, 2),
    highlights: seed.highlights,
    includes: [
      `${seed.accommodationTitle} stay`,
      'Private airport and intercity transfers',
      'Local guide support',
      'Breakfast and selected hosted meals',
    ],
    excludes: [
      'International flights',
      'Travel insurance',
      'Personal expenses and gratuities',
    ],
    itinerary: buildStarterItinerary(seed),
    destination_name: seed.destinationName,
    destination_title: seed.destinationName,
    destination_image: seed.destinationImage,
    destination_summary: seed.summary,
    accommodation_title: seed.accommodationTitle,
    accommodation_summary: seed.accommodationSummary,
    accommodation_image: seed.accommodationImage,
    accommodation_address: seed.accommodationAddress,
    universal_modules: {
      featured_tours: seed.featured !== false,
      featured: seed.featured !== false,
      destinations: seed.destinations !== false,
      accommodation: seed.accommodation !== false,
      hero: true,
    },
  };
}

async function ensurePricingContext(db, tenantId, now) {
  const [seasonRow, segmentRow, paxRowsResult] = await db.batch([
    db.prepare('SELECT id FROM tenant_seasons WHERE tenant_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT 1').bind(tenantId),
    db.prepare('SELECT id FROM pricing_segments WHERE tenant_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT 1').bind(tenantId),
    db.prepare('SELECT id, min_pax, max_pax FROM pax_bands WHERE tenant_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT 3').bind(tenantId),
  ]);

  let seasonId = seasonRow.results?.[0]?.id || seasonRow.id;
  let segmentId = segmentRow.results?.[0]?.id || segmentRow.id;
  let paxBands = paxRowsResult.results || [];
  const statements = [];

  if (!seasonId) {
    seasonId = nanoid();
    statements.push(
      db.prepare(
        `INSERT INTO tenant_seasons
         (id, tenant_id, name, start_month, start_day, end_month, end_day, sort_order, is_active, notes, created_at)
         VALUES (?, ?, ?, 1, 1, 12, 31, 0, 1, ?, ?)`
      ).bind(seasonId, tenantId, 'Year Round', 'Default starter season for seeded showcase tours', now)
    );
  }

  if (!segmentId) {
    segmentId = nanoid();
    statements.push(
      db.prepare(
        `INSERT INTO pricing_segments
         (id, tenant_id, code, name, description, sort_order, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, 0, 1, ?)`
      ).bind(segmentId, tenantId, 'fit', 'FIT', 'Default independent traveler pricing segment', now)
    );
  }

  if (!paxBands.length) {
    paxBands = [
      { id: nanoid(), name: '2-4 Guests', min_pax: 2, max_pax: 4, sort_order: 0 },
      { id: nanoid(), name: '5-8 Guests', min_pax: 5, max_pax: 8, sort_order: 1 },
    ];
    paxBands.forEach((band) => {
      statements.push(
        db.prepare(
          `INSERT INTO pax_bands
           (id, tenant_id, name, min_pax, max_pax, sort_order, is_active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
        ).bind(band.id, tenantId, band.name, band.min_pax, band.max_pax, band.sort_order, now)
      );
    });
  }

  if (statements.length) {
    await db.batch(statements);
  }

  return {
    seasonId,
    segmentId,
    paxBands: paxBands.map((band) => ({
      id: band.id,
      minPax: Number(band.min_pax),
      maxPax: Number(band.max_pax),
    })),
  };
}

function buildHotelGallery(seed, tourId, index) {
  return [seed.accommodationImage, SAMPLE_HOTEL_IMAGES[(index + 1) % SAMPLE_HOTEL_IMAGES.length]]
    .filter(Boolean)
    .map((src, galleryIndex) => ({
      id: `hotel-${tourId}-${galleryIndex + 1}`,
      src,
      alt: seed.accommodationTitle,
      caption: galleryIndex === 0 ? seed.accommodationTitle : `${seed.accommodationTitle} detail ${galleryIndex + 1}`,
    }));
}

function buildStopServicesConfig(stopIndex, stopCount) {
  return {
    hotel: 1,
    guide: 1,
    local: ['car7'],
    intercity: stopIndex < stopCount - 1 ? ['car7'] : [],
    pub: {
      hotel: 1,
      guide: 1,
      local: 1,
      intercity: 1,
    },
  };
}

function buildMealRows(seed, stop, stopId, tenantId, createdAt) {
  const meals = [
    stop.breakfast ? { mealType: 'breakfast', label: `${stop.name} breakfast host` } : null,
    stop.lunch ? { mealType: 'lunch', label: `${stop.name} lunch partner` } : null,
    stop.dinner ? { mealType: 'dinner', label: `${stop.name} dinner partner` } : null,
  ].filter(Boolean);

  return meals.map((meal, index) => ({
    sql: `INSERT INTO stop_meals
      (id, tenant_id, tour_stop_id, person_in_charge, meal_type, restaurant_name, contact_name, contact_phone, contact_email, address, meal_datetime, notes, stage, status, position, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'planned', ?, ?)`,
    params: [
      nanoid(),
      tenantId,
      stopId,
      'Operations Desk',
      meal.mealType,
      `${seed.destinationName} ${meal.label}`,
      'Supplier Desk',
      '+84000000000',
      'ops@travelagent.local',
      `${stop.name}, Vietnam`,
      createdAt + (index * 3600),
      `Starter ${meal.mealType} service for ${stop.label}`,
      index,
      createdAt,
    ],
  }));
}

function buildStopServiceStatements(seed, stop, stopId, tenantId, createdAt, stopIndex, stopCount) {
  const statements = [
    {
      sql: `INSERT INTO stop_accommodations
        (id, tenant_id, tour_stop_id, person_in_charge, hotel_name, contact_name, contact_phone, contact_email, address, check_in, check_out, room_type, guests, notes, stage, status, position, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'planned', ?, ?)`,
      params: [
        nanoid(),
        tenantId,
        stopId,
        'Operations Desk',
        `${seed.accommodationTitle} - ${stop.name}`,
        'Supplier Desk',
        '+84000000000',
        'ops@travelagent.local',
        `${stop.name}, Vietnam`,
        createdAt + (stopIndex * 86400),
        createdAt + ((stopIndex + Math.max(stop.nights, 1)) * 86400),
        'Deluxe',
        2,
        `Starter accommodation service for ${stop.label}`,
        stopIndex,
        createdAt,
      ],
    },
    {
      sql: `INSERT INTO stop_guides
        (id, tenant_id, tour_stop_id, person_in_charge, guide_name, contact_name, phone, email, address, languages, time_from, time_to, notes, stage, status, position, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'planned', ?, ?)`,
      params: [
        nanoid(),
        tenantId,
        stopId,
        'Guide Coordinator',
        `${stop.name} Local Guide`,
        'Guide Desk',
        '+84000000001',
        'guide@travelagent.local',
        `${stop.name}, Vietnam`,
        'English, Vietnamese',
        createdAt + (stopIndex * 86400) + 9 * 3600,
        createdAt + (stopIndex * 86400) + 17 * 3600,
        `Starter guide service for ${stop.label}`,
        stopIndex,
        createdAt,
      ],
    },
    {
      sql: `INSERT INTO stop_local_transports
        (id, tenant_id, tour_stop_id, person_in_charge, mode, supplier, contact_name, driver_name, phone, email, address, pickup_time, pickup_place, dropoff_place, notes, stage, status, position, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'planned', ?, ?)`,
      params: [
        nanoid(),
        tenantId,
        stopId,
        'Transport Desk',
        'car7',
        `${stop.name} Local Transport`,
        'Dispatch Team',
        `${stop.name} Driver`,
        '+84000000002',
        'transport@travelagent.local',
        `${stop.name}, Vietnam`,
        createdAt + (stopIndex * 86400) + 8 * 3600,
        `${stop.name} city center`,
        `${stop.name} hotel`,
        `Starter local transport for ${stop.label}`,
        stopIndex,
        createdAt,
      ],
    },
  ];

  if (stopIndex < stopCount - 1) {
    statements.push({
      sql: `INSERT INTO stop_intercity_legs
        (id, tenant_id, tour_stop_id, person_in_charge, mode, supplier, contact_name, phone, email, address, depart_time, depart_point, arrive_point, ticket_ref, notes, stage, status, position, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'planned', ?, ?)`,
      params: [
        nanoid(),
        tenantId,
        stopId,
        'Transport Desk',
        'car7',
        `${stop.name} Intercity Transfer`,
        'Dispatch Team',
        '+84000000003',
        'intercity@travelagent.local',
        `${stop.name}, Vietnam`,
        createdAt + (stopIndex * 86400) + 18 * 3600,
        `${stop.name} departure point`,
        'Next itinerary stop',
        `LEG-${String(stopIndex + 1).padStart(2, '0')}`,
        `Starter intercity transfer after ${stop.label}`,
        stopIndex,
        createdAt,
      ],
    });
  }

  return [...statements, ...buildMealRows(seed, stop, stopId, tenantId, createdAt)];
}

export async function bootstrapTenantStarterContent(env, tenantId, tenantName) {
  const db = env?.DB;
  if (!db || !tenantId) {
    return { ok: false, skipped: true, reason: 'missing_context' };
  }

  const existingTours = await db
    .prepare('SELECT COUNT(*) AS total FROM tours WHERE tenant_id = ?')
    .bind(tenantId)
    .first();

  if (Number(existingTours?.total || 0) > 0) {
    return { ok: true, skipped: true, reason: 'tenant_has_existing_tours' };
  }

  const now = Math.floor(Date.now() / 1000);
  await ensureUniversalSiteInitialized(db, tenantId, tenantName);
  const pricingContext = await ensurePricingContext(db, tenantId, now);

  const destinationMap = new Map();
  STARTER_TOUR_SEEDS.forEach((seed) => {
    seed.stops.forEach((stop) => {
      if (!destinationMap.has(stop.code)) {
        destinationMap.set(stop.code, { code: stop.code, name: stop.name, id: nanoid() });
      }
    });
  });

  const statements = [];
  for (const destination of destinationMap.values()) {
    statements.push(
      db.prepare(
        `INSERT INTO destinations
         (id, tenant_id, code, name, is_active, created_at)
         VALUES (?, ?, ?, ?, 1, ?)`
      ).bind(destination.id, tenantId, destination.code, destination.name, now)
    );
  }

  const seededTours = STARTER_TOUR_SEEDS.map((seed, index) => {
    const tourId = nanoid();
    const createdAt = now + index;
    const slug = `${slugify(seed.title)}-${tourId.slice(0, 6).toLowerCase()}`;
    const contentData = JSON.stringify(buildTourContent(seed));

    statements.push(
      db.prepare(
        `INSERT INTO tours
         (id, tenant_id, title, lang, duration_text, start_date, status, slug, content_data, template_id, created_at)
         VALUES (?, ?, ?, 'en', ?, NULL, 'draft', ?, ?, ?, ?)`
      ).bind(tourId, tenantId, seed.title, seed.durationText, slug, contentData, DEFAULT_TEMPLATE_ID, createdAt)
    );

    seed.stops.forEach((stop, stopIndex) => {
      const stopId = nanoid();
      const servicesConfig = buildStopServicesConfig(stopIndex, seed.stops.length);
      statements.push(
        db.prepare(
          `INSERT INTO tour_stops
           (id, tenant_id, tour_id, destination_id, label, day_from, day_to, nights, meal_breakfast, meal_lunch, meal_dinner, description, services_config, sort_order, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          stopId,
          tenantId,
          tourId,
          destinationMap.get(stop.code)?.id || null,
          stop.label,
          stop.dayFrom,
          stop.dayTo,
          stop.nights,
          stop.breakfast ? 1 : 0,
          stop.lunch ? 1 : 0,
          stop.dinner ? 1 : 0,
          stop.description,
          JSON.stringify(servicesConfig),
          stopIndex,
          createdAt,
        )
      );

      buildStopServiceStatements(seed, stop, stopId, tenantId, createdAt, stopIndex, seed.stops.length).forEach((statement) => {
        statements.push(db.prepare(statement.sql).bind(...statement.params));
      });
    });

    pricingContext.paxBands.forEach((band, bandIndex) => {
      const bandDiscount = bandIndex === 0 ? 0 : 160;
      statements.push(
        db.prepare(
          `INSERT INTO tour_prices
           (id, tenant_id, tour_id, season_id, segment_id, pax_band_id, base_currency, adult_shared_room_price, adult_single_room_price, child_shared_with_parents_price, notes, is_active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
        ).bind(
          nanoid(),
          tenantId,
          tourId,
          pricingContext.seasonId,
          pricingContext.segmentId,
          band.id,
          DEFAULT_CURRENCY,
          Math.max(seed.basePrice - bandDiscount, 250),
          Math.max(seed.singlePrice - bandDiscount, 350),
          Math.max(seed.childPrice - Math.round(bandDiscount / 2), 150),
          `Starter pricing for ${band.minPax}-${band.maxPax} guests`,
          createdAt,
        )
      );
    });

    statements.push(
      db.prepare(
        `INSERT INTO tenant_universal_hotels
         (id, tenant_id, hotel_key, tour_id, name, description, address, gallery_json, status, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
      ).bind(
        nanoid(),
        tenantId,
        slugify(seed.accommodationTitle || `hotel-${tourId}`) || `hotel-${tourId}`,
        tourId,
        seed.accommodationTitle,
        seed.accommodationSummary,
        seed.accommodationAddress,
        JSON.stringify(buildHotelGallery(seed, tourId, index)),
        index,
        createdAt,
        createdAt,
      )
    );

    return { id: tourId, title: seed.title };
  });

  await db.batch(statements);

  const syncedTours = [];
  for (const tour of seededTours) {
    const result = await syncUniversalTourPage(env, tenantId, tour.id);
    syncedTours.push({ id: tour.id, title: tour.title, ok: Boolean(result?.ok), public_url: result?.public_url || null });
  }

  return {
    ok: true,
    skipped: false,
    seeded: {
      tours: seededTours.length,
      destinations: destinationMap.size,
      hotels: seededTours.length,
      stop_services: STARTER_TOUR_SEEDS.reduce((count, seed) => count + seed.stops.length, 0),
    },
    tours: syncedTours,
  };
}