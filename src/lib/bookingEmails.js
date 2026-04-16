/**
 * bookingEmails.js
 * Dispatches booking lifecycle emails via the GAS webhook (PASSWORD_RESET_WEBHOOK_URL).
 * Reuses the same signed delivery contract as password reset emails.
 *
 * Supported events:
 *   booking.created          → guest confirmation + payment instructions
 *   booking.proof_uploaded   → agent notification (proof received, action required)
 *   booking.confirmed        → guest confirmation (booking locked in)
 */

const WEBHOOK_USER_AGENT = 'travel-agent-booking-email/1.0';

// ── Core HMAC helper (duplicated from onboarding.js to keep lib self-contained) ─
async function hmacSha256Hex(secret, payload) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');
}

function esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Low-level dispatch — mirrors dispatchPasswordResetLink() contract exactly ──
async function dispatchWebhook(env, { event, tenantId, recipientEmail, emailContent, bookingData, platformBaseUrl }) {
  const webhookUrl    = String(env.PASSWORD_RESET_WEBHOOK_URL    || '').trim();
  const webhookSecret = String(env.PASSWORD_RESET_WEBHOOK_SECRET || '').trim();

  if (!webhookUrl) {
    console.warn(`[BOOKING_EMAIL] PASSWORD_RESET_WEBHOOK_URL not set — email not sent for event=${event}`);
    return { ok: false, reason: 'webhook_not_configured' };
  }
  if (!recipientEmail) {
    console.warn(`[BOOKING_EMAIL] No recipient for event=${event}, skipping`);
    return { ok: false, reason: 'no_recipient' };
  }

  const eventId   = crypto.randomUUID();
  const timestamp = Math.floor(Date.now() / 1000);

  const payload = {
    event,
    event_id:    eventId,
    occurred_at: timestamp,
    tenant_id:   tenantId,
    locale:      'vi',
    recipient:   { email: recipientEmail },
    booking:     bookingData ?? {},
    email_content: emailContent,
    source: {
      app:      'travel-agent-management',
      base_url: platformBaseUrl || null,
    },
  };

  const payloadText = JSON.stringify(payload)
    // GAS reads the POST body with Latin-1/ISO-8859-1 encoding when computing HMAC.
    // Any non-ASCII chars (Vietnamese names, em-dashes, etc.) produce different bytes
    // on GAS side vs Worker side, causing signature mismatch. Escape all non-ASCII
    // to \uXXXX so only ASCII bytes are transported. JSON.parse on GAS side will
    // correctly decode them back to the original Unicode chars before sending email.
    .replace(/[\u0080-\uFFFF]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

  try {
    const destinationUrl = new URL(webhookUrl);
    const headers = {
      'Content-Type':             'application/json',
      'User-Agent':               WEBHOOK_USER_AGENT,
      'X-TravelAgent-Event':      event,
      'X-TravelAgent-Event-Id':   eventId,
      'X-TravelAgent-Timestamp':  String(timestamp),
    };

    destinationUrl.searchParams.set('ta_event',    event);
    destinationUrl.searchParams.set('ta_event_id', eventId);
    destinationUrl.searchParams.set('ta_ts',       String(timestamp));

    let signature = '';
    if (webhookSecret) {
      const _enc = new TextEncoder();
      const _key = await crypto.subtle.importKey('raw', _enc.encode(webhookSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      signature = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', _key, _enc.encode(`${timestamp}.${payloadText}`)))).map(b => b.toString(16).padStart(2, '0')).join('');
      headers['X-TravelAgent-Signature'] = `v1=${signature}`;
      destinationUrl.searchParams.set('ta_sig_v', 'v1');
      destinationUrl.searchParams.set('ta_sig',   signature);
    }

    const res = await fetch(destinationUrl.toString(), { method: 'POST', headers, body: payloadText });
    const resText = await res.text().catch(() => '');

    if (!res.ok) {
      console.warn(`[BOOKING_EMAIL] webhook http error event=${event} status=${res.status} body=${resText.slice(0, 200)}`);
      return { ok: false, status: res.status, gas_body: resText.slice(0, 200) };
    }

    // GAS always returns HTTP 200 — check body text for actual success
    const success = resText.trim() === 'Success';
    if (!success) {
      console.warn(`[BOOKING_EMAIL] GAS rejected event=${event} to=${recipientEmail} gas_body="${resText.slice(0, 300)}"`);
      return { ok: false, gas_body: resText.slice(0, 300) };
    }

    console.info(`[BOOKING_EMAIL] sent event=${event} to=${recipientEmail} event_id=${eventId}`);
    return { ok: true, event_id: eventId };
  } catch (err) {
    console.warn(`[BOOKING_EMAIL] dispatch exception event=${event}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

// ── Format currency for display ───────────────────────────────────────────────
function fmtAmount(amount) {
  return parseFloat(amount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Format unix timestamp to readable date ────────────────────────────────────
function fmtDeadline(unixSeconds) {
  if (!unixSeconds) return '';
  return new Date(unixSeconds * 1000).toUTCString();
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Email 1 — booking.created
 * Sent to the GUEST immediately after order is placed.
 * Includes payment instructions (bank transfer deadline or instant payment note).
 */
export async function dispatchBookingCreatedEmail(env, {
  orderId, tenantId, tenantName,
  tourTitle, travelDate, segmentName, paxSummary,
  grandTotal, currency,
  paymentMethod, deadlineUnix, deadlineHours,
  guestName, guestEmail,
  guestPortalUrl,
  platformBaseUrl,
}) {
  const name     = guestName  || 'there';
  const tour     = tourTitle  || `Order #${String(orderId).slice(0, 8).toUpperCase()}`;
  const agent    = tenantName || 'Tours Market';
  const total    = `${fmtAmount(grandTotal)} ${currency || 'USD'}`;
  const portalUrl = guestPortalUrl || '#';

  const isBankTransfer = paymentMethod === 'BANK_TRANSFER';
  const isArrival      = paymentMethod === 'PAY_ON_ARRIVAL';

  let paymentInstructions = '';
  let paymentInstructionsHtml = '';

  if (isBankTransfer) {
    paymentInstructions = `Payment required within ${deadlineHours ?? 48} hours.\nDeadline: ${fmtDeadline(deadlineUnix)}\n\nPlease upload your bank transfer receipt at:\n${portalUrl}`;
    paymentInstructionsHtml = `<p><strong>Payment required within ${esc(deadlineHours ?? 48)} hours.</strong><br>Deadline: ${esc(fmtDeadline(deadlineUnix))}</p><p>Please upload your bank transfer receipt at:<br><a href="${esc(portalUrl)}">${esc(portalUrl)}</a></p>`;
  } else if (isArrival) {
    paymentInstructions = `This is a pay-on-arrival booking. Please meet our team at the designated location to complete payment.`;
    paymentInstructionsHtml = `<p>This is a <strong>pay-on-arrival</strong> booking. Please meet our team at the designated location to complete payment.</p>`;
  } else {
    paymentInstructions = `Please complete your payment via ${paymentMethod}. Our team will contact you with further details.`;
    paymentInstructionsHtml = `<p>Please complete your payment via <strong>${esc(paymentMethod)}</strong>. Our team will contact you with further details.</p>`;
  }

  const subject = `Booking received — ${tour} | ${agent}`;

  const text = [
    `Dear ${name},`,
    ``,
    `Thank you for your booking with ${agent}. Here are your booking details:`,
    ``,
    `  Tour:         ${tour}`,
    `  Travel date:  ${travelDate || 'TBD'}`,
    `  Passengers:   ${paxSummary || 'See portal'}`,
    `  Total:        ${total}`,
    `  Payment:      ${paymentMethod}`,
    `  Order ID:     ${String(orderId).slice(0, 8).toUpperCase()}`,
    ``,
    paymentInstructions,
    ``,
    `Check your booking status at: ${portalUrl}`,
    ``,
    `Questions? Reply to this email or contact ${agent}.`,
    ``,
    `Best regards,`,
    `${agent} Team`,
  ].join('\n');

  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b">
<div style="background:#1d4ed8;padding:24px;border-radius:8px 8px 0 0">
  <h1 style="color:#fff;margin:0;font-size:22px">Booking Received</h1>
  <p style="color:#bfdbfe;margin:4px 0 0">${esc(agent)}</p>
</div>
<div style="background:#f8fafc;padding:24px;border:1px solid #e2e8f0;border-top:none">
  <p>Dear <strong>${esc(name)}</strong>,</p>
  <p>Thank you for your booking. Here are your details:</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:8px 0;color:#64748b;width:40%">Tour</td><td style="padding:8px 0;font-weight:600">${esc(tour)}</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:8px 0;color:#64748b">Travel date</td><td style="padding:8px 0">${esc(travelDate || 'TBD')}</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:8px 0;color:#64748b">Passengers</td><td style="padding:8px 0">${esc(paxSummary || 'See portal')}</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:8px 0;color:#64748b">Total</td><td style="padding:8px 0;font-weight:600;font-size:18px;color:#1d4ed8">${esc(total)}</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:8px 0;color:#64748b">Payment</td><td style="padding:8px 0">${esc(paymentMethod)}</td></tr>
    <tr><td style="padding:8px 0;color:#64748b">Order ID</td><td style="padding:8px 0;font-family:monospace">${esc(String(orderId).slice(0, 8).toUpperCase())}</td></tr>
  </table>
  ${paymentInstructionsHtml}
  <p style="margin-top:24px"><a href="${esc(portalUrl)}" style="background:#1d4ed8;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block">View booking portal</a></p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
  <p style="color:#64748b;font-size:13px">Questions? Reply to this email or contact <strong>${esc(agent)}</strong>.</p>
</div>
</div>`.trim();

  return dispatchWebhook(env, {
    event: 'booking.created',
    tenantId,
    recipientEmail: guestEmail,
    emailContent:   { subject, text, html },
    bookingData: {
      order_id:       orderId,
      tour_title:     tourTitle,
      travel_date:    travelDate,
      grand_total:    grandTotal,
      payment_method: paymentMethod,
    },
    platformBaseUrl,
  });
}

/**
 * Email 2a — booking.new_booking (agent notification)
 * Sent to the AGENT/OWNER immediately after a new booking order is placed.
 */
export async function dispatchNewBookingAgentEmail(env, {
  orderId, tenantId, tenantName,
  agentEmail,
  tourTitle, travelDate, segmentName, paxSummary,
  grandTotal, currency,
  paymentMethod,
  guestName, guestEmail, guestPhone,
  dashboardUrl,
  platformBaseUrl,
}) {
  if (!agentEmail) {
    console.warn(`[BOOKING_EMAIL] No agent email for tenant=${tenantId}, new_booking notification skipped`);
    return { ok: false, reason: 'no_agent_email' };
  }

  const agent    = tenantName || 'Tours Market';
  const tour     = tourTitle  || `Order #${String(orderId).slice(0, 8).toUpperCase()}`;
  const total    = `${fmtAmount(grandTotal)} ${currency || 'USD'}`;
  const ordShort = String(orderId).slice(0, 8).toUpperCase();
  const manageUrl = dashboardUrl || '#';
  const isBankTransfer = paymentMethod === 'BANK_TRANSFER';

  const subject = `New booking received — ${tour} | ${ordShort}`;

  const text = [
    `Hi ${agent} team,`,
    ``,
    `A new booking has been placed on your platform. Here are the details:`,
    ``,
    `  Order ID:     ${ordShort}`,
    `  Tour:         ${tour}`,
    `  Travel date:  ${travelDate || 'TBD'}`,
    `  Segment:      ${segmentName || 'N/A'}`,
    `  Passengers:   ${paxSummary || 'See dashboard'}`,
    `  Total:        ${total}`,
    `  Payment:      ${paymentMethod}`,
    ``,
    `Guest identity: LOCKED — will be revealed in your dashboard after you confirm receipt of payment.`,
    ``,
    isBankTransfer
      ? `The guest will upload their bank transfer proof within 48 hours. You will receive another email when the proof is uploaded.`
      : `Please follow up with the guest to complete the booking process.`,
    ``,
    `View and manage this booking:`,
    manageUrl,
    ``,
    `– Tours Market Platform`,
  ].join('\n');

  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b">
<div style="background:#1d4ed8;padding:24px;border-radius:8px 8px 0 0">
  <h1 style="color:#fff;margin:0;font-size:20px">New Booking Received</h1>
  <p style="color:#bfdbfe;margin:4px 0 0">${esc(agent)}</p>
</div>
<div style="background:#f8fafc;padding:24px;border:1px solid #e2e8f0;border-top:none">
  <p>Hi <strong>${esc(agent)}</strong> team,</p>
  <p>A new booking has been placed. Here are the details:</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:8px 0;color:#64748b;width:40%">Order ID</td><td style="padding:8px 0;font-family:monospace;font-weight:600">${esc(ordShort)}</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:8px 0;color:#64748b">Tour</td><td style="padding:8px 0;font-weight:600">${esc(tour)}</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:8px 0;color:#64748b">Travel date</td><td style="padding:8px 0">${esc(travelDate || 'TBD')}</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:8px 0;color:#64748b">Segment</td><td style="padding:8px 0">${esc(segmentName || 'N/A')}</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:8px 0;color:#64748b">Passengers</td><td style="padding:8px 0">${esc(paxSummary || 'See dashboard')}</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:8px 0;color:#64748b">Total</td><td style="padding:8px 0;font-weight:600;font-size:18px;color:#1d4ed8">${esc(total)}</td></tr>
    <tr><td style="padding:8px 0;color:#64748b">Payment</td><td style="padding:8px 0">${esc(paymentMethod)}</td></tr>
  </table>
  <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:16px;margin:16px 0">
    <p style="margin:0 0 4px;font-weight:600;color:#92400e">🔒 Guest identity is locked</p>
    <p style="margin:0;font-size:13px;color:#78350f">For privacy protection, guest name, email and phone are hidden until you confirm receipt of payment in your dashboard. Once confirmed, full guest details will be visible there.</p>
  </div>
  ${isBankTransfer
    ? `<p style="background:#fef9c3;border:1px solid #fde047;border-radius:6px;padding:12px;color:#854d0e">⏳ Awaiting bank transfer proof from guest (48h deadline). You will be notified when they upload it.</p>`
    : `<p>Please follow up with the guest to complete the booking process.</p>`}
  <p><a href="${esc(manageUrl)}" style="background:#1d4ed8;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block">View booking dashboard</a></p>
</div>
</div>`.trim();

  return dispatchWebhook(env, {
    event: 'booking.new_booking',
    tenantId,
    recipientEmail: agentEmail,
    emailContent:   { subject, text, html },
    bookingData: {
      order_id:       orderId,
      tour_title:     tourTitle,
      travel_date:    travelDate,
      grand_total:    grandTotal,
      payment_method: paymentMethod,
    },
    platformBaseUrl,
  });
}

/**
 * Email 2 — booking.proof_uploaded
 * Sent to the AGENT when a guest uploads proof of bank transfer.
 */
export async function dispatchProofUploadedEmail(env, {
  orderId, tenantId,
  agentEmail, agentName,
  tourTitle, travelDate,
  grandTotal, currency,
  dashboardUrl,
  platformBaseUrl,
}) {
  if (!agentEmail) {
    console.warn(`[BOOKING_EMAIL] No agent email for tenant=${tenantId}, proof_uploaded skipped`);
    return { ok: false, reason: 'no_agent_email' };
  }

  const agent = agentName || 'there';
  const tour  = tourTitle  || `Order #${String(orderId).slice(0, 8).toUpperCase()}`;
  const total = `${fmtAmount(grandTotal)} ${currency || 'USD'}`;
  const ordShort = String(orderId).slice(0, 8).toUpperCase();
  const manageUrl = dashboardUrl || '#';

  const subject = `Action required: Payment proof received — Order #${ordShort}`;

  const text = [
    `Hi ${agent},`,
    ``,
    `A guest has uploaded their bank transfer proof for the following booking:`,
    ``,
    `  Order ID:     ${ordShort}`,
    `  Tour:         ${tour}`,
    `  Travel date:  ${travelDate || 'TBD'}`,
    `  Total:        ${total}`,
    ``,
    `Please review the proof and confirm receipt to unlock the guest identity:`,
    manageUrl,
    ``,
    `– Tours Market Platform`,
  ].join('\n');

  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b">
<div style="background:#0f172a;padding:24px;border-radius:8px 8px 0 0">
  <h1 style="color:#fff;margin:0;font-size:20px">Payment Proof Received</h1>
  <p style="color:#94a3b8;margin:4px 0 0">Action required — Tours Market Platform</p>
</div>
<div style="background:#f8fafc;padding:24px;border:1px solid #e2e8f0;border-top:none">
  <p>Hi <strong>${esc(agent)}</strong>,</p>
  <p>A guest has uploaded their bank transfer proof. Please review and confirm receipt.</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:8px 0;color:#64748b;width:40%">Order ID</td><td style="padding:8px 0;font-family:monospace;font-weight:600">${esc(ordShort)}</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:8px 0;color:#64748b">Tour</td><td style="padding:8px 0">${esc(tour)}</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:8px 0;color:#64748b">Travel date</td><td style="padding:8px 0">${esc(travelDate || 'TBD')}</td></tr>
    <tr><td style="padding:8px 0;color:#64748b">Amount</td><td style="padding:8px 0;font-weight:600;color:#1d4ed8">${esc(total)}</td></tr>
  </table>
  <p style="background:#fef9c3;border:1px solid #fde047;border-radius:6px;padding:12px;color:#854d0e">
    ⚠️ Guest identity is locked until you confirm receipt. Review the uploaded proof, then click below.
  </p>
  <p><a href="${esc(manageUrl)}" style="background:#0f172a;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block">Go to booking dashboard</a></p>
</div>
</div>`.trim();

  return dispatchWebhook(env, {
    event: 'booking.proof_uploaded',
    tenantId,
    recipientEmail: agentEmail,
    emailContent:   { subject, text, html },
    bookingData: {
      order_id:    orderId,
      tour_title:  tourTitle,
      travel_date: travelDate,
      grand_total: grandTotal,
    },
    platformBaseUrl,
  });
}

/**
 * Email 3 — booking.confirmed
 * Sent to the GUEST after the agent calls confirm-receipt.
 */
export async function dispatchBookingConfirmedEmail(env, {
  orderId, tenantId, tenantName,
  guestName, guestEmail,
  tourTitle, travelDate, segmentName, paxSummary,
  grandTotal, currency,
  platformBaseUrl,
}) {
  const name  = guestName  || 'there';
  const tour  = tourTitle  || `Order #${String(orderId).slice(0, 8).toUpperCase()}`;
  const agent = tenantName || 'Tours Market';
  const total = `${fmtAmount(grandTotal)} ${currency || 'USD'}`;

  const subject = `Booking confirmed! ${tour} — ${travelDate || 'See details'}`;

  const text = [
    `Dear ${name},`,
    ``,
    `Great news! Your booking has been confirmed by ${agent}.`,
    ``,
    `  Tour:         ${tour}`,
    `  Travel date:  ${travelDate || 'TBD'}`,
    `  Passengers:   ${paxSummary || 'See details'}`,
    `  Total paid:   ${total}`,
    `  Order ID:     ${String(orderId).slice(0, 8).toUpperCase()}`,
    ``,
    `Please keep this email as your booking confirmation.`,
    `If you have any questions, please reply to this email or contact ${agent} directly.`,
    ``,
    `We look forward to seeing you on the tour!`,
    ``,
    `Best regards,`,
    `${agent} Team`,
  ].join('\n');

  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b">
<div style="background:#15803d;padding:24px;border-radius:8px 8px 0 0">
  <h1 style="color:#fff;margin:0;font-size:22px">✓ Booking Confirmed!</h1>
  <p style="color:#bbf7d0;margin:4px 0 0">${esc(agent)}</p>
</div>
<div style="background:#f8fafc;padding:24px;border:1px solid #e2e8f0;border-top:none">
  <p>Dear <strong>${esc(name)}</strong>,</p>
  <p>Great news! Your booking has been confirmed by <strong>${esc(agent)}</strong>.</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:8px 0;color:#64748b;width:40%">Tour</td><td style="padding:8px 0;font-weight:600">${esc(tour)}</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:8px 0;color:#64748b">Travel date</td><td style="padding:8px 0;font-weight:600">${esc(travelDate || 'TBD')}</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:8px 0;color:#64748b">Passengers</td><td style="padding:8px 0">${esc(paxSummary || 'See details')}</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:8px 0;color:#64748b">Total paid</td><td style="padding:8px 0;font-weight:600;font-size:18px;color:#15803d">${esc(total)}</td></tr>
    <tr><td style="padding:8px 0;color:#64748b">Order ID</td><td style="padding:8px 0;font-family:monospace">${esc(String(orderId).slice(0, 8).toUpperCase())}</td></tr>
  </table>
  <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:16px;margin:16px 0">
    <p style="margin:0;color:#15803d;font-weight:600">Please keep this email as your booking confirmation.</p>
  </div>
  <p>We look forward to seeing you on the tour! If you have any questions, please reply to this email or contact <strong>${esc(agent)}</strong>.</p>
</div>
</div>`.trim();

  return dispatchWebhook(env, {
    event: 'booking.confirmed',
    tenantId,
    recipientEmail: guestEmail,
    emailContent:   { subject, text, html },
    bookingData: {
      order_id:    orderId,
      tour_title:  tourTitle,
      travel_date: travelDate,
      grand_total: grandTotal,
    },
    platformBaseUrl,
  });
}

// ── Contact form → info@tours-market.com ──────────────────────────────────────
export async function dispatchContactFormEmail(env, { name, email, type, message }) {
  const subject = `[Contact Form] ${esc(type || 'General')} — from ${esc(name)}`;
  const text = `Name: ${name}\nEmail: ${email}\nType: ${type}\n\n${message}`;
  const html = `<div style="font-family:sans-serif;max-width:600px">
<h2 style="color:#0f172a">New contact form submission</h2>
<table style="width:100%;border-collapse:collapse;margin:16px 0">
  <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:8px 0;color:#64748b;width:30%">Name</td><td style="padding:8px 0;font-weight:600">${esc(name)}</td></tr>
  <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:8px 0;color:#64748b">Email</td><td style="padding:8px 0"><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
  <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:8px 0;color:#64748b">Type</td><td style="padding:8px 0">${esc(type)}</td></tr>
</table>
<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px;margin:16px 0;white-space:pre-wrap">${esc(message)}</div>
<p style="color:#64748b;font-size:13px">Sent from tours-market.com contact form</p>
</div>`.trim();

  const infoEmail = 'info@tours-market.com';
  return dispatchWebhook(env, {
    event: 'contact.form',
    tenantId: 'platform',
    recipientEmail: infoEmail,
    emailContent: { subject, text, html },
    bookingData: { sender_name: name, sender_email: email, contact_type: type },
    platformBaseUrl: env.PLATFORM_BASE_URL || 'https://tours-market.com',
  });
}

// ── Billing payment confirmed email ───────────────────────────────────────────
// Sent to the tenant owner when a Stripe invoice.payment_succeeded event fires.
export async function dispatchBillingPaymentEmail(env, { tenantId, tenantName, tenantEmail, amountFormatted, periodEnd, invoiceUrl }) {
  const subject = `Payment confirmed — Tours Market subscription`;
  const periodEndStr = periodEnd ? new Date(periodEnd * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
  const text = `Hi ${tenantName || 'there'},\n\nYour payment of ${amountFormatted || 'your subscription fee'} has been received.\nNext billing date: ${periodEndStr}.\n${invoiceUrl ? `\nView invoice: ${invoiceUrl}` : ''}\n\nThank you for using Tours Market.\ninfo@tours-market.com`;
  const html = `<div style="font-family:sans-serif;max-width:600px">
<h2 style="color:#0f172a">Payment confirmed ✓</h2>
<p style="color:#475569;margin-top:8px">Hi ${esc(tenantName || 'there')},</p>
<p style="color:#475569">Your Tours Market subscription payment has been received successfully.</p>
<table style="width:100%;border-collapse:collapse;margin:20px 0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">
  <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:12px 16px;color:#64748b;width:45%">Amount paid</td><td style="padding:12px 16px;font-weight:700;color:#0f172a">${esc(amountFormatted || '—')}</td></tr>
  <tr><td style="padding:12px 16px;color:#64748b">Next billing date</td><td style="padding:12px 16px;color:#0f172a">${esc(periodEndStr)}</td></tr>
</table>
${invoiceUrl ? `<p style="margin:20px 0"><a href="${esc(invoiceUrl)}" style="background:#2563eb;color:#fff;padding:10px 22px;border-radius:999px;text-decoration:none;font-weight:700;font-size:13px">Download invoice</a></p>` : ''}
<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
<p style="color:#64748b;font-size:13px">To manage your subscription or update your payment method, visit your dashboard billing section.</p>
<p style="color:#64748b;font-size:13px">Questions? Reply to <a href="mailto:info@tours-market.com">info@tours-market.com</a></p>
</div>`.trim();

  return dispatchWebhook(env, {
    event: 'billing.payment_succeeded',
    tenantId: tenantId || 'platform',
    recipientEmail: tenantEmail,
    emailContent: { subject, text, html },
    bookingData: { amount: amountFormatted, period_end: periodEndStr },
    platformBaseUrl: env.PLATFORM_BASE_URL || 'https://tours-market.com',
  });
}

// ── Billing: subscription activated (first payment) ───────────────────────────
export async function dispatchBillingActivationEmail(env, { tenantId, tenantName, tenantEmail }) {
  const dashUrl = `${(env.PLATFORM_BASE_URL || 'https://tours-market.com').replace(/\/$/, '')}/dashboard.html`;
  const subject = `You're now on Tours Market Pro 🎉`;
  const text = [
    `Hi ${tenantName || 'there'},`,
    ``,
    `Welcome to Tours Market Pro! Your subscription is now active.`,
    ``,
    `You have full access to all platform features:`,
    `  • Unlimited tours and bookings`,
    `  • Custom domain support`,
    `  • Priority support`,
    ``,
    `Head to your dashboard to continue building your tour business:`,
    dashUrl,
    ``,
    `Thank you for choosing Tours Market.`,
    `— The Tours Market Team`,
  ].join('\n');
  const html = `<div style="font-family:sans-serif;max-width:600px">
<div style="background:#1d4ed8;padding:24px;border-radius:8px 8px 0 0">
  <h1 style="color:#fff;margin:0;font-size:22px">Welcome to Tours Market Pro 🎉</h1>
</div>
<div style="background:#f8fafc;padding:24px;border:1px solid #e2e8f0;border-top:none">
  <p>Hi <strong>${esc(tenantName || 'there')}</strong>,</p>
  <p>Your subscription is now <strong style="color:#15803d">active</strong>. You have full access to all platform features.</p>
  <ul style="color:#475569;line-height:1.8">
    <li>Unlimited tours and bookings</li>
    <li>Custom domain support</li>
    <li>Priority support</li>
  </ul>
  <p style="margin:20px 0"><a href="${esc(dashUrl)}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:700;font-size:14px">Go to Dashboard →</a></p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
  <p style="color:#64748b;font-size:13px">Questions? Reply to <a href="mailto:info@tours-market.com">info@tours-market.com</a></p>
</div>
</div>`.trim();

  return dispatchWebhook(env, {
    event: 'billing.activated',
    tenantId: tenantId || 'platform',
    recipientEmail: tenantEmail,
    emailContent: { subject, text, html },
    bookingData: {},
    platformBaseUrl: env.PLATFORM_BASE_URL || 'https://tours-market.com',
  });
}

// ── Billing: subscription status change (SUSPENDED or CANCELLED) ──────────────
export async function dispatchBillingStatusEmail(env, { tenantId, tenantName, tenantEmail, status }) {
  const dashUrl = `${(env.PLATFORM_BASE_URL || 'https://tours-market.com').replace(/\/$/, '')}/dashboard.html`;

  const isSuspended = status === 'SUSPENDED';
  const subject = isSuspended
    ? `Action required — Tours Market account suspended`
    : `Tours Market subscription cancelled`;

  const text = isSuspended
    ? [
        `Hi ${tenantName || 'there'},`,
        ``,
        `Your Tours Market account has been suspended due to a payment failure.`,
        ``,
        `To restore access, please update your payment method:`,
        `${dashUrl}`,
        ``,
        `If you believe this is an error, contact us at info@tours-market.com.`,
      ].join('\n')
    : [
        `Hi ${tenantName || 'there'},`,
        ``,
        `Your Tours Market subscription has been cancelled.`,
        ``,
        `Your data is safe and you can reactivate at any time by logging in:`,
        `${dashUrl}`,
        ``,
        `Questions? Contact us at info@tours-market.com.`,
      ].join('\n');

  const html = isSuspended
    ? `<div style="font-family:sans-serif;max-width:600px">
<div style="background:#dc2626;padding:24px;border-radius:8px 8px 0 0">
  <h1 style="color:#fff;margin:0;font-size:22px">⚠️ Account Suspended</h1>
</div>
<div style="background:#f8fafc;padding:24px;border:1px solid #e2e8f0;border-top:none">
  <p>Hi <strong>${esc(tenantName || 'there')}</strong>,</p>
  <p>Your account has been suspended due to a <strong>payment failure</strong>. Tour booking pages are temporarily offline.</p>
  <p>To restore access immediately, update your payment method:</p>
  <p style="margin:20px 0"><a href="${esc(dashUrl)}" style="background:#dc2626;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:700;font-size:14px">Update Payment Method →</a></p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
  <p style="color:#64748b;font-size:13px">If you believe this is an error, reply to this email or contact <a href="mailto:info@tours-market.com">info@tours-market.com</a>.</p>
</div>
</div>`.trim()
    : `<div style="font-family:sans-serif;max-width:600px">
<div style="background:#64748b;padding:24px;border-radius:8px 8px 0 0">
  <h1 style="color:#fff;margin:0;font-size:22px">Subscription Cancelled</h1>
</div>
<div style="background:#f8fafc;padding:24px;border:1px solid #e2e8f0;border-top:none">
  <p>Hi <strong>${esc(tenantName || 'there')}</strong>,</p>
  <p>Your Tours Market subscription has been cancelled. Your data is safe and your account is preserved.</p>
  <p>If you'd like to continue, you can reactivate at any time:</p>
  <p style="margin:20px 0"><a href="${esc(dashUrl)}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:700;font-size:14px">Reactivate Account →</a></p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
  <p style="color:#64748b;font-size:13px">Questions? Contact us at <a href="mailto:info@tours-market.com">info@tours-market.com</a>.</p>
</div>
</div>`.trim();

  return dispatchWebhook(env, {
    event: isSuspended ? 'billing.suspended' : 'billing.cancelled',
    tenantId: tenantId || 'platform',
    recipientEmail: tenantEmail,
    emailContent: { subject, text, html },
    bookingData: {},
    platformBaseUrl: env.PLATFORM_BASE_URL || 'https://tours-market.com',
  });
}

// ── Billing: trial expiry reminder ────────────────────────────────────────────
export async function dispatchTrialReminderEmail(env, { tenantId, tenantName, tenantEmail, daysLeft, expired }) {
  const dashUrl = `${(env.PLATFORM_BASE_URL || 'https://tours-market.com').replace(/\/$/, '')}/dashboard.html`;
  const subject = expired
    ? `Your Tours Market trial has ended`
    : `Your Tours Market trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;

  const urgency = daysLeft <= 1 ? '#dc2626' : daysLeft <= 7 ? '#d97706' : '#1d4ed8';

  const text = expired
    ? [
        `Hi ${tenantName || 'there'},`,
        ``,
        `Your 180-day free trial has ended. Subscribe to continue using Tours Market:`,
        dashUrl,
        ``,
        `Your data is safe — subscribe at any time to restore full access.`,
        ``,
        `info@tours-market.com`,
      ].join('\n')
    : [
        `Hi ${tenantName || 'there'},`,
        ``,
        `Your Tours Market free trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`,
        ``,
        `Subscribe now to avoid any interruption to your service:`,
        dashUrl,
        ``,
        `info@tours-market.com`,
      ].join('\n');

  const html = `<div style="font-family:sans-serif;max-width:600px">
<div style="background:${urgency};padding:24px;border-radius:8px 8px 0 0">
  <h1 style="color:#fff;margin:0;font-size:22px">${expired ? 'Trial Ended' : `Trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`}</h1>
</div>
<div style="background:#f8fafc;padding:24px;border:1px solid #e2e8f0;border-top:none">
  <p>Hi <strong>${esc(tenantName || 'there')}</strong>,</p>
  ${expired
    ? `<p>Your 180-day free trial has ended. Subscribe to restore full access to Tours Market.</p>`
    : `<p>Your free trial ends in <strong>${daysLeft} day${daysLeft === 1 ? '' : 's'}</strong>. Subscribe now to keep your tours live and continue accepting bookings.</p>`}
  <p style="margin:20px 0"><a href="${esc(dashUrl)}" style="background:${urgency};color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:700;font-size:14px">Subscribe Now →</a></p>
  <p style="color:#64748b;font-size:13px">Your data is safe. You can subscribe at any time.</p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
  <p style="color:#64748b;font-size:13px">Questions? Reply to <a href="mailto:info@tours-market.com">info@tours-market.com</a>.</p>
</div>
</div>`.trim();

  return dispatchWebhook(env, {
    event: expired ? 'billing.trial_expired' : 'billing.trial_reminder',
    tenantId: tenantId || 'platform',
    recipientEmail: tenantEmail,
    emailContent: { subject, text, html },
    bookingData: { days_left: daysLeft, expired },
    platformBaseUrl: env.PLATFORM_BASE_URL || 'https://tours-market.com',
  });
}

// ── Admin alert (internal — sent to info@tours-market.com) ───────────────────
export async function dispatchAdminAlertEmail(env, { subject, bodyText, bodyHtml }) {
  const adminEmail = 'info@tours-market.com';
  const html = bodyHtml || `<div style="font-family:sans-serif;max-width:600px"><pre style="background:#f8fafc;padding:16px;border-radius:8px;font-size:13px">${esc(bodyText || '')}</pre></div>`;
  return dispatchWebhook(env, {
    event: 'admin.alert',
    tenantId: 'platform',
    recipientEmail: adminEmail,
    emailContent: { subject, text: bodyText || subject, html },
    bookingData: {},
    platformBaseUrl: env.PLATFORM_BASE_URL || 'https://tours-market.com',
  });
}
