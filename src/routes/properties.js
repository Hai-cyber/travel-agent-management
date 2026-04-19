import { nanoid } from 'nanoid';
import { SESSION_COOKIE_NAME, getAuthSession } from '../lib/auth.js';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function resolveTenantId(request) {
  const tenantId = request.headers.get('X-Tenant-ID');
  return tenantId ? tenantId.trim() : null;
}

function parseJsonBody(request) {
  return request.json();
}

function readAuthTokenFromRequest(request) {
  const cookieHeader = request.headers.get('cookie') || '';
  const cookieMatch = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`));
  if (cookieMatch?.[1]) return decodeURIComponent(cookieMatch[1]);

  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization') || '';
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  return bearerMatch ? bearerMatch[1].trim() : '';
}

async function requireTenantActor(request, env, tenantId) {
  const token = readAuthTokenFromRequest(request);
  if (!token) {
    return { error: jsonResponse({ error: 'Authentication required.' }, 401) };
  }

  const session = await getAuthSession(env.DB, token);
  if (!session) {
    return { error: jsonResponse({ error: 'Session expired. Please log in again.' }, 401) };
  }

  if (tenantId && session.tenant_id !== tenantId) {
    return { error: jsonResponse({ error: 'Forbidden for this tenant.' }, 403) };
  }

  return { session };
}

function currentUnixSeconds() {
  return Math.floor(Date.now() / 1000);
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function parseDateUtc(value) {
  return new Date(`${value}T00:00:00Z`);
}

function formatDateUtc(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function enumerateStayDates(checkIn, checkOut) {
  const dates = [];
  for (let cursor = parseDateUtc(checkIn); cursor < parseDateUtc(checkOut); cursor = addDays(cursor, 1)) {
    dates.push(formatDateUtc(cursor));
  }
  return dates;
}

function enumerateDateRange(startDate, endDate) {
  const dates = [];
  for (let cursor = new Date(startDate.getTime()); cursor <= endDate; cursor = addDays(cursor, 1)) {
    dates.push(formatDateUtc(cursor));
  }
  return dates;
}

function rangesOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

function getOrCreateMap(map, key, factory = () => new Map()) {
  if (!map.has(key)) map.set(key, factory());
  return map.get(key);
}

function getOrCreateSetMap(map, key) {
  if (!map.has(key)) map.set(key, new Set());
  return map.get(key);
}

function countAllocatedUnitsByNight(allocationRows, roomUnitMap, stayDates) {
  const allowedDates = new Set(stayDates);
  const roomTypeNightCounts = new Map();
  const roomTypeNightUnits = new Map();

  for (const row of allocationRows || []) {
    if (!allowedDates.has(row.stay_date)) continue;
    const roomUnit = roomUnitMap.get(String(row.room_unit_id));
    if (!roomUnit) continue;

    const roomTypeCounts = getOrCreateMap(roomTypeNightCounts, String(roomUnit.room_type_id));
    const roomTypeUnits = getOrCreateMap(roomTypeNightUnits, String(roomUnit.room_type_id));
    const unitsForNight = getOrCreateSetMap(roomTypeUnits, row.stay_date);
    unitsForNight.add(String(row.room_unit_id));
    roomTypeCounts.set(row.stay_date, unitsForNight.size);
  }

  return { roomTypeNightCounts, roomTypeNightUnits };
}

function countHoldsByNight(holdRows, stayDates) {
  const holdCounts = new Map();
  const dateSet = new Set(stayDates);

  for (const row of holdRows || []) {
    const roomTypeId = String(row.room_type_id);
    const perNight = getOrCreateMap(holdCounts, roomTypeId);
    const holdDates = enumerateStayDates(row.check_in, row.check_out);
    for (const stayDate of holdDates) {
      if (!dateSet.has(stayDate)) continue;
      perNight.set(stayDate, (perNight.get(stayDate) || 0) + Number(row.rooms_requested || 0));
    }
  }

  return holdCounts;
}

function buildNightlyRemaining(roomTypes, roomUnitsByType, allocationCounts, holdCounts, stayDates) {
  const nightlyRemainingByType = new Map();

  for (const roomType of roomTypes) {
    const roomTypeId = String(roomType.id);
    const baseCount = (roomUnitsByType.get(roomTypeId) || []).length;
    const allocated = allocationCounts.get(roomTypeId) || new Map();
    const held = holdCounts.get(roomTypeId) || new Map();
    const rows = stayDates.map((stayDate) => {
      const remaining = baseCount - (allocated.get(stayDate) || 0) - (held.get(stayDate) || 0);
      return {
        stay_date: stayDate,
        remaining: Math.max(remaining, 0),
      };
    });
    nightlyRemainingByType.set(roomTypeId, rows);
  }

  return nightlyRemainingByType;
}

function collectShortageDates(nightlyRemaining, roomsRequested) {
  return (nightlyRemaining || []).filter((row) => row.remaining < roomsRequested).map((row) => row.stay_date);
}

function hasContiguousCapacity(nightlyRemaining, roomsRequested) {
  return (nightlyRemaining || []).every((row) => row.remaining >= roomsRequested);
}

function findContiguousUnits(roomUnits, occupiedDatesByUnit, stayDates, roomsRequested) {
  const candidates = [];
  for (const roomUnit of roomUnits || []) {
    const occupiedDates = occupiedDatesByUnit.get(String(roomUnit.id)) || new Set();
    const freeAllNights = stayDates.every((stayDate) => !occupiedDates.has(stayDate));
    if (freeAllNights) candidates.push(roomUnit);
    if (candidates.length >= roomsRequested) return candidates;
  }
  return candidates;
}

function buildSameTypeSplitSegments(roomUnits, occupiedDatesByUnit, stayDates, roomTypeId) {
  const availableUnitsByNight = new Map();
  for (const stayDate of stayDates) {
    const availableUnits = (roomUnits || []).filter((roomUnit) => {
      const occupiedDates = occupiedDatesByUnit.get(String(roomUnit.id)) || new Set();
      return !occupiedDates.has(stayDate);
    });
    availableUnitsByNight.set(stayDate, availableUnits);
  }

  const segments = [];
  let currentSegment = null;
  let currentUnitId = null;

  for (let index = 0; index < stayDates.length; index += 1) {
    const stayDate = stayDates[index];
    const availableUnits = availableUnitsByNight.get(stayDate) || [];
    if (!availableUnits.length) return [];

    const preferred = availableUnits.find((unit) => String(unit.id) === currentUnitId);
    const chosen = preferred || availableUnits[0];
    const nextDate = index + 1 < stayDates.length ? stayDates[index + 1] : null;

    if (!currentSegment || String(chosen.id) !== currentUnitId) {
      if (currentSegment) segments.push(currentSegment);
      currentSegment = {
        room_type_id: roomTypeId,
        room_unit_id: String(chosen.id),
        check_in: stayDate,
        check_out: nextDate || formatDateUtc(addDays(parseDateUtc(stayDate), 1)),
      };
      currentUnitId = String(chosen.id);
    } else {
      currentSegment.check_out = nextDate || formatDateUtc(addDays(parseDateUtc(stayDate), 1));
    }
  }

  if (currentSegment) segments.push(currentSegment);
  return segments;
}

function buildNearbyOptions(stayDatesByType, checkIn, checkOut, roomsRequested, windowDays = 3) {
  const options = [];
  const stayLength = enumerateStayDates(checkIn, checkOut).length;
  const requestedStart = parseDateUtc(checkIn);

  for (let offset = -windowDays; offset <= windowDays; offset += 1) {
    if (offset === 0) continue;
    const candidateCheckIn = formatDateUtc(addDays(requestedStart, offset));
    const candidateCheckOut = formatDateUtc(addDays(parseDateUtc(candidateCheckIn), stayLength));
    const candidateDates = enumerateStayDates(candidateCheckIn, candidateCheckOut);
    const rows = candidateDates.map((stayDate) => stayDatesByType.find((row) => row.stay_date === stayDate)).filter(Boolean);
    if (rows.length !== candidateDates.length) continue;
    if (rows.every((row) => row.remaining >= roomsRequested)) {
      options.push({ check_in: candidateCheckIn, check_out: candidateCheckOut });
    }
  }

  return options;
}

function rankUpgradeRoomTypes(roomTypes, requestedRoomType) {
  const requestedSort = Number(requestedRoomType.sort_order || 0);
  return roomTypes
    .filter((roomType) => String(roomType.id) !== String(requestedRoomType.id))
    .map((roomType) => ({
      roomType,
      delta: Number(roomType.sort_order || 0) - requestedSort,
    }))
    .sort((a, b) => {
      const aPositive = a.delta >= 0 ? a.delta : Number.MAX_SAFE_INTEGER;
      const bPositive = b.delta >= 0 ? b.delta : Number.MAX_SAFE_INTEGER;
      if (aPositive !== bPositive) return aPositive - bPositive;
      return Math.abs(a.delta) - Math.abs(b.delta);
    })
    .map((entry) => entry.roomType);
}

function buildPlan(planType, score, moveCount, upgradeSegments, publicVisible, segments, opsNotes = []) {
  return {
    plan_type: planType,
    score,
    move_count: moveCount,
    upgrade_segments: upgradeSegments,
    public_visible: publicVisible,
    segments,
    ops_notes: opsNotes,
  };
}

const PROPERTY_RESERVATION_SOURCES = new Set([
  'direct_web',
  'direct_widget',
  'ota_forwarded',
  'manual_frontdesk',
  'manual_phone',
  'manual_agent',
  'manual_message',
]);

const PROPERTY_STATUSES = new Set(['draft', 'active', 'inactive']);
const PROPERTY_UPGRADE_MODES = new Set(['off', 'suggest_only', 'auto_if_penalty_better']);
const ROOM_UNIT_OPERATIONAL_STATUSES = new Set(['ready', 'maintenance', 'out_of_order']);

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function isTimeString(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim());
}

function normalizeBooleanInteger(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === 1 || value === '1') return 1;
  if (value === 0 || value === '0') return 0;
  return Number(value) ? 1 : 0;
}

function normalizeInteger(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  return Number(value);
}

function parseJsonSafe(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function roomNumberFromSequence(prefix, number) {
  return `${prefix || ''}${String(number)}`;
}

function mapPropertyRow(row) {
  return {
    ...row,
    split_stay_enabled: Boolean(row.split_stay_enabled),
    split_stay_public_visible: Boolean(row.split_stay_public_visible),
    allow_upgrade_to_preserve_stay: Boolean(row.allow_upgrade_to_preserve_stay),
    same_day_turnover_sellable: Boolean(row.same_day_turnover_sellable),
  };
}

function mapRoomTypeRow(row) {
  return {
    ...row,
    active: Boolean(row.active),
  };
}

function mapRoomUnitRow(row) {
  return {
    ...row,
    active: Boolean(row.active),
  };
}

function mapRoomRateRow(row) {
  return {
    ...row,
    active: Boolean(row.active),
  };
}

function mapRateSeasonRow(row) {
  return {
    ...row,
    active: Boolean(row.active),
  };
}

function mapSeasonRateRow(row) {
  return {
    ...row,
    active: Boolean(row.active),
  };
}

function validatePropertyCreateRequest(body) {
  const name = String(body?.name || '').trim();
  const slug = String(body?.slug || slugify(name)).trim();
  const status = String(body?.status || 'active').trim();
  const timezone = String(body?.timezone || 'Asia/Ho_Chi_Minh').trim();
  const currency = String(body?.currency || 'VND').trim();
  const defaultCheckInTime = String(body?.default_check_in_time || '14:00').trim();
  const defaultCheckOutTime = String(body?.default_check_out_time || '11:00').trim();
  const upgradeMode = String(body?.upgrade_mode || 'suggest_only').trim();
  const maxRoomMovesPerReservation = normalizeInteger(body?.max_room_moves_per_reservation, 1);
  const maxUpgradeSegmentsPerStay = normalizeInteger(body?.max_upgrade_segments_per_stay, 1);
  const maxUpgradeLevelJump = normalizeInteger(body?.max_upgrade_level_jump, 1);

  if (!name) return { error: 'name is required.' };
  if (!slug) return { error: 'slug is required.' };
  if (!PROPERTY_STATUSES.has(status)) return { error: 'status is invalid.' };
  if (!isTimeString(defaultCheckInTime) || !isTimeString(defaultCheckOutTime)) {
    return { error: 'default_check_in_time and default_check_out_time must use HH:MM format.' };
  }
  if (!PROPERTY_UPGRADE_MODES.has(upgradeMode)) return { error: 'upgrade_mode is invalid.' };
  if (![maxRoomMovesPerReservation, maxUpgradeSegmentsPerStay, maxUpgradeLevelJump].every(Number.isInteger)) {
    return { error: 'max_room_moves_per_reservation, max_upgrade_segments_per_stay, and max_upgrade_level_jump must be integers.' };
  }

  return {
    name,
    slug,
    status,
    timezone,
    currency,
    defaultCheckInTime,
    defaultCheckOutTime,
    splitStayEnabled: normalizeBooleanInteger(body?.split_stay_enabled, 1),
    splitStayPublicVisible: normalizeBooleanInteger(body?.split_stay_public_visible, 0),
    allowUpgradeToPreserveStay: normalizeBooleanInteger(body?.allow_upgrade_to_preserve_stay, 1),
    upgradeMode,
    maxRoomMovesPerReservation,
    maxUpgradeSegmentsPerStay,
    maxUpgradeLevelJump,
    sameDayTurnoverSellable: normalizeBooleanInteger(body?.same_day_turnover_sellable, 0),
  };
}

function validatePropertyPatchRequest(body) {
  const allowed = new Set([
    'name', 'slug', 'status', 'timezone', 'currency', 'default_check_in_time', 'default_check_out_time',
    'split_stay_enabled', 'split_stay_public_visible', 'allow_upgrade_to_preserve_stay', 'upgrade_mode',
    'max_room_moves_per_reservation', 'max_upgrade_segments_per_stay', 'max_upgrade_level_jump', 'same_day_turnover_sellable',
  ]);
  const keys = Object.keys(body || {});
  if (!keys.length) return { error: 'No fields provided for update.' };
  const unknown = keys.filter((key) => !allowed.has(key));
  if (unknown.length) return { error: `Unknown fields: ${unknown.join(', ')}.` };

  const updates = {};
  if ('name' in body) {
    const value = String(body.name || '').trim();
    if (!value) return { error: 'name cannot be empty.' };
    updates.name = value;
  }
  if ('slug' in body) {
    const value = String(body.slug || '').trim();
    if (!value) return { error: 'slug cannot be empty.' };
    updates.slug = value;
  }
  if ('status' in body) {
    const value = String(body.status || '').trim();
    if (!PROPERTY_STATUSES.has(value)) return { error: 'status is invalid.' };
    updates.status = value;
  }
  if ('timezone' in body) updates.timezone = String(body.timezone || '').trim();
  if ('currency' in body) updates.currency = String(body.currency || '').trim();
  if ('default_check_in_time' in body) {
    const value = String(body.default_check_in_time || '').trim();
    if (!isTimeString(value)) return { error: 'default_check_in_time must use HH:MM format.' };
    updates.default_check_in_time = value;
  }
  if ('default_check_out_time' in body) {
    const value = String(body.default_check_out_time || '').trim();
    if (!isTimeString(value)) return { error: 'default_check_out_time must use HH:MM format.' };
    updates.default_check_out_time = value;
  }
  if ('split_stay_enabled' in body) updates.split_stay_enabled = normalizeBooleanInteger(body.split_stay_enabled);
  if ('split_stay_public_visible' in body) updates.split_stay_public_visible = normalizeBooleanInteger(body.split_stay_public_visible);
  if ('allow_upgrade_to_preserve_stay' in body) updates.allow_upgrade_to_preserve_stay = normalizeBooleanInteger(body.allow_upgrade_to_preserve_stay);
  if ('upgrade_mode' in body) {
    const value = String(body.upgrade_mode || '').trim();
    if (!PROPERTY_UPGRADE_MODES.has(value)) return { error: 'upgrade_mode is invalid.' };
    updates.upgrade_mode = value;
  }
  for (const key of ['max_room_moves_per_reservation', 'max_upgrade_segments_per_stay', 'max_upgrade_level_jump']) {
    if (key in body) {
      const value = Number(body[key]);
      if (!Number.isInteger(value)) return { error: `${key} must be an integer.` };
      updates[key] = value;
    }
  }
  if ('same_day_turnover_sellable' in body) updates.same_day_turnover_sellable = normalizeBooleanInteger(body.same_day_turnover_sellable);

  return { updates };
}

function validateRoomTypeCreateRequest(body) {
  const code = String(body?.code || '').trim();
  const name = String(body?.name || '').trim();
  const description = body?.description ? String(body.description).trim() : null;
  const baseCapacity = normalizeInteger(body?.base_capacity, 1);
  const maxOccupancy = normalizeInteger(body?.max_occupancy, 1);
  const sortOrder = normalizeInteger(body?.sort_order, 0);

  if (!code || !name) return { error: 'code and name are required.' };
  if (![baseCapacity, maxOccupancy, sortOrder].every(Number.isInteger)) {
    return { error: 'base_capacity, max_occupancy, and sort_order must be integers.' };
  }

  return {
    code,
    name,
    description,
    baseCapacity,
    maxOccupancy,
    sortOrder,
    active: normalizeBooleanInteger(body?.active, 1),
  };
}

function validateRoomTypePatchRequest(body) {
  const allowed = new Set(['code', 'name', 'description', 'base_capacity', 'max_occupancy', 'sort_order', 'active']);
  const keys = Object.keys(body || {});
  if (!keys.length) return { error: 'No fields provided for update.' };
  const unknown = keys.filter((key) => !allowed.has(key));
  if (unknown.length) return { error: `Unknown fields: ${unknown.join(', ')}.` };

  const updates = {};
  if ('code' in body) {
    const value = String(body.code || '').trim();
    if (!value) return { error: 'code cannot be empty.' };
    updates.code = value;
  }
  if ('name' in body) {
    const value = String(body.name || '').trim();
    if (!value) return { error: 'name cannot be empty.' };
    updates.name = value;
  }
  if ('description' in body) updates.description = body.description ? String(body.description).trim() : null;
  for (const key of ['base_capacity', 'max_occupancy', 'sort_order']) {
    if (key in body) {
      const value = Number(body[key]);
      if (!Number.isInteger(value)) return { error: `${key} must be an integer.` };
      updates[key] = value;
    }
  }
  if ('active' in body) updates.active = normalizeBooleanInteger(body.active);
  return { updates };
}

function validateRoomUnitCreateRequest(body) {
  const roomTypeId = String(body?.room_type_id || '').trim();
  const roomNumber = String(body?.room_number || '').trim();
  const floorLabel = body?.floor_label ? String(body.floor_label).trim() : null;
  const sortOrder = normalizeInteger(body?.sort_order, 0);
  const operationalStatus = String(body?.operational_status || 'ready').trim();

  if (!roomTypeId || !roomNumber) return { error: 'room_type_id and room_number are required.' };
  if (!Number.isInteger(sortOrder)) return { error: 'sort_order must be an integer.' };
  if (!ROOM_UNIT_OPERATIONAL_STATUSES.has(operationalStatus)) return { error: 'operational_status is invalid.' };

  return {
    roomTypeId,
    roomNumber,
    floorLabel,
    sortOrder,
    active: normalizeBooleanInteger(body?.active, 1),
    operationalStatus,
  };
}

function validateRoomUnitPatchRequest(body) {
  const allowed = new Set(['room_type_id', 'room_number', 'floor_label', 'sort_order', 'active', 'operational_status']);
  const keys = Object.keys(body || {});
  if (!keys.length) return { error: 'No fields provided for update.' };
  const unknown = keys.filter((key) => !allowed.has(key));
  if (unknown.length) return { error: `Unknown fields: ${unknown.join(', ')}.` };

  const updates = {};
  if ('room_type_id' in body) {
    const value = String(body.room_type_id || '').trim();
    if (!value) return { error: 'room_type_id cannot be empty.' };
    updates.room_type_id = value;
  }
  if ('room_number' in body) {
    const value = String(body.room_number || '').trim();
    if (!value) return { error: 'room_number cannot be empty.' };
    updates.room_number = value;
  }
  if ('floor_label' in body) updates.floor_label = body.floor_label ? String(body.floor_label).trim() : null;
  if ('sort_order' in body) {
    const value = Number(body.sort_order);
    if (!Number.isInteger(value)) return { error: 'sort_order must be an integer.' };
    updates.sort_order = value;
  }
  if ('active' in body) updates.active = normalizeBooleanInteger(body.active);
  if ('operational_status' in body) {
    const value = String(body.operational_status || '').trim();
    if (!ROOM_UNIT_OPERATIONAL_STATUSES.has(value)) return { error: 'operational_status is invalid.' };
    updates.operational_status = value;
  }
  return { updates };
}

function validateRoomUnitBulkCreateRequest(body) {
  const roomTypeId = String(body?.room_type_id || '').trim();
  const count = Number(body?.count || 0);
  const startNumber = Number(body?.start_number || 1);
  const prefix = body?.prefix !== undefined ? String(body.prefix) : '';
  const floorLabel = body?.floor_label ? String(body.floor_label).trim() : null;
  const sortOrderStart = Number(body?.sort_order_start || 0);

  if (!roomTypeId) return { error: 'room_type_id is required.' };
  if (!Number.isInteger(count) || count < 1 || count > 500) return { error: 'count must be an integer between 1 and 500.' };
  if (!Number.isInteger(startNumber) || startNumber < 0) return { error: 'start_number must be an integer greater than or equal to 0.' };
  if (!Number.isInteger(sortOrderStart)) return { error: 'sort_order_start must be an integer.' };

  return {
    roomTypeId,
    count,
    startNumber,
    prefix,
    floorLabel,
    sortOrderStart,
    active: normalizeBooleanInteger(body?.active, 1),
    operationalStatus: String(body?.operational_status || 'ready').trim(),
  };
}

function validateRoomRateCreateRequest(body) {
  const roomTypeId = String(body?.room_type_id || '').trim();
  const rateName = String(body?.rate_name || 'Standard Rate').trim();
  const currency = String(body?.currency || 'VND').trim().toUpperCase();
  const nightlyAmount = Number(body?.nightly_amount);
  const includedAdults = normalizeInteger(body?.included_adults, 2);
  const includedChildren = normalizeInteger(body?.included_children, 0);
  const extraAdultAmount = Number(body?.extra_adult_amount ?? 0);
  const extraChildAmount = Number(body?.extra_child_amount ?? 0);

  if (!roomTypeId) return { error: 'room_type_id is required.' };
  if (!rateName) return { error: 'rate_name is required.' };
  if (!Number.isFinite(nightlyAmount) || nightlyAmount < 0) return { error: 'nightly_amount must be a number greater than or equal to 0.' };
  if (![includedAdults, includedChildren].every(Number.isInteger) || includedAdults < 1 || includedChildren < 0) {
    return { error: 'included_adults must be at least 1 and included_children must be 0 or greater.' };
  }
  if (![extraAdultAmount, extraChildAmount].every(Number.isFinite) || extraAdultAmount < 0 || extraChildAmount < 0) {
    return { error: 'extra_adult_amount and extra_child_amount must be numbers greater than or equal to 0.' };
  }

  return {
    roomTypeId,
    rateName,
    currency,
    nightlyAmount,
    includedAdults,
    includedChildren,
    extraAdultAmount,
    extraChildAmount,
    active: normalizeBooleanInteger(body?.active, 1),
  };
}

function validateRoomRatePatchRequest(body) {
  const allowed = new Set(['rate_name', 'currency', 'nightly_amount', 'included_adults', 'included_children', 'extra_adult_amount', 'extra_child_amount', 'active']);
  const keys = Object.keys(body || {});
  if (!keys.length) return { error: 'No fields provided for update.' };
  const unknown = keys.filter((key) => !allowed.has(key));
  if (unknown.length) return { error: `Unknown fields: ${unknown.join(', ')}.` };

  const updates = {};
  if ('rate_name' in body) {
    const value = String(body.rate_name || '').trim();
    if (!value) return { error: 'rate_name cannot be empty.' };
    updates.rate_name = value;
  }
  if ('currency' in body) {
    const value = String(body.currency || '').trim().toUpperCase();
    if (!value) return { error: 'currency cannot be empty.' };
    updates.currency = value;
  }
  if ('nightly_amount' in body) {
    const value = Number(body.nightly_amount);
    if (!Number.isFinite(value) || value < 0) return { error: 'nightly_amount must be a number greater than or equal to 0.' };
    updates.nightly_amount = value;
  }
  if ('included_adults' in body) {
    const value = Number(body.included_adults);
    if (!Number.isInteger(value) || value < 1) return { error: 'included_adults must be an integer greater than or equal to 1.' };
    updates.included_adults = value;
  }
  if ('included_children' in body) {
    const value = Number(body.included_children);
    if (!Number.isInteger(value) || value < 0) return { error: 'included_children must be an integer greater than or equal to 0.' };
    updates.included_children = value;
  }
  if ('extra_adult_amount' in body) {
    const value = Number(body.extra_adult_amount);
    if (!Number.isFinite(value) || value < 0) return { error: 'extra_adult_amount must be a number greater than or equal to 0.' };
    updates.extra_adult_amount = value;
  }
  if ('extra_child_amount' in body) {
    const value = Number(body.extra_child_amount);
    if (!Number.isFinite(value) || value < 0) return { error: 'extra_child_amount must be a number greater than or equal to 0.' };
    updates.extra_child_amount = value;
  }
  if ('active' in body) updates.active = normalizeBooleanInteger(body.active);
  return { updates };
}

function validateRateSeasonCreateRequest(body) {
  const name = String(body?.name || '').trim();
  const startDate = String(body?.start_date || '').trim();
  const endDate = String(body?.end_date || '').trim();
  const sortOrder = normalizeInteger(body?.sort_order, 0);

  if (!name) return { error: 'name is required.' };
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) return { error: 'start_date and end_date must use YYYY-MM-DD format.' };
  if (parseDateUtc(startDate) > parseDateUtc(endDate)) return { error: 'start_date must be on or before end_date.' };
  if (!Number.isInteger(sortOrder)) return { error: 'sort_order must be an integer.' };

  return {
    name,
    startDate,
    endDate,
    sortOrder,
    active: normalizeBooleanInteger(body?.active, 1),
  };
}

function validateRateSeasonPatchRequest(body) {
  const allowed = new Set(['name', 'start_date', 'end_date', 'sort_order', 'active']);
  const keys = Object.keys(body || {});
  if (!keys.length) return { error: 'No fields provided for update.' };
  const unknown = keys.filter((key) => !allowed.has(key));
  if (unknown.length) return { error: `Unknown fields: ${unknown.join(', ')}.` };

  const updates = {};
  if ('name' in body) {
    const value = String(body.name || '').trim();
    if (!value) return { error: 'name cannot be empty.' };
    updates.name = value;
  }
  if ('start_date' in body) {
    const value = String(body.start_date || '').trim();
    if (!isIsoDate(value)) return { error: 'start_date must use YYYY-MM-DD format.' };
    updates.start_date = value;
  }
  if ('end_date' in body) {
    const value = String(body.end_date || '').trim();
    if (!isIsoDate(value)) return { error: 'end_date must use YYYY-MM-DD format.' };
    updates.end_date = value;
  }
  if (updates.start_date && updates.end_date && parseDateUtc(updates.start_date) > parseDateUtc(updates.end_date)) {
    return { error: 'start_date must be on or before end_date.' };
  }
  if ('sort_order' in body) {
    const value = Number(body.sort_order);
    if (!Number.isInteger(value)) return { error: 'sort_order must be an integer.' };
    updates.sort_order = value;
  }
  if ('active' in body) updates.active = normalizeBooleanInteger(body.active);
  return { updates };
}

function validateSeasonRoomRateCreateRequest(body) {
  const seasonId = String(body?.season_id || '').trim();
  const roomTypeId = String(body?.room_type_id || '').trim();
  const currency = String(body?.currency || 'VND').trim().toUpperCase();
  const nightlyAmount = Number(body?.nightly_amount);
  const includedAdults = normalizeInteger(body?.included_adults, 2);
  const includedChildren = normalizeInteger(body?.included_children, 0);
  const extraAdultAmount = Number(body?.extra_adult_amount ?? 0);
  const extraChildAmount = Number(body?.extra_child_amount ?? 0);

  if (!seasonId || !roomTypeId) return { error: 'season_id and room_type_id are required.' };
  if (!Number.isFinite(nightlyAmount) || nightlyAmount < 0) return { error: 'nightly_amount must be a number greater than or equal to 0.' };
  if (![includedAdults, includedChildren].every(Number.isInteger) || includedAdults < 1 || includedChildren < 0) {
    return { error: 'included_adults must be at least 1 and included_children must be 0 or greater.' };
  }
  if (![extraAdultAmount, extraChildAmount].every(Number.isFinite) || extraAdultAmount < 0 || extraChildAmount < 0) {
    return { error: 'extra_adult_amount and extra_child_amount must be numbers greater than or equal to 0.' };
  }

  return {
    seasonId,
    roomTypeId,
    currency,
    nightlyAmount,
    includedAdults,
    includedChildren,
    extraAdultAmount,
    extraChildAmount,
    active: normalizeBooleanInteger(body?.active, 1),
  };
}

function validateSeasonRoomRatePatchRequest(body) {
  const allowed = new Set(['currency', 'nightly_amount', 'included_adults', 'included_children', 'extra_adult_amount', 'extra_child_amount', 'active']);
  const keys = Object.keys(body || {});
  if (!keys.length) return { error: 'No fields provided for update.' };
  const unknown = keys.filter((key) => !allowed.has(key));
  if (unknown.length) return { error: `Unknown fields: ${unknown.join(', ')}.` };

  const updates = {};
  if ('currency' in body) {
    const value = String(body.currency || '').trim().toUpperCase();
    if (!value) return { error: 'currency cannot be empty.' };
    updates.currency = value;
  }
  if ('nightly_amount' in body) {
    const value = Number(body.nightly_amount);
    if (!Number.isFinite(value) || value < 0) return { error: 'nightly_amount must be a number greater than or equal to 0.' };
    updates.nightly_amount = value;
  }
  if ('included_adults' in body) {
    const value = Number(body.included_adults);
    if (!Number.isInteger(value) || value < 1) return { error: 'included_adults must be an integer greater than or equal to 1.' };
    updates.included_adults = value;
  }
  if ('included_children' in body) {
    const value = Number(body.included_children);
    if (!Number.isInteger(value) || value < 0) return { error: 'included_children must be an integer greater than or equal to 0.' };
    updates.included_children = value;
  }
  if ('extra_adult_amount' in body) {
    const value = Number(body.extra_adult_amount);
    if (!Number.isFinite(value) || value < 0) return { error: 'extra_adult_amount must be a number greater than or equal to 0.' };
    updates.extra_adult_amount = value;
  }
  if ('extra_child_amount' in body) {
    const value = Number(body.extra_child_amount);
    if (!Number.isFinite(value) || value < 0) return { error: 'extra_child_amount must be a number greater than or equal to 0.' };
    updates.extra_child_amount = value;
  }
  if ('active' in body) updates.active = normalizeBooleanInteger(body.active);
  return { updates };
}

function validateRateQuoteRequest(body, propertyId) {
  const property = String(propertyId || '').trim();
  const roomTypeId = String(body?.room_type_id || '').trim();
  const checkIn = String(body?.check_in || '').trim();
  const checkOut = String(body?.check_out || '').trim();
  const adults = Number(body?.adults ?? 2);
  const children = Number(body?.children ?? 0);
  const roomsRequested = Number(body?.rooms_requested ?? 1);

  if (!property) return { error: 'propertyId is required.' };
  if (!roomTypeId) return { error: 'room_type_id is required.' };
  if (!isIsoDate(checkIn) || !isIsoDate(checkOut)) return { error: 'check_in and check_out must use YYYY-MM-DD format.' };
  if (parseDateUtc(checkIn) >= parseDateUtc(checkOut)) return { error: 'check_out must be after check_in.' };
  if (!Number.isInteger(adults) || adults < 1) return { error: 'adults must be an integer greater than or equal to 1.' };
  if (!Number.isInteger(children) || children < 0) return { error: 'children must be an integer greater than or equal to 0.' };
  if (!Number.isInteger(roomsRequested) || roomsRequested < 1 || roomsRequested > 20) {
    return { error: 'rooms_requested must be an integer between 1 and 20.' };
  }

  return { propertyId: property, roomTypeId, checkIn, checkOut, adults, children, roomsRequested };
}

function validateEarlyCheckoutRequest(body, reservation) {
  const effectiveCheckOut = String(body?.effective_check_out || '').trim();
  if (!isIsoDate(effectiveCheckOut)) return { error: 'effective_check_out must use YYYY-MM-DD format.' };
  if (parseDateUtc(effectiveCheckOut) <= parseDateUtc(reservation.check_in)) {
    return { error: 'effective_check_out must be after the reservation check_in date.' };
  }
  if (parseDateUtc(effectiveCheckOut) > parseDateUtc(reservation.check_out)) {
    return { error: 'effective_check_out cannot be later than the current reservation check_out.' };
  }
  return { effectiveCheckOut };
}

function validateAvailabilityRequest(body, propertyId) {
  const checkIn = String(body?.check_in || '').trim();
  const checkOut = String(body?.check_out || '').trim();
  const roomTypeId = String(body?.room_type_id || '').trim();
  const roomsRequested = Number(body?.rooms_requested || 1);
  const normalizedPropertyId = String(propertyId || '').trim();

  if (!normalizedPropertyId || !roomTypeId || !isIsoDate(checkIn) || !isIsoDate(checkOut)) {
    return { error: 'propertyId, room_type_id, check_in, and check_out are required.' };
  }
  if (!Number.isInteger(roomsRequested) || roomsRequested < 1) {
    return { error: 'rooms_requested must be an integer greater than 0.' };
  }
  if (parseDateUtc(checkOut) <= parseDateUtc(checkIn)) {
    return { error: 'check_out must be later than check_in.' };
  }

  return {
    propertyId: normalizedPropertyId,
    roomTypeId,
    checkIn,
    checkOut,
    roomsRequested,
  };
}

async function loadPropertyContext(env, tenantId, propertyId, roomTypeId) {
  const property = await env.DB
    .prepare(
      `SELECT id, tenant_id, name, slug, split_stay_enabled, split_stay_public_visible,
              allow_upgrade_to_preserve_stay, upgrade_mode, max_room_moves_per_reservation,
              max_upgrade_segments_per_stay, max_upgrade_level_jump, same_day_turnover_sellable
         FROM properties
        WHERE id = ? AND tenant_id = ?`
    )
    .bind(propertyId, tenantId)
    .first();

  if (!property) return { property: null, roomTypes: [], requestedRoomType: null };

  const roomTypesResult = await env.DB
    .prepare(
      `SELECT id, tenant_id, property_id, code, name, description, base_capacity, max_occupancy, sort_order, active
         FROM room_types
        WHERE tenant_id = ? AND property_id = ? AND active = 1
        ORDER BY sort_order ASC, name ASC`
    )
    .bind(tenantId, propertyId)
    .all();

  const roomTypes = roomTypesResult.results || [];
  const requestedRoomType = roomTypes.find((roomType) => String(roomType.id) === String(roomTypeId)) || null;
  return { property, roomTypes, requestedRoomType };
}

async function loadPropertyById(env, tenantId, propertyId) {
  const row = await env.DB
    .prepare(
      `SELECT id, tenant_id, name, slug, status, timezone, currency,
              default_check_in_time, default_check_out_time,
              split_stay_enabled, split_stay_public_visible,
              allow_upgrade_to_preserve_stay, upgrade_mode,
              max_room_moves_per_reservation, max_upgrade_segments_per_stay, max_upgrade_level_jump,
              same_day_turnover_sellable, created_at, updated_at
         FROM properties
        WHERE id = ? AND tenant_id = ?`
    )
    .bind(propertyId, tenantId)
    .first();
  return row ? mapPropertyRow(row) : null;
}

async function loadRoomTypeById(env, tenantId, propertyId, roomTypeId) {
  const row = await env.DB
    .prepare(
      `SELECT id, tenant_id, property_id, code, name, description, base_capacity, max_occupancy, sort_order, active, created_at, updated_at
         FROM room_types
        WHERE id = ? AND tenant_id = ? AND property_id = ?`
    )
    .bind(roomTypeId, tenantId, propertyId)
    .first();
  return row ? mapRoomTypeRow(row) : null;
}

async function loadRoomUnitById(env, tenantId, propertyId, roomUnitId) {
  const row = await env.DB
    .prepare(
      `SELECT id, tenant_id, property_id, room_type_id, room_number, floor_label, sort_order, active, operational_status, created_at, updated_at
         FROM room_units
        WHERE id = ? AND tenant_id = ? AND property_id = ?`
    )
    .bind(roomUnitId, tenantId, propertyId)
    .first();
  return row ? mapRoomUnitRow(row) : null;
}

async function loadRoomRateById(env, tenantId, propertyId, roomRateId) {
  const row = await env.DB
    .prepare(
      `SELECT id, tenant_id, property_id, room_type_id, rate_name, currency, nightly_amount,
              included_adults, included_children, extra_adult_amount, extra_child_amount,
              active, created_at, updated_at
         FROM property_room_rates
        WHERE id = ? AND tenant_id = ? AND property_id = ?`
    )
    .bind(roomRateId, tenantId, propertyId)
    .first();
  return row ? mapRoomRateRow(row) : null;
}

async function loadRateSeasonById(env, tenantId, propertyId, seasonId) {
  const row = await env.DB
    .prepare(
      `SELECT id, tenant_id, property_id, name, start_date, end_date, sort_order, active, created_at, updated_at
         FROM property_rate_seasons
        WHERE id = ? AND tenant_id = ? AND property_id = ?`
    )
    .bind(seasonId, tenantId, propertyId)
    .first();
  return row ? mapRateSeasonRow(row) : null;
}

async function loadSeasonRoomRateById(env, tenantId, propertyId, seasonRoomRateId) {
  const row = await env.DB
    .prepare(
      `SELECT id, tenant_id, property_id, season_id, room_type_id, currency, nightly_amount,
              included_adults, included_children, extra_adult_amount, extra_child_amount,
              active, created_at, updated_at
         FROM property_room_rate_season_prices
        WHERE id = ? AND tenant_id = ? AND property_id = ?`
    )
    .bind(seasonRoomRateId, tenantId, propertyId)
    .first();
  return row ? mapSeasonRateRow(row) : null;
}

function resolveNightlyRateForDate(stayDate, activeSeasons, seasonRatesByKey, baseRate) {
  const matchingSeason = activeSeasons.find((season) => stayDate >= season.start_date && stayDate <= season.end_date);
  if (matchingSeason) {
    const seasonRate = seasonRatesByKey.get(`${matchingSeason.id}`);
    if (seasonRate?.active) {
      return {
        source: 'season_rate',
        season_id: matchingSeason.id,
        season_name: matchingSeason.name,
        currency: seasonRate.currency,
        nightly_amount: Number(seasonRate.nightly_amount),
        included_adults: Number(seasonRate.included_adults ?? 2),
        included_children: Number(seasonRate.included_children ?? 0),
        extra_adult_amount: Number(seasonRate.extra_adult_amount ?? 0),
        extra_child_amount: Number(seasonRate.extra_child_amount ?? 0),
      };
    }
  }
  if (baseRate?.active) {
    return {
      source: 'base_rate',
      season_id: null,
      season_name: null,
      currency: baseRate.currency,
      nightly_amount: Number(baseRate.nightly_amount),
      included_adults: Number(baseRate.included_adults ?? 2),
      included_children: Number(baseRate.included_children ?? 0),
      extra_adult_amount: Number(baseRate.extra_adult_amount ?? 0),
      extra_child_amount: Number(baseRate.extra_child_amount ?? 0),
    };
  }
  return null;
}

function calculateOccupancyAdjustment(resolvedRate, adults, children, roomsRequested = 1) {
  if (!resolvedRate) {
    return {
      included_adults_total: 0,
      included_children_total: 0,
      extra_adults: 0,
      extra_children: 0,
      extra_adult_amount: 0,
      extra_child_amount: 0,
      adjustment_amount: 0,
    };
  }

  const includedAdultsTotal = Number(resolvedRate.included_adults || 0) * Number(roomsRequested || 1);
  const includedChildrenTotal = Number(resolvedRate.included_children || 0) * Number(roomsRequested || 1);
  const extraAdults = Math.max(0, Number(adults || 0) - includedAdultsTotal);
  const extraChildren = Math.max(0, Number(children || 0) - includedChildrenTotal);
  const extraAdultAmount = Number(resolvedRate.extra_adult_amount || 0);
  const extraChildAmount = Number(resolvedRate.extra_child_amount || 0);
  const adjustmentAmount = extraAdults * extraAdultAmount + extraChildren * extraChildAmount;

  return {
    included_adults_total: includedAdultsTotal,
    included_children_total: includedChildrenTotal,
    extra_adults: extraAdults,
    extra_children: extraChildren,
    extra_adult_amount: extraAdultAmount,
    extra_child_amount: extraChildAmount,
    adjustment_amount: adjustmentAmount,
  };
}

function buildDynamicUpdateSql(tableName, updates) {
  const columns = Object.keys(updates);
  const assignments = columns.map((column) => `${column} = ?`);
  return {
    sql: `UPDATE ${tableName} SET ${assignments.join(', ')}, updated_at = ?`,
    values: columns.map((column) => updates[column]),
  };
}

function mapBuilderSqlError(error) {
  const message = String(error?.message || '');
  if (message.includes('UNIQUE constraint failed')) {
    return { status: 409, payload: { error: 'A record with the same unique key already exists.' } };
  }
  if (message.includes('FOREIGN KEY constraint failed')) {
    return { status: 409, payload: { error: 'Referenced property or room type was not found.' } };
  }
  return null;
}

export async function handleListProperties(request, env) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);

  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  try {
    const result = await env.DB
      .prepare(
        `SELECT p.id, p.tenant_id, p.name, p.slug, p.status, p.timezone, p.currency,
                p.default_check_in_time, p.default_check_out_time,
                p.split_stay_enabled, p.split_stay_public_visible,
                p.allow_upgrade_to_preserve_stay, p.upgrade_mode,
                p.max_room_moves_per_reservation, p.max_upgrade_segments_per_stay, p.max_upgrade_level_jump,
                p.same_day_turnover_sellable, p.created_at, p.updated_at,
                (SELECT COUNT(*) FROM room_types rt WHERE rt.tenant_id = p.tenant_id AND rt.property_id = p.id) AS room_type_count,
                (SELECT COUNT(*) FROM room_units ru WHERE ru.tenant_id = p.tenant_id AND ru.property_id = p.id) AS room_unit_count
           FROM properties p
          WHERE p.tenant_id = ?
          ORDER BY p.created_at DESC, p.name ASC`
      )
      .bind(tenantId)
      .all();

    return jsonResponse({ ok: true, properties: (result.results || []).map(mapPropertyRow) });
  } catch (error) {
    console.error('[PROPERTY_LIST]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleCreateProperty(request, env) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);

  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }

  const parsed = validatePropertyCreateRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const id = nanoid();
    const now = currentUnixSeconds();
    await env.DB
      .prepare(
        `INSERT INTO properties
          (id, tenant_id, name, slug, status, timezone, currency, default_check_in_time, default_check_out_time,
           split_stay_enabled, split_stay_public_visible, allow_upgrade_to_preserve_stay, upgrade_mode,
           max_room_moves_per_reservation, max_upgrade_segments_per_stay, max_upgrade_level_jump, same_day_turnover_sellable,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id, tenantId, parsed.name, parsed.slug, parsed.status, parsed.timezone, parsed.currency,
        parsed.defaultCheckInTime, parsed.defaultCheckOutTime,
        parsed.splitStayEnabled, parsed.splitStayPublicVisible, parsed.allowUpgradeToPreserveStay, parsed.upgradeMode,
        parsed.maxRoomMovesPerReservation, parsed.maxUpgradeSegmentsPerStay, parsed.maxUpgradeLevelJump, parsed.sameDayTurnoverSellable,
        now, now
      )
      .run();

    return jsonResponse({ ok: true, property: await loadPropertyById(env, tenantId, id) }, 201);
  } catch (error) {
    const mapped = mapBuilderSqlError(error);
    if (mapped) return jsonResponse(mapped.payload, mapped.status);
    console.error('[PROPERTY_CREATE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleUpdateProperty(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);

  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const propertyId = String(params?.propertyId || '').trim();
  const parsed = validatePropertyPatchRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const existing = await loadPropertyById(env, tenantId, propertyId);
    if (!existing) return jsonResponse({ error: 'Property not found.' }, 404);
    const now = currentUnixSeconds();
    const { sql, values } = buildDynamicUpdateSql('properties', parsed.updates);
    await env.DB.prepare(`${sql} WHERE id = ? AND tenant_id = ?`).bind(...values, now, propertyId, tenantId).run();
    return jsonResponse({ ok: true, property: await loadPropertyById(env, tenantId, propertyId) });
  } catch (error) {
    const mapped = mapBuilderSqlError(error);
    if (mapped) return jsonResponse(mapped.payload, mapped.status);
    console.error('[PROPERTY_UPDATE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleListRoomTypes(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();

  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  try {
    const property = await loadPropertyById(env, tenantId, propertyId);
    if (!property) return jsonResponse({ error: 'Property not found.' }, 404);

    const result = await env.DB
      .prepare(
        `SELECT rt.id, rt.tenant_id, rt.property_id, rt.code, rt.name, rt.description, rt.base_capacity, rt.max_occupancy, rt.sort_order, rt.active, rt.created_at, rt.updated_at,
                (SELECT COUNT(*) FROM room_units ru WHERE ru.tenant_id = rt.tenant_id AND ru.property_id = rt.property_id AND ru.room_type_id = rt.id) AS room_unit_count
           FROM room_types rt
          WHERE rt.tenant_id = ? AND rt.property_id = ?
          ORDER BY rt.sort_order ASC, rt.name ASC`
      )
      .bind(tenantId, propertyId)
      .all();

    return jsonResponse({ ok: true, room_types: (result.results || []).map(mapRoomTypeRow) });
  } catch (error) {
    console.error('[ROOM_TYPE_LIST]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleCreateRoomType(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();

  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validateRoomTypeCreateRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const property = await loadPropertyById(env, tenantId, propertyId);
    if (!property) return jsonResponse({ error: 'Property not found.' }, 404);
    const id = nanoid();
    const now = currentUnixSeconds();
    await env.DB
      .prepare(
        `INSERT INTO room_types
          (id, tenant_id, property_id, code, name, description, base_capacity, max_occupancy, sort_order, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, tenantId, propertyId, parsed.code, parsed.name, parsed.description, parsed.baseCapacity, parsed.maxOccupancy, parsed.sortOrder, parsed.active, now, now)
      .run();

    return jsonResponse({ ok: true, room_type: await loadRoomTypeById(env, tenantId, propertyId, id) }, 201);
  } catch (error) {
    const mapped = mapBuilderSqlError(error);
    if (mapped) return jsonResponse(mapped.payload, mapped.status);
    console.error('[ROOM_TYPE_CREATE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleUpdateRoomType(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const roomTypeId = String(params?.roomTypeId || '').trim();

  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validateRoomTypePatchRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const existing = await loadRoomTypeById(env, tenantId, propertyId, roomTypeId);
    if (!existing) return jsonResponse({ error: 'Room type not found.' }, 404);
    const now = currentUnixSeconds();
    const { sql, values } = buildDynamicUpdateSql('room_types', parsed.updates);
    await env.DB.prepare(`${sql} WHERE id = ? AND tenant_id = ? AND property_id = ?`).bind(...values, now, roomTypeId, tenantId, propertyId).run();
    return jsonResponse({ ok: true, room_type: await loadRoomTypeById(env, tenantId, propertyId, roomTypeId) });
  } catch (error) {
    const mapped = mapBuilderSqlError(error);
    if (mapped) return jsonResponse(mapped.payload, mapped.status);
    console.error('[ROOM_TYPE_UPDATE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleListRoomUnits(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();

  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  try {
    const property = await loadPropertyById(env, tenantId, propertyId);
    if (!property) return jsonResponse({ error: 'Property not found.' }, 404);

    const result = await env.DB
      .prepare(
        `SELECT id, tenant_id, property_id, room_type_id, room_number, floor_label, sort_order, active, operational_status, created_at, updated_at
           FROM room_units
          WHERE tenant_id = ? AND property_id = ?
          ORDER BY sort_order ASC, room_number ASC`
      )
      .bind(tenantId, propertyId)
      .all();

    return jsonResponse({ ok: true, room_units: (result.results || []).map(mapRoomUnitRow) });
  } catch (error) {
    console.error('[ROOM_UNIT_LIST]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleCreateRoomUnit(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();

  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validateRoomUnitCreateRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const roomType = await loadRoomTypeById(env, tenantId, propertyId, parsed.roomTypeId);
    if (!roomType) return jsonResponse({ error: 'Room type not found.' }, 404);
    const id = nanoid();
    const now = currentUnixSeconds();
    await env.DB
      .prepare(
        `INSERT INTO room_units
          (id, tenant_id, property_id, room_type_id, room_number, floor_label, sort_order, active, operational_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, tenantId, propertyId, parsed.roomTypeId, parsed.roomNumber, parsed.floorLabel, parsed.sortOrder, parsed.active, parsed.operationalStatus, now, now)
      .run();
    return jsonResponse({ ok: true, room_unit: await loadRoomUnitById(env, tenantId, propertyId, id) }, 201);
  } catch (error) {
    const mapped = mapBuilderSqlError(error);
    if (mapped) return jsonResponse(mapped.payload, mapped.status);
    console.error('[ROOM_UNIT_CREATE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleBulkCreateRoomUnits(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();

  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validateRoomUnitBulkCreateRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);
  if (!ROOM_UNIT_OPERATIONAL_STATUSES.has(parsed.operationalStatus)) {
    return jsonResponse({ error: 'operational_status is invalid.' }, 400);
  }

  try {
    const roomType = await loadRoomTypeById(env, tenantId, propertyId, parsed.roomTypeId);
    if (!roomType) return jsonResponse({ error: 'Room type not found.' }, 404);
    const now = currentUnixSeconds();
    const created = [];
    for (let index = 0; index < parsed.count; index += 1) {
      const roomNumber = roomNumberFromSequence(parsed.prefix, parsed.startNumber + index);
      const roomUnitId = nanoid();
      await env.DB
        .prepare(
          `INSERT INTO room_units
            (id, tenant_id, property_id, room_type_id, room_number, floor_label, sort_order, active, operational_status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          roomUnitId,
          tenantId,
          propertyId,
          parsed.roomTypeId,
          roomNumber,
          parsed.floorLabel,
          parsed.sortOrderStart + index,
          parsed.active,
          parsed.operationalStatus,
          now,
          now
        )
        .run();
      created.push(roomUnitId);
    }

    const roomUnits = [];
    for (const roomUnitId of created) {
      roomUnits.push(await loadRoomUnitById(env, tenantId, propertyId, roomUnitId));
    }
    return jsonResponse({ ok: true, room_units: roomUnits }, 201);
  } catch (error) {
    const mapped = mapBuilderSqlError(error);
    if (mapped) return jsonResponse(mapped.payload, mapped.status);
    console.error('[ROOM_UNIT_BULK_CREATE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleUpdateRoomUnit(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const roomUnitId = String(params?.roomUnitId || '').trim();

  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validateRoomUnitPatchRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const existing = await loadRoomUnitById(env, tenantId, propertyId, roomUnitId);
    if (!existing) return jsonResponse({ error: 'Room unit not found.' }, 404);
    if (parsed.updates.room_type_id) {
      const roomType = await loadRoomTypeById(env, tenantId, propertyId, parsed.updates.room_type_id);
      if (!roomType) return jsonResponse({ error: 'Room type not found.' }, 404);
    }
    const now = currentUnixSeconds();
    const { sql, values } = buildDynamicUpdateSql('room_units', parsed.updates);
    await env.DB.prepare(`${sql} WHERE id = ? AND tenant_id = ? AND property_id = ?`).bind(...values, now, roomUnitId, tenantId, propertyId).run();
    return jsonResponse({ ok: true, room_unit: await loadRoomUnitById(env, tenantId, propertyId, roomUnitId) });
  } catch (error) {
    const mapped = mapBuilderSqlError(error);
    if (mapped) return jsonResponse(mapped.payload, mapped.status);
    console.error('[ROOM_UNIT_UPDATE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleListRoomRates(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();

  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  try {
    const property = await loadPropertyById(env, tenantId, propertyId);
    if (!property) return jsonResponse({ error: 'Property not found.' }, 404);

    const result = await env.DB
      .prepare(
      `SELECT prr.id, prr.tenant_id, prr.property_id, prr.room_type_id, prr.rate_name, prr.currency, prr.nightly_amount,
        prr.included_adults, prr.included_children, prr.extra_adult_amount, prr.extra_child_amount,
        prr.active, prr.created_at, prr.updated_at,
                rt.code AS room_type_code, rt.name AS room_type_name
           FROM property_room_rates prr
           LEFT JOIN room_types rt ON rt.id = prr.room_type_id AND rt.tenant_id = prr.tenant_id AND rt.property_id = prr.property_id
          WHERE prr.tenant_id = ? AND prr.property_id = ?
          ORDER BY prr.created_at DESC`
      )
      .bind(tenantId, propertyId)
      .all();

    return jsonResponse({ ok: true, room_rates: (result.results || []).map(mapRoomRateRow) });
  } catch (error) {
    console.error('[ROOM_RATE_LIST]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleCreateRoomRate(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();

  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validateRoomRateCreateRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const roomType = await loadRoomTypeById(env, tenantId, propertyId, parsed.roomTypeId);
    if (!roomType) return jsonResponse({ error: 'Room type not found.' }, 404);
    const id = nanoid();
    const now = currentUnixSeconds();
    await env.DB
      .prepare(
        `INSERT INTO property_room_rates
          (id, tenant_id, property_id, room_type_id, rate_name, currency, nightly_amount,
           included_adults, included_children, extra_adult_amount, extra_child_amount,
           active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        tenantId,
        propertyId,
        parsed.roomTypeId,
        parsed.rateName,
        parsed.currency,
        parsed.nightlyAmount,
        parsed.includedAdults,
        parsed.includedChildren,
        parsed.extraAdultAmount,
        parsed.extraChildAmount,
        parsed.active,
        now,
        now
      )
      .run();

    return jsonResponse({ ok: true, room_rate: await loadRoomRateById(env, tenantId, propertyId, id) }, 201);
  } catch (error) {
    const mapped = mapBuilderSqlError(error);
    if (mapped) return jsonResponse(mapped.payload, mapped.status);
    console.error('[ROOM_RATE_CREATE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleUpdateRoomRate(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const roomRateId = String(params?.roomRateId || '').trim();

  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validateRoomRatePatchRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const existing = await loadRoomRateById(env, tenantId, propertyId, roomRateId);
    if (!existing) return jsonResponse({ error: 'Room rate not found.' }, 404);
    const now = currentUnixSeconds();
    const { sql, values } = buildDynamicUpdateSql('property_room_rates', parsed.updates);
    await env.DB.prepare(`${sql} WHERE id = ? AND tenant_id = ? AND property_id = ?`).bind(...values, now, roomRateId, tenantId, propertyId).run();
    return jsonResponse({ ok: true, room_rate: await loadRoomRateById(env, tenantId, propertyId, roomRateId) });
  } catch (error) {
    const mapped = mapBuilderSqlError(error);
    if (mapped) return jsonResponse(mapped.payload, mapped.status);
    console.error('[ROOM_RATE_UPDATE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleListRateSeasons(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  try {
    const property = await loadPropertyById(env, tenantId, propertyId);
    if (!property) return jsonResponse({ error: 'Property not found.' }, 404);
    const result = await env.DB
      .prepare(
        `SELECT id, tenant_id, property_id, name, start_date, end_date, sort_order, active, created_at, updated_at
           FROM property_rate_seasons
          WHERE tenant_id = ? AND property_id = ?
          ORDER BY sort_order ASC, start_date ASC, created_at ASC`
      )
      .bind(tenantId, propertyId)
      .all();
    return jsonResponse({ ok: true, rate_seasons: (result.results || []).map(mapRateSeasonRow) });
  } catch (error) {
    console.error('[RATE_SEASON_LIST]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleCreateRateSeason(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validateRateSeasonCreateRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const property = await loadPropertyById(env, tenantId, propertyId);
    if (!property) return jsonResponse({ error: 'Property not found.' }, 404);
    const id = nanoid();
    const now = currentUnixSeconds();
    await env.DB
      .prepare(
        `INSERT INTO property_rate_seasons
          (id, tenant_id, property_id, name, start_date, end_date, sort_order, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, tenantId, propertyId, parsed.name, parsed.startDate, parsed.endDate, parsed.sortOrder, parsed.active, now, now)
      .run();
    return jsonResponse({ ok: true, rate_season: await loadRateSeasonById(env, tenantId, propertyId, id) }, 201);
  } catch (error) {
    const mapped = mapBuilderSqlError(error);
    if (mapped) return jsonResponse(mapped.payload, mapped.status);
    console.error('[RATE_SEASON_CREATE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleUpdateRateSeason(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const seasonId = String(params?.seasonId || '').trim();
  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validateRateSeasonPatchRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const existing = await loadRateSeasonById(env, tenantId, propertyId, seasonId);
    if (!existing) return jsonResponse({ error: 'Rate season not found.' }, 404);
    const nextStart = parsed.updates.start_date || existing.start_date;
    const nextEnd = parsed.updates.end_date || existing.end_date;
    if (parseDateUtc(nextStart) > parseDateUtc(nextEnd)) return jsonResponse({ error: 'start_date must be on or before end_date.' }, 400);
    const now = currentUnixSeconds();
    const { sql, values } = buildDynamicUpdateSql('property_rate_seasons', parsed.updates);
    await env.DB.prepare(`${sql} WHERE id = ? AND tenant_id = ? AND property_id = ?`).bind(...values, now, seasonId, tenantId, propertyId).run();
    return jsonResponse({ ok: true, rate_season: await loadRateSeasonById(env, tenantId, propertyId, seasonId) });
  } catch (error) {
    const mapped = mapBuilderSqlError(error);
    if (mapped) return jsonResponse(mapped.payload, mapped.status);
    console.error('[RATE_SEASON_UPDATE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleListSeasonRoomRates(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  try {
    const property = await loadPropertyById(env, tenantId, propertyId);
    if (!property) return jsonResponse({ error: 'Property not found.' }, 404);
    const result = await env.DB
      .prepare(
      `SELECT sr.id, sr.tenant_id, sr.property_id, sr.season_id, sr.room_type_id, sr.currency, sr.nightly_amount,
        sr.included_adults, sr.included_children, sr.extra_adult_amount, sr.extra_child_amount,
        sr.active, sr.created_at, sr.updated_at,
                prs.name AS season_name, rt.name AS room_type_name, rt.code AS room_type_code
           FROM property_room_rate_season_prices sr
           LEFT JOIN property_rate_seasons prs ON prs.id = sr.season_id AND prs.tenant_id = sr.tenant_id AND prs.property_id = sr.property_id
           LEFT JOIN room_types rt ON rt.id = sr.room_type_id AND rt.tenant_id = sr.tenant_id AND rt.property_id = sr.property_id
          WHERE sr.tenant_id = ? AND sr.property_id = ?
          ORDER BY prs.sort_order ASC, prs.start_date ASC, rt.sort_order ASC, sr.created_at ASC`
      )
      .bind(tenantId, propertyId)
      .all();
    return jsonResponse({ ok: true, season_room_rates: (result.results || []).map(mapSeasonRateRow) });
  } catch (error) {
    console.error('[SEASON_ROOM_RATE_LIST]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleCreateSeasonRoomRate(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validateSeasonRoomRateCreateRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const season = await loadRateSeasonById(env, tenantId, propertyId, parsed.seasonId);
    if (!season) return jsonResponse({ error: 'Rate season not found.' }, 404);
    const roomType = await loadRoomTypeById(env, tenantId, propertyId, parsed.roomTypeId);
    if (!roomType) return jsonResponse({ error: 'Room type not found.' }, 404);
    const id = nanoid();
    const now = currentUnixSeconds();
    await env.DB
      .prepare(
        `INSERT INTO property_room_rate_season_prices
          (id, tenant_id, property_id, season_id, room_type_id, currency, nightly_amount,
           included_adults, included_children, extra_adult_amount, extra_child_amount,
           active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        tenantId,
        propertyId,
        parsed.seasonId,
        parsed.roomTypeId,
        parsed.currency,
        parsed.nightlyAmount,
        parsed.includedAdults,
        parsed.includedChildren,
        parsed.extraAdultAmount,
        parsed.extraChildAmount,
        parsed.active,
        now,
        now
      )
      .run();
    return jsonResponse({ ok: true, season_room_rate: await loadSeasonRoomRateById(env, tenantId, propertyId, id) }, 201);
  } catch (error) {
    const mapped = mapBuilderSqlError(error);
    if (mapped) return jsonResponse(mapped.payload, mapped.status);
    console.error('[SEASON_ROOM_RATE_CREATE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleUpdateSeasonRoomRate(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const seasonRoomRateId = String(params?.seasonRoomRateId || '').trim();
  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validateSeasonRoomRatePatchRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const existing = await loadSeasonRoomRateById(env, tenantId, propertyId, seasonRoomRateId);
    if (!existing) return jsonResponse({ error: 'Season room rate not found.' }, 404);
    const now = currentUnixSeconds();
    const { sql, values } = buildDynamicUpdateSql('property_room_rate_season_prices', parsed.updates);
    await env.DB.prepare(`${sql} WHERE id = ? AND tenant_id = ? AND property_id = ?`).bind(...values, now, seasonRoomRateId, tenantId, propertyId).run();
    return jsonResponse({ ok: true, season_room_rate: await loadSeasonRoomRateById(env, tenantId, propertyId, seasonRoomRateId) });
  } catch (error) {
    const mapped = mapBuilderSqlError(error);
    if (mapped) return jsonResponse(mapped.payload, mapped.status);
    console.error('[SEASON_ROOM_RATE_UPDATE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleQuotePropertyRoomRate(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validateRateQuoteRequest(body, propertyId);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const property = await loadPropertyById(env, tenantId, propertyId);
    if (!property) return jsonResponse({ error: 'Property not found.' }, 404);
    const roomType = await loadRoomTypeById(env, tenantId, propertyId, parsed.roomTypeId);
    if (!roomType) return jsonResponse({ error: 'Room type not found.' }, 404);
    const totalGuests = parsed.adults + parsed.children;
    const maxGuests = Number(roomType.max_occupancy || 0) * parsed.roomsRequested;
    if (maxGuests > 0 && totalGuests > maxGuests) {
      return jsonResponse({ error: `Guest mix exceeds the configured max occupancy for ${parsed.roomsRequested} room(s).` }, 409);
    }

    const [baseRateRow, seasonsResult, seasonRatesResult] = await Promise.all([
      env.DB.prepare(
        `SELECT id, tenant_id, property_id, room_type_id, rate_name, currency, nightly_amount,
                included_adults, included_children, extra_adult_amount, extra_child_amount,
                active, created_at, updated_at
           FROM property_room_rates
          WHERE tenant_id = ? AND property_id = ? AND room_type_id = ? AND active = 1
          ORDER BY updated_at DESC, created_at DESC
          LIMIT 1`
      ).bind(tenantId, propertyId, parsed.roomTypeId).first(),
      env.DB.prepare(
        `SELECT id, tenant_id, property_id, name, start_date, end_date, sort_order, active, created_at, updated_at
           FROM property_rate_seasons
          WHERE tenant_id = ? AND property_id = ? AND active = 1
          ORDER BY sort_order ASC, start_date ASC, created_at ASC`
      ).bind(tenantId, propertyId).all(),
      env.DB.prepare(
        `SELECT id, tenant_id, property_id, season_id, room_type_id, currency, nightly_amount,
          included_adults, included_children, extra_adult_amount, extra_child_amount,
          active, created_at, updated_at
           FROM property_room_rate_season_prices
          WHERE tenant_id = ? AND property_id = ? AND room_type_id = ? AND active = 1`
      ).bind(tenantId, propertyId, parsed.roomTypeId).all(),
    ]);

    const stayDates = enumerateStayDates(parsed.checkIn, parsed.checkOut);
    const activeSeasons = (seasonsResult.results || []).map(mapRateSeasonRow);
    const seasonRatesByKey = new Map((seasonRatesResult.results || []).map((row) => [String(row.season_id), mapSeasonRateRow(row)]));
    const baseRate = baseRateRow ? mapRoomRateRow(baseRateRow) : null;

    const nightlyBreakdown = stayDates.map((stayDate) => {
      const resolved = resolveNightlyRateForDate(stayDate, activeSeasons, seasonRatesByKey, baseRate);
      const occupancyAdjustment = calculateOccupancyAdjustment(resolved, parsed.adults, parsed.children, parsed.roomsRequested);
      const nightlyBaseTotal = resolved ? Number(resolved.nightly_amount) * parsed.roomsRequested : null;
      return {
        stay_date: stayDate,
        source: resolved?.source || 'missing_rate',
        season_id: resolved?.season_id || null,
        season_name: resolved?.season_name || null,
        currency: resolved?.currency || baseRate?.currency || property.currency,
        nightly_amount: resolved ? Number(resolved.nightly_amount) : null,
        rooms_requested: parsed.roomsRequested,
        nightly_base_total: nightlyBaseTotal,
        included_adults: resolved ? Number(resolved.included_adults) : null,
        included_children: resolved ? Number(resolved.included_children) : null,
        occupancy_adjustment: resolved ? occupancyAdjustment : null,
        nightly_total: resolved ? nightlyBaseTotal + Number(occupancyAdjustment.adjustment_amount || 0) : null,
      };
    });

    const missingDates = nightlyBreakdown.filter((row) => row.nightly_amount === null).map((row) => row.stay_date);
    const totalBaseAmount = nightlyBreakdown.reduce((sum, row) => sum + (Number(row.nightly_base_total) || 0), 0);
    const totalOccupancyAdjustment = nightlyBreakdown.reduce((sum, row) => sum + (Number(row.occupancy_adjustment?.adjustment_amount) || 0), 0);
    const totalAmount = nightlyBreakdown.reduce((sum, row) => sum + (Number(row.nightly_total) || 0), 0);
    const currency = nightlyBreakdown.find((row) => row.currency)?.currency || property.currency;

    return jsonResponse({
      ok: true,
      property_id: propertyId,
      room_type_id: parsed.roomTypeId,
      request: {
        check_in: parsed.checkIn,
        check_out: parsed.checkOut,
        adults: parsed.adults,
        children: parsed.children,
        rooms_requested: parsed.roomsRequested,
      },
      pricing: {
        currency,
        nightly_breakdown: nightlyBreakdown,
        missing_rate_dates: missingDates,
        total_base_amount: totalBaseAmount,
        total_occupancy_adjustment: totalOccupancyAdjustment,
        total_amount: totalAmount,
        source_summary: {
          has_base_rate: Boolean(baseRate),
          active_seasons: activeSeasons.length,
          active_season_rates: seasonRatesByKey.size,
        },
      },
    });
  } catch (error) {
    console.error('[PROPERTY_RATE_QUOTE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

async function loadAvailabilityInputs(env, tenantId, propertyId, startDate, endDate, options = {}) {
  const excludeHoldId = options.excludeHoldId ? String(options.excludeHoldId) : null;
  const excludeReservationId = options.excludeReservationId ? String(options.excludeReservationId) : null;
  const roomUnitsResult = await env.DB
    .prepare(
      `SELECT id, tenant_id, property_id, room_type_id, room_number, floor_label, sort_order, active, operational_status
         FROM room_units
        WHERE tenant_id = ?
          AND property_id = ?
          AND active = 1
          AND operational_status NOT IN ('maintenance', 'out_of_order')
        ORDER BY sort_order ASC, room_number ASC`
    )
    .bind(tenantId, propertyId)
    .all();

  const holdsResult = await env.DB
    .prepare(
      `SELECT id, tenant_id, property_id, room_type_id, hold_type, source_type, source_id,
              check_in, check_out, rooms_requested, status, expires_at
         FROM inventory_holds
        WHERE tenant_id = ?
          AND property_id = ?
          AND status = 'active'
          AND expires_at > ?
          AND check_in < ?
          AND check_out > ?`
    )
    .bind(tenantId, propertyId, currentUnixSeconds(), endDate, startDate)
    .all();

  const allocationsResult = await env.DB
    .prepare(
      `SELECT id, tenant_id, property_id, reservation_id, stay_plan_id, room_unit_id, stay_date, allocation_status
         FROM reservation_allocations
        WHERE tenant_id = ?
          AND property_id = ?
          AND stay_date >= ?
          AND stay_date < ?
          AND allocation_status IN ('soft_allocated', 'locked')`
    )
    .bind(tenantId, propertyId, startDate, endDate)
    .all();

  return {
    roomUnits: roomUnitsResult.results || [],
    holds: (holdsResult.results || []).filter((row) => !excludeHoldId || String(row.id) !== excludeHoldId),
    allocations: (allocationsResult.results || []).filter((row) => !excludeReservationId || String(row.reservation_id) !== excludeReservationId),
  };
}

async function calculateAvailability(env, tenantId, propertyId, roomTypeId, checkIn, checkOut, roomsRequested, options = {}) {
  const stayDates = enumerateStayDates(checkIn, checkOut);
  const windowStart = addDays(parseDateUtc(checkIn), -3);
  const windowEnd = addDays(parseDateUtc(checkOut), 3);
  const windowDates = enumerateDateRange(windowStart, addDays(windowEnd, -1));
  const rangeStart = formatDateUtc(windowStart);
  const rangeEndExclusive = formatDateUtc(windowEnd);

  const { property, roomTypes, requestedRoomType } = await loadPropertyContext(env, tenantId, propertyId, roomTypeId);
  if (!property) {
    return { error: { status: 404, payload: { error: 'Property not found.' } } };
  }
  if (!requestedRoomType) {
    return { error: { status: 404, payload: { error: 'Room type not found for this property.' } } };
  }

  const { roomUnits, holds, allocations } = await loadAvailabilityInputs(env, tenantId, propertyId, rangeStart, rangeEndExclusive, options);
  const roomUnitMap = new Map((roomUnits || []).map((roomUnit) => [String(roomUnit.id), roomUnit]));
  const roomUnitsByType = new Map();
  for (const roomUnit of roomUnits) {
    const roomTypeUnits = roomUnitsByType.get(String(roomUnit.room_type_id)) || [];
    roomTypeUnits.push(roomUnit);
    roomUnitsByType.set(String(roomUnit.room_type_id), roomTypeUnits);
  }

  const occupiedDatesByUnit = new Map();
  for (const allocation of allocations) {
    const occupiedDates = occupiedDatesByUnit.get(String(allocation.room_unit_id)) || new Set();
    occupiedDates.add(allocation.stay_date);
    occupiedDatesByUnit.set(String(allocation.room_unit_id), occupiedDates);
  }

  const { roomTypeNightCounts } = countAllocatedUnitsByNight(allocations, roomUnitMap, windowDates);
  const holdCounts = countHoldsByNight(holds, windowDates);
  const nightlyRemainingByType = buildNightlyRemaining(roomTypes, roomUnitsByType, roomTypeNightCounts, holdCounts, windowDates);

  const requestedNightly = (nightlyRemainingByType.get(String(requestedRoomType.id)) || []).filter((row) => stayDates.includes(row.stay_date));
  const shortageDates = collectShortageDates(requestedNightly, roomsRequested);
  const stayPlans = [];

  const requestedRoomUnits = roomUnitsByType.get(String(requestedRoomType.id)) || [];
  const contiguousUnits = findContiguousUnits(requestedRoomUnits, occupiedDatesByUnit, stayDates, roomsRequested);
  const contiguousCapacity = hasContiguousCapacity(requestedNightly, roomsRequested);

  if (contiguousCapacity) {
    stayPlans.push(
      buildPlan(
        'contiguous_same_type',
        10,
        0,
        0,
        true,
        [{
          room_type_id: String(requestedRoomType.id),
          room_unit_id: contiguousUnits.length >= roomsRequested ? String(contiguousUnits[0]?.id || '') || null : null,
          check_in: checkIn,
          check_out: checkOut,
        }],
        contiguousUnits.length >= roomsRequested ? [] : ['Contiguous candidate uses room-type capacity only because active holds are not tied to a specific room unit.']
      )
    );
  }

  if (roomsRequested === 1 && property.split_stay_enabled && contiguousCapacity && contiguousUnits.length < 1) {
    const splitSegments = buildSameTypeSplitSegments(requestedRoomUnits, occupiedDatesByUnit, stayDates, String(requestedRoomType.id));
    if (splitSegments.length > 1 && splitSegments.length - 1 <= Number(property.max_room_moves_per_reservation || 1)) {
      stayPlans.push(
        buildPlan(
          'split_same_type',
          35 + (splitSegments.length - 1) * 5,
          splitSegments.length - 1,
          0,
          Boolean(property.split_stay_public_visible),
          splitSegments,
          ['Split stay candidate generated because same-type capacity exists across the stay but not on one continuous lane.']
        )
      );
    }
  }

  if (property.allow_upgrade_to_preserve_stay) {
    const rankedUpgradeTypes = rankUpgradeRoomTypes(roomTypes, requestedRoomType);
    for (const upgradeType of rankedUpgradeTypes) {
      const upgradeNightly = (nightlyRemainingByType.get(String(upgradeType.id)) || []).filter((row) => stayDates.includes(row.stay_date));
      if (hasContiguousCapacity(upgradeNightly, roomsRequested)) {
        const upgradeUnits = findContiguousUnits(
          roomUnitsByType.get(String(upgradeType.id)) || [],
          occupiedDatesByUnit,
          stayDates,
          roomsRequested
        );
        stayPlans.push(
          buildPlan(
            'contiguous_upgrade',
            20,
            0,
            1,
            true,
            [{
              room_type_id: String(upgradeType.id),
              room_unit_id: upgradeUnits.length >= roomsRequested ? String(upgradeUnits[0]?.id || '') || null : null,
              check_in: checkIn,
              check_out: checkOut,
            }],
            ['Upgrade-preserve candidate uses a higher room type to keep the stay contiguous.']
          )
        );
        break;
      }
    }
  }

  const sameTypeNearbyOptions = buildNearbyOptions(
    nightlyRemainingByType.get(String(requestedRoomType.id)) || [],
    checkIn,
    checkOut,
    roomsRequested,
    3
  );

  const otherRoomTypeOptions = rankUpgradeRoomTypes(roomTypes, requestedRoomType)
    .map((roomType) => {
      const nightly = (nightlyRemainingByType.get(String(roomType.id)) || []).filter((row) => stayDates.includes(row.stay_date));
      if (!hasContiguousCapacity(nightly, roomsRequested)) return null;
      return {
        room_type_id: String(roomType.id),
        code: roomType.code,
        name: roomType.name,
      };
    })
    .filter(Boolean);

  stayPlans.sort((a, b) => a.score - b.score);

  return {
    property,
    requestedRoomType,
    requestedNightly,
    shortageDates,
    stayPlans,
    sameTypeNearbyOptions,
    otherRoomTypeOptions,
    request: {
      property_id: propertyId,
      room_type_id: roomTypeId,
      check_in: checkIn,
      check_out: checkOut,
      rooms_requested: roomsRequested,
    },
  };
}

function buildAvailabilityPayload(result) {
  return {
    ok: true,
    property_id: result.request.property_id,
    room_type_id: result.request.room_type_id,
    request: {
      check_in: result.request.check_in,
      check_out: result.request.check_out,
      rooms_requested: result.request.rooms_requested,
    },
    availability: {
      nightly_remaining: result.requestedNightly,
      shortage_dates: result.shortageDates,
      stay_plans: result.stayPlans,
      same_type_nearby_options: result.sameTypeNearbyOptions,
      other_room_type_options: result.otherRoomTypeOptions,
    },
    policy: {
      split_stay_enabled: Boolean(result.property.split_stay_enabled),
      split_stay_public_visible: Boolean(result.property.split_stay_public_visible),
      allow_upgrade_to_preserve_stay: Boolean(result.property.allow_upgrade_to_preserve_stay),
      upgrade_mode: result.property.upgrade_mode,
    },
  };
}

function validateReservationCreateRequest(body, propertyId) {
  const availability = validateAvailabilityRequest(body, propertyId);
  if (availability.error) return availability;

  const source = String(body?.source || 'direct_web').trim();
  const guestName = String(body?.guest_name || '').trim();
  const guestEmail = body?.guest_email ? String(body.guest_email).trim() : null;
  const guestPhone = body?.guest_phone ? String(body.guest_phone).trim() : null;
  const sourceRef = body?.source_ref ? String(body.source_ref).trim() : null;
  const sourcePayload = body?.source_payload ? JSON.stringify(body.source_payload) : null;
  const pricingSnapshot = body?.pricing_snapshot ? JSON.stringify(body.pricing_snapshot) : JSON.stringify({});
  const specialRequests = body?.special_requests ? String(body.special_requests).trim() : null;
  const expectedArrivalTime = body?.expected_arrival_time ? String(body.expected_arrival_time).trim() : null;
  const expectedFlightRef = body?.expected_flight_ref ? String(body.expected_flight_ref).trim() : null;
  const expectedArrivalChannel = body?.expected_arrival_channel ? String(body.expected_arrival_channel).trim() : null;
  const airportTransferRequested = body?.airport_transfer_requested ? 1 : 0;
  const airportTransferPriceSnapshot = body?.airport_transfer_price_snapshot ? JSON.stringify(body.airport_transfer_price_snapshot) : null;
  const cancellationPolicySnapshot = body?.cancellation_policy_snapshot ? JSON.stringify(body.cancellation_policy_snapshot) : null;
  const adults = Number(body?.adults ?? 1);
  const children = Number(body?.children ?? 0);
  const holdId = body?.hold_id ? String(body.hold_id).trim() : null;

  if (!PROPERTY_RESERVATION_SOURCES.has(source)) {
    return { error: 'source is invalid.' };
  }
  if (!guestName) {
    return { error: 'guest_name is required.' };
  }
  if (!Number.isInteger(adults) || adults < 1) {
    return { error: 'adults must be an integer greater than 0.' };
  }
  if (!Number.isInteger(children) || children < 0) {
    return { error: 'children must be an integer greater than or equal to 0.' };
  }
  if (availability.roomsRequested !== 1) {
    return { error: 'Reservation create baseline currently supports rooms_requested = 1 only.' };
  }

  return {
    ...availability,
    source,
    sourceRef,
    sourcePayload,
    guestName,
    guestEmail,
    guestPhone,
    adults,
    children,
    pricingSnapshot,
    specialRequests,
    expectedArrivalTime,
    expectedFlightRef,
    expectedArrivalChannel,
    airportTransferRequested,
    airportTransferPriceSnapshot,
    cancellationPolicySnapshot,
    holdId,
  };
}

async function loadActiveHold(env, tenantId, propertyId, holdId) {
  if (!holdId) return null;
  return env.DB
    .prepare(
      `SELECT id, tenant_id, property_id, room_type_id, hold_type, source_type, source_id,
              check_in, check_out, rooms_requested, status, expires_at
         FROM inventory_holds
        WHERE id = ?
          AND tenant_id = ?
          AND property_id = ?
          AND status = 'active'
          AND expires_at > ?`
    )
    .bind(holdId, tenantId, propertyId, currentUnixSeconds())
    .first();
}

function selectBestPlan(availability) {
  return Array.isArray(availability?.stayPlans) && availability.stayPlans.length ? availability.stayPlans[0] : null;
}

function validateReservationRebookRequest(body, propertyId, existingReservation) {
  const availability = validateAvailabilityRequest({
    propertyId,
    room_type_id: body?.room_type_id || existingReservation?.room_type_id,
    check_in: body?.check_in || existingReservation?.check_in,
    check_out: body?.check_out || existingReservation?.check_out,
    rooms_requested: body?.rooms_requested ?? existingReservation?.rooms_requested ?? 1,
  }, propertyId);
  if (availability.error) return availability;

  const adults = Number(body?.adults ?? existingReservation?.adults ?? 1);
  const children = Number(body?.children ?? existingReservation?.children ?? 0);
  const specialRequests = body?.special_requests !== undefined ? (body.special_requests ? String(body.special_requests).trim() : null) : existingReservation?.special_requests || null;
  const expectedArrivalTime = body?.expected_arrival_time !== undefined ? (body.expected_arrival_time ? String(body.expected_arrival_time).trim() : null) : existingReservation?.expected_arrival_time || null;
  const expectedFlightRef = body?.expected_flight_ref !== undefined ? (body.expected_flight_ref ? String(body.expected_flight_ref).trim() : null) : existingReservation?.expected_flight_ref || null;
  const expectedArrivalChannel = body?.expected_arrival_channel !== undefined ? (body.expected_arrival_channel ? String(body.expected_arrival_channel).trim() : null) : existingReservation?.expected_arrival_channel || null;
  const pricingSnapshot = body?.pricing_snapshot ? JSON.stringify(body.pricing_snapshot) : (existingReservation?.pricing_snapshot || JSON.stringify({}));
  const holdId = body?.hold_id ? String(body.hold_id).trim() : null;

  if (!Number.isInteger(adults) || adults < 1) return { error: 'adults must be an integer greater than 0.' };
  if (!Number.isInteger(children) || children < 0) return { error: 'children must be an integer greater than or equal to 0.' };
  if (availability.roomsRequested !== 1) return { error: 'Reservation rebook baseline currently supports rooms_requested = 1 only.' };

  return {
    ...availability,
    adults,
    children,
    specialRequests,
    expectedArrivalTime,
    expectedFlightRef,
    expectedArrivalChannel,
    pricingSnapshot,
    holdId,
  };
}

function validateReservationStatusTransition(record, fromStatuses, actionLabel) {
  if (!record?.reservation) return { error: 'Reservation not found.' };
  if (!fromStatuses.includes(record.reservation.status)) {
    return { error: `${actionLabel} is only allowed from status: ${fromStatuses.join(', ')}.` };
  }
  return null;
}

async function discardReservationStayPlanState(env, tenantId, propertyId, reservationId) {
  const now = currentUnixSeconds();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE reservation_stay_plans
          SET is_selected = 0,
              status = 'discarded',
              updated_at = ?
        WHERE tenant_id = ?
          AND property_id = ?
          AND reservation_id = ?
          AND is_selected = 1
          AND status IN ('selected', 'locked')`
    ).bind(now, tenantId, propertyId, reservationId),
    env.DB.prepare(
      `UPDATE reservation_allocations
          SET allocation_status = 'released',
              updated_at = ?
        WHERE tenant_id = ?
          AND property_id = ?
          AND reservation_id = ?
          AND allocation_status IN ('soft_allocated', 'locked')`
    ).bind(now, tenantId, propertyId, reservationId),
  ]);
}

async function attachSelectedStayPlanArtifacts(env, tenantId, reservationId, propertyId, selectedPlan) {
  const now = currentUnixSeconds();
  const stayPlanId = nanoid();
  const planSegments = selectedPlan.segments || [];

  await env.DB
    .prepare(
      `INSERT INTO reservation_stay_plans
        (id, tenant_id, property_id, reservation_id, plan_type, score, move_count, upgrade_segments,
         public_visible, is_selected, status, meta_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'locked', ?, ?, ?)`
    )
    .bind(
      stayPlanId,
      tenantId,
      propertyId,
      reservationId,
      selectedPlan.plan_type,
      Number(selectedPlan.score || 0),
      Number(selectedPlan.move_count || 0),
      Number(selectedPlan.upgrade_segments || 0),
      selectedPlan.public_visible ? 1 : 0,
      JSON.stringify({ ops_notes: selectedPlan.ops_notes || [] }),
      now,
      now
    )
    .run();

  for (let index = 0; index < planSegments.length; index += 1) {
    const segment = planSegments[index];
    const segmentId = nanoid();
    await env.DB
      .prepare(
        `INSERT INTO reservation_stay_plan_segments
          (id, tenant_id, property_id, reservation_id, stay_plan_id, segment_order,
           room_type_id, room_unit_id, check_in, check_out, segment_type, upgrade_applied, ops_notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        segmentId,
        tenantId,
        propertyId,
        reservationId,
        stayPlanId,
        index + 1,
        segment.room_type_id,
        segment.room_unit_id,
        segment.check_in,
        segment.check_out,
        selectedPlan.plan_type === 'contiguous_upgrade' ? 'upgrade' : (index > 0 ? 'split_move' : 'base'),
        selectedPlan.plan_type === 'contiguous_upgrade' ? 1 : 0,
        selectedPlan.ops_notes?.[index] || null,
        now
      )
      .run();

    const stayDates = enumerateStayDates(segment.check_in, segment.check_out);
    for (const stayDate of stayDates) {
      await env.DB
        .prepare(
          `INSERT INTO reservation_allocations
            (id, tenant_id, property_id, reservation_id, stay_plan_id, room_unit_id, stay_date, allocation_status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'locked', ?, ?)`
        )
        .bind(
          nanoid(),
          tenantId,
          propertyId,
          reservationId,
          stayPlanId,
          segment.room_unit_id,
          stayDate,
          now,
          now
        )
        .run();
    }
  }

  return { stayPlanId, lockedAt: now };
}

async function createReservationArtifacts(env, tenantId, reservationId, propertyId, reservationInput, selectedPlan) {
  const now = currentUnixSeconds();

  await env.DB
    .prepare(
      `INSERT INTO property_reservations
        (id, tenant_id, property_id, source, source_ref, source_payload, status,
         guest_name, guest_email, guest_phone,
         check_in, check_out, room_type_id, rooms_requested, adults, children,
         pricing_snapshot, special_requests,
         expected_arrival_time, expected_flight_ref, expected_arrival_channel,
         airport_transfer_requested, airport_transfer_price_snapshot, cancellation_policy_snapshot,
         confirmed_at, confirmed_by, cancelled_at, cancelled_by, cancel_reason,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`
    )
    .bind(
      reservationId,
      tenantId,
      propertyId,
      reservationInput.source,
      reservationInput.sourceRef,
      reservationInput.sourcePayload,
      reservationInput.guestName,
      reservationInput.guestEmail,
      reservationInput.guestPhone,
      reservationInput.checkIn,
      reservationInput.checkOut,
      reservationInput.roomTypeId,
      reservationInput.roomsRequested,
      reservationInput.adults,
      reservationInput.children,
      reservationInput.pricingSnapshot,
      reservationInput.specialRequests,
      reservationInput.expectedArrivalTime,
      reservationInput.expectedFlightRef,
      reservationInput.expectedArrivalChannel,
      reservationInput.airportTransferRequested,
      reservationInput.airportTransferPriceSnapshot,
      reservationInput.cancellationPolicySnapshot,
      now,
      now,
      now
    )
    .run();

  const planArtifacts = await attachSelectedStayPlanArtifacts(env, tenantId, reservationId, propertyId, selectedPlan);
  return { stayPlanId: planArtifacts.stayPlanId, confirmedAt: now };
}

async function loadPropertyReservation(env, tenantId, propertyId, reservationId) {
  const reservation = await env.DB
    .prepare(
      `SELECT id, tenant_id, property_id, source, source_ref, source_payload, status,
              guest_name, guest_email, guest_phone,
              check_in, check_out, room_type_id, rooms_requested, adults, children,
              pricing_snapshot, special_requests,
              expected_arrival_time, expected_flight_ref, expected_arrival_channel,
              airport_transfer_requested, airport_transfer_price_snapshot, cancellation_policy_snapshot,
              confirmed_at, confirmed_by, cancelled_at, cancelled_by, cancel_reason,
              created_at, updated_at
         FROM property_reservations
        WHERE id = ? AND tenant_id = ? AND property_id = ?`
    )
    .bind(reservationId, tenantId, propertyId)
    .first();

  if (!reservation) return null;

  const stayPlan = await env.DB
    .prepare(
      `SELECT id, plan_type, score, move_count, upgrade_segments, public_visible, is_selected, status, meta_json, created_at, updated_at
         FROM reservation_stay_plans
        WHERE tenant_id = ? AND property_id = ? AND reservation_id = ? AND is_selected = 1
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1`
    )
    .bind(tenantId, propertyId, reservationId)
    .first();

  const segmentsResult = await env.DB
    .prepare(
      `SELECT id, stay_plan_id, segment_order, room_type_id, room_unit_id, check_in, check_out, segment_type, upgrade_applied, ops_notes, created_at
         FROM reservation_stay_plan_segments
        WHERE tenant_id = ? AND property_id = ? AND reservation_id = ?
        ORDER BY segment_order ASC`
    )
    .bind(tenantId, propertyId, reservationId)
    .all();

  const allocationsResult = await env.DB
    .prepare(
      `SELECT id, stay_plan_id, room_unit_id, stay_date, allocation_status, created_at, updated_at
         FROM reservation_allocations
        WHERE tenant_id = ? AND property_id = ? AND reservation_id = ?
        ORDER BY stay_date ASC, room_unit_id ASC`
    )
    .bind(tenantId, propertyId, reservationId)
    .all();

  return {
    reservation,
    stayPlan: stayPlan || null,
    segments: stayPlan
      ? (segmentsResult.results || []).filter((segment) => String(segment.stay_plan_id) === String(stayPlan.id))
      : [],
    allocations: allocationsResult.results || [],
  };
}

function buildReservationPayload(record) {
  return {
    ok: true,
    reservation: {
      id: record.reservation.id,
      property_id: record.reservation.property_id,
      source: record.reservation.source,
      source_ref: record.reservation.source_ref,
      status: record.reservation.status,
      guest_name: record.reservation.guest_name,
      guest_email: record.reservation.guest_email,
      guest_phone: record.reservation.guest_phone,
      check_in: record.reservation.check_in,
      check_out: record.reservation.check_out,
      room_type_id: record.reservation.room_type_id,
      rooms_requested: record.reservation.rooms_requested,
      adults: record.reservation.adults,
      children: record.reservation.children,
      pricing_snapshot: record.reservation.pricing_snapshot ? JSON.parse(record.reservation.pricing_snapshot) : null,
      special_requests: record.reservation.special_requests,
      expected_arrival_time: record.reservation.expected_arrival_time,
      expected_flight_ref: record.reservation.expected_flight_ref,
      expected_arrival_channel: record.reservation.expected_arrival_channel,
      airport_transfer_requested: Boolean(record.reservation.airport_transfer_requested),
      airport_transfer_price_snapshot: record.reservation.airport_transfer_price_snapshot ? JSON.parse(record.reservation.airport_transfer_price_snapshot) : null,
      cancellation_policy_snapshot: record.reservation.cancellation_policy_snapshot ? JSON.parse(record.reservation.cancellation_policy_snapshot) : null,
      confirmed_at: record.reservation.confirmed_at,
      cancelled_at: record.reservation.cancelled_at,
      cancel_reason: record.reservation.cancel_reason,
      created_at: record.reservation.created_at,
      updated_at: record.reservation.updated_at,
    },
    stay_plan: record.stayPlan ? {
      id: record.stayPlan.id,
      plan_type: record.stayPlan.plan_type,
      score: record.stayPlan.score,
      move_count: record.stayPlan.move_count,
      upgrade_segments: record.stayPlan.upgrade_segments,
      public_visible: Boolean(record.stayPlan.public_visible),
      is_selected: Boolean(record.stayPlan.is_selected),
      status: record.stayPlan.status,
      meta: record.stayPlan.meta_json ? JSON.parse(record.stayPlan.meta_json) : null,
      segments: record.segments,
    } : null,
    allocations: record.allocations,
  };
}

export async function handleCheckPropertyAvailability(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) {
    return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  }

  let body;
  try {
    body = await parseJsonBody(request);
  } catch {
    return jsonResponse({ error: 'Request body is not valid JSON.' }, 400);
  }

  const parsedRequest = validateAvailabilityRequest(body, params?.propertyId);
  if (parsedRequest.error) {
    return jsonResponse({ error: parsedRequest.error }, 400);
  }

  try {
    const availability = await calculateAvailability(
      env,
      tenantId,
      parsedRequest.propertyId,
      parsedRequest.roomTypeId,
      parsedRequest.checkIn,
      parsedRequest.checkOut,
      parsedRequest.roomsRequested
    );
    if (availability.error) {
      return jsonResponse(availability.error.payload, availability.error.status);
    }

    return jsonResponse(buildAvailabilityPayload(availability));
  } catch (error) {
    console.error('[PROPERTY_AVAILABILITY]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleCreatePropertyAvailabilityHold(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) {
    return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  }

  let body;
  try {
    body = await parseJsonBody(request);
  } catch {
    return jsonResponse({ error: 'Request body is not valid JSON.' }, 400);
  }

  const parsedRequest = validateAvailabilityRequest(body, params?.propertyId);
  if (parsedRequest.error) {
    return jsonResponse({ error: parsedRequest.error }, 400);
  }

  const holdType = String(body?.hold_type || 'soft_hold').trim();
  const sourceType = String(body?.source_type || 'direct_web').trim();
  const sourceId = body?.source_id ? String(body.source_id).trim() : null;
  const ttlSeconds = Number(body?.ttl_seconds || 900);

  if (!['soft_hold', 'manual_hold', 'review_hold'].includes(holdType)) {
    return jsonResponse({ error: 'hold_type must be one of soft_hold, manual_hold, or review_hold.' }, 400);
  }
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 3600) {
    return jsonResponse({ error: 'ttl_seconds must be an integer between 60 and 3600.' }, 400);
  }

  try {
    const availability = await calculateAvailability(
      env,
      tenantId,
      parsedRequest.propertyId,
      parsedRequest.roomTypeId,
      parsedRequest.checkIn,
      parsedRequest.checkOut,
      parsedRequest.roomsRequested
    );
    if (availability.error) {
      return jsonResponse(availability.error.payload, availability.error.status);
    }

    if (availability.shortageDates.length) {
      return jsonResponse({
        error: 'Inventory is no longer available for this stay.',
        availability: buildAvailabilityPayload(availability).availability,
      }, 409);
    }

    const now = currentUnixSeconds();
    const holdId = nanoid();
    const expiresAt = now + ttlSeconds;

    await env.DB
      .prepare(
        `INSERT INTO inventory_holds
          (id, tenant_id, property_id, room_type_id, hold_type, source_type, source_id, check_in, check_out, rooms_requested, status, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
      )
      .bind(
        holdId,
        tenantId,
        parsedRequest.propertyId,
        parsedRequest.roomTypeId,
        holdType,
        sourceType,
        sourceId,
        parsedRequest.checkIn,
        parsedRequest.checkOut,
        parsedRequest.roomsRequested,
        expiresAt,
        now
      )
      .run();

    const refreshedAvailability = await calculateAvailability(
      env,
      tenantId,
      parsedRequest.propertyId,
      parsedRequest.roomTypeId,
      parsedRequest.checkIn,
      parsedRequest.checkOut,
      parsedRequest.roomsRequested
    );

    return jsonResponse({
      ok: true,
      hold: {
        id: holdId,
        property_id: parsedRequest.propertyId,
        room_type_id: parsedRequest.roomTypeId,
        hold_type: holdType,
        source_type: sourceType,
        source_id: sourceId,
        check_in: parsedRequest.checkIn,
        check_out: parsedRequest.checkOut,
        rooms_requested: parsedRequest.roomsRequested,
        expires_at: expiresAt,
      },
      availability: refreshedAvailability.error ? null : buildAvailabilityPayload(refreshedAvailability).availability,
    }, 201);
  } catch (error) {
    console.error('[PROPERTY_HOLD_CREATE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleCreatePropertyReservation(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) {
    return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  }

  let body;
  try {
    body = await parseJsonBody(request);
  } catch {
    return jsonResponse({ error: 'Request body is not valid JSON.' }, 400);
  }

  const parsedRequest = validateReservationCreateRequest(body, params?.propertyId);
  if (parsedRequest.error) {
    return jsonResponse({ error: parsedRequest.error }, 400);
  }

  try {
    let activeHold = null;
    if (parsedRequest.holdId) {
      activeHold = await loadActiveHold(env, tenantId, parsedRequest.propertyId, parsedRequest.holdId);
      if (!activeHold) {
        return jsonResponse({ error: 'Active hold not found.' }, 404);
      }
      if (
        String(activeHold.room_type_id) !== parsedRequest.roomTypeId ||
        String(activeHold.check_in) !== parsedRequest.checkIn ||
        String(activeHold.check_out) !== parsedRequest.checkOut ||
        Number(activeHold.rooms_requested || 0) !== parsedRequest.roomsRequested
      ) {
        return jsonResponse({ error: 'hold_id does not match the requested stay.' }, 409);
      }
    }

    const availability = await calculateAvailability(
      env,
      tenantId,
      parsedRequest.propertyId,
      parsedRequest.roomTypeId,
      parsedRequest.checkIn,
      parsedRequest.checkOut,
      parsedRequest.roomsRequested,
      { excludeHoldId: parsedRequest.holdId }
    );
    if (availability.error) {
      return jsonResponse(availability.error.payload, availability.error.status);
    }
    if (availability.shortageDates.length) {
      return jsonResponse({
        error: 'Inventory is no longer available for this stay.',
        availability: buildAvailabilityPayload(availability).availability,
      }, 409);
    }

    const selectedPlan = selectBestPlan(availability);
    if (!selectedPlan || !selectedPlan.segments?.length || selectedPlan.segments.some((segment) => !segment.room_unit_id)) {
      return jsonResponse({ error: 'No concrete allocation plan is available for confirmation yet.' }, 409);
    }

    const reservationId = nanoid();
    const artifacts = await createReservationArtifacts(env, tenantId, reservationId, parsedRequest.propertyId, parsedRequest, selectedPlan);

    if (activeHold) {
      await env.DB
        .prepare(`UPDATE inventory_holds SET status = 'consumed' WHERE id = ? AND tenant_id = ? AND property_id = ? AND status = 'active'`)
        .bind(parsedRequest.holdId, tenantId, parsedRequest.propertyId)
        .run();
    }

    return jsonResponse({
      ok: true,
      reservation: {
        id: reservationId,
        property_id: parsedRequest.propertyId,
        status: 'confirmed',
        source: parsedRequest.source,
        guest_name: parsedRequest.guestName,
        guest_email: parsedRequest.guestEmail,
        guest_phone: parsedRequest.guestPhone,
        check_in: parsedRequest.checkIn,
        check_out: parsedRequest.checkOut,
        room_type_id: parsedRequest.roomTypeId,
        rooms_requested: parsedRequest.roomsRequested,
        adults: parsedRequest.adults,
        children: parsedRequest.children,
        confirmed_at: artifacts.confirmedAt,
      },
      stay_plan: {
        id: artifacts.stayPlanId,
        plan_type: selectedPlan.plan_type,
        score: selectedPlan.score,
        segments: selectedPlan.segments,
      },
      hold: activeHold ? { id: parsedRequest.holdId, status: 'consumed' } : null,
    }, 201);
  } catch (error) {
    console.error('[PROPERTY_RESERVATION_CREATE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleReleasePropertyAvailabilityHold(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const holdId = String(params?.holdId || '').trim();

  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  try {
    const hold = await env.DB
      .prepare(
        `SELECT id, tenant_id, property_id, room_type_id, hold_type, source_type, source_id,
                check_in, check_out, rooms_requested, status, expires_at, created_at
           FROM inventory_holds
          WHERE id = ? AND tenant_id = ? AND property_id = ?`
      )
      .bind(holdId, tenantId, propertyId)
      .first();

    if (!hold) return jsonResponse({ error: 'Hold not found.' }, 404);
    if (hold.status !== 'active') return jsonResponse({ error: 'Only active holds can be released.' }, 409);

    await env.DB
      .prepare(`UPDATE inventory_holds SET status = 'released' WHERE id = ? AND tenant_id = ? AND property_id = ? AND status = 'active'`)
      .bind(holdId, tenantId, propertyId)
      .run();

    return jsonResponse({
      ok: true,
      hold: {
        ...hold,
        status: 'released',
      },
    });
  } catch (error) {
    console.error('[PROPERTY_HOLD_RELEASE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleGetPropertyReservation(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) {
    return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  }

  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  const propertyId = String(params?.propertyId || '').trim();
  const reservationId = String(params?.reservationId || '').trim();
  if (!propertyId || !reservationId) {
    return jsonResponse({ error: 'propertyId and reservationId are required.' }, 400);
  }

  try {
    const record = await loadPropertyReservation(env, tenantId, propertyId, reservationId);
    if (!record) {
      return jsonResponse({ error: 'Reservation not found.' }, 404);
    }

    return jsonResponse(buildReservationPayload(record));
  } catch (error) {
    console.error('[PROPERTY_RESERVATION_GET]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleCancelPropertyReservation(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) {
    return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  }

  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  const propertyId = String(params?.propertyId || '').trim();
  const reservationId = String(params?.reservationId || '').trim();
  if (!propertyId || !reservationId) {
    return jsonResponse({ error: 'propertyId and reservationId are required.' }, 400);
  }

  let body = {};
  try {
    if ((request.headers.get('content-type') || '').includes('application/json')) {
      body = await parseJsonBody(request);
    }
  } catch {
    return jsonResponse({ error: 'Request body is not valid JSON.' }, 400);
  }

  const cancelReason = body?.cancel_reason ? String(body.cancel_reason).trim() : null;
  const cancelledBy = request.headers.get('X-User-ID')?.trim() || null;

  try {
    const record = await loadPropertyReservation(env, tenantId, propertyId, reservationId);
    if (!record) {
      return jsonResponse({ error: 'Reservation not found.' }, 404);
    }
    if (record.reservation.status === 'cancelled') {
      return jsonResponse({ error: 'Reservation is already cancelled.' }, 409);
    }
    if (['checked_in', 'checked_out'].includes(String(record.reservation.status))) {
      return jsonResponse({ error: `Cannot cancel a reservation in status ${record.reservation.status}.` }, 409);
    }

    const now = currentUnixSeconds();

    await env.DB
      .prepare(
        `UPDATE property_reservations
            SET status = 'cancelled',
                cancelled_at = ?,
                cancelled_by = ?,
                cancel_reason = ?,
                updated_at = ?
          WHERE id = ? AND tenant_id = ? AND property_id = ?`
      )
      .bind(now, cancelledBy, cancelReason, now, reservationId, tenantId, propertyId)
      .run();

    await env.DB
      .prepare(
        `UPDATE reservation_stay_plans
            SET status = 'discarded',
                is_selected = 0,
                updated_at = ?
          WHERE reservation_id = ? AND tenant_id = ? AND property_id = ? AND status IN ('selected', 'locked', 'candidate')`
      )
      .bind(now, reservationId, tenantId, propertyId)
      .run();

    await env.DB
      .prepare(
        `UPDATE reservation_allocations
            SET allocation_status = 'released',
                updated_at = ?
          WHERE reservation_id = ? AND tenant_id = ? AND property_id = ? AND allocation_status IN ('soft_allocated', 'locked')`
      )
      .bind(now, reservationId, tenantId, propertyId)
      .run();

    const updatedRecord = await loadPropertyReservation(env, tenantId, propertyId, reservationId);
    return jsonResponse(buildReservationPayload(updatedRecord));
  } catch (error) {
    console.error('[PROPERTY_RESERVATION_CANCEL]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleRebookPropertyReservation(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);

  const propertyId = String(params?.propertyId || '').trim();
  const reservationId = String(params?.reservationId || '').trim();
  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }

  try {
    const record = await loadPropertyReservation(env, tenantId, propertyId, reservationId);
    if (!record) return jsonResponse({ error: 'Reservation not found.' }, 404);
    const statusError = validateReservationStatusTransition(record, ['confirmed'], 'Rebook');
    if (statusError) return jsonResponse({ error: statusError.error }, 409);

    const parsedRequest = validateReservationRebookRequest(body, propertyId, record.reservation);
    if (parsedRequest.error) return jsonResponse({ error: parsedRequest.error }, 400);

    let activeHold = null;
    if (parsedRequest.holdId) {
      activeHold = await loadActiveHold(env, tenantId, propertyId, parsedRequest.holdId);
      if (!activeHold) return jsonResponse({ error: 'Active hold not found.' }, 404);
      if (
        String(activeHold.room_type_id) !== parsedRequest.roomTypeId ||
        String(activeHold.check_in) !== parsedRequest.checkIn ||
        String(activeHold.check_out) !== parsedRequest.checkOut ||
        Number(activeHold.rooms_requested || 0) !== parsedRequest.roomsRequested
      ) {
        return jsonResponse({ error: 'hold_id does not match the requested rebook stay.' }, 409);
      }
    }

    const availability = await calculateAvailability(
      env,
      tenantId,
      propertyId,
      parsedRequest.roomTypeId,
      parsedRequest.checkIn,
      parsedRequest.checkOut,
      parsedRequest.roomsRequested,
      { excludeHoldId: parsedRequest.holdId, excludeReservationId: reservationId }
    );
    if (availability.error) return jsonResponse(availability.error.payload, availability.error.status);
    if (availability.shortageDates.length) {
      return jsonResponse({
        error: 'Inventory is no longer available for the rebooked stay.',
        availability: buildAvailabilityPayload(availability).availability,
      }, 409);
    }

    const selectedPlan = selectBestPlan(availability);
    if (!selectedPlan || !selectedPlan.segments?.length || selectedPlan.segments.some((segment) => !segment.room_unit_id)) {
      return jsonResponse({ error: 'No concrete allocation plan is available for rebooking yet.' }, 409);
    }

    const now = currentUnixSeconds();
    await discardReservationStayPlanState(env, tenantId, propertyId, reservationId);
    await env.DB
      .prepare(
        `UPDATE property_reservations
            SET check_in = ?,
                check_out = ?,
                room_type_id = ?,
                rooms_requested = ?,
                adults = ?,
                children = ?,
                pricing_snapshot = ?,
                special_requests = ?,
                expected_arrival_time = ?,
                expected_flight_ref = ?,
                expected_arrival_channel = ?,
                updated_at = ?
          WHERE id = ? AND tenant_id = ? AND property_id = ?`
      )
      .bind(
        parsedRequest.checkIn,
        parsedRequest.checkOut,
        parsedRequest.roomTypeId,
        parsedRequest.roomsRequested,
        parsedRequest.adults,
        parsedRequest.children,
        parsedRequest.pricingSnapshot,
        parsedRequest.specialRequests,
        parsedRequest.expectedArrivalTime,
        parsedRequest.expectedFlightRef,
        parsedRequest.expectedArrivalChannel,
        now,
        reservationId,
        tenantId,
        propertyId
      )
      .run();

    await attachSelectedStayPlanArtifacts(env, tenantId, reservationId, propertyId, selectedPlan);

    if (activeHold) {
      await env.DB
        .prepare(`UPDATE inventory_holds SET status = 'consumed' WHERE id = ? AND tenant_id = ? AND property_id = ? AND status = 'active'`)
        .bind(parsedRequest.holdId, tenantId, propertyId)
        .run();
    }

    const updatedRecord = await loadPropertyReservation(env, tenantId, propertyId, reservationId);
    return jsonResponse({
      ...buildReservationPayload(updatedRecord),
      rebooked: true,
    });
  } catch (error) {
    console.error('[PROPERTY_RESERVATION_REBOOK]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleCheckInPropertyReservation(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);

  const propertyId = String(params?.propertyId || '').trim();
  const reservationId = String(params?.reservationId || '').trim();
  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  try {
    const record = await loadPropertyReservation(env, tenantId, propertyId, reservationId);
    if (!record) return jsonResponse({ error: 'Reservation not found.' }, 404);
    const statusError = validateReservationStatusTransition(record, ['confirmed'], 'Check-in');
    if (statusError) return jsonResponse({ error: statusError.error }, 409);

    await env.DB
      .prepare(`UPDATE property_reservations SET status = 'checked_in', updated_at = ? WHERE id = ? AND tenant_id = ? AND property_id = ?`)
      .bind(currentUnixSeconds(), reservationId, tenantId, propertyId)
      .run();

    const updatedRecord = await loadPropertyReservation(env, tenantId, propertyId, reservationId);
    return jsonResponse(buildReservationPayload(updatedRecord));
  } catch (error) {
    console.error('[PROPERTY_RESERVATION_CHECK_IN]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleCheckOutPropertyReservation(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);

  const propertyId = String(params?.propertyId || '').trim();
  const reservationId = String(params?.reservationId || '').trim();
  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  try {
    const record = await loadPropertyReservation(env, tenantId, propertyId, reservationId);
    if (!record) return jsonResponse({ error: 'Reservation not found.' }, 404);
    const statusError = validateReservationStatusTransition(record, ['checked_in'], 'Check-out');
    if (statusError) return jsonResponse({ error: statusError.error }, 409);

    await env.DB
      .prepare(`UPDATE property_reservations SET status = 'checked_out', updated_at = ? WHERE id = ? AND tenant_id = ? AND property_id = ?`)
      .bind(currentUnixSeconds(), reservationId, tenantId, propertyId)
      .run();

    const updatedRecord = await loadPropertyReservation(env, tenantId, propertyId, reservationId);
    return jsonResponse(buildReservationPayload(updatedRecord));
  } catch (error) {
    console.error('[PROPERTY_RESERVATION_CHECK_OUT]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleEarlyCheckOutPropertyReservation(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);

  const propertyId = String(params?.propertyId || '').trim();
  const reservationId = String(params?.reservationId || '').trim();
  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }

  try {
    const record = await loadPropertyReservation(env, tenantId, propertyId, reservationId);
    if (!record) return jsonResponse({ error: 'Reservation not found.' }, 404);
    const statusError = validateReservationStatusTransition(record, ['checked_in'], 'Early check-out');
    if (statusError) return jsonResponse({ error: statusError.error }, 409);

    const parsed = validateEarlyCheckoutRequest(body, record.reservation);
    if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

    const now = currentUnixSeconds();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE property_reservations
            SET status = 'checked_out',
                check_out = ?,
                updated_at = ?
          WHERE id = ? AND tenant_id = ? AND property_id = ?`
      ).bind(parsed.effectiveCheckOut, now, reservationId, tenantId, propertyId),
      env.DB.prepare(
        `UPDATE reservation_allocations
            SET allocation_status = 'released',
                updated_at = ?
          WHERE tenant_id = ?
            AND property_id = ?
            AND reservation_id = ?
            AND allocation_status IN ('soft_allocated', 'locked')
            AND stay_date >= ?`
      ).bind(now, tenantId, propertyId, reservationId, parsed.effectiveCheckOut),
      env.DB.prepare(
        `UPDATE reservation_stay_plan_segments
            SET check_out = ?
          WHERE tenant_id = ?
            AND property_id = ?
            AND reservation_id = ?
            AND check_in < ?
            AND check_out > ?`
      ).bind(parsed.effectiveCheckOut, tenantId, propertyId, reservationId, parsed.effectiveCheckOut, parsed.effectiveCheckOut),
      env.DB.prepare(
        `DELETE FROM reservation_stay_plan_segments
          WHERE tenant_id = ?
            AND property_id = ?
            AND reservation_id = ?
            AND check_in >= ?`
      ).bind(tenantId, propertyId, reservationId, parsed.effectiveCheckOut),
    ]);

    const updatedRecord = await loadPropertyReservation(env, tenantId, propertyId, reservationId);
    return jsonResponse({
      ...buildReservationPayload(updatedRecord),
      early_checked_out: true,
      effective_check_out: parsed.effectiveCheckOut,
    });
  } catch (error) {
    console.error('[PROPERTY_RESERVATION_EARLY_CHECK_OUT]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleNoShowPropertyReservation(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);

  const propertyId = String(params?.propertyId || '').trim();
  const reservationId = String(params?.reservationId || '').trim();
  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  try {
    const record = await loadPropertyReservation(env, tenantId, propertyId, reservationId);
    if (!record) return jsonResponse({ error: 'Reservation not found.' }, 404);
    const statusError = validateReservationStatusTransition(record, ['confirmed'], 'No-show');
    if (statusError) return jsonResponse({ error: statusError.error }, 409);

    await discardReservationStayPlanState(env, tenantId, propertyId, reservationId);
    await env.DB
      .prepare(`UPDATE property_reservations SET status = 'no_show', updated_at = ? WHERE id = ? AND tenant_id = ? AND property_id = ?`)
      .bind(currentUnixSeconds(), reservationId, tenantId, propertyId)
      .run();

    const updatedRecord = await loadPropertyReservation(env, tenantId, propertyId, reservationId);
    return jsonResponse({
      ...buildReservationPayload(updatedRecord),
      no_show: true,
    });
  } catch (error) {
    console.error('[PROPERTY_RESERVATION_NO_SHOW]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleUndoPropertyReservationStatus(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);

  const propertyId = String(params?.propertyId || '').trim();
  const reservationId = String(params?.reservationId || '').trim();
  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  try {
    const record = await loadPropertyReservation(env, tenantId, propertyId, reservationId);
    if (!record) return jsonResponse({ error: 'Reservation not found.' }, 404);

    if (record.reservation.status === 'checked_in') {
      await env.DB
        .prepare(`UPDATE property_reservations SET status = 'confirmed', updated_at = ? WHERE id = ? AND tenant_id = ? AND property_id = ?`)
        .bind(currentUnixSeconds(), reservationId, tenantId, propertyId)
        .run();
      const updatedRecord = await loadPropertyReservation(env, tenantId, propertyId, reservationId);
      return jsonResponse({
        ...buildReservationPayload(updatedRecord),
        undone_from: 'checked_in',
      });
    }

    if (record.reservation.status === 'no_show') {
      const availability = await calculateAvailability(
        env,
        tenantId,
        propertyId,
        record.reservation.room_type_id,
        record.reservation.check_in,
        record.reservation.check_out,
        record.reservation.rooms_requested,
        { excludeReservationId: reservationId }
      );
      if (availability.error) return jsonResponse(availability.error.payload, availability.error.status);
      if (availability.shortageDates.length) {
        return jsonResponse({
          error: 'Inventory is no longer available to undo the no-show status.',
          availability: buildAvailabilityPayload(availability).availability,
        }, 409);
      }

      const selectedPlan = selectBestPlan(availability);
      if (!selectedPlan || !selectedPlan.segments?.length || selectedPlan.segments.some((segment) => !segment.room_unit_id)) {
        return jsonResponse({ error: 'No concrete allocation plan is available to restore this reservation.' }, 409);
      }

      await attachSelectedStayPlanArtifacts(env, tenantId, reservationId, propertyId, selectedPlan);
      await env.DB
        .prepare(`UPDATE property_reservations SET status = 'confirmed', updated_at = ? WHERE id = ? AND tenant_id = ? AND property_id = ?`)
        .bind(currentUnixSeconds(), reservationId, tenantId, propertyId)
        .run();

      const updatedRecord = await loadPropertyReservation(env, tenantId, propertyId, reservationId);
      return jsonResponse({
        ...buildReservationPayload(updatedRecord),
        undone_from: 'no_show',
      });
    }

    return jsonResponse({ error: 'Undo is only supported for checked_in and no_show reservations in this baseline.' }, 409);
  } catch (error) {
    console.error('[PROPERTY_RESERVATION_UNDO_STATUS]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}