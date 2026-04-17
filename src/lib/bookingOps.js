// src/lib/bookingOps.js
// Shared post-confirmation operations called from both bank-transfer (bookings.js)
// and instant-payment webhook (payments.js) paths.
import { nanoid } from 'nanoid';
import { notifyAgent } from './notifications.js';
import { dispatchOpsDailyDigestEmail } from './bookingEmails.js';

// ── Service-type metadata ─────────────────────────────────────────────────
const SERVICE_QUERIES = {
  accommodation: {
    table: 'stop_accommodations',
    icon: '🏨',
    titleField: 'hotel_name',
    phone: 'contact_phone',
    email: 'contact_email',
    metaFields: ['hotel_name', 'address', 'check_in', 'check_out', 'room_type', 'contact_name', 'notes'],
  },
  meal: {
    table: 'stop_meals',
    icon: '🍽️',
    titleField: 'restaurant_name',
    phone: 'contact_phone',
    email: 'contact_email',
    metaFields: ['restaurant_name', 'meal_type', 'address', 'meal_datetime', 'contact_name', 'notes'],
  },
  guide: {
    table: 'stop_guides',
    icon: '🧭',
    titleField: 'guide_name',
    phone: 'phone',
    email: 'email',
    metaFields: ['guide_name', 'address', 'languages', 'time_from', 'time_to', 'contact_name', 'notes'],
  },
  local_transport: {
    table: 'stop_local_transports',
    icon: '🚐',
    titleField: 'supplier',
    phone: 'phone',
    email: 'email',
    metaFields: ['supplier', 'mode', 'driver_name', 'address', 'pickup_time', 'pickup_place', 'dropoff_place', 'contact_name', 'notes'],
  },
  intercity_leg: {
    table: 'stop_intercity_legs',
    icon: '✈️',
    titleField: 'supplier',
    phone: 'phone',
    email: 'email',
    metaFields: ['supplier', 'mode', 'depart_time', 'depart_point', 'arrive_point', 'ticket_ref', 'contact_name', 'notes'],
  },
};

function buildDaySuffix(stop) {
  if (stop.day_from == null) return '';
  const to = stop.day_to && stop.day_to !== stop.day_from ? `–${stop.day_to}` : '';
  return ` (Day ${stop.day_from}${to})`;
}

function buildMeta(cfg, item) {
  const meta = {};
  for (const f of cfg.metaFields) {
    if (item[f] != null) meta[f] = item[f];
  }
  return Object.keys(meta).length ? JSON.stringify(meta) : null;
}

/**
 * Seed booking_order_todos from all service items attached to the tour's stops.
 * Creates one structured todo per service item (accommodation, meal, guide,
 * local transport, intercity leg) with rich contact/meta fields.
 *
 * Idempotent — short-circuits if any todos already exist for this order.
 * Call non-blocking via executionCtx.waitUntil().
 *
 * @param {object} env      Cloudflare Worker env (needs env.DB)
 * @param {string} tenantId
 * @param {string} orderId
 * @param {string|null} tourId
 */
// Default placeholder service types seeded for every stop regardless of configured items.
// Sorted in the order they appear in the todo card list within a stop.
const PLACEHOLDER_SERVICES = [
  { type: 'accommodation',  icon: '🏨', label: 'Accommodation',     sortOffset: 10 },
  { type: 'intercity_leg',  icon: '✈️', label: 'Intercity Transfer', sortOffset: 20 },
  { type: 'local_transport',icon: '🚐', label: 'Local Transport',    sortOffset: 30 },
  { type: 'guide',          icon: '🧭', label: 'Guide',              sortOffset: 40 },
  // meals seeded separately using stop meal flags (see below)
];

