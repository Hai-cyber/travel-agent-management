import { nanoid } from 'nanoid';
import { SESSION_COOKIE_NAME, getAuthSession } from '../lib/auth.js';
import {
  addDays,
  currentUnixSeconds,
  enumerateDateRange,
  enumerateStayDates,
  formatDateParts,
  formatDateUtc,
  getTimeZoneDateTimeParts,
  isIsoDate,
  parseDateUtc,
} from './properties/date-utils.js';
import {
  PROPERTY_WEEKDAY_NAMES,
  buildAddonSalesPolicy,
  mapAddonServicePresetRow,
  mapPropertyAllotmentRow,
  mapPropertyPricingProfileRow,
  mapPropertyRow,
  mapPropertyWeekdayPricingRuleRow,
  mapRateSeasonRow,
  mapRoomRateRow,
  mapRoomTypeRow,
  mapRoomUnitRow,
  mapSeasonRateRow,
  parseJsonSafe,
} from './properties/mappers.js';
import {
  buildResolvedRateQuotePayload as pricingBuildResolvedRateQuotePayload,
  buildReservationPricingSnapshot as pricingBuildReservationPricingSnapshot,
  parseReservationPricingSnapshotValue as pricingParseReservationPricingSnapshotValue,
  resolveFrozenReservationPricingSnapshot as pricingResolveFrozenReservationPricingSnapshot,
  resolveSnapshotNightlyRate as pricingResolveSnapshotNightlyRate,
} from './properties/pricing.js';
import {
  validateAddonServicePresetCreateRequest,
  validateAddonServicePresetPatchRequest,
  validateAvailabilityRequest,
  validateEarlyCheckoutRequest,
  validateFolioChargeRequest,
  validateFolioPaymentRequest,
  validateHousekeepingTaskPatchRequest,
  validatePlannerPricingPreviewRequest,
  validatePropertyAllotmentCreateRequest,
  validatePropertyAllotmentPatchRequest,
  validatePropertyCreateRequest,
  validatePropertyPatchRequest,
  validatePropertyPricingProfileConfiguration,
  validatePropertyPricingProfileCreateRequest,
  validatePropertyPricingProfilePatchRequest,
  validatePropertyWeekdayPricingRuleCreateRequest,
  validatePropertyWeekdayPricingRulePatchRequest,
  validateRateQuoteRequest,
  validateRateSeasonCreateRequest,
  validateRateSeasonPatchRequest,
  validateReservationCreateRequest,
  validateReservationRebookRequest,
  validateReservationRoomAssignmentRequest,
  validateRoomRateCreateRequest,
  validateRoomRatePatchRequest,
  validateRoomTypeCreateRequest,
  validateRoomTypePatchRequest,
  validateRoomUnitBulkCreateRequest,
  validateRoomUnitCreateRequest,
  validateRoomUnitFlagPatchRequest,
  validateRoomUnitPatchRequest,
  validateSeasonRoomRateCreateRequest,
  validateSeasonRoomRatePatchRequest,
  validateShiftHandoverPatchRequest,
} from './properties/validators.js';

