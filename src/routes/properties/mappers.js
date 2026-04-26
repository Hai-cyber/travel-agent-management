const PROPERTY_WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const AIRPORT_PICKUP_ADDON_CODES = new Set(['AIRPORT-PICKUP', 'AIRPORT-ARRIVAL']);

function parseJsonSafe(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isAirportPickupAddonPreset(serviceType, code, name) {
  if (String(serviceType || '').trim() !== 'transfer') return false;
  const normalizedCode = String(code || '').trim().toUpperCase();
  const normalizedName = String(name || '').trim().toLowerCase();
  return AIRPORT_PICKUP_ADDON_CODES.has(normalizedCode)
    || normalizedName.includes('airport pickup')
    || normalizedName.includes('airport arrival');
}

function buildAddonSalesPolicy(serviceType, code, name) {
  const prearrivalException = isAirportPickupAddonPreset(serviceType, code, name);
  return {
    sales_channel: 'onsite_only',
    onsite_only: true,
    prearrival_exception: prearrivalException,
    exception_reason: prearrivalException ? 'airport_pickup' : null,
  };
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
    do_not_disturb: Boolean(row.do_not_disturb),
    room_service_requested: Boolean(row.room_service_requested),
  };
}

function mapRoomRateRow(row) {
  return {
    ...row,
    active: Boolean(row.active),
  };
}

function mapPropertyPricingProfileRow(row) {
  return {
    ...row,
    active: Boolean(row.active),
    scope: row.room_type_id ? 'room_type' : 'property',
    roh_capacity_filter: row.room_type_id ? null : (String(row.roh_capacity_filter || '').trim() || null),
    fixed_nightly_amount: row.fixed_nightly_amount == null ? null : Number(row.fixed_nightly_amount),
    delta_amount: row.delta_amount == null ? null : Number(row.delta_amount),
    delta_percent: row.delta_percent == null ? null : Number(row.delta_percent),
  };
}

function mapPropertyWeekdayPricingRuleRow(row) {
  const dayOfWeek = Number(row.day_of_week);
  return {
    ...row,
    day_of_week: dayOfWeek,
    day_name: PROPERTY_WEEKDAY_NAMES[dayOfWeek] || `Day ${dayOfWeek}`,
    active: Boolean(row.active),
    scope: row.room_type_id ? 'room_type' : 'property',
    fixed_nightly_amount: row.fixed_nightly_amount == null ? null : Number(row.fixed_nightly_amount),
    delta_amount: row.delta_amount == null ? null : Number(row.delta_amount),
    delta_percent: row.delta_percent == null ? null : Number(row.delta_percent),
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

function mapAddonServicePresetRow(row) {
  const parsedConfig = parseJsonSafe(row.config_json);
  return {
    ...row,
    active: Boolean(row.active),
    early_arrival_fee: Number(row.early_arrival_fee || 0),
    late_checkout_fee: Number(row.late_checkout_fee || 0),
    config_json: parsedConfig,
    sales_policy: buildAddonSalesPolicy(row.service_type, row.code, row.name),
    onsite_only: true,
    prearrival_exception: isAirportPickupAddonPreset(row.service_type, row.code, row.name),
  };
}

function mapPropertyAllotmentRow(row) {
  const rohCapacityFilter = row.room_type_id
    ? null
    : (String(row.roh_capacity_filter || '').trim() || 'max_2');
  return {
    ...row,
    rooms_blocked: Number(row.rooms_blocked || 0),
    roh_capacity_filter: rohCapacityFilter,
    inventory_blocking: Boolean(row.inventory_blocking),
    commitment_blocking: Boolean(row.inventory_blocking),
    auto_release_enabled: Boolean(row.auto_release_enabled),
    auto_release_state: row.auto_release_state || 'none',
    auto_release_due: row.release_date || null,
  };
}

function mapPropertyAllotmentAllocationRow(row) {
  return {
    ...row,
    inventory_blocking: String(row.allocation_status || 'allocated') === 'allocated',
  };
}

function mapPropertyAllotmentRoomingListEntryRow(row) {
  return {
    ...row,
    reservation_id: row.reservation_id || null,
    guest_name: row.guest_name || null,
    note: row.note || null,
  };
}

function mapPropertyAllotmentMasterFolioRow(row) {
  return {
    ...row,
    note: row.note || null,
  };
}

function mapPropertyAllotmentMasterFolioLineRow(row) {
  return {
    ...row,
    note: row.note || null,
  };
}

function mapPropertyAllotmentDeferredGuestChargeRow(row) {
  return {
    ...row,
    reservation_id: row.reservation_id || null,
    consumed_folio_id: row.consumed_folio_id || null,
    consumed_folio_line_id: row.consumed_folio_line_id || null,
    note: row.note || null,
  };
}

export {
  PROPERTY_WEEKDAY_NAMES,
  buildAddonSalesPolicy,
  mapAddonServicePresetRow,
  mapPropertyAllotmentRow,
  mapPropertyAllotmentAllocationRow,
  mapPropertyAllotmentMasterFolioRow,
  mapPropertyAllotmentMasterFolioLineRow,
  mapPropertyAllotmentDeferredGuestChargeRow,
  mapPropertyAllotmentRoomingListEntryRow,
  mapPropertyPricingProfileRow,
  mapPropertyRow,
  mapPropertyWeekdayPricingRuleRow,
  mapRateSeasonRow,
  mapRoomRateRow,
  mapRoomTypeRow,
  mapRoomUnitRow,
  mapSeasonRateRow,
  parseJsonSafe,
};