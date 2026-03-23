/**
 * D1 Query Helpers
 * Common patterns for CRUD operations
 */

/**
 * Get tenant context from request headers
 * @param {Request} request
 * @returns {string} tenant_id or default tenant for MVP
 */
export function getTenantId(request) {
	const header = request.headers.get('X-Tenant-ID');
	// For MVP, default to seed tenant if not provided
	return header || 'ten-0001-aaaa-bbbb-cccc-000000000001';
}

/**
 * Generate a simple ID (UUID-like)
 * @returns {string}
 */
export function generateId() {
	return crypto.randomUUID();
}

/**
 * Standard error response
 * @param {string} message
 * @param {number} status
 * @returns {Response}
 */
export function errorResponse(message, status = 400, options = {}) {
	const { code = inferErrorCode(status), details } = options;
	const payload = {
		ok: false,
		error: {
			code,
			message,
		},
	};

	if (details !== undefined) {
		payload.error.details = details;
	}

	return new Response(JSON.stringify(payload), {
		status,
		headers: jsonHeaders(),
	});
}

/**
 * Standard success response
 * @param {object} data
 * @param {number} status
 * @returns {Response}
 */
export function successResponse(data, status = 200) {
	const payload = Array.isArray(data) ? { ok: true, data } : { ok: true, ...data };

	return new Response(JSON.stringify(payload), {
		status,
		headers: jsonHeaders(),
	});
}

/**
 * Parse a JSON request body and surface a consistent 400 error for invalid JSON.
 * @param {Request} request
 * @returns {Promise<{ok: true, value: any} | {ok: false, response: Response}>}
 */
export async function readJsonBody(request) {
	try {
		const value = await request.json();

		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			return {
				ok: false,
				response: errorResponse('Request body must be a JSON object', 400, { code: 'invalid_body' }),
			};
		}

		return { ok: true, value };
	} catch (error) {
		return {
			ok: false,
			response: errorResponse('Request body must be valid JSON', 400, { code: 'invalid_json' }),
		};
	}
}

/**
 * Validate numeric pagination params.
 * @param {string | null} rawLimit
 * @param {string | null} rawOffset
 * @returns {{ok: true, value: {limit: number, offset: number}} | {ok: false, response: Response}}
 */
export function parsePaginationParams(rawLimit, rawOffset) {
	const limit = rawLimit === null ? 50 : Number(rawLimit);
	const offset = rawOffset === null ? 0 : Number(rawOffset);

	if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
		return {
			ok: false,
			response: errorResponse('limit must be an integer between 1 and 100', 400, { code: 'invalid_query' }),
		};
	}

	if (!Number.isInteger(offset) || offset < 0) {
		return {
			ok: false,
			response: errorResponse('offset must be an integer >= 0', 400, { code: 'invalid_query' }),
		};
	}

	return { ok: true, value: { limit, offset } };
}

export function notFoundResponse(message) {
	return errorResponse(message, 404, { code: 'not_found' });
}

export function validationError(message, details) {
	return errorResponse(message, 400, { code: 'validation_error', details });
}

export function internalError(message) {
	return errorResponse(message, 500, { code: 'internal_error' });
}

function jsonHeaders() {
	return { 'Content-Type': 'application/json; charset=utf-8' };
}

function inferErrorCode(status) {
	if (status === 404) {
		return 'not_found';
	}
	if (status >= 500) {
		return 'internal_error';
	}
	return 'bad_request';
}
