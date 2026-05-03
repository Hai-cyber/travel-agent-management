import { spawnSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import crypto from 'node:crypto';
import { buildTenantModerationPayload, moderateTenantContent } from '../src/lib/aiModeration.js';

const NPX_BIN = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const NODE_BIN = process.platform === 'win32' ? 'node.exe' : 'node';
const POWERSHELL_BIN = 'powershell.exe';
const DB_NAME = 'travel_agent_db';
const TENANT_ID = 'ten-demo-001';
const SPAWN_PORT = 8790;
const DEFAULT_PRICING_SMOKE_DATE = '2026-10-10';
const PRICING_SMOKE_EXPECTED_TOTAL = 1360;
const PRICING_OVERLAP_SMOKE_DATE = '2026-05-20';
const FETCH_RETRY_DELAYS_MS = [250, 750, 1500, 3000, 5000];

let failures = 0;

function pass(message) {
  console.log(`PASS ${message}`);
}

function fail(message) {
  failures += 1;
  console.error(`FAIL ${message}`);
}

function info(message) {
  console.log(`INFO ${message}`);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runFile(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    ...options,
  });

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `Command failed: ${command} ${args.join(' ')}`).trim());
  }

  return result.stdout;
}

function runNpx(args, options = {}) {
  if (process.platform === 'win32') {
    return runFile(POWERSHELL_BIN, ['-NoProfile', '-Command', `& ${quotePowerShell(NPX_BIN)} ${args.map(quotePowerShell).join(' ')}`], options);
  }

  return runFile(NPX_BIN, args, options);
}

function runNode(args, options = {}) {
  return runFile(NODE_BIN, args, options);
}

function runD1Json(sql) {
  const normalizedSql = String(sql).replace(/\s+/g, ' ').trim();
  const raw = runNpx([
    'wrangler', 'd1', 'execute', DB_NAME,
    '--local',
    `--command="${normalizedSql.replaceAll('"', '\\"')}"`,
    '--json',
  ]);

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed[0]?.success) {
    throw new Error(`D1 execute failed for SQL: ${sql}`);
  }
  return parsed[0].results || [];
}

async function isServerReady(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/api/tenant/config`, {
      headers: {
        'X-Tenant-ID': TENANT_ID,
      },
    });
    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  }
}

async function waitForServer(baseUrl, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isServerReady(baseUrl)) return true;
    await delay(500);
  }
  return false;
}

async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function resolveSmokePort(startPort = SPAWN_PORT, maxOffset = 10) {
  for (let offset = 0; offset <= maxOffset; offset += 1) {
    const port = startPort + offset;
    if (await isPortAvailable(port)) return port;
  }
  return null;
}

async function resolveBaseUrl() {
  if (process.env.SMOKE_BASE_URL) {
    return { baseUrl: process.env.SMOKE_BASE_URL, server: null, reused: true };
  }

  const spawnPort = await resolveSmokePort();
  if (!spawnPort) {
    throw new Error(`No available local smoke port found in range ${SPAWN_PORT}-${SPAWN_PORT + 10}.`);
  }

  const baseUrl = `http://127.0.0.1:${spawnPort}`;
  if (spawnPort !== SPAWN_PORT) {
    info(`Default smoke port ${SPAWN_PORT} is busy, using ${spawnPort} instead`);
  }
  info(`No running local Worker detected, starting Wrangler dev on ${baseUrl}`);

  const child = process.platform === 'win32'
    ? spawn(POWERSHELL_BIN, ['-NoProfile', '-Command', `& ${quotePowerShell(NPX_BIN)} 'wrangler' 'dev' '--local' '--config' './wrangler.jsonc' '--port' '${String(spawnPort)}'`], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    : spawn(NPX_BIN, ['wrangler', 'dev', '--local', '--config', './wrangler.jsonc', '--port', String(spawnPort)], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

  let resolveReadyFromLogs;
  const readyFromLogs = new Promise((resolve) => {
    resolveReadyFromLogs = resolve;
  });
  const emitChildOutput = (chunk, writer) => {
    const text = String(chunk);
    writer(text);
    if (text.includes('Ready on ') || text.includes(`Ready on ${baseUrl}`)) {
      resolveReadyFromLogs(true);
    }
  };

  child.stdout.on('data', (chunk) => emitChildOutput(chunk, (text) => process.stdout.write(text)));
  child.stderr.on('data', (chunk) => emitChildOutput(chunk, (text) => process.stderr.write(text)));

  const ready = await Promise.race([
    waitForServer(baseUrl, 120000),
    readyFromLogs,
  ]);
  if (!ready) {
    child.kill();
    throw new Error(`Wrangler dev did not become ready on ${baseUrl}`);
  }

  return { baseUrl, server: child, reused: false };
}

function ensureTenantFixtures() {
  info('Reconciling and applying local migrations');
  runNode(['./scripts/apply-local-migrations.mjs']);

  info('Refreshing local pricing seed data');
  runNpx(['wrangler', 'd1', 'execute', DB_NAME, '--local', '--file', 'db/seed_test.sql']);

  info(`Ensuring ${TENANT_ID} is ACTIVE and booking-compliant for smoke`);
  runD1Json(
    `UPDATE tenants
        SET subscription_status = 'ACTIVE',
            terms_accepted = 1,
            terms_accepted_at = ${Math.floor(Date.now() / 1000)},
            subdomain = NULL,
            custom_domain = NULL,
            custom_domain_verified_at = NULL,
            trust_status = 'PREVIEW_ONLY',
            trust_reasons_json = NULL,
            trust_reviewed_at = NULL,
            trust_reviewed_by = NULL,
            public_indexing_enabled = 0,
            payment_methods = json_array(
              json_object(
                'id', 'BANK_TRANSFER',
                'label', 'Chuyen khoan ngan hang',
                'enabled', json('true'),
                'category', 'manual'
              ),
              json_object(
                'id', 'STRIPE',
                'label', 'Stripe',
                'enabled', json('true'),
                'category', 'instant',
                'requires_key', json('true')
              )
            )
      WHERE id = '${TENANT_ID}';`
  );
}

async function runSubdomainPolicySmoke(baseUrl, token) {
  info('Running subdomain policy smoke flow');
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-ID': TENANT_ID,
  };

  const shortLabel = await requestJson(`${baseUrl}/api/tenants/settings`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ subdomain: 'ab' }),
  });

  if (shortLabel.response.status !== 400 || !Array.isArray(shortLabel.body?.details) || !shortLabel.body.details.some((entry) => String(entry).includes('3 đến 63'))) {
    fail(`Subdomain smoke expected 400 for short label, received ${shortLabel.response.status}: ${shortLabel.text}`);
    return;
  }
  pass('Rejected too-short subdomain labels before persistence');

  const reservedLabel = await requestJson(`${baseUrl}/api/tenants/settings`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ subdomain: 'app' }),
  });

  if (reservedLabel.response.status !== 409 || reservedLabel.body?.code !== 'reserved' || reservedLabel.body?.review_required !== false) {
    fail(`Subdomain smoke expected reserved-label rejection, received ${reservedLabel.response.status}: ${reservedLabel.text}`);
    return;
  }
  pass('Rejected reserved platform subdomain labels with policy metadata');

  const phishingLabel = await requestJson(`${baseUrl}/api/tenants/settings`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ subdomain: 'verify-paypal' }),
  });

  const phishingSummaries = Array.isArray(phishingLabel.body?.review?.summaries)
    ? phishingLabel.body.review.summaries
    : [];
  if (
    phishingLabel.response.status !== 409
    || phishingLabel.body?.code !== 'manual_review'
    || phishingLabel.body?.review_required !== true
    || !phishingSummaries.some((entry) => String(entry).includes('phishing-sensitive keyword'))
    || !phishingSummaries.some((entry) => String(entry).includes('paypal'))
  ) {
    fail(`Subdomain smoke expected phishing-style label to require manual review, received ${phishingLabel.response.status}: ${phishingLabel.text}`);
    return;
  }
  pass('Flagged phishing-style finance subdomains for manual review');

  const entropyLabel = await requestJson(`${baseUrl}/api/tenants/settings`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ subdomain: 'x9k2m7q4p1' }),
  });

  const entropySummaries = Array.isArray(entropyLabel.body?.review?.summaries)
    ? entropyLabel.body.review.summaries
    : [];
  if (
    entropyLabel.response.status !== 409
    || entropyLabel.body?.code !== 'manual_review'
    || entropyLabel.body?.review_required !== true
    || !entropySummaries.some((entry) => String(entry).includes('randomly generated'))
  ) {
    fail(`Subdomain smoke expected random-looking label to require manual review, received ${entropyLabel.response.status}: ${entropyLabel.text}`);
    return;
  }
  pass('Flagged high-entropy subdomains for manual review');

  const cleanLabel = 'sunset-smoke-lagoon';
  const probationLabel = await requestJson(`${baseUrl}/api/tenants/settings`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ subdomain: cleanLabel }),
  });

  if (!probationLabel.response.ok || !probationLabel.body?.ok || probationLabel.body?.settings?.subdomain !== cleanLabel || probationLabel.body?.trust_state?.status !== 'PROBATION') {
    fail(`Subdomain smoke expected clean label to promote tenant to PROBATION, received ${probationLabel.response.status}: ${probationLabel.text}`);
    return;
  }
  pass('Clean subdomain claim auto-promoted tenant into probation mode');

  const customDomain = await requestJson(`${baseUrl}/api/tenants/settings`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ custom_domain: 'travel-smoke.example.com' }),
  });

  if (customDomain.response.status !== 409 || customDomain.body?.code !== 'CUSTOM_DOMAIN_TRUST_REQUIRED') {
    fail(`Subdomain smoke expected custom-domain trust gate, received ${customDomain.response.status}: ${customDomain.text}`);
    return;
  }
  pass('Blocked custom-domain binding until tenant becomes trusted');

  const settings = await requestJson(`${baseUrl}/api/tenants/settings`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Tenant-ID': TENANT_ID,
    },
  });

  if (!settings.response.ok || !settings.body?.ok) {
    fail(`Subdomain smoke could not reload tenant settings: ${settings.text}`);
    return;
  }

  if (settings.body?.settings?.subdomain !== cleanLabel || settings.body?.trust_state?.status !== 'PROBATION') {
    fail(`Subdomain smoke expected clean subdomain + probation trust state to persist, received ${settings.text}`);
    return;
  }
  if (settings.body?.settings?.custom_domain !== null) {
    fail(`Subdomain smoke expected blocked custom-domain attempt to leave custom_domain unset, received ${settings.body?.settings?.custom_domain}`);
    return;
  }
  pass('Verified rejected suspicious or gated domain attempts did not corrupt tenant settings');
}

async function runAiModerationFallbackSmoke() {
  info('Running Cloudflare AI moderation fallback smoke flow');
  const payload = buildTenantModerationPayload({
    tenant: {
      id: TENANT_ID,
      name: 'Smoke Travel',
      subdomain: 'smoke-travel',
      trust_status: 'PROBATION',
    },
    siteConfig: {
      brand: { name: 'Smoke Travel' },
      content: { hero_title: 'Private journeys', hero_desc: 'Tailored tours across Vietnam.' },
      custom_sections: [{ id: 'hero', html: '<section><h1>Private journeys</h1><p>Tailored tours across Vietnam.</p></section>' }],
    },
    stage: 'smoke',
  });

  const result = await moderateTenantContent({}, payload, { stage: 'smoke' });
  if (!result.skipped || !String(result.reason || '').includes('Cloudflare AI binding or REST credentials')) {
    fail(`Cloudflare AI fallback smoke expected skipped/unconfigured result, received ${JSON.stringify(result)}`);
    return;
  }
  pass('Cloudflare AI moderation degrades cleanly when no binding or REST credentials are configured');
}

