# UNIVERSAL TEMPLATE PIVOT

Last updated: 2026-03-31
Branch: `pivot/universal-template`

## Decision

Stop treating each public template as its own independent website system.

New direction:
- one universal site system
- one shared content/editor model
- one shared theme/token model
- one shared page schema
- eight visual/business variants built on top of the same system

This reduces maintenance cost and keeps `tour builder` + `pricing engine` canonical.

## Product split

### Group A: Travel agents
Count: 3 variants

Purpose:
- sell tours
- publish tour listing pages
- auto-generate tour detail pages from operational tour data
- inject shared booking engine tied to tour + pricing

### Group B: Hotels / guesthouses / cruises
Count: 5 variants

Purpose:
- present rooms / stays / cruise products
- use the same site shell, theme system, page builder, menu editor, media editor, footer/legal system
- reservation engine is separate and will be built later

Constraint:
- do not block the universal site system on the reservation engine
- ship hospitality variants first with content/site capabilities, then plug reservation engine later

## Shared core

The following must be common across all 8 variants:

- tenant-level theme tokens
- menu schema
- footer schema
- legal page schema
- section/block editing rules
- media replacement rules
- link editing rules
- extra page creation
- standard contact channels
- page routing/publishing model

The following must remain canonical shared business engines:

- `tour builder`
- `pricing engine`

## Standard site map

The universal system should provide these standard pages out of the box:

- `home`
- `tours`
- `hotels`
- `booking` or `reservation`
- `about-us`
- `contact-us`
- `terms`
- `privacy`
- `impressum`

Notes:
- Not every variant has to show every page in the menu.
- Visibility is controlled by schema, not by deleting the page type from the system.
- Tenants can add extra custom pages later.

## Menu system

Menu must be schema-driven.

Each menu item should support:
- `key`
- `label`
- `href`
- `page_key`
- `visible`
- `sort_order`
- `target`
- `is_external`

Editable behavior:
- tenant can rename labels
- tenant can reorder items
- tenant can hide/show items
- tenant can attach hyperlinks
- tenant can point items to internal pages or external URLs

## Content editing model

Across all variants, the tenant must be able to:
- change text
- change labels
- change CTA text
- insert or update hyperlinks
- replace images
- change theme/color/font tokens
- add extra sections where allowed
- add extra pages

This should be implemented as structured editable content, not arbitrary freeform HTML-only editing.

Recommended split:
- global site config
- page config
- section config
- block content
- theme tokens

## Contact model

Standard contact system should support:
- contact form
- phone
- email
- WhatsApp
- Zalo
- optional address/map link

Display rules:
- each channel can be enabled/disabled
- each channel can have a custom label
- each channel can render as menu item, footer item, floating button, or contact card

## Footer model

Footer should be universal and schema-driven.

Minimum content:
- brand/site title
- short company copy
- contact channels
- legal links
- copyright line

Mandatory legal slots:
- `T&C`
- `Privacy`
- `Impressum`

## Variant model

Important rule:
- variants are presentation presets, not separate apps

Each variant should define:
- hero composition
- typography mood
- color direction
- section ordering defaults
- card styles
- imagery style
- CTA style
- header/footer style

Each variant should not redefine:
- menu logic
- page routing logic
- legal page logic
- contact schema
- editor capability model
- publish/render pipeline

## Proposed 8 variants

### Travel agent variants (3)
1. `travel-classic`
Classic brochure style, trust-first, broad demographic.

2. `travel-signature`
Premium curated journeys, editorial storytelling, stronger hero imagery.

3. `travel-compact`
Conversion-first, search/listing heavy, minimal storytelling.

### Hospitality variants (5)
4. `hotel-classic`
Standard hotel presentation, amenities, room highlights, trust/convenience.

5. `boutique-stay`
Small hotel / guesthouse / homestay storytelling.

6. `resort-luxury`
Large imagery, experience-focused, upscale.

7. `cruise-editorial`
Cruise storytelling, deck/journey mood, itinerary/experience emphasis.

8. `lodging-compact`
Budget stay / hostel / guesthouse, utility-first and booking-forward.

## Tour detail page rule

For travel-agent variants, `tour detail` must be generated automatically.

Source of truth:
- operational tour record
- tour stops
- pricing setup
- site-facing public content overrides

Flow:
1. tenant creates or copies a tour
2. system auto-creates the public tour page record/slug
3. system renders a default tour detail page from the universal template
4. tenant can decorate the page by editing text, images, and selected content blocks
5. system always injects the booking engine in the designated slot
6. CTA like `I like this tour` must bind to that specific `tour_id`
7. pricing shown must bind to the tenant's own pricing engine data

Important constraint:
- tenant can decorate and enrich the tour page
- tenant cannot break the canonical binding between the public page and `tour_id` / pricing source

## Hospitality detail page rule

For hotel/guesthouse/cruise variants:
- auto-generated detail pages can also exist later
- but reservation engine binding is phase 2
- phase 1 can ship with CTA placeholders and contact/reservation inquiry entry points

## Editor capability boundaries

Tenant can edit:
- text
- labels
- buttons
- links
- images
- menu labels
- section visibility/order within allowed areas
- theme tokens
- contact channels
- extra pages

Tenant should not directly edit:
- canonical booking engine internals
- canonical tour-pricing computation
- system routing contracts
- legal page keys
- structural bindings between public tour pages and source tour records

## Implementation phases

### Phase 1
- universal site schema
- shared page registry
- shared menu/footer/contact/legal schema
- variant preset registry
- 3 travel variants wired to tour listing + auto-generated tour detail

### Phase 2
- page builder/editor adaptation to universal schema
- extra page creation
- variant-aware home sections
- stable tour detail decoration layer

### Phase 3
- 5 hospitality variants on same universal shell
- hospitality listing/detail content model
- reservation engine placeholder integration points

### Phase 4
- hospitality reservation engine implementation
- bind hospitality variants to reservation engine

## Non-negotiables

- One universal system only.
- Variants are presets, not separate products.
- `tour builder` and `pricing engine` remain shared canonical business engines.
- Travel-agent tour detail pages are auto-generated from operational data.
- Booking engine on travel detail pages is injected by the system, not manually pasted.
- Tenant decoration must never sever the page-to-tour binding.
- Hospitality reservation engine is a later phase and must not distort the universal site foundation.

## Outcome

Yes, this direction is valid.

It is stronger than the current approach because it separates:
- business engine
- public-site shell
- visual variants
- future hospitality reservation engine

That separation is the only realistic way to support:
- 3 travel-agent variants
- 5 hospitality variants
- automatic tour pages
- editable text/image/link/theme capabilities
- a future reservation engine

without exploding maintenance cost.