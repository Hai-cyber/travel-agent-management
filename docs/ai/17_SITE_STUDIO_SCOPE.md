> **RUNTIME NOTE:**
> This file describes the **TARGET DESIGN** for the Site Studio module. The current rescue runtime does **NOT** implement these flows yet. Actual implemented slices are listed in 01_CURRENT_STATE.md.

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

# SITE STUDIO SCOPE

## Purpose

Allow agents to customize their public-facing website.

## Features (MVP)

- Theme selection
- Colors / fonts
- Header / footer
- Tour listing page
- Tour detail page

## Legal Pages

- Terms & Conditions
- Privacy Policy
- Impressum

## Contact

- contact form
- phone
- WhatsApp link

## Search

- basic tour search

## Non-goals (MVP)

- drag-drop builder
- complex CMS