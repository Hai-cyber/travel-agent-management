/**
 * Tour Routes [CHK-201]
 * POST /api/tours
 * GET  /api/tours/:id
 * PATCH /api/tours/:id
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
import { assertPublishGateSatisfied } from './publish.js';
import { assertBookingsAllowed } from './billing.js';

/**
 * POST /api/tours - Create a new tour
 * Body: { title, start_date?, duration_text, lang?, day1_pickup_enabled?, day1_welcome_enabled? }
 */
export async function createTour(request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) {
			return parsedBody.response;
		}

		const body = parsedBody.value;
		const { title, start_date, duration_text, lang, day1_pickup_enabled, day1_welcome_enabled } = body;

		// Validation
		if (!title || typeof title !== 'string') {
			return validationError('title is required and must be a string');
		}
		if (start_date !== undefined && (typeof start_date !== 'number' || start_date <= 0)) {
			return validationError('start_date must be a positive number (epoch ms) when provided');
		}
		if (!duration_text || typeof duration_text !== 'string') {
			return validationError('duration_text is required and must be a string');
		}
		if (lang !== undefined && typeof lang !== 'string') {
			return validationError('lang must be a string');
		}
		if (day1_pickup_enabled !== undefined && typeof day1_pickup_enabled !== 'boolean') {
			return validationError('day1_pickup_enabled must be a boolean');
		}
		if (day1_welcome_enabled !== undefined && typeof day1_welcome_enabled !== 'boolean') {
			return validationError('day1_welcome_enabled must be a boolean');
		}

		const tenantId = getTenantId(request);
		const tourId = generateId();
		const now = Date.now();

		const resolvedStartDate = typeof start_date === 'number' ? start_date : Date.now();

		await db
			.prepare(
				`INSERT INTO tours 
			(id, tenant_id, title, start_date, duration_text, lang, status, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(tourId, tenantId, title, resolvedStartDate, duration_text, lang || 'vi', 'draft', now)
			.run();

		await createDay1Tasks({
			tourId,
			tenantId,
			startDate: resolvedStartDate,
			pickupEnabled: day1_pickup_enabled !== false,
			welcomeEnabled: day1_welcome_enabled !== false,
			db,
		});

		const tour = {
			id: tourId,
			tenant_id: tenantId,
			title,
			start_date: resolvedStartDate,
			duration_text,
			lang: lang || 'vi',
			day1_pickup_enabled: day1_pickup_enabled !== false,
			day1_welcome_enabled: day1_welcome_enabled !== false,
			status: 'draft',
			created_at: now,
		};

		return successResponse(tour, 201);
	} catch (e) {
		return internalError(`Failed to create tour: ${e.message}`);
	}
}

async function createDay1Tasks({ tourId, tenantId, startDate, pickupEnabled, welcomeEnabled, db }) {
	const tasks = [];
	const twoHours = 2 * 60 * 60 * 1000;

	if (pickupEnabled) {
		tasks.push({
			id: generateId(),
			title: 'Day-1 Pickup Coordination',
			due_at: Math.max(1, startDate - twoHours),
			service_entity_id: `${tourId}:pickup`,
		});
	}

	if (welcomeEnabled) {
		tasks.push({
			id: generateId(),
			title: 'Day-1 Welcome Setup',
			due_at: startDate + twoHours,
			service_entity_id: `${tourId}:welcome`,
		});
	}

	for (const task of tasks) {
		await db
			.prepare(
				`INSERT INTO tasks
				(id, tenant_id, booking_id, service_entity_type, service_entity_id, title, due_at, status, last_notice_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(task.id, tenantId, tourId, 'day1_event', task.service_entity_id, task.title, task.due_at, 'pending', null)
			.run();
	}
}

/**
 * GET /api/tours/:id - Retrieve a tour
 */
export async function getTour(tourId, db, request) {
	try {
		const tenantId = getTenantId(request);

		const tour = await db
			.prepare('SELECT * FROM tours WHERE id = ? AND tenant_id = ?')
			.bind(tourId, tenantId)
			.first();

		if (!tour) {
			return notFoundResponse('Tour not found');
		}

		return successResponse(tour);
	} catch (e) {
		return internalError(`Failed to retrieve tour: ${e.message}`);
	}
}

/**
 * PATCH /api/tours/:id - Update a tour
 * Body: { status?, title?, lang? }
 */
export async function updateTour(tourId, request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) {
			return parsedBody.response;
		}

		const body = parsedBody.value;
		const { status, title, lang } = body;
		const tenantId = getTenantId(request);

		// Check tour exists
		const existing = await db
			.prepare('SELECT id FROM tours WHERE id = ? AND tenant_id = ?')
			.bind(tourId, tenantId)
			.first();

		if (!existing) {
			return notFoundResponse('Tour not found');
		}

		// Build dynamic update
		const updates = [];
		const binds = [];

		if (status !== undefined) {
			const validStatuses = ['draft', 'on_sale', 'booked', 'completed', 'archived'];
			if (!validStatuses.includes(status)) {
				return validationError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
			}
			if (status === 'on_sale') {
				const gate = await assertPublishGateSatisfied(tenantId, db);
				if (!gate.ok) {
					return validationError(gate.message, gate.details);
				}
			}
			if (status === 'booked') {
				const billing = await assertBookingsAllowed(tenantId, db);
				if (!billing.ok) {
					return validationError(billing.message, billing.details);
				}
			}
			updates.push('status = ?');
			binds.push(status);
		}

		if (title !== undefined) {
			if (typeof title !== 'string') {
				return validationError('title must be a string');
			}
			updates.push('title = ?');
			binds.push(title);
		}

		if (lang !== undefined) {
			if (typeof lang !== 'string') {
				return validationError('lang must be a string');
			}
			updates.push('lang = ?');
			binds.push(lang);
		}

		if (updates.length === 0) {
			return validationError('No fields to update');
		}

		binds.push(tourId);
		binds.push(tenantId);

		await db
			.prepare(`UPDATE tours SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`)
			.bind(...binds)
			.run();

		const updated = await db
			.prepare('SELECT * FROM tours WHERE id = ? AND tenant_id = ?')
			.bind(tourId, tenantId)
			.first();

		return successResponse(updated);
	} catch (e) {
		return internalError(`Failed to update tour: ${e.message}`);
	}
}
