// src/routes/distribution.js
// ── Tour Distribution Helper ─────────────────────────────────────────────────
//
// GET /api/distribution/tours/:id/listing-package
//   Assembles all structured tour content into copy-ready listing formats:
//     - ota_card      (title, duration, description, highlights, price, inclusions, meeting point, contact)
//     - social_snippet (3-5 bullet highlights + hero image + caption)
//     - agent_brief    (full itinerary, pricing table, booking contact)
//
// GET /api/distribution/tours/:id/channel-readiness
//   Scores tour completeness against minimum requirements for 3 channels:
//     - own_site, ota_generic, social
//
// Auth: X-Tenant-ID header (set from session on the client).
// No new DB tables needed — assembles from existing tours, tour_stops,
// pricing_segments, pax_bands, tour_prices, and tenants.

import { Hono } from 'hono';

const distribution = new Hono();

// ── Shared helpers ────────────────────────────────────────────────────────────

function safeJson(raw) {
  if (!raw) return {};
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return {}; }
}

function fmtPrice(amount, currency = 'USD') {
  if (!amount && amount !== 0) return null;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency,
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${Number(amount).toLocaleString()}`;
  }
}

// ── GET /api/distribution/tours/:id/listing-package ───────────────────────────
distribution.get('/tours/:id/listing-package', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const tourId = c.req.param('id');

  try {
    const db = c.env.DB;

    // ── Fetch tour + tenant context ───────────────────────────────────────
    const [tour, tenant] = await Promise.all([
      db.prepare(`
        SELECT id, title, slug, duration_text, tour_type, lang,
               content_data, status
          FROM tours
         WHERE id = ? AND tenant_id = ?
      `).bind(tourId, tenantId).first(),

      db.prepare(`
        SELECT name, email, booking_currency, base_currency, payment_config_json
          FROM tenants WHERE id = ?
      `).bind(tenantId).first(),
    ]);

    if (!tour) return c.json({ error: 'Tour not found.' }, 404);

    const content  = safeJson(tour.content_data);
    const currency = tenant?.booking_currency ?? content.booking_currency ?? 'USD';

    // ── Fetch stops ───────────────────────────────────────────────────────
    const stopsRes = await db
      .prepare(`
        SELECT label, day_from, day_to, description
          FROM tour_stops
         WHERE tour_id = ? AND tenant_id = ?
         ORDER BY sort_order ASC, day_from ASC
      `)
      .bind(tourId, tenantId)
      .all();
    const stops = stopsRes.results ?? [];

    // ── Fetch lowest price (from/to) ─────────────────────────────────────
    // tour_prices has tour_id directly; price is in adult_shared_room_price
    const priceRes = await db
      .prepare(`
        SELECT MIN(adult_shared_room_price) AS min_price,
               MAX(adult_shared_room_price) AS max_price
          FROM tour_prices
         WHERE tour_id = ? AND tenant_id = ?
           AND adult_shared_room_price > 0
      `)
      .bind(tourId, tenantId)
      .first();

    const minPrice = priceRes?.min_price ?? content.base_price ?? null;
    const maxPrice = priceRes?.max_price ?? null;

    // ── Core fields ───────────────────────────────────────────────────────
    const title       = content.tour_name    ?? tour.title ?? '';
    const description = content.hero_desc    ?? content.description ?? content.meta_description ?? '';
    const duration    = tour.duration_text   ?? content.duration ?? '';
    const highlights  = Array.isArray(content.highlights) ? content.highlights : [];
    const includes    = Array.isArray(content.includes)   ? content.includes   : [];
    const excludes    = Array.isArray(content.excludes)   ? content.excludes   : [];
    const heroImage   = content.og_image     ?? content.hero_image ?? null;
    const meetingPt   = content.meeting_point ?? content.start_location ?? null;
    const contactEmail = tenant?.email ?? null;

    // ── Build price display string ────────────────────────────────────────
    let priceDisplay = null;
    if (minPrice !== null) {
      const from = fmtPrice(minPrice, currency);
      priceDisplay = maxPrice && maxPrice !== minPrice
        ? `From ${from} / person`
        : `${from} / person`;
    }

    // ── Itinerary from stops ──────────────────────────────────────────────
    const itinerary = stops.length > 0
      ? stops.map(s => ({
          day:      s.day_from,
          location: s.label ?? '',
          summary:  s.description ?? '',
        }))
      : (Array.isArray(content.itinerary) ? content.itinerary : []);

    // ── OTA card ──────────────────────────────────────────────────────────
    // Short, structured text block ready to paste into Booking.com, Agoda,
    // Viator, or any OTA listing form.
    const otaCardLines = [
      `📌 ${title}`,
      duration   ? `⏱️ Duration: ${duration}` : null,
      priceDisplay ? `💰 Price: ${priceDisplay}` : null,
      '',
      description ? description : null,
      '',
      highlights.length  ? `✅ Highlights:\n${highlights.map(h => `• ${h}`).join('\n')}` : null,
      includes.length    ? `\n✅ Included:\n${includes.map(i => `• ${i}`).join('\n')}` : null,
      excludes.length    ? `\n❌ Not included:\n${excludes.map(e => `• ${e}`).join('\n')}` : null,
      meetingPt          ? `\n📍 Meeting point: ${meetingPt}` : null,
      contactEmail       ? `\n📧 Bookings: ${contactEmail}` : null,
    ].filter(l => l !== null).join('\n').trim();

    // ── Social snippet ────────────────────────────────────────────────────
    // Caption-ready for Instagram / Facebook / WhatsApp broadcast.
    const socialBullets = highlights.slice(0, 5);
    const socialLines = [
      `✨ ${title}`,
      duration ? `📅 ${duration}` : null,
      priceDisplay ? `💰 ${priceDisplay}` : null,
      '',
      socialBullets.length ? socialBullets.map(h => `• ${h}`).join('\n') : null,
      '',
      contactEmail ? `📩 Book now: ${contactEmail}` : null,
    ].filter(l => l !== null).join('\n').trim();

    // ── Travel agent brief ────────────────────────────────────────────────
    // Full structured text for forwarding to agent networks.
    const agentLines = [
      `TOUR BRIEF — ${title}`,
      `${'─'.repeat(50)}`,
      duration    ? `Duration:     ${duration}` : null,
      priceDisplay ? `Price:        ${priceDisplay}` : null,
      meetingPt   ? `Meeting point: ${meetingPt}` : null,
      '',
      description ? `OVERVIEW\n${description}` : null,
      '',
      itinerary.length ? (
        `ITINERARY\n` + itinerary.map(d =>
          `Day ${d.day ?? '?'} — ${d.location ?? ''}\n${d.summary ?? ''}`
        ).join('\n\n')
      ) : null,
      '',
      includes.length ? `INCLUDED\n${includes.map(i => `✓ ${i}`).join('\n')}` : null,
      excludes.length ? `\nNOT INCLUDED\n${excludes.map(e => `✗ ${e}`).join('\n')}` : null,
      '',
      contactEmail ? `BOOKING CONTACT\nEmail: ${contactEmail}` : null,
    ].filter(l => l !== null).join('\n').trim();

    return c.json({
      ok: true,
      tour_id: tourId,
      title,
      formats: {
        ota_card: {
          label:   'OTA Listing Card',
          hint:    'Paste into Booking.com, Agoda, Viator, or any OTA listing form',
          content: otaCardLines,
        },
        social_snippet: {
          label:     'Social Media Caption',
          hint:      'Paste into Instagram, Facebook, or WhatsApp broadcast',
          content:   socialLines,
          hero_image: heroImage,
        },
        agent_brief: {
          label:   'Travel Agent Brief',
          hint:    'Forward to travel agents or partner networks',
          content: agentLines,
        },
      },
      raw: {
        title,
        description,
        duration,
        price_display: priceDisplay,
        min_price:     minPrice,
        max_price:     maxPrice,
        currency,
        highlights,
        includes,
        excludes,
        meeting_point: meetingPt,
        hero_image:    heroImage,
        contact_email: contactEmail,
        stops_count:   stops.length,
        itinerary,
      },
    });

  } catch (err) {
    console.error('[DISTRIBUTION] listing-package error', err);
    return c.json({ error: 'Internal server error.' }, 500);
  }
});

// ── GET /api/distribution/tours/:id/channel-readiness ─────────────────────────
distribution.get('/tours/:id/channel-readiness', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const tourId = c.req.param('id');

  try {
    const db = c.env.DB;

    const [tour, priceRow, mediaRow, stopsRow] = await Promise.all([
      db.prepare(`
        SELECT id, title, slug, duration_text, status, content_data
          FROM tours WHERE id = ? AND tenant_id = ?
      `).bind(tourId, tenantId).first(),

      db.prepare(`
        SELECT COUNT(*) AS cnt FROM tour_prices
         WHERE tour_id = ? AND tenant_id = ?
           AND adult_shared_room_price > 0
      `).bind(tourId, tenantId).first(),

      // Check for at least one media item in content_data or og_image
      db.prepare(`
        SELECT content_data FROM tours WHERE id = ? AND tenant_id = ?
      `).bind(tourId, tenantId).first(),

      db.prepare(`
        SELECT COUNT(*) AS cnt FROM tour_stops WHERE tour_id = ? AND tenant_id = ?
      `).bind(tourId, tenantId).first(),
    ]);

    if (!tour) return c.json({ error: 'Tour not found.' }, 404);

    const content = safeJson(tour.content_data);
    const hasPrice       = (priceRow?.cnt ?? 0) > 0 || !!content.base_price;
    const hasImage       = !!(content.og_image ?? content.hero_image);
    const hasDescription = !!(content.hero_desc ?? content.description ?? content.meta_description);
    const hasTitle       = !!tour.title;
    const hasDuration    = !!tour.duration_text;
    const hasHighlights  = Array.isArray(content.highlights) && content.highlights.length > 0;
    const hasIncludes    = Array.isArray(content.includes)   && content.includes.length > 0;
    const hasItinerary   = (stopsRow?.cnt ?? 0) > 0 || (Array.isArray(content.itinerary) && content.itinerary.length > 0);
    const hasMeetingPt   = !!(content.meeting_point ?? content.start_location);
    const hasCancPolicy  = !!(content.cancellation_policy);
    const isPublished    = tour.status === 'published';
    const longDesc       = (content.hero_desc ?? content.description ?? content.meta_description ?? '').length >= 120;

    // ── Channel definitions ───────────────────────────────────────────────
    const channels = [
      {
        key:   'own_site',
        label: 'Your Website',
        icon:  '🌐',
        checks: [
          { id: 'title',       label: 'Tour title',           pass: hasTitle },
          { id: 'description', label: 'Description (120+ chars)', pass: longDesc },
          { id: 'price',       label: 'Price set',            pass: hasPrice },
          { id: 'image',       label: 'Hero image',           pass: hasImage },
          { id: 'itinerary',   label: 'Itinerary / stops',   pass: hasItinerary },
          { id: 'published',   label: 'Published',            pass: isPublished },
        ],
      },
      {
        key:   'ota_generic',
        label: 'OTA / Booking Platform',
        icon:  '🏪',
        checks: [
          { id: 'title',        label: 'Tour title',              pass: hasTitle },
          { id: 'description',  label: 'Description (120+ chars)', pass: longDesc },
          { id: 'price',        label: 'Price set',               pass: hasPrice },
          { id: 'image',        label: 'At least 1 photo',        pass: hasImage },
          { id: 'highlights',   label: 'Highlights list',         pass: hasHighlights },
          { id: 'includes',     label: 'Inclusions list',         pass: hasIncludes },
          { id: 'duration',     label: 'Duration stated',         pass: hasDuration },
          { id: 'meeting_pt',   label: 'Meeting point',           pass: hasMeetingPt },
          { id: 'cancel_policy',label: 'Cancellation policy',     pass: hasCancPolicy },
        ],
      },
      {
        key:   'social',
        label: 'Social Media',
        icon:  '📱',
        checks: [
          { id: 'title',      label: 'Tour title',        pass: hasTitle },
          { id: 'price',      label: 'Price set',         pass: hasPrice },
          { id: 'image',      label: 'Hero image',        pass: hasImage },
          { id: 'highlights', label: '3+ highlights',     pass: Array.isArray(content.highlights) && content.highlights.length >= 3 },
          { id: 'duration',   label: 'Duration stated',   pass: hasDuration },
        ],
      },
    ];

    const scored = channels.map(ch => {
      const passed = ch.checks.filter(c => c.pass).length;
      const total  = ch.checks.length;
      return {
        ...ch,
        passed,
        total,
        score_pct: Math.round((passed / total) * 100),
        ready:     passed === total,
      };
    });

    return c.json({ ok: true, tour_id: tourId, title: tour.title, channels: scored });

  } catch (err) {
    console.error('[DISTRIBUTION] channel-readiness error', err);
    return c.json({ error: 'Internal server error.' }, 500);
  }
});

export default function registerDistributionRoutes(app) {
  app.route('/api/distribution', distribution);
}
