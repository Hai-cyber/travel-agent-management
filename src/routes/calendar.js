// src/routes/calendar.js
// ── iCal / webcal subscription feed ──────────────────────────────────────────
//
// GET /api/calendar/:secret.ics
//   Public URL (no session required) — the secret IS the auth token.
//   Returns a valid iCal 2.0 feed with one VEVENT per upcoming service todo,
//   including VALARM reminders embedded so calendar apps fire on-device alerts.
//
//   Used by: Apple Calendar (webcal://), Google Calendar, Outlook, Fantastical…
//   Any app that supports iCal subscription URL works automatically.
//
// GET /api/calendar/:secret/:orderId.ics
//   Same feed filtered to a single booking order.
//
// [SEC] secret is a random 32-char hex token per tenant (no brute-force surface
//       thanks to UUID entropy). Rotating via POST /api/tenants/calendar-secret?rotate=1
//       immediately invalidates all existing subscriptions.

import { Hono } from 'hono';

const cal = new Hono();

// ── VALARM definitions per service type ──────────────────────────────────────
const ALARMS = {
  accommodation:   [{ trigger: '-P2D', desc: 'Check-in tomorrow!' }, { trigger: '-PT4H', desc: 'Check-in in 4 hours' }],
  meal:            [{ trigger: '-P1D', desc: 'Meal booked for tomorrow' }, { trigger: '-PT2H', desc: 'Meal in 2 hours' }],
  guide:           [{ trigger: '-P1D', desc: 'Guide service tomorrow' }, { trigger: '-PT1H', desc: 'Guide service in 1 hour' }],
  local_transport: [{ trigger: '-P1D', desc: 'Transport pickup tomorrow' }, { trigger: '-PT1H', desc: 'Transport pickup in 1 hour' }],
  intercity_leg:   [{ trigger: '-P2D', desc: 'Departure in 2 days' }, { trigger: '-PT4H', desc: 'Departure in 4 hours' }],
  default:         [{ trigger: '-P1D', desc: 'Task due tomorrow' }],
};

// ── iCal text helpers ─────────────────────────────────────────────────────────
// Fold long lines per RFC 5545 §3.1 (max 75 octets, continuation with CRLF + SPACE)
function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const chunks = [];
  let offset = 0;
  let first = true;
  while (offset < bytes.length) {
    const max = first ? 75 : 74; // first line: 75, continuation: 74 (after the leading space)
    const chunk = bytes.slice(offset, offset + max);
    chunks.push(new TextDecoder().decode(chunk));
    offset += max;
    first = false;
  }
  return chunks.join('\r\n ');
}

