# Tenant Trust And Abuse Control

Purpose: keep signup and onboarding lightweight while making public abuse, phishing, SEO spam, and custom-domain misuse expensive and reviewable.

This document describes the anti-abuse runtime that now exists in the repository. Runtime truth still lives in docs/ai/01_CURRENT_STATE.md.

## Core Principle

- Easy to enter: signup, dashboard access, starter content, preview tooling.
- Hard to spread abuse: public indexing, custom-domain exposure, risky subdomains, and suspicious publish attempts are gated by trust state.

## Trust Ladder

Tenant trust states:

- PREVIEW_ONLY
- PROBATION
- TRUSTED
- SUSPENDED
- QUARANTINED

Meaning:

- PREVIEW_ONLY: tenant can onboard, configure, and preview internally, but public exposure is not allowed.
- PROBATION: platform subdomain can be used, but public responses are forced to noindex and custom domains stay blocked.
- TRUSTED: full public exposure is allowed, including verified custom domains and optional indexing.
- SUSPENDED: public exposure is blocked.
- QUARANTINED: public exposure is blocked due to abuse or strong review signals.

## Runtime Rules

### Silent Risk Ledger

- Suspicious behavior is now written into `tenant_risk_events` instead of relying on transient logs only.
- Events can carry hashed IP, email, user-agent, asset hash, signal key, severity, risk score, and action.
- The platform uses this ledger to detect bursty behavior, correlate repeated signals, and preserve evidence for operator review without adding visible friction to normal tenants.

### Signup

- New tenants are created as PREVIEW_ONLY.
- `public_indexing_enabled` defaults to 0.
- Signup friction stays low: no extra business-verification steps were added to signup.
- Signup and login now apply quiet email/IP soft throttles and write hashed risk events so scripted retries are slowed before they become public abuse.

### Subdomain Claims

- Clean platform subdomains still follow strict syntax and abuse heuristics.
- Suspicious labels create manual-review cases and are rejected.
- A clean first-time subdomain claim automatically promotes a tenant from PREVIEW_ONLY to PROBATION.

### Custom Domains

- Custom domains are only claimable when the tenant is TRUSTED.
- Changing a custom domain resets `custom_domain_verified_at` to null.
- Every custom-domain change opens a verification review case before the domain is considered live.
- Host-based custom-domain resolution only works when:
  - tenant is TRUSTED
  - `custom_domain_verified_at` is set
  - subscription is ACTIVE

### Public Serving

- Platform subdomains are only resolved for PROBATION or TRUSTED tenants.
- TRUSTED tenants can serve through verified custom domains.
- PROBATION tenants are served with `X-Robots-Tag: noindex, nofollow, noarchive` and a matching `meta robots` tag.
- PREVIEW_ONLY, SUSPENDED, and QUARANTINED tenants do not get normal public host resolution.

### Publish Gate

Publish now checks the existing gates plus trust:

- subscription ACTIVE
- terms accepted
- at least one electronic payment gateway
- domain configured
- trust policy allows public publish
- publish attempt frequency stays within trust-aware soft limits

### Config-Save Moderation

- `PATCH /api/tenant/config` now records a risk event for every save attempt.
- Save frequency is compared against trust-aware velocity windows so automation bursts can be reviewed without blocking ordinary editing.
- Normalized tenant site content is scanned by rules and, when configured, Cloudflare AI.
- Flagged saves can open a review case and apply a soft trust hold that reduces public exposure while still allowing the tenant to keep working.

### Publish-Time Content Scan

Before publish, the system inspects tenant site content and can block or review:

Blocked examples:

- credential capture fields such as password inputs
- explicit adult markers
- account-takeover / phishing wording

Review-required examples:

- gambling or sportsbook keywords
- pharma affiliate keywords
- finance-bait wording
- unusually high outbound-link density

When publish is flagged:

- a tenant review case is created
- tenant trust is downgraded
- indexing is disabled
- publish is blocked with structured review details

### Cloudflare AI Second-Pass Moderation

- Rule-based checks still run first.
- When configured, Cloudflare AI now scores normalized tenant/site content during publish-time moderation and high-risk config-save moderation.
- AI output is constrained to structured JSON and merged with rule-based signals into one enforcement decision.
- AI can escalate cases into `REVIEW`, `BLOCK`, or `QUARANTINE`, but durable review cases in D1 remain the system of record.

