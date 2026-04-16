// src/lib/bookingOps.js
// Shared post-confirmation operations called from both bank-transfer (bookings.js)
// and instant-payment webhook (payments.js) paths.
import { nanoid } from 'nanoid';

/**
 * Seed booking_order_todos from tour_stops when a booking is confirmed.
 * Idempotent — uses INSERT OR IGNORE and short-circuits if todos already exist.
 * Call non-blocking via executionCtx.waitUntil().
 *
 * @param {object} env - Cloudflare Worker env (needs env.DB)
 * @param {string} tenantId
 * @param {string} orderId
 * @param {string|null} tourId
 */
export async function seedOrderTodos(env, tenantId, orderId, tourId) {
  if (!tourId || !orderId || !tenantId) return;
  try {
    // Short-circuit if todos already seeded for this order
    const existing = await env.DB
      .prepare('SELECT id FROM booking_order_todos WHERE order_id = ? AND tenant_id = ? LIMIT 1')
      .bind(orderId, tenantId)
      .first();
    if (existing) return;

    const { results: stops } = await env.DB
      .prepare('SELECT id, label, day_from, day_to FROM tour_stops WHERE tour_id = ? AND tenant_id = ? ORDER BY sort_order, day_from')
      .bind(tourId, tenantId)
      .all();
    if (!stops.length) return;

    const now   = Math.floor(Date.now() / 1000);
    const stmts = stops.map((stop, i) => {
      const id   = nanoid();
      const days = stop.day_from != null
        ? ` (Day ${stop.day_from}${stop.day_to && stop.day_to !== stop.day_from ? '–' + stop.day_to : ''})`
        : '';
      const title = String(stop.label || 'Stop').slice(0, 200) + days;
      return env.DB.prepare(
        'INSERT OR IGNORE INTO booking_order_todos (id, tenant_id, order_id, stop_id, title, done, sort_order, created_at) VALUES (?,?,?,?,?,0,?,?)'
      ).bind(id, tenantId, orderId, stop.id, title, i, now);
    });

    await env.DB.batch(stmts);
    console.info(`[TODOS_AUTO_SEED] order=${orderId} tenant=${tenantId} stops_seeded=${stops.length}`);
  } catch (err) {
    console.warn(`[TODOS_AUTO_SEED_ERROR] order=${orderId}`, err.message);
  }
}
