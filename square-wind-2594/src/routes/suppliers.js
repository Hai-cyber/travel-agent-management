/**
 * Supplier Routes [CHK-209]
 * Generic supplier registry for service operations.
 */

import {
	getTenantId,
	generateId,
	successResponse,
	readJsonBody,
	parsePaginationParams,
	validationError,
	notFoundResponse,
	internalError,
} from '../lib/db.js';

const ALLOWED_TYPES = new Set(['hotel', 'guide', 'transport', 'meal', 'other']);

export async function createSupplier(request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) {
			return parsedBody.response;
		}

		const { name, type, contact, notes } = parsedBody.value;
		if (!name || typeof name !== 'string') {
			return validationError('name is required and must be a string');
		}
		if (!type || typeof type !== 'string' || !ALLOWED_TYPES.has(type)) {
			return validationError(`type is required and must be one of: ${Array.from(ALLOWED_TYPES).join(', ')}`);
		}
		if (contact !== undefined && typeof contact !== 'string') {
			return validationError('contact must be a string');
		}
		if (notes !== undefined && typeof notes !== 'string') {
			return validationError('notes must be a string');
		}

		const tenantId = getTenantId(request);
		const supplierId = generateId();
		const now = Date.now();

		await db
			.prepare(
				`INSERT INTO suppliers (id, tenant_id, name, type, contact, notes, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(supplierId, tenantId, name.trim(), type, contact || null, notes || null, now)
			.run();

		const created = await db
			.prepare('SELECT * FROM suppliers WHERE id = ? AND tenant_id = ?')
			.bind(supplierId, tenantId)
			.first();
		return successResponse(created, 201);
	} catch (error) {
		return internalError(`Failed to create supplier: ${error.message}`);
	}
}

export async function listSuppliers(request, db) {
	try {
		const url = new URL(request.url);
		const tenantId = getTenantId(request);
		const type = url.searchParams.get('type');
		const pagination = parsePaginationParams(url.searchParams.get('limit'), url.searchParams.get('offset'));
		if (!pagination.ok) {
			return pagination.response;
		}
		const { limit, offset } = pagination.value;

		if (type && !ALLOWED_TYPES.has(type)) {
			return validationError(`type must be one of: ${Array.from(ALLOWED_TYPES).join(', ')}`);
		}

		let query = 'SELECT * FROM suppliers WHERE tenant_id = ?';
		const binds = [tenantId];
		if (type) {
			query += ' AND type = ?';
			binds.push(type);
		}
		query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
		binds.push(limit, offset);

		const result = await db.prepare(query).bind(...binds).all();
		return successResponse({ suppliers: result.results || [], limit, offset, total: (result.results || []).length });
	} catch (error) {
		return internalError(`Failed to list suppliers: ${error.message}`);
	}
}

export async function updateSupplier(supplierId, request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) {
			return parsedBody.response;
		}
		const { name, type, contact, notes } = parsedBody.value;
		const tenantId = getTenantId(request);

		const existing = await db
			.prepare('SELECT id FROM suppliers WHERE id = ? AND tenant_id = ?')
			.bind(supplierId, tenantId)
			.first();
		if (!existing) {
			return notFoundResponse('Supplier not found');
		}

		if (name !== undefined && typeof name !== 'string') {
			return validationError('name must be a string');
		}
		if (type !== undefined && (typeof type !== 'string' || !ALLOWED_TYPES.has(type))) {
			return validationError(`type must be one of: ${Array.from(ALLOWED_TYPES).join(', ')}`);
		}
		if (contact !== undefined && typeof contact !== 'string') {
			return validationError('contact must be a string');
		}
		if (notes !== undefined && typeof notes !== 'string') {
			return validationError('notes must be a string');
		}

		const updates = [];
		const binds = [];
		for (const field of ['name', 'type', 'contact', 'notes']) {
			if (parsedBody.value[field] !== undefined) {
				updates.push(`${field} = ?`);
				binds.push(parsedBody.value[field] || null);
			}
		}
		if (!updates.length) {
			return validationError('No fields to update');
		}

		binds.push(supplierId, tenantId);
		await db.prepare(`UPDATE suppliers SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...binds).run();

		const updated = await db
			.prepare('SELECT * FROM suppliers WHERE id = ? AND tenant_id = ?')
			.bind(supplierId, tenantId)
			.first();
		return successResponse(updated);
	} catch (error) {
		return internalError(`Failed to update supplier: ${error.message}`);
	}
}

export async function getSupplierByIdForTenant(supplierId, tenantId, db) {
	return db
		.prepare('SELECT id, tenant_id, name, type FROM suppliers WHERE id = ? AND tenant_id = ?')
		.bind(supplierId, tenantId)
		.first();
}
