## Latest Handoff
Date: 2026-04-16
Checkpoint: CHK-R77 — Billing safety: enforcement middleware, lifecycle emails, trial cron, dashboard banners

### What was completed

- **Subscription enforcement middleware** (`src/index.js`):
  - All write operations (POST/PUT/PATCH/DELETE) return HTTP 402 for SUSPENDED, CANCELLED, and trial-expired tenants
  - `/api/billing/*` always exempt so tenants can reactivate regardless of status
  - `getAuthSession()` in `src/lib/auth.js` extended to also return `subscription_status` and `tenant_created_at` from the tenants JOIN

- **Activation email** (`src/routes/billing.js` + `src/lib/bookingEmails.js`):
  - `dispatchBillingActivationEmail()` fired after `checkout.session.completed` activates tenant
  - "Welcome to Tours Market Pro 🎉" email with dashboard CTA

- **Status change emails** (`dispatchBillingStatusEmail()`):
  - SUSPENDED email (red) on `invoice.payment_failed` — "Update Payment Method →" CTA
  - CANCELLED email (grey) on `customer.subscription.deleted` — "Reactivate →" CTA

- **Admin alert email** (`dispatchAdminAlertEmail()`):
  - Sent to `info@tours-market.com` on payment failures and trial expiry events

- **Trial expiry cron** (`runTrialMaintenance(env)` in `src/index.js`):
  - Runs every `*/15 * * * *` cron tick
  - Auto-expires TRIAL tenants past 180 days → SUSPENDED + audit_log + email + admin alert
  - Sends reminder emails at 30 / 7 / 1 days before expiry
  - Deduplication via `tenant_audit_log` action keys `BILLING_TRIAL_REMINDER_30/7/1` and `BILLING_TRIAL_EXPIRED`

- **Dashboard SUSPENDED/CANCELLED banners** (`public/dashboard.html`):
  - Reuses existing `#trial-banner` element
  - SUSPENDED → red bg + "Fix billing →" opens billing pane
  - CANCELLED → grey bg + "Reactivate →" opens billing pane
  - Removed duplicate billing pane JS block (fix for CHK-R76 regression)

### What is still not done
- Stripe secrets must be configured: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_DOMAIN_WEBHOOK_SECRET`
- `[COMPANY ADDRESS]` placeholder in terms.html, privacy.html, contact.html — fill after Wyoming LLC formation
- `CF_ACCOUNT_ID` and `CF_REGISTRAR_API_TOKEN` show `REPLACE_ME` — non-blocking for current features
- Stripe webhook events to register in Stripe Dashboard: `checkout.session.completed`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.payment_succeeded`

### Suggested next prompt
"Build CHK-R78: Tenant subscription management in saas-admin.html. Add a Subscriptions tab that lists all tenants with their subscription_status, trial remaining days, and stripe_customer_id. Allow manual override of subscription_status from admin (for support use). Add a search/filter by status."

---

## Previous Handoff

### What was completed

- **`public/terms.html`** (new) — 17-section Terms of Service:
  - Explicitly positions Tours Market as SaaS software only
  - Section 4: "We Do Not Provide Travel Services" — no payment processing, no marketplace, operators fully responsible
  - Section 6: Commission defined as threshold-invoiced (0% under €500 / 1% €500–1499 / 2% €1500+/month), not deducted from customer payments
  - Section 7: Refund policy — 14-day refund on first paid period if no live storefront or bookings
  - Section 15: Wyoming LLC jurisdiction, AAA arbitration, class action waiver
  - `[COMPANY ADDRESS]` placeholder — fill after entity formation

- **`public/privacy.html`** (new) — GDPR-friendly Privacy Policy:
  - Two-table data inventory (operator-provided vs auto-collected)
  - Cookies: only `tam_session` (HTTP-only, no ad tracking)
  - Sub-processors: Cloudflare (DPA), Stripe (independent controller), Google (auth only)
  - Full data subject rights section (access, erasure, portability, restriction)
  - International transfer basis: Cloudflare SCCs

- **`public/pricing.html`** (new) — Real pricing page for Stripe reviewer:
  - Starter €4.98/mo, Tour Operator Pro €9.98/mo with commission table
  - Commission displayed as 3-row inline table (0% / 1% / 2% by threshold)
  - Future tiers (Hotel Pro €9.98, Suite €19) shown as greyed "coming soon"
  - FAQ 8 questions including commission mechanics, refund, cancellation

- **`public/contact.html`** (new) — Professional contact page:
  - 3 public addresses: support@, legal@, privacy@tours-market.com
  - Validated contact form with inquiry type select
  - Mailto fallback if `/api/contact` fails (endpoint not yet implemented — form degrades gracefully)

- **`public/index.html`** (updated):
  - Title/brand consistently "Tours Market" (was "TravelAgent")
  - Hero headline and copy rewritten — SaaS positioning, not marketing fluff
  - CTA buttons: "Start free — no card required" + "See pricing"
  - Pricing nav link added to header
  - Legal footer added: Terms · Privacy · Pricing · Contact

- **`src/lib/productTiers.js`** (updated):
  - All 3 `revenue_share` objects replaced: `percent_min/max` + `cap_policy: 'to_be_defined'` → `billing_model: 'threshold_invoiced'` + `tiers[]` array with explicit thresholds and percentages

### What is still not done

- `[COMPANY ADDRESS]` placeholder in terms.html, privacy.html, contact.html — fill after Wyoming LLC formation
- `/api/contact` endpoint not implemented — contact form falls back to mailto gracefully
- Stripe secrets still not configured: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` (replace `price_REPLACE_ME`), `STRIPE_DOMAIN_WEBHOOK_SECRET`
- `CF_ACCOUNT_ID` and `CF_REGISTRAR_API_TOKEN` show `REPLACE_ME` in wrangler output — non-blocking for current features
- Old `skin_*` and `website_*` locale keys can be removed in future cleanup

### Suggested next prompt
"Build CHK-R72: Trust ladder admin UI integration. Add a 'Review Cases' tab to saas-admin.html that lists open `tenant_review_cases` rows (GET /api/admin/tenant-review-cases), shows tenant name + reason + created_at, with Approve and Reject inline buttons that call POST /api/admin/tenants/:id/set-trust. Wire smoke coverage for the two actions."

---

## Previous Handoff
  - `skin` + `website` cards merged → single **`design`** card with 3-state progressive description (no skin → pick skin first; skin only → build shell; both done → edit anytime)
  - Tours description now inline-shows published count: `3 tours, 1 published. Refine pricing…`
  - **Removed** `properties` card (was hardcoded `propertiesCount = 0`, always stuck at NEXT)
  - **Removed** `pricing` card (redundant with tours card)
  - **Removed** `go_live` card (converted to auto-banner)
  - Total sequence: **11 cards → 7 cards** (subdomain, design, tours, destinations, accommodations, gallery, system)
  - Added `<div class="go-live-banner" id="go-live-banner" hidden>` to HTML, CSS `.go-live-banner {}` added
  - Banner auto-shows green 🎉 message when `sequence.every(s => s.complete)`
  - Static `guide_copy` in HTML updated — "Properties will live later…" sentence removed
  - Removed `const propertiesCount = 0` dead variable

- **`src/locales/en.json`** — `dashboard_launch` block updated:
  - `guide_copy` updated (Properties sentence removed)
  - `tours_desc_ready` updated to mention publishing tours
  - Added: `design_title`, `design_desc_skin_first`, `design_desc_shell_next`, `design_desc_ready`, `design_label_skin`, `design_label_shell`, `design_label_ready`
  - Added: `go_live_banner`
  - Old `skin_*` / `website_*` keys preserved (still referenced by other consumers)

- **All 10 other locale files** (`vi`, `zh`, `th`, `de`, `fr`, `es`, `ja`, `ko`, `en-gb`, `en-au`) — same structural additions:
  - All fully localized; all 11 files confirmed valid JSON before deploy

- **Deployed** `0357b7c7` — `npx wrangler deploy --env=""`; no migrations, no schema changes

### What is still not done

- Stripe secrets still not configured:
  - `wrangler secret put STRIPE_SECRET_KEY` (production Stripe secret)
  - `wrangler secret put STRIPE_PRICE_ID` (replace `price_REPLACE_ME` in wrangler.jsonc)
  - `wrangler secret put STRIPE_DOMAIN_WEBHOOK_SECRET`
- CF Registrar secrets: `CF_ACCOUNT_ID` ✓, `CF_REGISTRAR_API_TOKEN` ✓ already set in production
- Old `skin_*` and `website_*` locale keys kept for backwards compatibility — can be removed in a future cleanup once confirmed unused

### Suggested next prompt
"Build CHK-R71: Trust ladder admin UI integration. Add a 'Review Cases' tab to saas-admin.html that lists open `tenant_review_cases` rows (GET /api/admin/tenant-review-cases), shows tenant name + reason + created_at, with Approve and Reject inline buttons that call POST /api/admin/tenants/:id/set-trust. Wire smoke coverage for the two actions."

---

## Previous Handoff
Date: 2026-04-16
Checkpoint: CHK-R69 — Platform Admin Tenant Management Panel

### What was completed

- **`src/routes/admin.js`** — two new admin-only endpoints appended before `export default`:
  - `GET /api/admin/tenants` — list tenants with optional query filters (`status`, `trust`, `q` LIKE, `page`, `limit`); returns `tenants[]` + `total` + `page`; computes `trial_days_left` for TRIAL tenants
  - `POST /api/admin/tenants/:id/set-subscription` — validates `status` against `VALID_SUB_STATUSES = {TRIAL,ACTIVE,SUSPENDED,CANCELLED}`; D1 batch: `UPDATE tenants SET subscription_status` + `INSERT INTO tenant_audit_log (id, tenant_id, field_name, old_value, new_value, changed_at, changed_by)`; returns `{ ok, tenant_id, status, previous_status, note }`
  - Bug fixed: original INSERT used column name `created_at` and extra `action` column — both wrong for actual schema (`changed_at`, no `action`). Fixed to match `tenant_audit_log` schema.
- **`public/saas-admin.html`** — tab system added:
  - CSS: `.tab-bar`, `.tab-btn.active`, `.tab-pane.active`, `.tenants-panel`, `.tenant-table`, `.sub-badge.{STATUS}`, `.trust-badge.{STATUS}`, `.action-select`, `.tenant-filters`
  - HTML: `<div class="tab-bar">` with Marketing Editor | Tenants tabs; existing marketing form wrapped in `<div class="tab-pane active" id="tab-marketing">`; new `<div class="tab-pane" id="tab-tenants">` with search/filter controls + `#tenant-table-wrap`
  - JS (at top of `<script>`): tab switching; `loadTenants()` (builds query from filters, calls `GET /api/admin/tenants`); `renderTenantTable(tenants)` (builds table with per-row inline `<select>` status dropdowns); inline action handler (PATCH-style `POST /api/admin/tenants/:id/set-subscription` → updates badge inline); 350ms debounce on search input
