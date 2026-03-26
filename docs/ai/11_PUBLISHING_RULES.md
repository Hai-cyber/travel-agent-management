> RUNTIME NOTE: This document describes TARGET DESIGN for this module.
> The current rescue runtime does NOT implement these flows yet. Actual implemented slices are listed in 01_CURRENT_STATE.md.
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

# PUBLISHING RULES

## Environments

### Admin
- app.platform.com

### Preview
- preview.platform.com
- internal only
- not indexed
- no real booking

### Production
- agent domain only

## Rules

- No domain → cannot publish
- Preview is allowed without domain
- Booking is only active on production domain

## Branding

- Platform branding is NOT shown on public pages

## Footer (optional)

- Agent business name may be shown
- Platform name should not appear