async function runAssetModerationSmoke(baseUrl, token) {
  info('Running asset moderation smoke flow');

  const safeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" fill="#0f4c81"/><text x="10" y="36" font-size="12" fill="#ffffff">Travel</text></svg>`;
  const safeForm = new FormData();
  safeForm.append('file', new File([safeSvg], 'travel-safe.svg', { type: 'image/svg+xml' }));

  const safeUpload = await requestJson(`${baseUrl}/api/tenant/assets/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Tenant-ID': TENANT_ID,
    },
    body: safeForm,
  });

  if (safeUpload.response.status !== 201 || !safeUpload.body?.ok || safeUpload.body?.visibility !== 'PUBLIC') {
    fail(`Asset smoke expected safe svg upload to succeed publicly, received ${safeUpload.response.status}: ${safeUpload.text}`);
    return;
  }
  pass('Allowed safe SVG upload and kept it publicly serveable');

  const safeAsset = await requestJson(`${baseUrl}${safeUpload.body.url}`);
  if (!safeAsset.response.ok || !String(safeAsset.response.headers.get('content-type') || '').includes('image/svg+xml')) {
    fail(`Asset smoke expected safe svg to be publicly served, received ${safeAsset.response.status}: ${safeAsset.text}`);
    return;
  }
  pass('Served safe uploaded asset successfully');

  const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert('x')</script><text>Verify your account</text></svg>`;
  const maliciousForm = new FormData();
  maliciousForm.append('file', new File([maliciousSvg], 'verify-account.svg', { type: 'image/svg+xml' }));

  const maliciousUpload = await requestJson(`${baseUrl}/api/tenant/assets/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Tenant-ID': TENANT_ID,
    },
    body: maliciousForm,
  });

  if (maliciousUpload.response.status !== 403 || maliciousUpload.body?.code !== 'ASSET_BLOCKED') {
    fail(`Asset smoke expected malicious svg to be blocked, received ${maliciousUpload.response.status}: ${maliciousUpload.text}`);
    return;
  }
  pass('Blocked active-content SVG asset uploads');
}

function resolvePricingSmokeDate() {
  const season = runD1Json(
    `SELECT start_month, start_day
       FROM tenant_seasons
      WHERE tenant_id = '${TENANT_ID}'
        AND id = 'season-high'
      LIMIT 1;`
  )[0];

  if (!season) {
    return DEFAULT_PRICING_SMOKE_DATE;
  }

  return `2026-${pad2(season.start_month)}-${pad2(season.start_day)}`;
}

function mintBearerToken() {
  const membershipRows = runD1Json(
    `SELECT user_id
       FROM memberships
      WHERE tenant_id = '${TENANT_ID}'
      ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, user_id ASC
      LIMIT 1;`
  );

  if (!membershipRows.length) {
    throw new Error(`No user membership found for tenant ${TENANT_ID}`);
  }

  const userId = membershipRows[0].user_id;
  const userRows = runD1Json(`SELECT id, email FROM users WHERE id = '${userId}' LIMIT 1;`);

  if (!userRows.length) {
    throw new Error(`Membership user ${userId} was not found in users table`);
  }

  const token = `smoke-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 86400;
  const sessionId = `sess-${crypto.randomBytes(8).toString('hex')}`;

  runD1Json(
    `INSERT INTO auth_sessions (id, user_id, tenant_id, token_hash, created_at, expires_at, last_seen_at)
     VALUES ('${sessionId}', '${userId}', '${TENANT_ID}', '${tokenHash}', ${now}, ${expiresAt}, ${now});`
  );

  return token;
}

function getPrimaryUserEmail() {
  const rows = runD1Json(
    `SELECT u.email
       FROM memberships m
       JOIN users u
         ON u.id = m.user_id
      WHERE m.tenant_id = '${TENANT_ID}'
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, u.email ASC
      LIMIT 1;`
  );

  const email = rows[0]?.email;
  if (!email) {
    throw new Error(`No user email found for tenant ${TENANT_ID}`);
  }

  return email;
}

function getLocalAdminSecret() {
  try {
    const raw = readFileSync('.dev.vars', 'utf8');
    const match = raw.match(/^ADMIN_SECRET=(.+)$/m);
    if (match?.[1]) return match[1].trim();
  } catch {
    // fall through
  }
  throw new Error('ADMIN_SECRET was not found in .dev.vars for local smoke.');
}

async function requestJson(url, options = {}) {
  let response;
  let lastError = null;

  for (let attempt = 0; attempt <= FETCH_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      response = await fetch(url, options);
      break;
    } catch (error) {
      lastError = error;
      if (attempt === FETCH_RETRY_DELAYS_MS.length) {
        throw new Error(`Fetch failed for ${url}: ${error.message}`);
      }
      await delay(FETCH_RETRY_DELAYS_MS[attempt]);
    }
  }

  if (!response) {
    throw new Error(`Fetch failed for ${url}: ${lastError?.message || 'unknown network error'}`);
  }

  const text = await response.text();
  let body = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  return { response, body, text };
}

async function runTenantRouteBootSmoke(baseUrl) {
  info('Running tenant route boot smoke flow');

  const publicConfig = await requestJson(`${baseUrl}/api/tenant/config`, {
    headers: {
      'X-Tenant-ID': TENANT_ID,
    },
  });

  if (!publicConfig.response.ok || !publicConfig.body?.ok) {
    fail(`Tenant boot smoke public config failed: ${publicConfig.text}`);
    return;
  }
  pass('Verified /api/tenant/config route is mounted after Worker boot');

  const protectedSettings = await requestJson(`${baseUrl}/api/tenants/settings`, {
    headers: {
      'X-Tenant-ID': TENANT_ID,
      Cookie: 'ta_session=invalid',
    },
  });

  if (protectedSettings.response.status !== 401) {
    fail(`Tenant boot smoke protected settings route mismatch: expected 401, received ${protectedSettings.response.status}`);
    return;
  }
  pass('Verified /api/tenants/settings route is mounted and guarded after Worker boot');
}

async function runTaskSmoke(baseUrl, token) {
  info('Running task-system smoke flow');
  const hotelName = `Smoke Hotel ${Date.now()}`;
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'X-Tenant-ID': TENANT_ID,
  };

  const create = await requestJson(`${baseUrl}/api/stops/stop-001/accommodations`, {
    method: 'POST',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      hotel_name: hotelName,
      person_in_charge: 'Smoke Agent',
      address: '123 Street',
    }),
  });

  if (!create.response.ok || !create.body?.ok) {
    fail(`Task smoke create failed: ${create.text}`);
    return;
  }
  pass('Created accommodation on stop-001');

  const list = await requestJson(`${baseUrl}/api/stops/stop-001/accommodations`, {
    headers: authHeaders,
  });

  const item = list.body?.items?.find((entry) => entry.hotel_name === hotelName);
  const taskId = item?.tasks?.[0]?.id;

  if (!taskId) {
    fail('Task smoke could not find an embedded task for the created accommodation');
    return;
  }
  pass(`Embedded task found: ${taskId}`);

  const update = await requestJson(`${baseUrl}/api/tasks/${taskId}`, {
    method: 'PATCH',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'done' }),
  });

  if (!update.response.ok || !update.body?.ok) {
    fail(`Task smoke patch failed: ${update.text}`);
    return;
  }
  pass('Patched embedded task to done');

  const verify = await requestJson(`${baseUrl}/api/stops/stop-001/accommodations`, {
    headers: authHeaders,
  });

  const updatedItem = verify.body?.items?.find((entry) => entry.id === item.id);
  const updatedTask = updatedItem?.tasks?.find((entry) => entry.id === taskId);

  if (updatedTask?.status !== 'done') {
    fail(`Task smoke verification failed: expected done, received ${updatedTask?.status ?? 'missing'}`);
    return;
  }
  pass('Verified patched task status persisted');
}

async function runBookingSmoke(baseUrl, token, adminSecret) {
  info('Running booking confirm smoke flow');

  const showcaseBlocked = await requestJson(`${baseUrl}/api/bookings/order?__local_host=${encodeURIComponent('sunset-smoke-lagoon.tours-market.com')}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-ID': TENANT_ID,
      'X-Local-Smoke-Secret': adminSecret,
    },
    body: JSON.stringify({
      tour_id: 'tour-001',
      travel_date: '2026-07-10',
      segment_id: 'segment-standard',
      pax: {
        adult_shared_room_count: 2,
        adult_count: 2,
      },
      guest: {
        name: 'Blocked Showcase User',
        email: `blocked.showcase.${Date.now()}@example.com`,
      },
    }),
  });

  if (showcaseBlocked.response.status !== 403 || showcaseBlocked.body?.code !== 'COMMERCIAL_ACTIVATION_REQUIRED') {
    fail(`Booking smoke expected platform-subdomain commerce to be blocked, received ${showcaseBlocked.response.status}: ${showcaseBlocked.text}`);
    return;
  }
  pass('Blocked booking creation on showcase-only platform subdomain');

  const trustUpgrade = await requestJson(`${baseUrl}/api/admin/tenants/${encodeURIComponent(TENANT_ID)}/trust`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Secret': adminSecret,
    },
    body: JSON.stringify({
      trust_status: 'TRUSTED',
      public_indexing_enabled: true,
      reviewed_by: 'smoke:admin',
      resolution_note: 'Local smoke trusted promotion for custom-domain commerce path.',
    }),
  });

  if (!trustUpgrade.response.ok || trustUpgrade.body?.trust_state?.status !== 'TRUSTED') {
    fail(`Booking smoke trust upgrade failed: ${trustUpgrade.text}`);
    return;
  }
  pass('Promoted smoke tenant to TRUSTED through the live admin route');

  const customDomain = 'travel-smoke.example.com';
  const bindDomain = await requestJson(`${baseUrl}/api/tenants/settings`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Tenant-ID': TENANT_ID,
    },
    body: JSON.stringify({ custom_domain: customDomain }),
  });

  if (!bindDomain.response.ok || bindDomain.body?.settings?.custom_domain !== customDomain) {
    fail(`Booking smoke custom-domain bind failed: ${bindDomain.text}`);
    return;
  }
  pass('Bound custom domain after trust promotion');

  const verifyDomain = await requestJson(`${baseUrl}/api/admin/tenants/${encodeURIComponent(TENANT_ID)}/trust`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Secret': adminSecret,
    },
    body: JSON.stringify({
      trust_status: 'TRUSTED',
      public_indexing_enabled: true,
      verify_current_domain: true,
      reviewed_by: 'smoke:admin',
      resolution_note: 'Local smoke custom-domain verification for commerce path.',
    }),
  });

  if (!verifyDomain.response.ok || !verifyDomain.body?.tenant?.custom_domain_verified_at) {
    fail(`Booking smoke custom-domain verification failed: ${verifyDomain.text}`);
    return;
  }
  pass('Verified current custom domain through the live admin route');

  const paymentConfig = await requestJson(`${baseUrl}/api/payments/settings`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Tenant-ID': TENANT_ID,
    },
    body: JSON.stringify({
      methods: [
        { id: 'BANK_TRANSFER', enabled: true },
        { id: 'STRIPE', enabled: true },
      ],
    }),
  });

  // [POLICY] electronic gateway (STRIPE) must be present and enabled — not just bank transfer
  const electronicActive = Array.isArray(paymentConfig.body?.payment_methods)
    && paymentConfig.body.payment_methods.some((entry) => entry.id === 'STRIPE' && entry.enabled === true);
  if (!paymentConfig.response.ok || !electronicActive) {
    fail(`Booking smoke payment configuration failed — expected STRIPE electronic gateway enabled: ${paymentConfig.text}`);
    return;
  }
  pass('Confirmed electronic payment gateway (STRIPE) enabled through the live payment settings route');

  const order = await requestJson(`${baseUrl}/api/bookings/order?__local_host=${encodeURIComponent(customDomain)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-ID': TENANT_ID,
      'X-Local-Smoke-Secret': adminSecret,
    },
    body: JSON.stringify({
      tour_id: 'tour-001',
      travel_date: '2026-07-10',
      segment_id: 'segment-standard',
      pax: {
        adult_shared_room_count: 2,
        adult_count: 2,
      },
      guest: {
        name: 'Smoke Booking User',
        email: `smoke.booking.${Date.now()}@example.com`,
        phone: '0901234567',
      },
    }),
  });

  const orderId = order.body?.order_id;
  if (order.response.status !== 201 || !orderId) {
    fail(`Booking smoke order creation failed: ${order.text}`);
    return;
  }
  pass(`Created booking order ${orderId}`);

  const proofForm = new FormData();
  proofForm.set('proof', new Blob(['SMOKE_PROOF'], { type: 'image/jpeg' }), 'proof.jpg');

  const proof = await requestJson(`${baseUrl}/api/bookings/order/${orderId}/proof?__local_host=${encodeURIComponent(customDomain)}`, {
    method: 'POST',
    headers: {
      'X-Tenant-ID': TENANT_ID,
      'X-Local-Smoke-Secret': adminSecret,
    },
    body: proofForm,
  });

  if (!proof.response.ok || proof.body?.status !== 'PROOF_UPLOADED') {
    fail(`Booking smoke proof upload failed: ${proof.text}`);
    return;
  }
  pass('Uploaded booking proof and reached PROOF_UPLOADED');

  const confirm = await requestJson(`${baseUrl}/api/bookings/order/${orderId}/confirm-receipt?__local_host=${encodeURIComponent(customDomain)}`, {
    method: 'POST',
    headers: {
      'X-Tenant-ID': TENANT_ID,
      'X-Local-Smoke-Secret': adminSecret,
    },
  });

  if (!confirm.response.ok || confirm.body?.status !== 'CONFIRMED') {
    fail(`Booking smoke confirm failed: ${confirm.text}`);
    return;
  }
  pass('Confirmed booking receipt successfully');

  const auditRows = runD1Json(
    `SELECT action, field_name, old_value, new_value
       FROM tenant_audit_log
      WHERE tenant_id = '${TENANT_ID}'
        AND entity_id = '${orderId}'
      ORDER BY changed_at DESC
      LIMIT 1;`
  );

  const audit = auditRows[0];
  if (!audit || audit.action !== 'IDENTITY_UNLOCK_CONFIRM_RECEIPT') {
    fail(`Booking smoke audit verification failed for order ${orderId}`);
    return;
  }
  pass('Verified booking confirm audit row');
}