function icalEscape(s) {
  if (!s) return '';
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

function unixToIcal(unix) {
  // Returns UTC timestamp string: 20260403T080000Z
  const d = new Date(unix * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function unixToIcalDate(unix) {
  // Date-only value (no time, no Z): 20260403
  const d = new Date(unix * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}`;
}

function icalNow() {
  return unixToIcal(Math.floor(Date.now() / 1000));
}

function readMeta(val) {
  if (!val) return {};
  if (typeof val === 'string') { try { return JSON.parse(val); } catch { return {}; } }
  return val;
}

// ── Extract the primary datetime from a todo (for DTSTART) ───────────────────
function extractDatetime(serviceType, meta) {
  switch (serviceType) {
    case 'accommodation':   return meta.check_in   ? { unix: meta.check_in,   dateOnly: true  } : null;
    case 'meal':            return meta.meal_datetime ? { unix: meta.meal_datetime, dateOnly: false } : null;
    case 'guide':           return meta.time_from   ? { unix: meta.time_from,   dateOnly: false } : null;
    case 'local_transport': return meta.pickup_time  ? { unix: meta.pickup_time,  dateOnly: false } : null;
    case 'intercity_leg':   return meta.depart_time  ? { unix: meta.depart_time,  dateOnly: false } : null;
    default: return null;
  }
}

// ── Extract end datetime (for DTEND) ─────────────────────────────────────────
function extractEndDatetime(serviceType, meta, startUnix) {
  switch (serviceType) {
    case 'accommodation': return meta.check_out ? { unix: meta.check_out, dateOnly: true } : null;
    case 'meal':          return startUnix ? { unix: startUnix + 90 * 60, dateOnly: false } : null; // +90 min
    case 'guide':         return meta.time_to ? { unix: meta.time_to, dateOnly: false } : (startUnix ? { unix: startUnix + 8 * 3600, dateOnly: false } : null);
    case 'local_transport': return startUnix ? { unix: startUnix + 4 * 3600, dateOnly: false } : null;
    case 'intercity_leg':   return startUnix ? { unix: startUnix + 2 * 3600, dateOnly: false } : null;
    default: return null;
  }
}

// ── STATUS mapping ────────────────────────────────────────────────────────────
function icalStatus(todoStatus) {
  switch (todoStatus) {
    case 'confirmed':  return 'CONFIRMED';
    case 'cancelled':  return 'CANCELLED';
    case 'contacted':  return 'TENTATIVE';
    default:           return 'TENTATIVE';
  }
}

// ── Build VEVENT lines for one todo ──────────────────────────────────────────
function buildVevent(todo, order, baseUrl) {
  const meta    = readMeta(todo.service_meta_json);
  const svc     = todo.service_type;
  const dt      = extractDatetime(svc, meta);
  if (!dt) return null; // no date → skip (no calendar entry without a time anchor)

  const dtEnd    = extractEndDatetime(svc, meta, dt.unix);
  const alarmDefs = ALARMS[svc] || ALARMS.default;

  // Build summary (title line)
  const ICONS = { accommodation:'🏨', meal:'🍽️', guide:'🧭', local_transport:'🚐', intercity_leg:'✈️' };
  const icon    = ICONS[svc] || '📋';
  const nameMap = { accommodation:'hotel_name', meal:'restaurant_name', guide:'guide_name', local_transport:'supplier', intercity_leg:'supplier' };
  const name    = (nameMap[svc] ? meta[nameMap[svc]] : null) || todo.title || (svc ? svc.replace(/_/g,' ') : 'Task');
  const stopLabel = todo.stop_label ? ` — ${todo.stop_label}` : '';
  const summary = `${icon} ${name}${stopLabel}`;

  // Build description
  const descParts = [];
  if (meta.address)       descParts.push(`📍 ${meta.address}`);
  if (todo.contact_phone) descParts.push(`📞 ${todo.contact_phone}`);
  if (meta.contact_name)  descParts.push(`👤 ${meta.contact_name}`);
  if (todo.contact_email) descParts.push(`✉️ ${todo.contact_email}`);
  if (todo.person_in_charge) descParts.push(`In charge: ${todo.person_in_charge}`);
  if (meta.notes)         descParts.push(`Notes: ${meta.notes}`);
  // Service-specific extras
  if (svc === 'accommodation' && meta.room_type) descParts.push(`Room: ${meta.room_type}`);
  if (svc === 'guide' && meta.languages)         descParts.push(`Languages: ${meta.languages}`);
  if (svc === 'local_transport' && meta.driver_name) descParts.push(`Driver: ${meta.driver_name}`);
  if (svc === 'intercity_leg'   && meta.ticket_ref)  descParts.push(`Ref: ${meta.ticket_ref}`);
  if (order?.id) descParts.push(`Order: ${order.id}`);
  const opsLink = baseUrl ? `${baseUrl}/ops.html?order=${order?.id || ''}` : '';
  if (opsLink) descParts.push(`Ops board: ${opsLink}`);
  const description = descParts.join('\\n');

  const uid = `${todo.id}@travelagent-ops`;
  const now = icalNow();

  const lines = [
    'BEGIN:VEVENT',
    fold(`UID:${uid}`),
    fold(`DTSTAMP:${now}`),
    fold(`LAST-MODIFIED:${now}`),
    fold(`SUMMARY:${icalEscape(summary)}`),
  ];

  // DTSTART / DTEND
  if (dt.dateOnly) {
    lines.push(fold(`DTSTART;VALUE=DATE:${unixToIcalDate(dt.unix)}`));
    lines.push(fold(`DTEND;VALUE=DATE:${dtEnd ? unixToIcalDate(dtEnd.unix) : unixToIcalDate(dt.unix + 86400)}`));
  } else {
    lines.push(fold(`DTSTART:${unixToIcal(dt.unix)}`));
    lines.push(fold(`DTEND:${dtEnd ? unixToIcal(dtEnd.unix) : unixToIcal(dt.unix + 3600)}`));
  }

  lines.push(fold(`STATUS:${icalStatus(todo.status)}`));
  if (meta.address) lines.push(fold(`LOCATION:${icalEscape(meta.address)}`));
  if (description)  lines.push(fold(`DESCRIPTION:${description}`));
  if (opsLink)      lines.push(fold(`URL:${opsLink}`));

  // VALARM blocks — one per reminder offset
  for (const alarm of alarmDefs) {
    lines.push('BEGIN:VALARM');
    lines.push('ACTION:DISPLAY');
    lines.push(fold(`TRIGGER:${alarm.trigger}`));
    lines.push(fold(`DESCRIPTION:${icalEscape(alarm.desc + (meta.address ? ' @ ' + meta.address : ''))}`));
    lines.push('END:VALARM');
  }

  lines.push('END:VEVENT');
  return lines.join('\r\n');
}

// ── Main feed handler ─────────────────────────────────────────────────────────
async function generateFeed(c, secret, orderId = null) {
  if (!secret || secret.length < 20) {
    return new Response('Not Found', { status: 404 });
  }

  // Resolve tenant from secret
  const tenant = await c.env.DB
    .prepare('SELECT id, name FROM tenants WHERE calendar_secret = ?')
    .bind(secret)
    .first();
  if (!tenant) return new Response('Not Found', { status: 404 });

  const tenantId = tenant.id;

  // Determine time window: past 7 days → future 365 days
  const now     = Math.floor(Date.now() / 1000);
  const past    = now - 7 * 86400;
  const future  = now + 365 * 86400;

  // Fetch todos with date data from service_meta_json
  // We JOIN booking_orders to get travel_date and stop labels
  let sql = `
    SELECT bot.*,
           ts.label    AS stop_label,
           ts.day_from AS stop_day_from,
           ts.day_to   AS stop_day_to,
           bo.travel_date AS order_travel_date,
           bo.id          AS booking_order_id
    FROM booking_order_todos bot
    LEFT JOIN tour_stops ts ON ts.id = bot.stop_id
    LEFT JOIN booking_orders bo ON bo.id = bot.order_id
    WHERE bot.tenant_id = ?
      AND bot.status != 'cancelled'
      AND bot.service_type IS NOT NULL
  `;
  const binds = [tenantId];

  if (orderId) {
    sql += ' AND bot.order_id = ?';
    binds.push(orderId);
  }
  sql += ' ORDER BY bot.sort_order, bot.created_at';

  const { results: todos } = await c.env.DB.prepare(sql).bind(...binds).all();

  // Detect the worker's own public base URL for deep links
  const reqUrl  = new URL(c.req.url);
  const baseUrl = `${reqUrl.protocol}//${reqUrl.host}`;

  // Build VCALENDAR
  const calName   = icalEscape(tenant.name ? `${tenant.name} — Ops` : 'TravelAgent Ops');
  const calId     = `travelagent-ops-${tenantId}@cal`;
  const eventLines = [];

  for (const todo of todos) {
    const meta = readMeta(todo.service_meta_json);
    const dt   = extractDatetime(todo.service_type, meta);
    // Only include todos that have a date in our window
    if (!dt) continue;
    if (dt.unix < past || dt.unix > future) continue;

    const order = { id: todo.booking_order_id, travel_date: todo.order_travel_date };
    const vevent = buildVevent(todo, order, baseUrl);
    if (vevent) eventLines.push(vevent);
  }

  const ical = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    fold(`PRODID:-//TravelAgent Ops//EN`),
    fold(`X-WR-CALNAME:${calName}`),
    fold(`X-WR-CALDESC:Operations calendar — service bookings and reminders`),
    'X-WR-TIMEZONE:UTC',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    // Refresh interval hint for calendar clients (every 30 min)
    'X-PUBLISHED-TTL:PT30M',
    fold(`X-WR-RELCALID:${calId}`),
    ...eventLines,
    'END:VCALENDAR',
  ].join('\r\n');

  return new Response(ical, {
    status: 200,
    headers: {
      'Content-Type':        'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="travelagent-ops.ics"`,
      // No-cache so calendar apps always get fresh data
      'Cache-Control':       'no-cache, no-store',
    },
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────
// Tenant-wide ops calendar
cal.get('/:secret{[a-f0-9]{20,}.ics}', async (c) => {
  const raw    = c.req.param('secret');           // e.g. "abc123...ics"
  const secret = raw.replace(/\.ics$/, '');
  return generateFeed(c, secret, null);
});

// Single-order ops calendar
cal.get('/:secret{[a-f0-9]{20,}}/:orderId.ics', async (c) => {
  const secret  = c.req.param('secret');
  const rawOid  = c.req.param('orderId');
  const orderId = rawOid.replace(/\.ics$/, '');
  return generateFeed(c, secret, orderId);
});

export default function registerCalendarRoutes(app) {
  app.route('/api/calendar', cal);
}