export async function seedOrderTodos(env, tenantId, orderId, tourId) {
  if (!tourId || !orderId || !tenantId) return;
  try {
    // Short-circuit if todos already seeded for this order
    const existing = await env.DB
      .prepare('SELECT id FROM booking_order_todos WHERE order_id = ? AND tenant_id = ? LIMIT 1')
      .bind(orderId, tenantId)
      .first();
    if (existing) return;

    // Fetch all stops for the tour (include meal/night flags for placeholder decisions)
    const { results: stops } = await env.DB
      .prepare(`SELECT id, label, day_from, day_to, sort_order,
                       nights, meal_breakfast, meal_lunch, meal_dinner
                FROM tour_stops
                WHERE tour_id = ? AND tenant_id = ?
                ORDER BY sort_order, day_from`)
      .bind(tourId, tenantId)
      .all();
    if (!stops.length) return;

    const stopIds = stops.map(s => s.id);
    const stopMap = Object.fromEntries(stops.map(s => [s.id, s]));
    const now     = Math.floor(Date.now() / 1000);
    const stmts   = [];

    // Track which (stopId:serviceType) combos already have configured items
    const seeded = new Set();

    // ── 1. Seed todos from configured service item tables ─────────────────
    for (const [serviceType, cfg] of Object.entries(SERVICE_QUERIES)) {
      for (const stopId of stopIds) {
        const { results: items } = await env.DB
          .prepare(`SELECT * FROM ${cfg.table} WHERE tour_stop_id = ? AND tenant_id = ? ORDER BY position, created_at`)
          .bind(stopId, tenantId)
          .all();

        const stop      = stopMap[stopId];
        const daySuffix = buildDaySuffix(stop);

        for (const item of items) {
          seeded.add(`${stopId}:${serviceType}`);
          const id       = nanoid();
          const itemName = String(item[cfg.titleField] || serviceType).slice(0, 120);
          const title    = `${cfg.icon} ${itemName}${daySuffix}`.slice(0, 200);
          const meta     = buildMeta(cfg, item);
          const sortKey  = (stop.sort_order ?? 0) * 100 + (item.position ?? 0);

          stmts.push(env.DB.prepare(
            `INSERT OR IGNORE INTO booking_order_todos
             (id, tenant_id, order_id, stop_id, title, done, sort_order, created_at,
              service_type, service_item_id, status, person_in_charge,
              contact_name, contact_phone, contact_email, service_meta_json)
             VALUES (?,?,?,?,?,0,?,?,  ?,?,?,?,  ?,?,?,?)`
          ).bind(
            id, tenantId, orderId, stopId, title, sortKey, now,
            serviceType, item.id, 'pending',
            item.person_in_charge || null,
            item.contact_name     || null,
            item[cfg.phone]       || null,
            item[cfg.email]       || null,
            meta,
          ));
        }
      }
    }

    // ── 2. Fill gaps: placeholder todos for service types not yet configured ─
    for (const stop of stops) {
      const daySuffix = buildDaySuffix(stop);
      const baseSort  = (stop.sort_order ?? 0) * 100;

      // Non-meal services — always add a placeholder if not already seeded
      for (const svc of PLACEHOLDER_SERVICES) {
        if (seeded.has(`${stop.id}:${svc.type}`)) continue;
        const id    = nanoid();
        const title = `${svc.icon} ${svc.label}${daySuffix}`.slice(0, 200);
        stmts.push(env.DB.prepare(
          `INSERT OR IGNORE INTO booking_order_todos
           (id, tenant_id, order_id, stop_id, title, done, sort_order, created_at,
            service_type, service_item_id, status, person_in_charge,
            contact_name, contact_phone, contact_email, service_meta_json)
           VALUES (?,?,?,?,?,0,?,?,  ?,?,?,?,  ?,?,?,?)`
        ).bind(
          id, tenantId, orderId, stop.id, title, baseSort + svc.sortOffset, now,
          svc.type, null, 'pending', null, null, null, null, null,
        ));
      }

      // Meal placeholders — respect meal flags; fall back to one generic if all 0
      if (!seeded.has(`${stop.id}:meal`)) {
        const hasMealFlags = stop.meal_breakfast || stop.meal_lunch || stop.meal_dinner;
        const mealItems = hasMealFlags
          ? [
              stop.meal_breakfast ? { label: 'Breakfast', type: 'breakfast', off: 51 } : null,
              stop.meal_lunch     ? { label: 'Lunch',     type: 'lunch',     off: 52 } : null,
              stop.meal_dinner    ? { label: 'Dinner',    type: 'dinner',    off: 53 } : null,
            ].filter(Boolean)
          : [{ label: 'Meal', type: null, off: 51 }];

        for (const meal of mealItems) {
          const id   = nanoid();
          const title = `🍽️ ${meal.label}${daySuffix}`.slice(0, 200);
          const meta  = meal.type ? JSON.stringify({ meal_type: meal.type }) : null;
          stmts.push(env.DB.prepare(
            `INSERT OR IGNORE INTO booking_order_todos
             (id, tenant_id, order_id, stop_id, title, done, sort_order, created_at,
              service_type, service_item_id, status, person_in_charge,
              contact_name, contact_phone, contact_email, service_meta_json)
             VALUES (?,?,?,?,?,0,?,?,  ?,?,?,?,  ?,?,?,?)`
          ).bind(
            id, tenantId, orderId, stop.id, title, baseSort + meal.off, now,
            'meal', null, 'pending', null, null, null, null, meta,
          ));
        }
      }
    }

    if (!stmts.length) return;

    // D1 batch max = 100 statements; chunk to be safe
    const BATCH_SIZE = 80;
    for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
      await env.DB.batch(stmts.slice(i, i + BATCH_SIZE));
    }

    console.info(`[TODOS_AUTO_SEED] order=${orderId} tenant=${tenantId} items_seeded=${stmts.length}`);
  } catch (err) {
    console.warn(`[TODOS_AUTO_SEED_ERROR] order=${orderId}`, err.message);
  }
}

