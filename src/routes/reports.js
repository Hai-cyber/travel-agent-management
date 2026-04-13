// src/routes/reports.js
// Reporting & Analytics API for tenant admin dashboard
// All endpoints require X-Tenant-ID + authenticated session context
import { Hono } from 'hono';

const reports = new Hono();

// ── GET /api/reports/overview ──────────────────────────────────────────────
// Returns aggregated booking + revenue metrics for the tenant.
// Query params:
//   period=30d|90d|12m|all  (default: 30d)
reports.get('/overview', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')?.trim();
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header is required.' }, 400);

  const period = c.req.query('period') ?? '30d';

  // Resolve cutoff UNIX seconds
  const nowSec = Math.floor(Date.now() / 1000);
  let cutoffSec;
  if      (period === '90d')  cutoffSec = nowSec - 90  * 86400;
  else if (period === '12m')  cutoffSec = nowSec - 365 * 86400;
  else if (period === 'all')  cutoffSec = 0;
  else                        cutoffSec = nowSec - 30  * 86400; // default 30d

  // Start-of-current-month for MTD revenue
  const now = new Date();
  const somSec = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);

  try {
    const db = c.env.DB;

    // ── 1. Status counts (within period) ─────────────────────────────────
    const statusRows = await db
      .prepare(`
        SELECT status, COUNT(*) AS cnt
          FROM booking_orders
         WHERE tenant_id = ?
           AND created_at >= ?
         GROUP BY status
      `)
      .bind(tenantId, cutoffSec)
      .all();

    const counts = { AWAITING_PROOF: 0, PROOF_UPLOADED: 0, CONFIRMED: 0, EXPIRED: 0, CANCELLED: 0 };
    for (const row of statusRows.results ?? []) {
      if (row.status in counts) counts[row.status] = row.cnt;
    }
    const totalOrders = Object.values(counts).reduce((a, b) => a + b, 0);

    // ── 2. Revenue (CONFIRMED only) ────────────────────────────────────────
    const [revPeriodRow, revMonthRow, revAllTimeRow] = await Promise.all([
      db.prepare(`
        SELECT COALESCE(SUM(COALESCE(grand_total_amount, grand_total_usd)), 0) AS total,
               COALESCE(MAX(booking_currency), 'USD') AS currency
          FROM booking_orders
         WHERE tenant_id = ? AND status = 'CONFIRMED' AND created_at >= ?
      `).bind(tenantId, cutoffSec).first(),

      db.prepare(`
        SELECT COALESCE(SUM(COALESCE(grand_total_amount, grand_total_usd)), 0) AS total,
               COALESCE(MAX(booking_currency), 'USD') AS currency
          FROM booking_orders
         WHERE tenant_id = ? AND status = 'CONFIRMED' AND created_at >= ?
      `).bind(tenantId, somSec).first(),

      db.prepare(`
        SELECT COALESCE(SUM(COALESCE(grand_total_amount, grand_total_usd)), 0) AS total,
               COALESCE(MAX(booking_currency), 'USD') AS currency
          FROM booking_orders
         WHERE tenant_id = ? AND status = 'CONFIRMED'
      `).bind(tenantId).first(),
    ]);

    // ── 3. Top 5 tours by confirmed booking count (all time) ──────────────
    const topToursRows = await db
      .prepare(`
        SELECT bo.tour_id,
               COALESCE(t.title, bo.tour_id) AS tour_name,
               COUNT(*) AS booking_count,
               COALESCE(SUM(COALESCE(bo.grand_total_amount, bo.grand_total_usd)), 0) AS confirmed_revenue
          FROM booking_orders bo
          LEFT JOIN tours t ON t.id = bo.tour_id AND t.tenant_id = bo.tenant_id
         WHERE bo.tenant_id = ? AND bo.status = 'CONFIRMED'
         GROUP BY bo.tour_id
         ORDER BY booking_count DESC
         LIMIT 5
      `)
      .bind(tenantId)
      .all();

    // ── 4. Monthly breakdown (last 6 months, CONFIRMED) ───────────────────
    // SQLite: strftime('%Y-%m', datetime(created_at, 'unixepoch'))
    const monthlyRows = await db
      .prepare(`
        SELECT strftime('%Y-%m', datetime(created_at, 'unixepoch')) AS month,
               COUNT(*) AS count,
               COALESCE(SUM(COALESCE(grand_total_amount, grand_total_usd)), 0) AS revenue
          FROM booking_orders
         WHERE tenant_id = ?
           AND status = 'CONFIRMED'
           AND created_at >= ?
         GROUP BY month
         ORDER BY month ASC
      `)
      .bind(tenantId, nowSec - 180 * 86400)
      .all();

    // ── 5. Recent 10 orders (any status, newest first) ────────────────────
    const recentRows = await db
      .prepare(`
        SELECT bo.id,
               bo.status,
               bo.tour_id,
               COALESCE(t.title, bo.tour_id) AS tour_name,
               bo.travel_date,
               bo.created_at,
               COALESCE(bo.grand_total_amount, bo.grand_total_usd) AS total,
               COALESCE(bo.booking_currency, 'USD') AS currency,
               bo.pax_shared + bo.pax_private + bo.pax_children + bo.pax_infants AS pax_total,
               CASE WHEN bo.identity_unlocked = 1 THEN bo.guest_name ELSE NULL END AS guest_name
          FROM booking_orders bo
          LEFT JOIN tours t ON t.id = bo.tour_id AND t.tenant_id = bo.tenant_id
         WHERE bo.tenant_id = ?
         ORDER BY bo.created_at DESC
         LIMIT 10
      `)
      .bind(tenantId)
      .all();

    return c.json({
      ok: true,
      period,
      summary: {
        total_orders:     totalOrders,
        awaiting_proof:   counts.AWAITING_PROOF,
        proof_uploaded:   counts.PROOF_UPLOADED,
        confirmed:        counts.CONFIRMED,
        expired:          counts.EXPIRED,
        cancelled:        counts.CANCELLED,
        revenue_period:   revPeriodRow?.total  ?? 0,
        revenue_month:    revMonthRow?.total   ?? 0,
        revenue_all_time: revAllTimeRow?.total ?? 0,
        revenue_currency: revPeriodRow?.currency ?? 'USD',
      },
      top_tours:    topToursRows.results  ?? [],
      monthly:      monthlyRows.results   ?? [],
      recent_orders: recentRows.results   ?? [],
    });

  } catch (err) {
    console.error('[REPORTS] overview error', err);
    return c.json({ error: 'Internal server error.' }, 500);
  }
});

export default function registerReportsRoutes(app) {
  app.route('/api/reports', reports);
}
