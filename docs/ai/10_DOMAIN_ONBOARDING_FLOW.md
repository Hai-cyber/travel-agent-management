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

# DOMAIN ONBOARDING FLOW

## Entry Point
Admin → "Domain & Publish"

## Step 1: Choose Option

- I already have a domain
- I need a domain

## Step 2A: Existing Domain

Input:
- subdomain or domain (e.g. tour.company.vn)

System shows:
- DNS instructions (CNAME/TXT)

## Step 3: Verification

- User adds DNS record
- System verifies ownership

States:
- pending
- verified

## Step 4: Activation

- Link hostname → tenant_id
- Enable routing

## Step 5: Publish

- Only allowed if:
  - domain = verified

## States

- no_domain
- pending
- verified

Note:
- publish is gated separately by CHK-402 once domain status is `verified`