- **`scripts/smoke-local.mjs`** — two new smoke functions:
  - `runDomainVerifySmoke(baseUrl, token)` — 3 tests (auth guard, GET returns token+cname_target, POST returns structured DNS response)
  - `runAdminTenantSmoke(baseUrl, adminSecret)` — 6 tests (GET auth guard, GET returns list, GET ?status=TRIAL filter, POST auth guard, POST invalid status 400, POST TRIAL→ACTIVE→TRIAL round-trip)
  - Bug fixed: original functions used undeclared `assert()` — rewritten to use `pass()` / `fail(); return` pattern consistent with the rest of the smoke script
  - Bug fixed: domain verify POST test expected `400 NO_DOMAIN` but booking smoke had already bound a domain — updated to accept either `400 NO_DOMAIN` or a structured `{ verified, domain }` DNS check response

### What is still not done

- Stripe secrets still not configured:
  - `wrangler secret put STRIPE_SECRET_KEY` (production Stripe secret)
  - `wrangler secret put STRIPE_PRICE_ID` (replace `price_REPLACE_ME` in wrangler.jsonc)
  - `wrangler secret put STRIPE_DOMAIN_WEBHOOK_SECRET`
- CF Registrar secrets: `CF_ACCOUNT_ID` ✓, `CF_REGISTRAR_API_TOKEN` ✓ already set in production

### Suggested next prompt
"We still don't have Stripe. Build CHK-R70: Trust ladder admin UI integration. Add a 'Review Cases' tab to saas-admin.html that lists open `tenant_review_cases` rows (GET /api/admin/tenant-review-cases), shows tenant name + reason + created_at, with Approve and Reject inline buttons that call POST /api/admin/tenants/:id/set-trust. Wire smoke coverage for the two actions."

---

## Previous Handoff
Date: 2026-04-16
Checkpoint: CHK-R68 — BYOD Domain DNS TXT Verification

### What was completed

- **`src/routes/tenants.js`** — upgraded `buildDomainVerifyToken`:
  - New signature: `async buildDomainVerifyToken(adminSecret, tenantId, domain)`
  - Algorithm: `HMAC-SHA256(tenantId:domain, ADMIN_SECRET).slice(0,16)` via `crypto.subtle`
  - Fallback for local dev when `ADMIN_SECRET` not set: `tm-verify-${tenantId.slice(0,12)}`
  - Both `GET /api/tenants/custom-domain-verify` and `POST /api/tenants/custom-domain-verify` updated to use new async token
- **TXT record prefix**: `_tm-verify.{domain}` → `_tours-market-verify.{domain}`
- **CNAME target**: `square-wind-2594.divine-shape-9f0a.workers.dev` → `proxy.tours-market.com`
- **GET endpoint** now returns `txt_record_name`, `txt_record_value`, `cname_target` fields
- **POST endpoint** on success:
  - Sets `custom_domain_verified_at`
  - Promotes `trust_status` PREVIEW_ONLY → PROBATION (single `UPDATE`)
  - Returns `trust_promoted: true` when promotion happened
- **`public/dashboard.html`** — DNS verification panel:
  - `loadCustomDomainStatus()` calls `startDnsAutoPoll()` when domain is pending
  - `startDnsAutoPoll()` / `stopDnsAutoPoll()` — 30-second interval polling while panel open
  - On poll success: status badge updated, instructions hidden, button hidden, `onboardingState.settings.trust_status` updated if promoted
  - `btnVerifyCustomDomain` click also calls `stopDnsAutoPoll()` + handles `trust_promoted`
  - DNS instructions updated with correct TXT prefix and CNAME target
- **`scripts/smoke-local.mjs`**: added `runDomainVerifySmoke()` (3 tests):
  - Auth guard on GET
  - GET structure + CNAME target value
  - POST returns 400 `NO_DOMAIN` when no custom domain set

### What is still not done

- Env vars to set in production before domain purchase works end-to-end:
  - `wrangler secret put STRIPE_SECRET_KEY`
  - `wrangler secret put STRIPE_DOMAIN_WEBHOOK_SECRET`
  - `STRIPE_PRICE_ID` still `price_REPLACE_ME` in wrangler.jsonc vars
- Production CF credentials: `CF_ACCOUNT_ID` ✓, `CF_REGISTRAR_API_TOKEN` ✓ already set

### Suggested next prompt
"Do `wrangler secret put STRIPE_SECRET_KEY` and `STRIPE_PRICE_ID` for subscription checkout. Then build CHK-R69: Stripe subscription checkout flow — tenant clicks 'Subscribe' in wizard Step 4, `POST /api/billing/create-checkout` creates a Stripe Subscription mode Session with `subscription_data.trial_period_days`, success URL includes `?billing_success=1`, dashboard shows live subscription status badge."

---

## Previous Handoff
Date: 2026-04-15
Checkpoint: CHK-R67 — CF Registrar domain purchase + 30% platform markup

### What was completed

- **New route file `src/routes/domains.js`**:
  - `GET /api/domains/search?q=example.com` — RDAP availability check + TLD price lookup (30% markup enforced server-side)
  - `POST /api/domains/purchase` — Stripe one-time Checkout Session (mode: payment); creates PENDING D1 record; skips if duplicate PENDING/COMPLETED
  - `POST /api/domains/stripe-webhook` — HMAC-verified; idempotent; on `checkout.session.completed` calls CF Registrar API → writes `custom_domain + custom_domain_verified_at` to tenant (auto-verified, no CNAME wait)
  - `GET /api/domains/purchases` — tenant purchase history
- **Migration `0051_tenant_domain_purchases.sql`**: `tenant_domain_purchases` table
- **`src/index.js`**: import + register domains; `/api/domains/search` + `/api/domains/purchase` added to `PROTECTED_API_PREFIXES`
- **`wrangler.jsonc`**: `CF_ACCOUNT_ID` and `CF_REGISTRAR_API_TOKEN` placeholder vars added
- **`src/routes/billing.js`**: billing webhook now skips `checkout.session.completed` where `metadata.purchase_type === 'domain'`
- **`public/dashboard.html`**: domain-reg-panel CSS + HTML + JS; `openDomainRegPanel()` replaces the old `alert()`; `?domain_purchase=success` toast notification on Stripe redirect-back
- **Smoke test**: ALL PASS (6 domain smoke tests)
- **Production secrets**: `CF_ACCOUNT_ID` ✓, `CF_REGISTRAR_API_TOKEN` ✓ set via `wrangler secret put`

### What is still not done

### What was completed

- **`renderCommerceWizard(settings)` injected into `public/dashboard.html`**:
  - 4-step panel displayed in the "Start Here" pane for all paid tiers (`starter_landing` hidden entirely)
  - Step badges: done (✓ green) / next (blue) / later (grey) computed from live settings at render time
  - Step 1: Build your site → links to Visual Editor (always unlocked)
  - Step 2: Connect domain → BYOD scrolls to `#custom-domain-section`; "Register new domain ✨" fires alert placeholder for CHK-R67; if domain set+unverified shows "Check DNS" button
  - Step 3: T&C → scrollable box, checkbox gating, posts to `POST /api/tenant/accept-terms` (idempotent), reloads wizard on success
  - Step 4: Payment gateway → Stripe/MoMo/VNPay/ZaloPay with connected/required badges; bank transfer shown as supplementary row
  - `wizard-live-badge` shown when all 4 steps complete
- **`GET /api/tenants/settings` SELECT extended** (`src/routes/tenants.js`):
  - Added `payment_methods` and `product_tier_key` columns
  - `payment_methods` JSON string auto-parsed to array in the response
- **Smoke test**: ALL PASS

### What is still not done

- CHK-R67: CF Registrar API integration not started (`CF_ACCOUNT_ID`, `CF_REGISTRAR_API_TOKEN` not yet wired)
- CHK-R68: DNS TXT verification endpoint not yet built
- `STRIPE_PRICE_ID` env var is still `price_REPLACE_ME`
- Existing production tenants with bank-transfer-only lose `commercial_activation_enabled=true` after CHK-R65 — verify before deploying

### Suggested next prompt
"Build CHK-R67: CF Registrar domain purchase flow. Add a 'Register a domain' panel in the dashboard (or expand wizard Step 2). Search box → CF Registrar availability API → price display (CF cost × 1.30 with breakdown). Checkout via Stripe one-time payment. On webhook: call CF Registrar API to register, bind Workers route, write custom_domain + custom_domain_verified_at to D1. Create migration 0051_tenant_domain_purchases.sql."

---

## Previous Handoff
Date: 2026-04-15
Checkpoint: CHK-R65 — Electronic gateway commerce policy lock + roadmap for CF Registrar

### What was completed

- **Commercial activation policy locked** (non-negotiable, now enforced in code and instructions):
  - `publishGuard.js`: `commercialActivationEnabled` now gates on `electronicGatewayConfigured` (Stripe, MoMo, VNPay, ZaloPay, PayPal, GrabPay, Credit Card) — NOT on `paymentConfigured` (which accepted bank transfer)
  - Bank transfer is now explicitly `supplementary_only`: permitted as an add-on AFTER an electronic gateway is active; never sufficient to unlock commerce alone
  - Reason: bank transfer is untrackable → no platform commission, no cancellation detection, no modern commerce signal
  - Added `bank_transfer_only` flag to `buildTenantCommercialPolicy()` response so dashboard can show a targeted nudge
