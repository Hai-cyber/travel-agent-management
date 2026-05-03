import { getProductTierByKey, normalizeProductTierKey } from './productTiers.js';

export const MEMBERSHIP_PROVIDER_KEYS = Object.freeze({
  MANUAL_BANK_TRANSFER: 'manual_bank_transfer',
});

export const MEMBERSHIP_INTENT_STATUSES = Object.freeze({
  AWAITING_PAYMENT: 'awaiting_payment',
  AWAITING_REVIEW: 'awaiting_review',
  SETTLED: 'settled',
  FAILED: 'failed',
  EXPIRED: 'expired',
  VOID: 'void',
});

const MEMBERSHIP_SELF_SERVE_UPGRADE_MATRIX = Object.freeze({
  starter_landing: ['tour_operator_pro', 'hotel_operator_pro', 'tour_hotel_suite'],
  tour_operator_pro: ['tour_hotel_suite'],
  hotel_operator_pro: ['tour_hotel_suite'],
  tour_hotel_suite: [],
});
const MEMBERSHIP_MANUAL_SETTLEMENT_SETTING_KEY = 'membership_manual_settlement_config';
const OPEN_INTENT_STATUSES = [
  MEMBERSHIP_INTENT_STATUSES.AWAITING_PAYMENT,
  MEMBERSHIP_INTENT_STATUSES.AWAITING_REVIEW,
];
const DEFAULT_INTENT_TTL_SECONDS = 7 * 24 * 60 * 60;

export function normalizeMembershipProductTierKey(rawTierKey) {
  return normalizeProductTierKey(rawTierKey) || 'starter_landing';
}

export function getAllowedMembershipUpgradeTargets(rawCurrentTierKey, subscriptionStatus = 'TRIAL') {
  const currentTierKey = normalizeMembershipProductTierKey(rawCurrentTierKey);
  const currentStatus = String(subscriptionStatus || 'TRIAL').trim().toUpperCase();
  const targets = new Set(MEMBERSHIP_SELF_SERVE_UPGRADE_MATRIX[currentTierKey] || []);

  if (currentStatus !== 'ACTIVE' && currentTierKey !== 'starter_landing') {
    targets.add(currentTierKey);
  }

  return [...targets];
}

export function getMembershipTierPrice(rawTierKey) {
  const tier = getProductTierByKey(rawTierKey);
  if (!tier) return null;
  return {
    product_tier_key: tier.key,
    amount: Number(tier.price_eur_monthly),
    currency: 'EUR',
  };
}

export function isSupportedMembershipProviderKey(rawProviderKey) {
  return String(rawProviderKey || '').trim() === MEMBERSHIP_PROVIDER_KEYS.MANUAL_BANK_TRANSFER;
}

export function buildMembershipReferenceCode(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `TM-${year}${month}${day}-${random}`;
}

