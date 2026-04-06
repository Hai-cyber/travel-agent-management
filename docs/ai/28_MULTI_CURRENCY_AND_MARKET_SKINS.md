# Multi-Currency And Market Skins

Status: target direction with runtime slices now present for tenant booking-currency settings, market-skin catalogs, and quote/order currency snapshots.

## Why this exists

The product is a white-label SaaS for travel businesses.
Tenant storefront money logic must follow the tenant's commercial reality, not the SaaS platform's internal billing assumptions.

That means:
- the platform may bill the tenant in one currency
- the tenant may sell to end customers in another currency
- storefront language / skin defaults must follow the tenant's target market
- any non-authoritative mirror currency must be explicitly treated as a secondary display currency, not as booking truth

## Locked product direction

### 1. Code stays in English
- database columns
- API contracts
- business logic
- internal admin logic

English remains the canonical source language for code and product strings.

### 2. Tenant controls storefront money
- the tenant decides what currency they collect from end customers
- SaaS may assist with conversion and display, but must not force USD storefront charging
- quote/order truth must eventually be locked to one authoritative tenant booking currency

### 3. Curated market basket first
The product should not open with every ISO-4217 currency or every locale.
Start with a curated basket aligned to the current travel markets:

- USD
- EUR
- VND
- CNY
- JPY
- KRW
- GBP
- AUD
- SGD
- THB

### 4. Skin is not just color
A market-facing skin is a bundle of:
- theme visual defaults
- locale defaults
- currency defaults
- booking microcopy defaults
- typography and formatting defaults

### 5. Auto-translation is secondary
Automatic translation can help draft content, but it must not become the canonical source of product-facing copy.
Canonical source remains English, with curated locale packs layered on top.

## Runtime reality today

Current rescue runtime is still transitional:
- pricing rows still retain `base_currency` and some compatibility helpers still expose legacy USD-oriented fields
- `target_currency` is now explicitly treated as secondary display currency storage, while `booking_currency` is the authoritative storefront booking currency
- market skins are now available as curated catalogs/settings, and real locale packs now exist for `ja`, `ko`, `en-GB`, and `en-AU`, but broader storefront copy coverage still remains incomplete

## Runtime slices now present

### Slice 1 — Catalog foundation
- curated tenant currency basket is defined in runtime code
- tenant settings endpoints expose currency and UI-locale catalogs
- target/display currency validation is restricted to the curated basket
- admin pricing UI can already work with the expanded currency basket

### Slice 2 — Tenant booking currency settings
- tenants now have `booking_currency`, `market_skin_key`, and `primary_market`
- tenant settings can update booking currency, default locale, and market skin choice
- curated market-skin presets can suggest locale/currency/theme defaults while still allowing tenant overrides
- `target_currency` is retained only as the storage field for optional secondary display currency

### Slice 3 — Quote/order snapshot semantics
- booking drafts now snapshot quoted amount, quoted currency, quoted base currency, and quoted exchange rate
- booking orders now snapshot authoritative booking amount/currency alongside the legacy USD compatibility field
- pricing calculate responses now publish an authoritative tenant booking-currency amount while keeping older compatibility surfaces during migration

## Planned next slices

### Slice A — Tenant booking currency truth
- introduce authoritative tenant booking currency semantics
- stop relying on USD-centric field naming in booking/order snapshots
- store currency + rate snapshot with quote/order truth

### Slice B — Locale and market preset model
- define market preset / skin bundle model
- add locale-aware default skin packs
- keep code in English while making tenant-facing copy market-specific

### Slice C — FX engine only if needed
- add managed FX snapshots only after authoritative booking-currency semantics are stable
- any FX layer must be quote/order snapshot aware

## Design rule for contributors

Do not implement “currency conversion only” features that deepen the false assumption that storefront truth is always USD.
If a change touches quote, booking, invoice, payment proof, or payment confirmation semantics, treat authoritative tenant booking currency as the target end state.