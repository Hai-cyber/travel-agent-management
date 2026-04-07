import { normalizeLocale, translate } from '../utils/formatter.js';

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
const MARKET_SKIN_LABEL_KEYS = Object.freeze({
  'global-default': 'market_skins.labels.global_default',
  'vietnam-domestic': 'market_skins.labels.vietnam_domestic',
  'china-outbound': 'market_skins.labels.china_outbound',
  'japan-premium': 'market_skins.labels.japan_premium',
  'korea-premium': 'market_skins.labels.korea_premium',
  'uk-curated': 'market_skins.labels.uk_curated',
  'australia-outbound': 'market_skins.labels.australia_outbound',
  'germany-curated': 'market_skins.labels.germany_curated',
  'france-curated': 'market_skins.labels.france_curated',
  'spain-curated': 'market_skins.labels.spain_curated',
});

const MARKET_SKIN_LABEL_FALLBACKS = Object.freeze({
  'en-GB': {
    'global-default': 'Global English',
    'vietnam-domestic': 'Vietnam Domestic',
    'china-outbound': 'China Outbound',
    'japan-premium': 'Japan Premium',
    'korea-premium': 'Korea Premium',
    'uk-curated': 'United Kingdom',
    'australia-outbound': 'Australia Outbound',
    'germany-curated': 'Germany',
    'france-curated': 'France',
    'spain-curated': 'Spain',
  },
  'en-AU': {
    'global-default': 'Global English',
    'vietnam-domestic': 'Vietnam Domestic',
    'china-outbound': 'China Outbound',
    'japan-premium': 'Japan Premium',
    'korea-premium': 'Korea Premium',
    'uk-curated': 'United Kingdom',
    'australia-outbound': 'Australia Outbound',
    'germany-curated': 'Germany',
    'france-curated': 'France',
    'spain-curated': 'Spain',
  },
  ja: {
    'global-default': 'グローバル英語',
    'vietnam-domestic': 'ベトナム国内',
    'china-outbound': '中国アウトバウンド',
    'japan-premium': '日本プレミアム',
    'korea-premium': '韓国プレミアム',
    'uk-curated': '英国キュレーション',
    'australia-outbound': 'オーストラリアアウトバウンド',
    'germany-curated': 'ドイツキュレーション',
    'france-curated': 'フランスキュレーション',
    'spain-curated': 'スペインキュレーション',
  },
  ko: {
    'global-default': '글로벌 영어',
    'vietnam-domestic': '베트남 내수',
    'china-outbound': '중국 아웃바운드',
    'japan-premium': '일본 프리미엄',
    'korea-premium': '한국 프리미엄',
    'uk-curated': '영국 큐레이션',
    'australia-outbound': '호주 아웃바운드',
    'germany-curated': '독일 큐레이션',
    'france-curated': '프랑스 큐레이션',
    'spain-curated': '스페인 큐레이션',
  },
  de: {
    'global-default': 'Globales Englisch',
    'vietnam-domestic': 'Vietnam Inland',
    'china-outbound': 'China Outbound',
    'japan-premium': 'Japan Premium',
    'korea-premium': 'Korea Premium',
    'uk-curated': 'Vereinigtes Königreich kuratiert',
    'australia-outbound': 'Australien Outbound',
    'germany-curated': 'Deutschland kuratiert',
    'france-curated': 'Frankreich kuratiert',
    'spain-curated': 'Spanien kuratiert',
  },
  fr: {
    'global-default': 'Anglais global',
    'vietnam-domestic': 'Vietnam domestique',
    'china-outbound': 'Chine outbound',
    'japan-premium': 'Japon premium',
    'korea-premium': 'Corée premium',
    'uk-curated': 'Royaume-Uni curated',
    'australia-outbound': 'Australie outbound',
    'germany-curated': 'Allemagne curated',
    'france-curated': 'France curated',
    'spain-curated': 'Espagne curated',
  },
  es: {
    'global-default': 'Inglés global',
    'vietnam-domestic': 'Vietnam doméstico',
    'china-outbound': 'China outbound',
    'japan-premium': 'Japón premium',
    'korea-premium': 'Corea premium',
    'uk-curated': 'Reino Unido curated',
    'australia-outbound': 'Australia outbound',
    'germany-curated': 'Alemania curated',
    'france-curated': 'Francia curated',
    'spain-curated': 'España curated',
  },
});

function localizeMarketSkin(entry, lang = 'en') {
  const locale = normalizeLocale(lang);
  const labelKey = MARKET_SKIN_LABEL_KEYS[entry.key];
  const translated = labelKey ? translate(labelKey, locale) : entry.label;
  const fallbackLabel = MARKET_SKIN_LABEL_FALLBACKS[locale]?.[entry.key];
  return {
    ...entry,
    label: translated === labelKey && fallbackLabel ? fallbackLabel : translated,
  };
}

export function getMarketSkinCatalog(lang = 'en') {
  return MARKET_SKINS.map((entry) => localizeMarketSkin(entry, lang));
}

export function isSupportedMarketSkin(key) {
  return MARKET_SKIN_MAP.has(String(key ?? '').trim());
}

export function getMarketSkin(key) {
  return MARKET_SKIN_MAP.get(String(key ?? '').trim()) ?? MARKET_SKINS[0];
}

export function getMarketSkinLabel(key, lang = 'en') {
  return localizeMarketSkin(getMarketSkin(key), lang).label;
}