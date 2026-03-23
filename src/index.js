var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// node_modules/unenv/dist/runtime/_internal/utils.mjs
// @__NO_SIDE_EFFECTS__
function createNotImplementedError(name) {
  return new Error(`[unenv] ${name} is not implemented yet!`);
}
__name(createNotImplementedError, "createNotImplementedError");

// node_modules/unenv/dist/runtime/node/internal/perf_hooks/performance.mjs
var _timeOrigin = globalThis.performance?.timeOrigin ?? Date.now();
var _performanceNow = globalThis.performance?.now ? globalThis.performance.now.bind(globalThis.performance) : () => Date.now() - _timeOrigin;
var nodeTiming = {
  name: "node",
  entryType: "node",
  startTime: 0,
  duration: 0,
  nodeStart: 0,
  v8Start: 0,
  bootstrapComplete: 0,
  environment: 0,
  loopStart: 0,
  loopExit: 0,
  idleTime: 0,
  uvMetricsInfo: {
    loopCount: 0,
    events: 0,
    eventsWaiting: 0
  },
  detail: void 0,
  toJSON() {
    return this;
  }
};
var PerformanceEntry = class {
  static {
    __name(this, "PerformanceEntry");
  }
  __unenv__ = true;
  detail;
  entryType = "event";
  name;
  startTime;
  constructor(name, options) {
    this.name = name;
    this.startTime = options?.startTime || _performanceNow();
    this.detail = options?.detail;
  }
  get duration() {
    return _performanceNow() - this.startTime;
  }
  toJSON() {
    return {
      name: this.name,
      entryType: this.entryType,
      startTime: this.startTime,
      duration: this.duration,
      detail: this.detail
    };
  }
};
var PerformanceMark = class PerformanceMark2 extends PerformanceEntry {
  static {
    __name(this, "PerformanceMark");
  }
  entryType = "mark";
  constructor() {
    super(...arguments);
  }
  get duration() {
    return 0;
  }
};
var PerformanceMeasure = class extends PerformanceEntry {
  static {
    __name(this, "PerformanceMeasure");
  }
  entryType = "measure";
};
var PerformanceResourceTiming = class extends PerformanceEntry {
  static {
    __name(this, "PerformanceResourceTiming");
  }
  entryType = "resource";
  serverTiming = [];
  connectEnd = 0;
  connectStart = 0;
  decodedBodySize = 0;
  domainLookupEnd = 0;
  domainLookupStart = 0;
  encodedBodySize = 0;
  fetchStart = 0;
  initiatorType = "";
  name = "";
  nextHopProtocol = "";
  redirectEnd = 0;
  redirectStart = 0;
  requestStart = 0;
  responseEnd = 0;
  responseStart = 0;
  secureConnectionStart = 0;
  startTime = 0;
  transferSize = 0;
  workerStart = 0;
  responseStatus = 0;
};
var PerformanceObserverEntryList = class {
  static {
    __name(this, "PerformanceObserverEntryList");
  }
  __unenv__ = true;
  getEntries() {
    return [];
  }
  getEntriesByName(_name, _type) {
    return [];
  }
  getEntriesByType(type) {
    return [];
  }
};
var Performance = class {
  static {
    __name(this, "Performance");
  }
  __unenv__ = true;
  timeOrigin = _timeOrigin;
  eventCounts = /* @__PURE__ */ new Map();
  _entries = [];
  _resourceTimingBufferSize = 0;
  navigation = void 0;
  timing = void 0;
  timerify(_fn, _options) {
    throw createNotImplementedError("Performance.timerify");
  }
  get nodeTiming() {
    return nodeTiming;
  }
  eventLoopUtilization() {
    return {};
  }
  markResourceTiming() {
    return new PerformanceResourceTiming("");
  }
  onresourcetimingbufferfull = null;
  now() {
    if (this.timeOrigin === _timeOrigin) {
      return _performanceNow();
    }
    return Date.now() - this.timeOrigin;
  }
  clearMarks(markName) {
    this._entries = markName ? this._entries.filter((e) => e.name !== markName) : this._entries.filter((e) => e.entryType !== "mark");
  }
  clearMeasures(measureName) {
    this._entries = measureName ? this._entries.filter((e) => e.name !== measureName) : this._entries.filter((e) => e.entryType !== "measure");
  }
  clearResourceTimings() {
    this._entries = this._entries.filter((e) => e.entryType !== "resource" || e.entryType !== "navigation");
  }
  getEntries() {
    return this._entries;
  }
  getEntriesByName(name, type) {
    return this._entries.filter((e) => e.name === name && (!type || e.entryType === type));
  }
  getEntriesByType(type) {
    return this._entries.filter((e) => e.entryType === type);
  }
  mark(name, options) {
    const entry = new PerformanceMark(name, options);
    this._entries.push(entry);
    return entry;
  }
  measure(measureName, startOrMeasureOptions, endMark) {
    let start;
    let end;
    if (typeof startOrMeasureOptions === "string") {
      start = this.getEntriesByName(startOrMeasureOptions, "mark")[0]?.startTime;
      end = this.getEntriesByName(endMark, "mark")[0]?.startTime;
    } else {
      start = Number.parseFloat(startOrMeasureOptions?.start) || this.now();
      end = Number.parseFloat(startOrMeasureOptions?.end) || this.now();
    }
    const entry = new PerformanceMeasure(measureName, {
      startTime: start,
      detail: {
        start,
        end
      }
    });
    this._entries.push(entry);
    return entry;
  }
  setResourceTimingBufferSize(maxSize) {
    this._resourceTimingBufferSize = maxSize;
  }
  addEventListener(type, listener, options) {
    throw createNotImplementedError("Performance.addEventListener");
  }
  removeEventListener(type, listener, options) {
    throw createNotImplementedError("Performance.removeEventListener");
  }
  dispatchEvent(event) {
    throw createNotImplementedError("Performance.dispatchEvent");
  }
  toJSON() {
    return this;
  }
};
var PerformanceObserver = class {
  static {
    __name(this, "PerformanceObserver");
  }
  __unenv__ = true;
  static supportedEntryTypes = [];
  _callback = null;
  constructor(callback) {
    this._callback = callback;
  }
  takeRecords() {
    return [];
  }
  disconnect() {
    throw createNotImplementedError("PerformanceObserver.disconnect");
  }
  observe(options) {
    throw createNotImplementedError("PerformanceObserver.observe");
  }
  bind(fn) {
    return fn;
  }
  runInAsyncScope(fn, thisArg, ...args) {
    return fn.call(thisArg, ...args);
  }
  asyncId() {
    return 0;
  }
  triggerAsyncId() {
    return 0;
  }
  emitDestroy() {
    return this;
  }
};
var performance = globalThis.performance && "addEventListener" in globalThis.performance ? globalThis.performance : new Performance();

// node_modules/@cloudflare/unenv-preset/dist/runtime/polyfill/performance.mjs
if (!("__unenv__" in performance)) {
  const proto = Performance.prototype;
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key !== "constructor" && !(key in performance)) {
      const desc = Object.getOwnPropertyDescriptor(proto, key);
      if (desc) {
        Object.defineProperty(performance, key, desc);
      }
    }
  }
}
globalThis.performance = performance;
globalThis.Performance = Performance;
globalThis.PerformanceEntry = PerformanceEntry;
globalThis.PerformanceMark = PerformanceMark;
globalThis.PerformanceMeasure = PerformanceMeasure;
globalThis.PerformanceObserver = PerformanceObserver;
globalThis.PerformanceObserverEntryList = PerformanceObserverEntryList;
globalThis.PerformanceResourceTiming = PerformanceResourceTiming;

// src/lib/db.js
function getTenantId(request) {
  const header = request.headers.get("X-Tenant-ID");
  return header || "ten-0001-aaaa-bbbb-cccc-000000000001";
}
__name(getTenantId, "getTenantId");
function generateId() {
  return crypto.randomUUID();
}
__name(generateId, "generateId");
function errorResponse(message, status = 400, options = {}) {
  const { code = inferErrorCode(status), details } = options;
  const payload = {
    ok: false,
    error: {
      code,
      message
    }
  };
  if (details !== void 0) {
    payload.error.details = details;
  }
  return new Response(JSON.stringify(payload), {
    status,
    headers: jsonHeaders()
  });
}
__name(errorResponse, "errorResponse");
function successResponse(data, status = 200) {
  const payload = Array.isArray(data) ? { ok: true, data } : { ok: true, ...data };
  return new Response(JSON.stringify(payload), {
    status,
    headers: jsonHeaders()
  });
}
__name(successResponse, "successResponse");
async function readJsonBody(request) {
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {
        ok: false,
        response: errorResponse("Request body must be a JSON object", 400, { code: "invalid_body" })
      };
    }
    return { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      response: errorResponse("Request body must be valid JSON", 400, { code: "invalid_json" })
    };
  }
}
__name(readJsonBody, "readJsonBody");
function parsePaginationParams(rawLimit, rawOffset) {
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  const offset = rawOffset === null ? 0 : Number(rawOffset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return {
      ok: false,
      response: errorResponse("limit must be an integer between 1 and 100", 400, { code: "invalid_query" })
    };
  }
  if (!Number.isInteger(offset) || offset < 0) {
    return {
      ok: false,
      response: errorResponse("offset must be an integer >= 0", 400, { code: "invalid_query" })
    };
  }
  return { ok: true, value: { limit, offset } };
}
__name(parsePaginationParams, "parsePaginationParams");
function notFoundResponse(message) {
  return errorResponse(message, 404, { code: "not_found" });
}
__name(notFoundResponse, "notFoundResponse");
function validationError(message, details) {
  return errorResponse(message, 400, { code: "validation_error", details });
}
__name(validationError, "validationError");
function internalError(message) {
  return errorResponse(message, 500, { code: "internal_error" });
}
__name(internalError, "internalError");
function jsonHeaders() {
  return { "Content-Type": "application/json; charset=utf-8" };
}
__name(jsonHeaders, "jsonHeaders");
function inferErrorCode(status) {
  if (status === 404) {
    return "not_found";
  }
  if (status >= 500) {
    return "internal_error";
  }
  return "bad_request";
}
__name(inferErrorCode, "inferErrorCode");

// src/routes/billing.js
var TRIAL_MONTHS = 6;
var SUBSCRIPTION_STATUSES = /* @__PURE__ */ new Set(["trialing", "active", "unpaid"]);
async function getBillingStatus(request, db) {
  try {
    const tenantId = getTenantId(request);
    const billing = await getBillingStateForTenant(tenantId, db);
    return successResponse(billing);
  } catch (error) {
    return internalError(`Failed to get billing status: ${error.message}`);
  }
}
__name(getBillingStatus, "getBillingStatus");
async function upsertBillingStatus(request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const { subscription_status, trial_started_at, trial_ends_at } = parsedBody.value;
    if (subscription_status !== void 0 && (!SUBSCRIPTION_STATUSES.has(subscription_status) || typeof subscription_status !== "string")) {
      return validationError(`subscription_status must be one of: ${Array.from(SUBSCRIPTION_STATUSES).join(", ")}`);
    }
    if (trial_started_at !== void 0 && (!Number.isFinite(trial_started_at) || trial_started_at <= 0)) {
      return validationError("trial_started_at must be a positive epoch milliseconds number");
    }
    if (trial_ends_at !== void 0 && (!Number.isFinite(trial_ends_at) || trial_ends_at <= 0)) {
      return validationError("trial_ends_at must be a positive epoch milliseconds number");
    }
    if (trial_started_at !== void 0 && trial_ends_at !== void 0 && trial_ends_at <= trial_started_at) {
      return validationError("trial_ends_at must be greater than trial_started_at");
    }
    if (subscription_status === void 0 && trial_started_at === void 0 && trial_ends_at === void 0) {
      return validationError("At least one billing field must be provided");
    }
    const tenantId = getTenantId(request);
    const existing = await ensureBillingConfig(tenantId, db);
    const next = {
      trial_started_at: trial_started_at ?? existing.trial_started_at,
      trial_ends_at: trial_ends_at ?? existing.trial_ends_at,
      subscription_status: subscription_status ?? existing.subscription_status
    };
    await db.prepare(
      `INSERT INTO tenant_billing_configs
				(tenant_id, trial_started_at, trial_ends_at, subscription_status, updated_at)
				VALUES (?, ?, ?, ?, ?)
				ON CONFLICT(tenant_id) DO UPDATE SET
					trial_started_at = excluded.trial_started_at,
					trial_ends_at = excluded.trial_ends_at,
					subscription_status = excluded.subscription_status,
					updated_at = excluded.updated_at`
    ).bind(tenantId, next.trial_started_at, next.trial_ends_at, next.subscription_status, Date.now()).run();
    const billing = await getBillingStateForTenant(tenantId, db);
    return successResponse(billing);
  } catch (error) {
    return internalError(`Failed to save billing status: ${error.message}`);
  }
}
__name(upsertBillingStatus, "upsertBillingStatus");
async function getBillingStateForTenant(tenantId, db, now = Date.now()) {
  const config = await ensureBillingConfig(tenantId, db, now);
  return buildBillingState(config, now);
}
__name(getBillingStateForTenant, "getBillingStateForTenant");
async function assertBookingsAllowed(tenantId, db, now = Date.now()) {
  const billing = await getBillingStateForTenant(tenantId, db, now);
  if (!billing.new_bookings_allowed) {
    return {
      ok: false,
      message: "Billing status does not allow new bookings",
      details: billing
    };
  }
  return { ok: true, billing };
}
__name(assertBookingsAllowed, "assertBookingsAllowed");
async function ensureBillingConfig(tenantId, db, now = Date.now()) {
  let config = await db.prepare("SELECT * FROM tenant_billing_configs WHERE tenant_id = ?").bind(tenantId).first();
  if (config) {
    return config;
  }
  const trialStartedAt = now;
  const trialEndsAt = addMonths(now, TRIAL_MONTHS);
  await db.prepare(
    `INSERT INTO tenant_billing_configs
			(tenant_id, trial_started_at, trial_ends_at, subscription_status, updated_at)
			VALUES (?, ?, ?, ?, ?)`
  ).bind(tenantId, trialStartedAt, trialEndsAt, "trialing", now).run();
  config = await db.prepare("SELECT * FROM tenant_billing_configs WHERE tenant_id = ?").bind(tenantId).first();
  return config;
}
__name(ensureBillingConfig, "ensureBillingConfig");
function buildBillingState(config, now) {
  const trialExpired = config.subscription_status === "trialing" && now > config.trial_ends_at;
  const billingGoodStanding = config.subscription_status === "active" || config.subscription_status === "trialing" && !trialExpired;
  const restrictionReason = config.subscription_status === "unpaid" ? "unpaid" : trialExpired ? "trial_expired" : null;
  return {
    tenant_id: config.tenant_id,
    trial_started_at: config.trial_started_at,
    trial_ends_at: config.trial_ends_at,
    subscription_status: config.subscription_status,
    billing_in_good_standing: billingGoodStanding,
    publish_allowed: billingGoodStanding,
    new_bookings_allowed: billingGoodStanding,
    restriction_reason: restrictionReason,
    updated_at: config.updated_at
  };
}
__name(buildBillingState, "buildBillingState");
function addMonths(timestamp, monthCount) {
  const date = new Date(timestamp);
  date.setUTCMonth(date.getUTCMonth() + monthCount);
  return date.getTime();
}
__name(addMonths, "addMonths");

// src/routes/publish.js
async function getPublishGate(request, db) {
  try {
    const tenantId = getTenantId(request);
    const gate = await buildPublishGateState(tenantId, db);
    return successResponse(gate);
  } catch (error) {
    return internalError(`Failed to get publish gate: ${error.message}`);
  }
}
__name(getPublishGate, "getPublishGate");
async function upsertPublishGate(request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const {
      payment_method_added,
      terms_accepted,
      commission_agreement_accepted
    } = parsedBody.value;
    for (const [field, value] of Object.entries({
      payment_method_added,
      terms_accepted,
      commission_agreement_accepted
    })) {
      if (value !== void 0 && typeof value !== "boolean") {
        return validationError(`${field} must be a boolean`);
      }
    }
    if (payment_method_added === void 0 && terms_accepted === void 0 && commission_agreement_accepted === void 0) {
      return validationError("At least one publish gate field must be provided");
    }
    const tenantId = getTenantId(request);
    const existing = await db.prepare("SELECT * FROM tenant_publish_configs WHERE tenant_id = ?").bind(tenantId).first();
    const next = {
      payment_method_added: payment_method_added ?? Boolean(existing?.payment_method_added),
      terms_accepted: terms_accepted ?? Boolean(existing?.terms_accepted),
      commission_agreement_accepted: commission_agreement_accepted ?? Boolean(existing?.commission_agreement_accepted)
    };
    await db.prepare(
      `INSERT INTO tenant_publish_configs
				(tenant_id, payment_method_added, terms_accepted, commission_agreement_accepted, updated_at)
				VALUES (?, ?, ?, ?, ?)
				ON CONFLICT(tenant_id) DO UPDATE SET
					payment_method_added = excluded.payment_method_added,
					terms_accepted = excluded.terms_accepted,
					commission_agreement_accepted = excluded.commission_agreement_accepted,
					updated_at = excluded.updated_at`
    ).bind(
      tenantId,
      next.payment_method_added ? 1 : 0,
      next.terms_accepted ? 1 : 0,
      next.commission_agreement_accepted ? 1 : 0,
      Date.now()
    ).run();
    const gate = await buildPublishGateState(tenantId, db);
    return successResponse(gate);
  } catch (error) {
    return internalError(`Failed to save publish gate: ${error.message}`);
  }
}
__name(upsertPublishGate, "upsertPublishGate");
async function assertPublishGateSatisfied(tenantId, db) {
  const gate = await buildPublishGateState(tenantId, db);
  if (!gate.publish_allowed) {
    return {
      ok: false,
      message: "Publish gate requirements are not satisfied",
      details: gate
    };
  }
  return { ok: true, gate };
}
__name(assertPublishGateSatisfied, "assertPublishGateSatisfied");
async function buildPublishGateState(tenantId, db) {
  const domainConfig = await db.prepare("SELECT hostname, status, verified_at FROM tenant_domain_configs WHERE tenant_id = ?").bind(tenantId).first();
  const publishConfig = await db.prepare("SELECT * FROM tenant_publish_configs WHERE tenant_id = ?").bind(tenantId).first();
  const billing = await getBillingStateForTenant(tenantId, db);
  const requirements = {
    domain_verified: {
      label: "Domain verified",
      satisfied: domainConfig?.status === "verified",
      hostname: domainConfig?.hostname || null,
      status: domainConfig?.status || "no_domain"
    },
    payment_method_added: {
      label: "Payment method added",
      satisfied: Boolean(publishConfig?.payment_method_added)
    },
    terms_accepted: {
      label: "Terms accepted",
      satisfied: Boolean(publishConfig?.terms_accepted)
    },
    commission_agreement_accepted: {
      label: "Commission agreement accepted",
      satisfied: Boolean(publishConfig?.commission_agreement_accepted)
    },
    billing_in_good_standing: {
      label: "Billing in good standing",
      satisfied: billing.billing_in_good_standing,
      subscription_status: billing.subscription_status,
      restriction_reason: billing.restriction_reason
    }
  };
  const publishAllowed = Object.values(requirements).every((item) => item.satisfied);
  return {
    tenant_id: tenantId,
    preview_allowed: true,
    publish_allowed: publishAllowed,
    production_environment: "agent_domain_only",
    requirements,
    updated_at: publishConfig?.updated_at || null
  };
}
__name(buildPublishGateState, "buildPublishGateState");

