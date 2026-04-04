# PROPERTY ENGINE AND STAFF SEATS

> RUNTIME NOTE:
> This document records the **approved architectural direction** for the post-tour expansion into standalone hotel/property operations.
> The current rescue runtime does **not** implement the property engine yet.
> Actual implemented runtime slices remain listed in `01_CURRENT_STATE.md`.

## Decision summary

The system now treats two concepts as deliberately separate:

1. `stop_accommodation`
- a tour-side accommodation/service item
- belongs to a `tour_stop`
- part of the tour product / itinerary / operations context
- not a standalone hospitality business engine

2. `property`
- a standalone hospitality business entity
- future basis for hotel/resort/villa/lodge operations
- will own its own availability, reservation, inventory, POS, staff, and operational flows

This separation is intentional and should not be collapsed back into one generic `hotel` concept.

## Canonical naming map

### Tour side
- `tour`
- `tour_stop`
- `stop_accommodation`

### Standalone hospitality side
- `property`
- `property_reservation`
- `property_inventory`
- `property_staff`

## Why this split is required

Tour accommodation and standalone hotel/property operations look similar in UI, but they are different domains.

### Tour-side accommodation
- tied to itinerary
- tied to tour schedule and service operations
- does not own room inventory
- does not own property-level POS
- does not need independent staff login or front-desk workflows

### Property-side business engine
- owns room/rate/inventory logic
- owns reservation lifecycle
- may own POS/front-desk/housekeeping workflows
- may need staff login, seat management, and scoped permissions

Using one model for both would create avoidable overlap and make later expansion much harder.

## Staff login decision

Staff login is approved as an **add-on / seat model**, not as a separate tenant.

### Tenant principle
- `tenant` is the business / contract / subscription boundary
- a tenant is not “one person”
- a tenant may have an owner plus multiple staff users

### Staff principle
- staff are `users` with `memberships` and scoped permissions
- staff do not become separate tenants
- staff seats can be priced as add-ons under the tenant subscription

This rule is intended to hold for both travel businesses and future property businesses.

## Access model direction

### Core identity layer
- `user`
- `membership`
- `auth_session`

### Tenant-level roles
- `owner`
- `billing_admin`
- `manager`
- `staff`

### Future property-level roles
- `property_admin`
- `reservation_agent`
- `front_desk`
- `housekeeping_manager`
- `fnb_manager`

Property-level roles should be scoped by assignment rather than by creating new tenants.

## Migration-safe direction

### What stays unchanged now
- canonical tour pricing engine remains tour-specific
- current tour booking flow remains intact
- current `stop_accommodation` flows remain tour-side only
- current `tenant_universal_hotels` table remains transitional storefront/runtime support, not the canonical property engine

### What should be added later
- standalone `property` family tables
- standalone reservation/availability/inventory flows for `property`
- property staff assignment tables
- property-scoped operational permissions

### What should NOT be done
- do not force hotels/properties into the current tour pricing model
- do not create a generic `entity_prices` table prematurely
- do not treat staff as separate tenants
- do not rename `stop_accommodation` into `hotel`

## Transitional status of current hotel UI/runtime

Current “hotel” editing in universal/admin flows should be understood as **presentation/runtime support** for tour-linked accommodation storytelling, not as the finished hospitality engine.

Until the new property engine exists:
- `Hotels` UI is transitional
- tour-linked accommodation remains valid and useful
- standalone hospitality operations are future work

## Recommended next architectural slice

When implementation starts, prefer this order:

1. Lock naming and access model first
2. Add property domain schema family without touching tour pricing
3. Add property staff seat + assignment model
4. Add property availability / reservation engine
5. Only then connect `Check availability` for property entities to the new engine

This sequence minimizes regression risk while preserving clean separation.