async function runPublicHotelSmoke(baseUrl, token) {
  info('Running public hotel smoke flow');

  const customDomain = 'travel-smoke.example.com';
  const uniqueSuffix = String(Date.now());
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'X-Tenant-ID': TENANT_ID,
    'Content-Type': 'application/json',
  };
  const hotelRow = runD1Json(
    `SELECT id, hotel_key
       FROM tenant_universal_hotels
      WHERE tenant_id = '${TENANT_ID}'
      ORDER BY updated_at DESC
      LIMIT 1;`
  )[0];
  if (!hotelRow?.id || !hotelRow?.hotel_key) {
    fail('Public hotel smoke could not find a tenant hotel row fixture');
    return;
  }

  const propertyId = `prop-public-hotel-smoke-${uniqueSuffix}`;
  runD1Json(
    `INSERT INTO properties (
        id, tenant_id, name, slug, status, timezone, currency,
        default_check_in_time, default_check_out_time,
        split_stay_enabled, split_stay_public_visible,
        allow_upgrade_to_preserve_stay, upgrade_mode,
        max_room_moves_per_reservation, max_upgrade_segments_per_stay,
        max_upgrade_level_jump, same_day_turnover_sellable,
        created_at, updated_at
      ) VALUES (
        '${propertyId}', '${TENANT_ID}', 'Public Hotel Smoke ${uniqueSuffix}', 'public-hotel-smoke-${uniqueSuffix}',
        'active', 'Asia/Ho_Chi_Minh', 'USD',
        '14:00', '11:00',
        1, 0,
        1, 'suggest_only',
        1, 1,
        1, 0,
        strftime('%s','now'), strftime('%s','now')
      );`
  );

  const roomTypeCreate = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/room-types`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      code: `PH${uniqueSuffix.slice(-6)}`,
      name: `Public Hotel Type ${uniqueSuffix.slice(-4)}`,
      base_capacity: 2,
      max_occupancy: 2,
      sort_order: 9997,
    }),
  });
  if (!roomTypeCreate.response.ok || !roomTypeCreate.body?.room_type?.id) {
    fail(`Public hotel smoke could not create a room type: ${roomTypeCreate.response.status} ${roomTypeCreate.text}`);
    return;
  }
  const roomTypeId = roomTypeCreate.body.room_type.id;

  const roomUnitCreate = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/room-units`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      room_type_id: roomTypeId,
      room_number: `PH-${uniqueSuffix.slice(-4)}-1`,
      floor_label: 'Public Hotel Smoke',
      sort_order: 9998,
    }),
  });
  if (!roomUnitCreate.response.ok || !roomUnitCreate.body?.room_unit?.id) {
    fail(`Public hotel smoke could not create a room unit: ${roomUnitCreate.response.status} ${roomUnitCreate.text}`);
    return;
  }

  const roomRateCreate = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/room-rates`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      room_type_id: roomTypeId,
      rate_name: 'Public Hotel BAR',
      currency: 'USD',
      nightly_amount: 135,
      included_adults: 2,
      included_children: 0,
      extra_adult_amount: 0,
      extra_child_amount: 0,
      active: 1,
    }),
  });
  if (!roomRateCreate.response.ok || !roomRateCreate.body?.room_rate?.id) {
    fail(`Public hotel smoke could not create a room rate: ${roomRateCreate.response.status} ${roomRateCreate.text}`);
    return;
  }

  runD1Json(
    `UPDATE tenants
        SET subscription_status = 'ACTIVE',
            trust_status = 'TRUSTED',
            custom_domain = '${customDomain}',
            custom_domain_verified_at = COALESCE(custom_domain_verified_at, strftime('%s','now')),
            terms_accepted = 1,
            terms_accepted_at = COALESCE(terms_accepted_at, strftime('%s','now'))
      WHERE id = '${TENANT_ID}';
     UPDATE tenant_universal_hotels
        SET property_id = '${propertyId}',
            status = 'active',
            updated_at = strftime('%s','now')
      WHERE id = '${hotelRow.id}';`
  );

  const canonicalHotelKey = String(hotelRow.hotel_key).trim().toLowerCase();
  const publicHeaders = { 'X-Forwarded-Host': customDomain };

  const publicHotel = await requestJson(`${baseUrl}/api/universal/public/hotels/${encodeURIComponent(canonicalHotelKey)}`, {
    headers: publicHeaders,
  });
  if (
    !publicHotel.response.ok
    || !publicHotel.body?.ok
    || String(publicHotel.body?.hotel?.property?.id || '') !== String(propertyId)
  ) {
    fail(`Public hotel smoke read failed: ${publicHotel.response.status} ${publicHotel.text}`);
    return;
  }
  pass('Resolved a host-scoped public hotel with linked property data');

  const staySearch = await requestJson(`${baseUrl}/api/universal/public/hotels/${encodeURIComponent(canonicalHotelKey)}/stay-search`, {
    method: 'POST',
    headers: {
      ...publicHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      check_in: '2026-11-20',
      check_out: '2026-11-22',
      adults: 2,
      children: 0,
      rooms_requested: 1,
    }),
  });
  const roomOptions = Array.isArray(staySearch.body?.room_options) ? staySearch.body.room_options : [];
  const selectedOption = roomOptions.find((option) => option?.available) || null;
  if (!staySearch.response.ok || !staySearch.body?.ok || !roomOptions.length || !selectedOption?.room_type?.id) {
    fail(`Public hotel smoke stay-search failed: ${staySearch.response.status} ${staySearch.text}`);
    return;
  }
  pass('Returned public hotel stay-search room options through the shared property engine');

  const bookingCommit = await requestJson(`${baseUrl}/api/universal/public/hotels/${encodeURIComponent(canonicalHotelKey)}/booking-commit`, {
    method: 'POST',
    headers: {
      ...publicHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      room_type_id: selectedOption.room_type.id,
      check_in: '2026-11-20',
      check_out: '2026-11-22',
      adults: 2,
      children: 0,
      rooms_requested: 1,
      guest_name: `Public Hotel Smoke ${Date.now()}`,
      guest_email: `public.hotel.smoke.${Date.now()}@example.com`,
      guest_phone: '+49123456789',
      special_requests: 'Late arrival from smoke test',
    }),
  });

  if (
    !bookingCommit.response.ok
    || bookingCommit.body?.ok !== true
    || bookingCommit.body?.reservation?.status !== 'confirmed'
    || bookingCommit.body?.reservation?.source !== 'direct_web'
    || bookingCommit.body?.hold?.hold_type !== 'soft_hold'
  ) {
    fail(`Public hotel smoke booking-commit failed: ${bookingCommit.response.status} ${bookingCommit.text}`);
    return;
  }
  pass('Committed a public hotel booking into shared hold + reservation runtime successfully');
}

async function runPricingSmoke(baseUrl, token) {
  info('Running pricing calculate smoke flow');
  const pricingSmokeDate = resolvePricingSmokeDate();

  const pricing = await requestJson(
    `${baseUrl}/api/pricing/calculate?tour_id=tour-001&date=${encodeURIComponent(pricingSmokeDate)}&segment_id=segment-standard&adult_shared_room_count=2`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Tenant-ID': TENANT_ID,
      },
    }
  );

  if (!pricing.response.ok || !pricing.body?.ok) {
    fail(`Pricing smoke calculate failed: ${pricing.text}`);
    return;
  }

  if (pricing.body.applied_season_name !== 'High Season') {
    fail(`Pricing smoke season mismatch: expected High Season, received ${pricing.body.applied_season_name ?? 'missing'}`);
    return;
  }

  if (pricing.body.pax_band_name !== '1-5 pax') {
    fail(`Pricing smoke pax band mismatch: expected 1-5 pax, received ${pricing.body.pax_band_name ?? 'missing'}`);
    return;
  }

  if (pricing.body.invoice?.grand_total !== PRICING_SMOKE_EXPECTED_TOTAL) {
    fail(`Pricing smoke total mismatch: expected ${PRICING_SMOKE_EXPECTED_TOTAL}, received ${pricing.body.invoice?.grand_total ?? 'missing'}`);
    return;
  }

  if (pricing.body.prices?.adult_shared_room?.price_usd !== 680) {
    fail(`Pricing smoke unit price mismatch: expected 680, received ${pricing.body.prices?.adult_shared_room?.price_usd ?? 'missing'}`);
    return;
  }

  pass(`Calculated seeded high-season standard pricing correctly for ${pricingSmokeDate}`);

  const overlapPricing = await requestJson(
    `${baseUrl}/api/pricing/calculate?tour_id=tour-001&date=${encodeURIComponent(PRICING_OVERLAP_SMOKE_DATE)}&segment_id=segment-standard&adult_shared_room_count=2`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Tenant-ID': TENANT_ID,
      },
    }
  );

  if (!overlapPricing.response.ok || !overlapPricing.body?.ok) {
    fail(`Pricing overlap smoke calculate failed: ${overlapPricing.text}`);
    return;
  }

  if (overlapPricing.body.applied_season_name !== 'High Season') {
    fail(`Pricing overlap smoke season mismatch: expected High Season, received ${overlapPricing.body.applied_season_name ?? 'missing'}`);
    return;
  }

  if (overlapPricing.body.invoice?.grand_total !== PRICING_SMOKE_EXPECTED_TOTAL) {
    fail(`Pricing overlap smoke total mismatch: expected ${PRICING_SMOKE_EXPECTED_TOTAL}, received ${overlapPricing.body.invoice?.grand_total ?? 'missing'}`);
    return;
  }

  pass(`Verified overlap pricing prefers High Season on ${PRICING_OVERLAP_SMOKE_DATE}`);

  const familyRoomPolicy = await requestJson(
    `${baseUrl}/api/pricing/calculate?tour_id=tour-001&date=${encodeURIComponent(PRICING_OVERLAP_SMOKE_DATE)}&segment_id=segment-standard&adult_shared_room_count=2&child_count=2`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Tenant-ID': TENANT_ID,
      },
    }
  );

  if (familyRoomPolicy.response.status !== 422) {
    fail(`Pricing child-sharing policy smoke mismatch: expected 422, received ${familyRoomPolicy.response.status}`);
    return;
  }

  if (!String(familyRoomPolicy.body?.error || '').includes('chosen rooming capacity')) {
    fail(`Pricing child-sharing policy smoke expected rooming-capacity guidance, received: ${familyRoomPolicy.text}`);
    return;
  }

  pass('Verified child-with-parents pricing is capped and requires family room/manual quote when exceeded');

  const mixedRoomAllowance = await requestJson(
    `${baseUrl}/api/pricing/calculate?tour_id=tour-001&date=${encodeURIComponent(PRICING_OVERLAP_SMOKE_DATE)}&segment_id=segment-standard&adult_shared_room_count=8&adult_single_room_count=1&child_count=6`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Tenant-ID': TENANT_ID,
      },
    }
  );

  if (!mixedRoomAllowance.response.ok || !mixedRoomAllowance.body?.ok) {
    fail(`Pricing mixed-room child policy smoke failed: ${mixedRoomAllowance.text}`);
    return;
  }

  pass('Verified mixed rooming allows 1 child per shared double room and 2 children per private room');
}

async function runPasswordResetSmoke(baseUrl, token) {
  info('Running password reset smoke flow');
  const email = getPrimaryUserEmail();
  runD1Json(`DELETE FROM auth_action_attempts WHERE action = 'forgot_password' AND email = '${email.replaceAll("'", "''")}';`);

  const request = await requestJson(`${baseUrl}/api/auth/forgot-password`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Tenant-ID': TENANT_ID,
      Origin: baseUrl,
    },
    body: JSON.stringify({ email, return_origin: baseUrl }),
  });

  if (!request.response.ok || !request.body?.ok || !request.body?.dev_reset_url) {
    fail(`Password reset smoke request failed: ${request.text}`);
    return;
  }
  if (!['webhook', 'log_only'].includes(request.body.delivery)) {
    fail(`Password reset smoke expected webhook or log_only delivery, received ${request.body.delivery ?? 'missing'}`);
    return;
  }
  pass(`Prepared forgot-password reset link via ${request.body.delivery}`);

  const resetUrl = new URL(request.body.dev_reset_url);
  const resetToken = resetUrl.searchParams.get('token');
  if (!resetToken) {
    fail('Password reset smoke did not receive a tokenized dev reset URL');
    return;
  }

  const validate = await requestJson(`${baseUrl}/api/auth/reset-password/${encodeURIComponent(resetToken)}`);
  if (!validate.response.ok || !validate.body?.ok) {
    fail(`Password reset smoke token validation failed: ${validate.text}`);
    return;
  }
  pass('Validated password reset token');

  const newPassword = `Reset-${Date.now()}-Pass!`;
  const confirm = await requestJson(`${baseUrl}/api/auth/reset-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token: resetToken, password: newPassword }),
  });

  if (!confirm.response.ok || !confirm.body?.ok) {
    fail(`Password reset smoke confirm failed: ${confirm.text}`);
    return;
  }
  pass('Confirmed password reset');

  const login = await requestJson(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password: newPassword }),
  });

  if (!login.response.ok || !login.body?.ok) {
    fail(`Password reset smoke login failed: ${login.text}`);
    return;
  }
  pass('Verified sign-in with reset password');
}

// ── Domain registration smoke ─────────────────────────────────────────────────
// Tests the following without requiring Stripe or real CF credentials:
//   1. Auth guard — unauthenticated request → 401
//   2. Invalid domain name → 400
//   3. Unsupported TLD → 422
//   4. Valid domain RDAP search → 200 with price breakdown
//   5. Known-registered domain (google.com) → 200 available:false
//   6. Purchases history → 200 empty list
// The CF Registrar API call only fires in /api/domains/stripe-webhook AFTER Stripe
// sends checkout.session.completed, so it is not exercised in local smoke.
async function runDomainSmoke(baseUrl, token) {
  info('Running domain registration smoke flow');
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-ID': TENANT_ID,
  };

  // 1. Auth guard
  const unauthed = await requestJson(`${baseUrl}/api/domains/search?q=mybrand.com`);
  if (unauthed.response.status !== 401) {
    fail(`Domain smoke: expected 401 for unauthenticated search, got ${unauthed.response.status}: ${unauthed.text}`);
    return;
  }
  pass('Domain search route requires authentication');

  // 2. Invalid domain name
  const invalid = await requestJson(`${baseUrl}/api/domains/search?q=bad%20domain!`, { headers: authHeaders });
  if (invalid.response.status !== 400) {
    fail(`Domain smoke: expected 400 for invalid domain, got ${invalid.response.status}: ${invalid.text}`);
    return;
  }
  pass('Rejected invalid domain names with 400');

  // 3. Unsupported TLD
  const badTld = await requestJson(`${baseUrl}/api/domains/search?q=mybrand.museum`, { headers: authHeaders });
  if (badTld.response.status !== 422) {
    fail(`Domain smoke: expected 422 for unsupported TLD, got ${badTld.response.status}: ${badTld.text}`);
    return;
  }
  pass('Rejected unsupported TLD with 422');

  // 4. Valid domain RDAP search → 200 with correct price breakdown structure
  // Note: availability from RDAP may vary depending on network/proxy in CI or local.
  // We test that the price math and response shape are correct, not the RDAP outcome.
  const knownDomain = await requestJson(`${baseUrl}/api/domains/search?q=mybrand-smoke-test-12345.com`, { headers: authHeaders });
  if (!knownDomain.response.ok || !knownDomain.body?.ok) {
    fail(`Domain smoke: expected 200 for valid domain search, got ${knownDomain.response.status}: ${knownDomain.text}`);
    return;
  }
  if (typeof knownDomain.body?.platform_price_usd !== 'number' || knownDomain.body.platform_price_usd <= 0) {
    fail(`Domain smoke: expected platform_price_usd > 0 in response, got ${knownDomain.text}`);
    return;
  }
  if (knownDomain.body?.markup_pct !== 30) {
    fail(`Domain smoke: expected markup_pct=30, got ${knownDomain.body?.markup_pct}`);
    return;
  }
  // Verify the 30% markup math: platform_price ≥ registrar_price × 1.30
  const regPriceUsd  = knownDomain.body.registrar_price_usd;
  const platPriceUsd = knownDomain.body.platform_price_usd;
  if (platPriceUsd < regPriceUsd * 1.30 - 0.01) {
    fail(`Domain smoke: platform_price_usd ${platPriceUsd} is less than 30% above registrar_price ${regPriceUsd}`);
    return;
  }
  pass('Valid domain search returns 200 with correct 30% markup pricing structure');

  // 5. Purchases list — should return empty array for fresh smoke tenant
  const purchases = await requestJson(`${baseUrl}/api/domains/purchases`, { headers: authHeaders });
  if (!purchases.response.ok || !purchases.body?.ok || !Array.isArray(purchases.body?.purchases)) {
    fail(`Domain smoke: expected 200 purchases list, got ${purchases.response.status}: ${purchases.text}`);
    return;
  }
  pass('Domain purchases history endpoint responds with empty list');

  // 6. Purchase without Stripe configured → 503 (Stripe not in local .dev.vars)
  const purchaseAttempt = await requestJson(`${baseUrl}/api/domains/purchase`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ domain: 'smoke-test-domain-xyz.com' }),
  });
  if (purchaseAttempt.response.status !== 503) {
    fail(`Domain smoke: expected 503 when Stripe not configured, got ${purchaseAttempt.response.status}: ${purchaseAttempt.text}`);
    return;
  }
  pass('Domain purchase returns 503 gracefully when Stripe not configured');
}

async function runDomainVerifySmoke(baseUrl, token) {
  info('Running domain DNS verify smoke flow');

  // 1. GET requires auth
  {
    const res = await fetch(`${baseUrl}/api/tenants/custom-domain-verify`, {
      headers: { 'X-Tenant-ID': TENANT_ID },
    });
    if (res.status !== 401) {
      fail(`Domain verify GET must require authentication, got ${res.status}`); return;
    }
    pass('Domain verify GET requires authentication');
  }

  // 2. GET with valid bearer returns token + cname_target
  {
    const res = await fetch(`${baseUrl}/api/tenants/custom-domain-verify`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Tenant-ID': TENANT_ID },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) {
      fail(`GET /custom-domain-verify returned ${res.status}: ${JSON.stringify(body)}`); return;
    }
    if (body.token === undefined) {
      fail(`GET /custom-domain-verify missing token field: ${JSON.stringify(body)}`); return;
    }
    if (body.cname_target !== 'proxy.tours-market.com') {
      fail(`GET /custom-domain-verify wrong cname_target: ${body.cname_target}`); return;
    }
    pass('GET /custom-domain-verify returns 200 with token and cname_target');
  }

  // 3. POST triggers DNS check and returns a structured response (domain was bound by booking smoke)
  {
    const res = await fetch(`${baseUrl}/api/tenants/custom-domain-verify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'X-Tenant-ID': TENANT_ID },
    });
    const body = await res.json().catch(() => null);
    // Acceptable: 400 NO_DOMAIN (no domain set) -or- 200 with ok:false (DNS not propagated yet)
    const isNodomainError = res.status === 400 && body?.code === 'NO_DOMAIN';
    const isDnsNotYet = res.ok && body !== null && 'verified' in body;
    if (!isNodomainError && !isDnsNotYet) {
      fail(`POST /custom-domain-verify unexpected response ${res.status}: ${JSON.stringify(body)}`); return;
    }
    pass('POST /custom-domain-verify returns structured DNS verification response');
  }
}