// src/routes/tours.js
async function createTour(request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const body = parsedBody.value;
    const { title, start_date, duration_text, lang, day1_pickup_enabled, day1_welcome_enabled } = body;
    if (!title || typeof title !== "string") {
      return validationError("title is required and must be a string");
    }
    if (start_date !== void 0 && (typeof start_date !== "number" || start_date <= 0)) {
      return validationError("start_date must be a positive number (epoch ms) when provided");
    }
    if (!duration_text || typeof duration_text !== "string") {
      return validationError("duration_text is required and must be a string");
    }
    if (lang !== void 0 && typeof lang !== "string") {
      return validationError("lang must be a string");
    }
    if (day1_pickup_enabled !== void 0 && typeof day1_pickup_enabled !== "boolean") {
      return validationError("day1_pickup_enabled must be a boolean");
    }
    if (day1_welcome_enabled !== void 0 && typeof day1_welcome_enabled !== "boolean") {
      return validationError("day1_welcome_enabled must be a boolean");
    }
    const tenantId = getTenantId(request);
    const tourId = generateId();
    const now = Date.now();
    const resolvedStartDate = typeof start_date === "number" ? start_date : Date.now();
    await db.prepare(
      `INSERT INTO tours 
			(id, tenant_id, title, start_date, duration_text, lang, status, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(tourId, tenantId, title, resolvedStartDate, duration_text, lang || "vi", "draft", now).run();
    await createDay1Tasks({
      tourId,
      tenantId,
      startDate: resolvedStartDate,
      pickupEnabled: day1_pickup_enabled !== false,
      welcomeEnabled: day1_welcome_enabled !== false,
      db
    });
    const tour = {
      id: tourId,
      tenant_id: tenantId,
      title,
      start_date: resolvedStartDate,
      duration_text,
      lang: lang || "vi",
      day1_pickup_enabled: day1_pickup_enabled !== false,
      day1_welcome_enabled: day1_welcome_enabled !== false,
      status: "draft",
      created_at: now
    };
    return successResponse(tour, 201);
  } catch (e) {
    return internalError(`Failed to create tour: ${e.message}`);
  }
}
__name(createTour, "createTour");
async function createDay1Tasks({ tourId, tenantId, startDate, pickupEnabled, welcomeEnabled, db }) {
  const tasks = [];
  const twoHours = 2 * 60 * 60 * 1e3;
  if (pickupEnabled) {
    tasks.push({
      id: generateId(),
      title: "Day-1 Pickup Coordination",
      due_at: Math.max(1, startDate - twoHours),
      service_entity_id: `${tourId}:pickup`
    });
  }
  if (welcomeEnabled) {
    tasks.push({
      id: generateId(),
      title: "Day-1 Welcome Setup",
      due_at: startDate + twoHours,
      service_entity_id: `${tourId}:welcome`
    });
  }
  for (const task of tasks) {
    await db.prepare(
      `INSERT INTO tasks
				(id, tenant_id, booking_id, service_entity_type, service_entity_id, title, due_at, status, last_notice_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(task.id, tenantId, tourId, "day1_event", task.service_entity_id, task.title, task.due_at, "pending", null).run();
  }
}
__name(createDay1Tasks, "createDay1Tasks");
async function getTour(tourId, db, request) {
  try {
    const tenantId = getTenantId(request);
    const tour = await db.prepare("SELECT * FROM tours WHERE id = ? AND tenant_id = ?").bind(tourId, tenantId).first();
    if (!tour) {
      return notFoundResponse("Tour not found");
    }
    return successResponse(tour);
  } catch (e) {
    return internalError(`Failed to retrieve tour: ${e.message}`);
  }
}
__name(getTour, "getTour");
async function updateTour(tourId, request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const body = parsedBody.value;
    const { status, title, lang } = body;
    const tenantId = getTenantId(request);
    const existing = await db.prepare("SELECT id FROM tours WHERE id = ? AND tenant_id = ?").bind(tourId, tenantId).first();
    if (!existing) {
      return notFoundResponse("Tour not found");
    }
    const updates = [];
    const binds = [];
    if (status !== void 0) {
      const validStatuses = ["draft", "on_sale", "booked", "completed", "archived"];
      if (!validStatuses.includes(status)) {
        return validationError(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
      }
      if (status === "on_sale") {
        const gate = await assertPublishGateSatisfied(tenantId, db);
        if (!gate.ok) {
          return validationError(gate.message, gate.details);
        }
      }
      if (status === "booked") {
        const billing = await assertBookingsAllowed(tenantId, db);
        if (!billing.ok) {
          return validationError(billing.message, billing.details);
        }
      }
      updates.push("status = ?");
      binds.push(status);
    }
    if (title !== void 0) {
      if (typeof title !== "string") {
        return validationError("title must be a string");
      }
      updates.push("title = ?");
      binds.push(title);
    }
    if (lang !== void 0) {
      if (typeof lang !== "string") {
        return validationError("lang must be a string");
      }
      updates.push("lang = ?");
      binds.push(lang);
    }
    if (updates.length === 0) {
      return validationError("No fields to update");
    }
    binds.push(tourId);
    binds.push(tenantId);
    await db.prepare(`UPDATE tours SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`).bind(...binds).run();
    const updated = await db.prepare("SELECT * FROM tours WHERE id = ? AND tenant_id = ?").bind(tourId, tenantId).first();
    return successResponse(updated);
  } catch (e) {
    return internalError(`Failed to update tour: ${e.message}`);
  }
}
__name(updateTour, "updateTour");

// src/services/schedule.js
async function recomputeSchedule(tourId, db) {
  const tourResult = await db.prepare("SELECT id, start_date FROM tours WHERE id = ?").bind(tourId).first();
  if (!tourResult) {
    throw new Error(`Tour not found: ${tourId}`);
  }
  const tourStartDate = tourResult.start_date;
  const destinationsResult = await db.prepare("SELECT id, position, nights FROM destinations WHERE tour_id = ? ORDER BY position ASC").bind(tourId).all();
  if (!destinationsResult.results || destinationsResult.results.length === 0) {
    throw new Error(`No destinations found for tour: ${tourId}`);
  }
  const destinations = destinationsResult.results;
  const computed = [];
  let currentTime = tourStartDate;
  for (const dest of destinations) {
    const arrivalDate = currentTime + (computed.length === 0 ? 2 * 60 * 60 * 1e3 : 4 * 60 * 60 * 1e3);
    const departureDate = arrivalDate + dest.nights * 24 * 60 * 60 * 1e3;
    computed.push({
      id: dest.id,
      position: dest.position,
      nights: dest.nights,
      arrival_date: arrivalDate,
      departure_date: departureDate
    });
    currentTime = departureDate;
  }
  return computed;
}
__name(recomputeSchedule, "recomputeSchedule");
async function persistComputedSchedule(tourId, computedDestinations, db) {
  for (const dest of computedDestinations) {
    await db.prepare(
      `UPDATE destinations 
			SET arrival_date = ?, departure_date = ? 
			WHERE id = ? AND tour_id = ?`
    ).bind(dest.arrival_date, dest.departure_date, dest.id, tourId).run();
  }
}
__name(persistComputedSchedule, "persistComputedSchedule");

// src/routes/destinations.js
async function addDestination(tourId, request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const body = parsedBody.value;
    const { name, nights, position } = body;
    if (!name || typeof name !== "string") {
      return validationError("name is required and must be a string");
    }
    if (typeof nights !== "number" || nights < 0) {
      return validationError("nights is required and must be >= 0");
    }
    if (position !== void 0 && (typeof position !== "number" || position < 1)) {
      return validationError("position must be >= 1 when provided");
    }
    const tenantId = getTenantId(request);
    const destId = generateId();
    const now = Date.now();
    const defaultBlueprint = JSON.stringify(defaultServiceBlueprint());
    const resolvedPosition = typeof position === "number" ? position : await getNextDestinationPosition(tourId, tenantId, db);
    const tour = await db.prepare("SELECT id FROM tours WHERE id = ? AND tenant_id = ?").bind(tourId, tenantId).first();
    if (!tour) {
      return notFoundResponse("Tour not found");
    }
    await db.prepare(
      `INSERT INTO destinations 
			(id, tenant_id, tour_id, name, position, nights, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(destId, tenantId, tourId, name, resolvedPosition, nights, now).run();
    try {
      await db.prepare("UPDATE destinations SET service_blueprint_json = ? WHERE id = ? AND tenant_id = ?").bind(defaultBlueprint, destId, tenantId).run();
    } catch {
    }
    try {
      const computed = await recomputeSchedule(tourId, db);
      await persistComputedSchedule(tourId, computed, db);
    } catch (scheduleErr) {
      console.error("Schedule recompute failed:", scheduleErr.message);
    }
    const dest = {
      id: destId,
      tenant_id: tenantId,
      tour_id: tourId,
      name,
      position: resolvedPosition,
      nights,
      service_blueprint_json: defaultBlueprint,
      created_at: now
    };
    return successResponse(dest, 201);
  } catch (e) {
    return internalError(`Failed to add destination: ${e.message}`);
  }
}
__name(addDestination, "addDestination");
async function updateDestination(destId, request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const body = parsedBody.value;
    const { name, nights, position } = body;
    const tenantId = getTenantId(request);
    const existing = await db.prepare("SELECT id, tour_id FROM destinations WHERE id = ? AND tenant_id = ?").bind(destId, tenantId).first();
    if (!existing) {
      return notFoundResponse("Destination not found");
    }
    const tourId = existing.tour_id;
    const updates = [];
    const binds = [];
    if (name !== void 0) {
      if (typeof name !== "string") {
        return validationError("name must be a string");
      }
      updates.push("name = ?");
      binds.push(name);
    }
    if (nights !== void 0) {
      if (typeof nights !== "number" || nights < 0) {
        return validationError("nights must be >= 0");
      }
      updates.push("nights = ?");
      binds.push(nights);
    }
    if (position !== void 0) {
      if (typeof position !== "number" || position < 1) {
        return validationError("position must be >= 1");
      }
      updates.push("position = ?");
      binds.push(position);
    }
    if (updates.length === 0) {
      return validationError("No fields to update");
    }
    binds.push(destId);
    binds.push(tenantId);
    await db.prepare(`UPDATE destinations SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`).bind(...binds).run();
    try {
      const computed = await recomputeSchedule(tourId, db);
      await persistComputedSchedule(tourId, computed, db);
    } catch (scheduleErr) {
      console.error("Schedule recompute failed:", scheduleErr.message);
    }
    const updated = await db.prepare("SELECT * FROM destinations WHERE id = ? AND tenant_id = ?").bind(destId, tenantId).first();
    return successResponse(updated);
  } catch (e) {
    return internalError(`Failed to update destination: ${e.message}`);
  }
}
__name(updateDestination, "updateDestination");
async function listDestinations(tourId, request, db) {
  try {
    const tenantId = getTenantId(request);
    const tour = await db.prepare("SELECT id FROM tours WHERE id = ? AND tenant_id = ?").bind(tourId, tenantId).first();
    if (!tour) {
      return notFoundResponse("Tour not found");
    }
    const result = await db.prepare("SELECT * FROM destinations WHERE tour_id = ? AND tenant_id = ? ORDER BY position ASC").bind(tourId, tenantId).all();
    return successResponse({ destinations: result.results || [] });
  } catch (e) {
    return internalError(`Failed to list destinations: ${e.message}`);
  }
}
__name(listDestinations, "listDestinations");
async function getDestinationServiceBlueprint(destId, request, db) {
  try {
    const tenantId = getTenantId(request);
    const destination = await db.prepare("SELECT id, service_blueprint_json FROM destinations WHERE id = ? AND tenant_id = ?").bind(destId, tenantId).first();
    if (!destination) {
      return notFoundResponse("Destination not found");
    }
    const blueprint = parseBlueprint(destination.service_blueprint_json);
    return successResponse({ destination_id: destId, service_blueprint: blueprint });
  } catch (e) {
    return internalError(`Failed to get destination service blueprint: ${e.message}`);
  }
}
__name(getDestinationServiceBlueprint, "getDestinationServiceBlueprint");
async function upsertDestinationServiceBlueprint(destId, request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const body = parsedBody.value;
    const tenantId = getTenantId(request);
    const destination = await db.prepare("SELECT id FROM destinations WHERE id = ? AND tenant_id = ?").bind(destId, tenantId).first();
    if (!destination) {
      return notFoundResponse("Destination not found");
    }
    const source = body.service_blueprint && typeof body.service_blueprint === "object" ? body.service_blueprint : body;
    const blueprint = normalizeBlueprint(source);
    await db.prepare("UPDATE destinations SET service_blueprint_json = ? WHERE id = ? AND tenant_id = ?").bind(JSON.stringify(blueprint), destId, tenantId).run();
    return successResponse({ destination_id: destId, service_blueprint: blueprint });
  } catch (e) {
    return internalError(`Failed to update destination service blueprint: ${e.message}`);
  }
}
__name(upsertDestinationServiceBlueprint, "upsertDestinationServiceBlueprint");
async function deleteDestination(destId, request, db) {
  try {
    const tenantId = getTenantId(request);
    const existing = await db.prepare("SELECT id, tour_id FROM destinations WHERE id = ? AND tenant_id = ?").bind(destId, tenantId).first();
    if (!existing) return notFoundResponse("Destination not found");
    await db.prepare("DELETE FROM destinations WHERE id = ? AND tenant_id = ?").bind(destId, tenantId).run();
    try {
      const computed = await recomputeSchedule(existing.tour_id, db);
      await persistComputedSchedule(existing.tour_id, computed, db);
    } catch {
    }
    return successResponse({ deleted: destId });
  } catch (e) {
    return internalError(`Failed to delete destination: ${e.message}`);
  }
}
__name(deleteDestination, "deleteDestination");
function defaultServiceBlueprint() {
  return {
    accommodations: false,
    meals: false,
    guides: false,
    local_transports: false,
    intercity_legs: false,
    intercity_mode: "train"
  };
}
__name(defaultServiceBlueprint, "defaultServiceBlueprint");
function parseBlueprint(rawValue) {
  if (!rawValue) {
    return defaultServiceBlueprint();
  }
  try {
    return normalizeBlueprint(JSON.parse(rawValue));
  } catch {
    return defaultServiceBlueprint();
  }
}
__name(parseBlueprint, "parseBlueprint");
function normalizeBlueprint(input) {
  const base = defaultServiceBlueprint();
  for (const key of Object.keys(base)) {
    if (input[key] !== void 0) {
      if (key === "intercity_mode") {
        const allowedModes = ["motorcycle", "private_car_4", "private_car_7", "bus", "train", "flight"];
        base[key] = allowedModes.includes(String(input[key])) ? String(input[key]) : base[key];
      } else {
        base[key] = Boolean(input[key]);
      }
    }
  }
  return base;
}
__name(normalizeBlueprint, "normalizeBlueprint");
async function getNextDestinationPosition(tourId, tenantId, db) {
  const row = await db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM destinations WHERE tour_id = ? AND tenant_id = ?").bind(tourId, tenantId).first();
  return row?.next_position || 1;
}
__name(getNextDestinationPosition, "getNextDestinationPosition");

// src/services/tasks.js
async function generateTasksForTour(tourId, db) {
  const createdIds = [];
  const tour = await db.prepare("SELECT id, tenant_id FROM tours WHERE id = ?").bind(tourId).first();
  if (!tour) {
    throw new Error(`Tour not found: ${tourId}`);
  }
  const tenantId = tour.tenant_id;
  const dests = await db.prepare("SELECT id FROM destinations WHERE tour_id = ? AND tenant_id = ?").bind(tourId, tenantId).all();
  if (!dests.results || dests.results.length === 0) {
    return [];
  }
  const destIds = dests.results.map((d) => d.id);
  async function createTasksForServiceType(serviceType, table, nameField, timeField) {
    const placeholders = destIds.map(() => "?").join(",");
    const query = `SELECT id, ${nameField} as name, ${timeField} as due_at 
			FROM ${table} 
			WHERE destination_id IN (${placeholders}) 
			AND tenant_id = ?`;
    const result = await db.prepare(query).bind(...destIds, tenantId).all();
    for (const item of result.results || []) {
      const taskId = crypto.randomUUID();
      await db.prepare(
        `INSERT INTO tasks 
				(id, tenant_id, booking_id, service_entity_type, service_entity_id, title, due_at, status)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        taskId,
        tenantId,
        tourId,
        serviceType,
        item.id,
        `Confirm: ${item.name || serviceType}`,
        item.due_at,
        "pending"
      ).run();
      createdIds.push(taskId);
    }
  }
  __name(createTasksForServiceType, "createTasksForServiceType");
  await createTasksForServiceType("accommodation", "dest_accommodations", "hotel_name", "check_in");
  await createTasksForServiceType("meal", "dest_meals", "restaurant_name", "meal_datetime");
  await createTasksForServiceType("guide", "dest_guides", "guide_name", "time_from");
  await createTasksForServiceType("local_transport", "dest_local_transports", "mode", "pickup_time");
  await createTasksForServiceType("intercity_leg", "dest_intercity_legs", "mode", "depart_time");
  return createdIds;
}
__name(generateTasksForTour, "generateTasksForTour");
async function getTourStartReminderCandidates(db, now = Date.now()) {
  const tasksResult = await db.prepare(
    `SELECT t.id, t.tenant_id, t.booking_id, t.title, t.status, t.due_at,
				tr.start_date as tour_start_date,
				tr.created_at as booking_date
			FROM tasks t
			JOIN tours tr ON tr.id = t.booking_id AND tr.tenant_id = t.tenant_id
			WHERE t.booking_id IS NOT NULL
			AND t.status NOT IN ('confirmed', 'completed', 'canceled')
			AND tr.start_date IS NOT NULL`
  ).all();
  const candidates = [];
  for (const task of tasksResult.results || []) {
    const schedule = buildTourReminderSchedule(task.booking_date, task.tour_start_date);
    for (const reminder of schedule) {
      if (reminder.trigger_at > now) {
        continue;
      }
      const existing = await db.prepare("SELECT 1 FROM task_reminder_logs WHERE task_id = ? AND reminder_key = ? LIMIT 1").bind(task.id, reminder.key).first();
      if (!existing) {
        candidates.push({
          task_id: task.id,
          tenant_id: task.tenant_id,
          tour_id: task.booking_id,
          title: task.title,
          reminder_key: reminder.key,
          trigger_at: reminder.trigger_at,
          cadence: reminder.cadence,
          tour_start_date: task.tour_start_date
        });
      }
    }
  }
  return candidates.sort((left, right) => left.trigger_at - right.trigger_at);
}
__name(getTourStartReminderCandidates, "getTourStartReminderCandidates");
async function markTourStartReminderSent(taskId, reminderKey, db, sentAt = Date.now()) {
  await db.prepare("INSERT INTO task_reminder_logs (task_id, reminder_key, sent_at) VALUES (?, ?, ?)").bind(taskId, reminderKey, sentAt).run();
}
__name(markTourStartReminderSent, "markTourStartReminderSent");
function buildTourReminderSchedule(bookingDate, tourStartDate) {
  const reminders = [];
  const monthly = buildMonthlyReminderPoints(bookingDate, tourStartDate);
  for (const point of monthly) {
    reminders.push({
      key: `monthly:${point}`,
      cadence: "monthly",
      trigger_at: point
    });
  }
  const dayOffsets = [14, 7, 3];
  for (const days of dayOffsets) {
    const point = tourStartDate - days * 24 * 60 * 60 * 1e3;
    if (point >= bookingDate) {
      reminders.push({
        key: `before_start:${days}d`,
        cadence: `${days}d`,
        trigger_at: point
      });
    }
  }
  return reminders;
}
__name(buildTourReminderSchedule, "buildTourReminderSchedule");
function buildMonthlyReminderPoints(bookingDate, tourStartDate) {
  if (!bookingDate || !tourStartDate || bookingDate >= tourStartDate) {
    return [];
  }
  const points = [];
  const cursor = new Date(bookingDate);
  while (cursor.getTime() < tourStartDate) {
    points.push(cursor.getTime());
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return points;
}
__name(buildMonthlyReminderPoints, "buildMonthlyReminderPoints");

// src/routes/tasks.js
async function listTasks(request, db) {
  try {
    const url = new URL(request.url);
    const tourId = url.searchParams.get("tourId");
    const status = url.searchParams.get("status");
    const pagination = parsePaginationParams(url.searchParams.get("limit"), url.searchParams.get("offset"));
    if (!pagination.ok) {
      return pagination.response;
    }
    const { limit, offset } = pagination.value;
    const tenantId = getTenantId(request);
    let query = "SELECT * FROM tasks WHERE tenant_id = ?";
    const binds = [tenantId];
    if (status) {
      const validStatuses = ["pending", "confirmed", "completed", "canceled"];
      if (!validStatuses.includes(status)) {
        return validationError(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
      }
      query += " AND status = ?";
      binds.push(status);
    }
    if (tourId) {
      query = `
			SELECT DISTINCT t.* FROM tasks t
			WHERE t.tenant_id = ?
			${status ? "AND t.status = ?" : ""}
			AND (
				t.booking_id = ?
				OR EXISTS (
				SELECT 1 FROM dest_accommodations da 
				WHERE da.id = t.service_entity_id AND t.service_entity_type = 'accommodation'
				AND da.destination_id IN (SELECT id FROM destinations WHERE tour_id = ?)
				UNION
				SELECT 1 FROM dest_meals dm
				WHERE dm.id = t.service_entity_id AND t.service_entity_type = 'meal'
				AND dm.destination_id IN (SELECT id FROM destinations WHERE tour_id = ?)
				UNION
				SELECT 1 FROM dest_guides dg
				WHERE dg.id = t.service_entity_id AND t.service_entity_type = 'guide'
				AND dg.destination_id IN (SELECT id FROM destinations WHERE tour_id = ?)
				UNION
				SELECT 1 FROM dest_local_transports dlt
				WHERE dlt.id = t.service_entity_id AND t.service_entity_type = 'local_transport'
				AND dlt.destination_id IN (SELECT id FROM destinations WHERE tour_id = ?)
				UNION
				SELECT 1 FROM dest_intercity_legs dil
				WHERE dil.id = t.service_entity_id AND t.service_entity_type = 'intercity_leg'
				AND dil.destination_id IN (SELECT id FROM destinations WHERE tour_id = ?)
				)
			)
			ORDER BY t.due_at ASC
			LIMIT ? OFFSET ?
		`;
      binds.pop();
      binds.push(tenantId);
      if (status) binds.push(status);
      binds.push(tourId, tourId, tourId, tourId, tourId, tourId);
      binds.push(limit, offset);
    } else {
      query += " ORDER BY due_at ASC LIMIT ? OFFSET ?";
      binds.push(limit, offset);
    }
    const result = await db.prepare(query).bind(...binds).all();
    return successResponse({
      tasks: result.results || [],
      limit,
      offset,
      total: (result.results || []).length
    });
  } catch (e) {
    return internalError(`Failed to list tasks: ${e.message}`);
  }
}
__name(listTasks, "listTasks");
async function getTask(taskId, request, db) {
  try {
    const tenantId = getTenantId(request);
    const task = await db.prepare("SELECT * FROM tasks WHERE id = ? AND tenant_id = ?").bind(taskId, tenantId).first();
    if (!task) {
      return notFoundResponse("Task not found");
    }
    return successResponse(task);
  } catch (e) {
    return internalError(`Failed to retrieve task: ${e.message}`);
  }
}
__name(getTask, "getTask");
async function updateTask(taskId, request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const body = parsedBody.value;
    const { status, due_at } = body;
    const tenantId = getTenantId(request);
    const existing = await db.prepare("SELECT id FROM tasks WHERE id = ? AND tenant_id = ?").bind(taskId, tenantId).first();
    if (!existing) {
      return notFoundResponse("Task not found");
    }
    const updates = [];
    const binds = [];
    if (status !== void 0) {
      const validStatuses = ["pending", "confirmed", "completed", "canceled"];
      if (!validStatuses.includes(status)) {
        return validationError(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
      }
      updates.push("status = ?");
      binds.push(status);
    }
    if (due_at !== void 0) {
      if (typeof due_at !== "number" || due_at <= 0) {
        return validationError("due_at must be a positive number (epoch ms)");
      }
      updates.push("due_at = ?");
      binds.push(due_at);
    }
    if (updates.length === 0) {
      return validationError("No fields to update");
    }
    binds.push(taskId);
    binds.push(tenantId);
    await db.prepare(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`).bind(...binds).run();
    const updated = await db.prepare("SELECT * FROM tasks WHERE id = ? AND tenant_id = ?").bind(taskId, tenantId).first();
    return successResponse(updated);
  } catch (e) {
    return internalError(`Failed to update task: ${e.message}`);
  }
}
__name(updateTask, "updateTask");
async function generateTasksForTourEndpoint(request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const body = parsedBody.value;
    const { tourId } = body;
    if (!tourId) {
      return validationError("tourId is required");
    }
    const tenantId = getTenantId(request);
    const tour = await db.prepare("SELECT id FROM tours WHERE id = ? AND tenant_id = ?").bind(tourId, tenantId).first();
    if (!tour) {
      return notFoundResponse("Tour not found");
    }
    const createdIds = await generateTasksForTour(tourId, db);
    return successResponse({
      message: `Generated ${createdIds.length} tasks`,
      task_ids: createdIds
    });
  } catch (e) {
    return internalError(`Failed to generate tasks: ${e.message}`);
  }
}
__name(generateTasksForTourEndpoint, "generateTasksForTourEndpoint");
async function listReminderCandidates(request, db) {
  try {
    const url = new URL(request.url);
    const atRaw = url.searchParams.get("at");
    const at = atRaw === null ? Date.now() : Number(atRaw);
    if (!Number.isFinite(at) || at <= 0) {
      return validationError("at must be a positive epoch milliseconds number");
    }
    const tenantId = getTenantId(request);
    const candidates = await getTourStartReminderCandidates(db, at);
    return successResponse({
      candidates: candidates.filter((candidate) => candidate.tenant_id === tenantId),
      at
    });
  } catch (error) {
    return internalError(`Failed to list reminder candidates: ${error.message}`);
  }
}
__name(listReminderCandidates, "listReminderCandidates");
async function markReminderSent(taskId, request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const tenantId = getTenantId(request);
    const { reminder_key } = parsedBody.value;
    if (!reminder_key || typeof reminder_key !== "string") {
      return validationError("reminder_key is required and must be a string");
    }
    const task = await db.prepare("SELECT id FROM tasks WHERE id = ? AND tenant_id = ?").bind(taskId, tenantId).first();
    if (!task) {
      return notFoundResponse("Task not found");
    }
    await markTourStartReminderSent(taskId, reminder_key, db);
    return successResponse({ task_id: taskId, reminder_key, marked: true });
  } catch (error) {
    if (String(error.message || "").includes("UNIQUE")) {
      return successResponse({ task_id: taskId, marked: true, duplicate: true });
    }
    return internalError(`Failed to mark reminder as sent: ${error.message}`);
  }
}
__name(markReminderSent, "markReminderSent");

// src/services/communication.js
async function getOrCreateThread(entityType, entityId, tenantId, db) {
  let thread = await db.prepare("SELECT * FROM comm_threads WHERE entity_type = ? AND entity_id = ? AND tenant_id = ?").bind(entityType, entityId, tenantId).first();
  if (thread) {
    return thread;
  }
  const threadId = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO comm_threads (id, tenant_id, entity_type, entity_id)
		VALUES (?, ?, ?, ?)`
  ).bind(threadId, tenantId, entityType, entityId).run();
  return {
    id: threadId,
    tenant_id: tenantId,
    entity_type: entityType,
    entity_id: entityId
  };
}
__name(getOrCreateThread, "getOrCreateThread");
async function addMessage(threadId, channel, direction, messageData, tenantId, db) {
  const messageId = crypto.randomUUID();
  const now = Date.now();
  const { subject, body, to_addr, from_addr, created_by } = messageData;
  await db.prepare(
    `INSERT INTO comm_messages 
		(id, tenant_id, thread_id, channel, direction, subject, body, to_addr, from_addr, created_by, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    messageId,
    tenantId,
    threadId,
    channel,
    direction,
    subject !== void 0 ? subject : null,
    body !== void 0 ? body : null,
    to_addr !== void 0 ? to_addr : null,
    from_addr !== void 0 ? from_addr : null,
    created_by !== void 0 ? created_by : null,
    now
  ).run();
  return {
    id: messageId,
    tenant_id: tenantId,
    thread_id: threadId,
    channel,
    direction,
    subject: subject !== void 0 ? subject : null,
    body: body !== void 0 ? body : null,
    to_addr: to_addr !== void 0 ? to_addr : null,
    from_addr: from_addr !== void 0 ? from_addr : null,
    created_by: created_by !== void 0 ? created_by : null,
    created_at: now
  };
}
__name(addMessage, "addMessage");
async function getThreadMessages(threadId, tenantId, db, limit = 50, offset = 0) {
  const query = `SELECT * FROM comm_messages 
		WHERE thread_id = ? AND tenant_id = ?
		ORDER BY created_at DESC
		LIMIT ${limit} OFFSET ${offset}`;
  const result = await db.prepare(query).bind(threadId, tenantId).all();
  return result.results || [];
}
__name(getThreadMessages, "getThreadMessages");
async function getEntityThread(entityType, entityId, tenantId, db) {
  const thread = await db.prepare("SELECT * FROM comm_threads WHERE entity_type = ? AND entity_id = ? AND tenant_id = ?").bind(entityType, entityId, tenantId).first();
  if (!thread) {
    return null;
  }
  const messages = await getThreadMessages(thread.id, tenantId, db, 20, 0);
  return {
    ...thread,
    messages: messages.reverse()
    // chronological order
  };
}
__name(getEntityThread, "getEntityThread");

// src/routes/communication.js
async function sendEmail(entityType, entityId, request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const body = parsedBody.value;
    const { to_addr, subject, body: messageBody, from_addr } = body;
    if (!to_addr || typeof to_addr !== "string") {
      return validationError("to_addr is required and must be a string");
    }
    if (!messageBody || typeof messageBody !== "string") {
      return validationError("body is required and must be a string");
    }
    if (subject !== void 0 && typeof subject !== "string") {
      return validationError("subject must be a string");
    }
    if (from_addr !== void 0 && typeof from_addr !== "string") {
      return validationError("from_addr must be a string");
    }
    const tenantId = getTenantId(request);
    const thread = await getOrCreateThread(entityType, entityId, tenantId, db);
    const message = await addMessage(
      thread.id,
      "email",
      "outbound",
      {
        subject: subject || `Message to ${to_addr}`,
        body: messageBody,
        to_addr,
        from_addr: from_addr || "noreply@tours.example.com",
        created_by: tenantId
      },
      tenantId,
      db
    );
    return successResponse(message, 201);
  } catch (e) {
    return internalError(`Failed to send email: ${e.message}`);
  }
}
__name(sendEmail, "sendEmail");
async function addNote(threadId, request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const body = parsedBody.value;
    const { body: noteBody, created_by } = body;
    if (!noteBody || typeof noteBody !== "string") {
      return validationError("body is required and must be a string");
    }
    if (created_by !== void 0 && typeof created_by !== "string") {
      return validationError("created_by must be a string");
    }
    const tenantId = getTenantId(request);
    const thread = await db.prepare("SELECT id FROM comm_threads WHERE id = ? AND tenant_id = ?").bind(threadId, tenantId).first();
    if (!thread) {
      return notFoundResponse("Thread not found");
    }
    const message = await addMessage(
      threadId,
      "note",
      "internal",
      {
        body: noteBody,
        created_by: created_by || tenantId
      },
      tenantId,
      db
    );
    return successResponse(message, 201);
  } catch (e) {
    return internalError(`Failed to add note: ${e.message}`);
  }
}
__name(addNote, "addNote");
async function getThread(entityType, entityId, request, db) {
  try {
    const tenantId = getTenantId(request);
    const threadWithMessages = await getEntityThread(entityType, entityId, tenantId, db);
    if (!threadWithMessages) {
      return notFoundResponse("Thread not found");
    }
    return successResponse(threadWithMessages);
  } catch (e) {
    return internalError(`Failed to retrieve thread: ${e.message}`);
  }
}
__name(getThread, "getThread");
async function getMessages(threadId, request, db) {
  try {
    const url = new URL(request.url);
    const pagination = parsePaginationParams(url.searchParams.get("limit"), url.searchParams.get("offset"));
    if (!pagination.ok) {
      return pagination.response;
    }
    const { limit, offset } = pagination.value;
    const tenantId = getTenantId(request);
    const thread = await db.prepare("SELECT id FROM comm_threads WHERE id = ? AND tenant_id = ?").bind(threadId, tenantId).first();
    if (!thread) {
      return notFoundResponse("Thread not found");
    }
    const messages = await db.prepare(
      `SELECT * FROM comm_messages 
			WHERE thread_id = ? AND tenant_id = ?
			ORDER BY created_at ASC
			LIMIT ${limit} OFFSET ${offset}`
    ).bind(threadId, tenantId).all();
    return successResponse({
      thread_id: threadId,
      messages: messages.results || [],
      limit,
      offset
    });
  } catch (e) {
    return internalError(`Failed to retrieve messages: ${e.message}`);
  }
}
__name(getMessages, "getMessages");

// src/routes/suppliers.js
var ALLOWED_TYPES = /* @__PURE__ */ new Set(["hotel", "guide", "transport", "meal", "other"]);
async function createSupplier(request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const { name, type, contact, notes } = parsedBody.value;
    if (!name || typeof name !== "string") {
      return validationError("name is required and must be a string");
    }
    if (!type || typeof type !== "string" || !ALLOWED_TYPES.has(type)) {
      return validationError(`type is required and must be one of: ${Array.from(ALLOWED_TYPES).join(", ")}`);
    }
    if (contact !== void 0 && typeof contact !== "string") {
      return validationError("contact must be a string");
    }
    if (notes !== void 0 && typeof notes !== "string") {
      return validationError("notes must be a string");
    }
    const tenantId = getTenantId(request);
    const supplierId = generateId();
    const now = Date.now();
    await db.prepare(
      `INSERT INTO suppliers (id, tenant_id, name, type, contact, notes, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(supplierId, tenantId, name.trim(), type, contact || null, notes || null, now).run();
    const created = await db.prepare("SELECT * FROM suppliers WHERE id = ? AND tenant_id = ?").bind(supplierId, tenantId).first();
    return successResponse(created, 201);
  } catch (error) {
    return internalError(`Failed to create supplier: ${error.message}`);
  }
}
__name(createSupplier, "createSupplier");
async function listSuppliers(request, db) {
  try {
    const url = new URL(request.url);
    const tenantId = getTenantId(request);
    const type = url.searchParams.get("type");
    const pagination = parsePaginationParams(url.searchParams.get("limit"), url.searchParams.get("offset"));
    if (!pagination.ok) {
      return pagination.response;
    }
    const { limit, offset } = pagination.value;
    if (type && !ALLOWED_TYPES.has(type)) {
      return validationError(`type must be one of: ${Array.from(ALLOWED_TYPES).join(", ")}`);
    }
    let query = "SELECT * FROM suppliers WHERE tenant_id = ?";
    const binds = [tenantId];
    if (type) {
      query += " AND type = ?";
      binds.push(type);
    }
    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    binds.push(limit, offset);
    const result = await db.prepare(query).bind(...binds).all();
    return successResponse({ suppliers: result.results || [], limit, offset, total: (result.results || []).length });
  } catch (error) {
    return internalError(`Failed to list suppliers: ${error.message}`);
  }
}
__name(listSuppliers, "listSuppliers");
async function updateSupplier(supplierId, request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const { name, type, contact, notes } = parsedBody.value;
    const tenantId = getTenantId(request);
    const existing = await db.prepare("SELECT id FROM suppliers WHERE id = ? AND tenant_id = ?").bind(supplierId, tenantId).first();
    if (!existing) {
      return notFoundResponse("Supplier not found");
    }
    if (name !== void 0 && typeof name !== "string") {
      return validationError("name must be a string");
    }
    if (type !== void 0 && (typeof type !== "string" || !ALLOWED_TYPES.has(type))) {
      return validationError(`type must be one of: ${Array.from(ALLOWED_TYPES).join(", ")}`);
    }
    if (contact !== void 0 && typeof contact !== "string") {
      return validationError("contact must be a string");
    }
    if (notes !== void 0 && typeof notes !== "string") {
      return validationError("notes must be a string");
    }
    const updates = [];
    const binds = [];
    for (const field of ["name", "type", "contact", "notes"]) {
      if (parsedBody.value[field] !== void 0) {
        updates.push(`${field} = ?`);
        binds.push(parsedBody.value[field] || null);
      }
    }
    if (!updates.length) {
      return validationError("No fields to update");
    }
    binds.push(supplierId, tenantId);
    await db.prepare(`UPDATE suppliers SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`).bind(...binds).run();
    const updated = await db.prepare("SELECT * FROM suppliers WHERE id = ? AND tenant_id = ?").bind(supplierId, tenantId).first();
    return successResponse(updated);
  } catch (error) {
    return internalError(`Failed to update supplier: ${error.message}`);
  }
}
__name(updateSupplier, "updateSupplier");
async function getSupplierByIdForTenant(supplierId, tenantId, db) {
  return db.prepare("SELECT id, tenant_id, name, type FROM suppliers WHERE id = ? AND tenant_id = ?").bind(supplierId, tenantId).first();
}
__name(getSupplierByIdForTenant, "getSupplierByIdForTenant");

// src/routes/service-items.js
var ALLOWED_CHANNELS = /* @__PURE__ */ new Set(["email", "zalo", "messenger", "sms"]);
var ALLOWED_STAGES = /* @__PURE__ */ new Set(["contacted", "pending", "confirmed", "canceled"]);
var ALLOWED_STATUSES = /* @__PURE__ */ new Set(["planned", "booked", "confirmed", "canceled"]);
var SERVICE_CONFIG = {
  accommodations: {
    table: "dest_accommodations",
    entityType: "accommodation",
    primaryField: "hotel_name",
    requiredFields: ["hotel_name"],
    stringFields: ["hotel_name", "room_type"],
    numberFields: ["check_in", "check_out", "guests"],
    defaultFields(destination) {
      return {
        check_in: destination.arrival_date,
        check_out: destination.departure_date
      };
    }
  },
  meals: {
    table: "dest_meals",
    entityType: "meal",
    primaryField: "restaurant_name",
    requiredFields: ["meal_type", "restaurant_name"],
    stringFields: ["meal_type", "restaurant_name"],
    numberFields: ["meal_datetime"],
    defaultFields(destination, body) {
      return {
        meal_datetime: defaultMealDateTime(destination.arrival_date, body.meal_type)
      };
    }
  },
  guides: {
    table: "dest_guides",
    entityType: "guide",
    primaryField: "guide_name",
    requiredFields: ["guide_name"],
    stringFields: ["guide_name", "languages"],
    numberFields: ["time_from", "time_to"],
    defaultFields(destination) {
      const timeFrom = Math.max(defaultSameDayHour(destination.arrival_date, 9), destination.arrival_date || 0);
      const tentativeEnd = timeFrom + 4 * 60 * 60 * 1e3;
      return {
        time_from: timeFrom,
        time_to: destination.departure_date ? Math.min(destination.departure_date, tentativeEnd) : tentativeEnd
      };
    }
  },
  "local-transports": {
    table: "dest_local_transports",
    entityType: "local_transport",
    primaryField: "supplier",
    requiredFields: ["mode", "supplier"],
    stringFields: ["mode", "supplier", "driver_name", "pickup_place", "dropoff_place"],
    numberFields: ["pickup_time"],
    defaultFields(destination) {
      return {
        pickup_time: destination.arrival_date,
        pickup_place: `${destination.name} arrival point`,
        dropoff_place: `${destination.name} city center`
      };
    }
  },
  "intercity-legs": {
    table: "dest_intercity_legs",
    entityType: "intercity_leg",
    primaryField: "supplier",
    requiredFields: ["mode", "supplier"],
    stringFields: ["mode", "supplier", "depart_point", "arrive_point", "ticket_ref"],
    numberFields: ["depart_time"],
    defaultFields(destination) {
      return {
        depart_time: destination.departure_date,
        depart_point: destination.name,
        arrive_point: "TBD"
      };
    }
  }
};
async function createServiceItem(groupKey, destinationId, request, db) {
  const config = SERVICE_CONFIG[groupKey];
  if (!config) {
    return notFoundResponse("Service group not found");
  }
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const body = parsedBody.value;
    const tenantId = getTenantId(request);
    const destination = await getDestinationContext(destinationId, tenantId, db);
    if (!destination) {
      return notFoundResponse("Destination not found");
    }
    const validation = validateCreatePayload(config, body);
    if (validation) {
      return validation;
    }
    if (body.supplier_id !== void 0) {
      const supplier = await getSupplierByIdForTenant(body.supplier_id, tenantId, db);
      if (!supplier) {
        return validationError("supplier_id is invalid for tenant");
      }
    }
    const defaults = config.defaultFields(destination, body);
    const itemId = generateId();
    const now = Date.now();
    const position = await getNextPosition(config.table, destinationId, tenantId, db);
    const channels = normalizeChannels(body.communication_channels);
    const record = buildCreateRecord(config, itemId, destinationId, tenantId, body, defaults, position, now);
    const columns = Object.keys(record);
    const placeholders = columns.map(() => "?").join(", ");
    await db.prepare(`INSERT INTO ${config.table} (${columns.join(", ")}) VALUES (${placeholders})`).bind(...columns.map((column) => record[column])).run();
    const thread = await getOrCreateThread(config.entityType, itemId, tenantId, db);
    const created = await db.prepare(`SELECT * FROM ${config.table} WHERE id = ? AND tenant_id = ?`).bind(itemId, tenantId).first();
    return successResponse(hydrateItem(created, thread.id), 201);
  } catch (error) {
    return internalError(`Failed to create service item: ${error.message}`);
  }
}
__name(createServiceItem, "createServiceItem");
async function listServiceItems(groupKey, destinationId, request, db) {
  const config = SERVICE_CONFIG[groupKey];
  if (!config) {
    return notFoundResponse("Service group not found");
  }
  try {
    const tenantId = getTenantId(request);
    const destination = await getDestinationContext(destinationId, tenantId, db);
    if (!destination) {
      return notFoundResponse("Destination not found");
    }
    const result = await db.prepare(`SELECT * FROM ${config.table} WHERE destination_id = ? AND tenant_id = ? ORDER BY position ASC, created_at ASC`).bind(destinationId, tenantId).all();
    const items = await Promise.all((result.results || []).map((item) => hydrateItemWithThread(config, item, tenantId, db)));
    return successResponse({ items });
  } catch (error) {
    return internalError(`Failed to list service items: ${error.message}`);
  }
}
__name(listServiceItems, "listServiceItems");
async function updateServiceItem(groupKey, itemId, request, db) {
  const config = SERVICE_CONFIG[groupKey];
  if (!config) {
    return notFoundResponse("Service group not found");
  }
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const body = parsedBody.value;
    const tenantId = getTenantId(request);
    const existing = await db.prepare(`SELECT * FROM ${config.table} WHERE id = ? AND tenant_id = ?`).bind(itemId, tenantId).first();
    if (!existing) {
      return notFoundResponse("Service item not found");
    }
    const validation = validateUpdatePayload(config, body);
    if (validation) {
      return validation;
    }
    if (body.supplier_id !== void 0) {
      const supplier = await getSupplierByIdForTenant(body.supplier_id, tenantId, db);
      if (!supplier) {
        return validationError("supplier_id is invalid for tenant");
      }
    }
    const updates = [];
    const binds = [];
    for (const field of config.stringFields) {
      if (body[field] !== void 0) {
        updates.push(`${field} = ?`);
        binds.push(body[field] || null);
      }
    }
    for (const field of config.numberFields) {
      if (body[field] !== void 0) {
        updates.push(`${field} = ?`);
        binds.push(body[field]);
      }
    }
    for (const field of ["person_in_charge", "contact_name", "contact_phone", "contact_email", "address", "notes"]) {
      if (body[field] !== void 0) {
        updates.push(`${mapCommonField(config, field)} = ?`);
        binds.push(body[field] || null);
      }
    }
    if (body.status !== void 0) {
      updates.push("status = ?");
      binds.push(body.status);
    }
    if (body.stage !== void 0) {
      updates.push("stage = ?");
      binds.push(body.stage);
    }
    if (body.communication_channels !== void 0) {
      updates.push("communication_channels_json = ?");
      binds.push(JSON.stringify(normalizeChannels(body.communication_channels)));
    }
    if (body.supplier_id !== void 0) {
      updates.push("supplier_id = ?");
      binds.push(body.supplier_id || null);
    }
    if (!updates.length) {
      return validationError("No fields to update");
    }
    binds.push(itemId, tenantId);
    await db.prepare(`UPDATE ${config.table} SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`).bind(...binds).run();
    const updated = await db.prepare(`SELECT * FROM ${config.table} WHERE id = ? AND tenant_id = ?`).bind(itemId, tenantId).first();
    const thread = await getOrCreateThread(config.entityType, itemId, tenantId, db);
    return successResponse(hydrateItem(updated, thread.id));
  } catch (error) {
    return internalError(`Failed to update service item: ${error.message}`);
  }
}
__name(updateServiceItem, "updateServiceItem");
function validateCreatePayload(config, body) {
  for (const field of config.requiredFields) {
    if (typeof body[field] !== "string" || body[field].trim() === "") {
      return validationError(`${field} is required and must be a string`);
    }
  }
  for (const field of ["person_in_charge", "contact_name", "contact_email", "address"]) {
    if (typeof body[field] !== "string" || body[field].trim() === "") {
      return validationError(`${field} is required and must be a string`);
    }
  }
  if (body.contact_phone !== void 0 && typeof body.contact_phone !== "string") {
    return validationError("contact_phone must be a string");
  }
  if (body.notes !== void 0 && typeof body.notes !== "string") {
    return validationError("notes must be a string");
  }
  if (body.supplier_id !== void 0 && typeof body.supplier_id !== "string") {
    return validationError("supplier_id must be a string");
  }
  if (body.status !== void 0 && !ALLOWED_STATUSES.has(body.status)) {
    return validationError(`Invalid status. Must be one of: ${Array.from(ALLOWED_STATUSES).join(", ")}`);
  }
  if (body.stage !== void 0 && !ALLOWED_STAGES.has(body.stage)) {
    return validationError(`Invalid stage. Must be one of: ${Array.from(ALLOWED_STAGES).join(", ")}`);
  }
  const channelValidation = validateChannels(body.communication_channels);
  if (channelValidation) {
    return channelValidation;
  }
  for (const field of config.numberFields) {
    if (body[field] !== void 0 && (typeof body[field] !== "number" || Number.isNaN(body[field]))) {
      return validationError(`${field} must be a number`);
    }
  }
  for (const field of config.stringFields) {
    if (body[field] !== void 0 && typeof body[field] !== "string") {
      return validationError(`${field} must be a string`);
    }
  }
  return null;
}
__name(validateCreatePayload, "validateCreatePayload");
function validateUpdatePayload(config, body) {
  const channelValidation = validateChannels(body.communication_channels);
  if (channelValidation) {
    return channelValidation;
  }
  if (body.status !== void 0 && !ALLOWED_STATUSES.has(body.status)) {
    return validationError(`Invalid status. Must be one of: ${Array.from(ALLOWED_STATUSES).join(", ")}`);
  }
  if (body.stage !== void 0 && !ALLOWED_STAGES.has(body.stage)) {
    return validationError(`Invalid stage. Must be one of: ${Array.from(ALLOWED_STAGES).join(", ")}`);
  }
  for (const field of ["person_in_charge", "contact_name", "contact_phone", "contact_email", "address", "notes"]) {
    if (body[field] !== void 0 && typeof body[field] !== "string") {
      return validationError(`${field} must be a string`);
    }
  }
  if (body.supplier_id !== void 0 && typeof body.supplier_id !== "string") {
    return validationError("supplier_id must be a string");
  }
  for (const field of config.stringFields) {
    if (body[field] !== void 0 && typeof body[field] !== "string") {
      return validationError(`${field} must be a string`);
    }
  }
  for (const field of config.numberFields) {
    if (body[field] !== void 0 && (typeof body[field] !== "number" || Number.isNaN(body[field]))) {
      return validationError(`${field} must be a number`);
    }
  }
  return null;
}
__name(validateUpdatePayload, "validateUpdatePayload");
function validateChannels(channels) {
  if (channels === void 0) {
    return null;
  }
  if (!Array.isArray(channels)) {
    return validationError("communication_channels must be an array");
  }
  for (const channel of channels) {
    if (typeof channel !== "string" || !ALLOWED_CHANNELS.has(channel)) {
      return validationError(`communication_channels must contain only: ${Array.from(ALLOWED_CHANNELS).join(", ")}`);
    }
  }
  return null;
}
__name(validateChannels, "validateChannels");
function buildCreateRecord(config, itemId, destinationId, tenantId, body, defaults, position, now) {
  const channels = normalizeChannels(body.communication_channels);
  const record = {
    id: itemId,
    tenant_id: tenantId,
    destination_id: destinationId,
    person_in_charge: body.person_in_charge,
    contact_name: body.contact_name,
    contact_phone: body.contact_phone || null,
    contact_email: body.contact_email,
    address: body.address,
    notes: body.notes || null,
    status: body.status || "planned",
    stage: body.stage || "pending",
    communication_channels_json: JSON.stringify(channels),
    position,
    created_at: now
  };
  if (body.supplier_id !== void 0) {
    record.supplier_id = body.supplier_id;
  }
  for (const field of config.stringFields) {
    if (body[field] !== void 0) {
      record[field] = body[field];
    }
  }
  for (const field of config.numberFields) {
    const explicit = body[field];
    record[field] = explicit !== void 0 ? explicit : defaults[field] ?? null;
  }
  for (const [field, value] of Object.entries(defaults)) {
    if (record[field] === void 0) {
      record[field] = value;
    }
  }
  if (config.table === "dest_guides") {
    record.phone = record.contact_phone;
    record.email = record.contact_email;
    delete record.contact_phone;
    delete record.contact_email;
  }
  if (config.table === "dest_local_transports" || config.table === "dest_intercity_legs") {
    record.phone = record.contact_phone;
    record.email = record.contact_email;
    delete record.contact_phone;
    delete record.contact_email;
  }
  return record;
}
__name(buildCreateRecord, "buildCreateRecord");
async function getDestinationContext(destinationId, tenantId, db) {
  return db.prepare(
    `SELECT d.id, d.name, d.arrival_date, d.departure_date, d.position, d.nights, t.start_date
			FROM destinations d
			JOIN tours t ON t.id = d.tour_id
			WHERE d.id = ? AND d.tenant_id = ? AND t.tenant_id = ?`
  ).bind(destinationId, tenantId, tenantId).first();
}
__name(getDestinationContext, "getDestinationContext");
async function getNextPosition(table, destinationId, tenantId, db) {
  const result = await db.prepare(`SELECT COALESCE(MAX(position), 0) AS max_position FROM ${table} WHERE destination_id = ? AND tenant_id = ?`).bind(destinationId, tenantId).first();
  return (result?.max_position || 0) + 1;
}
__name(getNextPosition, "getNextPosition");
async function hydrateItemWithThread(config, row, tenantId, db) {
  const thread = await db.prepare("SELECT id FROM comm_threads WHERE entity_type = ? AND entity_id = ? AND tenant_id = ?").bind(config.entityType, row.id, tenantId).first();
  return hydrateItem(row, thread?.id || null);
}
__name(hydrateItemWithThread, "hydrateItemWithThread");
function hydrateItem(row, threadId) {
  const item = { ...row, thread_id: threadId, communication_channels: parseChannels(row.communication_channels_json) };
  delete item.communication_channels_json;
  if (item.phone !== void 0 && item.contact_phone === void 0) {
    item.contact_phone = item.phone;
  }
  if (item.email !== void 0 && item.contact_email === void 0) {
    item.contact_email = item.email;
  }
  return item;
}
__name(hydrateItem, "hydrateItem");
function parseChannels(value) {
  if (!value) {
    return ["email"];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : ["email"];
  } catch {
    return ["email"];
  }
}
__name(parseChannels, "parseChannels");
function normalizeChannels(channels) {
  if (!channels || !channels.length) {
    return ["email"];
  }
  return Array.from(new Set(channels.map((channel) => channel.toLowerCase())));
}
__name(normalizeChannels, "normalizeChannels");
function mapCommonField(config, field) {
  if ((config.table === "dest_guides" || config.table === "dest_local_transports" || config.table === "dest_intercity_legs") && field === "contact_phone") {
    return "phone";
  }
  if ((config.table === "dest_guides" || config.table === "dest_local_transports" || config.table === "dest_intercity_legs") && field === "contact_email") {
    return "email";
  }
  return field;
}
__name(mapCommonField, "mapCommonField");
function defaultSameDayHour(baseTimestamp, hour) {
  if (!baseTimestamp) {
    return null;
  }
  const date = new Date(baseTimestamp);
  date.setUTCHours(hour, 0, 0, 0);
  return date.getTime();
}
__name(defaultSameDayHour, "defaultSameDayHour");
function defaultMealDateTime(arrivalDate, mealType) {
  if (!arrivalDate) {
    return null;
  }
  const normalizedMealType = String(mealType || "").toLowerCase();
  const mealHour = normalizedMealType === "breakfast" ? 8 : normalizedMealType === "dinner" ? 18 : 12;
  const sameDay = defaultSameDayHour(arrivalDate, mealHour);
  return Math.max(sameDay, arrivalDate);
}
__name(defaultMealDateTime, "defaultMealDateTime");

// src/routes/calendar.js
async function upsertCalendarConfig(request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const body = parsedBody.value;
    const {
      google_calendar_id,
      ios_calendar_url,
      timezone,
      auto_sync_enabled,
      monthly_reminder_enabled
    } = body;
    if (google_calendar_id !== void 0 && typeof google_calendar_id !== "string") {
      return validationError("google_calendar_id must be a string");
    }
    if (ios_calendar_url !== void 0 && typeof ios_calendar_url !== "string") {
      return validationError("ios_calendar_url must be a string");
    }
    if (timezone !== void 0 && typeof timezone !== "string") {
      return validationError("timezone must be a string");
    }
    if (auto_sync_enabled !== void 0 && typeof auto_sync_enabled !== "boolean") {
      return validationError("auto_sync_enabled must be a boolean");
    }
    if (monthly_reminder_enabled !== void 0 && typeof monthly_reminder_enabled !== "boolean") {
      return validationError("monthly_reminder_enabled must be a boolean");
    }
    const tenantId = getTenantId(request);
    const now = Date.now();
    await db.prepare(
      `INSERT INTO tenant_calendar_configs
				(tenant_id, google_calendar_id, ios_calendar_url, timezone, auto_sync_enabled, monthly_reminder_enabled, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(tenant_id) DO UPDATE SET
					google_calendar_id = excluded.google_calendar_id,
					ios_calendar_url = excluded.ios_calendar_url,
					timezone = excluded.timezone,
					auto_sync_enabled = excluded.auto_sync_enabled,
					monthly_reminder_enabled = excluded.monthly_reminder_enabled,
					updated_at = excluded.updated_at`
    ).bind(
      tenantId,
      google_calendar_id || null,
      ios_calendar_url || null,
      timezone || "Asia/Ho_Chi_Minh",
      auto_sync_enabled === void 0 ? 1 : auto_sync_enabled ? 1 : 0,
      monthly_reminder_enabled === void 0 ? 1 : monthly_reminder_enabled ? 1 : 0,
      now
    ).run();
    const config = await db.prepare("SELECT * FROM tenant_calendar_configs WHERE tenant_id = ?").bind(tenantId).first();
    return successResponse(normalizeConfig(config));
  } catch (error) {
    return internalError(`Failed to save calendar config: ${error.message}`);
  }
}
__name(upsertCalendarConfig, "upsertCalendarConfig");
async function getCalendarConfig(request, db) {
  try {
    const tenantId = getTenantId(request);
    const config = await db.prepare("SELECT * FROM tenant_calendar_configs WHERE tenant_id = ?").bind(tenantId).first();
    if (!config) {
      return successResponse({
        tenant_id: tenantId,
        google_calendar_id: null,
        ios_calendar_url: null,
        timezone: "Asia/Ho_Chi_Minh",
        auto_sync_enabled: true,
        monthly_reminder_enabled: true,
        updated_at: null
      });
    }
    return successResponse(normalizeConfig(config));
  } catch (error) {
    return internalError(`Failed to get calendar config: ${error.message}`);
  }
}
__name(getCalendarConfig, "getCalendarConfig");
async function getTourCalendarFeed(tourId, request, db) {
  try {
    const tenantId = getTenantId(request);
    const tour = await db.prepare("SELECT id, title, start_date FROM tours WHERE id = ? AND tenant_id = ?").bind(tourId, tenantId).first();
    if (!tour) {
      return notFoundResponse("Tour not found");
    }
    const tasks = await db.prepare(
      `SELECT id, title, due_at, status
				FROM tasks
				WHERE tenant_id = ? AND booking_id = ?
				AND status NOT IN ('completed', 'canceled')
				ORDER BY due_at ASC`
    ).bind(tenantId, tourId).all();
    const ics = buildIcsCalendar(tour, tasks.results || []);
    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `inline; filename="tour-${tourId}.ics"`
      }
    });
  } catch (error) {
    return internalError(`Failed to generate calendar feed: ${error.message}`);
  }
}
__name(getTourCalendarFeed, "getTourCalendarFeed");
async function getGoogleSyncPreview(tourId, request, db) {
  try {
    const tenantId = getTenantId(request);
    const tour = await db.prepare("SELECT id, title, start_date FROM tours WHERE id = ? AND tenant_id = ?").bind(tourId, tenantId).first();
    if (!tour) {
      return notFoundResponse("Tour not found");
    }
    const config = await db.prepare("SELECT * FROM tenant_calendar_configs WHERE tenant_id = ?").bind(tenantId).first();
    if (!config?.google_calendar_id) {
      return validationError("google_calendar_id is not configured for tenant");
    }
    const tasks = await db.prepare(
      `SELECT id, title, due_at, status
				FROM tasks
				WHERE tenant_id = ? AND booking_id = ?
				AND status NOT IN ('completed', 'canceled')
				ORDER BY due_at ASC`
    ).bind(tenantId, tourId).all();
    const events = (tasks.results || []).map((task) => ({
      summary: task.title,
      description: `Tour ${tour.title} task (${task.id})`,
      start: { dateTime: toIso(task.due_at) },
      end: { dateTime: toIso((task.due_at || Date.now()) + 60 * 60 * 1e3) },
      extendedProperties: {
        private: {
          task_id: task.id,
          tour_id: tour.id
        }
      }
    }));
    return successResponse({
      tour_id: tour.id,
      google_calendar_id: config.google_calendar_id,
      event_count: events.length,
      events
    });
  } catch (error) {
    return internalError(`Failed to create Google sync preview: ${error.message}`);
  }
}
__name(getGoogleSyncPreview, "getGoogleSyncPreview");
function normalizeConfig(config) {
  return {
    tenant_id: config.tenant_id,
    google_calendar_id: config.google_calendar_id,
    timezone: config.timezone,
    ios_calendar_url: config.ios_calendar_url,
    auto_sync_enabled: Boolean(config.auto_sync_enabled),
    monthly_reminder_enabled: Boolean(config.monthly_reminder_enabled),
    updated_at: config.updated_at
  };
}
__name(normalizeConfig, "normalizeConfig");
function buildIcsCalendar(tour, tasks) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tour Booking App//CHK-208//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH"
  ];
  for (const task of tasks) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${task.id}@tour-booking-app`);
    lines.push(`SUMMARY:${escapeIcs(task.title)}`);
    lines.push(`DTSTAMP:${toIcsDate(Date.now())}`);
    lines.push(`DTSTART:${toIcsDate(task.due_at || tour.start_date || Date.now())}`);
    lines.push(`DTEND:${toIcsDate((task.due_at || tour.start_date || Date.now()) + 60 * 60 * 1e3)}`);
    lines.push(`DESCRIPTION:${escapeIcs(`Tour ${tour.title} task`)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r
`;
}
__name(buildIcsCalendar, "buildIcsCalendar");
function escapeIcs(value) {
  return String(value || "").replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,").replaceAll("\n", "\\n");
}
__name(escapeIcs, "escapeIcs");
function toIcsDate(timestamp) {
  const date = new Date(timestamp || Date.now());
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
__name(toIcsDate, "toIcsDate");
function toIso(timestamp) {
  return new Date(timestamp || Date.now()).toISOString();
}
__name(toIso, "toIso");

// src/routes/itinerary.js
var SERVICE_DEFINITIONS = [
  { label: "Accommodation", table: "dest_accommodations", field: "hotel_name" },
  { label: "Meals", table: "dest_meals", field: "restaurant_name" },
  { label: "Guide", table: "dest_guides", field: "guide_name" },
  { label: "Local Transport", table: "dest_local_transports", field: "supplier" },
  { label: "Intercity Leg", table: "dest_intercity_legs", field: "supplier" }
];
async function getItinerary(tourId, request, db) {
  try {
    const tenantId = getTenantId(request);
    const url = new URL(request.url);
    const format = normalizeFormat(url.searchParams.get("format"));
    const includeDestinationText = parseBooleanFlag(url.searchParams.get("includeDestinationText"), true);
    const lang = url.searchParams.get("lang");
    if (!format) {
      return validationError("format must be one of: markdown, md, html");
    }
    if (includeDestinationText === null) {
      return validationError("includeDestinationText must be true/false/1/0");
    }
    const tour = await db.prepare("SELECT id, tenant_id, title, lang, start_date, duration_text FROM tours WHERE id = ? AND tenant_id = ?").bind(tourId, tenantId).first();
    if (!tour) {
      return notFoundResponse("Tour not found");
    }
    const contentLang = lang || tour.lang || "vi";
    const destinationsResult = await db.prepare(
      `SELECT id, name, position, nights, arrival_date, departure_date
				FROM destinations
				WHERE tour_id = ? AND tenant_id = ?
				ORDER BY position ASC`
    ).bind(tourId, tenantId).all();
    const destinations = destinationsResult.results || [];
    const blocks = [];
    for (const destination of destinations) {
      const text = includeDestinationText ? await getDestinationText(destination.id, tenantId, contentLang, db) : null;
      const services = await getDestinationServices(destination.id, tenantId, db);
      blocks.push({ destination, text, services });
    }
    const content = format === "html" ? renderItineraryHtml({ tour, blocks, lang: contentLang, includeDestinationText }) : renderItineraryMarkdown({ tour, blocks, lang: contentLang, includeDestinationText });
    return successResponse({
      tour_id: tourId,
      format,
      lang: contentLang,
      include_destination_text: includeDestinationText,
      content
    });
  } catch (error) {
    return internalError(`Failed to build itinerary: ${error.message}`);
  }
}
__name(getItinerary, "getItinerary");
async function getDestinationText(destinationId, tenantId, lang, db) {
  const exact = await db.prepare(
    `SELECT summary, details, notes, lang
			FROM destination_texts
			WHERE destination_id = ? AND tenant_id = ? AND lang = ?
			LIMIT 1`
  ).bind(destinationId, tenantId, lang).first();
  if (exact) {
    return exact;
  }
  return db.prepare(
    `SELECT summary, details, notes, lang
			FROM destination_texts
			WHERE destination_id = ? AND tenant_id = ?
			ORDER BY updated_at DESC
			LIMIT 1`
  ).bind(destinationId, tenantId).first();
}
__name(getDestinationText, "getDestinationText");
async function getDestinationServices(destinationId, tenantId, db) {
  const items = [];
  for (const service of SERVICE_DEFINITIONS) {
    const result = await db.prepare(
      `SELECT ${service.field} as name
				FROM ${service.table}
				WHERE destination_id = ? AND tenant_id = ?
				ORDER BY position ASC, created_at ASC`
    ).bind(destinationId, tenantId).all();
    items.push({
      label: service.label,
      names: (result.results || []).map((row) => row.name).filter(Boolean)
    });
  }
  return items;
}
__name(getDestinationServices, "getDestinationServices");
function renderItineraryMarkdown({ tour, blocks, lang, includeDestinationText }) {
  const lines = [];
  lines.push(`# ${tour.title}`);
  lines.push("");
  lines.push(`- Language: ${lang}`);
  lines.push(`- Start date: ${formatDate(tour.start_date)}`);
  lines.push(`- Duration: ${tour.duration_text || "N/A"}`);
  lines.push("");
  if (!blocks.length) {
    lines.push("_No destinations added yet._");
    return lines.join("\n");
  }
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const { destination, text, services } = block;
    lines.push(`## Day ${index + 1}: ${destination.name}`);
    lines.push(`- Nights: ${destination.nights}`);
    lines.push(`- Arrival: ${formatDateTime(destination.arrival_date)}`);
    lines.push(`- Departure: ${formatDateTime(destination.departure_date)}`);
    if (includeDestinationText && text) {
      if (text.summary) {
        lines.push(`- Summary: ${text.summary}`);
      }
      if (text.details) {
        lines.push(`- Details: ${text.details}`);
      }
    }
    lines.push("");
    lines.push("### Services");
    for (const service of services) {
      if (!service.names.length) {
        lines.push(`- ${service.label}: none`);
        continue;
      }
      lines.push(`- ${service.label}: ${service.names.join(", ")}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}
__name(renderItineraryMarkdown, "renderItineraryMarkdown");
function renderItineraryHtml({ tour, blocks, lang, includeDestinationText }) {
  const sectionHtml = blocks.map((block, index) => {
    const { destination, text, services } = block;
    const servicesHtml = services.map((service) => {
      const names = service.names.length ? escapeHtml(service.names.join(", ")) : "none";
      return `<li><strong>${escapeHtml(service.label)}:</strong> ${names}</li>`;
    }).join("");
    const textHtml = includeDestinationText && text ? `<div class="dest-text">${text.summary ? `<p><strong>Summary:</strong> ${escapeHtml(text.summary)}</p>` : ""}${text.details ? `<p><strong>Details:</strong> ${escapeHtml(text.details)}</p>` : ""}</div>` : "";
    return `<section>
				<h2>Day ${index + 1}: ${escapeHtml(destination.name)}</h2>
				<ul>
					<li><strong>Nights:</strong> ${destination.nights}</li>
					<li><strong>Arrival:</strong> ${escapeHtml(formatDateTime(destination.arrival_date))}</li>
					<li><strong>Departure:</strong> ${escapeHtml(formatDateTime(destination.departure_date))}</li>
				</ul>
				${textHtml}
				<h3>Services</h3>
				<ul>${servicesHtml}</ul>
			</section>`;
  }).join("");
  const emptyState = blocks.length ? "" : "<p>No destinations added yet.</p>";
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>${escapeHtml(tour.title)} - Itinerary</title>
	</head>
	<body>
		<main>
			<h1>${escapeHtml(tour.title)}</h1>
			<p><strong>Language:</strong> ${escapeHtml(lang)}</p>
			<p><strong>Start date:</strong> ${escapeHtml(formatDate(tour.start_date))}</p>
			<p><strong>Duration:</strong> ${escapeHtml(tour.duration_text || "N/A")}</p>
			${emptyState}
			${sectionHtml}
		</main>
	</body>
</html>`;
}
__name(renderItineraryHtml, "renderItineraryHtml");
function normalizeFormat(value) {
  if (!value || value === "markdown" || value === "md") {
    return "markdown";
  }
  if (value === "html") {
    return "html";
  }
  return null;
}
__name(normalizeFormat, "normalizeFormat");
function parseBooleanFlag(value, defaultValue) {
  if (value === null) {
    return defaultValue;
  }
  if (value === "1" || value === "true") {
    return true;
  }
  if (value === "0" || value === "false") {
    return false;
  }
  return null;
}
__name(parseBooleanFlag, "parseBooleanFlag");
function formatDate(timestamp) {
  if (!timestamp) {
    return "N/A";
  }
  return new Date(timestamp).toISOString().slice(0, 10);
}
__name(formatDate, "formatDate");
function formatDateTime(timestamp) {
  if (!timestamp) {
    return "N/A";
  }
  return new Date(timestamp).toISOString();
}
__name(formatDateTime, "formatDateTime");
function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
__name(escapeHtml, "escapeHtml");

// src/routes/mobile.js
var CONTACT_SOURCES = {
  accommodation: {
    table: "dest_accommodations",
    query: "SELECT id, hotel_name AS supplier_name, contact_name, contact_phone AS phone, contact_email AS email FROM dest_accommodations WHERE id = ? AND tenant_id = ?"
  },
  meal: {
    table: "dest_meals",
    query: "SELECT id, restaurant_name AS supplier_name, contact_name, contact_phone AS phone, contact_email AS email FROM dest_meals WHERE id = ? AND tenant_id = ?"
  },
  guide: {
    table: "dest_guides",
    query: "SELECT id, guide_name AS supplier_name, contact_name, phone, email FROM dest_guides WHERE id = ? AND tenant_id = ?"
  },
  local_transport: {
    table: "dest_local_transports",
    query: "SELECT id, supplier AS supplier_name, contact_name, phone, email FROM dest_local_transports WHERE id = ? AND tenant_id = ?"
  },
  intercity_leg: {
    table: "dest_intercity_legs",
    query: "SELECT id, supplier AS supplier_name, contact_name, phone, email FROM dest_intercity_legs WHERE id = ? AND tenant_id = ?"
  }
};
var NOTE_CHANNELS = /* @__PURE__ */ new Set(["note", "call_log", "sms", "email", "whatsapp", "zalo", "messenger"]);
async function listMobileTasks(request, db) {
  try {
    const tenantId = getTenantId(request);
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const includeClosed = parseBooleanFlag2(url.searchParams.get("includeClosed"), false);
    if (includeClosed === null) {
      return validationError("includeClosed must be true/false/1/0");
    }
    const pagination = parsePaginationParams(url.searchParams.get("limit"), url.searchParams.get("offset"));
    if (!pagination.ok) {
      return pagination.response;
    }
    const { limit, offset } = pagination.value;
    const binds = [tenantId];
    let query = "SELECT * FROM tasks WHERE tenant_id = ?";
    if (status) {
      const validStatuses = ["pending", "confirmed", "completed", "canceled"];
      if (!validStatuses.includes(status)) {
        return validationError(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
      }
      query += " AND status = ?";
      binds.push(status);
    } else if (!includeClosed) {
      query += " AND status NOT IN ('completed', 'canceled')";
    }
    query += " ORDER BY due_at ASC LIMIT ? OFFSET ?";
    binds.push(limit, offset);
    const result = await db.prepare(query).bind(...binds).all();
    const rawTasks = result.results || [];
    const tasks = [];
    for (const task of rawTasks) {
      const contact = await getTaskContact(task, tenantId, db);
      const thread = await resolveTaskThread(task, tenantId, db);
      const latestMessage = await getLatestThreadMessage(thread.id, tenantId, db);
      const quickActions = buildQuickActions(contact, thread.id);
      tasks.push({
        id: task.id,
        title: task.title,
        status: task.status,
        due_at: task.due_at,
        service_entity_type: task.service_entity_type,
        service_entity_id: task.service_entity_id,
        booking_id: task.booking_id,
        thread_id: thread.id,
        contact,
        quick_actions: quickActions,
        latest_message: latestMessage
      });
    }
    return successResponse({ tasks, limit, offset, total: tasks.length });
  } catch (error) {
    return internalError(`Failed to list mobile tasks: ${error.message}`);
  }
}
__name(listMobileTasks, "listMobileTasks");
async function addMobileTaskNote(taskId, request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const tenantId = getTenantId(request);
    const { body, channel, created_by } = parsedBody.value;
    if (!body || typeof body !== "string") {
      return validationError("body is required and must be a string");
    }
    if (channel !== void 0 && (!NOTE_CHANNELS.has(channel) || typeof channel !== "string")) {
      return validationError(`channel must be one of: ${Array.from(NOTE_CHANNELS).join(", ")}`);
    }
    if (created_by !== void 0 && typeof created_by !== "string") {
      return validationError("created_by must be a string");
    }
    const task = await db.prepare("SELECT * FROM tasks WHERE id = ? AND tenant_id = ?").bind(taskId, tenantId).first();
    if (!task) {
      return notFoundResponse("Task not found");
    }
    const thread = await resolveTaskThread(task, tenantId, db);
    const message = await addMessage(
      thread.id,
      channel || "note",
      "internal",
      { body, created_by: created_by || tenantId },
      tenantId,
      db
    );
    return successResponse({ task_id: taskId, thread_id: thread.id, message }, 201);
  } catch (error) {
    return internalError(`Failed to add mobile task note: ${error.message}`);
  }
}
__name(addMobileTaskNote, "addMobileTaskNote");
async function updateMobileTaskStatus(taskId, request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const tenantId = getTenantId(request);
    const { status } = parsedBody.value;
    const validStatuses = ["pending", "confirmed", "completed", "canceled"];
    if (!status || !validStatuses.includes(status)) {
      return validationError(`status must be one of: ${validStatuses.join(", ")}`);
    }
    const task = await db.prepare("SELECT id FROM tasks WHERE id = ? AND tenant_id = ?").bind(taskId, tenantId).first();
    if (!task) {
      return notFoundResponse("Task not found");
    }
    await db.prepare("UPDATE tasks SET status = ? WHERE id = ? AND tenant_id = ?").bind(status, taskId, tenantId).run();
    const updated = await db.prepare("SELECT * FROM tasks WHERE id = ? AND tenant_id = ?").bind(taskId, tenantId).first();
    return successResponse({ task: updated });
  } catch (error) {
    return internalError(`Failed to update mobile task status: ${error.message}`);
  }
}
__name(updateMobileTaskStatus, "updateMobileTaskStatus");
async function resolveTaskThread(task, tenantId, db) {
  if (CONTACT_SOURCES[task.service_entity_type] && task.service_entity_id) {
    return getOrCreateThread(task.service_entity_type, task.service_entity_id, tenantId, db);
  }
  return getOrCreateThread("task", task.id, tenantId, db);
}
__name(resolveTaskThread, "resolveTaskThread");
async function getTaskContact(task, tenantId, db) {
  const source = CONTACT_SOURCES[task.service_entity_type];
  if (!source || !task.service_entity_id) {
    return null;
  }
  const row = await db.prepare(source.query).bind(task.service_entity_id, tenantId).first();
  if (!row) {
    return null;
  }
  return {
    supplier_name: row.supplier_name || null,
    contact_name: row.contact_name || null,
    phone: normalizePhone(row.phone),
    email: row.email || null
  };
}
__name(getTaskContact, "getTaskContact");
function buildQuickActions(contact, threadId) {
  if (!contact) {
    return {
      call: null,
      sms: null,
      email: null,
      whatsapp: null,
      zalo: null,
      thread_messages_url: threadId ? `/api/threads/${threadId}/messages?limit=20&offset=0` : null
    };
  }
  const phoneDigits = contact.phone ? contact.phone.replace(/[^\d+]/g, "") : null;
  const phoneForIntl = phoneDigits ? phoneDigits.replace(/^\+/, "") : null;
  const email = contact.email || null;
  return {
    call: phoneDigits ? `tel:${phoneDigits}` : null,
    sms: phoneDigits ? `sms:${phoneDigits}` : null,
    email: email ? `mailto:${email}` : null,
    whatsapp: phoneForIntl ? `https://wa.me/${phoneForIntl}` : null,
    zalo: phoneForIntl ? `https://zalo.me/${phoneForIntl}` : null,
    thread_messages_url: threadId ? `/api/threads/${threadId}/messages?limit=20&offset=0` : null
  };
}
__name(buildQuickActions, "buildQuickActions");
async function getLatestThreadMessage(threadId, tenantId, db) {
  const latest = await db.prepare(
    `SELECT id, channel, direction, body, created_at
			FROM comm_messages
			WHERE thread_id = ? AND tenant_id = ?
			ORDER BY created_at DESC
			LIMIT 1`
  ).bind(threadId, tenantId).first();
  return latest || null;
}
__name(getLatestThreadMessage, "getLatestThreadMessage");
function normalizePhone(value) {
  if (!value || typeof value !== "string") {
    return null;
  }
  return value.trim();
}
__name(normalizePhone, "normalizePhone");
function parseBooleanFlag2(value, defaultValue) {
  if (value === null) {
    return defaultValue;
  }
  if (value === "1" || value === "true") {
    return true;
  }
  if (value === "0" || value === "false") {
    return false;
  }
  return null;
}
__name(parseBooleanFlag2, "parseBooleanFlag");

// src/routes/domains.js
var DOMAIN_STATUS = {
  NO_DOMAIN: "no_domain",
  PENDING: "pending",
  VERIFIED: "verified"
};
var HOSTNAME_PATTERN = /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
async function getDomainConfig(request, db) {
  try {
    const tenantId = getTenantId(request);
    const config = await db.prepare("SELECT * FROM tenant_domain_configs WHERE tenant_id = ?").bind(tenantId).first();
    if (!config) {
      return successResponse(emptyDomainConfig(tenantId));
    }
    return successResponse(normalizeDomainConfig(config));
  } catch (error) {
    return internalError(`Failed to get domain config: ${error.message}`);
  }
}
__name(getDomainConfig, "getDomainConfig");
async function upsertDomainConfig(request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const { hostname } = parsedBody.value;
    if (!hostname || typeof hostname !== "string") {
      return validationError("hostname is required and must be a string");
    }
    const normalizedHostname = hostname.trim().toLowerCase();
    if (!HOSTNAME_PATTERN.test(normalizedHostname)) {
      return validationError("hostname must be a valid domain or subdomain");
    }
    const tenantId = getTenantId(request);
    const existing = await db.prepare("SELECT * FROM tenant_domain_configs WHERE tenant_id = ?").bind(tenantId).first();
    const claimed = await db.prepare("SELECT tenant_id FROM tenant_domain_configs WHERE hostname = ? AND tenant_id <> ?").bind(normalizedHostname, tenantId).first();
    if (claimed) {
      return validationError("hostname is already claimed by another tenant");
    }
    const unchangedVerified = existing && existing.hostname === normalizedHostname && existing.status === DOMAIN_STATUS.VERIFIED;
    const verificationValue = unchangedVerified ? existing.verification_record_value : `tb-verify-${generateId()}`;
    const now = Date.now();
    const status = unchangedVerified ? DOMAIN_STATUS.VERIFIED : DOMAIN_STATUS.PENDING;
    const verifiedAt = unchangedVerified ? existing.verified_at : null;
    const verificationRecordName = `_tour-booking-verification.${normalizedHostname}`;
    await db.prepare(
      `INSERT INTO tenant_domain_configs
				(tenant_id, hostname, status, verification_record_type, verification_record_name, verification_record_value, verified_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(tenant_id) DO UPDATE SET
					hostname = excluded.hostname,
					status = excluded.status,
					verification_record_type = excluded.verification_record_type,
					verification_record_name = excluded.verification_record_name,
					verification_record_value = excluded.verification_record_value,
					verified_at = excluded.verified_at,
					updated_at = excluded.updated_at`
    ).bind(
      tenantId,
      normalizedHostname,
      status,
      "TXT",
      verificationRecordName,
      verificationValue,
      verifiedAt,
      now
    ).run();
    const config = await db.prepare("SELECT * FROM tenant_domain_configs WHERE tenant_id = ?").bind(tenantId).first();
    return successResponse(normalizeDomainConfig(config));
  } catch (error) {
    return internalError(`Failed to save domain config: ${error.message}`);
  }
}
__name(upsertDomainConfig, "upsertDomainConfig");
async function verifyDomain(request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const { verification_value } = parsedBody.value;
    if (!verification_value || typeof verification_value !== "string") {
      return validationError("verification_value is required and must be a string");
    }
    const tenantId = getTenantId(request);
    const existing = await db.prepare("SELECT * FROM tenant_domain_configs WHERE tenant_id = ?").bind(tenantId).first();
    if (!existing || existing.status === DOMAIN_STATUS.NO_DOMAIN || !existing.hostname) {
      return validationError("No pending domain verification exists for tenant");
    }
    if (existing.status === DOMAIN_STATUS.VERIFIED) {
      return successResponse(normalizeDomainConfig(existing));
    }
    if (existing.verification_record_value !== verification_value) {
      return validationError("verification_value does not match pending record");
    }
    const now = Date.now();
    await db.prepare(
      `UPDATE tenant_domain_configs
				SET status = ?, verified_at = ?, updated_at = ?
				WHERE tenant_id = ?`
    ).bind(DOMAIN_STATUS.VERIFIED, now, now, tenantId).run();
    const verified = await db.prepare("SELECT * FROM tenant_domain_configs WHERE tenant_id = ?").bind(tenantId).first();
    return successResponse(normalizeDomainConfig(verified));
  } catch (error) {
    return internalError(`Failed to verify domain: ${error.message}`);
  }
}
__name(verifyDomain, "verifyDomain");
function emptyDomainConfig(tenantId) {
  return {
    tenant_id: tenantId,
    hostname: null,
    status: DOMAIN_STATUS.NO_DOMAIN,
    verification_record_type: "TXT",
    verification_record_name: null,
    verification_record_value: null,
    verified_at: null,
    updated_at: null
  };
}
__name(emptyDomainConfig, "emptyDomainConfig");
function normalizeDomainConfig(config) {
  return {
    tenant_id: config.tenant_id,
    hostname: config.hostname,
    status: config.status,
    verification_record_type: config.verification_record_type,
    verification_record_name: config.verification_record_name,
    verification_record_value: config.verification_record_value,
    verified_at: config.verified_at,
    updated_at: config.updated_at
  };
}
__name(normalizeDomainConfig, "normalizeDomainConfig");

