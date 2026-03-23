import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index.js';

describe('Bookings & Demo Payment [CHK-406]', () => {
	let db;
	const tenantId = 'ten-booking-1';
	const headers = { 'X-Tenant-ID': tenantId, 'Content-Type': 'application/json' };

	beforeEach(async () => {
		db = env.DB;
		for (const statement of tableStatements()) {
			await db.prepare(statement).run();
		}
	});

	afterEach(async () => {
		for (const table of ['demo_payments', 'bookings', 'booking_settings', 'tasks', 'dest_intercity_legs', 'dest_local_transports', 'dest_guides', 'dest_meals', 'dest_accommodations', 'destinations', 'tours']) {
			await db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
		}
	});

	it('persists tenant booking settings date_time_format', async () => {
		await db
			.prepare(
				`CREATE TABLE IF NOT EXISTS booking_settings (
					tenant_id TEXT PRIMARY KEY,
					auto_confirm_min_days INTEGER NOT NULL DEFAULT 30,
					auto_confirm_max_pax INTEGER NOT NULL DEFAULT 16,
					class_presets_json TEXT,
					pricing_tiers_json TEXT,
					date_time_format TEXT,
					pricing_currency_mode TEXT,
					pricing_base_currency TEXT,
					usd_to_vnd_rate REAL,
					class_labels_json TEXT,
					class_prices_json TEXT,
					class_descriptions_json TEXT,
					single_room_supplement_json TEXT,
					child_discount_pct REAL NOT NULL DEFAULT 0.5,
					updated_at INTEGER NOT NULL
				)`
			)
			.run();

		const saveRes = await worker.fetch(
			new Request('http://example.com/api/booking-settings', {
				method: 'POST',
				headers,
				body: JSON.stringify({ date_time_format: 'dd.mm.yyyy hh:mm' }),
			}),
			env
		);
		expect(saveRes.status).toBe(200);
		const saved = await saveRes.json();
		expect(saved.date_time_format).toBe('dd.mm.yyyy hh:mm');

		const getRes = await worker.fetch(new Request('http://example.com/api/booking-settings', { method: 'GET', headers }), env);
		expect(getRes.status).toBe(200);
		const loaded = await getRes.json();
		expect(loaded.date_time_format).toBe('dd.mm.yyyy hh:mm');
	});

	it('traveler submits booking on an on_sale tour', async () => {
		const tourId = await seedTour(db, tenantId, 'Mekong Journey', 'on_sale');

		const res = await worker.fetch(
			new Request('http://example.com/public/bookings', {
				method: 'POST',
				headers,
				body: JSON.stringify({ tour_id: tourId, traveler_name: 'Nam Tran', traveler_email: 'nam@example.com', pax: 2, message: 'Family trip' }),
			}),
			env
		);
		expect(res.status).toBe(201);
		const data = await res.json();
		expect(data.status).toBe('pending');
		expect(data.payment_status).toBe('unpaid');
		expect(data._next).toContain('/pay');
	});

	it('rejects booking on a draft tour', async () => {
		const tourId = await seedTour(db, tenantId, 'Draft Tour', 'draft');

		const res = await worker.fetch(
			new Request('http://example.com/public/bookings', {
				method: 'POST',
				headers,
				body: JSON.stringify({ tour_id: tourId, traveler_name: 'Mai Le', pax: 1 }),
			}),
			env
		);
		expect(res.status).toBe(404);
	});

	it('traveler completes demo payment flow', async () => {
		const tourId = await seedTour(db, tenantId, 'Ha Long Classic', 'on_sale');

		const bookRes = await worker.fetch(
			new Request('http://example.com/public/bookings', {
				method: 'POST',
				headers,
				body: JSON.stringify({ tour_id: tourId, traveler_name: 'Linh Pham', pax: 3 }),
			}),
			env
		);
		expect(bookRes.status).toBe(201);
		const booking = await bookRes.json();

		const payRes = await worker.fetch(
			new Request(`http://example.com/public/bookings/${booking.id}/pay`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ card_number: '4242424242424242', expiry: '12/28', cvv: '123', amount: 5990000 }),
			}),
			env
		);
		expect(payRes.status).toBe(200);
		const payment = await payRes.json();
		expect(payment.status).toBe('paid');
		expect(payment.card_last4).toBe('4242');
		expect(payment.amount).toBe(5990000);

		// Booking should now show payment_status=paid
		const checkRes = await worker.fetch(
			new Request(`http://example.com/public/bookings/${booking.id}`, { method: 'GET', headers }),
			env
		);
		expect(checkRes.status).toBe(200);
		const check = await checkRes.json();
		expect(check.payment_status).toBe('paid');
	});

	it('auto-confirms booking on payment when desired departure is at least 30 days ahead', async () => {
		const tourId = await seedTour(db, tenantId, 'Auto Confirm Tour', 'on_sale');
		const desiredDeparture = Date.now() + 35 * 24 * 60 * 60 * 1000;

		await db
			.prepare(
				`INSERT INTO destinations
				(id, tenant_id, tour_id, name, position, nights, arrival_date, departure_date, service_blueprint_json, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(
				crypto.randomUUID(),
				tenantId,
				tourId,
				'Hoian',
				1,
				2,
				Date.now(),
				Date.now() + 86400000,
				JSON.stringify({ accommodations: true, meals: false, guides: false, local_transports: false, intercity_legs: false }),
				Date.now()
			)
			.run();

		const bookRes = await worker.fetch(
			new Request('http://example.com/public/bookings', {
				method: 'POST',
				headers,
				body: JSON.stringify({
					tour_id: tourId,
					traveler_name: 'Auto Confirm User',
					pax: 2,
					desired_departure_date: desiredDeparture,
				}),
			}),
			env
		);
		const booking = await bookRes.json();

		const payRes = await worker.fetch(
			new Request(`http://example.com/public/bookings/${booking.id}/pay`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ card_number: '4242424242424242', expiry: '12/28', cvv: '123', amount: 1990000 }),
			}),
			env
		);
		expect(payRes.status).toBe(200);
		const payment = await payRes.json();
		expect(payment.auto_confirmed).toBe(true);

		const checkRes = await worker.fetch(new Request(`http://example.com/public/bookings/${booking.id}`, { method: 'GET', headers }), env);
		const check = await checkRes.json();
		expect(check.status).toBe('confirmed');
	});

	it('does not auto-confirm when pax is not below configured threshold', async () => {
		const tourId = await seedTour(db, tenantId, 'Threshold Tour', 'on_sale');
		const desiredDeparture = Date.now() + 35 * 24 * 60 * 60 * 1000;

		await db
			.prepare(
				`CREATE TABLE IF NOT EXISTS booking_settings (
					tenant_id TEXT PRIMARY KEY,
					auto_confirm_min_days INTEGER NOT NULL DEFAULT 30,
					auto_confirm_max_pax INTEGER NOT NULL DEFAULT 16,
					pricing_tiers_json TEXT,
					pricing_currency_mode TEXT,
					pricing_base_currency TEXT,
					usd_to_vnd_rate REAL,
					class_labels_json TEXT,
					class_prices_json TEXT,
					class_descriptions_json TEXT,
					single_room_supplement_json TEXT,
					child_discount_pct REAL NOT NULL DEFAULT 0.5,
					updated_at INTEGER NOT NULL
				)`
			)
			.run();
		await db
			.prepare(
				`INSERT INTO booking_settings (tenant_id, auto_confirm_min_days, auto_confirm_max_pax, pricing_tiers_json, pricing_currency_mode, pricing_base_currency, usd_to_vnd_rate, class_labels_json, class_prices_json, class_descriptions_json, single_room_supplement_json, child_discount_pct, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(
				tenantId,
				30,
				16,
				JSON.stringify([]),
				'auto',
				'VND',
				25000,
				JSON.stringify({ '3_star': 'Casual', '4_star': 'Boutique', '5_star': 'Luxury' }),
				JSON.stringify({ '3_star': 100, '4_star': 200, '5_star': 300 }),
				JSON.stringify({ '3_star': 'basic', '4_star': 'plus', '5_star': 'premium' }),
				JSON.stringify({ '3_star': 10, '4_star': 20, '5_star': 30 }),
				0.5,
				Date.now()
			)
			.run();

		const bookRes = await worker.fetch(
			new Request('http://example.com/public/bookings', {
				method: 'POST',
				headers,
				body: JSON.stringify({
					tour_id: tourId,
					traveler_name: 'Threshold User',
					pax: 16,
					desired_departure_date: desiredDeparture,
				}),
			}),
			env
		);
		const booking = await bookRes.json();

		const payRes = await worker.fetch(
			new Request(`http://example.com/public/bookings/${booking.id}/pay`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ card_number: '4242424242424242', expiry: '12/28', cvv: '123', amount: 1990000 }),
			}),
			env
		);
		const payment = await payRes.json();
		expect(payment.auto_confirmed).toBe(false);

		const checkRes = await worker.fetch(new Request(`http://example.com/public/bookings/${booking.id}`, { method: 'GET', headers }), env);
		const check = await checkRes.json();
		expect(check.status).toBe('pending');
	});

	it('agent confirms booking and auto-generates tasks', async () => {
		const tourId = await seedTour(db, tenantId, 'Sapa Trekker', 'on_sale');

		const bookRes = await worker.fetch(
			new Request('http://example.com/public/bookings', {
				method: 'POST',
				headers,
				body: JSON.stringify({ tour_id: tourId, traveler_name: 'Hoa Nguyen', pax: 2 }),
			}),
			env
		);
		const booking = await bookRes.json();

		const listRes = await worker.fetch(new Request('http://example.com/api/bookings', { method: 'GET', headers }), env);
		expect(listRes.status).toBe(200);
		const list = await listRes.json();
		expect(list.bookings.length).toBeGreaterThanOrEqual(1);
		expect(list.bookings[0].traveler_name).toBe('Hoa Nguyen');

		const confirmRes = await worker.fetch(
			new Request(`http://example.com/api/bookings/${booking.id}`, {
				method: 'PATCH',
				headers,
				body: JSON.stringify({ status: 'confirmed' }),
			}),
			env
		);
		expect(confirmRes.status).toBe(200);
		const confirmed = await confirmRes.json();
		expect(confirmed.status).toBe('confirmed');
		// generated_task_count is 0 because no service items seeded, but the field must be present
		expect(typeof confirmed.generated_task_count).toBe('number');
	});

	it('blocks double payment on already-paid booking', async () => {
		const tourId = await seedTour(db, tenantId, 'Danang Sun', 'on_sale');

		const bookRes = await worker.fetch(
			new Request('http://example.com/public/bookings', {
				method: 'POST',
				headers,
				body: JSON.stringify({ tour_id: tourId, traveler_name: 'An Bui', pax: 1 }),
			}),
			env
		);
		const booking = await bookRes.json();

		const payPayload = { card_number: '5500005555555559', expiry: '01/29', cvv: '321', amount: 2990000 };
		const pay1 = await worker.fetch(
			new Request(`http://example.com/public/bookings/${booking.id}/pay`, { method: 'POST', headers, body: JSON.stringify(payPayload) }),
			env
		);
		expect(pay1.status).toBe(200);

		const pay2 = await worker.fetch(
			new Request(`http://example.com/public/bookings/${booking.id}/pay`, { method: 'POST', headers, body: JSON.stringify(payPayload) }),
			env
		);
		expect(pay2.status).toBe(400);
	});

	it('auto-creates hidden CRM service rows from destination blueprint on booking confirm', async () => {
		const tourId = await seedTour(db, tenantId, 'Blueprint Tour', 'on_sale');

		await db
			.prepare(
				`INSERT INTO destinations
				(id, tenant_id, tour_id, name, position, nights, arrival_date, departure_date, service_blueprint_json, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(
				crypto.randomUUID(),
				tenantId,
				tourId,
				'Hanoi',
				1,
				2,
				Date.now(),
				Date.now() + 86400000,
				JSON.stringify({ accommodations: true, meals: false, guides: true, local_transports: false, intercity_legs: false }),
				Date.now()
			)
			.run();

		const bookRes = await worker.fetch(
			new Request('http://example.com/public/bookings', {
				method: 'POST',
				headers,
				body: JSON.stringify({ tour_id: tourId, traveler_name: 'Blueprint User', pax: 2 }),
			}),
			env
		);
		const booking = await bookRes.json();

		const confirmRes = await worker.fetch(
			new Request(`http://example.com/api/bookings/${booking.id}`, {
				method: 'PATCH',
				headers,
				body: JSON.stringify({ status: 'confirmed' }),
			}),
			env
		);
		expect(confirmRes.status).toBe(200);
		const confirmed = await confirmRes.json();
		expect(confirmed.generated_task_count).toBeGreaterThan(0);

		const accommodations = await db.prepare('SELECT COUNT(*) as total FROM dest_accommodations WHERE tenant_id = ? AND destination_id IS NOT NULL').bind(tenantId).first();
		const guides = await db.prepare('SELECT COUNT(*) as total FROM dest_guides WHERE tenant_id = ? AND destination_id IS NOT NULL').bind(tenantId).first();
		expect(accommodations.total).toBeGreaterThan(0);
		expect(guides.total).toBeGreaterThan(0);
	});
});

