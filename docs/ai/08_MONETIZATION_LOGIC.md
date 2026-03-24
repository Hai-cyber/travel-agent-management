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