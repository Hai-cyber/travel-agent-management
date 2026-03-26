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
- Each agent = 1 tenant

## Membership

- Users belong to tenant
- Roles (future):
  - owner
  - staff

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

## NOT included

- customer payment processing