import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { enrichPrice, enrichPricesObject, formatMoney, toUserDate, translate, dualPrice } from '../utils/formatter.js';
import { syncUniversalTourPage } from '../lib/universalSiteSync.js';

const pricing = new Hono();

const TABLE_MAP = {
  'tenant-seasons': 'tenant_seasons',
  'pricing-segments': 'pricing_segments',
  'pax-bands': 'pax_bands',
  'tour-prices': 'tour_prices'
};

// [SEC] Whitelist tÃªn cá»™t cho INSERT.
// D1 bind() chá»‰ báº£o vá»‡ VALUES (?), KHÃ”NG báº£o vá»‡ tÃªn cá»™t trong SQL string.
// Object.keys(userInput) trá»±c tiáº¿p vÃ o SQL = SQL Injection qua column name.
const ALLOWED_INSERT_COLUMNS = {
  tenant_seasons:   ['tenant_id', 'name', 'start_month', 'start_day', 'end_month', 'end_day', 'sort_order', 'is_active', 'notes'],
  pricing_segments: ['tenant_id', 'code', 'name', 'description', 'sort_order', 'is_active'],
  pax_bands:        ['tenant_id', 'name', 'min_pax', 'max_pax', 'sort_order', 'is_active'],
  tour_prices:      ['tenant_id', 'tour_id', 'season_id', 'segment_id', 'pax_band_id', 'base_currency',
                     'adult_shared_room_price', 'adult_single_room_price', 'child_shared_with_parents_price',
                     'infant_price', 'notes', 'is_active'],
};

// [SEC] Whitelist tÃªn cá»™t cho UPDATE.
// id, tenant_id, created_at lÃ  báº¥t biáº¿n â€” khÃ´ng Ä‘Æ°á»£c phÃ©p cáº­p nháº­t tá»« client.
const ALLOWED_UPDATE_COLUMNS = {
  tenant_seasons:   ['name', 'start_month', 'start_day', 'end_month', 'end_day', 'sort_order', 'is_active', 'notes'],
  pricing_segments: ['code', 'name', 'description', 'sort_order', 'is_active'],
  pax_bands:        ['name', 'min_pax', 'max_pax', 'sort_order', 'is_active'],
  tour_prices:      ['tour_id', 'season_id', 'segment_id', 'pax_band_id', 'base_currency',
                     'adult_shared_room_price', 'adult_single_room_price', 'child_shared_with_parents_price',
                     'infant_price', 'notes', 'is_active'],
};

// [SEC-FIX] Bá» 'tenant_id' khá»i táº¥t cáº£ requiredFields.
// tenant_id luÃ´n Ä‘áº¿n tá»« X-Tenant-ID header (khÃ´ng tin body).
// Giá»¯ 'tenant_id' á»Ÿ Ä‘Ã¢y sáº½ khiáº¿n má»i request há»£p lá»‡ bá»‹ tá»« chá»‘i vá»›i lá»—i "Missing required fields: tenant_id".
const requiredFields = {
  'tenant-seasons':   ['name', 'start_month', 'start_day', 'end_month', 'end_day'],
  'pricing-segments': ['code', 'name'],
  'pax-bands':        ['name', 'min_pax', 'max_pax'],
  'tour-prices':      ['tour_id', 'season_id', 'segment_id', 'pax_band_id'],
};

// Validate month (1â€“12) vÃ  day (1â€“31) cho tenant-seasons.
// Chá»‰ kiá»ƒm tra cÃ¡c trÆ°á»ng cÃ³ máº·t trong data (dÃ¹ng chung cho CREATE vÃ  PATCH).
function validateSeasonDates(data) {
  const errors = [];
  const { start_month, end_month, start_day, end_day } = data;
  if (start_month !== undefined && (start_month < 1 || start_month > 12)) {
    errors.push('start_month pháº£i tá»« 1 Ä‘áº¿n 12');
  }
  if (end_month !== undefined && (end_month < 1 || end_month > 12)) {
    errors.push('end_month pháº£i tá»« 1 Ä‘áº¿n 12');
  }
  if (start_day !== undefined && (start_day < 1 || start_day > 31)) {
    errors.push('start_day pháº£i tá»« 1 Ä‘áº¿n 31');
  }
  if (end_day !== undefined && (end_day < 1 || end_day > 31)) {
    errors.push('end_day pháº£i tá»« 1 Ä‘áº¿n 31');
  }
  return errors;
}

function validatePaxBandRange(data) {
  const errors = [];
  const hasMin = data.min_pax !== undefined;
  const hasMax = data.max_pax !== undefined;

  if (!hasMin && !hasMax) return errors;

  const minPax = data.min_pax;
  const maxPax = data.max_pax;

  if (!Number.isInteger(minPax) || !Number.isInteger(maxPax)) {
    errors.push('min_pax and max_pax must be integers');
    return errors;
  }

  if (minPax < 1 || maxPax < 1) {
    errors.push('min_pax and max_pax must be at least 1');
  }
  if (minPax > maxPax) {
    errors.push('min_pax must be less than or equal to max_pax');
  }

  return errors;
}

function getMaxChildrenForRooming(sharedAdults, singleAdults) {
  const sharedDoubleRooms = Math.floor(Math.max(0, Number(sharedAdults) || 0) / 2);
  const privateRooms = Math.max(0, Number(singleAdults) || 0);
  return sharedDoubleRooms + (privateRooms * 2);
}

function validateChildRoomingCapacity(sharedAdults, singleAdults, children) {
  const maxChildren = getMaxChildrenForRooming(sharedAdults, singleAdults);
  if (Number(children) <= maxChildren) {
    return { ok: true, max_children: maxChildren };
  }

  return {
    ok: false,
    max_children: maxChildren,
    error: `The chosen rooming capacity cannot accommodate the given number of children. Your current rooming allows up to ${maxChildren} child${maxChildren === 1 ? '' : 'ren'}: 1 per shared double room and 2 per private room. Please increase the room count or contact our staff for a family-room/manual quote.`,
  };
}

// Whitelist cá»™t cáº§n Ã©p kiá»ƒu sá»‘ trÆ°á»›c khi bind vÃ o D1.
// D1 strict-type: cá»™t REAL/INTEGER nháº­n string sáº½ throw SQLITE_MISMATCH (1031).
const NUMERIC_COLUMNS = {
  tenant_seasons:   {
    start_month: 'int', start_day: 'int',
    end_month:   'int', end_day:   'int',
    sort_order:  'int', is_active: 'int',
  },
  pricing_segments: { sort_order: 'int', is_active: 'int' },
  pax_bands:        { min_pax: 'int', max_pax: 'int', sort_order: 'int', is_active: 'int' },
  tour_prices:      {
    adult_shared_room_price:         'real',
    adult_single_room_price:         'real',
    child_shared_with_parents_price: 'real',
    infant_price:                    'real',
    is_active:                       'int',
  },
};

// Ã‰p kiá»ƒu in-place trÃªn safeData. Tráº£ null náº¿u giÃ¡ trá»‹ khÃ´ng parse Ä‘Æ°á»£c.
function coerceNumeric(table, safeData) {
  const cols = NUMERIC_COLUMNS[table] ?? {};
  for (const [col, type] of Object.entries(cols)) {
    if (col in safeData && safeData[col] !== null && safeData[col] !== undefined) {
      const n = Number(safeData[col]);
      safeData[col] = isNaN(n) ? null : (type === 'int' ? Math.trunc(n) : n);
    }
  }
}

// [SEC] Helper: log lá»—i DB Ä‘áº§y Ä‘á»§ phÃ­a server, tráº£ thÃ´ng bÃ¡o chung cho client.
// KHÃ”NG tráº£ err.message cho client vÃ¬ cÃ³ thá»ƒ lá»™ tÃªn báº£ng, cá»™t, constraint.
function dbError(err, context = '') {
  console.error(`[PRICING_ERROR]${context ? ' ' + context : ''}`, err);
  return Response.json({ error: 'Internal server error. Please try again later.' }, { status: 500 });
}

