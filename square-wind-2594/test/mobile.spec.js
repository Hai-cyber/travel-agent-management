import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index.js';

describe('Mobile Ops [CHK-304]', () => {
	let db;
	const tenantId = 'ten-mobile-1';
	const headers = { 'X-Tenant-ID': tenantId, 'Content-Type': 'application/json' };

	beforeEach(async () => {
		db = env.DB;
		for (const statement of tableStatements()) {
			await db.prepare(statement).run();
		}
	});

	afterEach(async () => {
		for (const table of ['comm_messages', 'comm_threads', 'dest_accommodations', 'tasks']) {
			await db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
		}
	});

	it('returns mobile tasks with quick contact actions', async () => {
		const serviceId = crypto.randomUUID();
		const taskId = crypto.randomUUID();
		const now = Date.now();

		await db
			.prepare(
				`INSERT INTO dest_accommodations (id, tenant_id, destination_id, hotel_name, contact_name, contact_phone, contact_email, position, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(serviceId, tenantId, 'dest-1', 'Sunrise Hotel', 'Lan', '+84901234567', 'lan@hotel.test', 1, now)
			.run();

		await db
			.prepare(
				`INSERT INTO tasks (id, tenant_id, booking_id, service_entity_type, service_entity_id, title, due_at, status)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(taskId, tenantId, 'tour-1', 'accommodation', serviceId, 'Confirm room block', now + 3600000, 'pending')
			.run();

		const response = await worker.fetch(new Request('http://example.com/api/mobile/tasks', { method: 'GET', headers }), env);
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.tasks).toHaveLength(1);
		expect(data.tasks[0].quick_actions.call).toBe('tel:+84901234567');
		expect(data.tasks[0].quick_actions.sms).toBe('sms:+84901234567');
		expect(data.tasks[0].quick_actions.email).toBe('mailto:lan@hotel.test');
		expect(data.tasks[0].quick_actions.whatsapp).toBe('https://wa.me/84901234567');
		expect(data.tasks[0].quick_actions.zalo).toBe('https://zalo.me/84901234567');
		expect(data.tasks[0].quick_actions.thread_messages_url).toContain('/api/threads/');
		expect(data.tasks[0].thread_id).toBeTruthy();
	});

	it('returns null quick actions for day1 events without supplier contact', async () => {
		const now = Date.now();
		await db
			.prepare(
				`INSERT INTO tasks (id, tenant_id, booking_id, service_entity_type, service_entity_id, title, due_at, status)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(crypto.randomUUID(), tenantId, 'tour-2', 'day1_event', 'tour-2:pickup', 'Day-1 Pickup Coordination', now + 3600000, 'pending')
			.run();

		const response = await worker.fetch(new Request('http://example.com/api/mobile/tasks', { method: 'GET', headers }), env);
		const data = await response.json();
		expect(response.status).toBe(200);
		expect(data.tasks[0].quick_actions.call).toBeNull();
		expect(data.tasks[0].thread_id).toBeTruthy();
	});

	it('adds quick note to service-related thread by task id', async () => {
		const serviceId = crypto.randomUUID();
		const taskId = crypto.randomUUID();
		const now = Date.now();

		await db
			.prepare(
				`INSERT INTO dest_accommodations (id, tenant_id, destination_id, hotel_name, contact_name, contact_phone, contact_email, position, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(serviceId, tenantId, 'dest-1', 'Sunrise Hotel', 'Lan', '+84901234567', 'lan@hotel.test', 1, now)
			.run();

		await db
			.prepare(
				`INSERT INTO tasks (id, tenant_id, booking_id, service_entity_type, service_entity_id, title, due_at, status)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(taskId, tenantId, 'tour-1', 'accommodation', serviceId, 'Confirm room block', now + 3600000, 'pending')
			.run();

		const response = await worker.fetch(
			new Request(`http://example.com/api/mobile/tasks/${taskId}/note`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ body: 'Called supplier, waiting final confirmation.', channel: 'call_log' }),
			}),
			env
		);

		expect(response.status).toBe(201);
		const data = await response.json();
		expect(data.task_id).toBe(taskId);
		expect(data.message.channel).toBe('call_log');
		expect(data.thread_id).toBeTruthy();

		const messageCount = await db
			.prepare('SELECT COUNT(*) AS total FROM comm_messages WHERE thread_id = ? AND tenant_id = ?')
			.bind(data.thread_id, tenantId)
			.first();
		expect(messageCount.total).toBe(1);

		const feedResponse = await worker.fetch(new Request('http://example.com/api/mobile/tasks', { method: 'GET', headers }), env);
		const feedData = await feedResponse.json();
		expect(feedData.tasks[0].latest_message.body).toBe('Called supplier, waiting final confirmation.');
		expect(feedData.tasks[0].latest_message.channel).toBe('call_log');
	});

	it('updates task status from mobile endpoint', async () => {
		const taskId = crypto.randomUUID();
		const now = Date.now();

		await db
			.prepare(
				`INSERT INTO tasks (id, tenant_id, booking_id, service_entity_type, service_entity_id, title, due_at, status)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(taskId, tenantId, 'tour-3', 'day1_event', 'tour-3:welcome', 'Day-1 Welcome Setup', now + 3600000, 'pending')
			.run();

		const response = await worker.fetch(
			new Request(`http://example.com/api/mobile/tasks/${taskId}/status`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ status: 'confirmed' }),
			}),
			env
		);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.task.status).toBe('confirmed');
	});
});

function tableStatements() {
	return [
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
		`CREATE TABLE IF NOT EXISTS dest_accommodations (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			destination_id TEXT NOT NULL,
			hotel_name TEXT,
			contact_name TEXT,
			contact_phone TEXT,
			contact_email TEXT,
			position INTEGER NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS comm_threads (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			entity_type TEXT NOT NULL,
			entity_id TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS comm_messages (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			thread_id TEXT NOT NULL,
			channel TEXT NOT NULL,
			direction TEXT NOT NULL,
			subject TEXT,
			body TEXT,
			to_addr TEXT,
			from_addr TEXT,
			attachments_json TEXT,
			created_by TEXT,
			created_at INTEGER NOT NULL
		)`,
	];
}
