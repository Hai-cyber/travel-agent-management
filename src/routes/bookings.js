// src/routes/bookings.js
// Booking Draft API — Lưu lựa chọn khách hàng thành draft (giỏ hàng tạm thời)
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import {
  calculateTourPrice,
  applyDiscountCouponCodeToPriceResult,
  applyGiftCardCodeToPriceResult,
  buildDiscountCouponCompensationStatements,
  buildGiftCardCompensationStatements,
} from './pricing.js';
import { resolveLocaleFromAcceptLanguage } from '../utils/formatter.js';
import { notifyAgent } from '../lib/notifications.js';
import { isInstantProvider, ALL_PROVIDERS, checkTenantCompliance } from './payments.js';
import { buildTenantCommercialPolicy, parseTenantPaymentMethods } from '../lib/publishGuard.js';
import {
  dispatchBookingCreatedEmail,
  dispatchNewBookingAgentEmail,
  dispatchProofUploadedEmail,
  dispatchBookingConfirmedEmail,
} from '../lib/bookingEmails.js';
import { seedOrderTodos } from '../lib/bookingOps.js';

const bookings = new Hono();

const DRAFT_TTL_SECONDS = 24 * 60 * 60; // 24 giờ

// ── Pax summary string for email content ─────────────────────────────────────
function buildPaxSummary(pax = {}) {
  const parts = [];
  const shared   = pax.adult_shared_room_count ?? pax.shared   ?? pax.adult_count ?? 0;
  const triple   = pax.adult_triple_room_count ?? 0;
  const priv     = pax.adult_single_room_count ?? pax.private  ?? 0;
  const children = pax.child_count   ?? pax.children ?? 0;
  const infants  = pax.infant_count  ?? pax.infants  ?? 0;
  if (shared   > 0) parts.push(`${shared} adult${shared   > 1 ? 's' : ''} (shared room)`);
  if (triple   > 0) parts.push(`${triple} adult${triple   > 1 ? 's' : ''} (triple room)`);
  if (priv     > 0) parts.push(`${priv} adult${priv     > 1 ? 's' : ''} (private room)`);
  if (children > 0) parts.push(`${children} child${children > 1 ? 'ren' : ''}`);
  if (infants  > 0) parts.push(`${infants} infant${infants  > 1 ? 's' : ''}`);
  return parts.join(', ') || 'See booking details';
}

// POST /api/bookings/draft
// [SEC] Giá được tính server-side — không tin giá từ client.
// Snapshot toàn bộ kết quả calculateTourPrice vào DB để đảm bảo tính toàn vẹn.
bookings.post('/draft', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required' }, 400);

  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return c.json({ error: 'Content-Type phải là application/json' }, 400);
  }

  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Request body không phải JSON hợp lệ' }, 400);
  }

  const missing = ['tour_id', 'travel_date', 'segment_id'].filter(f => !body?.[f]);
  if (missing.length > 0) {
    return c.json({ error: `Missing required fields: ${missing.join(', ')}.` }, 400);
  }

  const { tour_id, travel_date, segment_id, pax } = body;
  const discountCouponCode = String(body?.discount_coupon_code ?? body?.coupon_code ?? body?.discount_code ?? '').trim().toUpperCase();
  const giftCardIdCode = String(body?.gift_card_id_code ?? body?.gift_card_code ?? '').trim().toUpperCase();
  const tenantConfig = c.get('tenantConfig') ?? {};

  // Tính giá mới nhất từ server — không cho phép client truyền giá vào
  let priceResult = await calculateTourPrice(c.env, {
    tenant_id:               tenantId,
    tour_id,
    date:                    travel_date,
    adult_shared_room_count: pax?.adult_shared_room_count,
    adult_triple_room_count: pax?.adult_triple_room_count ?? 0,
    adult_single_room_count: pax?.adult_single_room_count ?? 0,
    adult_count:             pax?.adult_count,
    child_count:             pax?.child_count   ?? 0,
    infant_count:            pax?.infant_count  ?? 0,
    segment_id,
    timezone:                tenantConfig.timezone           ?? 'Asia/Ho_Chi_Minh',
    pricing_policy:          tenantConfig.pricing_policy     ?? 'PRIORITY_HIGH_SEASON',
    infant_policy_text:      tenantConfig.infant_policy_text ?? null,
  });

  if (!priceResult.ok) {
    return c.json({ error: priceResult.error, hint: priceResult.hint }, 422);
  }

  const discountCouponApplied = await applyDiscountCouponCodeToPriceResult(c.env, tenantId, tour_id, discountCouponCode, priceResult);
  if (!discountCouponApplied.ok) {
    return c.json({ error: discountCouponApplied.error }, 422);
  }
  priceResult = discountCouponApplied.priceResult;

  const giftCardApplied = await applyGiftCardCodeToPriceResult(c.env, tenantId, tour_id, giftCardIdCode, priceResult);
  if (!giftCardApplied.ok) {
    return c.json({ error: giftCardApplied.error }, 422);
  }
  priceResult = giftCardApplied.priceResult;

  const draftId   = nanoid();
  const now       = Math.floor(Date.now() / 1000);
  const expiresAt = now + DRAFT_TTL_SECONDS;

  // snapshot_json: bao gồm toàn bộ kết quả giá + metadata booking
  const snapshot = JSON.stringify({
    ...priceResult,
    saved_at:    now,
    tenant_id:   tenantId,
    tour_id,
    travel_date,
    segment_id,
    pax: pax ?? {},
  });

  try {
    await c.env.DB
      .prepare(`INSERT INTO booking_drafts
                  (id, tenant_id, tour_id, travel_date, segment_id, status, snapshot_json, expires_at, created_at)
                VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)`)
      .bind(draftId, tenantId, tour_id, travel_date, segment_id, snapshot, expiresAt, now)
      .run();

    return c.json({
      ok:                  true,
      draft_id:            draftId,
      expires_at:          expiresAt,
      grand_total:         priceResult.totals.grand_total,
      applied_season_name: priceResult.applied_season_name,
      pax_band_name:       priceResult.pax_band_name,
      segment_code:        priceResult.segment_code,
      segment_name:        priceResult.segment_name,
      unit_prices:         priceResult.prices,
      invoice:             priceResult.totals ? {
        grand_total: priceResult.totals.grand_total,
        original_grand_total: priceResult.totals.original_grand_total ?? priceResult.totals.grand_total,
        discount_coupon_applied: priceResult.totals.discount_coupon_applied ?? 0,
        gift_card_applied: priceResult.totals.gift_card_applied ?? 0,
        shared_room_subtotal: priceResult.totals.shared_room_subtotal ?? 0,
        single_room_subtotal: priceResult.totals.single_room_subtotal ?? 0,
        children_subtotal: priceResult.totals.children_subtotal ?? 0,
        infants_subtotal: priceResult.totals.infants_subtotal ?? 0,
      } : null,
    }, 201);

  } catch (err) {
    console.error('[BOOKING_DRAFT_ERROR] POST /draft', err);
    return c.json({ error: 'Internal server error while saving draft.' }, 500);
  }
});

// GET /api/bookings/draft/:draftId
// [SEC] WHERE tenant_id = ? — không thể đọc draft của tenant khác.
bookings.get('/draft/:draftId', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required' }, 400);

  const draftId = c.req.param('draftId');
  const now     = Math.floor(Date.now() / 1000);

  try {
    const draft = await c.env.DB
      .prepare('SELECT * FROM booking_drafts WHERE id = ? AND tenant_id = ? AND expires_at > ?')
      .bind(draftId, tenantId, now)
      .first();

    if (!draft) {
      return c.json({ error: 'Draft không tồn tại hoặc đã hết hạn' }, 404);
    }

    let snapshot = null;
    try { snapshot = JSON.parse(draft.snapshot_json); } catch { /* keep null */ }

    return c.json({
      ok:         true,
      draft_id:   draftId,
      status:     draft.status,
      expires_at: draft.expires_at,
      snapshot,
    });

  } catch (err) {
    console.error('[BOOKING_DRAFT_ERROR] GET /draft/:id', err);
    return c.json({ error: 'Internal server error.' }, 500);
  }
});