async function seedTour(db, tenantId, title, status) {
	const id = crypto.randomUUID();
	await db
		.prepare(`INSERT INTO tours (id, tenant_id, title, lang, start_date, duration_text, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
		.bind(id, tenantId, title, 'vi', Date.now(), '3N2D', status, Date.now())
		.run();
	return id;
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
			service_blueprint_json TEXT,
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS dest_accommodations (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			destination_id TEXT NOT NULL,
			hotel_name TEXT NOT NULL,
			contact_name TEXT,
			contact_phone TEXT,
			contact_email TEXT,
			check_in INTEGER,
			check_out INTEGER,
			room_type TEXT,
			guests INTEGER,
			notes TEXT,
			status TEXT NOT NULL DEFAULT 'planned',
			position INTEGER NOT NULL,
			created_at INTEGER NOT NULL,
			person_in_charge TEXT,
			address TEXT,
			stage TEXT NOT NULL DEFAULT 'pending',
			communication_channels_json TEXT
		)`,
		`CREATE TABLE IF NOT EXISTS dest_meals (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			destination_id TEXT NOT NULL,
			meal_type TEXT NOT NULL,
			restaurant_name TEXT,
			contact_name TEXT,
			contact_phone TEXT,
			contact_email TEXT,
			meal_datetime INTEGER,
			notes TEXT,
			status TEXT NOT NULL DEFAULT 'planned',
			position INTEGER NOT NULL,
			created_at INTEGER NOT NULL,
			person_in_charge TEXT,
			address TEXT,
			stage TEXT NOT NULL DEFAULT 'pending',
			communication_channels_json TEXT
		)`,
		`CREATE TABLE IF NOT EXISTS dest_guides (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			destination_id TEXT NOT NULL,
			guide_name TEXT,
			phone TEXT,
			email TEXT,
			languages TEXT,
			time_from INTEGER,
			time_to INTEGER,
			notes TEXT,
			status TEXT NOT NULL DEFAULT 'planned',
			position INTEGER NOT NULL,
			created_at INTEGER NOT NULL,
			person_in_charge TEXT,
			contact_name TEXT,
			address TEXT,
			stage TEXT NOT NULL DEFAULT 'pending',
			communication_channels_json TEXT,
			contact_phone TEXT,
			contact_email TEXT
		)`,
		`CREATE TABLE IF NOT EXISTS dest_local_transports (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			destination_id TEXT NOT NULL,
			mode TEXT NOT NULL,
			supplier TEXT,
			driver_name TEXT,
			phone TEXT,
			email TEXT,
			pickup_time INTEGER,
			pickup_place TEXT,
			dropoff_place TEXT,
			notes TEXT,
			status TEXT NOT NULL DEFAULT 'planned',
			position INTEGER NOT NULL,
			created_at INTEGER NOT NULL,
			person_in_charge TEXT,
			contact_name TEXT,
			address TEXT,
			stage TEXT NOT NULL DEFAULT 'pending',
			communication_channels_json TEXT,
			contact_phone TEXT,
			contact_email TEXT
		)`,
		`CREATE TABLE IF NOT EXISTS dest_intercity_legs (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			destination_id TEXT NOT NULL,
			mode TEXT NOT NULL,
			supplier TEXT,
			contact_name TEXT,
			phone TEXT,
			email TEXT,
			depart_time INTEGER,
			depart_point TEXT,
			arrive_point TEXT,
			ticket_ref TEXT,
			notes TEXT,
			status TEXT NOT NULL DEFAULT 'planned',
			position INTEGER NOT NULL,
			created_at INTEGER NOT NULL,
			person_in_charge TEXT,
			address TEXT,
			stage TEXT NOT NULL DEFAULT 'pending',
			communication_channels_json TEXT,
			contact_phone TEXT,
			contact_email TEXT
		)`,
		`CREATE TABLE IF NOT EXISTS bookings (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			tour_id TEXT NOT NULL,
			traveler_name TEXT NOT NULL,
			traveler_email TEXT,
			traveler_phone TEXT,
			pax INTEGER NOT NULL DEFAULT 1,
			child_count INTEGER,
			single_room_count INTEGER,
			tour_class TEXT,
			quoted_total REAL,
			message TEXT,
			desired_departure_date INTEGER,
			status TEXT NOT NULL DEFAULT 'pending',
			payment_status TEXT NOT NULL DEFAULT 'unpaid',
			payment_amount INTEGER,
			payment_currency TEXT NOT NULL DEFAULT 'VND',
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS demo_payments (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			booking_id TEXT NOT NULL,
			amount INTEGER NOT NULL,
			currency TEXT NOT NULL DEFAULT 'VND',
			card_last4 TEXT,
			status TEXT NOT NULL DEFAULT 'paid',
			paid_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS booking_settings (
			tenant_id TEXT PRIMARY KEY,
			auto_confirm_min_days INTEGER NOT NULL DEFAULT 30,
			auto_confirm_max_pax INTEGER NOT NULL DEFAULT 16,
			class_presets_json TEXT,
			pricing_tiers_json TEXT,
			date_time_format TEXT,
			pricing_currency_mode TEXT,
			pricing_base_currency TEXT,
			usd_to_vnd_rate REAL,
			class_labels_json TEXT,
			class_prices_json TEXT,
			class_descriptions_json TEXT,
			single_room_supplement_json TEXT,
			child_discount_pct REAL NOT NULL DEFAULT 0.5,
			updated_at INTEGER NOT NULL
		)`,
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
		)`,
	];
}
