import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index.js';

describe('Calendar & Reminder Cadence [CHK-208]', () => {
	let db;
	const tenantId = 'ten-cal-1';
	const headers = { 'X-Tenant-ID': tenantId, 'Content-Type': 'application/json' };

	beforeEach(async () => {
		db = env.DB;
		for (const statement of tableStatements()) {
			await db.prepare(statement).run();
		}
	});

	afterEach(async () => {
		for (const table of ['task_reminder_logs', 'tenant_calendar_configs', 'tasks', 'tours']) {
			await db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
		}
	});

	it('saves and retrieves tenant calendar config', async () => {
		const saveResponse = await worker.fetch(
			new Request('http://example.com/api/calendar/config', {
				method: 'POST',
				headers,
				body: JSON.stringify({
					google_calendar_id: 'tenant-calendar@example.com',
					timezone: 'Asia/Ho_Chi_Minh',
					auto_sync_enabled: true,
					monthly_reminder_enabled: true,
				}),
			}),
			env
		);
		expect(saveResponse.status).toBe(200);
		const saved = await saveResponse.json();
		expect(saved.google_calendar_id).toBe('tenant-calendar@example.com');

		const getResponse = await worker.fetch(
			new Request('http://example.com/api/calendar/config', { method: 'GET', headers }),
			env
		);
		expect(getResponse.status).toBe(200);
		const fetched = await getResponse.json();
		expect(fetched.google_calendar_id).toBe('tenant-calendar@example.com');
	});

	it('returns iPhone-compatible ICS feed for a tour', async () => {
		const { tourId } = await seedTourWithTasks(db, tenantId);

		const response = await worker.fetch(
			new Request(`http://example.com/api/calendar/tours/${tourId}/tasks.ics`, {
				method: 'GET',
				headers,
			}),
			env
		);

		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Type')).toContain('text/calendar');
		const text = await response.text();
		expect(text).toContain('BEGIN:VCALENDAR');
		expect(text).toContain('SUMMARY:Day-1 Pickup Coordination');
	});

	it('returns google sync preview payload when configured', async () => {
		const { tourId } = await seedTourWithTasks(db, tenantId);
		await db
			.prepare(
				`INSERT INTO tenant_calendar_configs
				(tenant_id, google_calendar_id, ios_calendar_url, timezone, auto_sync_enabled, monthly_reminder_enabled, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(tenantId, 'tenant-calendar@example.com', null, 'Asia/Ho_Chi_Minh', 1, 1, Date.now())
			.run();

		const response = await worker.fetch(
			new Request(`http://example.com/api/calendar/tours/${tourId}/google-sync/preview`, {
				method: 'GET',
				headers,
			}),
			env
		);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.google_calendar_id).toBe('tenant-calendar@example.com');
		expect(data.event_count).toBe(2);
	});

	it('lists reminder candidates using monthly + 14d + 7d cadence before tour start', async () => {
		const bookingDate = Date.parse('2026-01-01T00:00:00Z');
		const startDate = Date.parse('2026-03-20T08:00:00Z');
		const dueAt = Date.parse('2026-03-15T09:00:00Z');
		const tourId = crypto.randomUUID();
		const taskId = crypto.randomUUID();

		await db
			.prepare(
				`INSERT INTO tours (id, tenant_id, title, start_date, duration_text, status, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(tourId, tenantId, 'Reminder Tour', startDate, '5N4D', 'booked', bookingDate)
			.run();

		await db
			.prepare(
				`INSERT INTO tasks (id, tenant_id, booking_id, service_entity_type, service_entity_id, title, due_at, status)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(taskId, tenantId, tourId, 'day1_event', `${tourId}:pickup`, 'Day-1 Pickup Coordination', dueAt, 'pending')
			.run();

		const at = Date.parse('2026-03-13T09:00:00Z');
		const response = await worker.fetch(
			new Request(`http://example.com/api/tasks/reminders/candidates?at=${at}`, {
				method: 'GET',
				headers,
			}),
			env
		);

		expect(response.status).toBe(200);
		const data = await response.json();
		const keys = data.candidates.map((candidate) => candidate.reminder_key);
		expect(keys).toContain('before_start:14d');
		expect(keys).toContain('before_start:7d');
		expect(keys.some((key) => key.startsWith('monthly:'))).toBe(true);
		expect(keys).not.toContain('before_start:3d');
	});

	it('does not return reminder candidate once marked as sent', async () => {
		const bookingDate = Date.parse('2026-01-01T00:00:00Z');
		const startDate = Date.parse('2026-03-20T08:00:00Z');
		const tourId = crypto.randomUUID();
		const taskId = crypto.randomUUID();

		await db
			.prepare(
				`INSERT INTO tours (id, tenant_id, title, start_date, duration_text, status, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(tourId, tenantId, 'Reminder Tour', startDate, '5N4D', 'booked', bookingDate)
			.run();

		await db
			.prepare(
				`INSERT INTO tasks (id, tenant_id, booking_id, service_entity_type, service_entity_id, title, due_at, status)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(taskId, tenantId, tourId, 'day1_event', `${tourId}:welcome`, 'Day-1 Welcome Setup', startDate, 'pending')
			.run();

		const at = Date.parse('2026-03-06T08:00:00Z');
		const before = await worker.fetch(
			new Request(`http://example.com/api/tasks/reminders/candidates?at=${at}`, { method: 'GET', headers }),
			env
		);
		const beforeData = await before.json();
		expect(beforeData.candidates.some((candidate) => candidate.reminder_key === 'before_start:14d')).toBe(true);

		const markResponse = await worker.fetch(
			new Request(`http://example.com/api/tasks/${taskId}/reminders/mark-sent`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ reminder_key: 'before_start:14d' }),
			}),
			env
		);
		expect(markResponse.status).toBe(200);

		const after = await worker.fetch(
			new Request(`http://example.com/api/tasks/reminders/candidates?at=${at}`, { method: 'GET', headers }),
			env
		);
		const afterData = await after.json();
		expect(afterData.candidates.some((candidate) => candidate.reminder_key === 'before_start:14d')).toBe(false);
	});
});

