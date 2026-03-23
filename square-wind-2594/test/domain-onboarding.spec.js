import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index.js';

describe('Domain Onboarding [CHK-401]', () => {
	let db;
	const tenantId = 'ten-domain-1';
	const headers = { 'X-Tenant-ID': tenantId, 'Content-Type': 'application/json' };

	beforeEach(async () => {
		db = env.DB;
		await db
			.prepare(
				`CREATE TABLE IF NOT EXISTS tenant_domain_configs (
				tenant_id TEXT PRIMARY KEY,
				hostname TEXT UNIQUE,
				status TEXT NOT NULL CHECK (status IN ('no_domain', 'pending', 'verified')) DEFAULT 'no_domain',
				verification_record_type TEXT NOT NULL DEFAULT 'TXT',
				verification_record_name TEXT,
				verification_record_value TEXT,
				verified_at INTEGER,
				updated_at INTEGER NOT NULL
			)`
			)
			.run();
	});

	afterEach(async () => {
		await db.prepare('DROP TABLE IF EXISTS tenant_domain_configs').run();
	});

	it('returns no_domain state when tenant has not started onboarding', async () => {
		const response = await worker.fetch(
			new Request('http://example.com/api/domain/config', { method: 'GET', headers }),
			env
		);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.tenant_id).toBe(tenantId);
		expect(data.status).toBe('no_domain');
		expect(data.hostname).toBeNull();
	});

	it('stores pending domain config with verification instructions', async () => {
		const response = await worker.fetch(
			new Request('http://example.com/api/domain/config', {
				method: 'POST',
				headers,
				body: JSON.stringify({ hostname: 'Tour.Company.vn' }),
			}),
			env
		);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.hostname).toBe('tour.company.vn');
		expect(data.status).toBe('pending');
		expect(data.verification_record_type).toBe('TXT');
		expect(data.verification_record_name).toBe('_tour-booking-verification.tour.company.vn');
		expect(data.verification_record_value).toMatch(/^tb-verify-/);
	});

	it('verifies a pending domain when the verification value matches', async () => {
		const saveResponse = await worker.fetch(
			new Request('http://example.com/api/domain/config', {
				method: 'POST',
				headers,
				body: JSON.stringify({ hostname: 'tour.company.vn' }),
			}),
			env
		);
		const saved = await saveResponse.json();

		const verifyResponse = await worker.fetch(
			new Request('http://example.com/api/domain/verify', {
				method: 'POST',
				headers,
				body: JSON.stringify({ verification_value: saved.verification_record_value }),
			}),
			env
		);

		expect(verifyResponse.status).toBe(200);
		const verified = await verifyResponse.json();
		expect(verified.status).toBe('verified');
		expect(verified.hostname).toBe('tour.company.vn');
		expect(verified.verified_at).toBeTypeOf('number');
	});

	it('keeps domain configs tenant-scoped and rejects duplicate hostname claims', async () => {
		await worker.fetch(
			new Request('http://example.com/api/domain/config', {
				method: 'POST',
				headers,
				body: JSON.stringify({ hostname: 'tour.company.vn' }),
			}),
			env
		);

		const otherHeaders = { 'X-Tenant-ID': 'ten-domain-2', 'Content-Type': 'application/json' };
		const otherGetResponse = await worker.fetch(
			new Request('http://example.com/api/domain/config', {
				method: 'GET',
				headers: otherHeaders,
			}),
			env
		);
		const otherGet = await otherGetResponse.json();
		expect(otherGet.status).toBe('no_domain');

		const duplicateResponse = await worker.fetch(
			new Request('http://example.com/api/domain/config', {
				method: 'POST',
				headers: otherHeaders,
				body: JSON.stringify({ hostname: 'tour.company.vn' }),
			}),
			env
		);
		const duplicate = await duplicateResponse.json();
		expect(duplicateResponse.status).toBe(400);
		expect(duplicate.error.code).toBe('validation_error');
	});
});