function schedulePricingUniversalSync(executionCtx, env, tenantId, tourIds) {
  if (!executionCtx || !Array.isArray(tourIds)) return;
  const uniqueTourIds = [...new Set(tourIds.filter(Boolean))];
  if (!uniqueTourIds.length) return;

  executionCtx.waitUntil(
    Promise.allSettled(uniqueTourIds.map((tourId) => syncUniversalTourPage(env, tenantId, tourId)))
  );
}

// â”€â”€ buildPriceResponse â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Maps a calculateTourPrice result â†’ itemized invoice response.
// Labels are resolved via translate() using the client's Accept-Language-
// derived lang code (tenantConfig.lang, default 'en').
// USD is always primary (source of truth); local currency is appended when
// the tenant has a non-USD display_currency configured.
function buildPriceResponse(result, tenantConfig) {
  const {
    exchange_rate    = 1,
    display_currency = 'USD',
    locale           = 'en-US',
    lang             = 'en',
  } = tenantConfig ?? {};

  const cfg = { exchange_rate, display_currency, locale };

  const { pax_breakdown, totals, prices, base_currency } = result;
  const {
    adult_shared_room_count = 0,
    adult_single_room_count = 0,
    adult_count             = 0,  // legacy compat
    child_count             = 0,
    infant_count            = 0,
  } = pax_breakdown ?? {};

  const sharedCount  = adult_shared_room_count > 0 ? adult_shared_room_count : adult_count;
  const privateCount = adult_single_room_count;

  const grandTotal = totals?.grand_total ?? (prices.adult_shared_room ?? 0);

  // Line items â€” only include types with qty > 0; labels from locale files
  const line_items = [];
  if (sharedCount > 0) {
    line_items.push({
      type:       'adult_shared_room',
      label:      translate('invoice.adult_shared_room', lang),
      qty:        sharedCount,
      unit_price: dualPrice(prices.adult_shared_room ?? 0, cfg),
      subtotal:   dualPrice(totals?.shared_room_subtotal ?? 0, cfg),
    });
  }
  if (privateCount > 0) {
    line_items.push({
      type:       'adult_private_room',
      label:      translate('invoice.adult_private_room', lang),
      qty:        privateCount,
      unit_price: dualPrice(prices.adult_single_room ?? 0, cfg),
      subtotal:   dualPrice(totals?.single_room_subtotal ?? 0, cfg),
    });
  }
  if (child_count > 0) {
    line_items.push({
      type:       'child',
      label:      translate('invoice.child', lang),
      qty:        child_count,
      unit_price: dualPrice(prices.child_shared_with_parents ?? 0, cfg),
      subtotal:   dualPrice(totals?.children_subtotal ?? 0, cfg),
    });
  }
  if (infant_count > 0) {
    line_items.push({
      type:       'infant',
      label:      translate('invoice.infant', lang),
      qty:        infant_count,
      unit_price: dualPrice(prices.infant ?? 0, cfg),
      subtotal:   dualPrice(totals?.infants_subtotal ?? 0, cfg),
    });
  }

  const invoice = {
    title:               translate('invoice.detail', lang),
    line_items,
    grand_total:         grandTotal,
    grand_total_display: dualPrice(grandTotal, cfg),
  };

  const unit_prices = {
    adult_shared_room: prices.adult_shared_room ?? 0,
    adult_single_room: prices.adult_single_room ?? 0,
    child_shared_with_parents: prices.child_shared_with_parents ?? 0,
    infant: prices.infant ?? 0,
  };

  const response = {
    ok:                  true,
    applied_season_name: result.applied_season_name,
    pricing_policy:      result.pricing_policy,
    candidate_seasons:   result.candidate_seasons,
    matched_on:          result.matched_on,
    pax_breakdown,
    invoice,
    // price_summary kept for backward compatibility
    price_summary: {
      original: { amount: grandTotal, currency: base_currency ?? 'USD' },
      display:  dualPrice(grandTotal, cfg),
    },
    unit_prices,
    prices:        enrichPricesObject(
      {
        adult_shared_room:         prices.adult_shared_room,
        adult_single_room:         prices.adult_single_room,
        child_shared_with_parents: prices.child_shared_with_parents,
        infant:                    prices.infant,
      },
      { exchange_rate, target_currency: display_currency }
    ),
    season_id:     result.season_id,
    segment_id:    result.segment_id,
    segment_code:  result.segment_code,
    pax_band_id:   result.pax_band_id,
    segment_name:  result.segment_name,
    pax_band_name: result.pax_band_name,
    pax_range:     result.pax_range,
    notes:         result.notes,
  };

  if (infant_count > 0 && result.infant_policy_text) {
    response.infant_disclaimer = result.infant_policy_text;
  }

  return response;
}

