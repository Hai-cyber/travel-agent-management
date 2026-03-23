import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index.js';

describe('Observability [CHK-206]', () => {
	let db;
	const tenantId = 'ten-observe-1';
	const jsonHeaders = { 'X-Tenant-ID': tenantId, 'Content-Type': 'application/json' };

	beforeEach(async () => {
		db = env.DB;
		await db.prepare(`CREATE TABLE IF NOT EXISTS tours (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			title TEXT NOT NULL,
			lang TEXT DEFAULT 'vi',
			start_date INTEGER,
			duration_text TEXT,
			status TEXT NOT NULL DEFAULT 'draft',
			created_at INTEGER NOT NULL
		)`).run();

		await db.prepare(`CREATE TABLE IF NOT EXISTS tasks (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			booking_id TEXT,
			service_entity_type TEXT,
			service_entity_id TEXT,
			title TEXT NOT NULL,
			due_at INTEGER,
			status TEXT NOT NULL DEFAULT 'pending',
			last_notice_at INTEGER
		)`).run();
	});

	afterEach(async () => {
		await db.prepare('DROP TABLE IF EXISTS tasks').run();
		await db.prepare('DROP TABLE IF EXISTS tours').run();
	});

	it('adds generated request tracing headers to successful responses', async () => {
		const response = await worker.fetch(new Request('http://example.com/message'), env);

		expect(response.status).toBe(200);
		expect(response.headers.get('X-Request-ID')).toBeTruthy();
		expect(response.headers.get('Server-Timing')).toMatch(/^app;dur=\d+$/);
	});

	it('preserves an inbound request ID for traceability', async () => {
		const response = await worker.fetch(
			new Request('http://example.com/message', {
				headers: { 'X-Request-ID': 'req-fixed-123' },
			}),
			env
		);

		expect(response.headers.get('X-Request-ID')).toBe('req-fixed-123');
	});

	it('adds trace headers to not-found responses', async () => {
		const response = await worker.fetch(new Request('http://example.com/api/missing'), env);
		const data = await response.json();

		expect(response.status).toBe(404);
		expect(response.headers.get('X-Request-ID')).toBeTruthy();
		expect(response.headers.get('Server-Timing')).toMatch(/^app;dur=\d+$/);
		expect(data.ok).toBe(false);
	});

	it('adds trace headers to validation-error responses', async () => {
		const response = await worker.fetch(
			new Request('http://example.com/api/tours', {
				method: 'POST',
				headers: jsonHeaders,
				body: '{bad-json',
			}),
			env
		);

		const data = await response.json();
		expect(response.status).toBe(400);
		expect(response.headers.get('X-Request-ID')).toBeTruthy();
		expect(data.ok).toBe(false);
		expect(data.error.code).toBe('invalid_json');
	});
});
