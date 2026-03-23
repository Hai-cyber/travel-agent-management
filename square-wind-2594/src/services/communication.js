/**
 * Communication Service [CHK-203]
 * Thread and message management helpers
 */

/**
 * Get or create a thread for an entity.
 * @param {string} entityType - Type: accommodation, meal, guide, local_transport, intercity_leg, task, etc.
 * @param {string} entityId - Entity ID
 * @param {string} tenantId - Tenant ID
 * @param {object} db - D1 database binding
 * @returns {Promise<Object>} Thread object {id, tenant_id, entity_type, entity_id}
 */
export async function getOrCreateThread(entityType, entityId, tenantId, db) {
	// Try to find existing
	let thread = await db
		.prepare('SELECT * FROM comm_threads WHERE entity_type = ? AND entity_id = ? AND tenant_id = ?')
		.bind(entityType, entityId, tenantId)
		.first();

	if (thread) {
		return thread;
	}

	// Create new
	const threadId = crypto.randomUUID();
	await db
		.prepare(
			`INSERT INTO comm_threads (id, tenant_id, entity_type, entity_id)
		VALUES (?, ?, ?, ?)`
		)
		.bind(threadId, tenantId, entityType, entityId)
		.run();

	return {
		id: threadId,
		tenant_id: tenantId,
		entity_type: entityType,
		entity_id: entityId,
	};
}

/**
 * Add a message to a thread.
 * @param {string} threadId - Thread ID
 * @param {string} channel - Channel type: email, sms, note, call_log, etc.
 * @param {string} direction - Direction: inbound, outbound, internal
 * @param {Object} messageData - {subject?, body?, to_addr?, from_addr?, created_by?}
 * @param {string} tenantId - Tenant ID
 * @param {object} db - D1 database binding
 * @returns {Promise<Object>} Message object
 */
export async function addMessage(threadId, channel, direction, messageData, tenantId, db) {
	const messageId = crypto.randomUUID();
	const now = Date.now();

	const { subject, body, to_addr, from_addr, created_by } = messageData;

	await db
		.prepare(
			`INSERT INTO comm_messages 
		(id, tenant_id, thread_id, channel, direction, subject, body, to_addr, from_addr, created_by, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			messageId,
			tenantId,
			threadId,
			channel,
			direction,
			subject !== undefined ? subject : null,
			body !== undefined ? body : null,
			to_addr !== undefined ? to_addr : null,
			from_addr !== undefined ? from_addr : null,
			created_by !== undefined ? created_by : null,
			now
		)
		.run();

	return {
		id: messageId,
		tenant_id: tenantId,
		thread_id: threadId,
		channel,
		direction,
		subject: subject !== undefined ? subject : null,
		body: body !== undefined ? body : null,
		to_addr: to_addr !== undefined ? to_addr : null,
		from_addr: from_addr !== undefined ? from_addr : null,
		created_by: created_by !== undefined ? created_by : null,
		created_at: now,
	};
}

/**
 * Get messages for a thread.
 * @param {string} threadId - Thread ID
 * @param {string} tenantId - Tenant ID
 * @param {object} db - D1 database binding
 * @param {number} limit - Max messages
 * @param {number} offset - Pagination offset
 * @returns {Promise<Array>} Array of messages
 */
export async function getThreadMessages(threadId, tenantId, db, limit = 50, offset = 0) {
	// Build query with direct limit/offset values (not bind parameters)
	const query = `SELECT * FROM comm_messages 
		WHERE thread_id = ? AND tenant_id = ?
		ORDER BY created_at DESC
		LIMIT ${limit} OFFSET ${offset}`;

	const result = await db.prepare(query).bind(threadId, tenantId).all();

	return result.results || [];
}

/**
 * Get all threads for an entity.
 * @param {string} entityType - Entity type
 * @param {string} entityId - Entity ID
 * @param {string} tenantId - Tenant ID
 * @param {object} db - D1 database binding
 * @returns {Promise<Object>} Thread with recent messages
 */
export async function getEntityThread(entityType, entityId, tenantId, db) {
	const thread = await db
		.prepare('SELECT * FROM comm_threads WHERE entity_type = ? AND entity_id = ? AND tenant_id = ?')
		.bind(entityType, entityId, tenantId)
		.first();

	if (!thread) {
		return null;
	}

	const messages = await getThreadMessages(thread.id, tenantId, db, 20, 0);

	return {
		...thread,
		messages: messages.reverse(), // chronological order
	};
}
