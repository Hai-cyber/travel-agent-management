import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index.js';

describe('API Contract [CHK-205]', () => {
	let db;
	const tenantId = 'ten-contract-1';
	const jsonHeaders = { 'X-Tenant-ID': tenantId, 'Content-Type': 'application/json' };

	beforeEach(async () => {
		db = env.DB;

		await db.prepare(`CREATE TABLE IF NOT EXISTS tours (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			title TEXT NOT NULL,
			lang TEXT DEFAULT 'vi',
			start_date INTEGER,
			duration_text TEXT,
			status TEXT NOT NULL DEFAULT 'draft',
			created_at INTEGER NOT NULL
		)`).run();

		await db.prepare(`CREATE TABLE IF NOT EXISTS destinations (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			tour_id TEXT NOT NULL,
			name TEXT NOT NULL,
			position INTEGER NOT NULL,
			nights INTEGER NOT NULL DEFAULT 0,
			arrival_date INTEGER,
			departure_date INTEGER,
			created_at INTEGER NOT NULL
		)`).run();

		await db.prepare(`CREATE TABLE IF NOT EXISTS tasks (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			booking_id TEXT,
			service_entity_type TEXT,
			service_entity_id TEXT,
			title TEXT NOT NULL,
			due_at INTEGER,
			status TEXT NOT NULL DEFAULT 'pending',
			last_notice_at INTEGER
		)`).run();

		await db.prepare(`CREATE TABLE IF NOT EXISTS comm_threads (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			entity_type TEXT NOT NULL,
			entity_id TEXT NOT NULL
		)`).run();

		await db.prepare(`CREATE TABLE IF NOT EXISTS comm_messages (
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
		)`).run();
	});

	afterEach(async () => {
		for (const table of ['comm_messages', 'comm_threads', 'tasks', 'destinations', 'tours']) {
			await db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
		}
	});

	it('returns normalized validation errors for invalid JSON bodies', async () => {
		const request = new Request('http://example.com/api/tours', {
			method: 'POST',
			headers: jsonHeaders,
			body: '{invalid',
		});

		const response = await worker.fetch(request, env);
		const data = await response.json();

		expect(response.status).toBe(400);
		expect(data.ok).toBe(false);
		expect(data.error.code).toBe('invalid_json');
		expect(data.error.message).toBe('Request body must be valid JSON');
	});

	it('returns normalized validation errors for non-object JSON bodies', async () => {
		const request = new Request('http://example.com/api/tours', {
			method: 'POST',
			headers: jsonHeaders,
			body: JSON.stringify(['not-an-object']),
		});

		const response = await worker.fetch(request, env);
		const data = await response.json();

		expect(response.status).toBe(400);
		expect(data.ok).toBe(false);
		expect(data.error.code).toBe('invalid_body');
	});

	it('returns ok=true on successful responses', async () => {
		const request = new Request('http://example.com/api/tours', {
			method: 'POST',
			headers: jsonHeaders,
			body: JSON.stringify({
				title: 'Contract Tour',
				start_date: Date.now(),
				duration_text: '2N1D',
			}),
		});

		const response = await worker.fetch(request, env);
		const data = await response.json();

		expect(response.status).toBe(201);
		expect(data.ok).toBe(true);
		expect(data.title).toBe('Contract Tour');
	});

	it('returns normalized not_found errors', async () => {
		const request = new Request('http://example.com/api/tours/missing-tour', {
			method: 'GET',
			headers: jsonHeaders,
		});

		const response = await worker.fetch(request, env);
		const data = await response.json();

		expect(response.status).toBe(404);
		expect(data.ok).toBe(false);
		expect(data.error.code).toBe('not_found');
		expect(data.error.message).toBe('Tour not found');
	});

	it('validates task pagination query params', async () => {
		const request = new Request('http://example.com/api/tasks?limit=abc&offset=-1', {
			method: 'GET',
			headers: jsonHeaders,
		});

		const response = await worker.fetch(request, env);
		const data = await response.json();

		expect(response.status).toBe(400);
		expect(data.ok).toBe(false);
		expect(data.error.code).toBe('invalid_query');
	});

	it('validates communication pagination query params', async () => {
		const threadId = crypto.randomUUID();
		await db.prepare('INSERT INTO comm_threads (id, tenant_id, entity_type, entity_id) VALUES (?, ?, ?, ?)')
			.bind(threadId, tenantId, 'task', 'task-1')
			.run();

		const request = new Request(`http://example.com/api/threads/${threadId}/messages?limit=101`, {
			method: 'GET',
			headers: jsonHeaders,
		});

		const response = await worker.fetch(request, env);
		const data = await response.json();

		expect(response.status).toBe(400);
		expect(data.ok).toBe(false);
		expect(data.error.code).toBe('invalid_query');
	});

	it('returns structured validation errors for semantic validation failures', async () => {
		const request = new Request('http://example.com/api/tasks/generate-for-tour', {
			method: 'POST',
			headers: jsonHeaders,
			body: JSON.stringify({}),
		});

		const response = await worker.fetch(request, env);
		const data = await response.json();

		expect(response.status).toBe(400);
		expect(data.ok).toBe(false);
		expect(data.error.code).toBe('validation_error');
		expect(data.error.message).toBe('tourId is required');
	});
});