- **`productTiers.js` capability names clarified**: `online_payment` → `payment_enabled`; `electronic_gateway_required: true` and `bank_transfer_supplementary: true` flags added to all `payment_enabled` tiers
- **Smoke test hardened**: booking confirm flow now asserts STRIPE (electronic gateway) is what enables commerce, not bank transfer
- **`copilot-instructions.md` updated**: Section 5 "Commercial Activation Policy" written as non-negotiable rules — locks the CF Registrar direction (domain cost + 30% markup, auto-verified on checkout)
- **Roadmap checkpoints written** into `03_PROGRESS_LEDGER.md`:
  - CHK-R66: Commercial activation onboarding wizard (4-step dashboard panel)
  - CHK-R67: CF Registrar domain purchase + 30% platform markup (Stripe one-time checkout → CF API → auto-verify)
  - CHK-R68: BYOD domain DNS TXT verification flow

### What is still not done

- CHK-R66: 4-step dashboard wizard UI not yet built
- CHK-R67: CF Registrar API integration not started (`CF_ACCOUNT_ID`, `CF_REGISTRAR_API_TOKEN` env vars not yet wired)
- CHK-R68: DNS TXT verification endpoint not yet built
- `starter_landing` tier locale copy ("Contact form only, no online payment") should be updated to unambiguously say "no payment"
- Existing production tenants with bank-transfer-only as sole enabled method will lose `commercial_activation_enabled=true` after CHK-R65 deploys — verify zero such tenants in production before deploying

### Known risks / TODOs

- CF Registrar API: CF only allows registrar purchases on Cloudflare-managed domains — confirm platform CF account has registrar access before building CHK-R67
- 30% domain markup must be disclosed to tenants in T&C before charging — legal/copy needed as part of CHK-R66 T&C step
- `STRIPE_PRICE_ID` env var is still `price_REPLACE_ME` — Stripe subscription checkout will fail until replaced

### Suggested next prompt
"Build CHK-R66: add the 4-step commercial activation wizard panel to dashboard.html. Step 1 = site builder link (always unlocked). Step 2 = domain connect (BYOD instructions OR 'Register via platform' button placeholder). Step 3 = T&C accept with timestamp. Step 4 = payment gateway setup (electronic required, bank transfer as optional add-on). starter_landing tier locks Step 4 with upgrade CTA."

---

## Previous Handoff
Date: 2026-04-14
Checkpoint: CHK-R64 — Showcase-only platform subdomains + commercial activation backbone

### What was completed

- Product/legal direction was locked more tightly: platform subdomains are no longer treated as “lite commerce” surfaces; they are showcase-only by policy
- Runtime direction updated so showcase publish and commercial activation are separate concepts:
  - showcase publish: subdomain or custom domain configured, trust allows publish, terms accepted, tenant standing allows public content
  - commercial activation: verified custom domain, trusted tenant, active subscription, terms accepted, and at least one enabled payment method
- `soft-publish` fallback is being removed from the editor flow because it undermines the publish gate and the new legal policy
- Public booking/order creation is being redefined as custom-domain-only commerce rather than a generic tenant capability
- Docs were updated to reflect the policy consistently across product brief, architecture, API, subdomain policy, and AI runtime notes

### What is still not done

- Final pass on storefront CTA rendering to ensure all public platform surfaces replace booking intent with showcase/contact intent where needed
- Final pass on dashboard messaging so every launch/compliance hint describes “showcase vs commercial activation” rather than “gateway missing = site offline"
- Dedicated tenant/customer legal copy pages still need to be authored; this session locks the policy and runtime direction, not the finished legal prose

### Known risks / TODOs

- Any remaining public surface that still renders `Book Now`, `Check availability`, or demo checkout on a platform-owned host will create policy drift even if `/api/bookings/order` is blocked
- `/p/:tenantId/:slug` public paths should be treated the same as platform subdomains for legal purposes: showcase-only, no commerce
- Terms/disclaimer enforcement still needs a deliberate UI/legal-page rollout so the policy is visible to both tenants and end customers

### Suggested next prompt
"Finish CHK-R64: audit remaining public CTAs and booking widgets so no platform-owned surface exposes booking/payment intent, then add dedicated tenant terms + end-customer disclaimer pages for showcase-only subdomains."

---

## Previous Handoff
# Session Handoff Log

Purpose: end each session with a tiny handoff that reflects the **current rescue rebuild reality**, not the old system.

Rule:
If a capability existed only in the old repo/docs but is not rebuilt in the current repo, do not describe it as active.

---

## Handoff Template
Date:
Checkpoint:
Goal of session:
What was completed:
Files changed:
What is still not done:
Known risks / TODOs:
Suggested next prompt:

---

## Latest Handoff
Date: 2026-04-14
Checkpoint: CHK-R58 — Trial countdown banner + Upgrade button restored + fully localized

### What was completed

**Trial banner root cause analysis:**
1. Settings API `SELECT` never included `created_at` → old condition `subscription_status === 'TRIAL' && created_at` always `false`
2. All dev tenants were manually set `ACTIVE` (no `stripe_customer_id`) → banner condition never triggered regardless

**Fixes applied:**
- Removed `created_at` gate entirely; `daysLeft` now driven from `/api/billing/status` server-side `trial_info.trial_days_left` (with `created_at` as local fallback only when billing API is unavailable)
- Upgraded banner condition: `subscription_status === 'TRIAL' || !hasStripeSubscription` — shows for any tenant without a real Stripe payment
- Wired `#btn-upgrade` click handler → `POST /api/billing/checkout` → redirects to Stripe `checkout_url` on success; shows `✅ Already Active` if tenant is already subscribed; restores label on error

**i18n localization:**
- Added `trial_banner.active`, `trial_banner.expired`, `trial_banner.upgrade` keys to all 11 locale files: `en`, `en-GB`, `en-AU`, `vi`, `zh`, `ja`, `ko`, `de`, `fr`, `es`, `th`
- Replaced hardcoded mixed Vietnamese/English string with `i18n.t('trial_banner.active').replace('{{n}}', daysLeft)`

**Language-switch re-render fix:**
- Removed `data-i18n` from `#trial-banner-text` and `#btn-upgrade` — the i18n engine's `apply()` pass was overwriting them with the raw `{{n}}` placeholder on every language switch
- Extracted `renderTrialBanner()` function; stores `daysLeft` as `window._trialDaysLeft`
- Registered `renderTrialBanner` as a `dashboard:langchange` listener → banner text re-renders correctly on language switch

### Files changed
```
public/dashboard.html                                (trial banner condition, renderTrialBanner, btn-upgrade handler)
src/locales/en.json, en-gb.json, en-au.json          (trial_banner keys added)
src/locales/vi.json, zh.json, ja.json, ko.json       (trial_banner keys added)
src/locales/de.json, fr.json, es.json, th.json       (trial_banner keys added)
docs/ai/03_PROGRESS_LEDGER.md                        (CHK-R58 entry)
docs/ai/04_SESSION_HANDOFF.md                        (this handoff)
```

### What is still not done
- `openOrderDetail()`, `loadTodos()`, `renderTodos()`, add-task save handler, `odet-actions` click handler — verify these function bodies exist in `dashboard.html` before assuming they work
- Day tour booking widget: room-based pax inputs still shown for day tours in `public/booking-widget.js`
- Trust ladder admin UI: `tenant_review_cases` table exists, no admin screen yet
- Booking currency display: `grand_total_usd` legacy references remain in some surfaces
- Calendar endpoint + departure reminders: cron wired but no business logic
- SEO/public indexing: `public_indexing_enabled` column exists but `<meta robots>` not injected

### Known risks / TODOs
- `STRIPE_PRICE_ID` env var is `price_REPLACE_ME` — Stripe checkout will fail until replaced with a real price ID
- Terminal cwd bug: use absolute `--cwd`/`--config` flags with wrangler; `cd` does not reliably persist

### Recommended next checkpoints
| # | Title | Prompt |
|---|---|---|
| CHK-R59 | Order detail JS completeness | "Verify that `openOrderDetail`, `loadTodos`, `renderTodos`, add-task form, and `odet-actions` click handler all exist in `dashboard.html`. If any are missing, write them." |
| CHK-R60 | Day tour booking widget | "In `booking-widget.js`, hide room selection and show adult/child count only when `tour_type=day_tour`." |
| CHK-R61 | Trust ladder admin UI | "Add a platform admin screen to list, inspect, and approve/reject `tenant_review_cases`." |
| CHK-R62 | Booking currency display cleanup | "Replace `grand_total_usd` legacy references in dashboard order detail, invoice HTML, and emails with `booking_currency`/`grand_total_amount`." |

### Suggested next prompt
"Verify order-detail JS completeness: grep `dashboard.html` for `openOrderDetail`, `loadTodos`, `renderTodos`, `btn-back-to-orders`, `btn-save-todo`, and `odet-actions`. For any that are missing, write in the correct handler bodies."

---

### What was completed

**Dashboard pane system (CHK-R56):**
- `db/migrations/0050_booking_order_todos.sql` — new `booking_order_todos` table; `id TEXT PK`, `tenant_id`, `order_id FK`, `stop_id INTEGER` (null for custom tasks), `title`, `done`, `done_at`, `sort_order`, `created_at`; indexed on `(order_id, tenant_id)`
- 3 new API routes in `src/routes/bookings.js`:
  - `GET /order/:orderId/todos?seed=1` — lists todos; `?seed=1` auto-seeds one row per `tour_stop` on first open
  - `POST /order/:orderId/todos` — add custom task
  - `PATCH /order/:orderId/todos/:todoId` — toggle done/undone, set `done_at`
- `public/dashboard.html` restructured:
  - 3 `[data-pane]` divs: `start-here` (default), `orders`, `order-detail`
  - `showPane(name)` toggles `.pane-active` class — sidebar links become pane controllers
  - `let allOrdersCache = []` declared in script scope
  - `actionBtn(order)` always appends `📋` detail button
  - Order-detail pane: guest/tour/payment header, per-order todos checklist, add custom task form
  - Back button returns to orders pane

**showPane hotfix (CHK-R57):**
- `showPane()` function body and `allOrdersCache` declaration were missing from the file (silently dropped during multi-replace in prior session)
- Patched via targeted `replace_string_in_file` — both declarations now present and verified in file

**Proof image modal:**
- Fixed in CHK-R55 (prior session): `view-proof` handler uses `blob()+URL.createObjectURL()`; PDF support via `<object>` element; blob URL revoked on close. Confirmed working by user.

**Deploy:**
- Worker deployed as `02cec6b7` on `tours-market.com`
- Remote D1 migration 0050 applied