### Asset Moderation

- Tenant asset uploads are now tracked in `tenant_asset_inventory` and each scan result is stored in `tenant_asset_scan_results`.
- Uploads are fingerprinted with SHA-256 so the platform can correlate repeated asset reuse across tenants.
- Rule-based scanning currently blocks obvious active-content or phishing-oriented SVG payloads and can review unusually risky files.
- Cloudflare AI can run as a second-pass asset scorer before the file is exposed publicly.
- Assets can be stored as `PUBLIC`, downgraded to `AUTHENTICATED_ONLY`, sent to review, or blocked before R2 persistence when clearly malicious.

### Telegram Alerts

- Flagged moderation events can now trigger Telegram alerts through a bot token + chat ID.
- Telegram is used for operator notification only; review state still lives in `tenant_review_cases`.

## Review Queue

Durable review cases are stored in `tenant_review_cases`.

Each case includes:

- tenant_id
- status
- category
- severity
- signal_key
- summary
- evidence_json
- created/resolved audit fields

This replaces the earlier pattern where suspicious events only emitted webhooks or logs.

## Admin Operations

Admin routes are available under `/api/admin/*` and protected by `X-Admin-Secret`.

Relevant endpoints:

- `GET /api/admin/tenant-review-cases`
- `GET /api/admin/tenants/:id/trust`
- `PATCH /api/admin/tenants/:id/trust`

Admin actions can:

- promote a tenant to TRUSTED
- suspend or quarantine a tenant
- enable or disable indexing
- verify the current custom domain
- close open review cases during resolution

## Recommended Production Setup

- Set `ADMIN_SECRET` in Workers secrets.
- Set `SUBDOMAIN_REVIEW_WEBHOOK_URL` and `SUBDOMAIN_REVIEW_WEBHOOK_SECRET` for operational alerts.
- Treat webhook delivery as notification only; the source of truth is the D1 review queue.
- Keep custom-domain verification as an explicit operational step before enabling live exposure.

## What This Solves Now

- Prevents obvious phishing-style subdomain claims.
- Prevents untrusted tenants from binding custom domains.
- Prevents accidental indexing of probationary tenants.
- Makes suspicious publish attempts durable, reviewable, and stateful.
- Adds silent risk history for signup, login, content saves, publish attempts, and asset uploads.
- Scans tenant assets before public exposure and can hide or block risky files.
- Preserves a low-friction onboarding path because signup and dashboard access remain open.

## What Still Comes Next

This system is intentionally phase one. Future upgrades should include:

- ownership challenge flow for custom-domain verification
- disposable-email and reputation scoring
- richer Google-auth parity for the same quiet throttle model
- richer HTML/content moderation beyond the current heuristics
- admin UI for review queue resolution instead of API-only operations

## Future Considerations

These are the next pragmatic anti-abuse upgrades after the current phase.

### 1. Google-auth parity

- Apply the same quiet risk-event logging and soft throttling model to `POST /api/auth/google` and `POST /api/auth/signup-google`.
- This closes the gap where an attacker can switch away from email-password flows after the email lane gets stricter.

### 2. Operator review UI

- Build a small internal dashboard on top of `tenant_review_cases`, tenant trust state, asset scan history, and recent `tenant_risk_events`.
- The backend review model already exists; the next operational gain is making it fast for humans to triage and resolve cases.

### 3. Background reputation aggregation

- Add a scheduled summarizer that turns raw `tenant_risk_events` and `tenant_asset_inventory` history into stable cross-request reputation signals.
- Initial aggregation candidates: repeated IP reuse, repeated asset-hash reuse, bursty config-save/publish behavior, and clustered low-quality signup patterns.

### 4. Stronger asset scanning

- Extend beyond the current SVG-first and metadata-first rules.
- Priority additions: OCR/text extraction where practical, disguised-file checks, archive sanity checks, and perceptual-hash style detection for repeated scam creatives.

### 5. Threshold and alert tuning

- Use the current phase to collect signal quality before tightening enforcement further.
- Tune when Telegram should fire, when review is enough, and when a soft hold should escalate into a hard block based on observed false-positive rates.
