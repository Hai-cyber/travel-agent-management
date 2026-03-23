/**
 * Worker Observability [CHK-206]
 * Request-scoped trace IDs, structured logs, and response trace headers.
 */

export function createRequestContext(request) {
	const requestId = request.headers.get('X-Request-ID') || crypto.randomUUID();
	const startedAt = Date.now();
	const url = new URL(request.url);

	return {
		requestId,
		startedAt,
		method: request.method,
		path: url.pathname,
		search: url.search,
		tenantId: request.headers.get('X-Tenant-ID') || 'anonymous',
	};
}

export function logRequestStart(context) {
	logStructured('info', 'request.start', {
		request_id: context.requestId,
		method: context.method,
		path: context.path,
		search: context.search,
		tenant_id: context.tenantId,
	});
}

export function logRequestFinish(context, response, routeName) {
	const durationMs = Date.now() - context.startedAt;
	logStructured('info', 'request.finish', {
		request_id: context.requestId,
		method: context.method,
		path: context.path,
		route: routeName,
		status: response.status,
		duration_ms: durationMs,
		tenant_id: context.tenantId,
	});
}

export function logRequestError(context, error, routeName) {
	const durationMs = Date.now() - context.startedAt;
	logStructured('error', 'request.error', {
		request_id: context.requestId,
		method: context.method,
		path: context.path,
		route: routeName,
		duration_ms: durationMs,
		tenant_id: context.tenantId,
		error_name: error?.name || 'Error',
		error_message: error?.message || 'Unknown error',
	});
}

export function attachTraceHeaders(response, context) {
	const durationMs = Date.now() - context.startedAt;
	const headers = new Headers(response.headers);
	headers.set('X-Request-ID', context.requestId);
	headers.set('Server-Timing', `app;dur=${durationMs}`);

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

function logStructured(level, event, fields) {
	const entry = {
		level,
		event,
		ts: new Date().toISOString(),
		...fields,
	};

	if (level === 'error') {
		console.error(JSON.stringify(entry));
		return;
	}

	console.log(JSON.stringify(entry));
}
