import { isIsoDate, parseDateUtc } from './date-utils.js';
import { parseJsonSafe } from './mappers.js';
import {
  HOUSEKEEPING_ROOM_STATES,
  HOUSEKEEPING_TASK_STATUSES,
  PROPERTY_ADDON_PRICING_MODES,
  PROPERTY_ADDON_SCOPES,
  PROPERTY_ADDON_SERVICE_TYPES,
  PROPERTY_ALLOTMENT_MASTER_FOLIO_BILLING_MODES,
  PROPERTY_ALLOTMENT_PAYER_SCOPES,
  PROPERTY_ALLOTMENT_ROOMING_STATUSES,
  PROPERTY_ALLOTMENT_STATUSES,
  PROPERTY_PRICING_PROFILE_MODES,
  PROPERTY_PRICING_PROFILE_VISIBILITIES,
  PROPERTY_RESERVATION_SOURCES,
  PROPERTY_STATUSES,
  PROPERTY_UPGRADE_MODES,
  ROOM_UNIT_OPERATIONAL_STATUSES,
} from './constants.js';

const PROPERTY_ALLOTMENT_ROH_CAPACITY_FILTERS = new Set(['max_2', 'gte_2']);

function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function isTimeString(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function normalizeBooleanInteger(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  return value ? 1 : 0;
}

function normalizeInteger(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  return Number(value);
}

function normalizeOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  return Number(value);
}

function parseReservationPricingSnapshotValue(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  return parseJsonSafe(value);
}

function extractPricingProfileIdFromPricingSnapshot(value) {
  const snapshot = parseReservationPricingSnapshotValue(value);
  const pricingProfileId = snapshot?.pricing_profile_id ?? snapshot?.pricing_profile?.id ?? null;
  return pricingProfileId ? String(pricingProfileId).trim() : null;
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
    addressLine1: body?.address_line_1 ? String(body.address_line_1).trim().slice(0, 255) : null,
    addressLine2: body?.address_line_2 ? String(body.address_line_2).trim().slice(0, 255) : null,
    city: body?.city ? String(body.city).trim().slice(0, 100) : null,
    stateProvince: body?.state_province ? String(body.state_province).trim().slice(0, 100) : null,
    postalCode: body?.postal_code ? String(body.postal_code).trim().slice(0, 20) : null,
    countryCode: body?.country_code ? String(body.country_code).trim().toUpperCase().slice(0, 2) : null,
  };
}

function validatePropertyPatchRequest(body) {
  const allowed = new Set([
    'name', 'slug', 'status', 'timezone', 'currency', 'default_check_in_time', 'default_check_out_time',
    'split_stay_enabled', 'split_stay_public_visible', 'allow_upgrade_to_preserve_stay', 'upgrade_mode',
    'max_room_moves_per_reservation', 'max_upgrade_segments_per_stay', 'max_upgrade_level_jump', 'same_day_turnover_sellable',
    'address_line_1', 'address_line_2', 'city', 'state_province', 'postal_code', 'country_code',
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
  for (const key of ['address_line_1', 'address_line_2', 'city', 'state_province', 'postal_code']) {
    if (key in body) updates[key] = body[key] ? String(body[key]).trim().slice(0, 255) : null;
  }
  if ('country_code' in body) {
    updates.country_code = body.country_code ? String(body.country_code).trim().toUpperCase().slice(0, 2) : null;
  }

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
    doNotDisturb: normalizeBooleanInteger(body?.do_not_disturb, 0),
    roomServiceRequested: normalizeBooleanInteger(body?.room_service_requested, 0),
  };
}

function validateRoomUnitPatchRequest(body) {
  const allowed = new Set(['room_type_id', 'room_number', 'floor_label', 'sort_order', 'active', 'operational_status', 'do_not_disturb', 'room_service_requested']);
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
  if ('do_not_disturb' in body) updates.do_not_disturb = normalizeBooleanInteger(body.do_not_disturb);
  if ('room_service_requested' in body) updates.room_service_requested = normalizeBooleanInteger(body.room_service_requested);
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
    doNotDisturb: normalizeBooleanInteger(body?.do_not_disturb, 0),
    roomServiceRequested: normalizeBooleanInteger(body?.room_service_requested, 0),
  };
}

function validateShiftHandoverPatchRequest(body) {
  const keys = Object.keys(body || {});
  if (!keys.length) return { error: 'No fields provided for update.' };
  const allowed = new Set(['note']);
  const unknown = keys.filter((key) => !allowed.has(key));
  if (unknown.length) return { error: `Unknown fields: ${unknown.join(', ')}.` };
  const note = body?.note ? String(body.note).trim() : null;
  if (note && note.length > 4000) return { error: 'note must be 4000 characters or fewer.' };
  return { note };
}

function validateRoomUnitFlagPatchRequest(body) {
  const keys = Object.keys(body || {});
  if (!keys.length) return { error: 'No fields provided for update.' };
  const allowed = new Set(['do_not_disturb', 'room_service_requested']);
  const unknown = keys.filter((key) => !allowed.has(key));
  if (unknown.length) return { error: `Unknown fields: ${unknown.join(', ')}.` };
  const updates = {};
  if ('do_not_disturb' in body) updates.do_not_disturb = normalizeBooleanInteger(body.do_not_disturb);
  if ('room_service_requested' in body) updates.room_service_requested = normalizeBooleanInteger(body.room_service_requested);
  return { updates };
}

