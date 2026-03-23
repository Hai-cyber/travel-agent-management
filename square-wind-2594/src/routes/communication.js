/**
 * Communication Routes [CHK-203]
 * POST /api/threads/:entityType/:entityId/email
 * POST /api/threads/:threadId/note
 * GET  /api/threads/:entityType/:entityId
 */

import {
	getTenantId,
	successResponse,
	readJsonBody,
	parsePaginationParams,
	validationError,
	notFoundResponse,
	internalError,
} from '../lib/db.js';
import { getOrCreateThread, addMessage, getEntityThread } from '../services/communication.js';

/**
 * POST /api/threads/:entityType/:entityId/email - Send/log email
 * Body: { to_addr, subject?, body?, from_addr? }
 */
export async function sendEmail(entityType, entityId, request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) {
			return parsedBody.response;
		}
		const body = parsedBody.value;
		const { to_addr, subject, body: messageBody, from_addr } = body;

		// Validation
		if (!to_addr || typeof to_addr !== 'string') {
			return validationError('to_addr is required and must be a string');
		}
		if (!messageBody || typeof messageBody !== 'string') {
			return validationError('body is required and must be a string');
		}
		if (subject !== undefined && typeof subject !== 'string') {
			return validationError('subject must be a string');
		}
		if (from_addr !== undefined && typeof from_addr !== 'string') {
			return validationError('from_addr must be a string');
		}

		const tenantId = getTenantId(request);

		// Get or create thread
		const thread = await getOrCreateThread(entityType, entityId, tenantId, db);

		// Add message
		const message = await addMessage(
			thread.id,
			'email',
			'outbound',
			{
				subject: subject || `Message to ${to_addr}`,
				body: messageBody,
				to_addr,
				from_addr: from_addr || 'noreply@tours.example.com',
				created_by: tenantId,
			},
			tenantId,
			db
		);

		return successResponse(message, 201);
	} catch (e) {
		return internalError(`Failed to send email: ${e.message}`);
	}
}

/**
 * POST /api/threads/:threadId/note - Add internal note
 * Body: { body, created_by? }
 */
export async function addNote(threadId, request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) {
			return parsedBody.response;
		}
		const body = parsedBody.value;
		const { body: noteBody, created_by } = body;

		// Validation
		if (!noteBody || typeof noteBody !== 'string') {
			return validationError('body is required and must be a string');
		}
		if (created_by !== undefined && typeof created_by !== 'string') {
			return validationError('created_by must be a string');
		}

		const tenantId = getTenantId(request);

		// Verify thread exists and belongs to tenant
		const thread = await db
			.prepare('SELECT id FROM comm_threads WHERE id = ? AND tenant_id = ?')
			.bind(threadId, tenantId)
			.first();

		if (!thread) {
			return notFoundResponse('Thread not found');
		}

		// Add note message
		const message = await addMessage(
			threadId,
			'note',
			'internal',
			{
				body: noteBody,
				created_by: created_by || tenantId,
			},
			tenantId,
			db
		);

		return successResponse(message, 201);
	} catch (e) {
		return internalError(`Failed to add note: ${e.message}`);
	}
}

/**
 * GET /api/threads/:entityType/:entityId - Get thread with messages
 */
export async function getThread(entityType, entityId, request, db) {
	try {
		const tenantId = getTenantId(request);

		const threadWithMessages = await getEntityThread(entityType, entityId, tenantId, db);

		if (!threadWithMessages) {
			return notFoundResponse('Thread not found');
		}

		return successResponse(threadWithMessages);
	} catch (e) {
		return internalError(`Failed to retrieve thread: ${e.message}`);
	}
}

/**
 * GET /api/threads/:threadId/messages - Get messages for a thread
 * Query params: limit, offset
 */
export async function getMessages(threadId, request, db) {
	try {
		const url = new URL(request.url);
		const pagination = parsePaginationParams(url.searchParams.get('limit'), url.searchParams.get('offset'));
		if (!pagination.ok) {
			return pagination.response;
		}
		const { limit, offset } = pagination.value;

		const tenantId = getTenantId(request);

		// Verify thread exists
		const thread = await db
			.prepare('SELECT id FROM comm_threads WHERE id = ? AND tenant_id = ?')
			.bind(threadId, tenantId)
			.first();

		if (!thread) {
			return notFoundResponse('Thread not found');
		}

		const messages = await db
			.prepare(
				`SELECT * FROM comm_messages 
			WHERE thread_id = ? AND tenant_id = ?
			ORDER BY created_at ASC
			LIMIT ${limit} OFFSET ${offset}`
			)
			.bind(threadId, tenantId)
			.all();

		return successResponse({
			thread_id: threadId,
			messages: messages.results || [],
			limit,
			offset,
		});
	} catch (e) {
		return internalError(`Failed to retrieve messages: ${e.message}`);
	}
}