// src/routes/site-studio.js
var LEGAL_PAGE_KEYS = /* @__PURE__ */ new Set(["terms", "privacy", "impressum"]);
var LEGACY_BUILDER_COMPAT_DEFAULTS = {
  template: "editorial-journey",
  blocks: ["hero", "story-grid", "itinerary-rail", "price-spotlight", "testimonial-wall", "final-cta"],
  utilities: ["floating-contact", "trust-badges", "sticky-cta"],
  content: {
    hero: {
      eyebrow: "Signature Journey",
      headline: "Cities first, mountain silence after.",
      subtitle: "Shape a high-conviction landing page with a clear promise, rich route mood, and immediate next step.",
      cta_label: "Plan This Journey",
      cta_href: "/book.html"
    },
    faq: [
      { question: "What is included in the standard planning flow?", answer: "Core stays, meals, operating support, and itinerary structure aligned to the selected class preset." },
      { question: "Can travelers request a different departure date?", answer: "Yes. The quote flow can adapt by departure date and matching season window." },
      { question: "How quickly should a lead receive a response?", answer: "Use the Builder utilities and ops shell together so high-intent travelers can be answered within the same working day." }
    ],
    testimonials: [
      { quote: "The route felt polished from the first city arrival to the final mountain night.", name: "Anh Tran", role: "Private group traveler" },
      { quote: "Everything from hotels to transfers felt coordinated and calm.", name: "Mina Vo", role: "Family booking lead" },
      { quote: "The itinerary pacing made the whole journey feel premium without being rigid.", name: "Daniel Pham", role: "Repeat guest" }
    ],
    cta: {
      heading: "Ready to turn this draft into a selling page?",
      body: "Use the Builder to create the public story, then route travelers into the booking flow with clarity.",
      button_label: "Open Booking Flow",
      button_href: "/book.html"
    }
  }
};
async function getSiteConfig(request, db) {
  try {
    const tenantId = getTenantId(request);
    const config = await ensureSiteConfig(tenantId, db);
    return successResponse(normalizeSiteConfig(config));
  } catch (error) {
    return internalError(`Failed to get site config: ${error.message}`);
  }
}
__name(getSiteConfig, "getSiteConfig");
async function upsertSiteConfig(request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const tenantId = getTenantId(request);
    const existing = normalizeSiteConfig(await ensureSiteConfig(tenantId, db));
    const body = parsedBody.value;
    const nextLegacyBuilder = {
      template: body.builder_template ?? existing.builder_template,
      blocks: body.builder_blocks ?? existing.builder_blocks,
      utilities: body.builder_utilities ?? existing.builder_utilities,
      content: body.builder_content ?? existing.builder_content
    };
    const next = {
      theme: body.theme ?? existing.theme,
      primary_color: body.primary_color ?? existing.primary_color,
      font_family: body.font_family ?? existing.font_family,
      builder_template: nextLegacyBuilder.template,
      builder_blocks: nextLegacyBuilder.blocks,
      builder_utilities: nextLegacyBuilder.utilities,
      builder_content: nextLegacyBuilder.content,
      header_title: body.header_title ?? existing.header_title,
      footer_text: body.footer_text ?? existing.footer_text,
      contact_email: body.contact_email ?? existing.contact_email,
      contact_phone: body.contact_phone ?? existing.contact_phone,
      whatsapp_url: body.whatsapp_url ?? existing.whatsapp_url,
      default_public_lang: body.default_public_lang ?? existing.default_public_lang,
      search_enabled: body.search_enabled === void 0 ? Boolean(existing.search_enabled) : body.search_enabled
    };
    const validation = validateSiteConfig(next);
    if (validation) {
      return validation;
    }
    await db.prepare(
      `INSERT INTO tenant_site_configs
				(tenant_id, theme, primary_color, font_family, builder_template, builder_blocks_json, builder_utilities_json, builder_content_json, header_title, footer_text, contact_email, contact_phone, whatsapp_url, default_public_lang, search_enabled, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(tenant_id) DO UPDATE SET
					theme = excluded.theme,
					primary_color = excluded.primary_color,
					font_family = excluded.font_family,
					builder_template = excluded.builder_template,
					builder_blocks_json = excluded.builder_blocks_json,
					builder_utilities_json = excluded.builder_utilities_json,
					builder_content_json = excluded.builder_content_json,
					header_title = excluded.header_title,
					footer_text = excluded.footer_text,
					contact_email = excluded.contact_email,
					contact_phone = excluded.contact_phone,
					whatsapp_url = excluded.whatsapp_url,
					default_public_lang = excluded.default_public_lang,
					search_enabled = excluded.search_enabled,
					updated_at = excluded.updated_at`
    ).bind(
      tenantId,
      next.theme,
      next.primary_color,
      next.font_family,
      next.builder_template,
      JSON.stringify(next.builder_blocks),
      JSON.stringify(next.builder_utilities),
      JSON.stringify(next.builder_content),
      next.header_title,
      next.footer_text,
      next.contact_email,
      next.contact_phone,
      next.whatsapp_url,
      next.default_public_lang,
      next.search_enabled ? 1 : 0,
      Date.now()
    ).run();
    const saved = await db.prepare("SELECT * FROM tenant_site_configs WHERE tenant_id = ?").bind(tenantId).first();
    return successResponse(normalizeSiteConfig(saved));
  } catch (error) {
    return internalError(`Failed to save site config: ${error.message}`);
  }
}
__name(upsertSiteConfig, "upsertSiteConfig");
async function upsertLegalPage(request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const { page_key, lang, title, content } = parsedBody.value;
    if (!page_key || !LEGAL_PAGE_KEYS.has(page_key)) {
      return validationError(`page_key must be one of: ${Array.from(LEGAL_PAGE_KEYS).join(", ")}`);
    }
    if (!lang || typeof lang !== "string") {
      return validationError("lang is required and must be a string");
    }
    if (!title || typeof title !== "string") {
      return validationError("title is required and must be a string");
    }
    if (!content || typeof content !== "string") {
      return validationError("content is required and must be a string");
    }
    const tenantId = getTenantId(request);
    const existing = await db.prepare("SELECT id FROM tenant_site_pages WHERE tenant_id = ? AND page_key = ? AND lang = ?").bind(tenantId, page_key, lang).first();
    if (existing) {
      await db.prepare("UPDATE tenant_site_pages SET title = ?, content = ?, updated_at = ? WHERE id = ?").bind(title, content, Date.now(), existing.id).run();
    } else {
      await db.prepare(
        `INSERT INTO tenant_site_pages
					(id, tenant_id, page_key, lang, title, content, updated_at)
					VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(generateId(), tenantId, page_key, lang, title, content, Date.now()).run();
    }
    const saved = await db.prepare("SELECT tenant_id, page_key, lang, title, content, updated_at FROM tenant_site_pages WHERE tenant_id = ? AND page_key = ? AND lang = ?").bind(tenantId, page_key, lang).first();
    return successResponse(saved);
  } catch (error) {
    return internalError(`Failed to save legal page: ${error.message}`);
  }
}
__name(upsertLegalPage, "upsertLegalPage");
async function getLegalPage(request, db) {
  try {
    const tenantId = getTenantId(request);
    const url = new URL(request.url);
    const pageKey = url.searchParams.get("page_key");
    if (!pageKey || !LEGAL_PAGE_KEYS.has(pageKey)) {
      return validationError(`page_key must be one of: ${Array.from(LEGAL_PAGE_KEYS).join(", ")}`);
    }
    const config = await ensureSiteConfig(tenantId, db);
    const requestedLang = url.searchParams.get("lang") || config.default_public_lang;
    const page = await resolveLocalizedPage(tenantId, pageKey, requestedLang, config.default_public_lang, db);
    if (!page) {
      return notFoundResponse("Legal page not found");
    }
    return successResponse(page);
  } catch (error) {
    return internalError(`Failed to get legal page: ${error.message}`);
  }
}
__name(getLegalPage, "getLegalPage");
async function upsertTourPublicContent(tourId, request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const { lang, headline, summary, body } = parsedBody.value;
    if (!lang || typeof lang !== "string") {
      return validationError("lang is required and must be a string");
    }
    if (headline !== void 0 && typeof headline !== "string") {
      return validationError("headline must be a string");
    }
    if (summary !== void 0 && typeof summary !== "string") {
      return validationError("summary must be a string");
    }
    if (body !== void 0 && typeof body !== "string") {
      return validationError("body must be a string");
    }
    const tenantId = getTenantId(request);
    const tour = await db.prepare("SELECT id FROM tours WHERE id = ? AND tenant_id = ?").bind(tourId, tenantId).first();
    if (!tour) {
      return notFoundResponse("Tour not found");
    }
    const existing = await db.prepare("SELECT id FROM tour_public_contents WHERE tenant_id = ? AND tour_id = ? AND lang = ?").bind(tenantId, tourId, lang).first();
    if (existing) {
      await db.prepare("UPDATE tour_public_contents SET headline = ?, summary = ?, body = ?, updated_at = ? WHERE id = ?").bind(headline || null, summary || null, body || null, Date.now(), existing.id).run();
    } else {
      await db.prepare(
        `INSERT INTO tour_public_contents
					(id, tenant_id, tour_id, lang, headline, summary, body, updated_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(generateId(), tenantId, tourId, lang, headline || null, summary || null, body || null, Date.now()).run();
    }
    const saved = await db.prepare("SELECT tenant_id, tour_id, lang, headline, summary, body, updated_at FROM tour_public_contents WHERE tenant_id = ? AND tour_id = ? AND lang = ?").bind(tenantId, tourId, lang).first();
    return successResponse(saved);
  } catch (error) {
    return internalError(`Failed to save tour public content: ${error.message}`);
  }
}
__name(upsertTourPublicContent, "upsertTourPublicContent");
async function getTourPublicContent(tourId, request, db) {
  try {
    const tenantId = getTenantId(request);
    const url = new URL(request.url);
    const config = await ensureSiteConfig(tenantId, db);
    const requestedLang = url.searchParams.get("lang") || config.default_public_lang;
    const tour = await resolvePublicTour(tenantId, tourId, requestedLang, config.default_public_lang, db);
    if (!tour) {
      return notFoundResponse("Tour not found");
    }
    return successResponse(tour);
  } catch (error) {
    return internalError(`Failed to get tour public content: ${error.message}`);
  }
}
__name(getTourPublicContent, "getTourPublicContent");
async function getPublicSite(request, db) {
  try {
    const tenantId = getTenantId(request);
    const config = await ensureSiteConfig(tenantId, db);
    const url = new URL(request.url);
    const lang = url.searchParams.get("lang") || config.default_public_lang;
    const legalPages = await getAvailableLegalPages(tenantId, lang, config.default_public_lang, db);
    return successResponse({
      tenant_id: tenantId,
      lang,
      config: normalizeSiteConfig(config),
      builder: buildPublicBuilder(normalizeSiteConfig(config)),
      legal_pages: legalPages
    });
  } catch (error) {
    return internalError(`Failed to get public site: ${error.message}`);
  }
}
__name(getPublicSite, "getPublicSite");
async function listPublicTours(request, db) {
  try {
    const tenantId = getTenantId(request);
    const config = await ensureSiteConfig(tenantId, db);
    const url = new URL(request.url);
    const lang = url.searchParams.get("lang") || config.default_public_lang;
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const result = await db.prepare("SELECT id, tenant_id, title, lang, start_date, duration_text, status FROM tours WHERE tenant_id = ? ORDER BY created_at DESC").bind(tenantId).all();
    const tours = [];
    for (const row of result.results || []) {
      const localized = await resolveLocalizedTourContent(tenantId, row.id, lang, config.default_public_lang, db);
      const summaryText = `${row.title || ""} ${localized?.headline || ""} ${localized?.summary || ""}`.toLowerCase();
      if (q && !summaryText.includes(q)) {
        continue;
      }
      tours.push(buildPublicTourPreview(row, localized, lang));
    }
    return successResponse({ tours, total: tours.length, lang, search_enabled: Boolean(config.search_enabled) });
  } catch (error) {
    return internalError(`Failed to list public tours: ${error.message}`);
  }
}
__name(listPublicTours, "listPublicTours");
async function getPublicTour(tourId, request, db) {
  try {
    const tenantId = getTenantId(request);
    const config = await ensureSiteConfig(tenantId, db);
    const url = new URL(request.url);
    const lang = url.searchParams.get("lang") || config.default_public_lang;
    const tour = await resolvePublicTour(tenantId, tourId, lang, config.default_public_lang, db);
    if (!tour) {
      return notFoundResponse("Tour not found");
    }
    return successResponse({
      ...tour,
      builder: buildPublicBuilder(normalizeSiteConfig(config))
    });
  } catch (error) {
    return internalError(`Failed to get public tour: ${error.message}`);
  }
}
__name(getPublicTour, "getPublicTour");
async function ensureSiteConfig(tenantId, db) {
  let config = await db.prepare("SELECT * FROM tenant_site_configs WHERE tenant_id = ?").bind(tenantId).first();
  if (config) {
    return config;
  }
  await db.prepare(
    `INSERT INTO tenant_site_configs
			(tenant_id, theme, primary_color, font_family, builder_template, builder_blocks_json, builder_utilities_json, builder_content_json, header_title, footer_text, contact_email, contact_phone, whatsapp_url, default_public_lang, search_enabled, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    tenantId,
    "editorial",
    "#bf5a36",
    "Iowan Old Style",
    LEGACY_BUILDER_COMPAT_DEFAULTS.template,
    JSON.stringify(LEGACY_BUILDER_COMPAT_DEFAULTS.blocks),
    JSON.stringify(LEGACY_BUILDER_COMPAT_DEFAULTS.utilities),
    JSON.stringify(LEGACY_BUILDER_COMPAT_DEFAULTS.content),
    "Tour Collection",
    null,
    null,
    null,
    null,
    "vi",
    1,
    Date.now()
  ).run();
  config = await db.prepare("SELECT * FROM tenant_site_configs WHERE tenant_id = ?").bind(tenantId).first();
  return config;
}
__name(ensureSiteConfig, "ensureSiteConfig");
async function resolveLocalizedPage(tenantId, pageKey, requestedLang, defaultLang, db) {
  const exact = await db.prepare("SELECT tenant_id, page_key, lang, title, content, updated_at FROM tenant_site_pages WHERE tenant_id = ? AND page_key = ? AND lang = ?").bind(tenantId, pageKey, requestedLang).first();
  if (exact) {
    return exact;
  }
  if (requestedLang !== defaultLang) {
    const fallback = await db.prepare("SELECT tenant_id, page_key, lang, title, content, updated_at FROM tenant_site_pages WHERE tenant_id = ? AND page_key = ? AND lang = ?").bind(tenantId, pageKey, defaultLang).first();
    if (fallback) {
      return fallback;
    }
  }
  return db.prepare("SELECT tenant_id, page_key, lang, title, content, updated_at FROM tenant_site_pages WHERE tenant_id = ? AND page_key = ? ORDER BY updated_at DESC LIMIT 1").bind(tenantId, pageKey).first();
}
__name(resolveLocalizedPage, "resolveLocalizedPage");
async function resolveLocalizedTourContent(tenantId, tourId, requestedLang, defaultLang, db) {
  const exact = await db.prepare("SELECT lang, headline, summary, body, updated_at FROM tour_public_contents WHERE tenant_id = ? AND tour_id = ? AND lang = ?").bind(tenantId, tourId, requestedLang).first();
  if (exact) {
    return exact;
  }
  if (requestedLang !== defaultLang) {
    const fallback = await db.prepare("SELECT lang, headline, summary, body, updated_at FROM tour_public_contents WHERE tenant_id = ? AND tour_id = ? AND lang = ?").bind(tenantId, tourId, defaultLang).first();
    if (fallback) {
      return fallback;
    }
  }
  return db.prepare("SELECT lang, headline, summary, body, updated_at FROM tour_public_contents WHERE tenant_id = ? AND tour_id = ? ORDER BY updated_at DESC LIMIT 1").bind(tenantId, tourId).first();
}
__name(resolveLocalizedTourContent, "resolveLocalizedTourContent");
async function resolvePublicTour(tenantId, tourId, requestedLang, defaultLang, db) {
  const tour = await db.prepare("SELECT id, tenant_id, title, lang, start_date, duration_text, status FROM tours WHERE id = ? AND tenant_id = ?").bind(tourId, tenantId).first();
  if (!tour) {
    return null;
  }
  const localized = await resolveLocalizedTourContent(tenantId, tourId, requestedLang, defaultLang, db);
  const preview = buildPublicTourPreview(tour, localized, requestedLang);
  return {
    ...preview,
    body: localized?.body || null
  };
}
__name(resolvePublicTour, "resolvePublicTour");
function buildPublicTourPreview(tour, localized, requestedLang) {
  return {
    id: tour.id,
    title: localized?.headline || tour.title,
    summary: localized?.summary || null,
    start_date: tour.start_date,
    duration_text: tour.duration_text,
    status: tour.status,
    content_lang: localized?.lang || requestedLang || tour.lang || "vi"
  };
}
__name(buildPublicTourPreview, "buildPublicTourPreview");
async function getAvailableLegalPages(tenantId, requestedLang, defaultLang, db) {
  const pages = [];
  for (const key of LEGAL_PAGE_KEYS) {
    const page = await resolveLocalizedPage(tenantId, key, requestedLang, defaultLang, db);
    if (page) {
      pages.push({ page_key: key, lang: page.lang, title: page.title });
    }
  }
  return pages;
}
__name(getAvailableLegalPages, "getAvailableLegalPages");
function normalizeSiteConfig(config) {
  const legacyBuilder = normalizeLegacyBuilderCompat(config);
  return {
    tenant_id: config.tenant_id,
    theme: config.theme,
    primary_color: config.primary_color,
    font_family: config.font_family,
    builder_template: legacyBuilder.template,
    builder_blocks: legacyBuilder.blocks,
    builder_utilities: legacyBuilder.utilities,
    builder_content: legacyBuilder.content,
    header_title: config.header_title,
    footer_text: config.footer_text,
    contact_email: config.contact_email,
    contact_phone: config.contact_phone,
    whatsapp_url: config.whatsapp_url,
    default_public_lang: config.default_public_lang,
    search_enabled: Boolean(config.search_enabled),
    updated_at: config.updated_at
  };
}
__name(normalizeSiteConfig, "normalizeSiteConfig");
function validateSiteConfig(config) {
  for (const field of ["theme", "primary_color", "font_family", "header_title", "default_public_lang"]) {
    if (!config[field] || typeof config[field] !== "string") {
      return validationError(`${field} is required and must be a string`);
    }
  }
  const legacyValidation = validateLegacyBuilderCompat(config);
  if (legacyValidation) {
    return legacyValidation;
  }
  for (const field of ["footer_text", "contact_email", "contact_phone", "whatsapp_url"]) {
    if (config[field] !== null && config[field] !== void 0 && typeof config[field] !== "string") {
      return validationError(`${field} must be a string`);
    }
  }
  if (typeof config.search_enabled !== "boolean") {
    return validationError("search_enabled must be a boolean");
  }
  return null;
}
__name(validateSiteConfig, "validateSiteConfig");
function normalizeBuilderContent(value) {
  const hero = value?.hero && typeof value.hero === "object" ? value.hero : {};
  const cta = value?.cta && typeof value.cta === "object" ? value.cta : {};
  const faq = Array.isArray(value?.faq) ? value.faq : [];
  const testimonials = Array.isArray(value?.testimonials) ? value.testimonials : [];
  return {
    hero: {
      eyebrow: String(hero.eyebrow || LEGACY_BUILDER_COMPAT_DEFAULTS.content.hero.eyebrow),
      headline: String(hero.headline || LEGACY_BUILDER_COMPAT_DEFAULTS.content.hero.headline),
      subtitle: String(hero.subtitle || LEGACY_BUILDER_COMPAT_DEFAULTS.content.hero.subtitle),
      cta_label: String(hero.cta_label || LEGACY_BUILDER_COMPAT_DEFAULTS.content.hero.cta_label),
      cta_href: String(hero.cta_href || LEGACY_BUILDER_COMPAT_DEFAULTS.content.hero.cta_href)
    },
    faq: normalizeFaqItems(faq),
    testimonials: normalizeTestimonialItems(testimonials),
    cta: {
      heading: String(cta.heading || LEGACY_BUILDER_COMPAT_DEFAULTS.content.cta.heading),
      body: String(cta.body || LEGACY_BUILDER_COMPAT_DEFAULTS.content.cta.body),
      button_label: String(cta.button_label || LEGACY_BUILDER_COMPAT_DEFAULTS.content.cta.button_label),
      button_href: String(cta.button_href || LEGACY_BUILDER_COMPAT_DEFAULTS.content.cta.button_href)
    }
  };
}
__name(normalizeBuilderContent, "normalizeBuilderContent");
function normalizeFaqItems(items) {
  const merged = LEGACY_BUILDER_COMPAT_DEFAULTS.content.faq.map((item, index) => {
    const source = items[index] && typeof items[index] === "object" ? items[index] : {};
    return {
      question: String(source.question || item.question),
      answer: String(source.answer || item.answer)
    };
  });
  return merged;
}
__name(normalizeFaqItems, "normalizeFaqItems");
function normalizeTestimonialItems(items) {
  const merged = LEGACY_BUILDER_COMPAT_DEFAULTS.content.testimonials.map((item, index) => {
    const source = items[index] && typeof items[index] === "object" ? items[index] : {};
    return {
      quote: String(source.quote || item.quote),
      name: String(source.name || item.name),
      role: String(source.role || item.role)
    };
  });
  return merged;
}
__name(normalizeTestimonialItems, "normalizeTestimonialItems");
function buildPublicBuilder(config) {
  return {
    template: config.builder_template,
    blocks: config.builder_blocks,
    utilities: config.builder_utilities,
    content: config.builder_content
  };
}
__name(buildPublicBuilder, "buildPublicBuilder");
function normalizeLegacyBuilderCompat(config) {
  let blocks = LEGACY_BUILDER_COMPAT_DEFAULTS.blocks;
  let utilities = LEGACY_BUILDER_COMPAT_DEFAULTS.utilities;
  let content = LEGACY_BUILDER_COMPAT_DEFAULTS.content;
  try {
    const parsed = typeof config.builder_blocks_json === "string" ? JSON.parse(config.builder_blocks_json) : config.builder_blocks;
    if (Array.isArray(parsed)) {
      blocks = parsed.map((item) => String(item));
    }
  } catch {
    blocks = LEGACY_BUILDER_COMPAT_DEFAULTS.blocks;
  }
  try {
    const parsed = typeof config.builder_utilities_json === "string" ? JSON.parse(config.builder_utilities_json) : config.builder_utilities;
    if (Array.isArray(parsed)) {
      utilities = parsed.map((item) => String(item));
    }
  } catch {
    utilities = LEGACY_BUILDER_COMPAT_DEFAULTS.utilities;
  }
  try {
    const parsed = typeof config.builder_content_json === "string" ? JSON.parse(config.builder_content_json) : config.builder_content;
    content = normalizeBuilderContent(parsed);
  } catch {
    content = LEGACY_BUILDER_COMPAT_DEFAULTS.content;
  }
  return {
    template: config.builder_template || LEGACY_BUILDER_COMPAT_DEFAULTS.template,
    blocks,
    utilities,
    content
  };
}
__name(normalizeLegacyBuilderCompat, "normalizeLegacyBuilderCompat");
function validateLegacyBuilderCompat(config) {
  if (!config.builder_template || typeof config.builder_template !== "string") {
    return validationError("builder_template must be a string when legacy Builder compatibility fields are present");
  }
  if (!Array.isArray(config.builder_blocks) || config.builder_blocks.some((item) => typeof item !== "string")) {
    return validationError("builder_blocks must be an array of strings when legacy Builder compatibility fields are present");
  }
  if (!Array.isArray(config.builder_utilities) || config.builder_utilities.some((item) => typeof item !== "string")) {
    return validationError("builder_utilities must be an array of strings when legacy Builder compatibility fields are present");
  }
  if (!config.builder_content || typeof config.builder_content !== "object" || Array.isArray(config.builder_content)) {
    return validationError("builder_content must be an object when legacy Builder compatibility fields are present");
  }
  return null;
}
__name(validateLegacyBuilderCompat, "validateLegacyBuilderCompat");

// src/routes/site-layouts.js
var DEFAULT_LAYOUT = {
  template_engine: "grapesjs",
  status: "draft",
  html: defaultHtmlTemplate(),
  css: defaultCssTemplate(),
  project_data: null,
  updated_at: null,
  published_at: null
};
async function getSiteLayout(request, db) {
  try {
    const tenantId = getTenantId(request);
    const layout = await db.prepare("SELECT * FROM tenant_site_layouts WHERE tenant_id = ?").bind(tenantId).first();
    return successResponse(normalizeLayout(tenantId, layout));
  } catch (error) {
    return internalError(`Failed to get site layout: ${error.message}`);
  }
}
__name(getSiteLayout, "getSiteLayout");
async function upsertSiteLayout(request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const tenantId = getTenantId(request);
    const existing = normalizeLayout(
      tenantId,
      await db.prepare("SELECT * FROM tenant_site_layouts WHERE tenant_id = ?").bind(tenantId).first()
    );
    const body = parsedBody.value;
    const next = {
      template_engine: body.template_engine ?? existing.template_engine,
      status: body.status ?? existing.status,
      html: body.html ?? existing.html,
      css: body.css ?? existing.css,
      project_data: body.project_data ?? existing.project_data
    };
    const validation = validateLayout(next);
    if (validation) {
      return validation;
    }
    const now = Date.now();
    const publishedAt = next.status === "published" ? existing.published_at || now : null;
    await db.prepare(
      `INSERT INTO tenant_site_layouts
			(tenant_id, template_engine, status, html, css, project_json, updated_at, published_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(tenant_id) DO UPDATE SET
				template_engine = excluded.template_engine,
				status = excluded.status,
				html = excluded.html,
				css = excluded.css,
				project_json = excluded.project_json,
				updated_at = excluded.updated_at,
				published_at = excluded.published_at`
    ).bind(
      tenantId,
      next.template_engine,
      next.status,
      next.html,
      next.css,
      next.project_data ? JSON.stringify(next.project_data) : null,
      now,
      publishedAt
    ).run();
    const saved = await db.prepare("SELECT * FROM tenant_site_layouts WHERE tenant_id = ?").bind(tenantId).first();
    return successResponse(normalizeLayout(tenantId, saved));
  } catch (error) {
    return internalError(`Failed to save site layout: ${error.message}`);
  }
}
__name(upsertSiteLayout, "upsertSiteLayout");
async function maybeRenderHostedSite(request, db) {
  try {
    if (request.method !== "GET") {
      return null;
    }
    const url = new URL(request.url);
    if (!shouldHandleHostedSite(url)) {
      return null;
    }
    const domain = await db.prepare("SELECT tenant_id, hostname FROM tenant_domain_configs WHERE hostname = ? AND status = ?").bind(url.hostname.toLowerCase(), "verified").first();
    if (!domain) {
      return null;
    }
    const layoutRow = await db.prepare("SELECT * FROM tenant_site_layouts WHERE tenant_id = ? AND status = ?").bind(domain.tenant_id, "published").first();
    if (!layoutRow) {
      return notFoundHtml("Published site layout not found");
    }
    const siteConfig = await ensureSiteConfig2(domain.tenant_id, db);
    const tours = await listPublishedTours(domain.tenant_id, siteConfig.default_public_lang, db);
    const renderedHtml = renderLayoutHtml(normalizeLayout(domain.tenant_id, layoutRow), siteConfig, tours, url);
    return new Response(renderedHtml, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300"
      }
    });
  } catch (error) {
    return new Response(`<html><body><h1>Hosted site error</h1><pre>${escapeHtml2(error.message)}</pre></body></html>`, {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
}
__name(maybeRenderHostedSite, "maybeRenderHostedSite");
function normalizeLayout(tenantId, layout) {
  if (!layout) {
    return { tenant_id: tenantId, ...DEFAULT_LAYOUT };
  }
  let projectData = null;
  try {
    projectData = layout.project_json ? JSON.parse(layout.project_json) : null;
  } catch {
    projectData = null;
  }
  return {
    tenant_id: tenantId,
    template_engine: layout.template_engine || "grapesjs",
    status: layout.status || "draft",
    html: layout.html || defaultHtmlTemplate(),
    css: layout.css || defaultCssTemplate(),
    project_data: projectData,
    updated_at: layout.updated_at || null,
    published_at: layout.published_at || null
  };
}
__name(normalizeLayout, "normalizeLayout");
function validateLayout(layout) {
  if (!layout.template_engine || typeof layout.template_engine !== "string") {
    return validationError("template_engine is required and must be a string");
  }
  if (!["draft", "published"].includes(layout.status)) {
    return validationError("status must be draft or published");
  }
  for (const field of ["html", "css"]) {
    if (typeof layout[field] !== "string") {
      return validationError(`${field} must be a string`);
    }
  }
  if (layout.project_data !== null && layout.project_data !== void 0 && typeof layout.project_data !== "object") {
    return validationError("project_data must be an object when provided");
  }
  return null;
}
__name(validateLayout, "validateLayout");
function shouldHandleHostedSite(url) {
  const hostname = url.hostname.toLowerCase();
  if (hostname === "example.com" || hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".workers.dev")) {
    return false;
  }
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/public")) {
    return false;
  }
  if (url.pathname === "/sitemap.xml" || url.pathname === "/robots.txt") {
    return false;
  }
  return url.pathname === "/" || url.pathname === "/index.html";
}
__name(shouldHandleHostedSite, "shouldHandleHostedSite");
async function ensureSiteConfig2(tenantId, db) {
  let config = await db.prepare("SELECT * FROM tenant_site_configs WHERE tenant_id = ?").bind(tenantId).first();
  if (config) {
    return config;
  }
  await db.prepare(
    `INSERT INTO tenant_site_configs
		(tenant_id, theme, primary_color, font_family, header_title, footer_text, contact_email, contact_phone, whatsapp_url, default_public_lang, search_enabled, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(tenantId, "editorial", "#bf5a36", "Iowan Old Style", "Tour Collection", null, null, null, null, "vi", 1, Date.now()).run();
  config = await db.prepare("SELECT * FROM tenant_site_configs WHERE tenant_id = ?").bind(tenantId).first();
  return config;
}
__name(ensureSiteConfig2, "ensureSiteConfig");
async function listPublishedTours(tenantId, lang, db) {
  const rows = await db.prepare("SELECT id, title, duration_text FROM tours WHERE tenant_id = ? AND status = ? ORDER BY created_at DESC").bind(tenantId, "on_sale").all();
  const tours = [];
  for (const row of rows.results || []) {
    const localized = await db.prepare("SELECT headline, summary FROM tour_public_contents WHERE tenant_id = ? AND tour_id = ? AND lang = ?").bind(tenantId, row.id, lang).first();
    tours.push({
      id: row.id,
      title: localized?.headline || row.title,
      summary: localized?.summary || "",
      duration_text: row.duration_text || ""
    });
  }
  return tours;
}
__name(listPublishedTours, "listPublishedTours");
function renderLayoutHtml(layout, siteConfig, tours, url) {
  const replacements = /* @__PURE__ */ new Map([
    ["{{SITE_TITLE}}", siteConfig.header_title || "Tour Collection"],
    ["{{SITE_FOOTER}}", siteConfig.footer_text || ""],
    ["{{PRIMARY_COLOR}}", siteConfig.primary_color || "#bf5a36"],
    ["{{CONTACT_EMAIL}}", siteConfig.contact_email || ""],
    ["{{CONTACT_PHONE}}", siteConfig.contact_phone || ""],
    ["{{WHATSAPP_URL}}", siteConfig.whatsapp_url || ""],
    ["{{DOMAIN_NAME}}", url.hostname],
    ["{{TOUR_LIST}}", buildTourListMarkup(tours)]
  ]);
  let html = layout.html;
  let css = layout.css;
  for (const [placeholder, value] of replacements.entries()) {
    html = html.split(placeholder).join(value);
    css = css.split(placeholder).join(value);
  }
  if (!/^<!doctype html>/i.test(html.trim())) {
    html = `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml2(siteConfig.header_title || "Tour Collection")}</title><style>${css}</style></head><body>${html}</body></html>`;
  } else if (css) {
    html = html.replace("</head>", `<style>${css}</style></head>`);
  }
  return html;
}
__name(renderLayoutHtml, "renderLayoutHtml");
function buildTourListMarkup(tours) {
  if (!tours.length) {
    return '<div class="tour-empty">No tours published yet.</div>';
  }
  return `<section class="tour-list">${tours.map(
    (tour) => `<article class="tour-card"><h3>${escapeHtml2(tour.title)}</h3><p>${escapeHtml2(tour.summary || "Signature itinerary ready to publish.")}</p><div class="tour-meta">${escapeHtml2(tour.duration_text || "")}</div></article>`
  ).join("")}</section>`;
}
__name(buildTourListMarkup, "buildTourListMarkup");
function defaultHtmlTemplate() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{{SITE_TITLE}}</title>
</head>
<body>
  <header class="site-hero">
    <p class="site-kicker">Hosted by {{DOMAIN_NAME}}</p>
    <h1>{{SITE_TITLE}}</h1>
    <p class="site-copy">Replace this layout in GrapesJS and keep placeholders like {{TOUR_LIST}} where live SaaS data should be injected.</p>
  </header>
  <main>
    {{TOUR_LIST}}
  </main>
  <footer>{{SITE_FOOTER}}</footer>
</body>
</html>`;
}
__name(defaultHtmlTemplate, "defaultHtmlTemplate");
function defaultCssTemplate() {
  return `:root { --accent: {{PRIMARY_COLOR}}; }
body { font-family: system-ui, sans-serif; margin: 0; color: #1f1a17; background: #f5efe7; }
.site-hero { padding: 72px 24px 32px; background: linear-gradient(135deg, rgba(255,255,255,0.9), rgba(244,233,221,0.95)); }
.site-kicker { text-transform: uppercase; letter-spacing: .12em; color: var(--accent); font-size: 12px; }
h1 { margin: 0 0 12px; font-size: clamp(2.4rem, 7vw, 4.8rem); }
.site-copy { max-width: 56ch; line-height: 1.7; }
main { padding: 24px; }
.tour-list { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.tour-card { padding: 20px; border-radius: 20px; background: white; border: 1px solid rgba(31,26,23,.08); box-shadow: 0 10px 30px rgba(31,26,23,.06); }
.tour-card h3 { margin-top: 0; }
.tour-meta { margin-top: 12px; color: var(--accent); font-weight: 700; }
footer { padding: 24px; color: rgba(31,26,23,.7); }`;
}
__name(defaultCssTemplate, "defaultCssTemplate");
function notFoundHtml(message) {
  return new Response(`<!doctype html><html><body><h1>404</h1><p>${escapeHtml2(message)}</p></body></html>`, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}
__name(notFoundHtml, "notFoundHtml");
function escapeHtml2(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
__name(escapeHtml2, "escapeHtml");

// src/routes/growth.js
var EVENT_NAMES = /* @__PURE__ */ new Set(["view_tour", "click_contact", "submit_booking"]);
var LEAD_CHANNELS = /* @__PURE__ */ new Set(["contact_form", "whatsapp", "call"]);
async function getGrowthConfig(request, db) {
  try {
    const tenantId = getTenantId(request);
    const config = await ensureGrowthConfig(tenantId, db);
    return successResponse(normalizeGrowthConfig(config));
  } catch (error) {
    return internalError(`Failed to get growth config: ${error.message}`);
  }
}
__name(getGrowthConfig, "getGrowthConfig");
async function upsertGrowthConfig(request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const tenantId = getTenantId(request);
    const existing = await ensureGrowthConfig(tenantId, db);
    const body = parsedBody.value;
    const next = {
      google_analytics_id: body.google_analytics_id ?? existing.google_analytics_id,
      facebook_pixel_id: body.facebook_pixel_id ?? existing.facebook_pixel_id,
      tripadvisor_url: body.tripadvisor_url ?? existing.tripadvisor_url,
      google_reviews_url: body.google_reviews_url ?? existing.google_reviews_url,
      whatsapp_url: body.whatsapp_url ?? existing.whatsapp_url,
      call_phone: body.call_phone ?? existing.call_phone,
      contact_email: body.contact_email ?? existing.contact_email,
      trust_badges_json: body.trust_badges_json ?? existing.trust_badges_json
    };
    for (const field of [
      "google_analytics_id",
      "facebook_pixel_id",
      "tripadvisor_url",
      "google_reviews_url",
      "whatsapp_url",
      "call_phone",
      "contact_email"
    ]) {
      if (next[field] !== null && next[field] !== void 0 && typeof next[field] !== "string") {
        return validationError(`${field} must be a string`);
      }
    }
    if (next.trust_badges_json !== null && next.trust_badges_json !== void 0) {
      if (!Array.isArray(next.trust_badges_json)) {
        return validationError("trust_badges_json must be an array");
      }
      for (const item of next.trust_badges_json) {
        if (typeof item !== "string") {
          return validationError("trust_badges_json must contain only strings");
        }
      }
    }
    await db.prepare(
      `INSERT INTO tenant_growth_configs
				(tenant_id, google_analytics_id, facebook_pixel_id, tripadvisor_url, google_reviews_url, whatsapp_url, call_phone, contact_email, trust_badges_json, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(tenant_id) DO UPDATE SET
					google_analytics_id = excluded.google_analytics_id,
					facebook_pixel_id = excluded.facebook_pixel_id,
					tripadvisor_url = excluded.tripadvisor_url,
					google_reviews_url = excluded.google_reviews_url,
					whatsapp_url = excluded.whatsapp_url,
					call_phone = excluded.call_phone,
					contact_email = excluded.contact_email,
					trust_badges_json = excluded.trust_badges_json,
					updated_at = excluded.updated_at`
    ).bind(
      tenantId,
      next.google_analytics_id || null,
      next.facebook_pixel_id || null,
      next.tripadvisor_url || null,
      next.google_reviews_url || null,
      next.whatsapp_url || null,
      next.call_phone || null,
      next.contact_email || null,
      next.trust_badges_json ? JSON.stringify(next.trust_badges_json) : null,
      Date.now()
    ).run();
    const saved = await db.prepare("SELECT * FROM tenant_growth_configs WHERE tenant_id = ?").bind(tenantId).first();
    return successResponse(normalizeGrowthConfig(saved));
  } catch (error) {
    return internalError(`Failed to save growth config: ${error.message}`);
  }
}
__name(upsertGrowthConfig, "upsertGrowthConfig");
async function upsertTourSeoMeta(tourId, request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const { lang, meta_title, meta_description, keywords, og_title, og_description, og_image, snippet_template } = parsedBody.value;
    if (!lang || typeof lang !== "string") {
      return validationError("lang is required and must be a string");
    }
    for (const [field, value] of Object.entries({
      meta_title,
      meta_description,
      keywords,
      og_title,
      og_description,
      og_image,
      snippet_template
    })) {
      if (value !== void 0 && value !== null && typeof value !== "string") {
        return validationError(`${field} must be a string`);
      }
    }
    const tenantId = getTenantId(request);
    const tour = await db.prepare("SELECT id FROM tours WHERE id = ? AND tenant_id = ?").bind(tourId, tenantId).first();
    if (!tour) {
      return notFoundResponse("Tour not found");
    }
    const existing = await db.prepare("SELECT id FROM tour_growth_seo_metas WHERE tenant_id = ? AND tour_id = ? AND lang = ?").bind(tenantId, tourId, lang).first();
    if (existing) {
      await db.prepare(
        `UPDATE tour_growth_seo_metas
					SET meta_title = ?, meta_description = ?, keywords = ?, og_title = ?, og_description = ?, og_image = ?, snippet_template = ?, updated_at = ?
					WHERE id = ?`
      ).bind(meta_title || null, meta_description || null, keywords || null, og_title || null, og_description || null, og_image || null, snippet_template || null, Date.now(), existing.id).run();
    } else {
      await db.prepare(
        `INSERT INTO tour_growth_seo_metas
					(id, tenant_id, tour_id, lang, meta_title, meta_description, keywords, og_title, og_description, og_image, snippet_template, updated_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(generateId(), tenantId, tourId, lang, meta_title || null, meta_description || null, keywords || null, og_title || null, og_description || null, og_image || null, snippet_template || null, Date.now()).run();
    }
    const saved = await resolveSeoMeta(tenantId, tourId, lang, null, db);
    return successResponse(saved);
  } catch (error) {
    return internalError(`Failed to save tour SEO metadata: ${error.message}`);
  }
}
__name(upsertTourSeoMeta, "upsertTourSeoMeta");
async function getTourSeoMeta(tourId, request, db) {
  try {
    const tenantId = getTenantId(request);
    const tour = await db.prepare("SELECT id, lang FROM tours WHERE id = ? AND tenant_id = ?").bind(tourId, tenantId).first();
    if (!tour) {
      return notFoundResponse("Tour not found");
    }
    const url = new URL(request.url);
    const lang = url.searchParams.get("lang") || tour.lang || "vi";
    const seo = await resolveSeoMeta(tenantId, tourId, lang, tour.lang || "vi", db);
    if (!seo) {
      return notFoundResponse("Tour SEO metadata not found");
    }
    return successResponse(seo);
  } catch (error) {
    return internalError(`Failed to get tour SEO metadata: ${error.message}`);
  }
}
__name(getTourSeoMeta, "getTourSeoMeta");
async function upsertTourSlug(tourId, request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const { slug } = parsedBody.value;
    if (!slug || typeof slug !== "string") {
      return validationError("slug is required and must be a string");
    }
    const normalizedSlug = slug.trim().toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedSlug)) {
      return validationError("slug must use lowercase letters, numbers, and hyphens only");
    }
    const tenantId = getTenantId(request);
    const tour = await db.prepare("SELECT id FROM tours WHERE id = ? AND tenant_id = ?").bind(tourId, tenantId).first();
    if (!tour) {
      return notFoundResponse("Tour not found");
    }
    const claimed = await db.prepare("SELECT tour_id FROM tour_growth_slugs WHERE tenant_id = ? AND slug = ? AND tour_id <> ?").bind(tenantId, normalizedSlug, tourId).first();
    if (claimed) {
      return validationError("slug is already used by another tour");
    }
    await db.prepare(
      `INSERT INTO tour_growth_slugs
				(tenant_id, tour_id, slug, updated_at)
				VALUES (?, ?, ?, ?)
				ON CONFLICT(tenant_id, tour_id) DO UPDATE SET
					slug = excluded.slug,
					updated_at = excluded.updated_at`
    ).bind(tenantId, tourId, normalizedSlug, Date.now()).run();
    const saved = await db.prepare("SELECT tenant_id, tour_id, slug, updated_at FROM tour_growth_slugs WHERE tenant_id = ? AND tour_id = ?").bind(tenantId, tourId).first();
    return successResponse(saved);
  } catch (error) {
    return internalError(`Failed to save tour slug: ${error.message}`);
  }
}
__name(upsertTourSlug, "upsertTourSlug");
async function getSitemapXml(request, db) {
  try {
    const tenantId = getTenantId(request);
    const rows = await db.prepare(
      `SELECT s.slug, t.id, t.created_at
				FROM tour_growth_slugs s
				JOIN tours t ON t.id = s.tour_id AND t.tenant_id = s.tenant_id
				WHERE s.tenant_id = ? AND t.status = 'on_sale'
				ORDER BY t.created_at DESC`
    ).bind(tenantId).all();
    const urls = (rows.results || []).map((row) => `<url><loc>/public/tours/slug/${escapeXml(row.slug)}</loc><lastmod>${new Date(row.created_at || Date.now()).toISOString()}</lastmod></url>`).join("");
    const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
    return new Response(xml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8"
      }
    });
  } catch (error) {
    return internalError(`Failed to build sitemap: ${error.message}`);
  }
}
__name(getSitemapXml, "getSitemapXml");
async function getRobotsTxt() {
  const content = ["User-agent: *", "Allow: /", "Sitemap: /sitemap.xml"].join("\n");
  return new Response(content, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}
__name(getRobotsTxt, "getRobotsTxt");
async function getPublicTourBySlug(slug, request, db) {
  try {
    const tenantId = getTenantId(request);
    const slugRow = await db.prepare("SELECT tour_id FROM tour_growth_slugs WHERE tenant_id = ? AND slug = ?").bind(tenantId, slug).first();
    if (!slugRow) {
      return notFoundResponse("Tour not found");
    }
    const tour = await db.prepare("SELECT id, tenant_id, title, lang, start_date, duration_text, status FROM tours WHERE id = ? AND tenant_id = ?").bind(slugRow.tour_id, tenantId).first();
    if (!tour) {
      return notFoundResponse("Tour not found");
    }
    const url = new URL(request.url);
    const lang = url.searchParams.get("lang") || tour.lang || "vi";
    const seo = await resolveSeoMeta(tenantId, tour.id, lang, tour.lang || "vi", db);
    const growth = await ensureGrowthConfig(tenantId, db);
    return successResponse({
      id: tour.id,
      slug,
      title: seo?.meta_title || tour.title,
      meta_description: seo?.meta_description || null,
      og_title: seo?.og_title || seo?.meta_title || tour.title,
      og_description: seo?.og_description || seo?.meta_description || null,
      og_image: seo?.og_image || null,
      keywords: seo?.keywords || null,
      analytics: {
        google_analytics_id: growth.google_analytics_id,
        facebook_pixel_id: growth.facebook_pixel_id
      },
      social: {
        whatsapp_url: growth.whatsapp_url
      }
    });
  } catch (error) {
    return internalError(`Failed to get public tour by slug: ${error.message}`);
  }
}
__name(getPublicTourBySlug, "getPublicTourBySlug");
async function captureLead(request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const tenantId = getTenantId(request);
    const { tour_id, channel, name, email, phone, message } = parsedBody.value;
    if (!channel || !LEAD_CHANNELS.has(channel)) {
      return validationError(`channel must be one of: ${Array.from(LEAD_CHANNELS).join(", ")}`);
    }
    if (!message || typeof message !== "string") {
      return validationError("message is required and must be a string");
    }
    for (const [field, value] of Object.entries({ name, email, phone })) {
      if (value !== void 0 && value !== null && typeof value !== "string") {
        return validationError(`${field} must be a string`);
      }
    }
    if (tour_id !== void 0 && tour_id !== null && typeof tour_id !== "string") {
      return validationError("tour_id must be a string");
    }
    if (tour_id) {
      const tour = await db.prepare("SELECT id FROM tours WHERE id = ? AND tenant_id = ?").bind(tour_id, tenantId).first();
      if (!tour) {
        return validationError("tour_id is invalid for tenant");
      }
    }
    const leadId = generateId();
    const now = Date.now();
    await db.prepare(
      `INSERT INTO growth_leads
				(id, tenant_id, tour_id, channel, name, email, phone, message, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(leadId, tenantId, tour_id || null, channel, name || null, email || null, phone || null, message, now).run();
    return successResponse({ id: leadId, tenant_id: tenantId, tour_id: tour_id || null, channel, created_at: now }, 201);
  } catch (error) {
    return internalError(`Failed to capture lead: ${error.message}`);
  }
}
__name(captureLead, "captureLead");
async function captureGrowthEvent(request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const tenantId = getTenantId(request);
    const { event_name, tour_id, channel, metadata } = parsedBody.value;
    if (!event_name || !EVENT_NAMES.has(event_name)) {
      return validationError(`event_name must be one of: ${Array.from(EVENT_NAMES).join(", ")}`);
    }
    if (tour_id !== void 0 && tour_id !== null && typeof tour_id !== "string") {
      return validationError("tour_id must be a string");
    }
    if (channel !== void 0 && channel !== null && typeof channel !== "string") {
      return validationError("channel must be a string");
    }
    if (metadata !== void 0 && metadata !== null && (typeof metadata !== "object" || Array.isArray(metadata))) {
      return validationError("metadata must be an object");
    }
    if (tour_id) {
      const tour = await db.prepare("SELECT id FROM tours WHERE id = ? AND tenant_id = ?").bind(tour_id, tenantId).first();
      if (!tour) {
        return validationError("tour_id is invalid for tenant");
      }
    }
    const eventId = generateId();
    const now = Date.now();
    await db.prepare(
      `INSERT INTO growth_events
				(id, tenant_id, tour_id, event_name, channel, metadata_json, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(eventId, tenantId, tour_id || null, event_name, channel || null, metadata ? JSON.stringify(metadata) : null, now).run();
    return successResponse({ id: eventId, tenant_id: tenantId, event_name, created_at: now }, 201);
  } catch (error) {
    return internalError(`Failed to capture growth event: ${error.message}`);
  }
}
__name(captureGrowthEvent, "captureGrowthEvent");
async function ensureGrowthConfig(tenantId, db) {
  let config = await db.prepare("SELECT * FROM tenant_growth_configs WHERE tenant_id = ?").bind(tenantId).first();
  if (config) {
    return config;
  }
  await db.prepare(
    `INSERT INTO tenant_growth_configs
			(tenant_id, google_analytics_id, facebook_pixel_id, tripadvisor_url, google_reviews_url, whatsapp_url, call_phone, contact_email, trust_badges_json, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(tenantId, null, null, null, null, null, null, null, JSON.stringify([]), Date.now()).run();
  config = await db.prepare("SELECT * FROM tenant_growth_configs WHERE tenant_id = ?").bind(tenantId).first();
  return config;
}
__name(ensureGrowthConfig, "ensureGrowthConfig");
function normalizeGrowthConfig(config) {
  return {
    tenant_id: config.tenant_id,
    google_analytics_id: config.google_analytics_id,
    facebook_pixel_id: config.facebook_pixel_id,
    tripadvisor_url: config.tripadvisor_url,
    google_reviews_url: config.google_reviews_url,
    whatsapp_url: config.whatsapp_url,
    call_phone: config.call_phone,
    contact_email: config.contact_email,
    trust_badges: parseJsonArray(config.trust_badges_json),
    updated_at: config.updated_at
  };
}
__name(normalizeGrowthConfig, "normalizeGrowthConfig");
async function resolveSeoMeta(tenantId, tourId, requestedLang, defaultLang, db) {
  const exact = await db.prepare("SELECT tenant_id, tour_id, lang, meta_title, meta_description, keywords, og_title, og_description, og_image, snippet_template, updated_at FROM tour_growth_seo_metas WHERE tenant_id = ? AND tour_id = ? AND lang = ?").bind(tenantId, tourId, requestedLang).first();
  if (exact) {
    return exact;
  }
  if (defaultLang && defaultLang !== requestedLang) {
    const fallback = await db.prepare("SELECT tenant_id, tour_id, lang, meta_title, meta_description, keywords, og_title, og_description, og_image, snippet_template, updated_at FROM tour_growth_seo_metas WHERE tenant_id = ? AND tour_id = ? AND lang = ?").bind(tenantId, tourId, defaultLang).first();
    if (fallback) {
      return fallback;
    }
  }
  return db.prepare("SELECT tenant_id, tour_id, lang, meta_title, meta_description, keywords, og_title, og_description, og_image, snippet_template, updated_at FROM tour_growth_seo_metas WHERE tenant_id = ? AND tour_id = ? ORDER BY updated_at DESC LIMIT 1").bind(tenantId, tourId).first();
}
__name(resolveSeoMeta, "resolveSeoMeta");
function parseJsonArray(value) {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
__name(parseJsonArray, "parseJsonArray");
function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
__name(escapeXml, "escapeXml");

// src/routes/booking-settings.js
var DEFAULT_SETTINGS = {
  auto_confirm_min_days: 30,
  auto_confirm_max_pax: 16,
  class_presets: [
    {
      id: "class_standard",
      label: "Standard",
      base_price: 25e5,
      single_room_supplement: 45e4,
      description: "Comfortable hotels, basic local restaurants."
    },
    {
      id: "class_boutique",
      label: "Boutique",
      base_price: 34e5,
      single_room_supplement: 7e5,
      description: "Upscale hotels and curated restaurants."
    },
    {
      id: "class_luxury",
      label: "Luxury/Excellency",
      base_price: 49e5,
      single_room_supplement: 12e5,
      description: "Premium luxury hotels and high-end dining."
    }
  ],
  pricing_tiers: [],
  date_time_format: "dd.mm.yyyy hh:mm",
  pricing_currency_mode: "auto",
  pricing_base_currency: "VND",
  usd_to_vnd_rate: 25e3,
  class_labels: {
    "3_star": "Standard",
    "4_star": "Boutique",
    "5_star": "Luxury/Excellency"
  },
  class_prices: {
    "3_star": 25e5,
    "4_star": 34e5,
    "5_star": 49e5
  },
  class_descriptions: {
    "3_star": "3 star: comfortable hotels (e.g. Mayfair, Silk style), basic local restaurants.",
    "4_star": "4 star: upscale city hotels, curated regional restaurants.",
    "5_star": "5 star: premium luxury hotels, high-end dining experience."
  },
  single_room_supplement: {
    "3_star": 45e4,
    "4_star": 7e5,
    "5_star": 12e5
  },
  child_discount_pct: 0.5
};
async function getBookingSettings(request, db) {
  try {
    const tenantId = getTenantId(request);
    const settings = await loadSettings(tenantId, db);
    return successResponse(settings);
  } catch (error) {
    return internalError(`Failed to get booking settings: ${error.message}`);
  }
}
__name(getBookingSettings, "getBookingSettings");
async function upsertBookingSettings(request, db) {
  try {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const tenantId = getTenantId(request);
    const payload = normalizeSettingsPayload(parsed.value);
    if (!payload.ok) {
      return validationError(payload.message);
    }
    const now = Date.now();
    const normalized = payload.value;
    await db.prepare(
      `INSERT INTO booking_settings
					(tenant_id, auto_confirm_min_days, auto_confirm_max_pax, class_presets_json, pricing_tiers_json, date_time_format, pricing_currency_mode, pricing_base_currency, usd_to_vnd_rate, class_labels_json, class_prices_json, class_descriptions_json, single_room_supplement_json, child_discount_pct, updated_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(tenant_id) DO UPDATE SET
					auto_confirm_min_days = excluded.auto_confirm_min_days,
					auto_confirm_max_pax = excluded.auto_confirm_max_pax,
					class_presets_json = excluded.class_presets_json,
					pricing_tiers_json = excluded.pricing_tiers_json,
						date_time_format = excluded.date_time_format,
					pricing_currency_mode = excluded.pricing_currency_mode,
					pricing_base_currency = excluded.pricing_base_currency,
					usd_to_vnd_rate = excluded.usd_to_vnd_rate,
					class_labels_json = excluded.class_labels_json,
					class_prices_json = excluded.class_prices_json,
					class_descriptions_json = excluded.class_descriptions_json,
					single_room_supplement_json = excluded.single_room_supplement_json,
					child_discount_pct = excluded.child_discount_pct,
					updated_at = excluded.updated_at`
    ).bind(
      tenantId,
      normalized.auto_confirm_min_days,
      normalized.auto_confirm_max_pax,
      JSON.stringify(normalized.class_presets),
      JSON.stringify(normalized.pricing_tiers),
      normalized.date_time_format,
      normalized.pricing_currency_mode,
      normalized.pricing_base_currency,
      normalized.usd_to_vnd_rate,
      JSON.stringify(normalized.class_labels),
      JSON.stringify(normalized.class_prices),
      JSON.stringify(normalized.class_descriptions),
      JSON.stringify(normalized.single_room_supplement),
      normalized.child_discount_pct,
      now
    ).run();
    return successResponse({ ...normalized, updated_at: now });
  } catch (error) {
    return internalError(`Failed to update booking settings: ${error.message}`);
  }
}
__name(upsertBookingSettings, "upsertBookingSettings");
async function getPublicBookingSettings(request, db) {
  try {
    const tenantId = getTenantId(request);
    const settings = await loadSettings(tenantId, db);
    return successResponse(settings);
  } catch (error) {
    return internalError(`Failed to get public booking settings: ${error.message}`);
  }
}
__name(getPublicBookingSettings, "getPublicBookingSettings");
async function getEffectiveBookingSettings(tenantId, db) {
  return loadSettings(tenantId, db);
}
__name(getEffectiveBookingSettings, "getEffectiveBookingSettings");
function normalizeSettingsPayload(input) {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...input,
    class_presets: Array.isArray(input.class_presets) ? input.class_presets : null,
    pricing_tiers: Array.isArray(input.pricing_tiers) ? input.pricing_tiers : DEFAULT_SETTINGS.pricing_tiers,
    class_labels: { ...DEFAULT_SETTINGS.class_labels, ...input.class_labels || {} },
    class_prices: { ...DEFAULT_SETTINGS.class_prices, ...input.class_prices || {} },
    class_descriptions: { ...DEFAULT_SETTINGS.class_descriptions, ...input.class_descriptions || {} },
    single_room_supplement: {
      ...DEFAULT_SETTINGS.single_room_supplement,
      ...input.single_room_supplement || {}
    }
  };
  if (!Number.isInteger(merged.auto_confirm_min_days) || merged.auto_confirm_min_days < 0) {
    return { ok: false, message: "auto_confirm_min_days must be an integer >= 0" };
  }
  if (!Number.isInteger(merged.auto_confirm_max_pax) || merged.auto_confirm_max_pax < 1) {
    return { ok: false, message: "auto_confirm_max_pax must be an integer >= 1" };
  }
  if (!["dd.mm.yyyy hh:mm"].includes(String(merged.date_time_format || "dd.mm.yyyy hh:mm"))) {
    return { ok: false, message: "date_time_format must be dd.mm.yyyy hh:mm" };
  }
  if (!["auto", "USD", "VND"].includes(String(merged.pricing_currency_mode || "auto"))) {
    return { ok: false, message: "pricing_currency_mode must be auto, USD, or VND" };
  }
  if (!["USD", "VND"].includes(String(merged.pricing_base_currency || "VND"))) {
    return { ok: false, message: "pricing_base_currency must be USD or VND" };
  }
  if (!Number.isFinite(Number(merged.usd_to_vnd_rate)) || Number(merged.usd_to_vnd_rate) <= 0) {
    return { ok: false, message: "usd_to_vnd_rate must be > 0" };
  }
  if (typeof merged.child_discount_pct !== "number" || merged.child_discount_pct < 0 || merged.child_discount_pct > 1) {
    return { ok: false, message: "child_discount_pct must be a number between 0 and 1" };
  }
  let normalizedPresets = [];
  if (Array.isArray(merged.class_presets) && merged.class_presets.length > 0) {
    normalizedPresets = merged.class_presets.map((preset, idx) => ({
      id: String(preset.id || `class_${idx + 1}`),
      label: String(preset.label || `Class ${idx + 1}`),
      base_price: Number(preset.base_price || 0),
      single_room_supplement: Number(preset.single_room_supplement || 0),
      description: String(preset.description || "")
    }));
  } else {
    normalizedPresets = [
      {
        id: "3_star",
        label: merged.class_labels["3_star"],
        base_price: merged.class_prices["3_star"],
        single_room_supplement: merged.single_room_supplement["3_star"],
        description: merged.class_descriptions["3_star"]
      },
      {
        id: "4_star",
        label: merged.class_labels["4_star"],
        base_price: merged.class_prices["4_star"],
        single_room_supplement: merged.single_room_supplement["4_star"],
        description: merged.class_descriptions["4_star"]
      },
      {
        id: "5_star",
        label: merged.class_labels["5_star"],
        base_price: merged.class_prices["5_star"],
        single_room_supplement: merged.single_room_supplement["5_star"],
        description: merged.class_descriptions["5_star"]
      }
    ];
  }
  if (!normalizedPresets.length) {
    return { ok: false, message: "class_presets must contain at least one class" };
  }
  for (const preset of normalizedPresets) {
    if (!preset.id.trim()) return { ok: false, message: "Each class preset needs an id" };
    if (!preset.label.trim()) return { ok: false, message: "Each class preset needs a label" };
    if (!Number.isFinite(preset.base_price) || preset.base_price < 0) return { ok: false, message: "Each class preset base_price must be >= 0" };
    if (!Number.isFinite(preset.single_room_supplement) || preset.single_room_supplement < 0) return { ok: false, message: "Each class preset single_room_supplement must be >= 0" };
  }
  const normalizedPricingTiers = Array.isArray(merged.pricing_tiers) ? merged.pricing_tiers.map((tier, idx) => ({
    id: String(tier.id || `tier_${idx + 1}`),
    class_id: String(
      tier.class_id || normalizedPresets.find((preset) => preset.label === String(tier.title || ""))?.id || normalizedPresets[0]?.id || `class_${idx + 1}`
    ),
    season: String(tier.season || ""),
    season_start: String(tier.season_start || ""),
    season_end: String(tier.season_end || ""),
    pax_band: String(tier.pax_band || ""),
    min_pax: Number(tier.min_pax || 1),
    max_pax: Number(tier.max_pax || 99),
    title: String(tier.title || ""),
    adult_shared_price: Number(tier.adult_shared_price || 0),
    adult_single_price: Number(tier.adult_single_price || 0),
    child_shared_price: Number(tier.child_shared_price || 0)
  })).filter((tier) => tier.season && tier.pax_band && tier.title) : [];
  for (const tier of normalizedPricingTiers) {
    if (!Number.isFinite(tier.min_pax) || tier.min_pax < 1) {
      return { ok: false, message: "pricing_tiers.min_pax must be >= 1" };
    }
    if (!Number.isFinite(tier.max_pax) || tier.max_pax < tier.min_pax) {
      return { ok: false, message: "pricing_tiers.max_pax must be >= min_pax" };
    }
    for (const key of ["adult_shared_price", "adult_single_price", "child_shared_price"]) {
      if (!Number.isFinite(tier[key]) || tier[key] < 0) {
        return { ok: false, message: `pricing_tiers.${key} must be >= 0` };
      }
    }
  }
  const derivedLabels = {};
  const derivedPrices = {};
  const derivedDescriptions = {};
  const derivedSupplements = {};
  normalizedPresets.slice(0, 3).forEach((preset, idx) => {
    const key = idx === 0 ? "3_star" : idx === 1 ? "4_star" : "5_star";
    derivedLabels[key] = preset.label;
    derivedPrices[key] = preset.base_price;
    derivedDescriptions[key] = preset.description;
    derivedSupplements[key] = preset.single_room_supplement;
  });
  for (const cls of ["3_star", "4_star", "5_star"]) {
    derivedLabels[cls] = derivedLabels[cls] || DEFAULT_SETTINGS.class_labels[cls];
    derivedPrices[cls] = Number.isFinite(derivedPrices[cls]) ? derivedPrices[cls] : DEFAULT_SETTINGS.class_prices[cls];
    derivedDescriptions[cls] = derivedDescriptions[cls] || DEFAULT_SETTINGS.class_descriptions[cls];
    derivedSupplements[cls] = Number.isFinite(derivedSupplements[cls]) ? derivedSupplements[cls] : DEFAULT_SETTINGS.single_room_supplement[cls];
  }
  return {
    ok: true,
    value: {
      auto_confirm_min_days: merged.auto_confirm_min_days,
      auto_confirm_max_pax: merged.auto_confirm_max_pax,
      class_presets: normalizedPresets,
      pricing_tiers: normalizedPricingTiers,
      date_time_format: String(merged.date_time_format || "dd.mm.yyyy hh:mm"),
      pricing_currency_mode: String(merged.pricing_currency_mode || "auto"),
      pricing_base_currency: String(merged.pricing_base_currency || "VND"),
      usd_to_vnd_rate: Number(merged.usd_to_vnd_rate || 25e3),
      class_labels: derivedLabels,
      class_prices: derivedPrices,
      class_descriptions: derivedDescriptions,
      single_room_supplement: derivedSupplements,
      child_discount_pct: merged.child_discount_pct
    }
  };
}
__name(normalizeSettingsPayload, "normalizeSettingsPayload");
async function loadSettings(tenantId, db) {
  let row = null;
  try {
    row = await db.prepare(
      `SELECT auto_confirm_min_days, auto_confirm_max_pax, class_presets_json, pricing_tiers_json, date_time_format, pricing_currency_mode, pricing_base_currency, usd_to_vnd_rate, class_labels_json, class_prices_json, class_descriptions_json,
				single_room_supplement_json, child_discount_pct, updated_at
				FROM booking_settings WHERE tenant_id = ?`
    ).bind(tenantId).first();
  } catch {
    return {
      ...DEFAULT_SETTINGS,
      updated_at: null
    };
  }
  if (!row) {
    return {
      ...DEFAULT_SETTINGS,
      updated_at: null
    };
  }
  let classPresets = DEFAULT_SETTINGS.class_presets;
  let pricingTiers = DEFAULT_SETTINGS.pricing_tiers;
  let classLabels = DEFAULT_SETTINGS.class_labels;
  let classPrices = DEFAULT_SETTINGS.class_prices;
  let classDescriptions = DEFAULT_SETTINGS.class_descriptions;
  let supplements = DEFAULT_SETTINGS.single_room_supplement;
  try {
    const parsedPresets = JSON.parse(row.class_presets_json || "[]");
    if (Array.isArray(parsedPresets) && parsedPresets.length) {
      classPresets = parsedPresets;
    }
  } catch {
  }
  try {
    const parsedPricing = JSON.parse(row.pricing_tiers_json || "[]");
    if (Array.isArray(parsedPricing)) {
      pricingTiers = parsedPricing;
    }
  } catch {
  }
  try {
    classLabels = { ...classLabels, ...JSON.parse(row.class_labels_json || "{}") };
  } catch {
  }
  try {
    classPrices = { ...classPrices, ...JSON.parse(row.class_prices_json || "{}") };
  } catch {
  }
  try {
    classDescriptions = { ...classDescriptions, ...JSON.parse(row.class_descriptions_json || "{}") };
  } catch {
  }
  try {
    supplements = { ...supplements, ...JSON.parse(row.single_room_supplement_json || "{}") };
  } catch {
  }
  if (!Array.isArray(classPresets) || !classPresets.length) {
    classPresets = DEFAULT_SETTINGS.class_presets;
  }
  return {
    auto_confirm_min_days: row.auto_confirm_min_days,
    auto_confirm_max_pax: row.auto_confirm_max_pax,
    class_presets: classPresets,
    pricing_tiers: pricingTiers,
    date_time_format: row.date_time_format || DEFAULT_SETTINGS.date_time_format,
    pricing_currency_mode: row.pricing_currency_mode || DEFAULT_SETTINGS.pricing_currency_mode,
    pricing_base_currency: row.pricing_base_currency || DEFAULT_SETTINGS.pricing_base_currency,
    usd_to_vnd_rate: Number(row.usd_to_vnd_rate || DEFAULT_SETTINGS.usd_to_vnd_rate),
    class_labels: classLabels,
    class_prices: classPrices,
    class_descriptions: classDescriptions,
    single_room_supplement: supplements,
    child_discount_pct: row.child_discount_pct,
    updated_at: row.updated_at
  };
}
__name(loadSettings, "loadSettings");

// src/routes/bookings.js
async function publicCreateBooking(request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) return parsedBody.response;
    const {
      tour_id,
      traveler_name,
      traveler_email,
      traveler_phone,
      pax,
      child_count,
      single_room_count,
      tour_class,
      message,
      desired_departure_date
    } = parsedBody.value;
    const tenantId = getTenantId(request);
    if (!tour_id || typeof tour_id !== "string") return validationError("tour_id is required");
    if (!traveler_name || typeof traveler_name !== "string") return validationError("traveler_name is required");
    const parsedPax = pax === void 0 ? 1 : Number(pax);
    if (!Number.isInteger(parsedPax) || parsedPax < 1) return validationError("pax must be a positive integer");
    const parsedChildCount = child_count === void 0 ? 0 : Number(child_count);
    const parsedSingleRoomCount = single_room_count === void 0 ? 0 : Number(single_room_count);
    if (!Number.isInteger(parsedChildCount) || parsedChildCount < 0) return validationError("child_count must be an integer >= 0");
    if (!Number.isInteger(parsedSingleRoomCount) || parsedSingleRoomCount < 0) return validationError("single_room_count must be an integer >= 0");
    if (tour_class !== void 0 && typeof tour_class !== "string") {
      return validationError("tour_class must be a string when provided");
    }
    for (const [field, value] of Object.entries({ traveler_email, traveler_phone, message })) {
      if (value !== void 0 && value !== null && typeof value !== "string") {
        return validationError(`${field} must be a string`);
      }
    }
    if (desired_departure_date !== void 0 && (typeof desired_departure_date !== "number" || desired_departure_date <= 0)) {
      return validationError("desired_departure_date must be a positive number (epoch ms) when provided");
    }
    const tour = await db.prepare("SELECT id, tenant_id FROM tours WHERE id = ? AND tenant_id = ? AND status = 'on_sale'").bind(tour_id, tenantId).first();
    if (!tour) return notFoundResponse("Tour not found or not available for booking");
    const bookingId = generateId();
    const now = Date.now();
    const settings = await getEffectiveBookingSettings(tenantId, db);
    const selectedClass = tour_class || settings.class_presets?.[0]?.id || "class_1";
    const defaultAmount = calculateQuoteTotal({
      settings,
      pax: parsedPax,
      childCount: parsedChildCount,
      singleRoomCount: parsedSingleRoomCount,
      tourClass: selectedClass,
      desiredDepartureDate: desired_departure_date
    });
    await db.prepare(
      `INSERT INTO bookings
				(id, tenant_id, tour_id, traveler_name, traveler_email, traveler_phone, pax, child_count, single_room_count, tour_class, quoted_total, message, desired_departure_date, status, payment_status, payment_amount, payment_currency, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'unpaid', ?, 'VND', ?)`
    ).bind(
      bookingId,
      tenantId,
      tour_id,
      traveler_name,
      traveler_email || null,
      traveler_phone || null,
      parsedPax,
      parsedChildCount,
      parsedSingleRoomCount,
      selectedClass,
      defaultAmount,
      message || null,
      desired_departure_date || null,
      defaultAmount,
      now
    ).run();
    return successResponse(
      {
        id: bookingId,
        tenant_id: tenantId,
        tour_id,
        status: "pending",
        payment_status: "unpaid",
        created_at: now,
        _next: `POST /public/bookings/${bookingId}/pay`
      },
      201
    );
  } catch (error) {
    return internalError(`Failed to create booking: ${error.message}`);
  }
}
__name(publicCreateBooking, "publicCreateBooking");
async function publicGetBooking(bookingId, request, db) {
  try {
    const tenantId = getTenantId(request);
    const booking = await db.prepare(
      `SELECT id, tenant_id, tour_id, traveler_name, pax, status, payment_status, payment_currency, created_at
				FROM bookings WHERE id = ? AND tenant_id = ?`
    ).bind(bookingId, tenantId).first();
    if (!booking) return notFoundResponse("Booking not found");
    return successResponse(booking);
  } catch (error) {
    return internalError(`Failed to get booking: ${error.message}`);
  }
}
__name(publicGetBooking, "publicGetBooking");
async function publicPayBooking(bookingId, request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) return parsedBody.response;
    const { card_number, expiry, cvv, amount } = parsedBody.value;
    if (!card_number || typeof card_number !== "string" || card_number.replace(/\s/g, "").length < 12) {
      return validationError("card_number must be at least 12 digits");
    }
    if (!expiry || typeof expiry !== "string") return validationError("expiry is required (MM/YY)");
    if (!cvv || typeof cvv !== "string" || cvv.length < 3) return validationError("cvv must be at least 3 digits");
    if (amount !== void 0 && amount !== null && (typeof amount !== "number" || amount < 0)) {
      return validationError("amount must be a non-negative number");
    }
    const tenantId = getTenantId(request);
    const booking = await db.prepare("SELECT id, status, payment_status, tour_id, desired_departure_date, pax FROM bookings WHERE id = ? AND tenant_id = ?").bind(bookingId, tenantId).first();
    if (!booking) return notFoundResponse("Booking not found");
    if (booking.payment_status === "paid") return validationError("Booking is already paid");
    if (booking.status === "rejected" || booking.status === "cancelled") {
      return validationError("Cannot pay for a rejected or cancelled booking");
    }
    const cardLast4 = card_number.replace(/\s/g, "").slice(-4);
    const payAmount = typeof amount === "number" ? amount : 0;
    const paymentId = generateId();
    const now = Date.now();
    await db.prepare(
      `INSERT INTO demo_payments (id, tenant_id, booking_id, amount, currency, card_last4, status, paid_at)
				VALUES (?, ?, ?, ?, 'VND', ?, 'paid', ?)`
    ).bind(paymentId, tenantId, bookingId, payAmount, cardLast4, now).run();
    const autoSettings = await getEffectiveBookingSettings(tenantId, db);
    const shouldAutoConfirm = canAutoConfirmAfterPayment({
      desiredDepartureDate: booking.desired_departure_date,
      pax: booking.pax,
      settings: autoSettings
    });
    if (shouldAutoConfirm) {
      await db.prepare(`UPDATE bookings SET payment_status = 'paid', payment_amount = ?, status = 'confirmed' WHERE id = ? AND tenant_id = ?`).bind(payAmount, bookingId, tenantId).run();
      try {
        await ensureServiceItemsFromBlueprint(booking.tour_id, tenantId, db);
        await generateTasksForTour(booking.tour_id, db);
      } catch {
      }
    } else {
      await db.prepare(`UPDATE bookings SET payment_status = 'paid', payment_amount = ? WHERE id = ? AND tenant_id = ?`).bind(payAmount, bookingId, tenantId).run();
    }
    return successResponse({
      payment_id: paymentId,
      booking_id: bookingId,
      status: "paid",
      auto_confirmed: shouldAutoConfirm,
      card_last4: cardLast4,
      amount: payAmount,
      currency: "VND",
      paid_at: now,
      message: shouldAutoConfirm ? "Payment recorded and booking auto-confirmed." : "Payment recorded. Booking is awaiting agent confirmation."
    });
  } catch (error) {
    return internalError(`Failed to process demo payment: ${error.message}`);
  }
}
__name(publicPayBooking, "publicPayBooking");
async function listBookings(request, db) {
  try {
    const tenantId = getTenantId(request);
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    let query = `SELECT b.id, b.tour_id, b.traveler_name, b.traveler_email, b.traveler_phone,
			b.pax, b.child_count, b.single_room_count, b.tour_class, b.quoted_total, b.desired_departure_date,
			b.message, b.status, b.payment_status, b.payment_amount, b.payment_currency,
			b.created_at, t.title AS tour_title
			FROM bookings b
			LEFT JOIN tours t ON t.id = b.tour_id AND t.tenant_id = b.tenant_id
			WHERE b.tenant_id = ?`;
    const params = [tenantId];
    if (status) {
      query += " AND b.status = ?";
      params.push(status);
    }
    query += " ORDER BY b.created_at DESC LIMIT 100";
    const rows = await db.prepare(query).bind(...params).all();
    return successResponse({ bookings: rows.results || [] });
  } catch (error) {
    return internalError(`Failed to list bookings: ${error.message}`);
  }
}
__name(listBookings, "listBookings");
async function updateBooking(bookingId, request, db) {
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) return parsedBody.response;
    const tenantId = getTenantId(request);
    const { status } = parsedBody.value;
    const ALLOWED = ["confirmed", "rejected", "completed", "cancelled"];
    if (!status || !ALLOWED.includes(status)) {
      return validationError(`status must be one of: ${ALLOWED.join(", ")}`);
    }
    const booking = await db.prepare("SELECT id, tour_id, status FROM bookings WHERE id = ? AND tenant_id = ?").bind(bookingId, tenantId).first();
    if (!booking) return notFoundResponse("Booking not found");
    if (booking.status === "rejected" || booking.status === "cancelled") {
      return validationError("Cannot transition from a terminal booking status");
    }
    await db.prepare("UPDATE bookings SET status = ? WHERE id = ? AND tenant_id = ?").bind(status, bookingId, tenantId).run();
    let generatedTasks = [];
    if (status === "confirmed") {
      try {
        await ensureServiceItemsFromBlueprint(booking.tour_id, tenantId, db);
        generatedTasks = await generateTasksForTour(booking.tour_id, db);
      } catch {
      }
    }
    const updated = await db.prepare(
      `SELECT id, tour_id, traveler_name, pax, status, payment_status, created_at
				FROM bookings WHERE id = ?`
    ).bind(bookingId).first();
    return successResponse({ ...updated, generated_task_count: generatedTasks.length });
  } catch (error) {
    return internalError(`Failed to update booking: ${error.message}`);
  }
}
__name(updateBooking, "updateBooking");
async function ensureServiceItemsFromBlueprint(tourId, tenantId, db) {
  let destinations;
  try {
    destinations = await db.prepare("SELECT id, name, arrival_date, departure_date, service_blueprint_json FROM destinations WHERE tour_id = ? AND tenant_id = ? ORDER BY position ASC").bind(tourId, tenantId).all();
  } catch {
    destinations = await db.prepare("SELECT id, name, arrival_date, departure_date FROM destinations WHERE tour_id = ? AND tenant_id = ? ORDER BY position ASC").bind(tourId, tenantId).all();
  }
  for (const destination of destinations.results || []) {
    const blueprint = parseBlueprint2(destination.service_blueprint_json);
    if (blueprint.accommodations) {
      await ensureAccommodation(destination, tenantId, db);
    }
    if (blueprint.meals) {
      await ensureMeal(destination, tenantId, db);
    }
    if (blueprint.guides) {
      await ensureGuide(destination, tenantId, db);
    }
    if (blueprint.local_transports) {
      await ensureLocalTransport(destination, tenantId, db);
    }
    if (blueprint.intercity_legs) {
      await ensureIntercityLeg(destination, tenantId, db);
    }
  }
}
__name(ensureServiceItemsFromBlueprint, "ensureServiceItemsFromBlueprint");
function canAutoConfirmAfterPayment({ desiredDepartureDate, pax, settings }) {
  if (!desiredDepartureDate || typeof desiredDepartureDate !== "number") {
    return false;
  }
  const minDays = settings?.auto_confirm_min_days ?? 30;
  const maxPax = settings?.auto_confirm_max_pax ?? 16;
  const requiredMs = minDays * 24 * 60 * 60 * 1e3;
  const leadTimeOk = desiredDepartureDate - Date.now() >= requiredMs;
  const paxOk = typeof pax === "number" && pax < maxPax;
  return leadTimeOk && paxOk;
}
__name(canAutoConfirmAfterPayment, "canAutoConfirmAfterPayment");
function calculateQuoteTotal({ settings, pax, childCount, singleRoomCount, tourClass, desiredDepartureDate }) {
  const pricingTiers = Array.isArray(settings.pricing_tiers) ? settings.pricing_tiers : [];
  const matchedTiers = pricingTiers.filter((tier) => matchPricingTier(tier, pax, desiredDepartureDate));
  if (matchedTiers.length) {
    const selectedTier = matchedTiers.find((tier) => tier.id === tourClass || tier.title === tourClass) || matchedTiers[0];
    const adults = Math.max(0, pax - childCount);
    const singleAdults = Math.min(adults, Math.max(0, singleRoomCount));
    const sharedAdults = Math.max(0, adults - singleAdults);
    return sharedAdults * Number(selectedTier.adult_shared_price || 0) + singleAdults * Number(selectedTier.adult_single_price || 0) + childCount * Number(selectedTier.child_shared_price || 0);
  }
  const presets = Array.isArray(settings.class_presets) ? settings.class_presets : [];
  const matched = presets.find((preset) => preset.id === tourClass) || presets[0] || null;
  const classPrice = Number(matched?.base_price || settings.class_prices?.[tourClass] || settings.class_prices?.["3_star"] || 0);
  const singleSupp = Number(matched?.single_room_supplement || settings.single_room_supplement?.[tourClass] || settings.single_room_supplement?.["3_star"] || 0);
  const childDiscount = typeof settings.child_discount_pct === "number" ? settings.child_discount_pct : 0.5;
  const payingAdults = Math.max(0, pax - childCount);
  const childPrice = classPrice * childDiscount;
  return payingAdults * classPrice + childCount * childPrice + singleRoomCount * singleSupp;
}
__name(calculateQuoteTotal, "calculateQuoteTotal");
function matchPricingTier(tier, pax, desiredDepartureDate) {
  if (!tier || typeof tier !== "object") return false;
  const minPax = Number(tier.min_pax || 1);
  const maxPax = Number(tier.max_pax || 999);
  if (pax < minPax || pax > maxPax) return false;
  if (!desiredDepartureDate || typeof desiredDepartureDate !== "number") return true;
  const date = new Date(desiredDepartureDate);
  if (Number.isNaN(date.getTime())) return true;
  const current = (date.getMonth() + 1) * 100 + date.getDate();
  const start = mmddToInt(tier.season_start);
  const end = mmddToInt(tier.season_end);
  if (!start || !end) return true;
  if (start <= end) {
    return current >= start && current <= end;
  }
  return current >= start || current <= end;
}
__name(matchPricingTier, "matchPricingTier");
function mmddToInt(value) {
  if (typeof value !== "string") return 0;
  const m = value.match(/^(\d{2})-(\d{2})$/);
  if (!m) return 0;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return 0;
  return month * 100 + day;
}
__name(mmddToInt, "mmddToInt");
function parseBlueprint2(rawValue) {
  const fallback = {
    accommodations: false,
    meals: false,
    guides: false,
    local_transports: false,
    intercity_legs: false,
    intercity_mode: "train"
  };
  if (!rawValue) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(rawValue);
    return {
      accommodations: Boolean(parsed.accommodations),
      meals: Boolean(parsed.meals),
      guides: Boolean(parsed.guides),
      local_transports: Boolean(parsed.local_transports),
      intercity_legs: Boolean(parsed.intercity_legs),
      intercity_mode: parsed.intercity_mode || "train"
    };
  } catch {
    return fallback;
  }
}
__name(parseBlueprint2, "parseBlueprint");
async function ensureAccommodation(destination, tenantId, db) {
  const existing = await db.prepare("SELECT id FROM dest_accommodations WHERE destination_id = ? AND tenant_id = ? LIMIT 1").bind(destination.id, tenantId).first();
  if (existing) return;
  const now = Date.now();
  await db.prepare(
    `INSERT INTO dest_accommodations
			(id, tenant_id, destination_id, hotel_name, check_in, check_out, status, position, created_at,
			 person_in_charge, contact_name, contact_phone, contact_email, address, notes, stage, communication_channels_json)
			VALUES (?, ?, ?, ?, ?, ?, 'planned', 1, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).bind(
    generateId(),
    tenantId,
    destination.id,
    `${destination.name} Stay (auto)`,
    destination.arrival_date || null,
    destination.departure_date || null,
    now,
    "System Auto CRM",
    "TBD",
    null,
    null,
    `${destination.name} (TBD address)`,
    "Auto-created from service toggle on booking confirmation",
    JSON.stringify(["email"])
  ).run();
}
__name(ensureAccommodation, "ensureAccommodation");
async function ensureMeal(destination, tenantId, db) {
  const existing = await db.prepare("SELECT id FROM dest_meals WHERE destination_id = ? AND tenant_id = ? LIMIT 1").bind(destination.id, tenantId).first();
  if (existing) return;
  const now = Date.now();
  await db.prepare(
    `INSERT INTO dest_meals
			(id, tenant_id, destination_id, meal_type, restaurant_name, meal_datetime, status, position, created_at,
			 person_in_charge, contact_name, contact_phone, contact_email, address, notes, stage, communication_channels_json)
			VALUES (?, ?, ?, 'dinner', ?, ?, 'planned', 1, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).bind(
    generateId(),
    tenantId,
    destination.id,
    `${destination.name} Meal (auto)`,
    destination.arrival_date || null,
    now,
    "System Auto CRM",
    "TBD",
    null,
    null,
    `${destination.name} (TBD restaurant address)`,
    "Auto-created from service toggle on booking confirmation",
    JSON.stringify(["email"])
  ).run();
}
__name(ensureMeal, "ensureMeal");
async function ensureGuide(destination, tenantId, db) {
  const existing = await db.prepare("SELECT id FROM dest_guides WHERE destination_id = ? AND tenant_id = ? LIMIT 1").bind(destination.id, tenantId).first();
  if (existing) return;
  const now = Date.now();
  const timeFrom = destination.arrival_date || null;
  const timeTo = destination.departure_date || null;
  await db.prepare(
    `INSERT INTO dest_guides
			(id, tenant_id, destination_id, guide_name, time_from, time_to, status, position, created_at,
			 person_in_charge, contact_name, contact_phone, contact_email, address, notes, stage, communication_channels_json)
			VALUES (?, ?, ?, ?, ?, ?, 'planned', 1, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).bind(
    generateId(),
    tenantId,
    destination.id,
    `${destination.name} Guide (auto)`,
    timeFrom,
    timeTo,
    now,
    "System Auto CRM",
    "TBD",
    null,
    null,
    `${destination.name} (TBD guide meetup point)`,
    "Auto-created from service toggle on booking confirmation",
    JSON.stringify(["zalo"])
  ).run();
}
__name(ensureGuide, "ensureGuide");
async function ensureLocalTransport(destination, tenantId, db) {
  const existing = await db.prepare("SELECT id FROM dest_local_transports WHERE destination_id = ? AND tenant_id = ? LIMIT 1").bind(destination.id, tenantId).first();
  if (existing) return;
  const now = Date.now();
  await db.prepare(
    `INSERT INTO dest_local_transports
			(id, tenant_id, destination_id, mode, supplier, pickup_time, pickup_place, dropoff_place, status, position, created_at,
			 person_in_charge, contact_name, contact_phone, contact_email, address, notes, stage, communication_channels_json)
			VALUES (?, ?, ?, 'van', ?, ?, ?, ?, 'planned', 1, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).bind(
    generateId(),
    tenantId,
    destination.id,
    `${destination.name} Local Transport (auto)`,
    destination.arrival_date || null,
    `${destination.name} arrival`,
    `${destination.name} city center`,
    now,
    "System Auto CRM",
    "TBD",
    null,
    null,
    `${destination.name} (TBD transport operator address)`,
    "Auto-created from service toggle on booking confirmation",
    JSON.stringify(["sms"])
  ).run();
}
__name(ensureLocalTransport, "ensureLocalTransport");
async function ensureIntercityLeg(destination, tenantId, db, mode = "train") {
  const existing = await db.prepare("SELECT id FROM dest_intercity_legs WHERE destination_id = ? AND tenant_id = ? LIMIT 1").bind(destination.id, tenantId).first();
  if (existing) return;
  const now = Date.now();
  await db.prepare(
    `INSERT INTO dest_intercity_legs
			(id, tenant_id, destination_id, mode, supplier, depart_time, depart_point, arrive_point, status, position, created_at,
			 person_in_charge, contact_name, contact_phone, contact_email, address, notes, stage, communication_channels_json)
			VALUES (?, ?, ?, 'train', ?, ?, ?, ?, 'planned', 1, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).bind(
    generateId(),
    tenantId,
    destination.id,
    `${destination.name} Intercity Leg (auto)`,
    destination.departure_date || destination.arrival_date || null,
    destination.name,
    "TBD",
    now,
    "System Auto CRM",
    "TBD",
    null,
    null,
    `${destination.name} (TBD departure terminal)`,
    "Auto-created from service toggle on booking confirmation",
    JSON.stringify(["email"])
  ).run();
  await db.prepare("UPDATE dest_intercity_legs SET mode = ? WHERE destination_id = ? AND tenant_id = ?").bind(mode || "train", destination.id, tenantId).run();
}
__name(ensureIntercityLeg, "ensureIntercityLeg");

// src/lib/observability.js
function createRequestContext(request) {
  const requestId = request.headers.get("X-Request-ID") || crypto.randomUUID();
  const startedAt = Date.now();
  const url = new URL(request.url);
  return {
    requestId,
    startedAt,
    method: request.method,
    path: url.pathname,
    search: url.search,
    tenantId: request.headers.get("X-Tenant-ID") || "anonymous"
  };
}
__name(createRequestContext, "createRequestContext");
function logRequestStart(context) {
  logStructured("info", "request.start", {
    request_id: context.requestId,
    method: context.method,
    path: context.path,
    search: context.search,
    tenant_id: context.tenantId
  });
}
__name(logRequestStart, "logRequestStart");
function logRequestFinish(context, response, routeName) {
  const durationMs = Date.now() - context.startedAt;
  logStructured("info", "request.finish", {
    request_id: context.requestId,
    method: context.method,
    path: context.path,
    route: routeName,
    status: response.status,
    duration_ms: durationMs,
    tenant_id: context.tenantId
  });
}
__name(logRequestFinish, "logRequestFinish");
function logRequestError(context, error, routeName) {
  const durationMs = Date.now() - context.startedAt;
  logStructured("error", "request.error", {
    request_id: context.requestId,
    method: context.method,
    path: context.path,
    route: routeName,
    duration_ms: durationMs,
    tenant_id: context.tenantId,
    error_name: error?.name || "Error",
    error_message: error?.message || "Unknown error"
  });
}
__name(logRequestError, "logRequestError");
function attachTraceHeaders(response, context) {
  const durationMs = Date.now() - context.startedAt;
  const headers = new Headers(response.headers);
  headers.set("X-Request-ID", context.requestId);
  headers.set("Server-Timing", `app;dur=${durationMs}`);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
__name(attachTraceHeaders, "attachTraceHeaders");
function logStructured(level, event, fields) {
  const entry = {
    level,
    event,
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    ...fields
  };
  if (level === "error") {
    console.error(JSON.stringify(entry));
    return;
  }
  console.log(JSON.stringify(entry));
}
__name(logStructured, "logStructured");

// src/index.js
var index_default = {
  async fetch(request, env, ctx) {
    const context = createRequestContext(request);
    logRequestStart(context);
    let routeName = "not_found";
    try {
      const result = await dispatchRequest(request, env);
      routeName = result.routeName;
      const tracedResponse = attachTraceHeaders(result.response, context);
      logRequestFinish(context, tracedResponse, routeName);
      return tracedResponse;
    } catch (error) {
      logRequestError(context, error, routeName);
      const response = attachTraceHeaders(errorResponse("Unhandled worker error", 500), context);
      logRequestFinish(context, response, routeName);
      return response;
    }
  }
};
async function dispatchRequest(request, env) {
  const url = new URL(request.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const serviceGroups = /* @__PURE__ */ new Set(["accommodations", "meals", "guides", "local-transports", "intercity-legs"]);
  const hostedSiteResponse = await maybeRenderHostedSite(request, env.DB);
  if (hostedSiteResponse) {
    return { routeName: "hosted.site.render", response: hostedSiteResponse };
  }
  if (url.pathname === "/message") {
    return { routeName: "demo.message", response: new Response("Hello, World!") };
  }
  if (url.pathname === "/random") {
    return { routeName: "demo.random", response: new Response(crypto.randomUUID()) };
  }
  const redirectMap = /* @__PURE__ */ new Map([
    ["/test/saas-admin", "/"],
    ["/test/agent-admin", "/"],
    ["/test/saas-frontend", "/book.html"],
    ["/test/traveler-frontend", "/book.html"],
    ["/preview", "/"],
    ["/live", "/"],
    ["/pro", "/"]
  ]);
  if (redirectMap.has(url.pathname)) {
    const target = redirectMap.get(url.pathname);
    return {
      routeName: "env.redirect",
      response: Response.redirect(new URL(target, url.origin).toString(), 302)
    };
  }
  if (url.pathname === "/api/tours" && request.method === "POST") {
    return { routeName: "tours.create", response: await createTour(request, env.DB) };
  }
  if (pathParts.length === 4 && pathParts[0] === "api" && pathParts[1] === "tours" && pathParts[3] === "destinations") {
    const tourId = pathParts[2];
    if (request.method === "POST") {
      return { routeName: "destinations.create", response: await addDestination(tourId, request, env.DB) };
    }
    if (request.method === "GET") {
      return { routeName: "destinations.list", response: await listDestinations(tourId, request, env.DB) };
    }
  }
  if (pathParts.length === 4 && pathParts[0] === "api" && pathParts[1] === "tours" && pathParts[3] === "itinerary" && request.method === "GET") {
    const tourId = pathParts[2];
    return { routeName: "tours.itinerary", response: await getItinerary(tourId, request, env.DB) };
  }
  if (pathParts.length === 3 && pathParts[0] === "api" && pathParts[1] === "tours") {
    const tourId = pathParts[2];
    if (request.method === "GET") {
      return { routeName: "tours.get", response: await getTour(tourId, env.DB, request) };
    }
    if (request.method === "PATCH") {
      return { routeName: "tours.update", response: await updateTour(tourId, request, env.DB) };
    }
  }
  if (pathParts.length === 3 && pathParts[0] === "api" && pathParts[1] === "destinations" && request.method === "PATCH") {
    const destId = pathParts[2];
    return { routeName: "destinations.update", response: await updateDestination(destId, request, env.DB) };
  }
  if (pathParts.length === 3 && pathParts[0] === "api" && pathParts[1] === "destinations" && request.method === "DELETE") {
    const destId = pathParts[2];
    return { routeName: "destinations.delete", response: await deleteDestination(destId, request, env.DB) };
  }
  if (pathParts.length === 4 && pathParts[0] === "api" && pathParts[1] === "destinations" && pathParts[3] === "service-blueprint") {
    const destId = pathParts[2];
    if (request.method === "GET") {
      return { routeName: "destinations.service_blueprint.get", response: await getDestinationServiceBlueprint(destId, request, env.DB) };
    }
    if (request.method === "POST") {
      return { routeName: "destinations.service_blueprint.upsert", response: await upsertDestinationServiceBlueprint(destId, request, env.DB) };
    }
  }
  if (pathParts.length === 4 && pathParts[0] === "api" && pathParts[1] === "destinations" && serviceGroups.has(pathParts[3])) {
    const destinationId = pathParts[2];
    const groupKey = pathParts[3];
    if (request.method === "POST") {
      return { routeName: `services.${groupKey}.create`, response: await createServiceItem(groupKey, destinationId, request, env.DB) };
    }
    if (request.method === "GET") {
      return { routeName: `services.${groupKey}.list`, response: await listServiceItems(groupKey, destinationId, request, env.DB) };
    }
  }
  if (pathParts.length === 3 && pathParts[0] === "api" && serviceGroups.has(pathParts[1]) && request.method === "PATCH") {
    const groupKey = pathParts[1];
    const itemId = pathParts[2];
    return { routeName: `services.${groupKey}.update`, response: await updateServiceItem(groupKey, itemId, request, env.DB) };
  }
  if (url.pathname === "/api/tasks/generate-for-tour" && request.method === "POST") {
    return { routeName: "tasks.generate_for_tour", response: await generateTasksForTourEndpoint(request, env.DB) };
  }
  if (url.pathname === "/api/tasks" && request.method === "GET") {
    return { routeName: "tasks.list", response: await listTasks(request, env.DB) };
  }
  if (url.pathname === "/api/suppliers") {
    if (request.method === "POST") {
      return { routeName: "suppliers.create", response: await createSupplier(request, env.DB) };
    }
    if (request.method === "GET") {
      return { routeName: "suppliers.list", response: await listSuppliers(request, env.DB) };
    }
  }
  if (url.pathname === "/api/mobile/tasks" && request.method === "GET") {
    return { routeName: "mobile.tasks.list", response: await listMobileTasks(request, env.DB) };
  }
  if (url.pathname === "/api/domain/config") {
    if (request.method === "GET") {
      return { routeName: "domain.config.get", response: await getDomainConfig(request, env.DB) };
    }
    if (request.method === "POST") {
      return { routeName: "domain.config.upsert", response: await upsertDomainConfig(request, env.DB) };
    }
  }
  if (url.pathname === "/api/domain/verify" && request.method === "POST") {
    return { routeName: "domain.verify", response: await verifyDomain(request, env.DB) };
  }
  if (url.pathname === "/api/publish/gate") {
    if (request.method === "GET") {
      return { routeName: "publish.gate.get", response: await getPublishGate(request, env.DB) };
    }
    if (request.method === "POST") {
      return { routeName: "publish.gate.upsert", response: await upsertPublishGate(request, env.DB) };
    }
  }
  if (url.pathname === "/api/billing/status") {
    if (request.method === "GET") {
      return { routeName: "billing.status.get", response: await getBillingStatus(request, env.DB) };
    }
    if (request.method === "POST") {
      return { routeName: "billing.status.upsert", response: await upsertBillingStatus(request, env.DB) };
    }
  }
  if (url.pathname === "/api/site/config") {
    if (request.method === "GET") {
      return { routeName: "site.config.get", response: await getSiteConfig(request, env.DB) };
    }
    if (request.method === "POST") {
      return { routeName: "site.config.upsert", response: await upsertSiteConfig(request, env.DB) };
    }
  }
  if (url.pathname === "/api/site/layout") {
    if (request.method === "GET") {
      return { routeName: "site.layout.get", response: await getSiteLayout(request, env.DB) };
    }
    if (request.method === "POST") {
      return { routeName: "site.layout.upsert", response: await upsertSiteLayout(request, env.DB) };
    }
  }
  if (url.pathname === "/api/site/pages") {
    if (request.method === "GET") {
      return { routeName: "site.pages.get", response: await getLegalPage(request, env.DB) };
    }
    if (request.method === "POST") {
      return { routeName: "site.pages.upsert", response: await upsertLegalPage(request, env.DB) };
    }
  }
  if (pathParts.length === 5 && pathParts[0] === "api" && pathParts[1] === "site" && pathParts[2] === "tours" && pathParts[4] === "content") {
    const tourId = pathParts[3];
    if (request.method === "GET") {
      return { routeName: "site.tours.content.get", response: await getTourPublicContent(tourId, request, env.DB) };
    }
    if (request.method === "POST") {
      return { routeName: "site.tours.content.upsert", response: await upsertTourPublicContent(tourId, request, env.DB) };
    }
  }
  if (url.pathname === "/public/site" && request.method === "GET") {
    return { routeName: "public.site.get", response: await getPublicSite(request, env.DB) };
  }
  if (url.pathname === "/public/tours" && request.method === "GET") {
    return { routeName: "public.tours.list", response: await listPublicTours(request, env.DB) };
  }
  if (pathParts.length === 4 && pathParts[0] === "public" && pathParts[1] === "tours" && pathParts[2] === "slug" && request.method === "GET") {
    const slug = pathParts[3];
    return { routeName: "public.tours.slug.get", response: await getPublicTourBySlug(slug, request, env.DB) };
  }
  if (pathParts.length === 3 && pathParts[0] === "public" && pathParts[1] === "tours" && request.method === "GET") {
    const tourId = pathParts[2];
    return { routeName: "public.tours.get", response: await getPublicTour(tourId, request, env.DB) };
  }
  if (url.pathname === "/api/growth/config") {
    if (request.method === "GET") {
      return { routeName: "growth.config.get", response: await getGrowthConfig(request, env.DB) };
    }
    if (request.method === "POST") {
      return { routeName: "growth.config.upsert", response: await upsertGrowthConfig(request, env.DB) };
    }
  }
  if (pathParts.length === 5 && pathParts[0] === "api" && pathParts[1] === "growth" && pathParts[2] === "tours" && pathParts[4] === "seo") {
    const tourId = pathParts[3];
    if (request.method === "GET") {
      return { routeName: "growth.tours.seo.get", response: await getTourSeoMeta(tourId, request, env.DB) };
    }
    if (request.method === "POST") {
      return { routeName: "growth.tours.seo.upsert", response: await upsertTourSeoMeta(tourId, request, env.DB) };
    }
  }
  if (pathParts.length === 5 && pathParts[0] === "api" && pathParts[1] === "growth" && pathParts[2] === "tours" && pathParts[4] === "slug" && request.method === "POST") {
    const tourId = pathParts[3];
    return { routeName: "growth.tours.slug.upsert", response: await upsertTourSlug(tourId, request, env.DB) };
  }
  if (url.pathname === "/public/leads/contact" && request.method === "POST") {
    return { routeName: "public.leads.contact.capture", response: await captureLead(request, env.DB) };
  }
  if (url.pathname === "/public/events" && request.method === "POST") {
    return { routeName: "public.events.capture", response: await captureGrowthEvent(request, env.DB) };
  }
  if (url.pathname === "/sitemap.xml" && request.method === "GET") {
    return { routeName: "public.sitemap", response: await getSitemapXml(request, env.DB) };
  }
  if (url.pathname === "/robots.txt" && request.method === "GET") {
    return { routeName: "public.robots", response: await getRobotsTxt(request, env.DB) };
  }
  if (url.pathname === "/public/bookings" && request.method === "POST") {
    return { routeName: "public.bookings.create", response: await publicCreateBooking(request, env.DB) };
  }
  if (url.pathname === "/public/booking-settings" && request.method === "GET") {
    return { routeName: "public.booking_settings.get", response: await getPublicBookingSettings(request, env.DB) };
  }
  if (pathParts.length === 4 && pathParts[0] === "public" && pathParts[1] === "bookings" && pathParts[3] === "pay" && request.method === "POST") {
    const bookingId = pathParts[2];
    return { routeName: "public.bookings.pay", response: await publicPayBooking(bookingId, request, env.DB) };
  }
  if (pathParts.length === 3 && pathParts[0] === "public" && pathParts[1] === "bookings" && request.method === "GET") {
    const bookingId = pathParts[2];
    return { routeName: "public.bookings.get", response: await publicGetBooking(bookingId, request, env.DB) };
  }
  if (url.pathname === "/api/bookings" && request.method === "GET") {
    return { routeName: "api.bookings.list", response: await listBookings(request, env.DB) };
  }
  if (url.pathname === "/api/booking-settings") {
    if (request.method === "GET") {
      return { routeName: "api.booking_settings.get", response: await getBookingSettings(request, env.DB) };
    }
    if (request.method === "POST") {
      return { routeName: "api.booking_settings.upsert", response: await upsertBookingSettings(request, env.DB) };
    }
  }
  if (pathParts.length === 3 && pathParts[0] === "api" && pathParts[1] === "bookings" && request.method === "PATCH") {
    const bookingId = pathParts[2];
    return { routeName: "api.bookings.update", response: await updateBooking(bookingId, request, env.DB) };
  }
  if (url.pathname === "/api/tasks/reminders/candidates" && request.method === "GET") {
    return { routeName: "tasks.reminders.candidates", response: await listReminderCandidates(request, env.DB) };
  }
  if (pathParts.length === 3 && pathParts[0] === "api" && pathParts[1] === "tasks") {
    const taskId = pathParts[2];
    if (request.method === "GET") {
      return { routeName: "tasks.get", response: await getTask(taskId, request, env.DB) };
    }
    if (request.method === "PATCH") {
      return { routeName: "tasks.update", response: await updateTask(taskId, request, env.DB) };
    }
  }
  if (pathParts.length === 5 && pathParts[0] === "api" && pathParts[1] === "tasks" && pathParts[3] === "reminders" && pathParts[4] === "mark-sent" && request.method === "POST") {
    const taskId = pathParts[2];
    return { routeName: "tasks.reminders.mark_sent", response: await markReminderSent(taskId, request, env.DB) };
  }
  if (pathParts.length === 5 && pathParts[0] === "api" && pathParts[1] === "mobile" && pathParts[2] === "tasks" && pathParts[4] === "note" && request.method === "POST") {
    const taskId = pathParts[3];
    return { routeName: "mobile.tasks.note", response: await addMobileTaskNote(taskId, request, env.DB) };
  }
  if (pathParts.length === 5 && pathParts[0] === "api" && pathParts[1] === "mobile" && pathParts[2] === "tasks" && pathParts[4] === "status" && request.method === "POST") {
    const taskId = pathParts[3];
    return { routeName: "mobile.tasks.status", response: await updateMobileTaskStatus(taskId, request, env.DB) };
  }
  if (pathParts.length === 3 && pathParts[0] === "api" && pathParts[1] === "suppliers" && request.method === "PATCH") {
    const supplierId = pathParts[2];
    return { routeName: "suppliers.update", response: await updateSupplier(supplierId, request, env.DB) };
  }
  if (url.pathname === "/api/calendar/config") {
    if (request.method === "GET") {
      return { routeName: "calendar.config.get", response: await getCalendarConfig(request, env.DB) };
    }
    if (request.method === "POST") {
      return { routeName: "calendar.config.upsert", response: await upsertCalendarConfig(request, env.DB) };
    }
  }
  if (pathParts.length === 5 && pathParts[0] === "api" && pathParts[1] === "calendar" && pathParts[2] === "tours" && pathParts[4] === "tasks.ics" && request.method === "GET") {
    const tourId = pathParts[3];
    return { routeName: "calendar.tour.feed", response: await getTourCalendarFeed(tourId, request, env.DB) };
  }
  if (pathParts.length === 6 && pathParts[0] === "api" && pathParts[1] === "calendar" && pathParts[2] === "tours" && pathParts[4] === "google-sync" && pathParts[5] === "preview" && request.method === "GET") {
    const tourId = pathParts[3];
    return { routeName: "calendar.tour.google_sync_preview", response: await getGoogleSyncPreview(tourId, request, env.DB) };
  }
  if (pathParts.length === 4 && pathParts[0] === "api" && pathParts[1] === "threads" && pathParts[3] === "note" && request.method === "POST") {
    const threadId = pathParts[2];
    return { routeName: "threads.add_note", response: await addNote(threadId, request, env.DB) };
  }
  if (pathParts.length === 4 && pathParts[0] === "api" && pathParts[1] === "threads" && pathParts[3] === "messages" && request.method === "GET") {
    const threadId = pathParts[2];
    return { routeName: "threads.messages", response: await getMessages(threadId, request, env.DB) };
  }
  if (url.pathname.match(/^\/api\/threads\/[^/]+\/[^/]+\/email$/) && request.method === "POST") {
    const match = url.pathname.match(/^\/api\/threads\/([^/]+)\/([^/]+)\/email$/);
    if (match) {
      const [, entityType, entityId] = match;
      return { routeName: "threads.send_email", response: await sendEmail(entityType, entityId, request, env.DB) };
    }
  }
  if (url.pathname.match(/^\/api\/threads\/[^/]+\/[^/]+$/) && request.method === "GET") {
    const match = url.pathname.match(/^\/api\/threads\/([^/]+)\/([^/]+)$/);
    if (match) {
      const [, entityType, entityId] = match;
      return { routeName: "threads.get", response: await getThread(entityType, entityId, request, env.DB) };
    }
  }
  return { routeName: "not_found", response: errorResponse("Not Found", 404) };
}
__name(dispatchRequest, "dispatchRequest");
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
