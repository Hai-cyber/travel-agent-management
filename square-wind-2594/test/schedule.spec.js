import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { recomputeSchedule, persistComputedSchedule } from '../src/services/schedule';

describe('Schedule Service [CHK-103]', () => {
	let db;

	beforeEach(async () => {
		// Use test database binding from env
		db = env.DB;

		// Initialize schema
		await db
			.prepare(
				`CREATE TABLE IF NOT EXISTS tours (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			title TEXT NOT NULL,
			start_date INTEGER,
			status TEXT DEFAULT 'draft',
			created_at INTEGER
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
			created_at INTEGER
		)`
			)
			.run();
	});

	afterEach(async () => {
		// Clean up
		await db.prepare('DROP TABLE IF EXISTS tours').run();
		await db.prepare('DROP TABLE IF EXISTS destinations').run();
	});

	describe('recomputeSchedule', () => {
		it('should compute arrival/departure for single destination', async () => {
			const tourStartMs = new Date('2026-04-15T08:00:00Z').getTime();
			const tourId = 'tour-test-1';
			const tenantId = 'tenant-test-1';

			// Insert test data
			await db
				.prepare(`INSERT INTO tours (id, tenant_id, title, start_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
				.bind(tourId, tenantId, 'Test Tour', tourStartMs, 'draft', tourStartMs)
				.run();

			await db
				.prepare(
					`INSERT INTO destinations (id, tenant_id, tour_id, name, position, nights, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
				)
				.bind('dst-1', tenantId, tourId, 'Destination 1', 1, 2, tourStartMs)
				.run();

			// Execute
			const result = await recomputeSchedule(tourId, db);

			// Verify
			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({
				id: 'dst-1',
				nights: 2,
			});

			// arrival should be tour start + 2h (first destination buffer)
			const expectedArrival = tourStartMs + 2 * 60 * 60 * 1000;
			expect(result[0].arrival_date).toBe(expectedArrival);

			// departure should be arrival + 2 nights (48 hours)
			const expectedDeparture = expectedArrival + 2 * 24 * 60 * 60 * 1000;
			expect(result[0].departure_date).toBe(expectedDeparture);
		});

		it('should compute arrival/departure for multiple destinations in sequence', async () => {
			const tourStartMs = new Date('2026-04-15T08:00:00Z').getTime();
			const tourId = 'tour-test-2';
			const tenantId = 'tenant-test-1';

			// Insert tour
			await db
				.prepare(`INSERT INTO tours (id, tenant_id, title, start_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
				.bind(tourId, tenantId, 'Multi-Destination Tour', tourStartMs, 'draft', tourStartMs)
				.run();

			// Insert 3 destinations
			const destData = [
				['dst-sGN', 'Sài Gòn', 1, 2],
				['dst-han', 'Hà Nội', 2, 2],
				['dst-spa', 'Sa Pa', 3, 1],
			];

			for (const [id, name, position, nights] of destData) {
				await db
					.prepare(
						`INSERT INTO destinations (id, tenant_id, tour_id, name, position, nights, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
					)
					.bind(id, tenantId, tourId, name, position, nights, tourStartMs)
					.run();
			}

			// Execute
			const result = await recomputeSchedule(tourId, db);

			// Verify we got all 3
			expect(result).toHaveLength(3);

			// Verify first destination's timeline
			const dst1Arrival = tourStartMs + 2 * 60 * 60 * 1000; // first dest: +2h buffer
			expect(result[0].arrival_date).toBe(dst1Arrival);
			const dst1Departure = dst1Arrival + 2 * 24 * 60 * 60 * 1000; // 2 nights
			expect(result[0].departure_date).toBe(dst1Departure);

			// Verify second destination starts after first departs (+ 4h buffer)
			const dst2Arrival = dst1Departure + 4 * 60 * 60 * 1000;
			expect(result[1].arrival_date).toBe(dst2Arrival);
			const dst2Departure = dst2Arrival + 2 * 24 * 60 * 60 * 1000; // 2 nights
			expect(result[1].departure_date).toBe(dst2Departure);

			// Verify third destination starts after second departs (+ 4h buffer)
			const dst3Arrival = dst2Departure + 4 * 60 * 60 * 1000;
			expect(result[2].arrival_date).toBe(dst3Arrival);
			const dst3Departure = dst3Arrival + 1 * 24 * 60 * 60 * 1000; // 1 night
			expect(result[2].departure_date).toBe(dst3Departure);
		});

		it('should throw error if tour not found', async () => {
			const nonexistentTourId = 'tour-nonexistent';

			await expect(recomputeSchedule(nonexistentTourId, db)).rejects.toThrow(
				`Tour not found: ${nonexistentTourId}`
			);
		});

		it('should throw error if no destinations found', async () => {
			const tourStartMs = new Date('2026-04-15T08:00:00Z').getTime();
			const tourId = 'tour-no-dests';
			const tenantId = 'tenant-test-1';

			// Insert tour but no destinations
			await db
				.prepare(`INSERT INTO tours (id, tenant_id, title, start_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
				.bind(tourId, tenantId, 'Empty Tour', tourStartMs, 'draft', tourStartMs)
				.run();

			await expect(recomputeSchedule(tourId, db)).rejects.toThrow(
				`No destinations found for tour: ${tourId}`
			);
		});

		it('should preserve destination id and position', async () => {
			const tourStartMs = new Date('2026-04-15T08:00:00Z').getTime();
			const tourId = 'tour-test-ids';
			const tenantId = 'tenant-test-1';

			await db
				.prepare(`INSERT INTO tours (id, tenant_id, title, start_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
				.bind(tourId, tenantId, 'Test Tour', tourStartMs, 'draft', tourStartMs)
				.run();

			await db
				.prepare(
					`INSERT INTO destinations (id, tenant_id, tour_id, name, position, nights, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
				)
				.bind('dst-preserve', tenantId, tourId, 'Preserve Test', 42, 3, tourStartMs)
				.run();

			const result = await recomputeSchedule(tourId, db);

			expect(result[0].id).toBe('dst-preserve');
			expect(result[0].position).toBe(42);
			expect(result[0].nights).toBe(3);
		});
	});

	describe('persistComputedSchedule', () => {
		it('should update destinations with computed dates in database', async () => {
			const tourStartMs = new Date('2026-04-15T08:00:00Z').getTime();
			const tourId = 'tour-persist';
			const tenantId = 'tenant-test-1';
			const destId = 'dst-persist';

			// Setup
			await db
				.prepare(`INSERT INTO tours (id, tenant_id, title, start_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
				.bind(tourId, tenantId, 'Persist Test', tourStartMs, 'draft', tourStartMs)
				.run();

			await db
				.prepare(
					`INSERT INTO destinations (id, tenant_id, tour_id, name, position, nights, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(destId, tenantId, tourId, 'Persist Dest', 1, 2, tourStartMs)
				.run();

			// Compute
			const computed = await recomputeSchedule(tourId, db);

			// Persist
			await persistComputedSchedule(tourId, computed, db);

			// Verify by querying DB
			const persisted = await db.prepare('SELECT id, arrival_date, departure_date FROM destinations WHERE id = ?').bind(destId).first();

			expect(persisted).toBeDefined();
			expect(persisted.arrival_date).toBe(computed[0].arrival_date);
			expect(persisted.departure_date).toBe(computed[0].departure_date);
		});
	});
});