async function runPropertyReservationPlannerSmoke(baseUrl, token) {
  info('Running property reservation planner smoke flow');

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'X-Tenant-ID': TENANT_ID,
    'Content-Type': 'application/json',
  };
  const uniqueSuffix = String(Date.now());

  const propertyList = await requestJson(`${baseUrl}/api/properties`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Tenant-ID': TENANT_ID,
    },
  });
  if (!propertyList.response.ok || !propertyList.body?.ok || !Array.isArray(propertyList.body?.properties)) {
    fail(`Property planner smoke could not list properties: ${propertyList.response.status} ${JSON.stringify(propertyList.body)}`);
    return;
  }

  let propertyId = propertyList.body.properties[0]?.id || null;
  if (!propertyId) {
    const propertyCreate = await requestJson(`${baseUrl}/api/properties`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: `Planner Smoke ${uniqueSuffix}`,
        slug: `planner-smoke-${uniqueSuffix}`,
      }),
    });
    if (!propertyCreate.response.ok || !propertyCreate.body?.property?.id) {
      fail(`Property planner smoke could not create a property: ${propertyCreate.response.status} ${JSON.stringify(propertyCreate.body)}`);
      return;
    }
    propertyId = propertyCreate.body.property.id;
  }

  const roomTypeCreate = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/room-types`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      code: `SMK${uniqueSuffix.slice(-6)}`,
      name: `Smoke Type ${uniqueSuffix.slice(-4)}`,
      base_capacity: 2,
      max_occupancy: 2,
      sort_order: 9990,
    }),
  });
  if (!roomTypeCreate.response.ok || !roomTypeCreate.body?.room_type?.id) {
    fail(`Property planner smoke could not create a room type: ${roomTypeCreate.response.status} ${JSON.stringify(roomTypeCreate.body)}`);
    return;
  }
  const roomTypeId = roomTypeCreate.body.room_type.id;

  const roomUnitOneCreate = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/room-units`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      room_type_id: roomTypeId,
      room_number: `SM-${uniqueSuffix.slice(-4)}-1`,
      floor_label: 'Smoke',
      sort_order: 9991,
    }),
  });
  const roomUnitTwoCreate = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/room-units`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      room_type_id: roomTypeId,
      room_number: `SM-${uniqueSuffix.slice(-4)}-2`,
      floor_label: 'Smoke',
      sort_order: 9992,
    }),
  });
  if (!roomUnitOneCreate.response.ok || !roomUnitOneCreate.body?.room_unit?.id || !roomUnitTwoCreate.response.ok || !roomUnitTwoCreate.body?.room_unit?.id) {
    fail(`Property planner smoke could not create room units: ${roomUnitOneCreate.response.status}/${roomUnitTwoCreate.response.status} ${JSON.stringify({ one: roomUnitOneCreate.body, two: roomUnitTwoCreate.body })}`);
    return;
  }
  const roomUnitOneId = roomUnitOneCreate.body.room_unit.id;
  const roomUnitTwoId = roomUnitTwoCreate.body.room_unit.id;
  pass('Property planner smoke fixtures created');

  const preferredStayCheckIn = '2026-09-10';
  const preferredStayCheckOut = '2026-09-12';
  const blockingReservation = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/reservations`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      room_type_id: roomTypeId,
      check_in: preferredStayCheckIn,
      check_out: preferredStayCheckOut,
      rooms_requested: 1,
      preferred_room_unit_id: roomUnitOneId,
      guest_name: `Lane Block ${uniqueSuffix}`,
      adults: 2,
      children: 0,
      source: 'manual_frontdesk',
    }),
  });
  if (!blockingReservation.response.ok || !blockingReservation.body?.reservation?.id) {
    fail(`Property planner smoke could not create the blocking reservation: ${blockingReservation.response.status} ${JSON.stringify(blockingReservation.body)}`);
    return;
  }
  pass('Created a blocking reservation on the preferred lane');

  const directAvailability = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/availability`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      room_type_id: roomTypeId,
      check_in: preferredStayCheckIn,
      check_out: preferredStayCheckOut,
      rooms_requested: 1,
    }),
  });
  const nightlyRemaining = Array.isArray(directAvailability.body?.availability?.nightly_remaining)
    ? directAvailability.body.availability.nightly_remaining
    : [];
  if (
    !directAvailability.response.ok
    || nightlyRemaining.length !== 2
    || !nightlyRemaining.every((row) => Number(row?.remaining) === 1)
    || Array.isArray(directAvailability.body?.availability?.shortage_dates) && directAvailability.body.availability.shortage_dates.length !== 0
  ) {
    fail(`Direct availability did not reflect night-based remaining inventory after one locked allocation: ${directAvailability.response.status} ${JSON.stringify(directAvailability.body)}`);
    return;
  }
  pass('Direct availability stays night-based and subtracts locked allocations from sellable room-unit inventory');

  const holdCreate = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/availability/hold`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      room_type_id: roomTypeId,
      check_in: preferredStayCheckIn,
      check_out: preferredStayCheckOut,
      rooms_requested: 1,
      hold_type: 'soft_hold',
      source_type: 'smoke_test',
      source_id: `hold-${uniqueSuffix}`,
      ttl_seconds: 900,
    }),
  });
  const heldNightlyRemaining = Array.isArray(holdCreate.body?.availability?.nightly_remaining)
    ? holdCreate.body.availability.nightly_remaining
    : [];
  const holdId = holdCreate.body?.hold?.id || null;
  if (
    holdCreate.response.status !== 201
    || !holdId
    || heldNightlyRemaining.length !== 2
    || !heldNightlyRemaining.every((row) => Number(row?.remaining) === 0)
    || !Array.isArray(holdCreate.body?.availability?.shortage_dates)
    || holdCreate.body.availability.shortage_dates.length !== 2
  ) {
    fail(`Availability hold did not subtract active hold inventory as expected: ${holdCreate.response.status} ${JSON.stringify(holdCreate.body)}`);
    return;
  }
  pass('Availability hold path rechecks inventory and subtracts active holds from nightly remaining counts');

  const holdRelease = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/availability/hold/${encodeURIComponent(holdId)}/release`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Tenant-ID': TENANT_ID,
    },
  });
  if (!holdRelease.response.ok || holdRelease.body?.ok !== true) {
    fail(`Availability hold release failed: ${holdRelease.response.status} ${JSON.stringify(holdRelease.body)}`);
    return;
  }

  const availabilityAfterRelease = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/availability`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      room_type_id: roomTypeId,
      check_in: preferredStayCheckIn,
      check_out: preferredStayCheckOut,
      rooms_requested: 1,
    }),
  });
  const nightlyRemainingAfterRelease = Array.isArray(availabilityAfterRelease.body?.availability?.nightly_remaining)
    ? availabilityAfterRelease.body.availability.nightly_remaining
    : [];
  if (
    !availabilityAfterRelease.response.ok
    || nightlyRemainingAfterRelease.length !== 2
    || !nightlyRemainingAfterRelease.every((row) => Number(row?.remaining) === 1)
    || !Array.isArray(availabilityAfterRelease.body?.availability?.shortage_dates)
    || availabilityAfterRelease.body.availability.shortage_dates.length !== 0
  ) {
    fail(`Availability did not reopen after hold release: ${availabilityAfterRelease.response.status} ${JSON.stringify(availabilityAfterRelease.body)}`);
    return;
  }
  pass('Hold release restores nightly remaining inventory without mutating locked reservation truth');

  const preferredLanePlan = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/reservations/plan`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      room_type_id: roomTypeId,
      check_in: preferredStayCheckIn,
      check_out: preferredStayCheckOut,
      rooms_requested: 1,
      preferred_room_unit_id: roomUnitOneId,
    }),
  });
  const preferredPlanSegments = Array.isArray(preferredLanePlan.body?.selected_plan?.segments)
    ? preferredLanePlan.body.selected_plan.segments
    : [];
  const preferredConflictTypes = Array.isArray(preferredLanePlan.body?.preferred_room_conflicts)
    ? preferredLanePlan.body.preferred_room_conflicts.map((conflict) => conflict.conflict_type)
    : [];
  if (
    !preferredLanePlan.response.ok
    || preferredLanePlan.body?.can_fulfill !== true
    || preferredLanePlan.body?.preferred_room_honored !== false
    || !preferredConflictTypes.includes('reservation_overlap')
    || !preferredPlanSegments.some((segment) => String(segment.room_unit_id || '') === String(roomUnitTwoId))
    || preferredPlanSegments.some((segment) => String(segment.room_unit_id || '') === String(roomUnitOneId))
  ) {
    fail(`Preferred-lane planning did not fall back as expected: ${preferredLanePlan.response.status} ${JSON.stringify(preferredLanePlan.body)}`);
    return;
  }
  pass('Planner keeps preferred lanes soft and falls back to another free room when needed');

  const preferredLaneReservation = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/reservations`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      room_type_id: roomTypeId,
      check_in: preferredStayCheckIn,
      check_out: preferredStayCheckOut,
      rooms_requested: 1,
      preferred_room_unit_id: roomUnitOneId,
      guest_name: `Lane Fallback ${uniqueSuffix}`,
      adults: 1,
      children: 0,
      source: 'manual_frontdesk',
    }),
  });
  const preferredAssignedRoomUnitId = preferredLaneReservation.body?.reservation?.assigned_room_unit_id
    || preferredLaneReservation.body?.stay_plan?.segments?.[0]?.room_unit_id
    || null;
  if (
    !preferredLaneReservation.response.ok
    || preferredLaneReservation.body?.reservation?.preferred_room_honored !== false
    || String(preferredAssignedRoomUnitId || '') !== String(roomUnitTwoId)
  ) {
    fail(`Preferred-lane reservation create did not stay off the blocked lane: ${preferredLaneReservation.response.status} ${JSON.stringify(preferredLaneReservation.body)}`);
    return;
  }
  pass('Reservation create avoids force-binding a blocked preferred lane');

  const allotmentCheckIn = '2026-09-20';
  const allotmentCheckOut = '2026-09-22';
  const allotmentPricingProfileCreate = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/pricing-profiles`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      room_type_id: roomTypeId,
      code: `B2B-${uniqueSuffix.slice(-4)}`,
      name: 'Allotment B2B Contract',
      visibility: 'planner_only',
      pricing_mode: 'fixed_nightly_amount',
      fixed_nightly_amount: 79,
      notes: 'Smoke allotment pricing profile',
      active: 1,
    }),
  });
  if (!allotmentPricingProfileCreate.response.ok || !allotmentPricingProfileCreate.body?.pricing_profile?.id) {
    fail(`Property planner smoke could not create the allotment pricing profile: ${allotmentPricingProfileCreate.response.status} ${JSON.stringify(allotmentPricingProfileCreate.body)}`);
    return;
  }
  const allotmentPricingProfileId = allotmentPricingProfileCreate.body.pricing_profile.id;

  const allotmentCreate = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/allotments`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      room_type_id: roomTypeId,
      pricing_profile_id: allotmentPricingProfileId,
      operator_name: `Smoke Operator ${uniqueSuffix.slice(-4)}`,
      operator_code: 'SMOKE',
      source_ref: `ALLOT-${uniqueSuffix}`,
      check_in: allotmentCheckIn,
      check_out: allotmentCheckOut,
      release_date: '2026-09-18',
      rooms_blocked: 2,
      notes: 'Planner smoke allotment',
    }),
  });
  if (!allotmentCreate.response.ok || !allotmentCreate.body?.allotment?.id) {
    fail(`Property planner smoke could not create the allotment: ${allotmentCreate.response.status} ${JSON.stringify(allotmentCreate.body)}`);
    return;
  }
  if (String(allotmentCreate.body?.allotment?.pricing_profile_id || '') !== String(allotmentPricingProfileId)) {
    fail(`Property planner smoke did not persist pricing_profile_id on the allotment: ${JSON.stringify(allotmentCreate.body)}`);
    return;
  }
  const allotmentId = allotmentCreate.body.allotment.id;
  pass('Created an operator block for allotment-consumption smoke');

  const freeSellPlan = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/reservations/plan`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      room_type_id: roomTypeId,
      check_in: allotmentCheckIn,
      check_out: allotmentCheckOut,
      rooms_requested: 1,
    }),
  });
  if (!freeSellPlan.response.ok || freeSellPlan.body?.can_fulfill !== false) {
    fail(`Operator block should remove general free-sell inventory before consumption: ${freeSellPlan.response.status} ${JSON.stringify(freeSellPlan.body)}`);
    return;
  }
  pass('Active operator block reduces generic free-sell availability');

  const allotmentPlan = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/reservations/plan`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      room_type_id: roomTypeId,
      check_in: allotmentCheckIn,
      check_out: allotmentCheckOut,
      rooms_requested: 1,
      allotment_id: allotmentId,
    }),
  });
  if (
    !allotmentPlan.response.ok
    || allotmentPlan.body?.can_fulfill !== true
    || Number(allotmentPlan.body?.allotment_consumption?.remaining_rooms_after_commit) !== 1
  ) {
    fail(`Allotment planner preview did not expose the expected consumption summary: ${allotmentPlan.response.status} ${JSON.stringify(allotmentPlan.body)}`);
    return;
  }
  pass('Planner preview exposes allotment consumption and remaining blocked rooms');

  const allotmentReservationOne = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/reservations`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      room_type_id: roomTypeId,
      check_in: allotmentCheckIn,
      check_out: allotmentCheckOut,
      rooms_requested: 1,
      allotment_id: allotmentId,
      guest_name: `Allotment Guest 1 ${uniqueSuffix}`,
      adults: 2,
      children: 0,
      source: 'manual_frontdesk',
    }),
  });
  if (
    !allotmentReservationOne.response.ok
    || Number(allotmentReservationOne.body?.allotment_consumption?.remaining_rooms_after_commit) !== 1
  ) {
    fail(`First allotment-backed reservation did not decrement the block as expected: ${allotmentReservationOne.response.status} ${JSON.stringify(allotmentReservationOne.body)}`);
    return;
  }
  const allotmentReservationOneId = String(allotmentReservationOne.body?.reservation?.id || '').trim();
  const allotmentReservationOneDetail = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(allotmentReservationOneId)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Tenant-ID': TENANT_ID,
    },
  });
  if (
    !allotmentReservationOneId
    || !allotmentReservationOneDetail.response.ok
    || String(allotmentReservationOneDetail.body?.reservation?.pricing_snapshot?.pricing_profile_id || '') !== String(allotmentPricingProfileId)
  ) {
    fail(`First allotment-backed reservation did not inherit the allotment pricing profile: ${allotmentReservationOneDetail.response.status} ${JSON.stringify(allotmentReservationOneDetail.body)}`);
    return;
  }
  pass('First allotment-backed reservation decrements blocked inventory and inherits allotment pricing profile');

  const allotmentReservationTwo = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/reservations`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      room_type_id: roomTypeId,
      check_in: allotmentCheckIn,
      check_out: allotmentCheckOut,
      rooms_requested: 1,
      allotment_id: allotmentId,
      guest_name: `Allotment Guest 2 ${uniqueSuffix}`,
      adults: 1,
      children: 0,
      source: 'manual_frontdesk',
    }),
  });
  if (
    !allotmentReservationTwo.response.ok
    || Number(allotmentReservationTwo.body?.allotment_consumption?.remaining_rooms_after_commit) !== 0
  ) {
    fail(`Second allotment-backed reservation did not fully consume the block: ${allotmentReservationTwo.response.status} ${JSON.stringify(allotmentReservationTwo.body)}`);
    return;
  }

  const allotmentList = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/allotments?from_date=${encodeURIComponent(allotmentCheckIn)}&days=5&status=all`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Tenant-ID': TENANT_ID,
    },
  });
  const consumedAllotment = Array.isArray(allotmentList.body?.allotments)
    ? allotmentList.body.allotments.find((item) => String(item.id || '') === String(allotmentId))
    : null;
  if (
    !allotmentList.response.ok
    || !consumedAllotment
    || consumedAllotment.status !== 'released'
    || Number(consumedAllotment.rooms_blocked || 0) !== 0
    || consumedAllotment.inventory_blocking !== false
  ) {
    fail(`Fully consumed allotment was not released cleanly: ${allotmentList.response.status} ${JSON.stringify(allotmentList.body)}`);
    return;
  }
  pass('Fully consumed operator block releases inventory and marks the allotment as released');
}

async function runPropertyRohCommitmentSmoke(baseUrl, token) {
  info('Running property ROH commitment smoke flow');

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'X-Tenant-ID': TENANT_ID,
    'Content-Type': 'application/json',
  };
  const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}-roh`;
  const fixtureKey = crypto.randomBytes(3).toString('hex').toUpperCase();

  const propertyList = await requestJson(`${baseUrl}/api/properties`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Tenant-ID': TENANT_ID,
    },
  });
  if (!propertyList.response.ok || !Array.isArray(propertyList.body?.properties) || !propertyList.body.properties[0]?.id) {
    fail(`ROH smoke could not list an existing property: ${propertyList.response.status} ${JSON.stringify(propertyList.body)}`);
    return;
  }
  const propertyId = propertyList.body.properties[0].id;

  const roomTypeOne = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/room-types`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ code: `R1${fixtureKey}`, name: `ROH One ${fixtureKey}`, base_capacity: 2, max_occupancy: 2, sort_order: 10001 }),
  });
  const roomTypeTwo = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/room-types`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ code: `R2${fixtureKey}`, name: `ROH Two ${fixtureKey}`, base_capacity: 2, max_occupancy: 2, sort_order: 10002 }),
  });
  if (!roomTypeOne.response.ok || !roomTypeOne.body?.room_type?.id || !roomTypeTwo.response.ok || !roomTypeTwo.body?.room_type?.id) {
    fail(`ROH smoke could not create room types: ${roomTypeOne.response.status}/${roomTypeTwo.response.status} ${JSON.stringify({ one: roomTypeOne.body, two: roomTypeTwo.body })}`);
    return;
  }

  const roomUnitOne = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/room-units`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ room_type_id: roomTypeOne.body.room_type.id, room_number: `RH-${fixtureKey}-1`, floor_label: 'ROH', sort_order: 10011 }),
  });
  const roomUnitTwo = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/room-units`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ room_type_id: roomTypeTwo.body.room_type.id, room_number: `RH-${fixtureKey}-2`, floor_label: 'ROH', sort_order: 10012 }),
  });
  if (!roomUnitOne.response.ok || !roomUnitOne.body?.room_unit?.id || !roomUnitTwo.response.ok || !roomUnitTwo.body?.room_unit?.id) {
    fail(`ROH smoke could not create room units: ${roomUnitOne.response.status}/${roomUnitTwo.response.status} ${JSON.stringify({ one: roomUnitOne.body, two: roomUnitTwo.body })}`);
    return;
  }

  const rohCheckIn = '2026-11-20';
  const rohCheckOut = '2026-11-22';
  const rohAllotment = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/allotments`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      operator_name: `ROH Operator ${String(uniqueSuffix).slice(-4)}`,
      operator_code: 'ROH',
      source_ref: `ROH-${uniqueSuffix}`,
      check_in: rohCheckIn,
      check_out: rohCheckOut,
      release_date: '2026-11-18',
      rooms_blocked: 2,
      roh_capacity_filter: 'max_2',
      notes: 'ROH commitment smoke',
    }),
  });
  if (!rohAllotment.response.ok || !rohAllotment.body?.allotment?.id) {
    fail(`ROH smoke could not create ROH allotment: ${rohAllotment.response.status} ${JSON.stringify(rohAllotment.body)}`);
    return;
  }
  const allotmentId = rohAllotment.body.allotment.id;

  const allocation = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/allotments/${encodeURIComponent(allotmentId)}/allocate`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ allocation_source: 'manual_allocate' }),
  });
  if (!allocation.response.ok || !Array.isArray(allocation.body?.allocations) || allocation.body.allocations.length !== 2) {
    fail(`ROH smoke allocation did not materialize two room allocations: ${allocation.response.status} ${JSON.stringify(allocation.body)}`);
    return;
  }
  const allocatedRoomTypeId = String(allocation.body.allocations[0]?.room_type_id || '').trim();
  if (!allocatedRoomTypeId) {
    fail(`ROH smoke allocation did not return a concrete allocated room type: ${allocation.response.status} ${JSON.stringify(allocation.body)}`);
    return;
  }
  pass('ROH allotment allocated into concrete room units');

  const confirmed = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/allotments/${encodeURIComponent(allotmentId)}/confirm`, {
    method: 'POST',
    headers: authHeaders,
  });
  if (
    !confirmed.response.ok
    || confirmed.body?.allotment?.status !== 'confirmed'
    || !Array.isArray(confirmed.body?.rooming_list_entries)
    || confirmed.body.rooming_list_entries.length !== 2
    || !confirmed.body?.master_folio?.id
  ) {
    fail(`ROH smoke confirm did not seed rooming list and master folio: ${confirmed.response.status} ${JSON.stringify(confirmed.body)}`);
    return;
  }
  pass('ROH allotment confirm seeded rooming list and master folio');

  const freeSellBlockedByAllocation = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/reservations/plan`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      room_type_id: allocatedRoomTypeId,
      check_in: rohCheckIn,
      check_out: rohCheckOut,
      rooms_requested: 1,
    }),
  });
  if (!freeSellBlockedByAllocation.response.ok || freeSellBlockedByAllocation.body?.can_fulfill !== false) {
    fail(`ROH materialized allocation did not block free-sell planner inventory as expected: ${freeSellBlockedByAllocation.response.status} ${JSON.stringify(freeSellBlockedByAllocation.body)}`);
    return;
  }
  pass('ROH materialized allocations block free-sell planner inventory on their concrete lanes');

  const roomingList = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/allotments/${encodeURIComponent(allotmentId)}/rooming-list`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Tenant-ID': TENANT_ID },
  });
  if (!roomingList.response.ok || !Array.isArray(roomingList.body?.entries) || roomingList.body.entries.length !== 2) {
    fail(`ROH smoke could not list rooming entries: ${roomingList.response.status} ${JSON.stringify(roomingList.body)}`);
    return;
  }
  const [entryOne, entryTwo] = roomingList.body.entries;

  const roomingUpdateOne = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/allotments/${encodeURIComponent(allotmentId)}/rooming-list/${encodeURIComponent(entryOne.id)}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ display_name: 'Lead Guest', guest_name: 'Lead Guest', rooming_status: 'checked_in', payer_scope: 'master' }),
  });
  const roomingUpdateTwo = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/allotments/${encodeURIComponent(allotmentId)}/rooming-list/${encodeURIComponent(entryTwo.id)}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ display_name: 'Delegate Two', guest_name: 'Delegate Two', rooming_status: 'named', payer_scope: 'guest' }),
  });
  if (!roomingUpdateOne.response.ok || !roomingUpdateTwo.response.ok) {
    fail(`ROH smoke could not patch rooming entries: ${roomingUpdateOne.response.status}/${roomingUpdateTwo.response.status} ${JSON.stringify({ one: roomingUpdateOne.body, two: roomingUpdateTwo.body })}`);
    return;
  }
  pass('ROH rooming entries accept payer scope and guest labeling');

  const masterFolioPatch = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/allotments/${encodeURIComponent(allotmentId)}/master-folio`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ billing_mode: 'mixed', note: 'ROH routing smoke' }),
  });
  if (!masterFolioPatch.response.ok || masterFolioPatch.body?.master_folio?.billing_mode !== 'mixed') {
    fail(`ROH smoke could not switch master folio to mixed billing: ${masterFolioPatch.response.status} ${JSON.stringify(masterFolioPatch.body)}`);
    return;
  }

  const masterCharge = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/allotments/${encodeURIComponent(allotmentId)}/charges`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      rooming_entry_id: entryOne.id,
      line_type: 'service_charge',
      category: 'package',
      description: 'Group package',
      quantity: 1,
      unit_amount: 120,
      currency: 'USD',
    }),
  });
  const guestCharge = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/allotments/${encodeURIComponent(allotmentId)}/charges`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      rooming_entry_id: entryTwo.id,
      line_type: 'fee',
      category: 'incidentals',
      description: 'Mini bar',
      quantity: 1,
      unit_amount: 35,
      currency: 'USD',
    }),
  });
  if (!masterCharge.response.ok || masterCharge.body?.payer_scope !== 'master' || !masterCharge.body?.line?.id) {
    fail(`ROH smoke master charge did not route into master folio: ${masterCharge.response.status} ${JSON.stringify(masterCharge.body)}`);
    return;
  }
  if (!guestCharge.response.ok || guestCharge.body?.payer_scope !== 'guest' || !guestCharge.body?.deferred_guest_charge?.id) {
    fail(`ROH smoke guest charge did not defer to guest scope: ${guestCharge.response.status} ${JSON.stringify(guestCharge.body)}`);
    return;
  }
  pass('ROH charges route into master and deferred guest scope correctly');

  const masterFolioGet = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/allotments/${encodeURIComponent(allotmentId)}/master-folio`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Tenant-ID': TENANT_ID },
  });
  if (
    !masterFolioGet.response.ok
    || !Array.isArray(masterFolioGet.body?.lines)
    || masterFolioGet.body.lines.length !== 1
    || !Array.isArray(masterFolioGet.body?.deferred_guest_charges)
    || masterFolioGet.body.deferred_guest_charges.length !== 1
    || Number(masterFolioGet.body?.summary?.charge_total) !== 120
  ) {
    fail(`ROH smoke master folio payload did not expose routed lines and deferred guest charges: ${masterFolioGet.response.status} ${JSON.stringify(masterFolioGet.body)}`);
    return;
  }
  pass('Master folio exposes routed lines, deferred guest charges, and summary totals');

  const rackSummary = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/room-rack-summary?from_date=${encodeURIComponent(rohCheckIn)}&lookahead_days=14`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Tenant-ID': TENANT_ID },
  });
  const rackRows = Array.isArray(rackSummary.body?.summary) ? rackSummary.body.summary : [];
  const occupiedByOperator = rackRows.find((item) => String(item.current_allotment_id || '') === String(allotmentId) && String(item.current_allotment_rooming_status || '') === 'checked_in');
  const reservedByOperator = rackRows.find((item) => String(item.current_allotment_id || '') === String(allotmentId) && String(item.current_allotment_rooming_status || '') === 'named');
  if (
    !rackSummary.response.ok
    || !occupiedByOperator
    || !reservedByOperator
    || !String(occupiedByOperator.why_not_assignable || '').includes('Occupied by operator block')
    || !String(reservedByOperator.why_not_assignable || '').includes('Reserved by operator block')
  ) {
    fail(`ROH smoke rack summary did not expose B2B occupancy truth: ${rackSummary.response.status} ${JSON.stringify(rackSummary.body)}`);
    return;
  }
  pass('Rack summary exposes confirmed operator occupancy for housekeeping and rack visibility');
}

