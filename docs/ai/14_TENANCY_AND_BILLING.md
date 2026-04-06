> **RUNTIME NOTE:**
> This file describes the **TARGET DESIGN** for the Tenancy and Billing module. The current rescue runtime does **NOT** implement these flows yet. Actual implemented slices are listed in 01_CURRENT_STATE.md.

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

# TENANCY AND BILLING

## Tenant

- Created on signup
- Tenant is the business / subscription / contract boundary
- A tenant is not limited to one person

## Membership

- Users belong to tenant
- Staff access should be modeled as tenant memberships / seats, not as separate tenants
- Roles (future):
  - owner
  - staff

## Staff seats

- Staff login is planned as an add-on / seat model under the tenant
- This rule should apply for both travel businesses and future property businesses
- Future property staff should still authenticate as tenant users, then receive property-scoped assignments/permissions instead of becoming separate tenants

## Trial

- Starts at signup
- Duration: 6 months

## Subscription

- Activated after trial
- Monthly billing

## Restrictions

If unpaid:
- disable publish
- restrict new bookings

## Runtime baseline

- billing standing is stored per tenant
- `subscription_status` is currently one of:
  - `trialing`
  - `active`
  - `unpaid`
- if trial expires without active subscription, tenant is treated as billing-blocked for publish and new bookings

## Billing Scope

- subscription fee
- commission tracking

## Storefront currency direction

- Tenant storefront currency must follow the tenant's commercial reality, not the SaaS platform's internal billing assumptions
- The tenant should eventually control one authoritative booking / charging currency for end-customer bookings
- Currency conversion and secondary display are support layers, not the source of truth

## Market skin direction

- Tenants serving different niche markets need default skins aligned to those markets
- Code stays English-first internally
- Tenant-facing locale, currency defaults, booking microcopy, and skin defaults should be bundled by market-oriented presets
- Automatic translation may assist drafting, but curated locale packs remain the preferred default for real tenant-facing skins

## NOT included

- customer payment processing