// src/lib/notifications.js
// CHK-R27: Smart notification dispatcher for booking events.
//
// Channels supported:
//   1. Telegram Bot API   — real-time push via agent's own bot
//   2. Generic Webhook    — HTTP POST to any URL (Make.com, Zapier, n8n, etc.)
//   3. Console log        — always fires as a fallback audit trail
//
// Configuration is read from tenants.notification_config (JSON TEXT column):
//   {
//     "telegram": { "bot_token": "...", "chat_id": "@channel_or_numeric_id" },
//     "webhook":  { "url": "https://hook.make.com/..." }
//   }
//
// [SEC] Telegram bot tokens and webhook URLs are stored per-tenant, never shared.
// [SEC] All outbound network calls are non-blocking (waitUntil) and fail-silently.
//       A failed notification must NEVER block or roll back a booking transaction.

const PROVIDER_LABELS = {
  CREDIT_CARD: 'Thẻ tín dụng',
  MOMO:        'MoMo',
  ZALOPAY:     'ZaloPay',
  VNPAY:       'VNPay',
  PAYPAL:      'PayPal',
  GRABPAY:     'GrabPay',
  BANK_TRANSFER:  'Chuyển khoản',
  CASH_AT_OFFICE: 'Thanh toán tại văn phòng',
};

/**
 * Dispatch a booking notification to all configured channels for the tenant.
 * Reads notification_config from D1 — call this from within a waitUntil() so it
 * does not block the HTTP response.
 *
 * @param {object} env              Workers environment (must have env.DB)
 * @param {string} tenantId
 * @param {'INSTANT_PAID'|'MANUAL_BOOKING'|'PROOF_UPLOADED'} eventType
 * @param {{ order_id, provider, guest_name, grand_total, tour_id }} payload
 */
export async function notifyAgent(env, tenantId, eventType, payload) {
  // Load config — if the tenant has no notification_config this is a no-op.
  let nCfg = {};
  try {
    const row = await env.DB
      .prepare('SELECT notification_config FROM tenants WHERE id = ?')
      .bind(tenantId)
      .first();
    if (row?.notification_config) nCfg = JSON.parse(row.notification_config);
  } catch (err) {
    console.warn('[NOTIFY_CONFIG_LOAD_ERR]', err.message);
    return;
  }

  const message = buildMessage(eventType, payload);

  // Always log to console — useful for wrangler tail and audit.
  console.info(
    `[NOTIFY] tenant=${tenantId} event=${eventType} order=${payload.order_id} | ${message.replace(/<[^>]*>/g, '')}`
  );

  const tasks = [];

  // ── Telegram ───────────────────────────────────────────────────────────────
  if (nCfg.telegram?.bot_token && nCfg.telegram?.chat_id) {
    tasks.push(
      sendTelegram(nCfg.telegram.bot_token, nCfg.telegram.chat_id, message)
        .catch(err => console.warn('[NOTIFY_TELEGRAM_ERR]', err.message))
    );
  }

  // ── Generic webhook (Make.com / Zapier / n8n / custom) ────────────────────
  if (nCfg.webhook?.url) {
    tasks.push(
      sendWebhook(nCfg.webhook.url, {
        event:       eventType,
        order_id:    payload.order_id,
        provider:    payload.provider ?? null,
        guest_name:  payload.guest_name ?? null,
        grand_total: payload.grand_total ?? null,
        tour_id:     payload.tour_id ?? null,
        message:     message.replace(/<[^>]*>/g, ''),
        tenant_id:   tenantId,
        fired_at:    new Date().toISOString(),
      })
        .catch(err => console.warn('[NOTIFY_WEBHOOK_ERR]', err.message))
    );
  }

  if (tasks.length) await Promise.allSettled(tasks);
}

// ── Channel implementations ───────────────────────────────────────────────────

async function sendTelegram(botToken, chatId, htmlMessage) {
  // [SEC] bot_token is used only as a path segment in the Bot API URL — never logged.
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res  = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id:    chatId,
      text:       htmlMessage,
      parse_mode: 'HTML',
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`Telegram API error: ${err.slice(0, 200)}`);
  }
}

async function sendWebhook(url, payload) {
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Webhook returned HTTP ${res.status}`);
  }
}

// ── Message templates ─────────────────────────────────────────────────────────

function buildMessage(eventType, payload) {
  const { order_id, provider, guest_name, grand_total } = payload;
  const providerLabel = PROVIDER_LABELS[provider] ?? provider ?? 'N/A';
  const usd = grand_total != null ? `$${Number(grand_total).toFixed(2)} USD` : '';

  switch (eventType) {
    case 'INSTANT_PAID':
      return (
        `💰 <b>Tiền tươi!</b> Khách vừa thanh toán qua <b>${providerLabel}</b>, vào nhận data ngay!\n` +
        `📋 Order: <code>${order_id}</code>\n` +
        (usd ? `💵 Tổng: ${usd}\n` : '') +
        (guest_name ? `👤 Khách: ${guest_name}` : '🔒 Danh tính sẽ hiện sau khi xác nhận.')
      );

    case 'MANUAL_BOOKING':
      return (
        `⏳ <b>Kèo chờ!</b> Khách chọn <b>${providerLabel}</b>, dữ liệu khách đang được khóa để bảo vệ bạn.\n` +
        `📋 Order: <code>${order_id}</code>\n` +
        (usd ? `💵 Tổng: ${usd}\n` : '') +
        `🔒 Danh tính sẽ mở khoá khi nhận được biên lai.`
      );

    case 'PROOF_UPLOADED':
      return (
        `📸 <b>Có biên lai mới!</b> Khách vừa tải ảnh chứng minh thanh toán.\n` +
        `📋 Order: <code>${order_id}</code>\n` +
        `✅ Vào xác nhận sớm để mở khoá dữ liệu khách!`
      );

    case 'WEBHOOK_PAID':
      return (
        `🎯 <b>Webhook xác nhận!</b> Giao dịch <b>${providerLabel}</b> thành công.\n` +
        `📋 Order: <code>${order_id}</code>\n` +
        (usd ? `💵 Tổng: ${usd}\n` : '') +
        `🔓 Danh tính khách đã được mở khoá tự động.`
      );

    default:
      return `Event: ${eventType} | Order: ${order_id}`;
  }
}
