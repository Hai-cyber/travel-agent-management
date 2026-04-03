# Google Apps Script Password Reset Receiver

Use this when the Worker should hand off password-reset emails to a Google Apps Script Web App that sends mail through your Google account for `tours-market.com`.

## Current verified deployment

Production is currently using this verified Web App URL:

```text
https://script.google.com/macros/s/AKfycbwtLvd8sI-81R3V4e9B1kcZ4iAC7zCnBZqAbDFSQLoqiEnTRpiboTR1cabKIALlgKnlWg/exec
```

Verified on 2026-04-03:

- direct signed POST to the hook returned `Success`
- `POST https://tours-market.com/api/auth/forgot-password` returned `200 OK`

## Worker-side production secrets

Set the real Apps Script URL:

```bash
printf '%s' 'https://script.google.com/macros/s/AKfycbwtLvd8sI-81R3V4e9B1kcZ4iAC7zCnBZqAbDFSQLoqiEnTRpiboTR1cabKIALlgKnlWg/exec' | npx wrangler secret put PASSWORD_RESET_WEBHOOK_URL --config ./wrangler.jsonc --env=''
```

Current live secret rotation command pattern:

```bash
printf '%s' 'replace-with-your-random-secret' | npx wrangler secret put PASSWORD_RESET_WEBHOOK_SECRET --config ./wrangler.jsonc
```

The production integration currently uses a hardcoded `WEBHOOK_SECRET` constant in the Apps Script file. If you later switch to Script Properties, keep the Worker secret value exactly identical.

## Apps Script receiver code

Copy the ready-to-paste receiver from [docs/google-apps-script-password-reset-webhook.gs](/Users/nguyennhathai/projects/travel-agent-management/docs/google-apps-script-password-reset-webhook.gs).

If you want the inline version directly here, use this:

```javascript
const WEBHOOK_SECRET = 'NZiL9CL0HKSW+ZM2d2O2zIdB1wFi/g3q++jp/k8R1qvMBvtU+5v+RZoJbPIONZE1';
const SENDER_NAME = 'Tours Market Support';
const VERSION_TAG = 'gas-password-reset-v2';

function doPost(e) {
  const rawBody = e && e.postData && e.postData.contents ? e.postData.contents : '';
  const params = e && e.parameter ? e.parameter : {};
  const timestamp = String(params.ta_ts || '');
  const signature = String(params.ta_sig || '');

    if (!rawBody || !timestamp || !signature) {
      console.log(JSON.stringify({ ok: false, version: VERSION_TAG, reason: 'missing_signature_material' }));
      return textResponse_('Missing signature material');
  }

    const expected = signTravelAgent_(WEBHOOK_SECRET, timestamp + '.' + rawBody);
  if (expected !== signature) {
      console.log(JSON.stringify({ ok: false, version: VERSION_TAG, reason: 'signature_mismatch' }));
      return textResponse_('Unauthorized');
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (error) {
      console.log(JSON.stringify({ ok: false, version: VERSION_TAG, reason: 'invalid_json', error: String(error) }));
      return textResponse_('Error: ' + String(error));
  }

    const recipient = stringOrEmpty_(payload && payload.recipient && payload.recipient.email);
    const subject = stringOrEmpty_(payload && payload.email_content && payload.email_content.subject) || 'Reset your TravelAgent password';
    const textBody = stringOrEmpty_(payload && payload.email_content && payload.email_content.text);
    const htmlBody = stringOrEmpty_(payload && payload.email_content && payload.email_content.html);

    if (!recipient || !subject || (!textBody && !htmlBody)) {
      console.log(JSON.stringify({ ok: false, version: VERSION_TAG, reason: 'invalid_payload' }));
      return textResponse_('Invalid payload');
  }

  GmailApp.sendEmail(recipient, subject, textBody || 'Please open the HTML version of this email.', {
      htmlBody: htmlBody || textBody,
      name: SENDER_NAME,
  });

    console.log(JSON.stringify({ ok: true, version: VERSION_TAG, event: payload.event || null, event_id: payload.event_id || null, recipient: recipient }));
    return textResponse_('Success');
}

function signTravelAgent_(secret, message) {
  const bytes = Utilities.computeHmacSha256Signature(message, secret);
  return bytes.map(function(byte) {
    const normalized = byte < 0 ? byte + 256 : byte;
    return ('0' + normalized.toString(16)).slice(-2);
  }).join('');
}

function stringOrEmpty_(value) {
  return value == null ? '' : String(value).trim();
}

function textResponse_(message) {
  return ContentService
    .createTextOutput(message)
    .setMimeType(ContentService.MimeType.TEXT);
}
```

## Query params sent by the Worker

The Worker now duplicates signature metadata into the webhook URL query string specifically for Apps Script compatibility:

- `ta_event`
- `ta_event_id`
- `ta_ts`
- `ta_sig_v`
- `ta_sig`

That means your Apps Script receiver can verify the request without relying on custom header access.

## Deploy checklist

1. Create a brand-new Apps Script project.
2. Paste the code from [docs/google-apps-script-password-reset-webhook.gs](/Users/nguyennhathai/projects/travel-agent-management/docs/google-apps-script-password-reset-webhook.gs).
3. Deploy as Web App.
4. Set `Execute as: Me`.
5. Set `Who has access: Anyone`.
6. Choose `New version` when deploying.
7. Copy the new `/macros/s/.../exec` URL.

## Notes from live rollout

- The old `/a/macros/<domain>/...` URL variant was not suitable for the Worker because Google redirected it through domain login
- The production outage during initial live testing was partly due to a missing remote D1 migration; `0034_password_reset_tokens.sql` had to be applied remotely before forgot-password could work on live
- The first several Apps Script deployments failed because the live Web App version did not actually match the editor code; creating a brand-new Apps Script project and deploying a fresh `/macros/s/.../exec` Web App was the clean fix