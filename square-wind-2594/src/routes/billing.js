/**
 * Billing status routes [CHK-403]
 * Trial/subscription standing controls publish and new booking allowance.
 */

import { getTenantId, successResponse, readJsonBody, validationError, internalError } from '../lib/db.js';

const TRIAL_MONTHS = 6;
const SUBSCRIPTION_STATUSES = new Set(['trialing', 'active', 'unpaid']);

export async function getBillingStatus(request, db) {
	try {
		const tenantId = getTenantId(request);
		const billing = await getBillingStateForTenant(tenantId, db);
		return successResponse(billing);
	} catch (error) {
		return internalError(`Failed to get billing status: ${error.message}`);
	}
}

export async function upsertBillingStatus(request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) {
			return parsedBody.response;
		}

		const { subscription_status, trial_started_at, trial_ends_at } = parsedBody.value;
		if (subscription_status !== undefined && (!SUBSCRIPTION_STATUSES.has(subscription_status) || typeof subscription_status !== 'string')) {
			return validationError(`subscription_status must be one of: ${Array.from(SUBSCRIPTION_STATUSES).join(', ')}`);
		}
		if (trial_started_at !== undefined && (!Number.isFinite(trial_started_at) || trial_started_at <= 0)) {
			return validationError('trial_started_at must be a positive epoch milliseconds number');
		}
		if (trial_ends_at !== undefined && (!Number.isFinite(trial_ends_at) || trial_ends_at <= 0)) {
			return validationError('trial_ends_at must be a positive epoch milliseconds number');
		}
		if (trial_started_at !== undefined && trial_ends_at !== undefined && trial_ends_at <= trial_started_at) {
			return validationError('trial_ends_at must be greater than trial_started_at');
		}
		if (subscription_status === undefined && trial_started_at === undefined && trial_ends_at === undefined) {
			return validationError('At least one billing field must be provided');
		}

		const tenantId = getTenantId(request);
		const existing = await ensureBillingConfig(tenantId, db);
		const next = {
			trial_started_at: trial_started_at ?? existing.trial_started_at,
			trial_ends_at: trial_ends_at ?? existing.trial_ends_at,
			subscription_status: subscription_status ?? existing.subscription_status,
		};

		await db
			.prepare(
				`INSERT INTO tenant_billing_configs
				(tenant_id, trial_started_at, trial_ends_at, subscription_status, updated_at)
				VALUES (?, ?, ?, ?, ?)
				ON CONFLICT(tenant_id) DO UPDATE SET
					trial_started_at = excluded.trial_started_at,
					trial_ends_at = excluded.trial_ends_at,
					subscription_status = excluded.subscription_status,
					updated_at = excluded.updated_at`
			)
			.bind(tenantId, next.trial_started_at, next.trial_ends_at, next.subscription_status, Date.now())
			.run();

		const billing = await getBillingStateForTenant(tenantId, db);
		return successResponse(billing);
	} catch (error) {
		return internalError(`Failed to save billing status: ${error.message}`);
	}
}

export async function getBillingStateForTenant(tenantId, db, now = Date.now()) {
		const config = await ensureBillingConfig(tenantId, db, now);
		return buildBillingState(config, now);
}

export async function assertBookingsAllowed(tenantId, db, now = Date.now()) {
		const billing = await getBillingStateForTenant(tenantId, db, now);
		if (!billing.new_bookings_allowed) {
			return {
				ok: false,
				message: 'Billing status does not allow new bookings',
				details: billing,
			};
		}
		return { ok: true, billing };
}

async function ensureBillingConfig(tenantId, db, now = Date.now()) {
	let config = await db
		.prepare('SELECT * FROM tenant_billing_configs WHERE tenant_id = ?')
		.bind(tenantId)
		.first();

	if (config) {
		return config;
	}

	const trialStartedAt = now;
	const trialEndsAt = addMonths(now, TRIAL_MONTHS);
	await db
		.prepare(
			`INSERT INTO tenant_billing_configs
			(tenant_id, trial_started_at, trial_ends_at, subscription_status, updated_at)
			VALUES (?, ?, ?, ?, ?)`
		)
		.bind(tenantId, trialStartedAt, trialEndsAt, 'trialing', now)
		.run();

	config = await db
		.prepare('SELECT * FROM tenant_billing_configs WHERE tenant_id = ?')
		.bind(tenantId)
		.first();
	return config;
}

function buildBillingState(config, now) {
	const trialExpired = config.subscription_status === 'trialing' && now > config.trial_ends_at;
	const billingGoodStanding = config.subscription_status === 'active' || (config.subscription_status === 'trialing' && !trialExpired);
	const restrictionReason = config.subscription_status === 'unpaid'
		? 'unpaid'
		: trialExpired
			? 'trial_expired'
			: null;

	return {
		tenant_id: config.tenant_id,
		trial_started_at: config.trial_started_at,
		trial_ends_at: config.trial_ends_at,
		subscription_status: config.subscription_status,
		billing_in_good_standing: billingGoodStanding,
		publish_allowed: billingGoodStanding,
		new_bookings_allowed: billingGoodStanding,
		restriction_reason: restrictionReason,
		updated_at: config.updated_at,
	};
}

function addMonths(timestamp, monthCount) {
	const date = new Date(timestamp);
	date.setUTCMonth(date.getUTCMonth() + monthCount);
	return date.getTime();
}