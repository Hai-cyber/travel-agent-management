# > **RUNTIME NOTE:**
# > Tour data and preview endpoints exist in the rescue runtime. The Site/public layer is **NOT** rebuilt yet. This document describes the intended separation between Tour (data/logic) and Site (presentation), **not** the current runtime implementation.

# 
Add a "RUNTIME NOTE" near the top of this file:

- Clarify that:
  - tour data and preview endpoints exist in the rescue runtime
  - the Site/public layer is NOT rebuilt yet
- Say explicitly that this document describes the intended separation between Tour (data/logic) and Site (presentation), not current runtime implementation.

Do not change the rest of the content.


# TOUR AND SITE STRUCTURE

## Layers


### Tour (per product)
- configuration
- visual
- pricing
- itinerary: tour_stops (canonical, ordered segments; each may reference a catalog destination)

> NOTE: Legacy "destination" logic is retained for business intent but is not canonical for itinerary modeling. All operational service items must reference tour_stop_id.

### Site (per tenant)
- theme
- layout
- pages
- legal
- contact

## Relationship

- One tenant → many tours
- One site → displays multiple tours

## Separation

- Tour = data + logic
- Site = presentation