import { nanoid } from 'nanoid';

import {
  currentUnixSeconds,
  enumerateStayDates,
} from './date-utils.js';
import { parseJsonSafe } from './mappers.js';

function buildReservationGuestPhotoUrl(propertyId, reservationId, guestPhotoKey) {
  if (!guestPhotoKey) return null;
  return `/api/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/guest-photo`;
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
  const sourcePayload = record.reservation.source_payload ? parseJsonSafe(record.reservation.source_payload) : null;
  return {
    ok: true,
    reservation: {
      id: record.reservation.id,
      property_id: record.reservation.property_id,
      source: record.reservation.source,
      source_ref: record.reservation.source_ref,
      source_payload: sourcePayload,
      status: record.reservation.status,
      guest_name: record.reservation.guest_name,
      guest_email: record.reservation.guest_email,
      guest_phone: record.reservation.guest_phone,
      guest_profile: sourcePayload?.guest_profile || null,
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

function reservationPrimaryRoomUnitId(record) {
  return String(
    record?.reservation?.assigned_room_unit_id
      || record?.segments?.[0]?.room_unit_id
      || record?.allocations?.[0]?.room_unit_id
      || ''
  ).trim() || null;
}

export {
  attachSelectedStayPlanArtifacts,
  buildReservationBoardSummary,
  buildReservationPayload,
  createReservationArtifacts,
  deriveAssignedRoomUnitId,
  discardReservationStayPlanState,
  loadPropertyReservation,
  recordPropertyReservationEvent,
  reservationPrimaryRoomUnitId,
  validateReservationStatusTransition,
};