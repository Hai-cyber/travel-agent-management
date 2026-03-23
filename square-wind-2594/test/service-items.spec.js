import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index.js';

describe('Service Items - Operational CRUD', () => {
	let db;
	const tenantId = 'ten-service-1';
	const defaultHeaders = { 'X-Tenant-ID': tenantId, 'Content-Type': 'application/json' };

	beforeEach(async () => {
		db = env.DB;
		for (const statement of tableStatements()) {
			await db.prepare(statement).run();
		}
	});

	afterEach(async () => {
		for (const table of [
			'comm_threads',
			'dest_intercity_legs',
			'dest_local_transports',
			'dest_guides',
			'dest_meals',
			'dest_accommodations',
			'destinations',
			'tours',
		]) {
			await db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
		}
	});

	it('creates accommodation with auto-filled check-in/check-out and a thread', async () => {
		const destination = await seedDestination(db, tenantId);

		const response = await worker.fetch(
			new Request(`http://example.com/api/destinations/${destination.id}/accommodations`, {
				method: 'POST',
				headers: defaultHeaders,
				body: JSON.stringify({
					hotel_name: 'Hotel de l Opera',
					person_in_charge: 'Mai Tran',
					contact_name: 'Reservations Desk',
					contact_email: 'booking@hotel.test',
					address: '29 Trang Tien, Hanoi',
					communication_channels: ['email', 'zalo'],
					notes: 'Hold deluxe rooms near elevator.',
				}),
			}),
			env
		);

		const data = await response.json();
		expect(response.status).toBe(201);
		expect(data.hotel_name).toBe('Hotel de l Opera');
		expect(data.check_in).toBe(destination.arrival_date);
		expect(data.check_out).toBe(destination.departure_date);
		expect(data.stage).toBe('pending');
		expect(data.communication_channels).toEqual(['email', 'zalo']);
		expect(data.thread_id).toBeTruthy();
	});

	it('creates meal with auto-filled datetime based on meal type', async () => {
		const destination = await seedDestination(db, tenantId);

		const response = await worker.fetch(
			new Request(`http://example.com/api/destinations/${destination.id}/meals`, {
				method: 'POST',
				headers: defaultHeaders,
				body: JSON.stringify({
					meal_type: 'dinner',
					restaurant_name: 'Cha Ca Family House',
					person_in_charge: 'Hung Le',
					contact_name: 'Thu Host',
					contact_email: 'thu@restaurant.test',
					address: '14 Cha Ca, Hanoi',
				}),
			}),
			env
		);

		const data = await response.json();
		expect(response.status).toBe(201);
		expect(typeof data.meal_datetime).toBe('number');
		expect(data.restaurant_name).toBe('Cha Ca Family House');
	});

	it('creates guide with auto-filled time window', async () => {
		const destination = await seedDestination(db, tenantId);
		const response = await worker.fetch(
			new Request(`http://example.com/api/destinations/${destination.id}/guides`, {
				method: 'POST',
				headers: defaultHeaders,
				body: JSON.stringify({
					guide_name: 'Lan Pham',
					person_in_charge: 'Binh Tran',
					contact_name: 'Lan Pham',
					contact_email: 'lan@guide.test',
					address: 'Hanoi Old Quarter',
					languages: 'vi,en',
				}),
			}),
			env
		);
		const data = await response.json();
		expect(response.status).toBe(201);
		expect(data.time_from).toBeTruthy();
		expect(data.time_to).toBeTruthy();
		expect(data.time_to).toBeGreaterThan(data.time_from);
	});

	it('creates local transport with auto-filled pickup defaults', async () => {
		const destination = await seedDestination(db, tenantId);
		const response = await worker.fetch(
			new Request(`http://example.com/api/destinations/${destination.id}/local-transports`, {
				method: 'POST',
				headers: defaultHeaders,
				body: JSON.stringify({
					mode: 'van',
					supplier: 'City Shuttle Co',
					person_in_charge: 'An Vu',
					contact_name: 'Dispatch',
					contact_email: 'ops@shuttle.test',
					address: 'Noi Bai Airport, Hanoi',
				}),
			}),
			env
		);
		const data = await response.json();
		expect(response.status).toBe(201);
		expect(data.pickup_time).toBe(destination.arrival_date);
		expect(data.pickup_place).toContain('Hanoi');
	});

	it('creates intercity leg with auto-filled departure defaults', async () => {
		const destination = await seedDestination(db, tenantId);
		const response = await worker.fetch(
			new Request(`http://example.com/api/destinations/${destination.id}/intercity-legs`, {
				method: 'POST',
				headers: defaultHeaders,
				body: JSON.stringify({
					mode: 'flight',
					supplier: 'Vietnam Airlines',
					person_in_charge: 'Duc Hoang',
					contact_name: 'Air Desk',
					contact_email: 'desk@air.test',
					address: 'Noi Bai Airport',
				}),
			}),
			env
		);
		const data = await response.json();
		expect(response.status).toBe(201);
		expect(data.depart_time).toBe(destination.departure_date);
		expect(data.depart_point).toBe('Hanoi');
	});

	it('lists service items for a destination', async () => {
		const destination = await seedDestination(db, tenantId);
		await createAccommodation(destination.id, defaultHeaders, env, worker, 'Heritage Stay');
		await createAccommodation(destination.id, defaultHeaders, env, worker, 'West Lake Lodge');

		const response = await worker.fetch(
			new Request(`http://example.com/api/destinations/${destination.id}/accommodations`, {
				method: 'GET',
				headers: defaultHeaders,
			}),
			env
		);
		const data = await response.json();
		expect(response.status).toBe(200);
		expect(data.items).toHaveLength(2);
		expect(data.items[0].thread_id).toBeTruthy();
	});

	it('updates stage and communication channels on a service item', async () => {
		const destination = await seedDestination(db, tenantId);
		const createResponse = await createAccommodation(destination.id, defaultHeaders, env, worker, 'Opera Suites');
		const created = await createResponse.json();

		const response = await worker.fetch(
			new Request(`http://example.com/api/accommodations/${created.id}`, {
				method: 'PATCH',
				headers: defaultHeaders,
				body: JSON.stringify({
					stage: 'confirmed',
					status: 'confirmed',
					communication_channels: ['sms', 'messenger'],
					address: 'Updated address block',
				}),
			}),
			env
		);
		const data = await response.json();
		expect(response.status).toBe(200);
		expect(data.stage).toBe('confirmed');
		expect(data.status).toBe('confirmed');
		expect(data.communication_channels).toEqual(['sms', 'messenger']);
		expect(data.address).toBe('Updated address block');
	});

	it('rejects missing operational fields', async () => {
		const destination = await seedDestination(db, tenantId);
		const response = await worker.fetch(
			new Request(`http://example.com/api/destinations/${destination.id}/meals`, {
				method: 'POST',
				headers: defaultHeaders,
				body: JSON.stringify({
					meal_type: 'lunch',
					restaurant_name: 'No Contact Restaurant',
				}),
			}),
			env
		);
		const data = await response.json();
		expect(response.status).toBe(400);
		expect(data.error.code).toBe('validation_error');
	});

	it('enforces tenant isolation for service listing', async () => {
		const destination = await seedDestination(db, tenantId);
		await createAccommodation(destination.id, defaultHeaders, env, worker, 'Tenant Locked Hotel');
		const response = await worker.fetch(
			new Request(`http://example.com/api/destinations/${destination.id}/accommodations`, {
				method: 'GET',
				headers: { 'X-Tenant-ID': 'other-tenant' },
			}),
			env
		);
		expect(response.status).toBe(404);
	});
});