// 1. HÃ m Xá»­ lÃ½ POST
export async function handleCreatePricing(req, env, { group }, executionCtx) {
  const table = TABLE_MAP[group];
  if (!table) return Response.json({ error: `Invalid group: ${group}` }, { status: 400 });

  try {
    const data = await req.json();
    const missing = requiredFields[group]?.filter(f => data[f] === undefined);
    if (missing?.length > 0) {
      return Response.json({ error: `Missing required fields: ${missing.join(', ')}` }, { status: 400 });
    }

    if (group === 'tenant-seasons') {
      const dateErrors = validateSeasonDates(data);
      if (dateErrors.length > 0) {
        return Response.json({ error: 'Dá»¯ liá»‡u ngÃ y thÃ¡ng khÃ´ng há»£p lá»‡', details: dateErrors }, { status: 400 });
      }
    }

    // [SEC-FIX] tenant_id Ä‘áº¿n tá»« X-Tenant-ID header, khÃ´ng pháº£i body
    // TODO: thay báº±ng JWT/session khi auth middleware Ä‘Æ°á»£c triá»ƒn khai
    const tenantFromHeader = req.headers.get('X-Tenant-ID')?.trim();
    if (!tenantFromHeader) {
      return Response.json({ error: 'X-Tenant-ID header is required' }, { status: 400 });
    }

    const allowed = ALLOWED_INSERT_COLUMNS[table] ?? [];
    const safeData = Object.fromEntries(
      Object.entries(data).filter(([k]) => allowed.includes(k))
    );
    // Ghi Ä‘Ã¨ tenant_id báº±ng giÃ¡ trá»‹ tá»« header â€” khÃ´ng tin body
    safeData.tenant_id = tenantFromHeader;

    // Default cÃ¡c trÆ°á»ng giÃ¡ vá» 0 thay vÃ¬ null cho group tour-prices
    // TrÃ¡nh lá»—i tÃ­nh toÃ¡n phÃ­a sau khi cÃ¡c trÆ°á»ng nÃ y bá»‹ bá» qua trong request body
    if (group === 'tour-prices') {
      const PRICE_FIELDS = [
        'adult_shared_room_price',
        'adult_single_room_price',
        'child_shared_with_parents_price',
        'infant_price',
      ];
      for (const f of PRICE_FIELDS) {
        if (safeData[f] === undefined || safeData[f] === null) {
          safeData[f] = 0;
        }
      }
    }

    // Ã‰p kiá»ƒu REAL/INTEGER â€” trÃ¡nh SQLITE_MISMATCH (1031) khi client gá»­i string
    coerceNumeric(table, safeData);

    if (group === 'pax-bands') {
      const paxBandErrors = validatePaxBandRange(safeData);
      if (paxBandErrors.length > 0) {
        return Response.json({ error: 'Invalid pax band range', details: paxBandErrors }, { status: 400 });
      }
    }

    console.log('[CREATE_PRICING] Dá»¯ liá»‡u sau khi Ã©p kiá»ƒu:', safeData);

    const id = nanoid();
    const now = Math.floor(Date.now() / 1000);
    const columns = [...Object.keys(safeData), 'id', 'created_at'];
    const values  = [...Object.values(safeData), id, now];
    const placeholders = columns.map(() => '?').join(',');

    const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`;
    console.log('[CREATE_PRICING SQL]', sql);
    console.log('[CREATE_PRICING values]', values);

    await env.DB.prepare(sql).bind(...values).run();

    if (group === 'tour-prices') {
      schedulePricingUniversalSync(executionCtx, env, tenantFromHeader, [safeData.tour_id]);
    }

    return Response.json({ ok: true, id }, { status: 201 });
  } catch (err) {
    // [SEC] Never leak raw SQLite internals (table/column names, constraints) to client
    console.error('[CREATE_PRICING_ERROR]', err.message, err.cause);
    const msg = err.message ?? '';
    if (msg.includes('UNIQUE constraint failed')) {
      if (msg.includes('pricing_segments')) {
        return Response.json({ error: 'A segment with this code already exists for your account' }, { status: 409 });
      }
      if (msg.includes('tour_prices')) {
        return Response.json({ error: 'A price row already exists for this season / segment / pax band combination' }, { status: 409 });
      }
      return Response.json({ error: 'Duplicate entry — this record already exists' }, { status: 409 });
    }
    if (msg.includes('CHECK constraint failed')) {
      if (msg.includes('pax_bands') || msg.includes('min_pax')) {
        return Response.json({ error: 'Invalid pax band: min pax must be less than or equal to max pax' }, { status: 400 });
      }
      return Response.json({ error: 'Validation failed — check your input values' }, { status: 400 });
    }
    return Response.json({ error: 'Internal server error. Please try again later.' }, { status: 500 });
  }
}
// GET /api/pricing/metadata
// Tráº£ vá» pricing_segments + pax_bands cá»§a tenant trong 1 request.
// DÃ¹ng Ä‘á»ƒ populate dropdown khi táº¡o/sá»­a tour_prices trÃªn UI.
export async function handleGetPricingMetadata(req, env) {
  const tenantId = req.headers.get('X-Tenant-ID')?.trim();
  if (!tenantId) {
    return Response.json({ error: 'X-Tenant-ID header is required' }, { status: 400 });
  }

  try {
    const [segmentsResult, bandsResult] = await env.DB.batch([
      env.DB.prepare(
        'SELECT id, code, name, sort_order FROM pricing_segments WHERE tenant_id = ? AND is_active = 1 ORDER BY sort_order ASC'
      ).bind(tenantId),
      env.DB.prepare(
        'SELECT id, name, min_pax, max_pax, sort_order FROM pax_bands WHERE tenant_id = ? AND is_active = 1 ORDER BY sort_order ASC'
      ).bind(tenantId),
    ]);

    return Response.json({
      ok: true,
      segments: segmentsResult.results,
      pax_bands: bandsResult.results,
    });
  } catch (err) {
    return dbError(err, 'handleGetPricingMetadata');
  }
}

// 2. HÃ m Xá»­ lÃ½ GET (Chá»‰ giá»¯ láº¡i 1 Ä‘á»‹nh nghÄ©a duy nháº¥t)
export async function handleGetPricing(req, env, { group }) {
  const table = TABLE_MAP[group];
  if (!table) return Response.json({ error: `Invalid group: ${group}` }, { status: 400 });

  // [SEC-FIX] tenant_id Ä‘áº¿n tá»« X-Tenant-ID header â€” khÃ´ng tin query param
  // TODO: thay báº±ng JWT/session khi auth middleware Ä‘Æ°á»£c triá»ƒn khai
  const tenant_id = req.headers.get('X-Tenant-ID')?.trim();
  if (!tenant_id) {
    return Response.json({ error: 'X-Tenant-ID header is required' }, { status: 400 });
  }

  try {
    const { results } = await env.DB
      .prepare(`SELECT * FROM ${table} WHERE tenant_id = ? ORDER BY created_at DESC`)
      .bind(tenant_id)
      .all();

    // Enrich dual-currency display cho tour-prices
    if (group === 'tour-prices') {
      const tenant = await env.DB
        .prepare('SELECT exchange_rate, target_currency FROM tenants WHERE id = ?')
        .bind(tenant_id)
        .first();
      const tenantConfig = tenant ?? {};
      const PRICE_FIELDS = [
        'adult_shared_room_price',
        'adult_single_room_price',
        'child_shared_with_parents_price',
        'infant_price',
      ];
      const items = results.map(row => ({
        ...row,
        display: Object.fromEntries(
          PRICE_FIELDS.map(f => [f, enrichPrice(row[f], tenantConfig)])
        ),
      }));
      return Response.json({ ok: true, items });
    }

    return Response.json({ ok: true, items: results });
  } catch (err) {
    return dbError(err, `handleGetPricing:${group}`);
  }
}

// 3. Handlers cho Hono
// QUAN TRá»ŒNG: Route cá»¥ thá»ƒ /calculate pháº£i Ä‘á»©ng TRÆ¯á»šC route Ä‘á»™ng /:group
// Ä‘á»ƒ trÃ¡nh bá»‹ Hono match nháº§m 'calculate' vÃ o group handler
pricing.post('/calculate', async (c) => {
  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return c.json({ error: 'Content-Type pháº£i lÃ  application/json' }, 400);
  }

  // [SEC] tenant_id Ä‘áº¿n tá»« X-Tenant-ID header â€” khÃ´ng tin body
  const tenantFromHeader = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantFromHeader) {
    return c.json({ error: 'X-Tenant-ID header is required' }, 400);
  }

  let params;
  try {
    params = await c.req.json();
  } catch {
    return c.json({ error: 'Request body is not valid JSON.' }, 400);
  }

  if (!params.tour_id || !(params.travel_date ?? params.date)) {
    return c.json({ error: 'Thiáº¿u trÆ°á»ng báº¯t buá»™c: tour_id, travel_date' }, 400);
  }

  const tenantConfig   = c.get('tenantConfig') ?? {};
  const commonParams   = {
    tenant_id:               tenantFromHeader,
    tour_id:                 params.tour_id,
    date:                    params.travel_date ?? params.date,
    pax_count:               params.pax_count,
    adult_count:             params.adult_count,
    adult_shared_room_count: params.adult_shared_room_count ?? params.adult_shared_count,
    adult_single_room_count: params.adult_single_room_count ?? params.adult_private_count ?? 0,
    child_count:             params.child_count   ?? 0,
    infant_count:            params.infant_count  ?? 0,
    timezone:                tenantConfig.timezone           ?? 'Asia/Ho_Chi_Minh',
    pricing_policy:          tenantConfig.pricing_policy     ?? 'PRIORITY_HIGH_SEASON',
    infant_policy_text:      tenantConfig.infant_policy_text ?? null,
  };

  // Compare mode: no segment_id â†’ return all segments
  if (!params.segment_id) {
    const allResult = await calculateAllSegmentsPrice(c.env, commonParams);
    if (!allResult.ok) return c.json(allResult, 422);
    return c.json({
      ok:         true,
      mode:       'compare',
      segments:   allResult.segments.map(s => buildPriceResponse(s, tenantConfig)),
      matched_on: allResult.matched_on,
    });
  }

  const result = await calculateTourPrice(c.env, { ...commonParams, segment_id: params.segment_id });
  if (!result.ok) return c.json(result, 422);
  return c.json(buildPriceResponse(result, tenantConfig));
});

// GET /api/pricing/calculate?tour_id=&date=YYYY-MM-DD&adult_shared_room_count=&[segment_id=]
// segment_id optional â€” omit to get compare table for ALL segments
pricing.get('/calculate', async (c) => {
  // [SEC] tenant_id tá»« X-Tenant-ID header
  const tenantFromHeader = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantFromHeader) {
    return c.json({ error: 'X-Tenant-ID header is required.' }, 400);
  }

  const {
    tour_id, date, segment_id,
    pax_count, adult_count,
    adult_shared_room_count, adult_single_room_count,
    adult_shared_count, adult_private_count,
    child_count, infant_count,
  } = c.req.query();

  // tour_id + date required; at least 1 pax param must be present
  const missing = ['tour_id', 'date'].filter(p => !c.req.query(p));
  const noPax   = !pax_count && !adult_count && !adult_shared_room_count && !adult_shared_count;
  if (missing.length > 0 || noPax) {
    return c.json({
      error: `Missing required query params: ${[
        ...missing,
        ...(noPax ? ['adult_shared_room_count (or adult_count or pax_count)'] : []),
      ].join(', ')}.`,
    }, 400);
  }

  const tenantConfig  = c.get('tenantConfig') ?? {};
  const commonParams  = {
    tenant_id:               tenantFromHeader,
    tour_id,
    date,
    pax_count:               pax_count               ? Number(pax_count)               : undefined,
    adult_count:             adult_count              ? Number(adult_count)              : undefined,
    adult_shared_room_count: (adult_shared_room_count ?? adult_shared_count) ? Number(adult_shared_room_count ?? adult_shared_count) : undefined,
    adult_single_room_count: Number(adult_single_room_count ?? adult_private_count ?? 0),
    child_count:             Number(child_count       ?? 0),
    infant_count:            Number(infant_count      ?? 0),
    timezone:                tenantConfig.timezone           ?? 'Asia/Ho_Chi_Minh',
    pricing_policy:          tenantConfig.pricing_policy     ?? 'PRIORITY_HIGH_SEASON',
    infant_policy_text:      tenantConfig.infant_policy_text ?? null,
  };

  // Compare mode: no segment_id â†’ return all segments sorted cheapest-first
  if (!segment_id) {
    const allResult = await calculateAllSegmentsPrice(c.env, commonParams);
    if (!allResult.ok) return c.json(allResult, 422);
    return c.json({
      ok:         true,
      mode:       'compare',
      segments:   allResult.segments.map(s => buildPriceResponse(s, tenantConfig)),
      matched_on: allResult.matched_on,
    });
  }

  const result = await calculateTourPrice(c.env, { ...commonParams, segment_id });
  if (!result.ok) return c.json(result, 422);
  return c.json(buildPriceResponse(result, tenantConfig));
});

// Pháº£i Ä‘á»©ng TRÆ¯á»šC /:group â€” trÃ¡nh Hono match 'tenant-seasons' vÃ o group handler
pricing.post('/tenant-seasons/:sourceSeasonId/copy', async (c) => {
  const sourceSeasonId = c.req.param('sourceSeasonId');
  return handleCopySeason(c.req.raw, c.env, { sourceSeasonId });
});

// Pháº£i Ä‘á»©ng TRÆ¯á»šC /:group Ä‘á»ƒ khÃ´ng bá»‹ Hono match nháº§m
pricing.post('/duplicate-season', async (c) => {
  return handleDuplicateSeason(c.req.raw, c.env);
});

pricing.post('/:group', async (c) => {
  const group = c.req.param('group');
  return handleCreatePricing(c.req.raw, c.env, { group });
});

pricing.get('/metadata', async (c) => {
  return handleGetPricingMetadata(c.req.raw, c.env);
});

pricing.get('/:group', async (c) => {
  const group = c.req.param('group');
  return handleGetPricing(c.req.raw, c.env, { group });
});

// 4. Export default function cho index.js
export default function registerPricingRoutes(app) {
  if (app.route) {
    app.route('/api/pricing', pricing);
  }
}

pricing.delete('/:group/:itemId', async (c) => {
  const group = c.req.param('group');
  const itemId = c.req.param('itemId');
  return handleDeletePricing(c.req.raw, c.env, { group, itemId });
});

export async function handleUpdatePricing(req, env, { group, itemId }, executionCtx) {
  const table = TABLE_MAP[group];
  if (!table) return Response.json({ error: `Invalid group` }, { status: 400 });

  try {
    const data = await req.json();

    // [SEC-FIX] tenant_id Ä‘áº¿n tá»« X-Tenant-ID header â€” khÃ´ng tin body
    // TODO: thay báº±ng JWT/session khi auth middleware Ä‘Æ°á»£c triá»ƒn khai
    const tenant_id = req.headers.get('X-Tenant-ID')?.trim();
    if (!tenant_id) {
      return Response.json({ error: 'X-Tenant-ID header is required' }, { status: 400 });
    }

    const current = group === 'tour-prices'
      ? await env.DB.prepare('SELECT tour_id FROM tour_prices WHERE id = ? AND tenant_id = ?').bind(itemId, tenant_id).first()
      : group === 'pax-bands'
        ? await env.DB.prepare('SELECT min_pax, max_pax FROM pax_bands WHERE id = ? AND tenant_id = ?').bind(itemId, tenant_id).first()
        : null;

    if (group === 'tenant-seasons') {
      const dateErrors = validateSeasonDates(data);
      if (dateErrors.length > 0) {
        return Response.json({ error: 'Dá»¯ liá»‡u ngÃ y thÃ¡ng khÃ´ng há»£p lá»‡', details: dateErrors }, { status: 400 });
      }
    }

    // [SEC-FIX] Whitelist column names â€” loáº¡i bá» id, tenant_id, created_at (báº¥t biáº¿n)
    const allowed = ALLOWED_UPDATE_COLUMNS[table] ?? [];
    const safeData = Object.fromEntries(
      Object.entries(data).filter(([k]) => allowed.includes(k))
    );

    coerceNumeric(table, safeData);

    if (group === 'pax-bands') {
      if (!current) {
        return Response.json({ error: 'Item not found' }, { status: 404 });
      }
      const paxBandErrors = validatePaxBandRange({
        min_pax: safeData.min_pax ?? Number(current.min_pax),
        max_pax: safeData.max_pax ?? Number(current.max_pax),
      });
      if (paxBandErrors.length > 0) {
        return Response.json({ error: 'Invalid pax band range', details: paxBandErrors }, { status: 400 });
      }
    }

    if (Object.keys(safeData).length === 0) {
      return Response.json({ error: 'KhÃ´ng cÃ³ trÆ°á»ng há»£p lá»‡ Ä‘á»ƒ cáº­p nháº­t' }, { status: 400 });
    }

    const setClause = Object.keys(safeData).map(col => `${col} = ?`).join(', ');
    // [SEC-FIX] WHERE id = ? AND tenant_id = ? â€” ngÄƒn cáº­p nháº­t record cá»§a tenant khÃ¡c
    const values = [...Object.values(safeData), itemId, tenant_id];
    const result = await env.DB
      .prepare(`UPDATE ${table} SET ${setClause} WHERE id = ? AND tenant_id = ?`)
      .bind(...values)
      .run();

    if (result.meta.changes === 0) {
      return Response.json({ error: 'Item not found' }, { status: 404 });
    }

    if (group === 'tour-prices') {
      schedulePricingUniversalSync(executionCtx, env, tenant_id, [current?.tour_id, safeData.tour_id]);
    }

    return Response.json({ ok: true });
  } catch (err) {
    return dbError(err, `handleUpdatePricing:${group}`);
  }
}

// ThÃªm route vÃ o Ä‘á»‘i tÆ°á»£ng pricing (Hono) phÃ­a cuá»‘i file
pricing.patch('/:group/:itemId', async (c) => {
  const { group, itemId } = c.req.param();
  return handleUpdatePricing(c.req.raw, c.env, { group, itemId });
});

export async function handleDeletePricing(req, env, { group, itemId }, executionCtx) {
  const table = TABLE_MAP[group];
  if (!table) return Response.json({ error: `Invalid group` }, { status: 400 });

  // [SEC] tenant_id from header only
  const tenant_id = req.headers.get('X-Tenant-ID')?.trim();
  if (!tenant_id) {
    return Response.json({ error: 'X-Tenant-ID header is required' }, { status: 400 });
  }

  // D1 enforces FOREIGN KEY constraints. tour_prices references tenant_seasons,
  // pax_bands, and pricing_segments - cascade-delete child rows first, then
  // the parent, all in one atomic batch.
  const CHILD_FK_COLUMN = {
    'tenant-seasons':   'season_id',
    'pax-bands':        'pax_band_id',
    'pricing-segments': 'segment_id',
  };

  try {
    const current = group === 'tour-prices'
      ? await env.DB.prepare('SELECT tour_id FROM tour_prices WHERE id = ? AND tenant_id = ?').bind(itemId, tenant_id).first()
      : null;

    const fkCol = CHILD_FK_COLUMN[group];
    if (fkCol) {
      // Batch: [0] wipe dependent tour_prices, [1] delete parent - atomic
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM tour_prices WHERE ${fkCol} = ? AND tenant_id = ?`).bind(itemId, tenant_id),
        env.DB.prepare(`DELETE FROM ${table}     WHERE id = ?        AND tenant_id = ?`).bind(itemId, tenant_id),
      ]);
    } else {
      // tour-prices: direct delete, no FK children
      await env.DB
        .prepare(`DELETE FROM ${table} WHERE id = ? AND tenant_id = ?`)
        .bind(itemId, tenant_id)
        .run();
    }

    if (group === 'tour-prices') {
      schedulePricingUniversalSync(executionCtx, env, tenant_id, [current?.tour_id]);
    }

    return Response.json({ ok: true });
  } catch (err) {
    return dbError(err, `handleDeletePricing:${group}`);
  }
}

