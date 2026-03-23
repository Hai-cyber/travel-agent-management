import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index.js';

describe('Suppliers [CHK-209]', () => {
	let db;
	const tenantId = 'ten-supplier-1';
	const headers = { 'X-Tenant-ID': tenantId, 'Content-Type': 'application/json' };

	beforeEach(async () => {
		db = env.DB;
		for (const statement of tableStatements()) {
			await db.prepare(statement).run();
		}
	});

	afterEach(async () => {
		for (const table of ['comm_threads', 'suppliers', 'dest_accommodations', 'destinations', 'tours']) {
			await db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
		}
	});

	it('creates and lists suppliers', async () => {
		const createResponse = await worker.fetch(
			new Request('http://example.com/api/suppliers', {
				method: 'POST',
				headers,
				body: JSON.stringify({ name: 'Sunrise Hotel Group', type: 'hotel', contact: '+84900000111', notes: 'Preferred partner' }),
			}),
			env
		);
		expect(createResponse.status).toBe(201);
		const created = await createResponse.json();
		expect(created.id).toBeTruthy();
		expect(created.type).toBe('hotel');

		const listResponse = await worker.fetch(new Request('http://example.com/api/suppliers?type=hotel', { method: 'GET', headers }), env);
		expect(listResponse.status).toBe(200);
		const listed = await listResponse.json();
		expect(listed.suppliers).toHaveLength(1);
		expect(listed.suppliers[0].name).toBe('Sunrise Hotel Group');
	});

	it('updates supplier details', async () => {
		const createResponse = await worker.fetch(
			new Request('http://example.com/api/suppliers', {
				method: 'POST',
				headers,
				body: JSON.stringify({ name: 'Hanoi Rail Desk', type: 'transport' }),
			}),
			env
		);
		const created = await createResponse.json();

		const updateResponse = await worker.fetch(
			new Request(`http://example.com/api/suppliers/${created.id}`, {
				method: 'PATCH',
				headers,
				body: JSON.stringify({ notes: 'Night train specialist', contact: 'rail@ops.test' }),
			}),
			env
		);
		expect(updateResponse.status).toBe(200);
		const updated = await updateResponse.json();
		expect(updated.notes).toBe('Night train specialist');
		expect(updated.contact).toBe('rail@ops.test');
	});

	it('links supplier_id on service items and rejects invalid supplier_id', async () => {
		const now = Date.now();
		const tourId = crypto.randomUUID();
		const destinationId = crypto.randomUUID();
		await db
			.prepare('INSERT INTO tours (id, tenant_id, title, lang, start_date, duration_text, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
			.bind(tourId, tenantId, 'Ops Tour', 'vi', now, '3N2D', 'draft', now)
			.run();
		await db
			.prepare('INSERT INTO destinations (id, tenant_id, tour_id, name, position, nights, arrival_date, departure_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
			.bind(destinationId, tenantId, tourId, 'Hanoi', 1, 2, now + 3600000, now + 2 * 24 * 3600000, now)
			.run();

		const supplierRes = await worker.fetch(
			new Request('http://example.com/api/suppliers', {
				method: 'POST',
				headers,
				body: JSON.stringify({ name: 'Lake View Hotels', type: 'hotel' }),
			}),
			env
		);
		const supplier = await supplierRes.json();

		const createService = await worker.fetch(
			new Request(`http://example.com/api/destinations/${destinationId}/accommodations`, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					hotel_name: 'Lake View Hotel',
					person_in_charge: 'Mai Tran',
					contact_name: 'Reservation',
					contact_email: 'booking@lake.test',
					address: 'Hanoi Center',
					supplier_id: supplier.id,
				}),
			}),
			env
		);
		expect(createService.status).toBe(201);
		const createdService = await createService.json();
		expect(createdService.supplier_id).toBe(supplier.id);

		const invalidService = await worker.fetch(
			new Request(`http://example.com/api/destinations/${destinationId}/accommodations`, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					hotel_name: 'Invalid Supplier Hotel',
					person_in_charge: 'Mai Tran',
					contact_name: 'Reservation',
					contact_email: 'booking@invalid.test',
					address: 'Hanoi Center',
					supplier_id: 'missing-supplier',
				}),
			}),
			env
		);
		expect(invalidService.status).toBe(400);
	});
});

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
		`CREATE TABLE IF NOT EXISTS suppliers (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			name TEXT NOT NULL,
			type TEXT NOT NULL,
			contact TEXT,
			notes TEXT,
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS dest_accommodations (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			destination_id TEXT NOT NULL,
			supplier_id TEXT,
			person_in_charge TEXT NOT NULL,
			hotel_name TEXT NOT NULL,
			contact_name TEXT,
			contact_phone TEXT,
			contact_email TEXT,
			address TEXT NOT NULL,
			check_in INTEGER,
			check_out INTEGER,
			room_type TEXT,
			guests INTEGER,
			notes TEXT,
			stage TEXT NOT NULL DEFAULT 'pending',
			communication_channels_json TEXT,
			status TEXT NOT NULL DEFAULT 'planned',
			position INTEGER NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS comm_threads (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			entity_type TEXT NOT NULL,
			entity_id TEXT NOT NULL
		)`,
	];
}
