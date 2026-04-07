// src/utils/formatter.js
// I18n helpers for locale lookup, translation, and formatting.

import vi from '../locales/vi.json';
import en from '../locales/en.json';
import zh from '../locales/zh.json';
import ja from '../locales/ja.json';
import ko from '../locales/ko.json';
import de from '../locales/de.json';
import fr from '../locales/fr.json';
import es from '../locales/es.json';
import enGb from '../locales/en-gb.json';
import enAu from '../locales/en-au.json';

// ── Translation registry ──────────────────────────────────────────────────────
const LOCALES = {
  en,
  'en-GB': enGb,
  'en-AU': enAu,
  vi,
  zh,
  ja,
  ko,
  de,
  fr,
  es,
};

const LOCALE_ALIASES = {
  en: 'en',
  'en-us': 'en',
  'en-gb': 'en-GB',
  'en-au': 'en-AU',
  vi: 'vi',
  'vi-vn': 'vi',
  zh: 'zh',
  'zh-cn': 'zh',
  'zh-hans': 'zh',
  ja: 'ja',
  'ja-jp': 'ja',
  ko: 'ko',
  'ko-kr': 'ko',
  de: 'de',
  'de-de': 'de',
  fr: 'fr',
  'fr-fr': 'fr',
  es: 'es',
  'es-es': 'es',
};

const SUPPORTED_LOCALES = Object.freeze(['en', 'en-GB', 'en-AU', 'vi', 'zh', 'ja', 'ko', 'de', 'fr', 'es']);

export function getSupportedLocales() {
  return [...SUPPORTED_LOCALES];
}

export function normalizeLocale(lang) {
  const fallback = 'en';
  if (!lang) return fallback;

  const normalized = String(lang).trim().replace(/_/g, '-').toLowerCase();
  if (LOCALE_ALIASES[normalized]) return LOCALE_ALIASES[normalized];

  const base = normalized.split('-')[0];
  return LOCALE_ALIASES[base] || fallback;
}

export function getLocaleMessages(lang = 'en') {
  return LOCALES[normalizeLocale(lang)] ?? LOCALES.en;
}

// ── Currency config ───────────────────────────────────────────────────────────
// Locale mặc định cho từng mã tiền tệ
const CURRENCY_LOCALE = {
  VND: 'vi-VN',
  USD: 'en-US',
  EUR: 'de-DE',
  GBP: 'en-GB',
  THB: 'th-TH',
  JPY: 'ja-JP',
  KRW: 'ko-KR',
  AUD: 'en-AU',
  SGD: 'en-SG',
};

// Tiền tệ không dùng số thập phân (theo chuẩn quốc tế ISO 4217)
const ZERO_DECIMAL_CURRENCIES = new Set(['VND', 'JPY', 'KRW']);

// Cache formatter để tránh tạo lại mỗi lần gọi (Intl objects khá nặng)
const _moneyCache = new Map();
const _dateCache  = new Map();

// ── 1. formatMoney ────────────────────────────────────────────────────────────
/**
 * Định dạng số thành chuỗi tiền tệ theo locale và mã tiền.
 * Nếu `exchangeRate` được cung cấp, `amount` (USD) sẽ được quy đổi trước khi hiển thị.
 *
 * @example
 *   formatMoney(100, 'en-US', 'USD')           // "$100.00"
 *   formatMoney(100, 'vi-VN', 'VND', 25450)    // "2.545.000 ₫"
 *
 * @param {number}  amount
 * @param {string}  locale       - BCP 47, ví dụ 'vi-VN', 'en-US'
 * @param {string}  currency     - ISO 4217, ví dụ 'VND', 'USD'
 * @param {number}  [exchangeRate=1] - tỷ giá quy đổi từ USD
 * @returns {string}
 */
export function formatMoney(amount, locale, currency, exchangeRate = 1) {
  if (amount == null || isNaN(amount)) return '';

  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(currency);
  const raw = amount * exchangeRate;

  // Kế toán VN: làm tròn đến nghìn đồng gần nhất
  const converted = isZeroDecimal ? Math.round(raw / 1000) * 1000 : raw;

  const cacheKey = `${locale}:${currency}`;
  if (!_moneyCache.has(cacheKey)) {
    _moneyCache.set(cacheKey, new Intl.NumberFormat(locale, {
      style:                 'currency',
      currency,
      minimumFractionDigits: isZeroDecimal ? 0 : 2,
      maximumFractionDigits: isZeroDecimal ? 0 : 2,
    }));
  }

  return _moneyCache.get(cacheKey).format(converted);
}

// ── 2. formatDateTime ─────────────────────────────────────────────────────────
/**
 * Định dạng ngày tháng theo locale.
 * Hỗ trợ: Date object, UNIX timestamp (giây — cách D1 lưu), hoặc ISO string.
 *
 * @example
 *   formatDateTime(1711324800, 'vi-VN')   // "25/03/2026"
 *   formatDateTime(1711324800, 'en-US')   // "03/25/2026"
 *   formatDateTime(new Date(), 'ja-JP', { dateStyle: 'long' })
 *
 * @param {Date|number|string}            date
 * @param {string}                        locale   - BCP 47
 * @param {Intl.DateTimeFormatOptions}    [options]
 * @returns {string}
 */
