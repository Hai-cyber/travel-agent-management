# MEMBERSHIP SETTLEMENT AND PROVIDER MODEL

> RUNTIME NOTE:
> This document defines the approved target design for tenant membership settlement and provider abstraction.
> The current rescue runtime now implements the phase-1 baseline of this model: shared membership intents, manual-bank-transfer settlement, admin approval, and tier-aware billing-pane routing.
> Actual implemented route/UI/runtime truth still lives in `01_CURRENT_STATE.md`.

## Purpose

This document defines how the platform should complete tenant membership activation for:

- `tours_pro`
- `hotel_pro`
- `all_in_one`

without making Stripe, Lemon, or any single payment provider the architectural center of the system.

## Core rule

Tenant membership settlement and end-customer commerce must be treated as two different problems.

### Tenant membership settlement

This is how the tenant pays the platform for product access.

Examples:

- manual bank transfer
- Wise transfer instructions
- PayPal manual request
- Stripe subscription checkout
- future local provider or invoicing workflow

### End-customer commerce

This is how the tenant accepts money from their own guests and buyers.

Examples:

- Stripe
- PayPal
- MoMo
- VNPay
- ZaloPay
- GrabPay

The two layers may use different providers and must not be collapsed into one assumption.

## Non-negotiable policy boundary

Completing tenant membership does not by itself unlock public commerce.

The platform must keep these states separate:

- `membership active` = the tenant has paid or been approved for the platform plan
- `electronic gateway configured` = the tenant has configured at least one real electronic payment method for end-customer commerce

This preserves the existing commercial policy:

- platform-owned surfaces remain showcase-only
- verified custom domains remain the commercial surface
- manual-only methods do not count as electronic gateway activation

## Runtime status

Current rescue runtime now ships this subset:

- `membership_billing_intents` as the operational source of truth for tenant membership settlement
- manual-bank-transfer settlement instructions sourced from env or `app_settings`
- tenant routes for create/current/mark-submitted
- admin review routes for approve/reject/void
- tenant entitlement activation after approval
- billing-pane target selection for:
	- `starter_landing -> tour_operator_pro`
	- `starter_landing -> hotel_operator_pro`
	- `starter_landing -> tour_hotel_suite`
	- `tour_operator_pro -> tour_hotel_suite`
	- `hotel_operator_pro -> tour_hotel_suite`

Current runtime does not yet ship:

- proof upload on membership intents
- non-manual provider plugins
- Stripe migrated into the same provider contract layer
- a claim that membership activation alone unlocks guest commerce

## Approved architecture direction

The platform should move to a provider-agnostic membership settlement model.

### Shared billing core

The shared billing core should own:

- membership intent creation
- tier/plan resolution
- settlement status transitions
- proof-of-payment handling
- approval and audit trail
- activation of tenant membership after settlement

The shared billing core should not assume Stripe objects as its source of truth.

### Provider plugin layer

Membership providers should behave as plugins.

Initial provider direction:

- `manual_bank_transfer`
- `wise_manual`
- `paypal_manual`
- `stripe`
- `test_fake`

The first shippable release does not need all of them implemented at once.

## Provider contract

Each membership provider should expose one common behavioral contract.

Suggested contract:

- `createIntent()`
- `getActionPayload()`
- `verifyWebhook()` when applicable
- `acceptProofUpload()` when applicable
- `reconcile()` for manual settlement review
- `cancelIntent()` when applicable
- `capabilities()`

The UI should not care whether the provider is Stripe, Wise-style manual transfer, or a later provider.

The UI should only react to the provider response mode.

## Response modes for billing UI

The tenant billing UI should support these modes:

- `redirect_checkout`
- `show_manual_instructions`
- `awaiting_proof`
- `awaiting_review`
- `settled`
- `failed`

This keeps the flow stable even when the provider changes.

## Membership settlement source of truth

The system should add a dedicated membership-settlement record rather than using `tenants.subscription_status` alone as the operational record.

Suggested source-of-truth entity:

- `membership_billing_intents`

Suggested fields:

- `id`
- `tenant_id`
- `product_tier_key`
- `provider_key`
- `status`
- `amount`
- `currency`
- `reference_code`
- `instructions_json`
- `proof_asset_key`
- `provider_session_id`
- `provider_reference`
- `requested_at`
- `expires_at`
- `submitted_at`
- `reviewed_at`
- `reviewed_by`
- `review_note`
- `settled_at`
- `meta_json`