// ── Todo reminder cadence ─────────────────────────────────────────────────────
// Called from the scheduled cron (index.js).
// Sends one grouped reminder per CONFIRMED order when today is:
//   • +30 days from booking (once off after booking)
//   • D-30, D-14, D-7, D-3 before travel_date
// Only todos with status NOT IN ('confirmed','cancelled') and stale last_reminded_at
// are included. Updates last_reminded_at to prevent duplicate fires from 15-min cron.

function _reminderDayCheck(order, todayStr) {
  const DAYS_BEFORE = [30, 14, 7, 3];
  if (order.travel_date) {
    const travelMs = new Date(order.travel_date + 'T00:00:00Z').getTime();
    if (!isNaN(travelMs)) {
      for (const d of DAYS_BEFORE) {
        const reminderDate = new Date(travelMs - d * 86400_000).toISOString().slice(0, 10);
        if (reminderDate === todayStr) return `D-${d}`;
      }
    }
  }
  // +30 days from booking creation
  const created30 = new Date((order.created_at + 30 * 86400) * 1000).toISOString().slice(0, 10);
  if (created30 === todayStr) return '+30d';
  return null;
}

export async function runTodoReminders(env) {
  const now      = Math.floor(Date.now() / 1000);
  const todayStr = new Date(now * 1000).toISOString().slice(0, 10); // YYYY-MM-DD UTC

  try {
    // Only look at recent/upcoming confirmed orders (created within last 90 days)
    const cutoffCreated = now - 90 * 86400;
    const { results: orders } = await env.DB
      .prepare(`SELECT id, tenant_id, travel_date, created_at
                FROM booking_orders
                WHERE status = 'CONFIRMED'
                  AND travel_date IS NOT NULL
                  AND created_at > ?`)
      .bind(cutoffCreated)
      .all();

    let totalReminded = 0;
    for (const order of orders) {
      const reminderKey = _reminderDayCheck(order, todayStr);
      if (!reminderKey) continue;

      // Find todos still actionable and not recently reminded (23h de-dupe window)
      const staleThreshold = now - 23 * 3600;
      const { results: todos } = await env.DB
        .prepare(`SELECT id, title, status, service_type, contact_name, contact_phone
                  FROM booking_order_todos
                  WHERE order_id = ? AND tenant_id = ?
                    AND status NOT IN ('confirmed', 'cancelled')
                    AND (last_reminded_at IS NULL OR last_reminded_at < ?)`)
        .bind(order.id, order.tenant_id, staleThreshold)
        .all();

      if (!todos.length) continue;

      // Send grouped summary notification
      try {
        await notifyAgent(env, order.tenant_id, 'TODO_REMINDER', {
          order_id:      order.id,
          travel_date:   order.travel_date,
          pending_count: todos.length,
          reminder_key:  reminderKey,
          today:         todayStr,
        });
      } catch (notifyErr) {
        console.warn(`[TODO_REMINDER_NOTIFY_ERROR] order=${order.id}`, notifyErr.message);
      }

      // Update last_reminded_at for all reminded todos (chunk at 80)
      const updateStmts = todos.map(t =>
        env.DB.prepare('UPDATE booking_order_todos SET last_reminded_at = ? WHERE id = ? AND tenant_id = ?')
          .bind(now, t.id, order.tenant_id)
      );
      const BATCH_SIZE = 80;
      for (let i = 0; i < updateStmts.length; i += BATCH_SIZE) {
        await env.DB.batch(updateStmts.slice(i, i + BATCH_SIZE));
      }

      totalReminded += todos.length;
      console.info(`[TODO_REMINDER] order=${order.id} key=${reminderKey} todos=${todos.length}`);
    }

    if (totalReminded > 0) {
      console.info(`[TODO_REMINDER_SUMMARY] date=${todayStr} total_reminded=${totalReminded}`);
    }
  } catch (err) {
    console.warn('[TODO_REMINDERS_ERROR]', err.message);
  }
}

