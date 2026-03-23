import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index.js';

describe('Billing Restrictions [CHK-403]', () => {
	let db;
	const tenantId = 'ten-billing-1';
	const headers = { 'X-Tenant-ID': tenantId, 'Content-Type': 'application/json' };

	beforeEach(async () => {
		db = env.DB;
		for (const statement of tableStatements()) {
			await db.prepare(statement).run();
		}
	});

	afterEach(async () => {
		for (const table of ['tenant_billing_configs', 'tenant_publish_configs', 'tenant_domain_configs', 'tours']) {
			await db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
		}
	});

	it('returns a default trialing billing status with publish and bookings allowed', async () => {
		const response = await worker.fetch(
			new Request('http://example.com/api/billing/status', { method: 'GET', headers }),
			env
		);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.subscription_status).toBe('trialing');
		expect(data.publish_allowed).toBe(true);
		expect(data.new_bookings_allowed).toBe(true);
		expect(data.trial_started_at).toBeTypeOf('number');
		expect(data.trial_ends_at).toBeGreaterThan(data.trial_started_at);
	});

	it('updates tenant billing status and reports unpaid restriction state', async () => {
		const response = await worker.fetch(
			new Request('http://example.com/api/billing/status', {
				method: 'POST',
				headers,
				body: JSON.stringify({ subscription_status: 'unpaid' }),
			}),
			env
		);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.subscription_status).toBe('unpaid');
		expect(data.publish_allowed).toBe(false);
		expect(data.new_bookings_allowed).toBe(false);
		expect(data.restriction_reason).toBe('unpaid');
	});

	it('causes publish gate to fail billing requirement when unpaid', async () => {
		await db
			.prepare(
				`INSERT INTO tenant_domain_configs
				(tenant_id, hostname, status, verification_record_type, verification_record_name, verification_record_value, verified_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(tenantId, 'tour.company.vn', 'verified', 'TXT', '_tour-booking-verification.tour.company.vn', 'tb-verify-123', Date.now(), Date.now())
			.run();
		await db
			.prepare(
				`INSERT INTO tenant_publish_configs
				(tenant_id, payment_method_added, terms_accepted, commission_agreement_accepted, updated_at)
				VALUES (?, ?, ?, ?, ?)`
			)
			.bind(tenantId, 1, 1, 1, Date.now())
			.run();
		await db
			.prepare(
				`INSERT INTO tenant_billing_configs
				(tenant_id, trial_started_at, trial_ends_at, subscription_status, updated_at)
				VALUES (?, ?, ?, ?, ?)`
			)
			.bind(tenantId, Date.now(), Date.now() + 1000, 'unpaid', Date.now())
			.run();

		const response = await worker.fetch(
			new Request('http://example.com/api/publish/gate', { method: 'GET', headers }),
			env
		);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.publish_allowed).toBe(false);
		expect(data.requirements.billing_in_good_standing.satisfied).toBe(false);
	});

	it('blocks moving a tour to booked when billing is unpaid', async () => {
		const tourId = await seedTour(db, tenantId);
		await db
			.prepare(
				`INSERT INTO tenant_billing_configs
				(tenant_id, trial_started_at, trial_ends_at, subscription_status, updated_at)
				VALUES (?, ?, ?, ?, ?)`
			)
			.bind(tenantId, Date.now(), Date.now() + 1000, 'unpaid', Date.now())
			.run();

		const response = await worker.fetch(
			new Request(`http://example.com/api/tours/${tourId}`, {
				method: 'PATCH',
				headers,
				body: JSON.stringify({ status: 'booked' }),
			}),
			env
		);

		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.error.code).toBe('validation_error');
		expect(data.error.message).toBe('Billing status does not allow new bookings');
		expect(data.error.details.new_bookings_allowed).toBe(false);
	});

	it('allows moving a tour to booked while tenant is in trial', async () => {
		const tourId = await seedTour(db, tenantId);

		const response = await worker.fetch(
			new Request(`http://example.com/api/tours/${tourId}`, {
				method: 'PATCH',
				headers,
				body: JSON.stringify({ status: 'booked' }),
			}),
			env
		);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.status).toBe('booked');
	});
});

async function seedTour(db, tenantId) {
	const tourId = crypto.randomUUID();
	await db
		.prepare(
			`INSERT INTO tours (id, tenant_id, title, lang, start_date, duration_text, status, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(tourId, tenantId, 'Billable Tour', 'vi', Date.now(), '3N2D', 'draft', Date.now())
		.run();
	return tourId;
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
		`CREATE TABLE IF NOT EXISTS tenant_domain_configs (
			tenant_id TEXT PRIMARY KEY,
			hostname TEXT UNIQUE,
			status TEXT NOT NULL CHECK (status IN ('no_domain', 'pending', 'verified')) DEFAULT 'no_domain',
			verification_record_type TEXT NOT NULL DEFAULT 'TXT',
			verification_record_name TEXT,
			verification_record_value TEXT,
			verified_at INTEGER,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS tenant_publish_configs (
			tenant_id TEXT PRIMARY KEY,
			payment_method_added INTEGER NOT NULL DEFAULT 0,
			terms_accepted INTEGER NOT NULL DEFAULT 0,
			commission_agreement_accepted INTEGER NOT NULL DEFAULT 0,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS tenant_billing_configs (
			tenant_id TEXT PRIMARY KEY,
			trial_started_at INTEGER NOT NULL,
			trial_ends_at INTEGER NOT NULL,
			subscription_status TEXT NOT NULL CHECK (subscription_status IN ('trialing', 'active', 'unpaid')) DEFAULT 'trialing',
			updated_at INTEGER NOT NULL
		)`,
	];
}