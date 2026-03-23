/**
 * Task Routes [CHK-202]
 * GET /api/tasks
 * GET /api/tasks/:id
 * PATCH /api/tasks/:id
 * POST /api/tasks/generate-for-tour (manual trigger)
 */

import {
	getTenantId,
	successResponse,
	readJsonBody,
	parsePaginationParams,
	validationError,
	notFoundResponse,
	internalError,
} from '../lib/db.js';
import { generateTasksForTour, getTourStartReminderCandidates, markTourStartReminderSent } from '../services/tasks.js';

/**
 * GET /api/tasks - List tasks with filters
 * Query params: tourId, status, limit, offset
 */
export async function listTasks(request, db) {
	try {
		const url = new URL(request.url);
		const tourId = url.searchParams.get('tourId');
		const status = url.searchParams.get('status');
		const pagination = parsePaginationParams(url.searchParams.get('limit'), url.searchParams.get('offset'));
		if (!pagination.ok) {
			return pagination.response;
		}
		const { limit, offset } = pagination.value;

		const tenantId = getTenantId(request);

		// Build query
		let query = 'SELECT * FROM tasks WHERE tenant_id = ?';
		const binds = [tenantId];

		if (status) {
			const validStatuses = ['pending', 'confirmed', 'completed', 'canceled'];
			if (!validStatuses.includes(status)) {
				return validationError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
			}
			query += ' AND status = ?';
			binds.push(status);
		}

		if (tourId) {
			// Join through service entities to find tasks for a tour
			// For MVP, filter by checking service linkage in a tour's destinations,
			// plus CHK-207 day1_event tasks stored with booking_id = tourId.
			query = `
			SELECT DISTINCT t.* FROM tasks t
			WHERE t.tenant_id = ?
			${status ? 'AND t.status = ?' : ''}
			AND (
				t.booking_id = ?
				OR EXISTS (
				SELECT 1 FROM dest_accommodations da 
				WHERE da.id = t.service_entity_id AND t.service_entity_type = 'accommodation'
				AND da.destination_id IN (SELECT id FROM destinations WHERE tour_id = ?)
				UNION
				SELECT 1 FROM dest_meals dm
				WHERE dm.id = t.service_entity_id AND t.service_entity_type = 'meal'
				AND dm.destination_id IN (SELECT id FROM destinations WHERE tour_id = ?)
				UNION
				SELECT 1 FROM dest_guides dg
				WHERE dg.id = t.service_entity_id AND t.service_entity_type = 'guide'
				AND dg.destination_id IN (SELECT id FROM destinations WHERE tour_id = ?)
				UNION
				SELECT 1 FROM dest_local_transports dlt
				WHERE dlt.id = t.service_entity_id AND t.service_entity_type = 'local_transport'
				AND dlt.destination_id IN (SELECT id FROM destinations WHERE tour_id = ?)
				UNION
				SELECT 1 FROM dest_intercity_legs dil
				WHERE dil.id = t.service_entity_id AND t.service_entity_type = 'intercity_leg'
				AND dil.destination_id IN (SELECT id FROM destinations WHERE tour_id = ?)
				)
			)
			ORDER BY t.due_at ASC
			LIMIT ? OFFSET ?
		`;
			binds.pop(); // Remove first tenantId from original query
			binds.push(tenantId);
			if (status) binds.push(status);
			binds.push(tourId, tourId, tourId, tourId, tourId, tourId);
			binds.push(limit, offset);
		} else {
			query += ' ORDER BY due_at ASC LIMIT ? OFFSET ?';
			binds.push(limit, offset);
		}

		const result = await db.prepare(query).bind(...binds).all();

		return successResponse({
			tasks: result.results || [],
			limit,
			offset,
			total: (result.results || []).length,
		});
	} catch (e) {
		return internalError(`Failed to list tasks: ${e.message}`);
	}
}

/**
 * GET /api/tasks/:id - Get a single task
 */
export async function getTask(taskId, request, db) {
	try {
		const tenantId = getTenantId(request);

		const task = await db
			.prepare('SELECT * FROM tasks WHERE id = ? AND tenant_id = ?')
			.bind(taskId, tenantId)
			.first();

		if (!task) {
			return notFoundResponse('Task not found');
		}

		return successResponse(task);
	} catch (e) {
		return internalError(`Failed to retrieve task: ${e.message}`);
	}
}

