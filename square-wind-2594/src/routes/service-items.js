/**
 * Service Item Routes
 * Operational CRUD for 5 destination service groups.
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
import { getOrCreateThread } from '../services/communication.js';
import { getSupplierByIdForTenant } from './suppliers.js';

const ALLOWED_CHANNELS = new Set(['email', 'zalo', 'messenger', 'sms']);
const ALLOWED_STAGES = new Set(['contacted', 'pending', 'confirmed', 'canceled']);
const ALLOWED_STATUSES = new Set(['planned', 'booked', 'confirmed', 'canceled']);

const SERVICE_CONFIG = {
	accommodations: {
		table: 'dest_accommodations',
		entityType: 'accommodation',
		primaryField: 'hotel_name',
		requiredFields: ['hotel_name'],
		stringFields: ['hotel_name', 'room_type'],
		numberFields: ['check_in', 'check_out', 'guests'],
		defaultFields(destination) {
			return {
				check_in: destination.arrival_date,
				check_out: destination.departure_date,
			};
		},
	},
	meals: {
		table: 'dest_meals',
		entityType: 'meal',
		primaryField: 'restaurant_name',
		requiredFields: ['meal_type', 'restaurant_name'],
		stringFields: ['meal_type', 'restaurant_name'],
		numberFields: ['meal_datetime'],
		defaultFields(destination, body) {
			return {
				meal_datetime: defaultMealDateTime(destination.arrival_date, body.meal_type),
			};
		},
	},
	guides: {
		table: 'dest_guides',
		entityType: 'guide',
		primaryField: 'guide_name',
		requiredFields: ['guide_name'],
		stringFields: ['guide_name', 'languages'],
		numberFields: ['time_from', 'time_to'],
		defaultFields(destination) {
			const timeFrom = Math.max(defaultSameDayHour(destination.arrival_date, 9), destination.arrival_date || 0);
			const tentativeEnd = timeFrom + 4 * 60 * 60 * 1000;
			return {
				time_from: timeFrom,
				time_to: destination.departure_date ? Math.min(destination.departure_date, tentativeEnd) : tentativeEnd,
			};
		},
	},
	'local-transports': {
		table: 'dest_local_transports',
		entityType: 'local_transport',
		primaryField: 'supplier',
		requiredFields: ['mode', 'supplier'],
		stringFields: ['mode', 'supplier', 'driver_name', 'pickup_place', 'dropoff_place'],
		numberFields: ['pickup_time'],
		defaultFields(destination) {
			return {
				pickup_time: destination.arrival_date,
				pickup_place: `${destination.name} arrival point`,
				dropoff_place: `${destination.name} city center`,
			};
		},
	},
	'intercity-legs': {
		table: 'dest_intercity_legs',
		entityType: 'intercity_leg',
		primaryField: 'supplier',
		requiredFields: ['mode', 'supplier'],
		stringFields: ['mode', 'supplier', 'depart_point', 'arrive_point', 'ticket_ref'],
		numberFields: ['depart_time'],
		defaultFields(destination) {
			return {
				depart_time: destination.departure_date,
				depart_point: destination.name,
				arrive_point: 'TBD',
			};
		},
	},
};

export async function createServiceItem(groupKey, destinationId, request, db) {
	const config = SERVICE_CONFIG[groupKey];
	if (!config) {
		return notFoundResponse('Service group not found');
	}

	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) {
			return parsedBody.response;
		}
		const body = parsedBody.value;
		const tenantId = getTenantId(request);
		const destination = await getDestinationContext(destinationId, tenantId, db);
		if (!destination) {
			return notFoundResponse('Destination not found');
		}

		const validation = validateCreatePayload(config, body);
		if (validation) {
			return validation;
		}
		if (body.supplier_id !== undefined) {
			const supplier = await getSupplierByIdForTenant(body.supplier_id, tenantId, db);
			if (!supplier) {
				return validationError('supplier_id is invalid for tenant');
			}
		}

		const defaults = config.defaultFields(destination, body);
		const itemId = generateId();
		const now = Date.now();
		const position = await getNextPosition(config.table, destinationId, tenantId, db);
		const channels = normalizeChannels(body.communication_channels);
		const record = buildCreateRecord(config, itemId, destinationId, tenantId, body, defaults, position, now);

		const columns = Object.keys(record);
		const placeholders = columns.map(() => '?').join(', ');
		await db
			.prepare(`INSERT INTO ${config.table} (${columns.join(', ')}) VALUES (${placeholders})`)
			.bind(...columns.map((column) => record[column]))
			.run();

		const thread = await getOrCreateThread(config.entityType, itemId, tenantId, db);
		const created = await db
			.prepare(`SELECT * FROM ${config.table} WHERE id = ? AND tenant_id = ?`)
			.bind(itemId, tenantId)
			.first();

		return successResponse(hydrateItem(created, thread.id), 201);
	} catch (error) {
		return internalError(`Failed to create service item: ${error.message}`);
	}
}

export async function listServiceItems(groupKey, destinationId, request, db) {
	const config = SERVICE_CONFIG[groupKey];
	if (!config) {
		return notFoundResponse('Service group not found');
	}

	try {
		const tenantId = getTenantId(request);
		const destination = await getDestinationContext(destinationId, tenantId, db);
		if (!destination) {
			return notFoundResponse('Destination not found');
		}

		const result = await db
			.prepare(`SELECT * FROM ${config.table} WHERE destination_id = ? AND tenant_id = ? ORDER BY position ASC, created_at ASC`)
			.bind(destinationId, tenantId)
			.all();

		const items = await Promise.all((result.results || []).map((item) => hydrateItemWithThread(config, item, tenantId, db)));
		return successResponse({ items });
	} catch (error) {
		return internalError(`Failed to list service items: ${error.message}`);
	}
}

export async function updateServiceItem(groupKey, itemId, request, db) {
	const config = SERVICE_CONFIG[groupKey];
	if (!config) {
		return notFoundResponse('Service group not found');
	}

	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) {
			return parsedBody.response;
		}
		const body = parsedBody.value;
		const tenantId = getTenantId(request);
		const existing = await db
			.prepare(`SELECT * FROM ${config.table} WHERE id = ? AND tenant_id = ?`)
			.bind(itemId, tenantId)
			.first();
		if (!existing) {
			return notFoundResponse('Service item not found');
		}

		const validation = validateUpdatePayload(config, body);
		if (validation) {
			return validation;
		}

		if (body.supplier_id !== undefined) {
			const supplier = await getSupplierByIdForTenant(body.supplier_id, tenantId, db);
			if (!supplier) {
				return validationError('supplier_id is invalid for tenant');
			}
		}

		const updates = [];
		const binds = [];
		for (const field of config.stringFields) {
			if (body[field] !== undefined) {
				updates.push(`${field} = ?`);
				binds.push(body[field] || null);
			}
		}
		for (const field of config.numberFields) {
			if (body[field] !== undefined) {
				updates.push(`${field} = ?`);
				binds.push(body[field]);
			}
		}
		for (const field of ['person_in_charge', 'contact_name', 'contact_phone', 'contact_email', 'address', 'notes']) {
			if (body[field] !== undefined) {
				updates.push(`${mapCommonField(config, field)} = ?`);
				binds.push(body[field] || null);
			}
		}
		if (body.status !== undefined) {
			updates.push('status = ?');
			binds.push(body.status);
		}
		if (body.stage !== undefined) {
			updates.push('stage = ?');
			binds.push(body.stage);
		}
		if (body.communication_channels !== undefined) {
			updates.push('communication_channels_json = ?');
			binds.push(JSON.stringify(normalizeChannels(body.communication_channels)));
		}
		if (body.supplier_id !== undefined) {
			updates.push('supplier_id = ?');
			binds.push(body.supplier_id || null);
		}

		if (!updates.length) {
			return validationError('No fields to update');
		}

		binds.push(itemId, tenantId);
		await db.prepare(`UPDATE ${config.table} SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...binds).run();
		const updated = await db
			.prepare(`SELECT * FROM ${config.table} WHERE id = ? AND tenant_id = ?`)
			.bind(itemId, tenantId)
			.first();
		const thread = await getOrCreateThread(config.entityType, itemId, tenantId, db);
		return successResponse(hydrateItem(updated, thread.id));
	} catch (error) {
		return internalError(`Failed to update service item: ${error.message}`);
	}
}

function validateCreatePayload(config, body) {
	for (const field of config.requiredFields) {
		if (typeof body[field] !== 'string' || body[field].trim() === '') {
			return validationError(`${field} is required and must be a string`);
		}
	}
	for (const field of ['person_in_charge', 'contact_name', 'contact_email', 'address']) {
		if (typeof body[field] !== 'string' || body[field].trim() === '') {
			return validationError(`${field} is required and must be a string`);
		}
	}
	if (body.contact_phone !== undefined && typeof body.contact_phone !== 'string') {
		return validationError('contact_phone must be a string');
	}
	if (body.notes !== undefined && typeof body.notes !== 'string') {
		return validationError('notes must be a string');
	}
	if (body.supplier_id !== undefined && typeof body.supplier_id !== 'string') {
		return validationError('supplier_id must be a string');
	}
	if (body.status !== undefined && !ALLOWED_STATUSES.has(body.status)) {
		return validationError(`Invalid status. Must be one of: ${Array.from(ALLOWED_STATUSES).join(', ')}`);
	}
	if (body.stage !== undefined && !ALLOWED_STAGES.has(body.stage)) {
		return validationError(`Invalid stage. Must be one of: ${Array.from(ALLOWED_STAGES).join(', ')}`);
	}
	const channelValidation = validateChannels(body.communication_channels);
	if (channelValidation) {
		return channelValidation;
	}
	for (const field of config.numberFields) {
		if (body[field] !== undefined && (typeof body[field] !== 'number' || Number.isNaN(body[field]))) {
			return validationError(`${field} must be a number`);
		}
	}
	for (const field of config.stringFields) {
		if (body[field] !== undefined && typeof body[field] !== 'string') {
			return validationError(`${field} must be a string`);
		}
	}
	return null;
}

function validateUpdatePayload(config, body) {
	const channelValidation = validateChannels(body.communication_channels);
	if (channelValidation) {
		return channelValidation;
	}
	if (body.status !== undefined && !ALLOWED_STATUSES.has(body.status)) {
		return validationError(`Invalid status. Must be one of: ${Array.from(ALLOWED_STATUSES).join(', ')}`);
	}
	if (body.stage !== undefined && !ALLOWED_STAGES.has(body.stage)) {
		return validationError(`Invalid stage. Must be one of: ${Array.from(ALLOWED_STAGES).join(', ')}`);
	}
	for (const field of ['person_in_charge', 'contact_name', 'contact_phone', 'contact_email', 'address', 'notes']) {
		if (body[field] !== undefined && typeof body[field] !== 'string') {
			return validationError(`${field} must be a string`);
		}
	}
	if (body.supplier_id !== undefined && typeof body.supplier_id !== 'string') {
		return validationError('supplier_id must be a string');
	}
	for (const field of config.stringFields) {
		if (body[field] !== undefined && typeof body[field] !== 'string') {
			return validationError(`${field} must be a string`);
		}
	}
	for (const field of config.numberFields) {
		if (body[field] !== undefined && (typeof body[field] !== 'number' || Number.isNaN(body[field]))) {
			return validationError(`${field} must be a number`);
		}
	}
	return null;
}

function validateChannels(channels) {
	if (channels === undefined) {
		return null;
	}
	if (!Array.isArray(channels)) {
		return validationError('communication_channels must be an array');
	}
	for (const channel of channels) {
		if (typeof channel !== 'string' || !ALLOWED_CHANNELS.has(channel)) {
			return validationError(`communication_channels must contain only: ${Array.from(ALLOWED_CHANNELS).join(', ')}`);
		}
	}
	return null;
}

function buildCreateRecord(config, itemId, destinationId, tenantId, body, defaults, position, now) {
	const channels = normalizeChannels(body.communication_channels);
	const record = {
		id: itemId,
		tenant_id: tenantId,
		destination_id: destinationId,
		person_in_charge: body.person_in_charge,
		contact_name: body.contact_name,
		contact_phone: body.contact_phone || null,
		contact_email: body.contact_email,
		address: body.address,
		notes: body.notes || null,
		status: body.status || 'planned',
		stage: body.stage || 'pending',
		communication_channels_json: JSON.stringify(channels),
		position,
		created_at: now,
	};

	if (body.supplier_id !== undefined) {
		record.supplier_id = body.supplier_id;
	}

	for (const field of config.stringFields) {
		if (body[field] !== undefined) {
			record[field] = body[field];
		}
	}
	for (const field of config.numberFields) {
		const explicit = body[field];
		record[field] = explicit !== undefined ? explicit : defaults[field] ?? null;
	}
	for (const [field, value] of Object.entries(defaults)) {
		if (record[field] === undefined) {
			record[field] = value;
		}
	}

	if (config.table === 'dest_guides') {
		record.phone = record.contact_phone;
		record.email = record.contact_email;
		delete record.contact_phone;
		delete record.contact_email;
	}
	if (config.table === 'dest_local_transports' || config.table === 'dest_intercity_legs') {
		record.phone = record.contact_phone;
		record.email = record.contact_email;
		delete record.contact_phone;
		delete record.contact_email;
	}

	return record;
}

async function getDestinationContext(destinationId, tenantId, db) {
	return db
		.prepare(
			`SELECT d.id, d.name, d.arrival_date, d.departure_date, d.position, d.nights, t.start_date
			FROM destinations d
			JOIN tours t ON t.id = d.tour_id
			WHERE d.id = ? AND d.tenant_id = ? AND t.tenant_id = ?`
		)
		.bind(destinationId, tenantId, tenantId)
		.first();
}

async function getNextPosition(table, destinationId, tenantId, db) {
	const result = await db
		.prepare(`SELECT COALESCE(MAX(position), 0) AS max_position FROM ${table} WHERE destination_id = ? AND tenant_id = ?`)
		.bind(destinationId, tenantId)
		.first();
	return (result?.max_position || 0) + 1;
}

async function hydrateItemWithThread(config, row, tenantId, db) {
	const thread = await db
		.prepare('SELECT id FROM comm_threads WHERE entity_type = ? AND entity_id = ? AND tenant_id = ?')
		.bind(config.entityType, row.id, tenantId)
		.first();
	return hydrateItem(row, thread?.id || null);
}

function hydrateItem(row, threadId) {
	const item = { ...row, thread_id: threadId, communication_channels: parseChannels(row.communication_channels_json) };
	delete item.communication_channels_json;
	if (item.phone !== undefined && item.contact_phone === undefined) {
		item.contact_phone = item.phone;
	}
	if (item.email !== undefined && item.contact_email === undefined) {
		item.contact_email = item.email;
	}
	return item;
}

function parseChannels(value) {
	if (!value) {
		return ['email'];
	}
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed : ['email'];
	} catch {
		return ['email'];
	}
}

function normalizeChannels(channels) {
	if (!channels || !channels.length) {
		return ['email'];
	}
	return Array.from(new Set(channels.map((channel) => channel.toLowerCase())));
}

function mapCommonField(config, field) {
	if ((config.table === 'dest_guides' || config.table === 'dest_local_transports' || config.table === 'dest_intercity_legs') && field === 'contact_phone') {
		return 'phone';
	}
	if ((config.table === 'dest_guides' || config.table === 'dest_local_transports' || config.table === 'dest_intercity_legs') && field === 'contact_email') {
		return 'email';
	}
	return field;
}

function defaultSameDayHour(baseTimestamp, hour) {
	if (!baseTimestamp) {
		return null;
	}
	const date = new Date(baseTimestamp);
	date.setUTCHours(hour, 0, 0, 0);
	return date.getTime();
}

function defaultMealDateTime(arrivalDate, mealType) {
	if (!arrivalDate) {
		return null;
	}
	const normalizedMealType = String(mealType || '').toLowerCase();
	const mealHour = normalizedMealType === 'breakfast' ? 8 : normalizedMealType === 'dinner' ? 18 : 12;
	const sameDay = defaultSameDayHour(arrivalDate, mealHour);
	return Math.max(sameDay, arrivalDate);
}
