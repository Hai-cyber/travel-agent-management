import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import QRCode from 'qrcode';
import { enrichPrice, enrichPricesObject, formatMoney, toUserDate, translate, dualPrice } from '../utils/formatter.js';
import { syncUniversalTourPage } from '../lib/universalSiteSync.js';

const pricing = new Hono();

const GIFT_CARD_STATUSES = new Set(['active', 'redeemed', 'cancelled']);
const DISCOUNT_COUPON_STATUSES = new Set(['active', 'paused']);
const DISCOUNT_COUPON_TYPES = new Set(['amount', 'percent']);
const SAFE_DISCOUNT_COUPON_CODE_RE = /^[A-Z0-9_-]{4,32}$/;

function generateGiftCardIdCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'GC-';
  for (let index = 0; index < 8; index += 1) {
    if (index === 4) code += '-';
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function generateUniqueGiftCardIdCode(env, tenantId) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const idCode = generateGiftCardIdCode();
    const existing = await env.DB
      .prepare('SELECT id FROM tour_gift_cards WHERE tenant_id = ? AND id_code = ?')
      .bind(tenantId, idCode)
      .first();
    if (!existing) return idCode;
  }
  throw new Error('Could not generate a unique gift card ID code');
}

function generateDiscountCouponCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'OFF-';
  for (let index = 0; index < 8; index += 1) {
    if (index === 4) code += '-';
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function generateUniqueDiscountCouponCode(env, tenantId) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateDiscountCouponCode();
    const existing = await env.DB
      .prepare('SELECT id FROM tenant_discount_coupons WHERE tenant_id = ? AND code = ?')
      .bind(tenantId, code)
      .first();
    if (!existing) return code;
  }
  throw new Error('Could not generate a unique discount coupon code');
}

function sanitizeGiftCardCode(value) {
  return String(value || '').trim().toUpperCase();
}

function sanitizeDiscountCouponCode(value) {
  return String(value || '').toUpperCase().replace(/\s+/g, '').trim();
}

function getGiftCardStatus(row) {
  if (!row) return 'cancelled';
  if (row.status === 'cancelled') return 'cancelled';
  return Number(row.remaining_value ?? 0) > 0 ? 'active' : 'redeemed';
}

function getDiscountCouponAvailability(row, now = Math.floor(Date.now() / 1000)) {
  if (!row) return 'paused';
  if (row.status !== 'active') return 'paused';
  if (row.starts_at && Number(row.starts_at) > now) return 'scheduled';
  if (row.expires_at && Number(row.expires_at) < now) return 'expired';
  if (row.max_uses !== null && row.max_uses !== undefined && Number(row.uses_count ?? 0) >= Number(row.max_uses)) return 'exhausted';
  return 'active';
}

function buildGiftCardQrPayload(card) {
  return [
    'TOURS MARKET GIFT CARD',
    `ID Code: ${card.id_code}`,
    `Tour ID: ${card.tour_id}`,
    `Email: ${card.recipient_email}`,
    `Phone: ${card.recipient_phone}`,
    `Value: ${Number(card.face_value ?? 0).toFixed(2)} ${card.currency || 'USD'}`,
    `Remaining: ${Number(card.remaining_value ?? 0).toFixed(2)} ${card.currency || 'USD'}`,
  ].join('\n');
}

async function buildGiftCardQrSvg(card) {
  return QRCode.toString(buildGiftCardQrPayload(card), {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 180,
  });
}

async function mapGiftCardRow(row, options = {}) {
  const includeQr = options.includeQr === true;
  const mapped = {
    id: row.id,
    tenant_id: row.tenant_id,
    tour_id: row.tour_id,
    tour_title: row.tour_title ?? null,
    id_code: row.id_code,
    recipient_email: row.recipient_email,
    recipient_phone: row.recipient_phone,
    currency: row.currency,
    face_value: Number(row.face_value ?? 0),
    remaining_value: Number(row.remaining_value ?? 0),
    status: getGiftCardStatus(row),
    notes: row.notes ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };

  if (includeQr) {
    mapped.qr_svg = await buildGiftCardQrSvg(mapped);
  }

  return mapped;
}

function toOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

