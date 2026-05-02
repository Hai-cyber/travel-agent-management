# PROPERTY STAFF AUTHORIZATION MODEL

> RUNTIME NOTE:
> This document records the approved staff authorization direction for `NEXT-P19`.
> It is a policy and backend-enforcement document, not proof that the full role-aware property authorization model already exists in runtime.
> Actual implemented slices must still be verified in `01_CURRENT_STATE.md`.

## Purpose

This document defines how property-engine access should move beyond the current tenant-admin-heavy gate.

Its purpose is to ensure hotel/property operations can be run by a real team instead of one all-powerful tenant session.

## Current problem

The current rescue runtime already has useful authenticated property flows.

But most of them still collapse into coarse access patterns such as:

- `requireTenantActor`
- `requireManagerActor`

This is enough for development and internal demo slices.
It is not enough for a real hotel operating team.

## Core rule

Property authorization must be:

- role-aware
- property-scoped
- backend-enforced
- compatible with the existing tenant + membership model

Do not treat UI hiding as permission control.

## Identity and scope rule

The tenant remains the contract boundary.
Property staff remain users within the tenant.

That means:

- staff do not become separate tenants
- staff are still `users` with `memberships`
- property permissions should be granted by property-scoped assignment, not by inventing a second identity system

## Recommended role model

The first operational role model should stay compact.

### Tenant-level roles already relevant

- `owner`
- `billing_admin`
- `manager`
- `staff`

These remain useful, but they are too broad to express hotel operations safely on their own.

### Property-level roles for the first hotel runtime

- `property_admin`
- `reservation_agent`
- `front_desk`
- `housekeeping`

Optional later roles:

- `housekeeping_manager`
- `fnb_manager`
- `night_auditor`

The first implementation should avoid over-fragmentation, but it must be stronger than one shared tenant-admin gate.

## Permission groups

The first model should group permissions by operational domain.

### 1. Property configuration

Examples:

- edit property settings
- edit room types
- edit room units
- edit pricing configuration
- edit policy configuration

Default access:

- `property_admin`
- tenant `owner` / `manager`

Not for:

- `front_desk`
- `housekeeping`

### 2. Reservation operations

Examples:

- create reservation
- patch guest profile fields
- rebook / cancel / no-show
- check-in / check-out
- assign room

Default access:

- `property_admin`
- `reservation_agent`
- `front_desk`

### 3. Housekeeping operations

Examples:

- view housekeeping board
- update housekeeping task status
- update room flags tied to housekeeping workflow
- transition room state when allowed by policy

Default access:

- `property_admin`
- `housekeeping`
- optionally `front_desk` for selected non-destructive updates

### 4. Folio and settlement operations

Examples:

- add folio line
- record folio payment
- settle folio
- run night-audit-adjacent actions

Default access:

- `property_admin`
- `front_desk`
- `reservation_agent` only where policy explicitly allows it

### 5. B2B / allotment operations

Examples:

- create/edit allotments
- release blocks
- rework confirmed blocks
- manage rooming execution
- adjust operator charge routing

Default access:

- `property_admin`
- tenant `manager`

This domain should remain tighter because it changes inventory and commercial commitments materially.

## Minimum role expectations

### `property_admin`

Can:

- configure property runtime
- manage pricing and allotments
- manage reservations
- manage folios
- manage housekeeping board

### `reservation_agent`

Can:

- create and edit reservations
- manage guest-facing reservation lifecycle actions
- inspect pricing outputs

Cannot by default:

- change pricing configuration
- change property inventory configuration
- run sensitive allotment rework

### `front_desk`

Can:

- check in / check out guests
- assign rooms
- post folio charges/payments within allowed policy
- inspect arrivals/departures/board views

Cannot by default:

- edit pricing configuration
- edit structural property setup

### `housekeeping`

Can:

- work housekeeping tasks
- update room operational workflow states that are housekeeping-owned
- inspect room/task context needed to complete the job

Cannot by default:

- edit pricing
- mutate reservation commercial data
- release or rework B2B blocks

## Backend enforcement rule

Every sensitive route must enforce the permission boundary in backend logic.

Examples:

- pricing routes must not rely on hidden UI controls
- housekeeping transitions must not assume only admins can reach the endpoint
- folio posting must not be open to every authenticated tenant user automatically

The real check belongs in the request handler or shared auth guard.

## Property scoping rule

Authorization must be property-scoped where appropriate.

That means a staff user may:

- have access to one property but not another within the same tenant
- have different property roles at different properties

Do not assume one tenant role automatically grants the same property permissions everywhere once multi-property operation matters.

## Transitional implementation rule

The first hardening pass does not need the final perfect matrix.

But it must at least achieve this:

- `housekeeping` is no longer effectively tenant-admin by proxy
- `front_desk` can run desk operations without owning pricing/admin powers
- pricing/allotment configuration remains manager/admin scoped
- backend handlers enforce the distinction

## Suggested first enforcement sequence

To reduce risk, harden in this order:

1. housekeeping routes
2. reservation lifecycle routes
3. folio posting/payment routes
4. pricing configuration routes
5. allotment/B2B routes

This follows the operational impact while keeping the permission model incremental.

## Audit expectations

Where operationally meaningful, role-sensitive actions should preserve actor context.

Examples:

- check-in / check-out
- room-state changes
- folio payments
- allotment release or rework

This is not just for debugging.
It is part of property operational accountability.

## Relationship to current runtime

The current runtime already contains early signals of role-aware handling in selected paths, such as housekeeping state transitions using role ranking.

But the broader property engine still does not have a complete actor-aware authorization model.

This checkpoint should turn that scattered behavior into one deliberate, documented system.

## Required implementation outputs for `NEXT-P19`

The checkpoint should not be considered complete until all of these are decided:

- first property role set
- permission groups by operational domain
- backend enforcement rule
- property-scoped assignment rule
- first hardening sequence across route families

## Non-goals for this checkpoint

- full billing-seat commercialization
- final HR/staff scheduling system
- generic cross-product RBAC framework redesign for the whole SaaS

This checkpoint is about practical property authorization hardening first.