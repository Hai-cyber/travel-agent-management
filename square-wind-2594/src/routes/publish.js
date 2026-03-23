/**
 * Publish gate routes [CHK-402]
 * Preview remains open, production publish is checklist-gated.
 */

import { getTenantId, successResponse, readJsonBody, validationError, internalError } from '../lib/db.js';
import { getBillingStateForTenant } from './billing.js';

export async function getPublishGate(request, db) {
	try {
		const tenantId = getTenantId(request);
		const gate = await buildPublishGateState(tenantId, db);
		return successResponse(gate);
	} catch (error) {
		return internalError(`Failed to get publish gate: ${error.message}`);
	}
}

export async function upsertPublishGate(request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) {
			return parsedBody.response;
		}

		const {
			payment_method_added,
			terms_accepted,
			commission_agreement_accepted,
		} = parsedBody.value;

		for (const [field, value] of Object.entries({
			payment_method_added,
			terms_accepted,
			commission_agreement_accepted,
		})) {
			if (value !== undefined && typeof value !== 'boolean') {
				return validationError(`${field} must be a boolean`);
			}
		}

		if (
			payment_method_added === undefined &&
			terms_accepted === undefined &&
			commission_agreement_accepted === undefined
		) {
			return validationError('At least one publish gate field must be provided');
		}

		const tenantId = getTenantId(request);
		const existing = await db
			.prepare('SELECT * FROM tenant_publish_configs WHERE tenant_id = ?')
			.bind(tenantId)
			.first();

		const next = {
			payment_method_added: payment_method_added ?? Boolean(existing?.payment_method_added),
			terms_accepted: terms_accepted ?? Boolean(existing?.terms_accepted),
			commission_agreement_accepted:
				commission_agreement_accepted ?? Boolean(existing?.commission_agreement_accepted),
		};

		await db
			.prepare(
				`INSERT INTO tenant_publish_configs
				(tenant_id, payment_method_added, terms_accepted, commission_agreement_accepted, updated_at)
				VALUES (?, ?, ?, ?, ?)
				ON CONFLICT(tenant_id) DO UPDATE SET
					payment_method_added = excluded.payment_method_added,
					terms_accepted = excluded.terms_accepted,
					commission_agreement_accepted = excluded.commission_agreement_accepted,
					updated_at = excluded.updated_at`
			)
			.bind(
				tenantId,
				next.payment_method_added ? 1 : 0,
				next.terms_accepted ? 1 : 0,
				next.commission_agreement_accepted ? 1 : 0,
				Date.now()
			)
			.run();

		const gate = await buildPublishGateState(tenantId, db);
		return successResponse(gate);
	} catch (error) {
		return internalError(`Failed to save publish gate: ${error.message}`);
	}
}

export async function getPublishGateStateForTenant(tenantId, db) {
	return buildPublishGateState(tenantId, db);
}

export async function assertPublishGateSatisfied(tenantId, db) {
	const gate = await buildPublishGateState(tenantId, db);
	if (!gate.publish_allowed) {
		return {
			ok: false,
			message: 'Publish gate requirements are not satisfied',
			details: gate,
		};
	}

	return { ok: true, gate };
}

async function buildPublishGateState(tenantId, db) {
	const domainConfig = await db
		.prepare('SELECT hostname, status, verified_at FROM tenant_domain_configs WHERE tenant_id = ?')
		.bind(tenantId)
		.first();
	const publishConfig = await db
		.prepare('SELECT * FROM tenant_publish_configs WHERE tenant_id = ?')
		.bind(tenantId)
		.first();
	const billing = await getBillingStateForTenant(tenantId, db);

	const requirements = {
		domain_verified: {
			label: 'Domain verified',
			satisfied: domainConfig?.status === 'verified',
			hostname: domainConfig?.hostname || null,
			status: domainConfig?.status || 'no_domain',
		},
		payment_method_added: {
			label: 'Payment method added',
			satisfied: Boolean(publishConfig?.payment_method_added),
		},
		terms_accepted: {
			label: 'Terms accepted',
			satisfied: Boolean(publishConfig?.terms_accepted),
		},
		commission_agreement_accepted: {
			label: 'Commission agreement accepted',
			satisfied: Boolean(publishConfig?.commission_agreement_accepted),
		},
		billing_in_good_standing: {
			label: 'Billing in good standing',
			satisfied: billing.billing_in_good_standing,
			subscription_status: billing.subscription_status,
			restriction_reason: billing.restriction_reason,
		},
	};

	const publishAllowed = Object.values(requirements).every((item) => item.satisfied);

	return {
		tenant_id: tenantId,
		preview_allowed: true,
		publish_allowed: publishAllowed,
		production_environment: 'agent_domain_only',
		requirements,
		updated_at: publishConfig?.updated_at || null,
	};
}