import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index.js';
import { getOrCreateThread, addMessage, getThreadMessages, getEntityThread } from '../src/services/communication.js';

describe('Communication [CHK-203] - Threads & Messages', () => {
	let db;
	const tenantId = 'ten-test-1';
	const defaultHeaders = { 'X-Tenant-ID': tenantId, 'Content-Type': 'application/json' };

	beforeEach(async () => {
		db = env.DB;

		// Create tables
		await db
			.prepare(
				`CREATE TABLE IF NOT EXISTS comm_threads (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			entity_type TEXT NOT NULL,
			entity_id TEXT NOT NULL
		)`
			)
			.run();

		await db
			.prepare(
				`CREATE TABLE IF NOT EXISTS comm_messages (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			thread_id TEXT NOT NULL,
			channel TEXT NOT NULL,
			direction TEXT NOT NULL,
			subject TEXT,
			body TEXT,
			to_addr TEXT,
			from_addr TEXT,
			attachments_json TEXT,
			created_by TEXT,
			created_at INTEGER NOT NULL
		)`
			)
			.run();
	});

	afterEach(async () => {
		await db.prepare('DROP TABLE IF EXISTS comm_messages').run();
		await db.prepare('DROP TABLE IF EXISTS comm_threads').run();
	});

	describe('getOrCreateThread service', () => {
		it('should create a new thread if not exists', async () => {
			const thread = await getOrCreateThread('accommodation', 'accom-123', tenantId, db);

			expect(thread.id).toBeDefined();
			expect(thread.entity_type).toBe('accommodation');
			expect(thread.entity_id).toBe('accom-123');
			expect(thread.tenant_id).toBe(tenantId);
		});

		it('should return existing thread if it exists', async () => {
			// Create first
			const thread1 = await getOrCreateThread('accommodation', 'accom-123', tenantId, db);

			// Retrieve
			const thread2 = await getOrCreateThread('accommodation', 'accom-123', tenantId, db);

			expect(thread1.id).toBe(thread2.id);
		});

		it('should isolate threads by entity type and ID', async () => {
			const thread1 = await getOrCreateThread('accommodation', 'accom-123', tenantId, db);
			const thread2 = await getOrCreateThread('accommodation', 'accom-456', tenantId, db);

			expect(thread1.id).not.toBe(thread2.id);
		});
	});

	describe('addMessage service', () => {
		it('should add a message to a thread', async () => {
			const thread = await getOrCreateThread('accommodation', 'accom-123', tenantId, db);

			const message = await addMessage(
				thread.id,
				'email',
				'outbound',
				{
					subject: 'Confirm booking',
					body: 'Please confirm your hotel booking',
					to_addr: 'guest@example.com',
					from_addr: 'support@tours.example.com',
					created_by: tenantId,
				},
				tenantId,
				db
			);

			expect(message.id).toBeDefined();
			expect(message.channel).toBe('email');
			expect(message.direction).toBe('outbound');
			expect(message.subject).toBe('Confirm booking');
		});
	});

	describe('POST /api/threads/:entityType/:entityId/email', () => {
		it('should send and log an email', async () => {
			const request = new Request(
				'http://example.com/api/threads/accommodation/accom-123/email',
				{
					method: 'POST',
					headers: defaultHeaders,
					body: JSON.stringify({
						to_addr: 'guest@example.com',
						subject: 'Booking Confirmation',
						body: 'Your hotel is confirmed.',
						from_addr: 'support@tours.example.com',
					}),
				}
			);

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(201);

			const data = await response.json();
			expect(data.channel).toBe('email');
			expect(data.direction).toBe('outbound');
			expect(data.to_addr).toBe('guest@example.com');
		});

		it('should use default from_addr', async () => {
			const request = new Request(
				'http://example.com/api/threads/accommodation/accom-123/email',
				{
					method: 'POST',
					headers: defaultHeaders,
					body: JSON.stringify({
						to_addr: 'guest@example.com',
						body: 'Test message',
					}),
				}
			);

			const response = await worker.fetch(request, env);
			const data = await response.json();

			expect(data.from_addr).toBe('noreply@tours.example.com');
		});

		it('should reject missing to_addr', async () => {
			const request = new Request(
				'http://example.com/api/threads/accommodation/accom-123/email',
				{
					method: 'POST',
					headers: defaultHeaders,
					body: JSON.stringify({
						body: 'Test message',
					}),
				}
			);

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(400);
		});

		it('should create thread on first email', async () => {
			const request = new Request(
				'http://example.com/api/threads/meal/meal-789/email',
				{
					method: 'POST',
					headers: defaultHeaders,
					body: JSON.stringify({
						to_addr: 'restaurant@example.com',
						body: 'Confirm table reservation',
					}),
				}
			);

			await worker.fetch(request, env);

			// Verify thread was created
			const thread = await db
				.prepare('SELECT * FROM comm_threads WHERE entity_type = ? AND entity_id = ?')
				.bind('meal', 'meal-789')
				.first();

			expect(thread).toBeDefined();
		});
	});

	describe('POST /api/threads/:threadId/note', () => {
		it('should add an internal note to a thread', async () => {
			// Create thread first
			const thread = await getOrCreateThread('accommodation', 'accom-123', tenantId, db);

			const request = new Request(`http://example.com/api/threads/${thread.id}/note`, {
				method: 'POST',
				headers: defaultHeaders,
				body: JSON.stringify({
					body: 'Contacted hotel, confirmed for April 15',
					created_by: tenantId,
				}),
			});

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(201);

			const data = await response.json();
			expect(data.channel).toBe('note');
			expect(data.direction).toBe('internal');
			expect(data.body).toBe('Contacted hotel, confirmed for April 15');
		});
	});

	describe('GET /api/threads/:entityType/:entityId', () => {
		it('should retrieve thread with messages', async () => {
			const thread = await getOrCreateThread('accommodation', 'accom-123', tenantId, db);

			// Add messages with all fields
			await addMessage(
				thread.id,
				'email',
				'outbound',
				{
					subject: 'Confirm',
					body: 'Please confirm',
					to_addr: 'guest@example.com',
					from_addr: 'support@tours.example.com',
					created_by: tenantId,
				},
				tenantId,
				db
			);

			await addMessage(
				thread.id,
				'email',
				'outbound',
				{
					subject: 'Reminder',
					body: 'Guest confirmed',
					to_addr: 'guest@example.com',
					from_addr: 'support@tours.example.com',
					created_by: tenantId,
				},
				tenantId,
				db
			);

			const request = new Request(
				'http://example.com/api/threads/accommodation/accom-123',
				{
					method: 'GET',
					headers: defaultHeaders,
				}
			);

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(200);

			const data = await response.json();
			expect(data.entity_type).toBe('accommodation');
			expect(data.messages.length).toBe(2);
		});

		it('should return 404 for non-existent thread', async () => {
			const request = new Request(
				'http://example.com/api/threads/accommodation/nonexistent',
				{
					method: 'GET',
					headers: defaultHeaders,
				}
			);

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(404);
		});
	});

	describe('GET /api/threads/:threadId/messages', () => {
		it('should retrieve messages for a thread', async () => {
			const thread = await getOrCreateThread('guide', 'guide-123', tenantId, db);

			// Add messages with all fields
			for (let i = 0; i < 5; i++) {
				await addMessage(
					thread.id,
					'email',
					'outbound',
					{
						body: `Message ${i}`,
						subject: `Subject ${i}`,
						to_addr: 'guide@example.com',
						from_addr: 'support@tours.example.com',
						created_by: tenantId,
					},
					tenantId,
					db
				);
			}

			const request = new Request(`http://example.com/api/threads/${thread.id}/messages`, {
				method: 'GET',
				headers: defaultHeaders,
			});

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(200);

			const data = await response.json();
			expect(data.messages.length).toBe(5);
		});

		it('should support pagination', async () => {
			const thread = await getOrCreateThread('guide', 'guide-123', tenantId, db);

			// Add 10 messages
			for (let i = 0; i < 10; i++) {
				await addMessage(
					thread.id,
					'email',
					'outbound',
					{
						body: `Message ${i}`,
						subject: `Subject ${i}`,
						to_addr: 'guide@example.com',
						from_addr: 'support@tours.example.com',
						created_by: tenantId,
					},
					tenantId,
					db
				);
			}

			const request = new Request(
				`http://example.com/api/threads/${thread.id}/messages?limit=5&offset=0`,
				{
					method: 'GET',
					headers: defaultHeaders,
				}
			);

			const response = await worker.fetch(request, env);
			const data = await response.json();

			expect(data.messages.length).toBe(5);
			expect(data.limit).toBe(5);
			expect(data.offset).toBe(0);
		});

		it('should return 404 for non-existent thread', async () => {
			const request = new Request('http://example.com/api/threads/nonexistent/messages', {
				method: 'GET',
				headers: defaultHeaders,
			});

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(404);
		});
	});

	describe('Multi-tenant isolation', () => {
		it('should not retrieve messages from different tenant', async () => {
			const thread = await getOrCreateThread('accommodation', 'accom-123', tenantId, db);

			await addMessage(
				thread.id,
				'email',
				'outbound',
				{
					body: 'Sensitive info',
					subject: 'Sensitive',
					to_addr: 'guest@example.com',
					from_addr: 'support@tours.example.com',
					created_by: tenantId,
				},
				tenantId,
				db
			);

			// Try to access as different tenant
			const request = new Request(
				`http://example.com/api/threads/${thread.id}/messages`,
				{
					method: 'GET',
					headers: { 'X-Tenant-ID': 'tenant-other', 'Content-Type': 'application/json' },
				}
			);

			const response = await worker.fetch(request, env);
			expect(response.status).toBe(404);
		});
	});
});
