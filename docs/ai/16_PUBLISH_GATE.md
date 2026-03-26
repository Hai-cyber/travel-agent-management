> **RUNTIME NOTE:**
> This file describes the **TARGET DESIGN** for the Publish Gate module. The current rescue runtime does **NOT** implement these flows yet. Actual implemented slices are listed in 01_CURRENT_STATE.md.

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

# PUBLISH GATE

## Purpose

Ensure legal, billing, and domain requirements are met before going live.

## Requirements

- Domain verified
- Payment method added
- Terms accepted
- Commission agreement accepted

## Behavior

If not satisfied:
- disable publish
- show checklist

## Preview Mode

- always available
- no real booking

## Runtime baseline

- tenant checklist state is persisted separately from domain verification
- publish gate is enforced when a tour moves to `on_sale`