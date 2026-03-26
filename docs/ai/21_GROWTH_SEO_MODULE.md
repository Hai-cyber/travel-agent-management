> **RUNTIME NOTE:**
> This file describes the **TARGET DESIGN** for the Growth & SEO module. The current rescue runtime does **NOT** implement these flows yet. Actual implemented slices are listed in 01_CURRENT_STATE.md.

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

# GROWTH & SEO MODULE

## Purpose
Help agents acquire traffic and convert visitors.

## Reframe
This module is not "just SEO".
It is a tenant-level Distribution & Growth Layer covering:
- Search
- Social
- Reviews / trust
- Direct lead capture

## Scope

### A. SEO Core (MVP required)
1. Meta config (site + per tour)
- title
- meta_description
- keywords (optional)
- og_title
- og_description
- og_image

2. URL structure
- /tours/:slug
- slug must be editable per tour

3. Sitemap
- /sitemap.xml
- auto-generated from published tours

4. Robots
- /robots.txt baseline

5. Structured data
- Tour
- Product
- Offer
- Review

### B. Content SEO (simple but important)
1. Tour landing pages
- each tour is a standalone SEO page
- title, description, itinerary, media

2. Snippet templates
- auto templates for agents who do not write copy
- example: "Tour {destination} {duration} gia tot"

### C. Social sharing (VN-critical)
1. Facebook preview
- Open Graph tags

2. WhatsApp preview
- link preview and deep-link behavior

3. Zalo share
- link + fallback image

### D. Review & trust layer
1. Internal review widget
2. External review links
- TripAdvisor
- Google Reviews

3. Trust badges
- verified
- years of experience
- rating

### E. Analytics
1. Google Analytics ID
2. Facebook Pixel ID
3. Event tracking baseline
- view_tour
- click_contact
- submit_booking

### F. Lead capture
1. Contact form
2. WhatsApp button
3. Call button

## UI placement
Site Studio should include a dedicated tab: Growth & SEO

Sections:
1. SEO Basics
2. Social Preview
3. Analytics
4. Reviews
5. Lead Capture

## Rollout strategy
### Phase 1 (MVP)
- meta tags
- OG tags
- WhatsApp button
- contact form
- sitemap

### Phase 2
- structured data
- analytics
- review links

### Phase 3
- content automation
- SEO suggestions
- ranking insights

## VN market note
Traffic priority in practice is often:
1. Facebook
2. Zalo
3. Referral
4. Google SEO

So this module must combine SEO + Social + Messaging, not SEO-only.

## Non-goals (MVP)
- blog/CMS system
- advanced technical SEO toolkit