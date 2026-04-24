import { nanoid } from 'nanoid';

import { addDays, currentUnixSeconds, formatDateUtc, isIsoDate } from './date-utils.js';

function createFolioHousekeepingHandlers(deps) {
  const {
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
  } = deps;

  async function handleGetPropertyReservationFolio(request, env, params) {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
    const propertyId = String(params?.propertyId || '').trim();
    const reservationId = String(params?.reservationId || '').trim();
    const actor = await requireTenantActor(request, env, tenantId);
    if (actor.error) return actor.error;

    try {
      const record = await reservationLoadPropertyReservation(env, tenantId, propertyId, reservationId);
      if (!record) return jsonResponse({ error: 'Reservation not found.' }, 404);
      return jsonResponse(await buildReservationFolioPayload(env, tenantId, propertyId, record));
    } catch (error) {
      console.error('[PROPERTY_RESERVATION_FOLIO_GET]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  async function handleCreatePropertyReservationFolioLine(request, env, params) {
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
      const record = await reservationLoadPropertyReservation(env, tenantId, propertyId, reservationId);
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
        .bind(
          nanoid(),
          tenantId,
          propertyId,
          folio.id,
          parsed.lineType,
          parsed.sourceType,
          parsed.category,
          parsed.description,
          parsed.quantity,
          parsed.unitAmount,
          totalAmount,
          currency,
          now,
          request.headers.get('X-User-ID')?.trim() || null,
          parsed.note,
          now,
          now,
        )
        .run();

      return jsonResponse(await buildReservationFolioPayload(env, tenantId, propertyId, record), 201);
    } catch (error) {
      console.error('[PROPERTY_RESERVATION_FOLIO_LINE_CREATE]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  async function handleCreatePropertyReservationFolioPayment(request, env, params) {
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
      const record = await reservationLoadPropertyReservation(env, tenantId, propertyId, reservationId);
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
        .bind(
          nanoid(),
          tenantId,
          propertyId,
          folio.id,
          parsed.method,
          `Payment (${parsed.method.replace('_', ' ')})`,
          totalAmount,
          totalAmount,
          currency,
          now,
          request.headers.get('X-User-ID')?.trim() || null,
          parsed.note,
          now,
          now,
        )
        .run();

      return jsonResponse(await buildReservationFolioPayload(env, tenantId, propertyId, record), 201);
    } catch (error) {
      console.error('[PROPERTY_RESERVATION_FOLIO_PAYMENT_CREATE]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  async function handleRunPropertyNightAudit(request, env, params) {
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
        await ensureReservationNightAuditCharge(env, tenantId, propertyId, folio.id, nightly, auditDate, request.headers.get('X-User-ID')?.trim() || null);
        postedCount += 1;
      }

      return jsonResponse({ ok: true, property_id: propertyId, audit_date: auditDate, room_charge_lines_posted: postedCount });
    } catch (error) {
      console.error('[PROPERTY_NIGHT_AUDIT]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  async function handleListHousekeepingTasks(request, env, params) {
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

  async function handleSyncHousekeepingTasks(request, env, params) {
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

  async function handleUpdateHousekeepingTask(request, env, params) {
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

  return {
    handleCreatePropertyReservationFolioLine,
    handleCreatePropertyReservationFolioPayment,
    handleGetPropertyReservationFolio,
    handleListHousekeepingTasks,
    handleRunPropertyNightAudit,
    handleSyncHousekeepingTasks,
    handleUpdateHousekeepingTask,
  };
}

export { createFolioHousekeepingHandlers };