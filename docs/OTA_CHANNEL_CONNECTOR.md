# OTA Channel Connector — Future Roadmap

**Status:** Not started. Planned after first paying subscriber cohort.

---

## What is an OTA Channel Connector?

**OTA = Online Travel Agency.** Examples: Viator, GetYourGuide, Expedia Experiences, Klook, Booking.com Experiences. These are large consumer marketplaces where travelers browse and book tours. OTAs take 20–30% commission per booking but supply the traffic.

A **channel connector** (also called a channel manager) is the software layer that:

1. **Publishes** your operator's tour inventory (prices, availability, descriptions, photos) to OTA marketplaces automatically
2. **Receives** inbound bookings from those OTAs back into Tours Market
3. **Syncs availability** in real time so the operator cannot be double-booked across multiple platforms simultaneously

Competitors Rezdy, Bokun, and FareHarbor have direct API integrations with Viator and GetYourGuide. When operators use them, their tours appear on those marketplaces with no manual work. This is a significant distribution advantage for operators who rely on OTA traffic.

---

## Why we are not building this now

Our target customer in Phase 1 is the **operator who wants to escape OTA dependency** — they have returning clients, referrals, and group bookings, and they lose 25% commission on every Viator booking. Tours Market's direct-booking storefront is a selling point *against* OTAs for this segment.

The channel connector becomes valuable at **Phase 2**, when operators want to add OTA exposure as an additional channel while keeping direct bookings as the primary revenue stream.

---

## Technical scope

### Per-OTA integrations required

Each OTA has its own supplier API and must be integrated independently:

| OTA | API Name | Priority | Notes |
|---|---|---|---|
| Viator | Viator Connectivity API | High | Largest volume in SEA + EU |
| GetYourGuide | Supplier API | High | Strong EU market |
| Klook | Partner API | Medium | Strong SEA market |
| Expedia | Rapid API (Experiences) | Low | Complex, mostly Western market |
| Booking.com Experiences | Partner API | Low | Smaller experiences share |

### Core capabilities per integration

- **Product sync** — push tour name, description, photos, duration, inclusions/exclusions, meeting point
- **Availability calendar** — push open/closed dates, capacity per date
- **Pricing sync** — push per-person prices by pax tier and season
- **Booking inbound** — receive booking webhook from OTA → create `booking_order` in D1
- **Cancellation sync** — receive cancellation from OTA → update order status
- **Availability lock** — when a booking arrives from any channel, decrement availability across all connected OTAs

### Estimated effort per OTA

- API access approval: **4–12 weeks** (gated, requires existing operator base)
- Technical certification per OTA: **2–4 weeks**
- Integration build: **2–4 weeks** per OTA
- Ongoing maintenance: **~1–2 days/month** per OTA for API version changes

---

## Commercial barriers (the hard part)

1. **API access is gated.** Viator and GetYourGuide do not give supplier API access to new software vendors freely. You must apply as a **connectivity partner** and demonstrate you have an active operator customer base. Bokun was already approved years ago; new applicants face 3–12 month review cycles.

2. **Certification is required.** Each OTA runs a formal technical certification process — automated test suites that verify availability sync correctness, booking handling, cancellation flows, and error recovery. Failure to pass means no live access.

3. **Volume requirements.** Some OTAs require proof of a minimum number of operators or booking volume before granting full connectivity partner status.

---

## Recommended approach (phased)

### Phase 1 — No OTA connector (current)
Focus on direct-booking operators. The anti-OTA narrative is a selling point.

### Phase 2 — Bokun bridge (~50 paying tenants)
**Bokun is already an approved connectivity partner** with Viator, GetYourGuide, and others. They expose a public API (`bokun.io/api`) that allows third-party systems to push/pull tour data and bookings. Using Bokun as a middleware layer gives Tours Market indirect OTA connectivity without needing direct OTA approval.

Implementation:
- Add a "Connect to Bokun" option in the tenant dashboard
- Sync tour products to the tenant's Bokun account via Bokun API
- Bokun handles the OTA distribution and routes inbound bookings back via webhook
- Tours Market receives the booking webhook from Bokun and creates a `booking_order`

This is the fastest path to OTA distribution and is used by several smaller SaaS tools in this space.

### Phase 3 — Direct Viator integration (~200+ tenants)
Apply for Viator Connectivity Partner status. Build the direct integration. At this scale the certification effort is justified and Viator will take the application seriously.

### Phase 4 — Additional OTAs
GetYourGuide, Klook, Expedia as operator demand warrants.

---

## Data model impact

When an OTA booking arrives, the following additional fields will be needed on `booking_orders`:

```sql
ALTER TABLE booking_orders ADD COLUMN source_channel TEXT DEFAULT 'direct'; -- 'direct' | 'viator' | 'gyg' | 'klook' | 'bokun'
ALTER TABLE booking_orders ADD COLUMN external_booking_ref TEXT;             -- OTA's own booking ID
ALTER TABLE booking_orders ADD COLUMN channel_commission_pct REAL;           -- e.g. 0.25 for Viator 25%
ALTER TABLE booking_orders ADD COLUMN channel_payout_amount INTEGER;         -- net payout after OTA commission (cents)
```

A new table will track connected channels per tenant:

```sql
CREATE TABLE tenant_channel_connections (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  channel TEXT NOT NULL,           -- 'bokun' | 'viator' | 'gyg'
  status TEXT DEFAULT 'pending',   -- 'pending' | 'active' | 'disconnected'
  credentials_json TEXT,           -- encrypted API keys/tokens
  connected_at TEXT,
  last_sync_at TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
```

---

## References

- Viator Connectivity Partner program: https://www.viator.com/orion/supplier/connectivity-partners
- GetYourGuide Supplier API: https://supply.getyourguide.com/
- Bokun API docs: https://bokun.io/api/
- Klook Partner API: https://partner.klook.com/
