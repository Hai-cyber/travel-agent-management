/**
 * TravelAgent webhook receiver for Google Apps Script.
 * Handles: password_reset.requested, booking.created, booking.proof_uploaded, booking.confirmed
 *
 * Deploy as a Web App with:
 * - Execute as: Me
 * - Who has access: Anyone
 *
 * Replace WEBHOOK_SECRET with the exact same value stored in
 * Cloudflare Worker secret PASSWORD_RESET_WEBHOOK_SECRET.
 */

const WEBHOOK_SECRET = 'NZiL9CL0HKSW+ZM2d2O2zIdB1wFi/g3q++jp/k8R1qvMBvtU+5v+RZoJbPIONZE1';
const SENDER_NAME = 'Tours Market';
// SENDER_EMAIL: must be a verified "Send As" alias in the account running this script,
// OR leave as '' to send from the default account email.
const SENDER_EMAIL = 'info@tours-market.com';
const VERSION_TAG = 'gas-booking-mailer-v1';

function doPost(e) {
  try {
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

    const data = JSON.parse(rawBody);
    const event = stringOrEmpty_(data && data.event);
    const recipient = stringOrEmpty_(data && data.recipient && data.recipient.email);
    const subject = stringOrEmpty_(data && data.email_content && data.email_content.subject);
    const textBody = stringOrEmpty_(data && data.email_content && data.email_content.text);
    const htmlBody = stringOrEmpty_(data && data.email_content && data.email_content.html);

    if (!recipient || !subject || (!textBody && !htmlBody)) {
      console.log(JSON.stringify({ ok: false, version: VERSION_TAG, reason: 'invalid_payload', event: event }));
      return textResponse_('Invalid payload');
    }

    const mailOptions = {
      htmlBody: htmlBody || textBody,
      name: SENDER_NAME,
    };
    if (SENDER_EMAIL) {
      mailOptions.from = SENDER_EMAIL;
    }

    GmailApp.sendEmail(
      recipient,
      subject,
      textBody || 'Please open the HTML version of this email.',
      mailOptions
    );

    console.log(JSON.stringify({
      ok: true,
      version: VERSION_TAG,
      event: event,
      event_id: stringOrEmpty_(data.event_id),
      recipient: recipient,
    }));

    return textResponse_('Success');
  } catch (error) {
    console.log(JSON.stringify({ ok: false, version: VERSION_TAG, reason: 'exception', error: String(error) }));
    return textResponse_('Error: ' + String(error));
  }
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