async function runPropertyAllotmentReworkSmoke(baseUrl, token) {
  info('Running property allotment rework smoke flow');

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'X-Tenant-ID': TENANT_ID,
    'Content-Type': 'application/json',
  };
  const fixtureKey = crypto.randomBytes(3).toString('hex').toUpperCase();

  const propertyList = await requestJson(`${baseUrl}/api/properties`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Tenant-ID': TENANT_ID },
  });
  if (!propertyList.response.ok || !Array.isArray(propertyList.body?.properties) || !propertyList.body.properties[0]?.id) {
    fail(`Allotment rework smoke could not list an existing property: ${propertyList.response.status} ${JSON.stringify(propertyList.body)}`);
    return;
  }
  const propertyId = propertyList.body.properties[0].id;

  const deluxeType = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/room-types`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ code: `DX${fixtureKey}`, name: `Deluxe ${fixtureKey}`, base_capacity: 2, max_occupancy: 2, sort_order: 12001 }),
  });
  const suiteType = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/room-types`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ code: `SU${fixtureKey}`, name: `Suite ${fixtureKey}`, base_capacity: 2, max_occupancy: 3, sort_order: 12002 }),
  });
  if (!deluxeType.response.ok || !suiteType.response.ok) {
    fail(`Allotment rework smoke could not create room types: ${JSON.stringify({ deluxe: deluxeType.body, suite: suiteType.body })}`);
    return;
  }

  const deluxeUnitOne = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/room-units`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ room_type_id: deluxeType.body.room_type.id, room_number: `DX-${fixtureKey}-1`, floor_label: 'RW', sort_order: 12011 }),
  });
  const deluxeUnitTwo = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/room-units`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ room_type_id: deluxeType.body.room_type.id, room_number: `DX-${fixtureKey}-2`, floor_label: 'RW', sort_order: 12012 }),
  });
  const suiteUnitOne = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/room-units`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ room_type_id: suiteType.body.room_type.id, room_number: `SU-${fixtureKey}-1`, floor_label: 'RW', sort_order: 12021 }),
  });
  const suiteUnitTwo = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/room-units`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ room_type_id: suiteType.body.room_type.id, room_number: `SU-${fixtureKey}-2`, floor_label: 'RW', sort_order: 12022 }),
  });
  if (![deluxeUnitOne, deluxeUnitTwo, suiteUnitOne, suiteUnitTwo].every((item) => item.response.ok && item.body?.room_unit?.id)) {
    fail(`Allotment rework smoke could not create room units: ${JSON.stringify({ deluxeUnitOne: deluxeUnitOne.body, deluxeUnitTwo: deluxeUnitTwo.body, suiteUnitOne: suiteUnitOne.body, suiteUnitTwo: suiteUnitTwo.body })}`);
    return;
  }

  const checkIn = '2026-12-10';
  const checkOut = '2026-12-12';
  const confirmedAllotment = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/allotments`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({
      operator_name: `Rework Operator ${fixtureKey}`,
      operator_code: `RW-${fixtureKey}`,
      room_type_id: deluxeType.body.room_type.id,
      rooms_blocked: 2,
      check_in: checkIn,
      check_out: checkOut,
      release_date: '2026-12-08',
      notes: 'rework smoke',
    }),
  });
  if (!confirmedAllotment.response.ok || !confirmedAllotment.body?.allotment?.id) {
    fail(`Allotment rework smoke could not create source allotment: ${confirmedAllotment.response.status} ${JSON.stringify(confirmedAllotment.body)}`);
    return;
  }
  const sourceAllotmentId = confirmedAllotment.body.allotment.id;

  const sourceAllocated = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/allotments/${encodeURIComponent(sourceAllotmentId)}/allocate`, {
    method: 'POST', headers: authHeaders, body: JSON.stringify({ allocation_source: 'manual_allocate' }),
  });
  const sourceConfirmed = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/allotments/${encodeURIComponent(sourceAllotmentId)}/confirm`, {
    method: 'POST', headers: authHeaders,
  });
  if (!sourceAllocated.response.ok || !sourceConfirmed.response.ok || sourceConfirmed.body?.allotment?.status !== 'confirmed') {
    fail(`Allotment rework smoke could not prepare confirmed source allotment: ${JSON.stringify({ allocate: sourceAllocated.body, confirm: sourceConfirmed.body })}`);
    return;
  }

  const shrinkPreview = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/allotments/${encodeURIComponent(sourceAllotmentId)}/rework-preview`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ rooms_blocked: 1 }),
  });
  if (!shrinkPreview.response.ok || !shrinkPreview.body?.policy?.can_apply || Number(shrinkPreview.body?.impact?.released_allocations) !== 1) {
    fail(`Allotment rework preview did not expose shrink impact correctly: ${shrinkPreview.response.status} ${JSON.stringify(shrinkPreview.body)}`);
    return;
  }
  pass('Allotment rework preview exposes room-level shrink impact before apply');

  const shrinkApply = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/allotments/${encodeURIComponent(sourceAllotmentId)}/rework-apply`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ rooms_blocked: 1 }),
  });
  if (!shrinkApply.response.ok || Number(shrinkApply.body?.allocations?.length || 0) !== 1 || Number(shrinkApply.body?.preview?.impact?.released_allocations || 0) !== 1) {
    fail(`Allotment rework apply did not reduce the confirmed block in place: ${shrinkApply.response.status} ${JSON.stringify(shrinkApply.body)}`);
    return;
  }
  pass('Allotment rework apply preserves and releases concrete lanes correctly');

  const splitCheckIn = '2026-12-14';
  const splitCheckOut = '2026-12-16';
  const splitSource = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/allotments`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({
      operator_name: `Split Operator ${fixtureKey}`,
      operator_code: `SP-${fixtureKey}`,
      room_type_id: deluxeType.body.room_type.id,
      rooms_blocked: 2,
      check_in: splitCheckIn,
      check_out: splitCheckOut,
      release_date: '2026-12-12',
      notes: 'split smoke',
    }),
  });
  if (!splitSource.response.ok || !splitSource.body?.allotment?.id) {
    fail(`Allotment split smoke could not create split source: ${splitSource.response.status} ${JSON.stringify(splitSource.body)}`);
    return;
  }
  const splitSourceId = splitSource.body.allotment.id;
  const splitAllocated = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/allotments/${encodeURIComponent(splitSourceId)}/allocate`, {
    method: 'POST', headers: authHeaders, body: JSON.stringify({ allocation_source: 'manual_allocate' }),
  });
  const splitConfirmed = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/allotments/${encodeURIComponent(splitSourceId)}/confirm`, {
    method: 'POST', headers: authHeaders,
  });
  if (!splitAllocated.response.ok || !splitConfirmed.response.ok || splitConfirmed.body?.allotment?.status !== 'confirmed') {
    fail(`Allotment split smoke could not prepare confirmed split source: ${JSON.stringify({ allocate: splitAllocated.body, confirm: splitConfirmed.body })}`);
    return;
  }

  const splitApply = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/allotments/${encodeURIComponent(splitSourceId)}/split`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({
      room_type_id: suiteType.body.room_type.id,
      rooms_blocked: 1,
      check_in: splitCheckIn,
      check_out: splitCheckOut,
      release_date: '2026-12-12',
      notes: 'split child smoke',
    }),
  });
  if (!splitApply.response.ok || splitApply.body?.child_allotment?.status !== 'confirmed' || Number(splitApply.body?.child_allocations?.length || 0) !== 1) {
    fail(`Allotment split did not create a confirmed child commitment: ${splitApply.response.status} ${JSON.stringify(splitApply.body)}`);
    return;
  }

  const sourceAfterSplit = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/allotments?status=all&from_date=2026-12-13&days=5`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Tenant-ID': TENANT_ID },
  });
  const sourceRow = Array.isArray(sourceAfterSplit.body?.allotments)
    ? sourceAfterSplit.body.allotments.find((item) => String(item.id) === String(splitSourceId))
    : null;
  if (!sourceAfterSplit.response.ok || !sourceRow || Number(sourceRow.rooms_blocked || 0) !== 1) {
    fail(`Allotment split did not reduce the source commitment correctly: ${sourceAfterSplit.response.status} ${JSON.stringify(sourceAfterSplit.body)}`);
    return;
  }
  pass('Allotment split creates a confirmed child commitment and reduces the source block');
}

