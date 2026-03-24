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