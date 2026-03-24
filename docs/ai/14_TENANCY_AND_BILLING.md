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