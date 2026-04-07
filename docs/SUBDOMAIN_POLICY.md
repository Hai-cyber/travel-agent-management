# Subdomain Policy

Purpose: define the platform-owned subdomain namespace, tenant-facing subdomain rules, and the reservation strategy for future SaaS growth, support, and operations.

This document is runtime-aligned for the current platform subdomain flow. If implementation details conflict with runtime behavior, [docs/ai/01_CURRENT_STATE.md](docs/ai/01_CURRENT_STATE.md) wins.

## Principles

- Tenant-selected platform subdomains are branding labels for tenant previews and hosted platform entrypoints.
- Platform-owned subdomains are permanently reserved and cannot be claimed by tenants.
- Tenant subdomains should be brand-specific, not generic SaaS, marketing, or infrastructure labels.
- A tenant platform subdomain is lock-once. After a tenant reserves it, later changes are rejected.

## Tenant Rules

- Allowed pattern: lowercase letters, numbers, and hyphens only.
- Minimum length: 3 characters.
- Maximum length: 63 characters.
- A subdomain cannot start or end with a hyphen.
- Reserved platform labels are rejected even if they are syntactically valid.
- Suspicious finance, auth, support, government, typo-squatting, or random-looking labels are held for manual review.
- If a requested subdomain conflicts with a reserved name, the tenant should choose a brand-specific alternative such as `sunset-travel`, `atlas-voyages`, or `blue-lagoon-tours`.

Regex reference:

```txt
^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$
```

## Reserved Platform Namespaces

### Marketing and Growth

- `www`
- `marketing`
- `start`
- `plans`
- `demo`
- `customers`
- `compare`
- `why`
- `stories`
- `blog`
- `learn`
- `academy`
- `events`
- `promo`
- `go`
- `community`
- `waitlist`

### Commercial and Lifecycle

- `partners`
- `referrals`
- `rewards`
- `billing`
- `checkout`
- `pay`
- `book`
- `trips`
- `portal`
- `success`
- `migrate`
- `import`
- `contact`

### Product and Support

- `app`
- `auth`
- `studio`
- `preview`
- `api`
- `docs`
- `developers`
- `help`
- `support`
- `id`

### Operations and Delivery

- `admin`
- `ops`
- `internal`
- `status`
- `trust`
- `legal`
- `webhooks`
- `hooks`
- `cdn`
- `assets`
- `media`
- `edge`
- `sandbox`
- `staging`
- `dev`
- `beta`
- `labs`
- `region`
- `m`

### Technical Safety

- `mail`
- `smtp`
- `imap`
- `pop`
- `ftp`
- `ns1`
- `ns2`
- `autodiscover`
- `webmail`
- `cpanel`
- `localhost`

## Recommendation Policy

- Reserve names early if they may later become product, support, billing, SEO, or operational surfaces.
- Prefer short, obvious, platform-owned labels for future infrastructure even before the feature is live.
- Do not allow tenants to register generic labels that could later block platform growth.
- When in doubt, keep the generic term for the platform and ask tenants to use a branded variation.

## Good Tenant Examples

- `sunset-travel`
- `atlas-voyages`
- `blue-lagoon-tours`
- `nordic-expeditions`
- `mekong-private-journeys`

## Rejected Examples

- `app`
- `auth`
- `demo`
- `billing`
- `status`
- `blog`
- `api`
- `cdn`

## Runtime Notes

- Backend validation rejects reserved labels in `PATCH /api/tenants/settings` when a tenant attempts to lock `subdomain`.
- Backend validation also routes suspicious attempts into manual review if they contain high-risk auth/finance/government keywords, resemble protected finance brands, or look randomly generated.
- Manual review alerts can be forwarded through `SUBDOMAIN_REVIEW_WEBHOOK_URL` and signed with `SUBDOMAIN_REVIEW_WEBHOOK_SECRET`; local development falls back to log-only warnings.
- Tenant settings responses expose `subdomain_policy` so the dashboard can show the active platform suffix, reserved labels, and suggestion suffixes.
- The tenant dashboard suggestion flow prefers non-reserved alternatives automatically.