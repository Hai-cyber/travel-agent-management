# Cloudflare AI And Telegram Moderation

Purpose: add a Cloudflare-native AI scoring layer on top of the existing rule-based abuse controls, then notify operators through Telegram when a tenant is flagged.

## Goal

Keep onboarding easy while making public abuse harder.

Approach:

- Rule-based checks still run first.
- Cloudflare AI is used as a second-pass scorer, not the sole judge.
- Durable review cases in D1 remain the source of truth.
- Telegram is used for operator alerts, not as the system of record.

## Runtime Placement

### Publish-time moderation

Current publish flow:

1. Existing publish gate runs.
2. Rule-based content heuristics run.
3. Cloudflare AI moderation runs over normalized tenant/site payload.
4. Rule + AI signals are merged into one moderation outcome.
5. If flagged:
   - publish is blocked
   - tenant trust is downgraded
   - indexing is disabled
   - a `tenant_review_cases` row is created
   - Telegram alert is sent when configured

### Config-save moderation

Current config-save flow:

1. Tenant saves site config through `PATCH /api/tenant/config`.
2. A durable `tenant_risk_events` row is written.
3. Rule-based heuristics score the normalized tenant/site payload.
4. Cloudflare AI can run on the same normalized payload.
5. Merged signals can create a review case and apply a soft trust hold without blocking normal editing.

### Asset moderation

Current asset-upload flow:

1. Tenant uploads an asset through `POST /api/tenant/assets/upload`.
2. Rule-based asset scanning runs first.
3. Cloudflare AI can score normalized asset metadata and extracted text/signal hints.
4. Rule + AI signals are merged with asset hash reuse checks.
5. If flagged:
  - obviously malicious files are blocked before storage
  - review-required files are stored with restricted visibility when appropriate
  - inventory and scan evidence are persisted in D1
  - Telegram alerting can be triggered through the same review workflow

### Manual admin moderation

Admin can re-run AI moderation without publishing through:

- `POST /api/admin/tenants/:id/moderate-ai`

This supports a dry run or an applied decision.

## Decision Model

Rule-based checks keep hard authority for obvious abuse.

### Hard rule examples

- credential capture forms
- explicit adult markers
- credential-theft wording

### Cloudflare AI is used for

- phishing or impersonation ambiguity
- SEO spam and affiliate abuse signals
- domain and brand mismatch
- suspicious travel-site content that is not obviously illegal but still risky
- multilingual content that simple regex does not catch well
- suspicious asset metadata and extracted text signals that go beyond simple filename or SVG pattern rules

## Recommended Action Mapping

Cloudflare AI returns structured JSON:

- `risk_score` from 0 to 100
- `confidence` from 0 to 1
- `recommended_action`: `ALLOW`, `REVIEW`, `BLOCK`, `QUARANTINE`
- categories and evidence
- operator summary and reasons

Enforcement mapping:

- Hard rule block always wins.
- AI `BLOCK` or `QUARANTINE`, or AI risk score >= 80, becomes a blocking outcome.
- AI `REVIEW`, or AI risk score >= 55, becomes manual review.
- Otherwise the tenant is allowed through this stage.

## Configuration Needed

### Cloudflare AI

Preferred production path:

- add an `AI` binding in `wrangler.jsonc`
- optional `AI_MODERATION_MODEL`, default `@cf/meta/llama-3.1-8b-instruct`

Fallback path when an AI binding is not available:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- optional `AI_MODERATION_MODEL`

Optional provider override:

- `AI_MODERATION_PROVIDER=cloudflare-ai`

### Telegram

Required to enable alerting:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

### Existing anti-abuse config still useful

- `SUBDOMAIN_REVIEW_WEBHOOK_URL`
- `SUBDOMAIN_REVIEW_WEBHOOK_SECRET`
- `ADMIN_SECRET`

## What You Need To Provide

To fully turn this on in production, provide:

1. Cloudflare AI access through the Worker binding or API token
2. Telegram bot token
3. Telegram target chat ID
4. Confirmation of which chat should receive alerts
5. Optional choice on whether Telegram alerts should fire for every review case or only for high-severity outcomes

## Operational Notes

- If Cloudflare AI is not configured, runtime falls back to rule-based moderation only.
- If Telegram is not configured, flagged cases are still stored in D1 review queue.
- Telegram alerts are intentionally short; operators should inspect the review queue or admin endpoint for full evidence.
- Admin route auth remains `X-Admin-Secret` protected.
- The Worker prefers the native `AI` binding; REST credentials exist mainly for local scripts and environments that do not have the binding.

## API Notes

### Run AI moderation manually

`POST /api/admin/tenants/:id/moderate-ai`

Optional JSON body:

```json
{
  "apply_decision": true,
  "notify_telegram": true
}
```

Behavior:

- `apply_decision: false` means dry-run only
- `apply_decision: true` means create review case and update tenant trust if flagged

## Recommendation For Next Iteration

If this phase performs well, the next safe extension is:

1. extend the same quiet risk controls to Google-auth entry paths
2. add a UI review queue for operators instead of API-only moderation workflows
3. add selective alert tuning so Telegram only fires on the highest-signal review outcomes