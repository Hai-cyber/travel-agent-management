/**
 * Mobile Ops Routes [CHK-304]
 * Mobile-first task execution endpoints.
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
import { addMessage, getOrCreateThread } from '../services/communication.js';

const CONTACT_SOURCES = {
	accommodation: {
		table: 'dest_accommodations',
		query: 'SELECT id, hotel_name AS supplier_name, contact_name, contact_phone AS phone, contact_email AS email FROM dest_accommodations WHERE id = ? AND tenant_id = ?',
	},
	meal: {
		table: 'dest_meals',
		query: 'SELECT id, restaurant_name AS supplier_name, contact_name, contact_phone AS phone, contact_email AS email FROM dest_meals WHERE id = ? AND tenant_id = ?',
	},
	guide: {
		table: 'dest_guides',
		query: 'SELECT id, guide_name AS supplier_name, contact_name, phone, email FROM dest_guides WHERE id = ? AND tenant_id = ?',
	},
	local_transport: {
		table: 'dest_local_transports',
		query: 'SELECT id, supplier AS supplier_name, contact_name, phone, email FROM dest_local_transports WHERE id = ? AND tenant_id = ?',
	},
	intercity_leg: {
		table: 'dest_intercity_legs',
		query: 'SELECT id, supplier AS supplier_name, contact_name, phone, email FROM dest_intercity_legs WHERE id = ? AND tenant_id = ?',
	},
};

const NOTE_CHANNELS = new Set(['note', 'call_log', 'sms', 'email', 'whatsapp', 'zalo', 'messenger']);

export async function listMobileTasks(request, db) {
	try {
		const tenantId = getTenantId(request);
		const url = new URL(request.url);
		const status = url.searchParams.get('status');
		const includeClosed = parseBooleanFlag(url.searchParams.get('includeClosed'), false);
		if (includeClosed === null) {
			return validationError('includeClosed must be true/false/1/0');
		}

		const pagination = parsePaginationParams(url.searchParams.get('limit'), url.searchParams.get('offset'));
		if (!pagination.ok) {
			return pagination.response;
		}
		const { limit, offset } = pagination.value;

		const binds = [tenantId];
		let query = 'SELECT * FROM tasks WHERE tenant_id = ?';
		if (status) {
			const validStatuses = ['pending', 'confirmed', 'completed', 'canceled'];
			if (!validStatuses.includes(status)) {
				return validationError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
			}
			query += ' AND status = ?';
			binds.push(status);
		} else if (!includeClosed) {
			query += " AND status NOT IN ('completed', 'canceled')";
		}

		query += ' ORDER BY due_at ASC LIMIT ? OFFSET ?';
		binds.push(limit, offset);

		const result = await db.prepare(query).bind(...binds).all();
		const rawTasks = result.results || [];

		const tasks = [];
		for (const task of rawTasks) {
			const contact = await getTaskContact(task, tenantId, db);
			const thread = await resolveTaskThread(task, tenantId, db);
			const latestMessage = await getLatestThreadMessage(thread.id, tenantId, db);
			const quickActions = buildQuickActions(contact, thread.id);
			tasks.push({
				id: task.id,
				title: task.title,
				status: task.status,
				due_at: task.due_at,
				service_entity_type: task.service_entity_type,
				service_entity_id: task.service_entity_id,
				booking_id: task.booking_id,
				thread_id: thread.id,
				contact,
				quick_actions: quickActions,
				latest_message: latestMessage,
			});
		}

		return successResponse({ tasks, limit, offset, total: tasks.length });
	} catch (error) {
		return internalError(`Failed to list mobile tasks: ${error.message}`);
	}
}

export async function addMobileTaskNote(taskId, request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) {
			return parsedBody.response;
		}
		const tenantId = getTenantId(request);
		const { body, channel, created_by } = parsedBody.value;
		if (!body || typeof body !== 'string') {
			return validationError('body is required and must be a string');
		}
		if (channel !== undefined && (!NOTE_CHANNELS.has(channel) || typeof channel !== 'string')) {
			return validationError(`channel must be one of: ${Array.from(NOTE_CHANNELS).join(', ')}`);
		}
		if (created_by !== undefined && typeof created_by !== 'string') {
			return validationError('created_by must be a string');
		}

		const task = await db
			.prepare('SELECT * FROM tasks WHERE id = ? AND tenant_id = ?')
			.bind(taskId, tenantId)
			.first();
		if (!task) {
			return notFoundResponse('Task not found');
		}

		const thread = await resolveTaskThread(task, tenantId, db);
		const message = await addMessage(
			thread.id,
			channel || 'note',
			'internal',
			{ body, created_by: created_by || tenantId },
			tenantId,
			db
		);

		return successResponse({ task_id: taskId, thread_id: thread.id, message }, 201);
	} catch (error) {
		return internalError(`Failed to add mobile task note: ${error.message}`);
	}
}

export async function updateMobileTaskStatus(taskId, request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) {
			return parsedBody.response;
		}
		const tenantId = getTenantId(request);
		const { status } = parsedBody.value;
		const validStatuses = ['pending', 'confirmed', 'completed', 'canceled'];
		if (!status || !validStatuses.includes(status)) {
			return validationError(`status must be one of: ${validStatuses.join(', ')}`);
		}

		const task = await db
			.prepare('SELECT id FROM tasks WHERE id = ? AND tenant_id = ?')
			.bind(taskId, tenantId)
			.first();
		if (!task) {
			return notFoundResponse('Task not found');
		}

		await db.prepare('UPDATE tasks SET status = ? WHERE id = ? AND tenant_id = ?').bind(status, taskId, tenantId).run();
		const updated = await db
			.prepare('SELECT * FROM tasks WHERE id = ? AND tenant_id = ?')
			.bind(taskId, tenantId)
			.first();

		return successResponse({ task: updated });
	} catch (error) {
		return internalError(`Failed to update mobile task status: ${error.message}`);
	}
}

async function resolveTaskThread(task, tenantId, db) {
	if (CONTACT_SOURCES[task.service_entity_type] && task.service_entity_id) {
		return getOrCreateThread(task.service_entity_type, task.service_entity_id, tenantId, db);
	}
	return getOrCreateThread('task', task.id, tenantId, db);
}

async function getTaskContact(task, tenantId, db) {
	const source = CONTACT_SOURCES[task.service_entity_type];
	if (!source || !task.service_entity_id) {
		return null;
	}
	const row = await db.prepare(source.query).bind(task.service_entity_id, tenantId).first();
	if (!row) {
		return null;
	}
	return {
		supplier_name: row.supplier_name || null,
		contact_name: row.contact_name || null,
		phone: normalizePhone(row.phone),
		email: row.email || null,
	};
}

function buildQuickActions(contact, threadId) {
	if (!contact) {
		return {
			call: null,
			sms: null,
			email: null,
			whatsapp: null,
			zalo: null,
			thread_messages_url: threadId ? `/api/threads/${threadId}/messages?limit=20&offset=0` : null,
		};
	}

	const phoneDigits = contact.phone ? contact.phone.replace(/[^\d+]/g, '') : null;
	const phoneForIntl = phoneDigits ? phoneDigits.replace(/^\+/, '') : null;
	const email = contact.email || null;

	return {
		call: phoneDigits ? `tel:${phoneDigits}` : null,
		sms: phoneDigits ? `sms:${phoneDigits}` : null,
		email: email ? `mailto:${email}` : null,
		whatsapp: phoneForIntl ? `https://wa.me/${phoneForIntl}` : null,
		zalo: phoneForIntl ? `https://zalo.me/${phoneForIntl}` : null,
		thread_messages_url: threadId ? `/api/threads/${threadId}/messages?limit=20&offset=0` : null,
	};
}

async function getLatestThreadMessage(threadId, tenantId, db) {
	const latest = await db
		.prepare(
			`SELECT id, channel, direction, body, created_at
			FROM comm_messages
			WHERE thread_id = ? AND tenant_id = ?
			ORDER BY created_at DESC
			LIMIT 1`
		)
		.bind(threadId, tenantId)
		.first();
	return latest || null;
}

function normalizePhone(value) {
	if (!value || typeof value !== 'string') {
		return null;
	}
	return value.trim();
}

function parseBooleanFlag(value, defaultValue) {
	if (value === null) {
		return defaultValue;
	}
	if (value === '1' || value === 'true') {
		return true;
	}
	if (value === '0' || value === 'false') {
		return false;
	}
	return null;
}
