import { spawnSync, spawn } from 'node:child_process';
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
const FETCH_RETRY_DELAYS_MS = [250, 750, 1500];

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
    const response = await fetch(`${baseUrl}/api/auth/session`);
    return response.ok;
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

async function resolveBaseUrl() {
  if (process.env.SMOKE_BASE_URL) {
    return { baseUrl: process.env.SMOKE_BASE_URL, server: null, reused: true };
  }

  const baseUrl = `http://127.0.0.1:${SPAWN_PORT}`;
  info(`No running local Worker detected, starting Wrangler dev on ${baseUrl}`);

  const child = process.platform === 'win32'
    ? spawn(POWERSHELL_BIN, ['-NoProfile', '-Command', `& ${quotePowerShell(NPX_BIN)} 'wrangler' 'dev' '--config' './wrangler.jsonc' '--port' '${String(SPAWN_PORT)}'`], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    : spawn(NPX_BIN, ['wrangler', 'dev', '--config', './wrangler.jsonc', '--port', String(SPAWN_PORT)], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

  child.stdout.on('data', (chunk) => process.stdout.write(String(chunk)));
  child.stderr.on('data', (chunk) => process.stderr.write(String(chunk)));

  const ready = await waitForServer(baseUrl, 45000);
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

async function runBookingSmoke(baseUrl) {
  info('Running booking confirm smoke flow');

  const order = await requestJson(`${baseUrl}/api/bookings/order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-ID': TENANT_ID,
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

  const proof = await requestJson(`${baseUrl}/api/bookings/order/${orderId}/proof`, {
    method: 'POST',
    headers: {
      'X-Tenant-ID': TENANT_ID,
    },
    body: proofForm,
  });

  if (!proof.response.ok || proof.body?.status !== 'PROOF_UPLOADED') {
    fail(`Booking smoke proof upload failed: ${proof.text}`);
    return;
  }
  pass('Uploaded booking proof and reached PROOF_UPLOADED');

  const confirm = await requestJson(`${baseUrl}/api/bookings/order/${orderId}/confirm-receipt`, {
    method: 'POST',
    headers: {
      'X-Tenant-ID': TENANT_ID,
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

async function main() {
  let server = null;
  try {
    ensureTenantFixtures();
    const { baseUrl, server: spawnedServer } = await resolveBaseUrl();
    server = spawnedServer;

    await runTenantRouteBootSmoke(baseUrl);
    await runAiModerationFallbackSmoke();

    const token = mintBearerToken();
    await runSubdomainPolicySmoke(baseUrl, token);
    await runAssetModerationSmoke(baseUrl, token);
    await runTaskSmoke(baseUrl, token);
    await runPricingSmoke(baseUrl, token);
    await runBookingSmoke(baseUrl);
    await runPasswordResetSmoke(baseUrl, token);
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