# Password Reset Webhook

Purpose: let the Worker hand off real password-reset emails to an external email sender in production.

## Required production secrets

Set both values on the deployed Worker:

```bash
printf '%s' 'https://mailer.example.com/password-reset' | npx wrangler secret put PASSWORD_RESET_WEBHOOK_URL --config ./wrangler.jsonc
printf '%s' 'replace-with-a-long-random-secret' | npx wrangler secret put PASSWORD_RESET_WEBHOOK_SECRET --config ./wrangler.jsonc
```

For local verification, copy the same keys into `.dev.vars`.

## Delivery behavior

- The Worker calls `PASSWORD_RESET_WEBHOOK_URL` with `POST`
- The body is JSON
- If `PASSWORD_RESET_WEBHOOK_SECRET` is set, the request is HMAC-signed
- Anonymous callers still get a generic API response; the reset token is not returned in production responses

## Headers

- `Content-Type: application/json`
- `User-Agent: travel-agent-password-reset-webhook/1.0`
- `X-TravelAgent-Event: password_reset.requested`
- `X-TravelAgent-Event-Id: <uuid>`
- `X-TravelAgent-Timestamp: <unix-seconds>`
- `X-TravelAgent-Signature: v1=<hex-hmac-sha256>` when secret is configured

For receivers like Google Apps Script that do not expose custom headers cleanly, the Worker also duplicates this metadata into query params:

- `ta_event=password_reset.requested`
- `ta_event_id=<uuid>`
- `ta_ts=<unix-seconds>`
- `ta_sig_v=v1`
- `ta_sig=<hex-hmac-sha256>` when secret is configured

Signature input:

```text
<timestamp>.<raw_json_body>
```

Signature algorithm:

```text
HMAC_SHA256(PASSWORD_RESET_WEBHOOK_SECRET, signature_input)
```

## Payload shape

```json
{
  "event": "password_reset.requested",
  "event_id": "1c443a88-c1c9-4a2e-9384-0440f7947b09",
  "occurred_at": 1775244000,
  "tenant_id": "ten-demo-001",
  "locale": "en",
  "recipient": {
    "email": "owner@example.com"
  },
  "reset": {
    "url": "https://tours-market.com/reset-password.html?token=...",
    "expires_at": 1775247600
  },
  "email_content": {
    "subject": "Reset your TravelAgent password",
    "text": "...",
    "html": "..."
  },
  "source": {
    "app": "travel-agent-management",
    "base_url": "https://tours-market.com"
  }
}
```

The webhook receiver can send `email_content.subject`, `email_content.text`, and `email_content.html` directly through Resend, Postmark, SendGrid, Mailgun, or another mailer.

## Google Apps Script option

If you want the cheapest path using Google Workspace / Gmail on your own domain, point the Worker at your Apps Script Web App:

```bash
printf '%s' 'https://script.google.com/macros/s/AKfycbwtLvd8sI-81R3V4e9B1kcZ4iAC7zCnBZqAbDFSQLoqiEnTRpiboTR1cabKIALlgKnlWg/exec' | npx wrangler secret put PASSWORD_RESET_WEBHOOK_URL --config ./wrangler.jsonc --env=''
```

You should still configure `PASSWORD_RESET_WEBHOOK_SECRET` on both sides so the Apps Script receiver can reject spoofed requests.

## Current production status

- Live Worker is currently configured to use a verified Google Apps Script receiver
- Verified on 2026-04-03: direct signed POST to the Apps Script hook returned `Success`
- Verified on 2026-04-03: `POST /api/auth/forgot-password` on `https://tours-market.com` returned `200 OK` after the remote `0034_password_reset_tokens.sql` migration was applied

Receiver requirements:

- accept `POST`
- read the raw JSON body
- read `ta_ts` and `ta_sig` from query params
- recompute `HMAC_SHA256(secret, "<timestamp>.<raw_json_body>")`
- reject if the signature mismatches
- send the email to `payload.recipient.email`
- use `payload.email_content.subject`, `payload.email_content.text`, and `payload.email_content.html`
- return HTTP `200` or `202`

## Local verification

Start the mock receiver:

```bash
npm run mock:webhook:password-reset
```

Then run:

```bash
npm test
```

The mock receiver verifies the HMAC signature and prints the accepted event summary.