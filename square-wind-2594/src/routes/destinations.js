/**
 * Destination Routes [CHK-201]
 * POST /api/tours/:tourId/destinations
 * PATCH /api/destinations/:destId
 * GET  /api/tours/:tourId/destinations
 */

import {
	getTenantId,
	generateId,
	successResponse,
	readJsonBody,
	validationError,
	notFoundResponse,
	internalError,
} from '../lib/db.js';
import { recomputeSchedule, persistComputedSchedule } from '../services/schedule.js';

/**
 * POST /api/tours/:tourId/destinations - Add a destination to a tour
 * Body: { name, nights, position }
 */
export async function addDestination(tourId, request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) {
			return parsedBody.response;
		}

		const body = parsedBody.value;
		const { name, nights, position } = body;

		// Validation
		if (!name || typeof name !== 'string') {
			return validationError('name is required and must be a string');
		}
		if (typeof nights !== 'number' || nights < 0) {
			return validationError('nights is required and must be >= 0');
		}
		if (position !== undefined && (typeof position !== 'number' || position < 1)) {
			return validationError('position must be >= 1 when provided');
		}

		const tenantId = getTenantId(request);
		const destId = generateId();
		const now = Date.now();
		const defaultBlueprint = JSON.stringify(defaultServiceBlueprint());
		const resolvedPosition = typeof position === 'number' ? position : await getNextDestinationPosition(tourId, tenantId, db);

		// Check tour exists
		const tour = await db
			.prepare('SELECT id FROM tours WHERE id = ? AND tenant_id = ?')
			.bind(tourId, tenantId)
			.first();

		if (!tour) {
			return notFoundResponse('Tour not found');
		}

		// Insert destination
		await db
			.prepare(
				`INSERT INTO destinations 
			(id, tenant_id, tour_id, name, position, nights, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(destId, tenantId, tourId, name, resolvedPosition, nights, now)
			.run();

		// Best-effort for schema versions that already include service_blueprint_json.
		try {
			await db
				.prepare('UPDATE destinations SET service_blueprint_json = ? WHERE id = ? AND tenant_id = ?')
				.bind(defaultBlueprint, destId, tenantId)
				.run();
		} catch {
			// Older test schemas may not include the column yet.
		}

		// Auto-recompute schedule
		try {
			const computed = await recomputeSchedule(tourId, db);
			await persistComputedSchedule(tourId, computed, db);
		} catch (scheduleErr) {
			// Log but don't fail the request
			console.error('Schedule recompute failed:', scheduleErr.message);
		}

		const dest = {
			id: destId,
			tenant_id: tenantId,
			tour_id: tourId,
			name,
			position: resolvedPosition,
			nights,
			service_blueprint_json: defaultBlueprint,
			created_at: now,
		};

		return successResponse(dest, 201);
	} catch (e) {
		return internalError(`Failed to add destination: ${e.message}`);
	}
}

/**
 * PATCH /api/destinations/:destId - Update a destination
 * Body: { name?, nights?, position? }
 */
export async function updateDestination(destId, request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) {
			return parsedBody.response;
		}

		const body = parsedBody.value;
		const { name, nights, position } = body;
		const tenantId = getTenantId(request);

		// Check destination exists and get tour_id
		const existing = await db
			.prepare('SELECT id, tour_id FROM destinations WHERE id = ? AND tenant_id = ?')
			.bind(destId, tenantId)
			.first();

		if (!existing) {
			return notFoundResponse('Destination not found');
		}

		const tourId = existing.tour_id;

		// Build dynamic update
		const updates = [];
		const binds = [];

		if (name !== undefined) {
			if (typeof name !== 'string') {
				return validationError('name must be a string');
			}
			updates.push('name = ?');
			binds.push(name);
		}

		if (nights !== undefined) {
			if (typeof nights !== 'number' || nights < 0) {
				return validationError('nights must be >= 0');
			}
			updates.push('nights = ?');
			binds.push(nights);
		}

		if (position !== undefined) {
			if (typeof position !== 'number' || position < 1) {
				return validationError('position must be >= 1');
			}
			updates.push('position = ?');
			binds.push(position);
		}

		if (updates.length === 0) {
			return validationError('No fields to update');
		}

		binds.push(destId);
		binds.push(tenantId);

		await db
			.prepare(`UPDATE destinations SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`)
			.bind(...binds)
			.run();

		// Auto-recompute schedule (important when nights/position changes)
		try {
			const computed = await recomputeSchedule(tourId, db);
			await persistComputedSchedule(tourId, computed, db);
		} catch (scheduleErr) {
			// Log but don't fail the request
			console.error('Schedule recompute failed:', scheduleErr.message);
		}

		const updated = await db
			.prepare('SELECT * FROM destinations WHERE id = ? AND tenant_id = ?')
			.bind(destId, tenantId)
			.first();

		return successResponse(updated);
	} catch (e) {
		return internalError(`Failed to update destination: ${e.message}`);
	}
}

/**
 * GET /api/tours/:tourId/destinations - List destinations for a tour
 */
export async function listDestinations(tourId, request, db) {
	try {
		const tenantId = getTenantId(request);

		// Check tour exists
		const tour = await db
			.prepare('SELECT id FROM tours WHERE id = ? AND tenant_id = ?')
			.bind(tourId, tenantId)
			.first();

		if (!tour) {
			return notFoundResponse('Tour not found');
		}

		const result = await db
			.prepare('SELECT * FROM destinations WHERE tour_id = ? AND tenant_id = ? ORDER BY position ASC')
			.bind(tourId, tenantId)
			.all();

		return successResponse({ destinations: result.results || [] });
	} catch (e) {
		return internalError(`Failed to list destinations: ${e.message}`);
	}
}

export async function getDestinationServiceBlueprint(destId, request, db) {
	try {
		const tenantId = getTenantId(request);
		const destination = await db
			.prepare('SELECT id, service_blueprint_json FROM destinations WHERE id = ? AND tenant_id = ?')
			.bind(destId, tenantId)
			.first();

		if (!destination) {
			return notFoundResponse('Destination not found');
		}

		const blueprint = parseBlueprint(destination.service_blueprint_json);
		return successResponse({ destination_id: destId, service_blueprint: blueprint });
	} catch (e) {
		return internalError(`Failed to get destination service blueprint: ${e.message}`);
	}
}

export async function upsertDestinationServiceBlueprint(destId, request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) {
			return parsedBody.response;
		}

		const body = parsedBody.value;
		const tenantId = getTenantId(request);

		const destination = await db
			.prepare('SELECT id FROM destinations WHERE id = ? AND tenant_id = ?')
			.bind(destId, tenantId)
			.first();
		if (!destination) {
			return notFoundResponse('Destination not found');
		}

		const source = body.service_blueprint && typeof body.service_blueprint === 'object'
			? body.service_blueprint
			: body;

		const blueprint = normalizeBlueprint(source);
		await db
			.prepare('UPDATE destinations SET service_blueprint_json = ? WHERE id = ? AND tenant_id = ?')
			.bind(JSON.stringify(blueprint), destId, tenantId)
			.run();

		return successResponse({ destination_id: destId, service_blueprint: blueprint });
	} catch (e) {
		return internalError(`Failed to update destination service blueprint: ${e.message}`);
	}
}

/**
 * DELETE /api/destinations/:destId - Remove a destination
 */
export async function deleteDestination(destId, request, db) {
	try {
		const tenantId = getTenantId(request);
		const existing = await db
			.prepare('SELECT id, tour_id FROM destinations WHERE id = ? AND tenant_id = ?')
			.bind(destId, tenantId)
			.first();
		if (!existing) return notFoundResponse('Destination not found');

		await db
			.prepare('DELETE FROM destinations WHERE id = ? AND tenant_id = ?')
			.bind(destId, tenantId)
			.run();

		try {
			const computed = await recomputeSchedule(existing.tour_id, db);
			await persistComputedSchedule(existing.tour_id, computed, db);
		} catch {
			// non-fatal
		}

		return successResponse({ deleted: destId });
	} catch (e) {
		return internalError(`Failed to delete destination: ${e.message}`);
	}
}

function defaultServiceBlueprint() {
	return {
		accommodations: false,
		meals: false,
		guides: false,
		local_transports: false,
		intercity_legs: false,
		intercity_mode: 'train',
	};
}

function parseBlueprint(rawValue) {
	if (!rawValue) {
		return defaultServiceBlueprint();
	}
	try {
		return normalizeBlueprint(JSON.parse(rawValue));
	} catch {
		return defaultServiceBlueprint();
	}
}

function normalizeBlueprint(input) {
	const base = defaultServiceBlueprint();
	for (const key of Object.keys(base)) {
		if (input[key] !== undefined) {
			if (key === 'intercity_mode') {
				const allowedModes = ['motorcycle', 'private_car_4', 'private_car_7', 'bus', 'train', 'flight'];
				base[key] = allowedModes.includes(String(input[key])) ? String(input[key]) : base[key];
			} else {
				base[key] = Boolean(input[key]);
			}
		}
	}
	return base;
}

async function getNextDestinationPosition(tourId, tenantId, db) {
	const row = await db
		.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM destinations WHERE tour_id = ? AND tenant_id = ?')
		.bind(tourId, tenantId)
		.first();
	return row?.next_position || 1;
}
