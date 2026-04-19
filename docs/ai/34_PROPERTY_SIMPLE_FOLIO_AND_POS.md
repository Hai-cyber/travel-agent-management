# PROPERTY SIMPLE FOLIO AND POS

> RUNTIME NOTE:
> This document records the approved target direction for the property's simple folio/POS layer.
> The current rescue runtime does **not** implement this module yet.

## Purpose

This document defines the first commercial folio/POS layer for the future property engine.

The goal is not to build a full restaurant or outlet POS.
The goal is to ship a simple, operationally useful billing layer that lets properties:

- derive core charges from bookings
- add manual charges when needed
- record payments cleanly
- settle balances at check-out
- preserve a clear audit trail

## Core principle

The first version should be a **folio engine first**, not a full POS engine.

This means:

- booking is the main source of charges
- manual posting is supported
- payment collection is supported
- checkout settlement is supported
- outlet workflows are not the initial focus

## Why folio-first is the right v1 boundary

This approach is simple to ship and commercially strong because it covers the most common real property needs:

- room charges
- add-ons
- incidental fees
- payments
- checkout balance

It avoids the complexity of:

- table service
- kitchen routing
- receipt printers by outlet
- multi-outlet revenue centers
- kitchen/bar/floor-service workflows

## Canonical objects

The folio/POS layer should start from these concepts.

- `folio`
- `folio_line`
- `payment_record`
- `adjustment_record`
- `checkout_summary`

The reservation remains the anchor.

The folio exists because of the stay, not the other way around.

## Relationship to reservation

Every confirmed reservation should be able to own one primary folio.

### Default rule
- one reservation -> one primary folio

### Later expansion
- multiple folios per reservation
- split folio by room / guest / company

That should be deferred until the single-folio model is stable.

## What the first folio must support

### Charges
- room charge
- manual service/add-on charge
- tax/service fee if applicable
- discount/adjustment

### Payments
- online payment
- cash
- card (manual capture record)
- bank transfer
- OTA collected / external collected flag

### Checkout
- current balance
- paid amount
- remaining due
- settlement confirmation

## Charge sources

The first version should explicitly distinguish the origin of every folio line.

### 1. Booking-derived charges
- nightly room charge
- booked package/add-on tied to reservation

### 2. Manual charges
- tour add-ons sold by the same tenant
- food and beverage
- minibar
- laundry
- airport transfer
- extra bed
- breakfast added manually
- misc service charge

### 3. Adjustments
- discount
- waiver
- refund
- correction

The system should never blur these sources together.

### Operational rule
For v1, these add-on services should be manually posted by front desk or authorized staff.

This includes services such as:

- tours
- meals / food and beverage
- laundry
- airport transfer
- other incidental hospitality services

## Canonical folio line model

Each `folio_line` should support:

- `id`
- `folio_id`
- `line_type`
- `source_type`
- `description`
- `quantity`
- `unit_amount`
- `total_amount`
- `currency`
- `tax_code` or `tax_snapshot` if needed later
- `status`
- `posted_at`
- `posted_by`

### Suggested `line_type`
- `room_charge`
- `service_charge`
- `fee`
- `discount`
- `refund`
- `payment_applied` (optional derived representation only)

### Suggested `source_type`
- `reservation_system`
- `manual_frontdesk`
- `manual_manager`
- `imported`

## Payment record model

Payments should not be hidden inside folio lines as the source of truth.

They should be stored as canonical payment records.

Each `payment_record` should support:

- `id`
- `folio_id`
- `payment_method`
- `amount`
- `currency`
- `status`
- `external_ref`
- `received_at`
- `received_by`
- `notes`

### Suggested `payment_method`
- `online_gateway`
- `cash`
- `card_manual`
- `bank_transfer`
- `ota_collected`

### Suggested `status`
- `pending`
- `recorded`
- `voided`
- `refunded`

## OTA / external collection handling

The folio engine must support reservations where the property does not collect the main room payment directly.

Examples:

- OTA prepaid booking
- external agency collected amount

This should be represented explicitly, not improvised in notes.

### Practical rule
- the folio may contain room charges
- the payment side may show `ota_collected`
- front desk still needs to see whether extras remain payable on-site

## Checkout summary

The first checkout flow should be simple and explicit.

It should show:

- total charges
- total payments
- current balance
- extra charges posted today
- whether settlement is complete

### Checkout actions
- post final manual charge
- record payment
- mark folio settled
- continue with check-out

## Unified invoice direction for tenants with hotel + tour business

If the same tenant operates both hotel/property and tour products, the platform should support a future-friendly path to unified billing.

### Principle
- hotel stay remains the anchor for lodging folio
- tour services can be posted as add-on folio lines when the guest is also a hotel guest
- unified invoice should be optional, not forced for every tenant

### Early-direction rule
The first version does not need a full cross-domain billing engine.
But the folio model should not block a later option where:

- room charges
- hotel add-ons
- tour add-ons

can appear on one guest-facing invoice under the same tenant.

### Practical v1 implication
- `tour` should be a valid manual add-on/service category in folio posting
- unified invoice can initially be operational/manual rather than fully automated

## Connection to reservation lifecycle

The folio should evolve alongside the reservation.

### Confirmed reservation
- folio can be created immediately or lazily on first posting

### Checked-in reservation
- folio becomes operationally active

### Checked-out reservation
- folio should normally be settled or clearly flagged as unpaid/partially paid

### Cancelled reservation
- folio may require cancellation fees, refunds, or zeroing logic depending on policy

## Adjustments and corrections

The first version must support safe manual correction.

### Do not
- rewrite old amounts invisibly

### Do
- add reversal or adjustment records
- keep an audit trail of who changed what

This keeps folio history trustworthy.

## Minimum audit expectations

The folio/POS layer should retain auditability for:

- manual charge posting
- discount/waiver
- payment recording
- payment void/refund
- final settlement

Early versions do not need a full accounting ledger, but they do need an operationally credible history.

## Posting UX rules

Manual posting should be fast.

The UI should require only:

- description
- amount
- optional quantity
- category/type
- notes if needed

Suggested early categories:

- room
- tour
- food_beverage
- laundry
- airport_transfer
- misc

Do not force a complex accounting chart in v1.

## Pricing and tax boundary

The folio/POS layer should consume pricing truth from the reservation/booking engine, not redefine it.

### Rule
- room pricing comes from reservation snapshot
- folio posts and displays charges
- folio does not become the canonical room pricing engine

This avoids coupling the billing layer too tightly to future rate logic.

## What the first version is not

The first version should not attempt to become:

- a restaurant POS
- a bar POS
- a kitchen order system
- a general retail POS
- a full accounting ledger

If outlet POS becomes necessary later, it should be added as a separate module or a more specialized expansion of the folio layer.

## Recommended v1 implementation order

1. create canonical folio per reservation
2. post booking-derived room charges
3. add manual charge posting
4. add payment recording
5. add checkout summary and settlement state
6. add correction/adjustment records

## Future expansion paths

After the simple folio/POS is stable, the natural next steps are:

- multiple folios per reservation
- company billing / split folios
- outlet posting into folio
- tax invoice/export logic
- daily cashier close reports
- accounting export integrations

## Companion docs

- `30_PROPERTY_ENGINE_OVERVIEW.md` — overall property engine scope
- `31_PROPERTY_AVAILABILITY_AND_ALLOCATION.md` — availability and stay-plan rules
- `32_PROPERTY_RESERVATION_INTAKE_AND_BOOKING_SOURCES.md` — reservation intake model
- `33_PROPERTY_OPERATIONS_APP.md` — room map, housekeeping, maintenance, and operational workflows