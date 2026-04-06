const MARKET_SKINS = Object.freeze([
  {
    key: 'global-default',
    label: 'Global English',
    primary_market: 'GLOBAL',
    default_locale: 'en-US',
    booking_currency: 'USD',
    theme_variant: 'tour-luxury',
    ui_locale: 'en',
  },
  {
    key: 'vietnam-domestic',
    label: 'Vietnam Domestic',
    primary_market: 'VN',
    default_locale: 'vi-VN',
    booking_currency: 'VND',
    theme_variant: 'tour-luxury',
    ui_locale: 'vi',
  },
  {
    key: 'china-outbound',
    label: 'China Outbound',
    primary_market: 'CN',
    default_locale: 'zh-CN',
    booking_currency: 'CNY',
    theme_variant: 'tour-luxury-riviera',
    ui_locale: 'zh',
  },
  {
    key: 'japan-premium',
    label: 'Japan Premium',
    primary_market: 'JP',
    default_locale: 'ja-JP',
    booking_currency: 'JPY',
    theme_variant: 'tour-luxury',
    ui_locale: 'ja',
  },
  {
    key: 'korea-premium',
    label: 'Korea Premium',
    primary_market: 'KR',
    default_locale: 'ko-KR',
    booking_currency: 'KRW',
    theme_variant: 'tour-luxury',
    ui_locale: 'ko',
  },
  {
    key: 'uk-curated',
    label: 'United Kingdom',
    primary_market: 'GB',
    default_locale: 'en-GB',
    booking_currency: 'GBP',
    theme_variant: 'tour-luxury-riviera',
    ui_locale: 'en-GB',
  },
  {
    key: 'australia-outbound',
    label: 'Australia Outbound',
    primary_market: 'AU',
    default_locale: 'en-AU',
    booking_currency: 'AUD',
    theme_variant: 'tour-luxury-riviera',
    ui_locale: 'en-AU',
  },
  {
    key: 'germany-curated',
    label: 'Germany',
    primary_market: 'DE',
    default_locale: 'de-DE',
    booking_currency: 'EUR',
    theme_variant: 'tour-luxury-riviera',
    ui_locale: 'de',
  },
  {
    key: 'france-curated',
    label: 'France',
    primary_market: 'FR',
    default_locale: 'fr-FR',
    booking_currency: 'EUR',
    theme_variant: 'tour-luxury-riviera',
    ui_locale: 'fr',
  },
  {
    key: 'spain-curated',
    label: 'Spain',
    primary_market: 'ES',
    default_locale: 'es-ES',
    booking_currency: 'EUR',
    theme_variant: 'tour-luxury-riviera',
    ui_locale: 'es',
  },
]);

const MARKET_SKIN_MAP = new Map(MARKET_SKINS.map((entry) => [entry.key, entry]));

export function getMarketSkinCatalog() {
  return MARKET_SKINS.map((entry) => ({ ...entry }));
}

export function isSupportedMarketSkin(key) {
  return MARKET_SKIN_MAP.has(String(key ?? '').trim());
}

export function getMarketSkin(key) {
  return MARKET_SKIN_MAP.get(String(key ?? '').trim()) ?? MARKET_SKINS[0];
}