const pricingSnapshotDeps = {
  resolvePropertyRateQuote,
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function imageResponse(object) {
  if (!object?.body) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  return new Response(object.body, { status: 200, headers });
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

// Manager+ required for property/room configuration (not operational use).
// owner=4, manager=3, staff=2, provider=1
const PROPERTY_ROLE_RANK = { owner: 4, manager: 3, staff: 2, provider: 1 };
async function requireManagerActor(request, env, tenantId) {
  const result = await requireTenantActor(request, env, tenantId);
  if (result.error) return result;
  if ((PROPERTY_ROLE_RANK[result.session.role] ?? 0) < 3) {
    return { error: jsonResponse({ error: 'Manager or owner access required.' }, 403) };
  }
  return result;
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

function effectiveAllotmentRoomsBlocked(row, options = {}) {
  const blockedRooms = Number(row?.rooms_blocked || 0);
  const consumeAllotmentId = options.consumeAllotmentId ? String(options.consumeAllotmentId).trim() : null;
  const consumeAllotmentRooms = Math.max(0, Number(options.consumeAllotmentRooms || 0));
  if (consumeAllotmentId && String(row?.id || '') === consumeAllotmentId) {
    return Math.max(blockedRooms - consumeAllotmentRooms, 0);
  }
  return blockedRooms;
}

function countAllotmentsByNight(allotmentRows, stayDates, options = {}) {
  const todayIso = options.todayIso || formatDateUtc(new Date());
  const allotmentCounts = new Map();
  const dateSet = new Set(stayDates);

  for (const row of allotmentRows || []) {
    if (String(row.status || 'active') !== 'active') continue;
    if (row.release_date && String(row.release_date) < todayIso) continue;
    const effectiveRoomsBlocked = effectiveAllotmentRoomsBlocked(row, options);
    if (effectiveRoomsBlocked < 1) continue;
    const roomTypeId = String(row.room_type_id);
    const perNight = getOrCreateMap(allotmentCounts, roomTypeId);
    const allotmentDates = enumerateStayDates(row.check_in, row.check_out);
    for (const stayDate of allotmentDates) {
      if (!dateSet.has(stayDate)) continue;
      perNight.set(stayDate, (perNight.get(stayDate) || 0) + effectiveRoomsBlocked);
    }
  }

  return allotmentCounts;
}

function buildNightlyRemaining(roomTypes, roomUnitsByType, allocationCounts, holdCounts, allotmentCounts, stayDates) {
  const nightlyRemainingByType = new Map();

  for (const roomType of roomTypes) {
    const roomTypeId = String(roomType.id);
    const baseCount = (roomUnitsByType.get(roomTypeId) || []).length;
    const allocated = allocationCounts.get(roomTypeId) || new Map();
    const held = holdCounts.get(roomTypeId) || new Map();
    const allotted = allotmentCounts.get(roomTypeId) || new Map();
    const rows = stayDates.map((stayDate) => {
      const remaining = baseCount - (allocated.get(stayDate) || 0) - (held.get(stayDate) || 0) - (allotted.get(stayDate) || 0);
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

function prioritizeRoomUnits(roomUnits, preferredRoomUnitId = null) {
  if (!preferredRoomUnitId) return roomUnits || [];
  const preferredId = String(preferredRoomUnitId);
  return [...(roomUnits || [])].sort((left, right) => {
    const leftPreferred = String(left?.id || '') === preferredId ? 1 : 0;
    const rightPreferred = String(right?.id || '') === preferredId ? 1 : 0;
    return rightPreferred - leftPreferred;
  });
}

function findContiguousUnits(roomUnits, occupiedDatesByUnit, stayDates, roomsRequested, preferredRoomUnitId = null) {
  const candidates = [];
  for (const roomUnit of prioritizeRoomUnits(roomUnits, preferredRoomUnitId)) {
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
        room_number: chosen.room_number || null,
        floor_label: chosen.floor_label || null,
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
const HOUSEKEEPING_TASK_STATUSES = new Set(['pending', 'in_progress', 'waiting_inspection', 'completed', 'cancelled']);
const HOUSEKEEPING_ROOM_STATES = new Set(['dirty', 'cleaning', 'ready_for_inspection', 'inspected', 'ready']);
const HOUSEKEEPING_TASK_KINDS = new Set(['departure_clean', 'stayover_refresh']);
const HOUSEKEEPING_TASK_PRIORITIES = new Set(['arrival_today_high', 'arrival_today_normal', 'departure_clean', 'routine', 'blocked_maintenance']);
const PROPERTY_ADDON_SERVICE_TYPES = new Set(['transfer', 'meal', 'wellness', 'housekeeping', 'transport', 'experience', 'fee', 'other']);
const PROPERTY_ADDON_PRICING_MODES = new Set(['fixed', 'per_unit', 'per_guest', 'per_night']);
const PROPERTY_ADDON_SCOPES = new Set(['per_stay', 'per_night', 'per_guest', 'per_room']);
const PROPERTY_ALLOTMENT_STATUSES = new Set(['active', 'released', 'expired']);
const PROPERTY_PRICING_PROFILE_VISIBILITIES = new Set(['planner_only']);
const PROPERTY_PRICING_PROFILE_MODES = new Set(['fixed_nightly_amount', 'delta_amount', 'delta_percent']);

const DEFAULT_PROPERTY_ADDON_PRESETS = {
  airport_pickup: {
    code: 'AIRPORT-PICKUP',
    name: 'Airport Pickup',
    service_type: 'transfer',
    pricing_mode: 'fixed',
    currency: 'USD',
    default_unit_price: 35,
    default_unit_label: 'booking',
    scope: 'per_stay',
    notes: 'The only pre-arrival addon exception. All other addons stay onsite-only.',
  },
  breakfast_upgrade: {
    code: 'BREAKFAST-UPGRADE',
    name: 'Breakfast Upgrade',
    service_type: 'meal',
    pricing_mode: 'per_guest',
    currency: 'USD',
    default_unit_price: 12,
    default_unit_label: 'guest',
    scope: 'per_guest',
    notes: 'Onsite-only addon sold after arrival or during stay.',
  },
  extra_bed: {
    code: 'EXTRA-BED',
    name: 'Extra Bed',
    service_type: 'housekeeping',
    pricing_mode: 'per_night',
    currency: 'USD',
    default_unit_price: 25,
    default_unit_label: 'night',
    scope: 'per_night',
    notes: 'Onsite-only addon posted per occupied night.',
  },
  late_checkout: {
    code: 'LATE-CHECKOUT',
    name: 'Late Checkout',
    service_type: 'fee',
    pricing_mode: 'fixed',
    currency: 'USD',
    default_unit_price: 20,
    default_unit_label: 'booking',
    scope: 'per_stay',
    late_checkout_fee: 20,
    notes: 'Onsite-only fee preset for front desk approval.',
  },
  early_arrival: {
    code: 'EARLY-ARRIVAL',
    name: 'Early Arrival',
    service_type: 'fee',
    pricing_mode: 'fixed',
    currency: 'USD',
    default_unit_price: 20,
    default_unit_label: 'booking',
    scope: 'per_stay',
    early_arrival_fee: 20,
    notes: 'Onsite-only fee preset for front desk approval before standard check-in time.',
  },
  laundry_bag: {
    code: 'LAUNDRY-BAG',
    name: 'Laundry Bag',
    service_type: 'other',
    pricing_mode: 'per_unit',
    currency: 'USD',
    default_unit_price: 10,
    default_unit_label: 'bag',
    scope: 'per_stay',
    notes: 'Onsite-only laundry service posted per returned bag.',
  },
};

function serializeAddonConfigJson(serviceType, code, name, rawConfig) {
  const parsed = typeof rawConfig === 'string' ? parseJsonSafe(rawConfig) : rawConfig;
  const config = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...parsed } : {};
  delete config.sales_policy;
  delete config.sales_channel;
  delete config.onsite_only;
  delete config.prearrival_exception;
  config.sales_policy = buildAddonSalesPolicy(serviceType, code, name);
  return JSON.stringify(config);
}

function buildReservationGuestPhotoKey(tenantId, propertyId, reservationId, extension = 'bin') {
  const safeExtension = String(extension || 'bin').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'bin';
  return `property-guest-photos/${tenantId}/${propertyId}/${reservationId}/primary.${safeExtension}`;
}

function buildReservationGuestPhotoUrl(propertyId, reservationId, guestPhotoKey) {
  if (!guestPhotoKey) return null;
  return `/api/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/guest-photo`;
}

function detectFileExtension(contentType, filename) {
  const name = String(filename || '').trim().toLowerCase();
  if (name.includes('.') && /^[a-z0-9]+$/.test(name.split('.').pop())) return name.split('.').pop();
  const normalizedContentType = String(contentType || '').trim().toLowerCase();
  if (normalizedContentType === 'image/jpeg') return 'jpg';
  if (normalizedContentType === 'image/png') return 'png';
  if (normalizedContentType === 'image/webp') return 'webp';
  if (normalizedContentType === 'image/gif') return 'gif';
  return 'bin';
}

function roomNumberFromSequence(prefix, number) {
  return `${prefix || ''}${String(number)}`;
}

function buildSegmentsForContiguousUnits(roomTypeId, checkIn, checkOut, contiguousUnits, roomsRequested) {
  if (!Array.isArray(contiguousUnits) || contiguousUnits.length < roomsRequested) {
    return Array.from({ length: roomsRequested }, (_, index) => ({
      room_type_id: roomTypeId,
      room_unit_id: contiguousUnits[index]?.id ? String(contiguousUnits[index].id) : null,
      room_number: contiguousUnits[index]?.room_number || null,
      floor_label: contiguousUnits[index]?.floor_label || null,
      check_in: checkIn,
      check_out: checkOut,
    }));
  }
  return contiguousUnits.slice(0, roomsRequested).map((roomUnit) => ({
    room_type_id: roomTypeId,
    room_unit_id: String(roomUnit.id),
    room_number: roomUnit.room_number || null,
    floor_label: roomUnit.floor_label || null,
    check_in: checkIn,
    check_out: checkOut,
  }));
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
              same_day_turnover_sellable,
              shift_handover_note, shift_handover_updated_at, shift_handover_updated_by,
              address_line_1, address_line_2, city, state_province, postal_code, country_code,
              created_at, updated_at
         FROM properties
        WHERE id = ? AND tenant_id = ?`
    )
    .bind(propertyId, tenantId)
    .first();
  return row ? mapPropertyRow(row) : null;
}

async function loadAddonServicePresetById(env, tenantId, propertyId, presetId) {
  const row = await env.DB
    .prepare(
      `SELECT id, tenant_id, property_id, code, name, service_type, pricing_mode, currency,
              default_unit_price, default_unit_label, scope, early_arrival_fee, late_checkout_fee,
              active, sort_order, notes, config_json,
              created_at, updated_at
         FROM property_addon_service_presets
        WHERE tenant_id = ? AND property_id = ? AND id = ?`
    )
    .bind(tenantId, propertyId, presetId)
    .first();
  return row ? mapAddonServicePresetRow(row) : null;
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

async function loadPropertyAllotmentById(env, tenantId, propertyId, allotmentId) {
  const todayIso = formatDateUtc(new Date());
  const row = await env.DB
    .prepare(
      `SELECT pa.id, pa.tenant_id, pa.property_id, pa.room_type_id, pa.operator_name, pa.operator_code,
              pa.source_ref, pa.check_in, pa.check_out, pa.rooms_blocked, pa.release_date, pa.status,
              pa.notes, pa.created_by, pa.updated_by, pa.created_at, pa.updated_at,
              rt.code AS room_type_code, rt.name AS room_type_name,
              CASE
                WHEN pa.status = 'active' AND (pa.release_date IS NULL OR pa.release_date >= ?) THEN 1
                ELSE 0
              END AS inventory_blocking
         FROM property_allotments pa
         JOIN room_types rt
           ON rt.id = pa.room_type_id
          AND rt.tenant_id = pa.tenant_id
          AND rt.property_id = pa.property_id
        WHERE pa.id = ? AND pa.tenant_id = ? AND pa.property_id = ?`
    )
    .bind(todayIso, allotmentId, tenantId, propertyId)
    .first();
  return row ? mapPropertyAllotmentRow(row) : null;
}

async function listPropertyAllotmentsInRange(env, tenantId, propertyId, fromDate, toDate, status = 'all') {
  const todayIso = formatDateUtc(new Date());
  let sql = `SELECT pa.id, pa.tenant_id, pa.property_id, pa.room_type_id, pa.operator_name, pa.operator_code,
                    pa.source_ref, pa.check_in, pa.check_out, pa.rooms_blocked, pa.release_date, pa.status,
                    pa.notes, pa.created_by, pa.updated_by, pa.created_at, pa.updated_at,
                    rt.code AS room_type_code, rt.name AS room_type_name,
                    CASE
                      WHEN pa.status = 'active' AND (pa.release_date IS NULL OR pa.release_date >= ?) THEN 1
                      ELSE 0
                    END AS inventory_blocking
               FROM property_allotments pa
               JOIN room_types rt
                 ON rt.id = pa.room_type_id
                AND rt.tenant_id = pa.tenant_id
                AND rt.property_id = pa.property_id
              WHERE pa.tenant_id = ?
                AND pa.property_id = ?
                AND pa.check_in < ?
                AND pa.check_out > ?`;
  const binds = [todayIso, tenantId, propertyId, toDate, fromDate];
  if (status !== 'all') {
    sql += ` AND pa.status = ?`;
    binds.push(status);
  }
  sql += ` ORDER BY pa.check_in ASC, pa.operator_name ASC, pa.room_type_id ASC`;
  const result = await env.DB.prepare(sql).bind(...binds).all();
  return (result.results || []).map(mapPropertyAllotmentRow);
}

async function loadRoomUnitById(env, tenantId, propertyId, roomUnitId) {
  const row = await env.DB
    .prepare(
      `SELECT id, tenant_id, property_id, room_type_id, room_number, floor_label, sort_order, active, operational_status,
              do_not_disturb, room_service_requested, created_at, updated_at
         FROM room_units
        WHERE id = ? AND tenant_id = ? AND property_id = ?`
    )
    .bind(roomUnitId, tenantId, propertyId)
    .first();
  return row ? mapRoomUnitRow(row) : null;
}

function normalizeMonthKey(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value) ? value : null;
}

function startOfMonthUtc(monthKey) {
  return parseDateUtc(`${monthKey}-01`);
}

async function listRoomUnitReservationsInRange(env, tenantId, propertyId, roomUnitId, rangeStart, rangeEndExclusive) {
  const result = await env.DB
    .prepare(
      `SELECT id, tenant_id, property_id, status, guest_name, check_in, check_out, assigned_room_unit_id, room_type_id
         FROM property_reservations
        WHERE tenant_id = ?
          AND property_id = ?
          AND assigned_room_unit_id = ?
          AND status IN ('confirmed', 'checked_in', 'checked_out')
          AND check_out > ?
          AND check_in < ?
        ORDER BY check_in ASC, created_at ASC`
    )
    .bind(tenantId, propertyId, roomUnitId, rangeStart, rangeEndExclusive)
    .all();
  return result.results || [];
}

function buildRoomUnitAvailabilityCalendarPayload(roomUnit, monthKey, reservations) {
  const monthStart = startOfMonthUtc(monthKey);
  const monthEndExclusive = addDays(new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1)), 0);
  const days = enumerateDateRange(monthStart, addDays(monthEndExclusive, -1)).map((dateText) => {
    const reservation = (reservations || []).find((entry) => entry.check_in <= dateText && entry.check_out > dateText);
    return {
      date: dateText,
      status: reservation ? 'reserved' : 'available',
      reservation_id: reservation?.id || null,
      guest_name: reservation?.guest_name || null,
    };
  });

  return {
    ok: true,
    room_unit: roomUnit,
    month: monthKey,
    days,
    reservations: (reservations || []).map((entry) => ({
      id: entry.id,
      status: entry.status,
      guest_name: entry.guest_name,
      check_in: entry.check_in,
      check_out: entry.check_out,
    })),
  };
}

export async function handleGetRoomUnitAvailabilityCalendar(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const roomUnitId = String(params?.roomUnitId || '').trim();

  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  const url = new URL(request.url);
  const monthKey = normalizeMonthKey(String(url.searchParams.get('month') || '').trim()) || formatDateUtc(new Date()).slice(0, 7);

  try {
    const property = await loadPropertyById(env, tenantId, propertyId);
    if (!property) return jsonResponse({ error: 'Property not found.' }, 404);
    const roomUnit = await loadRoomUnitById(env, tenantId, propertyId, roomUnitId);
    if (!roomUnit) return jsonResponse({ error: 'Room unit not found.' }, 404);

    const monthStart = formatDateUtc(startOfMonthUtc(monthKey));
    const monthEndExclusive = formatDateUtc(new Date(Date.UTC(startOfMonthUtc(monthKey).getUTCFullYear(), startOfMonthUtc(monthKey).getUTCMonth() + 1, 1)));
    const reservations = await listRoomUnitReservationsInRange(env, tenantId, propertyId, roomUnitId, monthStart, monthEndExclusive);
    return jsonResponse(buildRoomUnitAvailabilityCalendarPayload(roomUnit, monthKey, reservations));
  } catch (error) {
    console.error('[ROOM_UNIT_AVAILABILITY_CALENDAR_GET]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleGetPropertyRoomRackSummary(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();

  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  const url = new URL(request.url);
  const fromDate = String(url.searchParams.get('from_date') || formatDateUtc(new Date())).trim();
  const lookaheadDays = Math.min(180, Math.max(7, Number(url.searchParams.get('lookahead_days') || 90)));
  if (!isIsoDate(fromDate)) return jsonResponse({ error: 'from_date must use YYYY-MM-DD format.' }, 400);

  try {
    const property = await loadPropertyById(env, tenantId, propertyId);
    if (!property) return jsonResponse({ error: 'Property not found.' }, 404);

    const roomUnitsResult = await env.DB
      .prepare(
        `SELECT id, tenant_id, property_id, room_type_id, room_number, floor_label, sort_order, active, operational_status,
                do_not_disturb, room_service_requested, created_at, updated_at
           FROM room_units
          WHERE tenant_id = ? AND property_id = ?`
      )
      .bind(tenantId, propertyId)
      .all();
    const roomUnits = (roomUnitsResult.results || []).map(mapRoomUnitRow);
    const rangeEndExclusive = formatDateUtc(addDays(parseDateUtc(fromDate), lookaheadDays));

    // CHK-R107: Use reservation_allocations as the source of truth so multi-room
    // and split-stay reservations (where assigned_room_unit_id may be null) are
    // correctly reflected in the rack's forward-looking availability signals.
    const allocResult = await env.DB
      .prepare(
        `SELECT ra.room_unit_id, ra.reservation_id,
                pr.guest_name, pr.check_in, pr.check_out, pr.status,
                MIN(ra.stay_date) AS first_alloc_date,
                MAX(ra.stay_date) AS last_alloc_date
           FROM reservation_allocations ra
           JOIN property_reservations pr
             ON pr.id = ra.reservation_id
            AND pr.tenant_id = ra.tenant_id
            AND pr.property_id = ra.property_id
          WHERE ra.tenant_id = ?
            AND ra.property_id = ?
            AND ra.allocation_status = 'locked'
            AND pr.status IN ('confirmed', 'checked_in')
            AND ra.stay_date >= ?
            AND ra.stay_date < ?
          GROUP BY ra.room_unit_id, ra.reservation_id, pr.guest_name, pr.check_in, pr.check_out, pr.status
          ORDER BY ra.room_unit_id ASC, MIN(ra.stay_date) ASC`
      )
      .bind(tenantId, propertyId, fromDate, rangeEndExclusive)
      .all();

    // Build per-unit segment list (ordered by first_alloc_date ascending)
    const byUnit = new Map();
    for (const row of (allocResult.results || [])) {
      const unitId = String(row.room_unit_id || '').trim();
      if (!unitId) continue;
      if (!byUnit.has(unitId)) byUnit.set(unitId, []);
      byUnit.get(unitId).push(row);
    }

    const summary = roomUnits.map((roomUnit) => {
      const segments = byUnit.get(String(roomUnit.id)) || [];

      // Current = a segment whose allocated nights include fromDate
      // (first_alloc_date <= fromDate AND last_alloc_date >= fromDate)
      const current = segments.find((s) => s.first_alloc_date <= fromDate && s.last_alloc_date >= fromDate) || null;
      // Next = first segment that starts strictly after fromDate
      const next = segments.find((s) => s.first_alloc_date > fromDate) || null;

      // Open nights = free nights between now and the next blocked segment
      const openFrom = current ? current.check_out : fromDate;
      const openEnd = next ? next.first_alloc_date : rangeEndExclusive;
      const openNights = Math.max(0, enumerateStayDates(openFrom, openEnd).length);

      // Arrival/departure signals (relative to fromDate)
      const arrivalToday = !current && next?.first_alloc_date === fromDate;
      const departureToday = current?.check_out === fromDate;

      // Human-readable explanation for why a room cannot be freely assigned
      let whyNotAssignable = null;
      if (['maintenance', 'out_of_order'].includes(roomUnit.operational_status)) {
        whyNotAssignable = roomUnit.operational_status === 'out_of_order' ? 'Out of order' : 'Under maintenance';
      } else if (current) {
        whyNotAssignable = departureToday
          ? `Departing today · ${current.guest_name || 'Guest'}`
          : `Occupied until ${current.check_out} · ${current.guest_name || 'Guest'}`;
      } else if (next) {
        whyNotAssignable = arrivalToday
          ? `Arriving today · ${next.guest_name || 'Guest'}`
          : `${openNights} night${openNights !== 1 ? 's' : ''} free · Next: ${next.guest_name || 'Reservation'} arrives ${next.first_alloc_date}`;
      }

      return {
        room_unit_id: roomUnit.id,
        current_reservation_id: current?.reservation_id || null,
        current_guest_name: current?.guest_name || null,
        current_check_out: current?.check_out || null,
        departure_today: departureToday || false,
        next_reservation_id: next?.reservation_id || null,
        next_reservation_start: next?.first_alloc_date || null,
        next_reservation_guest_name: next?.guest_name || null,
        arrival_today: arrivalToday || false,
        open_nights: openNights,
        fully_open_within_window: !current && !next,
        why_not_assignable: whyNotAssignable,
      };
    });

    return jsonResponse({ ok: true, from_date: fromDate, lookahead_days: lookaheadDays, summary });
  } catch (error) {
    console.error('[ROOM_RACK_SUMMARY_GET]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

// CHK-R108: Per-unit per-date planning grid backed by reservation_allocations.
// Returns a dense slot matrix so the frontend can render a multi-room Gantt calendar.
export async function handleGetPropertyPlanningGrid(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();

  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  const url = new URL(request.url);
  const fromDate = String(url.searchParams.get('from_date') || formatDateUtc(new Date())).trim();
  const days = Math.min(60, Math.max(7, Number(url.searchParams.get('days') || 21)));
  if (!isIsoDate(fromDate)) return jsonResponse({ error: 'from_date must use YYYY-MM-DD format.' }, 400);

  try {
    const property = await loadPropertyById(env, tenantId, propertyId);
    if (!property) return jsonResponse({ error: 'Property not found.' }, 404);

    const roomUnitsResult = await env.DB
      .prepare(
        `SELECT id, room_type_id, room_number, floor_label, sort_order, operational_status
           FROM room_units
          WHERE tenant_id = ? AND property_id = ? AND active = 1
          ORDER BY floor_label ASC, sort_order ASC, room_number ASC`
      )
      .bind(tenantId, propertyId)
      .all();
    const roomUnits = roomUnitsResult.results || [];

    const toDate = formatDateUtc(addDays(parseDateUtc(fromDate), days));
    const dates = enumerateStayDates(fromDate, toDate);
    const allotments = await listPropertyAllotmentsInRange(env, tenantId, propertyId, fromDate, toDate, 'all');

    const allocResult = await env.DB
      .prepare(
        `SELECT ra.room_unit_id, ra.reservation_id, ra.stay_date,
                pr.guest_name, pr.check_in, pr.check_out, pr.status,
                pr.pricing_snapshot
           FROM reservation_allocations ra
           JOIN property_reservations pr
             ON pr.id = ra.reservation_id
            AND pr.tenant_id = ra.tenant_id
            AND pr.property_id = ra.property_id
          WHERE ra.tenant_id = ?
            AND ra.property_id = ?
            AND ra.allocation_status = 'locked'
            AND pr.status IN ('pending_payment', 'confirmed', 'checked_in')
            AND ra.stay_date >= ?
            AND ra.stay_date < ?
          ORDER BY ra.stay_date ASC, ra.room_unit_id ASC`
      )
      .bind(tenantId, propertyId, fromDate, toDate)
      .all();

    const assignedReservationsResult = await env.DB
      .prepare(
        `SELECT id AS reservation_id, assigned_room_unit_id AS room_unit_id,
                guest_name, check_in, check_out, status, pricing_snapshot
           FROM property_reservations
          WHERE tenant_id = ?
            AND property_id = ?
            AND assigned_room_unit_id IS NOT NULL
            AND status IN ('pending_payment', 'confirmed', 'checked_in')
            AND check_in < ?
            AND check_out >= ?
          ORDER BY check_in ASC, assigned_room_unit_id ASC`
      )
      .bind(tenantId, propertyId, toDate, fromDate)
      .all();

    // Build occupancy map: `${room_unit_id}::${stay_date}` → slot info
    const occupancyMap = new Map();
    const reservationMap = new Map();

    const upsertReservation = (row, roomUnitId, parsedSnapshot) => {
      const normalizedRoomUnitId = String(roomUnitId || '').trim();
      const normalizedReservationId = String(row?.reservation_id || '').trim();
      if (!normalizedRoomUnitId || !normalizedReservationId) return;
      const key = `${normalizedRoomUnitId}::${normalizedReservationId}`;
      const nextRecord = {
        reservation_id: normalizedReservationId,
        id: normalizedReservationId,
        room_unit_id: normalizedRoomUnitId,
        guest_name: row?.guest_name || '',
        check_in: row?.check_in || '',
        check_out: row?.check_out || '',
        status: row?.status || 'confirmed',
        pricing_snapshot: parsedSnapshot || null,
      };
      if (!reservationMap.has(key)) {
        reservationMap.set(key, nextRecord);
        return;
      }
      const current = reservationMap.get(key);
      if (!current.check_in || (nextRecord.check_in && nextRecord.check_in < current.check_in)) current.check_in = nextRecord.check_in;
      if (!current.check_out || (nextRecord.check_out && nextRecord.check_out > current.check_out)) current.check_out = nextRecord.check_out;
      if (!current.guest_name && nextRecord.guest_name) current.guest_name = nextRecord.guest_name;
      if ((!current.pricing_snapshot || current.pricing_snapshot === null) && nextRecord.pricing_snapshot) current.pricing_snapshot = nextRecord.pricing_snapshot;
      if (!current.status && nextRecord.status) current.status = nextRecord.status;
    };

    for (const row of (allocResult.results || [])) {
      const key = `${row.room_unit_id}::${row.stay_date}`;
      const nextDay = formatDateUtc(addDays(parseDateUtc(row.stay_date), 1));
      const ps = row.pricing_snapshot ? parseJsonSafe(row.pricing_snapshot) : null;
      let slotState = 'occupied';
      if (row.check_in === row.stay_date && nextDay === row.check_out) {
        slotState = 'same_day'; // single-night stay (arrives and departs same transition)
      } else if (row.check_in === row.stay_date) {
        slotState = 'arriving';
      } else if (nextDay === row.check_out) {
        slotState = 'departing';
      }
      occupancyMap.set(key, {
        state: slotState,
        reservation_id: row.reservation_id,
        reservation_status: row.status,
        guest_name: row.guest_name,
        check_in: row.check_in,
        check_out: row.check_out,
        nightly_amount: ps?.nightly_amount ?? ps?.price_per_night ?? ps?.rate_amount ?? ps?.nightly_rate ?? null,
        currency: ps?.currency ?? null,
      });
      upsertReservation(row, row.room_unit_id, ps);
    }

    for (const row of (assignedReservationsResult.results || [])) {
      const ps = row.pricing_snapshot ? parseJsonSafe(row.pricing_snapshot) : null;
      upsertReservation(row, row.room_unit_id, ps);
    }

    const units = roomUnits.map((unit) => {
      const slots = dates.map((date) => {
        if (unit.operational_status === 'out_of_order') return { date, state: 'out_of_order' };
        if (unit.operational_status === 'maintenance') return { date, state: 'maintenance' };
        const slot = occupancyMap.get(`${unit.id}::${date}`);
        if (slot) return { date, ...slot };
        return { date, state: 'vacant' };
      });
      return {
        room_unit_id: unit.id,
        room_number: unit.room_number,
        floor_label: unit.floor_label,
        room_type_id: unit.room_type_id,
        operational_status: unit.operational_status,
        slots,
      };
    });

    return jsonResponse({ ok: true, from_date: fromDate, days, dates, units, reservations: Array.from(reservationMap.values()), allotments });
  } catch (error) {
    console.error('[PROPERTY_PLANNING_GRID_GET]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleListPropertyAllotments(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  const url = new URL(request.url);
  const fromDate = String(url.searchParams.get('from_date') || formatDateUtc(new Date())).trim();
  const days = Math.min(120, Math.max(1, Number(url.searchParams.get('days') || 30)));
  const status = String(url.searchParams.get('status') || 'all').trim();
  if (!isIsoDate(fromDate)) return jsonResponse({ error: 'from_date must use YYYY-MM-DD format.' }, 400);
  if (status !== 'all' && !PROPERTY_ALLOTMENT_STATUSES.has(status)) return jsonResponse({ error: 'status is invalid.' }, 400);

  try {
    const property = await loadPropertyById(env, tenantId, propertyId);
    if (!property) return jsonResponse({ error: 'Property not found.' }, 404);
    const toDate = formatDateUtc(addDays(parseDateUtc(fromDate), days));
    const allotments = await listPropertyAllotmentsInRange(env, tenantId, propertyId, fromDate, toDate, status);
    return jsonResponse({ ok: true, property_id: propertyId, from_date: fromDate, days, allotments });
  } catch (error) {
    console.error('[PROPERTY_ALLOTMENTS_LIST]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleCreatePropertyAllotment(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validatePropertyAllotmentCreateRequest(body, propertyId);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const roomType = await loadRoomTypeById(env, tenantId, propertyId, parsed.roomTypeId);
    if (!roomType) return jsonResponse({ error: 'room_type_id not found for this property.' }, 404);
    const now = currentUnixSeconds();
    const allotmentId = nanoid();
    await env.DB
      .prepare(
        `INSERT INTO property_allotments
          (id, tenant_id, property_id, room_type_id, operator_name, operator_code, source_ref,
           check_in, check_out, rooms_blocked, release_date, status, notes, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`
      )
      .bind(
        allotmentId,
        tenantId,
        propertyId,
        parsed.roomTypeId,
        parsed.operatorName,
        parsed.operatorCode,
        parsed.sourceRef,
        parsed.checkIn,
        parsed.checkOut,
        parsed.roomsBlocked,
        parsed.releaseDate,
        parsed.notes,
        actor.session.user_id || null,
        actor.session.user_id || null,
        now,
        now,
      )
      .run();
    const created = await loadPropertyAllotmentById(env, tenantId, propertyId, allotmentId);
    return jsonResponse({ ok: true, allotment: created }, 201);
  } catch (error) {
    console.error('[PROPERTY_ALLOTMENT_CREATE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleUpdatePropertyAllotment(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const allotmentId = String(params?.allotmentId || '').trim();
  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validatePropertyAllotmentPatchRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const existing = await loadPropertyAllotmentById(env, tenantId, propertyId, allotmentId);
    if (!existing) return jsonResponse({ error: 'Allotment not found.' }, 404);

    const mergedCheckIn = parsed.updates.check_in || existing.check_in;
    const mergedCheckOut = parsed.updates.check_out || existing.check_out;
    if (parseDateUtc(mergedCheckIn) >= parseDateUtc(mergedCheckOut)) {
      return jsonResponse({ error: 'check_out must be after check_in.' }, 400);
    }

    const sqlParts = [];
    const bindValues = [];
    for (const [key, value] of Object.entries(parsed.updates)) {
      sqlParts.push(`${key} = ?`);
      bindValues.push(value);
    }
    sqlParts.push('updated_by = ?');
    bindValues.push(actor.session.user_id || null);
    sqlParts.push('updated_at = ?');
    bindValues.push(currentUnixSeconds());

    await env.DB
      .prepare(`UPDATE property_allotments SET ${sqlParts.join(', ')} WHERE id = ? AND tenant_id = ? AND property_id = ?`)
      .bind(...bindValues, allotmentId, tenantId, propertyId)
      .run();

    const updated = await loadPropertyAllotmentById(env, tenantId, propertyId, allotmentId);
    return jsonResponse({ ok: true, allotment: updated });
  } catch (error) {
    console.error('[PROPERTY_ALLOTMENT_UPDATE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleReleasePropertyAllotment(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const allotmentId = String(params?.allotmentId || '').trim();
  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;

  try {
    const existing = await loadPropertyAllotmentById(env, tenantId, propertyId, allotmentId);
    if (!existing) return jsonResponse({ error: 'Allotment not found.' }, 404);
    if (existing.status === 'released') return jsonResponse({ error: 'Allotment is already released.' }, 409);

    await env.DB
      .prepare(`UPDATE property_allotments SET status = 'released', updated_by = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND property_id = ?`)
      .bind(actor.session.user_id || null, currentUnixSeconds(), allotmentId, tenantId, propertyId)
      .run();

    const updated = await loadPropertyAllotmentById(env, tenantId, propertyId, allotmentId);
    return jsonResponse({ ok: true, allotment: updated, released: true });
  } catch (error) {
    console.error('[PROPERTY_ALLOTMENT_RELEASE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

async function loadPropertyShiftHandover(env, tenantId, propertyId) {
  const row = await env.DB
    .prepare(
      `SELECT p.id AS property_id, p.tenant_id, p.shift_handover_note, p.shift_handover_updated_at, p.shift_handover_updated_by,
              u.email AS updated_by_email
         FROM properties p
         LEFT JOIN users u
           ON u.id = p.shift_handover_updated_by
        WHERE p.id = ? AND p.tenant_id = ?`
    )
    .bind(propertyId, tenantId)
    .first();
  if (!row) return null;
  return {
    property_id: row.property_id,
    tenant_id: row.tenant_id,
    note: row.shift_handover_note || null,
    updated_at: row.shift_handover_updated_at || null,
    updated_by: row.shift_handover_updated_by || null,
    updated_by_email: row.updated_by_email || null,
  };
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

async function loadPropertyPricingProfileById(env, tenantId, propertyId, pricingProfileId) {
  const row = await env.DB
    .prepare(
      `SELECT ppp.id, ppp.tenant_id, ppp.property_id, ppp.room_type_id, ppp.code, ppp.name,
              ppp.visibility, ppp.pricing_mode, ppp.fixed_nightly_amount, ppp.delta_amount, ppp.delta_percent,
              ppp.notes, ppp.active, ppp.created_by, ppp.updated_by, ppp.created_at, ppp.updated_at,
              rt.code AS room_type_code, rt.name AS room_type_name
         FROM property_pricing_profiles ppp
         LEFT JOIN room_types rt ON rt.id = ppp.room_type_id AND rt.tenant_id = ppp.tenant_id AND rt.property_id = ppp.property_id
        WHERE ppp.id = ? AND ppp.tenant_id = ? AND ppp.property_id = ?`
    )
    .bind(pricingProfileId, tenantId, propertyId)
    .first();
  return row ? mapPropertyPricingProfileRow(row) : null;
}

async function loadPropertyWeekdayPricingRuleById(env, tenantId, propertyId, weekdayPricingRuleId) {
  const row = await env.DB
    .prepare(
      `SELECT pwr.id, pwr.tenant_id, pwr.property_id, pwr.room_type_id, pwr.day_of_week, pwr.name,
              pwr.pricing_mode, pwr.fixed_nightly_amount, pwr.delta_amount, pwr.delta_percent,
              pwr.notes, pwr.active, pwr.created_by, pwr.updated_by, pwr.created_at, pwr.updated_at,
              rt.code AS room_type_code, rt.name AS room_type_name
         FROM property_weekday_pricing_rules pwr
         LEFT JOIN room_types rt ON rt.id = pwr.room_type_id AND rt.tenant_id = pwr.tenant_id AND rt.property_id = pwr.property_id
        WHERE pwr.id = ? AND pwr.tenant_id = ? AND pwr.property_id = ?`
    )
    .bind(weekdayPricingRuleId, tenantId, propertyId)
    .first();
  return row ? mapPropertyWeekdayPricingRuleRow(row) : null;
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

function weekdayIndexForIsoDate(stayDate) {
  return parseDateUtc(stayDate).getUTCDay();
}

function selectApplicablePropertyWeekdayPricingRule(weekdayRules, roomTypeId, stayDate) {
  const dayOfWeek = weekdayIndexForIsoDate(stayDate);
  const normalizedRoomTypeId = String(roomTypeId || '').trim();
  const exactRule = (weekdayRules || []).find((rule) => Number(rule.day_of_week) === dayOfWeek && String(rule.room_type_id || '').trim() === normalizedRoomTypeId);
  if (exactRule) return exactRule;
  return (weekdayRules || []).find((rule) => Number(rule.day_of_week) === dayOfWeek && !rule.room_type_id) || null;
}

function applyPropertyWeekdayPricingRuleToResolvedRate(resolvedRate, weekdayRule, stayDate) {
  if (!resolvedRate || !weekdayRule || !weekdayRule.active) return resolvedRate;

  const baseNightlyAmount = Number(resolvedRate.nightly_amount || 0);
  let adjustedNightlyAmount = baseNightlyAmount;
  let adjustmentPercent = null;

  if (weekdayRule.pricing_mode === 'fixed_nightly_amount') {
    adjustedNightlyAmount = Number(weekdayRule.fixed_nightly_amount || 0);
  } else if (weekdayRule.pricing_mode === 'delta_amount') {
    adjustedNightlyAmount = baseNightlyAmount + Number(weekdayRule.delta_amount || 0);
  } else if (weekdayRule.pricing_mode === 'delta_percent') {
    adjustmentPercent = Number(weekdayRule.delta_percent || 0);
    adjustedNightlyAmount = baseNightlyAmount * (1 + (adjustmentPercent / 100));
  }

  adjustedNightlyAmount = Number(Math.max(0, adjustedNightlyAmount).toFixed(2));
  const adjustmentAmount = Number((adjustedNightlyAmount - baseNightlyAmount).toFixed(2));
  const dayOfWeek = weekdayIndexForIsoDate(stayDate);

  return {
    ...resolvedRate,
    nightly_amount: adjustedNightlyAmount,
    weekday_pricing_rule_applied: true,
    weekday_pricing_rule_id: weekdayRule.id,
    weekday_pricing_rule_name: weekdayRule.name,
    weekday_pricing_rule_day_of_week: dayOfWeek,
    weekday_pricing_rule_day_name: PROPERTY_WEEKDAY_NAMES[dayOfWeek] || `Day ${dayOfWeek}`,
    weekday_pricing_rule_mode: weekdayRule.pricing_mode,
    weekday_pricing_rule_scope: weekdayRule.scope,
    weekday_pricing_rule_room_type_id: weekdayRule.room_type_id || null,
    weekday_pricing_rule_adjustment_amount: adjustmentAmount,
    weekday_pricing_rule_adjustment_percent: adjustmentPercent,
  };
}

function applyPropertyPricingProfileToResolvedRate(resolvedRate, pricingProfile) {
  if (!resolvedRate || !pricingProfile || !pricingProfile.active) return resolvedRate;

  const baseNightlyAmount = Number(resolvedRate.nightly_amount || 0);
  let adjustedNightlyAmount = baseNightlyAmount;
  let adjustmentPercent = null;

  if (pricingProfile.pricing_mode === 'fixed_nightly_amount') {
    adjustedNightlyAmount = Number(pricingProfile.fixed_nightly_amount || 0);
  } else if (pricingProfile.pricing_mode === 'delta_amount') {
    adjustedNightlyAmount = baseNightlyAmount + Number(pricingProfile.delta_amount || 0);
  } else if (pricingProfile.pricing_mode === 'delta_percent') {
    adjustmentPercent = Number(pricingProfile.delta_percent || 0);
    adjustedNightlyAmount = baseNightlyAmount * (1 + (adjustmentPercent / 100));
  }

  adjustedNightlyAmount = Number(Math.max(0, adjustedNightlyAmount).toFixed(2));
  const adjustmentAmount = Number((adjustedNightlyAmount - baseNightlyAmount).toFixed(2));

  return {
    ...resolvedRate,
    nightly_amount: adjustedNightlyAmount,
    pricing_profile_applied: true,
    pricing_profile_id: pricingProfile.id,
    pricing_profile_code: pricingProfile.code,
    pricing_profile_name: pricingProfile.name,
    pricing_profile_visibility: pricingProfile.visibility,
    pricing_profile_mode: pricingProfile.pricing_mode,
    pricing_profile_scope: pricingProfile.scope,
    pricing_profile_room_type_id: pricingProfile.room_type_id || null,
    pricing_profile_adjustment_amount: adjustmentAmount,
    pricing_profile_adjustment_percent: adjustmentPercent,
  };
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

function calculatePerRoomOccupancyAdjustments(resolvedRate, roomGuestAssignments) {
  if (!resolvedRate || !Array.isArray(roomGuestAssignments) || !roomGuestAssignments.length) return null;
  return roomGuestAssignments.map((assignment) => {
    const adjustment = calculateOccupancyAdjustment(resolvedRate, assignment.adults, assignment.children, 1);
    return {
      room_index: assignment.room_index,
      label: assignment.label,
      adults: assignment.adults,
      children: assignment.children,
      nightly_base_total: Number(resolvedRate.nightly_amount),
      occupancy_adjustment: adjustment,
      nightly_total: Number(resolvedRate.nightly_amount) + Number(adjustment.adjustment_amount || 0),
    };
  });
}

function mapPricingProfileQuoteSummary(pricingProfile) {
  if (!pricingProfile) return null;
  return {
    id: pricingProfile.id,
    code: pricingProfile.code,
    name: pricingProfile.name,
    room_type_id: pricingProfile.room_type_id,
    pricing_mode: pricingProfile.pricing_mode,
    fixed_nightly_amount: pricingProfile.fixed_nightly_amount,
    delta_amount: pricingProfile.delta_amount,
    delta_percent: pricingProfile.delta_percent,
  };
}

function applyPreviewScarcityPricing(nightlyBreakdown, nightlyRemainingByType, scarcityPreview, currency) {
  const normalized = Array.isArray(nightlyBreakdown) ? nightlyBreakdown.map((row) => ({ ...row })) : [];
  const config = scarcityPreview && scarcityPreview.enabled
    ? {
        enabled: true,
        threshold_remaining: Number(scarcityPreview.thresholdRemaining || 0),
        surcharge_amount: Number(scarcityPreview.surchargeAmount || 0),
        max_total_amount: Number(scarcityPreview.maxTotalAmount || 0),
      }
    : {
        enabled: false,
        threshold_remaining: Number(scarcityPreview?.thresholdRemaining || 0),
        surcharge_amount: Number(scarcityPreview?.surchargeAmount || 0),
        max_total_amount: Number(scarcityPreview?.maxTotalAmount || 0),
      };

  if (!config.enabled || config.surcharge_amount <= 0 || config.max_total_amount <= 0) {
    return {
      nightlyBreakdown: normalized.map((row) => ({
        ...row,
        scarcity_adjustment: null,
      })),
      scarcityPreview: {
        ...config,
        total_surcharge_amount: 0,
        triggered_nights: 0,
        applied: false,
        currency,
      },
    };
  }

  let remainingCap = config.max_total_amount;
  let totalSurchargeAmount = 0;
  let triggeredNights = 0;

  const scarcityNightly = normalized.map((row) => {
    const components = Array.isArray(row.room_type_components) ? row.room_type_components : [];
    const triggeredComponents = components.map((component) => {
      const nightlyRows = nightlyRemainingByType?.get(String(component.room_type_id || '')) || [];
      const nightlyRow = nightlyRows.find((candidate) => String(candidate.stay_date || '') === String(row.stay_date || '')) || null;
      const remainingAfterSelectedPlan = nightlyRow
        ? Math.max(Number(nightlyRow.remaining || 0) - Number(component.rooms_requested || 0), 0)
        : null;
      if (remainingAfterSelectedPlan === null || remainingAfterSelectedPlan >= config.threshold_remaining) return null;
      return {
        room_type_id: component.room_type_id,
        room_type_code: component.room_type_code || null,
        room_type_name: component.room_type_name || null,
        remaining_after_selected_plan: remainingAfterSelectedPlan,
        threshold_remaining: config.threshold_remaining,
      };
    }).filter(Boolean);

    if (!triggeredComponents.length || remainingCap <= 0 || !Number.isFinite(Number(row.nightly_total))) {
      return {
        ...row,
        scarcity_adjustment: null,
      };
    }

    const appliedAmount = Number(Math.min(config.surcharge_amount, remainingCap).toFixed(2));
    remainingCap = Number(Math.max(0, remainingCap - appliedAmount).toFixed(2));
    totalSurchargeAmount = Number((totalSurchargeAmount + appliedAmount).toFixed(2));
    triggeredNights += 1;

    return {
      ...row,
      nightly_total: Number((Number(row.nightly_total || 0) + appliedAmount).toFixed(2)),
      scarcity_adjustment: {
        applied_amount: appliedAmount,
        currency: row.currency || currency,
        triggered_components: triggeredComponents,
        threshold_remaining: config.threshold_remaining,
      },
    };
  });

  return {
    nightlyBreakdown: scarcityNightly,
    scarcityPreview: {
      ...config,
      total_surcharge_amount: totalSurchargeAmount,
      triggered_nights: triggeredNights,
      applied: totalSurchargeAmount > 0,
      currency,
    },
  };
}

async function buildSelectedPlanPricingPreview(env, tenantId, propertyId, requestInput, selectedPlan, options = {}) {
  if (!selectedPlan?.segments?.length) return { pricing: null };

  const property = await loadPropertyById(env, tenantId, propertyId);
  if (!property) return { error: { status: 404, payload: { error: 'Property not found.' } } };

  const pricingProfileId = options.pricingProfileId ? String(options.pricingProfileId).trim() : null;
  const pricingProfile = pricingProfileId
    ? await loadPropertyPricingProfileById(env, tenantId, propertyId, pricingProfileId)
    : null;
  if (pricingProfileId) {
    if (!pricingProfile) return { error: { status: 404, payload: { error: 'Pricing profile not found.' } } };
    if (!pricingProfile.active) return { error: { status: 409, payload: { error: 'Pricing profile is inactive.' } } };
  }

  const activeSeasonsResult = await env.DB
    .prepare(
      `SELECT id, tenant_id, property_id, name, start_date, end_date, sort_order, active, created_at, updated_at
         FROM property_rate_seasons
        WHERE tenant_id = ? AND property_id = ? AND active = 1
        ORDER BY sort_order ASC, start_date ASC, created_at ASC`
    )
    .bind(tenantId, propertyId)
    .all();
  const activeSeasons = (activeSeasonsResult.results || []).map(mapRateSeasonRow);

  const roomTypeIds = Array.from(new Set((selectedPlan.segments || []).map((segment) => String(segment.room_type_id || '').trim()).filter(Boolean)));
  const roomTypeContexts = new Map();

  await Promise.all(roomTypeIds.map(async (roomTypeId) => {
    const [roomType, baseRateRow, seasonRatesResult, weekdayRulesResult] = await Promise.all([
      loadRoomTypeById(env, tenantId, propertyId, roomTypeId),
      env.DB.prepare(
        `SELECT id, tenant_id, property_id, room_type_id, rate_name, currency, nightly_amount,
                included_adults, included_children, extra_adult_amount, extra_child_amount,
                active, created_at, updated_at
           FROM property_room_rates
          WHERE tenant_id = ? AND property_id = ? AND room_type_id = ? AND active = 1
          ORDER BY updated_at DESC, created_at DESC
          LIMIT 1`
      ).bind(tenantId, propertyId, roomTypeId).first(),
      env.DB.prepare(
        `SELECT id, tenant_id, property_id, season_id, room_type_id, currency, nightly_amount,
                included_adults, included_children, extra_adult_amount, extra_child_amount,
                active, created_at, updated_at
           FROM property_room_rate_season_prices
          WHERE tenant_id = ? AND property_id = ? AND room_type_id = ? AND active = 1`
      ).bind(tenantId, propertyId, roomTypeId).all(),
      env.DB.prepare(
        `SELECT pwr.id, pwr.tenant_id, pwr.property_id, pwr.room_type_id, pwr.day_of_week, pwr.name,
                pwr.pricing_mode, pwr.fixed_nightly_amount, pwr.delta_amount, pwr.delta_percent,
                pwr.notes, pwr.active, pwr.created_by, pwr.updated_by, pwr.created_at, pwr.updated_at,
                rt.code AS room_type_code, rt.name AS room_type_name
           FROM property_weekday_pricing_rules pwr
           LEFT JOIN room_types rt ON rt.id = pwr.room_type_id AND rt.tenant_id = pwr.tenant_id AND rt.property_id = pwr.property_id
          WHERE pwr.tenant_id = ?
            AND pwr.property_id = ?
            AND pwr.active = 1
            AND (pwr.room_type_id IS NULL OR pwr.room_type_id = ?)
          ORDER BY CASE WHEN pwr.room_type_id = ? THEN 0 ELSE 1 END ASC, pwr.day_of_week ASC, pwr.created_at ASC`
      ).bind(tenantId, propertyId, roomTypeId, roomTypeId).all(),
    ]);

    roomTypeContexts.set(roomTypeId, {
      roomType,
      baseRate: baseRateRow ? mapRoomRateRow(baseRateRow) : null,
      seasonRatesByKey: new Map((seasonRatesResult.results || []).map((row) => [String(row.season_id), mapSeasonRateRow(row)])),
      weekdayRules: (weekdayRulesResult.results || []).map(mapPropertyWeekdayPricingRuleRow),
    });
  }));

  const stayDates = enumerateStayDates(requestInput.checkIn, requestInput.checkOut);
  const nightlyBreakdown = stayDates.map((stayDate) => {
    const segmentsForNight = (selectedPlan.segments || []).filter((segment) => segment.check_in <= stayDate && segment.check_out > stayDate);
    if (!segmentsForNight.length) {
      return {
        stay_date: stayDate,
        source: 'missing_plan_segment',
        currency: property.currency,
        nightly_amount: null,
        nightly_total: null,
        room_type_components: [],
        occupancy_adjustment: null,
      };
    }

    const roomsByType = new Map();
    for (const segment of segmentsForNight) {
      const roomTypeId = String(segment.room_type_id || '').trim();
      roomsByType.set(roomTypeId, (roomsByType.get(roomTypeId) || 0) + 1);
    }

    const roomTypeComponents = Array.from(roomsByType.entries()).map(([roomTypeId, roomsRequestedForType]) => {
      const context = roomTypeContexts.get(roomTypeId);
      const resolved = context
        ? resolveNightlyRateForDate(stayDate, activeSeasons, context.seasonRatesByKey, context.baseRate)
        : null;
      const weekdayAdjusted = context
        ? applyPropertyWeekdayPricingRuleToResolvedRate(resolved, selectApplicablePropertyWeekdayPricingRule(context.weekdayRules, roomTypeId, stayDate), stayDate)
        : null;
      const applicableProfile = pricingProfile && (!pricingProfile.room_type_id || String(pricingProfile.room_type_id) === roomTypeId)
        ? pricingProfile
        : null;
      const quotedRate = applyPropertyPricingProfileToResolvedRate(weekdayAdjusted, applicableProfile);
      return {
        room_type_id: roomTypeId,
        room_type_code: context?.roomType?.code || null,
        room_type_name: context?.roomType?.name || null,
        rooms_requested: roomsRequestedForType,
        source: quotedRate?.source || 'missing_rate',
        season_name: quotedRate?.season_name || null,
        currency: quotedRate?.currency || property.currency,
        nightly_amount: quotedRate ? Number(quotedRate.nightly_amount) : null,
        nightly_total: quotedRate ? Number(quotedRate.nightly_amount) * roomsRequestedForType : null,
        weekday_adjustment: quotedRate?.weekday_pricing_rule_applied
          ? {
              id: quotedRate.weekday_pricing_rule_id,
              name: quotedRate.weekday_pricing_rule_name,
              day_name: quotedRate.weekday_pricing_rule_day_name,
              pricing_mode: quotedRate.weekday_pricing_rule_mode,
              adjustment_amount: quotedRate.weekday_pricing_rule_adjustment_amount,
              adjustment_percent: quotedRate.weekday_pricing_rule_adjustment_percent,
            }
          : null,
        pricing_profile: quotedRate?.pricing_profile_applied ? mapPricingProfileQuoteSummary(applicableProfile) : null,
        included_adults: quotedRate ? Number(quotedRate.included_adults) : null,
        included_children: quotedRate ? Number(quotedRate.included_children) : null,
        extra_adult_amount: quotedRate ? Number(quotedRate.extra_adult_amount || 0) : null,
        extra_child_amount: quotedRate ? Number(quotedRate.extra_child_amount || 0) : null,
      };
    });

    const priceableComponents = roomTypeComponents.filter((component) => Number.isFinite(Number(component.nightly_amount)));
    const nightlyBaseTotal = priceableComponents.reduce((sum, component) => sum + Number(component.nightly_total || 0), 0);
    const occupancyBasis = roomTypeComponents.length === 1 ? roomTypeComponents[0] : null;
    const occupancyAdjustment = occupancyBasis && Number.isFinite(Number(occupancyBasis.nightly_amount))
      ? calculateOccupancyAdjustment(
          {
            included_adults: occupancyBasis.included_adults,
            included_children: occupancyBasis.included_children,
            extra_adult_amount: occupancyBasis.extra_adult_amount,
            extra_child_amount: occupancyBasis.extra_child_amount,
          },
          requestInput.adults,
          requestInput.children,
          Number(occupancyBasis.rooms_requested || 1),
        )
      : null;

    return {
      stay_date: stayDate,
      currency: roomTypeComponents.find((component) => component.currency)?.currency || property.currency,
      source: roomTypeComponents.length === 1 ? roomTypeComponents[0].source : 'selected_plan_mix',
      season_name: roomTypeComponents.length === 1 ? roomTypeComponents[0].season_name : null,
      room_type_id: roomTypeComponents.length === 1 ? roomTypeComponents[0].room_type_id : null,
      room_type_code: roomTypeComponents.length === 1 ? roomTypeComponents[0].room_type_code : null,
      room_type_name: roomTypeComponents.length === 1 ? roomTypeComponents[0].room_type_name : null,
      rooms_requested: segmentsForNight.length,
      nightly_amount: roomTypeComponents.length === 1 ? roomTypeComponents[0].nightly_amount : null,
      nightly_base_total: nightlyBaseTotal,
      occupancy_adjustment: occupancyAdjustment,
      nightly_total: Number(nightlyBaseTotal + Number(occupancyAdjustment?.adjustment_amount || 0)),
      room_type_components: roomTypeComponents,
      pricing_profile: roomTypeComponents.length === 1 ? roomTypeComponents[0].pricing_profile : null,
      weekday_adjustment: roomTypeComponents.length === 1 ? roomTypeComponents[0].weekday_adjustment : null,
    };
  });

  const scarcityPreviewApplied = applyPreviewScarcityPricing(
    nightlyBreakdown,
    options.nightlyRemainingByType || null,
    options.scarcityPreview || null,
    nightlyBreakdown.find((row) => row.currency)?.currency || property.currency,
  );
  const scarcityNightlyBreakdown = scarcityPreviewApplied.nightlyBreakdown;
  const missingDates = scarcityNightlyBreakdown.filter((row) => !Number.isFinite(Number(row.nightly_total))).map((row) => row.stay_date);
  const totalBaseAmount = scarcityNightlyBreakdown.reduce((sum, row) => sum + (Number(row.nightly_base_total) || 0), 0);
  const totalOccupancyAdjustment = scarcityNightlyBreakdown.reduce((sum, row) => sum + (Number(row.occupancy_adjustment?.adjustment_amount) || 0), 0);
  const totalAmount = scarcityNightlyBreakdown.reduce((sum, row) => sum + (Number(row.nightly_total) || 0), 0);

  return {
    pricing: {
      currency: scarcityNightlyBreakdown.find((row) => row.currency)?.currency || property.currency,
      pricing_profile: mapPricingProfileQuoteSummary(pricingProfile),
      nightly_breakdown: scarcityNightlyBreakdown,
      missing_rate_dates: missingDates,
      total_base_amount: totalBaseAmount,
      total_occupancy_adjustment: totalOccupancyAdjustment,
      total_amount: totalAmount,
      selected_plan_type: selectedPlan.plan_type || null,
      scarcity_preview: scarcityPreviewApplied.scarcityPreview,
    },
  };
}

async function resolvePropertyRateQuote(env, tenantId, propertyId, parsed) {
  const property = await loadPropertyById(env, tenantId, propertyId);
  if (!property) return { error: { payload: { error: 'Property not found.' }, status: 404 } };

  const roomType = await loadRoomTypeById(env, tenantId, propertyId, parsed.roomTypeId);
  if (!roomType) return { error: { payload: { error: 'Room type not found.' }, status: 404 } };

  const totalGuests = Number(parsed.adults || 0) + Number(parsed.children || 0);
  const maxGuests = Number(roomType.max_occupancy || 0) * Number(parsed.roomsRequested || 1);
  if (maxGuests > 0 && totalGuests > maxGuests) {
    return {
      error: {
        payload: { error: `Guest mix exceeds the configured max occupancy for ${parsed.roomsRequested} room(s).` },
        status: 409,
      },
    };
  }

  const [baseRateRow, seasonsResult, seasonRatesResult, weekdayRulesResult, pricingProfile] = await Promise.all([
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
    env.DB.prepare(
      `SELECT pwr.id, pwr.tenant_id, pwr.property_id, pwr.room_type_id, pwr.day_of_week, pwr.name,
              pwr.pricing_mode, pwr.fixed_nightly_amount, pwr.delta_amount, pwr.delta_percent,
              pwr.notes, pwr.active, pwr.created_by, pwr.updated_by, pwr.created_at, pwr.updated_at,
              rt.code AS room_type_code, rt.name AS room_type_name
         FROM property_weekday_pricing_rules pwr
         LEFT JOIN room_types rt ON rt.id = pwr.room_type_id AND rt.tenant_id = pwr.tenant_id AND rt.property_id = pwr.property_id
        WHERE pwr.tenant_id = ?
          AND pwr.property_id = ?
          AND pwr.active = 1
          AND (pwr.room_type_id IS NULL OR pwr.room_type_id = ?)
        ORDER BY CASE WHEN pwr.room_type_id = ? THEN 0 ELSE 1 END ASC, pwr.day_of_week ASC, pwr.created_at ASC`
    ).bind(tenantId, propertyId, parsed.roomTypeId, parsed.roomTypeId).all(),
    parsed.pricingProfileId
      ? loadPropertyPricingProfileById(env, tenantId, propertyId, parsed.pricingProfileId)
      : Promise.resolve(null),
  ]);

  if (parsed.pricingProfileId) {
    if (!pricingProfile) return { error: { payload: { error: 'Pricing profile not found.' }, status: 404 } };
    if (!pricingProfile.active) return { error: { payload: { error: 'Pricing profile is inactive.' }, status: 409 } };
    if (pricingProfile.room_type_id && String(pricingProfile.room_type_id) !== parsed.roomTypeId) {
      return {
        error: {
          payload: { error: 'Pricing profile does not apply to the selected room type.' },
          status: 409,
        },
      };
    }
  }

  const stayDates = enumerateStayDates(parsed.checkIn, parsed.checkOut);
  const activeSeasons = (seasonsResult.results || []).map(mapRateSeasonRow);
  const seasonRatesByKey = new Map((seasonRatesResult.results || []).map((row) => [String(row.season_id), mapSeasonRateRow(row)]));
  const weekdayRules = (weekdayRulesResult.results || []).map(mapPropertyWeekdayPricingRuleRow);
  const baseRate = baseRateRow ? mapRoomRateRow(baseRateRow) : null;

  const nightlyBreakdown = stayDates.map((stayDate) => {
    const resolved = resolveNightlyRateForDate(stayDate, activeSeasons, seasonRatesByKey, baseRate);
    const weekdayRule = selectApplicablePropertyWeekdayPricingRule(weekdayRules, parsed.roomTypeId, stayDate);
    const weekdayAdjustedRate = applyPropertyWeekdayPricingRuleToResolvedRate(resolved, weekdayRule, stayDate);
    const quotedRate = applyPropertyPricingProfileToResolvedRate(weekdayAdjustedRate, pricingProfile);
    const perRoomAssignments = calculatePerRoomOccupancyAdjustments(quotedRate, parsed.roomGuestAssignments);
    const occupancyAdjustment = perRoomAssignments
      ? {
          included_adults_total: perRoomAssignments.reduce((sum, item) => sum + Number(item.occupancy_adjustment.included_adults_total || 0), 0),
          included_children_total: perRoomAssignments.reduce((sum, item) => sum + Number(item.occupancy_adjustment.included_children_total || 0), 0),
          extra_adults: perRoomAssignments.reduce((sum, item) => sum + Number(item.occupancy_adjustment.extra_adults || 0), 0),
          extra_children: perRoomAssignments.reduce((sum, item) => sum + Number(item.occupancy_adjustment.extra_children || 0), 0),
          extra_adult_amount: Number(quotedRate?.extra_adult_amount || 0),
          extra_child_amount: Number(quotedRate?.extra_child_amount || 0),
          adjustment_amount: perRoomAssignments.reduce((sum, item) => sum + Number(item.occupancy_adjustment.adjustment_amount || 0), 0),
        }
      : calculateOccupancyAdjustment(quotedRate, parsed.adults, parsed.children, parsed.roomsRequested);
    const nightlyBaseTotal = perRoomAssignments
      ? perRoomAssignments.reduce((sum, item) => sum + Number(item.nightly_base_total || 0), 0)
      : (quotedRate ? Number(quotedRate.nightly_amount) * parsed.roomsRequested : null);
    return {
      stay_date: stayDate,
      source: quotedRate?.source || 'missing_rate',
      season_id: quotedRate?.season_id || null,
      season_name: quotedRate?.season_name || null,
      currency: quotedRate?.currency || baseRate?.currency || property.currency,
      base_nightly_amount: resolved ? Number(resolved.nightly_amount) : null,
      weekday_nightly_amount: weekdayAdjustedRate ? Number(weekdayAdjustedRate.nightly_amount) : null,
      nightly_amount: quotedRate ? Number(quotedRate.nightly_amount) : null,
      rooms_requested: parsed.roomsRequested,
      nightly_base_total: nightlyBaseTotal,
      included_adults: quotedRate ? Number(quotedRate.included_adults) : null,
      included_children: quotedRate ? Number(quotedRate.included_children) : null,
      room_guest_assignments: perRoomAssignments,
      weekday_adjustment: quotedRate?.weekday_pricing_rule_applied
        ? {
            id: quotedRate.weekday_pricing_rule_id,
            name: quotedRate.weekday_pricing_rule_name,
            day_of_week: quotedRate.weekday_pricing_rule_day_of_week,
            day_name: quotedRate.weekday_pricing_rule_day_name,
            pricing_mode: quotedRate.weekday_pricing_rule_mode,
            adjustment_amount: quotedRate.weekday_pricing_rule_adjustment_amount,
            adjustment_percent: quotedRate.weekday_pricing_rule_adjustment_percent,
          }
        : null,
      pricing_profile: quotedRate?.pricing_profile_applied
        ? {
            id: quotedRate.pricing_profile_id,
            code: quotedRate.pricing_profile_code,
            name: quotedRate.pricing_profile_name,
            pricing_mode: quotedRate.pricing_profile_mode,
            adjustment_amount: quotedRate.pricing_profile_adjustment_amount,
            adjustment_percent: quotedRate.pricing_profile_adjustment_percent,
          }
        : null,
      occupancy_adjustment: quotedRate ? occupancyAdjustment : null,
      nightly_total: quotedRate ? nightlyBaseTotal + Number(occupancyAdjustment.adjustment_amount || 0) : null,
    };
  });

  const missingDates = nightlyBreakdown.filter((row) => row.nightly_amount === null).map((row) => row.stay_date);
  const totalBaseAmount = nightlyBreakdown.reduce((sum, row) => sum + (Number(row.nightly_base_total) || 0), 0);
  const totalOccupancyAdjustment = nightlyBreakdown.reduce((sum, row) => sum + (Number(row.occupancy_adjustment?.adjustment_amount) || 0), 0);
  const totalAmount = nightlyBreakdown.reduce((sum, row) => sum + (Number(row.nightly_total) || 0), 0);
  const currency = nightlyBreakdown.find((row) => row.currency)?.currency || property.currency;

  return {
    pricingProfile,
    nightlyBreakdown,
    missingDates,
    totalBaseAmount,
    totalOccupancyAdjustment,
    totalAmount,
    currency,
    sourceSummary: {
      has_base_rate: Boolean(baseRate),
      active_seasons: activeSeasons.length,
      active_season_rates: seasonRatesByKey.size,
      weekday_rules_loaded: weekdayRules.length,
      weekday_pricing_applied: nightlyBreakdown.some((row) => row.weekday_adjustment),
      pricing_profile_applied: Boolean(pricingProfile),
    },
  };
}

async function recordPropertyReservationEvent(env, tenantId, propertyId, reservationId, action, fromStatus, toStatus, payload = null, actorUserId = null) {
  const now = Date.now();
  await env.DB
    .prepare(
      `INSERT INTO property_reservation_events
        (id, tenant_id, property_id, reservation_id, action, from_status, to_status, actor_user_id, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      nanoid(),
      tenantId,
      propertyId,
      reservationId,
      action,
      fromStatus,
      toStatus,
      actorUserId,
      payload ? JSON.stringify(payload) : null,
      now
    )
    .run();
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
          p.same_day_turnover_sellable, p.shift_handover_note, p.shift_handover_updated_at, p.shift_handover_updated_by, p.created_at, p.updated_at,
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

  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }

  const parsed = validatePropertyCreateRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    // Property slot enforcement: 1 base property included, +1 per extra_property_slots purchased.
    const tenantRow = await env.DB
      .prepare('SELECT extra_property_slots FROM tenants WHERE id = ?')
      .bind(tenantId)
      .first();
    const extraSlots  = tenantRow?.extra_property_slots ?? 0;
    const propertyLimit = 1 + extraSlots;
    const { count: existingCount } = await env.DB
      .prepare(`SELECT COUNT(*) AS count FROM properties WHERE tenant_id = ?`)
      .bind(tenantId)
      .first() ?? { count: 0 };
    if (existingCount >= propertyLimit) {
      return jsonResponse({
        error: `Property limit reached. Your plan includes ${propertyLimit} propert${propertyLimit === 1 ? 'y' : 'ies'}. Purchase an additional property slot (+4.99 EUR/month) to add more.`,
        upgrade_required: true,
        property_limit: propertyLimit,
        addon_url: '/api/billing/addon',
      }, 403);
    }

    const id = nanoid();
    const now = currentUnixSeconds();
    await env.DB
      .prepare(
        `INSERT INTO properties
          (id, tenant_id, name, slug, status, timezone, currency, default_check_in_time, default_check_out_time,
           split_stay_enabled, split_stay_public_visible, allow_upgrade_to_preserve_stay, upgrade_mode,
           max_room_moves_per_reservation, max_upgrade_segments_per_stay, max_upgrade_level_jump, same_day_turnover_sellable,
           address_line_1, address_line_2, city, state_province, postal_code, country_code,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id, tenantId, parsed.name, parsed.slug, parsed.status, parsed.timezone, parsed.currency,
        parsed.defaultCheckInTime, parsed.defaultCheckOutTime,
        parsed.splitStayEnabled, parsed.splitStayPublicVisible, parsed.allowUpgradeToPreserveStay, parsed.upgradeMode,
        parsed.maxRoomMovesPerReservation, parsed.maxUpgradeSegmentsPerStay, parsed.maxUpgradeLevelJump, parsed.sameDayTurnoverSellable,
        parsed.addressLine1, parsed.addressLine2, parsed.city, parsed.stateProvince, parsed.postalCode, parsed.countryCode,
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

  const actor = await requireManagerActor(request, env, tenantId);
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

  const actor = await requireManagerActor(request, env, tenantId);
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

  const actor = await requireManagerActor(request, env, tenantId);
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
        `SELECT id, tenant_id, property_id, room_type_id, room_number, floor_label, sort_order, active, operational_status,
          do_not_disturb, room_service_requested, created_at, updated_at
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

  const actor = await requireManagerActor(request, env, tenantId);
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
          (id, tenant_id, property_id, room_type_id, room_number, floor_label, sort_order, active, operational_status, do_not_disturb, room_service_requested, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, tenantId, propertyId, parsed.roomTypeId, parsed.roomNumber, parsed.floorLabel, parsed.sortOrder, parsed.active, parsed.operationalStatus, parsed.doNotDisturb, parsed.roomServiceRequested, now, now)
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

  const actor = await requireManagerActor(request, env, tenantId);
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
            (id, tenant_id, property_id, room_type_id, room_number, floor_label, sort_order, active, operational_status, do_not_disturb, room_service_requested, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
          parsed.doNotDisturb,
          parsed.roomServiceRequested,
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

  const actor = await requireManagerActor(request, env, tenantId);
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

export async function handleUpdateRoomUnitFlags(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const roomUnitId = String(params?.roomUnitId || '').trim();

  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validateRoomUnitFlagPatchRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const existing = await loadRoomUnitById(env, tenantId, propertyId, roomUnitId);
    if (!existing) return jsonResponse({ error: 'Room unit not found.' }, 404);
    const now = currentUnixSeconds();
    const { sql, values } = buildDynamicUpdateSql('room_units', parsed.updates);
    await env.DB.prepare(`${sql} WHERE id = ? AND tenant_id = ? AND property_id = ?`).bind(...values, now, roomUnitId, tenantId, propertyId).run();
    return jsonResponse({ ok: true, room_unit: await loadRoomUnitById(env, tenantId, propertyId, roomUnitId) });
  } catch (error) {
    const mapped = mapBuilderSqlError(error);
    if (mapped) return jsonResponse(mapped.payload, mapped.status);
    console.error('[ROOM_UNIT_FLAGS_UPDATE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleGetPropertyShiftHandover(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();

  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  try {
    const property = await loadPropertyById(env, tenantId, propertyId);
    if (!property) return jsonResponse({ error: 'Property not found.' }, 404);
    return jsonResponse({ ok: true, shift_handover: await loadPropertyShiftHandover(env, tenantId, propertyId) });
  } catch (error) {
    console.error('[PROPERTY_SHIFT_HANDOVER_GET]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleUpdatePropertyShiftHandover(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();

  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validateShiftHandoverPatchRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const property = await loadPropertyById(env, tenantId, propertyId);
    if (!property) return jsonResponse({ error: 'Property not found.' }, 404);
    const now = currentUnixSeconds();
    await env.DB
      .prepare(
        `UPDATE properties
            SET shift_handover_note = ?,
                shift_handover_updated_at = ?,
                shift_handover_updated_by = ?,
                updated_at = ?
          WHERE id = ? AND tenant_id = ?`
      )
      .bind(parsed.note, now, actor.session.user_id || null, now, propertyId, tenantId)
      .run();
    return jsonResponse({ ok: true, shift_handover: await loadPropertyShiftHandover(env, tenantId, propertyId) });
  } catch (error) {
    console.error('[PROPERTY_SHIFT_HANDOVER_UPDATE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleListPropertyPricingProfiles(request, env, params) {
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
        `SELECT ppp.id, ppp.tenant_id, ppp.property_id, ppp.room_type_id, ppp.code, ppp.name,
                ppp.visibility, ppp.pricing_mode, ppp.fixed_nightly_amount, ppp.delta_amount, ppp.delta_percent,
                ppp.notes, ppp.active, ppp.created_by, ppp.updated_by, ppp.created_at, ppp.updated_at,
                rt.code AS room_type_code, rt.name AS room_type_name
           FROM property_pricing_profiles ppp
           LEFT JOIN room_types rt ON rt.id = ppp.room_type_id AND rt.tenant_id = ppp.tenant_id AND rt.property_id = ppp.property_id
          WHERE ppp.tenant_id = ? AND ppp.property_id = ?
          ORDER BY ppp.active DESC, ppp.created_at DESC`
      )
      .bind(tenantId, propertyId)
      .all();

    return jsonResponse({ ok: true, pricing_profiles: (result.results || []).map(mapPropertyPricingProfileRow) });
  } catch (error) {
    console.error('[PROPERTY_PRICING_PROFILE_LIST]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleCreatePropertyPricingProfile(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();

  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validatePropertyPricingProfileCreateRequest(body, propertyId);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const property = await loadPropertyById(env, tenantId, propertyId);
    if (!property) return jsonResponse({ error: 'Property not found.' }, 404);
    if (parsed.roomTypeId) {
      const roomType = await loadRoomTypeById(env, tenantId, propertyId, parsed.roomTypeId);
      if (!roomType) return jsonResponse({ error: 'Room type not found.' }, 404);
    }

    const id = nanoid();
    const now = currentUnixSeconds();
    const actorId = actor.session.user_id || null;
    await env.DB
      .prepare(
        `INSERT INTO property_pricing_profiles
          (id, tenant_id, property_id, room_type_id, code, name, visibility, pricing_mode,
           fixed_nightly_amount, delta_amount, delta_percent, notes, active, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        tenantId,
        propertyId,
        parsed.roomTypeId,
        parsed.code,
        parsed.name,
        parsed.visibility,
        parsed.pricingMode,
        parsed.fixedNightlyAmount,
        parsed.deltaAmount,
        parsed.deltaPercent,
        parsed.notes,
        parsed.active,
        actorId,
        actorId,
        now,
        now
      )
      .run();

    return jsonResponse({ ok: true, pricing_profile: await loadPropertyPricingProfileById(env, tenantId, propertyId, id) }, 201);
  } catch (error) {
    const mapped = mapBuilderSqlError(error);
    if (mapped) return jsonResponse(mapped.payload, mapped.status);
    console.error('[PROPERTY_PRICING_PROFILE_CREATE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleUpdatePropertyPricingProfile(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const pricingProfileId = String(params?.pricingProfileId || '').trim();

  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validatePropertyPricingProfilePatchRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const existing = await loadPropertyPricingProfileById(env, tenantId, propertyId, pricingProfileId);
    if (!existing) return jsonResponse({ error: 'Pricing profile not found.' }, 404);

    const nextRoomTypeId = Object.prototype.hasOwnProperty.call(parsed.updates, 'room_type_id')
      ? parsed.updates.room_type_id
      : existing.room_type_id;
    if (nextRoomTypeId) {
      const roomType = await loadRoomTypeById(env, tenantId, propertyId, nextRoomTypeId);
      if (!roomType) return jsonResponse({ error: 'Room type not found.' }, 404);
    }

    const normalizedConfig = validatePropertyPricingProfileConfiguration(
      parsed.updates.pricing_mode || existing.pricing_mode,
      {
        fixedNightlyAmount: Object.prototype.hasOwnProperty.call(parsed.updates, 'fixed_nightly_amount')
          ? parsed.updates.fixed_nightly_amount
          : existing.fixed_nightly_amount,
        deltaAmount: Object.prototype.hasOwnProperty.call(parsed.updates, 'delta_amount')
          ? parsed.updates.delta_amount
          : existing.delta_amount,
        deltaPercent: Object.prototype.hasOwnProperty.call(parsed.updates, 'delta_percent')
          ? parsed.updates.delta_percent
          : existing.delta_percent,
      }
    );
    if (normalizedConfig.error) return jsonResponse({ error: normalizedConfig.error }, 400);

    const updates = {
      ...parsed.updates,
      fixed_nightly_amount: normalizedConfig.fixedNightlyAmount,
      delta_amount: normalizedConfig.deltaAmount,
      delta_percent: normalizedConfig.deltaPercent,
      updated_by: actor.session.user_id || null,
    };
    const now = currentUnixSeconds();
    const { sql, values } = buildDynamicUpdateSql('property_pricing_profiles', updates);
    await env.DB
      .prepare(`${sql} WHERE id = ? AND tenant_id = ? AND property_id = ?`)
      .bind(...values, now, pricingProfileId, tenantId, propertyId)
      .run();
    return jsonResponse({ ok: true, pricing_profile: await loadPropertyPricingProfileById(env, tenantId, propertyId, pricingProfileId) });
  } catch (error) {
    const mapped = mapBuilderSqlError(error);
    if (mapped) return jsonResponse(mapped.payload, mapped.status);
    console.error('[PROPERTY_PRICING_PROFILE_UPDATE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleListPropertyWeekdayPricingRules(request, env, params) {
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
        `SELECT pwr.id, pwr.tenant_id, pwr.property_id, pwr.room_type_id, pwr.day_of_week, pwr.name,
                pwr.pricing_mode, pwr.fixed_nightly_amount, pwr.delta_amount, pwr.delta_percent,
                pwr.notes, pwr.active, pwr.created_by, pwr.updated_by, pwr.created_at, pwr.updated_at,
                rt.code AS room_type_code, rt.name AS room_type_name
           FROM property_weekday_pricing_rules pwr
           LEFT JOIN room_types rt ON rt.id = pwr.room_type_id AND rt.tenant_id = pwr.tenant_id AND rt.property_id = pwr.property_id
          WHERE pwr.tenant_id = ? AND pwr.property_id = ?
          ORDER BY pwr.active DESC, pwr.day_of_week ASC, CASE WHEN pwr.room_type_id IS NULL THEN 1 ELSE 0 END ASC, pwr.created_at DESC`
      )
      .bind(tenantId, propertyId)
      .all();

    return jsonResponse({ ok: true, weekday_pricing_rules: (result.results || []).map(mapPropertyWeekdayPricingRuleRow) });
  } catch (error) {
    console.error('[PROPERTY_WEEKDAY_PRICING_RULE_LIST]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleCreatePropertyWeekdayPricingRule(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();

  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validatePropertyWeekdayPricingRuleCreateRequest(body, propertyId);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const property = await loadPropertyById(env, tenantId, propertyId);
    if (!property) return jsonResponse({ error: 'Property not found.' }, 404);
    if (parsed.roomTypeId) {
      const roomType = await loadRoomTypeById(env, tenantId, propertyId, parsed.roomTypeId);
      if (!roomType) return jsonResponse({ error: 'Room type not found.' }, 404);
    }

    const id = nanoid();
    const now = currentUnixSeconds();
    const actorId = actor.session.user_id || null;
    await env.DB
      .prepare(
        `INSERT INTO property_weekday_pricing_rules
          (id, tenant_id, property_id, room_type_id, day_of_week, name, pricing_mode,
           fixed_nightly_amount, delta_amount, delta_percent, notes, active, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        tenantId,
        propertyId,
        parsed.roomTypeId,
        parsed.dayOfWeek,
        parsed.name,
        parsed.pricingMode,
        parsed.fixedNightlyAmount,
        parsed.deltaAmount,
        parsed.deltaPercent,
        parsed.notes,
        parsed.active,
        actorId,
        actorId,
        now,
        now
      )
      .run();

    return jsonResponse({ ok: true, weekday_pricing_rule: await loadPropertyWeekdayPricingRuleById(env, tenantId, propertyId, id) }, 201);
  } catch (error) {
    const mapped = mapBuilderSqlError(error);
    if (mapped) return jsonResponse(mapped.payload, mapped.status);
    console.error('[PROPERTY_WEEKDAY_PRICING_RULE_CREATE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleUpdatePropertyWeekdayPricingRule(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const weekdayPricingRuleId = String(params?.weekdayPricingRuleId || '').trim();

  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validatePropertyWeekdayPricingRulePatchRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const existing = await loadPropertyWeekdayPricingRuleById(env, tenantId, propertyId, weekdayPricingRuleId);
    if (!existing) return jsonResponse({ error: 'Weekday pricing rule not found.' }, 404);

    const nextRoomTypeId = Object.prototype.hasOwnProperty.call(parsed.updates, 'room_type_id')
      ? parsed.updates.room_type_id
      : existing.room_type_id;
    if (nextRoomTypeId) {
      const roomType = await loadRoomTypeById(env, tenantId, propertyId, nextRoomTypeId);
      if (!roomType) return jsonResponse({ error: 'Room type not found.' }, 404);
    }

    const normalizedConfig = validatePropertyPricingProfileConfiguration(
      parsed.updates.pricing_mode || existing.pricing_mode,
      {
        fixedNightlyAmount: Object.prototype.hasOwnProperty.call(parsed.updates, 'fixed_nightly_amount')
          ? parsed.updates.fixed_nightly_amount
          : existing.fixed_nightly_amount,
        deltaAmount: Object.prototype.hasOwnProperty.call(parsed.updates, 'delta_amount')
          ? parsed.updates.delta_amount
          : existing.delta_amount,
        deltaPercent: Object.prototype.hasOwnProperty.call(parsed.updates, 'delta_percent')
          ? parsed.updates.delta_percent
          : existing.delta_percent,
      }
    );
    if (normalizedConfig.error) return jsonResponse({ error: normalizedConfig.error }, 400);

    const updates = {
      ...parsed.updates,
      fixed_nightly_amount: normalizedConfig.fixedNightlyAmount,
      delta_amount: normalizedConfig.deltaAmount,
      delta_percent: normalizedConfig.deltaPercent,
      updated_by: actor.session.user_id || null,
    };
    const now = currentUnixSeconds();
    const { sql, values } = buildDynamicUpdateSql('property_weekday_pricing_rules', updates);
    await env.DB
      .prepare(`${sql} WHERE id = ? AND tenant_id = ? AND property_id = ?`)
      .bind(...values, now, weekdayPricingRuleId, tenantId, propertyId)
      .run();
    return jsonResponse({ ok: true, weekday_pricing_rule: await loadPropertyWeekdayPricingRuleById(env, tenantId, propertyId, weekdayPricingRuleId) });
  } catch (error) {
    const mapped = mapBuilderSqlError(error);
    if (mapped) return jsonResponse(mapped.payload, mapped.status);
    console.error('[PROPERTY_WEEKDAY_PRICING_RULE_UPDATE]', error);
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

export async function handleListPropertyAddonServicePresets(request, env, params) {
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
        `SELECT id, tenant_id, property_id, code, name, service_type, pricing_mode, currency,
                default_unit_price, default_unit_label, scope, early_arrival_fee, late_checkout_fee,
                active, sort_order, notes, config_json,
                created_at, updated_at
           FROM property_addon_service_presets
          WHERE tenant_id = ? AND property_id = ?
          ORDER BY sort_order ASC, created_at DESC`
      )
      .bind(tenantId, propertyId)
      .all();

    return jsonResponse({ ok: true, addon_service_presets: (result.results || []).map(mapAddonServicePresetRow) });
  } catch (error) {
    console.error('[PROPERTY_ADDON_PRESET_LIST]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleCreatePropertyAddonServicePreset(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();

  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validateAddonServicePresetCreateRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const property = await loadPropertyById(env, tenantId, propertyId);
    if (!property) return jsonResponse({ error: 'Property not found.' }, 404);
    const id = nanoid();
    const now = currentUnixSeconds();
    await env.DB
      .prepare(
        `INSERT INTO property_addon_service_presets
          (id, tenant_id, property_id, code, name, service_type, pricing_mode, currency,
           default_unit_price, default_unit_label, scope, early_arrival_fee, late_checkout_fee,
           active, sort_order, notes, config_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        tenantId,
        propertyId,
        parsed.code,
        parsed.name,
        parsed.serviceType,
        parsed.pricingMode,
        parsed.currency,
        parsed.defaultUnitPrice,
        parsed.defaultUnitLabel,
        parsed.scope,
        parsed.earlyArrivalFee,
        parsed.lateCheckoutFee,
        parsed.active,
        parsed.sortOrder,
        parsed.notes,
        serializeAddonConfigJson(parsed.serviceType, parsed.code, parsed.name, parsed.rawConfig),
        now,
        now
      )
      .run();

    return jsonResponse({ ok: true, addon_service_preset: await loadAddonServicePresetById(env, tenantId, propertyId, id) }, 201);
  } catch (error) {
    const mapped = mapBuilderSqlError(error);
    if (mapped) return jsonResponse(mapped.payload, mapped.status);
    console.error('[PROPERTY_ADDON_PRESET_CREATE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleSeedPropertyAddonServicePresets(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();

  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body = {};
  try { body = await parseJsonBody(request); } catch {}
  const presetKeys = Array.isArray(body?.preset_keys) && body.preset_keys.length
    ? body.preset_keys.map((key) => String(key).trim())
    : Object.keys(DEFAULT_PROPERTY_ADDON_PRESETS);

  try {
    const property = await loadPropertyById(env, tenantId, propertyId);
    if (!property) return jsonResponse({ error: 'Property not found.' }, 404);
    const now = currentUnixSeconds();
    const created = [];
    for (let index = 0; index < presetKeys.length; index += 1) {
      const preset = DEFAULT_PROPERTY_ADDON_PRESETS[presetKeys[index]];
      if (!preset) continue;

      const existing = await env.DB
        .prepare(`SELECT id FROM property_addon_service_presets WHERE tenant_id = ? AND property_id = ? AND code = ?`)
        .bind(tenantId, propertyId, preset.code)
        .first();
      if (existing?.id) continue;

      const presetId = nanoid();
      await env.DB
        .prepare(
          `INSERT INTO property_addon_service_presets
            (id, tenant_id, property_id, code, name, service_type, pricing_mode, currency,
             default_unit_price, default_unit_label, scope, early_arrival_fee, late_checkout_fee,
             active, sort_order, notes, config_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`
        )
        .bind(
          presetId,
          tenantId,
          propertyId,
          preset.code,
          preset.name,
          preset.service_type,
          preset.pricing_mode,
          preset.currency,
          preset.default_unit_price,
          preset.default_unit_label,
          preset.scope,
          Number(preset.early_arrival_fee || 0),
          Number(preset.late_checkout_fee || 0),
          index * 10,
          preset.notes || null,
          serializeAddonConfigJson(preset.service_type, preset.code, preset.name, null),
          now,
          now
        )
        .run();
      created.push(await loadAddonServicePresetById(env, tenantId, propertyId, presetId));
    }

    return jsonResponse({ ok: true, created_count: created.length, addon_service_presets: created }, 201);
  } catch (error) {
    const mapped = mapBuilderSqlError(error);
    if (mapped) return jsonResponse(mapped.payload, mapped.status);
    console.error('[PROPERTY_ADDON_PRESET_SEED]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleUpdatePropertyAddonServicePreset(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const presetId = String(params?.presetId || '').trim();

  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validateAddonServicePresetPatchRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const existing = await loadAddonServicePresetById(env, tenantId, propertyId, presetId);
    if (!existing) return jsonResponse({ error: 'Addon service preset not found.' }, 404);
    const now = currentUnixSeconds();
    const effectiveCode = parsed.updates.code ?? existing.code;
    const effectiveName = parsed.updates.name ?? existing.name;
    const effectiveServiceType = parsed.updates.service_type ?? existing.service_type;
    const effectiveConfig = 'config_json' in parsed.updates ? parsed.updates.config_json : existing.config_json;
    parsed.updates.config_json = serializeAddonConfigJson(effectiveServiceType, effectiveCode, effectiveName, effectiveConfig);
    const { sql, values } = buildDynamicUpdateSql('property_addon_service_presets', parsed.updates);
    await env.DB.prepare(`${sql} WHERE id = ? AND tenant_id = ? AND property_id = ?`).bind(...values, now, presetId, tenantId, propertyId).run();
    return jsonResponse({ ok: true, addon_service_preset: await loadAddonServicePresetById(env, tenantId, propertyId, presetId) });
  } catch (error) {
    const mapped = mapBuilderSqlError(error);
    if (mapped) return jsonResponse(mapped.payload, mapped.status);
    console.error('[PROPERTY_ADDON_PRESET_UPDATE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleCreateRoomRate(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();

  const actor = await requireManagerActor(request, env, tenantId);
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

  const actor = await requireManagerActor(request, env, tenantId);
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
  const actor = await requireManagerActor(request, env, tenantId);
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
  const actor = await requireManagerActor(request, env, tenantId);
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
  const actor = await requireManagerActor(request, env, tenantId);
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
  const actor = await requireManagerActor(request, env, tenantId);
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
    const quote = await resolvePropertyRateQuote(env, tenantId, propertyId, parsed);
    if (quote.error) return jsonResponse(quote.error.payload, quote.error.status);
    return jsonResponse(pricingBuildResolvedRateQuotePayload(propertyId, parsed, quote));
  } catch (error) {
    console.error('[PROPERTY_RATE_QUOTE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

async function loadAvailabilityInputs(env, tenantId, propertyId, startDate, endDate, options = {}) {
  const excludeHoldId = options.excludeHoldId ? String(options.excludeHoldId) : null;
  const excludeReservationId = options.excludeReservationId ? String(options.excludeReservationId) : null;
  const todayIso = formatDateUtc(new Date());
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

  const allotmentsResult = await env.DB
    .prepare(
      `SELECT id, tenant_id, property_id, room_type_id, operator_name, operator_code, source_ref,
              check_in, check_out, rooms_blocked, release_date, status, notes, created_at, updated_at
         FROM property_allotments
        WHERE tenant_id = ?
          AND property_id = ?
          AND status = 'active'
          AND check_in < ?
          AND check_out > ?
          AND (release_date IS NULL OR release_date >= ?)`
    )
    .bind(tenantId, propertyId, endDate, startDate, todayIso)
    .all();

  return {
    roomUnits: roomUnitsResult.results || [],
    holds: (holdsResult.results || []).filter((row) => !excludeHoldId || String(row.id) !== excludeHoldId),
    allocations: (allocationsResult.results || []).filter((row) => !excludeReservationId || String(row.reservation_id) !== excludeReservationId),
    allotments: allotmentsResult.results || [],
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

  const { roomUnits, holds, allocations, allotments } = await loadAvailabilityInputs(env, tenantId, propertyId, rangeStart, rangeEndExclusive, options);
  const roomUnitMap = new Map((roomUnits || []).map((roomUnit) => [String(roomUnit.id), roomUnit]));
  const preferredRoomUnitId = options.preferredRoomUnitId ? String(options.preferredRoomUnitId).trim() : null;
  const preferredRoomUnit = preferredRoomUnitId ? (roomUnitMap.get(preferredRoomUnitId) || null) : null;
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
  const allotmentCounts = countAllotmentsByNight(allotments, windowDates, options);
  const nightlyRemainingByType = buildNightlyRemaining(roomTypes, roomUnitsByType, roomTypeNightCounts, holdCounts, allotmentCounts, windowDates);

  const requestedNightly = (nightlyRemainingByType.get(String(requestedRoomType.id)) || []).filter((row) => stayDates.includes(row.stay_date));
  const shortageDates = collectShortageDates(requestedNightly, roomsRequested);
  const stayPlans = [];

  const requestedRoomUnits = roomUnitsByType.get(String(requestedRoomType.id)) || [];
  const contiguousUnits = findContiguousUnits(requestedRoomUnits, occupiedDatesByUnit, stayDates, roomsRequested, preferredRoomUnitId);
  const contiguousCapacity = hasContiguousCapacity(requestedNightly, roomsRequested);

  if (contiguousCapacity) {
    const contiguousSegments = buildSegmentsForContiguousUnits(
      String(requestedRoomType.id),
      checkIn,
      checkOut,
      contiguousUnits,
      roomsRequested
    );
    stayPlans.push(
      buildPlan(
        'contiguous_same_type',
        10,
        0,
        0,
        true,
        contiguousSegments,
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
            buildSegmentsForContiguousUnits(String(upgradeType.id), checkIn, checkOut, upgradeUnits, roomsRequested),
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
    nightlyRemainingByType,
    shortageDates,
    stayPlans,
    sameTypeNearbyOptions,
    otherRoomTypeOptions,
    activeAllotments: allotments,
    request: {
      property_id: propertyId,
      room_type_id: roomTypeId,
      check_in: checkIn,
      check_out: checkOut,
      rooms_requested: roomsRequested,
      preferred_room_unit_id: preferredRoomUnitId,
    },
    preferredRoomUnit,
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

function buildPlanningRecommendations(availability) {
  const recommendations = [];
  if (Array.isArray(availability?.sameTypeNearbyOptions) && availability.sameTypeNearbyOptions.length) {
    recommendations.push({
      kind: 'same_type_nearby',
      label: 'Shift dates within same room type',
      options: availability.sameTypeNearbyOptions,
    });
  }
  if (Array.isArray(availability?.otherRoomTypeOptions) && availability.otherRoomTypeOptions.length) {
    recommendations.push({
      kind: 'upgrade_preserve',
      label: 'Use an alternate room type',
      options: availability.otherRoomTypeOptions,
    });
  }
  if (Array.isArray(availability?.stayPlans) && availability.stayPlans.some((plan) => String(plan.plan_type || '').includes('split'))) {
    recommendations.push({
      kind: 'split_stay',
      label: 'Consider split-stay allocation',
      options: availability.stayPlans
        .filter((plan) => String(plan.plan_type || '').includes('split'))
        .map((plan) => ({
          plan_type: plan.plan_type,
          move_count: plan.move_count,
          public_visible: plan.public_visible,
        })),
    });
  }
  return recommendations;
}

function buildAllotmentConsumptionSummary(allotment, roomsRequested) {
  if (!allotment) return null;
  const blockedRooms = Math.max(0, Number(allotment.rooms_blocked || 0));
  const requestedRooms = Math.max(0, Number(roomsRequested || 0));
  const remainingRooms = Math.max(blockedRooms - requestedRooms, 0);
  return {
    allotment_id: allotment.id,
    operator_name: allotment.operator_name,
    operator_code: allotment.operator_code || null,
    room_type_id: allotment.room_type_id,
    room_type_code: allotment.room_type_code || null,
    room_type_name: allotment.room_type_name || null,
    check_in: allotment.check_in,
    check_out: allotment.check_out,
    release_date: allotment.release_date || null,
    rooms_blocked: blockedRooms,
    rooms_requested: requestedRooms,
    remaining_rooms_after_commit: remainingRooms,
    fully_consumed: remainingRooms === 0,
  };
}

async function buildPreferredRoomUnitConflicts(env, tenantId, propertyId, roomTypeId, roomUnitId, checkIn, checkOut, options = {}) {
  const normalizedRoomUnitId = String(roomUnitId || '').trim();
  if (!normalizedRoomUnitId) return { roomUnit: null, conflicts: [] };

  const roomUnit = await loadRoomUnitById(env, tenantId, propertyId, normalizedRoomUnitId);
  if (!roomUnit) {
    return {
      roomUnit: null,
      conflicts: [{ conflict_type: 'room_missing', room_unit_id: normalizedRoomUnitId }],
    };
  }

  const conflicts = [];
  if (String(roomUnit.room_type_id) !== String(roomTypeId)) {
    conflicts.push({
      conflict_type: 'room_type_mismatch',
      room_unit_id: roomUnit.id,
      room_number: roomUnit.room_number,
      room_type_id: roomUnit.room_type_id,
    });
  }
  if (!roomUnit.active) {
    conflicts.push({
      conflict_type: 'room_inactive',
      room_unit_id: roomUnit.id,
      room_number: roomUnit.room_number,
    });
  }
  if (['maintenance', 'out_of_order'].includes(String(roomUnit.operational_status || ''))) {
    conflicts.push({
      conflict_type: 'room_unavailable',
      room_unit_id: roomUnit.id,
      room_number: roomUnit.room_number,
      floor_label: roomUnit.floor_label || null,
      operational_status: roomUnit.operational_status,
    });
  }

  const excludeReservationId = options.excludeReservationId ? String(options.excludeReservationId) : null;
  const overlapResult = await env.DB
    .prepare(
      `SELECT ra.stay_date, ra.reservation_id, pr.guest_name, pr.status
         FROM reservation_allocations ra
         JOIN property_reservations pr
           ON pr.id = ra.reservation_id
          AND pr.tenant_id = ra.tenant_id
          AND pr.property_id = ra.property_id
        WHERE ra.tenant_id = ?
          AND ra.property_id = ?
          AND ra.room_unit_id = ?
          AND ra.stay_date >= ?
          AND ra.stay_date < ?
          AND (? IS NULL OR ra.reservation_id != ?)
          AND ra.allocation_status IN ('soft_allocated', 'locked')
        ORDER BY ra.stay_date ASC`
    )
    .bind(tenantId, propertyId, normalizedRoomUnitId, checkIn, checkOut, excludeReservationId, excludeReservationId)
    .all();

  for (const row of (overlapResult.results || [])) {
    conflicts.push({
      conflict_type: 'reservation_overlap',
      room_unit_id: roomUnit.id,
      room_number: roomUnit.room_number,
      floor_label: roomUnit.floor_label || null,
      stay_date: row.stay_date,
      reservation_id: row.reservation_id,
      reservation_status: row.status,
      guest_name: row.guest_name || null,
    });
  }

  return { roomUnit, conflicts };
}

async function buildReservationPlanningConflicts(env, tenantId, propertyId, roomTypeId, checkIn, checkOut, options = {}) {
  const stayDates = enumerateStayDates(checkIn, checkOut);
  const excludeReservationId = options.excludeReservationId ? String(options.excludeReservationId) : null;
  const consumeAllotmentId = options.consumeAllotmentId ? String(options.consumeAllotmentId).trim() : null;
  const consumeAllotmentRooms = Math.max(0, Number(options.consumeAllotmentRooms || 0));
  const roomUnitsResult = await env.DB
    .prepare(
      `SELECT id, room_number, floor_label, operational_status
         FROM room_units
        WHERE tenant_id = ?
          AND property_id = ?
          AND room_type_id = ?
          AND active = 1
        ORDER BY sort_order ASC, room_number ASC`
    )
    .bind(tenantId, propertyId, roomTypeId)
    .all();

  const allocationResult = await env.DB
    .prepare(
      `SELECT ra.room_unit_id, ra.stay_date, ra.reservation_id, pr.guest_name, pr.status,
              ru.room_number, ru.floor_label
         FROM reservation_allocations ra
         JOIN room_units ru
           ON ru.id = ra.room_unit_id
          AND ru.tenant_id = ra.tenant_id
          AND ru.property_id = ra.property_id
         JOIN property_reservations pr
           ON pr.id = ra.reservation_id
          AND pr.tenant_id = ra.tenant_id
          AND pr.property_id = ra.property_id
        WHERE ra.tenant_id = ?
          AND ra.property_id = ?
          AND ru.room_type_id = ?
          AND ra.stay_date >= ?
          AND ra.stay_date < ?
          AND (? IS NULL OR ra.reservation_id != ?)
          AND ra.allocation_status IN ('soft_allocated', 'locked')
        ORDER BY ra.stay_date ASC, ru.room_number ASC`
    )
    .bind(tenantId, propertyId, roomTypeId, checkIn, checkOut, excludeReservationId, excludeReservationId)
    .all();

  const holdResult = await env.DB
    .prepare(
      `SELECT id, hold_type, source_type, source_id, check_in, check_out, rooms_requested, expires_at
         FROM inventory_holds
        WHERE tenant_id = ?
          AND property_id = ?
          AND room_type_id = ?
          AND status = 'active'
          AND expires_at > ?
          AND check_in < ?
          AND check_out > ?
        ORDER BY check_in ASC, expires_at ASC`
    )
    .bind(tenantId, propertyId, roomTypeId, currentUnixSeconds(), checkOut, checkIn)
    .all();

  const allotmentResult = await env.DB
    .prepare(
      `SELECT id, operator_name, operator_code, source_ref, check_in, check_out, rooms_blocked, release_date, status
         FROM property_allotments
        WHERE tenant_id = ?
          AND property_id = ?
          AND room_type_id = ?
          AND status = 'active'
          AND check_in < ?
          AND check_out > ?
          AND (release_date IS NULL OR release_date >= ?)
        ORDER BY check_in ASC, operator_name ASC`
    )
    .bind(tenantId, propertyId, roomTypeId, checkOut, checkIn, formatDateUtc(new Date()))
    .all();

  const maintenanceConflicts = (roomUnitsResult.results || [])
    .filter((roomUnit) => ['maintenance', 'out_of_order'].includes(String(roomUnit.operational_status || '')))
    .map((roomUnit) => ({
      conflict_type: 'room_unavailable',
      room_unit_id: roomUnit.id,
      room_number: roomUnit.room_number,
      floor_label: roomUnit.floor_label || null,
      operational_status: roomUnit.operational_status,
      affected_dates: stayDates,
    }));

  const reservationConflicts = (allocationResult.results || []).map((row) => ({
    conflict_type: 'reservation_overlap',
    room_unit_id: row.room_unit_id,
    room_number: row.room_number,
    floor_label: row.floor_label || null,
    stay_date: row.stay_date,
    reservation_id: row.reservation_id,
    reservation_status: row.status,
    guest_name: row.guest_name || null,
  }));

  const holdConflicts = (holdResult.results || []).map((row) => ({
    conflict_type: 'inventory_hold',
    hold_id: row.id,
    hold_type: row.hold_type,
    source_type: row.source_type,
    source_id: row.source_id || null,
    check_in: row.check_in,
    check_out: row.check_out,
    rooms_requested: Number(row.rooms_requested || 0),
    expires_at: row.expires_at,
  }));

  const allotmentConflicts = (allotmentResult.results || []).map((row) => {
    const effectiveRoomsBlocked = consumeAllotmentId && String(row.id || '') === consumeAllotmentId
      ? Math.max(Number(row.rooms_blocked || 0) - consumeAllotmentRooms, 0)
      : Number(row.rooms_blocked || 0);
    if (effectiveRoomsBlocked < 1) return null;
    return {
      conflict_type: 'operator_allotment',
      allotment_id: row.id,
      operator_name: row.operator_name,
      operator_code: row.operator_code || null,
      source_ref: row.source_ref || null,
      check_in: row.check_in,
      check_out: row.check_out,
      rooms_blocked: effectiveRoomsBlocked,
      release_date: row.release_date || null,
      status: row.status,
    };
  }).filter(Boolean);

  return {
    maintenance_conflicts: maintenanceConflicts,
    reservation_conflicts: reservationConflicts,
    hold_conflicts: holdConflicts,
    allotment_conflicts: allotmentConflicts,
  };
}

function buildReservationPlanningPayload(availability, conflicts, metadata = {}) {
  const selectedPlan = selectBestPlan(availability);
  const selectedSegments = Array.isArray(selectedPlan?.segments) ? selectedPlan.segments : [];
  const selectedRoomUnitIds = selectedSegments.map((segment) => String(segment.room_unit_id || '')).filter(Boolean);
  const preferredRoomUnitId = String(metadata.preferredRoomUnitId || availability?.request?.preferred_room_unit_id || '').trim() || null;
  const preferredRoomUnit = metadata.preferredRoomUnit || availability?.preferredRoomUnit || null;
  const preferredRoomHonored = preferredRoomUnitId ? selectedRoomUnitIds.includes(preferredRoomUnitId) : null;
  const preferredRoomConflicts = Array.isArray(metadata.preferredRoomConflicts) ? metadata.preferredRoomConflicts : [];
  return {
    ok: true,
    can_fulfill: !availability.shortageDates.length && Boolean(selectedPlan),
    request: availability.request,
    selected_plan: selectedPlan,
    candidate_plans: availability.stayPlans || [],
    availability: buildAvailabilityPayload(availability).availability,
    conflicts: {
      shortage_dates: availability.shortageDates,
      maintenance_conflicts: conflicts.maintenance_conflicts,
      reservation_conflicts: conflicts.reservation_conflicts,
      hold_conflicts: conflicts.hold_conflicts,
      allotment_conflicts: conflicts.allotment_conflicts,
    },
    recommendations: buildPlanningRecommendations(availability),
    preferred_room_unit_id: preferredRoomUnitId,
    preferred_room_number: preferredRoomUnit?.room_number || null,
    preferred_room_honored: preferredRoomHonored,
    preferred_room_conflicts: preferredRoomConflicts,
    preferred_room_fallback_room_unit_ids: preferredRoomUnitId && selectedPlan && !preferredRoomHonored ? selectedRoomUnitIds : [],
    preferred_room_fallback_room_numbers: preferredRoomUnitId && selectedPlan && !preferredRoomHonored
      ? selectedSegments.map((segment) => segment.room_number).filter(Boolean)
      : [],
    allotment_consumption: metadata.allotmentConsumption || null,
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

function validateAllotmentConsumptionRequest(allotment, parsedRequest) {
  if (!allotment) return 'Active allotment not found.';
  if (String(allotment.status || '') !== 'active' || !Boolean(allotment.inventory_blocking)) {
    return 'Allotment is no longer active for inventory blocking.';
  }
  if (String(allotment.room_type_id || '') !== String(parsedRequest.roomTypeId || '')) {
    return 'allotment_id does not match the requested room type.';
  }
  if (parseDateUtc(parsedRequest.checkIn) < parseDateUtc(String(allotment.check_in || ''))
      || parseDateUtc(parsedRequest.checkOut) > parseDateUtc(String(allotment.check_out || ''))) {
    return 'Requested stay must fit inside the selected operator block window.';
  }
  if (Number(parsedRequest.roomsRequested || 0) > Number(allotment.rooms_blocked || 0)) {
    return 'Requested rooms exceed the remaining operator block.';
  }
  return null;
}

function selectBestPlan(availability) {
  return Array.isArray(availability?.stayPlans) && availability.stayPlans.length ? availability.stayPlans[0] : null;
}

function deriveAssignedRoomUnitId(selectedPlan) {
  if (!selectedPlan?.segments?.length) return null;
  return String(selectedPlan.segments[0]?.room_unit_id || '').trim() || null;
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
  const assignedRoomUnitId = deriveAssignedRoomUnitId(selectedPlan);

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

  await env.DB
    .prepare(
      `UPDATE property_reservations
          SET assigned_room_unit_id = ?,
              updated_at = ?
        WHERE id = ? AND tenant_id = ? AND property_id = ?`
    )
    .bind(assignedRoomUnitId, now, reservationId, tenantId, propertyId)
    .run();

  return { stayPlanId, lockedAt: now };
}

async function createReservationArtifacts(env, tenantId, reservationId, propertyId, reservationInput, selectedPlan, confirmedAt = currentUnixSeconds()) {
  const now = Number(confirmedAt || currentUnixSeconds());
  const assignedRoomUnitId = deriveAssignedRoomUnitId(selectedPlan);

  await env.DB
    .prepare(
      `INSERT INTO property_reservations
        (id, tenant_id, property_id, source, source_ref, source_payload, status,
         guest_name, guest_email, guest_phone,
         check_in, check_out, room_type_id, assigned_room_unit_id, rooms_requested, adults, children,
         pricing_snapshot, special_requests,
         expected_arrival_time, expected_flight_ref, expected_arrival_channel,
         airport_transfer_requested, airport_transfer_price_snapshot, cancellation_policy_snapshot,
         confirmed_at, confirmed_by, cancelled_at, cancelled_by, cancel_reason, guest_photo_key, guest_photo_uploaded_at,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`
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
      assignedRoomUnitId,
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
  await recordPropertyReservationEvent(env, tenantId, propertyId, reservationId, 'reservation_created', null, 'confirmed', {
    check_in: reservationInput.checkIn,
    check_out: reservationInput.checkOut,
    room_type_id: reservationInput.roomTypeId,
    rooms_requested: reservationInput.roomsRequested,
    adults: reservationInput.adults,
    children: reservationInput.children,
  });
  return { stayPlanId: planArtifacts.stayPlanId, confirmedAt: now };
}

async function loadPropertyReservation(env, tenantId, propertyId, reservationId) {
  const reservation = await env.DB
    .prepare(
      `SELECT pr.id, pr.tenant_id, pr.property_id, pr.source, pr.source_ref, pr.source_payload, pr.status,
              pr.guest_name, pr.guest_email, pr.guest_phone,
              pr.check_in, pr.check_out, pr.room_type_id, pr.assigned_room_unit_id,
              aru.room_number AS assigned_room_number,
              pr.guest_photo_key, pr.guest_photo_uploaded_at,
              pr.rooms_requested, pr.adults, pr.children,
              pricing_snapshot, special_requests,
              expected_arrival_time, expected_flight_ref, expected_arrival_channel,
              airport_transfer_requested, airport_transfer_price_snapshot, cancellation_policy_snapshot,
              confirmed_at, confirmed_by, cancelled_at, cancelled_by, cancel_reason,
              pr.created_at, pr.updated_at
         FROM property_reservations pr
         LEFT JOIN room_units aru
           ON aru.id = pr.assigned_room_unit_id
          AND aru.tenant_id = pr.tenant_id
          AND aru.property_id = pr.property_id
        WHERE pr.id = ? AND pr.tenant_id = ? AND pr.property_id = ?`
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
      `SELECT rss.id, rss.stay_plan_id, rss.segment_order, rss.room_type_id, rss.room_unit_id,
              ru.room_number AS room_unit_number,
              rss.check_in, rss.check_out, rss.segment_type, rss.upgrade_applied, rss.ops_notes, rss.created_at
         FROM reservation_stay_plan_segments rss
         LEFT JOIN room_units ru
           ON ru.id = rss.room_unit_id
          AND ru.tenant_id = rss.tenant_id
          AND ru.property_id = rss.property_id
        WHERE rss.tenant_id = ? AND rss.property_id = ? AND rss.reservation_id = ?
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

  const eventsResult = await env.DB
    .prepare(
      `SELECT id, action, from_status, to_status, actor_user_id, payload_json, created_at
         FROM property_reservation_events
        WHERE tenant_id = ? AND property_id = ? AND reservation_id = ?
        ORDER BY created_at DESC`
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
    events: (eventsResult.results || []).map((event) => ({
      ...event,
      payload: event.payload_json ? JSON.parse(event.payload_json) : null,
    })),
  };
}

function buildReservationPayload(record) {
  const allocatedRoomUnitIds = Array.from(new Set((record.segments || []).map((segment) => String(segment.room_unit_id || '').trim()).filter(Boolean)));
  const allocatedRoomNumbers = Array.from(new Set((record.segments || []).map((segment) => String(segment.room_unit_number || '').trim()).filter(Boolean)));
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
      assigned_room_unit_id: record.reservation.assigned_room_unit_id,
      assigned_room_number: record.reservation.assigned_room_number,
      allocated_room_unit_ids: allocatedRoomUnitIds,
      allocated_room_numbers: allocatedRoomNumbers,
      guest_photo_key: record.reservation.guest_photo_key || null,
      guest_photo_uploaded_at: record.reservation.guest_photo_uploaded_at || null,
      guest_photo_url: buildReservationGuestPhotoUrl(record.reservation.property_id, record.reservation.id, record.reservation.guest_photo_key),
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
    events: record.events || [],
  };
}

function buildReservationBoardSummary(row, boardDate) {
  const pricingSnapshot = row.pricing_snapshot ? parseJsonSafe(row.pricing_snapshot) : null;
  const allocatedRoomUnitIds = String(row.allocated_room_unit_ids || '').trim()
    ? String(row.allocated_room_unit_ids).split(',').map((value) => value.trim()).filter(Boolean)
    : [];
  const allocatedRoomNumbers = String(row.allocated_room_numbers || '').trim()
    ? String(row.allocated_room_numbers).split(',').map((value) => value.trim()).filter(Boolean)
    : [];
  const arrivalToday = boardDate ? String(row.check_in) === String(boardDate) : false;
  const departureToday = boardDate ? String(row.check_out) === String(boardDate) : false;
  const stayover = boardDate ? String(row.check_in) < String(boardDate) && String(row.check_out) > String(boardDate) : false;

  return {
    id: row.id,
    property_id: row.property_id,
    status: row.status,
    source: row.source,
    guest_name: row.guest_name,
    guest_email: row.guest_email,
    guest_phone: row.guest_phone,
    check_in: row.check_in,
    check_out: row.check_out,
    room_type_id: row.room_type_id,
    room_type_code: row.room_type_code,
    room_type_name: row.room_type_name,
    assigned_room_unit_id: row.assigned_room_unit_id,
    assigned_room_number: row.assigned_room_number,
    allocated_room_unit_ids: allocatedRoomUnitIds,
    allocated_room_numbers: allocatedRoomNumbers,
    guest_photo_url: buildReservationGuestPhotoUrl(row.property_id, row.id, row.guest_photo_key),
    rooms_requested: row.rooms_requested,
    adults: row.adults,
    children: row.children,
    pricing_snapshot: pricingSnapshot,
    confirmed_at: row.confirmed_at,
    cancelled_at: row.cancelled_at,
    cancel_reason: row.cancel_reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
    arrival_today: arrivalToday,
    departure_today: departureToday,
    stayover,
  };
}

async function loadReservationFolio(env, tenantId, propertyId, reservationId) {
  return env.DB
    .prepare(
      `SELECT id, tenant_id, property_id, reservation_id, status, currency, note, opened_at, settled_at, closed_by, created_at, updated_at
         FROM folios
        WHERE tenant_id = ? AND property_id = ? AND reservation_id = ?`
    )
    .bind(tenantId, propertyId, reservationId)
    .first();
}

async function ensureReservationFolio(env, tenantId, propertyId, reservationRecord) {
  let folio = await loadReservationFolio(env, tenantId, propertyId, reservationRecord.reservation.id);
  if (folio) return folio;

  const property = await loadPropertyById(env, tenantId, propertyId);
  const pricingCurrency = reservationRecord.reservation.pricing_snapshot ? parseJsonSafe(reservationRecord.reservation.pricing_snapshot)?.currency : null;
  const currency = String(pricingCurrency || property?.currency || 'USD').trim().toUpperCase();
  const now = currentUnixSeconds();
  const folioId = nanoid();

  await env.DB
    .prepare(
      `INSERT INTO folios
        (id, tenant_id, property_id, reservation_id, status, currency, note, opened_at, settled_at, closed_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'open', ?, NULL, ?, NULL, NULL, ?, ?)`
    )
    .bind(folioId, tenantId, propertyId, reservationRecord.reservation.id, currency, now, now, now)
    .run();

  folio = await loadReservationFolio(env, tenantId, propertyId, reservationRecord.reservation.id);
  return folio;
}

async function loadFolioLines(env, tenantId, propertyId, folioId) {
  const result = await env.DB
    .prepare(
      `SELECT id, tenant_id, property_id, folio_id, line_type, source_type, category, description,
              quantity, unit_amount, total_amount, currency, status, posted_at, posted_by, note, created_at, updated_at
         FROM folio_lines
        WHERE tenant_id = ? AND property_id = ? AND folio_id = ?
        ORDER BY posted_at ASC, created_at ASC`
    )
    .bind(tenantId, propertyId, folioId)
    .all();
  return result.results || [];
}

async function recalculateFolioStatus(env, tenantId, propertyId, folioId) {
  const totals = await env.DB
    .prepare(
      `SELECT COALESCE(SUM(total_amount), 0) AS balance_due,
              COALESCE(SUM(CASE WHEN line_type = 'payment' THEN ABS(total_amount) ELSE 0 END), 0) AS payment_total,
              COALESCE(SUM(CASE WHEN line_type != 'payment' AND total_amount > 0 THEN total_amount ELSE 0 END), 0) AS charge_total,
              COALESCE(SUM(CASE WHEN line_type != 'payment' AND total_amount < 0 THEN total_amount ELSE 0 END), 0) AS adjustment_total
         FROM folio_lines
        WHERE tenant_id = ? AND property_id = ? AND folio_id = ? AND status = 'posted'`
    )
    .bind(tenantId, propertyId, folioId)
    .first();

  const now = currentUnixSeconds();
  const balanceDue = Number(totals?.balance_due || 0);
  const nextStatus = balanceDue <= 0 ? 'settled' : 'open';
  await env.DB
    .prepare(
      `UPDATE folios
          SET status = ?,
              settled_at = ?,
              updated_at = ?
        WHERE id = ? AND tenant_id = ? AND property_id = ?`
    )
    .bind(nextStatus, nextStatus === 'settled' ? now : null, now, folioId, tenantId, propertyId)
    .run();

  return {
    charge_total: Number(totals?.charge_total || 0),
    payment_total: Number(totals?.payment_total || 0),
    adjustment_total: Number(totals?.adjustment_total || 0),
    balance_due: balanceDue,
    status: nextStatus,
  };
}

async function buildReservationFolioPayload(env, tenantId, propertyId, reservationRecord) {
  const folio = await ensureReservationFolio(env, tenantId, propertyId, reservationRecord);
  const lines = await loadFolioLines(env, tenantId, propertyId, folio.id);
  const summary = await recalculateFolioStatus(env, tenantId, propertyId, folio.id);
  const refreshedFolio = await loadReservationFolio(env, tenantId, propertyId, reservationRecord.reservation.id);
  return {
    ok: true,
    reservation_id: reservationRecord.reservation.id,
    folio: refreshedFolio,
    lines,
    summary,
  };
}

function reservationPrimaryRoomUnitId(record) {
  return String(
    record?.reservation?.assigned_room_unit_id
      || record?.segments?.[0]?.room_unit_id
      || record?.allocations?.[0]?.room_unit_id
      || ''
  ).trim() || null;
}

async function loadLatestRoomStatesByUnitIds(env, tenantId, propertyId, roomUnitIds) {
  const ids = Array.from(new Set((roomUnitIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(', ');
  const result = await env.DB
    .prepare(
      `SELECT e.room_unit_id, e.previous_state, e.new_state, e.note, e.reservation_id, e.changed_by, e.created_at
         FROM room_state_events e
         JOIN (
           SELECT room_unit_id, MAX(created_at) AS max_created_at
             FROM room_state_events
            WHERE tenant_id = ? AND property_id = ? AND room_unit_id IN (${placeholders})
            GROUP BY room_unit_id
         ) latest
           ON latest.room_unit_id = e.room_unit_id
          AND latest.max_created_at = e.created_at
        WHERE e.tenant_id = ? AND e.property_id = ? AND e.room_unit_id IN (${placeholders})`
    )
    .bind(tenantId, propertyId, ...ids, tenantId, propertyId, ...ids)
    .all();
  return new Map((result.results || []).map((row) => [String(row.room_unit_id), row]));
}

async function recordRoomStateEvent(env, tenantId, propertyId, roomUnitId, newState, options = {}) {
  const latestMap = await loadLatestRoomStatesByUnitIds(env, tenantId, propertyId, [roomUnitId]);
  const previousState = latestMap.get(String(roomUnitId))?.new_state || null;
  const now = currentUnixSeconds();
  await env.DB
    .prepare(
      `INSERT INTO room_state_events
        (id, tenant_id, property_id, room_unit_id, reservation_id, previous_state, new_state, note, changed_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      nanoid(),
      tenantId,
      propertyId,
      roomUnitId,
      options.reservationId || null,
      previousState,
      newState,
      options.note || null,
      options.changedBy || null,
      now
    )
    .run();
  return { previousState, newState, created_at: now };
}

async function determineHousekeepingPriority(env, tenantId, propertyId, roomUnitId, turnoverDate, reservationId, taskKind = 'departure_clean') {
  if (taskKind === 'stayover_refresh') return 'routine';
  const sameDayArrival = await env.DB
    .prepare(
      `SELECT id
         FROM property_reservations
        WHERE tenant_id = ?
          AND property_id = ?
          AND id != ?
          AND assigned_room_unit_id = ?
          AND check_in = ?
          AND status IN ('confirmed', 'checked_in')
        LIMIT 1`
    )
    .bind(tenantId, propertyId, reservationId || '', roomUnitId, turnoverDate)
    .first();
  return sameDayArrival ? 'arrival_today_high' : 'departure_clean';
}

async function ensureHousekeepingTask(env, tenantId, propertyId, options) {
  const roomUnitId = String(options?.roomUnitId || '').trim();
  const reservationId = String(options?.reservationId || '').trim();
  const taskKind = String(options?.taskKind || 'departure_clean').trim();
  const serviceDate = String(options?.serviceDate || '').trim();
  if (!roomUnitId || !reservationId || !serviceDate || !HOUSEKEEPING_TASK_KINDS.has(taskKind)) {
    return { task: null, created: false };
  }

  const roomUnit = await loadRoomUnitById(env, tenantId, propertyId, roomUnitId);
  if (!roomUnit || ['maintenance', 'out_of_order'].includes(String(roomUnit.operational_status))) {
    return { task: null, created: false };
  }

  const existing = await env.DB
    .prepare(
      `SELECT id, tenant_id, property_id, room_unit_id, reservation_id, task_kind, service_date, priority, status, scheduled_for,
              started_at, completed_at, assigned_user_id, note, created_at, updated_at
         FROM housekeeping_tasks
        WHERE tenant_id = ?
          AND property_id = ?
          AND room_unit_id = ?
          AND reservation_id = ?
          AND task_kind = ?
          AND service_date = ?
        ORDER BY created_at DESC
        LIMIT 1`
    )
    .bind(tenantId, propertyId, roomUnitId, reservationId, taskKind, serviceDate)
    .first();
  if (existing) return { task: existing, created: false };

  const priority = await determineHousekeepingPriority(env, tenantId, propertyId, roomUnitId, serviceDate, reservationId, taskKind);
  const now = currentUnixSeconds();
  const scheduledFor = Math.floor(parseDateUtc(serviceDate).getTime() / 1000);
  const taskId = nanoid();
  await env.DB
    .prepare(
      `INSERT INTO housekeeping_tasks
        (id, tenant_id, property_id, room_unit_id, reservation_id, task_kind, service_date, priority, status, scheduled_for,
         started_at, completed_at, assigned_user_id, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, NULL, ?, ?, ?)`
    )
    .bind(taskId, tenantId, propertyId, roomUnitId, reservationId, taskKind, serviceDate, priority, scheduledFor, options?.note || null, now, now)
    .run();
  const task = await env.DB
    .prepare(
      `SELECT id, tenant_id, property_id, room_unit_id, reservation_id, task_kind, service_date, priority, status, scheduled_for,
              started_at, completed_at, assigned_user_id, note, created_at, updated_at
         FROM housekeeping_tasks
        WHERE id = ? AND tenant_id = ? AND property_id = ?`
    )
    .bind(taskId, tenantId, propertyId)
    .first();
  return { task, created: true };
}

async function ensureHousekeepingTaskForTurnover(env, tenantId, propertyId, roomUnitId, reservationId, turnoverDate, actorUserId = null) {
  const result = await ensureHousekeepingTask(env, tenantId, propertyId, {
    roomUnitId,
    reservationId,
    taskKind: 'departure_clean',
    serviceDate: turnoverDate,
    note: `Auto-created from checkout for ${turnoverDate}.`,
    actorUserId,
  });
  return result.task;
}

async function ensureStayoverRefreshTasksForProperty(env, tenantId, propertyId, serviceDate) {
  const stayovers = await env.DB
    .prepare(
      `SELECT id, assigned_room_unit_id
         FROM property_reservations
        WHERE tenant_id = ?
          AND property_id = ?
          AND status = 'checked_in'
          AND assigned_room_unit_id IS NOT NULL
          AND check_in < ?
          AND check_out > ?`
    )
    .bind(tenantId, propertyId, serviceDate, serviceDate)
    .all();

  let createdCount = 0;
  for (const reservation of (stayovers.results || [])) {
    const result = await ensureHousekeepingTask(env, tenantId, propertyId, {
      roomUnitId: String(reservation.assigned_room_unit_id),
      reservationId: String(reservation.id),
      taskKind: 'stayover_refresh',
      serviceDate,
      note: `Auto-created stayover refresh for ${serviceDate}.`,
    });
    if (result.created) createdCount += 1;
  }
  return createdCount;
}

async function isPropertyLocalToday(env, tenantId, propertyId, boardDate, now = new Date()) {
  const property = await loadPropertyById(env, tenantId, propertyId);
  if (!property) return false;
  const timeZone = String(property.timezone || 'Asia/Ho_Chi_Minh').trim() || 'Asia/Ho_Chi_Minh';
  return formatDateParts(getTimeZoneDateTimeParts(now, timeZone)) === boardDate;
}

async function syncHousekeepingTasksForProperty(env, tenantId, propertyId, boardDate) {
  const departures = await env.DB
    .prepare(
      `SELECT id, assigned_room_unit_id, check_out
         FROM property_reservations
        WHERE tenant_id = ?
          AND property_id = ?
          AND status = 'checked_out'
          AND check_out = ?`
    )
    .bind(tenantId, propertyId, boardDate)
    .all();

  for (const reservation of (departures.results || [])) {
    if (!reservation.assigned_room_unit_id) continue;
    await ensureHousekeepingTaskForTurnover(env, tenantId, propertyId, String(reservation.assigned_room_unit_id), String(reservation.id), boardDate, null);
  }

  if (await isPropertyLocalToday(env, tenantId, propertyId, boardDate)) {
    await ensureStayoverRefreshTasksForProperty(env, tenantId, propertyId, boardDate);
  }
}

export async function runScheduledHousekeepingAutomation(env, now = new Date()) {
  const propertiesResult = await env.DB
    .prepare(
      `SELECT id, tenant_id, timezone
         FROM properties
        WHERE status = 'active'`
    )
    .all();

  let propertyCount = 0;
  let createdTaskCount = 0;
  for (const property of (propertiesResult.results || [])) {
    const timeZone = String(property.timezone || 'Asia/Ho_Chi_Minh').trim() || 'Asia/Ho_Chi_Minh';
    const localParts = getTimeZoneDateTimeParts(now, timeZone);
    if (localParts.hour !== 9 || localParts.minute >= 15) continue;
    createdTaskCount += await ensureStayoverRefreshTasksForProperty(env, String(property.tenant_id), String(property.id), formatDateParts(localParts));
    propertyCount += 1;
  }

  return { ok: true, property_count: propertyCount, created_task_count: createdTaskCount };
}

async function loadHousekeepingTasks(env, tenantId, propertyId, options = {}) {
  const statuses = Array.isArray(options.statuses) && options.statuses.length ? options.statuses : ['pending', 'in_progress', 'waiting_inspection'];
  const placeholders = statuses.map(() => '?').join(', ');
  const result = await env.DB
    .prepare(
      `SELECT ht.id, ht.tenant_id, ht.property_id, ht.room_unit_id, ht.reservation_id, ht.task_kind, ht.service_date, ht.priority, ht.status, ht.scheduled_for,
              ht.started_at, ht.completed_at, ht.assigned_user_id, ht.note, ht.created_at, ht.updated_at,
              ru.room_number, ru.floor_label, ru.room_type_id, ru.operational_status,
              pr.guest_name, pr.check_in, pr.check_out, pr.status AS reservation_status
         FROM housekeeping_tasks ht
         JOIN room_units ru
           ON ru.id = ht.room_unit_id
          AND ru.tenant_id = ht.tenant_id
          AND ru.property_id = ht.property_id
         LEFT JOIN property_reservations pr
           ON pr.id = ht.reservation_id
          AND pr.tenant_id = ht.tenant_id
          AND pr.property_id = ht.property_id
        WHERE ht.tenant_id = ?
          AND ht.property_id = ?
          AND ht.status IN (${placeholders})
        ORDER BY ht.scheduled_for ASC, ht.created_at ASC`
    )
    .bind(tenantId, propertyId, ...statuses)
    .all();
  return result.results || [];
}

function housekeepingStateFromTaskStatus(status, taskKind = 'departure_clean') {
  if (taskKind === 'stayover_refresh') {
    if (status === 'pending') return 'refresh_needed';
    if (status === 'in_progress') return 'refreshing';
    if (status === 'completed') return 'refreshed';
    return null;
  }
  if (status === 'pending') return 'dirty';
  if (status === 'in_progress') return 'cleaning';
  if (status === 'waiting_inspection') return 'ready_for_inspection';
  if (status === 'completed') return 'ready';
  return null;
}

function resolveEffectiveHousekeepingRoomState(taskKind, taskStatus, latestRoomState) {
  const statusState = housekeepingStateFromTaskStatus(taskStatus, taskKind);
  const persistedState = String(latestRoomState || '').trim() || null;

  if (taskKind === 'stayover_refresh') return statusState || 'ready';

  if (taskStatus === 'pending' || taskStatus === 'in_progress') {
    return statusState || persistedState || 'ready';
  }

  if (taskStatus === 'waiting_inspection') {
    if (persistedState === 'inspected' || persistedState === 'ready') return persistedState;
    return 'ready_for_inspection';
  }

  return persistedState || statusState || 'ready';
}

async function resolveReservationNightlyRate(env, tenantId, propertyId, reservation, stayDate) {
  const snapshotNightly = pricingResolveSnapshotNightlyRate(reservation?.pricing_snapshot, stayDate);
  if (snapshotNightly) return snapshotNightly;

  const [property, roomType, baseRateRow, seasonsResult, seasonRatesResult, weekdayRulesResult] = await Promise.all([
    loadPropertyById(env, tenantId, propertyId),
    loadRoomTypeById(env, tenantId, propertyId, reservation.room_type_id),
    env.DB.prepare(
      `SELECT id, tenant_id, property_id, room_type_id, rate_name, currency, nightly_amount,
              included_adults, included_children, extra_adult_amount, extra_child_amount,
              active, created_at, updated_at
         FROM property_room_rates
        WHERE tenant_id = ? AND property_id = ? AND room_type_id = ? AND active = 1
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1`
    ).bind(tenantId, propertyId, reservation.room_type_id).first(),
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
    ).bind(tenantId, propertyId, reservation.room_type_id).all(),
    env.DB.prepare(
      `SELECT pwr.id, pwr.tenant_id, pwr.property_id, pwr.room_type_id, pwr.day_of_week, pwr.name,
              pwr.pricing_mode, pwr.fixed_nightly_amount, pwr.delta_amount, pwr.delta_percent,
              pwr.notes, pwr.active, pwr.created_by, pwr.updated_by, pwr.created_at, pwr.updated_at,
              rt.code AS room_type_code, rt.name AS room_type_name
         FROM property_weekday_pricing_rules pwr
         LEFT JOIN room_types rt ON rt.id = pwr.room_type_id AND rt.tenant_id = pwr.tenant_id AND rt.property_id = pwr.property_id
        WHERE pwr.tenant_id = ?
          AND pwr.property_id = ?
          AND pwr.active = 1
          AND (pwr.room_type_id IS NULL OR pwr.room_type_id = ?)
        ORDER BY CASE WHEN pwr.room_type_id = ? THEN 0 ELSE 1 END ASC, pwr.day_of_week ASC, pwr.created_at ASC`
    ).bind(tenantId, propertyId, reservation.room_type_id, reservation.room_type_id).all(),
  ]);

  if (!property || !roomType) return null;
  const activeSeasons = (seasonsResult.results || []).map(mapRateSeasonRow);
  const seasonRatesByKey = new Map((seasonRatesResult.results || []).map((row) => [String(row.season_id), mapSeasonRateRow(row)]));
  const weekdayRules = (weekdayRulesResult.results || []).map(mapPropertyWeekdayPricingRuleRow);
  const baseRate = baseRateRow ? mapRoomRateRow(baseRateRow) : null;
  const resolved = resolveNightlyRateForDate(stayDate, activeSeasons, seasonRatesByKey, baseRate);
  const weekdayRule = selectApplicablePropertyWeekdayPricingRule(weekdayRules, reservation.room_type_id, stayDate);
  const effectiveRate = applyPropertyWeekdayPricingRuleToResolvedRate(resolved, weekdayRule, stayDate);
  if (!effectiveRate) return null;
  const occupancyAdjustment = calculateOccupancyAdjustment(effectiveRate, reservation.adults, reservation.children, reservation.rooms_requested);
  const nightlyBaseTotal = Number(effectiveRate.nightly_amount) * Number(reservation.rooms_requested || 1);
  return {
    currency: effectiveRate.currency || property.currency,
    unit_amount: Number(effectiveRate.nightly_amount),
    total_amount: nightlyBaseTotal + Number(occupancyAdjustment.adjustment_amount || 0),
    adjustment_amount: Number(occupancyAdjustment.adjustment_amount || 0),
    source: effectiveRate.source,
    season_name: effectiveRate.season_name,
  };
}

export async function runPropertyNightAuditForDate(env, auditDate) {
  const targetDate = String(auditDate || formatDateUtc(addDays(new Date(), -1))).trim();
  const properties = await env.DB
    .prepare(`SELECT id, tenant_id FROM properties WHERE status = 'active'`)
    .all();

  let postedCount = 0;
  for (const property of (properties.results || [])) {
    const reservations = await env.DB
      .prepare(
        `SELECT id, tenant_id, property_id, room_type_id, rooms_requested, adults, children, status, check_in, check_out,
                guest_name, pricing_snapshot, assigned_room_unit_id
           FROM property_reservations
          WHERE tenant_id = ?
            AND property_id = ?
            AND check_in <= ?
            AND check_out > ?
            AND status IN ('checked_in', 'checked_out')`
      )
      .bind(property.tenant_id, property.id, targetDate, targetDate)
      .all();

    for (const reservation of (reservations.results || [])) {
      const record = { reservation, segments: [], allocations: [] };
      const folio = await ensureReservationFolio(env, property.tenant_id, property.id, record);
      const auditToken = `night_audit:${targetDate}`;
      const existing = await env.DB
        .prepare(
          `SELECT id
             FROM folio_lines
            WHERE tenant_id = ?
              AND property_id = ?
              AND folio_id = ?
              AND line_type = 'room_charge'
              AND category = 'room_rate'
              AND note = ?
              AND status = 'posted'
            LIMIT 1`
        )
        .bind(property.tenant_id, property.id, folio.id, auditToken)
        .first();
      if (existing) continue;

      const nightly = await resolveReservationNightlyRate(env, property.tenant_id, property.id, reservation, targetDate);
      if (!nightly) continue;
      const now = currentUnixSeconds();
      await env.DB
        .prepare(
          `INSERT INTO folio_lines
            (id, tenant_id, property_id, folio_id, line_type, source_type, category, description,
             quantity, unit_amount, total_amount, currency, status, posted_at, posted_by, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'room_charge', 'reservation_system', 'room_rate', ?, 1, ?, ?, ?, 'posted', ?, NULL, ?, ?, ?)`
        )
        .bind(
          nanoid(),
          property.tenant_id,
          property.id,
          folio.id,
          `Night audit room charge · ${targetDate}${nightly.season_name ? ` · ${nightly.season_name}` : ''}`,
          nightly.unit_amount,
          nightly.total_amount,
          nightly.currency,
          now,
          auditToken,
          now,
          now
        )
        .run();
      await recalculateFolioStatus(env, property.tenant_id, property.id, folio.id);
      postedCount += 1;
    }
  }

  return { ok: true, audit_date: targetDate, room_charge_lines_posted: postedCount };
}

export async function handleGetPropertyReservationFolio(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const reservationId = String(params?.reservationId || '').trim();
  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  try {
    const record = await loadPropertyReservation(env, tenantId, propertyId, reservationId);
    if (!record) return jsonResponse({ error: 'Reservation not found.' }, 404);
    return jsonResponse(await buildReservationFolioPayload(env, tenantId, propertyId, record));
  } catch (error) {
    console.error('[PROPERTY_RESERVATION_FOLIO_GET]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleCreatePropertyReservationFolioLine(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const reservationId = String(params?.reservationId || '').trim();
  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validateFolioChargeRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const record = await loadPropertyReservation(env, tenantId, propertyId, reservationId);
    if (!record) return jsonResponse({ error: 'Reservation not found.' }, 404);
    if (['cancelled', 'no_show'].includes(String(record.reservation.status))) {
      return jsonResponse({ error: 'Cannot post folio charges for cancelled or no_show reservations.' }, 409);
    }
    const folio = await ensureReservationFolio(env, tenantId, propertyId, record);
    const now = currentUnixSeconds();
    const currency = parsed.currency || String(folio.currency || 'USD').trim().toUpperCase();
    const totalAmount = Number((parsed.quantity * parsed.unitAmount).toFixed(2));
    await env.DB
      .prepare(
        `INSERT INTO folio_lines
          (id, tenant_id, property_id, folio_id, line_type, source_type, category, description,
           quantity, unit_amount, total_amount, currency, status, posted_at, posted_by, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, ?)`
      )
      .bind(nanoid(), tenantId, propertyId, folio.id, parsed.lineType, parsed.sourceType, parsed.category, parsed.description, parsed.quantity, parsed.unitAmount, totalAmount, currency, now, request.headers.get('X-User-ID')?.trim() || null, parsed.note, now, now)
      .run();

    return jsonResponse(await buildReservationFolioPayload(env, tenantId, propertyId, record), 201);
  } catch (error) {
    console.error('[PROPERTY_RESERVATION_FOLIO_LINE_CREATE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleCreatePropertyReservationFolioPayment(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const reservationId = String(params?.reservationId || '').trim();
  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validateFolioPaymentRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const record = await loadPropertyReservation(env, tenantId, propertyId, reservationId);
    if (!record) return jsonResponse({ error: 'Reservation not found.' }, 404);
    const folio = await ensureReservationFolio(env, tenantId, propertyId, record);
    const now = currentUnixSeconds();
    const currency = parsed.currency || String(folio.currency || 'USD').trim().toUpperCase();
    const totalAmount = Number((-parsed.amount).toFixed(2));
    await env.DB
      .prepare(
        `INSERT INTO folio_lines
          (id, tenant_id, property_id, folio_id, line_type, source_type, category, description,
           quantity, unit_amount, total_amount, currency, status, posted_at, posted_by, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'payment', 'manual_frontdesk', ?, ?, 1, ?, ?, ?, 'posted', ?, ?, ?, ?, ?)`
      )
      .bind(nanoid(), tenantId, propertyId, folio.id, parsed.method, `Payment (${parsed.method.replace('_', ' ')})`, totalAmount, totalAmount, currency, now, request.headers.get('X-User-ID')?.trim() || null, parsed.note, now, now)
      .run();

    return jsonResponse(await buildReservationFolioPayload(env, tenantId, propertyId, record), 201);
  } catch (error) {
    console.error('[PROPERTY_RESERVATION_FOLIO_PAYMENT_CREATE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleUploadReservationGuestPhoto(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const reservationId = String(params?.reservationId || '').trim();
  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  try {
    const record = await loadPropertyReservation(env, tenantId, propertyId, reservationId);
    if (!record) return jsonResponse({ error: 'Reservation not found.' }, 404);

    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) return jsonResponse({ error: 'file is required.' }, 400);
    const contentType = String(file.type || '').trim().toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(contentType)) {
      return jsonResponse({ error: 'Only jpeg, png, webp, and gif guest photos are supported.' }, 400);
    }
    if (Number(file.size || 0) > 5 * 1024 * 1024) return jsonResponse({ error: 'Guest photo must be 5 MB or smaller.' }, 400);

    const key = buildReservationGuestPhotoKey(tenantId, propertyId, reservationId, detectFileExtension(contentType, file.name));
    await env.BOOKING_PROOFS.put(key, file, {
      httpMetadata: { contentType, cacheControl: 'private, max-age=300' },
      customMetadata: { tenant_id: tenantId, property_id: propertyId, reservation_id: reservationId, kind: 'guest_photo' },
    });
    const now = currentUnixSeconds();
    await env.DB
      .prepare(
        `UPDATE property_reservations
            SET guest_photo_key = ?, guest_photo_uploaded_at = ?, updated_at = ?
          WHERE id = ? AND tenant_id = ? AND property_id = ?`
      )
      .bind(key, now, now, reservationId, tenantId, propertyId)
      .run();

    return jsonResponse(buildReservationPayload(await loadPropertyReservation(env, tenantId, propertyId, reservationId)), 201);
  } catch (error) {
    console.error('[PROPERTY_RESERVATION_GUEST_PHOTO_UPLOAD]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleGetReservationGuestPhoto(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const reservationId = String(params?.reservationId || '').trim();
  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  try {
    const record = await loadPropertyReservation(env, tenantId, propertyId, reservationId);
    if (!record?.reservation?.guest_photo_key) return jsonResponse({ error: 'Guest photo not found.' }, 404);
    const object = await env.BOOKING_PROOFS.get(String(record.reservation.guest_photo_key));
    if (!object) return jsonResponse({ error: 'Guest photo not found.' }, 404);
    return imageResponse(object);
  } catch (error) {
    console.error('[PROPERTY_RESERVATION_GUEST_PHOTO_GET]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleListPropertyAvailabilityHolds(request, env, params) {
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
        `SELECT ih.id, ih.tenant_id, ih.property_id, ih.room_type_id, ih.hold_type, ih.source_type, ih.source_id,
                ih.check_in, ih.check_out, ih.rooms_requested, ih.status, ih.expires_at, ih.created_at,
                rt.code AS room_type_code, rt.name AS room_type_name
           FROM inventory_holds ih
           LEFT JOIN room_types rt
             ON rt.id = ih.room_type_id
            AND rt.tenant_id = ih.tenant_id
            AND rt.property_id = ih.property_id
          WHERE ih.tenant_id = ?
            AND ih.property_id = ?
            AND ih.status = 'active'
            AND ih.expires_at > ?
          ORDER BY ih.expires_at ASC, ih.created_at DESC`
      )
      .bind(tenantId, propertyId, currentUnixSeconds())
      .all();

    return jsonResponse({ ok: true, property_id: propertyId, holds: result.results || [] });
  } catch (error) {
    console.error('[PROPERTY_HOLD_LIST]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleRunPropertyNightAudit(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body = {};
  try {
    if ((request.headers.get('content-type') || '').includes('application/json')) body = await parseJsonBody(request);
  } catch {
    return jsonResponse({ error: 'Request body is not valid JSON.' }, 400);
  }

  const auditDate = body?.audit_date ? String(body.audit_date).trim() : formatDateUtc(addDays(new Date(), -1));
  if (!isIsoDate(auditDate)) return jsonResponse({ error: 'audit_date must use YYYY-MM-DD format.' }, 400);

  try {
    const property = await loadPropertyById(env, tenantId, propertyId);
    if (!property) return jsonResponse({ error: 'Property not found.' }, 404);
    const reservations = await env.DB
      .prepare(
        `SELECT id, tenant_id, property_id, room_type_id, rooms_requested, adults, children, status, check_in, check_out,
                guest_name, pricing_snapshot, assigned_room_unit_id
           FROM property_reservations
          WHERE tenant_id = ?
            AND property_id = ?
            AND check_in <= ?
            AND check_out > ?
            AND status IN ('checked_in', 'checked_out')`
      )
      .bind(tenantId, propertyId, auditDate, auditDate)
      .all();

    let postedCount = 0;
    for (const reservation of (reservations.results || [])) {
      const record = { reservation, segments: [], allocations: [] };
      const folio = await ensureReservationFolio(env, tenantId, propertyId, record);
      const auditToken = `night_audit:${auditDate}`;
      const existing = await env.DB
        .prepare(
          `SELECT id FROM folio_lines
            WHERE tenant_id = ? AND property_id = ? AND folio_id = ?
              AND line_type = 'room_charge' AND category = 'room_rate' AND note = ? AND status = 'posted'
            LIMIT 1`
        )
        .bind(tenantId, propertyId, folio.id, auditToken)
        .first();
      if (existing) continue;

      const nightly = await resolveReservationNightlyRate(env, tenantId, propertyId, reservation, auditDate);
      if (!nightly) continue;
      const now = currentUnixSeconds();
      await env.DB
        .prepare(
          `INSERT INTO folio_lines
            (id, tenant_id, property_id, folio_id, line_type, source_type, category, description,
             quantity, unit_amount, total_amount, currency, status, posted_at, posted_by, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'room_charge', 'reservation_system', 'room_rate', ?, 1, ?, ?, ?, 'posted', ?, ?, ?, ?, ?)`
        )
        .bind(nanoid(), tenantId, propertyId, folio.id, `Night audit room charge · ${auditDate}${nightly.season_name ? ` · ${nightly.season_name}` : ''}`, nightly.unit_amount, nightly.total_amount, nightly.currency, now, request.headers.get('X-User-ID')?.trim() || null, auditToken, now, now)
        .run();
      await recalculateFolioStatus(env, tenantId, propertyId, folio.id);
      postedCount += 1;
    }

    return jsonResponse({ ok: true, property_id: propertyId, audit_date: auditDate, room_charge_lines_posted: postedCount });
  } catch (error) {
    console.error('[PROPERTY_NIGHT_AUDIT]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleListHousekeepingTasks(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;
  const url = new URL(request.url);
  const boardDate = String(url.searchParams.get('board_date') || formatDateUtc(new Date())).trim();
  if (!isIsoDate(boardDate)) return jsonResponse({ error: 'board_date must use YYYY-MM-DD format.' }, 400);

  try {
    await syncHousekeepingTasksForProperty(env, tenantId, propertyId, boardDate);
    const tasks = await loadHousekeepingTasks(env, tenantId, propertyId);
    const roomUnitsResult = await env.DB
      .prepare(
        `SELECT id
           FROM room_units
          WHERE tenant_id = ?
            AND property_id = ?
            AND active = 1`
      )
      .bind(tenantId, propertyId)
      .all();
    const roomUnitIds = (roomUnitsResult.results || []).map((roomUnit) => roomUnit.id);
    const roomStateMap = await loadLatestRoomStatesByUnitIds(env, tenantId, propertyId, roomUnitIds);
    return jsonResponse({
      ok: true,
      property_id: propertyId,
      board_date: boardDate,
      actor_role: actor.session.role,
      room_states: Array.from(roomStateMap.values()),
      housekeeping_tasks: tasks.map((task) => ({
        ...task,
        effective_room_state: resolveEffectiveHousekeepingRoomState(task.task_kind, task.status, roomStateMap.get(String(task.room_unit_id))?.new_state),
      })),
    });
  } catch (error) {
    console.error('[PROPERTY_HOUSEKEEPING_LIST]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleSyncHousekeepingTasks(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;
  const url = new URL(request.url);
  const boardDate = String(url.searchParams.get('board_date') || formatDateUtc(new Date())).trim();
  if (!isIsoDate(boardDate)) return jsonResponse({ error: 'board_date must use YYYY-MM-DD format.' }, 400);

  try {
    await syncHousekeepingTasksForProperty(env, tenantId, propertyId, boardDate);
    const tasks = await loadHousekeepingTasks(env, tenantId, propertyId);
    return jsonResponse({ ok: true, property_id: propertyId, board_date: boardDate, housekeeping_task_count: tasks.length });
  } catch (error) {
    console.error('[PROPERTY_HOUSEKEEPING_SYNC]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleUpdateHousekeepingTask(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const taskId = String(params?.taskId || '').trim();
  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validateHousekeepingTaskPatchRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);
  if (parsed.roomState && (PROPERTY_ROLE_RANK[actor.session.role] ?? 0) < 3) {
    return jsonResponse({ error: 'Manager or owner access required.' }, 403);
  }

  try {
    const existing = await env.DB
      .prepare(
        `SELECT id, tenant_id, property_id, room_unit_id, reservation_id, task_kind, service_date, priority, status, scheduled_for,
                started_at, completed_at, assigned_user_id, note, created_at, updated_at
           FROM housekeeping_tasks
          WHERE id = ? AND tenant_id = ? AND property_id = ?`
      )
      .bind(taskId, tenantId, propertyId)
      .first();
    if (!existing) return jsonResponse({ error: 'Housekeeping task not found.' }, 404);

    const latestRoomStateMap = await loadLatestRoomStatesByUnitIds(env, tenantId, propertyId, [existing.room_unit_id]);
    const currentEffectiveRoomState = resolveEffectiveHousekeepingRoomState(existing.task_kind, existing.status, latestRoomStateMap.get(String(existing.room_unit_id))?.new_state);
    if (parsed.roomState === 'inspected' && currentEffectiveRoomState !== 'ready_for_inspection') {
      return jsonResponse({ error: 'Room must be ready for inspection before it can be inspected.' }, 409);
    }
    if (parsed.roomState === 'ready' && currentEffectiveRoomState !== 'inspected') {
      return jsonResponse({ error: 'Room must be inspected before it can be marked clean.' }, 409);
    }

    const updates = { ...parsed.updates };
    const now = currentUnixSeconds();
    if (updates.status === 'in_progress') updates.started_at = existing.started_at || now;
    if (updates.status === 'completed') updates.completed_at = now;
    if (updates.status === 'cancelled') updates.completed_at = existing.completed_at || null;
    if (parsed.roomState === 'ready' && !updates.status) {
      updates.status = 'completed';
      updates.completed_at = now;
    }
    if (Object.keys(updates).length) {
      const { sql, values } = buildDynamicUpdateSql('housekeeping_tasks', updates);
      await env.DB.prepare(`${sql} WHERE id = ? AND tenant_id = ? AND property_id = ?`).bind(...values, now, taskId, tenantId, propertyId).run();
    }

    const nextRoomState = parsed.roomState || (updates.status ? housekeepingStateFromTaskStatus(updates.status, existing.task_kind) : null);
    if (nextRoomState && nextRoomState !== 'ready_for_inspection' && existing.task_kind !== 'stayover_refresh') {
      await recordRoomStateEvent(env, tenantId, propertyId, existing.room_unit_id, nextRoomState, {
        reservationId: existing.reservation_id,
        note: updates.note || existing.note || null,
        changedBy: request.headers.get('X-User-ID')?.trim() || null,
      });
    }

    const updated = Object.keys(updates).length
      ? await env.DB
        .prepare(
          `SELECT id, tenant_id, property_id, room_unit_id, reservation_id, task_kind, service_date, priority, status, scheduled_for,
                  started_at, completed_at, assigned_user_id, note, created_at, updated_at
             FROM housekeeping_tasks
            WHERE id = ? AND tenant_id = ? AND property_id = ?`
        )
        .bind(taskId, tenantId, propertyId)
        .first()
      : existing;
    const refreshedRoomStateMap = await loadLatestRoomStatesByUnitIds(env, tenantId, propertyId, [existing.room_unit_id]);
    return jsonResponse({
      ok: true,
      housekeeping_task: {
        ...updated,
        effective_room_state: resolveEffectiveHousekeepingRoomState(updated.task_kind, updated.status, refreshedRoomStateMap.get(String(existing.room_unit_id))?.new_state || nextRoomState),
      },
    });
  } catch (error) {
    console.error('[PROPERTY_HOUSEKEEPING_UPDATE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
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

export async function handlePlanPropertyReservation(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try {
    body = await parseJsonBody(request);
  } catch {
    return jsonResponse({ error: 'Request body is not valid JSON.' }, 400);
  }

  const parsedRequest = validateAvailabilityRequest(body, params?.propertyId);
  if (parsedRequest.error) return jsonResponse({ error: parsedRequest.error }, 400);
  const pricingPreviewRequest = validatePlannerPricingPreviewRequest(body);
  if (pricingPreviewRequest.error) return jsonResponse({ error: pricingPreviewRequest.error }, 400);

  try {
    let activeAllotment = null;
    if (parsedRequest.allotmentId) {
      activeAllotment = await loadPropertyAllotmentById(env, tenantId, parsedRequest.propertyId, parsedRequest.allotmentId);
      const allotmentError = validateAllotmentConsumptionRequest(activeAllotment, parsedRequest);
      if (allotmentError) return jsonResponse({ error: allotmentError }, activeAllotment ? 409 : 404);
    }

    const availability = await calculateAvailability(
      env,
      tenantId,
      parsedRequest.propertyId,
      parsedRequest.roomTypeId,
      parsedRequest.checkIn,
      parsedRequest.checkOut,
      parsedRequest.roomsRequested,
      {
        preferredRoomUnitId: parsedRequest.preferredRoomUnitId,
        consumeAllotmentId: activeAllotment?.id || null,
        consumeAllotmentRooms: activeAllotment ? parsedRequest.roomsRequested : 0,
      }
    );
    if (availability.error) return jsonResponse(availability.error.payload, availability.error.status);

    const conflicts = await buildReservationPlanningConflicts(
      env,
      tenantId,
      parsedRequest.propertyId,
      parsedRequest.roomTypeId,
      parsedRequest.checkIn,
      parsedRequest.checkOut,
      {
        consumeAllotmentId: activeAllotment?.id || null,
        consumeAllotmentRooms: activeAllotment ? parsedRequest.roomsRequested : 0,
      }
    );

    const preferredRoom = parsedRequest.preferredRoomUnitId
      ? await buildPreferredRoomUnitConflicts(
          env,
          tenantId,
          parsedRequest.propertyId,
          parsedRequest.roomTypeId,
          parsedRequest.preferredRoomUnitId,
          parsedRequest.checkIn,
          parsedRequest.checkOut,
        )
      : { roomUnit: null, conflicts: [] };

    const payload = buildReservationPlanningPayload(availability, conflicts, {
      preferredRoomUnitId: parsedRequest.preferredRoomUnitId,
      preferredRoomUnit: preferredRoom.roomUnit,
      preferredRoomConflicts: preferredRoom.conflicts,
      allotmentConsumption: buildAllotmentConsumptionSummary(activeAllotment, parsedRequest.roomsRequested),
    });

    if (payload.selected_plan) {
      const selectedPlanPricing = await buildSelectedPlanPricingPreview(env, tenantId, parsedRequest.propertyId, {
        checkIn: parsedRequest.checkIn,
        checkOut: parsedRequest.checkOut,
        adults: pricingPreviewRequest.adults,
        children: pricingPreviewRequest.children,
      }, payload.selected_plan, {
        pricingProfileId: pricingPreviewRequest.pricingProfileId,
        scarcityPreview: pricingPreviewRequest.scarcityPreview,
        nightlyRemainingByType: availability.nightlyRemainingByType,
      });
      if (selectedPlanPricing.error) {
        return jsonResponse(selectedPlanPricing.error.payload, selectedPlanPricing.error.status);
      }
      payload.selected_plan_pricing = selectedPlanPricing.pricing;
    } else {
      payload.selected_plan_pricing = null;
    }

    return jsonResponse(payload);
  } catch (error) {
    console.error('[PROPERTY_RESERVATION_PLAN]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

async function buildPreferredRoomUnitExtensionConflicts(env, tenantId, propertyId, roomUnitId, currentCheckOut, proposedCheckOut, excludeReservationId) {
  const roomUnit = await loadRoomUnitById(env, tenantId, propertyId, roomUnitId);
  if (!roomUnit) {
    return [{ conflict_type: 'room_missing', room_unit_id: roomUnitId }];
  }
  const conflicts = [];
  if (['maintenance', 'out_of_order'].includes(String(roomUnit.operational_status || ''))) {
    conflicts.push({
      conflict_type: 'room_unavailable',
      room_unit_id: roomUnit.id,
      room_number: roomUnit.room_number,
      operational_status: roomUnit.operational_status,
    });
  }

  const result = await env.DB
    .prepare(
      `SELECT ra.stay_date, ra.reservation_id, pr.guest_name, pr.status
         FROM reservation_allocations ra
         JOIN property_reservations pr
           ON pr.id = ra.reservation_id
          AND pr.tenant_id = ra.tenant_id
          AND pr.property_id = ra.property_id
        WHERE ra.tenant_id = ?
          AND ra.property_id = ?
          AND ra.room_unit_id = ?
          AND ra.stay_date >= ?
          AND ra.stay_date < ?
          AND ra.reservation_id != ?
          AND ra.allocation_status IN ('soft_allocated', 'locked')
        ORDER BY ra.stay_date ASC`
    )
    .bind(tenantId, propertyId, roomUnitId, currentCheckOut, proposedCheckOut, excludeReservationId)
    .all();

  for (const row of (result.results || [])) {
    conflicts.push({
      conflict_type: 'reservation_overlap',
      room_unit_id: roomUnit.id,
      room_number: roomUnit.room_number,
      stay_date: row.stay_date,
      reservation_id: row.reservation_id,
      reservation_status: row.status,
      guest_name: row.guest_name || null,
    });
  }

  return conflicts;
}

export async function handlePlanPropertyReservationExtension(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);

  const propertyId = String(params?.propertyId || '').trim();
  const reservationId = String(params?.reservationId || '').trim();
  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }

  const proposedCheckOut = String(body?.check_out || '').trim();
  if (!isIsoDate(proposedCheckOut)) return jsonResponse({ error: 'check_out must use YYYY-MM-DD format.' }, 400);

  try {
    const record = await loadPropertyReservation(env, tenantId, propertyId, reservationId);
    if (!record) return jsonResponse({ error: 'Reservation not found.' }, 404);
    if (!['confirmed', 'checked_in'].includes(String(record.reservation.status))) {
      return jsonResponse({ error: 'Extend planning is only supported for confirmed or checked_in reservations.' }, 409);
    }
    if (Number(record.reservation.rooms_requested || 0) !== 1) {
      return jsonResponse({ error: 'Extend planning baseline currently supports rooms_requested = 1 only.' }, 409);
    }
    if (parseDateUtc(proposedCheckOut) <= parseDateUtc(String(record.reservation.check_out || ''))) {
      return jsonResponse({ error: 'check_out must extend beyond the current reservation check_out.' }, 400);
    }

    const availability = await calculateAvailability(
      env,
      tenantId,
      propertyId,
      record.reservation.room_type_id,
      record.reservation.check_in,
      proposedCheckOut,
      Number(record.reservation.rooms_requested || 1),
      { excludeReservationId: reservationId }
    );
    if (availability.error) return jsonResponse(availability.error.payload, availability.error.status);

    const conflicts = await buildReservationPlanningConflicts(
      env,
      tenantId,
      propertyId,
      record.reservation.room_type_id,
      record.reservation.check_in,
      proposedCheckOut,
      { excludeReservationId: reservationId }
    );

    const preferredRoomUnitId = reservationPrimaryRoomUnitId(record);
    const preferredRoomConflicts = preferredRoomUnitId
      ? await buildPreferredRoomUnitExtensionConflicts(
          env,
          tenantId,
          propertyId,
          preferredRoomUnitId,
          record.reservation.check_out,
          proposedCheckOut,
          reservationId,
        )
      : [];

    return jsonResponse({
      ok: true,
      reservation_id: reservationId,
      current_check_out: record.reservation.check_out,
      proposed_check_out: proposedCheckOut,
      preferred_room_unit_id: preferredRoomUnitId,
      in_place_possible: Boolean(preferredRoomUnitId) && preferredRoomConflicts.length === 0,
      preferred_room_conflicts: preferredRoomConflicts,
      planner: buildReservationPlanningPayload(availability, conflicts),
    });
  } catch (error) {
    console.error('[PROPERTY_RESERVATION_EXTEND_PLAN]', error);
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
    let activeAllotment = null;
    let allotmentActor = null;
    if (parsedRequest.allotmentId) {
      const actor = await requireTenantActor(request, env, tenantId);
      if (actor.error) return actor.error;
      allotmentActor = actor.session;

      activeAllotment = await loadPropertyAllotmentById(env, tenantId, parsedRequest.propertyId, parsedRequest.allotmentId);
      const allotmentError = validateAllotmentConsumptionRequest(activeAllotment, parsedRequest);
      if (allotmentError) {
        return jsonResponse({ error: allotmentError }, activeAllotment ? 409 : 404);
      }
    }

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
      {
        excludeHoldId: parsedRequest.holdId,
        preferredRoomUnitId: parsedRequest.preferredRoomUnitId,
        consumeAllotmentId: activeAllotment?.id || null,
        consumeAllotmentRooms: activeAllotment ? parsedRequest.roomsRequested : 0,
      }
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
    const confirmedAt = currentUnixSeconds();
    const frozenPricing = await pricingResolveFrozenReservationPricingSnapshot(env, tenantId, parsedRequest.propertyId, parsedRequest, {
      fallbackSnapshot: parsedRequest.pricingSnapshot,
      frozenAt: confirmedAt,
    }, pricingSnapshotDeps);
    if (frozenPricing.error) return jsonResponse(frozenPricing.error.payload, frozenPricing.error.status);
    parsedRequest.pricingSnapshot = JSON.stringify(frozenPricing.snapshot);
    const artifacts = await createReservationArtifacts(env, tenantId, reservationId, parsedRequest.propertyId, parsedRequest, selectedPlan, confirmedAt);

    if (activeHold) {
      await env.DB
        .prepare(`UPDATE inventory_holds SET status = 'consumed' WHERE id = ? AND tenant_id = ? AND property_id = ? AND status = 'active'`)
        .bind(parsedRequest.holdId, tenantId, parsedRequest.propertyId)
        .run();
    }

    const allotmentConsumption = buildAllotmentConsumptionSummary(activeAllotment, parsedRequest.roomsRequested);
    if (activeAllotment && allotmentConsumption) {
      await env.DB
        .prepare(
          `UPDATE property_allotments
              SET rooms_blocked = ?,
                  status = ?,
                  updated_by = ?,
                  updated_at = ?
            WHERE id = ? AND tenant_id = ? AND property_id = ? AND status = 'active'`
        )
        .bind(
          allotmentConsumption.remaining_rooms_after_commit,
          allotmentConsumption.fully_consumed ? 'released' : 'active',
          allotmentActor?.user_id || null,
          currentUnixSeconds(),
          activeAllotment.id,
          tenantId,
          parsedRequest.propertyId,
        )
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
        assigned_room_unit_id: deriveAssignedRoomUnitId(selectedPlan),
        preferred_room_unit_id: parsedRequest.preferredRoomUnitId,
        preferred_room_honored: parsedRequest.preferredRoomUnitId
          ? Boolean(selectedPlan.segments?.some((segment) => String(segment.room_unit_id || '') === String(parsedRequest.preferredRoomUnitId)))
          : null,
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
      allotment_consumption: allotmentConsumption,
    }, 201);
  } catch (error) {
    console.error('[PROPERTY_RESERVATION_CREATE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleListPropertyReservations(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);

  const propertyId = String(params?.propertyId || '').trim();
  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  const url = new URL(request.url);
  const boardDate = String(url.searchParams.get('board_date') || formatDateUtc(new Date())).trim();
  const status = String(url.searchParams.get('status') || 'all').trim();
  const limit = Number(url.searchParams.get('limit') || 80);

  if (!isIsoDate(boardDate)) return jsonResponse({ error: 'board_date must use YYYY-MM-DD format.' }, 400);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    return jsonResponse({ error: 'limit must be an integer between 1 and 200.' }, 400);
  }

  try {
    const property = await loadPropertyById(env, tenantId, propertyId);
    if (!property) return jsonResponse({ error: 'Property not found.' }, 404);

    const clauses = [
      'pr.tenant_id = ?',
      'pr.property_id = ?',
      'pr.check_in <= ?',
      'pr.check_out >= ?',
    ];
    const values = [tenantId, propertyId, boardDate, boardDate];
    if (status && status !== 'all') {
      clauses.push('pr.status = ?');
      values.push(status);
    }

    const sql = `SELECT pr.id, pr.property_id, pr.source, pr.status,
                        pr.guest_name, pr.guest_email, pr.guest_phone,
                        pr.check_in, pr.check_out, pr.room_type_id, pr.assigned_room_unit_id, pr.guest_photo_key,
                        aru.room_number AS assigned_room_number,
                        pr.rooms_requested,
                        pr.adults, pr.children, pr.pricing_snapshot,
                        pr.confirmed_at, pr.cancelled_at, pr.cancel_reason,
                        pr.created_at, pr.updated_at,
                        rt.code AS room_type_code,
                        rt.name AS room_type_name,
                        (
                          SELECT GROUP_CONCAT(DISTINCT rss.room_unit_id)
                            FROM reservation_stay_plan_segments rss
                            JOIN reservation_stay_plans rsp
                              ON rsp.id = rss.stay_plan_id
                             AND rsp.tenant_id = rss.tenant_id
                             AND rsp.property_id = rss.property_id
                           WHERE rss.tenant_id = pr.tenant_id
                             AND rss.property_id = pr.property_id
                             AND rss.reservation_id = pr.id
                             AND rsp.is_selected = 1
                        ) AS allocated_room_unit_ids,
                        (
                          SELECT GROUP_CONCAT(DISTINCT ru2.room_number)
                            FROM reservation_stay_plan_segments rss
                            JOIN reservation_stay_plans rsp
                              ON rsp.id = rss.stay_plan_id
                             AND rsp.tenant_id = rss.tenant_id
                             AND rsp.property_id = rss.property_id
                            LEFT JOIN room_units ru2
                              ON ru2.id = rss.room_unit_id
                             AND ru2.tenant_id = rss.tenant_id
                             AND ru2.property_id = rss.property_id
                           WHERE rss.tenant_id = pr.tenant_id
                             AND rss.property_id = pr.property_id
                             AND rss.reservation_id = pr.id
                             AND rsp.is_selected = 1
                        ) AS allocated_room_numbers
                   FROM property_reservations pr
                   LEFT JOIN room_types rt
                     ON rt.id = pr.room_type_id
                    AND rt.tenant_id = pr.tenant_id
                    AND rt.property_id = pr.property_id
                   LEFT JOIN room_units aru
                     ON aru.id = pr.assigned_room_unit_id
                    AND aru.tenant_id = pr.tenant_id
                    AND aru.property_id = pr.property_id
                  WHERE ${clauses.join(' AND ')}
                  ORDER BY CASE
                             WHEN pr.check_in = ? THEN 0
                             WHEN pr.check_out = ? THEN 1
                             ELSE 2
                           END,
                           pr.check_in ASC,
                           pr.check_out ASC,
                           pr.created_at DESC
                  LIMIT ?`;

    const result = await env.DB.prepare(sql).bind(...values, boardDate, boardDate, limit).all();
    return jsonResponse({
      ok: true,
      property_id: propertyId,
      board_date: boardDate,
      reservations: (result.results || []).map((row) => buildReservationBoardSummary(row, boardDate)),
    });
  } catch (error) {
    console.error('[PROPERTY_RESERVATION_LIST]', error);
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

async function assignReservationToRoomUnit(env, tenantId, propertyId, reservationId, record, assignedRoomUnitId, actorUserId) {
  if (Number(record?.reservation?.rooms_requested || 0) !== 1) {
    return { error: 'Room assignment baseline currently supports rooms_requested = 1 only.' };
  }
  if (!record?.stayPlan || !Array.isArray(record?.segments) || record.segments.length !== 1) {
    return { error: 'Room assignment currently supports one-segment stays only.' };
  }

  if (!assignedRoomUnitId) {
    await env.DB
      .prepare(
        `UPDATE property_reservations
            SET assigned_room_unit_id = NULL,
                updated_at = ?
          WHERE id = ? AND tenant_id = ? AND property_id = ?`
      )
      .bind(currentUnixSeconds(), reservationId, tenantId, propertyId)
      .run();
    await recordPropertyReservationEvent(env, tenantId, propertyId, reservationId, 'room_assignment', record.reservation.status, record.reservation.status, {
      previous_room_unit_id: record.reservation.assigned_room_unit_id || null,
      next_room_unit_id: null,
      cleared: true,
    }, actorUserId);
    return { ok: true };
  }

  const roomUnit = await loadRoomUnitById(env, tenantId, propertyId, assignedRoomUnitId);
  if (!roomUnit) return { error: 'Assigned room unit not found.' };
  if (!roomUnit.active) return { error: 'Assigned room unit must be active.' };
  if (['maintenance', 'out_of_order'].includes(String(roomUnit.operational_status))) {
    return { error: 'Assigned room unit is not available for assignment.' };
  }

  const allowedRoomTypeIds = new Set((record.segments || []).map((segment) => String(segment.room_type_id)).filter(Boolean));
  if (!allowedRoomTypeIds.size) allowedRoomTypeIds.add(String(record.reservation.room_type_id));
  if (!allowedRoomTypeIds.has(String(roomUnit.room_type_id))) {
    return { error: 'Assigned room unit must belong to the reservation stay-plan room type.' };
  }

  const stayDates = enumerateStayDates(record.segments[0].check_in, record.segments[0].check_out);
  if (!stayDates.length) return { error: 'Reservation stay dates are invalid for assignment.' };

  const placeholders = stayDates.map(() => '?').join(', ');
  const conflict = await env.DB
    .prepare(
      `SELECT id
         FROM reservation_allocations
        WHERE tenant_id = ?
          AND property_id = ?
          AND room_unit_id = ?
          AND reservation_id != ?
          AND allocation_status IN ('soft_allocated', 'locked')
          AND stay_date IN (${placeholders})
        LIMIT 1`
    )
    .bind(tenantId, propertyId, assignedRoomUnitId, reservationId, ...stayDates)
    .first();
  if (conflict) return { error: 'Assigned room unit is already occupied for part of this stay.' };

  const now = currentUnixSeconds();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE property_reservations
          SET assigned_room_unit_id = ?,
              updated_at = ?
        WHERE id = ? AND tenant_id = ? AND property_id = ?`
    ).bind(assignedRoomUnitId, now, reservationId, tenantId, propertyId),
    env.DB.prepare(
      `UPDATE reservation_stay_plan_segments
          SET room_unit_id = ?
        WHERE tenant_id = ?
          AND property_id = ?
          AND reservation_id = ?
          AND stay_plan_id = ?`
    ).bind(assignedRoomUnitId, tenantId, propertyId, reservationId, record.stayPlan.id),
    env.DB.prepare(
      `UPDATE reservation_allocations
          SET room_unit_id = ?,
              updated_at = ?
        WHERE tenant_id = ?
          AND property_id = ?
          AND reservation_id = ?
          AND stay_plan_id = ?
          AND allocation_status IN ('soft_allocated', 'locked')`
    ).bind(assignedRoomUnitId, now, tenantId, propertyId, reservationId, record.stayPlan.id),
  ]);

  await recordPropertyReservationEvent(env, tenantId, propertyId, reservationId, 'room_assignment', record.reservation.status, record.reservation.status, {
    previous_room_unit_id: record.reservation.assigned_room_unit_id || null,
    next_room_unit_id: assignedRoomUnitId,
    next_room_number: roomUnit.room_number,
  }, actorUserId);
  return { ok: true };
}

export async function handleUpdatePropertyReservationAssignment(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);

  const propertyId = String(params?.propertyId || '').trim();
  const reservationId = String(params?.reservationId || '').trim();
  const actor = await requireTenantActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validateReservationRoomAssignmentRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const record = await loadPropertyReservation(env, tenantId, propertyId, reservationId);
    if (!record) return jsonResponse({ error: 'Reservation not found.' }, 404);
    if (!['confirmed', 'checked_in'].includes(String(record.reservation.status))) {
      return jsonResponse({ error: 'Room assignment is only supported for confirmed or checked_in reservations.' }, 409);
    }

    const assignment = await assignReservationToRoomUnit(env, tenantId, propertyId, reservationId, record, parsed.assignedRoomUnitId, request.headers.get('X-User-ID')?.trim() || null);
    if (assignment.error) return jsonResponse({ error: assignment.error }, 409);

    const updatedRecord = await loadPropertyReservation(env, tenantId, propertyId, reservationId);
    return jsonResponse({
      ...buildReservationPayload(updatedRecord),
      assignment_updated: true,
    });
  } catch (error) {
    console.error('[PROPERTY_RESERVATION_ASSIGNMENT_UPDATE]', error);
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

    await recordPropertyReservationEvent(env, tenantId, propertyId, reservationId, 'cancel', record.reservation.status, 'cancelled', {
      cancel_reason: cancelReason,
    }, cancelledBy);

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
    const frozenPricing = await pricingResolveFrozenReservationPricingSnapshot(env, tenantId, propertyId, parsedRequest, {
      fallbackSnapshot: parsedRequest.pricingSnapshot,
      frozenAt: now,
    }, pricingSnapshotDeps);
    if (frozenPricing.error) return jsonResponse(frozenPricing.error.payload, frozenPricing.error.status);
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
        JSON.stringify(frozenPricing.snapshot),
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

    await recordPropertyReservationEvent(env, tenantId, propertyId, reservationId, 'rebook', record.reservation.status, record.reservation.status, {
      previous_check_in: record.reservation.check_in,
      previous_check_out: record.reservation.check_out,
      next_check_in: parsedRequest.checkIn,
      next_check_out: parsedRequest.checkOut,
      previous_room_type_id: record.reservation.room_type_id,
      next_room_type_id: parsedRequest.roomTypeId,
    }, request.headers.get('X-User-ID')?.trim() || null);

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

  let body = {};
  try {
    if ((request.headers.get('content-type') || '').includes('application/json')) {
      body = await parseJsonBody(request);
    }
  } catch {
    return jsonResponse({ error: 'Request body is not valid JSON.' }, 400);
  }

  try {
    const record = await loadPropertyReservation(env, tenantId, propertyId, reservationId);
    if (!record) return jsonResponse({ error: 'Reservation not found.' }, 404);
    const statusError = validateReservationStatusTransition(record, ['confirmed'], 'Check-in');
    if (statusError) return jsonResponse({ error: statusError.error }, 409);

    await env.DB
      .prepare(`UPDATE property_reservations SET status = 'checked_in', updated_at = ? WHERE id = ? AND tenant_id = ? AND property_id = ?`)
      .bind(currentUnixSeconds(), reservationId, tenantId, propertyId)
      .run();

    if (Object.prototype.hasOwnProperty.call(body || {}, 'assigned_room_unit_id')) {
      const parsedAssignment = validateReservationRoomAssignmentRequest(body);
      if (parsedAssignment.error) return jsonResponse({ error: parsedAssignment.error }, 400);
      const assignment = await assignReservationToRoomUnit(env, tenantId, propertyId, reservationId, record, parsedAssignment.assignedRoomUnitId, request.headers.get('X-User-ID')?.trim() || null);
      if (assignment.error) return jsonResponse({ error: assignment.error }, 409);
    }

    await recordPropertyReservationEvent(env, tenantId, propertyId, reservationId, 'check_in', 'confirmed', 'checked_in', null, request.headers.get('X-User-ID')?.trim() || null);

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

    const roomUnitId = reservationPrimaryRoomUnitId(record);
    if (roomUnitId) {
      await recordRoomStateEvent(env, tenantId, propertyId, roomUnitId, 'dirty', {
        reservationId,
        note: `Auto-dirty on check-out ${record.reservation.check_out}`,
        changedBy: request.headers.get('X-User-ID')?.trim() || null,
      });
      await ensureHousekeepingTaskForTurnover(env, tenantId, propertyId, roomUnitId, reservationId, record.reservation.check_out, request.headers.get('X-User-ID')?.trim() || null);
    }

    await recordPropertyReservationEvent(env, tenantId, propertyId, reservationId, 'check_out', 'checked_in', 'checked_out', {
      effective_check_out: record.reservation.check_out,
    }, request.headers.get('X-User-ID')?.trim() || null);

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

    const roomUnitId = reservationPrimaryRoomUnitId(record);
    if (roomUnitId) {
      await recordRoomStateEvent(env, tenantId, propertyId, roomUnitId, 'dirty', {
        reservationId,
        note: `Auto-dirty on early check-out ${parsed.effectiveCheckOut}`,
        changedBy: request.headers.get('X-User-ID')?.trim() || null,
      });
      await ensureHousekeepingTaskForTurnover(env, tenantId, propertyId, roomUnitId, reservationId, parsed.effectiveCheckOut, request.headers.get('X-User-ID')?.trim() || null);
    }

    await recordPropertyReservationEvent(env, tenantId, propertyId, reservationId, 'early_check_out', 'checked_in', 'checked_out', {
      previous_check_out: record.reservation.check_out,
      effective_check_out: parsed.effectiveCheckOut,
    }, request.headers.get('X-User-ID')?.trim() || null);

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

    await recordPropertyReservationEvent(env, tenantId, propertyId, reservationId, 'no_show', 'confirmed', 'no_show', {
      check_in: record.reservation.check_in,
      check_out: record.reservation.check_out,
    }, request.headers.get('X-User-ID')?.trim() || null);

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
      await recordPropertyReservationEvent(env, tenantId, propertyId, reservationId, 'undo_status', 'checked_in', 'confirmed', {
        undone_from: 'checked_in',
      }, request.headers.get('X-User-ID')?.trim() || null);
      const updatedRecord = await loadPropertyReservation(env, tenantId, propertyId, reservationId);
      return jsonResponse({
        ...buildReservationPayload(updatedRecord),
        undone_from: 'checked_in',
      });
    }

    if (record.reservation.status === 'checked_out') {
      const latestEarlyCheckOutEvent = (record.events || []).find((event) => event.action === 'early_check_out' && event.payload?.previous_check_out) || null;
      if (latestEarlyCheckOutEvent) {
        const restoredCheckOut = String(latestEarlyCheckOutEvent.payload.previous_check_out);
        const availability = await calculateAvailability(
          env,
          tenantId,
          propertyId,
          record.reservation.room_type_id,
          record.reservation.check_in,
          restoredCheckOut,
          record.reservation.rooms_requested,
          { excludeReservationId: reservationId }
        );
        if (availability.error) return jsonResponse(availability.error.payload, availability.error.status);
        if (availability.shortageDates.length) {
          return jsonResponse({
            error: 'Inventory is no longer available to undo the early check-out.',
            availability: buildAvailabilityPayload(availability).availability,
          }, 409);
        }

        const selectedPlan = selectBestPlan(availability);
        if (!selectedPlan || !selectedPlan.segments?.length || selectedPlan.segments.some((segment) => !segment.room_unit_id)) {
          return jsonResponse({ error: 'No concrete allocation plan is available to restore this checked-out reservation.' }, 409);
        }

        await discardReservationStayPlanState(env, tenantId, propertyId, reservationId);
        await env.DB
          .prepare(`UPDATE property_reservations SET status = 'checked_in', check_out = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND property_id = ?`)
          .bind(restoredCheckOut, currentUnixSeconds(), reservationId, tenantId, propertyId)
          .run();
        await attachSelectedStayPlanArtifacts(env, tenantId, reservationId, propertyId, selectedPlan);
        await recordPropertyReservationEvent(env, tenantId, propertyId, reservationId, 'undo_status', 'checked_out', 'checked_in', {
          undone_from: 'early_check_out',
          restored_check_out: restoredCheckOut,
        }, request.headers.get('X-User-ID')?.trim() || null);

        const updatedRecord = await loadPropertyReservation(env, tenantId, propertyId, reservationId);
        return jsonResponse({
          ...buildReservationPayload(updatedRecord),
          undone_from: 'early_check_out',
        });
      }

      await env.DB
        .prepare(`UPDATE property_reservations SET status = 'checked_in', updated_at = ? WHERE id = ? AND tenant_id = ? AND property_id = ?`)
        .bind(currentUnixSeconds(), reservationId, tenantId, propertyId)
        .run();
      await recordPropertyReservationEvent(env, tenantId, propertyId, reservationId, 'undo_status', 'checked_out', 'checked_in', {
        undone_from: 'checked_out',
      }, request.headers.get('X-User-ID')?.trim() || null);
      const updatedRecord = await loadPropertyReservation(env, tenantId, propertyId, reservationId);
      return jsonResponse({
        ...buildReservationPayload(updatedRecord),
        undone_from: 'checked_out',
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
      await recordPropertyReservationEvent(env, tenantId, propertyId, reservationId, 'undo_status', 'no_show', 'confirmed', {
        undone_from: 'no_show',
      }, request.headers.get('X-User-ID')?.trim() || null);

      const updatedRecord = await loadPropertyReservation(env, tenantId, propertyId, reservationId);
      return jsonResponse({
        ...buildReservationPayload(updatedRecord),
        undone_from: 'no_show',
      });
    }

    return jsonResponse({ error: 'Undo is only supported for checked_in, checked_out, and no_show reservations in this baseline.' }, 409);
  } catch (error) {
    console.error('[PROPERTY_RESERVATION_UNDO_STATUS]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleDeleteProperty(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;
  try {
    const existing = await loadPropertyById(env, tenantId, propertyId);
    if (!existing) return jsonResponse({ error: 'Property not found.' }, 404);
    await env.DB.prepare('DELETE FROM properties WHERE id = ? AND tenant_id = ?').bind(propertyId, tenantId).run();
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('[PROPERTY_DELETE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleDeleteRoomType(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const roomTypeId = String(params?.roomTypeId || '').trim();
  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;
  try {
    const existing = await loadRoomTypeById(env, tenantId, propertyId, roomTypeId);
    if (!existing) return jsonResponse({ error: 'Room type not found.' }, 404);
    await env.DB.prepare('DELETE FROM room_types WHERE id = ? AND tenant_id = ? AND property_id = ?').bind(roomTypeId, tenantId, propertyId).run();
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('[ROOM_TYPE_DELETE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleDeleteRoomUnit(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const roomUnitId = String(params?.roomUnitId || '').trim();
  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;
  try {
    const existing = await loadRoomUnitById(env, tenantId, propertyId, roomUnitId);
    if (!existing) return jsonResponse({ error: 'Room unit not found.' }, 404);
    await env.DB.prepare('DELETE FROM room_units WHERE id = ? AND tenant_id = ? AND property_id = ?').bind(roomUnitId, tenantId, propertyId).run();
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('[ROOM_UNIT_DELETE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleDeletePropertyPricingProfile(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const pricingProfileId = String(params?.pricingProfileId || '').trim();
  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;
  try {
    const existing = await loadPropertyPricingProfileById(env, tenantId, propertyId, pricingProfileId);
    if (!existing) return jsonResponse({ error: 'Pricing profile not found.' }, 404);
    await env.DB.prepare('DELETE FROM property_pricing_profiles WHERE id = ? AND tenant_id = ? AND property_id = ?').bind(pricingProfileId, tenantId, propertyId).run();
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('[PROPERTY_PRICING_PROFILE_DELETE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleDeletePropertyWeekdayPricingRule(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const weekdayPricingRuleId = String(params?.weekdayPricingRuleId || '').trim();
  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;
  try {
    const existing = await loadPropertyWeekdayPricingRuleById(env, tenantId, propertyId, weekdayPricingRuleId);
    if (!existing) return jsonResponse({ error: 'Weekday pricing rule not found.' }, 404);
    await env.DB.prepare('DELETE FROM property_weekday_pricing_rules WHERE id = ? AND tenant_id = ? AND property_id = ?').bind(weekdayPricingRuleId, tenantId, propertyId).run();
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('[PROPERTY_WEEKDAY_PRICING_RULE_DELETE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleDeleteRoomRate(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const roomRateId = String(params?.roomRateId || '').trim();
  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;
  try {
    const existing = await loadRoomRateById(env, tenantId, propertyId, roomRateId);
    if (!existing) return jsonResponse({ error: 'Room rate not found.' }, 404);
    await env.DB.prepare('DELETE FROM property_room_rates WHERE id = ? AND tenant_id = ? AND property_id = ?').bind(roomRateId, tenantId, propertyId).run();
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('[ROOM_RATE_DELETE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleDeletePropertyAddonServicePreset(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const presetId = String(params?.presetId || '').trim();
  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;
  try {
    const existing = await loadAddonServicePresetById(env, tenantId, propertyId, presetId);
    if (!existing) return jsonResponse({ error: 'Addon service preset not found.' }, 404);
    await env.DB.prepare('DELETE FROM property_addon_service_presets WHERE id = ? AND tenant_id = ? AND property_id = ?').bind(presetId, tenantId, propertyId).run();
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('[ADDON_PRESET_DELETE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleDeleteRateSeason(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const seasonId = String(params?.seasonId || '').trim();
  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;
  try {
    const existing = await loadRateSeasonById(env, tenantId, propertyId, seasonId);
    if (!existing) return jsonResponse({ error: 'Rate season not found.' }, 404);
    await env.DB.prepare('DELETE FROM property_rate_seasons WHERE id = ? AND tenant_id = ? AND property_id = ?').bind(seasonId, tenantId, propertyId).run();
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('[RATE_SEASON_DELETE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleDeleteSeasonRoomRate(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const seasonRoomRateId = String(params?.seasonRoomRateId || '').trim();
  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;
  try {
    const existing = await loadSeasonRoomRateById(env, tenantId, propertyId, seasonRoomRateId);
    if (!existing) return jsonResponse({ error: 'Season room rate not found.' }, 404);
    await env.DB.prepare('DELETE FROM property_room_rate_season_prices WHERE id = ? AND tenant_id = ? AND property_id = ?').bind(seasonRoomRateId, tenantId, propertyId).run();
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('[SEASON_ROOM_RATE_DELETE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}