### Files changed
```
db/migrations/0050_booking_order_todos.sql           (new)
src/routes/bookings.js                               (3 todos routes added)
public/dashboard.html                                (pane system CSS + HTML + JS; showPane hotfix)
docs/ai/01_CURRENT_STATE.md                          (updated to CHK-R56/R57)
docs/ai/03_PROGRESS_LEDGER.md                        (CHK-R56 + CHK-R57 entries; recommended next checkpoints table)
docs/ai/04_SESSION_HANDOFF.md                        (this handoff)
```

### What is still not done
- `openOrderDetail()`, `loadTodos()`, `renderTodos()`, add-task save handler, `odet-actions` click handler — these functions are referenced but their bodies need to be verified exist in `dashboard.html`; grep the file before assuming they are present
- Day tour booking widget: room-based pax inputs still shown for day tours in `public/booking-widget.js`
- Trust ladder admin UI: `tenant_review_cases` table exists, no admin screen yet
- Booking currency display: `grand_total_usd` legacy references remain in some surfaces
- Calendar endpoint + departure reminders: cron is wired but no logic
- SEO/public indexing surface: `public_indexing_enabled` column exists but `<meta robots>` not injected

### Known risks / TODOs
- Before working on order-detail JS: grep `openOrderDetail` in `public/dashboard.html` — if absent, the 📋 button will do nothing. Same check for `loadTodos`, `renderTodos`, `btn-back-to-orders` handler.
- Terminal cwd bug: `cd` commands inside a multi-command expression may not persist in some terminal sessions; use absolute `--cwd` or `--config` flags with `wrangler` as a workaround

### Recommended next checkpoints
| # | Title | Prompt |
|---|---|---|
| CHK-R58 | Order detail JS completeness | "Verify that `openOrderDetail`, `loadTodos`, `renderTodos`, add-task form, and `odet-actions` click handler all exist in `dashboard.html`. If any are missing, write them." |
| CHK-R59 | Day tour booking widget | "In `booking-widget.js` and `tour-booking-view.js`, hide room selection and show adult/child count only when `TOUR_TYPE=day`." |
| CHK-R60 | Trust ladder admin UI | "Add a platform admin screen to list, inspect, and approve/reject `tenant_review_cases`." |
| CHK-R61 | Booking currency display cleanup | "Replace `grand_total_usd` legacy references in dashboard order detail, invoice HTML, and emails with `booking_currency`/`grand_total_amount`." |

### Suggested next prompt
"Verify order-detail JS completeness: grep `dashboard.html` for `openOrderDetail`, `loadTodos`, `renderTodos`, `btn-back-to-orders`, `btn-save-todo`, and `odet-actions`. For any that are missing, write in the correct handler bodies."

### What was completed

**Triple room fixes:**
- `pricing.js` `getMaxChildrenForRooming` accepts `tripleAdults` param; adds `Math.floor(tripleAdults/3) * 2` to max children
- Both `POST /bookings/draft` and `POST /bookings/order` now pass `adult_triple_room_count` to pricing engine
- `buildPaxSummary` + `buildQuoteSummaryHtml` include triple room adults in pax display

**Guest booking portal (was 404):**
- `public/booking-portal.html` created — status badge, booking details, countdown, drag-and-drop proof upload, per-status sections
- `GET /bookings/public/:token` → 302 redirect to `/booking-portal.html?token=TOKEN`
- `GET /api/bookings/public/:token` JOIN expanded to include `tour_title`, `tenant_name`, `pax_triple`

**Live dashboard orders:**
- `public/dashboard.html` bookings section replaces hardcoded dummy rows with `loadOrders()` using `GET /api/bookings/orders`
- All orders fetched client-side; status filter applied in JS so sidebar counts are always accurate
- Left sidebar order links wired to live counts + click-to-filter; `active-filter` CSS class highlights active selection
- Stat cards (Awaiting Proof, Proof Uploaded, Confirmed, Revenue) update from live data on each load

**Identity masking:**
- `dispatchNewBookingAgentEmail` email no longer includes guest name/email/phone — replaced with 🔒 amber locked-notice box
- `guestDisplay(order)` in dashboard reads `order.guest.name/email/phone` (maskOrder structure) and reveals only after `identity_unlocked = 1`
- `maskOrder` now returns `secure_token` and `price_snapshot_json`

**Proof streaming endpoint:**
- `GET /api/bookings/order/:id/proof-url` — streams R2 `BOOKING_PROOFS` object directly; tenant-scoped; 300s private cache
- Endpoint confirmed working: `Status=200, Content-Type=image/png, Length=40662`
- `actionBtn` in dashboard uses `data-order-id` attribute (old broken `CSS.escape` DOM-search removed)
- **Known issue: proof image still does not load in the browser modal** — deferred to next session

### Files changed
```
public/booking-portal.html                       (new — guest portal page)
public/dashboard.html                            (live orders, sidebar counts, identity display, proof button fix)
src/routes/bookings.js                           (maskOrder fields, proof-url endpoint, public redirect, JOIN)
src/lib/bookingEmails.js                         (agent email identity masking)
db/migrations/0046_triple_room_price.sql         (applied to production)
db/migrations/0047_pricing_notes.sql             (applied to production)
db/migrations/0048_tour_type.sql                 (applied to production, carried from prior session)
docs/ai/01_CURRENT_STATE.md                      (updated to 2026-04-13)
docs/ai/03_PROGRESS_LEDGER.md                    (CHK-R53 full entry)
docs/ai/04_SESSION_HANDOFF.md                    (this handoff)
```

### What is still not done
- Proof image modal (`🖼 Proof` button) still does not render the image in browser — endpoint returns 200/image/png but image does not appear in `<img>` tag; possibly a CORS, blob-URL, or response-handling issue in the dashboard JS
- Booking widget (`booking-widget.js` / `widget.js`) still uses room-based pax inputs for day tours — not yet adapted
- Public booking API pricing.js still requires `adult_shared_room_count` — no API-level day_tour shortcut

### Known risks / TODOs
- Proof image viewer needs debugging: check whether response needs `blob()` conversion or whether the fetch is hitting an auth/CORS barrier
- Old synced tour pages in `tenant_universal_tour_pages` do not have `tour_type` in snapshot — `tour_type_map` fallback handles render-time but a re-sync per tour will permanently fix it

### Suggested next prompt
"Let's debug the proof image modal — the fetch to `/api/bookings/order/:id/proof-url` returns 200/image/png but the `<img>` in the modal never shows the image. Investigate the dashboard JS proof-viewer handler and fix it."

---

## Previous Handoff
Date: 2026-04-10
Checkpoint: CHK-R50 — Day Tour pricing mode (per-person Adult/Child/Infant, no room columns)

### What was completed

**Migration:**
- `db/migrations/0048_tour_type.sql` — `ALTER TABLE tours ADD COLUMN tour_type TEXT NOT NULL DEFAULT 'package'`  
  Values: `'package'` | `'day_tour'`

**Admin pricing UI (`public/tour-config.html` — `loadPricing()`):**
- `isDayTour = S.tour?.tour_type === 'day_tour'` flag
- Price table: hides Triple/Single Room columns; renames "Shared room" header → "Adult" for day tours
- Add-price form: hides triple/single room input wrappers; renames "Shared room" label → "Adult" via `id="ap-shared-label"`
- `adult_price` i18n key added to `en.json`, `vi.json`, `zh.json`, `th.json`

**Public price table (`src/routes/universalSites.js`):**
- `renderPricing`: `isDayTour` derived from `snapshot?.tour_type` OR `tourRuntime.tour_type_map[activeTourId]` (live DB fallback — old synced pages do not need re-sync)
- Day tour columns: **Segment / Season / Pax / Adult / Child / Infant** (no Shared Room / Single Room)
- Applies to both `profile.pricing === 'table'` and `sidebar/spotlight` layouts
- `infant_price` added to `segmentGroups` aggregation

**Booking conversation widget (`public/tour-booking-view.js`):**
- `data-tour-type` now propagated from root element to dynamically created drawer
- Room sentence row (`[data-tbv-room-row]`) hidden when `isDayTour`
- `updateRoomStatusPill()` returns early (hidden) when `isDayTour`
- `buildCompactSummary()` omits room part when `isDayTour`

**Sync (`src/lib/universalSiteSync.js`):**
- `syncUniversalTourPage` SELECT now includes `tour_type`
- `buildTourSyncSnapshot` stores `tour_type` in snapshot
- Pricing rows query now selects `tp.infant_price`; `buildPricingCards` includes `infant_price` in each card

**Mount points (`src/routes/universalSites.js`):**
- `bookingInlineMarkup` and `bookingViewMarkup` now emit `data-tour-type` using live `activeTourType` variable
- `getSiteBundle` tours SELECT now includes `tour_type`; `tourRuntime.tour_type_map` built as `{ [tour_id]: tour_type }`

### Files changed
```
db/migrations/0048_tour_type.sql                  (new — already applied to production)
public/tour-config.html                           (isDayTour admin pricing UI)
public/tour-booking-view.js                       (room row hide, status pill hide, compact summary, drawer attr)
src/routes/universalSites.js                      (renderPricing day tour columns, tour_type_map, data-tour-type attrs)
src/lib/universalSiteSync.js                      (tour_type in snapshot, infant_price in pricing cards)
src/locales/en.json                               (adult_price key)
src/locales/vi.json                               (adult_price key)
src/locales/zh.json                               (adult_price key)
src/locales/th.json                               (adult_price key)
docs/ai/03_PROGRESS_LEDGER.md                     (CHK-R50 entry)
docs/ai/04_SESSION_HANDOFF.md                     (this handoff)
```

### What is still not done
- Booking widget `booking-widget.js` / `widget.js` still uses room-based pax inputs — day tour variant not yet implemented there
- Public booking API `pricing.js` still requires `adult_shared_room_count` — no API-level day_tour shortcut yet
- `pax_range_label` in the public price table does not show infant prices for legacy synced snapshots (need re-sync to populate `infant_price` in `pricing_cards`)

### Known risks / TODOs
- Old synced tour pages in `tenant_universal_tour_pages` do not have `tour_type` in `sync_snapshot` — the live `tour_type_map` fallback handles render-time, but a re-sync per tour will permanently fix the snapshot
- `adult_triple_room_count` and `adult_single_room_count` pax types still show in the phase-2 price breakdown table for day tours (PAX_TYPES list not filtered) — they show $0.00 so cosmetic only for now

