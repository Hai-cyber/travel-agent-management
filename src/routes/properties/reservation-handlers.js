import { nanoid } from 'nanoid';

import {
  currentUnixSeconds,
  enumerateStayDates,
  formatDateUtc,
} from './date-utils.js';
import {
  buildAllotmentConsumptionSummary,
  buildAvailabilityPayload,
  calculateAvailability,
  selectBestPlan,
} from './availability.js';
import { resolveFrozenReservationPricingSnapshot } from './pricing.js';
import {
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
} from './reservations.js';

function createReservationHandlers(deps) {
  const {
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
  } = deps;

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

  async function handleCreatePropertyReservation(request, env, params) {
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
        if (!parsedRequest.pricingProfileId && activeAllotment?.pricing_profile_id) {
          parsedRequest.pricingProfileId = String(activeAllotment.pricing_profile_id).trim() || null;
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
          adults: parsedRequest.adults,
          children: parsedRequest.children,
          activeAllotment,
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

      if (!parsedRequest.roomTypeId) {
        parsedRequest.roomTypeId = String(selectedPlan.segments?.[0]?.room_type_id || '').trim() || null;
      }

      const reservationId = nanoid();
      const confirmedAt = currentUnixSeconds();
      const frozenPricing = await resolveFrozenReservationPricingSnapshot(env, tenantId, parsedRequest.propertyId, parsedRequest, {
        fallbackSnapshot: parsedRequest.pricingSnapshot,
        frozenAt: confirmedAt,
      }, pricingDeps);
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

  async function handleListPropertyReservations(request, env, params) {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);

    const propertyId = String(params?.propertyId || '').trim();
    const actor = await requireTenantActor(request, env, tenantId);
    if (actor.error) return actor.error;

    const url = new URL(request.url);
    const boardDate = String(url.searchParams.get('board_date') || formatDateUtc(new Date())).trim();
    const status = String(url.searchParams.get('status') || 'all').trim();
    const limit = Number(url.searchParams.get('limit') || 80);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(boardDate)) return jsonResponse({ error: 'board_date must use YYYY-MM-DD format.' }, 400);
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

  async function handleGetPropertyReservation(request, env, params) {
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

  async function handleUploadReservationGuestPhoto(request, env, params) {
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

  async function handleGetReservationGuestPhoto(request, env, params) {
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

  async function handleUpdatePropertyReservationAssignment(request, env, params) {
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
      const parsed = validateReservationPatchRequest(body, record.reservation);
      if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

      const actorUserId = request.headers.get('X-User-ID')?.trim() || null;
      const updateSqlParts = [];
      const updateValues = [];

      if (Object.prototype.hasOwnProperty.call(parsed.updates, 'guestName')) {
        updateSqlParts.push('guest_name = ?');
        updateValues.push(parsed.updates.guestName);
      }
      if (Object.prototype.hasOwnProperty.call(parsed.updates, 'guestEmail')) {
        updateSqlParts.push('guest_email = ?');
        updateValues.push(parsed.updates.guestEmail);
      }
      if (Object.prototype.hasOwnProperty.call(parsed.updates, 'guestPhone')) {
        updateSqlParts.push('guest_phone = ?');
        updateValues.push(parsed.updates.guestPhone);
      }
      if (Object.prototype.hasOwnProperty.call(parsed.updates, 'specialRequests')) {
        updateSqlParts.push('special_requests = ?');
        updateValues.push(parsed.updates.specialRequests);
      }
      if (Object.prototype.hasOwnProperty.call(parsed.updates, 'sourcePayload')) {
        updateSqlParts.push('source_payload = ?');
        updateValues.push(parsed.updates.sourcePayload);
      }

      if (updateSqlParts.length) {
        updateSqlParts.push('updated_at = ?');
        updateValues.push(currentUnixSeconds());
        await env.DB
          .prepare(
            `UPDATE property_reservations
                SET ${updateSqlParts.join(', ')}
              WHERE id = ? AND tenant_id = ? AND property_id = ?`
          )
          .bind(...updateValues, reservationId, tenantId, propertyId)
          .run();
        await recordPropertyReservationEvent(env, tenantId, propertyId, reservationId, 'guest_profile_updated', record.reservation.status, record.reservation.status, {
          guest_name: Object.prototype.hasOwnProperty.call(parsed.updates, 'guestName') ? parsed.updates.guestName : undefined,
          guest_email: Object.prototype.hasOwnProperty.call(parsed.updates, 'guestEmail') ? parsed.updates.guestEmail : undefined,
          guest_phone: Object.prototype.hasOwnProperty.call(parsed.updates, 'guestPhone') ? parsed.updates.guestPhone : undefined,
          special_requests: Object.prototype.hasOwnProperty.call(parsed.updates, 'specialRequests') ? parsed.updates.specialRequests : undefined,
          guest_profile: Object.prototype.hasOwnProperty.call(parsed.updates, 'sourcePayload') ? JSON.parse(parsed.updates.sourcePayload || '{}').guest_profile || null : undefined,
        }, actorUserId);
      }

      if (Object.prototype.hasOwnProperty.call(parsed.updates, 'assignedRoomUnitId')) {
        if (!['confirmed', 'checked_in'].includes(String(record.reservation.status))) {
          return jsonResponse({ error: 'Room assignment is only supported for confirmed or checked_in reservations.' }, 409);
        }
        const assignment = await assignReservationToRoomUnit(env, tenantId, propertyId, reservationId, record, parsed.updates.assignedRoomUnitId, actorUserId);
        if (assignment.error) return jsonResponse({ error: assignment.error }, 409);
      }

      const updatedRecord = await loadPropertyReservation(env, tenantId, propertyId, reservationId);
      return jsonResponse({
        ...buildReservationPayload(updatedRecord),
        assignment_updated: Object.prototype.hasOwnProperty.call(parsed.updates, 'assignedRoomUnitId'),
        profile_updated: updateSqlParts.length > 0,
      });
    } catch (error) {
      console.error('[PROPERTY_RESERVATION_ASSIGNMENT_UPDATE]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  async function handleCancelPropertyReservation(request, env, params) {
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

  async function handleRebookPropertyReservation(request, env, params) {
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
        {
          adults: parsedRequest.adults,
          children: parsedRequest.children,
          excludeHoldId: parsedRequest.holdId,
          excludeReservationId: reservationId,
        }
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
      const frozenPricing = await resolveFrozenReservationPricingSnapshot(env, tenantId, propertyId, parsedRequest, {
        fallbackSnapshot: parsedRequest.pricingSnapshot,
        frozenAt: now,
      }, pricingDeps);
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

  async function handleCheckInPropertyReservation(request, env, params) {
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

  async function handleCheckOutPropertyReservation(request, env, params) {
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

  async function handleEarlyCheckOutPropertyReservation(request, env, params) {
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

  async function handleNoShowPropertyReservation(request, env, params) {
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

  async function handleUndoPropertyReservationStatus(request, env, params) {
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
            {
              adults: Number(record.reservation.adults || 1),
              children: Number(record.reservation.children || 0),
              excludeReservationId: reservationId,
            }
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
          {
            adults: Number(record.reservation.adults || 1),
            children: Number(record.reservation.children || 0),
            excludeReservationId: reservationId,
          }
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

  return {
    handleCancelPropertyReservation,
    handleCheckInPropertyReservation,
    handleCheckOutPropertyReservation,
    handleCreatePropertyReservation,
    handleEarlyCheckOutPropertyReservation,
    handleGetPropertyReservation,
    handleGetReservationGuestPhoto,
    handleListPropertyReservations,
    handleNoShowPropertyReservation,
    handleRebookPropertyReservation,
    handleUndoPropertyReservationStatus,
    handleUpdatePropertyReservationAssignment,
    handleUploadReservationGuestPhoto,
  };
}

export { createReservationHandlers };