export function getManualSettlementConfig(env) {
  const rawConfig = String(env.MEMBERSHIP_MANUAL_SETTLEMENT_CONFIG || '').trim();
  if (!rawConfig) return null;
  try {
    const parsed = JSON.parse(rawConfig);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function getFallbackManualSettlementConfig(env) {
  const supportEmail = String(env.MEMBERSHIP_SUPPORT_EMAIL || 'info@tours-market.com').trim() || 'info@tours-market.com';
  return {
    enabled: true,
    provider_label: 'Manual settlement',
    supported_currencies: ['EUR'],
    payment_note_template: '{{reference_code}}',
    help_text: `Membership payment instructions are being finalized by the platform team. Use reference {{reference_code}} and contact ${supportEmail} to complete this upgrade.`,
  };
}

async function loadManualSettlementConfig(env) {
  const envConfig = getManualSettlementConfig(env);
  if (envConfig) return envConfig;

  try {
    const row = await env.DB
      .prepare('SELECT value_json FROM app_settings WHERE setting_key = ?')
      .bind(MEMBERSHIP_MANUAL_SETTLEMENT_SETTING_KEY)
      .first();
    if (!row?.value_json) return getFallbackManualSettlementConfig(env);
    const parsed = JSON.parse(row.value_json);
    return parsed && typeof parsed === 'object' ? parsed : getFallbackManualSettlementConfig(env);
  } catch {
    return getFallbackManualSettlementConfig(env);
  }
}

function buildManualPaymentNote(config, referenceCode) {
  const template = String(config?.payment_note_template || '{{reference_code}}');
  const placeholderRe = /\{\{\s*reference_code\s*\}\}/;
  const match = template.match(placeholderRe);
  if (!match) return template;

  const [matched] = match;
  const parts = template.split(matched);
  const prefix = parts[0] || '';
  const suffix = parts.slice(1).join(matched);

  if (prefix && String(referenceCode).startsWith(prefix)) {
    return `${referenceCode}${suffix}`;
  }

  return `${prefix}${referenceCode}${suffix}`;
}

function buildManualInstructions(config, referenceCode) {
  const paymentNote = buildManualPaymentNote(config, referenceCode);
  return {
    provider_label: String(config?.provider_label || 'Bank transfer'),
    account_holder: config?.account_holder || null,
    bank_name: config?.bank_name || null,
    iban: config?.iban || null,
    swift_bic: config?.swift_bic || null,
    address: config?.address || null,
    supported_currencies: Array.isArray(config?.supported_currencies) ? config.supported_currencies : ['EUR'],
    help_text: config?.help_text || null,
    payment_note: paymentNote,
  };
}

function isMissingMembershipBillingTableError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('membership_billing_intents') && message.includes('no such table');
}

function buildFallbackMembershipIntent({
  tenantId,
  canonicalTierKey,
  providerKey,
  pricing,
  instructions,
  referenceCode,
  nowS,
}) {
  return {
    id: `fallback-${tenantId}-${canonicalTierKey}`,
    tenant_id: tenantId,
    product_tier_key: canonicalTierKey,
    provider_key: providerKey,
    status: MEMBERSHIP_INTENT_STATUSES.AWAITING_PAYMENT,
    amount: pricing.amount,
    currency: pricing.currency,
    reference_code: referenceCode,
    instructions,
    requested_at: nowS,
    expires_at: nowS + DEFAULT_INTENT_TTL_SECONDS,
    submitted_at: null,
    reviewed_at: null,
    reviewed_by: null,
    review_note: null,
    settled_at: null,
    voided_at: null,
    meta: {
      response_mode: 'show_manual_instructions',
      persistence: 'unavailable',
    },
  };
}

async function findReusableMembershipIntent(db, tenantId, productTierKey, providerKey, nowS) {
  return db
    .prepare(
      `SELECT id, tenant_id, product_tier_key, provider_key, status, amount, currency,
              reference_code, instructions_json, requested_at, expires_at, submitted_at,
              reviewed_at, reviewed_by, review_note, settled_at, voided_at, meta_json
         FROM membership_billing_intents
        WHERE tenant_id = ?
          AND product_tier_key = ?
          AND provider_key = ?
          AND status IN (?, ?)
          AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY requested_at DESC
        LIMIT 1`
    )
    .bind(
      tenantId,
      productTierKey,
      providerKey,
      MEMBERSHIP_INTENT_STATUSES.AWAITING_PAYMENT,
      MEMBERSHIP_INTENT_STATUSES.AWAITING_REVIEW,
      nowS,
    )
    .first();
}

function parseMaybeJson(rawValue, fallback = null) {
  try {
    return rawValue ? JSON.parse(rawValue) : fallback;
  } catch {
    return fallback;
  }
}

function serializeIntentRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    product_tier_key: row.product_tier_key,
    provider_key: row.provider_key,
    status: row.status,
    amount: Number(row.amount),
    currency: row.currency,
    reference_code: row.reference_code,
    instructions: parseMaybeJson(row.instructions_json, null),
    requested_at: row.requested_at,
    expires_at: row.expires_at,
    submitted_at: row.submitted_at,
    reviewed_at: row.reviewed_at,
    reviewed_by: row.reviewed_by,
    review_note: row.review_note,
    settled_at: row.settled_at,
    voided_at: row.voided_at,
    meta: parseMaybeJson(row.meta_json, {}),
  };
}