### Suggested next prompt
"Filter PAX_TYPES in tour-booking-view.js for day tours to only show Adult, Child, Infant rows in the phase-2 price-per-person breakdown table."

---


### What was completed

**Migrations (apply both before deploy):**
- `db/migrations/0043_hotel_star_region.sql` — `ALTER TABLE tenant_universal_hotels` adds `star_rating INTEGER DEFAULT NULL` and `region TEXT DEFAULT ''`
- `db/migrations/0044_media_libraries.sql` — `tenant_media_libraries` (titled photo collections) + `tour_media_library_links` (tour → library junction with `section_hint`)

**API (`src/routes/universalSites.js`):**
- `normalizeHotel` now exposes `star_rating` and `region`
- `listHotels` orders by `region ASC, star_rating DESC NULLS LAST, sort_order ASC`
- `POST /site/hotels` and `PATCH /hotels/:hotelId` accept `star_rating` and `region`
- New: `GET/POST /media-libraries`, `GET/PATCH/DELETE /media-libraries/:id`
- New: `GET/POST /tours/:tourId/library-links`, `DELETE /library-links/:id`

**UI (`public/product-modules.html`):**
- Hotels list now shows `region` group headers + gold star display (`★★★☆☆`)
- Hotel editor: two new fields — Region + Star Rating (1–5 select or Unrated)
- New **Libraries** mode tab — list sidebar + full editor (title, description, cover, photos, status, delete)
- `loadSourceData` fetches `/api/universal/media-libraries`
- `getModeFromParams` accepts `libraries`; `init` selects first library on load

**UI (`public/tour-config.html`):**
- New **Linked Photo Libraries** section in Content tab — select picker + section_hint dropdown (`gallery` / `hero` / `itinerary`) + Link button + unlink list
- `loadCatalogs` now also fetches `/api/universal/media-libraries`
- `loadTourLinks` now also fetches library links and calls `renderLinkedLibraries()`
- `renderLinkedLibraries()` renders linked items with section hint + photo count + × unlink

**Sync (`src/lib/universalSiteSync.js`):**
- `syncTourPage` batches a third query: `tour_media_library_links JOIN tenant_media_libraries`
- `buildTourSyncSnapshot` accepts `gallerySections = []` (6th arg), stores in `snapshot.gallery_sections`
- Gallery block in `buildTourDetailBlocks` emits `{ sections: [...], images: [...] }` when library links exist (backward-compat flat `images[]` always present); falls back to `gallery_images` when no libraries linked

### Files changed
```
db/migrations/0043_hotel_star_region.sql         (new)
db/migrations/0044_media_libraries.sql            (new)
src/routes/universalSites.js                      (normalizeHotel, listHotels, hotel PATCH/POST, + library routes)
src/lib/universalSiteSync.js                      (library batch query, gallery_sections in snapshot+blocks)
public/product-modules.html                       (Hotels grouped UI, Libraries tab)
public/tour-config.html                           (Linked Photo Libraries section)
docs/ai/03_PROGRESS_LEDGER.md                     (CHK-R49 entry)
```

### What is still not done
- Photo library items have no individual `alt`/`caption` editing in the Libraries tab UI (all items get the library title as alt) — deferred
- `section_hint` is stored but not yet used by public renderers to differentiate hero vs gallery vs itinerary slots
- Hotel junction `tour_hotel_links.nights` editing is exposed at link-time only; in-place nights editing on linked items is not in the UI yet

### Known risks / TODOs
- **Migrations must be applied before deploy.** Otherwise `star_rating`/`region` columns are missing and hotels PATCH will fail silently (UPDATE proceeds, columns ignored).
- `json_each(ml.items_json)` in the library-links list query requires SQLite JSON extension — Cloudflare D1 supports this but verify locally first if count shows 0.
- `gallery_sections` fallback: if no libraries are linked, blocks still use the flat `gallery_images` from `content_data` — no regression.

### Suggested next prompt
"Use `section_hint` in the public renderer: when a gallery block has `sections`, render named section headings above each photo group. Fall back to a flat grid when `sections` is absent (current renderers unchanged)."

---


### What was completed

**`src/lib/universalSiteSync.js`** — three focused changes:

1. **New builder function** `buildDestinationCatalogCards(destinationRows)` — mirrors `buildHotelCardsFromRows`; normalizes `gallery_json` to `images[]`, exposes `name`, `region`, `description`, `image`.

2. **Snapshot** — `buildTourSyncSnapshot` now accepts `destinationRows = []` (5th arg) and emits `destination_catalog_cards[]` using the builder above.

3. **Blocks** — `buildTourDetailBlocks` now prefers `destination_catalog_cards` for the `destination_carousel` block when junction links exist; falls back to stop-based `destination_stops` when no catalog links are present (existing behavior preserved).

4. **Query** — the two separate `.prepare().all()` calls for hotel links were batched with a new parallel query for `tour_destination_links JOIN tenant_destinations` (status = `active`, ordered by `sort_order`). `destinationRows` is passed through to the snapshot.

### Files changed
```
src/lib/universalSiteSync.js    (buildDestinationCatalogCards added, syncTourPage updated)
docs/ai/03_PROGRESS_LEDGER.md   (CHK-R48 follow-up entry + curl/smoke instructions)
```

### What is still not done
- Taxonomy/interest tagging on `tenant_destinations` is still deferred
- `tour_destination_links` sort_order reordering UI is not exposed in tour-config.html
- Destination catalog cards do not yet contribute to SEO meta

### Known risks / TODOs
- If a tenant has applied the catalog migration (`migrate-catalog-tables.sql`) but no links yet, the fallback to `destination_stops` fires automatically — no regression
- `tenant_destinations` must have `status = 'active'` to appear in sync; drafts are silently excluded (intentional)

### Suggested next prompt
"Add SEO meta contribution from destination catalog cards — when `destination_catalog_cards` are present, include the first destination name and region in `seo_json.description` of the synced tour page."

---

Goal of session: Decouple destinations and hotels from tours into reusable catalog tables with junction links. Replace inline hotel cards in Tour Content with catalog pickers.

### What was completed

**DB migration** (`scripts/migrate-catalog-tables.sql`) applied to production D1:
- `tenant_destinations` — standalone destination catalog per tenant (name, description, region, gallery_json, status, sort_order)
- `tour_destination_links` — M:N junction between tours and destinations (sort_order)
- `tour_hotel_links` — M:N junction between tours and hotels (nights, sort_order)

**API routes** added to `src/routes/universalSites.js`:
- `GET/POST /api/universal/destinations` — destination catalog CRUD
- `GET/PATCH/DELETE /api/universal/destinations/:id`
- `GET/POST /api/universal/tours/:tourId/destination-links`
- `DELETE /api/universal/destination-links/:id`
- `GET/POST /api/universal/tours/:tourId/hotel-links` (with `nights` field)
- `PATCH/DELETE /api/universal/hotel-links/:id`

**Product Modules UI** (`public/product-modules.html`):
- "Properties" tab renamed to "Hotels"; removed "Linked Tour" dropdown from hotel editor
- Destinations tab now manages `tenant_destinations` catalog (name, region, description, gallery, status/delete support)
- State extended with `destinations[]`, `selectedDestinationId`, `currentDestination`
- `loadSourceData()` now fetches `/api/universal/destinations` alongside tours/hotels
- `createDestinationModule()` POSTs to new catalog endpoint (no longer creates a ghost tour)
- `saveDestinationModule()` PATCHes catalog endpoint with gallery-url textarea serialization
- `saveHotelModule()` / `createHotelModule()` no longer send `tour_id`

**Tour Content** (`public/tour-config.html`):
- Inline hotel add form replaced by **Linked Destinations** + **Linked Hotels** catalog picker sections
- `loadCatalogs()` fetches hotel + destination catalogs on page load and populates `<select>` dropdowns
- `loadTourLinks(tourId)` called on `selectTour()` — fetches both link lists and renders inline lists
- `renderLinkedHotels()` / `renderLinkedDestinations()` — show linked items with unlink (×) button
- `btn-link-hotel` / `btn-link-dest` — POST to junction endpoints with `nights` field for hotels
- Legacy `renderHotelCards()` / `btn-add-hotel` inline form removed

**Sync** (`src/lib/universalSiteSync.js`):
- Hotel slide source changed from `WHERE tour_id = ?` to `JOIN tour_hotel_links` (junction-first)
- Backward-compat fallback: if no junction links exist, legacy `tour_id`-linked hotels are used

### Files changed
```
scripts/migrate-catalog-tables.sql    (new)
src/routes/universalSites.js          (new routes + normalizeDestination)
src/lib/universalSiteSync.js          (junction-first hotel query + legacy fallback)
public/product-modules.html           (Destinations catalog tab, Hotels renamed, no tour_id)
public/tour-config.html               (catalog pickers replace inline hotel form)
```