async function runPropertyPricingProfileSmoke(baseUrl, token) {
  info('Running property pricing profile smoke flow');

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'X-Tenant-ID': TENANT_ID,
    'Content-Type': 'application/json',
  };
  const uniqueSuffix = String(Date.now());

  const propertyList = await requestJson(`${baseUrl}/api/properties`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Tenant-ID': TENANT_ID,
    },
  });
  if (!propertyList.response.ok || !propertyList.body?.ok || !Array.isArray(propertyList.body?.properties)) {
    fail(`Pricing profile smoke could not list properties: ${propertyList.response.status} ${JSON.stringify(propertyList.body)}`);
    return;
  }

  let propertyId = propertyList.body.properties[0]?.id || null;
  if (!propertyId) {
    const propertyCreate = await requestJson(`${baseUrl}/api/properties`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: `Profile Smoke ${uniqueSuffix}`,
        slug: `profile-smoke-${uniqueSuffix}`,
      }),
    });
    if (!propertyCreate.response.ok || !propertyCreate.body?.property?.id) {
      fail(`Pricing profile smoke could not create a property: ${propertyCreate.response.status} ${JSON.stringify(propertyCreate.body)}`);
      return;
    }
    propertyId = propertyCreate.body.property.id;
  }

  const roomTypeCreate = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/room-types`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      code: `PF${uniqueSuffix.slice(-6)}`,
      name: `Profile Type ${uniqueSuffix.slice(-4)}`,
      base_capacity: 2,
      max_occupancy: 2,
      sort_order: 9995,
    }),
  });
  if (!roomTypeCreate.response.ok || !roomTypeCreate.body?.room_type?.id) {
    fail(`Pricing profile smoke could not create a room type: ${roomTypeCreate.response.status} ${JSON.stringify(roomTypeCreate.body)}`);
    return;
  }
  const roomTypeId = roomTypeCreate.body.room_type.id;

  const roomUnitCreate = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/room-units`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      room_type_id: roomTypeId,
      room_number: `PF-${uniqueSuffix.slice(-4)}-1`,
      floor_label: 'Profile Smoke',
      sort_order: 9996,
    }),
  });
  if (!roomUnitCreate.response.ok || !roomUnitCreate.body?.room_unit?.id) {
    fail(`Pricing profile smoke could not create a room unit: ${roomUnitCreate.response.status} ${JSON.stringify(roomUnitCreate.body)}`);
    return;
  }

  const baseRateCreate = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/room-rates`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      room_type_id: roomTypeId,
      rate_name: 'Smoke BAR',
      currency: 'USD',
      nightly_amount: 100,
      included_adults: 2,
      included_children: 0,
      extra_adult_amount: 0,
      extra_child_amount: 0,
      active: 1,
    }),
  });
  if (!baseRateCreate.response.ok || !baseRateCreate.body?.room_rate?.id) {
    fail(`Pricing profile smoke could not create a base room rate: ${baseRateCreate.response.status} ${JSON.stringify(baseRateCreate.body)}`);
    return;
  }

  const pricingProfileCreate = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/pricing-profiles`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      room_type_id: roomTypeId,
      code: `GROUP-${uniqueSuffix.slice(-4)}`,
      name: 'Group Contract',
      visibility: 'planner_only',
      pricing_mode: 'delta_amount',
      delta_amount: -15,
      notes: 'Smoke test planner-only pricing profile',
      active: 1,
    }),
  });
  if (!pricingProfileCreate.response.ok || !pricingProfileCreate.body?.pricing_profile?.id) {
    fail(`Pricing profile smoke could not create a pricing profile: ${pricingProfileCreate.response.status} ${JSON.stringify(pricingProfileCreate.body)}`);
    return;
  }
  const pricingProfileId = pricingProfileCreate.body.pricing_profile.id;

  const pricingProfileList = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/pricing-profiles`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Tenant-ID': TENANT_ID,
    },
  });
  if (
    !pricingProfileList.response.ok
    || !Array.isArray(pricingProfileList.body?.pricing_profiles)
    || !pricingProfileList.body.pricing_profiles.some((profile) => String(profile.id) === String(pricingProfileId))
  ) {
    fail(`Pricing profile smoke could not list the created pricing profile: ${pricingProfileList.response.status} ${JSON.stringify(pricingProfileList.body)}`);
    return;
  }
  pass('Planner-only pricing profile CRUD baseline is available');

  const quoted = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/rates/quote`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      room_type_id: roomTypeId,
      check_in: '2026-10-10',
      check_out: '2026-10-12',
      adults: 2,
      children: 0,
      rooms_requested: 1,
      pricing_profile_id: pricingProfileId,
    }),
  });
  if (
    !quoted.response.ok
    || quoted.body?.pricing?.pricing_profile?.id !== pricingProfileId
    || Number(quoted.body?.pricing?.total_amount) !== 170
    || !Array.isArray(quoted.body?.pricing?.nightly_breakdown)
    || quoted.body.pricing.nightly_breakdown.some((night) => Number(night.nightly_amount) !== 85)
  ) {
    fail(`Pricing profile smoke quote did not apply the planner overlay as expected: ${quoted.response.status} ${JSON.stringify(quoted.body)}`);
    return;
  }
  pass('Quote endpoint applies planner-only pricing profiles on top of base nightly rates');

  const plannerPreview = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/reservations/plan`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      room_type_id: roomTypeId,
      check_in: '2026-10-10',
      check_out: '2026-10-12',
      adults: 2,
      children: 0,
      rooms_requested: 1,
      pricing_profile_id: pricingProfileId,
    }),
  });
  if (
    !plannerPreview.response.ok
    || plannerPreview.body?.can_fulfill !== true
    || plannerPreview.body?.selected_plan_pricing?.pricing_profile?.id !== pricingProfileId
    || Number(plannerPreview.body?.selected_plan_pricing?.total_amount) !== 170
    || !Array.isArray(plannerPreview.body?.selected_plan_pricing?.nightly_breakdown)
    || plannerPreview.body.selected_plan_pricing.nightly_breakdown.some((night) => Number(night.nightly_total) !== 85)
  ) {
    fail(`Planner preview did not expose selected-plan pricing with the chosen profile: ${plannerPreview.response.status} ${JSON.stringify(plannerPreview.body)}`);
    return;
  }
  pass('Planner preview exposes selected-plan pricing with the chosen pricing profile before commit');

  const scarcityPreview = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/reservations/plan`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      room_type_id: roomTypeId,
      check_in: '2026-10-10',
      check_out: '2026-10-12',
      adults: 2,
      children: 0,
      rooms_requested: 1,
      pricing_profile_id: pricingProfileId,
      scarcity_preview: {
        enabled: true,
        threshold_remaining: 1,
        surcharge_amount: 12,
        max_total_amount: 20,
      },
    }),
  });
  if (
    !scarcityPreview.response.ok
    || scarcityPreview.body?.selected_plan_pricing?.scarcity_preview?.applied !== true
    || Number(scarcityPreview.body?.selected_plan_pricing?.scarcity_preview?.total_surcharge_amount) !== 20
    || Number(scarcityPreview.body?.selected_plan_pricing?.total_amount) !== 190
    || !Array.isArray(scarcityPreview.body?.selected_plan_pricing?.nightly_breakdown)
    || scarcityPreview.body.selected_plan_pricing.nightly_breakdown.every((night) => Number(night?.scarcity_adjustment?.applied_amount || 0) < 1)
  ) {
    fail(`Planner preview did not apply capped manual scarcity pricing as expected: ${scarcityPreview.response.status} ${JSON.stringify(scarcityPreview.body)}`);
    return;
  }
  pass('Planner preview applies capped manual scarcity pricing only in preview mode');

  const reservationCreate = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/reservations`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      room_type_id: roomTypeId,
      check_in: '2026-10-10',
      check_out: '2026-10-12',
      rooms_requested: 1,
      guest_name: `Profile Snapshot ${uniqueSuffix}`,
      adults: 2,
      children: 0,
      source: 'manual_frontdesk',
      pricing_profile_id: pricingProfileId,
    }),
  });
  if (!reservationCreate.response.ok || !reservationCreate.body?.reservation?.id) {
    fail(`Pricing profile smoke could not create a reservation with a frozen snapshot: ${reservationCreate.response.status} ${JSON.stringify(reservationCreate.body)}`);
    return;
  }
  const reservationId = reservationCreate.body.reservation.id;

  const reservationGet = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Tenant-ID': TENANT_ID,
    },
  });
  const snapshot = reservationGet.body?.reservation?.pricing_snapshot;
  const frozenNightly = Array.isArray(snapshot?.nightly_breakdown)
    ? snapshot.nightly_breakdown.find((night) => String(night?.stay_date || '') === '2026-10-10')
    : null;
  if (
    !reservationGet.response.ok
    || snapshot?.pricing_profile_id !== pricingProfileId
    || snapshot?.snapshot_capture_status !== 'frozen_quote'
    || Number(snapshot?.total_amount) !== 170
    || Number(frozenNightly?.nightly_total) !== 85
  ) {
    fail(`Reservation create did not freeze the quoted pricing decision: ${reservationGet.response.status} ${JSON.stringify(reservationGet.body)}`);
    return;
  }
  pass('Reservation create freezes the nightly commercial breakdown into pricing_snapshot');

  const reservationCheckIn = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/check-in`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ assigned_room_unit_id: roomUnitCreate.body.room_unit.id }),
  });
  if (!reservationCheckIn.response.ok) {
    fail(`Pricing profile smoke could not check in the reservation before night audit: ${reservationCheckIn.response.status} ${JSON.stringify(reservationCheckIn.body)}`);
    return;
  }

  const baseRatePatch = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/room-rates/${encodeURIComponent(baseRateCreate.body.room_rate.id)}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ nightly_amount: 250 }),
  });
  if (!baseRatePatch.response.ok) {
    fail(`Pricing profile smoke could not change the live base rate after reservation freeze: ${baseRatePatch.response.status} ${JSON.stringify(baseRatePatch.body)}`);
    return;
  }

  const nightAudit = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/folios/night-audit`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ audit_date: '2026-10-10' }),
  });
  if (!nightAudit.response.ok || Number(nightAudit.body?.room_charge_lines_posted) !== 1) {
    fail(`Pricing profile smoke night audit did not post exactly one room charge: ${nightAudit.response.status} ${JSON.stringify(nightAudit.body)}`);
    return;
  }

  const folioGet = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/folio`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Tenant-ID': TENANT_ID,
    },
  });
  const auditLine = Array.isArray(folioGet.body?.lines)
    ? folioGet.body.lines.find((line) => String(line?.note || '') === 'night_audit:2026-10-10')
    : null;
  if (
    !folioGet.response.ok
    || !auditLine
    || Number(auditLine.unit_amount) !== 85
    || Number(auditLine.total_amount) !== 85
    || String(auditLine.currency || '') !== 'USD'
  ) {
    fail(`Night audit did not honor the frozen reservation snapshot after live rates changed: ${folioGet.response.status} ${JSON.stringify(folioGet.body)}`);
    return;
  }
  pass('Night audit posts the frozen nightly charge from pricing_snapshot before any live-rate fallback');
}

