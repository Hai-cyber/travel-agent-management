#
> RUNTIME NOTE: This document describes TARGET DESIGN for this module.
> The current rescue runtime does NOT implement these flows yet. Actual implemented slices are listed in 01_CURRENT_STATE.md.
#
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

# DOMAIN POLICY

## Principle

Platform is NOT a marketplace.
Agents are fully responsible for their content and services.

## Rules

- Public tour pages MUST run on agent-owned domains
- Platform domains are used ONLY for:
  - admin dashboard
  - internal preview

## Forbidden

- No public tours on platform subdomains
- No shared storefront under platform domain

## Domain Ownership

- Agent must:
  - own domain OR
  - control DNS

## Legal Separation

- Platform does NOT:
  - sell tours
  - represent agent services
- Agent is responsible for:
  - content
  - pricing
  - service quality