export function formatDateTime(date, locale, options) {
  if (date == null) return '';

  // D1 lưu INTEGER seconds — nhân 1000 để ra milliseconds
  const ts = typeof date === 'number' ? date * 1000 : date;
  const d  = date instanceof Date ? date : new Date(ts);
  if (isNaN(d.getTime())) return '';

  const opts     = options ?? { year: 'numeric', month: '2-digit', day: '2-digit' };
  const cacheKey = `${locale}:${JSON.stringify(opts)}`;

  if (!_dateCache.has(cacheKey)) {
    _dateCache.set(cacheKey, new Intl.DateTimeFormat(locale, opts));
  }

  return _dateCache.get(cacheKey).format(d);
}

// ── 3. translate ──────────────────────────────────────────────────────────────
/**
 * Lấy chuỗi bản địa hóa theo key dạng dot-notation.
 * Hỗ trợ placeholder {{variable}} để thay thế động.
 * Nếu không tìm thấy, fallback sang 'en', sau đó trả về key gốc.
 *
 * @example
 *   translate('pricing.no_price_found', 'vi')          // "Không tìm thấy mức giá phù hợp"
 *   translate('error.missing_fields', 'en', { fields: 'name, code' })
 *   // "Missing required fields: name, code"
 *
 * @param {string} key           - dot notation, ví dụ 'error.missing_fields'
 * @param {string} [lang='en']   - 'vi' | 'en'
 * @param {Record<string,string>} [vars={}] - placeholder values
 * @returns {string}
 */
export function translate(key, lang = 'en', vars = {}) {
  const dict  = getLocaleMessages(lang);
  const parts = key.split('.');

  let node = dict;
  for (const part of parts) {
    if (node == null || typeof node !== 'object') { node = undefined; break; }
    node = node[part];
  }

  // Fallback sang 'en' nếu không tìm thấy trong ngôn ngữ yêu cầu
  if (typeof node !== 'string' && lang !== 'en') {
    return translate(key, 'en', vars);
  }

  const str = typeof node === 'string' ? node : key;

  // Thay thế placeholder {{variable}}
  return str.replace(/\{\{(\w+)\}\}/g, (_, name) => vars[name] ?? `{{${name}}}`);
}

// ── 4. enrichPrice / enrichPricesObject (dùng nội bộ bởi pricing.js) ─────────
// Formatter USD tĩnh để tái sử dụng
const _usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD',
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

/**
 * Enrich một giá USD thành dual-currency object dựa trên cấu hình tenant.
 *
 * @param {number|null} amountUSD
 * @param {{ exchange_rate?: number, target_currency?: string }} tenantConfig
 * @returns {{ price_usd, formatted_price_usd, price_XXX?, formatted_price_XXX? }}
 */
export function enrichPrice(amountUSD, tenantConfig) {
  const { exchange_rate = 1, target_currency = 'USD' } = tenantConfig ?? {};

  if (amountUSD == null) {
    return { price_usd: null, formatted_price_usd: null };
  }

  const result = {
    price_usd:           amountUSD,
    formatted_price_usd: _usdFormatter.format(amountUSD),
  };

  if (target_currency && target_currency !== 'USD' && exchange_rate > 0) {
    const locale         = CURRENCY_LOCALE[target_currency] ?? 'en-US';
    const isZeroDecimal  = ZERO_DECIMAL_CURRENCIES.has(target_currency);
    const raw            = amountUSD * exchange_rate;
    const amount         = isZeroDecimal ? Math.round(raw / 1000) * 1000 : raw;
    const key            = target_currency.toLowerCase();

    result[`price_${key}`]           = amount;
    result[`formatted_price_${key}`] = formatMoney(amountUSD, locale, target_currency, exchange_rate);
  }

  return result;
}

/**
 * Enrich toàn bộ prices object từ calculateTourPrice sang dual-currency.
 *
 * @param {{ adult_shared_room, adult_single_room, child_shared_with_parents }} prices
 * @param {{ exchange_rate?: number, target_currency?: string }} tenantConfig
 */
export function enrichPricesObject(prices, tenantConfig) {
  return {
    adult_shared_room:         enrichPrice(prices.adult_shared_room, tenantConfig),
    adult_single_room:         enrichPrice(prices.adult_single_room, tenantConfig),
    child_shared_with_parents: enrichPrice(prices.child_shared_with_parents, tenantConfig),
  };
}

