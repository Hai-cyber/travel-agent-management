import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index.js';

describe('Itinerary Preview [CHK-303]', () => {
	let db;
	const tenantId = 'ten-itinerary-1';
	const headers = { 'X-Tenant-ID': tenantId };

	beforeEach(async () => {
		db = env.DB;
		for (const statement of tableStatements()) {
			await db.prepare(statement).run();
		}
	});

	afterEach(async () => {
		for (const table of [
			'dest_intercity_legs',
			'dest_local_transports',
			'dest_guides',
			'dest_meals',
			'dest_accommodations',
			'destination_texts',
			'destinations',
			'tours',
		]) {
			await db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
		}
	});

	it('returns markdown itinerary with destination text by default', async () => {
		const { tourId } = await seedTourData(db, tenantId);

		const response = await worker.fetch(
			new Request(`http://example.com/api/tours/${tourId}/itinerary`, {
				method: 'GET',
				headers,
			}),
			env
		);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.format).toBe('markdown');
		expect(data.include_destination_text).toBe(true);
		expect(data.content).toContain('# Hanoi Discovery');
		expect(data.content).toContain('Summary: Hoan Kiem area walk and food rhythm.');
		expect(data.content).toContain('Accommodation: Lake View Hotel');
	});

	it('can exclude destination text using query flag', async () => {
		const { tourId } = await seedTourData(db, tenantId);

		const response = await worker.fetch(
			new Request(`http://example.com/api/tours/${tourId}/itinerary?includeDestinationText=0`, {
				method: 'GET',
				headers,
			}),
			env
		);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.include_destination_text).toBe(false);
		expect(data.content).not.toContain('Summary: Hoan Kiem area walk and food rhythm.');
	});

	it('returns html itinerary when format=html', async () => {
		const { tourId } = await seedTourData(db, tenantId);

		const response = await worker.fetch(
			new Request(`http://example.com/api/tours/${tourId}/itinerary?format=html`, {
				method: 'GET',
				headers,
			}),
			env
		);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.format).toBe('html');
		expect(data.content).toContain('<!doctype html>');
		expect(data.content).toContain('Day 1: Hanoi');
	});

	it('uses language-specific destination text with fallback', async () => {
		const { tourId } = await seedTourData(db, tenantId);

		const enResponse = await worker.fetch(
			new Request(`http://example.com/api/tours/${tourId}/itinerary?lang=en`, {
				method: 'GET',
				headers,
			}),
			env
		);
		const enData = await enResponse.json();
		expect(enData.content).toContain('Summary: Old quarter orientation and neighborhood tasting.');
		expect(enData.lang).toBe('en');

		const frResponse = await worker.fetch(
			new Request(`http://example.com/api/tours/${tourId}/itinerary?lang=fr`, {
				method: 'GET',
				headers,
			}),
			env
		);
		const frData = await frResponse.json();
		expect(frData.content).toContain('Summary: Old quarter orientation and neighborhood tasting.');
		expect(frData.lang).toBe('fr');
	});

	it('returns validation error for invalid format', async () => {
		const { tourId } = await seedTourData(db, tenantId);
		const response = await worker.fetch(
			new Request(`http://example.com/api/tours/${tourId}/itinerary?format=pdf`, {
				method: 'GET',
				headers,
			}),
			env
		);
		expect(response.status).toBe(400);
	});
});

async function seedTourData(db, tenantId) {
	const now = Date.now();
	const tourId = crypto.randomUUID();
	const destinationId = crypto.randomUUID();

	await db
		.prepare(
			`INSERT INTO tours (id, tenant_id, title, lang, start_date, duration_text, status, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(tourId, tenantId, 'Hanoi Discovery', 'vi', now, '3N2D', 'draft', now)
		.run();

	await db
		.prepare(
			`INSERT INTO destinations (id, tenant_id, tour_id, name, position, nights, arrival_date, departure_date, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(destinationId, tenantId, tourId, 'Hanoi', 1, 2, now + 7200000, now + 2 * 24 * 3600000, now)
		.run();

	await db
		.prepare(
			`INSERT INTO destination_texts (id, tenant_id, destination_id, summary, details, notes, lang, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			crypto.randomUUID(),
			tenantId,
			destinationId,
			'Hoan Kiem area walk and food rhythm.',
			'Craft alleys, temple edge, and old quarter evening pulse.',
			null,
			'vi',
			now
		)
		.run();

	await db
		.prepare(
			`INSERT INTO destination_texts (id, tenant_id, destination_id, summary, details, notes, lang, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			crypto.randomUUID(),
			tenantId,
			destinationId,
			'Old quarter orientation and neighborhood tasting.',
			'Street-level pace with market and lake corridor highlights.',
			null,
			'en',
			now + 1000
		)
		.run();

	await db
		.prepare(
			`INSERT INTO dest_accommodations (id, tenant_id, destination_id, hotel_name, position, created_at)
			VALUES (?, ?, ?, ?, ?, ?)`
		)
		.bind(crypto.randomUUID(), tenantId, destinationId, 'Lake View Hotel', 1, now)
		.run();

	await db
		.prepare(
			`INSERT INTO dest_meals (id, tenant_id, destination_id, meal_type, restaurant_name, position, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(crypto.randomUUID(), tenantId, destinationId, 'Dinner', 'Pho Gia Truyen', 1, now)
		.run();

	return { tourId, destinationId };
}

function tableStatements() {
	return [
		`CREATE TABLE IF NOT EXISTS tours (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			title TEXT NOT NULL,
			lang TEXT DEFAULT 'vi',
			start_date INTEGER,
			duration_text TEXT,
			status TEXT,
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS destinations (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			tour_id TEXT NOT NULL,
			name TEXT NOT NULL,
			position INTEGER NOT NULL,
			nights INTEGER NOT NULL,
			arrival_date INTEGER,
			departure_date INTEGER,
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS destination_texts (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			destination_id TEXT NOT NULL,
			summary TEXT,
			details TEXT,
			notes TEXT,
			lang TEXT,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS dest_accommodations (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			destination_id TEXT NOT NULL,
			hotel_name TEXT,
			position INTEGER NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS dest_meals (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			destination_id TEXT NOT NULL,
			meal_type TEXT,
			restaurant_name TEXT,
			position INTEGER NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS dest_guides (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			destination_id TEXT NOT NULL,
			guide_name TEXT,
			position INTEGER NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS dest_local_transports (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			destination_id TEXT NOT NULL,
			supplier TEXT,
			position INTEGER NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS dest_intercity_legs (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			destination_id TEXT NOT NULL,
			supplier TEXT,
			position INTEGER NOT NULL,
			created_at INTEGER NOT NULL
		)`,
	];
}