// ── Daily ops digest ──────────────────────────────────────────────────────────
// Called once a day from the "0 8 * * *" cron trigger.
// For every tenant that has pending/contacted todos in the next 7 days,
// sends one summary email so the team doesn't miss anything.
// [UX] Groups todos by order, shows service icon + title + status.
// [SEC] Only queries active confirmed/pending-arrival orders; excludes cancelled todos.
export async function runOpsDailyDigest(env) {
  const now      = Math.floor(Date.now() / 1000);
  const todayStr = new Date(now * 1000).toISOString().slice(0, 10);
  const window7d = now + 7 * 86400;
  const baseUrl  = (env.PLATFORM_BASE_URL || 'https://tours-market.com').replace(/\/$/, '');

  try {
    // Load all tenants that have an email address
    const { results: tenants } = await env.DB
      .prepare("SELECT id, name, email FROM tenants WHERE email IS NOT NULL AND email != ''")
      .all();

    let totalSent = 0;

    for (const tenant of tenants) {
      try {
        // Find orders with pending todos in the next 7 days
        // A todo is "due soon" if its service_meta_json has any datetime unix field in [now, +7d]
        // or if the order travel_date is within [today, +7d]
        const { results: todos } = await env.DB
          .prepare(`
            SELECT bot.id, bot.title, bot.status, bot.service_type, bot.service_meta_json,
                   bo.id AS order_id, bo.travel_date,
                   bo.price_snapshot_json
            FROM booking_order_todos bot
            JOIN booking_orders bo ON bo.id = bot.order_id
            WHERE bot.tenant_id = ?
              AND bot.status IN ('pending', 'contacted')
              AND bo.status NOT IN ('CANCELLED', 'EXPIRED')
              AND bo.travel_date IS NOT NULL
              AND bo.travel_date >= ?
              AND bo.travel_date <= ?
            ORDER BY bo.travel_date, bot.sort_order
          `)
          .bind(tenant.id, todayStr, new Date(window7d * 1000).toISOString().slice(0, 10))
          .all();

        if (!todos.length) continue;

        // Group by order
        const orderMap = new Map();
        for (const t of todos) {
          if (!orderMap.has(t.order_id)) {
            // Extract tour name from price snapshot
            let tourName = t.order_id;
            try { const snap = JSON.parse(t.price_snapshot_json); tourName = snap.tour_name || snap.tour_title || tourName; } catch {}
            orderMap.set(t.order_id, {
              orderId:    t.order_id,
              orderLabel: tourName,
              travelDate: t.travel_date,
              todos:      [],
            });
          }
          // Build a human-readable due label from service_meta_json
          let dueLabel = '';
          try {
            const meta = JSON.parse(t.service_meta_json || '{}');
            const unix = meta.check_in || meta.meal_datetime || meta.time_from || meta.pickup_time || meta.depart_time;
            if (unix) {
              const d = new Date(unix * 1000);
              dueLabel = d.toISOString().slice(0, 10);
            }
          } catch {}
          orderMap.get(t.order_id).todos.push({ title: t.title, status: t.status, dueLabel });
        }

        const todoGroups = Array.from(orderMap.values());
        const opsUrl     = `${baseUrl}/ops.html`;

        await dispatchOpsDailyDigestEmail(env, {
          tenantId:   tenant.id,
          tenantName: tenant.name,
          tenantEmail: tenant.email,
          todayStr,
          todoGroups,
          opsUrl,
        });

        totalSent++;
        console.info(`[OPS_DIGEST] tenant=${tenant.id} groups=${todoGroups.length} total_todos=${todos.length}`);
      } catch (tenantErr) {
        console.warn(`[OPS_DIGEST_TENANT_ERR] tenant=${tenant.id}`, tenantErr.message);
      }
    }

    console.info(`[OPS_DIGEST_SUMMARY] date=${todayStr} tenants_emailed=${totalSent}`);
  } catch (err) {
    console.warn('[OPS_DIGEST_ERROR]', err.message);
  }
}
