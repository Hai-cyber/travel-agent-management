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
  mapPropertyAllotmentAllocationRow,
  mapPropertyAllotmentDeferredGuestChargeRow,
  mapPropertyAllotmentMasterFolioRow,
  mapPropertyAllotmentMasterFolioLineRow,
  mapPropertyAllotmentRoomingListEntryRow,
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
import { createPlanningHandlers } from './properties/planning-handlers.js';
import { createFolioHousekeepingHandlers } from './properties/folio-housekeeping-handlers.js';
import { createPricingHandlers } from './properties/pricing-handlers.js';
import { createReservationHandlers } from './properties/reservation-handlers.js';
import {
  buildResolvedRateQuotePayload as pricingBuildResolvedRateQuotePayload,
  resolvePropertyRateQuote as pricingResolvePropertyRateQuote,
  resolveSnapshotNightlyRate as pricingResolveSnapshotNightlyRate,
} from './properties/pricing.js';
import {
  loadPropertyReservation as reservationLoadPropertyReservation,
} from './properties/reservations.js';
import {
  validateAddonServicePresetCreateRequest,
  validateAddonServicePresetPatchRequest,
  validateAvailabilityRequest,
  validateEarlyCheckoutRequest,
  validateFolioChargeRequest,
  validateFolioPaymentRequest,
  validateHousekeepingTaskPatchRequest,
  validatePlannerPricingPreviewRequest,
  validatePropertyAllotmentAllocateRequest,
  validatePropertyAllotmentChargeRoutingRequest,
  validatePropertyAllotmentCreateRequest,
  validatePropertyAllotmentMasterFolioPatchRequest,
  validatePropertyAllotmentReworkPreviewRequest,
  validatePropertyAllotmentRoomingListPatchRequest,
  validatePropertyAllotmentPatchRequest,
  validatePropertyAllotmentSplitRequest,
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
  validateReservationPatchRequest,
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

const pricingDeps = {
  loadPropertyById,
  loadPropertyPricingProfileById,
  loadRoomTypeById,
};

const availabilityDeps = {
  loadRoomUnitById,
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

async function recordPropertyAllotmentEvent(env, tenantId, propertyId, allotmentId, action, fromStatus, toStatus, payload = null, actorUserId = null) {
  await env.DB
    .prepare(
      `INSERT INTO property_allotment_events
        (id, tenant_id, property_id, allotment_id, action, from_status, to_status, actor_user_id, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      nanoid(),
      tenantId,
      propertyId,
      allotmentId,
      action,
      fromStatus,
      toStatus,
      actorUserId,
      payload ? JSON.stringify(payload) : null,
      currentUnixSeconds(),
    )
    .run();
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

const planningHandlers = createPlanningHandlers({
  availabilityDeps,
  jsonResponse,
  loadActiveHold,
  loadPropertyAllotmentById,
  loadPropertyById,
  loadRoomUnitById,
  parseJsonBody,
  pricingDeps,
  requireTenantActor,
  resolveTenantId,
  validateAllotmentConsumptionRequest,
  validateAvailabilityRequest,
  validatePlannerPricingPreviewRequest,
});

const reservationHandlers = createReservationHandlers({
  buildReservationGuestPhotoKey,
  detectFileExtension,
  ensureHousekeepingTaskForTurnover,
  imageResponse,
  jsonResponse,
  loadActiveHold,
  loadPropertyAllotmentById,
  loadPropertyById,
  loadRoomUnitById,
  parseJsonBody,
  pricingDeps,
  recordRoomStateEvent,
  requireTenantActor,
  resolveTenantId,
  validateAllotmentConsumptionRequest,
  validateEarlyCheckoutRequest,
  validateReservationCreateRequest,
  validateReservationPatchRequest,
  validateReservationRebookRequest,
  validateReservationRoomAssignmentRequest,
});

const folioHousekeepingHandlers = createFolioHousekeepingHandlers({
  PROPERTY_ROLE_RANK,
  buildDynamicUpdateSql,
  buildReservationFolioPayload,
  ensureReservationFolio,
  ensureReservationNightAuditCharge,
  housekeepingStateFromTaskStatus,
  jsonResponse,
  loadHousekeepingTasks,
  loadLatestRoomStatesByUnitIds,
  loadPropertyById,
  parseJsonBody,
  recordRoomStateEvent,
  requireManagerActor,
  requireTenantActor,
  reservationLoadPropertyReservation,
  resolveEffectiveHousekeepingRoomState,
  resolveReservationNightlyRate,
  resolveTenantId,
  syncHousekeepingTasksForProperty,
  validateFolioChargeRequest,
  validateFolioPaymentRequest,
  validateHousekeepingTaskPatchRequest,
});

const pricingHandlers = createPricingHandlers({
  DEFAULT_PROPERTY_ADDON_PRESETS,
  buildDynamicUpdateSql,
  jsonResponse,
  loadAddonServicePresetById,
  loadPropertyById,
  loadPropertyPricingProfileById,
  loadPropertyWeekdayPricingRuleById,
  loadRateSeasonById,
  loadRoomRateById,
  loadRoomTypeById,
  loadSeasonRoomRateById,
  mapAddonServicePresetRow,
  mapBuilderSqlError,
  mapPropertyPricingProfileRow,
  mapPropertyWeekdayPricingRuleRow,
  mapRateSeasonRow,
  mapRoomRateRow,
  mapSeasonRateRow,
  parseJsonBody,
  pricingBuildResolvedRateQuotePayload,
  pricingDeps,
  pricingResolvePropertyRateQuote,
  requireManagerActor,
  requireTenantActor,
  resolveTenantId,
  serializeAddonConfigJson,
  validateAddonServicePresetCreateRequest,
  validateAddonServicePresetPatchRequest,
  validatePropertyPricingProfileConfiguration,
  validatePropertyPricingProfileCreateRequest,
  validatePropertyPricingProfilePatchRequest,
  validatePropertyWeekdayPricingRuleCreateRequest,
  validatePropertyWeekdayPricingRulePatchRequest,
  validateRateQuoteRequest,
  validateRateSeasonCreateRequest,
  validateRateSeasonPatchRequest,
  validateRoomRateCreateRequest,
  validateRoomRatePatchRequest,
  validateSeasonRoomRateCreateRequest,
  validateSeasonRoomRatePatchRequest,
});

function rangesOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
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
              pa.source_ref, pa.check_in, pa.check_out, pa.rooms_blocked, pa.roh_capacity_filter, pa.release_date, pa.status,
              pa.notes, pa.created_by, pa.updated_by, pa.created_at, pa.updated_at,
              rt.code AS room_type_code, rt.name AS room_type_name,
              CASE
                WHEN pa.status IN ('draft', 'active', 'allocated') AND (pa.release_date IS NULL OR pa.release_date >= ?) THEN 1
                WHEN pa.status IN ('confirmed', 'in_house') THEN 1
                ELSE 0
              END AS inventory_blocking,
              CASE
                WHEN pa.status IN ('confirmed', 'in_house', 'released', 'cancelled', 'expired') THEN 0
                WHEN pa.release_date IS NOT NULL THEN 1
                ELSE 0
              END AS auto_release_enabled,
              CASE
                WHEN pa.status IN ('confirmed', 'in_house') THEN 'locked'
                WHEN pa.status IN ('released', 'cancelled', 'expired') THEN 'closed'
                WHEN pa.release_date IS NULL THEN 'none'
                WHEN pa.release_date < ? THEN 'overdue'
                WHEN pa.release_date = ? THEN 'due_today'
                ELSE 'scheduled'
              END AS auto_release_state
         FROM property_allotments pa
         LEFT JOIN room_types rt
           ON rt.id = pa.room_type_id
          AND rt.tenant_id = pa.tenant_id
          AND rt.property_id = pa.property_id
        WHERE pa.id = ? AND pa.tenant_id = ? AND pa.property_id = ?`
    )
    .bind(todayIso, todayIso, todayIso, allotmentId, tenantId, propertyId)
    .first();
  return row ? mapPropertyAllotmentRow(row) : null;
}

async function listPropertyAllotmentsInRange(env, tenantId, propertyId, fromDate, toDate, status = 'all') {
  const todayIso = formatDateUtc(new Date());
  let sql = `SELECT pa.id, pa.tenant_id, pa.property_id, pa.room_type_id, pa.operator_name, pa.operator_code,
                    pa.source_ref, pa.check_in, pa.check_out, pa.rooms_blocked, pa.roh_capacity_filter, pa.release_date, pa.status,
                    pa.notes, pa.created_by, pa.updated_by, pa.created_at, pa.updated_at,
                    rt.code AS room_type_code, rt.name AS room_type_name,
                    CASE
                      WHEN pa.status IN ('draft', 'active', 'allocated') AND (pa.release_date IS NULL OR pa.release_date >= ?) THEN 1
                      WHEN pa.status IN ('confirmed', 'in_house') THEN 1
                      ELSE 0
                    END AS inventory_blocking,
                    CASE
                      WHEN pa.status IN ('confirmed', 'in_house', 'released', 'cancelled', 'expired') THEN 0
                      WHEN pa.release_date IS NOT NULL THEN 1
                      ELSE 0
                    END AS auto_release_enabled,
                    CASE
                      WHEN pa.status IN ('confirmed', 'in_house') THEN 'locked'
                      WHEN pa.status IN ('released', 'cancelled', 'expired') THEN 'closed'
                      WHEN pa.release_date IS NULL THEN 'none'
                      WHEN pa.release_date < ? THEN 'overdue'
                      WHEN pa.release_date = ? THEN 'due_today'
                      ELSE 'scheduled'
                    END AS auto_release_state
               FROM property_allotments pa
               LEFT JOIN room_types rt
                 ON rt.id = pa.room_type_id
                AND rt.tenant_id = pa.tenant_id
                AND rt.property_id = pa.property_id
              WHERE pa.tenant_id = ?
                AND pa.property_id = ?
                AND pa.check_in < ?
                AND pa.check_out > ?`;
  const binds = [todayIso, todayIso, todayIso, tenantId, propertyId, toDate, fromDate];
  if (status !== 'all') {
    sql += ` AND pa.status = ?`;
    binds.push(status);
  }
  sql += ` ORDER BY pa.check_in ASC, pa.operator_name ASC, pa.room_type_id ASC`;
  const result = await env.DB.prepare(sql).bind(...binds).all();
  return (result.results || []).map(mapPropertyAllotmentRow);
}

async function autoReleaseExpiredAllotmentsForProperty(env, tenantId, propertyId, localDate, actorUserId = 'system:auto_release') {
  const result = await env.DB
    .prepare(
      `SELECT id
         FROM property_allotments
        WHERE tenant_id = ?
          AND property_id = ?
          AND status IN ('draft', 'active', 'allocated')
          AND release_date IS NOT NULL
          AND release_date < ?`
    )
    .bind(tenantId, propertyId, localDate)
    .all();

  let releasedCount = 0;
  const now = currentUnixSeconds();
  for (const row of (result.results || [])) {
    const allotmentId = String(row.id || '').trim();
    if (!allotmentId) continue;
    const existing = await loadPropertyAllotmentById(env, tenantId, propertyId, allotmentId);
    if (!existing) continue;
    const activeAllocations = await listActivePropertyAllotmentAllocations(env, tenantId, propertyId, allotmentId);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE property_allotment_allocations
            SET allocation_status = 'released',
                released_reason = 'auto_release_policy',
                updated_by = ?,
                updated_at = ?
          WHERE tenant_id = ?
            AND property_id = ?
            AND allotment_id = ?
            AND allocation_status = 'allocated'`
      ).bind(actorUserId, now, tenantId, propertyId, allotmentId),
      env.DB.prepare(
        `UPDATE property_allotments
            SET status = 'expired',
                updated_by = ?,
                updated_at = ?
          WHERE id = ?
            AND tenant_id = ?
            AND property_id = ?
            AND status IN ('draft', 'active', 'allocated')`
      ).bind(actorUserId, now, allotmentId, tenantId, propertyId),
    ]);
    await recordPropertyAllotmentEvent(env, tenantId, propertyId, allotmentId, 'allotment_auto_released', existing.status, 'expired', {
      released_by_policy: true,
      release_reason: 'auto_release_policy',
      release_date: existing.release_date || null,
      released_allocations: activeAllocations.length,
      room_unit_ids: activeAllocations.map((allocation) => allocation.room_unit_id),
      actor_type: 'system',
    }, null);
    releasedCount += 1;
  }
  return releasedCount;
}

async function listPropertyAllotmentAllocationsInRange(env, tenantId, propertyId, fromDate, toDate, allocationStatus = 'all') {
  let sql = `SELECT paa.id, paa.tenant_id, paa.property_id, paa.allotment_id, paa.room_type_id, paa.room_unit_id,
                    paa.operator_name, paa.check_in, paa.check_out, paa.allocation_status, paa.allocation_source,
                    paa.released_reason, paa.created_by, paa.updated_by, paa.created_at, paa.updated_at,
                    ru.room_number, ru.floor_label,
                    rt.code AS room_type_code, rt.name AS room_type_name,
                    pa.roh_capacity_filter, pa.status AS allotment_status
               FROM property_allotment_allocations paa
               JOIN property_allotments pa
                 ON pa.id = paa.allotment_id
                AND pa.tenant_id = paa.tenant_id
                AND pa.property_id = paa.property_id
               JOIN room_units ru
                 ON ru.id = paa.room_unit_id
                AND ru.tenant_id = paa.tenant_id
                AND ru.property_id = paa.property_id
               LEFT JOIN room_types rt
                 ON rt.id = paa.room_type_id
                AND rt.tenant_id = paa.tenant_id
                AND rt.property_id = paa.property_id
              WHERE paa.tenant_id = ?
                AND paa.property_id = ?
                AND paa.check_in < ?
                AND paa.check_out > ?`;
  const binds = [tenantId, propertyId, toDate, fromDate];
  if (allocationStatus !== 'all') {
    sql += ' AND paa.allocation_status = ?';
    binds.push(allocationStatus);
  }
  sql += ' ORDER BY paa.check_in ASC, ru.floor_label ASC, ru.room_number ASC';
  const result = await env.DB.prepare(sql).bind(...binds).all();
  return (result.results || []).map(mapPropertyAllotmentAllocationRow);
}

async function listActivePropertyAllotmentAllocations(env, tenantId, propertyId, allotmentId) {
  const result = await env.DB
    .prepare(
      `SELECT paa.id, paa.tenant_id, paa.property_id, paa.allotment_id, paa.room_type_id, paa.room_unit_id,
              paa.operator_name, paa.check_in, paa.check_out, paa.allocation_status, paa.allocation_source,
              paa.released_reason, paa.created_by, paa.updated_by, paa.created_at, paa.updated_at,
              ru.room_number, ru.floor_label,
              rt.code AS room_type_code, rt.name AS room_type_name,
              pa.roh_capacity_filter
         FROM property_allotment_allocations paa
         JOIN property_allotments pa
           ON pa.id = paa.allotment_id
          AND pa.tenant_id = paa.tenant_id
          AND pa.property_id = paa.property_id
         JOIN room_units ru
           ON ru.id = paa.room_unit_id
          AND ru.tenant_id = paa.tenant_id
          AND ru.property_id = paa.property_id
         LEFT JOIN room_types rt
           ON rt.id = paa.room_type_id
          AND rt.tenant_id = paa.tenant_id
          AND rt.property_id = paa.property_id
        WHERE paa.tenant_id = ?
          AND paa.property_id = ?
          AND paa.allotment_id = ?
          AND paa.allocation_status = 'allocated'
        ORDER BY ru.floor_label ASC, ru.room_number ASC`
    )
    .bind(tenantId, propertyId, allotmentId)
    .all();
  return (result.results || []).map(mapPropertyAllotmentAllocationRow);
}

async function listPropertyAllotmentEvents(env, tenantId, propertyId, allotmentId, limit = 50) {
  const result = await env.DB
    .prepare(
      `SELECT id, tenant_id, property_id, allotment_id, action, from_status, to_status, actor_user_id, payload_json, created_at
         FROM property_allotment_events
        WHERE tenant_id = ?
          AND property_id = ?
          AND allotment_id = ?
        ORDER BY created_at DESC
        LIMIT ?`
    )
    .bind(tenantId, propertyId, allotmentId, limit)
    .all();
  return (result.results || []).map((row) => ({
    ...row,
    payload_json: parseJsonSafe(row.payload_json),
  }));
}

async function listPropertyAllotmentRoomingListEntries(env, tenantId, propertyId, allotmentId) {
  const result = await env.DB
    .prepare(
      `SELECT prle.id, prle.tenant_id, prle.property_id, prle.allotment_id, prle.allotment_allocation_id,
              prle.room_type_id, prle.room_unit_id, prle.rooming_status, prle.payer_scope, prle.reservation_id, prle.display_name, prle.guest_name,
              prle.note, prle.created_by, prle.updated_by, prle.created_at, prle.updated_at,
              ru.room_number, ru.floor_label,
              rt.code AS room_type_code, rt.name AS room_type_name
         FROM property_allotment_rooming_list_entries prle
         JOIN room_units ru
           ON ru.id = prle.room_unit_id
          AND ru.tenant_id = prle.tenant_id
          AND ru.property_id = prle.property_id
         LEFT JOIN room_types rt
           ON rt.id = prle.room_type_id
          AND rt.tenant_id = prle.tenant_id
          AND rt.property_id = prle.property_id
        WHERE prle.tenant_id = ?
          AND prle.property_id = ?
          AND prle.allotment_id = ?
        ORDER BY ru.floor_label ASC, ru.room_number ASC, prle.created_at ASC`
    )
    .bind(tenantId, propertyId, allotmentId)
    .all();
  return (result.results || []).map(mapPropertyAllotmentRoomingListEntryRow);
}

async function loadPropertyAllotmentRoomingListEntryById(env, tenantId, propertyId, allotmentId, entryId) {
  const row = await env.DB
    .prepare(
      `SELECT prle.id, prle.tenant_id, prle.property_id, prle.allotment_id, prle.allotment_allocation_id,
              prle.room_type_id, prle.room_unit_id, prle.rooming_status, prle.payer_scope, prle.reservation_id, prle.display_name, prle.guest_name,
              prle.note, prle.created_by, prle.updated_by, prle.created_at, prle.updated_at,
              ru.room_number, ru.floor_label,
              rt.code AS room_type_code, rt.name AS room_type_name
         FROM property_allotment_rooming_list_entries prle
         JOIN room_units ru
           ON ru.id = prle.room_unit_id
          AND ru.tenant_id = prle.tenant_id
          AND ru.property_id = prle.property_id
         LEFT JOIN room_types rt
           ON rt.id = prle.room_type_id
          AND rt.tenant_id = prle.tenant_id
          AND rt.property_id = prle.property_id
        WHERE prle.tenant_id = ?
          AND prle.property_id = ?
          AND prle.allotment_id = ?
          AND prle.id = ?`
    )
    .bind(tenantId, propertyId, allotmentId, entryId)
    .first();
  return row ? mapPropertyAllotmentRoomingListEntryRow(row) : null;
}

async function ensurePropertyAllotmentRoomingListEntries(env, tenantId, propertyId, allotment, allocations, actorUserId) {
  const existingEntries = await listPropertyAllotmentRoomingListEntries(env, tenantId, propertyId, allotment.id);
  const existingAllocationIds = new Set(existingEntries.map((entry) => String(entry.allotment_allocation_id || '')));
  const now = currentUnixSeconds();
  const inserts = [];
  for (const allocation of (allocations || [])) {
    const allocationId = String(allocation.id || '').trim();
    if (!allocationId || existingAllocationIds.has(allocationId)) continue;
    const roomLabel = allocation.room_number ? `Room ${allocation.room_number}` : 'Room TBD';
    inserts.push(env.DB.prepare(
      `INSERT INTO property_allotment_rooming_list_entries
        (id, tenant_id, property_id, allotment_id, allotment_allocation_id, room_type_id, room_unit_id,
         rooming_status, display_name, guest_name, note, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, ?, ?, ?, ?)`
    ).bind(
      nanoid(),
      tenantId,
      propertyId,
      allotment.id,
      allocationId,
      allocation.room_type_id,
      allocation.room_unit_id,
      `${allotment.operator_name || 'Operator'} · ${roomLabel}`,
      actorUserId || null,
      actorUserId || null,
      now,
      now,
    ));
  }
  if (inserts.length) await env.DB.batch(inserts);
  return listPropertyAllotmentRoomingListEntries(env, tenantId, propertyId, allotment.id);
}

async function loadPropertyAllotmentMasterFolio(env, tenantId, propertyId, allotmentId) {
  const row = await env.DB
    .prepare(
      `SELECT id, tenant_id, property_id, allotment_id, status, billing_mode, currency, note,
              opened_at, settled_at, closed_by, created_at, updated_at
         FROM property_allotment_master_folios
        WHERE tenant_id = ?
          AND property_id = ?
          AND allotment_id = ?`
    )
    .bind(tenantId, propertyId, allotmentId)
    .first();
  return row ? mapPropertyAllotmentMasterFolioRow(row) : null;
}

async function ensurePropertyAllotmentMasterFolio(env, tenantId, propertyId, allotment, actorUserId = null) {
  let folio = await loadPropertyAllotmentMasterFolio(env, tenantId, propertyId, allotment.id);
  if (folio) return { folio, created: false };

  const property = await loadPropertyById(env, tenantId, propertyId);
  const currency = String(property?.currency || 'USD').trim().toUpperCase();
  const now = currentUnixSeconds();
  const folioId = nanoid();
  await env.DB
    .prepare(
      `INSERT INTO property_allotment_master_folios
        (id, tenant_id, property_id, allotment_id, status, billing_mode, currency, note, opened_at, settled_at, closed_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'open', 'master_only', ?, NULL, ?, NULL, NULL, ?, ?)`
    )
    .bind(folioId, tenantId, propertyId, allotment.id, currency, now, now, now)
    .run();
  folio = await loadPropertyAllotmentMasterFolio(env, tenantId, propertyId, allotment.id);
  if (folio) {
    await recordPropertyAllotmentEvent(env, tenantId, propertyId, allotment.id, 'allotment_master_folio_opened', allotment.status, allotment.status, {
      master_folio_id: folio.id,
      billing_mode: folio.billing_mode,
      currency: folio.currency,
    }, actorUserId || null);
  }
  return { folio, created: true };
}

async function loadPropertyAllotmentMasterFolioLines(env, tenantId, propertyId, allotmentId) {
  const result = await env.DB
    .prepare(
      `SELECT paml.id, paml.tenant_id, paml.property_id, paml.master_folio_id, paml.allotment_id, paml.rooming_entry_id,
              paml.line_type, paml.source_type, paml.category, paml.description, paml.quantity, paml.unit_amount,
              paml.total_amount, paml.currency, paml.status, paml.posted_at, paml.posted_by, paml.note, paml.created_at, paml.updated_at
         FROM property_allotment_master_folio_lines paml
        WHERE paml.tenant_id = ?
          AND paml.property_id = ?
          AND paml.allotment_id = ?
        ORDER BY paml.posted_at ASC, paml.created_at ASC`
    )
    .bind(tenantId, propertyId, allotmentId)
    .all();
  return (result.results || []).map(mapPropertyAllotmentMasterFolioLineRow);
}

async function loadPropertyAllotmentDeferredGuestCharges(env, tenantId, propertyId, allotmentId) {
  const result = await env.DB
    .prepare(
      `SELECT id, tenant_id, property_id, allotment_id, rooming_entry_id, reservation_id, line_type, source_type, category,
              description, quantity, unit_amount, total_amount, currency, routing_status, note, created_by, consumed_folio_id,
              consumed_folio_line_id, consumed_at, created_at, updated_at
         FROM property_allotment_deferred_guest_charges
        WHERE tenant_id = ?
          AND property_id = ?
          AND allotment_id = ?
        ORDER BY created_at ASC`
    )
    .bind(tenantId, propertyId, allotmentId)
    .all();
  return (result.results || []).map(mapPropertyAllotmentDeferredGuestChargeRow);
}

async function recalculatePropertyAllotmentMasterFolioStatus(env, tenantId, propertyId, masterFolioId) {
  const totals = await env.DB
    .prepare(
      `SELECT COALESCE(SUM(total_amount), 0) AS balance_due,
              COALESCE(SUM(CASE WHEN line_type = 'payment' THEN ABS(total_amount) ELSE 0 END), 0) AS payment_total,
              COALESCE(SUM(CASE WHEN line_type != 'payment' AND total_amount > 0 THEN total_amount ELSE 0 END), 0) AS charge_total,
              COALESCE(SUM(CASE WHEN line_type != 'payment' AND total_amount < 0 THEN total_amount ELSE 0 END), 0) AS adjustment_total
         FROM property_allotment_master_folio_lines
        WHERE tenant_id = ? AND property_id = ? AND master_folio_id = ? AND status = 'posted'`
    )
    .bind(tenantId, propertyId, masterFolioId)
    .first();

  const now = currentUnixSeconds();
  const balanceDue = Number(totals?.balance_due || 0);
  const nextStatus = balanceDue <= 0 ? 'settled' : 'open';
  await env.DB
    .prepare(
      `UPDATE property_allotment_master_folios
          SET status = ?,
              settled_at = ?,
              updated_at = ?
        WHERE id = ? AND tenant_id = ? AND property_id = ?`
    )
    .bind(nextStatus, nextStatus === 'settled' ? now : null, now, masterFolioId, tenantId, propertyId)
    .run();

  return {
    charge_total: Number(totals?.charge_total || 0),
    payment_total: Number(totals?.payment_total || 0),
    adjustment_total: Number(totals?.adjustment_total || 0),
    balance_due: balanceDue,
    status: nextStatus,
  };
}

function resolveAllotmentChargePayerScope(masterFolio, roomingEntry, parsedCharge) {
  const billingMode = String(masterFolio?.billing_mode || 'master_only').trim() || 'master_only';
  if (parsedCharge?.payerScope) return parsedCharge.payerScope;
  if (billingMode === 'master_only') return 'master';
  if (billingMode === 'guest_only') return 'guest';
  if (String(parsedCharge?.lineType || '') === 'room_charge') return 'master';
  const roomingScope = String(roomingEntry?.payer_scope || '').trim();
  if (roomingScope === 'master' || roomingScope === 'guest') return roomingScope;
  return 'guest';
}

function filterEligibleRoomTypesForAllotment(allotment, roomTypes, roomRateMap) {
  if (allotment.room_type_id) {
    return roomTypes.filter((roomType) => String(roomType.id) === String(allotment.room_type_id));
  }
  const rohCapacityFilter = String(allotment.roh_capacity_filter || 'gte_2').trim() || 'gte_2';
  return [...roomTypes]
    .filter((roomType) => {
      const maxOccupancy = Number(roomType.max_occupancy || 0);
      return rohCapacityFilter === 'gte_2' ? maxOccupancy >= 2 : maxOccupancy === 2;
    })
    .sort((left, right) => {
      const leftRate = Number(roomRateMap.get(String(left.id)) || Number.MAX_SAFE_INTEGER);
      const rightRate = Number(roomRateMap.get(String(right.id)) || Number.MAX_SAFE_INTEGER);
      if (leftRate !== rightRate) return leftRate - rightRate;
      const leftSort = Number(left.sort_order || 0);
      const rightSort = Number(right.sort_order || 0);
      if (leftSort !== rightSort) return leftSort - rightSort;
      return String(left.name || left.code || left.id).localeCompare(String(right.name || right.code || right.id));
    });
}

async function collectAllocatableUnitsForAllotment(env, tenantId, propertyId, allotment, options = {}) {
  const roomTypesResult = await env.DB
    .prepare(
      `SELECT id, code, name, max_occupancy, sort_order
         FROM room_types
        WHERE tenant_id = ?
          AND property_id = ?
          AND active = 1
        ORDER BY sort_order ASC, name ASC`
    )
    .bind(tenantId, propertyId)
    .all();
  const roomRatesResult = await env.DB
    .prepare(
      `SELECT room_type_id, MIN(nightly_amount) AS min_nightly_amount
         FROM property_room_rates
        WHERE tenant_id = ?
          AND property_id = ?
          AND active = 1
        GROUP BY room_type_id`
    )
    .bind(tenantId, propertyId)
    .all();
  const roomUnitsResult = await env.DB
    .prepare(
      `SELECT id, room_type_id, room_number, floor_label, sort_order
         FROM room_units
        WHERE tenant_id = ?
          AND property_id = ?
          AND active = 1
          AND operational_status NOT IN ('maintenance', 'out_of_order')
        ORDER BY sort_order ASC, room_number ASC`
    )
    .bind(tenantId, propertyId)
    .all();
  const reservationOverlapResult = await env.DB
    .prepare(
      `SELECT DISTINCT room_unit_id
         FROM reservation_allocations
        WHERE tenant_id = ?
          AND property_id = ?
          AND allocation_status IN ('soft_allocated', 'locked')
          AND stay_date >= ?
          AND stay_date < ?`
    )
    .bind(tenantId, propertyId, allotment.check_in, allotment.check_out)
    .all();
  const excludeAllotmentId = options.excludeAllotmentId ? String(options.excludeAllotmentId).trim() : null;
  const allotmentOverlapResult = await env.DB
    .prepare(
      `SELECT DISTINCT room_unit_id
         FROM property_allotment_allocations
        WHERE tenant_id = ?
          AND property_id = ?
          AND allocation_status = 'allocated'
          AND check_in < ?
          AND check_out > ?
          AND (? IS NULL OR allotment_id != ?)`
    )
    .bind(tenantId, propertyId, allotment.check_out, allotment.check_in, excludeAllotmentId, excludeAllotmentId)
    .all();

  const roomTypes = roomTypesResult.results || [];
  const roomRateMap = new Map((roomRatesResult.results || []).map((row) => [String(row.room_type_id || ''), Number(row.min_nightly_amount || Number.MAX_SAFE_INTEGER)]));
  const blockedRoomUnitIds = new Set([
    ...(reservationOverlapResult.results || []).map((row) => String(row.room_unit_id || '')),
    ...(allotmentOverlapResult.results || []).map((row) => String(row.room_unit_id || '')),
    ...((options.blockedRoomUnitIds || []).map((value) => String(value || ''))),
  ]);
  const eligibleRoomTypes = filterEligibleRoomTypesForAllotment(allotment, roomTypes, roomRateMap);
  if (!eligibleRoomTypes.length) {
    return { error: 'No eligible room types match this operator block.' };
  }

  const requiredRooms = Math.max(0, Number((options.requiredRooms ?? allotment.rooms_blocked) || 0));
  const collectCandidateUnits = (roomTypesForAllocation) => {
    const units = [];
    for (const roomType of roomTypesForAllocation) {
      const matchingUnits = (roomUnitsResult.results || []).filter((roomUnit) => String(roomUnit.room_type_id) === String(roomType.id));
      for (const roomUnit of matchingUnits) {
        if (blockedRoomUnitIds.has(String(roomUnit.id))) continue;
        units.push({ roomType, roomUnit });
      }
    }
    return units;
  };

  let candidateUnits = collectCandidateUnits(eligibleRoomTypes);
  let effectiveRohCapacityFilter = allotment.room_type_id
    ? null
    : (String(allotment.roh_capacity_filter || 'gte_2').trim() || 'gte_2');

  if (!allotment.room_type_id && effectiveRohCapacityFilter === 'max_2' && candidateUnits.length < requiredRooms) {
    const broadenedEligibleRoomTypes = filterEligibleRoomTypesForAllotment(
      { ...allotment, roh_capacity_filter: 'gte_2' },
      roomTypes,
      roomRateMap,
    );
    const broadenedCandidateUnits = collectCandidateUnits(broadenedEligibleRoomTypes);
    if (broadenedCandidateUnits.length >= requiredRooms) {
      candidateUnits = broadenedCandidateUnits;
      effectiveRohCapacityFilter = 'gte_2';
    }
  }

  if (candidateUnits.length < requiredRooms) {
    const filterLabel = !allotment.room_type_id
      ? (effectiveRohCapacityFilter === 'gte_2' ? 'ROH rooms with max occupancy >= 2' : 'ROH rooms with max occupancy = 2')
      : 'the selected room type';
    return {
      error: `Only ${candidateUnits.length} free room(s) matching ${filterLabel} are currently available to allocate against this operator block.`,
      availableRooms: candidateUnits.length,
      effectiveRohCapacityFilter,
    };
  }

  return {
    candidateUnits,
    effectiveRohCapacityFilter,
    availableRooms: candidateUnits.length,
  };
}

async function insertPropertyAllotmentAllocations(env, tenantId, propertyId, allotment, chosenUnits, actorUserId, allocationSource = 'manual_allocate') {
  const now = currentUnixSeconds();
  const batchStatements = chosenUnits.map(({ roomType, roomUnit }) => env.DB.prepare(
    `INSERT INTO property_allotment_allocations
      (id, tenant_id, property_id, allotment_id, room_type_id, room_unit_id, operator_name,
       check_in, check_out, allocation_status, allocation_source, released_reason, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'allocated', ?, NULL, ?, ?, ?, ?)`
  ).bind(
    nanoid(),
    tenantId,
    propertyId,
    allotment.id,
    roomType.id,
    roomUnit.id,
    allotment.operator_name,
    allotment.check_in,
    allotment.check_out,
    allocationSource,
    actorUserId || null,
    actorUserId || null,
    now,
    now,
  ));
  if (batchStatements.length) await env.DB.batch(batchStatements);
  return now;
}

async function buildPropertyAllotmentReworkPreview(env, tenantId, propertyId, existing, updates = {}) {
  const proposed = {
    ...existing,
    ...updates,
  };
  if (proposed.room_type_id) proposed.roh_capacity_filter = null;

  const roomTypesResult = await env.DB
    .prepare(
      `SELECT id, code, name, max_occupancy, sort_order
         FROM room_types
        WHERE tenant_id = ?
          AND property_id = ?
          AND active = 1`
    )
    .bind(tenantId, propertyId)
    .all();
  const roomTypesById = new Map((roomTypesResult.results || []).map((row) => [String(row.id || ''), row]));
  const activeAllocations = await listActivePropertyAllotmentAllocations(env, tenantId, propertyId, existing.id);

  const inventoryShapeKeys = ['room_type_id', 'check_in', 'check_out', 'rooms_blocked', 'roh_capacity_filter'];
  const inventoryShapeChanged = inventoryShapeKeys.some((key) => Object.prototype.hasOwnProperty.call(updates, key));
  const currentState = String(existing.status || '').trim();
  const blockKind = existing.room_type_id ? 'non_roh' : 'roh';
  const proposedBlockKind = proposed.room_type_id ? 'non_roh' : 'roh';
  const metadataOnly = !inventoryShapeChanged;
  const inventoryLocked = currentState === 'in_house' && inventoryShapeChanged;

  const existingRoomType = existing.room_type_id ? roomTypesById.get(String(existing.room_type_id)) || null : null;
  const proposedRoomType = proposed.room_type_id ? roomTypesById.get(String(proposed.room_type_id)) || null : null;
  const sameRoomType = String(existing.room_type_id || '') === String(proposed.room_type_id || '');
  const isUpgrade = Boolean(existingRoomType && proposedRoomType && !sameRoomType && Number(proposedRoomType.sort_order || 0) > Number(existingRoomType.sort_order || 0));
  const isDowngrade = Boolean(existingRoomType && proposedRoomType && !sameRoomType && Number(proposedRoomType.sort_order || 0) < Number(existingRoomType.sort_order || 0));
  const requiresSplit = currentState === 'confirmed' && blockKind === 'non_roh' && !sameRoomType && !isUpgrade;

  const proposedCheckIn = String(proposed.check_in || '').trim();
  const proposedCheckOut = String(proposed.check_out || '').trim();
  const proposedRoomsBlocked = Number(proposed.rooms_blocked || 0);
  const eligiblePreservedAllocations = activeAllocations.filter((allocation) => {
    if (!proposedCheckIn || !proposedCheckOut) return false;
    if (String(allocation.check_in || '') < proposedCheckIn || String(allocation.check_out || '') > proposedCheckOut) return false;
    if (proposed.room_type_id) {
      return String(allocation.room_type_id || '') === String(proposed.room_type_id || '');
    }
    const allocationRoomType = roomTypesById.get(String(allocation.room_type_id || '')) || null;
    const maxOccupancy = Number(allocationRoomType?.max_occupancy || 0);
    if (String(proposed.roh_capacity_filter || 'gte_2') === 'max_2') return maxOccupancy === 2;
    return maxOccupancy >= 2;
  });
  const preservedAllocations = eligiblePreservedAllocations.slice(0, proposedRoomsBlocked);
  const releasedAllocations = activeAllocations.filter((allocation) => !preservedAllocations.some((item) => String(item.id) === String(allocation.id)));
  const additionalAllocationsNeeded = Math.max(proposedRoomsBlocked - preservedAllocations.length, 0);

  let candidateSummary = { candidateUnits: [], effectiveRohCapacityFilter: proposed.roh_capacity_filter || null, availableRooms: 0 };
  if (!inventoryLocked && inventoryShapeChanged && additionalAllocationsNeeded > 0) {
    candidateSummary = await collectAllocatableUnitsForAllotment(env, tenantId, propertyId, proposed, {
      excludeAllotmentId: existing.id,
      blockedRoomUnitIds: preservedAllocations.map((allocation) => allocation.room_unit_id),
      requiredRooms: additionalAllocationsNeeded,
    });
  }

  const warnings = [];
  if (currentState === 'confirmed' && inventoryShapeChanged) warnings.push('Confirmed allotment changes must use rework preview/apply semantics rather than naive PATCH.');
  if (isUpgrade) warnings.push('This change is a full-block upgrade candidate and should recheck availability before apply.');
  if (requiresSplit) warnings.push('This non-ROH confirmed change should use a split/reshape flow instead of in-place mutation.');
  if (isDowngrade) warnings.push('Downgrade behavior is not approved for naive in-place mutation and may require manual override policy.');
  if (candidateSummary.error) warnings.push(candidateSummary.error);

  const mapAllocationSummary = (allocation) => ({
    allocation_id: allocation.id,
    room_unit_id: allocation.room_unit_id,
    room_number: allocation.room_number || null,
    room_type_id: allocation.room_type_id || null,
    room_type_code: allocation.room_type_code || null,
  });
  const mapCandidateSummary = ({ roomType, roomUnit }) => ({
    room_unit_id: roomUnit.id,
    room_number: roomUnit.room_number || null,
    room_type_id: roomType.id,
    room_type_code: roomType.code || null,
  });

  return {
    existing_allotment: existing,
    proposed_allotment: {
      ...proposed,
      roh_capacity_filter: proposed.room_type_id ? null : (candidateSummary.effectiveRohCapacityFilter || proposed.roh_capacity_filter || null),
    },
    policy: {
      current_state: currentState,
      block_kind: blockKind,
      proposed_block_kind: proposedBlockKind,
      metadata_only: metadataOnly,
      inventory_shape_changed: inventoryShapeChanged,
      inventory_locked: inventoryLocked,
      editable: !inventoryLocked,
      requires_preview: currentState === 'allocated' || currentState === 'confirmed',
      same_room_type: sameRoomType,
      full_upgrade_candidate: isUpgrade,
      downgrade_detected: isDowngrade,
      requires_split: requiresSplit,
      can_apply: !inventoryLocked && !requiresSplit && !isDowngrade && !candidateSummary.error,
    },
    impact: {
      active_allocations: activeAllocations.length,
      preserved_allocations: preservedAllocations.length,
      released_allocations: releasedAllocations.length,
      additional_allocations_needed: additionalAllocationsNeeded,
      additional_allocations_available: candidateSummary.availableRooms || 0,
    },
    room_diff: {
      preserved: preservedAllocations.map(mapAllocationSummary),
      released: releasedAllocations.map(mapAllocationSummary),
      to_allocate: (candidateSummary.candidateUnits || []).slice(0, additionalAllocationsNeeded).map(mapCandidateSummary),
    },
    warnings,
    _internal: {
      preservedAllocations,
      releasedAllocations,
      candidateUnits: candidateSummary.candidateUnits || [],
      effectiveRohCapacityFilter: candidateSummary.effectiveRohCapacityFilter || null,
    },
  };
}

function sanitizePropertyAllotmentReworkPreview(preview) {
  if (!preview || typeof preview !== 'object') return preview;
  const { _internal, ...safePreview } = preview;
  return safePreview;
}

async function allocatePropertyAllotmentRooms(env, tenantId, propertyId, allotment, actorUserId, allocationSource = 'manual_allocate') {
  const existingAllocations = await listActivePropertyAllotmentAllocations(env, tenantId, propertyId, allotment.id);
  if (existingAllocations.length) {
    if (existingAllocations.length === Number(allotment.rooms_blocked || 0)) {
      return { allocations: existingAllocations, alreadyAllocated: true };
    }
    return { error: 'This operator block already has partial room allocations. Release it first before reallocating.' };
  }

  const candidateSummary = await collectAllocatableUnitsForAllotment(env, tenantId, propertyId, allotment, {
    requiredRooms: Number(allotment.rooms_blocked || 0),
  });
  if (candidateSummary.error) {
    return { error: candidateSummary.error, availableRooms: candidateSummary.availableRooms ?? null };
  }

  const chosenUnits = (candidateSummary.candidateUnits || []).slice(0, Number(allotment.rooms_blocked || 0));
  await insertPropertyAllotmentAllocations(env, tenantId, propertyId, allotment, chosenUnits, actorUserId, allocationSource);
  const now = currentUnixSeconds();
  await env.DB
    .prepare(
      `UPDATE property_allotments
          SET status = CASE WHEN status IN ('draft', 'active') THEN 'allocated' ELSE status END,
              roh_capacity_filter = COALESCE(?, roh_capacity_filter),
              updated_by = ?,
              updated_at = ?
        WHERE id = ? AND tenant_id = ? AND property_id = ?`
    )
      .bind(candidateSummary.effectiveRohCapacityFilter, actorUserId || null, now, allotment.id, tenantId, propertyId)
    .run();
  const allocations = await listActivePropertyAllotmentAllocations(env, tenantId, propertyId, allotment.id);
  await recordPropertyAllotmentEvent(
    env,
    tenantId,
    propertyId,
    allotment.id,
    'allotment_allocated',
    allotment.status,
    allotment.status === 'draft' || allotment.status === 'active' ? 'allocated' : allotment.status,
    {
      allocation_source: allocationSource,
      effective_roh_capacity_filter: candidateSummary.effectiveRohCapacityFilter,
      allocated_rooms: allocations.length,
      room_unit_ids: allocations.map((allocation) => allocation.room_unit_id),
    },
    actorUserId || null,
  );
  return { allocations, alreadyAllocated: false };
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
            AND ra.allocation_status IN ('soft_allocated', 'locked')
            AND pr.status IN ('pending_payment', 'confirmed', 'checked_in')
            AND ra.stay_date >= ?
            AND ra.stay_date < ?
          GROUP BY ra.room_unit_id, ra.reservation_id, pr.guest_name, pr.check_in, pr.check_out, pr.status
          ORDER BY ra.room_unit_id ASC, MIN(ra.stay_date) ASC`
      )
      .bind(tenantId, propertyId, fromDate, rangeEndExclusive)
      .all();

    const allotmentOccupancyResult = await env.DB
      .prepare(
        `SELECT paa.room_unit_id, paa.allotment_id, pa.operator_name, pa.status AS allotment_status,
                paa.check_in, paa.check_out,
                prle.id AS rooming_entry_id, prle.rooming_status, prle.display_name, prle.guest_name
           FROM property_allotment_allocations paa
           JOIN property_allotments pa
             ON pa.id = paa.allotment_id
            AND pa.tenant_id = paa.tenant_id
            AND pa.property_id = paa.property_id
           LEFT JOIN property_allotment_rooming_list_entries prle
             ON prle.allotment_allocation_id = paa.id
            AND prle.tenant_id = paa.tenant_id
            AND prle.property_id = paa.property_id
          WHERE paa.tenant_id = ?
            AND paa.property_id = ?
            AND paa.allocation_status = 'allocated'
            AND pa.status IN ('confirmed', 'in_house')
            AND paa.check_out > ?
            AND paa.check_in < ?
          ORDER BY paa.room_unit_id ASC, paa.check_in ASC`
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

    const allotmentsByUnit = new Map();
    for (const row of (allotmentOccupancyResult.results || [])) {
      const unitId = String(row.room_unit_id || '').trim();
      if (!unitId) continue;
      if (!allotmentsByUnit.has(unitId)) allotmentsByUnit.set(unitId, []);
      allotmentsByUnit.get(unitId).push(row);
    }

    const summary = roomUnits.map((roomUnit) => {
      const segments = byUnit.get(String(roomUnit.id)) || [];
      const allotmentSegments = allotmentsByUnit.get(String(roomUnit.id)) || [];

      // Current = a segment whose allocated nights include fromDate
      // (first_alloc_date <= fromDate AND last_alloc_date >= fromDate)
      const current = segments.find((s) => s.first_alloc_date <= fromDate && s.last_alloc_date >= fromDate) || null;
      // Next = first segment that starts strictly after fromDate
      const next = segments.find((s) => s.first_alloc_date > fromDate) || null;

      const currentAllotment = !current
        ? (allotmentSegments.find((segment) => String(segment.check_in || '') <= fromDate && String(segment.check_out || '') > fromDate) || null)
        : null;
      const nextAllotment = !next
        ? (allotmentSegments.find((segment) => String(segment.check_in || '') > fromDate) || null)
        : null;

      // Open nights = free nights between now and the next blocked segment
      const openFrom = current ? current.check_out : (currentAllotment ? currentAllotment.check_out : fromDate);
      const openEnd = next ? next.first_alloc_date : (nextAllotment ? nextAllotment.check_in : rangeEndExclusive);
      const openNights = Math.max(0, enumerateStayDates(openFrom, openEnd).length);

      // Arrival/departure signals (relative to fromDate)
      const arrivalToday = (!current && next?.first_alloc_date === fromDate) || (!current && !next && nextAllotment?.check_in === fromDate);
      const departureToday = current?.check_out === fromDate || currentAllotment?.check_out === fromDate;

      // Human-readable explanation for why a room cannot be freely assigned
      let whyNotAssignable = null;
      if (['maintenance', 'out_of_order'].includes(roomUnit.operational_status)) {
        whyNotAssignable = roomUnit.operational_status === 'out_of_order' ? 'Out of order' : 'Under maintenance';
      } else if (current) {
        whyNotAssignable = departureToday
          ? `Departing today · ${current.guest_name || 'Guest'}`
          : `Occupied until ${current.check_out} · ${current.guest_name || 'Guest'}`;
      } else if (currentAllotment) {
        const roomingLabel = currentAllotment.guest_name || currentAllotment.display_name || currentAllotment.operator_name || 'Operator block';
        const occupiedLabel = currentAllotment.rooming_status === 'checked_in'
          ? 'Occupied'
          : 'Reserved';
        whyNotAssignable = departureToday
          ? `${occupiedLabel} by operator block today · ${roomingLabel}`
          : `${occupiedLabel} by operator block until ${currentAllotment.check_out} · ${roomingLabel}`;
      } else if (next) {
        whyNotAssignable = arrivalToday
          ? `Arriving today · ${next.guest_name || 'Guest'}`
          : `${openNights} night${openNights !== 1 ? 's' : ''} free · Next: ${next.guest_name || 'Reservation'} arrives ${next.first_alloc_date}`;
      } else if (nextAllotment) {
        const roomingLabel = nextAllotment.guest_name || nextAllotment.display_name || nextAllotment.operator_name || 'Operator block';
        whyNotAssignable = arrivalToday
          ? `Operator block arrives today · ${roomingLabel}`
          : `${openNights} night${openNights !== 1 ? 's' : ''} free · Next operator block: ${roomingLabel} arrives ${nextAllotment.check_in}`;
      }

      return {
        room_unit_id: roomUnit.id,
        current_reservation_id: current?.reservation_id || null,
        current_reservation_status: current?.status || null,
        current_guest_name: current?.guest_name || currentAllotment?.guest_name || currentAllotment?.display_name || currentAllotment?.operator_name || null,
        current_check_out: current?.check_out || currentAllotment?.check_out || null,
        departure_today: departureToday || false,
        next_reservation_id: next?.reservation_id || null,
        next_reservation_status: next?.status || null,
        next_reservation_start: next?.first_alloc_date || null,
        next_reservation_guest_name: next?.guest_name || null,
        current_allotment_id: currentAllotment?.allotment_id || null,
        current_allotment_operator_name: currentAllotment?.operator_name || null,
        current_allotment_display_name: currentAllotment?.display_name || currentAllotment?.guest_name || null,
        current_allotment_rooming_status: currentAllotment?.rooming_status || null,
        current_allotment_status: currentAllotment?.allotment_status || null,
        next_allotment_id: nextAllotment?.allotment_id || null,
        next_allotment_start: nextAllotment?.check_in || null,
        next_allotment_display_name: nextAllotment?.display_name || nextAllotment?.guest_name || nextAllotment?.operator_name || null,
        arrival_today: arrivalToday || false,
        open_nights: openNights,
        fully_open_within_window: !current && !next && !currentAllotment && !nextAllotment,
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
    const allotmentAllocations = await listPropertyAllotmentAllocationsInRange(env, tenantId, propertyId, fromDate, toDate, 'allocated');

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

    for (const allocation of (allotmentAllocations || [])) {
      const allotmentDates = enumerateStayDates(allocation.check_in, allocation.check_out).filter((date) => date >= fromDate && date < toDate);
      const normalizedStatus = String(allocation.allotment_status || '').trim();
      const slotStatus = normalizedStatus === 'in_house' ? 'checked_in' : 'confirmed';
      for (const stayDate of allotmentDates) {
        const key = `${allocation.room_unit_id}::${stayDate}`;
        if (occupancyMap.has(key)) continue;
        occupancyMap.set(key, {
          state: 'booked',
          status: slotStatus,
          reservation_status: slotStatus,
          guest_name: allocation.operator_name || 'Operator block',
          check_in: allocation.check_in,
          check_out: allocation.check_out,
          allotment_id: allocation.allotment_id,
          operator_name: allocation.operator_name || 'Operator block',
        });
      }
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

    return jsonResponse({ ok: true, from_date: fromDate, days, dates, units, reservations: Array.from(reservationMap.values()), allotments, allotment_allocations: allotmentAllocations });
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

export async function handleListPropertyAllotmentEvents(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const allotmentId = String(params?.allotmentId || '').trim();
  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;

  const url = new URL(request.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 50)));

  try {
    const existing = await loadPropertyAllotmentById(env, tenantId, propertyId, allotmentId);
    if (!existing) return jsonResponse({ error: 'Allotment not found.' }, 404);
    const events = await listPropertyAllotmentEvents(env, tenantId, propertyId, allotmentId, limit);
    return jsonResponse({ ok: true, allotment_id: allotmentId, events });
  } catch (error) {
    console.error('[PROPERTY_ALLOTMENT_EVENTS_LIST]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleListPropertyAllotmentRoomingList(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const allotmentId = String(params?.allotmentId || '').trim();
  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;

  try {
    const existing = await loadPropertyAllotmentById(env, tenantId, propertyId, allotmentId);
    if (!existing) return jsonResponse({ error: 'Allotment not found.' }, 404);
    const entries = await listPropertyAllotmentRoomingListEntries(env, tenantId, propertyId, allotmentId);
    return jsonResponse({ ok: true, allotment_id: allotmentId, entries });
  } catch (error) {
    console.error('[PROPERTY_ALLOTMENT_ROOMING_LIST_GET]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleGetPropertyAllotmentMasterFolio(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const allotmentId = String(params?.allotmentId || '').trim();
  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;

  try {
    const existing = await loadPropertyAllotmentById(env, tenantId, propertyId, allotmentId);
    if (!existing) return jsonResponse({ error: 'Allotment not found.' }, 404);
    const ensured = await ensurePropertyAllotmentMasterFolio(env, tenantId, propertyId, existing, actor.session.user_id || null);
    const lines = await loadPropertyAllotmentMasterFolioLines(env, tenantId, propertyId, allotmentId);
    const deferredGuestCharges = await loadPropertyAllotmentDeferredGuestCharges(env, tenantId, propertyId, allotmentId);
    const summary = await recalculatePropertyAllotmentMasterFolioStatus(env, tenantId, propertyId, ensured.folio.id);
    return jsonResponse({ ok: true, allotment_id: allotmentId, master_folio: ensured.folio, lines, deferred_guest_charges: deferredGuestCharges, summary });
  } catch (error) {
    console.error('[PROPERTY_ALLOTMENT_MASTER_FOLIO_GET]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleUpdatePropertyAllotmentMasterFolio(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const allotmentId = String(params?.allotmentId || '').trim();
  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validatePropertyAllotmentMasterFolioPatchRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const existing = await loadPropertyAllotmentById(env, tenantId, propertyId, allotmentId);
    if (!existing) return jsonResponse({ error: 'Allotment not found.' }, 404);
    const ensured = await ensurePropertyAllotmentMasterFolio(env, tenantId, propertyId, existing, actor.session.user_id || null);
    const sqlParts = [];
    const bindValues = [];
    for (const [key, value] of Object.entries(parsed.updates)) {
      sqlParts.push(`${key} = ?`);
      bindValues.push(value);
    }
    sqlParts.push('updated_at = ?');
    bindValues.push(currentUnixSeconds());

    await env.DB
      .prepare(`UPDATE property_allotment_master_folios SET ${sqlParts.join(', ')} WHERE id = ? AND tenant_id = ? AND property_id = ? AND allotment_id = ?`)
      .bind(...bindValues, ensured.folio.id, tenantId, propertyId, allotmentId)
      .run();

    const updated = await loadPropertyAllotmentMasterFolio(env, tenantId, propertyId, allotmentId);
    await recordPropertyAllotmentEvent(env, tenantId, propertyId, allotmentId, 'allotment_master_folio_updated', existing.status, existing.status, {
      updates: parsed.updates,
      master_folio_id: updated?.id || ensured.folio.id,
    }, actor.session.user_id || null);
    return jsonResponse({ ok: true, master_folio: updated });
  } catch (error) {
    console.error('[PROPERTY_ALLOTMENT_MASTER_FOLIO_PATCH]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handlePostPropertyAllotmentCharge(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const allotmentId = String(params?.allotmentId || '').trim();
  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validatePropertyAllotmentChargeRoutingRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const allotment = await loadPropertyAllotmentById(env, tenantId, propertyId, allotmentId);
    if (!allotment) return jsonResponse({ error: 'Allotment not found.' }, 404);
    const ensuredMasterFolio = await ensurePropertyAllotmentMasterFolio(env, tenantId, propertyId, allotment, actor.session.user_id || null);
    let roomingEntry = null;
    if (parsed.roomingEntryId) {
      roomingEntry = await loadPropertyAllotmentRoomingListEntryById(env, tenantId, propertyId, allotmentId, parsed.roomingEntryId);
      if (!roomingEntry) return jsonResponse({ error: 'Rooming list entry not found.' }, 404);
    }

    const payerScope = resolveAllotmentChargePayerScope(ensuredMasterFolio.folio, roomingEntry, parsed);
    const now = currentUnixSeconds();

    if (payerScope === 'master') {
      const lineId = nanoid();
      await env.DB
        .prepare(
          `INSERT INTO property_allotment_master_folio_lines
            (id, tenant_id, property_id, master_folio_id, allotment_id, rooming_entry_id, line_type, source_type, category,
             description, quantity, unit_amount, total_amount, currency, status, posted_at, posted_by, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'manual_manager', ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, ?)`
        )
        .bind(
          lineId,
          tenantId,
          propertyId,
          ensuredMasterFolio.folio.id,
          allotmentId,
          roomingEntry?.id || null,
          parsed.lineType,
          parsed.category,
          parsed.description,
          parsed.quantity,
          parsed.unitAmount,
          parsed.totalAmount,
          parsed.currency,
          now,
          actor.session.user_id || null,
          parsed.note,
          now,
          now,
        )
        .run();
      const lines = await loadPropertyAllotmentMasterFolioLines(env, tenantId, propertyId, allotmentId);
      const line = lines.find((item) => String(item.id) === String(lineId)) || null;
      const summary = await recalculatePropertyAllotmentMasterFolioStatus(env, tenantId, propertyId, ensuredMasterFolio.folio.id);
      await recordPropertyAllotmentEvent(env, tenantId, propertyId, allotmentId, 'allotment_charge_routed', allotment.status, allotment.status, {
        payer_scope: 'master',
        master_folio_id: ensuredMasterFolio.folio.id,
        master_folio_line_id: lineId,
        rooming_entry_id: roomingEntry?.id || null,
        line_type: parsed.lineType,
        total_amount: parsed.totalAmount,
        currency: parsed.currency,
      }, actor.session.user_id || null);
      return jsonResponse({ ok: true, payer_scope: 'master', master_folio: ensuredMasterFolio.folio, line, summary });
    }

    if (!roomingEntry) {
      return jsonResponse({ error: 'rooming_entry_id is required when a charge routes to guest scope.' }, 409);
    }

    const deferredChargeId = nanoid();
    await env.DB
      .prepare(
        `INSERT INTO property_allotment_deferred_guest_charges
          (id, tenant_id, property_id, allotment_id, rooming_entry_id, line_type, source_type, category,
           description, quantity, unit_amount, total_amount, currency, routing_status, note, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'manual_manager', ?, ?, ?, ?, ?, ?, 'pending_guest_folio', ?, ?, ?, ?)`
      )
      .bind(
        deferredChargeId,
        tenantId,
        propertyId,
        allotmentId,
        roomingEntry.id,
        parsed.lineType,
        parsed.category,
        parsed.description,
        parsed.quantity,
        parsed.unitAmount,
        parsed.totalAmount,
        parsed.currency,
        parsed.note,
        actor.session.user_id || null,
        now,
        now,
      )
      .run();
    const deferredGuestCharges = await loadPropertyAllotmentDeferredGuestCharges(env, tenantId, propertyId, allotmentId);
    const deferredCharge = deferredGuestCharges.find((item) => String(item.id) === String(deferredChargeId)) || null;
    await recordPropertyAllotmentEvent(env, tenantId, propertyId, allotmentId, 'allotment_charge_routed', allotment.status, allotment.status, {
      payer_scope: 'guest',
      deferred_guest_charge_id: deferredChargeId,
      rooming_entry_id: roomingEntry.id,
      line_type: parsed.lineType,
      total_amount: parsed.totalAmount,
      currency: parsed.currency,
    }, actor.session.user_id || null);
    return jsonResponse({ ok: true, payer_scope: 'guest', deferred_guest_charge: deferredCharge, routing_status: 'pending_guest_folio' });
  } catch (error) {
    console.error('[PROPERTY_ALLOTMENT_CHARGE_ROUTE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleUpdatePropertyAllotmentRoomingListEntry(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const allotmentId = String(params?.allotmentId || '').trim();
  const entryId = String(params?.entryId || '').trim();
  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validatePropertyAllotmentRoomingListPatchRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const existingAllotment = await loadPropertyAllotmentById(env, tenantId, propertyId, allotmentId);
    if (!existingAllotment) return jsonResponse({ error: 'Allotment not found.' }, 404);
    const existingEntry = await loadPropertyAllotmentRoomingListEntryById(env, tenantId, propertyId, allotmentId, entryId);
    if (!existingEntry) return jsonResponse({ error: 'Rooming list entry not found.' }, 404);

    const nextReservationId = Object.prototype.hasOwnProperty.call(parsed.updates, 'reservation_id')
      ? parsed.updates.reservation_id
      : existingEntry.reservation_id;
    const nextRoomingStatus = Object.prototype.hasOwnProperty.call(parsed.updates, 'rooming_status')
      ? parsed.updates.rooming_status
      : existingEntry.rooming_status;
    let reservationRecord = null;
    if (nextReservationId) {
      reservationRecord = await reservationLoadPropertyReservation(env, tenantId, propertyId, nextReservationId);
      if (!reservationRecord) return jsonResponse({ error: 'reservation_id was not found for this property.' }, 404);
      if (!reservationMatchesRoomingEntry(reservationRecord, existingEntry)) {
        return jsonResponse({ error: 'reservation_id does not match the rooming entry room lane.' }, 409);
      }
      if (['cancelled', 'no_show'].includes(String(reservationRecord.reservation.status || ''))) {
        return jsonResponse({ error: 'reservation_id is not active enough for rooming execution.' }, 409);
      }
      if (nextRoomingStatus === 'checked_in' && String(reservationRecord.reservation.status || '') !== 'checked_in') {
        return jsonResponse({ error: 'rooming_status checked_in requires a checked-in reservation.' }, 409);
      }
      if (nextRoomingStatus === 'checked_out' && String(reservationRecord.reservation.status || '') !== 'checked_out') {
        return jsonResponse({ error: 'rooming_status checked_out requires a checked-out reservation.' }, 409);
      }
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
      .prepare(`UPDATE property_allotment_rooming_list_entries SET ${sqlParts.join(', ')} WHERE id = ? AND tenant_id = ? AND property_id = ? AND allotment_id = ?`)
      .bind(...bindValues, entryId, tenantId, propertyId, allotmentId)
      .run();

    const updated = await loadPropertyAllotmentRoomingListEntryById(env, tenantId, propertyId, allotmentId, entryId);
    let consumedGuestCharges = [];
    let guestFolioSummary = null;
    if (reservationRecord && updated) {
      const consumed = await consumeDeferredGuestChargesForReservation(env, tenantId, propertyId, allotmentId, updated, reservationRecord, actor.session.user_id || null);
      consumedGuestCharges = consumed.consumedCharges || [];
      guestFolioSummary = consumed.summary || null;
      if (consumedGuestCharges.length) {
        await recordPropertyAllotmentEvent(env, tenantId, propertyId, allotmentId, 'allotment_guest_charges_consumed', existingAllotment.status, existingAllotment.status, {
          rooming_entry_id: updated.id,
          reservation_id: reservationRecord.reservation.id,
          deferred_guest_charge_ids: consumedGuestCharges.map((item) => item.id),
          consumed_folio_id: consumed.folio?.id || null,
        }, actor.session.user_id || null);
      }
    }
    const syncedAllotment = await syncPropertyAllotmentExecutionStatus(env, tenantId, propertyId, allotmentId, actor.session.user_id || null);
    return jsonResponse({ ok: true, entry: updated, allotment: syncedAllotment, consumed_guest_charges: consumedGuestCharges, guest_folio_summary: guestFolioSummary });
  } catch (error) {
    console.error('[PROPERTY_ALLOTMENT_ROOMING_LIST_PATCH]', error);
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
    if (parsed.roomTypeId) {
      const roomType = await loadRoomTypeById(env, tenantId, propertyId, parsed.roomTypeId);
      if (!roomType) return jsonResponse({ error: 'room_type_id not found for this property.' }, 404);
    }
    const now = currentUnixSeconds();
    const allotmentId = nanoid();
    await env.DB
      .prepare(
        `INSERT INTO property_allotments
          (id, tenant_id, property_id, room_type_id, operator_name, operator_code, source_ref,
           check_in, check_out, rooms_blocked, roh_capacity_filter, release_date, status, notes, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`
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
        parsed.rohCapacityFilter,
        parsed.releaseDate,
        parsed.notes,
        actor.session.user_id || null,
        actor.session.user_id || null,
        now,
        now,
      )
      .run();
    await recordPropertyAllotmentEvent(env, tenantId, propertyId, allotmentId, 'allotment_created', null, 'active', {
      operator_name: parsed.operatorName,
      room_type_id: parsed.roomTypeId,
      check_in: parsed.checkIn,
      check_out: parsed.checkOut,
      rooms_blocked: parsed.roomsBlocked,
      release_date: parsed.releaseDate,
      roh_capacity_filter: parsed.rohCapacityFilter,
    }, actor.session.user_id || null);
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
    if (existing.room_type_id && 'roh_capacity_filter' in parsed.updates) {
      parsed.updates.roh_capacity_filter = null;
    }

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
    await recordPropertyAllotmentEvent(env, tenantId, propertyId, allotmentId, 'allotment_updated', existing.status, updated.status, {
      updates: parsed.updates,
    }, actor.session.user_id || null);
    return jsonResponse({ ok: true, allotment: updated });
  } catch (error) {
    console.error('[PROPERTY_ALLOTMENT_UPDATE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handlePreviewPropertyAllotmentRework(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const allotmentId = String(params?.allotmentId || '').trim();
  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validatePropertyAllotmentReworkPreviewRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const existing = await loadPropertyAllotmentById(env, tenantId, propertyId, allotmentId);
    if (!existing) return jsonResponse({ error: 'Allotment not found.' }, 404);
    const preview = await buildPropertyAllotmentReworkPreview(env, tenantId, propertyId, existing, parsed.updates);
    return jsonResponse({ ok: true, ...sanitizePropertyAllotmentReworkPreview(preview) });
  } catch (error) {
    console.error('[PROPERTY_ALLOTMENT_REWORK_PREVIEW]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleApplyPropertyAllotmentRework(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const allotmentId = String(params?.allotmentId || '').trim();
  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validatePropertyAllotmentReworkPreviewRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const existing = await loadPropertyAllotmentById(env, tenantId, propertyId, allotmentId);
    if (!existing) return jsonResponse({ error: 'Allotment not found.' }, 404);
    const preview = await buildPropertyAllotmentReworkPreview(env, tenantId, propertyId, existing, parsed.updates);
    if (preview.policy.inventory_locked) return jsonResponse({ error: 'In-house allotments cannot change inventory shape.' }, 409);
    if (preview.policy.requires_split) return jsonResponse({ error: 'This confirmed non-ROH change requires the split flow.', preview }, 409);
    if (preview.policy.downgrade_detected) return jsonResponse({ error: 'Downgrade rework is not approved for naive in-place mutation.', preview }, 409);
    if (!preview.policy.can_apply) return jsonResponse({ error: preview.warnings[preview.warnings.length - 1] || 'Rework preview cannot be applied.', preview }, 409);

    const proposed = preview.proposed_allotment;
    const sqlParts = [];
    const bindValues = [];
    for (const [key, value] of Object.entries({
      operator_name: proposed.operator_name,
      operator_code: proposed.operator_code,
      source_ref: proposed.source_ref,
      room_type_id: proposed.room_type_id,
      check_in: proposed.check_in,
      check_out: proposed.check_out,
      release_date: proposed.release_date,
      rooms_blocked: proposed.rooms_blocked,
      notes: proposed.notes,
      roh_capacity_filter: proposed.roh_capacity_filter,
    })) {
      if (existing[key] === value) continue;
      sqlParts.push(`${key} = ?`);
      bindValues.push(value);
    }

    const now = currentUnixSeconds();
    if (sqlParts.length) {
      sqlParts.push('updated_by = ?');
      bindValues.push(actor.session.user_id || null);
      sqlParts.push('updated_at = ?');
      bindValues.push(now);
      await env.DB
        .prepare(`UPDATE property_allotments SET ${sqlParts.join(', ')} WHERE id = ? AND tenant_id = ? AND property_id = ?`)
        .bind(...bindValues, allotmentId, tenantId, propertyId)
        .run();
    }

    const releasedAllocations = preview._internal.releasedAllocations || [];
    if (releasedAllocations.length) {
      await env.DB.batch(releasedAllocations.map((allocation) => env.DB.prepare(
        `UPDATE property_allotment_allocations
            SET allocation_status = 'released',
                released_reason = 'allotment_reworked',
                updated_by = ?,
                updated_at = ?
          WHERE id = ? AND tenant_id = ? AND property_id = ?`
      ).bind(actor.session.user_id || null, now, allocation.id, tenantId, propertyId)));
      await env.DB.batch(releasedAllocations.map((allocation) => env.DB.prepare(
        `UPDATE property_allotment_rooming_list_entries
            SET rooming_status = CASE WHEN rooming_status = 'checked_in' THEN rooming_status ELSE 'cancelled' END,
                updated_by = ?,
                updated_at = ?
          WHERE allotment_allocation_id = ? AND tenant_id = ? AND property_id = ? AND allotment_id = ?`
      ).bind(actor.session.user_id || null, now, allocation.id, tenantId, propertyId, allotmentId)));
    }

    const updated = await loadPropertyAllotmentById(env, tenantId, propertyId, allotmentId);
    const additionalNeeded = Number(preview.impact.additional_allocations_needed || 0);
    if (additionalNeeded > 0) {
      const chosenUnits = (preview._internal.candidateUnits || []).slice(0, additionalNeeded);
      await insertPropertyAllotmentAllocations(env, tenantId, propertyId, updated, chosenUnits, actor.session.user_id || null, 'manual_reallocate');
    }

    const allocations = await listActivePropertyAllotmentAllocations(env, tenantId, propertyId, allotmentId);
    if (String(updated.status || '') === 'confirmed') {
      await ensurePropertyAllotmentRoomingListEntries(env, tenantId, propertyId, updated, allocations, actor.session.user_id || null);
      await ensurePropertyAllotmentMasterFolio(env, tenantId, propertyId, updated, actor.session.user_id || null);
    }
    await recordPropertyAllotmentEvent(env, tenantId, propertyId, allotmentId, 'allotment_reworked', existing.status, updated.status, {
      updates: parsed.updates,
      preserved_allocations: Number(preview.impact.preserved_allocations || 0),
      released_allocations: Number(preview.impact.released_allocations || 0),
      additional_allocations_needed: Number(preview.impact.additional_allocations_needed || 0),
      resulting_allocations: allocations.length,
      resulting_room_unit_ids: allocations.map((allocation) => allocation.room_unit_id),
    }, actor.session.user_id || null);
    return jsonResponse({ ok: true, allotment: updated, allocations, preview: sanitizePropertyAllotmentReworkPreview(preview) });
  } catch (error) {
    console.error('[PROPERTY_ALLOTMENT_REWORK_APPLY]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleSplitPropertyAllotment(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const allotmentId = String(params?.allotmentId || '').trim();
  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body;
  try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
  const parsed = validatePropertyAllotmentSplitRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const existing = await loadPropertyAllotmentById(env, tenantId, propertyId, allotmentId);
    if (!existing) return jsonResponse({ error: 'Allotment not found.' }, 404);
    if (String(existing.status || '') !== 'confirmed') return jsonResponse({ error: 'Only confirmed allotments can be split.' }, 409);
    if (!existing.room_type_id) return jsonResponse({ error: 'ROH allotments should use rework instead of split.' }, 409);
    if (Number(parsed.child.rooms_blocked || 0) >= Number(existing.rooms_blocked || 0)) return jsonResponse({ error: 'Split rooms must be less than the current rooms_blocked.' }, 409);
    if (String(parsed.child.room_type_id || '') === String(existing.room_type_id || '')) return jsonResponse({ error: 'Split child must use a different room type.' }, 409);

    const roomTypesResult = await env.DB
      .prepare(`SELECT id, sort_order FROM room_types WHERE tenant_id = ? AND property_id = ? AND active = 1`)
      .bind(tenantId, propertyId)
      .all();
    const roomTypesById = new Map((roomTypesResult.results || []).map((row) => [String(row.id || ''), row]));
    const existingRoomType = roomTypesById.get(String(existing.room_type_id || '')) || null;
    const childRoomType = roomTypesById.get(String(parsed.child.room_type_id || '')) || null;
    if (!childRoomType) return jsonResponse({ error: 'Split room_type_id was not found.' }, 404);
    if (existingRoomType && Number(childRoomType.sort_order || 0) < Number(existingRoomType.sort_order || 0)) {
      return jsonResponse({ error: 'Split downgrade is not approved in this slice.' }, 409);
    }

    const childCheckIn = parsed.child.check_in || existing.check_in;
    const childCheckOut = parsed.child.check_out || existing.check_out;
    if (childCheckIn < existing.check_in || childCheckOut > existing.check_out) {
      return jsonResponse({ error: 'Split child dates must remain inside the source allotment window.' }, 409);
    }

    const remainingRooms = Number(existing.rooms_blocked || 0) - Number(parsed.child.rooms_blocked || 0);
    const originalPreview = await buildPropertyAllotmentReworkPreview(env, tenantId, propertyId, existing, { rooms_blocked: remainingRooms });
    if (!originalPreview.policy.can_apply) return jsonResponse({ error: 'Source allotment cannot be reduced for split.', preview: originalPreview }, 409);

    const preservedOriginalRoomIds = (originalPreview._internal.preservedAllocations || []).map((allocation) => allocation.room_unit_id);
    const childAllotmentShape = {
      ...existing,
      operator_name: parsed.child.operator_name || existing.operator_name,
      operator_code: parsed.child.operator_code || existing.operator_code,
      source_ref: parsed.child.source_ref || existing.source_ref,
      room_type_id: parsed.child.room_type_id,
      check_in: childCheckIn,
      check_out: childCheckOut,
      release_date: parsed.child.release_date || existing.release_date,
      rooms_blocked: parsed.child.rooms_blocked,
      notes: parsed.child.notes || existing.notes,
      roh_capacity_filter: null,
    };
    const childCandidateSummary = await collectAllocatableUnitsForAllotment(env, tenantId, propertyId, childAllotmentShape, {
      excludeAllotmentId: existing.id,
      blockedRoomUnitIds: preservedOriginalRoomIds,
      requiredRooms: Number(parsed.child.rooms_blocked || 0),
    });
    if (childCandidateSummary.error) return jsonResponse({ error: childCandidateSummary.error }, 409);

    const applyRequest = new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify({ rooms_blocked: remainingRooms }) });
    const applyResponse = await handleApplyPropertyAllotmentRework(applyRequest, env, params);
    if (applyResponse.status && applyResponse.status >= 400) return applyResponse;

    const childAllotmentId = nanoid();
    const now = currentUnixSeconds();
    await env.DB.prepare(
      `INSERT INTO property_allotments
        (id, tenant_id, property_id, room_type_id, operator_name, operator_code, source_ref, check_in, check_out, release_date,
         rooms_blocked, status, notes, roh_capacity_filter, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'allocated', ?, NULL, ?, ?, ?, ?)`
    ).bind(
      childAllotmentId,
      tenantId,
      propertyId,
      parsed.child.room_type_id,
      parsed.child.operator_name || existing.operator_name,
      parsed.child.operator_code || existing.operator_code || null,
      parsed.child.source_ref || existing.source_ref || null,
      childCheckIn,
      childCheckOut,
      parsed.child.release_date || existing.release_date || null,
      parsed.child.rooms_blocked,
      parsed.child.notes || existing.notes || null,
      actor.session.user_id || null,
      actor.session.user_id || null,
      now,
      now,
    ).run();
    const childAllotment = await loadPropertyAllotmentById(env, tenantId, propertyId, childAllotmentId);
    await insertPropertyAllotmentAllocations(env, tenantId, propertyId, childAllotment, (childCandidateSummary.candidateUnits || []).slice(0, Number(parsed.child.rooms_blocked || 0)), actor.session.user_id || null, 'manual_split');
    await env.DB.prepare(
      `UPDATE property_allotments SET status = 'confirmed', updated_by = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND property_id = ?`
    ).bind(actor.session.user_id || null, now, childAllotmentId, tenantId, propertyId).run();
    const confirmedChild = await loadPropertyAllotmentById(env, tenantId, propertyId, childAllotmentId);
    const childAllocations = await listActivePropertyAllotmentAllocations(env, tenantId, propertyId, childAllotmentId);
    const childRoomingList = await ensurePropertyAllotmentRoomingListEntries(env, tenantId, propertyId, confirmedChild, childAllocations, actor.session.user_id || null);
    const childMasterFolio = await ensurePropertyAllotmentMasterFolio(env, tenantId, propertyId, confirmedChild, actor.session.user_id || null);
    await recordPropertyAllotmentEvent(env, tenantId, propertyId, childAllotmentId, 'allotment_confirmed', 'allocated', 'confirmed', {
      confirmed_rooms: childAllocations.length,
      room_unit_ids: childAllocations.map((allocation) => allocation.room_unit_id),
      split_from_allotment_id: allotmentId,
      rooming_list_entries_created: childRoomingList.length,
      master_folio_id: childMasterFolio.folio?.id || null,
    }, actor.session.user_id || null);
    await recordPropertyAllotmentEvent(env, tenantId, propertyId, allotmentId, 'allotment_split', existing.status, existing.status, {
      child_allotment_id: childAllotmentId,
      child_room_type_id: parsed.child.room_type_id,
      child_rooms_blocked: parsed.child.rooms_blocked,
    }, actor.session.user_id || null);
    return jsonResponse({ ok: true, source_allotment_id: allotmentId, child_allotment: confirmedChild, child_allocations: childAllocations });
  } catch (error) {
    console.error('[PROPERTY_ALLOTMENT_SPLIT]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleAllocatePropertyAllotment(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const allotmentId = String(params?.allotmentId || '').trim();
  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;

  let body = {};
  try { body = await parseJsonBody(request); } catch { body = {}; }
  const parsed = validatePropertyAllotmentAllocateRequest(body);
  if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

  try {
    const existing = await loadPropertyAllotmentById(env, tenantId, propertyId, allotmentId);
    if (!existing) return jsonResponse({ error: 'Allotment not found.' }, 404);
    if (existing.status !== 'active' || !existing.inventory_blocking) {
      return jsonResponse({ error: 'Only active inventory-blocking allotments can be allocated.' }, 409);
    }

    const allocated = await allocatePropertyAllotmentRooms(env, tenantId, propertyId, existing, actor.session.user_id || null, parsed.allocationSource);
    if (allocated.error) {
      return jsonResponse({ error: allocated.error, available_rooms: allocated.availableRooms ?? null }, 409);
    }

    return jsonResponse({
      ok: true,
      allotment: existing,
      allocations: allocated.allocations,
      already_allocated: Boolean(allocated.alreadyAllocated),
    });
  } catch (error) {
    console.error('[PROPERTY_ALLOTMENT_ALLOCATE]', error);
    return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
  }
}

export async function handleConfirmPropertyAllotment(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
  const propertyId = String(params?.propertyId || '').trim();
  const allotmentId = String(params?.allotmentId || '').trim();
  const actor = await requireManagerActor(request, env, tenantId);
  if (actor.error) return actor.error;

  try {
    const existing = await loadPropertyAllotmentById(env, tenantId, propertyId, allotmentId);
    if (!existing) return jsonResponse({ error: 'Allotment not found.' }, 404);
    if (['confirmed', 'in_house'].includes(String(existing.status || ''))) {
      return jsonResponse({ error: 'Allotment is already confirmed.' }, 409);
    }
    if (['released', 'cancelled', 'expired'].includes(String(existing.status || ''))) {
      return jsonResponse({ error: 'Released, cancelled, or expired allotments cannot be confirmed.' }, 409);
    }

    const activeAllocations = await listActivePropertyAllotmentAllocations(env, tenantId, propertyId, allotmentId);
    const roomsBlocked = Number(existing.rooms_blocked || 0);
    if (activeAllocations.length !== roomsBlocked) {
      return jsonResponse({
        error: 'Allotment must have all rooms allocated before confirmation.',
        allocated_rooms: activeAllocations.length,
        rooms_blocked: roomsBlocked,
      }, 409);
    }

    const now = currentUnixSeconds();
    await env.DB
      .prepare(
        `UPDATE property_allotments
            SET status = 'confirmed',
                updated_by = ?,
                updated_at = ?
          WHERE id = ? AND tenant_id = ? AND property_id = ?`
      )
      .bind(actor.session.user_id || null, now, allotmentId, tenantId, propertyId)
      .run();

    const updated = await loadPropertyAllotmentById(env, tenantId, propertyId, allotmentId);
    const roomingListEntries = await ensurePropertyAllotmentRoomingListEntries(env, tenantId, propertyId, updated, activeAllocations, actor.session.user_id || null);
    const ensuredMasterFolio = await ensurePropertyAllotmentMasterFolio(env, tenantId, propertyId, updated, actor.session.user_id || null);
    await recordPropertyAllotmentEvent(env, tenantId, propertyId, allotmentId, 'allotment_confirmed', existing.status, 'confirmed', {
      confirmed_rooms: activeAllocations.length,
      room_unit_ids: activeAllocations.map((allocation) => allocation.room_unit_id),
      auto_release_locked: true,
      rooming_list_entries_created: roomingListEntries.length,
      master_folio_id: ensuredMasterFolio.folio?.id || null,
    }, actor.session.user_id || null);

    return jsonResponse({ ok: true, allotment: updated, allocations: activeAllocations, rooming_list_entries: roomingListEntries, master_folio: ensuredMasterFolio.folio, confirmed: true });
  } catch (error) {
    console.error('[PROPERTY_ALLOTMENT_CONFIRM]', error);
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

    const now = currentUnixSeconds();
    const activeAllocations = await listActivePropertyAllotmentAllocations(env, tenantId, propertyId, allotmentId);
    await env.DB
      .prepare(
        `UPDATE property_allotment_allocations
            SET allocation_status = 'released',
                released_reason = 'allotment_released',
                updated_by = ?,
                updated_at = ?
          WHERE tenant_id = ?
            AND property_id = ?
            AND allotment_id = ?
            AND allocation_status = 'allocated'`
      )
      .bind(actor.session.user_id || null, now, tenantId, propertyId, allotmentId)
      .run();

    await env.DB
      .prepare(`UPDATE property_allotments SET status = 'released', updated_by = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND property_id = ?`)
      .bind(actor.session.user_id || null, now, allotmentId, tenantId, propertyId)
      .run();

    const updated = await loadPropertyAllotmentById(env, tenantId, propertyId, allotmentId);
    await recordPropertyAllotmentEvent(env, tenantId, propertyId, allotmentId, 'allotment_released', existing.status, updated.status, {
      released_by_policy: false,
      released_allocations: activeAllocations.length,
      room_unit_ids: activeAllocations.map((allocation) => allocation.room_unit_id),
      release_reason: 'manual_release',
    }, actor.session.user_id || null);
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
              ppp.visibility, ppp.pricing_mode, ppp.roh_capacity_filter, ppp.fixed_nightly_amount, ppp.delta_amount, ppp.delta_percent,
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

export const handleListPropertyPricingProfiles = pricingHandlers.handleListPropertyPricingProfiles;
export const handleCreatePropertyPricingProfile = pricingHandlers.handleCreatePropertyPricingProfile;
export const handleUpdatePropertyPricingProfile = pricingHandlers.handleUpdatePropertyPricingProfile;
export const handleListPropertyWeekdayPricingRules = pricingHandlers.handleListPropertyWeekdayPricingRules;
export const handleCreatePropertyWeekdayPricingRule = pricingHandlers.handleCreatePropertyWeekdayPricingRule;
export const handleUpdatePropertyWeekdayPricingRule = pricingHandlers.handleUpdatePropertyWeekdayPricingRule;
export const handleListRoomRates = pricingHandlers.handleListRoomRates;
export const handleListPropertyAddonServicePresets = pricingHandlers.handleListPropertyAddonServicePresets;
export const handleCreatePropertyAddonServicePreset = pricingHandlers.handleCreatePropertyAddonServicePreset;
export const handleSeedPropertyAddonServicePresets = pricingHandlers.handleSeedPropertyAddonServicePresets;
export const handleUpdatePropertyAddonServicePreset = pricingHandlers.handleUpdatePropertyAddonServicePreset;
export const handleCreateRoomRate = pricingHandlers.handleCreateRoomRate;
export const handleUpdateRoomRate = pricingHandlers.handleUpdateRoomRate;
export const handleListRateSeasons = pricingHandlers.handleListRateSeasons;
export const handleCreateRateSeason = pricingHandlers.handleCreateRateSeason;
export const handleUpdateRateSeason = pricingHandlers.handleUpdateRateSeason;
export const handleListSeasonRoomRates = pricingHandlers.handleListSeasonRoomRates;
export const handleCreateSeasonRoomRate = pricingHandlers.handleCreateSeasonRoomRate;
export const handleUpdateSeasonRoomRate = pricingHandlers.handleUpdateSeasonRoomRate;
export const handleQuotePropertyRoomRate = pricingHandlers.handleQuotePropertyRoomRate;

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
  if (allotment.room_type_id && String(allotment.room_type_id || '') !== String(parsedRequest.roomTypeId || '')) {
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

function reservationMatchesRoomingEntry(reservationRecord, roomingEntry) {
  const expectedRoomUnitId = String(roomingEntry?.room_unit_id || '').trim();
  if (!expectedRoomUnitId) return false;
  const assignedRoomUnitId = String(reservationRecord?.reservation?.assigned_room_unit_id || '').trim();
  if (assignedRoomUnitId && assignedRoomUnitId === expectedRoomUnitId) return true;
  return Boolean((reservationRecord?.segments || []).some((segment) => String(segment.room_unit_id || '').trim() === expectedRoomUnitId));
}

async function syncPropertyAllotmentExecutionStatus(env, tenantId, propertyId, allotmentId, actorUserId = null) {
  const allotment = await loadPropertyAllotmentById(env, tenantId, propertyId, allotmentId);
  if (!allotment) return null;
  const entries = await listPropertyAllotmentRoomingListEntries(env, tenantId, propertyId, allotmentId);
  const hasCheckedIn = entries.some((entry) => String(entry.rooming_status || '') === 'checked_in');
  const targetStatus = hasCheckedIn
    ? 'in_house'
    : (String(allotment.status || '') === 'in_house' ? 'confirmed' : String(allotment.status || ''));
  if (targetStatus === String(allotment.status || '')) return allotment;

  await env.DB
    .prepare(
      `UPDATE property_allotments
          SET status = ?,
              updated_by = ?,
              updated_at = ?
        WHERE id = ? AND tenant_id = ? AND property_id = ?`
    )
    .bind(targetStatus, actorUserId || null, currentUnixSeconds(), allotmentId, tenantId, propertyId)
    .run();
  await recordPropertyAllotmentEvent(env, tenantId, propertyId, allotmentId, 'allotment_execution_status_updated', allotment.status, targetStatus, {
    has_checked_in_rooming_entries: hasCheckedIn,
  }, actorUserId || null);
  return loadPropertyAllotmentById(env, tenantId, propertyId, allotmentId);
}

async function consumeDeferredGuestChargesForReservation(env, tenantId, propertyId, allotmentId, roomingEntry, reservationRecord, actorUserId = null) {
  const reservationId = String(reservationRecord?.reservation?.id || '').trim();
  if (!reservationId || !roomingEntry?.id) {
    return { consumedCharges: [], folio: null, summary: null };
  }

  const pendingResult = await env.DB
    .prepare(
      `SELECT id, tenant_id, property_id, allotment_id, rooming_entry_id, reservation_id, line_type, source_type, category,
              description, quantity, unit_amount, total_amount, currency, routing_status, note, created_by, consumed_folio_id,
              consumed_folio_line_id, consumed_at, created_at, updated_at
         FROM property_allotment_deferred_guest_charges
        WHERE tenant_id = ?
          AND property_id = ?
          AND allotment_id = ?
          AND rooming_entry_id = ?
          AND routing_status = 'pending_guest_folio'
        ORDER BY created_at ASC`
    )
    .bind(tenantId, propertyId, allotmentId, roomingEntry.id)
    .all();
  const pendingCharges = (pendingResult.results || []).map(mapPropertyAllotmentDeferredGuestChargeRow);
  if (!pendingCharges.length) {
    return { consumedCharges: [], folio: null, summary: null };
  }

  const folio = await ensureReservationFolio(env, tenantId, propertyId, reservationRecord);
  const now = currentUnixSeconds();
  const insertStatements = [];
  const updateStatements = [];
  const consumedCharges = [];

  for (const charge of pendingCharges) {
    const folioLineId = nanoid();
    insertStatements.push(env.DB.prepare(
      `INSERT INTO folio_lines
        (id, tenant_id, property_id, folio_id, line_type, source_type, category, description,
         quantity, unit_amount, total_amount, currency, status, posted_at, posted_by, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, ?)`
    ).bind(
      folioLineId,
      tenantId,
      propertyId,
      folio.id,
      charge.line_type,
      'allotment_guest_charge',
      charge.category,
      charge.description,
      charge.quantity,
      charge.unit_amount,
      charge.total_amount,
      charge.currency,
      now,
      actorUserId || null,
      charge.note,
      now,
      now,
    ));
    updateStatements.push(env.DB.prepare(
      `UPDATE property_allotment_deferred_guest_charges
          SET reservation_id = ?,
              routing_status = 'posted_to_guest_folio',
              consumed_folio_id = ?,
              consumed_folio_line_id = ?,
              consumed_at = ?,
              updated_at = ?
        WHERE id = ? AND tenant_id = ? AND property_id = ?`
    ).bind(reservationId, folio.id, folioLineId, now, now, charge.id, tenantId, propertyId));
    consumedCharges.push({ ...charge, reservation_id: reservationId, consumed_folio_id: folio.id, consumed_folio_line_id: folioLineId, consumed_at: now, routing_status: 'posted_to_guest_folio' });
  }

  if (insertStatements.length) await env.DB.batch(insertStatements);
  if (updateStatements.length) await env.DB.batch(updateStatements);
  const summary = await recalculateFolioStatus(env, tenantId, propertyId, folio.id);
  return { consumedCharges, folio, summary };
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

export async function runScheduledAllotmentReleaseAutomation(env, now = new Date()) {
  const propertiesResult = await env.DB
    .prepare(
      `SELECT id, tenant_id, timezone
         FROM properties
        WHERE status = 'active'`
    )
    .all();

  let propertyCount = 0;
  let expiredAllotmentCount = 0;
  for (const property of (propertiesResult.results || [])) {
    const timeZone = String(property.timezone || 'Asia/Ho_Chi_Minh').trim() || 'Asia/Ho_Chi_Minh';
    const localDate = formatDateParts(getTimeZoneDateTimeParts(now, timeZone));
    expiredAllotmentCount += await autoReleaseExpiredAllotmentsForProperty(env, String(property.tenant_id), String(property.id), localDate);
    propertyCount += 1;
  }

  return { ok: true, property_count: propertyCount, expired_allotment_count: expiredAllotmentCount };
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

async function ensureReservationNightAuditCharge(env, tenantId, propertyId, folioId, nightly, auditDate, actorUserId = null) {
  const now = currentUnixSeconds();
  const auditToken = `night_audit:${auditDate}`;
  await env.DB
    .prepare(
      `INSERT INTO folio_lines
        (id, tenant_id, property_id, folio_id, line_type, source_type, category, description,
         quantity, unit_amount, total_amount, currency, status, posted_at, posted_by, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'room_charge', 'reservation_system', 'room_rate', ?, 1, ?, ?, ?, 'posted', ?, ?, ?, ?, ?)`
    )
    .bind(
      nanoid(),
      tenantId,
      propertyId,
      folioId,
      `Night audit room charge · ${auditDate}${nightly.season_name ? ` · ${nightly.season_name}` : ''}`,
      nightly.unit_amount,
      nightly.total_amount,
      nightly.currency,
      now,
      actorUserId,
      auditToken,
      now,
      now
    )
    .run();
  await recalculateFolioStatus(env, tenantId, propertyId, folioId);
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
      await ensureReservationNightAuditCharge(env, property.tenant_id, property.id, folio.id, nightly, targetDate, null);
      postedCount += 1;
    }
  }

  return { ok: true, audit_date: targetDate, room_charge_lines_posted: postedCount };
}

export const handleGetPropertyReservationFolio = folioHousekeepingHandlers.handleGetPropertyReservationFolio;
export const handleCreatePropertyReservationFolioLine = folioHousekeepingHandlers.handleCreatePropertyReservationFolioLine;
export const handleCreatePropertyReservationFolioPayment = folioHousekeepingHandlers.handleCreatePropertyReservationFolioPayment;
export const handleUploadReservationGuestPhoto = reservationHandlers.handleUploadReservationGuestPhoto;
export const handleGetReservationGuestPhoto = reservationHandlers.handleGetReservationGuestPhoto;
export const handleListPropertyAvailabilityHolds = planningHandlers.handleListPropertyAvailabilityHolds;
export const handleRunPropertyNightAudit = folioHousekeepingHandlers.handleRunPropertyNightAudit;
export const handleListHousekeepingTasks = folioHousekeepingHandlers.handleListHousekeepingTasks;
export const handleSyncHousekeepingTasks = folioHousekeepingHandlers.handleSyncHousekeepingTasks;
export const handleUpdateHousekeepingTask = folioHousekeepingHandlers.handleUpdateHousekeepingTask;
export const handleCheckPropertyAvailability = planningHandlers.handleCheckPropertyAvailability;
export const handlePlanPropertyReservation = planningHandlers.handlePlanPropertyReservation;
export const handlePlanPropertyReservationExtension = planningHandlers.handlePlanPropertyReservationExtension;
export const handleCreatePropertyAvailabilityHold = planningHandlers.handleCreatePropertyAvailabilityHold;
export const handleCreatePropertyReservation = reservationHandlers.handleCreatePropertyReservation;
export const handleListPropertyReservations = reservationHandlers.handleListPropertyReservations;
export const handleReleasePropertyAvailabilityHold = planningHandlers.handleReleasePropertyAvailabilityHold;
export const handleGetPropertyReservation = reservationHandlers.handleGetPropertyReservation;
export const handleUpdatePropertyReservationAssignment = reservationHandlers.handleUpdatePropertyReservationAssignment;
export const handleCancelPropertyReservation = reservationHandlers.handleCancelPropertyReservation;
export const handleRebookPropertyReservation = reservationHandlers.handleRebookPropertyReservation;
export const handleCheckInPropertyReservation = reservationHandlers.handleCheckInPropertyReservation;
export const handleCheckOutPropertyReservation = reservationHandlers.handleCheckOutPropertyReservation;
export const handleEarlyCheckOutPropertyReservation = reservationHandlers.handleEarlyCheckOutPropertyReservation;
export const handleNoShowPropertyReservation = reservationHandlers.handleNoShowPropertyReservation;
export const handleUndoPropertyReservationStatus = reservationHandlers.handleUndoPropertyReservationStatus;

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

export const handleDeletePropertyPricingProfile = pricingHandlers.handleDeletePropertyPricingProfile;
export const handleDeletePropertyWeekdayPricingRule = pricingHandlers.handleDeletePropertyWeekdayPricingRule;
export const handleDeleteRoomRate = pricingHandlers.handleDeleteRoomRate;
export const handleDeletePropertyAddonServicePreset = pricingHandlers.handleDeletePropertyAddonServicePreset;
export const handleDeleteRateSeason = pricingHandlers.handleDeleteRateSeason;
export const handleDeleteSeasonRoomRate = pricingHandlers.handleDeleteSeasonRoomRate;