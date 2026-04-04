# Interest Taxonomy And Collection Strategy

Purpose: define the next discovery architecture direction for public tour pages.

Status: agreed product direction, not implemented yet.

## Decision summary

The platform should move toward a hybrid model:

- keep presentation more constrained than a full free-form Site Studio workflow
- make structured tagging and rule-based collections the primary discovery engine
- let agent-assisted curation exist on top of taxonomy, not replace taxonomy

In practical terms:

- hybrid remains the delivery model
- tagging wins as the long-term organizing system
- auto-generated collection pages become the scalable default
- manually curated pages become selective overrides, not the baseline system

## Canonical interest taxonomy

Initial top-level interests:

- `adventure`
- `culture`
- `beach`
- `sport`
- `food`
- `nature`

Planned sub-interests later:

- `trekking`
- `diving`
- `cycling`
- `heritage`

Rules:

- top-level interests are canonical and controlled by the system
- sub-interests are also controlled vocabulary, not free-text user tags
- agents may suggest tags, but should select from canonical taxonomy instead of inventing new labels ad hoc

## Why this direction wins

This direction is preferred over leaning harder into Site Studio for tour discovery because it is:

- easier to implement
- easier to validate
- easier to keep consistent across many tours
- much better for search, filtering, and auto-grouping
- much more scalable once inventory grows

Site Studio remains useful for presentation and curated landing pages, but it should not be the primary discovery architecture.

## System model

There are 3 layers:

### 1. Structured metadata layer

Tours and destinations should carry structured discovery metadata.

Minimum shape:

- canonical interest tags
- optional sub-interest tags
- optional boolean toggles such as:
  - `family_friendly`
  - `private_tour`
  - `multi_day`
  - `water_based`
  - `easy_activity_level`
- optional scored dimensions later such as:
  - `adventure_score`
  - `culture_score`
  - `relaxation_score`

### 2. Rules-based collection layer

The system should generate pages like:

- `/interests/adventure`
- `/interests/culture`
- `/interests/beach`

These are not hand-built one by one.

They should be generated from rules such as:

- include tours tagged `adventure`
- include destinations tagged `adventure`
- sort by relevance / featured / freshness
- hide or delay publication if there is not enough inventory

### 3. Curated override layer

Agent or admin users may still create curated pages and curated sections.

Examples:

- `Best Adventure Tours In Vietnam`
- `Soft Adventure For Families`
- `Beach And Food Escapes`

But those pages should reuse the same structured query blocks rather than storing all selection logic manually.

## Auto-generated interest pages

Default recommendation:

- system auto-creates and auto-updates canonical interest pages
- pages are published only when enough tagged inventory exists
- pages reuse common page blocks instead of each page having custom markup logic

Recommended publication rule for MVP:

- only publish an interest page when at least 3 relevant tours exist

This avoids thin low-value pages.

## Block strategy

Blocks still matter, but they should become rule-driven blocks rather than manual layout fragments first.

Example reusable blocks:

- `interest_hero`
- `tour_grid_by_interest`
- `tour_grid_by_sub_interest`
- `destination_spotlight_by_interest`
- `faq_by_interest`
- `related_interests`
- `seo_intro`

These blocks should work in 2 places:

- auto-generated collection pages
- curated landing pages

## Agent role

The agent should primarily act as a metadata and curation assistant.

Good uses:

- suggest canonical interest tags from tour copy and itinerary
- suggest sub-interests from description patterns
- propose missing toggles or scores
- generate hero copy and SEO copy for collection pages
- choose featured tours for a curated landing page

Bad default use:

- inventing uncontrolled tags
- becoming the main page-builder for every category page

## Search impact

This strategy should directly power search and discovery.

Search and filtering can combine:

- text relevance
- canonical interest tags
- sub-interest tags
- boolean toggles
- optional score dimensions later
- featured or commercial ordering rules

The same taxonomy should power:

- collection pages
- filter UI
- related-tour recommendations
- search ranking boosts

## Build recommendation

Recommended implementation order:

1. establish canonical taxonomy tables and mappings
2. tag tours and destinations with canonical interests
3. add rules-based collection page generation
4. add reusable query-driven blocks for interest pages
5. add agent-assisted tagging and curation
6. refine ranking, toggles, and scores later

## Explicit product stance

The platform should not try to solve large-scale discovery primarily through free-form page building.

The platform should solve discovery through:

- structured taxonomy
- rules-based collections
- selective curated overrides

That is the agreed direction to build next.