// =============================================================================
// handleCopySeason â€” Táº¡o báº£n sao cá»§a má»™t season (cÃ¹ng cáº¥u trÃºc, tÃªn má»›i)
// =============================================================================

/**
 * Sao chÃ©p má»™t tenant_season cÃ¹ng toÃ n bá»™ tour_prices sang season má»›i.
 * Season má»›i káº¿ thá»«a Ä‘áº§y Ä‘á»§ start_month/day, end_month/day, sort_order, notes
 * cá»§a season gá»‘c; chá»‰ thay name báº±ng new_name tá»« request body.
 *
 * Route: POST /api/pricing/tenant-seasons/:sourceSeasonId/copy
 * Body:  { new_name: string }
 *
 * @param {Request} req
 * @param {object}  env
 * @param {{ sourceSeasonId: string }} params
 */
export async function handleCopySeason(req, env, { sourceSeasonId }) {
  // [SEC] tenant_id tá»« X-Tenant-ID header â€” khÃ´ng tin body
  const tenantId = req.headers.get('X-Tenant-ID')?.trim();
  if (!tenantId) {
    return Response.json({ error: 'X-Tenant-ID header is required' }, { status: 400 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Request body khÃ´ng pháº£i JSON há»£p lá»‡' }, { status: 400 });
  }

  const new_name = body?.new_name?.toString().trim();
  if (!new_name) {
    return Response.json({ error: 'new_name lÃ  báº¯t buá»™c' }, { status: 400 });
  }

  try {
    // --- BÆ°á»›c A: Láº¥y season gá»‘c â€” liá»‡t kÃª tÆ°á»ng minh, scoped theo tenant_id ---
    const source = await env.DB
      .prepare(`SELECT id, tenant_id, name, start_month, start_day, end_month, end_day,
                       sort_order, is_active, notes
                FROM tenant_seasons
                WHERE id = ? AND tenant_id = ?`)
      .bind(sourceSeasonId, tenantId)
      .first();
    if (!source) {
      return Response.json(
        { error: 'Season khÃ´ng tá»“n táº¡i hoáº·c khÃ´ng thuá»™c tenant nÃ y' },
        { status: 404 }
      );
    }

    // --- BÆ°á»›c 1: SELECT toÃ n bá»™ price rows â€” liá»‡t kÃª tÆ°á»ng minh, KHÃ”NG dÃ¹ng SELECT * ---
    const { results: sourcePrices } = await env.DB
      .prepare(`SELECT tenant_id, tour_id, segment_id, pax_band_id, base_currency,
                       adult_shared_room_price, adult_single_room_price,
                       child_shared_with_parents_price, notes, is_active
                FROM tour_prices
                WHERE season_id = ? AND tenant_id = ?`)
      .bind(sourceSeasonId, tenantId)
      .all();

    const newSeasonId = nanoid();
    const now = Math.floor(Date.now() / 1000);

    // --- stmtSeason: INSERT season má»›i â€” káº¿ thá»«a cáº¥u trÃºc, chá»‰ Ä‘á»•i id, name, created_at ---
    const stmtSeason = env.DB
      .prepare(`INSERT INTO tenant_seasons
                  (id, tenant_id, name, start_month, start_day, end_month, end_day,
                   sort_order, is_active, notes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        newSeasonId,
        tenantId,
        new_name,
        source.start_month,
        source.start_day,
        source.end_month,
        source.end_day,
        source.sort_order  ?? 0,
        source.is_active   ?? 1,
        source.notes       ?? null,
        now
      );

    // --- BÆ°á»›c 2: map() táº¡o stmtPrices â€” má»—i row nháº­n nanoid() má»›i tá»« JS ---
    // ?? null trÃªn tá»«ng giÃ¡ trá»‹ Ä‘áº£m báº£o D1 nháº­n NULL thay vÃ¬ undefined (trÃ¡nh bind error)
    console.log('Sá»‘ lÆ°á»£ng giÃ¡ sáº½ copy:', sourcePrices.length);

    const stmtPrices = sourcePrices.map(p => env.DB
      .prepare(`INSERT INTO tour_prices
                  (id, tenant_id, tour_id, season_id, segment_id, pax_band_id,
                   base_currency, adult_shared_room_price, adult_single_room_price,
                   child_shared_with_parents_price, notes, is_active, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        nanoid(),
        tenantId,
        p.tour_id                         ?? null,
        newSeasonId,
        p.segment_id                      ?? null,
        p.pax_band_id                     ?? null,
        p.base_currency                   ?? 'USD',
        p.adult_shared_room_price         ?? null,
        p.adult_single_room_price         ?? null,
        p.child_shared_with_parents_price ?? null,
        p.notes                           ?? null,
        p.is_active                       ?? 1,
        now
      )
    );

    // --- BÆ°á»›c 3: náº¿u khÃ´ng cÃ³ giÃ¡, chá»‰ cháº¡y stmtSeason Ä‘Æ¡n láº» ---
    // env.DB.batch([]) vá»›i máº£ng rá»—ng gÃ¢y lá»—i 1031 trÃªn D1 local
    if (stmtPrices.length === 0) {
      await stmtSeason.run();
    } else {
      await env.DB.batch([stmtSeason, ...stmtPrices]);
    }

    return Response.json({
      ok:               true,
      new_season_id:    newSeasonId,
      source_season_id: sourceSeasonId,
      copied_prices:    stmtPrices.length,
    }, { status: 201 });

  } catch (err) {
    console.error('[COPY_SEASON_ERROR]', {
      message:        err.message,
      cause:          err.cause,
      sourceSeasonId,
      tenantId,
    });
    return Response.json({
      error: 'Internal server error while copying season.',
    }, { status: 500 });
  }
}

// =============================================================================
// handleDuplicateSeason â€” Clone má»™t season vÃ  toÃ n bá»™ tour_prices cá»§a nÃ³
// =============================================================================

/**
 * Táº¡o season má»›i tá»« newSeasonData, sau Ä‘Ã³ sao chÃ©p táº¥t cáº£ tour_prices
 * cá»§a sourceSeasonId sang season má»›i â€” toÃ n bá»™ trong má»™t D1 batch (transaction).
 *
 * Body JSON: { sourceSeasonId: string, newSeasonData: { tenant_id, name,
 *   start_month, start_day, end_month, end_day, [sort_order], [notes] } }
 *
 * D1 batch Ä‘áº£m báº£o tÃ­nh nguyÃªn tá»­: náº¿u báº¥t ká»³ INSERT nÃ o tháº¥t báº¡i,
 * toÃ n bá»™ batch bá»‹ rollback â€” khÃ´ng Ä‘á»ƒ láº¡i dá»¯ liá»‡u rÃ¡c.
 *
 * @param {Request} req
 * @param {object}  env - Cloudflare Workers env (env.DB = D1)
 * @returns {Promise<Response>}
 */
export async function handleDuplicateSeason(req, env) {
  // --- Parse body ---
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Request body khÃ´ng pháº£i JSON há»£p lá»‡' }, { status: 400 });
  }

  const { sourceSeasonId, newSeasonData } = body ?? {};

  // --- Validate Ä‘áº§u vÃ o ---
  if (!sourceSeasonId || typeof sourceSeasonId !== 'string') {
    return Response.json({ error: 'sourceSeasonId lÃ  báº¯t buá»™c vÃ  pháº£i lÃ  string' }, { status: 400 });
  }
  if (!newSeasonData || typeof newSeasonData !== 'object') {
    return Response.json({ error: 'newSeasonData lÃ  báº¯t buá»™c vÃ  pháº£i lÃ  object' }, { status: 400 });
  }

  // [SEC-FIX] tenant_id Ä‘áº¿n tá»« X-Tenant-ID header
  // TODO: thay báº±ng JWT/session khi auth middleware Ä‘Æ°á»£c triá»ƒn khai
  const headerTenantId = req.headers.get('X-Tenant-ID')?.trim();
  if (!headerTenantId) {
    return Response.json({ error: 'X-Tenant-ID header is required' }, { status: 400 });
  }
  if (newSeasonData.tenant_id && newSeasonData.tenant_id !== headerTenantId) {
    return Response.json({ error: 'tenant_id trong body khÃ´ng khá»›p vá»›i X-Tenant-ID header' }, { status: 400 });
  }
  // Ghi Ä‘Ã¨ tenant_id trong payload báº±ng giÃ¡ trá»‹ tá»« header
  newSeasonData.tenant_id = headerTenantId;

  const requiredSeasonFields = ['name', 'start_month', 'start_day', 'end_month', 'end_day'];
  const missing = requiredSeasonFields.filter(f => newSeasonData[f] == null);
  if (missing.length > 0) {
    return Response.json({ error: `newSeasonData thiáº¿u trÆ°á»ng báº¯t buá»™c: ${missing.join(', ')}` }, { status: 400 });
  }

  try {
    // --- BÆ°á»›c 1: Láº¥y táº¥t cáº£ tour_prices cá»§a sourceSeasonId ---
    // Thá»±c hiá»‡n TRÆ¯á»šC batch Ä‘á»ƒ dÃ¹ng káº¿t quáº£ build INSERT statements
    const tenantId = headerTenantId;
    const { results: sourcePrices } = await env.DB
      .prepare('SELECT * FROM tour_prices WHERE season_id = ? AND tenant_id = ? AND is_active = 1')
      .bind(sourceSeasonId, tenantId)
      .all();

    // --- BÆ°á»›c 2: Chuáº©n bá»‹ INSERT season má»›i ---
    const newSeasonId = nanoid();
    const now = Math.floor(Date.now() / 1000);

    const allowedSeasonFields = ['tenant_id', 'name', 'start_month', 'start_day', 'end_month', 'end_day', 'sort_order', 'notes', 'is_active'];
    // Chá»‰ láº¥y cÃ¡c cá»™t Ä‘Æ°á»£c phÃ©p â€” trÃ¡nh SQL injection qua tÃªn cá»™t
    const filteredSeason = Object.fromEntries(
      Object.entries(newSeasonData).filter(([k]) => allowedSeasonFields.includes(k))
    );
    const seasonCols = [...Object.keys(filteredSeason), 'id', 'created_at'];
    const seasonVals = [...Object.values(filteredSeason), newSeasonId, now];
    const seasonPlaceholders = seasonCols.map(() => '?').join(', ');

    const insertSeasonStmt = env.DB
      .prepare(`INSERT INTO tenant_seasons (${seasonCols.join(', ')}) VALUES (${seasonPlaceholders})`)
      .bind(...seasonVals);

    // --- BÆ°á»›c 3: Chuáº©n bá»‹ INSERT tá»«ng price row vá»›i season_id má»›i ---
    const insertPriceStmts = sourcePrices.map(price => {
      const newPriceId = nanoid();
      return env.DB
        .prepare(`INSERT INTO tour_prices (
          id, tenant_id, tour_id, season_id, segment_id, pax_band_id,
          base_currency, adult_shared_room_price, adult_single_room_price,
          child_shared_with_parents_price, notes, is_active, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          newPriceId,
          price.tenant_id,
          price.tour_id,
          newSeasonId,                           // â† season má»›i
          price.segment_id,
          price.pax_band_id,
          price.base_currency ?? 'USD',
          price.adult_shared_room_price,
          price.adult_single_room_price,
          price.child_shared_with_parents_price,
          price.notes,
          1,
          now
        );
    });

    // --- BÆ°á»›c 4: Cháº¡y toÃ n bá»™ trong D1 batch (atomic transaction) ---
    // Náº¿u báº¥t ká»³ statement nÃ o tháº¥t báº¡i, D1 rollback toÃ n bá»™
    await env.DB.batch([insertSeasonStmt, ...insertPriceStmts]);

    return Response.json({
      ok: true,
      new_season_id:     newSeasonId,
      source_season_id:  sourceSeasonId,
      duplicated_prices: insertPriceStmts.length,
    }, { status: 201 });

  } catch (err) {
    return dbError(err, 'handleDuplicateSeason');
  }
}

// =============================================================================
// calculateTourPrice â€” Pricing Engine vá»›i xá»­ lÃ½ giao mÃ¹a + Infant support
// =============================================================================

/**
 * TÃ­nh giÃ¡ tour cho má»™t booking request cá»¥ thá»ƒ.
 *
 * Pax model:
 *  - adult_count  : ngÆ°á»i lá»›n (báº¯t buá»™c >= 1)
 *  - child_count  : tráº» em (máº·c Ä‘á»‹nh 0)
 *  - infant_count : tráº» sÆ¡ sinh 0-2 tuá»•i (máº·c Ä‘á»‹nh 0, khÃ´ng tÃ­nh gháº¿)
 *  - pax_count    : legacy alias cá»§a adult_count (backward compat)
 *
 * Pax Band matching dÃ¹ng adult_count + child_count (infants khÃ´ng tÃ­nh gháº¿).
 *
 * Total = (adults Ã— adult_shared_room_price)
 *       + (children Ã— child_shared_with_parents_price)
 *       + (infants  Ã— infant_price)
 *
 * @param {object} env
 * @param {{ tenant_id, tour_id, date, pax_count?, adult_count?, child_count?,
 *           infant_count?, segment_id, timezone?, pricing_policy?, infant_policy_text? }} params
 * @returns {Promise<object>}
 */
export async function calculateTourPrice(env, {
  tenant_id,
  tour_id,
  date,
  pax_count,                           // legacy â€” backward compat
  adult_count,                         // legacy â€” all adults in shared rooms
  adult_shared_room_count,             // adults in shared occupancy
  adult_single_room_count = 0,         // adults in single occupancy (pays single supplement)
  child_count             = 0,
  infant_count            = 0,
  segment_id,
  timezone                = 'Asia/Ho_Chi_Minh',
  pricing_policy          = 'PRIORITY_HIGH_SEASON',
  infant_policy_text      = null,
}) {
  // --- Validate required ---
  if (!tenant_id || !tour_id || !date || !segment_id) {
    return { ok: false, error: 'Missing required fields: tenant_id, tour_id, date, segment_id.' };
  }

  // Rooming model (cascade: explicit rooming â†’ adult_count â†’ pax_count)
  const sharedAdults = adult_shared_room_count != null
    ? Number(adult_shared_room_count)
    : (adult_count != null ? Number(adult_count) : Number(pax_count ?? 1));
  const singleAdults = Number(adult_single_room_count ?? 0);
  const totalAdults  = sharedAdults + singleAdults;
  const children     = Number(child_count  ?? 0);
  const infants      = Number(infant_count ?? 0);

  if (!Number.isInteger(sharedAdults) || sharedAdults < 0) return { ok: false, error: 'adult_shared_room_count must be a non-negative integer.' };
  if (!Number.isInteger(singleAdults) || singleAdults < 0) return { ok: false, error: 'adult_single_room_count must be a non-negative integer.' };
  if (totalAdults < 1) return { ok: false, error: 'At least 1 adult is required.' };
  if (!Number.isInteger(children) || children < 0) return { ok: false, error: 'child_count must be a non-negative integer.' };
  if (!Number.isInteger(infants)  || infants  < 0) return { ok: false, error: 'infant_count must be a non-negative integer.' };

  const childRoomingValidation = validateChildRoomingCapacity(sharedAdults, singleAdults, children);
  if (!childRoomingValidation.ok) {
    return { ok: false, error: childRoomingValidation.error, max_children: childRoomingValidation.max_children };
  }

  // effectivePax: dÃ¹ng Ä‘á»ƒ khá»›p pax_band â€” infants khÃ´ng chiáº¿m gháº¿
  const effectivePax = totalAdults + children;

  // Chuyá»ƒn date â†’ { month, day } theo mÃºi giá» Tenant
  let monthDay;
  try {
    const { month, day } = toUserDate(date, timezone);
    monthDay = month * 100 + day; // VD: 325
  } catch {
    return { ok: false, error: `Invalid date format â€” expected YYYY-MM-DD (received: "${date}").` };
  }

  // --- Truy váº¥n JOIN â€” láº¥y Táº¤T Cáº¢ Season há»£p lá»‡ Ä‘á»ƒ xá»­ lÃ½ giao mÃ¹a ---
  const sql = `
    SELECT
      tp.id                             AS price_id,
      tp.season_id,
      tp.segment_id,
      tp.pax_band_id,
      tp.base_currency,
      tp.adult_shared_room_price,
      tp.adult_single_room_price,
      tp.child_shared_with_parents_price,
      tp.infant_price,
      tp.notes                          AS price_notes,
      ts.name                           AS season_name,
      ts.start_month,
      ts.start_day,
      ts.end_month,
      ts.end_day,
      ps.code                           AS segment_code,
      ps.name                           AS segment_name,
      pb.name                           AS pax_band_name,
      pb.min_pax,
      pb.max_pax
    FROM tour_prices tp

    JOIN tenant_seasons ts
      ON  tp.season_id  = ts.id
      AND tp.tenant_id  = ts.tenant_id
      AND ts.is_active  = 1
      AND (
        (
          ts.start_month * 100 + ts.start_day <= ?
          AND ? <= ts.end_month * 100 + ts.end_day
        )
        OR
        (
          ts.start_month * 100 + ts.start_day > ts.end_month * 100 + ts.end_day
          AND (
            ? >= ts.start_month * 100 + ts.start_day
            OR  ? <= ts.end_month * 100 + ts.end_day
          )
        )
      )

    JOIN pricing_segments ps
      ON  tp.segment_id = ps.id
      AND tp.tenant_id  = ps.tenant_id
      AND ps.is_active  = 1

    JOIN pax_bands pb
      ON  tp.pax_band_id = pb.id
      AND tp.tenant_id   = pb.tenant_id
      AND pb.is_active   = 1
      AND pb.min_pax    <= ?
      AND pb.max_pax    >= ?

    WHERE tp.tenant_id  = ?
      AND tp.tour_id    = ?
      AND tp.segment_id = ?
      AND tp.is_active  = 1
  `;

  try {
    const { results } = await env.DB.prepare(sql)
      .bind(monthDay, monthDay, monthDay, monthDay, effectivePax, effectivePax, tenant_id, tour_id, segment_id)
      .all();

    if (!results || results.length === 0) {
      return {
        ok:    false,
        error: "We couldn't find a matching season for your travel date. Please contact our support.",
        debug: [
          'Check (1): Does tenant_seasons have a season covering this date?',
          'Check (2): Does pax_bands have a range covering adult_count + child_count?',
          'Check (3): Does tour_prices have a record for this segment_id?',
          'Check (4): Are all related records active (is_active = 1)?',
        ],
        params_used: { tenant_id, tour_id, date, month_day: monthDay, adults: totalAdults, children, infants, segment_id },
      };
    }

    // --- Xá»­ lÃ½ giao mÃ¹a: chá»n báº£n ghi tá»‘t nháº¥t theo pricing_policy ---
    const row = pricing_policy === 'PRIORITY_HIGH_SEASON'
      ? results.reduce((best, r) =>
          (r.adult_shared_room_price ?? 0) > (best.adult_shared_room_price ?? 0) ? r : best
        , results[0])
      : results[0];

    // --- TÃ­nh sub-totals theo Rooming Model ---
    const sharedSubtotal   = sharedAdults * (row.adult_shared_room_price         ?? 0);
    const singleSubtotal   = singleAdults * (row.adult_single_room_price         ?? 0);
    const childrenSubtotal = children     * (row.child_shared_with_parents_price ?? 0);
    const infantsSubtotal  = infants      * (row.infant_price                    ?? 0);
    const grandTotal       = sharedSubtotal + singleSubtotal + childrenSubtotal + infantsSubtotal;

    return {
      ok:                  true,
      price_id:            row.price_id,
      season_id:           row.season_id,
      segment_id:          row.segment_id,
      segment_code:        row.segment_code,
      pax_band_id:         row.pax_band_id,
      applied_season_name: row.season_name,
      pricing_policy,
      candidate_seasons:   results.length,
      segment_name:        row.segment_name,
      pax_band_name:       row.pax_band_name,
      pax_range:           { min: row.min_pax, max: row.max_pax },
      base_currency:       row.base_currency,
      pax_breakdown: {
        adult_shared_room_count: sharedAdults,
        adult_single_room_count: singleAdults,
        child_count:             children,
        infant_count:            infants,
      },
      totals: {
        shared_room_subtotal:  sharedSubtotal,
        single_room_subtotal:  singleSubtotal,
        children_subtotal:     childrenSubtotal,
        infants_subtotal:      infantsSubtotal,
        grand_total:           grandTotal,
      },
      prices: {
        adult_shared_room:         row.adult_shared_room_price,
        adult_single_room:         row.adult_single_room_price,
        child_shared_with_parents: row.child_shared_with_parents_price,
        infant:                    row.infant_price ?? 0,
      },
      infant_policy_text,
      notes:      row.price_notes,
      matched_on: {
        date, month_day: monthDay,
        adult_shared_room_count: sharedAdults,
        adult_single_room_count: singleAdults,
        child_count:             children,
        infant_count:            infants,
        timezone,
      },
    };
  } catch (err) {
    console.error('[PRICING_ERROR] calculateTourPrice', err);
    return { ok: false, error: 'Internal server error. Please try again later.' };
  }
}

// =============================================================================
// calculateAllSegmentsPrice â€” Compare-mode: táº¥t cáº£ segments trong 1 query
// =============================================================================

/**
 * Truy váº¥n giÃ¡ cho Táº¤T Cáº¢ pricing_segments Ä‘ang active cá»§a tour â€” dÃ¹ng khi
 * khÃ¡ch muá»‘n so sÃ¡nh Standard/Boutique/Premium trÆ°á»›c khi chá»n.
 *
 * SQL: giá»‘ng calculateTourPrice nhÆ°ng KHÃ”NG cÃ³ `AND tp.segment_id = ?`.
 * JS:  group by segment_id, Ã¡p pricing_policy per group, sort cheapest-first.
 *
 * @returns {{ ok: true, segments: object[], matched_on: object } | { ok: false, error }}
 */
export async function calculateAllSegmentsPrice(env, {
  tenant_id,
  tour_id,
  date,
  pax_count,
  adult_count,
  adult_shared_room_count,
  adult_single_room_count = 0,
  child_count             = 0,
  infant_count            = 0,
  timezone                = 'Asia/Ho_Chi_Minh',
  pricing_policy          = 'PRIORITY_HIGH_SEASON',
  infant_policy_text      = null,
}) {
  if (!tenant_id || !tour_id || !date) {
    return { ok: false, error: 'Missing required fields: tenant_id, tour_id, date.' };
  }

  // Same rooming resolution as calculateTourPrice
  const sharedAdults = adult_shared_room_count != null
    ? Number(adult_shared_room_count)
    : (adult_count != null ? Number(adult_count) : Number(pax_count ?? 1));
  const singleAdults = Number(adult_single_room_count ?? 0);
  const totalAdults  = sharedAdults + singleAdults;
  const children     = Number(child_count  ?? 0);
  const infants      = Number(infant_count ?? 0);

  if (totalAdults < 1) return { ok: false, error: 'At least 1 adult is required.' };
  const childRoomingValidation = validateChildRoomingCapacity(sharedAdults, singleAdults, children);
  if (!childRoomingValidation.ok) {
    return { ok: false, error: childRoomingValidation.error, max_children: childRoomingValidation.max_children };
  }
  const effectivePax = totalAdults + children;

  let monthDay;
  try {
    const { month, day } = toUserDate(date, timezone);
    monthDay = month * 100 + day;
  } catch {
    return { ok: false, error: `Invalid date format â€” expected YYYY-MM-DD.` };
  }

  // Same JOIN as calculateTourPrice â€” WITHOUT the segment_id filter in WHERE
  const sql = `
    SELECT
      tp.id                             AS price_id,
      tp.season_id,
      tp.segment_id,
      tp.pax_band_id,
      tp.base_currency,
      tp.adult_shared_room_price,
      tp.adult_single_room_price,
      tp.child_shared_with_parents_price,
      tp.infant_price,
      tp.notes                          AS price_notes,
      ts.name                           AS season_name,
      ps.code                           AS segment_code,
      ps.name                           AS segment_name,
      pb.name                           AS pax_band_name,
      pb.min_pax,
      pb.max_pax
    FROM tour_prices tp

    JOIN tenant_seasons ts
      ON  tp.season_id  = ts.id
      AND tp.tenant_id  = ts.tenant_id
      AND ts.is_active  = 1
      AND (
        (
          ts.start_month * 100 + ts.start_day <= ?
          AND ? <= ts.end_month * 100 + ts.end_day
        )
        OR
        (
          ts.start_month * 100 + ts.start_day > ts.end_month * 100 + ts.end_day
          AND (
            ? >= ts.start_month * 100 + ts.start_day
            OR  ? <= ts.end_month * 100 + ts.end_day
          )
        )
      )

    JOIN pricing_segments ps
      ON  tp.segment_id = ps.id
      AND tp.tenant_id  = ps.tenant_id
      AND ps.is_active  = 1

    JOIN pax_bands pb
      ON  tp.pax_band_id = pb.id
      AND tp.tenant_id   = pb.tenant_id
      AND pb.is_active   = 1
      AND pb.min_pax    <= ?
      AND pb.max_pax    >= ?

    WHERE tp.tenant_id  = ?
      AND tp.tour_id    = ?
      AND tp.is_active  = 1
  `;

  try {
    const { results } = await env.DB.prepare(sql)
      .bind(monthDay, monthDay, monthDay, monthDay, effectivePax, effectivePax, tenant_id, tour_id)
      .all();

    if (!results || results.length === 0) {
      return {
        ok:    false,
        error: "We couldn't find a matching season for your travel date. Please contact our support.",
        hint:  `No active season covers ${date} for this tour and segment configuration.`,
      };
    }

    // Group by segment_id, apply pricing_policy to pick best row per group
    const bySegment = new Map();
    for (const row of results) {
      const rows = bySegment.get(row.segment_id) ?? [];
      rows.push(row);
      bySegment.set(row.segment_id, rows);
    }

    const segments = [];
    for (const [, rows] of bySegment) {
      const row = pricing_policy === 'PRIORITY_HIGH_SEASON'
        ? rows.reduce((best, r) =>
            (r.adult_shared_room_price ?? 0) > (best.adult_shared_room_price ?? 0) ? r : best
          , rows[0])
        : rows[0];

      const sharedSubtotal   = sharedAdults * (row.adult_shared_room_price         ?? 0);
      const singleSubtotal   = singleAdults * (row.adult_single_room_price         ?? 0);
      const childrenSubtotal = children     * (row.child_shared_with_parents_price ?? 0);
      const infantsSubtotal  = infants      * (row.infant_price                    ?? 0);
      const grandTotal       = sharedSubtotal + singleSubtotal + childrenSubtotal + infantsSubtotal;

      segments.push({
        ok:                  true,
        price_id:            row.price_id,
        season_id:           row.season_id,
        segment_id:          row.segment_id,
        segment_code:        row.segment_code,
        pax_band_id:         row.pax_band_id,
        applied_season_name: row.season_name,
        pricing_policy,
        candidate_seasons:   rows.length,
        segment_name:        row.segment_name,
        pax_band_name:       row.pax_band_name,
        pax_range:           { min: row.min_pax, max: row.max_pax },
        base_currency:       row.base_currency,
        pax_breakdown: {
          adult_shared_room_count: sharedAdults,
          adult_single_room_count: singleAdults,
          child_count:             children,
          infant_count:            infants,
        },
        totals: {
          shared_room_subtotal:  sharedSubtotal,
          single_room_subtotal:  singleSubtotal,
          children_subtotal:     childrenSubtotal,
          infants_subtotal:      infantsSubtotal,
          grand_total:           grandTotal,
        },
        prices: {
          adult_shared_room:         row.adult_shared_room_price,
          adult_single_room:         row.adult_single_room_price,
          child_shared_with_parents: row.child_shared_with_parents_price,
          infant:                    row.infant_price ?? 0,
        },
        infant_policy_text,
        notes:      row.price_notes,
        matched_on: {
          date, month_day: monthDay,
          adult_shared_room_count: sharedAdults,
          adult_single_room_count: singleAdults,
          child_count: children, infant_count: infants, timezone,
        },
      });
    }

    // Sort cheapest-first for compare view
    segments.sort((a, b) => (a.totals.grand_total ?? 0) - (b.totals.grand_total ?? 0));

    return {
      ok:         true,
      segments,
      matched_on: {
        date, month_day: monthDay,
        adult_shared_room_count: sharedAdults,
        adult_single_room_count: singleAdults,
        child_count: children, infant_count: infants, timezone,
      },
    };
  } catch (err) {
    console.error('[PRICING_ERROR] calculateAllSegmentsPrice', err);
    return { ok: false, error: 'Internal server error. Please try again later.' };
  }
}