export async function createOrReuseMembershipIntent(env, {
  tenantId,
  productTierKey,
  providerKey,
  nowS = Math.floor(Date.now() / 1000),
}) {
  const tenant = await env.DB
    .prepare('SELECT id, subscription_status, product_tier_key FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();
  if (!tenant) {
    throw new Error('Tenant not found.');
  }

  const canonicalTierKey = normalizeMembershipProductTierKey(productTierKey);
  const allowedTargets = getAllowedMembershipUpgradeTargets(tenant.product_tier_key, tenant.subscription_status);
  if (!allowedTargets.includes(canonicalTierKey)) {
    throw new Error('This membership target is not available from your current tier.');
  }
  if (!isSupportedMembershipProviderKey(providerKey)) {
    throw new Error('Unsupported membership settlement provider.');
  }

  const pricing = getMembershipTierPrice(canonicalTierKey);
  if (!pricing) {
    throw new Error('Unknown product tier.');
  }

  const config = await loadManualSettlementConfig(env);
  if (!config?.enabled) {
    throw new Error('Manual membership settlement is temporarily unavailable on this platform.');
  }

  const referenceCode = buildMembershipReferenceCode();
  const instructions = buildManualInstructions(config, referenceCode);

  let reusable = null;
  try {
    reusable = await findReusableMembershipIntent(env.DB, tenantId, canonicalTierKey, providerKey, nowS);
  } catch (err) {
    if (!isMissingMembershipBillingTableError(err)) throw err;
    return buildFallbackMembershipIntent({
      tenantId,
      canonicalTierKey,
      providerKey,
      pricing,
      instructions,
      referenceCode,
      nowS,
    });
  }
  if (reusable) {
    return serializeIntentRow(reusable);
  }

  const intentId = crypto.randomUUID();
  const expiresAt = nowS + DEFAULT_INTENT_TTL_SECONDS;

  try {
    await env.DB
      .prepare(
        `INSERT INTO membership_billing_intents
           (id, tenant_id, product_tier_key, provider_key, status, amount, currency,
            reference_code, instructions_json, requested_at, expires_at, meta_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        intentId,
        tenantId,
        canonicalTierKey,
        providerKey,
        MEMBERSHIP_INTENT_STATUSES.AWAITING_PAYMENT,
        pricing.amount,
        pricing.currency,
        referenceCode,
        JSON.stringify(instructions),
        nowS,
        expiresAt,
        JSON.stringify({ response_mode: 'show_manual_instructions' }),
      )
      .run();
  } catch (err) {
    if (!isMissingMembershipBillingTableError(err)) throw err;
    return buildFallbackMembershipIntent({
      tenantId,
      canonicalTierKey,
      providerKey,
      pricing,
      instructions,
      referenceCode,
      nowS,
    });
  }

  return {
    id: intentId,
    tenant_id: tenantId,
    product_tier_key: canonicalTierKey,
    provider_key: providerKey,
    status: MEMBERSHIP_INTENT_STATUSES.AWAITING_PAYMENT,
    amount: pricing.amount,
    currency: pricing.currency,
    reference_code: referenceCode,
    instructions,
    requested_at: nowS,
    expires_at: expiresAt,
    submitted_at: null,
    reviewed_at: null,
    reviewed_by: null,
    review_note: null,
    settled_at: null,
    voided_at: null,
    meta: { response_mode: 'show_manual_instructions' },
  };
}

export async function getCurrentMembershipIntent(env, { tenantId, nowS = Math.floor(Date.now() / 1000) }) {
  let row;
  try {
    row = await env.DB
      .prepare(
        `SELECT id, tenant_id, product_tier_key, provider_key, status, amount, currency,
                reference_code, instructions_json, requested_at, expires_at, submitted_at,
                reviewed_at, reviewed_by, review_note, settled_at, voided_at, meta_json
           FROM membership_billing_intents
          WHERE tenant_id = ?
            AND (expires_at IS NULL OR expires_at > ? OR status NOT IN (?, ?))
          ORDER BY requested_at DESC
          LIMIT 1`
      )
      .bind(
        tenantId,
        nowS,
        MEMBERSHIP_INTENT_STATUSES.AWAITING_PAYMENT,
        MEMBERSHIP_INTENT_STATUSES.AWAITING_REVIEW,
      )
      .first();
  } catch (err) {
    if (!isMissingMembershipBillingTableError(err)) throw err;
    return null;
  }

  return serializeIntentRow(row);
}

export async function markMembershipIntentSubmitted(env, {
  tenantId,
  intentId,
  note = null,
  nowS = Math.floor(Date.now() / 1000),
}) {
  if (String(intentId || '').startsWith('fallback-')) {
    throw new Error('Manual settlement review confirmation is temporarily unavailable on this platform. Please send your payment reference to support after payment.');
  }

  const intent = await env.DB
    .prepare(
      `SELECT id, tenant_id, product_tier_key, provider_key, status, amount, currency,
              reference_code, instructions_json, requested_at, expires_at, submitted_at,
              reviewed_at, reviewed_by, review_note, settled_at, voided_at, meta_json
         FROM membership_billing_intents
        WHERE id = ?
          AND tenant_id = ?`
    )
    .bind(intentId, tenantId)
    .first();

  if (!intent) {
    throw new Error('Membership billing intent not found.');
  }
  if (intent.status !== MEMBERSHIP_INTENT_STATUSES.AWAITING_PAYMENT) {
    throw new Error('Only awaiting-payment membership intents can be submitted for review.');
  }

  const currentMeta = parseMaybeJson(intent.meta_json, {}) || {};
  const nextMeta = {
    ...currentMeta,
    response_mode: 'awaiting_review',
    tenant_note: note ? String(note).slice(0, 500) : currentMeta.tenant_note || null,
  };

  await env.DB
    .prepare(
      `UPDATE membership_billing_intents
          SET status = ?,
              submitted_at = ?,
              meta_json = ?
        WHERE id = ?
          AND tenant_id = ?
          AND status = ?`
    )
    .bind(
      MEMBERSHIP_INTENT_STATUSES.AWAITING_REVIEW,
      nowS,
      JSON.stringify(nextMeta),
      intentId,
      tenantId,
      MEMBERSHIP_INTENT_STATUSES.AWAITING_PAYMENT,
    )
    .run();

  return {
    ...serializeIntentRow(intent),
    status: MEMBERSHIP_INTENT_STATUSES.AWAITING_REVIEW,
    submitted_at: nowS,
    meta: nextMeta,
  };
}

export async function activateTenantMembershipFromSettledIntent(env, {
  tenantId,
  productTierKey,
  actor = 'system',
  nowS = Math.floor(Date.now() / 1000),
}) {
  const tenant = await env.DB
    .prepare('SELECT id, subscription_status, product_tier_key FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();

  if (!tenant) {
    throw new Error('Tenant not found.');
  }

  const canonicalTierKey = normalizeMembershipProductTierKey(productTierKey);
  await env.DB.batch([
    env.DB.prepare('UPDATE tenants SET subscription_status = ?, product_tier_key = ? WHERE id = ?')
      .bind('ACTIVE', canonicalTierKey, tenantId),
    env.DB.prepare(
      `INSERT INTO tenant_audit_log (id, tenant_id, field_name, old_value, new_value, changed_at, changed_by)
       VALUES (?, ?, 'subscription_status', ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), tenantId, tenant.subscription_status, 'ACTIVE', nowS, actor),
    env.DB.prepare(
      `INSERT INTO tenant_audit_log (id, tenant_id, field_name, old_value, new_value, changed_at, changed_by)
       VALUES (?, ?, 'product_tier_key', ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), tenantId, tenant.product_tier_key, canonicalTierKey, nowS, actor),
  ]);
}

export async function listMembershipBillingIntents(env, {
  status = null,
  productTierKey = null,
  limit = 50,
}) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const clauses = [];
  const bindings = [];

  if (status) {
    clauses.push('mbi.status = ?');
    bindings.push(String(status).trim());
  }
  if (productTierKey) {
    clauses.push('mbi.product_tier_key = ?');
    bindings.push(normalizeMembershipProductTierKey(productTierKey));
  }

  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const statement = env.DB.prepare(
    `SELECT mbi.id, mbi.tenant_id, mbi.product_tier_key, mbi.provider_key, mbi.status,
            mbi.amount, mbi.currency, mbi.reference_code, mbi.instructions_json,
            mbi.requested_at, mbi.expires_at, mbi.submitted_at, mbi.reviewed_at,
            mbi.reviewed_by, mbi.review_note, mbi.settled_at, mbi.voided_at,
            mbi.meta_json, t.name AS tenant_name, t.subscription_status, t.product_tier_key AS tenant_product_tier_key
       FROM membership_billing_intents mbi
       JOIN tenants t
         ON t.id = mbi.tenant_id
      ${whereSql}
      ORDER BY mbi.requested_at DESC
      LIMIT ?`
  );
  const { results } = await statement.bind(...bindings, safeLimit).all();
  return (results || []).map((row) => ({
    ...serializeIntentRow(row),
    tenant_name: row.tenant_name,
    tenant_subscription_status: row.subscription_status,
    tenant_product_tier_key: row.tenant_product_tier_key,
  }));
}

async function loadIntentForAdmin(env, intentId) {
  return env.DB
    .prepare(
      `SELECT id, tenant_id, product_tier_key, provider_key, status, amount, currency,
              reference_code, instructions_json, requested_at, expires_at, submitted_at,
              reviewed_at, reviewed_by, review_note, settled_at, voided_at, meta_json
         FROM membership_billing_intents
        WHERE id = ?`
    )
    .bind(intentId)
    .first();
}

export async function approveMembershipIntent(env, {
  intentId,
  actor = 'platform_admin',
  note = null,
  nowS = Math.floor(Date.now() / 1000),
}) {
  const intent = await loadIntentForAdmin(env, intentId);
  if (!intent) {
    throw new Error('Membership billing intent not found.');
  }
  if (intent.status !== MEMBERSHIP_INTENT_STATUSES.AWAITING_REVIEW) {
    throw new Error('Only awaiting-review membership intents can be approved.');
  }

  await env.DB
    .prepare(
      `UPDATE membership_billing_intents
          SET status = ?,
              reviewed_at = ?,
              reviewed_by = ?,
              review_note = ?,
              settled_at = ?,
              meta_json = ?
        WHERE id = ?
          AND status = ?`
    )
    .bind(
      MEMBERSHIP_INTENT_STATUSES.SETTLED,
      nowS,
      actor,
      note ? String(note).slice(0, 500) : null,
      nowS,
      JSON.stringify({
        ...(parseMaybeJson(intent.meta_json, {}) || {}),
        response_mode: 'settled',
      }),
      intentId,
      MEMBERSHIP_INTENT_STATUSES.AWAITING_REVIEW,
    )
    .run();

  await activateTenantMembershipFromSettledIntent(env, {
    tenantId: intent.tenant_id,
    productTierKey: intent.product_tier_key,
    actor,
    nowS,
  });

  return {
    ...serializeIntentRow(intent),
    status: MEMBERSHIP_INTENT_STATUSES.SETTLED,
    reviewed_at: nowS,
    reviewed_by: actor,
    review_note: note ? String(note).slice(0, 500) : null,
    settled_at: nowS,
    meta: {
      ...(parseMaybeJson(intent.meta_json, {}) || {}),
      response_mode: 'settled',
    },
  };
}

export async function rejectMembershipIntent(env, {
  intentId,
  actor = 'platform_admin',
  note = null,
  nowS = Math.floor(Date.now() / 1000),
}) {
  const intent = await loadIntentForAdmin(env, intentId);
  if (!intent) {
    throw new Error('Membership billing intent not found.');
  }
  if (intent.status !== MEMBERSHIP_INTENT_STATUSES.AWAITING_REVIEW) {
    throw new Error('Only awaiting-review membership intents can be rejected.');
  }

  const nextMeta = {
    ...(parseMaybeJson(intent.meta_json, {}) || {}),
    response_mode: 'failed',
  };

  await env.DB
    .prepare(
      `UPDATE membership_billing_intents
          SET status = ?,
              reviewed_at = ?,
              reviewed_by = ?,
              review_note = ?,
              meta_json = ?
        WHERE id = ?
          AND status = ?`
    )
    .bind(
      MEMBERSHIP_INTENT_STATUSES.FAILED,
      nowS,
      actor,
      note ? String(note).slice(0, 500) : null,
      JSON.stringify(nextMeta),
      intentId,
      MEMBERSHIP_INTENT_STATUSES.AWAITING_REVIEW,
    )
    .run();

  return {
    ...serializeIntentRow(intent),
    status: MEMBERSHIP_INTENT_STATUSES.FAILED,
    reviewed_at: nowS,
    reviewed_by: actor,
    review_note: note ? String(note).slice(0, 500) : null,
    meta: nextMeta,
  };
}

export async function voidMembershipIntent(env, {
  intentId,
  actor = 'platform_admin',
  note = null,
  nowS = Math.floor(Date.now() / 1000),
}) {
  const intent = await loadIntentForAdmin(env, intentId);
  if (!intent) {
    throw new Error('Membership billing intent not found.');
  }
  if (!OPEN_INTENT_STATUSES.includes(intent.status)) {
    throw new Error('Only open membership intents can be voided.');
  }

  const nextMeta = {
    ...(parseMaybeJson(intent.meta_json, {}) || {}),
    response_mode: 'failed',
    void_actor: actor,
  };

  await env.DB
    .prepare(
      `UPDATE membership_billing_intents
          SET status = ?,
              reviewed_at = ?,
              reviewed_by = ?,
              review_note = ?,
              voided_at = ?,
              meta_json = ?
        WHERE id = ?
          AND status IN (?, ?)`
    )
    .bind(
      MEMBERSHIP_INTENT_STATUSES.VOID,
      nowS,
      actor,
      note ? String(note).slice(0, 500) : null,
      nowS,
      JSON.stringify(nextMeta),
      intentId,
      MEMBERSHIP_INTENT_STATUSES.AWAITING_PAYMENT,
      MEMBERSHIP_INTENT_STATUSES.AWAITING_REVIEW,
    )
    .run();

  return {
    ...serializeIntentRow(intent),
    status: MEMBERSHIP_INTENT_STATUSES.VOID,
    reviewed_at: nowS,
    reviewed_by: actor,
    review_note: note ? String(note).slice(0, 500) : null,
    voided_at: nowS,
    meta: nextMeta,
  };
}