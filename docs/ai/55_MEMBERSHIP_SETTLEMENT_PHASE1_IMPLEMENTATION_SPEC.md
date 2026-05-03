# MEMBERSHIP SETTLEMENT PHASE 1 IMPLEMENTATION SPEC

> RUNTIME NOTE:
> This document defines the approved phase-1 implementation spec for `CHK-R134`.
> The current rescue runtime does not implement this flow yet.
> Actual shipped billing runtime remains listed in `01_CURRENT_STATE.md`.

## Scope

This spec covers only phase 1 of the new membership settlement model.

Phase 1 goal:

- ship one provider-agnostic membership settlement core
- ship one manual settlement provider
- ship one admin approval flow
- activate paid membership and upgrade paths through the new path

This phase does not yet complete proof upload, non-manual provider plugins, or Stripe plugin migration.

Runtime update:

- the shared manual-settlement core is now live
- the billing pane now exposes self-serve targets beyond `tour_operator_pro`
- tenant-admin surfaces now use tier-aware soft locks that route users back into the billing pane when they touch features outside their current tier

## Runtime tier-key note

Current runtime code still uses these canonical keys:

- `tour_operator_pro`
- `hotel_operator_pro`
- `tour_hotel_suite`

Newer packaging docs use shorter aliases:

- `tours_pro`
- `hotel_pro`
- `all_in_one`

Phase 1 must normalize these names in one shared helper instead of silently mixing them across routes and UI.

## Checkpoint

- `CHK-R134` — membership settlement core

Phase-1 consumer checkpoints:

- `CHK-R135` — `tours_pro` membership completion
- `CHK-R136` — `hotel_pro` membership completion baseline
- `CHK-R137` — `all_in_one` membership completion baseline

## Why this phase exists

Current runtime billing is still Stripe-specific for tenant membership.

That creates two business risks:

- platform membership activation is blocked by provider availability or legal setup timing
- the billing architecture is provider-shaped instead of product-shaped

Phase 1 removes that dependency by making manual settlement the first non-provider-blocked path.

## Non-goals

Phase 1 does not include:

- replacing guest payment runtime
- changing public commerce policy
- treating manual settlement as electronic gateway activation
- Stripe subscription migration into the new plugin layer
- automatic bank reconciliation

## Runtime truth this spec must preserve

Phase 1 must preserve existing platform truth:

- `tenants.subscription_status` remains the entitlement gate used by runtime middleware
- public commerce policy still depends on real electronic payment methods and verified custom-domain policy
- manual membership settlement must not mark `electronic_gateway_configured = true`
- existing admin emergency override in `src/routes/admin.js` remains available as a support escape hatch until the new flow is fully stable

## Data model

### New table

Add one new D1 table:

- `membership_billing_intents`

### Required columns

- `id TEXT PRIMARY KEY`
- `tenant_id TEXT NOT NULL`
- `product_tier_key TEXT NOT NULL`
- `provider_key TEXT NOT NULL`
- `status TEXT NOT NULL`
- `amount NUMERIC NOT NULL`
- `currency TEXT NOT NULL`
- `reference_code TEXT NOT NULL`
- `instructions_json TEXT`
- `proof_asset_key TEXT`
- `provider_session_id TEXT`
- `provider_reference TEXT`
- `requested_at INTEGER NOT NULL`
- `expires_at INTEGER`
- `submitted_at INTEGER`
- `reviewed_at INTEGER`
- `reviewed_by TEXT`
- `review_note TEXT`
- `settled_at INTEGER`
- `voided_at INTEGER`
- `meta_json TEXT`

### Required indexes

- index on `(tenant_id, requested_at DESC)`
- index on `(tenant_id, status)`
- unique index on `reference_code`

### Status enum for phase 1

Allowed statuses in phase 1:

- `awaiting_payment`
- `awaiting_review`
- `settled`
- `failed`
- `expired`
- `void`

Phase 1 intentionally collapses `draft` and `awaiting_proof` to keep the first ship path smaller.

## Provider model for phase 1

### Providers implemented in phase 1

- `manual_bank_transfer`

### Providers explicitly deferred

- `wise_manual`
- `paypal_manual`
- `stripe`
- `test_fake`

Reason:

phase 1 should prove the shared billing core with the smallest credible non-provider-blocked path.

### Provider behavior in phase 1

`manual_bank_transfer` does not redirect to external checkout.

It returns:

- `response_mode = show_manual_instructions`
- account instructions payload
- transfer amount and currency
- required `reference_code`
- allowed next action: `mark_submitted`

## Platform-configured settlement instructions

Phase 1 must not hardcode personal or business payment details in product logic.

Manual settlement instructions should come from platform-managed config.

Preferred storage for phase 1:

- `app_settings`

Suggested config key:

- `membership_manual_settlement_config`

Suggested payload shape:

```json
{
  "enabled": true,
  "provider_label": "Bank transfer",
  "account_holder": "...",
  "bank_name": "...",
  "iban": "...",
  "swift_bic": "...",
  "address": "...",
  "supported_currencies": ["EUR"],
  "payment_note_template": "TM-{{reference_code}}",
  "help_text": "..."
}
```

If phase 1 needs a faster bootstrap path, env fallback is acceptable, but `app_settings` remains the preferred truth.

## Tier and amount rules for phase 1

Phase 1 only needs to activate `tours_pro`, but the billing intent model must already carry `product_tier_key` so later phases can extend the same flow cleanly.

Phase-1 allowed tier on tenant self-serve path:

- `tours_pro`

Phase-1 intent create must reject:

- `starter_landing`
- `hotel_pro`
- `all_in_one`

unless the route is explicitly admin/internal.

### Amount source of truth

Phase 1 should derive amount from the existing product tier catalog, not from frontend input.

Source:

- `src/lib/productTiers.js`

Phase-1 amount logic:

- `tours_pro` uses the catalog monthly EUR amount

## API surface

Phase 1 should add a new route family, separate from the old Stripe-specific billing endpoints.

Suggested file:

- `src/routes/membershipBilling.js`

Suggested registration family:

- `app.route('/api/membership-billing', membershipBilling)`

### Tenant routes

#### `POST /api/membership-billing/intents`

Purpose:

- create or reuse one active membership billing intent for the current tenant

Request body:

```json
{
  "product_tier_key": "tours_pro",
  "provider_key": "manual_bank_transfer"
}
```

Rules:

- require authenticated tenant actor
- require `X-Tenant-ID`
- tenant can only create intent for self
- tier must be phase-1 allowed
- provider must be phase-1 allowed
- if there is an existing open intent in `awaiting_payment` or `awaiting_review`, reuse it unless expired or voided

Response shape:

```json
{
  "ok": true,
  "intent": {
    "id": "...",
    "product_tier_key": "tours_pro",
    "provider_key": "manual_bank_transfer",
    "status": "awaiting_payment",
    "amount": 9.98,
    "currency": "EUR",
    "reference_code": "TM-...",
    "response_mode": "show_manual_instructions",
    "instructions": {
      "provider_label": "Bank transfer",
      "account_holder": "...",
      "iban": "...",
      "swift_bic": "...",
      "address": "...",
      "payment_note": "TM-..."
    }
  }
}
```

#### `GET /api/membership-billing/intents/current`

Purpose:

- return the latest open or latest recent billing intent for the current tenant

Rules:

- require authenticated tenant actor
- tenant-scoped only

#### `POST /api/membership-billing/intents/:intentId/mark-submitted`

Purpose:

- tenant marks the manual settlement as sent

Rules:

- require authenticated tenant actor
- intent must belong to tenant
- intent must currently be `awaiting_payment`
- move status to `awaiting_review`
- stamp `submitted_at`
- optional `note` goes into `meta_json` or `review_note_pending`

This is the minimum phase-1 substitute for proof upload.

### Admin routes

Admin routes should live in the existing admin route family rather than introducing a second admin auth model.

#### `GET /api/admin/membership-billing/intents`

Purpose:

- list review queue for manual settlement

Query support:

- `status`
- `product_tier_key`
- `limit`

#### `POST /api/admin/membership-billing/intents/:intentId/approve`

Purpose:

- approve settlement and activate tenant membership

Rules:

- require admin auth
- intent must be `awaiting_review`
- activation and settlement write must happen together

Writes:

- intent status -> `settled`
- `reviewed_at`, `reviewed_by`, `review_note`, `settled_at`
- tenant `subscription_status` -> `ACTIVE`
- tenant `product_tier_key` -> `tours_pro` if needed
- audit log row in `tenant_audit_log`

#### `POST /api/admin/membership-billing/intents/:intentId/reject`

Purpose:

- reject or fail the submitted settlement

Rules:

- require admin auth
- intent must be `awaiting_review`
- move to `failed`
- write review metadata

#### `POST /api/admin/membership-billing/intents/:intentId/void`

Purpose:

- manually close an abandoned or superseded intent

Rules:

- allowed from `awaiting_payment` or `awaiting_review`
- move to `void`

## Service layer

Phase 1 should not bury all logic directly in route handlers.

Suggested service file:

- `src/lib/membershipBilling.js`

Suggested responsibilities:

- resolve tier price from product catalog
- generate reference code
- read manual settlement config
- create or reuse active intent
- mark submitted
- approve intent and activate tenant membership atomically
- reject or void intent

### Activation helper

Add one explicit helper for membership activation.

Suggested function:

- `activateTenantMembershipFromSettledIntent(env, intent, actor)`

Reason:

Phase 1 should stop spreading entitlement writes across ad hoc admin paths and future provider callbacks.

## UI scope for phase 1

Phase 1 should add a minimal billing UI path on the tenant dashboard billing pane.

Minimum UI behavior:

- allow selecting all currently permitted target tiers from the runtime upgrade matrix
- show current membership status
- show manual settlement instructions when an intent exists
- show the required transfer reference clearly
- show `I have paid` action
- show `awaiting review` state after submission

Current runtime matrix:

- `starter_landing -> tour_operator_pro | hotel_operator_pro | tour_hotel_suite`
- `tour_operator_pro -> tour_hotel_suite`
- `hotel_operator_pro -> tour_hotel_suite`

No invoice history, no multi-provider chooser UI, and no proof-upload UI is required in phase 1.

## Security and audit requirements

Phase 1 must include:

- strict tenant ownership checks on every tenant route
- admin-only approval and rejection
- audit log on approval/rejection/void
- no acceptance of amount or tier price from the client
- no hardcoded settlement credentials in route logic

## Migration and rollout order

### Step 1

- add D1 migration for `membership_billing_intents`

### Step 2

- add service layer and tenant/admin routes

### Step 3

- add billing-pane UI for manual settlement targets and tier-aware upgrade routing

### Step 4

- keep old Stripe billing runtime intact during rollout

### Step 5

- after validation, route `tours_pro` membership completion to the new path by default

## Acceptance criteria for `CHK-R134`

`CHK-R134` is done when:

1. a tenant can create a provider-agnostic membership billing intent for an allowed target tier
2. manual settlement instructions are returned from platform config rather than hardcoded in logic
3. tenant can mark the settlement as submitted
4. admin can review and approve the intent
5. approval writes both intent settlement state and tenant entitlement state
6. the flow does not mark the tenant as having an electronic gateway for public commerce

## Acceptance criteria for `CHK-R135`

`CHK-R135` is done when:

1. the billing pane exposes the `tours_pro` membership flow end to end
2. a tenant can complete the manual settlement submission path without Stripe
3. admin approval activates `tours_pro` membership cleanly
4. existing publish/commercial policy still behaves correctly after activation

## Deferred follow-up after phase 1

- add proof upload to billing intents
- add proof-backed and richer review completion for `hotel_pro` and `all_in_one` on the same core
- add Stripe as a plugin on the new core
- add optional `test_fake` internal provider with guardrails
- add richer admin reconciliation and history views

## Files most likely touched in implementation

- `db/migrations/...membership_billing_intents.sql`
- `src/lib/membershipBilling.js`
- `src/routes/membershipBilling.js`
- `src/routes/admin.js`
- `src/index.js`
- `public/dashboard.html`
- `src/lib/productTiers.js`
- `docs/ai/03A_PROGRESS_LEDGER_TOUR_PLATFORM.md`
- `docs/ai/01_CURRENT_STATE.md`
- `docs/ai/56_MEMBERSHIP_SETTLEMENT_PHASE1_CODE_PLAN.md`