async function runPropertyWeekdayPricingSmoke(baseUrl, token) {
  info('Running property weekday pricing smoke flow');

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'X-Tenant-ID': TENANT_ID,
    'Content-Type': 'application/json',
  };
  const uniqueSuffix = String(Date.now());

  const propertyList = await requestJson(`${baseUrl}/api/properties`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Tenant-ID': TENANT_ID,
    },
  });
  if (!propertyList.response.ok || !propertyList.body?.ok || !Array.isArray(propertyList.body?.properties)) {
    fail(`Weekday pricing smoke could not list properties: ${propertyList.response.status} ${JSON.stringify(propertyList.body)}`);
    return;
  }

  let propertyId = propertyList.body.properties[0]?.id || null;
  if (!propertyId) {
    const propertyCreate = await requestJson(`${baseUrl}/api/properties`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: `Weekday Smoke ${uniqueSuffix}`,
        slug: `weekday-smoke-${uniqueSuffix}`,
      }),
    });
    if (!propertyCreate.response.ok || !propertyCreate.body?.property?.id) {
      fail(`Weekday pricing smoke could not create a property: ${propertyCreate.response.status} ${JSON.stringify(propertyCreate.body)}`);
      return;
    }
    propertyId = propertyCreate.body.property.id;
  }

  const roomTypeCreate = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/room-types`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      code: `WD${uniqueSuffix.slice(-6)}`,
      name: `Weekday Type ${uniqueSuffix.slice(-4)}`,
      base_capacity: 2,
      max_occupancy: 2,
      sort_order: 9994,
    }),
  });
  if (!roomTypeCreate.response.ok || !roomTypeCreate.body?.room_type?.id) {
    fail(`Weekday pricing smoke could not create a room type: ${roomTypeCreate.response.status} ${JSON.stringify(roomTypeCreate.body)}`);
    return;
  }
  const roomTypeId = roomTypeCreate.body.room_type.id;

  const roomUnitCreate = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/room-units`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      room_type_id: roomTypeId,
      room_number: `WD-${uniqueSuffix.slice(-4)}-1`,
      floor_label: 'Weekday Smoke',
      sort_order: 9994,
    }),
  });
  if (!roomUnitCreate.response.ok || !roomUnitCreate.body?.room_unit?.id) {
    fail(`Weekday pricing smoke could not create a room unit: ${roomUnitCreate.response.status} ${JSON.stringify(roomUnitCreate.body)}`);
    return;
  }

  const baseRateCreate = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/room-rates`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      room_type_id: roomTypeId,
      rate_name: 'Weekday BAR',
      currency: 'USD',
      nightly_amount: 100,
      included_adults: 2,
      included_children: 0,
      extra_adult_amount: 0,
      extra_child_amount: 0,
      active: 1,
    }),
  });
  if (!baseRateCreate.response.ok || !baseRateCreate.body?.room_rate?.id) {
    fail(`Weekday pricing smoke could not create a base room rate: ${baseRateCreate.response.status} ${JSON.stringify(baseRateCreate.body)}`);
    return;
  }

  const weekdayRuleCreate = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/weekday-pricing-rules`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      room_type_id: roomTypeId,
      day_of_week: 6,
      name: 'Saturday uplift',
      pricing_mode: 'delta_amount',
      delta_amount: 20,
      notes: 'Weekend uplift smoke rule',
      active: 1,
    }),
  });
  if (!weekdayRuleCreate.response.ok || !weekdayRuleCreate.body?.weekday_pricing_rule?.id) {
    fail(`Weekday pricing smoke could not create a weekday rule: ${weekdayRuleCreate.response.status} ${JSON.stringify(weekdayRuleCreate.body)}`);
    return;
  }
  const weekdayRuleId = weekdayRuleCreate.body.weekday_pricing_rule.id;

  const weekdayRuleList = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/weekday-pricing-rules`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Tenant-ID': TENANT_ID,
    },
  });
  if (
    !weekdayRuleList.response.ok
    || !Array.isArray(weekdayRuleList.body?.weekday_pricing_rules)
    || !weekdayRuleList.body.weekday_pricing_rules.some((rule) => String(rule.id) === String(weekdayRuleId))
  ) {
    fail(`Weekday pricing smoke could not list the created weekday rule: ${weekdayRuleList.response.status} ${JSON.stringify(weekdayRuleList.body)}`);
    return;
  }
  pass('Weekday pricing rule CRUD baseline is available');

  const quoted = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/rates/quote`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      room_type_id: roomTypeId,
      check_in: '2026-10-09',
      check_out: '2026-10-12',
      adults: 2,
      children: 0,
      rooms_requested: 1,
    }),
  });
  const saturdayQuote = Array.isArray(quoted.body?.pricing?.nightly_breakdown)
    ? quoted.body.pricing.nightly_breakdown.find((night) => String(night?.stay_date || '') === '2026-10-10')
    : null;
  if (
    !quoted.response.ok
    || Number(quoted.body?.pricing?.total_amount) !== 320
    || !Array.isArray(quoted.body?.pricing?.nightly_breakdown)
    || Number(quoted.body.pricing.nightly_breakdown[0]?.nightly_amount) !== 100
    || Number(saturdayQuote?.nightly_amount) !== 120
    || saturdayQuote?.weekday_adjustment?.day_name !== 'Saturday'
    || Number(saturdayQuote?.weekday_adjustment?.adjustment_amount) !== 20
  ) {
    fail(`Weekday pricing quote did not apply the Saturday uplift as expected: ${quoted.response.status} ${JSON.stringify(quoted.body)}`);
    return;
  }
  pass('Quote endpoint applies deterministic weekday adjustments and exposes them in nightly breakdowns');

  const reservationCreate = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/reservations`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      room_type_id: roomTypeId,
      check_in: '2026-10-09',
      check_out: '2026-10-12',
      rooms_requested: 1,
      guest_name: `Weekday Snapshot ${uniqueSuffix}`,
      adults: 2,
      children: 0,
      source: 'manual_frontdesk',
    }),
  });
  if (!reservationCreate.response.ok || !reservationCreate.body?.reservation?.id) {
    fail(`Weekday pricing smoke could not create a reservation with frozen weekday pricing: ${reservationCreate.response.status} ${JSON.stringify(reservationCreate.body)}`);
    return;
  }
  const reservationId = reservationCreate.body.reservation.id;

  const reservationGet = await requestJson(`${baseUrl}/api/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Tenant-ID': TENANT_ID,
    },
  });
  const snapshot = reservationGet.body?.reservation?.pricing_snapshot;
  const saturdaySnapshot = Array.isArray(snapshot?.nightly_breakdown)
    ? snapshot.nightly_breakdown.find((night) => String(night?.stay_date || '') === '2026-10-10')
    : null;
  if (
    !reservationGet.response.ok
    || snapshot?.snapshot_capture_status !== 'frozen_quote'
    || Number(snapshot?.total_amount) !== 320
    || Number(saturdaySnapshot?.nightly_total) !== 120
    || saturdaySnapshot?.weekday_adjustment?.day_name !== 'Saturday'
  ) {
    fail(`Reservation snapshot did not preserve the weekday adjustment breakdown: ${reservationGet.response.status} ${JSON.stringify(reservationGet.body)}`);
    return;
  }
  pass('Reservation pricing snapshot preserves weekday adjustments from the shared quote resolver');
}