export default function registerBookingRoutes(app) {
  app.route('/api/bookings', bookings);

  // Guest portal page — serve booking-portal.html for /bookings/public/:token
  // The :token is passed as ?token= so the static page can call the API.
  app.get('/bookings/public/:token', (c) => {
    const token = c.req.param('token');
    return c.redirect(`/booking-portal.html?token=${encodeURIComponent(token)}`, 302);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// BANK TRANSFER ORDER SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

// ── Deadline helper ───────────────────────────────────────────────────────────
// 48 h standard; extend to 72 h when the 48 h mark lands on Saturday or Sunday (UTC).
// This gives guests a full business day to complete the transfer.
function computePaymentDeadline(nowUnix) {
  const d48 = nowUnix + 48 * 3600;
  const dow  = new Date(d48 * 1000).getUTCDay(); // 0 = Sun, 6 = Sat
  return (dow === 0 || dow === 6) ? nowUnix + 72 * 3600 : d48;
}

// ── Allowed proof content-types ───────────────────────────────────────────────
const PROOF_ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  'image/heic', 'image/heif',
  'application/pdf',
]);
const PROOF_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// ── Identity mask ─────────────────────────────────────────────────────────────
// Trust-tier unlock model:
//   Group A — Instant (webhook): identity_unlocked = 1 the moment webhook fires
//   Group B — Manual (bank transfer): identity stays locked until agent calls confirm-receipt
//   Group C — Arrival (PAY_ON_ARRIVAL): identity stays locked until agent calls manual-unlock
//
// proof_r2_key is ALWAYS exposed so the agent can view the uploaded image/PDF
// even while the guest identity is still masked. This enables the "eyes on proof
// before unlock" workflow without extra round-trips.
function maskOrder(row) {
  const unlocked = !!row.identity_unlocked;

  const base = {
    id:               row.id,
    tour_id:          row.tour_id,
    travel_date:      row.travel_date,
    segment_id:       row.segment_id,
    status:           row.status,
    payment_method:   row.payment_method,
    payment_deadline: row.payment_deadline,
    grand_total_usd:  row.grand_total_usd,
    pax: {
      shared:   row.pax_shared,
      private:  row.pax_private,
      children: row.pax_children,
      infants:  row.pax_infants,
    },
    identity_locked:   !unlocked,
    identity_unlocked: unlocked,
    // Always visible — agent must review proof before unlocking identity
    proof_r2_key:      row.proof_r2_key ?? null,
    proof_uploaded_at: row.proof_uploaded_at ?? null,
    created_at:        row.created_at,
    // Token needed so agents can open / share the guest portal link
    secure_token:      row.secure_token ?? null,
    // Snapshot for tour title display in admin table
    price_snapshot_json: row.price_snapshot_json ?? null,
    discount_coupon: row.discount_coupon_code ? {
      id: row.discount_coupon_id ?? null,
      code: row.discount_coupon_code,
      applied_amount: row.discount_coupon_applied_amount ?? 0,
    } : null,
    gift_card: row.gift_card_id_code ? {
      id: row.gift_card_id ?? null,
      id_code: row.gift_card_id_code,
      applied_amount: row.gift_card_applied_amount ?? 0,
    } : null,
  };

  // [SEC] Identity Shield: always include guest field but mask when locked.
  // Identity is revealed ONLY after payment confirmation, not on proof upload.
  base.guest = {
    name:  unlocked ? row.guest_name  : '***',
    email: unlocked ? row.guest_email : '***',
    phone: unlocked ? row.guest_phone : '***',
  };

  if (unlocked) {
    base.confirm_receipt_available = row.status === 'PROOF_UPLOADED';
  } else {
    base.identity_note = row.proof_r2_key
      ? 'Proof received. Call POST /confirm-receipt to unlock guest identity.'
      : 'Identity locked. Awaiting proof of payment upload.';
  }

  return base;
}

// ── POST /api/bookings/order ──────────────────────────────────────────────────
// Creates a bank transfer order from a booking form submission.
// [LEGAL FIREWALL] Requires tenant subscription_status = 'ACTIVE'.
// Identity is stored immediately but API-locked until proof is uploaded.
bookings.post('/order', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  // [LEGAL FIREWALL] Only live (ACTIVE) tenants may accept bookings.
  const tenantRow = await c.env.DB
    .prepare('SELECT subscription_status, payment_methods, terms_accepted, trust_status, custom_domain, custom_domain_verified_at, subdomain, promo_activated FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();
  if (!tenantRow) return c.json({ error: 'Tenant not found.' }, 404);
  const rawHost = String(c.req.header('host') || '').split(':')[0].trim().toLowerCase();
  let localOverrideHost = '';
  try {
    localOverrideHost = String(new URL(c.req.url).searchParams.get('__local_host') || c.req.header('x-local-host-override') || '').split(':')[0].trim().toLowerCase();
  } catch {
    localOverrideHost = String(c.req.header('x-local-host-override') || '').split(':')[0].trim().toLowerCase();
  }
  const localSmokeSecret = String(c.req.header('x-local-smoke-secret') || '').trim();
  const allowLocalOverride = Boolean(c.env.ADMIN_SECRET) && localSmokeSecret !== '' && localSmokeSecret === c.env.ADMIN_SECRET;
  const requestHost = allowLocalOverride && localOverrideHost ? localOverrideHost : rawHost;
  const customDomain = String(tenantRow.custom_domain || '').trim().toLowerCase();
  const subdomain = String(tenantRow.subdomain || '').trim().toLowerCase();
  const requestHostType = customDomain && requestHost === customDomain
    ? 'custom_domain'
    : (subdomain && requestHost.split('.')[0] === subdomain ? 'platform_subdomain' : 'unknown');
  const tenantPolicy = buildTenantCommercialPolicy(tenantRow, {
    paymentMethods: parseTenantPaymentMethods(tenantRow.payment_methods),
    hostType: requestHostType,
  });
  const localCommercialPreview = allowLocalOverride
    && tenantPolicy.commercial_activation_enabled
    && Boolean(localOverrideHost)
    && localOverrideHost === customDomain;
  if (!tenantPolicy.public_booking_enabled && !localCommercialPreview) {
    return c.json({
      error: tenantPolicy.message,
      code: 'COMMERCIAL_ACTIVATION_REQUIRED',
      upgrade_url: '/dashboard.html#domain',
    }, 403);
  }

  // ── Electronic Gateway Mandate ──────────────────────────────────────────
  // Bookings are blocked unless the tenant has at least one electronic gateway
  // (Stripe/PayPal/MoMo/ZaloPay/VNPay/GrabPay) enabled in their payment_methods.
  // Mirrors the site-rendering kill switch in index.js.
  // Exception: promo-activated tenants bypass this gate for testing purposes.
  let tenantPaymentMethods = [];
  try { if (tenantRow.payment_methods) tenantPaymentMethods = JSON.parse(tenantRow.payment_methods); } catch {}
  if (!tenantPolicy.promo_activated && !checkTenantCompliance(tenantPaymentMethods)) {
    return c.json({
      error: 'This tour operator has not activated any electronic payment gateway. Online bookings are currently unavailable.',
      code:  'TENANT_NON_COMPLIANT',
    }, 403);
  }

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Request body is not valid JSON.' }, 400); }

  const missing = ['tour_id', 'travel_date', 'segment_id', 'guest'].filter(f => !body?.[f]);
  if (missing.length > 0) {
    return c.json({ error: `Missing required fields: ${missing.join(', ')}.` }, 400);
  }

  const guestMissing = ['name', 'email'].filter(f => !body.guest?.[f]);
  if (guestMissing.length > 0) {
    return c.json({ error: `Missing required guest fields: ${guestMissing.join(', ')}.` }, 400);
  }

  // ── Payment method classification ──────────────────────────────────────────
  const rawMethod    = (body.payment_method ?? 'BANK_TRANSFER').toUpperCase();
  if (!ALL_PROVIDERS.has(rawMethod)) {
    return c.json({
      error:   `Invalid payment_method: "${body.payment_method}".`,
      allowed: [...ALL_PROVIDERS],
    }, 400);
  }

  // Validate method is enabled for this tenant (if tenant has configured their channels)
  if (tenantRow.payment_methods && !tenantPolicy.promo_activated) {
    try {
      const methods = JSON.parse(tenantRow.payment_methods);
      const enabledMethod = methods.find(m => m.id === rawMethod && m.enabled);
      if (!enabledMethod) {
        return c.json({
          error: `Payment method "${rawMethod}" is not enabled for this tour operator.`,
          code:  'PAYMENT_METHOD_DISABLED',
        }, 400);
      }
    } catch { /* malformed JSON — allow all methods */ }
  }

  const instant = isInstantProvider(rawMethod);

  const { tour_id, travel_date, segment_id, pax = {}, guest, draft_id = null } = body;
  const discountCouponCode = String(body?.discount_coupon_code ?? body?.coupon_code ?? body?.discount_code ?? '').trim().toUpperCase();
  const giftCardIdCode = String(body?.gift_card_id_code ?? body?.gift_card_code ?? '').trim().toUpperCase();
  const tenantConfig = c.get('tenantConfig') ?? {};

  // Re-price server-side — client price is never trusted
  let priceResult = await calculateTourPrice(c.env, {
    tenant_id:               tenantId,
    tour_id,
    date:                    travel_date,
    adult_shared_room_count: pax.adult_shared_room_count ?? pax.shared,
    adult_triple_room_count: pax.adult_triple_room_count ?? 0,
    adult_single_room_count: pax.adult_single_room_count ?? pax.private ?? 0,
    adult_count:             pax.adult_count,
    child_count:             pax.child_count   ?? pax.children ?? 0,
    infant_count:            pax.infant_count  ?? pax.infants  ?? 0,
    segment_id,
    timezone:                tenantConfig.timezone           ?? 'Asia/Ho_Chi_Minh',
    pricing_policy:          tenantConfig.pricing_policy     ?? 'PRIORITY_HIGH_SEASON',
    infant_policy_text:      tenantConfig.infant_policy_text ?? null,
  });

  if (!priceResult.ok) {
    return c.json({ error: priceResult.error, hint: priceResult.hint }, 422);
  }
  let discountCouponRow = null;
  if (discountCouponCode) {
    const discountCouponApplied = await applyDiscountCouponCodeToPriceResult(c.env, tenantId, tour_id, discountCouponCode, priceResult);
    if (!discountCouponApplied.ok) {
      return c.json({ error: discountCouponApplied.error }, 422);
    }
    priceResult = discountCouponApplied.priceResult;
    discountCouponRow = discountCouponApplied.discountCoupon;
  }
  let giftCardRow = null;
  if (giftCardIdCode) {
    const giftCardApplied = await applyGiftCardCodeToPriceResult(c.env, tenantId, tour_id, giftCardIdCode, priceResult);
    if (!giftCardApplied.ok) {
      return c.json({ error: giftCardApplied.error }, 422);
    }
    priceResult = giftCardApplied.priceResult;
    giftCardRow = giftCardApplied.giftCard;
  }
  const orderId     = nanoid();
  const secureToken = nanoid(32);
  const now         = Math.floor(Date.now() / 1000);
  const discountCouponCompensation = buildDiscountCouponCompensationStatements(
    c.env,
    tenantId,
    discountCouponRow,
    now
  );
  let discountCouponDebited = false;
  const giftCardCompensation = buildGiftCardCompensationStatements(
    c.env,
    tenantId,
    giftCardRow,
    priceResult.gift_card?.applied_amount ?? 0,
    now
  );
  let giftCardDebited = false;

  // Group A (Instant): status = AWAITING_PAYMENT, no real deadline
  // Group B (Manual):  status = AWAITING_PROOF,   deadline = 48/72h
  // Group C (Arrival): status = PENDING_ARRIVAL,  no deadline, identity locked until manual unlock
  const isArrival     = rawMethod === 'PAY_ON_ARRIVAL';
  const initialStatus = isArrival ? 'PENDING_ARRIVAL'
                      : instant   ? 'AWAITING_PAYMENT'
                                  : 'AWAITING_PROOF';
  const deadline      = (instant || isArrival) ? 0 : computePaymentDeadline(now);
  const deadlineHours = !instant && !isArrival && deadline === now + 72 * 3600 ? 72 : 48;

  try {
    await c.env.DB
      .prepare(`INSERT INTO booking_orders
                  (id, tenant_id, draft_id, tour_id, travel_date, segment_id,
                   pax_shared, pax_private, pax_children, pax_infants,
                   guest_name, guest_email, guest_phone,
                   grand_total_usd, price_snapshot_json,
                   discount_coupon_id, discount_coupon_code, discount_coupon_applied_amount,
                   gift_card_id, gift_card_id_code, gift_card_applied_amount,
                   payment_method, payment_deadline, status, identity_unlocked,
                   secure_token, created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        orderId, tenantId, draft_id, tour_id, travel_date, segment_id,
        pax.adult_shared_room_count ?? pax.shared      ?? 0,
        pax.adult_single_room_count ?? pax.private     ?? 0,
        pax.child_count             ?? pax.children    ?? 0,
        pax.infant_count            ?? pax.infants     ?? 0,
        guest.name?.toString().slice(0, 200)  ?? null,
        guest.email?.toString().slice(0, 200) ?? null,
        guest.phone?.toString().slice(0, 50)  ?? null,
        priceResult.totals.grand_total,
        JSON.stringify({ ...priceResult, saved_at: now }),
        discountCouponCompensation?.couponId ?? null,
        discountCouponCompensation?.code ?? null,
        priceResult.discount_coupon?.applied_amount ?? 0,
        giftCardCompensation?.giftCardId ?? null,
        giftCardCompensation?.idCode ?? null,
        giftCardCompensation?.appliedAmount ?? 0,
        rawMethod,
        deadline,
        initialStatus,
        0,
        secureToken,
        now
      )
      .run();

    if (discountCouponCompensation) {
      const updateResult = await discountCouponCompensation.update.run();
      if (!updateResult.meta?.changes) {
        await c.env.DB
          .prepare('DELETE FROM booking_orders WHERE id = ? AND tenant_id = ?')
          .bind(orderId, tenantId)
          .run();
        return c.json({ error: 'Discount coupon availability changed before this booking could be saved. Please try again.' }, 409);
      }
      discountCouponDebited = true;
    }

    if (giftCardCompensation) {
      const updateResult = await giftCardCompensation.update.run();
      if (!updateResult.meta?.changes) {
        if (discountCouponDebited) {
          await discountCouponCompensation.restore.run().catch(() => null);
        }
        await c.env.DB
          .prepare('DELETE FROM booking_orders WHERE id = ? AND tenant_id = ?')
          .bind(orderId, tenantId)
          .run();
        return c.json({ error: 'Gift card balance changed before this booking could be saved. Please try again.' }, 409);
      }
      giftCardDebited = true;
    }

    // Fire booking notification — non-blocking
    c.executionCtx.waitUntil(
      notifyAgent(c.env, tenantId,
        instant ? 'INSTANT_PAID' : 'MANUAL_BOOKING',
        {
          order_id:    orderId,
          provider:    rawMethod,
          guest_name:  null,  // identity still locked at this point
          grand_total: priceResult.totals.grand_total,
          tour_id,
        }
      )
    );

    // Fire booking.created email to guest + new booking notification to agent — non-blocking
    c.executionCtx.waitUntil((async () => {
      try {
        const [tourRow, tenantRow, agentRow] = await Promise.all([
          c.env.DB.prepare('SELECT title FROM tours WHERE id = ? LIMIT 1').bind(tour_id).first(),
          c.env.DB.prepare('SELECT name FROM tenants WHERE id = ? LIMIT 1').bind(tenantId).first(),
          c.env.DB.prepare(`SELECT u.email FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.tenant_id = ? AND m.role = 'owner' LIMIT 1`).bind(tenantId).first(),
        ]);
        const platformBase   = String(c.env.PLATFORM_BASE_URL || '').trim();
        const guestPortalUrl = `${platformBase}/bookings/public/${secureToken}`;
        const dashboardUrl   = `${platformBase}/dashboard.html`;
        const paxSummary     = buildPaxSummary(pax);
        await Promise.all([
          dispatchBookingCreatedEmail(c.env, {
            orderId, tenantId,
            tenantName:   tenantRow?.name   || null,
            tourTitle:    tourRow?.title    || null,
            travelDate:   travel_date,
            segmentName:  priceResult.segment_name || null,
            paxSummary,
            grandTotal:   priceResult.totals.grand_total,
            currency:     tenantConfig.booking_currency || 'USD',
            paymentMethod: rawMethod,
            deadlineUnix:  deadline,
            deadlineHours,
            guestName:    guest.name,
            guestEmail:   guest.email,
            guestPortalUrl,
            platformBaseUrl: platformBase,
          }),
          dispatchNewBookingAgentEmail(c.env, {
            orderId, tenantId,
            tenantName:   tenantRow?.name   || null,
            agentEmail:   agentRow?.email   || null,
            tourTitle:    tourRow?.title    || null,
            travelDate:   travel_date,
            segmentName:  priceResult.segment_name || null,
            paxSummary,
            grandTotal:   priceResult.totals.grand_total,
            currency:     tenantConfig.booking_currency || 'USD',
            paymentMethod: rawMethod,
            guestName:    guest.name,
            guestEmail:   guest.email,
            guestPhone:   guest.phone || null,
            dashboardUrl,
            platformBaseUrl: platformBase,
          }),
        ]);
      } catch (err) {
        console.warn('[BOOKING_EMAIL] booking.created/new_booking error:', err.message);
      }
    })());

    if (isArrival) {
      // Group C: PAY_ON_ARRIVAL — identity locked until agent calls manual-unlock
      return c.json({
        ok:                 true,
        order_id:           orderId,
        status:             'PENDING_ARRIVAL',
        payment_method:     rawMethod,
        grand_total_usd:    priceResult.totals.grand_total,
        applied_season_name: priceResult.applied_season_name,
        pax_band_name:       priceResult.pax_band_name,
        segment_code:        priceResult.segment_code,
        segment_name:       priceResult.segment_name,
        unit_prices:        priceResult.prices,
        guest_portal_token: secureToken,
        guest_portal_url:   `/api/bookings/public/${secureToken}`,
        note:               'Đặt chỗ thành công. Khách sẽ thanh toán khi gặp nhân viên. Danh tính bị khoá cho đến khi nhân viên mở khoá thủ công.',
        warning:            '⚠ PAY_ON_ARRIVAL có rủi ro ghosting. Gọi POST /api/bookings/order/:orderId/manual-unlock khi thực sự gặp khách.',
        manual_unlock_url:  `/api/bookings/order/${orderId}/manual-unlock`,
      }, 201);
    }

    if (instant) {
      // Instant payment channel: return a payment initiation payload.
      // The agent's front-end uses this to redirect the guest to the provider.
      return c.json({
        ok:                  true,
        order_id:            orderId,
        status:              initialStatus,
        payment_method:      rawMethod,
        grand_total_usd:     priceResult.totals.grand_total,
        applied_season_name: priceResult.applied_season_name,
        pax_band_name:       priceResult.pax_band_name,
        segment_code:        priceResult.segment_code,
        segment_name:        priceResult.segment_name,
        unit_prices:         priceResult.prices,
        // Guest portal — guest can check status after payment
        guest_portal_token:  secureToken,
        guest_portal_url:    `/api/bookings/public/${secureToken}`,
        // Webhook confirmation URL to register with the payment provider
        webhook_confirm_url: `/api/payments/webhook/${rawMethod.toLowerCase()}`,
        // The provider must pass order_id back in their payload for webhook lookup
        provider_order_ref:  orderId,
        note: `Redirect guest to ${rawMethod} checkout. Set merchant order ID = ${orderId}. Webhook will auto-unlock identity on payment success.`,
      }, 201);
    }

    return c.json({
      ok:              true,
      order_id:        orderId,
      status:          'AWAITING_PROOF',
      payment_method:  rawMethod,
      payment_deadline: deadline,
      deadline_hours:  deadlineHours,
      deadline_note:   deadlineHours === 72
        ? 'Extended to 72 hours because the standard 48-hour window falls on a weekend.'
        : 'Payment required within 48 hours.',
      grand_total_usd: priceResult.totals.grand_total,
      applied_season_name: priceResult.applied_season_name,
      pax_band_name:       priceResult.pax_band_name,
      segment_code:        priceResult.segment_code,
      segment_name:    priceResult.segment_name,
      unit_prices:     priceResult.prices,
      guest_portal_token: secureToken,
      guest_portal_url:   `/api/bookings/public/${secureToken}`,
    }, 201);

  } catch (err) {
    if (giftCardCompensation && giftCardDebited) {
      try {
        await giftCardCompensation.restore.run();
      } catch (restoreErr) {
        console.warn('[BOOKING_ORDER_ERROR] gift card restore failed', restoreErr);
      }
    }
    if (discountCouponCompensation && discountCouponDebited) {
      try {
        await discountCouponCompensation.restore.run();
      } catch (restoreErr) {
        console.warn('[BOOKING_ORDER_ERROR] discount coupon restore failed', restoreErr);
      }
    }
    console.error('[BOOKING_ORDER_ERROR] POST /order', err);
    return c.json({ error: 'Internal server error while creating order.' }, 500);
  }
});

// ── GET /api/bookings/orders ──────────────────────────────────────────────────
// List all orders for the agent's tenant, newest first.
// Identity Shield applied: masked fields show *** when identity_unlocked = 0.
// [SEC] WHERE tenant_id = ? — cross-tenant reads are impossible.
bookings.get('/orders', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  // Optional filters via query params
  const statusFilter = c.req.query('status');
  const limit        = Math.min(Number(c.req.query('limit') ?? 50), 200);

  let sql = `SELECT * FROM booking_orders WHERE tenant_id = ?`;
  const binds = [tenantId];

  if (statusFilter) {
    sql += ` AND status = ?`;
    binds.push(statusFilter.toUpperCase());
  }

  sql += ` ORDER BY created_at DESC LIMIT ?`;
  binds.push(limit);

  const { results } = await c.env.DB
    .prepare(sql)
    .bind(...binds)
    .all();

  return c.json({
    ok:     true,
    count:  results.length,
    orders: results.map(maskOrder),
  });
});

// ── GET /api/bookings/order/:orderId ─────────────────────────────────────────
// Agent view. Identity fields are hidden until proof is uploaded.
// [SEC] WHERE tenant_id = ? — agent cannot read another tenant's order.
bookings.get('/order/:orderId', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const order = await c.env.DB
    .prepare('SELECT * FROM booking_orders WHERE id = ? AND tenant_id = ?')
    .bind(c.req.param('orderId'), tenantId)
    .first();

  if (!order) return c.json({ error: 'Order not found.' }, 404);

  let priceSnapshot = null;
  try { priceSnapshot = JSON.parse(order.price_snapshot_json); } catch { /* keep null */ }

  return c.json({ ok: true, order: maskOrder(order), price_snapshot: priceSnapshot });
});

// ── POST /api/bookings/order/:orderId/proof ───────────────────────────────────
// Guest uploads proof-of-payment image or PDF.
// On success: uploads to BOOKING_PROOFS R2, unlocks identity, status → PROOF_UPLOADED.
// [SEC] Content-type allowlist + 10 MB limit.
bookings.post('/order/:orderId/proof', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  if (!c.env.BOOKING_PROOFS) {
    return c.json({ error: 'R2 binding BOOKING_PROOFS is not configured.' }, 503);
  }

  const orderId = c.req.param('orderId');
  const order   = await c.env.DB
    .prepare('SELECT id, status, tenant_id FROM booking_orders WHERE id = ? AND tenant_id = ?')
    .bind(orderId, tenantId)
    .first();

  if (!order) return c.json({ error: 'Order not found.' }, 404);
  if (order.status === 'CONFIRMED') {
    return c.json({ error: 'This order is already confirmed. No further action required.' }, 409);
  }
  if (order.status === 'EXPIRED' || order.status === 'CANCELLED') {
    return c.json({ error: `Order is ${order.status} and can no longer be updated.` }, 409);
  }
  if (order.status === 'PROOF_UPLOADED') {
    return c.json({ error: 'Proof already uploaded. Awaiting agent confirmation.' }, 409);
  }

  let form;
  try { form = await c.req.formData(); }
  catch { return c.json({ error: 'Expected multipart/form-data body with a "proof" field.' }, 400); }

  const file = form.get('proof');
  if (!file || typeof file === 'string') {
    return c.json({ error: 'Missing file field: "proof". Must be an image or PDF.' }, 400);
  }

  const ct = (file.type ?? '').toLowerCase().split(';')[0].trim();
  if (!PROOF_ALLOWED_TYPES.has(ct)) {
    return c.json({
      error:   `Unsupported file type: "${ct}".`,
      allowed: [...PROOF_ALLOWED_TYPES],
    }, 415);
  }

  if (file.size > PROOF_MAX_BYTES) {
    return c.json({ error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 10 MB.` }, 413);
  }

  const buffer   = await file.arrayBuffer();
  // [SEC] R2 key uses orderId (nanoid — alphanumeric only) — no path traversal possible
  const r2Key    = `proofs/${orderId}`;
  const now      = Math.floor(Date.now() / 1000);

  await c.env.BOOKING_PROOFS.put(r2Key, buffer, {
    httpMetadata:   { contentType: ct },
    customMetadata: { order_id: orderId, tenant_id: tenantId, uploaded_at: new Date(now * 1000).toISOString() },
  });

  // Strict Lock: transition to PROOF_UPLOADED but keep identity locked.
  // Identity is revealed only when the agent calls POST /confirm-receipt.
  const result = await c.env.DB
    .prepare(`UPDATE booking_orders
              SET status             = 'PROOF_UPLOADED',
                  proof_r2_key       = ?,
                  proof_content_type = ?,
                  proof_uploaded_at  = ?
              WHERE id = ? AND tenant_id = ? AND status = 'AWAITING_PROOF'`)
    .bind(r2Key, ct, now, orderId, tenantId)
    .run();

  if (result.meta.changes === 0) {
    return c.json({ error: 'Order status changed before upload could be saved. Please refresh and try again.' }, 409);
  }

  console.info(`[PROOF_UPLOADED] order=${orderId} tenant=${tenantId} identity_locked=STRICT at=${new Date(now * 1000).toISOString()}`);

  // Notify agent via email — non-blocking
  c.executionCtx.waitUntil((async () => {
    try {
      const [orderRow, agentRow, tenantRow] = await Promise.all([
        c.env.DB.prepare(`SELECT o.tour_id, o.travel_date, o.grand_total_usd, t.title as tour_title
                          FROM booking_orders o LEFT JOIN tours t ON t.id = o.tour_id
                          WHERE o.id = ? LIMIT 1`).bind(orderId).first(),
        c.env.DB.prepare(`SELECT u.email FROM users u
                          JOIN memberships m ON m.user_id = u.id
                          WHERE m.tenant_id = ? AND m.role = 'owner' LIMIT 1`).bind(tenantId).first(),
        c.env.DB.prepare('SELECT name, booking_currency FROM tenants WHERE id = ? LIMIT 1').bind(tenantId).first(),
      ]);
      const platformBase = String(c.env.PLATFORM_BASE_URL || '').trim();
      await dispatchProofUploadedEmail(c.env, {
        orderId, tenantId,
        agentEmail:   agentRow?.email    || null,
        agentName:    tenantRow?.name    || null,
        tourTitle:    orderRow?.tour_title || null,
        travelDate:   orderRow?.travel_date || null,
        grandTotal:   orderRow?.grand_total_usd || null,
        currency:     tenantRow?.booking_currency || 'USD',
        dashboardUrl: `${platformBase}/dashboard.html`,
        platformBaseUrl: platformBase,
      });
    } catch (err) {
      console.warn('[BOOKING_EMAIL] booking.proof_uploaded (agent upload) error:', err.message);
    }
  })());

  return c.json({
    ok:               true,
    order_id:         orderId,
    status:           'PROOF_UPLOADED',
    identity_unlocked: false,
    proof_r2_key:     r2Key,
    note:             'Proof stored. Guest identity remains locked. Call POST /confirm-receipt after verifying the bank transfer to unlock.',
    confirm_url:      `/api/bookings/order/${orderId}/confirm-receipt`,
  });
});

