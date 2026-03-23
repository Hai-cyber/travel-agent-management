import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index.js';

describe('Routes [CHK-201] - Tours & Destinations CRUD', () => {
	let db;
	const tenantId = 'ten-test-1';
	const defaultHeaders = { 'X-Tenant-ID': tenantId, 'Content-Type': 'application/json' };

	beforeEach(async () => {
		db = env.DB;

		// Create tables
		await db
			.prepare(
				`CREATE TABLE IF NOT EXISTS tours (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			title TEXT NOT NULL,
			lang TEXT DEFAULT 'vi',
			start_date INTEGER,
			duration_text TEXT,
			status TEXT NOT NULL CHECK (status IN ('draft','on_sale','booked','completed','archived')) DEFAULT 'draft',
			created_at INTEGER NOT NULL
		)`
			)
			.run();

		await db
			.prepare(
				`CREATE TABLE IF NOT EXISTS destinations (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			tour_id TEXT NOT NULL,
			name TEXT NOT NULL,
			position INTEGER NOT NULL,
			nights INTEGER NOT NULL DEFAULT 0,
			arrival_date INTEGER,
			departure_date INTEGER,
			created_at INTEGER NOT NULL
		)`
			)
			.run();

		await db
			.prepare(
				`CREATE TABLE IF NOT EXISTS tasks (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			booking_id TEXT,
			service_entity_type TEXT,
			service_entity_id TEXT,
			title TEXT NOT NULL,
			due_at INTEGER,
			status TEXT NOT NULL DEFAULT 'pending',
			last_notice_at INTEGER
		)`
			)
			.run();

		await db
			.prepare(
				`CREATE TABLE IF NOT EXISTS tenant_billing_configs (
			tenant_id TEXT PRIMARY KEY,
			trial_started_at INTEGER NOT NULL,
			trial_ends_at INTEGER NOT NULL,
			subscription_status TEXT NOT NULL CHECK (subscription_status IN ('trialing', 'active', 'unpaid')) DEFAULT 'trialing',
			updated_at INTEGER NOT NULL
		)`
			)
			.run();
	});

	afterEach(async () => {
		await db.prepare('DROP TABLE IF EXISTS tenant_billing_configs').run();
		await db.prepare('DROP TABLE IF EXISTS tasks').run();
		await db.prepare('DROP TABLE IF EXISTS tours').run();
		await db.prepare('DROP TABLE IF EXISTS destinations').run();
	});

	describe('POST /api/tours', () => {
		it('should create a tour with valid input', async () => {
			const body = {
				title: 'Vietnam Tour',
				start_date: new Date('2026-04-15T08:00:00Z').getTime(),
				duration_text: '6N5D',
				lang: 'vi',
			};

			const request = new Request('http://example.com/api/tours', {
				method: 'POST',
				headers: defaultHeaders,
				body: JSON.stringify(body),
			});

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(201);

			const data = await response.json();
			expect(data.id).toBeDefined();
			expect(data.title).toBe('Vietnam Tour');
			expect(data.status).toBe('draft');
		});

		it('should use default lang if not provided', async () => {
			const body = {
				title: 'Test Tour',
				start_date: Date.now(),
				duration_text: '3N2D',
			};

			const request = new Request('http://example.com/api/tours', {
				method: 'POST',
				headers: defaultHeaders,
				body: JSON.stringify(body),
			});

			const response = await worker.fetch(request, env);
			const data = await response.json();
			expect(data.lang).toBe('vi');
		});

		it('should reject tour without title', async () => {
			const body = {
				start_date: Date.now(),
				duration_text: '3N2D',
			};

			const request = new Request('http://example.com/api/tours', {
				method: 'POST',
				headers: defaultHeaders,
				body: JSON.stringify(body),
			});

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(400);
		});

		it('should reject invalid start_date', async () => {
			const body = {
				title: 'Test',
				start_date: -100,
				duration_text: '3N2D',
			};

			const request = new Request('http://example.com/api/tours', {
				method: 'POST',
				headers: defaultHeaders,
				body: JSON.stringify(body),
			});

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(400);
		});

		it('should auto-create day-1 pickup and welcome tasks by default', async () => {
			const startDate = new Date('2026-04-15T08:00:00Z').getTime();
			const request = new Request('http://example.com/api/tours', {
				method: 'POST',
				headers: defaultHeaders,
				body: JSON.stringify({
					title: 'Day 1 Flow Tour',
					start_date: startDate,
					duration_text: '3N2D',
				}),
			});

			const response = await worker.fetch(request, env);
			const data = await response.json();
			expect(response.status).toBe(201);

			const tasks = await db
				.prepare('SELECT * FROM tasks WHERE booking_id = ? ORDER BY due_at ASC')
				.bind(data.id)
				.all();

			expect(tasks.results).toHaveLength(2);
			expect(tasks.results.every((task) => task.service_entity_type === 'day1_event')).toBe(true);
			expect(tasks.results.some((task) => task.title.includes('Pickup'))).toBe(true);
			expect(tasks.results.some((task) => task.title.includes('Welcome'))).toBe(true);
		});

		it('should honor day-1 toggles when creating tour', async () => {
			const request = new Request('http://example.com/api/tours', {
				method: 'POST',
				headers: defaultHeaders,
				body: JSON.stringify({
					title: 'Pickup Off Tour',
					start_date: Date.now() + 3600000,
					duration_text: '3N2D',
					day1_pickup_enabled: false,
					day1_welcome_enabled: true,
				}),
			});

			const response = await worker.fetch(request, env);
			const data = await response.json();
			expect(response.status).toBe(201);

			const tasks = await db
				.prepare('SELECT * FROM tasks WHERE booking_id = ? ORDER BY due_at ASC')
				.bind(data.id)
				.all();

			expect(tasks.results).toHaveLength(1);
			expect(tasks.results[0].title).toContain('Welcome');
		});
	});

	describe('GET /api/tours/:id', () => {
		it('should retrieve an existing tour', async () => {
			const startDate = new Date('2026-04-15T08:00:00Z').getTime();
			const tourId = crypto.randomUUID();
			const now = Date.now();

			await db
				.prepare(
					`INSERT INTO tours (id, tenant_id, title, start_date, duration_text, lang, status, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(tourId, tenantId, 'Test Tour', startDate, '3N2D', 'vi', 'draft', now)
				.run();

			const request = new Request(`http://example.com/api/tours/${tourId}`, {
				method: 'GET',
				headers: defaultHeaders,
			});

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(200);

			const data = await response.json();
			expect(data.id).toBe(tourId);
			expect(data.title).toBe('Test Tour');
		});

		it('should return 404 for non-existent tour', async () => {
			const request = new Request('http://example.com/api/tours/nonexistent', {
				method: 'GET',
				headers: defaultHeaders,
			});

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(404);
		});
	});

	describe('PATCH /api/tours/:id', () => {
		it('should update tour status', async () => {
			const tourId = crypto.randomUUID();
			const now = Date.now();

			await db
				.prepare(
					`INSERT INTO tours (id, tenant_id, title, start_date, duration_text, lang, status, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(tourId, tenantId, 'Test Tour', Date.now(), '3N2D', 'vi', 'draft', now)
				.run();

			const request = new Request(`http://example.com/api/tours/${tourId}`, {
				method: 'PATCH',
				headers: defaultHeaders,
					body: JSON.stringify({ status: 'booked' }),
			});

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(200);

			const data = await response.json();
				expect(data.status).toBe('booked');
		});

		it('should reject invalid status', async () => {
			const tourId = crypto.randomUUID();
			const now = Date.now();

			await db
				.prepare(
					`INSERT INTO tours (id, tenant_id, title, start_date, duration_text, lang, status, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(tourId, tenantId, 'Test Tour', Date.now(), '3N2D', 'vi', 'draft', now)
				.run();

			const request = new Request(`http://example.com/api/tours/${tourId}`, {
				method: 'PATCH',
				headers: defaultHeaders,
				body: JSON.stringify({ status: 'invalid_status' }),
			});

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(400);
		});
	});

	describe('POST /api/tours/:tourId/destinations', () => {
		it('should add a destination to a tour', async () => {
			const tourId = crypto.randomUUID();
			const now = Date.now();

			await db
				.prepare(
					`INSERT INTO tours (id, tenant_id, title, start_date, duration_text, lang, status, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(tourId, tenantId, 'Test Tour', Date.now(), '3N2D', 'vi', 'draft', now)
				.run();

			const body = {
				name: 'Sài Gòn',
				nights: 2,
				position: 1,
			};

			const request = new Request(`http://example.com/api/tours/${tourId}/destinations`, {
				method: 'POST',
				headers: defaultHeaders,
				body: JSON.stringify(body),
			});

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(201);

			const data = await response.json();
			expect(data.name).toBe('Sài Gòn');
			expect(data.nights).toBe(2);
			expect(data.position).toBe(1);
		});

		it('should return 404 if tour does not exist', async () => {
			const body = {
				name: 'Sài Gòn',
				nights: 2,
				position: 1,
			};

			const request = new Request('http://example.com/api/tours/nonexistent/destinations', {
				method: 'POST',
				headers: defaultHeaders,
				body: JSON.stringify(body),
			});

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(404);
		});

		it('should reject invalid nights', async () => {
			const tourId = crypto.randomUUID();
			const now = Date.now();

			await db
				.prepare(
					`INSERT INTO tours (id, tenant_id, title, start_date, duration_text, lang, status, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(tourId, tenantId, 'Test Tour', Date.now(), '3N2D', 'vi', 'draft', now)
				.run();

			const body = {
				name: 'Sài Gòn',
				nights: -1,
				position: 1,
			};

			const request = new Request(`http://example.com/api/tours/${tourId}/destinations`, {
				method: 'POST',
				headers: defaultHeaders,
				body: JSON.stringify(body),
			});

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(400);
		});
	});

	describe('GET /api/tours/:tourId/destinations', () => {
		it('should list destinations for a tour', async () => {
			const tourId = crypto.randomUUID();
			const now = Date.now();

			await db
				.prepare(
					`INSERT INTO tours (id, tenant_id, title, start_date, duration_text, lang, status, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(tourId, tenantId, 'Test Tour', Date.now(), '3N2D', 'vi', 'draft', now)
				.run();

			// Add 2 destinations
			for (let i = 0; i < 2; i++) {
				await db
					.prepare(
						`INSERT INTO destinations (id, tenant_id, tour_id, name, position, nights, created_at)
					VALUES (?, ?, ?, ?, ?, ?, ?)`
					)
					.bind(crypto.randomUUID(), tenantId, tourId, `Dest ${i}`, i + 1, i + 1, now)
					.run();
			}

			const request = new Request(`http://example.com/api/tours/${tourId}/destinations`, {
				method: 'GET',
				headers: defaultHeaders,
			});

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(200);

			const data = await response.json();
			expect(data.destinations).toHaveLength(2);
			expect(data.destinations[0].position).toBe(1);
			expect(data.destinations[1].position).toBe(2);
		});

		it('should return 404 if tour does not exist', async () => {
			const request = new Request('http://example.com/api/tours/nonexistent/destinations', {
				method: 'GET',
				headers: defaultHeaders,
			});

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(404);
		});
	});

	describe('PATCH /api/destinations/:destId', () => {
		it('should update a destination', async () => {
			const tourId = crypto.randomUUID();
			const destId = crypto.randomUUID();
			const now = Date.now();

			await db
				.prepare(
					`INSERT INTO tours (id, tenant_id, title, start_date, duration_text, lang, status, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(tourId, tenantId, 'Test Tour', Date.now(), '3N2D', 'vi', 'draft', now)
				.run();

			await db
				.prepare(
					`INSERT INTO destinations (id, tenant_id, tour_id, name, position, nights, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(destId, tenantId, tourId, 'Sài Gòn', 1, 2, now)
				.run();

			const request = new Request(`http://example.com/api/destinations/${destId}`, {
				method: 'PATCH',
				headers: defaultHeaders,
				body: JSON.stringify({ nights: 3, name: 'Sài Gòn City' }),
			});

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(200);

			const data = await response.json();
			expect(data.nights).toBe(3);
			expect(data.name).toBe('Sài Gòn City');
		});

		it('should return 404 if destination does not exist', async () => {
			const request = new Request('http://example.com/api/destinations/nonexistent', {
				method: 'PATCH',
				headers: defaultHeaders,
				body: JSON.stringify({ nights: 5 }),
			});

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(404);
		});
	});

	describe('Demo endpoints', () => {
		it('GET /message should return Hello, World!', async () => {
			const request = new Request('http://example.com/message', { method: 'GET' });
			const response = await worker.fetch(request, env);
			const text = await response.text();
			expect(text).toBe('Hello, World!');
		});

		it('GET /random should return a UUID', async () => {
			const request = new Request('http://example.com/random', { method: 'GET' });
			const response = await worker.fetch(request, env);
			const text = await response.text();
			expect(text).toMatch(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/);
		});
	});

	describe('Multi-tenant isolation', () => {
		it('should not retrieve tour from different tenant', async () => {
			const tourId = crypto.randomUUID();
			const now = Date.now();

			// Insert tour for tenant1
			await db
				.prepare(
					`INSERT INTO tours (id, tenant_id, title, start_date, duration_text, lang, status, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(tourId, 'tenant-1', 'Tenant 1 Tour', Date.now(), '3N2D', 'vi', 'draft', now)
				.run();

			// Try to GET as tenant-2
			const request = new Request(`http://example.com/api/tours/${tourId}`, {
				method: 'GET',
				headers: { 'X-Tenant-ID': 'tenant-2' },
			});

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(404);
		});
	});
});