async function runAdminTenantSmoke(baseUrl, adminSecret) {
  info('Running admin tenant management smoke flow');

  // 1. GET requires X-Admin-Secret
  {
    const res = await fetch(`${baseUrl}/api/admin/tenants`);
    if (res.status !== 401) {
      fail(`GET /api/admin/tenants must require X-Admin-Secret, got ${res.status}`); return;
    }
    pass('GET /api/admin/tenants requires X-Admin-Secret');
  }

  // 2. GET returns ok + tenants array
  {
    const res = await fetch(`${baseUrl}/api/admin/tenants`, {
      headers: { 'X-Admin-Secret': adminSecret },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok || !Array.isArray(body?.tenants)) {
      fail(`GET /api/admin/tenants returned unexpected result: ${res.status} ${JSON.stringify(body)}`); return;
    }
    if (body.tenants.length === 0) {
      fail('GET /api/admin/tenants returned empty list — expected at least 1 tenant'); return;
    }
    pass('GET /api/admin/tenants returns tenant list');
  }

  // 3. GET with ?status=TRIAL filter returns only TRIAL tenants
  {
    const res = await fetch(`${baseUrl}/api/admin/tenants?status=TRIAL`, {
      headers: { 'X-Admin-Secret': adminSecret },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) {
      fail(`GET /api/admin/tenants?status=TRIAL failed: ${res.status}`); return;
    }
    const allTrial = (body.tenants || []).every((t) => t.subscription_status === 'TRIAL');
    if (!allTrial) {
      fail(`GET /api/admin/tenants?status=TRIAL returned non-TRIAL tenants: ${JSON.stringify(body.tenants.map((t) => t.subscription_status))}`); return;
    }
    pass('GET /api/admin/tenants?status=TRIAL returns only TRIAL tenants');
  }

  // 4. POST set-subscription requires X-Admin-Secret
  {
    const res = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/set-subscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ACTIVE' }),
    });
    if (res.status !== 401) {
      fail(`POST set-subscription must require X-Admin-Secret, got ${res.status}`); return;
    }
    pass('POST /api/admin/tenants/:id/set-subscription requires X-Admin-Secret');
  }

  // 5. POST set-subscription rejects invalid status
  {
    const res = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/set-subscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': adminSecret },
      body: JSON.stringify({ status: 'BOGUS' }),
    });
    if (res.status !== 400) {
      fail(`POST set-subscription should reject invalid status with 400, got ${res.status}`); return;
    }
    pass('POST set-subscription rejects invalid status with 400');
  }

  // 6. POST set-subscription round-trip TRIAL → ACTIVE → TRIAL
  {
    const r1 = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/set-subscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': adminSecret },
      body: JSON.stringify({ status: 'ACTIVE', note: 'smoke test' }),
    });
    const b1 = await r1.json().catch(() => null);
    if (!r1.ok || b1?.status !== 'ACTIVE') {
      fail(`POST set-subscription ACTIVE failed: ${r1.status} ${JSON.stringify(b1)}`); return;
    }
    // restore to TRIAL
    const r2 = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/set-subscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': adminSecret },
      body: JSON.stringify({ status: 'TRIAL' }),
    });
    const b2 = await r2.json().catch(() => null);
    if (!r2.ok || b2?.status !== 'TRIAL') {
      fail(`POST set-subscription restore TRIAL failed: ${r2.status} ${JSON.stringify(b2)}`); return;
    }
    pass('POST set-subscription TRIAL→ACTIVE→TRIAL round-trip succeeds');
  }
}

async function main() {
  let server = null;
  try {
    ensureTenantFixtures();
    const { baseUrl, server: spawnedServer } = await resolveBaseUrl();
    server = spawnedServer;

    await runTenantRouteBootSmoke(baseUrl);
    await runAiModerationFallbackSmoke();

    const token = mintBearerToken();
    const adminSecret = getLocalAdminSecret();
    await runSubdomainPolicySmoke(baseUrl, token);
    await runAssetModerationSmoke(baseUrl, token);
    await runTaskSmoke(baseUrl, token);
    await runPricingSmoke(baseUrl, token);
    await runBookingSmoke(baseUrl, token, adminSecret);
    await runPublicHotelSmoke(baseUrl, token);
    await runPasswordResetSmoke(baseUrl, token);
    // Password reset invalidates the previous session — mint a fresh token for
    // tests that run after the password-reset smoke.
    const freshToken = mintBearerToken();
    await runDomainSmoke(baseUrl, freshToken);
    await runDomainVerifySmoke(baseUrl, freshToken);
    await runPropertyReservationPlannerSmoke(baseUrl, freshToken);
    await runPropertyRohCommitmentSmoke(baseUrl, freshToken);
    await runPropertyAllotmentReworkSmoke(baseUrl, freshToken);
    await runPropertyPricingProfileSmoke(baseUrl, freshToken);
    await runPropertyWeekdayPricingSmoke(baseUrl, freshToken);
    await runAdminTenantSmoke(baseUrl, adminSecret);
  } finally {
    if (server) {
      info('Stopping Wrangler dev started by smoke test');
      server.kill();
    }
  }

  if (failures > 0) {
    console.error(`Smoke test completed with ${failures} failure(s).`);
    process.exit(1);
  }

  console.log('Smoke test completed successfully.');
}

main().catch((error) => {
  console.error(`Smoke test aborted: ${error.message}`);
  process.exit(1);
});