// ── GET /api/bookings/order/:orderId/proof-url ────────────────────────────────
// Streams the proof image/PDF directly to the agent browser.
// [SEC] Only accessible to the tenant that owns the order.
bookings.get('/order/:orderId/proof-url', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const order = await c.env.DB
    .prepare('SELECT proof_r2_key, status FROM booking_orders WHERE id = ? AND tenant_id = ?')
    .bind(c.req.param('orderId'), tenantId)
    .first();

  if (!order) return c.json({ error: 'Order not found.' }, 404);
  if (!order.proof_r2_key) return c.json({ error: 'No proof uploaded yet.' }, 404);

  if (!c.env.BOOKING_PROOFS) return c.json({ error: 'R2 not configured.' }, 503);

  const obj = await c.env.BOOKING_PROOFS.get(order.proof_r2_key);
  if (!obj) return c.json({ error: 'Proof file not found in storage.' }, 404);

  const ct = obj.httpMetadata?.contentType || 'application/octet-stream';
  const headers = new Headers({
    'Content-Type':        ct,
    'Content-Disposition': `inline; filename="proof-${c.req.param('orderId')}"`,
    'Cache-Control':       'private, max-age=300',
    'Access-Control-Allow-Origin': c.req.header('Origin') || '*',
  });
  return new Response(obj.body, { headers });
});