function validatePropertyAllotmentCreateRequest(body, propertyId) {
  const property = String(propertyId || '').trim();
  const roomTypeId = body?.room_type_id == null ? null : (String(body.room_type_id || '').trim() || null);
  const rohCapacityFilter = body?.roh_capacity_filter == null ? null : (String(body.roh_capacity_filter || '').trim() || null);
  const operatorName = String(body?.operator_name || '').trim();
  const operatorCode = body?.operator_code ? String(body.operator_code).trim() : null;
  const sourceRef = body?.source_ref ? String(body.source_ref).trim() : null;
  const checkIn = String(body?.check_in || '').trim();
  const checkOut = String(body?.check_out || '').trim();
  const releaseDate = body?.release_date ? String(body.release_date).trim() : null;
  const roomsBlocked = Number(body?.rooms_blocked ?? 0);
  const notes = body?.notes ? String(body.notes).trim() : null;

  if (!property) return { error: 'propertyId is required.' };
  if (!operatorName) return { error: 'operator_name is required.' };
  if (!isIsoDate(checkIn) || !isIsoDate(checkOut)) return { error: 'check_in and check_out must use YYYY-MM-DD format.' };
  if (parseDateUtc(checkIn) >= parseDateUtc(checkOut)) return { error: 'check_out must be after check_in.' };
  if (releaseDate && !isIsoDate(releaseDate)) return { error: 'release_date must use YYYY-MM-DD format.' };
  if (!Number.isInteger(roomsBlocked) || roomsBlocked < 1 || roomsBlocked > 100) {
    return { error: 'rooms_blocked must be an integer between 1 and 100.' };
  }
  if (roomTypeId == null && rohCapacityFilter && !PROPERTY_ALLOTMENT_ROH_CAPACITY_FILTERS.has(rohCapacityFilter)) {
    return { error: 'roh_capacity_filter is invalid. Use max_2 or gte_2.' };
  }

  return {
    propertyId: property,
    roomTypeId,
    rohCapacityFilter: roomTypeId == null ? (rohCapacityFilter || 'gte_2') : null,
    operatorName,
    operatorCode,
    sourceRef,
    checkIn,
    checkOut,
    releaseDate,
    roomsBlocked,
    notes,
    status: 'active',
  };
}

function validatePropertyAllotmentPatchRequest(body) {
  const allowed = new Set(['operator_name', 'operator_code', 'source_ref', 'check_in', 'check_out', 'release_date', 'rooms_blocked', 'notes', 'status', 'roh_capacity_filter']);
  const keys = Object.keys(body || {});
  if (!keys.length) return { error: 'No fields provided for update.' };
  const unknown = keys.filter((key) => !allowed.has(key));
  if (unknown.length) return { error: `Unknown fields: ${unknown.join(', ')}.` };

  const updates = {};
  if ('operator_name' in body) {
    const value = String(body.operator_name || '').trim();
    if (!value) return { error: 'operator_name cannot be empty.' };
    updates.operator_name = value;
  }
  if ('operator_code' in body) updates.operator_code = body.operator_code ? String(body.operator_code).trim() : null;
  if ('source_ref' in body) updates.source_ref = body.source_ref ? String(body.source_ref).trim() : null;
  if ('check_in' in body) {
    const value = String(body.check_in || '').trim();
    if (!isIsoDate(value)) return { error: 'check_in must use YYYY-MM-DD format.' };
    updates.check_in = value;
  }
  if ('check_out' in body) {
    const value = String(body.check_out || '').trim();
    if (!isIsoDate(value)) return { error: 'check_out must use YYYY-MM-DD format.' };
    updates.check_out = value;
  }
  if ('release_date' in body) {
    const value = body.release_date ? String(body.release_date).trim() : null;
    if (value && !isIsoDate(value)) return { error: 'release_date must use YYYY-MM-DD format.' };
    updates.release_date = value;
  }
  if (('check_in' in updates || 'check_out' in updates) && updates.check_in && updates.check_out && parseDateUtc(updates.check_in) >= parseDateUtc(updates.check_out)) {
    return { error: 'check_out must be after check_in.' };
  }
  if ('rooms_blocked' in body) {
    const value = Number(body.rooms_blocked);
    if (!Number.isInteger(value) || value < 1 || value > 100) return { error: 'rooms_blocked must be an integer between 1 and 100.' };
    updates.rooms_blocked = value;
  }
  if ('roh_capacity_filter' in body) {
    const value = body.roh_capacity_filter == null ? null : (String(body.roh_capacity_filter || '').trim() || null);
    if (value && !PROPERTY_ALLOTMENT_ROH_CAPACITY_FILTERS.has(value)) {
      return { error: 'roh_capacity_filter is invalid. Use max_2 or gte_2.' };
    }
    updates.roh_capacity_filter = value;
  }
  if ('notes' in body) updates.notes = body.notes ? String(body.notes).trim() : null;
  if ('status' in body) {
    const value = String(body.status || '').trim();
    if (!PROPERTY_ALLOTMENT_STATUSES.has(value)) return { error: 'status is invalid.' };
    updates.status = value;
  }
  return { updates };
}

