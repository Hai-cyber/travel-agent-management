import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { nanoid } from 'nanoid';

const NPX_BIN = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const DB_NAME = 'travel_agent_db';

const args = new Set(process.argv.slice(2));
const useRemote = args.has('--remote');
const applyMode = args.has('--apply');
const targetTenant = [...args].find((arg) => arg.startsWith('--tenant='))?.split('=')[1] || '';

function runNpx(commandArgs) {
  const result = spawnSync(NPX_BIN, commandArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    shell: process.platform === 'win32',
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'Wrangler command failed').trim());
  }

  return result.stdout;
}

function runJsonQuery(sql) {
  const modeFlag = useRemote ? '--remote' : '--local';

  if (process.platform !== 'win32') {
    return runNpx([
      'wrangler', 'd1', 'execute', DB_NAME,
      modeFlag,
      '--config', './wrangler.jsonc',
      '--json',
      '--command',
      String(sql).trim(),
    ]);
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'tam-backfill-tenant-seed-json-'));
  const sqlFile = join(tempDir, 'statement.sql');
  writeFileSync(sqlFile, `${String(sql).trim()}\n`, 'utf8');

  try {
    const script = [
      `$sql = Get-Content -Raw -Path '${sqlFile.replaceAll("'", "''")}'`,
      `& '${NPX_BIN}' wrangler d1 execute ${DB_NAME} ${modeFlag} --config ./wrangler.jsonc --json --command $sql`,
    ].join('; ');
    const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      windowsHide: true,
    });

    if (result.status !== 0) {
      throw new Error((result.stderr || result.stdout || 'Wrangler command failed').trim());
    }

    return result.stdout;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function execute(sql, json = false) {
  const modeFlag = useRemote ? '--remote' : '--local';
  const tempDir = mkdtempSync(join(tmpdir(), 'tam-backfill-tenant-seed-'));
  const sqlFile = join(tempDir, 'statement.sql');
  writeFileSync(sqlFile, `${String(sql).trim()}\n`, 'utf8');

  try {
    return runNpx([
      'wrangler', 'd1', 'execute', DB_NAME,
      modeFlag,
      '--config', './wrangler.jsonc',
      '--file',
      sqlFile,
      ...(json ? ['--json'] : []),
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function executeJson(sql) {
  const raw = runJsonQuery(sql);
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Could not find JSON payload in Wrangler output:\n${raw}`);
  }
  const parsed = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(parsed) || !parsed[0]?.success) {
    throw new Error(`D1 execute failed for SQL: ${sql}`);
  }
  return parsed[0].results || [];
}

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function toSlug(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseDurationToNights(tour, content) {
  const raw = String(tour.duration_text || content.duration || '').trim();
  if (!raw) return 1;

  const nightsMatch = raw.match(/(\d+)\s*(night|nights|n)\b/i);
  if (nightsMatch) return Math.max(1, Number(nightsMatch[1]) || 1);

  const compactMatch = raw.match(/(\d+)\s*d\s*(\d+)\s*n/i);
  if (compactMatch) return Math.max(1, Number(compactMatch[2]) || 1);

  const daysMatch = raw.match(/(\d+)\s*(day|days|d)\b/i);
  if (daysMatch) return Math.max(1, (Number(daysMatch[1]) || 2) - 1);

  return 1;
}

function buildDefaultStopRows(tour) {
  const content = parseJson(tour.content_data, {});
  const itinerary = Array.isArray(content.itinerary) ? content.itinerary : [];
  if (itinerary.length) {
    return itinerary.map((entry, index) => ({
      label: String(entry.label || entry.title || entry.name || `Stop ${index + 1}`).trim() || `Stop ${index + 1}`,
      nights: Math.max(Number(entry.nights) || 1, 0),
      meal_breakfast: Number(Boolean(entry.meal_breakfast ?? entry.breakfast ?? 1)),
      meal_lunch: Number(Boolean(entry.meal_lunch ?? entry.lunch ?? 0)),
      meal_dinner: Number(Boolean(entry.meal_dinner ?? entry.dinner ?? 1)),
      description: String(entry.description || entry.body || '').trim(),
    }));
  }

  const destinationName = String(content.destination_name || content.destination_title || '').trim();
  const labelBase = destinationName || tour.title || 'Starter itinerary stop';
  return [{
    label: `${labelBase} arrival`,
    nights: parseDurationToNights(tour, content),
    meal_breakfast: 1,
    meal_lunch: 0,
    meal_dinner: 1,
    description: String(content.hero_desc || content.tour_desc || '').trim() || `Starter itinerary stop for ${tour.title || 'tour'}`,
  }];
}

function buildServicesConfig(stopIndex, stopCount, existingConfig = {}) {
  const base = parseJson(existingConfig, {});
  const local = Array.isArray(base.local) && base.local.length ? base.local : ['car7'];
  const intercity = Array.isArray(base.intercity) && base.intercity.length
    ? base.intercity
    : (stopIndex < stopCount - 1 ? ['car7'] : []);

  return {
    hotel: base.hotel ?? 1,
    guide: base.guide ?? 1,
    local,
    intercity,
    pub: {
      hotel: base.pub?.hotel ?? 1,
      guide: base.pub?.guide ?? 1,
      local: base.pub?.local ?? 1,
      intercity: base.pub?.intercity ?? 1,
    },
  };
}

function buildPricingSeed(tour) {
  const content = parseJson(tour.content_data, {});
  const basePrice = Number(content.base_price) || 980;
  return {
    shared: Math.max(Math.round(basePrice), 250),
    single: Math.max(Math.round(basePrice * 1.25), 350),
    child: Math.max(Math.round(basePrice * 0.5), 150),
  };
}

function buildServiceInserts({ tenantId, tourTitle, stop, stopIndex, stopCount, createdAt }) {
  const stopId = stop.id;
  const stopLabel = String(stop.label || tourTitle || `Stop ${stopIndex + 1}`).trim();
  const location = stopLabel.replace(/\s+arrival$/i, '').trim() || tourTitle || 'Vietnam';
  const inserts = [];

  inserts.push(`INSERT INTO stop_accommodations (id, tenant_id, tour_stop_id, person_in_charge, hotel_name, contact_name, contact_phone, contact_email, address, check_in, check_out, room_type, guests, notes, stage, status, position, created_at)
VALUES (${sqlString(nanoid())}, ${sqlString(tenantId)}, ${sqlString(stopId)}, 'Operations Desk', ${sqlString(`${location} Starter Hotel`)}, 'Supplier Desk', '+84000000000', 'ops@travelagent.local', ${sqlString(`${location}, Vietnam`)}, ${createdAt + stopIndex * 86400}, ${createdAt + (stopIndex + Math.max(stop.nights || 1, 1)) * 86400}, 'Deluxe', 2, ${sqlString(`Backfilled accommodation service for ${stopLabel}`)}, 'pending', 'planned', ${stopIndex}, ${createdAt});`);

  inserts.push(`INSERT INTO stop_guides (id, tenant_id, tour_stop_id, person_in_charge, guide_name, contact_name, phone, email, address, languages, time_from, time_to, notes, stage, status, position, created_at)
VALUES (${sqlString(nanoid())}, ${sqlString(tenantId)}, ${sqlString(stopId)}, 'Guide Coordinator', ${sqlString(`${location} Local Guide`)}, 'Guide Desk', '+84000000001', 'guide@travelagent.local', ${sqlString(`${location}, Vietnam`)}, 'English, Vietnamese', ${createdAt + stopIndex * 86400 + 9 * 3600}, ${createdAt + stopIndex * 86400 + 17 * 3600}, ${sqlString(`Backfilled guide service for ${stopLabel}`)}, 'pending', 'planned', ${stopIndex}, ${createdAt});`);

  inserts.push(`INSERT INTO stop_local_transports (id, tenant_id, tour_stop_id, person_in_charge, mode, supplier, contact_name, driver_name, phone, email, address, pickup_time, pickup_place, dropoff_place, notes, stage, status, position, created_at)
VALUES (${sqlString(nanoid())}, ${sqlString(tenantId)}, ${sqlString(stopId)}, 'Transport Desk', 'car7', ${sqlString(`${location} Local Transport`)}, 'Dispatch Team', ${sqlString(`${location} Driver`)}, '+84000000002', 'transport@travelagent.local', ${sqlString(`${location}, Vietnam`)}, ${createdAt + stopIndex * 86400 + 8 * 3600}, ${sqlString(`${location} center`)}, ${sqlString(`${location} hotel`)}, ${sqlString(`Backfilled local transport for ${stopLabel}`)}, 'pending', 'planned', ${stopIndex}, ${createdAt});`);

  if (stop.meal_breakfast) {
    inserts.push(`INSERT INTO stop_meals (id, tenant_id, tour_stop_id, person_in_charge, meal_type, restaurant_name, contact_name, contact_phone, contact_email, address, meal_datetime, notes, stage, status, position, created_at)
VALUES (${sqlString(nanoid())}, ${sqlString(tenantId)}, ${sqlString(stopId)}, 'Operations Desk', 'breakfast', ${sqlString(`${location} Breakfast Host`)}, 'Supplier Desk', '+84000000010', 'meal@travelagent.local', ${sqlString(`${location}, Vietnam`)}, ${createdAt + stopIndex * 86400 + 7 * 3600}, ${sqlString(`Backfilled breakfast service for ${stopLabel}`)}, 'pending', 'planned', 0, ${createdAt});`);
  }
  if (stop.meal_lunch) {
    inserts.push(`INSERT INTO stop_meals (id, tenant_id, tour_stop_id, person_in_charge, meal_type, restaurant_name, contact_name, contact_phone, contact_email, address, meal_datetime, notes, stage, status, position, created_at)
VALUES (${sqlString(nanoid())}, ${sqlString(tenantId)}, ${sqlString(stopId)}, 'Operations Desk', 'lunch', ${sqlString(`${location} Lunch Partner`)}, 'Supplier Desk', '+84000000011', 'meal@travelagent.local', ${sqlString(`${location}, Vietnam`)}, ${createdAt + stopIndex * 86400 + 12 * 3600}, ${sqlString(`Backfilled lunch service for ${stopLabel}`)}, 'pending', 'planned', 1, ${createdAt});`);
  }
  if (stop.meal_dinner) {
    inserts.push(`INSERT INTO stop_meals (id, tenant_id, tour_stop_id, person_in_charge, meal_type, restaurant_name, contact_name, contact_phone, contact_email, address, meal_datetime, notes, stage, status, position, created_at)
VALUES (${sqlString(nanoid())}, ${sqlString(tenantId)}, ${sqlString(stopId)}, 'Operations Desk', 'dinner', ${sqlString(`${location} Dinner Partner`)}, 'Supplier Desk', '+84000000012', 'meal@travelagent.local', ${sqlString(`${location}, Vietnam`)}, ${createdAt + stopIndex * 86400 + 18 * 3600}, ${sqlString(`Backfilled dinner service for ${stopLabel}`)}, 'pending', 'planned', 2, ${createdAt});`);
  }
  if (stopIndex < stopCount - 1) {
    inserts.push(`INSERT INTO stop_intercity_legs (id, tenant_id, tour_stop_id, person_in_charge, mode, supplier, contact_name, phone, email, address, depart_time, depart_point, arrive_point, ticket_ref, notes, stage, status, position, created_at)
VALUES (${sqlString(nanoid())}, ${sqlString(tenantId)}, ${sqlString(stopId)}, 'Transport Desk', 'car7', ${sqlString(`${location} Intercity Transfer`)}, 'Dispatch Team', '+84000000003', 'intercity@travelagent.local', ${sqlString(`${location}, Vietnam`)}, ${createdAt + stopIndex * 86400 + 18 * 3600}, ${sqlString(`${location} departure point`)}, 'Next itinerary stop', ${sqlString(`BF-${String(stopIndex + 1).padStart(2, '0')}`)}, ${sqlString(`Backfilled intercity transfer after ${stopLabel}`)}, 'pending', 'planned', ${stopIndex}, ${createdAt});`);
  }

  return inserts;
}

function buildPricingContextSql(tenantId, now) {
  const seasonId = `starter-season-${tenantId}`.slice(0, 120);
  const segmentId = `starter-segment-${tenantId}`.slice(0, 120);
  const pax2Id = `starter-pax-2-${tenantId}`.slice(0, 120);
  const pax4Id = `starter-pax-4-${tenantId}`.slice(0, 120);
  return {
    seasonId,
    segmentId,
    paxIds: [pax2Id, pax4Id],
    sql: [
      `INSERT OR IGNORE INTO tenant_seasons (id, tenant_id, name, start_month, start_day, end_month, end_day, sort_order, is_active, notes, created_at) VALUES (${sqlString(seasonId)}, ${sqlString(tenantId)}, 'Year Round', 1, 1, 12, 31, 0, 1, 'Backfilled default season', ${now});`,
      `INSERT OR IGNORE INTO pricing_segments (id, tenant_id, code, name, description, sort_order, is_active, created_at) VALUES (${sqlString(segmentId)}, ${sqlString(tenantId)}, 'fit', 'FIT', 'Backfilled default independent traveler segment', 0, 1, ${now});`,
      `INSERT OR IGNORE INTO pax_bands (id, tenant_id, name, min_pax, max_pax, sort_order, is_active, created_at) VALUES (${sqlString(pax2Id)}, ${sqlString(tenantId)}, '2-4 Guests', 2, 4, 0, 1, ${now});`,
      `INSERT OR IGNORE INTO pax_bands (id, tenant_id, name, min_pax, max_pax, sort_order, is_active, created_at) VALUES (${sqlString(pax4Id)}, ${sqlString(tenantId)}, '5-8 Guests', 5, 8, 1, 1, ${now});`,
    ],
  };
}

const tours = executeJson(`
SELECT
  t.tenant_id,
  tn.name AS tenant_name,
  t.id,
  t.title,
  t.duration_text,
  t.content_data,
  (SELECT COUNT(*) FROM tour_stops ts WHERE ts.tenant_id = t.tenant_id AND ts.tour_id = t.id) AS stop_count,
  (SELECT COUNT(*) FROM tour_prices tp WHERE tp.tenant_id = t.tenant_id AND tp.tour_id = t.id) AS price_count,
  (
    (SELECT COUNT(*) FROM stop_accommodations sa WHERE sa.tenant_id = t.tenant_id AND sa.tour_stop_id IN (SELECT id FROM tour_stops WHERE tenant_id = t.tenant_id AND tour_id = t.id)) +
    (SELECT COUNT(*) FROM stop_meals sm WHERE sm.tenant_id = t.tenant_id AND sm.tour_stop_id IN (SELECT id FROM tour_stops WHERE tenant_id = t.tenant_id AND tour_id = t.id)) +
    (SELECT COUNT(*) FROM stop_guides sg WHERE sg.tenant_id = t.tenant_id AND sg.tour_stop_id IN (SELECT id FROM tour_stops WHERE tenant_id = t.tenant_id AND tour_id = t.id)) +
    (SELECT COUNT(*) FROM stop_local_transports sl WHERE sl.tenant_id = t.tenant_id AND sl.tour_stop_id IN (SELECT id FROM tour_stops WHERE tenant_id = t.tenant_id AND tour_id = t.id)) +
    (SELECT COUNT(*) FROM stop_intercity_legs si WHERE si.tenant_id = t.tenant_id AND si.tour_stop_id IN (SELECT id FROM tour_stops WHERE tenant_id = t.tenant_id AND tour_id = t.id))
  ) AS service_count
FROM tours t
JOIN tenants tn ON tn.id = t.tenant_id
WHERE (${sqlString(targetTenant)} = '' OR t.tenant_id = ${sqlString(targetTenant)})
  AND (
    (SELECT COUNT(*) FROM tour_stops ts WHERE ts.tenant_id = t.tenant_id AND ts.tour_id = t.id) = 0
    OR (SELECT COUNT(*) FROM tour_prices tp WHERE tp.tenant_id = t.tenant_id AND tp.tour_id = t.id) = 0
    OR (
      (SELECT COUNT(*) FROM tour_stops ts WHERE ts.tenant_id = t.tenant_id AND ts.tour_id = t.id) > 0
      AND (
        (SELECT COUNT(*) FROM stop_accommodations sa WHERE sa.tenant_id = t.tenant_id AND sa.tour_stop_id IN (SELECT id FROM tour_stops WHERE tenant_id = t.tenant_id AND tour_id = t.id)) +
        (SELECT COUNT(*) FROM stop_meals sm WHERE sm.tenant_id = t.tenant_id AND sm.tour_stop_id IN (SELECT id FROM tour_stops WHERE tenant_id = t.tenant_id AND tour_id = t.id)) +
        (SELECT COUNT(*) FROM stop_guides sg WHERE sg.tenant_id = t.tenant_id AND sg.tour_stop_id IN (SELECT id FROM tour_stops WHERE tenant_id = t.tenant_id AND tour_id = t.id)) +
        (SELECT COUNT(*) FROM stop_local_transports sl WHERE sl.tenant_id = t.tenant_id AND sl.tour_stop_id IN (SELECT id FROM tour_stops WHERE tenant_id = t.tenant_id AND tour_id = t.id)) +
        (SELECT COUNT(*) FROM stop_intercity_legs si WHERE si.tenant_id = t.tenant_id AND si.tour_stop_id IN (SELECT id FROM tour_stops WHERE tenant_id = t.tenant_id AND tour_id = t.id))
      ) = 0
    )
  )
ORDER BY t.tenant_id, t.title;
`);

const summary = [];

for (const tour of tours) {
  const now = Math.floor(Date.now() / 1000);
  const sqlStatements = [];
  const pricingContext = buildPricingContextSql(tour.tenant_id, now);

  if (Number(tour.price_count || 0) === 0) {
    sqlStatements.push(...pricingContext.sql);
  }

  let stopRows = executeJson(`SELECT id, label, nights, meal_breakfast, meal_lunch, meal_dinner, description, services_config, sort_order FROM tour_stops WHERE tenant_id = ${sqlString(tour.tenant_id)} AND tour_id = ${sqlString(tour.id)} ORDER BY sort_order ASC, created_at ASC;`);

  if (!stopRows.length) {
    const defaults = buildDefaultStopRows(tour);
    let dayCursor = 1;
    defaults.forEach((draftStop, index) => {
      const stopId = nanoid();
      const nights = Math.max(Number(draftStop.nights) || 0, 0);
      const dayFrom = dayCursor;
      const dayTo = nights > 0 ? dayCursor + nights - 1 : dayCursor;
      dayCursor = dayTo + 1;
      const servicesConfig = buildServicesConfig(index, defaults.length);
      sqlStatements.push(`INSERT INTO tour_stops (id, tenant_id, tour_id, destination_id, label, day_from, day_to, nights, meal_breakfast, meal_lunch, meal_dinner, description, services_config, sort_order, created_at)
VALUES (${sqlString(stopId)}, ${sqlString(tour.tenant_id)}, ${sqlString(tour.id)}, NULL, ${sqlString(draftStop.label)}, ${dayFrom}, ${dayTo}, ${nights}, ${Number(draftStop.meal_breakfast || 0)}, ${Number(draftStop.meal_lunch || 0)}, ${Number(draftStop.meal_dinner || 0)}, ${sqlString(draftStop.description || '')}, ${sqlString(JSON.stringify(servicesConfig))}, ${index}, ${now + index});`);
      stopRows.push({
        id: stopId,
        label: draftStop.label,
        nights,
        meal_breakfast: Number(draftStop.meal_breakfast || 0),
        meal_lunch: Number(draftStop.meal_lunch || 0),
        meal_dinner: Number(draftStop.meal_dinner || 0),
        description: draftStop.description || '',
        services_config: JSON.stringify(servicesConfig),
        sort_order: index,
      });
    });
  }

  stopRows.forEach((stop, index) => {
    const nextConfig = buildServicesConfig(index, stopRows.length, stop.services_config);
    const currentConfig = JSON.stringify(parseJson(stop.services_config, {}));
    const nextConfigText = JSON.stringify(nextConfig);
    if (currentConfig !== nextConfigText) {
      sqlStatements.push(`UPDATE tour_stops SET services_config = ${sqlString(nextConfigText)} WHERE id = ${sqlString(stop.id)} AND tenant_id = ${sqlString(tour.tenant_id)};`);
      stop.services_config = nextConfigText;
    }
  });

  const serviceCounts = executeJson(`
SELECT
  ts.id,
  COUNT(DISTINCT sa.id) AS accommodations,
  COUNT(DISTINCT sm.id) AS meals,
  COUNT(DISTINCT sg.id) AS guides,
  COUNT(DISTINCT sl.id) AS local_transports,
  COUNT(DISTINCT si.id) AS intercity_legs
FROM tour_stops ts
LEFT JOIN stop_accommodations sa ON sa.tour_stop_id = ts.id AND sa.tenant_id = ts.tenant_id
LEFT JOIN stop_meals sm ON sm.tour_stop_id = ts.id AND sm.tenant_id = ts.tenant_id
LEFT JOIN stop_guides sg ON sg.tour_stop_id = ts.id AND sg.tenant_id = ts.tenant_id
LEFT JOIN stop_local_transports sl ON sl.tour_stop_id = ts.id AND sl.tenant_id = ts.tenant_id
LEFT JOIN stop_intercity_legs si ON si.tour_stop_id = ts.id AND si.tenant_id = ts.tenant_id
WHERE ts.tenant_id = ${sqlString(tour.tenant_id)} AND ts.tour_id = ${sqlString(tour.id)}
GROUP BY ts.id;
`);
  const byStop = new Map(serviceCounts.map((row) => [String(row.id), row]));

  stopRows.forEach((stop, index) => {
    const counts = byStop.get(String(stop.id)) || {};
    const hasAnyService = Number(counts.accommodations || 0) + Number(counts.meals || 0) + Number(counts.guides || 0) + Number(counts.local_transports || 0) + Number(counts.intercity_legs || 0) > 0;
    if (!hasAnyService) {
      sqlStatements.push(...buildServiceInserts({
        tenantId: tour.tenant_id,
        tourTitle: tour.title,
        stop,
        stopIndex: index,
        stopCount: stopRows.length,
        createdAt: now + index,
      }));
    }
  });

  if (Number(tour.price_count || 0) === 0) {
    const priceSeed = buildPricingSeed(tour);
    sqlStatements.push(`INSERT INTO tour_prices (id, tenant_id, tour_id, season_id, segment_id, pax_band_id, base_currency, adult_shared_room_price, adult_single_room_price, child_shared_with_parents_price, notes, is_active, created_at)
VALUES (${sqlString(nanoid())}, ${sqlString(tour.tenant_id)}, ${sqlString(tour.id)}, ${sqlString(pricingContext.seasonId)}, ${sqlString(pricingContext.segmentId)}, ${sqlString(pricingContext.paxIds[0])}, 'USD', ${priceSeed.shared}, ${priceSeed.single}, ${priceSeed.child}, ${sqlString(`Backfilled starter pricing for ${tour.title}`)}, 1, ${now});`);
  }

  const planned = {
    tenant_id: tour.tenant_id,
    tenant_name: tour.tenant_name,
    tour_id: tour.id,
    title: tour.title,
    added_stops: Number(tour.stop_count || 0) === 0 ? stopRows.length : 0,
    added_prices: Number(tour.price_count || 0) === 0 ? 1 : 0,
    added_services: sqlStatements.filter((sql) => /INSERT INTO stop_/.test(sql)).length,
    updated_services_config: sqlStatements.filter((sql) => /UPDATE tour_stops SET services_config/.test(sql)).length,
    statements: sqlStatements.length,
  };
  summary.push(planned);

  if (applyMode && sqlStatements.length) {
    execute(`BEGIN;\n${sqlStatements.join('\n')}\nCOMMIT;`);
  }
}

const result = {
  ok: true,
  mode: useRemote ? 'remote' : 'local',
  applied: applyMode,
  target_tenant: targetTenant || null,
  tours_considered: tours.length,
  affected_tours: summary.filter((item) => item.statements > 0).length,
  added_stops: summary.reduce((sum, item) => sum + item.added_stops, 0),
  added_prices: summary.reduce((sum, item) => sum + item.added_prices, 0),
  added_services: summary.reduce((sum, item) => sum + item.added_services, 0),
  updated_services_config: summary.reduce((sum, item) => sum + item.updated_services_config, 0),
  details: summary,
};

console.log(JSON.stringify(result, null, 2));