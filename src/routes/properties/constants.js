const PROPERTY_UPGRADE_MODES = new Set(['off', 'suggest_only', 'auto_if_penalty_better']);
const ROOM_UNIT_OPERATIONAL_STATUSES = new Set(['ready', 'maintenance', 'out_of_order']);
const HOUSEKEEPING_TASK_STATUSES = new Set(['pending', 'in_progress', 'waiting_inspection', 'completed', 'cancelled']);
const HOUSEKEEPING_ROOM_STATES = new Set(['dirty', 'cleaning', 'ready_for_inspection', 'inspected', 'ready']);
const HOUSEKEEPING_TASK_KINDS = new Set(['departure_clean', 'stayover_refresh']);
const HOUSEKEEPING_TASK_PRIORITIES = new Set(['arrival_today_high', 'arrival_today_normal', 'departure_clean', 'routine', 'blocked_maintenance']);
const PROPERTY_ADDON_SERVICE_TYPES = new Set(['transfer', 'meal', 'wellness', 'housekeeping', 'transport', 'experience', 'fee', 'other']);
const PROPERTY_ADDON_PRICING_MODES = new Set(['fixed', 'per_unit', 'per_guest', 'per_night']);
const PROPERTY_ADDON_SCOPES = new Set(['per_stay', 'per_night', 'per_guest', 'per_room']);
const PROPERTY_ALLOTMENT_STATUSES = new Set([
  'draft',
  'active',
  'allocated',
  'confirmed',
  'in_house',
  'released',
  'cancelled',
  'expired',
]);
const PROPERTY_ALLOTMENT_COMMITMENT_STATUSES = new Set(['draft', 'active', 'allocated', 'confirmed', 'in_house']);
const PROPERTY_ALLOTMENT_ROOMING_STATUSES = new Set(['pending', 'named', 'checked_in', 'checked_out', 'cancelled']);
const PROPERTY_ALLOTMENT_MASTER_FOLIO_BILLING_MODES = new Set(['master_only', 'guest_only', 'mixed']);
const PROPERTY_ALLOTMENT_PAYER_SCOPES = new Set(['master', 'guest']);
const PROPERTY_PRICING_PROFILE_VISIBILITIES = new Set(['planner_only']);
const PROPERTY_PRICING_PROFILE_MODES = new Set(['fixed_nightly_amount', 'delta_amount', 'delta_percent']);
const PROPERTY_RESERVATION_SOURCES = new Set([
  'direct_web',
  'direct_phone',
  'manual_frontdesk',
  'ota_booking',
  'sales_manual',
]);
const PROPERTY_STATUSES = new Set(['draft', 'active', 'inactive']);
const PROPERTY_WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const AIRPORT_PICKUP_ADDON_CODES = new Set(['AIRPORT-PICKUP', 'AIRPORT-ARRIVAL']);

export {
  AIRPORT_PICKUP_ADDON_CODES,
  HOUSEKEEPING_ROOM_STATES,
  HOUSEKEEPING_TASK_KINDS,
  HOUSEKEEPING_TASK_PRIORITIES,
  HOUSEKEEPING_TASK_STATUSES,
  PROPERTY_ADDON_PRICING_MODES,
  PROPERTY_ADDON_SCOPES,
  PROPERTY_ADDON_SERVICE_TYPES,
  PROPERTY_ALLOTMENT_COMMITMENT_STATUSES,
  PROPERTY_ALLOTMENT_MASTER_FOLIO_BILLING_MODES,
  PROPERTY_ALLOTMENT_PAYER_SCOPES,
  PROPERTY_ALLOTMENT_ROOMING_STATUSES,
  PROPERTY_ALLOTMENT_STATUSES,
  PROPERTY_PRICING_PROFILE_MODES,
  PROPERTY_PRICING_PROFILE_VISIBILITIES,
  PROPERTY_RESERVATION_SOURCES,
  PROPERTY_STATUSES,
  PROPERTY_UPGRADE_MODES,
  PROPERTY_WEEKDAY_NAMES,
  ROOM_UNIT_OPERATIONAL_STATUSES,
};