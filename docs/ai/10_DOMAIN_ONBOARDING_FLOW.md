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