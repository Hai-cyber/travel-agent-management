// src/routes/bookingcal.js
// ── Booking Calendar API ─────────────────────────────────────────────────────
//
// GET /api/bookingcal/month?year=YYYY&month=MM
//   Returns day-by-day booking counts for the given month.
//   Used by calendar.html month grid to paint dots on booked dates.
//
// GET /api/bookingcal/day?date=YYYY-MM-DD
//   Returns all bookings for a specific date (for the click-to-drill panel).
//
// Auth: X-Tenant-ID header required (set from session on the client side).
//
// Tenant-type agnostic: works for tour operators, hotels, activity providers —
// all share the booking_orders.travel_date field (YYYY-MM-DD).
// A dedicated hotel "tape chart" can be built later in a separate OPS app.

import { Hono } from 'hono';

const bookingcal = new Hono();

// ── GET /api/bookingcal/month ──────────────────────────────────────────────
bookingcal.get('/month', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const nowUtc = new Date();
  const yearRaw  = c.req.query('year');
  const monthRaw = c.req.query('month');

  const year  = yearRaw  ? parseInt(yearRaw, 10)  : nowUtc.getUTCFullYear();
  const month = monthRaw ? parseInt(monthRaw, 10) : (nowUtc.getUTCMonth() + 1);

  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12 || year < 2000 || year > 2100) {
    return c.json({ error: 'Invalid year/month.' }, 400);
  }

  const mm       = String(month).padStart(2, '0');
  const firstDay = `${year}-${mm}-01`;
  const lastDayN = new Date(Date.UTC(year, month, 0)).getUTCDate(); // last calendar day of month
  const lastDay  = `${year}-${mm}-${String(lastDayN).padStart(2, '0')}`;

  try {
    const db = c.env.DB;

    const rows = await db
      .prepare(`
        SELECT travel_date, status, COUNT(*) AS cnt
          FROM booking_orders
         WHERE tenant_id = ?
           AND travel_date >= ?
           AND travel_date <= ?
         GROUP BY travel_date, status
         ORDER BY travel_date ASC
      `)
      .bind(tenantId, firstDay, lastDay)
      .all();

    // Aggregate into { date -> { confirmed, pending, cancelled, total } }
    const dayMap = {};
    for (const row of rows.results ?? []) {
      const d = row.travel_date;
      if (!dayMap[d]) dayMap[d] = { confirmed: 0, pending: 0, cancelled: 0, total: 0 };
      const cnt = Number(row.cnt ?? 0);
      const st  = row.status ?? '';
      if (st === 'CONFIRMED') {
        dayMap[d].confirmed += cnt;
      } else if (st === 'EXPIRED' || st === 'CANCELLED') {
        dayMap[d].cancelled += cnt;
      } else {
        // AWAITING_PROOF, PROOF_UPLOADED, AWAITING_PAYMENT, PENDING_ARRIVAL …
        dayMap[d].pending += cnt;
      }
      dayMap[d].total += cnt;
    }

    const days = Object.entries(dayMap)
      .map(([date, counts]) => ({ date, ...counts }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const todayStr = nowUtc.toISOString().slice(0, 10);

    return c.json({ ok: true, year, month, days, today: todayStr });

  } catch (err) {
    console.error('[BOOKINGCAL] /month error', err);
    return c.json({ error: 'Internal server error.' }, 500);
  }
});

// ── GET /api/bookingcal/day ────────────────────────────────────────────────
bookingcal.get('/day', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const date = c.req.query('date') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'Invalid date. Expected YYYY-MM-DD.' }, 400);
  }

  try {
    const db = c.env.DB;

    const rows = await db
      .prepare(`
        SELECT bo.id,
               bo.status,
               bo.travel_date,
               COALESCE(t.title, bo.tour_id) AS tour_name,
               (bo.pax_shared + bo.pax_private + bo.pax_children) AS pax,
               COALESCE(bo.grand_total_amount, bo.grand_total_usd, 0) AS total,
               COALESCE(bo.booking_currency, 'USD') AS currency,
               bo.guest_name,
               bo.guest_phone,
               bo.identity_unlocked
          FROM booking_orders bo
          LEFT JOIN tours t ON t.id = bo.tour_id AND t.tenant_id = bo.tenant_id
         WHERE bo.tenant_id = ?
           AND bo.travel_date = ?
         ORDER BY
           CASE bo.status
             WHEN 'CONFIRMED'      THEN 1
             WHEN 'PENDING_ARRIVAL'THEN 2
             WHEN 'PROOF_UPLOADED' THEN 3
             WHEN 'AWAITING_PROOF' THEN 4
             ELSE 5
           END,
           bo.created_at DESC
      `)
      .bind(tenantId, date)
      .all();

    const bookings = (rows.results ?? []).map(r => ({
      id:          r.id,
      status:      r.status,
      tour_name:   r.tour_name,
      pax:         r.pax ?? 0,
      total:       r.total ?? 0,
      currency:    r.currency,
      // [SEC] only reveal identity if unlock flag is set
      guest_name:  r.identity_unlocked ? (r.guest_name ?? null) : null,
      guest_phone: r.identity_unlocked ? (r.guest_phone ?? null) : null,
    }));

    return c.json({ ok: true, date, bookings });

  } catch (err) {
    console.error('[BOOKINGCAL] /day error', err);
    return c.json({ error: 'Internal server error.' }, 500);
  }
});

export default function registerBookingCalRoutes(app) {
  app.route('/api/bookingcal', bookingcal);
}
