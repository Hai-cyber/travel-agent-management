const SUPPORTED_TENANT_CURRENCIES = Object.freeze([
  { code: 'USD', label: 'US Dollar', locale: 'en-US', symbol: '$' },
  { code: 'EUR', label: 'Euro', locale: 'de-DE', symbol: '€' },
  { code: 'VND', label: 'Vietnamese Dong', locale: 'vi-VN', symbol: '₫' },
  { code: 'CNY', label: 'Chinese Yuan', locale: 'zh-CN', symbol: '¥' },
  { code: 'JPY', label: 'Japanese Yen', locale: 'ja-JP', symbol: '¥' },
  { code: 'KRW', label: 'South Korean Won', locale: 'ko-KR', symbol: '₩' },
  { code: 'GBP', label: 'British Pound', locale: 'en-GB', symbol: '£' },
  { code: 'AUD', label: 'Australian Dollar', locale: 'en-AU', symbol: 'A$' },
  { code: 'SGD', label: 'Singapore Dollar', locale: 'en-SG', symbol: 'S$' },
  { code: 'THB', label: 'Thai Baht', locale: 'th-TH', symbol: '฿' },
]);

const SUPPORTED_TENANT_CURRENCY_CODES = new Set(
  SUPPORTED_TENANT_CURRENCIES.map((entry) => entry.code)
);

export function getTenantCurrencyCatalog() {
  return SUPPORTED_TENANT_CURRENCIES.map((entry) => ({ ...entry }));
}

export function isSupportedTenantCurrency(code) {
  return SUPPORTED_TENANT_CURRENCY_CODES.has(String(code ?? '').trim().toUpperCase());
}

export function getDefaultTenantCurrencyCode() {
  return 'USD';
}