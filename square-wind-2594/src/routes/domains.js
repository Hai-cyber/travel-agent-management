/**
 * Domain onboarding routes [CHK-401]
 * Tenant-scoped domain claim and verification state.
 */

import {
	getTenantId,
	generateId,
	successResponse,
	readJsonBody,
	validationError,
	internalError,
} from '../lib/db.js';

const DOMAIN_STATUS = {
	NO_DOMAIN: 'no_domain',
	PENDING: 'pending',
	VERIFIED: 'verified',
};

const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export async function getDomainConfig(request, db) {
	try {
		const tenantId = getTenantId(request);
		const config = await db
			.prepare('SELECT * FROM tenant_domain_configs WHERE tenant_id = ?')
			.bind(tenantId)
			.first();

		if (!config) {
			return successResponse(emptyDomainConfig(tenantId));
		}

		return successResponse(normalizeDomainConfig(config));
	} catch (error) {
		return internalError(`Failed to get domain config: ${error.message}`);
	}
}

export async function upsertDomainConfig(request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) {
			return parsedBody.response;
		}

		const { hostname } = parsedBody.value;
		if (!hostname || typeof hostname !== 'string') {
			return validationError('hostname is required and must be a string');
		}

		const normalizedHostname = hostname.trim().toLowerCase();
		if (!HOSTNAME_PATTERN.test(normalizedHostname)) {
			return validationError('hostname must be a valid domain or subdomain');
		}

		const tenantId = getTenantId(request);
		const existing = await db
			.prepare('SELECT * FROM tenant_domain_configs WHERE tenant_id = ?')
			.bind(tenantId)
			.first();
		const claimed = await db
			.prepare('SELECT tenant_id FROM tenant_domain_configs WHERE hostname = ? AND tenant_id <> ?')
			.bind(normalizedHostname, tenantId)
			.first();

		if (claimed) {
			return validationError('hostname is already claimed by another tenant');
		}

		const unchangedVerified =
			existing && existing.hostname === normalizedHostname && existing.status === DOMAIN_STATUS.VERIFIED;
		const verificationValue = unchangedVerified
			? existing.verification_record_value
			: `tb-verify-${generateId()}`;
		const now = Date.now();
		const status = unchangedVerified ? DOMAIN_STATUS.VERIFIED : DOMAIN_STATUS.PENDING;
		const verifiedAt = unchangedVerified ? existing.verified_at : null;
		const verificationRecordName = `_tour-booking-verification.${normalizedHostname}`;

		await db
			.prepare(
				`INSERT INTO tenant_domain_configs
				(tenant_id, hostname, status, verification_record_type, verification_record_name, verification_record_value, verified_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(tenant_id) DO UPDATE SET
					hostname = excluded.hostname,
					status = excluded.status,
					verification_record_type = excluded.verification_record_type,
					verification_record_name = excluded.verification_record_name,
					verification_record_value = excluded.verification_record_value,
					verified_at = excluded.verified_at,
					updated_at = excluded.updated_at`
			)
			.bind(
				tenantId,
				normalizedHostname,
				status,
				'TXT',
				verificationRecordName,
				verificationValue,
				verifiedAt,
				now
			)
			.run();

		const config = await db
			.prepare('SELECT * FROM tenant_domain_configs WHERE tenant_id = ?')
			.bind(tenantId)
			.first();

		return successResponse(normalizeDomainConfig(config));
	} catch (error) {
		return internalError(`Failed to save domain config: ${error.message}`);
	}
}

export async function verifyDomain(request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) {
			return parsedBody.response;
		}

		const { verification_value } = parsedBody.value;
		if (!verification_value || typeof verification_value !== 'string') {
			return validationError('verification_value is required and must be a string');
		}

		const tenantId = getTenantId(request);
		const existing = await db
			.prepare('SELECT * FROM tenant_domain_configs WHERE tenant_id = ?')
			.bind(tenantId)
			.first();

		if (!existing || existing.status === DOMAIN_STATUS.NO_DOMAIN || !existing.hostname) {
			return validationError('No pending domain verification exists for tenant');
		}

		if (existing.status === DOMAIN_STATUS.VERIFIED) {
			return successResponse(normalizeDomainConfig(existing));
		}

		if (existing.verification_record_value !== verification_value) {
			return validationError('verification_value does not match pending record');
		}

		const now = Date.now();
		await db
			.prepare(
				`UPDATE tenant_domain_configs
				SET status = ?, verified_at = ?, updated_at = ?
				WHERE tenant_id = ?`
			)
			.bind(DOMAIN_STATUS.VERIFIED, now, now, tenantId)
			.run();

		const verified = await db
			.prepare('SELECT * FROM tenant_domain_configs WHERE tenant_id = ?')
			.bind(tenantId)
			.first();

		return successResponse(normalizeDomainConfig(verified));
	} catch (error) {
		return internalError(`Failed to verify domain: ${error.message}`);
	}
}

function emptyDomainConfig(tenantId) {
	return {
		tenant_id: tenantId,
		hostname: null,
		status: DOMAIN_STATUS.NO_DOMAIN,
		verification_record_type: 'TXT',
		verification_record_name: null,
		verification_record_value: null,
		verified_at: null,
		updated_at: null,
	};
}

function normalizeDomainConfig(config) {
	return {
		tenant_id: config.tenant_id,
		hostname: config.hostname,
		status: config.status,
		verification_record_type: config.verification_record_type,
		verification_record_name: config.verification_record_name,
		verification_record_value: config.verification_record_value,
		verified_at: config.verified_at,
		updated_at: config.updated_at,
	};
}