async function mapDiscountCouponRow(row) {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    tour_id: row.tour_id ?? null,
    tour_title: row.tour_title ?? null,
    code: row.code,
    label: row.label ?? null,
    discount_type: row.discount_type,
    discount_value: Number(row.discount_value ?? 0),
    currency: row.currency ?? null,
    min_order_total: Number(row.min_order_total ?? 0),
    max_uses: row.max_uses ?? null,
    uses_count: Number(row.uses_count ?? 0),
    starts_at: row.starts_at ?? null,
    expires_at: row.expires_at ?? null,
    status: row.status,
    availability_status: getDiscountCouponAvailability(row, now),
    notes: row.notes ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function resolveGiftCardForQuote(env, tenantId, tourId, idCode, expectedCurrency = null) {
  const safeCode = sanitizeGiftCardCode(idCode);
  if (!safeCode) return { ok: true, giftCard: null };

  const row = await env.DB
    .prepare(`SELECT gc.*, t.title AS tour_title
                FROM tour_gift_cards gc
                LEFT JOIN tours t ON t.id = gc.tour_id AND t.tenant_id = gc.tenant_id
               WHERE gc.tenant_id = ? AND gc.id_code = ?`)
    .bind(tenantId, safeCode)
    .first();

  if (!row) {
    return { ok: false, error: 'Gift card not found for this tenant.' };
  }

  const status = getGiftCardStatus(row);
  if (status === 'cancelled') {
    return { ok: false, error: 'Gift card is cancelled and cannot be used.' };
  }
  if (status === 'redeemed') {
    return { ok: false, error: 'Gift card has already been fully redeemed.' };
  }
  if (row.tour_id !== tourId) {
    return { ok: false, error: 'Gift card is issued for a different tour.' };
  }
  if (expectedCurrency && row.currency && row.currency !== expectedCurrency) {
    return { ok: false, error: `Gift card currency ${row.currency} does not match quoted currency ${expectedCurrency}.` };
  }

  return { ok: true, giftCard: row };
}

async function resolveDiscountCouponForQuote(env, tenantId, tourId, code, currentGrandTotal, expectedCurrency = null) {
  const safeCode = sanitizeDiscountCouponCode(code);
  if (!safeCode) return { ok: true, discountCoupon: null };

  const row = await env.DB
    .prepare(`SELECT dc.*, t.title AS tour_title
                FROM tenant_discount_coupons dc
                LEFT JOIN tours t ON t.id = dc.tour_id AND t.tenant_id = dc.tenant_id
               WHERE dc.tenant_id = ? AND dc.code = ?`)
    .bind(tenantId, safeCode)
    .first();

  if (!row) {
    return { ok: false, error: 'Discount coupon not found for this tenant.' };
  }

  const availability = getDiscountCouponAvailability(row);
  if (availability === 'paused') {
    return { ok: false, error: 'Discount coupon is paused.' };
  }
  if (availability === 'scheduled') {
    return { ok: false, error: 'Discount coupon is not active yet.' };
  }
  if (availability === 'expired') {
    return { ok: false, error: 'Discount coupon has expired.' };
  }
  if (availability === 'exhausted') {
    return { ok: false, error: 'Discount coupon has reached its usage limit.' };
  }
  if (row.tour_id && row.tour_id !== tourId) {
    return { ok: false, error: 'Discount coupon is scoped to a different tour.' };
  }
  if (Number(row.min_order_total ?? 0) > Number(currentGrandTotal ?? 0)) {
    return { ok: false, error: 'Discount coupon minimum order total is not met.' };
  }
  if (row.discount_type === 'amount' && expectedCurrency && row.currency && row.currency !== expectedCurrency) {
    return { ok: false, error: `Discount coupon currency ${row.currency} does not match quoted currency ${expectedCurrency}.` };
  }

  return { ok: true, discountCoupon: row };
}

function applyGiftCardToPriceResult(priceResult, giftCardRow) {
  if (!giftCardRow) return priceResult;

  const originalGrandTotal = Number(priceResult?.totals?.original_grand_total ?? priceResult?.totals?.grand_total ?? 0);
  const currentGrandTotal = Number(priceResult?.totals?.grand_total ?? 0);
  const remainingValue = Number(giftCardRow.remaining_value ?? 0);
  const appliedAmount = Math.min(currentGrandTotal, remainingValue);
  const amountDue = Math.max(0, currentGrandTotal - appliedAmount);

  return {
    ...priceResult,
    totals: {
      ...priceResult.totals,
      original_grand_total: originalGrandTotal,
      gift_card_applied: appliedAmount,
      grand_total: amountDue,
    },
    gift_card: {
      id: giftCardRow.id,
      id_code: giftCardRow.id_code,
      tour_id: giftCardRow.tour_id,
      tour_title: giftCardRow.tour_title ?? null,
      recipient_email: giftCardRow.recipient_email,
      recipient_phone: giftCardRow.recipient_phone,
      currency: giftCardRow.currency,
      face_value: Number(giftCardRow.face_value ?? 0),
      remaining_value: remainingValue,
      applied_amount: appliedAmount,
      status: getGiftCardStatus(giftCardRow),
    },
  };
}

function applyDiscountCouponToPriceResult(priceResult, discountCouponRow) {
  if (!discountCouponRow) return priceResult;

  const currentGrandTotal = Number(priceResult?.totals?.grand_total ?? 0);
  const originalGrandTotal = Number(priceResult?.totals?.original_grand_total ?? currentGrandTotal);
  const discountValue = Number(discountCouponRow.discount_value ?? 0);
  const appliedAmount = discountCouponRow.discount_type === 'percent'
    ? Math.min(currentGrandTotal, Number((currentGrandTotal * (discountValue / 100)).toFixed(2)))
    : Math.min(currentGrandTotal, discountValue);
  const amountDue = Math.max(0, currentGrandTotal - appliedAmount);

  return {
    ...priceResult,
    totals: {
      ...priceResult.totals,
      original_grand_total: originalGrandTotal,
      discount_coupon_applied: appliedAmount,
      grand_total: amountDue,
    },
    discount_coupon: {
      id: discountCouponRow.id,
      code: discountCouponRow.code,
      label: discountCouponRow.label ?? null,
      tour_id: discountCouponRow.tour_id ?? null,
      tour_title: discountCouponRow.tour_title ?? null,
      discount_type: discountCouponRow.discount_type,
      discount_value: discountValue,
      currency: discountCouponRow.currency ?? null,
      min_order_total: Number(discountCouponRow.min_order_total ?? 0),
      applied_amount: appliedAmount,
      max_uses: discountCouponRow.max_uses ?? null,
      uses_count: Number(discountCouponRow.uses_count ?? 0),
      availability_status: getDiscountCouponAvailability(discountCouponRow),
    },
  };
}

export async function applyDiscountCouponCodeToPriceResult(env, tenantId, tourId, code, priceResult) {
  const safeCode = sanitizeDiscountCouponCode(code);
  if (!safeCode) return { ok: true, priceResult, discountCoupon: null };

  const currentGrandTotal = Number(priceResult?.totals?.grand_total ?? 0);
  const resolved = await resolveDiscountCouponForQuote(env, tenantId, tourId, safeCode, currentGrandTotal, priceResult.base_currency ?? 'USD');
  if (!resolved.ok) return resolved;

  return {
    ok: true,
    discountCoupon: resolved.discountCoupon,
    priceResult: applyDiscountCouponToPriceResult(priceResult, resolved.discountCoupon),
  };
}

export async function applyGiftCardCodeToPriceResult(env, tenantId, tourId, idCode, priceResult) {
  const safeCode = sanitizeGiftCardCode(idCode);
  if (!safeCode) return { ok: true, priceResult, giftCard: null };

  const resolved = await resolveGiftCardForQuote(env, tenantId, tourId, safeCode, priceResult.base_currency ?? 'USD');
  if (!resolved.ok) return resolved;

  return {
    ok: true,
    giftCard: resolved.giftCard,
    priceResult: applyGiftCardToPriceResult(priceResult, resolved.giftCard),
  };
}

export function buildGiftCardCompensationStatements(env, tenantId, giftCardRow, appliedAmount, now) {
  if (!giftCardRow || !(appliedAmount > 0)) return null;

  const remainingAfterApply = Math.max(0, Number(giftCardRow.remaining_value ?? 0) - appliedAmount);
  const nextStatus = remainingAfterApply > 0 ? 'active' : 'redeemed';

  return {
    appliedAmount,
    giftCardId: giftCardRow.id,
    idCode: giftCardRow.id_code,
    update: env.DB
      .prepare(`UPDATE tour_gift_cards
                   SET remaining_value = ?,
                       status = ?,
                       updated_at = ?
                 WHERE id = ?
                   AND tenant_id = ?
                   AND status = 'active'
                   AND remaining_value >= ?`)
      .bind(remainingAfterApply, nextStatus, now, giftCardRow.id, tenantId, appliedAmount),
    restore: env.DB
      .prepare(`UPDATE tour_gift_cards
                   SET remaining_value = remaining_value + ?,
                       status = 'active',
                       updated_at = ?
                 WHERE id = ? AND tenant_id = ?`)
      .bind(appliedAmount, now, giftCardRow.id, tenantId),
  };
}

export function buildDiscountCouponCompensationStatements(env, tenantId, discountCouponRow, now) {
  if (!discountCouponRow) return null;

  return {
    couponId: discountCouponRow.id,
    code: discountCouponRow.code,
    update: env.DB
      .prepare(`UPDATE tenant_discount_coupons
                   SET uses_count = uses_count + 1,
                       updated_at = ?
                 WHERE id = ?
                   AND tenant_id = ?
                   AND status = 'active'
                   AND (starts_at IS NULL OR starts_at <= ?)
                   AND (expires_at IS NULL OR expires_at >= ?)
                   AND (max_uses IS NULL OR uses_count < max_uses)`)
      .bind(now, discountCouponRow.id, tenantId, now, now),
    restore: env.DB
      .prepare(`UPDATE tenant_discount_coupons
                   SET uses_count = CASE WHEN uses_count > 0 THEN uses_count - 1 ELSE 0 END,
                       updated_at = ?
                 WHERE id = ? AND tenant_id = ?`)
      .bind(now, discountCouponRow.id, tenantId),
  };
}

function parseGiftCardBody(body) {
  return {
    tour_id: String(body?.tour_id || '').trim(),
    recipient_email: String(body?.recipient_email || '').trim().toLowerCase(),
    recipient_phone: String(body?.recipient_phone || '').trim(),
    currency: String(body?.currency || '').trim().toUpperCase() || null,
    face_value: body?.face_value != null ? Number(body.face_value) : null,
    notes: String(body?.notes || '').trim().slice(0, 500) || null,
  };
}

function validateGiftCardCreatePayload(payload) {
  const missing = [];
  if (!payload.tour_id) missing.push('tour_id');
  if (!payload.recipient_email) missing.push('recipient_email');
  if (!payload.recipient_phone) missing.push('recipient_phone');
  if (!(payload.face_value > 0)) missing.push('face_value');
  if (missing.length) {
    return `Missing or invalid required fields: ${missing.join(', ')}`;
  }
  return null;
}

function parseGiftCardPatchBody(body) {
  const patch = {};
  if (body?.recipient_email !== undefined) patch.recipient_email = String(body.recipient_email || '').trim().toLowerCase();
  if (body?.recipient_phone !== undefined) patch.recipient_phone = String(body.recipient_phone || '').trim();
  if (body?.notes !== undefined) patch.notes = String(body.notes || '').trim().slice(0, 500) || null;
  if (body?.status !== undefined) patch.status = String(body.status || '').trim().toLowerCase();
  return patch;
}

function parseDiscountCouponBody(body) {
  return {
    tour_id: String(body?.tour_id || '').trim() || null,
    code: sanitizeDiscountCouponCode(body?.code || ''),
    label: String(body?.label || '').trim().slice(0, 120) || null,
    discount_type: String(body?.discount_type || '').trim().toLowerCase(),
    discount_value: toOptionalNumber(body?.discount_value),
    currency: String(body?.currency || '').trim().toUpperCase() || null,
    min_order_total: toOptionalNumber(body?.min_order_total),
    max_uses: toOptionalNumber(body?.max_uses),
    starts_at: toOptionalNumber(body?.starts_at),
    expires_at: toOptionalNumber(body?.expires_at),
    status: String(body?.status || 'active').trim().toLowerCase(),
    notes: String(body?.notes || '').trim().slice(0, 500) || null,
  };
}

function validateDiscountCouponCreatePayload(payload) {
  const missing = [];
  if (!DISCOUNT_COUPON_TYPES.has(payload.discount_type)) missing.push('discount_type');
  if (!(payload.discount_value > 0)) missing.push('discount_value');
  if (!DISCOUNT_COUPON_STATUSES.has(payload.status)) missing.push('status');
  if (payload.discount_type === 'amount' && !payload.currency) missing.push('currency');
  if (payload.discount_type === 'percent' && (!(payload.discount_value > 0) || payload.discount_value > 100)) missing.push('discount_value(1-100 for percent)');
  if (payload.code && !SAFE_DISCOUNT_COUPON_CODE_RE.test(payload.code)) missing.push('code');
  if (payload.max_uses !== null && (!(payload.max_uses >= 1) || !Number.isInteger(payload.max_uses))) missing.push('max_uses');
  if (payload.min_order_total !== null && !(payload.min_order_total >= 0)) missing.push('min_order_total');
  if (payload.starts_at !== null && !Number.isInteger(payload.starts_at)) missing.push('starts_at');
  if (payload.expires_at !== null && !Number.isInteger(payload.expires_at)) missing.push('expires_at');
  if (payload.starts_at !== null && payload.expires_at !== null && payload.expires_at < payload.starts_at) missing.push('expires_at(after starts_at)');
  if (missing.length) {
    return `Missing or invalid required fields: ${missing.join(', ')}`;
  }
  return null;
}

function parseDiscountCouponPatchBody(body) {
  const patch = {};
  if (body?.label !== undefined) patch.label = String(body.label || '').trim().slice(0, 120) || null;
  if (body?.status !== undefined) patch.status = String(body.status || '').trim().toLowerCase();
  if (body?.notes !== undefined) patch.notes = String(body.notes || '').trim().slice(0, 500) || null;
  if (body?.min_order_total !== undefined) patch.min_order_total = toOptionalNumber(body.min_order_total) ?? 0;
  if (body?.max_uses !== undefined) patch.max_uses = toOptionalNumber(body.max_uses);
  if (body?.starts_at !== undefined) patch.starts_at = toOptionalNumber(body.starts_at);
  if (body?.expires_at !== undefined) patch.expires_at = toOptionalNumber(body.expires_at);
  return patch;
}

const TABLE_MAP = {
  'tenant-seasons': 'tenant_seasons',
  'pricing-segments': 'pricing_segments',
  'pax-bands': 'pax_bands',
  'tour-prices': 'tour_prices'
};

// [SEC] Whitelist tên cột cho INSERT.
// D1 bind() chỉ bảo vệ VALUES (?), KHÔNG bảo vệ tên cột trong SQL string.
// Object.keys(userInput) trực tiếp vào SQL = SQL Injection qua column name.
const ALLOWED_INSERT_COLUMNS = {
  tenant_seasons:   ['tenant_id', 'name', 'start_month', 'start_day', 'end_month', 'end_day', 'sort_order', 'is_active', 'notes'],
  pricing_segments: ['tenant_id', 'code', 'name', 'description', 'sort_order', 'is_active'],
  pax_bands:        ['tenant_id', 'name', 'min_pax', 'max_pax', 'sort_order', 'is_active'],
  tour_prices:      ['tenant_id', 'tour_id', 'season_id', 'segment_id', 'pax_band_id', 'base_currency',
                     'adult_shared_room_price', 'adult_single_room_price', 'adult_triple_room_price',
                     'child_shared_with_parents_price', 'infant_price', 'notes', 'is_active'],
};

// [SEC] Whitelist tên cột cho UPDATE.
// id, tenant_id, created_at là bất biến — không được phép cập nhật từ client.
const ALLOWED_UPDATE_COLUMNS = {
  tenant_seasons:   ['name', 'start_month', 'start_day', 'end_month', 'end_day', 'sort_order', 'is_active', 'notes'],
  pricing_segments: ['code', 'name', 'description', 'sort_order', 'is_active'],
  pax_bands:        ['name', 'min_pax', 'max_pax', 'sort_order', 'is_active'],
  tour_prices:      ['tour_id', 'season_id', 'segment_id', 'pax_band_id', 'base_currency',
                     'adult_shared_room_price', 'adult_single_room_price', 'adult_triple_room_price',
                     'child_shared_with_parents_price', 'infant_price', 'notes', 'is_active'],
};

// [SEC-FIX] Bỏ 'tenant_id' khỏi tất cả requiredFields.
// tenant_id luôn đến từ X-Tenant-ID header (không tin body).
// Giữ 'tenant_id' ở đây sẽ khiến mọi request hợp lệ bị từ chối với lỗi "Missing required fields: tenant_id".
const requiredFields = {
  'tenant-seasons':   ['name', 'start_month', 'start_day', 'end_month', 'end_day'],
  'pricing-segments': ['code', 'name'],
  'pax-bands':        ['name', 'min_pax', 'max_pax'],
  'tour-prices':      ['tour_id', 'season_id', 'segment_id', 'pax_band_id'],
};

// Validate month (1–12) và day (1–31) cho tenant-seasons.
// Chỉ kiểm tra các trường có mặt trong data (dùng chung cho CREATE và PATCH).
function validateSeasonDates(data) {
  const errors = [];
  const { start_month, end_month, start_day, end_day } = data;
  if (start_month !== undefined && (start_month < 1 || start_month > 12)) {
    errors.push('start_month phải từ 1 đến 12');
  }
  if (end_month !== undefined && (end_month < 1 || end_month > 12)) {
    errors.push('end_month phải từ 1 đến 12');
  }
  if (start_day !== undefined && (start_day < 1 || start_day > 31)) {
    errors.push('start_day phải từ 1 đến 31');
  }
  if (end_day !== undefined && (end_day < 1 || end_day > 31)) {
    errors.push('end_day phải từ 1 đến 31');
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

function getMaxChildrenForRooming(sharedAdults, singleAdults, tripleAdults) {
  const sharedDoubleRooms = Math.floor(Math.max(0, Number(sharedAdults) || 0) / 2);
  const tripleRooms       = Math.floor(Math.max(0, Number(tripleAdults) || 0) / 3);
  const privateRooms      = Math.max(0, Number(singleAdults) || 0);
  return sharedDoubleRooms + (tripleRooms * 2) + (privateRooms * 2);
}

function validateChildRoomingCapacity(sharedAdults, singleAdults, tripleAdults, children) {
  const maxChildren = getMaxChildrenForRooming(sharedAdults, singleAdults, tripleAdults);
  if (Number(children) <= maxChildren) {
    return { ok: true, max_children: maxChildren };
  }

  return {
    ok: false,
    max_children: maxChildren,
    error: `The chosen rooming capacity cannot accommodate the given number of children. Your current rooming allows up to ${maxChildren} child${maxChildren === 1 ? '' : 'ren'}: 1 per shared double room, 2 per triple room, and 2 per private room. Please increase the room count or contact our staff for a family-room/manual quote.`,
  };
}

// Whitelist cột cần ép kiểu số trước khi bind vào D1.
// D1 strict-type: cột REAL/INTEGER nhận string sẽ throw SQLITE_MISMATCH (1031).
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
    adult_triple_room_price:         'real',
    child_shared_with_parents_price: 'real',
    infant_price:                    'real',
    is_active:                       'int',
  },
};

// Ép kiểu in-place trên safeData. Trả null nếu giá trị không parse được.
function coerceNumeric(table, safeData) {
  const cols = NUMERIC_COLUMNS[table] ?? {};
  for (const [col, type] of Object.entries(cols)) {
    if (col in safeData && safeData[col] !== null && safeData[col] !== undefined) {
      const n = Number(safeData[col]);
      safeData[col] = isNaN(n) ? null : (type === 'int' ? Math.trunc(n) : n);
    }
  }
}

// [SEC] Helper: log lỗi DB đầy đủ phía server, trả thông báo chung cho client.
// KHÔNG trả err.message cho client vì có thể lộ tên bảng, cột, constraint.
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

// ── buildPriceResponse ────────────────────────────────────────────────────────
// Maps a calculateTourPrice result → itemized invoice response.
// Labels are resolved via translate() using the client's Accept-Language-
// derived lang code (tenantConfig.lang, default 'en').
// USD is always primary (source of truth); local currency is appended when
// the tenant has a non-USD display_currency configured.
function buildPriceResponse(result, tenantConfig, tourType) {
  const {
    exchange_rate    = 1,
    display_currency = 'USD',
    locale           = 'en-US',
    lang             = 'en',
  } = tenantConfig ?? {};

  const cfg = { exchange_rate, display_currency, locale };
  const isDayTour = (tourType ?? result.tour_type) === 'day_tour';

  const { pax_breakdown, totals, prices, base_currency } = result;
  const {
    adult_shared_room_count  = 0,
    adult_single_room_count  = 0,
    adult_triple_room_count  = 0,
    adult_count              = 0,  // legacy compat
    child_count              = 0,
    infant_count             = 0,
  } = pax_breakdown ?? {};

  const sharedCount  = adult_shared_room_count > 0 ? adult_shared_room_count : adult_count;
  const privateCount = adult_single_room_count;
  const tripleCount  = adult_triple_room_count;

  const grandTotal = totals?.grand_total ?? (prices.adult_shared_room ?? 0);
  const originalGrandTotal = totals?.original_grand_total ?? grandTotal;
  const discountCouponApplied = totals?.discount_coupon_applied ?? 0;
  const giftCardApplied = totals?.gift_card_applied ?? 0;
  const totalDiscountApplied = discountCouponApplied + giftCardApplied;

  // Line items — only include types with qty > 0; labels from locale files
  const line_items = [];
  if (sharedCount > 0) {
    line_items.push({
      type:       'adult_shared_room',
      label:      isDayTour ? translate('tour.adult', lang) : translate('invoice.adult_shared_room', lang),
      qty:        sharedCount,
      unit_price: dualPrice(prices.adult_shared_room ?? 0, cfg),
      subtotal:   dualPrice(totals?.shared_room_subtotal ?? 0, cfg),
    });
  }
  if (tripleCount > 0) {
    line_items.push({
      type:       'adult_triple_room',
      label:      translate('invoice.adult_triple_room', lang),
      qty:        tripleCount,
      unit_price: dualPrice(prices.adult_triple_room ?? 0, cfg),
      subtotal:   dualPrice(totals?.triple_room_subtotal ?? 0, cfg),
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

  if (discountCouponApplied > 0 || giftCardApplied > 0) {
    invoice.original_grand_total = originalGrandTotal;
    invoice.original_grand_total_display = dualPrice(originalGrandTotal, cfg);
    if (discountCouponApplied > 0) {
      invoice.discount_coupon_applied = discountCouponApplied;
      invoice.discount_coupon_applied_display = dualPrice(discountCouponApplied, cfg);
    }
    invoice.gift_card_applied = giftCardApplied;
    invoice.gift_card_applied_display = dualPrice(giftCardApplied, cfg);
    invoice.amount_due = grandTotal;
    invoice.amount_due_display = dualPrice(grandTotal, cfg);
  }

  const unit_prices = {
    adult_shared_room: prices.adult_shared_room ?? 0,
    adult_triple_room: prices.adult_triple_room ?? 0,
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
      original: { amount: originalGrandTotal, currency: base_currency ?? 'USD' },
      amount_due: { amount: grandTotal, currency: base_currency ?? 'USD' },
      discount: totalDiscountApplied > 0 ? { amount: totalDiscountApplied, currency: base_currency ?? 'USD' } : null,
      display:  dualPrice(grandTotal, cfg),
    },
    unit_prices,
    prices:        enrichPricesObject(
      {
        adult_shared_room:         prices.adult_shared_room,
        adult_triple_room:         prices.adult_triple_room,
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

  if (result.pricing_notes_text) {
    const notes = result.pricing_notes_text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (notes.length) response.pricing_notes = notes;
  }

  if (result.gift_card) {
    response.gift_card = {
      ...result.gift_card,
      face_value_display: dualPrice(result.gift_card.face_value ?? 0, cfg),
      remaining_value_display: dualPrice(result.gift_card.remaining_value ?? 0, cfg),
      applied_amount_display: dualPrice(result.gift_card.applied_amount ?? 0, cfg),
      amount_due_after_apply_display: dualPrice(grandTotal, cfg),
    };
  }

  if (result.discount_coupon) {
    response.discount_coupon = {
      ...result.discount_coupon,
      discount_value_display: result.discount_coupon.discount_type === 'percent'
        ? `${Number(result.discount_coupon.discount_value ?? 0)}%`
        : dualPrice(result.discount_coupon.discount_value ?? 0, cfg),
      applied_amount_display: dualPrice(result.discount_coupon.applied_amount ?? 0, cfg),
      amount_due_after_apply_display: dualPrice(grandTotal, cfg),
      min_order_total_display: dualPrice(result.discount_coupon.min_order_total ?? 0, cfg),
    };
  }

  return response;
}

// 1. Hàm Xử lý POST
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
        return Response.json({ error: 'Dữ liệu ngày tháng không hợp lệ', details: dateErrors }, { status: 400 });
      }
    }

    // [SEC-FIX] tenant_id đến từ X-Tenant-ID header, không phải body
    // TODO: thay bằng JWT/session khi auth middleware được triển khai
    const tenantFromHeader = req.headers.get('X-Tenant-ID')?.trim();
    if (!tenantFromHeader) {
      return Response.json({ error: 'X-Tenant-ID header is required' }, { status: 400 });
    }

    const allowed = ALLOWED_INSERT_COLUMNS[table] ?? [];
    const safeData = Object.fromEntries(
      Object.entries(data).filter(([k]) => allowed.includes(k))
    );
    // Ghi đè tenant_id bằng giá trị từ header — không tin body
    safeData.tenant_id = tenantFromHeader;

    // Default các trường giá về 0 thay vì null cho group tour-prices
    // Tránh lỗi tính toán phía sau khi các trường này bị bỏ qua trong request body
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

    // Ép kiểu REAL/INTEGER — tránh SQLITE_MISMATCH (1031) khi client gửi string
    coerceNumeric(table, safeData);

    if (group === 'pax-bands') {
      const paxBandErrors = validatePaxBandRange(safeData);
      if (paxBandErrors.length > 0) {
        return Response.json({ error: 'Invalid pax band range', details: paxBandErrors }, { status: 400 });
      }
    }

    console.log('[CREATE_PRICING] Dữ liệu sau khi ép kiểu:', safeData);

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
      return Response.json({ error: 'Duplicate entry � this record already exists' }, { status: 409 });
    }
    if (msg.includes('CHECK constraint failed')) {
      if (msg.includes('pax_bands') || msg.includes('min_pax')) {
        return Response.json({ error: 'Invalid pax band: min pax must be less than or equal to max pax' }, { status: 400 });
      }
      return Response.json({ error: 'Validation failed � check your input values' }, { status: 400 });
    }
    return Response.json({ error: 'Internal server error. Please try again later.' }, { status: 500 });
  }
}
// GET /api/pricing/metadata
// Trả về pricing_segments + pax_bands của tenant trong 1 request.
// Dùng để populate dropdown khi tạo/sửa tour_prices trên UI.
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

// 2. Hàm Xử lý GET (Chỉ giữ lại 1 định nghĩa duy nhất)
export async function handleGetPricing(req, env, { group }) {
  const table = TABLE_MAP[group];
  if (!table) return Response.json({ error: `Invalid group: ${group}` }, { status: 400 });

  // [SEC-FIX] tenant_id đến từ X-Tenant-ID header — không tin query param
  // TODO: thay bằng JWT/session khi auth middleware được triển khai
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

export async function handleCreateGiftCard(req, env) {
  const tenantId = req.headers.get('X-Tenant-ID')?.trim();
  if (!tenantId) {
    return Response.json({ error: 'X-Tenant-ID header is required' }, { status: 400 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Request body is not valid JSON.' }, { status: 400 });
  }

  const payload = parseGiftCardBody(body);
  const validationError = validateGiftCardCreatePayload(payload);
  if (validationError) {
    return Response.json({ error: validationError }, { status: 400 });
  }

  const tour = await env.DB
    .prepare('SELECT id, title FROM tours WHERE id = ? AND tenant_id = ?')
    .bind(payload.tour_id, tenantId)
    .first();
  if (!tour) {
    return Response.json({ error: 'Tour not found for this tenant.' }, { status: 404 });
  }

  try {
    const id = nanoid();
    const now = Math.floor(Date.now() / 1000);
    const idCode = await generateUniqueGiftCardIdCode(env, tenantId);
    const currency = payload.currency || 'USD';

    await env.DB
      .prepare(`INSERT INTO tour_gift_cards
                  (id, tenant_id, tour_id, id_code, recipient_email, recipient_phone, currency,
                   face_value, remaining_value, status, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`)
      .bind(
        id,
        tenantId,
        payload.tour_id,
        idCode,
        payload.recipient_email,
        payload.recipient_phone,
        currency,
        payload.face_value,
        payload.face_value,
        payload.notes,
        now,
        now,
      )
      .run();

    const item = await mapGiftCardRow({
      id,
      tenant_id: tenantId,
      tour_id: payload.tour_id,
      tour_title: tour.title,
      id_code: idCode,
      recipient_email: payload.recipient_email,
      recipient_phone: payload.recipient_phone,
      currency,
      face_value: payload.face_value,
      remaining_value: payload.face_value,
      status: 'active',
      notes: payload.notes,
      created_at: now,
      updated_at: now,
    }, { includeQr: true });

    return Response.json({ ok: true, item }, { status: 201 });
  } catch (err) {
    return dbError(err, 'handleCreateGiftCard');
  }
}

export async function handleListGiftCards(req, env) {
  const tenantId = req.headers.get('X-Tenant-ID')?.trim();
  if (!tenantId) {
    return Response.json({ error: 'X-Tenant-ID header is required' }, { status: 400 });
  }

  const url = new URL(req.url);
  const tourId = String(url.searchParams.get('tour_id') || '').trim();
  const includeQr = url.searchParams.get('include_qr') === '1';
  const status = String(url.searchParams.get('status') || '').trim().toLowerCase();
  const clauses = ['gc.tenant_id = ?'];
  const binds = [tenantId];

  if (tourId) {
    clauses.push('gc.tour_id = ?');
    binds.push(tourId);
  }

  if (status && GIFT_CARD_STATUSES.has(status)) {
    if (status === 'active') {
      clauses.push(`gc.status = 'active' AND gc.remaining_value > 0`);
    } else if (status === 'redeemed') {
      clauses.push(`(gc.status = 'redeemed' OR gc.remaining_value <= 0)`);
    } else {
      clauses.push('gc.status = ?');
      binds.push(status);
    }
  }

  try {
    const { results } = await env.DB
      .prepare(`SELECT gc.*, t.title AS tour_title
                  FROM tour_gift_cards gc
                  LEFT JOIN tours t ON t.id = gc.tour_id AND t.tenant_id = gc.tenant_id
                 WHERE ${clauses.join(' AND ')}
                 ORDER BY gc.created_at DESC`)
      .bind(...binds)
      .all();

    const items = [];
    for (const row of results || []) {
      items.push(await mapGiftCardRow(row, { includeQr }));
    }

    return Response.json({ ok: true, items });
  } catch (err) {
    return dbError(err, 'handleListGiftCards');
  }
}

export async function handleCreateDiscountCoupon(req, env) {
  const tenantId = req.headers.get('X-Tenant-ID')?.trim();
  if (!tenantId) {
    return Response.json({ error: 'X-Tenant-ID header is required' }, { status: 400 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Request body is not valid JSON.' }, { status: 400 });
  }

  const payload = parseDiscountCouponBody(body);
  const validationError = validateDiscountCouponCreatePayload(payload);
  if (validationError) {
    return Response.json({ error: validationError }, { status: 400 });
  }

  let tour = null;
  if (payload.tour_id) {
    tour = await env.DB
      .prepare('SELECT id, title FROM tours WHERE id = ? AND tenant_id = ?')
      .bind(payload.tour_id, tenantId)
      .first();
    if (!tour) {
      return Response.json({ error: 'Tour not found for this tenant.' }, { status: 404 });
    }
  }

  try {
    const id = nanoid();
    const now = Math.floor(Date.now() / 1000);
    const code = payload.code || await generateUniqueDiscountCouponCode(env, tenantId);
    const existing = await env.DB
      .prepare('SELECT id FROM tenant_discount_coupons WHERE tenant_id = ? AND code = ?')
      .bind(tenantId, code)
      .first();
    if (existing) {
      return Response.json({ error: 'Discount coupon code already exists for this tenant.' }, { status: 409 });
    }

    await env.DB
      .prepare(`INSERT INTO tenant_discount_coupons
                  (id, tenant_id, tour_id, code, label, discount_type, discount_value, currency,
                   min_order_total, max_uses, uses_count, starts_at, expires_at, status, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`)
      .bind(
        id,
        tenantId,
        payload.tour_id,
        code,
        payload.label,
        payload.discount_type,
        payload.discount_value,
        payload.currency,
        payload.min_order_total ?? 0,
        payload.max_uses,
        payload.starts_at,
        payload.expires_at,
        payload.status,
        payload.notes,
        now,
        now
      )
      .run();

    return Response.json({
      ok: true,
      item: await mapDiscountCouponRow({
        id,
        tenant_id: tenantId,
        tour_id: payload.tour_id,
        tour_title: tour?.title ?? null,
        code,
        label: payload.label,
        discount_type: payload.discount_type,
        discount_value: payload.discount_value,
        currency: payload.currency,
        min_order_total: payload.min_order_total ?? 0,
        max_uses: payload.max_uses,
        uses_count: 0,
        starts_at: payload.starts_at,
        expires_at: payload.expires_at,
        status: payload.status,
        notes: payload.notes,
        created_at: now,
        updated_at: now,
      }),
    }, { status: 201 });
  } catch (err) {
    return dbError(err, 'handleCreateDiscountCoupon');
  }
}

export async function handleListDiscountCoupons(req, env) {
  const tenantId = req.headers.get('X-Tenant-ID')?.trim();
  if (!tenantId) {
    return Response.json({ error: 'X-Tenant-ID header is required' }, { status: 400 });
  }

  const url = new URL(req.url);
  const tourId = String(url.searchParams.get('tour_id') || '').trim();
  const clauses = ['dc.tenant_id = ?'];
  const binds = [tenantId];

  if (tourId) {
    clauses.push('(dc.tour_id IS NULL OR dc.tour_id = ?)');
    binds.push(tourId);
  }

  try {
    const { results } = await env.DB
      .prepare(`SELECT dc.*, t.title AS tour_title
                  FROM tenant_discount_coupons dc
                  LEFT JOIN tours t ON t.id = dc.tour_id AND t.tenant_id = dc.tenant_id
                 WHERE ${clauses.join(' AND ')}
                 ORDER BY dc.created_at DESC`)
      .bind(...binds)
      .all();

    const items = [];
    for (const row of results || []) {
      items.push(await mapDiscountCouponRow(row));
    }

    return Response.json({ ok: true, items });
  } catch (err) {
    return dbError(err, 'handleListDiscountCoupons');
  }
}

export async function handleUpdateDiscountCoupon(req, env, { discountCouponId }) {
  const tenantId = req.headers.get('X-Tenant-ID')?.trim();
  if (!tenantId) {
    return Response.json({ error: 'X-Tenant-ID header is required' }, { status: 400 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Request body is not valid JSON.' }, { status: 400 });
  }

  const patch = parseDiscountCouponPatchBody(body);
  if (!Object.keys(patch).length) {
    return Response.json({ error: 'No valid discount coupon fields provided.' }, { status: 400 });
  }
  if (patch.status && !DISCOUNT_COUPON_STATUSES.has(patch.status)) {
    return Response.json({ error: 'Invalid discount coupon status.' }, { status: 400 });
  }
  if (patch.max_uses !== undefined && patch.max_uses !== null && (!(patch.max_uses >= 1) || !Number.isInteger(patch.max_uses))) {
    return Response.json({ error: 'max_uses must be an integer >= 1 or null.' }, { status: 400 });
  }
  if (patch.min_order_total !== undefined && !(patch.min_order_total >= 0)) {
    return Response.json({ error: 'min_order_total must be >= 0.' }, { status: 400 });
  }
  if (patch.starts_at !== undefined && patch.starts_at !== null && !Number.isInteger(patch.starts_at)) {
    return Response.json({ error: 'starts_at must be an integer unix timestamp or null.' }, { status: 400 });
  }
  if (patch.expires_at !== undefined && patch.expires_at !== null && !Number.isInteger(patch.expires_at)) {
    return Response.json({ error: 'expires_at must be an integer unix timestamp or null.' }, { status: 400 });
  }

  const current = await env.DB
    .prepare('SELECT * FROM tenant_discount_coupons WHERE id = ? AND tenant_id = ?')
    .bind(discountCouponId, tenantId)
    .first();
  if (!current) {
    return Response.json({ error: 'Discount coupon not found.' }, { status: 404 });
  }

  const nextStartsAt = patch.starts_at !== undefined ? patch.starts_at : current.starts_at;
  const nextExpiresAt = patch.expires_at !== undefined ? patch.expires_at : current.expires_at;
  if (nextStartsAt !== null && nextStartsAt !== undefined && nextExpiresAt !== null && nextExpiresAt !== undefined && Number(nextExpiresAt) < Number(nextStartsAt)) {
    return Response.json({ error: 'expires_at must be after starts_at.' }, { status: 400 });
  }

  if (patch.max_uses !== undefined && patch.max_uses !== null && Number(patch.max_uses) < Number(current.uses_count ?? 0)) {
    return Response.json({ error: 'max_uses cannot be lower than current uses_count.' }, { status: 422 });
  }

  const updates = [];
  const values = [];
  for (const [column, value] of Object.entries(patch)) {
    updates.push(`${column} = ?`);
    values.push(value);
  }
  updates.push('updated_at = ?');
  values.push(Math.floor(Date.now() / 1000));
  values.push(discountCouponId, tenantId);

  try {
    await env.DB
      .prepare(`UPDATE tenant_discount_coupons SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`)
      .bind(...values)
      .run();

    const updated = await env.DB
      .prepare(`SELECT dc.*, t.title AS tour_title
                  FROM tenant_discount_coupons dc
                  LEFT JOIN tours t ON t.id = dc.tour_id AND t.tenant_id = dc.tenant_id
                 WHERE dc.id = ? AND dc.tenant_id = ?`)
      .bind(discountCouponId, tenantId)
      .first();

    return Response.json({ ok: true, item: await mapDiscountCouponRow(updated) });
  } catch (err) {
    return dbError(err, 'handleUpdateDiscountCoupon');
  }
}

export async function handleUpdateGiftCard(req, env, { giftCardId }) {
  const tenantId = req.headers.get('X-Tenant-ID')?.trim();
  if (!tenantId) {
    return Response.json({ error: 'X-Tenant-ID header is required' }, { status: 400 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Request body is not valid JSON.' }, { status: 400 });
  }

  const patch = parseGiftCardPatchBody(body);
  if (!Object.keys(patch).length) {
    return Response.json({ error: 'No valid gift card fields provided.' }, { status: 400 });
  }
  if (patch.status && !GIFT_CARD_STATUSES.has(patch.status)) {
    return Response.json({ error: 'Invalid gift card status.' }, { status: 400 });
  }

  const current = await env.DB
    .prepare('SELECT * FROM tour_gift_cards WHERE id = ? AND tenant_id = ?')
    .bind(giftCardId, tenantId)
    .first();
  if (!current) {
    return Response.json({ error: 'Gift card not found.' }, { status: 404 });
  }

  if (patch.status === 'active' && Number(current.remaining_value ?? 0) <= 0) {
    return Response.json({ error: 'A fully redeemed gift card cannot be reactivated.' }, { status: 422 });
  }

  const updates = [];
  const values = [];
  for (const [column, value] of Object.entries(patch)) {
    updates.push(`${column} = ?`);
    values.push(value);
  }
  updates.push('updated_at = ?');
  values.push(Math.floor(Date.now() / 1000));
  values.push(giftCardId, tenantId);

  try {
    await env.DB
      .prepare(`UPDATE tour_gift_cards SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`)
      .bind(...values)
      .run();

    const updated = await env.DB
      .prepare(`SELECT gc.*, t.title AS tour_title
                  FROM tour_gift_cards gc
                  LEFT JOIN tours t ON t.id = gc.tour_id AND t.tenant_id = gc.tenant_id
                 WHERE gc.id = ? AND gc.tenant_id = ?`)
      .bind(giftCardId, tenantId)
      .first();

    return Response.json({ ok: true, item: await mapGiftCardRow(updated, { includeQr: true }) });
  } catch (err) {
    return dbError(err, 'handleUpdateGiftCard');
  }
}

// 3. Handlers cho Hono
// QUAN TRỌNG: Route cụ thể /calculate phải đứng TRƯỚC route động /:group
// để tránh bị Hono match nhầm 'calculate' vào group handler
pricing.post('/calculate', async (c) => {
  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return c.json({ error: 'Content-Type phải là application/json' }, 400);
  }

  // [SEC] tenant_id đến từ X-Tenant-ID header — không tin body
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
    return c.json({ error: 'Thiếu trường bắt buộc: tour_id, travel_date' }, 400);
  }

  const tenantConfig   = c.get('tenantConfig') ?? {};
  const commonParams   = {
    tenant_id:               tenantFromHeader,
    tour_id:                 params.tour_id,
    date:                    params.travel_date ?? params.date,
    pax_count:               params.pax_count,
    adult_count:             params.adult_count,
    adult_shared_room_count: params.adult_shared_room_count ?? params.adult_shared_count,
    adult_triple_room_count: params.adult_triple_room_count ?? 0,
    adult_single_room_count: params.adult_single_room_count ?? params.adult_private_count ?? 0,
    child_count:             params.child_count   ?? 0,
    infant_count:            params.infant_count  ?? 0,
    timezone:                tenantConfig.timezone           ?? 'Asia/Ho_Chi_Minh',
    pricing_policy:          tenantConfig.pricing_policy     ?? 'PRIORITY_HIGH_SEASON',
    infant_policy_text:      tenantConfig.infant_policy_text ?? null,
    pricing_notes_text:      tenantConfig.pricing_notes_text ?? null,
  };
  const discountCouponCode = sanitizeDiscountCouponCode(params.discount_coupon_code ?? params.coupon_code ?? params.discount_code);
  const giftCardIdCode = sanitizeGiftCardCode(params.gift_card_id_code ?? params.gift_card_code);
  const tourType = params.tour_type ?? null;

  // Compare mode: no segment_id ? return all segments
  if (!params.segment_id) {
    const allResult = await calculateAllSegmentsPrice(c.env, commonParams);
    if (!allResult.ok) return c.json(allResult, 422);
    const segments = [];
    for (const segment of allResult.segments) {
      let adjustedSegment = segment;
      const discountCouponApplied = await applyDiscountCouponCodeToPriceResult(c.env, tenantFromHeader, params.tour_id, discountCouponCode, adjustedSegment);
      if (!discountCouponApplied.ok) return c.json(discountCouponApplied, 422);
      adjustedSegment = discountCouponApplied.priceResult;
      const giftCardApplied = await applyGiftCardCodeToPriceResult(c.env, tenantFromHeader, params.tour_id, giftCardIdCode, adjustedSegment);
      if (!giftCardApplied.ok) return c.json(giftCardApplied, 422);
      segments.push(buildPriceResponse(giftCardApplied.priceResult, tenantConfig, tourType));
    }
    return c.json({
      ok:         true,
      mode:       'compare',
      segments,
      matched_on: allResult.matched_on,
    });
  }

  let result = await calculateTourPrice(c.env, { ...commonParams, segment_id: params.segment_id });
  if (!result.ok) return c.json(result, 422);
  const discountCouponApplied = await applyDiscountCouponCodeToPriceResult(c.env, tenantFromHeader, params.tour_id, discountCouponCode, result);
  if (!discountCouponApplied.ok) return c.json(discountCouponApplied, 422);
  result = discountCouponApplied.priceResult;
  const giftCardApplied = await applyGiftCardCodeToPriceResult(c.env, tenantFromHeader, params.tour_id, giftCardIdCode, result);
  if (!giftCardApplied.ok) return c.json(giftCardApplied, 422);
  result = giftCardApplied.priceResult;
  return c.json(buildPriceResponse(result, tenantConfig, tourType));
});

// GET /api/pricing/calculate?tour_id=&date=YYYY-MM-DD&adult_shared_room_count= (or adult_count= for day tours)&[segment_id=]
// segment_id optional — omit to get compare table for ALL segments
pricing.get('/calculate', async (c) => {
  // [SEC] tenant_id từ X-Tenant-ID header
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
    pricing_notes_text:      tenantConfig.pricing_notes_text ?? null,
  };
  const discountCouponCode = sanitizeDiscountCouponCode(c.req.query('discount_coupon_code') ?? c.req.query('coupon_code') ?? c.req.query('discount_code'));
  const giftCardIdCode = sanitizeGiftCardCode(c.req.query('gift_card_id_code') ?? c.req.query('gift_card_code'));
  const tourType = c.req.query('tour_type') ?? null;

  // Compare mode: no segment_id ? return all segments sorted cheapest-first
  if (!segment_id) {
    const allResult = await calculateAllSegmentsPrice(c.env, commonParams);
    if (!allResult.ok) return c.json(allResult, 422);
    const segments = [];
    for (const segment of allResult.segments) {
      let adjustedSegment = segment;
      const discountCouponApplied = await applyDiscountCouponCodeToPriceResult(c.env, tenantFromHeader, tour_id, discountCouponCode, adjustedSegment);
      if (!discountCouponApplied.ok) return c.json(discountCouponApplied, 422);
      adjustedSegment = discountCouponApplied.priceResult;
      const giftCardApplied = await applyGiftCardCodeToPriceResult(c.env, tenantFromHeader, tour_id, giftCardIdCode, adjustedSegment);
      if (!giftCardApplied.ok) return c.json(giftCardApplied, 422);
      segments.push(buildPriceResponse(giftCardApplied.priceResult, tenantConfig, tourType));
    }
    return c.json({
      ok:         true,
      mode:       'compare',
      segments,
      matched_on: allResult.matched_on,
    });
  }

  let result = await calculateTourPrice(c.env, { ...commonParams, segment_id });
  if (!result.ok) return c.json(result, 422);
  const discountCouponApplied = await applyDiscountCouponCodeToPriceResult(c.env, tenantFromHeader, tour_id, discountCouponCode, result);
  if (!discountCouponApplied.ok) return c.json(discountCouponApplied, 422);
  result = discountCouponApplied.priceResult;
  const giftCardApplied = await applyGiftCardCodeToPriceResult(c.env, tenantFromHeader, tour_id, giftCardIdCode, result);
  if (!giftCardApplied.ok) return c.json(giftCardApplied, 422);
  result = giftCardApplied.priceResult;
  return c.json(buildPriceResponse(result, tenantConfig, tourType));
});

pricing.post('/discount-coupons', async (c) => {
  return handleCreateDiscountCoupon(c.req.raw, c.env);
});

pricing.get('/discount-coupons', async (c) => {
  return handleListDiscountCoupons(c.req.raw, c.env);
});

pricing.patch('/discount-coupons/:discountCouponId', async (c) => {
  return handleUpdateDiscountCoupon(c.req.raw, c.env, { discountCouponId: c.req.param('discountCouponId') });
});

pricing.post('/gift-cards', async (c) => {
  return handleCreateGiftCard(c.req.raw, c.env);
});

pricing.get('/gift-cards', async (c) => {
  return handleListGiftCards(c.req.raw, c.env);
});

pricing.patch('/gift-cards/:giftCardId', async (c) => {
  return handleUpdateGiftCard(c.req.raw, c.env, { giftCardId: c.req.param('giftCardId') });
});

// Phải đứng TRƯỚC /:group — tránh Hono match 'tenant-seasons' vào group handler
pricing.post('/tenant-seasons/:sourceSeasonId/copy', async (c) => {
  const sourceSeasonId = c.req.param('sourceSeasonId');
  return handleCopySeason(c.req.raw, c.env, { sourceSeasonId });
});

// Phải đứng TRƯỚC /:group để không bị Hono match nhầm
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

    // [SEC-FIX] tenant_id đến từ X-Tenant-ID header — không tin body
    // TODO: thay bằng JWT/session khi auth middleware được triển khai
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
        return Response.json({ error: 'Dữ liệu ngày tháng không hợp lệ', details: dateErrors }, { status: 400 });
      }
    }

    // [SEC-FIX] Whitelist column names — loại bỏ id, tenant_id, created_at (bất biến)
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
      return Response.json({ error: 'Không có trường hợp lệ để cập nhật' }, { status: 400 });
    }

    const setClause = Object.keys(safeData).map(col => `${col} = ?`).join(', ');
    // [SEC-FIX] WHERE id = ? AND tenant_id = ? — ngăn cập nhật record của tenant khác
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

// Thêm route vào đối tượng pricing (Hono) phía cuối file
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
// handleCopySeason — Tạo bản sao của một season (cùng cấu trúc, tên mới)
// =============================================================================

/**
 * Sao chép một tenant_season cùng toàn bộ tour_prices sang season mới.
 * Season mới kế thừa đầy đủ start_month/day, end_month/day, sort_order, notes
 * của season gốc; chỉ thay name bằng new_name từ request body.
 *
 * Route: POST /api/pricing/tenant-seasons/:sourceSeasonId/copy
 * Body:  { new_name: string }
 *
 * @param {Request} req
 * @param {object}  env
 * @param {{ sourceSeasonId: string }} params
 */
export async function handleCopySeason(req, env, { sourceSeasonId }) {
  // [SEC] tenant_id từ X-Tenant-ID header — không tin body
  const tenantId = req.headers.get('X-Tenant-ID')?.trim();
  if (!tenantId) {
    return Response.json({ error: 'X-Tenant-ID header is required' }, { status: 400 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Request body không phải JSON hợp lệ' }, { status: 400 });
  }

  const new_name = body?.new_name?.toString().trim();
  if (!new_name) {
    return Response.json({ error: 'new_name là bắt buộc' }, { status: 400 });
  }

  try {
    // --- Bước A: Lấy season gốc — liệt kê tường minh, scoped theo tenant_id ---
    const source = await env.DB
      .prepare(`SELECT id, tenant_id, name, start_month, start_day, end_month, end_day,
                       sort_order, is_active, notes
                FROM tenant_seasons
                WHERE id = ? AND tenant_id = ?`)
      .bind(sourceSeasonId, tenantId)
      .first();
    if (!source) {
      return Response.json(
        { error: 'Season không tồn tại hoặc không thuộc tenant này' },
        { status: 404 }
      );
    }

    // --- Bước 1: SELECT toàn bộ price rows — liệt kê tường minh, KHÔNG dùng SELECT * ---
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

    // --- stmtSeason: INSERT season mới — kế thừa cấu trúc, chỉ đổi id, name, created_at ---
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

    // --- Bước 2: map() tạo stmtPrices — mỗi row nhận nanoid() mới từ JS ---
    // ?? null trên từng giá trị đảm bảo D1 nhận NULL thay vì undefined (tránh bind error)
    console.log('Số lượng giá sẽ copy:', sourcePrices.length);

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

    // --- Bước 3: nếu không có giá, chỉ chạy stmtSeason đơn lẻ ---
    // env.DB.batch([]) với mảng rỗng gây lỗi 1031 trên D1 local
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
// handleDuplicateSeason — Clone một season và toàn bộ tour_prices của nó
// =============================================================================

/**
 * Tạo season mới từ newSeasonData, sau đó sao chép tất cả tour_prices
 * của sourceSeasonId sang season mới — toàn bộ trong một D1 batch (transaction).
 *
 * Body JSON: { sourceSeasonId: string, newSeasonData: { tenant_id, name,
 *   start_month, start_day, end_month, end_day, [sort_order], [notes] } }
 *
 * D1 batch đảm bảo tính nguyên tử: nếu bất kỳ INSERT nào thất bại,
 * toàn bộ batch bị rollback — không để lại dữ liệu rác.
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
    return Response.json({ error: 'Request body không phải JSON hợp lệ' }, { status: 400 });
  }

  const { sourceSeasonId, newSeasonData } = body ?? {};

  // --- Validate đầu vào ---
  if (!sourceSeasonId || typeof sourceSeasonId !== 'string') {
    return Response.json({ error: 'sourceSeasonId là bắt buộc và phải là string' }, { status: 400 });
  }
  if (!newSeasonData || typeof newSeasonData !== 'object') {
    return Response.json({ error: 'newSeasonData là bắt buộc và phải là object' }, { status: 400 });
  }

  // [SEC-FIX] tenant_id đến từ X-Tenant-ID header
  // TODO: thay bằng JWT/session khi auth middleware được triển khai
  const headerTenantId = req.headers.get('X-Tenant-ID')?.trim();
  if (!headerTenantId) {
    return Response.json({ error: 'X-Tenant-ID header is required' }, { status: 400 });
  }
  if (newSeasonData.tenant_id && newSeasonData.tenant_id !== headerTenantId) {
    return Response.json({ error: 'tenant_id trong body không khớp với X-Tenant-ID header' }, { status: 400 });
  }
  // Ghi đè tenant_id trong payload bằng giá trị từ header
  newSeasonData.tenant_id = headerTenantId;

  const requiredSeasonFields = ['name', 'start_month', 'start_day', 'end_month', 'end_day'];
  const missing = requiredSeasonFields.filter(f => newSeasonData[f] == null);
  if (missing.length > 0) {
    return Response.json({ error: `newSeasonData thiếu trường bắt buộc: ${missing.join(', ')}` }, { status: 400 });
  }

  try {
    // --- Bước 1: Lấy tất cả tour_prices của sourceSeasonId ---
    // Thực hiện TRƯỚC batch để dùng kết quả build INSERT statements
    const tenantId = headerTenantId;
    const { results: sourcePrices } = await env.DB
      .prepare('SELECT * FROM tour_prices WHERE season_id = ? AND tenant_id = ? AND is_active = 1')
      .bind(sourceSeasonId, tenantId)
      .all();

    // --- Bước 2: Chuẩn bị INSERT season mới ---
    const newSeasonId = nanoid();
    const now = Math.floor(Date.now() / 1000);

    const allowedSeasonFields = ['tenant_id', 'name', 'start_month', 'start_day', 'end_month', 'end_day', 'sort_order', 'notes', 'is_active'];
    // Chỉ lấy các cột được phép — tránh SQL injection qua tên cột
    const filteredSeason = Object.fromEntries(
      Object.entries(newSeasonData).filter(([k]) => allowedSeasonFields.includes(k))
    );
    const seasonCols = [...Object.keys(filteredSeason), 'id', 'created_at'];
    const seasonVals = [...Object.values(filteredSeason), newSeasonId, now];
    const seasonPlaceholders = seasonCols.map(() => '?').join(', ');

    const insertSeasonStmt = env.DB
      .prepare(`INSERT INTO tenant_seasons (${seasonCols.join(', ')}) VALUES (${seasonPlaceholders})`)
      .bind(...seasonVals);

    // --- Bước 3: Chuẩn bị INSERT từng price row với season_id mới ---
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
          newSeasonId,                           // ← season mới
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

    // --- Bước 4: Chạy toàn bộ trong D1 batch (atomic transaction) ---
    // Nếu bất kỳ statement nào thất bại, D1 rollback toàn bộ
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
// calculateTourPrice — Pricing Engine với xử lý giao mùa + Infant support
// =============================================================================

/**
 * Tính giá tour cho một booking request cụ thể.
 *
 * Pax model:
 *  - adult_count  : người lớn (bắt buộc >= 1)
 *  - child_count  : trẻ em (mặc định 0)
 *  - infant_count : trẻ sơ sinh 0-2 tuổi (mặc định 0, không tính ghế)
 *  - pax_count    : legacy alias của adult_count (backward compat)
 *
 * Pax Band matching dùng adult_count + child_count (infants không tính ghế).
 *
 * Total = (adults × adult_shared_room_price)
 *       + (children × child_shared_with_parents_price)
 *       + (infants  × infant_price)
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
  pax_count,                           // legacy — backward compat
  adult_count,                         // legacy — all adults in shared rooms
  adult_shared_room_count,             // adults in shared occupancy
  adult_single_room_count = 0,         // adults in single occupancy (pays single supplement)
  adult_triple_room_count = 0,         // adults in triple occupancy
  child_count             = 0,
  infant_count            = 0,
  segment_id,
  timezone                = 'Asia/Ho_Chi_Minh',
  pricing_policy          = 'PRIORITY_HIGH_SEASON',
  infant_policy_text      = null,
  pricing_notes_text      = null,
}) {
  // --- Validate required ---
  if (!tenant_id || !tour_id || !date || !segment_id) {
    return { ok: false, error: 'Missing required fields: tenant_id, tour_id, date, segment_id.' };
  }

  // Rooming model (cascade: explicit rooming → adult_count → pax_count)
  const sharedAdults = adult_shared_room_count != null
    ? Number(adult_shared_room_count)
    : (adult_count != null ? Number(adult_count) : Number(pax_count ?? 1));
  const singleAdults = Number(adult_single_room_count ?? 0);
  const tripleAdults = Number(adult_triple_room_count ?? 0);
  const totalAdults  = sharedAdults + singleAdults + tripleAdults;
  const children     = Number(child_count  ?? 0);
  const infants      = Number(infant_count ?? 0);

  if (!Number.isInteger(sharedAdults) || sharedAdults < 0) return { ok: false, error: 'adult_shared_room_count must be a non-negative integer.' };
  if (!Number.isInteger(singleAdults) || singleAdults < 0) return { ok: false, error: 'adult_single_room_count must be a non-negative integer.' };
  if (!Number.isInteger(tripleAdults) || tripleAdults < 0) return { ok: false, error: 'adult_triple_room_count must be a non-negative integer.' };
  if (totalAdults < 1) return { ok: false, error: 'At least 1 adult is required.' };
  if (!Number.isInteger(children) || children < 0) return { ok: false, error: 'child_count must be a non-negative integer.' };
  if (!Number.isInteger(infants)  || infants  < 0) return { ok: false, error: 'infant_count must be a non-negative integer.' };

  const childRoomingValidation = validateChildRoomingCapacity(sharedAdults, singleAdults, tripleAdults, children);
  if (!childRoomingValidation.ok) {
    return { ok: false, error: childRoomingValidation.error, max_children: childRoomingValidation.max_children };
  }

  // effectivePax: dùng để khớp pax_band — infants không chiếm ghế
  const effectivePax = totalAdults + children;

  // Chuyển date → { month, day } theo múi giờ Tenant
  let monthDay;
  try {
    const { month, day } = toUserDate(date, timezone);
    monthDay = month * 100 + day; // VD: 325
  } catch {
    return { ok: false, error: `Invalid date format — expected YYYY-MM-DD (received: "${date}").` };
  }

  // --- Truy vấn JOIN — lấy TẤT CẢ Season hợp lệ để xử lý giao mùa ---
  const sql = `
    SELECT
      tp.id                             AS price_id,
      tp.season_id,
      tp.segment_id,
      tp.pax_band_id,
      tp.base_currency,
      tp.adult_shared_room_price,
      tp.adult_single_room_price,
      tp.adult_triple_room_price,
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

    // --- Xử lý giao mùa: chọn bản ghi tốt nhất theo pricing_policy ---
    const row = pricing_policy === 'PRIORITY_HIGH_SEASON'
      ? results.reduce((best, r) =>
          (r.adult_shared_room_price ?? 0) > (best.adult_shared_room_price ?? 0) ? r : best
        , results[0])
      : results[0];

    // --- Tính sub-totals theo Rooming Model ---
    const sharedSubtotal   = sharedAdults * (row.adult_shared_room_price         ?? 0);
    const singleSubtotal   = singleAdults * (row.adult_single_room_price         ?? 0);
    const tripleSubtotal   = tripleAdults * (row.adult_triple_room_price ?? row.adult_shared_room_price ?? 0);
    const childrenSubtotal = children     * (row.child_shared_with_parents_price ?? 0);
    const infantsSubtotal  = infants      * (row.infant_price                    ?? 0);
    const grandTotal       = sharedSubtotal + singleSubtotal + tripleSubtotal + childrenSubtotal + infantsSubtotal;

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
        adult_triple_room_count: tripleAdults,
        adult_single_room_count: singleAdults,
        child_count:             children,
        infant_count:            infants,
      },
      totals: {
        shared_room_subtotal:  sharedSubtotal,
        triple_room_subtotal:  tripleSubtotal,
        single_room_subtotal:  singleSubtotal,
        children_subtotal:     childrenSubtotal,
        infants_subtotal:      infantsSubtotal,
        grand_total:           grandTotal,
      },
      prices: {
        adult_shared_room:         row.adult_shared_room_price,
        adult_triple_room:         row.adult_triple_room_price ?? row.adult_shared_room_price,
        adult_single_room:         row.adult_single_room_price,
        child_shared_with_parents: row.child_shared_with_parents_price,
        infant:                    row.infant_price ?? 0,
      },
      infant_policy_text,
      pricing_notes_text,
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
// calculateAllSegmentsPrice — Compare-mode: tất cả segments trong 1 query
// =============================================================================

/**
 * Truy vấn giá cho TẤT CẢ pricing_segments đang active của tour — dùng khi
 * khách muốn so sánh Standard/Boutique/Premium trước khi chọn.
 *
 * SQL: giống calculateTourPrice nhưng KHÔNG có `AND tp.segment_id = ?`.
 * JS:  group by segment_id, áp pricing_policy per group, sort cheapest-first.
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
  adult_triple_room_count = 0,
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
  const tripleAdults = Number(adult_triple_room_count ?? 0);
  const totalAdults  = sharedAdults + singleAdults + tripleAdults;
  const children     = Number(child_count  ?? 0);
  const infants      = Number(infant_count ?? 0);

  if (totalAdults < 1) return { ok: false, error: 'At least 1 adult is required.' };
  const childRoomingValidation = validateChildRoomingCapacity(sharedAdults, singleAdults, tripleAdults, children);
  if (!childRoomingValidation.ok) {
    return { ok: false, error: childRoomingValidation.error, max_children: childRoomingValidation.max_children };
  }
  const effectivePax = totalAdults + children;

  let monthDay;
  try {
    const { month, day } = toUserDate(date, timezone);
    monthDay = month * 100 + day;
  } catch {
    return { ok: false, error: `Invalid date format — expected YYYY-MM-DD.` };
  }

  // Same JOIN as calculateTourPrice — WITHOUT the segment_id filter in WHERE
  const sql = `
    SELECT
      tp.id                             AS price_id,
      tp.season_id,
      tp.segment_id,
      tp.pax_band_id,
      tp.base_currency,
      tp.adult_shared_room_price,
      tp.adult_single_room_price,
      tp.adult_triple_room_price,
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

      const sharedSubtotal   = sharedAdults * (row.adult_shared_room_price                              ?? 0);
      const tripleSubtotal   = tripleAdults * (row.adult_triple_room_price ?? row.adult_shared_room_price ?? 0);
      const singleSubtotal   = singleAdults * (row.adult_single_room_price                              ?? 0);
      const childrenSubtotal = children     * (row.child_shared_with_parents_price                      ?? 0);
      const infantsSubtotal  = infants      * (row.infant_price                                         ?? 0);
      const grandTotal       = sharedSubtotal + tripleSubtotal + singleSubtotal + childrenSubtotal + infantsSubtotal;

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
          adult_triple_room_count: tripleAdults,
          adult_single_room_count: singleAdults,
          child_count:             children,
          infant_count:            infants,
        },
        totals: {
          shared_room_subtotal:  sharedSubtotal,
          triple_room_subtotal:  tripleSubtotal,
          single_room_subtotal:  singleSubtotal,
          children_subtotal:     childrenSubtotal,
          infants_subtotal:      infantsSubtotal,
          grand_total:           grandTotal,
        },
        prices: {
          adult_shared_room:         row.adult_shared_room_price,
          adult_triple_room:         row.adult_triple_room_price ?? row.adult_shared_room_price,
          adult_single_room:         row.adult_single_room_price,
          child_shared_with_parents: row.child_shared_with_parents_price,
          infant:                    row.infant_price ?? 0,
        },
        infant_policy_text,
        notes:      row.price_notes,
        matched_on: {
          date, month_day: monthDay,
          adult_shared_room_count: sharedAdults,
          adult_triple_room_count: tripleAdults,
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
        adult_triple_room_count: tripleAdults,
        adult_single_room_count: singleAdults,
        child_count: children, infant_count: infants, timezone,
      },
    };
  } catch (err) {
    console.error('[PRICING_ERROR] calculateAllSegmentsPrice', err);
    return { ok: false, error: 'Internal server error. Please try again later.' };
  }
}

