#
> RUNTIME NOTE: This document describes TARGET DESIGN for this module.
> The current rescue runtime does NOT implement these flows yet. Actual implemented slices are listed in 01_CURRENT_STATE.md.
#
You are updating this markdown file to clearly mark it as TARGET DESIGN only.

Source of truth:
- 01_CURRENT_STATE.md

Rules:
- This module (monetization/domain/publish/billing/site studio/growth/mobile/CRM/supplier/communications) is NOT implemented in the current rescue runtime.
- This document should be kept as product/architecture intent, not runtime truth.

Task:
1. Add a "RUNTIME NOTE" near the top saying:
   - this file describes TARGET DESIGN for this module
   - the current rescue runtime does NOT implement these flows yet
   - actual implemented slices are listed in 01_CURRENT_STATE.md.
2. Do NOT change the rest of the content. Just add the note.

# MONETIZATION LOGIC

## Subscription

- Free trial: 6 months
- After trial: 9.98 EUR/month

## Payment Methods (Agent → Platform)

- Credit card
- PayPal

## Commission

- Trigger:
  - agent revenue exceeds threshold (e.g. 5,000,000 VND/month)
- Rate:
  - 5%–10% (configurable)

## Revenue Tracking

- Platform does NOT process customer payments
- Platform records:
  - booking value
  - revenue per agent


## Pricing model upgrade
- Canonical pricing uses tenant_seasons, pricing_segments, pax_bands, and tour_prices. Flat season/pax fields are deprecated.

## TODO

- Define billing provider
- Define commission calculation job
- Define invoice generation

## Commercial packaging direction

The platform should support modular packaging rather than one oversized enterprise bundle.

Suggested direction:

- Tour Suite
- Hotel Suite
- Tour + Hotel Suite

### Tier 4

Tier 4 should be the combined `tour + hotel suite` tier.

This tier is for tenants who operate both:

- tours / experiences
- lodging / hotel / villa / stay operations

It should be treated as a combined suite under one product umbrella, not as two unrelated subscriptions glued together.

### Important rule

Even in Tier 4, the platform should still be sold as a lightweight SME operating system, not as a full ERP promise.