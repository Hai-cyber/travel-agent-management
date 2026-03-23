import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index.js';
import { generateTasksForTour, getTasksDueForNotice, updateTaskNoticeTime } from '../src/services/tasks.js';

describe('Tasks [CHK-202]', () => {
	let db;
	const tenantId = 'ten-test-1';
	const defaultHeaders = { 'X-Tenant-ID': tenantId, 'Content-Type': 'application/json' };

	beforeEach(async () => {
		db = env.DB;

		// Create minimal tables
		const tables = [
			`CREATE TABLE IF NOT EXISTS tours (
				id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, title TEXT NOT NULL,
				lang TEXT DEFAULT 'vi', start_date INTEGER, duration_text TEXT,
				status TEXT DEFAULT 'draft', created_at INTEGER NOT NULL
			)`,
			`CREATE TABLE IF NOT EXISTS destinations (
				id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, tour_id TEXT NOT NULL,
				name TEXT NOT NULL, position INTEGER NOT NULL, nights INTEGER DEFAULT 0,
				arrival_date INTEGER, departure_date INTEGER, created_at INTEGER NOT NULL
			)`,
			`CREATE TABLE IF NOT EXISTS dest_accommodations (
				id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, destination_id TEXT NOT NULL,
				hotel_name TEXT NOT NULL, contact_name TEXT, contact_phone TEXT, contact_email TEXT,
				check_in INTEGER, check_out INTEGER, room_type TEXT, guests INTEGER, notes TEXT,
				status TEXT DEFAULT 'planned', position INTEGER NOT NULL, created_at INTEGER NOT NULL
			)`,
			`CREATE TABLE IF NOT EXISTS dest_meals (
				id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, destination_id TEXT NOT NULL,
				meal_type TEXT NOT NULL, restaurant_name TEXT, contact_name TEXT, contact_phone TEXT,
				contact_email TEXT, meal_datetime INTEGER, notes TEXT, status TEXT DEFAULT 'planned',
				position INTEGER NOT NULL, created_at INTEGER NOT NULL
			)`,
			`CREATE TABLE IF NOT EXISTS dest_guides (
				id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, destination_id TEXT NOT NULL,
				guide_name TEXT, phone TEXT, email TEXT, languages TEXT,
				time_from INTEGER, time_to INTEGER, notes TEXT, status TEXT DEFAULT 'planned',
				position INTEGER NOT NULL, created_at INTEGER NOT NULL
			)`,
			`CREATE TABLE IF NOT EXISTS dest_local_transports (
				id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, destination_id TEXT NOT NULL,
				mode TEXT NOT NULL, supplier TEXT, driver_name TEXT, phone TEXT, email TEXT,
				pickup_time INTEGER, pickup_place TEXT, dropoff_place TEXT, notes TEXT,
				status TEXT DEFAULT 'planned', position INTEGER NOT NULL, created_at INTEGER NOT NULL
			)`,
			`CREATE TABLE IF NOT EXISTS dest_intercity_legs (
				id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, destination_id TEXT NOT NULL,
				mode TEXT NOT NULL, supplier TEXT, contact_name TEXT, phone TEXT, email TEXT,
				depart_time INTEGER, depart_point TEXT, arrive_point TEXT, ticket_ref TEXT, notes TEXT,
				status TEXT DEFAULT 'planned', position INTEGER NOT NULL, created_at INTEGER NOT NULL
			)`,
			`CREATE TABLE IF NOT EXISTS tasks (
				id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, booking_id TEXT,
				service_entity_type TEXT, service_entity_id TEXT, title TEXT NOT NULL,
			due_at INTEGER, status TEXT DEFAULT 'pending', last_notice_at INTEGER
			)`,
		];

		for (const table of tables) {
			await db.prepare(table).run();
		}
	});

	afterEach(async () => {
		const tables = [
			'tasks',
			'dest_intercity_legs',
			'dest_local_transports',
			'dest_guides',
			'dest_meals',
			'dest_accommodations',
			'destinations',
			'tours',
		];

		for (const table of tables) {
			await db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
		}
	});

	describe('generateTasksForTour service', () => {
		it('should generate tasks from all service types', async () => {
			const now = Date.now();
			const tourId = crypto.randomUUID();
			const destId = crypto.randomUUID();

			// Setup tour and destination
			await db
				.prepare(
					`INSERT INTO tours (id, tenant_id, title, start_date, duration_text, status, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(tourId, tenantId, 'Task Test Tour', now, '3N2D', 'draft', now)
				.run();

			await db
				.prepare(
					`INSERT INTO destinations (id, tenant_id, tour_id, name, position, nights, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(destId, tenantId, tourId, 'Test Dest', 1, 2, now)
				.run();

			// Add one of each service type
			const accomId = crypto.randomUUID();
			await db
				.prepare(
					`INSERT INTO dest_accommodations (id, tenant_id, destination_id, hotel_name, check_in, position, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(accomId, tenantId, destId, 'Test Hotel', now + 1000, 1, now)
				.run();

			const mealId = crypto.randomUUID();
			await db
				.prepare(
					`INSERT INTO dest_meals (id, tenant_id, destination_id, meal_type, restaurant_name, meal_datetime, position, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(mealId, tenantId, destId, 'Lunch', 'Test Restaurant', now + 2000, 1, now)
				.run();

			const guideId = crypto.randomUUID();
			await db
				.prepare(
					`INSERT INTO dest_guides (id, tenant_id, destination_id, guide_name, time_from, position, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(guideId, tenantId, destId, 'John Guide', now + 3000, 1, now)
				.run();

			// Generate tasks
			const createdIds = await generateTasksForTour(tourId, db);

			expect(createdIds.length).toBe(3);

			// Verify tasks exist
			const tasks = await db.prepare('SELECT * FROM tasks WHERE tenant_id = ?').bind(tenantId).all();

			expect(tasks.results.length).toBe(3);
			expect(tasks.results.some((t) => t.service_entity_type === 'accommodation')).toBe(true);
			expect(tasks.results.some((t) => t.service_entity_type === 'meal')).toBe(true);
			expect(tasks.results.some((t) => t.service_entity_type === 'guide')).toBe(true);
		});

		it('should throw error if tour not found', async () => {
			await expect(generateTasksForTour('nonexistent', db)).rejects.toThrow('Tour not found');
		});

		it('should return empty array if no services', async () => {
			const now = Date.now();
			const tourId = crypto.randomUUID();

			await db
				.prepare(
					`INSERT INTO tours (id, tenant_id, title, start_date, duration_text, status, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(tourId, tenantId, 'Empty Tour', now, '3N2D', 'draft', now)
				.run();

			const createdIds = await generateTasksForTour(tourId, db);

			expect(createdIds.length).toBe(0);
		});
	});

	describe('GET /api/tasks', () => {
		it('should list all tasks', async () => {
			const now = Date.now();
			const taskId1 = crypto.randomUUID();
			const taskId2 = crypto.randomUUID();

			await db
				.prepare(
					`INSERT INTO tasks (id, tenant_id, service_entity_type, service_entity_id, title, due_at, status)
				VALUES (?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(taskId1, tenantId, 'accommodation', 'accom-1', 'Confirm Hotel', now + 1000, 'pending')
				.run();

			await db
				.prepare(
					`INSERT INTO tasks (id, tenant_id, service_entity_type, service_entity_id, title, due_at, status)
				VALUES (?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(taskId2, tenantId, 'meal', 'meal-1', 'Confirm Meal', now + 2000, 'pending')
				.run();

			const request = new Request('http://example.com/api/tasks', {
				method: 'GET',
				headers: defaultHeaders,
			});

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(200);

			const data = await response.json();
			expect(data.tasks.length).toBe(2);
		});

		it('should filter by status', async () => {
			const now = Date.now();

			await db
				.prepare(
					`INSERT INTO tasks (id, tenant_id, service_entity_type, service_entity_id, title, due_at, status)
				VALUES (?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(crypto.randomUUID(), tenantId, 'accommodation', 'accom-1', 'Task 1', now + 1000, 'pending')
				.run();

			await db
				.prepare(
					`INSERT INTO tasks (id, tenant_id, service_entity_type, service_entity_id, title, due_at, status)
				VALUES (?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(crypto.randomUUID(), tenantId, 'meal', 'meal-1', 'Task 2', now + 2000, 'completed')
				.run();

			const request = new Request('http://example.com/api/tasks?status=pending', {
				method: 'GET',
				headers: defaultHeaders,
			});

			const response = await worker.fetch(request, env);
			const data = await response.json();

			expect(data.tasks.length).toBe(1);
			expect(data.tasks[0].status).toBe('pending');
		});

		it('should reject invalid status filter', async () => {
			const request = new Request('http://example.com/api/tasks?status=invalid', {
				method: 'GET',
				headers: defaultHeaders,
			});

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(400);
		});

		it('should include day-1 event tasks when filtering by tourId', async () => {
			const now = Date.now();
			const tourId = crypto.randomUUID();

			await db
				.prepare(
					`INSERT INTO tasks (id, tenant_id, booking_id, service_entity_type, service_entity_id, title, due_at, status)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(
					crypto.randomUUID(),
					tenantId,
					tourId,
					'day1_event',
					`${tourId}:pickup`,
					'Day-1 Pickup Coordination',
					now + 3600000,
					'pending'
				)
				.run();

			const request = new Request(`http://example.com/api/tasks?tourId=${tourId}`, {
				method: 'GET',
				headers: defaultHeaders,
			});

			const response = await worker.fetch(request, env);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.tasks).toHaveLength(1);
			expect(data.tasks[0].service_entity_type).toBe('day1_event');
		});
	});

	describe('GET /api/tasks/:id', () => {
		it('should retrieve a task', async () => {
			const now = Date.now();
			const taskId = crypto.randomUUID();

			await db
				.prepare(
					`INSERT INTO tasks (id, tenant_id, service_entity_type, service_entity_id, title, due_at, status)
				VALUES (?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(taskId, tenantId, 'accommodation', 'accom-1', 'Confirm Hotel', now + 1000, 'pending')
				.run();

			const request = new Request(`http://example.com/api/tasks/${taskId}`, {
				method: 'GET',
				headers: defaultHeaders,
			});

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(200);

			const data = await response.json();
			expect(data.id).toBe(taskId);
			expect(data.title).toBe('Confirm Hotel');
		});

		it('should return 404 for non-existent task', async () => {
			const request = new Request('http://example.com/api/tasks/nonexistent', {
				method: 'GET',
				headers: defaultHeaders,
			});

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(404);
		});
	});

	describe('PATCH /api/tasks/:id', () => {
		it('should update task status', async () => {
			const now = Date.now();
			const taskId = crypto.randomUUID();

			await db
				.prepare(
					`INSERT INTO tasks (id, tenant_id, service_entity_type, service_entity_id, title, due_at, status)
				VALUES (?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(taskId, tenantId, 'accommodation', 'accom-1', 'Confirm Hotel', now + 1000, 'pending')
				.run();

			const request = new Request(`http://example.com/api/tasks/${taskId}`, {
				method: 'PATCH',
				headers: defaultHeaders,
				body: JSON.stringify({ status: 'confirmed' }),
			});

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(200);

			const data = await response.json();
			expect(data.status).toBe('confirmed');
		});

		it('should reject invalid status', async () => {
			const now = Date.now();
			const taskId = crypto.randomUUID();

			await db
				.prepare(
					`INSERT INTO tasks (id, tenant_id, service_entity_type, service_entity_id, title, due_at, status)
				VALUES (?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(taskId, tenantId, 'accommodation', 'accom-1', 'Task', now + 1000, 'pending')
				.run();

			const request = new Request(`http://example.com/api/tasks/${taskId}`, {
				method: 'PATCH',
				headers: defaultHeaders,
				body: JSON.stringify({ status: 'invalid' }),
			});

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(400);
		});
	});

	describe('POST /api/tasks/generate-for-tour', () => {
		it('should generate tasks for a tour via endpoint', async () => {
			const now = Date.now();
			const tourId = crypto.randomUUID();
			const destId = crypto.randomUUID();

			// Setup
			await db
				.prepare(
					`INSERT INTO tours (id, tenant_id, title, start_date, duration_text, status, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(tourId, tenantId, 'Gen Test Tour', now, '3N2D', 'draft', now)
				.run();

			await db
				.prepare(
					`INSERT INTO destinations (id, tenant_id, tour_id, name, position, nights, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(destId, tenantId, tourId, 'Test', 1, 2, now)
				.run();

			await db
				.prepare(
					`INSERT INTO dest_accommodations (id, tenant_id, destination_id, hotel_name, check_in, position, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(crypto.randomUUID(), tenantId, destId, 'Hotel', now + 1000, 1, now)
				.run();

			// Generate
			const request = new Request('http://example.com/api/tasks/generate-for-tour', {
				method: 'POST',
				headers: defaultHeaders,
				body: JSON.stringify({ tourId }),
			});

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(200);

			const data = await response.json();
			expect(data.task_ids.length).toBe(1);
		});

		it('should return 404 if tour does not exist', async () => {
			const request = new Request('http://example.com/api/tasks/generate-for-tour', {
				method: 'POST',
				headers: defaultHeaders,
				body: JSON.stringify({ tourId: 'nonexistent' }),
			});

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(404);
		});
	});

	describe('getTasksDueForNotice service', () => {
		it('should find tasks due within lookhead window', async () => {
			const now = Date.now();
			const inTwoDays = now + 48 * 60 * 60 * 1000;
			const inTenDays = now + 10 * 24 * 60 * 60 * 1000;

			// Due soon
			await db
				.prepare(
					`INSERT INTO tasks (id, tenant_id, service_entity_type, service_entity_id, title, due_at, status)
				VALUES (?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(crypto.randomUUID(), tenantId, 'accommodation', 'a1', 'Due soon', inTwoDays, 'pending')
				.run();

			// Due later
			await db
				.prepare(
					`INSERT INTO tasks (id, tenant_id, service_entity_type, service_entity_id, title, due_at, status)
				VALUES (?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(crypto.randomUUID(), tenantId, 'accommodation', 'a2', 'Due later', inTenDays, 'pending')
				.run();

			const dueTasks = await getTasksDueForNotice(db, 48);

			expect(dueTasks.length).toBe(1);
			expect(dueTasks[0].title).toBe('Due soon');
		});

		it('should not return already-noticed tasks within 24h', async () => {
			const now = Date.now();
			const inTwoDays = now + 48 * 60 * 60 * 1000;

			const taskId = crypto.randomUUID();
			await db
				.prepare(
					`INSERT INTO tasks (id, tenant_id, service_entity_type, service_entity_id, title, due_at, status, last_notice_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(taskId, tenantId, 'accommodation', 'a1', 'Recently noticed', inTwoDays, 'pending', now)
				.run();

			const dueTasks = await getTasksDueForNotice(db, 48);

			expect(dueTasks.length).toBe(0);
		});
	});
});