function validatePropertyAllotmentReworkPreviewRequest(body) {
  const allowed = new Set(['operator_name', 'operator_code', 'source_ref', 'room_type_id', 'check_in', 'check_out', 'release_date', 'rooms_blocked', 'notes', 'roh_capacity_filter']);
  const keys = Object.keys(body || {});
  if (!keys.length) return { error: 'No fields provided for preview.' };
  const unknown = keys.filter((key) => !allowed.has(key));
  if (unknown.length) return { error: `Unknown fields: ${unknown.join(', ')}.` };

  const updates = {};
  if ('operator_name' in body) {
    const value = String(body.operator_name || '').trim();
    if (!value) return { error: 'operator_name cannot be empty.' };
    updates.operator_name = value;
  }
  if ('operator_code' in body) updates.operator_code = body.operator_code ? String(body.operator_code).trim() : null;
  if ('source_ref' in body) updates.source_ref = body.source_ref ? String(body.source_ref).trim() : null;
  if ('room_type_id' in body) updates.room_type_id = body.room_type_id == null ? null : (String(body.room_type_id || '').trim() || null);
  if ('check_in' in body) {
    const value = String(body.check_in || '').trim();
    if (!isIsoDate(value)) return { error: 'check_in must use YYYY-MM-DD format.' };
    updates.check_in = value;
  }
  if ('check_out' in body) {
    const value = String(body.check_out || '').trim();
    if (!isIsoDate(value)) return { error: 'check_out must use YYYY-MM-DD format.' };
    updates.check_out = value;
  }
  if ('release_date' in body) {
    const value = body.release_date ? String(body.release_date).trim() : null;
    if (value && !isIsoDate(value)) return { error: 'release_date must use YYYY-MM-DD format.' };
    updates.release_date = value;
  }
  if (('check_in' in updates || 'check_out' in updates) && updates.check_in && updates.check_out && parseDateUtc(updates.check_in) >= parseDateUtc(updates.check_out)) {
    return { error: 'check_out must be after check_in.' };
  }
  if ('rooms_blocked' in body) {
    const value = Number(body.rooms_blocked);
    if (!Number.isInteger(value) || value < 1 || value > 100) return { error: 'rooms_blocked must be an integer between 1 and 100.' };
    updates.rooms_blocked = value;
  }
  if ('roh_capacity_filter' in body) {
    const value = body.roh_capacity_filter == null ? null : (String(body.roh_capacity_filter || '').trim() || null);
    if (value && !PROPERTY_ALLOTMENT_ROH_CAPACITY_FILTERS.has(value)) {
      return { error: 'roh_capacity_filter is invalid. Use max_2 or gte_2.' };
    }
    updates.roh_capacity_filter = value;
  }
  if ('notes' in body) updates.notes = body.notes ? String(body.notes).trim() : null;
  return { updates };
}

function validatePropertyAllotmentSplitRequest(body) {
  const allowed = new Set(['operator_name', 'operator_code', 'source_ref', 'room_type_id', 'check_in', 'check_out', 'release_date', 'rooms_blocked', 'notes']);
  const keys = Object.keys(body || {});
  if (!keys.length) return { error: 'No fields provided for split.' };
  const unknown = keys.filter((key) => !allowed.has(key));
  if (unknown.length) return { error: `Unknown fields: ${unknown.join(', ')}.` };

  const roomTypeId = String(body?.room_type_id || '').trim();
  if (!roomTypeId) return { error: 'room_type_id is required for split.' };

  const roomsBlocked = Number(body?.rooms_blocked ?? 0);
  if (!Number.isInteger(roomsBlocked) || roomsBlocked < 1 || roomsBlocked > 99) {
    return { error: 'rooms_blocked must be an integer between 1 and 99.' };
  }

  const checkIn = body?.check_in == null ? null : String(body.check_in || '').trim();
  const checkOut = body?.check_out == null ? null : String(body.check_out || '').trim();
  if (checkIn && !isIsoDate(checkIn)) return { error: 'check_in must use YYYY-MM-DD format.' };
  if (checkOut && !isIsoDate(checkOut)) return { error: 'check_out must use YYYY-MM-DD format.' };
  if (checkIn && checkOut && parseDateUtc(checkIn) >= parseDateUtc(checkOut)) {
    return { error: 'check_out must be after check_in.' };
  }

  const releaseDate = body?.release_date ? String(body.release_date).trim() : null;
  if (releaseDate && !isIsoDate(releaseDate)) return { error: 'release_date must use YYYY-MM-DD format.' };

  return {
    child: {
      operator_name: body?.operator_name ? String(body.operator_name).trim() : null,
      operator_code: body?.operator_code ? String(body.operator_code).trim() : null,
      source_ref: body?.source_ref ? String(body.source_ref).trim() : null,
      room_type_id: roomTypeId,
      check_in: checkIn,
      check_out: checkOut,
      release_date: releaseDate,
      rooms_blocked: roomsBlocked,
      notes: body?.notes ? String(body.notes).trim() : null,
    },
  };
}

function validatePropertyAllotmentAllocateRequest(body) {
  const allocationSource = String(body?.allocation_source || 'manual_allocate').trim();
  if (!['manual_allocate', 'manual_reallocate'].includes(allocationSource)) {
    return { error: 'allocation_source is invalid.' };
  }
  return { allocationSource };
}

function validatePropertyAllotmentRoomingListPatchRequest(body) {
  const allowed = new Set(['display_name', 'guest_name', 'note', 'rooming_status', 'payer_scope']);
  const keys = Object.keys(body || {});
  if (!keys.length) return { error: 'No fields provided for update.' };
  const unknown = keys.filter((key) => !allowed.has(key));
  if (unknown.length) return { error: `Unknown fields: ${unknown.join(', ')}.` };

  const updates = {};
  if ('display_name' in body) {
    const value = String(body.display_name || '').trim();
    if (!value) return { error: 'display_name cannot be empty.' };
    updates.display_name = value;
  }
  if ('guest_name' in body) updates.guest_name = body.guest_name ? String(body.guest_name).trim() : null;
  if ('note' in body) updates.note = body.note ? String(body.note).trim() : null;
  if ('rooming_status' in body) {
    const value = String(body.rooming_status || '').trim();
    if (!PROPERTY_ALLOTMENT_ROOMING_STATUSES.has(value)) return { error: 'rooming_status is invalid.' };
    updates.rooming_status = value;
  }
  if ('payer_scope' in body) {
    const value = String(body.payer_scope || '').trim();
    if (!PROPERTY_ALLOTMENT_PAYER_SCOPES.has(value)) return { error: 'payer_scope is invalid.' };
    updates.payer_scope = value;
  }
  return { updates };
}

