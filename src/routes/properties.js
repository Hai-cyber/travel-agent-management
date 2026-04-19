import { nanoid } from 'nanoid';

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

async function loadAvailabilityInputs(env, tenantId, propertyId, startDate, endDate, options = {}) {
  const excludeHoldId = options.excludeHoldId ? String(options.excludeHoldId) : null;
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
    allocations: allocationsResult.results || [],
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

async function createReservationArtifacts(env, tenantId, reservationId, propertyId, reservationInput, selectedPlan) {
  const now = currentUnixSeconds();
  const stayPlanId = nanoid();
  const planSegments = selectedPlan.segments || [];

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

  return { stayPlanId, confirmedAt: now };
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