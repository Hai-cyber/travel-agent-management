import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index.js';

describe('Publish Gate [CHK-402]', () => {
	let db;
	const tenantId = 'ten-publish-1';
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

	it('returns a blocked publish gate with preview still allowed by default', async () => {
		const response = await worker.fetch(
			new Request('http://example.com/api/publish/gate', { method: 'GET', headers }),
			env
		);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.preview_allowed).toBe(true);
		expect(data.publish_allowed).toBe(false);
		expect(data.requirements.domain_verified.satisfied).toBe(false);
		expect(data.requirements.payment_method_added.satisfied).toBe(false);
		expect(data.requirements.terms_accepted.satisfied).toBe(false);
		expect(data.requirements.commission_agreement_accepted.satisfied).toBe(false);
	});

	it('updates tenant publish checklist and allows publish once all conditions are satisfied', async () => {
		await db
			.prepare(
				`INSERT INTO tenant_domain_configs
				(tenant_id, hostname, status, verification_record_type, verification_record_name, verification_record_value, verified_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(tenantId, 'tour.company.vn', 'verified', 'TXT', '_tour-booking-verification.tour.company.vn', 'tb-verify-123', Date.now(), Date.now())
			.run();

		const response = await worker.fetch(
			new Request('http://example.com/api/publish/gate', {
				method: 'POST',
				headers,
				body: JSON.stringify({
					payment_method_added: true,
					terms_accepted: true,
					commission_agreement_accepted: true,
				}),
			}),
			env
		);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.publish_allowed).toBe(true);
		expect(data.requirements.domain_verified.satisfied).toBe(true);
		expect(data.requirements.payment_method_added.satisfied).toBe(true);
		expect(data.requirements.terms_accepted.satisfied).toBe(true);
		expect(data.requirements.commission_agreement_accepted.satisfied).toBe(true);
	});

	it('blocks moving a tour to on_sale when publish gate is incomplete', async () => {
		const tourId = await seedTour(db, tenantId);

		const response = await worker.fetch(
			new Request(`http://example.com/api/tours/${tourId}`, {
				method: 'PATCH',
				headers,
				body: JSON.stringify({ status: 'on_sale' }),
			}),
			env
		);

		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.error.code).toBe('validation_error');
		expect(data.error.message).toBe('Publish gate requirements are not satisfied');
		expect(data.error.details.requirements.domain_verified.satisfied).toBe(false);
	});

	it('allows moving a tour to on_sale once publish gate is satisfied', async () => {
		const tourId = await seedTour(db, tenantId);
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

		const response = await worker.fetch(
			new Request(`http://example.com/api/tours/${tourId}`, {
				method: 'PATCH',
				headers,
				body: JSON.stringify({ status: 'on_sale' }),
			}),
			env
		);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.status).toBe('on_sale');
	});
});

async function seedTour(db, tenantId) {
	const tourId = crypto.randomUUID();
	await db
		.prepare(
			`INSERT INTO tours (id, tenant_id, title, lang, start_date, duration_text, status, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(tourId, tenantId, 'Publish Me', 'vi', Date.now(), '3N2D', 'draft', Date.now())
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