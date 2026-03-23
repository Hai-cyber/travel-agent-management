/**
 * Calendar routes [CHK-208]
 * Tenant calendar config + tour task calendar feed.
 */

import {
	getTenantId,
	successResponse,
	readJsonBody,
	validationError,
	notFoundResponse,
	internalError,
} from '../lib/db.js';

export async function upsertCalendarConfig(request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) {
			return parsedBody.response;
		}

		const body = parsedBody.value;
		const {
			google_calendar_id,
			ios_calendar_url,
			timezone,
			auto_sync_enabled,
			monthly_reminder_enabled,
		} = body;

		if (google_calendar_id !== undefined && typeof google_calendar_id !== 'string') {
			return validationError('google_calendar_id must be a string');
		}
		if (ios_calendar_url !== undefined && typeof ios_calendar_url !== 'string') {
			return validationError('ios_calendar_url must be a string');
		}
		if (timezone !== undefined && typeof timezone !== 'string') {
			return validationError('timezone must be a string');
		}
		if (auto_sync_enabled !== undefined && typeof auto_sync_enabled !== 'boolean') {
			return validationError('auto_sync_enabled must be a boolean');
		}
		if (monthly_reminder_enabled !== undefined && typeof monthly_reminder_enabled !== 'boolean') {
			return validationError('monthly_reminder_enabled must be a boolean');
		}

		const tenantId = getTenantId(request);
		const now = Date.now();
		await db
			.prepare(
				`INSERT INTO tenant_calendar_configs
				(tenant_id, google_calendar_id, ios_calendar_url, timezone, auto_sync_enabled, monthly_reminder_enabled, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(tenant_id) DO UPDATE SET
					google_calendar_id = excluded.google_calendar_id,
					ios_calendar_url = excluded.ios_calendar_url,
					timezone = excluded.timezone,
					auto_sync_enabled = excluded.auto_sync_enabled,
					monthly_reminder_enabled = excluded.monthly_reminder_enabled,
					updated_at = excluded.updated_at`
			)
			.bind(
				tenantId,
				google_calendar_id || null,
				ios_calendar_url || null,
				timezone || 'Asia/Ho_Chi_Minh',
				auto_sync_enabled === undefined ? 1 : auto_sync_enabled ? 1 : 0,
				monthly_reminder_enabled === undefined ? 1 : monthly_reminder_enabled ? 1 : 0,
				now
			)
			.run();

		const config = await db
			.prepare('SELECT * FROM tenant_calendar_configs WHERE tenant_id = ?')
			.bind(tenantId)
			.first();

		return successResponse(normalizeConfig(config));
	} catch (error) {
		return internalError(`Failed to save calendar config: ${error.message}`);
	}
}

export async function getCalendarConfig(request, db) {
	try {
		const tenantId = getTenantId(request);
		const config = await db
			.prepare('SELECT * FROM tenant_calendar_configs WHERE tenant_id = ?')
			.bind(tenantId)
			.first();

		if (!config) {
			return successResponse({
				tenant_id: tenantId,
				google_calendar_id: null,
				ios_calendar_url: null,
				timezone: 'Asia/Ho_Chi_Minh',
				auto_sync_enabled: true,
				monthly_reminder_enabled: true,
				updated_at: null,
			});
		}

		return successResponse(normalizeConfig(config));
	} catch (error) {
		return internalError(`Failed to get calendar config: ${error.message}`);
	}
}