### What is still not done
- Destinations tab in Product Modules has no taxonomy/interest tagging (intentionally deferred)
- `tour_destination_links` data is not yet consumed by sync (destinations don't appear in tour page blocks yet — use `content_data.destination_*` fields for now)
- Tour Content UI: destination link sort_order reordering and hotel link nights editing are not yet exposed (links are created in order, nights editable only at link time)

### Known risks / TODOs
- `tenant_destinations` gallery is stored as JSON array `[{id,src,alt,caption}]` matching hotel gallery format
- Backward-compat: all existing hotel rows with `tour_id` still work via sync fallback — no data migration needed
- New hotels created via Product Modules no longer receive `tour_id`; this is intentional

### Suggested next prompt
"Surface linked destinations in the tour sync, so the tour page shows a destinations carousel similar to the hotel carousel. Use `tour_destination_links JOIN tenant_destinations` the same way hotels are now queried."

---
Goal of session: Implement `GET /api/admin/tenants/:id/broken-assets` and record the interrupted 2026-04-07 anti-abuse session.

### What was completed this session

- Added `GET /api/admin/tenants/:id/broken-assets` to `src/routes/admin.js` (admin-secret protected)
  - Scans **five D1 surfaces** for `/api/tenant/assets/{tenantId}/...` URL patterns:
    `tours.content_data`, `tenant_universal_hotels.gallery_json`,
    `tenant_universal_tour_pages.content_override_json`, `tenant_universal_pages.blocks_json`,
    and `tenants.site_config`
  - Bulk-loads the tenant's full `tenant_asset_inventory` in one query and classifies URLs as
    `deleted`, `blocked`, `not_in_r2`, or `not_in_inventory_or_r2`
  - Accepts `?check_r2=1` to HEAD-check each URL against TOUR_PAGES R2 for deep validation of
    untracked or inventory-live assets
  - Returns structured report: `broken[]` with reason + inventory state + references per surface,
    and `live[]` with optional notes for untracked assets
  - [SEC] tenantId sourced from URL param only, never from request body; protected by admin middleware

### Files changed
```
src/routes/admin.js
docs/ai/04_SESSION_HANDOFF.md
```

---

## Formal 2026-04-07 Handoff (written retroactively)
Date: 2026-04-07
Checkpoint: Tenant anti-abuse phase 1 + Cloudflare AI moderation pivot
Goal of session: Ship subdomain abuse-review policy, tenant trust ladder enforcement, and switch AI moderation from Gemini to Cloudflare AI.

### What was completed
- Fixed `scripts/smoke-local.mjs`: added `fetch failed` retry logic (3 attempts: 250 ms / 750 ms / 1500 ms) and accepted `webhook` or `log_only` as valid password-reset delivery modes so local smoke passes on Windows again
- Added `src/lib/subdomainPolicy.js`:
  - 3–63 character platform subdomains with strict character validation
  - Reserved group blocking (marketing, commercial, product, operations, technical namespaces)
  - Phishing-sensitive keyword detection (auth, finance, government, payment categories)
  - High-entropy label heuristic (random-looking subdomains sent to manual review)
  - Protected finance-brand similarity check
  - Webhook alerting via `SUBDOMAIN_REVIEW_WEBHOOK_URL` with `SUBDOMAIN_REVIEW_WEBHOOK_SECRET`
  - Brand-safe suggestion suffixes returned to tenants on rejection
- Added `db/migrations/0040_tenant_trust_and_review.sql`:
  - `trust_status`, `public_indexing_enabled`, `custom_domain_verified_at` columns on tenants
  - `tenant_review_cases` table for durable review audit trail
  - `tenant_risk_events` table for silent abuse-risk ledger
  - `tenant_asset_inventory` and `tenant_asset_scan_results` tables for asset moderation
- Enforced trust ladder at runtime: `PREVIEW_ONLY → PROBATION → TRUSTED → SUSPENDED/QUARANTINED`
  - New tenants start `PREVIEW_ONLY`; clean first subdomain claim auto-promotes to `PROBATION`
  - Probation sites forced `noindex`; custom domains only resolve after `TRUSTED` + domain verified
  - Publish now runs content-abuse scan, rate-limits by trust tier, and returns `429` on automated behavior
- Pivoted AI moderation from Gemini to Cloudflare AI in `src/lib/aiModeration.js`:
  - Prefers Workers `AI` binding, falls back to Cloudflare REST credentials
  - Same normalized moderation contract (`ALLOW`, `REVIEW`, `BLOCK`, `QUARANTINE`)
  - Telegram alert support via `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`
- Remote D1 migration `0041` applied and verified on production

### Files changed
```
db/migrations/0040_tenant_trust_and_review.sql
src/lib/subdomainPolicy.js
src/lib/aiModeration.js
src/lib/trustAbuse.js
src/routes/tenants.js
src/routes/onboarding.js
src/index.js
scripts/smoke-local.mjs
docs/ai/01_CURRENT_STATE.md
docs/ai/03_PROGRESS_LEDGER.md
```

### What was still not done at session end
- No admin diagnostic for broken asset URLs persisted in D1 (fixed 2026-04-08)
- Dead asset URLs from pre-2026-04-06 deletes still not bulk-swept
- Product-modules gallery still requires explicit Save after image pick
- No formal handoff was written (written retroactively 2026-04-08)

### Known risks / TODOs
- `DELETE /api/tenant/assets/:filename` cleanup still only sweeps `tours.content_data`; other surfaces (`tenant_universal_pages`, `tenant_universal_hotels`, `site_config`) require a separate pass or the new admin diagnostic to surface then manually repair
- Existing tenants may still carry pre-cleanup dead asset references; use `GET /api/admin/tenants/:id/broken-assets` to identify them before building automated repair scripts
- Trust-ladder enforcement changes affect existing paying tenants if their `trust_status` is `NULL`; NULL is treated as `PREVIEW_ONLY`, so operators added before the migration may be unexpectedly restricted

### Suggested next prompt
```
Run GET /api/admin/tenants/ten-demo-001/broken-assets?check_r2=1 against local dev to verify
the diagnostic returns correct results, then plan a bulk-repair pass for any dead asset URLs
discovered across tour content_data and other surfaces.
```

---

## Latest Handoff (pre-2026-04-08)
Date: 2026-04-06
Checkpoint: Tenant media preview root-cause repair
Goal of session: restore reliable tenant-uploaded image preview/render paths, support exact `1-1` pax bands live, and stop deleted tenant assets from leaving dead gallery references behind in product modules.

### What was completed this session

- Applied and verified remote D1 migration `0039_allow_exact_pax_band_ranges.sql`, so production `pax_bands` now allow exact ranges such as `1-1`
- Added room-based child-capacity validation to pricing (`1 child per shared double room`, `2 children per private room`) and re-ran the local pricing smoke until the pricing section passed again
- Deployed the pricing fix to production and verified live `1-1` pax-band creation on a real production tenant instead of the non-existent demo tenant
- Traced the tenant-media preview failure to the preview optimizer layer: same-origin `/api/tenant/assets/...` URLs were healthy, but wrapping them in `/cdn-cgi/image/...` produced `404`, so uploaded photos could exist without rendering in compact previews
- Patched `public/product-modules.html`, `public/universal-admin.html`, and `src/routes/universalSites.js` so tenant asset API URLs bypass `cdn-cgi/image` and render through their raw asset URLs instead
- Added stronger product-modules media tooling: inline broken-image placeholders, live gallery preview, tenant-gallery delete buttons, and open-form cleanup that clears dead asset references from visible fields immediately after delete
- Hardened backend delete semantics in `src/routes/tenants.js`: deleting a tenant asset now also removes stale references from tour `content_data` (`gallery_images`, `home_gallery_images`, `hero_image`, `destination_image`) so product modules and storefront renders do not keep pointing at `404` URLs
- Fixed the first backend cleanup implementation after production logs exposed a D1 `LIKE or GLOB pattern too complex` failure on filenames containing wildcard characters; cleanup now scans tenant tours by `tenant_id` and filters matches in JS instead of using SQL `LIKE`
- Repaired the affected production tenant record during debugging so `Hanoi -Halong` no longer points at the dead `WT32mjC3s0o-.png` gallery URL

### Files changed
```
db/integrity_check_pricing.sql
db/migrations/0004_add_pricing_foundation.sql
db/migrations/0039_allow_exact_pax_band_ranges.sql
docs/ai/03_PROGRESS_LEDGER.md
docs/ai/04_SESSION_HANDOFF.md
public/product-modules.html
public/universal-admin.html
scripts/smoke-local.mjs
src/routes/pricing.js
src/routes/tenants.js
src/routes/universalSites.js
```

### What is still not done
- The full local smoke suite is not completely green yet because password-reset smoke remains flaky/unrelated outside the pricing/media scope
- Product-modules gallery flow still relies on the operator to save the module after choosing new images; upload alone does not rewrite persisted `content_data` until save is clicked
- There is still no automated production sweep for old dead tenant asset URLs that predate the new delete cleanup behavior

### Known risks / TODOs
- Existing tenants can still have old dead asset URLs in D1 from before the cleanup patch; those records must be resaved or cleaned manually once discovered
- Any future frontend helper that re-wraps `/api/tenant/assets/...` in `cdn-cgi/image` will reintroduce the same preview failure, so tenant asset URLs should stay on the raw path unless the delivery architecture changes
- `DELETE /api/tenant/assets/:filename` currently cleans tour content only; if future tenant-managed assets are persisted in other D1 JSON surfaces, the cleanup sweep must be expanded intentionally

### Suggested next prompt
```
Audit the remaining tenant-media surfaces for stale asset references, then add a small admin diagnostic that lists broken `/api/tenant/assets/...` URLs still persisted in D1 so operators can repair them without raw SQL.
```

---

Date: 2026-04-05
Checkpoint: CHK-R46 tenant booking currency + market skin foundation
Goal of session: Lock the new product direction for tenant-controlled storefront currency and market skins, then ship the first real runtime slices for booking currency settings, quote/order snapshots, and market-skin catalogs.

### What was completed this session

- Added a dedicated architecture note at `docs/ai/28_MULTI_CURRENCY_AND_MARKET_SKINS.md` to lock the product direction: code stays English, tenant storefront currency should be tenant-controlled, and market skins should bundle language/currency/copy defaults
- Updated the AI docs so `00_AI_INDEX.md`, `01_CURRENT_STATE.md`, `03_PROGRESS_LEDGER.md`, and `14_TENANCY_AND_BILLING.md` now reflect the same multi-currency / market-skin direction
- Added `src/lib/tenantMarketCatalog.js` with the curated tenant storefront currency basket: `USD`, `EUR`, `VND`, `CNY`, `JPY`, `KRW`, `GBP`, `AUD`, `SGD`, `THB`
- Added `src/lib/marketSkins.js` with curated market presets such as `global-default`, `vietnam-domestic`, `china-outbound`, `japan-premium`, `korea-premium`, `uk-curated`, and `australia-outbound`
- Opened tenant settings for `booking_currency`, `default_locale`, `market_skin_key`, and `primary_market`, while still exposing curated runtime catalogs for currencies, market skins, and UI locales
- Added `db/migrations/0037_tenant_booking_currency_and_market_skin.sql` to introduce tenant booking-currency fields and booking draft/order snapshot columns
- Changed pricing calculate responses so authoritative totals now use tenant `booking_currency`, while older compatibility fields remain present during the migration period
- Changed booking drafts and booking orders so they now snapshot authoritative amount/currency/base-currency/rate fields alongside legacy USD compatibility fields
- Added a public `GET /api/auth/market-skins` catalog and wired signup to submit `market_skin_key` for both email and Google onboarding
- Updated onboarding + starter bootstrap so a selected market skin now sets tenant defaults (`booking_currency`, `default_locale`, `primary_market`), starter universal site variant, and starter seed language/currency context
- Expanded `public/universal-admin.html` System Panel so operators can edit `market_skin_key`, `booking_currency`, and `default_locale` through `/api/tenants/settings` without leaving Website Design
- Added real locale packs for `ja`, `ko`, `en-GB`, and `en-AU`, and upgraded `/api/i18n` locale resolution so Accept-Language can hit those exact variants instead of collapsing to base English
- Expanded locale coverage further with real packs for `de`, `fr`, and `es`, and added EUR market presets for Germany, France, and Spain to the shared market-skin catalog
- Hardened local runtime diagnostics: smoke now checks tenant route mounts immediately after Worker boot, and dashboard startup no longer produces a misleading early `404 /api/tenant/config` before tenant context exists
- Fixed pricing overlap semantics so season priority comes from `tenant_seasons.sort_order` rather than raw price magnitude, seeded an explicit High/Low overlap window, added smoke coverage for the overlap rule, and updated booking/pricing UI so `Good to know` follows `Grand total` while `Check availability` shows a minimum-price teaser with canonical pricing copy
- Replaced the earlier child-cap ratio with a room-based rule: each shared double room allows 1 child and each private room allows 2 children; admin/public booking UIs and backend pricing now enforce the same rooming-capacity warning, and smoke covers both reject and allow paths
- Clarified money semantics in runtime and docs: `booking_currency` is storefront truth, while `target_currency` survives only as storage for optional `secondary_display_currency`
- Extended locale catalogs and the `public/tour-config.html` pricing display currency selector so admin-facing pricing work can already use the expanded currency basket

### Files changed
```
docs/ai/00_AI_INDEX.md
docs/ai/01_CURRENT_STATE.md
docs/ai/03_PROGRESS_LEDGER.md
docs/ai/04_SESSION_HANDOFF.md
docs/ai/14_TENANCY_AND_BILLING.md
docs/ai/28_MULTI_CURRENCY_AND_MARKET_SKINS.md
db/migrations/0037_tenant_booking_currency_and_market_skin.sql
db/migrations/0038_max_children_per_two_adults.sql
src/lib/marketSkins.js
src/lib/tenantMarketCatalog.js
src/index.js
src/locales/en-au.json
src/locales/en-gb.json
src/locales/de.json
src/locales/es.json
src/locales/fr.json
src/locales/ja.json
src/locales/ko.json
src/lib/tenantBootstrap.js
src/lib/universalSiteSync.js
src/routes/bookings.js
src/routes/onboarding.js
src/routes/pricing.js
src/routes/tenants.js
src/utils/formatter.js
src/locales/en.json
src/locales/vi.json
src/locales/zh.json
public/signup.html
public/tour-config.html
public/universal-admin.html
public/dashboard.html
public/tour-booking-view.js
public/booking-view-core.js
scripts/smoke-local.mjs
src/routes/universalSites.js
src/lib/universalSite.js
db/seed_test.sql
```

### What is still not done
- Full removal of USD-centric compatibility fields is not finished yet (`grand_total_usd`, older formatter helpers, older enriched price fields still exist for compatibility)
- The new locale packs are real and exact-matchable now, but they still rely on English fallback for untouched long-tail admin/runtime strings rather than having 100% translated coverage
- The product still needs a deliberate decision on whether secondary display currency should appear broadly on storefront pages or only in selected quote/invoice surfaces

### Known risks / TODOs
- `target_currency` is now semantically pinned as secondary display currency storage; future cleanup should decide whether the legacy column is renamed in schema or simply preserved behind the clearer API alias forever
- `total_revenue_tracked` is still a single numeric tenant field without explicit revenue currency metadata; if the product later supports real finance reporting across multiple booking currencies, that field needs a clearer accounting model
- The smoke suite currently validates success-state behavior, not the full new locale and quote/order currency payload contracts, so API-level assertions for exact locale resolution, `booking_currency`, `grand_total_amount`, and `secondary_display_currency` should be added next

### Suggested next prompt
```
Push the new locale and money semantics into customer-facing storefront surfaces: decide where secondary display currency should appear, extend translated coverage for the new locale packs, and add API smoke assertions for exact locale resolution plus booking/secondary display currency payloads.
```

---

Date: 2026-04-04
Checkpoint: Architecture clarification follow-up
Goal of session: Lock the terminology and tenancy direction for future standalone hospitality expansion so the repo no longer mixes tour accommodation with a future hotel/property engine.

### What was completed this session

- Added a dedicated architecture note at `docs/ai/26_PROPERTY_ENGINE_AND_STAFF_SEATS.md`
- Locked the naming split between:
  - tour side: `tour`, `tour_stop`, `stop_accommodation`
  - future hospitality side: `property`, `property_reservation`, `property_inventory`, `property_staff`
- Recorded the tenancy decision that staff login should be modeled as add-on seats/memberships inside a tenant, not as separate tenants
- Clarified that current `tenant_universal_hotels` usage remains transitional runtime/storytelling support and is not the canonical future hospitality engine
- Updated AI docs so `00_AI_INDEX.md`, `01_CURRENT_STATE.md`, and `14_TENANCY_AND_BILLING.md` all reflect the same concept boundary

### Files changed
```
docs/ai/00_AI_INDEX.md
docs/ai/01_CURRENT_STATE.md
docs/ai/14_TENANCY_AND_BILLING.md
docs/ai/26_PROPERTY_ENGINE_AND_STAFF_SEATS.md
docs/ai/04_SESSION_HANDOFF.md
```

### What is still not done
- No property engine schema has been implemented yet
- No property availability / reservation / POS / staff-assignment tables exist yet
- Current hotel UI/runtime still remains transitional and tour-adjacent only

### Known risks / TODOs
- Future contributors may still over-interpret `tenant_universal_hotels` as a canonical hotel engine unless the new property-domain note is read first
- Staff-seat pricing and limits are still a design direction only; no runtime enforcement exists yet
- Property-scoped RBAC has not been designed in schema form yet, only conceptually approved

### Suggested next prompt
```
Write a migration-safe schema proposal for the first `property` domain slice, including `property`, `property_staff_assignment`, and the minimum reservation/availability tables, without touching the current tour pricing engine.
```

---

Date: 2026-04-04
Checkpoint: CHK-R39 / CHK-R43 follow-up
Goal of session: Stabilize tenant-media authoring flows in the admin UIs, replace tour-only CTA wording with shared intent-based defaults, and repair the resulting storefront regression on production.

### What was completed this session

- Reworked media authoring in `public/tour-config.html` and `public/product-modules.html` around a tenant-gallery-first picker so operators can upload from local drive or reuse tenant-hosted images without pasting raw URLs by hand
- Added explicit media ownership behavior: gallery images stay gallery-level unless deliberately assigned to hero/destination/accommodation, module-level remove buttons clear only that module field, and gallery remove buttons delete only the selected gallery entry
- Added local upload guards for image size/dimensions and switched admin previews to optimized image URLs with local-dev fallback so previews remain fast without breaking local rendering
- Shrunk compact gallery previews in `product-modules.html` so agents can scan many images in one screen, while keeping larger previews intact for module-level editing contexts
- Introduced shared CTA intent defaults in the universal site layer: `Explore` for discovery, `Check availability` for booking, and `Contact us` for contact
- Replaced legacy tour-only fallback copy (`I like this tour`) in universal blueprint defaults, sync snapshot fallback, runtime booking slot rendering, and editor schema with the new CTA-intent system
- Forced universal hero behavior by context: home/listing hero CTAs now resolve to tenant-aware public listing paths, while `tour_detail` hero CTAs now resolve to booking intent and `#booking-engine`
- Fixed a production `Internal Server Error` introduced during the CTA refactor: `renderPublicHtml()` referenced `buildPageHref` / `headerPrimaryPageKey` before initialization, so the live fix moved CTA path helpers before hero rendering and redeployed production successfully

### Files changed
```
public/tour-config.html
public/product-modules.html
src/lib/universalSite.js
src/lib/universalSiteSync.js
src/routes/universalSites.js
src/lib/themes/six-senses.js
docs/ai/01_CURRENT_STATE.md
docs/ai/03_PROGRESS_LEDGER.md
docs/ai/04_SESSION_HANDOFF.md
```

### What is still not done
- Remote URL image validation is still weaker than local upload validation; true remote size/dimension enforcement still needs a backend metadata/proxy check
- Contact-intent CTA is defined at schema/runtime level, but only a subset of storefront CTA surfaces currently consume the shared resolver
- Media picker / preview logic is still duplicated across `tour-config.html` and `product-modules.html`; it is not yet extracted into a shared frontend module

### Known risks / TODOs
- Future CTA edits must respect render ordering inside `renderPublicHtml()`; helper values needed by hero render should be defined before any block render path runs, otherwise Worker-side `ReferenceError` regressions can surface as production `500`s
- Wrangler still warns that multiple environments exist when deploy is run without an explicit `--env`; deployments are succeeding, but explicit target selection should be standardized before the next risky rollout
- Admin media preview performance is improved, but storefront/public image optimization should still be reviewed separately so public delivery follows the same safety/performance rules without relying on admin-only assumptions

### Suggested next prompt
```
Extract the duplicated tenant-media picker / preview / remove behavior from `public/tour-config.html` and `public/product-modules.html` into a shared frontend module, then add backend validation for remote image URLs so pasted external images are checked before they enter tenant-managed content.
```

---

Date: 2026-04-04
Checkpoint: CHK-R45 taxonomy discovery foundation
Goal of session: Build the first production-grade foundation for taxonomy-first discovery so interests drive auto-generated collection pages instead of relying on free-form page building.

### What was completed this session

- Added `db/migrations/0036_interest_taxonomy_foundation.sql` with tenant-scoped discovery profiles and interest-tag mapping tables for tours and destinations, plus universal interest-page state
- Added `src/lib/interestTaxonomy.js` as the canonical taxonomy layer with fixed top-level interests (`adventure`, `culture`, `beach`, `sport`, `food`, `nature`), planned sub-interests, payload validation, and auto-page scaffolding helpers
- Extended `src/routes/universalSites.js` so universal site runtime now builds `interest_runtime` collections and resolves listing bindings of the form `taxonomy.interest.<interest>.tour_listing`
- Added protected taxonomy endpoints for catalog lookup and tenant-scoped tagging: `GET /api/universal/taxonomy/catalog`, `GET /api/universal/taxonomy/interest-pages`, `GET|PUT /api/universal/taxonomy/tours/:tourId`, and `GET|PUT /api/universal/taxonomy/destinations/:destinationId`
- Added auto-generated interest collection pages into the existing `tenant_universal_pages` pipeline instead of building a second page engine; these pages are scaffolded as standard pages and become visible once enough tours carry a matching top-level interest tag
- Surfaced taxonomy editing directly inside unit-level authoring flows: `public/tour-config.html` now edits tour interests in the Content tab, and `public/product-modules.html?mode=destinations` now edits destination-source taxonomy on the canonical backing tour record
- Replaced the Six Senses hero search mock with a real destination-or-interest search flow: the first field is wider, submits to the tours listing page, and filters listing cards by destination text plus taxonomy tags already assigned to tours
- Locked overwrite-oriented universal bootstrap persist by default: `POST /api/universal/site/bootstrap` now requires explicit overwrite confirmation before it can rewrite a tenant scaffold, and the manual universal API test skips destructive persist mode unless opted in
- Added a second Six Senses-derived luxury variant (`tour-luxury-riviera`) with different preset imagery, theme colors, and typography, and rewired `public/universal-admin.html` so operators choose among real luxury variants instead of a single hardcoded sample label
- Verified that the existing local smoke suite still passes unchanged after the taxonomy foundation landed

### Files changed
```
db/migrations/0036_interest_taxonomy_foundation.sql
src/lib/interestTaxonomy.js
src/routes/universalSites.js
public/tour-config.html
public/product-modules.html
public/universal-admin.html
src/lib/universalSite.js
src/lib/themes/six-senses.js
scripts/reset_local_six_senses_preset.mjs
docs/ai/01_CURRENT_STATE.md
docs/ai/22_INTEREST_TAXONOMY_AND_COLLECTIONS.md
docs/ai/03_PROGRESS_LEDGER.md
docs/ai/04_SESSION_HANDOFF.md
```

### What is still not done
- Search/ranking still does not consume taxonomy; the current build covers schema, APIs, auto-generated collection pages, and the first unit-level authoring surfaces only
- Search now consumes destination text and taxonomy tags for the storefront tours flow, but there is still no broader faceted search or ranking model yet
- True standalone destination-entity editing UI is still missing; current destination workflow applies taxonomy through destination-source modules backed by tours
- Destination-tag data is stored and retrievable, but current auto-generated interest pages are still driven by tour tags rather than destination-led page sections

### Known risks / TODOs
- Auto-generated interest pages are intentionally scaffolded into the existing universal page pipeline, so later manual editing rules need a clear policy for which fields remain system-owned versus curator-owned
- The first runtime binding only targets `tour_listing` by top-level interest; sub-interest pages, score-driven ordering, and facet search still need separate implementation work
- Production rollout gap was real: live universal schema loading failed until remote D1 migration `0036_interest_taxonomy_foundation.sql` was applied. The storefront schema now loads on production, but the full `choose skin` reset flow still needs a separate pass if further runtime errors appear.

### Suggested next prompt
```
Now that production D1 migration 0036 is applied and universal site config loads again, continue tracing the remaining `choose skin` reset flow on the real production tenant and isolate the next backend failure before changing more UI code.
```

---

Date: 2026-04-02
Checkpoint: Multi-skin storefront preservation + Website Design handoff
Goal of session: Preserve the real storefront direction in code and docs: save Six Senses as the first skin module, keep the runtime multi-skin-ready, expand Website Design system settings, and record the future seed-by-skin tenant workflow.

### What was completed this session

- Preserved the runtime multi-skin storefront architecture under `src/lib/themes/`, with `src/lib/themes/six-senses.js` saved as the first committed storefront skin module and `src/lib/themes/index.js` acting as the resolver/registry
- Kept Six Senses as the actual storefront truth by aligning the `tour-luxury` baseline, active theme resolution, preview-first render pipeline, and Website Design admin around that shell
- Expanded Website Design system settings so the panel now controls much more of the storefront chrome and behavior: header toggles, hero toggles, floating CTA/contact controls, footer/social visibility, menu-tab visibility, logo/fonts/colors, page visibility, and broader contact settings
- Cleaned the dashboard path so older Design Website / Visual Editor / Site Studio clutter is removed in favor of Website Design, System Settings, and Tours & Pricing flows
- Saved the future architecture direction in docs: more skins are planned, tenants will choose different skins, and tenant creation should eventually preload normalized seed packs for tours, hotels, galleries, destinations, and related storefront data based on that chosen skin

### Files changed
```
src/lib/themes/index.js
src/lib/themes/six-senses.js
src/lib/universalSite.js
src/lib/universalSiteSync.js
src/routes/universalSites.js
public/universal-admin.html
public/dashboard.html
public/tour-config.html
db/migrations/0031_universal_hotels.sql
scripts/backfill-universal-luxury.mjs
docs/ai/01_CURRENT_STATE.md
docs/ai/03_PROGRESS_LEDGER.md
docs/ai/04_SESSION_HANDOFF.md
CURRENT_STATE_EXPORT.md
```

### What is still not done
- Additional storefront skins beyond Six Senses are not implemented yet
- Tenant creation does not yet auto-load normalized seed packs by selected skin
- Seed normalization for tours, hotels, galleries, destinations, and related storefront content is still a planned next build step

### Known risks / TODOs
- The runtime is now multi-skin-ready in structure, but only one real skin module exists today; future skins should follow the same registry/module contract instead of hard-coding variant behavior back into the route layer
- Seed data is still split between canonical tour records, temporary hotel records, and universal runtime projections; tenant-bootstrap automation should only be built after those seed packs are normalized cleanly
- Temporary hotel storage is intentionally transitional and may be replaced once canonical hotel/domain modeling is formalized

### Suggested next prompt
```
Build the next storefront skin module under src/lib/themes/, then design a seed-pack system so tenant creation can choose a skin and automatically preload tours, hotels, galleries, destinations, and matching storefront content in one flow.
```

---

Date: 2026-03-26
Checkpoint: CHK-R36 + CHK-R36b
Git commits: `4e38506`, `2d14b0b` on branch `rescue-minimum`
Goal of session: Redesign the Price Config tab in `public/tour-config.html` to show a customer-facing Booking View (segment tiers, per-pax-type qty controls, live price calculator) instead of the flat admin grid; then add full CRUD for seasons and segments.

### What was completed this session

**CHK-R36 — Price Config tab: Customer Booking View**
- `public/tour-config.html` — replaced 3-column admin grid with:
  - **Booking View card** (top): segment tier buttons (auto-select first on load), 4-row pax table (Adult Shared Room, Adult Private Room, Child with parents, Infant) with ±qty steppers and unit price / subtotal columns, travel date input (triggers `POST /api/pricing/calculate` for season-aware total + footnote showing applied season + pax band)
  - **Collapsible admin `<details>`** (bottom): 2-col grid Seasons + Pax Bands; Segments; Tour Prices table. All existing IDs preserved.
  - New CSS: `.seg-tab`, `.seg-tab.active`, `.qty-wrap`, `.qty-btn`, `.qty-val`

**CHK-R36b — Season/Segment full CRUD + editable dates**
- Season dates (start/end month+day) now render as 4 editable `<input type="number">` fields — each fires `PATCH /api/pricing/tenant-seasons/:id` on blur
- **Add Season form**: Name + from month/from day/to month/to day → `POST /api/pricing/tenant-seasons`
- **Add Segment form**: Label + Code (auto-uppercased) → `POST /api/pricing/pricing-segments`
- Both season and segment rows already had delete (`×`) buttons from previous session
- Fixed `updatePricingItem` to correctly handle numeric field values

### Files changed
```
public/tour-config.html   (+264 -76 CHK-R36; +70 -7 CHK-R36b)
docs/ai/03_PROGRESS_LEDGER.md
docs/ai/01_CURRENT_STATE.md
docs/ai/04_SESSION_HANDOFF.md
```

### What is still not done / testing in progress
- Agent has not finished testing the Price Config tab in the running dev server — visual verification partially done, full CRUD flow (add season, add pax band, add segment, add tour price, run calculate) still pending
- `wrangler dev` runs on port 8787; ensure it is running before testing: `npx wrangler dev`
- Apply local migrations if needed: `npx wrangler d1 migrations apply travel_agent_db --local`

### Known risks
- Season date PATCH sends values as strings from `<input type="number">`; backend `coerceNumeric()` handles the int conversion — verify on first edit
- `POST /api/pricing/calculate` requires an existing tour price row matching the selected segment + date's season + pax count band; if no matching row, fallback total is shown (raw sum from base price row)
- Segment tabs auto-select the first segment on `loadPricing()` — if the tenant has no segments yet, the tab area shows a help message pointing to the Manage section

### Suggested next prompt
```
Read:
1. docs/ai/01_CURRENT_STATE.md
2. docs/ai/03_PROGRESS_LEDGER.md

Open http://localhost:8787/tour-config.html
Connect with tenant ten-demo-001, select a tour.
Go to Price Config tab and test:
1. Add a season (name, dates)
2. Add a segment (label, code)
3. Add a pax band
4. Add a tour price row linking them
5. In Booking View, select the new segment, set qty, pick a travel date → verify grand total appears
6. Delete a season and a segment — confirm loadPricing() refreshes cleanly

If all pass, CHK-R36 is DONE. Proceed to the next planned feature.
```

---

## Handoff Archive

### 2026-03-26 — CHK-R18 + CHK-R19
Date: 2026-03-26
Checkpoint: CHK-R18 + CHK-R19
Git commit: `0583b86` on branch `rescue-minimum`
Goal of session: Implement bank transfer order system with identity lock, proof upload, revenue tracking, scheduled purge; then add Guest Portal (token-gated) and Booking Widget v1.

What was completed: `booking_orders` table, 4 order endpoints, `purgeExpiredOrders` cron, `secure_token` migration, `GET/POST /api/bookings/public/:token`, `public/widget.js` embed widget, test suite `test/test_booking_orders.sh`.

Files changed: `src/routes/bookings.js`, `db/migrations/0016_booking_orders.sql`, `db/migrations/0017_booking_order_token.sql`, `public/widget.js`, `wrangler.jsonc`, `src/index.js`, `test/test_booking_orders.sh`