// ── POST /api/bookings/order/:orderId/confirm-receipt ────────────────────────
// Agent confirms they received the bank transfer AND unlocks guest identity.
// Only valid when status = 'PROOF_UPLOADED'.
// On success: identity_unlocked = 1, status → CONFIRMED, revenue tracked, audit logged.
// [SEC] Non-atomic but idempotent: status check prevents double-revenue count.
// [AUDIT] Every confirm-receipt is written to tenant_audit_log.
bookings.post('/order/:orderId/confirm-receipt', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const orderId = c.req.param('orderId');

  // Fetch order — include guest fields so we can return them after unlock
  const order = await c.env.DB
    .prepare('SELECT id, status, grand_total_usd, guest_name, guest_email, guest_phone FROM booking_orders WHERE id = ? AND tenant_id = ?')
    .bind(orderId, tenantId)
    .first();

  if (!order) return c.json({ error: 'Order not found.' }, 404);

  if (order.status !== 'PROOF_UPLOADED') {
    const hint = {
      AWAITING_PROOF: 'Proof of payment has not been uploaded yet.',
      CONFIRMED:      'Order already confirmed.',
      EXPIRED:        'Order has expired.',
      CANCELLED:      'Order has been cancelled.',
    }[order.status] ?? `Current status: ${order.status}`;
    return c.json({ error: hint, current_status: order.status }, 422);
  }

  const now       = Math.floor(Date.now() / 1000);
  const confirmedBy = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? null;

  // Step 1: Confirm + unlock identity atomically
  // [IDENTITY] identity_unlocked = 1 set HERE, not on proof upload (Strict Lock model)
  const orderUpdate = await c.env.DB
    .prepare(`UPDATE booking_orders
              SET status            = 'CONFIRMED',
                  identity_unlocked = 1,
                  confirmed_at      = ?,
                  confirmed_by      = ?
              WHERE id = ? AND tenant_id = ? AND status = 'PROOF_UPLOADED'`)
    .bind(now, confirmedBy, orderId, tenantId)
    .run();

  if (orderUpdate.meta.changes === 0) {
    return c.json({ error: 'Order status changed before confirmation. Please refresh.' }, 409);
  }

  // Step 2: Increment revenue — only runs if step 1 changed a row
  // [REVENUE INTEGRITY] total_revenue_tracked is the platform's commission base.
  await c.env.DB
    .prepare(`UPDATE tenants
              SET total_revenue_tracked = COALESCE(total_revenue_tracked, 0) + ?
              WHERE id = ?`)
    .bind(order.grand_total_usd, tenantId)
    .run();

  // Step 3: Audit log — record this identity unlock event
  await c.env.DB
    .prepare(`INSERT INTO tenant_audit_log
              (id, tenant_id, field_name, old_value, new_value, changed_at, changed_by, actor, action, entity_type, entity_id, meta_json, created_at)
              VALUES (?, ?, 'booking_order.status', 'PROOF_UPLOADED', 'CONFIRMED', ?, ?, ?, 'IDENTITY_UNLOCK_CONFIRM_RECEIPT', 'booking_order', ?, ?, ?)`)
    .bind(
      nanoid(),
      tenantId,
      now,
      confirmedBy ?? null,
      `agent:${confirmedBy ?? 'unknown'}`,
      orderId,
      JSON.stringify({ revenue_added: order.grand_total_usd }),
      now
    )
    .run();

  console.info(
    `[IDENTITY_UNLOCK_CONFIRM_RECEIPT] order=${orderId} tenant=${tenantId} amount_usd=${order.grand_total_usd} at=${new Date(now * 1000).toISOString()}`
  );

  // Send booking.confirmed email to guest — non-blocking
  c.executionCtx.waitUntil((async () => {
    try {
      const [fullOrder, tenantRow] = await Promise.all([
        c.env.DB.prepare(`SELECT o.tour_id, o.travel_date, o.pax_shared, o.pax_private, o.pax_children, o.pax_infants,
                                 t.title as tour_title
                          FROM booking_orders o LEFT JOIN tours t ON t.id = o.tour_id
                          WHERE o.id = ? LIMIT 1`).bind(orderId).first(),
        c.env.DB.prepare('SELECT name, booking_currency FROM tenants WHERE id = ? LIMIT 1').bind(tenantId).first(),
      ]);
      const paxSummary = buildPaxSummary({
        adult_shared_room_count: fullOrder?.pax_shared,
        adult_single_room_count: fullOrder?.pax_private,
        child_count:  fullOrder?.pax_children,
        infant_count: fullOrder?.pax_infants,
      });
      const platformBase = String(c.env.PLATFORM_BASE_URL || '').trim();
      await dispatchBookingConfirmedEmail(c.env, {
        orderId, tenantId,
        tenantName:  tenantRow?.name || null,
        guestName:   order.guest_name,
        guestEmail:  order.guest_email,
        tourTitle:   fullOrder?.tour_title  || null,
        travelDate:  fullOrder?.travel_date || null,
        segmentName: null,
        paxSummary,
        grandTotal:  order.grand_total_usd,
        currency:    tenantRow?.booking_currency || 'USD',
        platformBaseUrl: platformBase,
      });
      // Auto-seed todos from tour stops after confirmation
      await seedOrderTodos(c.env, tenantId, orderId, fullOrder?.tour_id || null);
    } catch (err) {
      console.warn('[BOOKING_EMAIL] booking.confirmed error:', err.message);
    }
  })());

  return c.json({
    ok:                true,
    order_id:          orderId,
    status:            'CONFIRMED',
    confirmed_at:      now,
    revenue_added:     order.grand_total_usd,
    identity_unlocked: true,
    guest: {
      name:  order.guest_name,
      email: order.guest_email,
      phone: order.guest_phone,
    },
    note: 'Order confirmed. Identity unlocked. Revenue has been added to your tracked total.',
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GUEST PORTAL — token-gated, no X-Tenant-ID required
// Guests receive a secure_token URL after booking. They use it to:
//   1. View their booking status / payment instructions
//   2. Upload proof of bank transfer
// ═══════════════════════════════════════════════════════════════════════════

const GUEST_STATUS_LABELS = {
  AWAITING_PROOF: {
    en: 'Awaiting proof of payment. Please upload your bank transfer receipt.',
    vi: 'Đang chờ biên lai chuyển khoản. Vui lòng tải ảnh chụp giao dịch lên.',
  },
  PENDING_ARRIVAL: {
    en: 'Your booking is confirmed for pay-on-arrival. Please meet the agent at the designated location.',
    vi: 'Đặt chỗ thành công. Vui lòng gặp nhân viên tại điểm hẹn để thanh toán.',
  },
  PROOF_UPLOADED: {
    en: 'Proof received. Your booking is awaiting agent confirmation.',
    vi: 'Đã nhận biên lai. Đặt tour đang chờ xác nhận từ nhân viên.',
  },
  CONFIRMED: {
    en: 'Your booking is confirmed! See you on the tour.',
    vi: 'Đặt tour thành công! Hẹn gặp bạn trên chuyến đi.',
  },
  EXPIRED: {
    en: 'This booking has expired. Please contact us to re-book.',
    vi: 'Đơn đặt tour đã hết hạn. Vui lòng liên hệ để đặt lại.',
  },
  CANCELLED: {
    en: 'This booking was cancelled.',
    vi: 'Đơn đặt tour đã bị hủy.',
  },
};

// ── GET /api/bookings/public/:secure_token ────────────────────────────────────
// No auth header required — token acts as the credential.
// Returns a guest-safe view: status, deadline, total, pax, upload instructions.
// Guests CAN see their own identity (it's their booking).
// On EXPIRED orders, identity will be NULL in DB (already purged by cron).
bookings.get('/public/:secure_token', async (c) => {
  const token = c.req.param('secure_token');
  if (!token || token.length < 16) {
    return c.json({ error: 'Invalid or missing token.' }, 400);
  }

  const order = await c.env.DB
    .prepare(`SELECT bo.id, bo.tenant_id, bo.tour_id, bo.travel_date, bo.segment_id,
                     bo.pax_shared, bo.pax_private, bo.pax_children, bo.pax_infants,
                     bo.price_snapshot_json,
                     bo.guest_name, bo.guest_email, bo.guest_phone,
                     bo.grand_total_usd, bo.payment_method, bo.payment_deadline,
                     bo.status, bo.identity_unlocked, bo.proof_uploaded_at, bo.created_at,
                     t.title  AS tour_title,
                     tn.name  AS tenant_name
              FROM booking_orders bo
              LEFT JOIN tours   t  ON t.id  = bo.tour_id
              LEFT JOIN tenants tn ON tn.id = bo.tenant_id
              WHERE bo.secure_token = ?`)
    .bind(token)
    .first();

  if (!order) return c.json({ error: 'Booking not found. The link may be invalid or expired.' }, 404);

  // Try to recover adult_triple_room_count from the price snapshot
  let pax_triple = 0;
  if (order.price_snapshot_json) {
    try {
      const snap = JSON.parse(order.price_snapshot_json);
      pax_triple = snap.params?.adult_triple_room_count ?? snap.pax?.adult_triple_room_count ?? 0;
    } catch { /* ignore */ }
  }

  // Accept-Language for label localisation (default: 'en')
  const lang = resolveLocaleFromAcceptLanguage(c.req.header('Accept-Language'));
  const labelLang = lang === 'vi' ? 'vi' : 'en';

  const statusLabel = GUEST_STATUS_LABELS[order.status]?.[labelLang]
    ?? `Status: ${order.status}`;

  const nowUnix     = Math.floor(Date.now() / 1000);
  const secondsLeft = order.payment_deadline - nowUnix;
  const hoursLeft   = Math.max(0, Math.ceil(secondsLeft / 3600));
  let publicDiscountCoupon = null;
  let publicGiftCard = null;
  if (order.price_snapshot_json) {
    try {
      const snap = JSON.parse(order.price_snapshot_json);
      publicDiscountCoupon = snap.discount_coupon ?? null;
      publicGiftCard = snap.gift_card ?? null;
    } catch {
      publicDiscountCoupon = null;
      publicGiftCard = null;
    }
  }

  return c.json({
    ok:     true,
    // Guest-visible order summary
    order: {
      id:              order.id,
      tour_id:         order.tour_id,
      tour_title:      order.tour_title  ?? null,
      tenant_name:     order.tenant_name ?? null,
      travel_date:     order.travel_date,
      segment_id:      order.segment_id,
      status:          order.status,
      status_label:    statusLabel,
      payment_method:  order.payment_method,
      payment_deadline: order.payment_deadline,
      hours_remaining: order.status === 'AWAITING_PROOF' ? hoursLeft : null,
      grand_total_usd: order.grand_total_usd,
      pax: {
        shared:   order.pax_shared,
        triple:   pax_triple,
        private:  order.pax_private,
        children: order.pax_children,
        infants:  order.pax_infants,
      },
      // Guest can see their own identity (NULLed by cron only on EXPIRED)
      guest: {
        name:  order.guest_name,
        email: order.guest_email,
        phone: order.guest_phone,
      },
      discount_coupon: publicDiscountCoupon,
      gift_card: publicGiftCard,
      proof_uploaded_at: order.proof_uploaded_at ?? null,
      created_at:        order.created_at,
    },
    // Upload instruction: only shown when action is required
    upload_required: order.status === 'AWAITING_PROOF',
    upload_endpoint: order.status === 'AWAITING_PROOF'
      ? `/api/bookings/public/${token}/proof`
      : null,
  });
});

// ── POST /api/bookings/public/:secure_token/proof ─────────────────────────────
// Guest uploads proof of bank transfer via their secure portal link.
// Same validation rules as the agent-side upload (MIME allowlist, 10 MB max).
// On success: status → PROOF_UPLOADED, identity_unlocked = 1.
bookings.post('/public/:secure_token/proof', async (c) => {
  const token = c.req.param('secure_token');
  if (!token || token.length < 16) {
    return c.json({ error: 'Invalid or missing token.' }, 400);
  }

  if (!c.env.BOOKING_PROOFS) {
    return c.json({ error: 'R2 binding BOOKING_PROOFS is not configured.' }, 503);
  }

  // Look up by token — no tenant header needed
  const order = await c.env.DB
    .prepare('SELECT id, tenant_id, status FROM booking_orders WHERE secure_token = ?')
    .bind(token)
    .first();

  if (!order) return c.json({ error: 'Booking not found. The link may be invalid.' }, 404);

  const statusGuard = { CONFIRMED: 409, EXPIRED: 409, CANCELLED: 409, PROOF_UPLOADED: 409 };
  if (statusGuard[order.status]) {
    const msgs = {
      CONFIRMED:      'This booking is already confirmed.',
      EXPIRED:        'This booking has expired and can no longer be updated.',
      CANCELLED:      'This booking has been cancelled.',
      PROOF_UPLOADED: 'Proof already uploaded. Awaiting agent confirmation.',
    };
    return c.json({ error: msgs[order.status] }, statusGuard[order.status]);
  }

  let form;
  try { form = await c.req.formData(); }
  catch { return c.json({ error: 'Expected multipart/form-data with a "proof" field.' }, 400); }

  const file = form.get('proof');
  if (!file || typeof file === 'string') {
    return c.json({ error: 'Missing file field "proof". Must be an image or PDF.' }, 400);
  }

  const ct = (file.type ?? '').toLowerCase().split(';')[0].trim();
  if (!PROOF_ALLOWED_TYPES.has(ct)) {
    return c.json({ error: `Unsupported file type: "${ct}".`, allowed: [...PROOF_ALLOWED_TYPES] }, 415);
  }
  if (file.size > PROOF_MAX_BYTES) {
    return c.json({ error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 10 MB.` }, 413);
  }

  const buffer = await file.arrayBuffer();
  const r2Key  = `proofs/${order.id}`;
  const now    = Math.floor(Date.now() / 1000);

  await c.env.BOOKING_PROOFS.put(r2Key, buffer, {
    httpMetadata:   { contentType: ct },
    customMetadata: { order_id: order.id, tenant_id: order.tenant_id, uploaded_at: new Date(now * 1000).toISOString() },
  });

  // Strict Lock: store proof but keep identity locked until agent confirms.
  const result = await c.env.DB
    .prepare(`UPDATE booking_orders
              SET status              = 'PROOF_UPLOADED',
                  proof_r2_key        = ?,
                  proof_content_type  = ?,
                  proof_uploaded_at   = ?
              WHERE id = ? AND secure_token = ? AND status = 'AWAITING_PROOF'`)
    .bind(r2Key, ct, now, order.id, token)
    .run();

  if (result.meta.changes === 0) {
    return c.json({ error: 'Order status changed before upload could be saved. Please refresh.' }, 409);
  }

  console.info(`[GUEST_PROOF_UPLOADED] order=${order.id} tenant=${order.tenant_id} identity_locked=STRICT at=${new Date(now * 1000).toISOString()}`);

  // Notify agent via Telegram/webhook — non-blocking
  c.executionCtx.waitUntil(
    notifyAgent(c.env, order.tenant_id, 'PROOF_UPLOADED', {
      order_id:    order.id,
      provider:    order.payment_method,
      grand_total: null,
    })
  );

  // Notify agent via email — non-blocking
  c.executionCtx.waitUntil((async () => {
    try {
      const [orderRow, agentRow, tenantRow] = await Promise.all([
        c.env.DB.prepare(`SELECT o.tour_id, o.travel_date, o.grand_total_usd, t.title as tour_title
                          FROM booking_orders o LEFT JOIN tours t ON t.id = o.tour_id
                          WHERE o.id = ? LIMIT 1`).bind(order.id).first(),
        c.env.DB.prepare(`SELECT u.email FROM users u
                          JOIN memberships m ON m.user_id = u.id
                          WHERE m.tenant_id = ? AND m.role = 'owner' LIMIT 1`).bind(order.tenant_id).first(),
        c.env.DB.prepare('SELECT name, booking_currency FROM tenants WHERE id = ? LIMIT 1').bind(order.tenant_id).first(),
      ]);
      const platformBase = String(c.env.PLATFORM_BASE_URL || '').trim();
      await dispatchProofUploadedEmail(c.env, {
        orderId:      order.id,
        tenantId:     order.tenant_id,
        agentEmail:   agentRow?.email    || null,
        agentName:    tenantRow?.name    || null,
        tourTitle:    orderRow?.tour_title || null,
        travelDate:   orderRow?.travel_date || null,
        grandTotal:   orderRow?.grand_total_usd || null,
        currency:     tenantRow?.booking_currency || 'USD',
        dashboardUrl: `${platformBase}/dashboard.html`,
        platformBaseUrl: platformBase,
      });
    } catch (err) {
      console.warn('[BOOKING_EMAIL] booking.proof_uploaded (guest portal) error:', err.message);
    }
  })());

  return c.json({
    ok:      true,
    status:  'PROOF_UPLOADED',
    message: 'Your proof of payment has been received. The agent will confirm your booking shortly.',
  });
});

// ── POST /api/bookings/order/:orderId/manual-unlock ───────────────────────────
// Agent explicitly unlocks the identity of a PAY_ON_ARRIVAL (PENDING_ARRIVAL) order.
// By calling this, the agent accepts the ghosting risk — the guest may not show up.
// [SEC] Only the owning tenant may unlock via X-Tenant-ID.
// [LOG] Logged with [MANUAL_UNLOCK_GHOSTING_RISK] tag for audit trail.
bookings.post('/order/:orderId/manual-unlock', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const orderId = c.req.param('orderId');

  const order = await c.env.DB
    .prepare(
      `SELECT id, status, identity_unlocked, guest_name, guest_email, guest_phone
       FROM booking_orders WHERE id = ? AND tenant_id = ?`
    )
    .bind(orderId, tenantId)
    .first();

  if (!order) return c.json({ error: 'Order not found.' }, 404);

  if (order.status !== 'PENDING_ARRIVAL') {
    return c.json({
      error:          'Manual unlock is only available for PAY_ON_ARRIVAL orders in PENDING_ARRIVAL status.',
      current_status: order.status,
    }, 422);
  }

  // Idempotent — already unlocked, return current data without re-writing
  if (order.identity_unlocked) {
    return c.json({
      ok:               true,
      order_id:         orderId,
      already_unlocked: true,
      guest: {
        name:  order.guest_name,
        email: order.guest_email,
        phone: order.guest_phone,
      },
    });
  }

  const now = Math.floor(Date.now() / 1000);

  await c.env.DB
    .prepare(`UPDATE booking_orders
              SET identity_unlocked = 1,
                  manual_unlock_at  = ?
              WHERE id = ? AND tenant_id = ? AND status = 'PENDING_ARRIVAL'`)
    .bind(now, orderId, tenantId)
    .run();

  // Audit log — record manual unlock with ghosting-risk flag
  const connIp = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? 'unknown';
  await c.env.DB
    .prepare(`INSERT INTO tenant_audit_log
              (id, tenant_id, field_name, old_value, new_value, changed_at, changed_by, actor, action, entity_type, entity_id, meta_json, created_at)
              VALUES (?, ?, 'booking_order.identity_unlocked', '0', '1', ?, ?, ?, 'MANUAL_UNLOCK_ARRIVAL', 'booking_order', ?, ?, ?)`)
    .bind(
      nanoid(),
      tenantId,
      now,
      connIp,
      `agent:${connIp}`,
      orderId,
      JSON.stringify({ payment_method: 'PAY_ON_ARRIVAL', risk: 'ghosting' }),
      now
    )
    .run();

  console.warn(
    `[MANUAL_UNLOCK_GHOSTING_RISK] order=${orderId} tenant=${tenantId} at=${new Date(now * 1000).toISOString()}`
  );

  return c.json({
    ok:                true,
    order_id:          orderId,
    status:            order.status,
    identity_unlocked: true,
    manual_unlock_at:  now,
    guest: {
      name:  order.guest_name,
      email: order.guest_email,
      phone: order.guest_phone,
    },
    warning: '⚠ Bạn đã chấp nhận rủi ro ghosting. Dữ liệu khách đã được mở khoá.',
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ORDER TODOS — per-order service checklist, seeded from tour stops
// ═══════════════════════════════════════════════════════════════════════════

// ── GET /api/bookings/order/:orderId/todos ─────────────────────────────────
// Returns todos for this order, each enriched with stop label + day range.
// ?seed=1 → seeds from service items if:
//   (a) no todos exist yet, OR
//   (b) all existing todos are legacy-style (service_type IS NULL) → deletes + re-seeds
// [SEC] WHERE tenant_id — cross-tenant isolation enforced.
bookings.get('/order/:orderId/todos', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required' }, 400);

  const orderId = c.req.param('orderId');
  const seed    = c.req.query('seed') === '1';

  const order = await c.env.DB
    .prepare('SELECT id, tour_id FROM booking_orders WHERE id = ? AND tenant_id = ?')
    .bind(orderId, tenantId)
    .first();
  if (!order) return c.json({ error: 'Order not found' }, 404);

  if (seed) {
    // Detect legacy-style todos (all have service_type IS NULL → seeded before CHK-R79)
    const richTodo = await c.env.DB
      .prepare('SELECT id FROM booking_order_todos WHERE order_id = ? AND tenant_id = ? AND service_type IS NOT NULL LIMIT 1')
      .bind(orderId, tenantId)
      .first();
    const anyTodo = !richTodo && await c.env.DB
      .prepare('SELECT id FROM booking_order_todos WHERE order_id = ? AND tenant_id = ? LIMIT 1')
      .bind(orderId, tenantId)
      .first();

    if (!richTodo) {
      // Either no todos yet, or all are legacy — delete legacy and re-seed
      if (anyTodo) {
        await c.env.DB
          .prepare('DELETE FROM booking_order_todos WHERE order_id = ? AND tenant_id = ?')
          .bind(orderId, tenantId)
          .run();
      }
      await seedOrderTodos(c.env, tenantId, orderId, order.tour_id);
    }
  }

  // Fetch todos enriched with stop label + day range via LEFT JOIN
  const { results: todos } = await c.env.DB
    .prepare(`
      SELECT bot.*,
             ts.label    AS stop_label,
             ts.day_from AS stop_day_from,
             ts.day_to   AS stop_day_to
      FROM booking_order_todos bot
      LEFT JOIN tour_stops ts ON ts.id = bot.stop_id
      WHERE bot.order_id = ? AND bot.tenant_id = ?
      ORDER BY bot.sort_order, bot.created_at
    `)
    .bind(orderId, tenantId)
    .all();

  return c.json({ ok: true, todos: todos || [] });
});

// ── POST /api/bookings/order/:orderId/todos ───────────────────────────────
// Add a custom (non-stop) task to an order's checklist.
bookings.post('/order/:orderId/todos', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required' }, 400);

  const orderId = c.req.param('orderId');
  const order   = await c.env.DB
    .prepare('SELECT id FROM booking_orders WHERE id = ? AND tenant_id = ?')
    .bind(orderId, tenantId)
    .first();
  if (!order) return c.json({ error: 'Order not found' }, 404);

  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const title = String(body?.title || '').trim().slice(0, 200);
  if (!title) return c.json({ error: 'title is required' }, 400);

  const id           = nanoid();
  const now          = Math.floor(Date.now() / 1000);
  const serviceType  = body?.service_type  ? String(body.service_type).slice(0, 50)  : null;
  const personCharge = body?.person_in_charge ? String(body.person_in_charge).slice(0, 200) : null;
  const cPhone       = body?.contact_phone ? String(body.contact_phone).slice(0, 50)  : null;
  const cEmail       = body?.contact_email ? String(body.contact_email).slice(0, 200) : null;
  const metaJson     = body?.service_meta_json ? JSON.stringify(body.service_meta_json) : null;

  await c.env.DB
    .prepare(`INSERT INTO booking_order_todos
      (id, tenant_id, order_id, stop_id, title, done, sort_order, created_at,
       service_type, status, person_in_charge, contact_phone, contact_email, service_meta_json)
      VALUES (?,?,?,NULL,?,0,999,?, ?,?,?,?,?,?)`)
    .bind(id, tenantId, orderId, title, now,
          serviceType, 'pending', personCharge, cPhone, cEmail, metaJson)
    .run();

  return c.json({ ok: true, todo: { id, tenant_id: tenantId, order_id: orderId, stop_id: null, title, done: 0, done_at: null, sort_order: 999, created_at: now, service_type: serviceType, status: 'pending' } }, 201);
});

// ── PATCH /api/bookings/order/:orderId/todos/:todoId ─────────────────────
// Update status (pending/contacted/confirmed/cancelled/rebooked) and/or done flag.
// status is the canonical field; done is derived from it for backward compat.
bookings.patch('/order/:orderId/todos/:todoId', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required' }, 400);

  const orderId = c.req.param('orderId');
  const todoId  = c.req.param('todoId');
  const changedBy = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? null;

  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const currentTodo = await c.env.DB
    .prepare(`SELECT id, status, done, done_at, person_in_charge, contact_name, contact_phone, contact_email, service_meta_json
              FROM booking_order_todos
              WHERE id = ? AND order_id = ? AND tenant_id = ?`)
    .bind(todoId, orderId, tenantId)
    .first();
  if (!currentTodo) return c.json({ error: 'Todo not found' }, 404);

  const VALID_STATUSES = new Set(['pending', 'contacted', 'confirmed', 'cancelled', 'rebooked']);
  const now    = Math.floor(Date.now() / 1000);
  let   status, done;

  if (body?.status !== undefined) {
    if (!VALID_STATUSES.has(body.status)) {
      return c.json({ error: `Invalid status. Allowed: ${[...VALID_STATUSES].join(', ')}` }, 400);
    }
    status = body.status;
    done   = (status === 'confirmed' || status === 'cancelled') ? 1 : 0;
  } else {
    // backward compat: accept bare done=true/false
    done   = body?.done ? 1 : 0;
    status = done ? 'confirmed' : 'pending';
  }

  // Optional field updates — only applied when present in the body
  const personCharge = body?.person_in_charge !== undefined
    ? (body.person_in_charge ? String(body.person_in_charge).slice(0, 200) : null) : undefined;
  const contactName  = body?.contact_name  !== undefined
    ? (body.contact_name  ? String(body.contact_name).slice(0, 200)  : null) : undefined;
  const contactPhone = body?.contact_phone !== undefined
    ? (body.contact_phone ? String(body.contact_phone).slice(0, 50)  : null) : undefined;
  const contactEmail = body?.contact_email !== undefined
    ? (body.contact_email ? String(body.contact_email).slice(0, 200) : null) : undefined;
  const metaJson     = body?.service_meta_json !== undefined
    ? (body.service_meta_json ? JSON.stringify(body.service_meta_json) : null) : undefined;

  // Build dynamic SET clause for optional fields
  const setClauses = ['done = ?', 'done_at = ?', 'status = ?'];
  const binds      = [done, done ? now : null, status];
  if (personCharge !== undefined) { setClauses.push('person_in_charge = ?'); binds.push(personCharge); }
  if (contactName  !== undefined) { setClauses.push('contact_name = ?');     binds.push(contactName); }
  if (contactPhone !== undefined) { setClauses.push('contact_phone = ?');    binds.push(contactPhone); }
  if (contactEmail !== undefined) { setClauses.push('contact_email = ?');    binds.push(contactEmail); }
  if (metaJson     !== undefined) { setClauses.push('service_meta_json = ?'); binds.push(metaJson); }
  binds.push(todoId, orderId, tenantId);

  const result = await c.env.DB
    .prepare(`UPDATE booking_order_todos SET ${setClauses.join(', ')} WHERE id = ? AND order_id = ? AND tenant_id = ?`)
    .bind(...binds)
    .run();

  if (!result.meta?.changes) return c.json({ error: 'Todo not found' }, 404);

  const changePairs = [
    ['booking_order_todo.status', currentTodo.status ?? null, status],
    ['booking_order_todo.person_in_charge', currentTodo.person_in_charge ?? null, personCharge !== undefined ? personCharge : currentTodo.person_in_charge ?? null],
    ['booking_order_todo.contact_name', currentTodo.contact_name ?? null, contactName !== undefined ? contactName : currentTodo.contact_name ?? null],
    ['booking_order_todo.contact_phone', currentTodo.contact_phone ?? null, contactPhone !== undefined ? contactPhone : currentTodo.contact_phone ?? null],
    ['booking_order_todo.contact_email', currentTodo.contact_email ?? null, contactEmail !== undefined ? contactEmail : currentTodo.contact_email ?? null],
    ['booking_order_todo.service_meta_json', currentTodo.service_meta_json ?? null, metaJson !== undefined ? metaJson : currentTodo.service_meta_json ?? null],
  ].filter(([, oldValue, newValue]) => (oldValue ?? null) !== (newValue ?? null));

  if (changePairs.length) {
    const auditStmts = changePairs.map(([fieldName, oldValue, newValue]) =>
      c.env.DB.prepare(`INSERT INTO tenant_audit_log
        (id, tenant_id, field_name, old_value, new_value, changed_at, changed_by, actor, action, entity_type, entity_id, meta_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'BOOKING_TODO_UPDATE', 'booking_order_todo', ?, ?, ?)`)
        .bind(
          nanoid(),
          tenantId,
          fieldName,
          oldValue,
          newValue,
          now,
          changedBy,
          `agent:${changedBy ?? 'unknown'}`,
          todoId,
          JSON.stringify({ order_id: orderId }),
          now,
        )
    );
    await c.env.DB.batch(auditStmts);
  }

  return c.json({ ok: true, id: todoId, done, done_at: done ? now : null, status });
});

// ── DELETE /api/bookings/order/:orderId/todos/:todoId ────────────────────
// Remove a single todo (and its thread entries) from an order's checklist.
// Only tenant-owned todos can be deleted. [SEC] tenant_id enforced.
bookings.delete('/order/:orderId/todos/:todoId', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required' }, 400);

  const orderId = c.req.param('orderId');
  const todoId  = c.req.param('todoId');

  // Verify ownership before delete
  const todo = await c.env.DB
    .prepare('SELECT id FROM booking_order_todos WHERE id = ? AND order_id = ? AND tenant_id = ?')
    .bind(todoId, orderId, tenantId)
    .first();
  if (!todo) return c.json({ error: 'Todo not found' }, 404);

  // Delete thread entries first (no ON DELETE CASCADE guaranteed)
  await c.env.DB
    .prepare('DELETE FROM booking_todo_threads WHERE todo_id = ? AND tenant_id = ?')
    .bind(todoId, tenantId)
    .run();

  await c.env.DB
    .prepare('DELETE FROM booking_order_todos WHERE id = ? AND order_id = ? AND tenant_id = ?')
    .bind(todoId, orderId, tenantId)
    .run();

  return c.json({ ok: true, deleted: todoId });
});

// ── GET /api/bookings/order/:orderId/todos/:todoId/thread ─────────────────
// Returns all communication thread entries for a single todo item.
// [SEC] tenant_id enforced on both todo and thread lookups.
bookings.get('/order/:orderId/todos/:todoId/thread', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required' }, 400);

  const orderId = c.req.param('orderId');
  const todoId  = c.req.param('todoId');

  // Confirm todo belongs to this tenant's order
  const todo = await c.env.DB
    .prepare('SELECT id FROM booking_order_todos WHERE id = ? AND order_id = ? AND tenant_id = ?')
    .bind(todoId, orderId, tenantId)
    .first();
  if (!todo) return c.json({ error: 'Todo not found' }, 404);

  const { results: entries } = await c.env.DB
    .prepare('SELECT * FROM booking_todo_threads WHERE todo_id = ? AND tenant_id = ? ORDER BY created_at ASC')
    .bind(todoId, tenantId)
    .all();

  return c.json({ ok: true, todo_id: todoId, entries: entries || [] });
});

// ── POST /api/bookings/order/:orderId/todos/reseed ────────────────────────
// Force-delete all existing todos for an order and re-seed from tour service items.
// Idempotent — safe to call multiple times.
bookings.post('/order/:orderId/todos/reseed', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required' }, 400);

  const orderId = c.req.param('orderId');
  const order   = await c.env.DB
    .prepare('SELECT id, tour_id FROM booking_orders WHERE id = ? AND tenant_id = ?')
    .bind(orderId, tenantId)
    .first();
  if (!order) return c.json({ error: 'Order not found' }, 404);

  // Delete existing todos (cascade also removes threads via ON DELETE CASCADE if set,
  // otherwise threads will be orphaned — acceptable for a reseed).
  await c.env.DB
    .prepare('DELETE FROM booking_order_todos WHERE order_id = ? AND tenant_id = ?')
    .bind(orderId, tenantId)
    .run();

  await seedOrderTodos(c.env, tenantId, orderId, order.tour_id);

  const { results: todos } = await c.env.DB
    .prepare(`
      SELECT bot.*,
             ts.label    AS stop_label,
             ts.day_from AS stop_day_from,
             ts.day_to   AS stop_day_to
      FROM booking_order_todos bot
      LEFT JOIN tour_stops ts ON ts.id = bot.stop_id
      WHERE bot.order_id = ? AND bot.tenant_id = ?
      ORDER BY bot.sort_order, bot.created_at
    `)
    .bind(orderId, tenantId)
    .all();

  return c.json({ ok: true, seeded: todos?.length ?? 0, todos: todos || [] });
});

// ── POST /api/bookings/order/:orderId/todos/:todoId/thread ────────────────
// Add a communication entry to a todo's thread.
// channel: phone | whatsapp | zalo | email | note
// direction: out | in | note
// Auto-advances todo status from 'pending' → 'contacted' on first outbound contact.
bookings.post('/order/:orderId/todos/:todoId/thread', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required' }, 400);

  const orderId = c.req.param('orderId');
  const todoId  = c.req.param('todoId');

  // Confirm todo belongs to this tenant's order, fetch current status
  const todo = await c.env.DB
    .prepare('SELECT id, status FROM booking_order_todos WHERE id = ? AND order_id = ? AND tenant_id = ?')
    .bind(todoId, orderId, tenantId)
    .first();
  if (!todo) return c.json({ error: 'Todo not found' }, 404);

  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const message = String(body?.message || '').trim();
  if (!message) return c.json({ error: 'message is required' }, 400);

  const VALID_CHANNELS   = new Set(['phone', 'whatsapp', 'zalo', 'email', 'note']);
  const VALID_DIRECTIONS = new Set(['out', 'in', 'note']);

  const channel   = VALID_CHANNELS.has(body?.channel)   ? body.channel   : 'note';
  const direction = VALID_DIRECTIONS.has(body?.direction) ? body.direction : 'out';
  const sentBy    = String(body?.sent_by || 'agent').slice(0, 100);

  const entryId = nanoid();
  const now     = Math.floor(Date.now() / 1000);

  await c.env.DB
    .prepare('INSERT INTO booking_todo_threads (id, tenant_id, todo_id, order_id, channel, direction, message, sent_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(entryId, tenantId, todoId, orderId, channel, direction, message, sentBy, now)
    .run();

  // Auto-advance: pending → contacted on first outbound contact
  let newTodoStatus = todo.status;
  if (todo.status === 'pending' && direction === 'out') {
    await c.env.DB
      .prepare('UPDATE booking_order_todos SET status = ? WHERE id = ? AND tenant_id = ?')
      .bind('contacted', todoId, tenantId)
      .run();
    newTodoStatus = 'contacted';
  }

  return c.json({
    ok:         true,
    entry_id:   entryId,
    todo_id:    todoId,
    channel,
    direction,
    message,
    sent_by:    sentBy,
    created_at: now,
    todo_status: newTodoStatus,
  }, 201);
});

// ── GET /api/bookings/suppliers/suggest ───────────────────────────────────
// Autocomplete suggestions from the tenant's supplier library.
// ?q={query}     — name search (LIKE %q%)
// ?type={type}   — filter by service type (accommodation|meal|guide|local_transport|intercity_leg)
// ?limit={n}     — max results, default 10, max 30
// Also de-duplicates against ad-hoc names used in existing service items.
// [SEC] tenant_id enforced on all queries.
bookings.get('/suppliers/suggest', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required' }, 400);

  const q     = (c.req.query('q') || '').trim().slice(0, 100);
  const type  = (c.req.query('type') || '').trim().toLowerCase();
  const limit = Math.min(Number(c.req.query('limit') ?? 10), 30);

  // Map service type to the corresponding stop table + name column for ad-hoc names
  const typeTableMap = {
    accommodation:  { table: 'stop_accommodations',  col: 'hotel_name' },
    meal:           { table: 'stop_meals',            col: 'restaurant_name' },
    guide:          { table: 'stop_guides',           col: 'guide_name' },
    local_transport:{ table: 'stop_local_transports', col: 'supplier' },
    intercity_leg:  { table: 'stop_intercity_legs',   col: 'supplier' },
  };

  const likeQ  = `%${q}%`;
  const results = new Map(); // name → { name, type, contact, source }

  // 1. Supplier library
  let libSql  = 'SELECT name, type, contact FROM suppliers WHERE tenant_id = ?';
  const libBinds = [tenantId];
  if (q)    { libSql += ' AND name LIKE ?'; libBinds.push(likeQ); }
  if (type) { libSql += ' AND type = ?';    libBinds.push(type); }
  libSql += ' ORDER BY name ASC LIMIT ?';   libBinds.push(limit);

  const { results: libRows } = await c.env.DB.prepare(libSql).bind(...libBinds).all();
  for (const r of (libRows || [])) {
    results.set(r.name.toLowerCase(), { name: r.name, type: r.type, contact: r.contact || null, source: 'library' });
  }

  // 2. Ad-hoc names from stop_* tables (if a specific type is requested and room remains)
  if (type && typeTableMap[type] && results.size < limit) {
    const { table, col } = typeTableMap[type];
    const adSql = `SELECT DISTINCT ${col} AS name FROM ${table} WHERE tenant_id = ?${q ? ' AND ' + col + ' LIKE ?' : ''} ORDER BY ${col} ASC LIMIT ?`;
    const adBinds = [tenantId, ...(q ? [likeQ] : []), limit - results.size];
    const { results: adRows } = await c.env.DB.prepare(adSql).bind(...adBinds).all();
    for (const r of (adRows || [])) {
      if (r.name && !results.has(r.name.toLowerCase())) {
        results.set(r.name.toLowerCase(), { name: r.name, type, contact: null, source: 'history' });
      }
    }
  }

  return c.json({ ok: true, suggestions: [...results.values()].slice(0, limit) });
});

// ── POST /api/bookings/suppliers ──────────────────────────────────────────
// Save a supplier to the tenant's library.
// [SEC] tenant_id from header, not body.
bookings.post('/suppliers', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required' }, 400);

  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const name = String(body?.name || '').trim().slice(0, 200);
  const type = String(body?.type || '').trim().slice(0, 50);
  if (!name) return c.json({ error: 'name is required' }, 400);
  if (!type) return c.json({ error: 'type is required' }, 400);

  const contact = body?.contact ? String(body.contact).slice(0, 500) : null;
  const notes   = body?.notes   ? String(body.notes).slice(0, 1000)  : null;
  const id      = nanoid();
  const now     = Math.floor(Date.now() / 1000);

  await c.env.DB
    .prepare('INSERT INTO suppliers (id, tenant_id, name, type, contact, notes, created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(id, tenantId, name, type, contact, notes, now)
    .run();

  return c.json({ ok: true, id, name, type }, 201);
});

// ═══════════════════════════════════════════════════════════════════════════
// SCHEDULED PURGE — called by the Workers Cron trigger every 15 minutes
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Expires all AWAITING_PROOF orders whose payment_deadline has passed.
 * - Sets status = 'EXPIRED'
 * - NULLs guest identity columns (GDPR data minimisation — identity was never unlocked)
 * - Logs a note about allotment release (allotment table to be wired when implemented)
 *
 * Safe to call multiple times (idempotent — only matches AWAITING_PROOF rows).
 * @param {object} env - Workers env (must have env.DB)
 * @returns {Promise<{ expired: number }>}
 */
export async function purgeExpiredOrders(env) {
  const nowUnix = Math.floor(Date.now() / 1000);

  try {
    const result = await env.DB
      .prepare(`UPDATE booking_orders
                SET status      = 'EXPIRED',
                    guest_name  = NULL,
                    guest_email = NULL,
                    guest_phone = NULL
                WHERE status IN ('AWAITING_PROOF', 'AWAITING_PAYMENT')
                  AND payment_deadline > 0
                  AND payment_deadline < ?`)
      .bind(nowUnix)
      .run();

    const expired = result.meta?.changes ?? 0;
    if (expired > 0) {
      console.info(
        `[BOOKING_PURGE] Expired ${expired} order(s) at ${new Date(nowUnix * 1000).toISOString()}. Guest identity erased. TODO: free allotment seats when allotment table is implemented.`
      );
    }
    return { expired };

  } catch (err) {
    console.error('[BOOKING_PURGE_ERROR]', err);
    return { expired: 0 };
  }
}