async function seedTourWithTasks(db, tenantId) {
	const tourId = crypto.randomUUID();
	const now = Date.now();
	await db
		.prepare(
			`INSERT INTO tours (id, tenant_id, title, start_date, duration_text, status, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(tourId, tenantId, 'Calendar Tour', now + 10 * 24 * 60 * 60 * 1000, '4N3D', 'booked', now)
		.run();

	for (const title of ['Day-1 Pickup Coordination', 'Day-1 Welcome Setup']) {
		await db
			.prepare(
				`INSERT INTO tasks (id, tenant_id, booking_id, service_entity_type, service_entity_id, title, due_at, status)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(crypto.randomUUID(), tenantId, tourId, 'day1_event', `${tourId}:${title}`, title, now + 2 * 60 * 60 * 1000, 'pending')
			.run();
	}

	return { tourId };
}

function tableStatements() {
	return [
		`CREATE TABLE IF NOT EXISTS tours (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			title TEXT NOT NULL,
			start_date INTEGER,
			duration_text TEXT,
			status TEXT,
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS tasks (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			booking_id TEXT,
			service_entity_type TEXT,
			service_entity_id TEXT,
			title TEXT NOT NULL,
			due_at INTEGER,
			status TEXT DEFAULT 'pending',
			last_notice_at INTEGER
		)`,
		`CREATE TABLE IF NOT EXISTS tenant_calendar_configs (
			tenant_id TEXT PRIMARY KEY,
			google_calendar_id TEXT,
			ios_calendar_url TEXT,
			timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
			auto_sync_enabled INTEGER NOT NULL DEFAULT 1,
			monthly_reminder_enabled INTEGER NOT NULL DEFAULT 1,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS task_reminder_logs (
			task_id TEXT NOT NULL,
			reminder_key TEXT NOT NULL,
			sent_at INTEGER NOT NULL,
			PRIMARY KEY (task_id, reminder_key)
		)`,
	];
}
