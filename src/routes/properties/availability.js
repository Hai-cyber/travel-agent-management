import {
  addDays,
  currentUnixSeconds,
  enumerateDateRange,
  enumerateStayDates,
  formatDateUtc,
  parseDateUtc,
} from './date-utils.js';

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

  return { roomTypeNightCounts };
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

async function buildPreferredRoomUnitConflicts(env, tenantId, propertyId, roomTypeId, roomUnitId, checkIn, checkOut, options = {}, deps) {
  const normalizedRoomUnitId = String(roomUnitId || '').trim();
  if (!normalizedRoomUnitId) return { roomUnit: null, conflicts: [] };

  const roomUnit = await deps.loadRoomUnitById(env, tenantId, propertyId, normalizedRoomUnitId);
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

function selectBestPlan(availability) {
  return Array.isArray(availability?.stayPlans) && availability.stayPlans.length ? availability.stayPlans[0] : null;
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

export {
  buildAllotmentConsumptionSummary,
  buildAvailabilityPayload,
  buildPreferredRoomUnitConflicts,
  buildReservationPlanningConflicts,
  buildReservationPlanningPayload,
  calculateAvailability,
  selectBestPlan,
};