function validatePropertyAllotmentMasterFolioPatchRequest(body) {
  const allowed = new Set(['billing_mode', 'note']);
  const keys = Object.keys(body || {});
  if (!keys.length) return { error: 'No fields provided for update.' };
  const unknown = keys.filter((key) => !allowed.has(key));
  if (unknown.length) return { error: `Unknown fields: ${unknown.join(', ')}.` };

  const updates = {};
  if ('billing_mode' in body) {
    const value = String(body.billing_mode || '').trim();
    if (!PROPERTY_ALLOTMENT_MASTER_FOLIO_BILLING_MODES.has(value)) return { error: 'billing_mode is invalid.' };
    updates.billing_mode = value;
  }
  if ('note' in body) updates.note = body.note ? String(body.note).trim() : null;
  return { updates };
}

function validatePropertyAllotmentChargeRoutingRequest(body) {
  const roomingEntryId = body?.rooming_entry_id ? String(body.rooming_entry_id).trim() : null;
  const lineType = String(body?.line_type || '').trim();
  const category = body?.category ? String(body.category).trim() : null;
  const description = String(body?.description || '').trim();
  const quantity = Number(body?.quantity ?? 1);
  const unitAmount = Number(body?.unit_amount ?? 0);
  const currency = String(body?.currency || 'USD').trim().toUpperCase();
  const note = body?.note ? String(body.note).trim() : null;
  const payerScope = body?.payer_scope ? String(body.payer_scope).trim() : null;

  if (!['room_charge', 'service_charge', 'fee', 'discount', 'refund', 'payment'].includes(lineType)) {
    return { error: 'line_type is invalid.' };
  }
  if (!description) return { error: 'description is required.' };
  if (!Number.isFinite(quantity) || quantity <= 0) return { error: 'quantity must be greater than 0.' };
  if (!Number.isFinite(unitAmount)) return { error: 'unit_amount must be a valid number.' };
  if (payerScope && !PROPERTY_ALLOTMENT_PAYER_SCOPES.has(payerScope)) return { error: 'payer_scope is invalid.' };

  return {
    roomingEntryId,
    lineType,
    category,
    description,
    quantity,
    unitAmount,
    totalAmount: Number((quantity * unitAmount).toFixed(2)),
    currency,
    note,
    payerScope,
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

function validateAddonServicePresetCreateRequest(body) {
  const code = String(body?.code || '').trim().toUpperCase();
  const name = String(body?.name || '').trim();
  const serviceType = String(body?.service_type || 'other').trim();
  const pricingMode = String(body?.pricing_mode || 'fixed').trim();
  const currency = String(body?.currency || 'USD').trim().toUpperCase();
  const defaultUnitPrice = Number(body?.default_unit_price ?? 0);
  const defaultUnitLabel = body?.default_unit_label ? String(body.default_unit_label).trim() : null;
  const scope = String(body?.scope || 'per_stay').trim();
  const sortOrder = normalizeInteger(body?.sort_order, 0);
  const earlyArrivalFee = Number(body?.early_arrival_fee ?? 0);
  const lateCheckoutFee = Number(body?.late_checkout_fee ?? 0);
  const notes = body?.notes ? String(body.notes).trim() : null;
  const rawConfig = body?.config_json !== undefined && body?.config_json !== null && body?.config_json !== ''
    ? (typeof body.config_json === 'string' ? parseJsonSafe(body.config_json) : body.config_json)
    : null;

  if (!code) return { error: 'code is required.' };
  if (!name) return { error: 'name is required.' };
  if (!PROPERTY_ADDON_SERVICE_TYPES.has(serviceType)) return { error: 'service_type is invalid.' };
  if (!PROPERTY_ADDON_PRICING_MODES.has(pricingMode)) return { error: 'pricing_mode is invalid.' };
  if (!PROPERTY_ADDON_SCOPES.has(scope)) return { error: 'scope is invalid.' };
  if (!Number.isFinite(defaultUnitPrice) || defaultUnitPrice < 0) return { error: 'default_unit_price must be a number greater than or equal to 0.' };
  if (!Number.isFinite(earlyArrivalFee) || earlyArrivalFee < 0) return { error: 'early_arrival_fee must be a number greater than or equal to 0.' };
  if (!Number.isFinite(lateCheckoutFee) || lateCheckoutFee < 0) return { error: 'late_checkout_fee must be a number greater than or equal to 0.' };
  if (!Number.isInteger(sortOrder)) return { error: 'sort_order must be an integer.' };

  return {
    code,
    name,
    serviceType,
    pricingMode,
    currency,
    defaultUnitPrice,
    defaultUnitLabel,
    scope,
    earlyArrivalFee,
    lateCheckoutFee,
    active: normalizeBooleanInteger(body?.active, 1),
    sortOrder,
    notes,
    rawConfig,
  };
}

function validateAddonServicePresetPatchRequest(body) {
  const allowed = new Set(['code', 'name', 'service_type', 'pricing_mode', 'currency', 'default_unit_price', 'default_unit_label', 'scope', 'early_arrival_fee', 'late_checkout_fee', 'active', 'sort_order', 'notes', 'config_json']);
  const keys = Object.keys(body || {});
  if (!keys.length) return { error: 'No fields provided for update.' };
  const unknown = keys.filter((key) => !allowed.has(key));
  if (unknown.length) return { error: `Unknown fields: ${unknown.join(', ')}.` };

  const updates = {};
  if ('code' in body) {
    const value = String(body.code || '').trim().toUpperCase();
    if (!value) return { error: 'code cannot be empty.' };
    updates.code = value;
  }
  if ('name' in body) {
    const value = String(body.name || '').trim();
    if (!value) return { error: 'name cannot be empty.' };
    updates.name = value;
  }
  if ('service_type' in body) {
    const value = String(body.service_type || '').trim();
    if (!PROPERTY_ADDON_SERVICE_TYPES.has(value)) return { error: 'service_type is invalid.' };
    updates.service_type = value;
  }
  if ('pricing_mode' in body) {
    const value = String(body.pricing_mode || '').trim();
    if (!PROPERTY_ADDON_PRICING_MODES.has(value)) return { error: 'pricing_mode is invalid.' };
    updates.pricing_mode = value;
  }
  if ('currency' in body) updates.currency = String(body.currency || '').trim().toUpperCase();
  if ('default_unit_price' in body) {
    const value = Number(body.default_unit_price);
    if (!Number.isFinite(value) || value < 0) return { error: 'default_unit_price must be a number greater than or equal to 0.' };
    updates.default_unit_price = value;
  }
  if ('early_arrival_fee' in body) {
    const value = Number(body.early_arrival_fee);
    if (!Number.isFinite(value) || value < 0) return { error: 'early_arrival_fee must be a number greater than or equal to 0.' };
    updates.early_arrival_fee = value;
  }
  if ('late_checkout_fee' in body) {
    const value = Number(body.late_checkout_fee);
    if (!Number.isFinite(value) || value < 0) return { error: 'late_checkout_fee must be a number greater than or equal to 0.' };
    updates.late_checkout_fee = value;
  }
  if ('default_unit_label' in body) updates.default_unit_label = body.default_unit_label ? String(body.default_unit_label).trim() : null;
  if ('scope' in body) {
    const value = String(body.scope || '').trim();
    if (!PROPERTY_ADDON_SCOPES.has(value)) return { error: 'scope is invalid.' };
    updates.scope = value;
  }
  if ('active' in body) updates.active = normalizeBooleanInteger(body.active);
  if ('sort_order' in body) {
    const value = Number(body.sort_order);
    if (!Number.isInteger(value)) return { error: 'sort_order must be an integer.' };
    updates.sort_order = value;
  }
  if ('notes' in body) updates.notes = body.notes ? String(body.notes).trim() : null;
  if ('config_json' in body) updates.config_json = body.config_json !== undefined && body.config_json !== null && body.config_json !== ''
    ? (typeof body.config_json === 'string' ? parseJsonSafe(body.config_json) : body.config_json)
    : null;
  return { updates };
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

function validatePropertyPricingProfileConfiguration(pricingMode, values) {
  const fixedNightlyAmount = values?.fixedNightlyAmount ?? null;
  const deltaAmount = values?.deltaAmount ?? null;
  const deltaPercent = values?.deltaPercent ?? null;

  if (!PROPERTY_PRICING_PROFILE_MODES.has(pricingMode)) {
    return { error: 'pricing_mode is invalid.' };
  }

  if (pricingMode === 'fixed_nightly_amount') {
    if (!Number.isFinite(fixedNightlyAmount) || fixedNightlyAmount < 0) {
      return { error: 'fixed_nightly_amount must be a number greater than or equal to 0 when pricing_mode is fixed_nightly_amount.' };
    }
    return { fixedNightlyAmount, deltaAmount: null, deltaPercent: null };
  }

  if (pricingMode === 'delta_amount') {
    if (!Number.isFinite(deltaAmount)) {
      return { error: 'delta_amount must be a number when pricing_mode is delta_amount.' };
    }
    return { fixedNightlyAmount: null, deltaAmount, deltaPercent: null };
  }

  if (!Number.isFinite(deltaPercent) || deltaPercent <= -100) {
    return { error: 'delta_percent must be a number greater than -100 when pricing_mode is delta_percent.' };
  }
  return { fixedNightlyAmount: null, deltaAmount: null, deltaPercent };
}

function validatePropertyPricingProfileCreateRequest(body, propertyId) {
  const property = String(propertyId || '').trim();
  const roomTypeId = body?.room_type_id == null ? null : (String(body.room_type_id || '').trim() || null);
  const rohCapacityFilter = body?.roh_capacity_filter == null ? null : (String(body.roh_capacity_filter || '').trim() || null);
  const code = String(body?.code || '').trim().toUpperCase();
  const name = String(body?.name || '').trim();
  const visibility = String(body?.visibility || 'planner_only').trim();
  const pricingMode = String(body?.pricing_mode || 'fixed_nightly_amount').trim();
  const fixedNightlyAmount = normalizeOptionalNumber(body?.fixed_nightly_amount);
  const deltaAmount = normalizeOptionalNumber(body?.delta_amount);
  const deltaPercent = normalizeOptionalNumber(body?.delta_percent);
  const notes = body?.notes == null ? null : (String(body.notes).trim() || null);

  if (!property) return { error: 'propertyId is required.' };
  if (!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(code)) {
    return { error: 'code must be 1-40 characters using only A-Z, 0-9, underscore, or hyphen.' };
  }
  if (!name) return { error: 'name is required.' };
  if (!PROPERTY_PRICING_PROFILE_VISIBILITIES.has(visibility)) return { error: 'visibility is invalid.' };
  if (rohCapacityFilter && !PROPERTY_ALLOTMENT_ROH_CAPACITY_FILTERS.has(rohCapacityFilter)) {
    return { error: 'roh_capacity_filter is invalid. Use max_2 or gte_2.' };
  }

  const normalizedConfig = validatePropertyPricingProfileConfiguration(pricingMode, {
    fixedNightlyAmount,
    deltaAmount,
    deltaPercent,
  });
  if (normalizedConfig.error) return normalizedConfig;

  return {
    propertyId: property,
    roomTypeId,
    code,
    name,
    visibility,
    pricingMode,
    rohCapacityFilter: roomTypeId ? null : rohCapacityFilter,
    fixedNightlyAmount: normalizedConfig.fixedNightlyAmount,
    deltaAmount: normalizedConfig.deltaAmount,
    deltaPercent: normalizedConfig.deltaPercent,
    notes,
    active: normalizeBooleanInteger(body?.active, 1),
  };
}

function validatePropertyPricingProfilePatchRequest(body) {
  const allowed = new Set([
    'room_type_id',
    'code',
    'name',
    'visibility',
    'pricing_mode',
    'roh_capacity_filter',
    'fixed_nightly_amount',
    'delta_amount',
    'delta_percent',
    'notes',
    'active',
  ]);
  const keys = Object.keys(body || {});
  if (!keys.length) return { error: 'No fields provided for update.' };
  const unknown = keys.filter((key) => !allowed.has(key));
  if (unknown.length) return { error: `Unknown fields: ${unknown.join(', ')}.` };

  const updates = {};
  if ('room_type_id' in body) {
    updates.room_type_id = body.room_type_id == null ? null : (String(body.room_type_id || '').trim() || null);
  }
  if ('code' in body) {
    const value = String(body.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(value)) {
      return { error: 'code must be 1-40 characters using only A-Z, 0-9, underscore, or hyphen.' };
    }
    updates.code = value;
  }
  if ('name' in body) {
    const value = String(body.name || '').trim();
    if (!value) return { error: 'name cannot be empty.' };
    updates.name = value;
  }
  if ('visibility' in body) {
    const value = String(body.visibility || '').trim();
    if (!PROPERTY_PRICING_PROFILE_VISIBILITIES.has(value)) return { error: 'visibility is invalid.' };
    updates.visibility = value;
  }
  if ('roh_capacity_filter' in body) {
    const value = body.roh_capacity_filter == null ? null : (String(body.roh_capacity_filter || '').trim() || null);
    if (value && !PROPERTY_ALLOTMENT_ROH_CAPACITY_FILTERS.has(value)) {
      return { error: 'roh_capacity_filter is invalid. Use max_2 or gte_2.' };
    }
    updates.roh_capacity_filter = value;
  }
  if ('pricing_mode' in body) {
    const value = String(body.pricing_mode || '').trim();
    if (!PROPERTY_PRICING_PROFILE_MODES.has(value)) return { error: 'pricing_mode is invalid.' };
    updates.pricing_mode = value;
  }
  if ('fixed_nightly_amount' in body) {
    const value = normalizeOptionalNumber(body.fixed_nightly_amount);
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      return { error: 'fixed_nightly_amount must be a number greater than or equal to 0.' };
    }
    updates.fixed_nightly_amount = value;
  }
  if ('delta_amount' in body) {
    const value = normalizeOptionalNumber(body.delta_amount);
    if (value !== null && !Number.isFinite(value)) return { error: 'delta_amount must be a number when provided.' };
    updates.delta_amount = value;
  }
  if ('delta_percent' in body) {
    const value = normalizeOptionalNumber(body.delta_percent);
    if (value !== null && (!Number.isFinite(value) || value <= -100)) {
      return { error: 'delta_percent must be a number greater than -100 when provided.' };
    }
    updates.delta_percent = value;
  }
  if ('notes' in body) {
    updates.notes = body.notes == null ? null : (String(body.notes).trim() || null);
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
  const pricingProfileId = body?.pricing_profile_id ? String(body.pricing_profile_id).trim() : null;
  let roomGuestAssignments = null;

  if (!property) return { error: 'propertyId is required.' };
  if (!roomTypeId) return { error: 'room_type_id is required.' };
  if (!isIsoDate(checkIn) || !isIsoDate(checkOut)) return { error: 'check_in and check_out must use YYYY-MM-DD format.' };
  if (parseDateUtc(checkIn) >= parseDateUtc(checkOut)) return { error: 'check_out must be after check_in.' };
  if (!Number.isInteger(adults) || adults < 1) return { error: 'adults must be an integer greater than or equal to 1.' };
  if (!Number.isInteger(children) || children < 0) return { error: 'children must be an integer greater than or equal to 0.' };
  if (!Number.isInteger(roomsRequested) || roomsRequested < 1 || roomsRequested > 20) {
    return { error: 'rooms_requested must be an integer between 1 and 20.' };
  }

  if (body?.room_guest_assignments !== undefined) {
    try {
      roomGuestAssignments = Array.isArray(body.room_guest_assignments)
        ? body.room_guest_assignments
        : JSON.parse(String(body.room_guest_assignments || '[]'));
    } catch {
      return { error: 'room_guest_assignments must be valid JSON when provided.' };
    }
    if (!Array.isArray(roomGuestAssignments) || roomGuestAssignments.length !== roomsRequested) {
      return { error: 'room_guest_assignments must contain exactly one entry per requested room.' };
    }

    let assignedAdults = 0;
    let assignedChildren = 0;
    roomGuestAssignments = roomGuestAssignments.map((assignment, index) => {
      const assignedAdultsValue = Number(assignment?.adults ?? 0);
      const assignedChildrenValue = Number(assignment?.children ?? 0);
      if (!Number.isInteger(assignedAdultsValue) || assignedAdultsValue < 0) {
        throw new Error(`room_guest_assignments[${index}].adults must be an integer greater than or equal to 0.`);
      }
      if (!Number.isInteger(assignedChildrenValue) || assignedChildrenValue < 0) {
        throw new Error(`room_guest_assignments[${index}].children must be an integer greater than or equal to 0.`);
      }
      if (assignedAdultsValue + assignedChildrenValue < 1) {
        throw new Error(`room_guest_assignments[${index}] must contain at least one guest.`);
      }
      assignedAdults += assignedAdultsValue;
      assignedChildren += assignedChildrenValue;
      return {
        room_index: index + 1,
        adults: assignedAdultsValue,
        children: assignedChildrenValue,
        label: assignment?.label ? String(assignment.label).trim() : `Room ${index + 1}`,
      };
    });

    if (assignedAdults !== adults || assignedChildren !== children) {
      return { error: 'room_guest_assignments totals must match the top-level adults and children counts.' };
    }
  }

  return { propertyId: property, roomTypeId, checkIn, checkOut, adults, children, roomsRequested, roomGuestAssignments, pricingProfileId };
}

function validatePropertyWeekdayPricingRuleCreateRequest(body, propertyId) {
  const property = String(propertyId || '').trim();
  const roomTypeId = body?.room_type_id == null ? null : (String(body.room_type_id || '').trim() || null);
  const dayOfWeek = Number(body?.day_of_week);
  const name = String(body?.name || '').trim();
  const pricingMode = String(body?.pricing_mode || 'fixed_nightly_amount').trim();
  const fixedNightlyAmount = normalizeOptionalNumber(body?.fixed_nightly_amount);
  const deltaAmount = normalizeOptionalNumber(body?.delta_amount);
  const deltaPercent = normalizeOptionalNumber(body?.delta_percent);
  const notes = body?.notes == null ? null : (String(body.notes).trim() || null);

  if (!property) return { error: 'propertyId is required.' };
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    return { error: 'day_of_week must be an integer between 0 (Sunday) and 6 (Saturday).' };
  }
  if (!name) return { error: 'name is required.' };

  const normalizedConfig = validatePropertyPricingProfileConfiguration(pricingMode, {
    fixedNightlyAmount,
    deltaAmount,
    deltaPercent,
  });
  if (normalizedConfig.error) return normalizedConfig;

  return {
    propertyId: property,
    roomTypeId,
    dayOfWeek,
    name,
    pricingMode,
    fixedNightlyAmount: normalizedConfig.fixedNightlyAmount,
    deltaAmount: normalizedConfig.deltaAmount,
    deltaPercent: normalizedConfig.deltaPercent,
    notes,
    active: normalizeBooleanInteger(body?.active, 1),
  };
}

function validatePropertyWeekdayPricingRulePatchRequest(body) {
  const allowed = new Set([
    'room_type_id',
    'day_of_week',
    'name',
    'pricing_mode',
    'fixed_nightly_amount',
    'delta_amount',
    'delta_percent',
    'notes',
    'active',
  ]);
  const keys = Object.keys(body || {});
  if (!keys.length) return { error: 'No fields provided for update.' };
  const unknown = keys.filter((key) => !allowed.has(key));
  if (unknown.length) return { error: `Unknown fields: ${unknown.join(', ')}.` };

  const updates = {};
  if ('room_type_id' in body) {
    updates.room_type_id = body.room_type_id == null ? null : (String(body.room_type_id || '').trim() || null);
  }
  if ('day_of_week' in body) {
    const value = Number(body.day_of_week);
    if (!Number.isInteger(value) || value < 0 || value > 6) {
      return { error: 'day_of_week must be an integer between 0 (Sunday) and 6 (Saturday).' };
    }
    updates.day_of_week = value;
  }
  if ('name' in body) {
    const value = String(body.name || '').trim();
    if (!value) return { error: 'name cannot be empty.' };
    updates.name = value;
  }
  if ('pricing_mode' in body) {
    const value = String(body.pricing_mode || '').trim();
    if (!PROPERTY_PRICING_PROFILE_MODES.has(value)) return { error: 'pricing_mode is invalid.' };
    updates.pricing_mode = value;
  }
  if ('fixed_nightly_amount' in body) {
    const value = normalizeOptionalNumber(body.fixed_nightly_amount);
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      return { error: 'fixed_nightly_amount must be a number greater than or equal to 0.' };
    }
    updates.fixed_nightly_amount = value;
  }
  if ('delta_amount' in body) {
    const value = normalizeOptionalNumber(body.delta_amount);
    if (value !== null && !Number.isFinite(value)) return { error: 'delta_amount must be a number when provided.' };
    updates.delta_amount = value;
  }
  if ('delta_percent' in body) {
    const value = normalizeOptionalNumber(body.delta_percent);
    if (value !== null && (!Number.isFinite(value) || value <= -100)) {
      return { error: 'delta_percent must be a number greater than -100 when provided.' };
    }
    updates.delta_percent = value;
  }
  if ('notes' in body) updates.notes = body.notes == null ? null : (String(body.notes).trim() || null);
  if ('active' in body) updates.active = normalizeBooleanInteger(body.active);
  return { updates };
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
  const preferredRoomUnitId = body?.preferred_room_unit_id ? String(body.preferred_room_unit_id).trim() : null;
  const allotmentId = body?.allotment_id ? String(body.allotment_id).trim() : null;
  const normalizedPropertyId = String(propertyId || '').trim();

  if (!normalizedPropertyId || (!roomTypeId && !allotmentId) || !isIsoDate(checkIn) || !isIsoDate(checkOut)) {
    return { error: 'propertyId, check_in, and check_out are required. room_type_id is required unless allotment_id is provided.' };
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
    preferredRoomUnitId,
    allotmentId,
  };
}

function validatePlannerPricingPreviewRequest(body) {
  const adults = Number(body?.adults ?? 1);
  const children = Number(body?.children ?? 0);
  const pricingProfileId = body?.pricing_profile_id ? String(body.pricing_profile_id).trim() : null;
  const scarcityEnabled = Boolean(body?.scarcity_preview?.enabled);
  const thresholdRemaining = body?.scarcity_preview?.threshold_remaining == null ? 1 : Number(body.scarcity_preview.threshold_remaining);
  const surchargeAmount = body?.scarcity_preview?.surcharge_amount == null ? 0 : Number(body.scarcity_preview.surcharge_amount);
  const maxTotalAmount = body?.scarcity_preview?.max_total_amount == null ? 0 : Number(body.scarcity_preview.max_total_amount);

  if (!Number.isInteger(adults) || adults < 1) {
    return { error: 'adults must be an integer greater than 0.' };
  }
  if (!Number.isInteger(children) || children < 0) {
    return { error: 'children must be an integer greater than or equal to 0.' };
  }
  if (!Number.isInteger(thresholdRemaining) || thresholdRemaining < 0 || thresholdRemaining > 20) {
    return { error: 'scarcity_preview.threshold_remaining must be an integer between 0 and 20.' };
  }
  if (!Number.isFinite(surchargeAmount) || surchargeAmount < 0) {
    return { error: 'scarcity_preview.surcharge_amount must be a number greater than or equal to 0.' };
  }
  if (!Number.isFinite(maxTotalAmount) || maxTotalAmount < 0) {
    return { error: 'scarcity_preview.max_total_amount must be a number greater than or equal to 0.' };
  }

  return {
    adults,
    children,
    pricingProfileId,
    scarcityPreview: {
      enabled: scarcityEnabled,
      thresholdRemaining,
      surchargeAmount,
      maxTotalAmount,
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
  const pricingProfileId = body?.pricing_profile_id
    ? String(body.pricing_profile_id).trim()
    : extractPricingProfileIdFromPricingSnapshot(body?.pricing_snapshot);
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

  if (holdId && availability.allotmentId) {
    return { error: 'hold_id and allotment_id cannot be used together.' };
  }

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
    pricingProfileId,
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

function validateReservationRoomAssignmentRequest(body) {
  const hasField = Object.prototype.hasOwnProperty.call(body || {}, 'assigned_room_unit_id');
  if (!hasField) return { error: 'assigned_room_unit_id is required.' };
  return {
    assignedRoomUnitId: body?.assigned_room_unit_id ? String(body.assigned_room_unit_id).trim() : null,
  };
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
  const pricingProfileId = body?.pricing_profile_id
    ? String(body.pricing_profile_id).trim()
    : (
        extractPricingProfileIdFromPricingSnapshot(body?.pricing_snapshot)
        || extractPricingProfileIdFromPricingSnapshot(existingReservation?.pricing_snapshot)
      );
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
    pricingProfileId,
    pricingSnapshot,
    holdId,
  };
}

function validateFolioChargeRequest(body) {
  const description = String(body?.description || '').trim();
  const category = body?.category ? String(body.category).trim() : null;
  const quantity = Number(body?.quantity ?? 1);
  const unitAmount = Number(body?.unit_amount ?? 0);
  const currency = body?.currency ? String(body.currency).trim().toUpperCase() : null;
  const note = body?.note ? String(body.note).trim() : null;
  const lineType = String(body?.line_type || 'service_charge').trim();
  const sourceType = String(body?.source_type || 'manual_frontdesk').trim();

  if (!description) return { error: 'description is required.' };
  if (!['service_charge', 'fee'].includes(lineType)) return { error: 'line_type must be service_charge or fee.' };
  if (!['manual_frontdesk', 'manual_manager', 'reservation_system', 'imported'].includes(sourceType)) return { error: 'source_type is invalid.' };
  if (!Number.isFinite(quantity) || quantity <= 0) return { error: 'quantity must be a number greater than 0.' };
  if (!Number.isFinite(unitAmount) || unitAmount < 0) return { error: 'unit_amount must be a number greater than or equal to 0.' };

  return { description, category, quantity, unitAmount, currency, note, lineType, sourceType };
}

function validateFolioPaymentRequest(body) {
  const amount = Number(body?.amount ?? 0);
  const method = String(body?.method || '').trim().toLowerCase();
  const note = body?.note ? String(body.note).trim() : null;
  const currency = body?.currency ? String(body.currency).trim().toUpperCase() : null;
  if (!['cash', 'card', 'bank_transfer', 'other'].includes(method)) return { error: 'method must be cash, card, bank_transfer, or other.' };
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'amount must be a number greater than 0.' };
  return { amount, method, note, currency };
}

function validateHousekeepingTaskPatchRequest(body) {
  const keys = Object.keys(body || {});
  if (!keys.length) return { error: 'No fields provided for update.' };
  const allowed = new Set(['status', 'assigned_user_id', 'note', 'room_state']);
  const unknown = keys.filter((key) => !allowed.has(key));
  if (unknown.length) return { error: `Unknown fields: ${unknown.join(', ')}.` };
  const updates = {};
  let roomState = null;
  if ('status' in body) {
    const status = String(body.status || '').trim();
    if (!HOUSEKEEPING_TASK_STATUSES.has(status)) return { error: 'status is invalid.' };
    updates.status = status;
  }
  if ('assigned_user_id' in body) updates.assigned_user_id = body.assigned_user_id ? String(body.assigned_user_id).trim() : null;
  if ('note' in body) updates.note = body.note ? String(body.note).trim() : null;
  if ('room_state' in body) {
    roomState = String(body.room_state || '').trim();
    if (!HOUSEKEEPING_ROOM_STATES.has(roomState)) return { error: 'room_state is invalid.' };
  }
  return { updates, roomState };
}

export {
  extractPricingProfileIdFromPricingSnapshot,
  normalizeBooleanInteger,
  normalizeInteger,
  normalizeOptionalNumber,
  validateAddonServicePresetCreateRequest,
  validateAddonServicePresetPatchRequest,
  validateAvailabilityRequest,
  validateEarlyCheckoutRequest,
  validateFolioChargeRequest,
  validateFolioPaymentRequest,
  validateHousekeepingTaskPatchRequest,
  validatePlannerPricingPreviewRequest,
  validatePropertyAllotmentCreateRequest,
  validatePropertyAllotmentAllocateRequest,
  validatePropertyAllotmentChargeRoutingRequest,
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
};