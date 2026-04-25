import { nanoid } from 'nanoid';

import {
  currentUnixSeconds,
  isIsoDate,
  parseDateUtc,
} from './date-utils.js';
import {
  buildAllotmentConsumptionSummary,
  buildAvailabilityPayload,
  buildPreferredRoomUnitConflicts,
  buildReservationPlanningConflicts,
  buildReservationPlanningPayload,
  calculateAvailability,
  selectBestPlan,
} from './availability.js';
import { buildSelectedPlanPricingPreview } from './pricing.js';
import {
  loadPropertyReservation,
  reservationPrimaryRoomUnitId,
} from './reservations.js';

function createPlanningHandlers(deps) {
  const {
    resolveTenantId,
    jsonResponse,
    parseJsonBody,
    requireTenantActor,
    validateAvailabilityRequest,
    validatePlannerPricingPreviewRequest,
    loadPropertyAllotmentById,
    validateAllotmentConsumptionRequest,
    loadPropertyById,
    loadActiveHold,
    loadRoomUnitById,
    pricingDeps,
    availabilityDeps,
  } = deps;

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

  async function handleListPropertyAvailabilityHolds(request, env, params) {
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

  async function handleCheckPropertyAvailability(request, env, params) {
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
        parsedRequest.roomsRequested,
        {
          adults: Number(body?.adults ?? 1),
          children: Number(body?.children ?? 0),
        }
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

  async function handlePlanPropertyReservation(request, env, params) {
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
          adults: pricingPreviewRequest.adults,
          children: pricingPreviewRequest.children,
          activeAllotment,
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
            {},
            availabilityDeps,
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
        }, pricingDeps);
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

  async function handlePlanPropertyReservationExtension(request, env, params) {
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
        {
          excludeReservationId: reservationId,
          adults: Number(record.reservation.adults || 1),
          children: Number(record.reservation.children || 0),
        }
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

  async function handleCreatePropertyAvailabilityHold(request, env, params) {
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
        parsedRequest.roomsRequested,
        {
          adults: Number(body?.adults ?? 1),
          children: Number(body?.children ?? 0),
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
        parsedRequest.roomsRequested,
        {
          adults: Number(body?.adults ?? 1),
          children: Number(body?.children ?? 0),
        }
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

  async function handleReleasePropertyAvailabilityHold(request, env, params) {
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

  return {
    handleCheckPropertyAvailability,
    handleCreatePropertyAvailabilityHold,
    handleListPropertyAvailabilityHolds,
    handlePlanPropertyReservation,
    handlePlanPropertyReservationExtension,
    handleReleasePropertyAvailabilityHold,
  };
}

export { createPlanningHandlers };