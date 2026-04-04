# PRICING DISPLAY POLICY

> Scope:
> This policy governs how tour pricing is displayed across storefront, preview, and synced universal page payloads.
> It intentionally does **not** introduce FX conversion.

## Decision summary

Until a real FX engine exists, the platform uses:

- **canonical pricing amounts** from `tour_prices`
- **canonical source currency** from `tour_prices.base_currency`
- **format-only display** in UI
- **no automatic conversion** based on tenant `exchange_rate`

This is the approved safety rule for the current rescue runtime.

## Current invariant

1. `tour_prices` is the source of truth for numeric price amounts.
2. `tour_prices.base_currency` is the source of truth for the currency of those amounts.
3. `tenant.target_currency` is **not** permission to relabel or convert those amounts by itself.
4. If a surface cannot prove a valid converted amount exists, it must display the original amount in its original currency.

## What storefronts may do now

- format a canonical amount using the amount's currency
- fall back to tenant `base_currency` only when the amount-level currency field is missing
- show `price_from`, `Shared`, `Single`, and other synced card values using the same shared formatter

## What storefronts may NOT do now

- must not hardcode `$`
- must not build strings like `From $500` directly in template/theme code
- must not reinterpret a USD amount as EUR just because tenant settings say `EUR`
- must not multiply display values by `exchange_rate` unless a real FX policy is implemented end-to-end

## Synced payload contract

Universal synced pricing payloads must carry currency with the amount.

Minimum required fields:

- `price_from`
- `price_from_currency`
- `pricing_base_currency`
- `pricing_display_currency`
- `pricing_display_policy`

For each pricing card:

- `adult_shared_room_price`
- `adult_shared_room_price_currency`
- `adult_single_room_price`
- `adult_single_room_price_currency`
- `child_shared_with_parents_price`
- `child_shared_with_parents_price_currency`

## Shared formatter rule

All storefront displays must go through one shared formatting path.

Current approved behavior:

- prefer the explicit currency carried with the amount
- otherwise fall back to tenant `base_currency`
- only fall back to another display currency when no canonical currency exists

## Audit focus completed

Targeted audit confirmed pricing display risk concentrated in these paths:

- `src/routes/universalSites.js`
- `src/lib/universalSiteSync.js`
- `public/tour-booking-view.js`

The main historical failure mode was template-level money rendering that hardcoded `$` or printed raw numeric values without carrying a currency field alongside them.

## Deferred future work

Do not start FX conversion until all of the following are defined:

- FX rate source
- FX lock timestamp
- rounding policy per currency
- order/booking settlement currency
- snapshot persistence of converted amount plus rate metadata

Until then, the correct system behavior is:

**format canonical money correctly, but do not convert it.**