export async function getTourCalendarFeed(tourId, request, db) {
	try {
		const tenantId = getTenantId(request);
		const tour = await db
			.prepare('SELECT id, title, start_date FROM tours WHERE id = ? AND tenant_id = ?')
			.bind(tourId, tenantId)
			.first();
		if (!tour) {
			return notFoundResponse('Tour not found');
		}

		const tasks = await db
			.prepare(
				`SELECT id, title, due_at, status
				FROM tasks
				WHERE tenant_id = ? AND booking_id = ?
				AND status NOT IN ('completed', 'canceled')
				ORDER BY due_at ASC`
			)
			.bind(tenantId, tourId)
			.all();

		const ics = buildIcsCalendar(tour, tasks.results || []);
		return new Response(ics, {
			status: 200,
			headers: {
				'Content-Type': 'text/calendar; charset=utf-8',
				'Content-Disposition': `inline; filename="tour-${tourId}.ics"`,
			},
		});
	} catch (error) {
		return internalError(`Failed to generate calendar feed: ${error.message}`);
	}
}

export async function getGoogleSyncPreview(tourId, request, db) {
	try {
		const tenantId = getTenantId(request);
		const tour = await db
			.prepare('SELECT id, title, start_date FROM tours WHERE id = ? AND tenant_id = ?')
			.bind(tourId, tenantId)
			.first();
		if (!tour) {
			return notFoundResponse('Tour not found');
		}

		const config = await db
			.prepare('SELECT * FROM tenant_calendar_configs WHERE tenant_id = ?')
			.bind(tenantId)
			.first();
		if (!config?.google_calendar_id) {
			return validationError('google_calendar_id is not configured for tenant');
		}

		const tasks = await db
			.prepare(
				`SELECT id, title, due_at, status
				FROM tasks
				WHERE tenant_id = ? AND booking_id = ?
				AND status NOT IN ('completed', 'canceled')
				ORDER BY due_at ASC`
			)
			.bind(tenantId, tourId)
			.all();

		const events = (tasks.results || []).map((task) => ({
			summary: task.title,
			description: `Tour ${tour.title} task (${task.id})`,
			start: { dateTime: toIso(task.due_at) },
			end: { dateTime: toIso((task.due_at || Date.now()) + 60 * 60 * 1000) },
			extendedProperties: {
				private: {
					task_id: task.id,
					tour_id: tour.id,
				},
			},
		}));

		return successResponse({
			tour_id: tour.id,
			google_calendar_id: config.google_calendar_id,
			event_count: events.length,
			events,
		});
	} catch (error) {
		return internalError(`Failed to create Google sync preview: ${error.message}`);
	}
}

function normalizeConfig(config) {
	return {
		tenant_id: config.tenant_id,
		google_calendar_id: config.google_calendar_id,
		timezone: config.timezone,
		ios_calendar_url: config.ios_calendar_url,
		auto_sync_enabled: Boolean(config.auto_sync_enabled),
		monthly_reminder_enabled: Boolean(config.monthly_reminder_enabled),
		updated_at: config.updated_at,
	};
}

function buildIcsCalendar(tour, tasks) {
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Tour Booking App//CHK-208//EN',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
	];

	for (const task of tasks) {
		lines.push('BEGIN:VEVENT');
		lines.push(`UID:${task.id}@tour-booking-app`);
		lines.push(`SUMMARY:${escapeIcs(task.title)}`);
		lines.push(`DTSTAMP:${toIcsDate(Date.now())}`);
		lines.push(`DTSTART:${toIcsDate(task.due_at || tour.start_date || Date.now())}`);
		lines.push(`DTEND:${toIcsDate((task.due_at || tour.start_date || Date.now()) + 60 * 60 * 1000)}`);
		lines.push(`DESCRIPTION:${escapeIcs(`Tour ${tour.title} task`)}`);
		lines.push('END:VEVENT');
	}

	lines.push('END:VCALENDAR');
	return `${lines.join('\r\n')}\r\n`;
}

function escapeIcs(value) {
	return String(value || '')
		.replaceAll('\\', '\\\\')
		.replaceAll(';', '\\;')
		.replaceAll(',', '\\,')
		.replaceAll('\n', '\\n');
}

function toIcsDate(timestamp) {
	const date = new Date(timestamp || Date.now());
	return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function toIso(timestamp) {
	return new Date(timestamp || Date.now()).toISOString();
}