// ── 5. toUserDate ─────────────────────────────────────────────────────────────
/**
 * Chuyển đổi timestamp sang { year, month, day } theo múi giờ của Tenant.
 *
 * QUAN TRỌNG: Luôn dùng hàm này khi so sánh ngày với Season boundaries
 * (start_month/start_day, end_month/end_day). KHÔNG dùng `new Date()` trực tiếp
 * vì server chạy UTC — ngày của Agent/Khách hàng tại Asia/Ho_Chi_Minh có thể
 * khác ngày UTC tới ±1 ngày.
 *
 * @example
 *   // Tenant tại VN, lúc 23:30 UTC ngày 25/03 → ngày thực tế là 26/03
 *   toUserDate(Date.now(), 'Asia/Ho_Chi_Minh')
 *   // → { year: 2026, month: 3, day: 26 }
 *
 *   // Dùng trong kiểm tra Season:
 *   const { month, day } = toUserDate(Date.now(), tenant.timezone);
 *   const inSeason = seasons.find(s =>
 *     (month * 100 + day) >= (s.start_month * 100 + s.start_day) &&
 *     (month * 100 + day) <= (s.end_month * 100 + s.end_day)
 *   );
 *
 * @param {Date|number|string} timestamp  - Date, UNIX ms, UNIX seconds (D1), hoặc ISO string
 * @param {string}             timezone   - IANA timezone, ví dụ 'Asia/Ho_Chi_Minh', 'America/New_York'
 * @returns {{ year: number, month: number, day: number }}
 */
export function toUserDate(timestamp, timezone) {
  // D1 lưu INTEGER seconds — phân biệt với ms bằng ngưỡng năm 3001
  const ts = (typeof timestamp === 'number' && timestamp < 32503680000)
    ? timestamp * 1000
    : timestamp;

  const d = timestamp instanceof Date ? timestamp : new Date(ts);
  if (isNaN(d.getTime())) throw new RangeError(`toUserDate: invalid timestamp "${timestamp}"`);

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone:  timezone,
    year:      'numeric',
    month:     'numeric',
    day:       'numeric',
  }).formatToParts(d);

  const get = (type) => parseInt(parts.find(p => p.type === type)?.value ?? '0', 10);

  return { year: get('year'), month: get('month'), day: get('day') };
}

// ── 6. dualPrice ──────────────────────────────────────────────────────────────
/**
 * Builds a USD-primary dual-currency price object for invoice line items.
 * USD is always the source of truth and is shown first; local currency is
 * appended when the tenant's display_currency differs from USD.
 *
 * @example
 *   dualPrice(450, { display_currency: 'VND', exchange_rate: 25450, locale: 'vi-VN' })
 *   // {
 *   //   amount: 450, currency: 'USD', formatted: '$450.00',
 *   //   local: { amount: 11452500, currency: 'VND', formatted: '11.452.500 ₫' }
 *   // }
 *
 * @param {number|null} amountUSD
 * @param {{ exchange_rate?: number, display_currency?: string, locale?: string }} tenantConfig
 * @returns {{ amount: number, currency: 'USD', formatted: string, local?: { amount, currency, formatted } }}
 */
export function dualPrice(amountUSD, tenantConfig) {
  const { exchange_rate = 1, display_currency = 'USD', locale = 'en-US' } = tenantConfig ?? {};
  const amt = amountUSD ?? 0;

  const result = {
    amount:    amt,
    currency:  'USD',
    formatted: _usdFormatter.format(amt),
  };

  if (display_currency && display_currency !== 'USD' && exchange_rate > 0) {
    const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(display_currency);
    const raw           = amt * exchange_rate;
    const localAmount   = isZeroDecimal ? Math.round(raw / 1000) * 1000 : raw;

    result.local = {
      amount:    localAmount,
      currency:  display_currency,
      formatted: formatMoney(amt, locale, display_currency, exchange_rate),
    };
  }

  return result;
}

// ── 7. resolveLocaleFromAcceptLanguage ────────────────────────────────────────
/**
 * Parses an HTTP Accept-Language header and returns the best-match supported
 * locale code. Falls back to 'en' when no supported language is found.
 *
 * Supported languages are derived from the keys in the LOCALES registry,
 * so adding a new locale file automatically extends detection.
 *
 * @example
 *   resolveLocaleFromAcceptLanguage('fr-FR,fr;q=0.9,en;q=0.8') // 'en'
 *   resolveLocaleFromAcceptLanguage('vi,en;q=0.8')              // 'vi'
 *   resolveLocaleFromAcceptLanguage(null)                       // 'en'
 *
 * @param {string|null} acceptLang - Value of the Accept-Language request header
 * @returns {string} Supported locale code ('en', 'vi', ...)
 */
export function resolveLocaleFromAcceptLanguage(acceptLang) {
  if (!acceptLang) return 'en';

  const supported = getSupportedLocales();

  // Parse "fr-FR,fr;q=0.9,en;q=0.8" → sorted [['fr-FR', 0.9], ['fr', 0.9], ['en', 0.8]]
  const langs = acceptLang
    .split(',')
    .map(part => {
      const [tag, q] = part.trim().split(';q=');
      return [tag.trim(), q ? parseFloat(q) : 1.0];
    })
    .sort((a, b) => b[1] - a[1]);

  for (const [lang] of langs) {
    const normalized = normalizeLocale(lang);
    if (supported.includes(normalized)) return normalized;
  }
  return 'en';
}
