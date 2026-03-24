# PRODUCT MODEL (SOURCE OF TRUTH)

## System Type
Multi-tenant SaaS platform for travel agents (Vietnam-first).

## Positioning
- NOT a marketplace
- NOT an OTA
- Platform provides:
  - Tour creation tools
  - Booking & operations management
  - Publishing infrastructure

## Core Layers


### 1. SaaS Tour Builder
- Tour_stops (canonical itinerary segments, each may reference a catalog destination)
- Service items (5 groups, linked to tour_stop_id)
- Itinerary composer
- Pricing + visual configuration (tenant_seasons, pricing_segments, pax_bands, tour_prices)
- Multilingual website content per tenant/tour
- Day-1 operational emphasis: pickup + welcome flow

### 2. Booking & Operations Engine
- Booking creation
- Service-based task generation
- Communication threads per service item
- Timeline logging
- Tenant calendar synchronization for operational todos


## Operations model clarification

- Service mini-cards are not just content blocks; they evolve into operational todos/tasks.
- Most service todo fields should be auto-filled from tour and tour_stop schedule context.
- Example:
  - set tour start date
  - auto-create Day-1 pickup + welcome todos
  - set tour_stop order and nights
  - derive accommodation check-in/check-out automatically
  - derive meal dates/times, guide windows, and transport timing defaults automatically

## Calendar + reminder clarification

- From the day a tour is booked, operational todos should be synced to tenant calendar channels.
- Calendar delivery targets:
  - Google Calendar direct integration
  - iPhone Calendar-compatible feed/integration path (ICS/webcal compatible)
- Reminder cadence for remaining tasks not yet confirmed:
  - monthly reminder while task is still open
  - additional reminders at 14 days, 7 days, and 3 days before due date
- Reminder cadence applies only while task state is not confirmed/completed.


## Required service data

Each service item / todo should carry at minimum:
- tour_stop_id (canonical linkage)
- person in charge
- provider / venue name
- contact person
- email
- phone or messaging contact
- address
- notes
- stage/status ticks: contacted, pending, confirmed, cancelled

## Communication model clarification

- Communication should support multiple channels:
  - email
  - Zalo
  - Messenger
  - SMS
- Logs should be consolidated directly at the task / service operation level, not scattered across separate disconnected UI surfaces.
- Task and communication views should feel like one operational timeline.

### 3. Commerce Layer
- Agents sell tours under their own domain
- Platform does NOT sell tours directly
- Platform does NOT own customers

### 4. Distribution & Growth Layer
- SEO foundation (meta, sitemap, schema)
- Social distribution (Facebook, Zalo, WhatsApp)
- Trust layer (reviews, badges)
- Analytics (GA/Pixel/events)
- Lead capture (contact, chat-first channels)


## Revenue Model

### Subscription
- Free trial: 6 months
- After trial: 9.98 EUR/month

### Commission
- Applied when agent revenue exceeds threshold
- Rate: 5%–10%

## Payment Responsibility

- Customer → pays Agent directly
- Platform:
  - tracks booking value

> NOTE: Legacy "destination" logic is retained for business intent but is not canonical for itinerary modeling. All operational service items must reference tour_stop_id.

> Pricing model upgrade: Flat season/pax fields are deprecated. Canonical pricing now uses tenant_seasons, pricing_segments, pax_bands, and tour_prices.

> AI doc control: Do not assume legacy-doc completion is canonical for itinerary or pricing; always check for tour_stops and new pricing model.
  - calculates commission
  - charges subscription

## Multi-tenancy
- Every entity must include `tenant_id`
- Data isolation is mandatory