/**
 * PATCH /api/tasks/:id - Update a task
 * Body: { status?, due_at? }
 */
export async function updateTask(taskId, request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) {
			return parsedBody.response;
		}
		const body = parsedBody.value;
		const { status, due_at } = body;
		const tenantId = getTenantId(request);

		// Check task exists
		const existing = await db
			.prepare('SELECT id FROM tasks WHERE id = ? AND tenant_id = ?')
			.bind(taskId, tenantId)
			.first();

		if (!existing) {
			return notFoundResponse('Task not found');
		}

		const updates = [];
		const binds = [];

		if (status !== undefined) {
			const validStatuses = ['pending', 'confirmed', 'completed', 'canceled'];
			if (!validStatuses.includes(status)) {
				return validationError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
			}
			updates.push('status = ?');
			binds.push(status);
		}

		if (due_at !== undefined) {
			if (typeof due_at !== 'number' || due_at <= 0) {
				return validationError('due_at must be a positive number (epoch ms)');
			}
			updates.push('due_at = ?');
			binds.push(due_at);
		}

		if (updates.length === 0) {
			return validationError('No fields to update');
		}

		binds.push(taskId);
		binds.push(tenantId);

		await db
			.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`)
			.bind(...binds)
			.run();

		const updated = await db
			.prepare('SELECT * FROM tasks WHERE id = ? AND tenant_id = ?')
			.bind(taskId, tenantId)
			.first();

		return successResponse(updated);
	} catch (e) {
		return internalError(`Failed to update task: ${e.message}`);
	}
}

/**
 * POST /api/tasks/generate-for-tour - Manual trigger to generate tasks
 * Body: { tourId }
 */
export async function generateTasksForTourEndpoint(request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) {
			return parsedBody.response;
		}
		const body = parsedBody.value;
		const { tourId } = body;

		if (!tourId) {
			return validationError('tourId is required');
		}

		const tenantId = getTenantId(request);

		// Verify tour belongs to tenant
		const tour = await db
			.prepare('SELECT id FROM tours WHERE id = ? AND tenant_id = ?')
			.bind(tourId, tenantId)
			.first();

		if (!tour) {
			return notFoundResponse('Tour not found');
		}

		const createdIds = await generateTasksForTour(tourId, db);

		return successResponse({
			message: `Generated ${createdIds.length} tasks`,
			task_ids: createdIds,
		});
	} catch (e) {
		return internalError(`Failed to generate tasks: ${e.message}`);
	}
}

/**
 * GET /api/tasks/reminders/candidates
 * Query params: at (optional epoch ms)
 */
export async function listReminderCandidates(request, db) {
	try {
		const url = new URL(request.url);
		const atRaw = url.searchParams.get('at');
		const at = atRaw === null ? Date.now() : Number(atRaw);
		if (!Number.isFinite(at) || at <= 0) {
			return validationError('at must be a positive epoch milliseconds number');
		}

		const tenantId = getTenantId(request);
		const candidates = await getTourStartReminderCandidates(db, at);
		return successResponse({
			candidates: candidates.filter((candidate) => candidate.tenant_id === tenantId),
			at,
		});
	} catch (error) {
		return internalError(`Failed to list reminder candidates: ${error.message}`);
	}
}

/**
 * POST /api/tasks/:id/reminders/mark-sent
 * Body: { reminder_key }
 */
export async function markReminderSent(taskId, request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) {
			return parsedBody.response;
		}
		const tenantId = getTenantId(request);
		const { reminder_key } = parsedBody.value;
		if (!reminder_key || typeof reminder_key !== 'string') {
			return validationError('reminder_key is required and must be a string');
		}

		const task = await db
			.prepare('SELECT id FROM tasks WHERE id = ? AND tenant_id = ?')
			.bind(taskId, tenantId)
			.first();
		if (!task) {
			return notFoundResponse('Task not found');
		}

		await markTourStartReminderSent(taskId, reminder_key, db);
		return successResponse({ task_id: taskId, reminder_key, marked: true });
	} catch (error) {
		if (String(error.message || '').includes('UNIQUE')) {
			return successResponse({ task_id: taskId, marked: true, duplicate: true });
		}
		return internalError(`Failed to mark reminder as sent: ${error.message}`);
	}
}