async function seedDestination(db, tenantId) {
	const tourId = crypto.randomUUID();
	const destinationId = crypto.randomUUID();
	const now = Date.now();
	const arrivalDate = now + 24 * 60 * 60 * 1000;
	const departureDate = arrivalDate + 3 * 24 * 60 * 60 * 1000;

	await db
		.prepare('INSERT INTO tours (id, tenant_id, title, start_date, duration_text, lang, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
		.bind(tourId, tenantId, 'Operations Tour', now, '5N4D', 'vi', 'draft', now)
		.run();

	await db
		.prepare('INSERT INTO destinations (id, tenant_id, tour_id, name, position, nights, arrival_date, departure_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
		.bind(destinationId, tenantId, tourId, 'Hanoi', 1, 3, arrivalDate, departureDate, now)
		.run();

	return { id: destinationId, tourId, arrival_date: arrivalDate, departure_date: departureDate };
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
			status TEXT NOT NULL DEFAULT 'draft',
			created_at INTEGER NOT NULL
		)`,
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
		)`,
		serviceTable('dest_accommodations', [
			'hotel_name TEXT NOT NULL',
			'contact_name TEXT',
			'contact_phone TEXT',
			'contact_email TEXT',
			'check_in INTEGER',
			'check_out INTEGER',
			'room_type TEXT',
			'guests INTEGER',
		]),
		serviceTable('dest_meals', [
			'meal_type TEXT NOT NULL',
			'restaurant_name TEXT NOT NULL',
			'contact_name TEXT',
			'contact_phone TEXT',
			'contact_email TEXT',
			'meal_datetime INTEGER',
		]),
		serviceTable('dest_guides', [
			'guide_name TEXT NOT NULL',
			'contact_name TEXT',
			'phone TEXT',
			'email TEXT',
			'languages TEXT',
			'time_from INTEGER',
			'time_to INTEGER',
		]),
		serviceTable('dest_local_transports', [
			'mode TEXT NOT NULL',
			'supplier TEXT NOT NULL',
			'contact_name TEXT',
			'driver_name TEXT',
			'phone TEXT',
			'email TEXT',
			'pickup_time INTEGER',
			'pickup_place TEXT',
			'dropoff_place TEXT',
		]),
		serviceTable('dest_intercity_legs', [
			'mode TEXT NOT NULL',
			'supplier TEXT NOT NULL',
			'contact_name TEXT',
			'phone TEXT',
			'email TEXT',
			'depart_time INTEGER',
			'depart_point TEXT',
			'arrive_point TEXT',
			'ticket_ref TEXT',
		]),
		`CREATE TABLE IF NOT EXISTS comm_threads (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			entity_type TEXT NOT NULL,
			entity_id TEXT NOT NULL
		)`,
	];
}

function serviceTable(name, extraColumns) {
	return `CREATE TABLE IF NOT EXISTS ${name} (
		id TEXT PRIMARY KEY,
		tenant_id TEXT NOT NULL,
		destination_id TEXT NOT NULL,
		person_in_charge TEXT NOT NULL,
		address TEXT NOT NULL,
		communication_channels_json TEXT,
		stage TEXT NOT NULL DEFAULT 'pending',
		${extraColumns.join(',\n\t\t')},
		notes TEXT,
		status TEXT NOT NULL DEFAULT 'planned',
		position INTEGER NOT NULL,
		created_at INTEGER NOT NULL
	)`;
}

function createAccommodation(destinationId, headers, env, worker, hotelName) {
	return worker.fetch(
		new Request(`http://example.com/api/destinations/${destinationId}/accommodations`, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				hotel_name: hotelName,
				person_in_charge: 'Mai Tran',
				contact_name: 'Reservations Desk',
				contact_email: 'booking@hotel.test',
				address: '29 Trang Tien, Hanoi',
			}),
		}),
		env
	);
}