`tenants.subscription_status` remains the entitlement output, not the complete settlement history.

## Status model

Target status flow:

- `draft`
- `awaiting_payment`
- `awaiting_proof`
- `under_review`
- `settled`
- `failed`
- `expired`
- `void`

Only `settled` may activate or renew membership.

Current runtime note:

- runtime currently uses `awaiting_review` instead of `under_review`
- runtime does not currently use `draft` or `awaiting_proof`

## Manual settlement baseline

The first non-provider-dependent ship path should be manual settlement.

Current minimum shipped flow:

1. tenant selects an allowed target tier from the upgrade matrix
2. platform creates a membership billing intent
3. system returns transfer instructions plus a required `reference_code`
4. tenant clicks `I have paid`
5. admin reviews the settlement
6. approved settlement moves intent to `settled`
7. tenant membership is activated

This path is the fallback that prevents the business from being blocked by Stripe, Lemon, or jurisdiction timing.

## Wise and PayPal position

Wise and PayPal manual flows should be treated as settlement channels, not as architectural truth.

That means:

- account instructions should come from platform config, not hardcoded product logic
- the flow should still create a billing intent and reference code
- the approval trail should still be internal to the platform

The system must be able to swap from Wise to PayPal or another manual channel without redesigning the billing flow.

## Test provider rule

`test_fake` is allowed only as an internal support and sandbox tool.

It must be restricted to:

- local development
- explicit internal/admin use
- allowlisted tenants
- promo/testing scenarios with audit trail

It must not become the production default path for normal external signups.

## Product-tier completion rule

The platform should treat membership completion as a tier-specific productization milestone.

### `tours_pro`

Done when a tenant can:

- choose `tours_pro`
- receive a membership billing intent
- complete or submit settlement through a provider-agnostic flow
- be activated into the tier without Stripe being mandatory

### `hotel_pro`

Done when the same membership flow works for the hotel package and cleanly activates hotel access without inventing a separate hotel-only billing architecture.

### `all_in_one`

Done when the same membership flow can activate the combined suite as one deliberate platform membership, not two independent subscriptions glued together.

## Tier-access UX rule

Tenant-admin surfaces should be tier-aware even before upgrade.

Runtime policy now implemented:

- `starter_landing` may view the workspace shell and website editor surfaces
- `starter_landing` must be softly blocked from operational tour/hotel features and routed into the billing pane with an upgrade notice
- `tour_operator_pro` may use tour-business surfaces and should be softly blocked from hotel/property surfaces unless upgraded to suite
- `hotel_operator_pro` may use hotel/property surfaces and should be softly blocked from tour-business surfaces unless upgraded to suite
- `tour_hotel_suite` may use both sides

This is a UX rule, not only a backend entitlement rule.

## Phase-based ship order

### Phase 1

- add shared membership billing intent model
- add manual settlement provider
- add admin approval flow
- activate `tours_pro` through the new path
- implementation spec is recorded in `55_MEMBERSHIP_SETTLEMENT_PHASE1_IMPLEMENTATION_SPEC.md`

### Phase 2

- complete product polish for `hotel_pro`
- complete product polish for `all_in_one`
- expose full tier-aware billing UI copy, status, and proof handling

### Phase 3

- move Stripe into the provider plugin layer instead of keeping it as the only assumed billing runtime
- optionally add additional providers later

## Checkpoint routing

This track belongs to the shared platform ledger, not the property-only ledger, because:

- membership settlement is a tenant/platform capability
- the same billing core must serve `tours_pro`, `hotel_pro`, and `all_in_one`
- hotel package activation depends on shared membership architecture, not only on hotel runtime features

## Companion docs

- `01_CURRENT_STATE.md`
- `03A_PROGRESS_LEDGER_TOUR_PLATFORM.md`
- `38_PLATFORM_PACKAGING_AND_TIERS.md`
- `53_HOTEL_PRODUCT_PACKAGE.md`
- `55_MEMBERSHIP_SETTLEMENT_PHASE1_IMPLEMENTATION_SPEC.md`
- `56_MEMBERSHIP_SETTLEMENT_PHASE1_CODE_PLAN.md`
