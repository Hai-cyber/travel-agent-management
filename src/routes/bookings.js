// src/routes/bookings.js
// Booking Draft API — Lưu lựa chọn khách hàng thành draft (giỏ hàng tạm thời)
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { calculateTourPrice } from './pricing.js';
import { resolveLocaleFromAcceptLanguage } from '../utils/formatter.js';
import { notifyAgent } from '../lib/notifications.js';
import { isInstantProvider, ALL_PROVIDERS, checkTenantCompliance } from './payments.js';

const bookings = new Hono();

const DRAFT_TTL_SECONDS = 24 * 60 * 60; // 24 giờ

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
  const tenantConfig = c.get('tenantConfig') ?? {};

  // Tính giá mới nhất từ server — không cho phép client truyền giá vào
  const priceResult = await calculateTourPrice(c.env, {
    tenant_id:               tenantId,
    tour_id,
    date:                    travel_date,
    adult_shared_room_count: pax?.adult_shared_room_count,
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
    .prepare('SELECT subscription_status, payment_methods FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();
  if (!tenantRow) return c.json({ error: 'Tenant not found.' }, 404);
  if (tenantRow.subscription_status !== 'ACTIVE') {
    return c.json({
      error:       'Booking is only available to tenants with an active subscription. This tour is in preview mode.',
      code:        'SUBSCRIPTION_INACTIVE',
      upgrade_url: '/billing/upgrade',
    }, 403);
  }

  // ── Electronic Gateway Mandate ──────────────────────────────────────────
  // Bookings are blocked unless the tenant has at least one electronic gateway
  // (Stripe/PayPal/MoMo/ZaloPay/VNPay/GrabPay) enabled in their payment_methods.
  // Mirrors the site-rendering kill switch in index.js.
  let tenantPaymentMethods = [];
  try { if (tenantRow.payment_methods) tenantPaymentMethods = JSON.parse(tenantRow.payment_methods); } catch {}
  if (!checkTenantCompliance(tenantPaymentMethods)) {
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
  if (tenantRow.payment_methods) {
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
  const tenantConfig = c.get('tenantConfig') ?? {};

  // Re-price server-side — client price is never trusted
  const priceResult = await calculateTourPrice(c.env, {
    tenant_id:               tenantId,
    tour_id,
    date:                    travel_date,
    adult_shared_room_count: pax.adult_shared_room_count ?? pax.shared,
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

  const orderId     = nanoid();
  const secureToken = nanoid(32);
  const now         = Math.floor(Date.now() / 1000);

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
                   payment_method, payment_deadline, status, identity_unlocked,
                   secure_token, created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`)
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
        rawMethod,
        deadline,
        initialStatus,
        secureToken,
        now
      )
      .run();

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
    .prepare(`SELECT id, tenant_id, tour_id, travel_date, segment_id,
                     pax_shared, pax_private, pax_children, pax_infants,
                     guest_name, guest_email, guest_phone,
                     grand_total_usd, payment_method, payment_deadline,
                     status, identity_unlocked, proof_uploaded_at, created_at
              FROM booking_orders WHERE secure_token = ?`)
    .bind(token)
    .first();

  if (!order) return c.json({ error: 'Booking not found. The link may be invalid or expired.' }, 404);

  // Accept-Language for label localisation (default: 'en')
  const lang = resolveLocaleFromAcceptLanguage(c.req.header('Accept-Language'));
  const labelLang = lang === 'vi' ? 'vi' : 'en';

  const statusLabel = GUEST_STATUS_LABELS[order.status]?.[labelLang]
    ?? `Status: ${order.status}`;

  const nowUnix     = Math.floor(Date.now() / 1000);
  const secondsLeft = order.payment_deadline - nowUnix;
  const hoursLeft   = Math.max(0, Math.ceil(secondsLeft / 3600));

  return c.json({
    ok:     true,
    // Guest-visible order summary
    order: {
      id:              order.id,
      tour_id:         order.tour_id,
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

  // Notify agent — non-blocking
  c.executionCtx.waitUntil(
    notifyAgent(c.env, order.tenant_id, 'PROOF_UPLOADED', {
      order_id:    order.id,
      provider:    order.payment_method,
      grand_total: null, // not fetched in this query for performance
    })
  );

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
