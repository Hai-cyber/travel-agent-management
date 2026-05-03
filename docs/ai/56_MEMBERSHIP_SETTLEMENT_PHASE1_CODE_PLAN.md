# MEMBERSHIP SETTLEMENT PHASE 1 CODE PLAN

> RUNTIME NOTE:
> This document is the concrete code plan for `CHK-R134` and the first consumer slice `CHK-R135`.
> It is not proof that the flow is already implemented.
> Actual shipped runtime remains listed in `01_CURRENT_STATE.md`.

## Purpose

This plan turns `55_MEMBERSHIP_SETTLEMENT_PHASE1_IMPLEMENTATION_SPEC.md` into a file-by-file execution path.

Primary goal:

- ship the shared membership settlement core for manual `tours_pro` activation

## Critical implementation decision

### Product tier key normalization must be handled first

Current docs and current runtime do not use the same tier keys.

Current runtime keys in code:

- `starter_landing`
- `tour_operator_pro`
- `hotel_operator_pro`
- `tour_hotel_suite`

Current newer packaging docs use:

- `starter_landing`
- `tours_pro`
- `hotel_pro`
- `all_in_one`

Phase 1 must not silently mix these names.

### Phase-1 rule

For runtime implementation in `CHK-R134` and `CHK-R135`, use current runtime keys as canonical in code:

- `tour_operator_pro`
- `hotel_operator_pro`
- `tour_hotel_suite`

If needed, add one normalization helper so docs-facing aliases can resolve safely.

Suggested helper behavior:

- `tours_pro` -> `tour_operator_pro`
- `hotel_pro` -> `hotel_operator_pro`
- `all_in_one` -> `tour_hotel_suite`

Do not rename the entire existing product-tier runtime in this checkpoint.

## Execution order

### Step 0

Add one normalization helper for membership tier keys.

Target:

- `src/lib/productTiers.js`

Add:

- `normalizeProductTierKey()`
- optionally `resolveCanonicalProductTierKey()`

Purpose:

- keep the new membership settlement flow aligned with current runtime keys
- avoid spreading alias handling across routes and dashboard JS

### Step 1

Add the new D1 migration.

Target file:

- `db/migrations/0104_membership_billing_intents.sql`

Contains:

- `CREATE TABLE membership_billing_intents`
- required indexes

Decision:

- use `TEXT` ids with `nanoid()` in runtime
- include `tenant_id` on every row for tenant isolation
- no foreign-key complexity beyond what phase 1 needs

### Step 2

Add the shared service layer.

Target file:

- `src/lib/membershipBilling.js`

Functions to implement in phase 1:

- `normalizeMembershipTierKey(rawKey)`
- `getMembershipTierPrice(productTierKey)`
- `getManualSettlementConfig(env)`
- `buildMembershipReferenceCode()`
- `findReusableMembershipIntent(db, tenantId, productTierKey, providerKey)`
- `createOrReuseMembershipIntent(env, input)`
- `markMembershipIntentSubmitted(env, input)`
- `approveMembershipIntent(env, input)`
- `rejectMembershipIntent(env, input)`
- `voidMembershipIntent(env, input)`
- `activateTenantMembershipFromSettledIntent(env, input)`

Why this file exists:

- routes should stay thin
- approval logic should not be duplicated between admin route and future providers
- activation should become one explicit operation rather than scattered `UPDATE tenants` statements

### Step 3

Add the tenant-facing route family.

Target file:

- `src/routes/membershipBilling.js`

Routes in phase 1:

- `POST /api/membership-billing/intents`
- `GET /api/membership-billing/intents/current`
- `POST /api/membership-billing/intents/:intentId/mark-submitted`

Route rules:

- require authenticated tenant actor
- require `X-Tenant-ID`
- tenant can only act on own rows
- use service layer for all writes
- return provider response mode and manual instructions payload

### Step 4

Register the new route family in worker bootstrap.

Target file:

- `src/index.js`

Change set:

- import `registerMembershipBillingRoutes` from the new route file
- register it next to existing billing/admin/payment route families

This checkpoint should use Hono registration, not URLPattern `patterns[]`, because this is entity-style platform routing.

### Step 5

Add admin review endpoints into the existing admin route family.

Target file:

- `src/routes/admin.js`

Routes in phase 1:

- `GET /api/admin/membership-billing/intents`
- `POST /api/admin/membership-billing/intents/:intentId/approve`
- `POST /api/admin/membership-billing/intents/:intentId/reject`
- `POST /api/admin/membership-billing/intents/:intentId/void`

Implementation note:

Do not replace the existing emergency route:

- `POST /api/admin/tenants/:id/set-subscription`

Keep it as a support escape hatch while the new flow stabilizes.

### Step 6

Upgrade the billing pane to a provider-agnostic membership UI.

Target file:

- `public/dashboard.html`

Specific touchpoints already present:

- pane container `#pane-billing`
- loader function `loadBillingPane()`
- renderer `renderBillingPane(data)`
- Stripe actions using `/api/billing/status`, `/api/billing/checkout`, `/api/billing/portal`

Phase-1 UI plan:

- keep the existing billing pane surface
- add a new membership settlement block for `tour_operator_pro`
- do not remove the old Stripe UI in the first patch unless replacement is fully working

Recommended UI states:

- no active intent -> show `Activate Tours Pro` button that creates an intent
- `awaiting_payment` -> show manual transfer instructions and required reference code
- `awaiting_review` -> show submitted state and waiting message
- `settled` with active membership -> show active state
- `failed` -> show retry path

Recommended implementation tactic:

- do not rewrite the whole billing pane at once
- first extend `loadBillingPane()` to fetch both old billing status and new membership intent status
- then add a small renderer branch for the new membership block

### Step 7

Expose platform-managed manual settlement config.

Primary truth target:

- `app_settings`

Likely touchpoints:

- existing admin/settings or marketing-site config surfaces if a current write path already exists

Phase-1 fallback:

- if there is no clean admin config surface yet, allow env-backed fallback for initial bootstrap while still centralizing read logic in `getManualSettlementConfig(env)`

Do not hardcode real account details directly inside route handlers or dashboard JS.

### Step 8

Add narrow validation and smoke coverage.

Likely targets:

- existing local smoke script if practical
- otherwise focused API smoke commands documented in ledger notes

Minimum checks:

1. create intent
2. reuse intent
3. mark submitted
4. admin approve
5. tenant becomes `ACTIVE`
6. `product_tier_key` matches canonical runtime key
7. commerce policy still does not treat manual settlement as electronic gateway activation

## File-by-file plan

### `db/migrations/0104_membership_billing_intents.sql`

Create the new table and indexes.

Expected validation:

- local migration apply succeeds
- table appears in `/api/tables` or D1 inspection flow

### `src/lib/productTiers.js`

Add canonical key normalization helpers.

Expected validation:

- tier lookup still works for existing signup/catalog consumers
- new billing flow can request `tours_pro` but resolve to `tour_operator_pro` safely if needed

### `src/lib/membershipBilling.js`

Implement the settlement core and activation helper.

Expected validation:

- unit-like runtime checks through narrow route calls
- rejection paths do not mutate tenant entitlement

### `src/routes/membershipBilling.js`

Implement tenant routes.

Expected validation:

- tenant-scoped intent create/read/submit works with authenticated session and `X-Tenant-ID`
- wrong tenant cannot read or mutate another tenant's intent

### `src/routes/admin.js`

Implement admin review queue and approve/reject/void actions.

Expected validation:

- approval writes both settlement state and tenant entitlement
- reject/void do not activate tenant
- existing `set-subscription` route still works

### `src/index.js`

Register the new membership billing route family.

Expected validation:

- route family is mounted in live worker runtime

### `public/dashboard.html`

Add phase-1 membership block to the billing pane.

Expected validation:

- billing pane still loads for current tenants
- `tour_operator_pro` activation path is visible and usable
- old Stripe-specific UI is not accidentally broken before the new flow fully replaces it

## Risks and local repair strategy

### Risk 1

Tier-key mismatch causes activations to write the wrong `product_tier_key`.

Repair strategy:

- centralize canonicalization in one helper before routes are added

### Risk 2

Billing pane rewrite breaks existing subscription status rendering.

Repair strategy:

- add the new membership block incrementally instead of replacing the entire renderer in one edit

### Risk 3

Admin approval writes `ACTIVE` but forgets audit trail.

Repair strategy:

- keep approval in service layer and always pair entitlement update with audit write

### Risk 4

Manual settlement accidentally loosens public-commerce gate.

Repair strategy:

- explicitly validate after approval that publish/commercial policy still checks electronic gateway state separately

## Suggested implementation batches

### Batch A

- migration
- service helper scaffold
- route registration scaffold

Validation after Batch A:

- migration applies
- routes mount without crashing

### Batch B

- tenant routes
- admin routes
- service-layer writes

Validation after Batch B:

- API smoke for create -> submit -> approve

### Batch C

- dashboard billing pane integration

Validation after Batch C:

- manual end-to-end flow works from dashboard

## Completion definition for this code plan

This plan is complete when implementation can proceed in order without reopening architecture decisions for:

- schema shape
- canonical tier key handling
- route placement
- admin approval path
- dashboard integration strategy

## Companion docs

- `54_MEMBERSHIP_SETTLEMENT_AND_PROVIDER_MODEL.md`
- `55_MEMBERSHIP_SETTLEMENT_PHASE1_IMPLEMENTATION_SPEC.md`
- `38_PLATFORM_PACKAGING_AND_TIERS.md`
- `01_CURRENT_STATE.md`
