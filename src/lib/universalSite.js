import { getSupportedLocales, normalizeLocale, translate } from '../utils/formatter.js';

const GROUP_DEFINITIONS = {
  tour_operator: {
    key: 'tour_operator',
    label: 'Tour Operator',
    entityType: 'tour',
    listingPageKey: 'tours',
    reservationPageKey: 'booking',
  },
  stay_accommodation: {
    key: 'stay_accommodation',
    label: 'Stay Accommodation',
    entityType: 'stay',
    listingPageKey: 'hotels',
    reservationPageKey: 'reservation',
  },
  transport_service: {
    key: 'transport_service',
    label: 'Transport Service',
    entityType: 'transport',
    listingPageKey: 'services',
    reservationPageKey: 'reservation',
  },
};

const GROUP_LABEL_KEYS = Object.freeze({
  tour_operator: 'universal_site.groups.tour_operator',
  stay_accommodation: 'universal_site.groups.stay_accommodation',
  transport_service: 'universal_site.groups.transport_service',
});

const GROUP_LABEL_FALLBACKS = Object.freeze({
  'en-GB': {
    tour_operator: 'Tour Operator',
    stay_accommodation: 'Stay Accommodation',
    transport_service: 'Transport Service',
  },
  'en-AU': {
    tour_operator: 'Tour Operator',
    stay_accommodation: 'Stay Accommodation',
    transport_service: 'Transport Service',
  },
  vi: {
    tour_operator: 'Nha dieu hanh tour',
    stay_accommodation: 'Luu tru',
    transport_service: 'Dich vu van chuyen',
  },
  zh: {
    tour_operator: '行程运营商',
    stay_accommodation: '住宿业务',
    transport_service: '交通服务',
  },
  ja: {
    tour_operator: 'ツアー運営',
    stay_accommodation: '宿泊事業',
    transport_service: '送迎サービス',
  },
  ko: {
    tour_operator: '투어 운영사',
    stay_accommodation: '숙박 업종',
    transport_service: '교통 서비스',
  },
  de: {
    tour_operator: 'Tourveranstalter',
    stay_accommodation: 'Unterkunft',
    transport_service: 'Transportservice',
  },
  fr: {
    tour_operator: 'Operateur de voyages',
    stay_accommodation: 'Hebergement',
    transport_service: 'Service de transport',
  },
  es: {
    tour_operator: 'Operador turistico',
    stay_accommodation: 'Alojamiento',
    transport_service: 'Servicio de transporte',
  },
});

const VARIANT_TRANSLATION_FALLBACKS = Object.freeze({
  'en-GB': {
    tour_adventure: { label: 'Adventure Operator', description: 'Action-forward travel sales with route energy and itinerary depth.' },
    tour_luxury: { label: 'Six Senses Immersive Frame', description: 'Default storefront shell for premium journey brands with Six Senses-style editorial chrome.' },
    tour_luxury_riviera: { label: 'Maison Verenne Riviera Frame', description: 'A brighter coastal luxury variation that keeps the Six Senses shell but shifts the mood toward Mediterranean calm and editorial leisure.' },
    stay_boutique: { label: 'Boutique Stay', description: 'Warm hospitality layout for boutique hotels, guesthouses, and lodges.' },
    stay_resort: { label: 'Luxury Resort', description: 'Large-image layout for resorts and premium accommodation properties.' },
    transfer_private: { label: 'Private Transfer', description: 'Utility-first shell for private transfer and transport service businesses.' },
    tour_expedition: { label: 'Expedition Tour', description: 'Dense route-first storytelling for serious multi-stop itineraries and guided expeditions.' },
    stay_urban: { label: 'Urban Stay', description: 'Compact city-hospitality layout for business hotels and modern apartments.' },
    transfer_city: { label: 'City Transfer', description: 'Fast-response layout for airport, station, and city shuttle services.' },
  },
  'en-AU': {
    tour_adventure: { label: 'Adventure Operator', description: 'Action-forward travel sales with route energy and itinerary depth.' },
    tour_luxury: { label: 'Six Senses Immersive Frame', description: 'Default storefront shell for premium journey brands with Six Senses-style editorial chrome.' },
    tour_luxury_riviera: { label: 'Maison Verenne Riviera Frame', description: 'A brighter coastal luxury variation that keeps the Six Senses shell but shifts the mood toward Mediterranean calm and editorial leisure.' },
    stay_boutique: { label: 'Boutique Stay', description: 'Warm hospitality layout for boutique hotels, guesthouses, and lodges.' },
    stay_resort: { label: 'Luxury Resort', description: 'Large-image layout for resorts and premium accommodation properties.' },
    transfer_private: { label: 'Private Transfer', description: 'Utility-first shell for private transfer and transport service businesses.' },
    tour_expedition: { label: 'Expedition Tour', description: 'Dense route-first storytelling for serious multi-stop itineraries and guided expeditions.' },
    stay_urban: { label: 'Urban Stay', description: 'Compact city-hospitality layout for business hotels and modern apartments.' },
    transfer_city: { label: 'City Transfer', description: 'Fast-response layout for airport, station, and city shuttle services.' },
  },
  ja: {
    tour_adventure: { label: 'アドベンチャーオペレーター', description: 'ルートの勢いと旅程の厚みを前面に出す、アクション志向の販売テンプレート。' },
    tour_luxury: { label: 'Six Senses 没入フレーム', description: 'Six Senses 風のエディトリアル感を備えた、高級旅ブランド向けの既定ストアフロント。' },
    tour_luxury_riviera: { label: 'Maison Verenne Riviera フレーム', description: 'Six Senses の骨格を保ちながら、地中海らしい静けさへ雰囲気を寄せた明るい海辺ラグジュアリー変種。' },
    stay_boutique: { label: 'ブティック滞在', description: 'ブティックホテル、ゲストハウス、ロッジ向けの温かみあるレイアウト。' },
    stay_resort: { label: 'ラグジュアリーリゾート', description: 'リゾートや高級宿泊施設向けの大きなビジュアル重視レイアウト。' },
    transfer_private: { label: 'プライベート送迎', description: '専用送迎や交通サービス事業者向けの utility-first シェル。' },
    tour_expedition: { label: 'エクスペディションツアー', description: '多停泊の本格行程や探検型商品向けに、ルート優先で濃く見せるストーリー構成。' },
    stay_urban: { label: 'アーバン滞在', description: 'ビジネスホテルやモダンアパート向けのコンパクトな都市型ホスピタリティレイアウト。' },
    transfer_city: { label: 'シティ送迎', description: '空港・駅・市内シャトル向けの高速レスポンス型レイアウト。' },
  },
  ko: {
    tour_adventure: { label: '어드벤처 운영사', description: '루트의 에너지와 일정의 깊이를 전면에 내세운 액션 지향형 판매 템플릿입니다.' },
    tour_luxury: { label: 'Six Senses 몰입형 프레임', description: 'Six Senses 스타일의 에디토리얼 감성을 담은 프리미엄 여행 브랜드용 기본 storefront 셸입니다.' },
    tour_luxury_riviera: { label: 'Maison Verenne Riviera 프레임', description: 'Six Senses 셸은 유지하면서 지중해식 여유와 해안 감성으로 톤을 바꾼 밝은 럭셔리 변형입니다.' },
    stay_boutique: { label: '부티크 스테이', description: '부티크 호텔, 게스트하우스, 로지에 맞는 따뜻한 호스피탈리티 레이아웃입니다.' },
    stay_resort: { label: '럭셔리 리조트', description: '리조트와 프리미엄 숙박 자산을 위한 대형 비주얼 중심 레이아웃입니다.' },
    transfer_private: { label: '프라이빗 트랜스퍼', description: '프라이빗 이동 및 교통 서비스 사업자를 위한 utility-first 셸입니다.' },
    tour_expedition: { label: '원정 투어', description: '다구간 일정과 원정형 상품을 위해 경로 논리를 우선시한 밀도 높은 스토리텔링 템플릿입니다.' },
    stay_urban: { label: '어반 스테이', description: '비즈니스 호텔과 현대적인 아파트를 위한 컴팩트한 도심형 숙박 레이아웃입니다.' },
    transfer_city: { label: '시티 트랜스퍼', description: '공항, 역, 도심 셔틀 서비스에 맞춘 빠른 응답형 레이아웃입니다.' },
  },
  de: {
    tour_adventure: { label: 'Adventure Operator', description: 'Verkaufs-Template mit viel Bewegungsenergie, starker Route und tiefer Reisedramaturgie.' },
    tour_luxury: { label: 'Six Senses Immersive Frame', description: 'Standard-Storefront fuer Premium-Reisemarken mit editorieller Anmutung im Stil von Six Senses.' },
    tour_luxury_riviera: { label: 'Maison Verenne Riviera Frame', description: 'Hellere Kuesten-Luxusvariation, die die Six-Senses-Struktur behaelt, aber Richtung mediterraner Ruhe verschiebt.' },
    stay_boutique: { label: 'Boutique Stay', description: 'Warme Hospitality-Struktur fuer Boutique-Hotels, Gaestehaeuser und Lodges.' },
    stay_resort: { label: 'Luxury Resort', description: 'Grossformatiges Bildlayout fuer Resorts und hochwertige Unterkunftsmarken.' },
    transfer_private: { label: 'Private Transfer', description: 'Utility-first-Shell fuer private Transfers und Transportdienstleister.' },
    tour_expedition: { label: 'Expedition Tour', description: 'Routenorientiertes Storytelling fuer ernsthafte mehrtaegige Expeditionen und komplexe Programme.' },
    stay_urban: { label: 'Urban Stay', description: 'Kompaktes Stadt-Hospitality-Layout fuer Businesshotels und moderne Apartments.' },
    transfer_city: { label: 'City Transfer', description: 'Schnelles Layout fuer Flughafen-, Bahnhof- und City-Shuttle-Services.' },
  },
  fr: {
    tour_adventure: { label: 'Adventure Operator', description: 'Template de vente oriente action, avec energie de route et profondeur de parcours.' },
    tour_luxury: { label: 'Six Senses Immersive Frame', description: 'Shell storefront par defaut pour les marques de voyage premium, avec une finition editoriale inspiree de Six Senses.' },
    tour_luxury_riviera: { label: 'Maison Verenne Riviera Frame', description: 'Variation cotiere plus lumineuse qui conserve la structure Six Senses tout en glissant vers une ambiance mediterraneenne.' },
    stay_boutique: { label: 'Boutique Stay', description: 'Mise en page chaleureuse pour boutique-hotels, guesthouses et lodges.' },
    stay_resort: { label: 'Luxury Resort', description: 'Mise en page a grande image pour resorts et hebergements premium.' },
    transfer_private: { label: 'Private Transfer', description: 'Shell utility-first pour les activites de transfert prive et de transport.' },
    tour_expedition: { label: 'Expedition Tour', description: 'Storytelling dense, guide par l itineraire, pour les circuits complexes et les expeditions accompagnees.' },
    stay_urban: { label: 'Urban Stay', description: 'Mise en page urbaine compacte pour hotels d affaires et appartements modernes.' },
    transfer_city: { label: 'City Transfer', description: 'Mise en page a reponse rapide pour navettes d aeroport, de gare et transferts urbains.' },
  },
  es: {
    tour_adventure: { label: 'Adventure Operator', description: 'Plantilla comercial orientada a la accion, con energia de ruta y mas profundidad de itinerario.' },
    tour_luxury: { label: 'Six Senses Immersive Frame', description: 'Shell storefront por defecto para marcas de viaje premium con una capa editorial al estilo Six Senses.' },
    tour_luxury_riviera: { label: 'Maison Verenne Riviera Frame', description: 'Variacion costera mas luminosa que mantiene la base Six Senses pero mueve el tono hacia una calma mediterranea.' },
    stay_boutique: { label: 'Boutique Stay', description: 'Diseno calido para hoteles boutique, guesthouses y lodges.' },
    stay_resort: { label: 'Luxury Resort', description: 'Diseno de gran imagen para resorts y propiedades de alojamiento premium.' },
    transfer_private: { label: 'Private Transfer', description: 'Shell utility-first para negocios de traslados privados y servicios de transporte.' },
    tour_expedition: { label: 'Expedition Tour', description: 'Storytelling denso, guiado por la ruta, para itinerarios serios de varias paradas y expediciones guiadas.' },
    stay_urban: { label: 'Urban Stay', description: 'Diseno compacto de hospitalidad urbana para hoteles de negocios y apartamentos modernos.' },
    transfer_city: { label: 'City Transfer', description: 'Diseno de respuesta rapida para aeropuertos, estaciones y servicios de shuttle urbano.' },
  },
});

const STRONG_LANGUAGE_OPTIONS = [
  { label: 'English', value: 'en' },
  { label: 'English (United Kingdom)', value: 'en-GB' },
  { label: 'English (Australia)', value: 'en-AU' },
  { label: 'Vietnamese', value: 'vi' },
  { label: 'Chinese', value: 'zh' },
  { label: 'Japanese', value: 'ja' },
  { label: 'Korean', value: 'ko' },
  { label: 'German', value: 'de' },
  { label: 'French', value: 'fr' },
  { label: 'Spanish', value: 'es' },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const UNIVERSAL_PAGE_TITLE_KEYS = {
  home: 'universal_site.nav.home',
  tours: 'universal_site.nav.tours',
  destinations: 'universal_site.nav.destinations',
  'featured-tours': 'universal_site.nav.featured_tours',
  accommodation: 'universal_site.nav.accommodation',
  hotels: 'universal_site.nav.hotels',
  services: 'universal_site.nav.services',
  booking: 'universal_site.nav.booking',
  reservation: 'universal_site.nav.reservation',
  'about-us': 'universal_site.nav.about_us',
  'contact-us': 'universal_site.nav.contact_us',
  terms: 'universal_site.nav.terms',
  privacy: 'universal_site.nav.privacy',
  impressum: 'universal_site.nav.impressum',
};

const UNIVERSAL_MENU_ITEM_KEYS = {
  home: 'universal_site.nav.home',
  tours: 'universal_site.nav.tours',
  destinations: 'universal_site.nav.destinations',
  'featured-tours': 'universal_site.nav.featured_tours',
  accommodation: 'universal_site.nav.accommodation',
  hotels: 'universal_site.nav.hotels',
  services: 'universal_site.nav.services',
  booking: 'universal_site.nav.booking',
  reservation: 'universal_site.nav.reservation',
  'about-us': 'universal_site.nav.about_us',
  'contact-us': 'universal_site.nav.contact_us',
};

const UNIVERSAL_CHANNEL_LABEL_KEYS = {
  phone: 'universal_site.channel.phone',
  email: 'universal_site.channel.email',
  whatsapp: 'universal_site.channel.whatsapp',
  zalo: 'universal_site.channel.zalo',
  instagram: 'universal_site.channel.instagram',
  facebook: 'universal_site.channel.facebook',
  youtube: 'universal_site.channel.youtube',
  address: 'universal_site.channel.address',
};

function normalizeSystemText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getUniversalText(key, lang = 'en', vars = {}) {
  return translate(key, normalizeLocale(lang), vars);
}

function localizeGroupDefinition(group, lang = 'en') {
  const translationKey = GROUP_LABEL_KEYS[group?.key];
  const locale = normalizeLocale(lang);
  const translated = translationKey ? getUniversalText(translationKey, locale) : group?.label;
  const fallbackLabel = GROUP_LABEL_FALLBACKS[locale]?.[group?.key];
  return {
    ...group,
    label: translated === translationKey && fallbackLabel ? fallbackLabel : translated,
  };
}

function getVariantLabelKey(variantKey) {
  return `theme_presets.variants.${String(variantKey || '').replace(/-/g, '_')}.label`;
}

function getVariantDescriptionKey(variantKey) {
  return `theme_presets.variants.${String(variantKey || '').replace(/-/g, '_')}.description`;
}

function localizeVariantDefinition(variant, lang = 'en') {
  if (!variant) return null;
  const locale = normalizeLocale(lang);
  const fallback = VARIANT_TRANSLATION_FALLBACKS[locale]?.[String(variant.key || '').replace(/-/g, '_')];
  const labelKey = getVariantLabelKey(variant.key);
  const descriptionKey = getVariantDescriptionKey(variant.key);
  const translatedLabel = getUniversalText(labelKey, locale);
  const translatedDescription = getUniversalText(descriptionKey, locale);
  return {
    ...variant,
    label: translatedLabel === labelKey && fallback?.label ? fallback.label : translatedLabel,
    description: translatedDescription === descriptionKey && fallback?.description ? fallback.description : translatedDescription,
  };
}

function isKnownUniversalDefault(value, key) {
  const target = normalizeSystemText(value);
  if (!target) return true;
  const supported = getSupportedLocales();
  for (const locale of supported) {
    if (normalizeSystemText(getUniversalText(key, locale)) === target) {
      return true;
    }
  }
  return false;
}

function resolveUniversalDefaultValue(currentValue, key, lang = 'en') {
  const localized = getUniversalText(key, lang);
  if (!String(currentValue || '').trim()) return localized;
  return isKnownUniversalDefault(currentValue, key) ? localized : currentValue;
}

function getUniversalPageTitleKey(pageKey, groupKey = 'tour_operator') {
  if (pageKey === 'booking' && groupKey !== 'tour_operator') return 'universal_site.nav.reservation';
  return UNIVERSAL_PAGE_TITLE_KEYS[pageKey] || null;
}

function getUniversalMenuLabelKey(itemKey, pageKey, groupKey = 'tour_operator') {
  if (pageKey) return getUniversalPageTitleKey(pageKey, groupKey);
  return UNIVERSAL_MENU_ITEM_KEYS[itemKey] || null;
}

export function getUniversalSystemCopy(groupKey = 'tour_operator', lang = 'en') {
  const locale = normalizeLocale(lang);
  const listingKey = groupKey === 'stay_accommodation' ? 'hotels' : (groupKey === 'transport_service' ? 'services' : 'tours');
  const reservationKey = groupKey === 'tour_operator' ? 'booking' : 'reservation';
  const t = (key, vars = {}) => getUniversalText(`universal_site.${key}`, locale, vars);
  return {
    locale,
    nav: {
      home: t('nav.home'),
      listing: t(`nav.${listingKey}`),
      destinations: t('nav.destinations'),
      featuredTours: t('nav.featured_tours'),
      accommodation: t('nav.accommodation'),
      reservation: t(`nav.${reservationKey}`),
      aboutUs: t('nav.about_us'),
      contactUs: t('nav.contact_us'),
      terms: t('nav.terms'),
      privacy: t('nav.privacy'),
      impressum: t('nav.impressum'),
      page: t('nav.page'),
    },
    cta: {
      discovery: t('cta.discovery'),
      booking: t('cta.booking'),
      contact: t('cta.contact'),
      viewItinerary: t('cta.view_itinerary'),
      openStandalonePage: t('cta.open_standalone_page'),
      requestQuote: t('cta.request_quote'),
      fastQuote: t('cta.fast_quote'),
      quote: t('cta.quote'),
      planWithConcierge: t('cta.plan_with_concierge'),
    },
    header: {
      viewMap: t('header.view_map'),
      login: t('header.login'),
      openNavigation: t('header.open_navigation'),
      close: t('header.close'),
      curatedMenu: t('header.curated_menu'),
      languageChip: t('header.language_chip'),
    },
    search: {
      destinationLabel: t('search.destination_label'),
      destinationPlaceholder: t('search.destination_placeholder'),
      travelStartsLabel: t('search.travel_starts_label'),
      travelStartsPlaceholder: t('search.travel_starts_placeholder'),
      travelEndsLabel: t('search.travel_ends_label'),
      travelEndsPlaceholder: t('search.travel_ends_placeholder'),
      guestsLabel: t('search.guests_label'),
      guestsPlaceholder: t('search.guests_placeholder'),
      codeLabel: t('search.code_label'),
      codePlaceholder: t('search.code_placeholder'),
      button: t('search.button'),
      emptyKicker: t('search.empty_kicker'),
      noMatchingTitle: t('search.no_matching_title'),
      noMatchingBody: t('search.no_matching_body'),
    },
    footer: {
      getInTouch: t('footer.get_in_touch'),
      follow: t('footer.follow'),
      navFallback: t('footer.nav_fallback'),
      conciergeFallback: t('footer.concierge_fallback'),
      kicker: t('footer.kicker'),
    },
    contact: {
      noChannels: t('contact.no_channels'),
      sendMessage: t('contact.send_message'),
    },
    pricing: {
      from: t('pricing.from'),
      shared: t('pricing.shared'),
      single: t('pricing.single'),
      sharedRoom: t('pricing.shared_room'),
      singleRoom: t('pricing.single_room'),
      spotlightBody: t('pricing.spotlight_body'),
    },
    channel: Object.fromEntries(Object.entries(UNIVERSAL_CHANNEL_LABEL_KEYS).map(([key, translationKey]) => [key, getUniversalText(translationKey, locale)])),
  };
}

export function localizeUniversalPageTitle(title, pageKey, groupKey = 'tour_operator', lang = 'en') {
  const translationKey = getUniversalPageTitleKey(pageKey, groupKey);
  return translationKey ? resolveUniversalDefaultValue(title, translationKey, lang) : title;
}

export function localizeUniversalMenuLabel(label, itemKey, pageKey, groupKey = 'tour_operator', lang = 'en') {
  const translationKey = getUniversalMenuLabelKey(itemKey, pageKey, groupKey);
  return translationKey ? resolveUniversalDefaultValue(label, translationKey, lang) : label;
}

export function localizeUniversalContactLabel(label, channelKey, lang = 'en') {
  const translationKey = UNIVERSAL_CHANNEL_LABEL_KEYS[channelKey];
  return translationKey ? resolveUniversalDefaultValue(label, translationKey, lang) : label;
}

export function localizeUniversalSystemText(currentValue, translationKey, lang = 'en') {
  return resolveUniversalDefaultValue(currentValue, translationKey, lang);
}

export function localizeUniversalContacts(contacts, lang = 'en') {
  const next = clone(contacts || {});
  if (next.contactForm && typeof next.contactForm === 'object') {
    next.contactForm.label = resolveUniversalDefaultValue(next.contactForm.label, 'universal_site.contact.send_message', lang);
  }
  const channels = next.channels && typeof next.channels === 'object' ? next.channels : {};
  for (const [channelKey, channel] of Object.entries(channels)) {
    if (!channel || typeof channel !== 'object') continue;
    channel.label = localizeUniversalContactLabel(channel.label, channelKey, lang);
  }
  return next;
}

export function localizeUniversalPages(pages, groupKey = 'tour_operator', lang = 'en') {
  return (Array.isArray(pages) ? pages : []).map((page) => {
    const localizedTitle = localizeUniversalPageTitle(page.title, page.page_key, groupKey, lang);
    const blocks = (Array.isArray(page.blocks) ? page.blocks : []).map((block) => {
      if (page.page_type !== 'legal' || block?.type !== 'legal') return block;
      return {
        ...block,
        label: localizeUniversalPageTitle(block.label, page.page_key, groupKey, lang),
        content: {
          ...(block.content || {}),
          heading: localizeUniversalPageTitle(block.content?.heading, page.page_key, groupKey, lang),
        },
      };
    });
    return {
      ...page,
      title: localizedTitle,
      blocks,
    };
  });
}

export function localizeUniversalMenuItems(menuItems, groupKey = 'tour_operator', lang = 'en') {
  return (Array.isArray(menuItems) ? menuItems : []).map((item) => ({
    ...item,
    label: localizeUniversalMenuLabel(item.label, item.item_key, item.page_key, groupKey, lang),
  }));
}

function createField(id, label, type, path, extra = {}) {
  return {
    id,
    label,
    type,
    path,
    ...extra,
  };
}

function createEditorGroup(id, label, fields) {
  return { id, label, fields };
}

function createSection(id, type, label, classes, content, dataBindings = {}) {
  return {
    id,
    type,
    label,
    classes,
    content,
    data_bindings: dataBindings,
  };
}

function createHeroSection(config) {
  return createSection(
    'hero',
    'hero',
    'Hero',
    config.classes,
    {
      eyebrow: config.eyebrow,
      headline: config.headline,
      body: config.body,
      primary_cta_label: config.primaryCtaLabel,
      primary_cta_href: config.primaryCtaHref,
      secondary_cta_label: config.secondaryCtaLabel,
      secondary_cta_href: config.secondaryCtaHref,
      hero_image: config.heroImage || '',
    },
    config.dataBindings,
  );
}

function createGallerySection(config) {
  return createSection(
    'gallery',
    'gallery',
    'Gallery',
    config.classes,
    {
      heading: config.heading,
      body: config.body,
      images: config.images || [],
    },
    config.dataBindings,
  );
}

function createFeaturesSection(config) {
  return createSection(
    'features',
    'features',
    'Features',
    config.classes,
    {
      heading: config.heading,
      body: config.body,
      items: config.items || [],
      story_image: config.storyImage || '',
    },
    config.dataBindings,
  );
}

function createContactSection(config) {
  return createSection(
    'contact',
    'contact',
    'Contact',
    config.classes,
    {
      heading: config.heading,
      body: config.body,
    },
    config.dataBindings,
  );
}

function createLegalSection(title) {
  return createSection(
    slugify(title),
    'legal',
    title,
    'py-16 bg-white',
    { heading: title, body: '' },
    { body: { source: `manual.${slugify(title).replace(/-/g, '_')}` } },
  );
}

function createCollectionSection(id, label, heading, body, source) {
  return createSection(
    id,
    'listing',
    label,
    'py-16 bg-white',
    {
      heading,
      body,
    },
    {
      cards: { source, fallback: 'system.empty_listing' },
    },
  );
}

function createStorySection(id, label, heading, body) {
  return createSection(
    id,
    'rich_text',
    label,
    'py-16 bg-white',
    {
      heading,
      body,
    },
    { body: { source: 'manual.body' } },
  );
}

function createTourDetailSections(heroClasses) {
  return [
    createHeroSection({
      classes: heroClasses,
      eyebrow: 'Signature Tour',
      headline: '{{tour.title}}',
      body: '{{tour.summary}}',
      primaryCtaLabel: 'Check availability',
      primaryCtaHref: '#booking-engine',
      secondaryCtaLabel: 'View itinerary',
      secondaryCtaHref: '#itinerary',
      dataBindings: {
        eyebrow: { source: 'tour.duration_text', fallback: 'manual.eyebrow' },
        headline: { source: 'tour.title' },
        body: { source: 'tour.summary' },
        hero_image: { source: 'tour.hero_image' },
      },
    }),
    createGallerySection({
      classes: 'py-16 bg-white',
      heading: 'Route gallery',
      body: 'Curated visuals synced from public tour content.',
      images: [],
      dataBindings: { images: { source: 'tour.gallery_images' } },
    }),
    createSection(
      'about',
      'rich_text',
      'About This Tour',
      'py-16 bg-white',
      {
        heading: 'About this tour',
        body: '',
      },
      { body: { source: 'tour.about_section' } },
    ),
    createFeaturesSection({
      classes: 'py-16 bg-slate-50',
      heading: 'Tour highlights',
      body: 'Highlights can come from content data or be decorated later.',
      items: [],
      dataBindings: { items: { source: 'tour.highlights' } },
    }),
    createSection(
      'itinerary',
      'itinerary',
      'Itinerary',
      'py-16 bg-white',
      {
        heading: 'Detailed itinerary',
        body: 'Ordered itinerary items from the canonical tour stop model.',
        items: [],
      },
      { items: { source: 'tour.itinerary_stops' } },
    ),
    createSection(
      'pricing',
      'pricing_spotlight',
      'Pricing Spotlight',
      'py-16 bg-slate-50',
      {
        heading: 'Pricing overview',
        body: 'Pricing cards are synced from the canonical pricing engine.',
        price_cards: [],
        price_from_label: 'From',
      },
      {
        price_cards: { source: 'tour.pricing_cards' },
        price_from: { source: 'tour.price_from' },
      },
    ),
  ];
}

const COMMON_CONTACT_FIELDS = [
  createField('contact_form_enabled', 'Contact Form Enabled', 'toggle', 'contacts.contactForm.enabled'),
  createField('contact_form_label', 'Contact Form Label', 'text', 'contacts.contactForm.label'),
  createField('phone_enabled', 'Phone Enabled', 'toggle', 'contacts.channels.phone.enabled'),
  createField('phone_value', 'Phone Number', 'text', 'contacts.channels.phone.value'),
  createField('email_enabled', 'Email Enabled', 'toggle', 'contacts.channels.email.enabled'),
  createField('email_value', 'Email Address', 'text', 'contacts.channels.email.value'),
  createField('whatsapp_enabled', 'WhatsApp Enabled', 'toggle', 'contacts.channels.whatsapp.enabled'),
  createField('whatsapp_value', 'WhatsApp URL', 'link', 'contacts.channels.whatsapp.value'),
  createField('zalo_enabled', 'Zalo Enabled', 'toggle', 'contacts.channels.zalo.enabled'),
  createField('zalo_value', 'Zalo URL', 'link', 'contacts.channels.zalo.value'),
  createField('instagram_enabled', 'Instagram Enabled', 'toggle', 'contacts.channels.instagram.enabled'),
  createField('instagram_value', 'Instagram URL', 'link', 'contacts.channels.instagram.value'),
  createField('facebook_enabled', 'Facebook Enabled', 'toggle', 'contacts.channels.facebook.enabled'),
  createField('facebook_value', 'Facebook URL', 'link', 'contacts.channels.facebook.value'),
  createField('youtube_enabled', 'YouTube Enabled', 'toggle', 'contacts.channels.youtube.enabled'),
  createField('youtube_value', 'YouTube URL', 'link', 'contacts.channels.youtube.value'),
  createField('address_enabled', 'Address Enabled', 'toggle', 'contacts.channels.address.enabled'),
  createField('address_value', 'Address', 'text', 'contacts.channels.address.value'),
  createField('address_map_url', 'Address Map URL', 'link', 'contacts.channels.address.mapUrl'),
];

function buildTourVariant(config) {
  return {
    key: config.key,
    groupKey: 'tour_operator',
    label: config.label,
    description: config.description,
    theme: config.theme,
    layoutProfile: config.layoutProfile || {},
    onboardingKeywords: config.onboardingKeywords || [],
    defaultConfig: {
      sections: [
        createHeroSection({
          classes: config.heroClasses,
          eyebrow: config.heroEyebrow,
          headline: config.heroHeadline,
          body: config.heroBody,
          primaryCtaLabel: config.primaryCtaLabel,
          primaryCtaHref: '/tours',
          secondaryCtaLabel: config.secondaryCtaLabel,
          secondaryCtaHref: '/contact-us',
          heroImage: config.heroImage || '',
          dataBindings: {
            headline: { source: 'tour_runtime.featured_tour.title', fallback: 'manual.headline' },
            body: { source: 'tour_runtime.featured_tour.summary', fallback: 'manual.body' },
            hero_image: { source: 'tour_runtime.featured_tour.hero_image', fallback: 'manual.hero_image' },
          },
        }),
        createGallerySection({
          classes: 'py-16 bg-white',
          heading: config.galleryHeading,
          body: config.galleryBody,
          images: config.galleryImages || [],
          dataBindings: { images: { source: 'tour_runtime.featured_collection.gallery_images' } },
        }),
        createFeaturesSection({
          classes: config.featuresClasses,
          heading: config.featuresHeading,
          body: config.featuresBody,
          items: config.featureItems,
          storyImage: config.storyImage || '',
          dataBindings: { items: { source: 'tour_runtime.operator_highlights', fallback: 'manual.items' } },
        }),
        createContactSection({
          classes: config.contactClasses,
          heading: config.contactHeading,
          body: config.contactBody,
          dataBindings: { channels: { source: 'site.contacts' } },
        }),
      ],
      menu_structure: [
        { item_key: 'home', label: 'Home', href: '/', page_key: 'home' },
        { item_key: 'tours', label: config.toursMenuLabel, href: '/tours', page_key: 'tours' },
        { item_key: 'destinations', label: 'Destinations', href: '/destinations', page_key: 'destinations' },
        { item_key: 'featured-tours', label: 'Featured Tours', href: '/featured-tours', page_key: 'featured-tours' },
        { item_key: 'accommodation', label: 'Accommodation', href: '/accommodation', page_key: 'accommodation' },
        { item_key: 'about-us', label: 'About Us', href: '/about-us', page_key: 'about-us' },
        { item_key: 'contact-us', label: 'Contact Us', href: '/contact-us', page_key: 'contact-us' },
      ],
      data_bindings: {
        home_hero: {
          title: 'tours.title',
          summary: 'tours.content_data.hero_desc',
          hero_image: 'tours.content_data.hero_image',
        },
        tour_listing: {
          cards: 'tours[]',
          card_title: 'tours.title',
          card_url: 'tours.slug',
          card_price_from: 'tour_prices.min(adult_shared_room_price, adult_single_room_price)',
        },
        tour_detail: {
          itinerary: 'tour_stops[]',
          pricing_cards: 'tour_prices + pricing_segments + tenant_seasons + pax_bands',
          booking_cta: 'system.booking_engine(tour_id)',
        },
      },
      page_blueprints: {
        home: 'default_sections',
        tours: [
          createCollectionSection('tour-grid', 'Tour Grid', config.listingHeading, config.listingBody, 'tour_runtime.tour_listing'),
        ],
        destinations: [
          createCollectionSection('destination-grid', 'Destination Grid', 'Destinations', 'Show the places you cover, route anchors, and travel mood before a guest drills into a specific itinerary.', 'tour_runtime.destination_listing'),
        ],
        'featured-tours': [
          createCollectionSection('featured-tour-grid', 'Featured Tours', 'Featured Tours', 'Use this page for hero itineraries, seasonal highlights, and higher-priority sales stories.', 'tour_runtime.featured_tours'),
        ],
        accommodation: [
          createStorySection('accommodation-story', 'Accommodation Story', 'Accommodation', 'Use this page to explain hotel standards, room style, stay logic, or lodge partnerships in a cleaner visual section.'),
        ],
        booking: [
          createSection('booking-intro', 'booking_entry', 'Booking Intro', 'py-16 bg-slate-50', {
            heading: 'Booking starts with a real tour',
            body: 'The booking engine stays bound to the real tour and pricing data.',
          }, {
            engine_entry: { source: 'system.booking_engine_index' },
          }),
        ],
        'about-us': [createSection('about-story', 'rich_text', 'About Story', 'py-16 bg-white', {
          heading: config.aboutHeading,
          body: config.aboutBody,
        }, { body: { source: 'manual.body' } })],
        'contact-us': [createContactSection({
          classes: 'py-16 bg-slate-50',
          heading: config.contactPageHeading,
          body: config.contactPageBody,
          dataBindings: { channels: { source: 'site.contacts' } },
        })],
        terms: [createLegalSection('Terms & Conditions')],
        privacy: [createLegalSection('Privacy Policy')],
        impressum: [createLegalSection('Impressum')],
        tour_detail: createTourDetailSections(config.detailHeroClasses),
      },
    },
  };
}

function buildStayVariant(config) {
  return {
    key: config.key,
    groupKey: 'stay_accommodation',
    label: config.label,
    description: config.description,
    theme: config.theme,
    layoutProfile: config.layoutProfile || {},
    onboardingKeywords: config.onboardingKeywords || [],
    defaultConfig: {
      sections: [
        createHeroSection({
          classes: config.heroClasses,
          eyebrow: config.heroEyebrow,
          headline: config.heroHeadline,
          body: config.heroBody,
          primaryCtaLabel: 'View Stays',
          primaryCtaHref: '/hotels',
          secondaryCtaLabel: 'Contact Us',
          secondaryCtaHref: '/contact-us',
          dataBindings: {
            headline: { source: 'stay_runtime.featured_property.name', fallback: 'manual.headline' },
            body: { source: 'stay_runtime.featured_property.summary', fallback: 'manual.body' },
            hero_image: { source: 'stay_runtime.featured_property.hero_image', fallback: 'manual.hero_image' },
          },
        }),
        createGallerySection({
          classes: 'py-16 bg-white',
          heading: config.galleryHeading,
          body: config.galleryBody,
          images: [],
          dataBindings: { images: { source: 'stay_runtime.gallery_images', fallback: 'manual.images' } },
        }),
        createFeaturesSection({
          classes: config.featuresClasses,
          heading: config.featuresHeading,
          body: config.featuresBody,
          items: config.featureItems,
          dataBindings: { items: { source: 'stay_runtime.highlights', fallback: 'manual.items' } },
        }),
        createContactSection({
          classes: config.contactClasses,
          heading: config.contactHeading,
          body: config.contactBody,
          dataBindings: { channels: { source: 'site.contacts' } },
        }),
      ],
      menu_structure: [
        { item_key: 'home', label: 'Home', href: '/', page_key: 'home' },
        { item_key: 'hotels', label: config.listingMenuLabel, href: '/hotels', page_key: 'hotels' },
        { item_key: 'reservation', label: 'Reservation', href: '/reservation', page_key: 'reservation' },
        { item_key: 'about-us', label: 'About Us', href: '/about-us', page_key: 'about-us' },
        { item_key: 'contact-us', label: 'Contact Us', href: '/contact-us', page_key: 'contact-us' },
      ],
      data_bindings: {
        home_hero: {
          title: 'stay.featured.name',
          summary: 'stay.featured.summary',
          hero_image: 'stay.featured.hero_image',
        },
        stay_listing: {
          cards: 'stay_properties[]',
          card_title: 'stay_properties.name',
          card_url: 'stay_properties.slug',
        },
      },
      page_blueprints: {
        home: 'default_sections',
        hotels: [createSection('stay-grid', 'listing', 'Stay Grid', 'py-16 bg-white', {
          heading: config.listingHeading,
          body: config.listingBody,
        }, {
          cards: { source: 'stay_runtime.property_listing' },
        })],
        reservation: [createSection('reservation-intro', 'reservation_entry', 'Reservation Entry', 'py-16 bg-slate-50', {
          heading: 'Reservation engine placeholder',
          body: 'Prepared for a future hospitality reservation system.',
        }, {
          entrypoint: { source: 'system.future_reservation_engine' },
        })],
        'about-us': [createSection('stay-story', 'rich_text', 'Stay Story', 'py-16 bg-white', {
          heading: config.aboutHeading,
          body: config.aboutBody,
        }, { body: { source: 'manual.body' } })],
        'contact-us': [createContactSection({
          classes: 'py-16 bg-slate-50',
          heading: config.contactPageHeading,
          body: config.contactPageBody,
          dataBindings: { channels: { source: 'site.contacts' } },
        })],
        terms: [createLegalSection('Terms & Conditions')],
        privacy: [createLegalSection('Privacy Policy')],
        impressum: [createLegalSection('Impressum')],
      },
    },
  };
}

function buildTransportVariant(config) {
  return {
    key: config.key,
    groupKey: 'transport_service',
    label: config.label,
    description: config.description,
    theme: config.theme,
    layoutProfile: config.layoutProfile || {},
    onboardingKeywords: config.onboardingKeywords || [],
    defaultConfig: {
      sections: [
        createHeroSection({
          classes: config.heroClasses,
          eyebrow: config.heroEyebrow,
          headline: config.heroHeadline,
          body: config.heroBody,
          primaryCtaLabel: 'View Services',
          primaryCtaHref: '/services',
          secondaryCtaLabel: 'Contact Us',
          secondaryCtaHref: '/contact-us',
          dataBindings: {
            headline: { source: 'transport_runtime.featured_service.title', fallback: 'manual.headline' },
            body: { source: 'transport_runtime.featured_service.summary', fallback: 'manual.body' },
            hero_image: { source: 'transport_runtime.featured_service.hero_image', fallback: 'manual.hero_image' },
          },
        }),
        createGallerySection({
          classes: 'py-16 bg-white',
          heading: config.galleryHeading,
          body: config.galleryBody,
          images: [],
          dataBindings: { images: { source: 'transport_runtime.gallery_images', fallback: 'manual.images' } },
        }),
        createFeaturesSection({
          classes: config.featuresClasses,
          heading: config.featuresHeading,
          body: config.featuresBody,
          items: config.featureItems,
          dataBindings: { items: { source: 'transport_runtime.highlights', fallback: 'manual.items' } },
        }),
        createContactSection({
          classes: config.contactClasses,
          heading: config.contactHeading,
          body: config.contactBody,
          dataBindings: { channels: { source: 'site.contacts' } },
        }),
      ],
      menu_structure: [
        { item_key: 'home', label: 'Home', href: '/', page_key: 'home' },
        { item_key: 'services', label: 'Services', href: '/services', page_key: 'services' },
        { item_key: 'reservation', label: 'Reservation', href: '/reservation', page_key: 'reservation' },
        { item_key: 'about-us', label: 'About Us', href: '/about-us', page_key: 'about-us' },
        { item_key: 'contact-us', label: 'Contact Us', href: '/contact-us', page_key: 'contact-us' },
      ],
      data_bindings: {
        home_hero: {
          title: 'transport.featured.title',
          summary: 'transport.featured.summary',
          hero_image: 'transport.featured.hero_image',
        },
        service_listing: {
          cards: 'transport_services[]',
          card_title: 'transport_services.title',
          card_url: 'transport_services.slug',
        },
      },
      page_blueprints: {
        home: 'default_sections',
        services: [createSection('service-grid', 'listing', 'Service Grid', 'py-16 bg-white', {
          heading: config.listingHeading,
          body: config.listingBody,
        }, {
          cards: { source: 'transport_runtime.service_listing' },
        })],
        reservation: [createSection('reservation-intro', 'reservation_entry', 'Reservation Entry', 'py-16 bg-slate-50', {
          heading: 'Reservation engine placeholder',
          body: 'Prepared for a future transport reservation flow.',
        }, {
          entrypoint: { source: 'system.future_reservation_engine' },
        })],
        'about-us': [createSection('service-story', 'rich_text', 'Service Story', 'py-16 bg-white', {
          heading: config.aboutHeading,
          body: config.aboutBody,
        }, { body: { source: 'manual.body' } })],
        'contact-us': [createContactSection({
          classes: 'py-16 bg-slate-50',
          heading: config.contactPageHeading,
          body: config.contactPageBody,
          dataBindings: { channels: { source: 'site.contacts' } },
        })],
        terms: [createLegalSection('Terms & Conditions')],
        privacy: [createLegalSection('Privacy Policy')],
        impressum: [createLegalSection('Impressum')],
      },
    },
  };
}

const VARIANT_DEFINITIONS = [
  buildTourVariant({
    key: 'tour-adventure',
    label: 'Adventure Operator',
    description: 'Action-forward travel sales with route energy and itinerary depth.',
    layoutProfile: {
      shell: 'adventure-split',
      hero: 'split',
      gallery: 'mosaic',
      itinerary: 'timeline',
      pricing: 'cards',
    },
    onboardingKeywords: ['adventure', 'trek', 'hike', 'mountain', 'climb', 'ha giang', 'sapa', 'expedition'],
    theme: {
      colorPrimary: '#0f5a3b',
      colorAccent: '#ee9b00',
      colorSurface: '#f5fbf7',
      colorText: '#173027',
      fontHeading: 'Space Grotesk, sans-serif',
      fontBody: 'Inter, system-ui, sans-serif',
      radius: '18px',
    },
    heroClasses: 'py-24 bg-emerald-950 text-white',
    heroEyebrow: 'Adventure routes',
    heroHeadline: 'Journeys with movement, contrast, and local detail.',
    heroBody: 'Built for operators who sell active routes, dramatic landscapes, and guided discovery.',
    primaryCtaLabel: 'Explore',
    secondaryCtaLabel: 'Talk to an expert',
    galleryHeading: 'Adventure gallery',
    galleryBody: 'Replace images and captions without touching layout bindings.',
    featuresClasses: 'py-16 bg-slate-50',
    featuresHeading: 'Why travelers choose us',
    featuresBody: 'Structured highlights keep the operator promise clear and editable.',
    featureItems: [
      { title: 'Field-tested routes', body: 'Built on the canonical tour builder.' },
      { title: 'Live pricing engine', body: 'Travel pricing stays system-owned and consistent.' },
      { title: 'Fast local contact', body: 'Phone, Zalo, WhatsApp, and contact form are configurable.' },
    ],
    contactClasses: 'py-16 bg-slate-900 text-white',
    contactHeading: 'Plan the route with our team',
    contactBody: 'All contact channels are schema-driven and theme-aware.',
    toursMenuLabel: 'Tours',
    listingHeading: 'Tour collection',
    listingBody: 'All active tours can be listed here with canonical pricing links.',
    aboutHeading: 'About this operator',
    aboutBody: 'Use structured fields to tell the operator story.',
    contactPageHeading: 'Talk to our team',
    contactPageBody: 'Contact form and social channels are schema-driven.',
    detailHeroClasses: 'py-24 bg-emerald-950 text-white',
  }),
  buildTourVariant({
    key: 'tour-luxury',
    label: 'Six Senses Immersive Frame',
    description: 'Default storefront shell for premium journey brands with Six Senses-style editorial chrome.',
    layoutProfile: {
      shell: 'luxury-editorial',
      hero: 'editorial',
      gallery: 'panorama',
      itinerary: 'story-cards',
      pricing: 'sidebar',
      nav: 'drawer',
      hero_motion: 'ken-burns',
      search_panel: 'concierge',
      social_rail: 'right',
    },
    onboardingKeywords: ['luxury', 'premium', 'private', 'exclusive', 'honeymoon', 'resort', 'villa'],
    theme: {
      colorPrimary: '#5a3b27',
      colorAccent: '#d4af73',
      colorSurface: '#fbf6ef',
      colorText: '#34241b',
      fontHeading: 'Cormorant Garamond, serif',
      fontBody: 'Source Sans 3, sans-serif',
      radius: '24px',
    },
    heroImage: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=2200&q=80',
    heroClasses: 'py-24 bg-stone-950 text-white',
    heroEyebrow: 'Signature journeys',
    heroHeadline: 'Travel stories shaped with care and polish.',
    heroBody: 'For curated operators who sell comfort, atmosphere, and elevated detail.',
    primaryCtaLabel: 'Explore',
    secondaryCtaLabel: 'Contact Concierge',
    galleryHeading: 'Signature visual moments',
    galleryBody: 'Large imagery can be replaced while preserving the luxury composition.',
    galleryImages: [
      {
        src: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=2200&q=80',
        alt: 'Hanoi - Ninh Binh',
        caption: 'Ninh Binh - Hanoi',
      },
    ],
    featuresClasses: 'py-16 bg-amber-50',
    featuresHeading: 'Crafted for premium travelers',
    featuresBody: 'Blend operational truth with presentation polish.',
    storyImage: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=2200&q=80',
    featureItems: [
      { title: 'Curated itinerary design', body: 'Grounded in the real tour builder.' },
      { title: 'Transparent rates', body: 'Canonical pricing engine stays in control.' },
      { title: 'Private planning support', body: 'Contacts are configurable per tenant.' },
    ],
    contactClasses: 'py-16 bg-stone-900 text-white',
    contactHeading: 'Speak with our travel desk',
    contactBody: 'Structured contact channels support elegant high-touch funnels.',
    toursMenuLabel: 'Journeys',
    listingHeading: 'Curated journeys',
    listingBody: 'Present premium programs without breaking live data bindings.',
    aboutHeading: 'About this travel house',
    aboutBody: 'Luxury operators can edit this story block safely.',
    contactPageHeading: 'Reach our concierge team',
    contactPageBody: 'Contact, phone, WhatsApp, and Zalo are configurable.',
    detailHeroClasses: 'py-24 bg-stone-950 text-white',
  }),
  buildTourVariant({
    key: 'tour-luxury-riviera',
    label: 'Maison Verenne Riviera Frame',
    description: 'A brighter coastal luxury variation that keeps the Six Senses shell but shifts the mood toward Mediterranean calm and editorial leisure.',
    layoutProfile: {
      shell: 'luxury-editorial',
      hero: 'editorial',
      gallery: 'panorama',
      itinerary: 'story-cards',
      pricing: 'sidebar',
      nav: 'drawer',
      hero_motion: 'ken-burns',
      search_panel: 'concierge',
      social_rail: 'right',
    },
    onboardingKeywords: ['riviera', 'coastal luxury', 'mediterranean', 'editorial stay', 'seaside', 'villa', 'private coast'],
    theme: {
      colorPrimary: '#214b57',
      colorAccent: '#d8a06d',
      colorSurface: '#f6f1ea',
      colorText: '#23353a',
      fontHeading: 'Bodoni Moda, serif',
      fontBody: 'Manrope, sans-serif',
      radius: '22px',
    },
    heroImage: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=2200&q=80',
    heroClasses: 'py-24 bg-slate-950 text-white',
    heroEyebrow: 'Seaside editions',
    heroHeadline: 'Quiet coastal journeys with a slower pulse.',
    heroBody: 'Built for brands that sell sea air, villa privacy, and cinematic pacing without losing operational structure.',
    primaryCtaLabel: 'Explore',
    secondaryCtaLabel: 'Plan A Private Stay',
    galleryHeading: 'Riviera atmosphere',
    galleryBody: 'A brighter preset with shoreline imagery, terrace light, and softer editorial rhythm.',
    galleryImages: [
      {
        src: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=2200&q=80',
        alt: 'Sea horizon at golden hour',
        caption: 'Sea horizon at golden hour',
      },
      {
        src: 'https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?auto=format&fit=crop&w=2200&q=80',
        alt: 'Terrace breakfast overlooking the coast',
        caption: 'Terrace breakfast overlooking the coast',
      },
      {
        src: 'https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=2200&q=80',
        alt: 'Stone paths, warm water, and afternoon light',
        caption: 'Stone paths, warm water, and afternoon light',
      },
    ],
    featuresClasses: 'py-16 bg-[#f3ece3]',
    featuresHeading: 'Luxury that feels sunlit, not heavy',
    featuresBody: 'This variation keeps the same operating frame while shifting the emotion toward coastal ease and editorial softness.',
    storyImage: 'https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?auto=format&fit=crop&w=2200&q=80',
    featureItems: [
      { title: 'Coastal mood preset', body: 'Preset imagery and typography land softer, brighter, and more leisure-led.' },
      { title: 'Same live pricing core', body: 'Operational truth stays untouched while presentation changes around it.' },
      { title: 'High-dopamine first glance', body: 'The shell is still premium, but it no longer feels identical to every other luxury tenant.' },
    ],
    contactClasses: 'py-16 bg-[#17333b] text-white',
    contactHeading: 'Speak with our villa concierge',
    contactBody: 'Use the same structured contact stack in a lighter, more resort-oriented mood.',
    toursMenuLabel: 'Editions',
    listingHeading: 'Coastal editions',
    listingBody: 'A luxury shell variation for brands that sell sea-facing calm instead of deep-earth drama.',
    aboutHeading: 'About this coastal house',
    aboutBody: 'Keep the same structured story workflow, but with a different emotional temperature.',
    contactPageHeading: 'Reach our coastal concierge',
    contactPageBody: 'Phone, email, WhatsApp, and other channels still remain fully structured.',
    detailHeroClasses: 'py-24 bg-[#17333b] text-white',
  }),
  buildStayVariant({
    key: 'stay-boutique',
    label: 'Boutique Stay',
    description: 'Warm hospitality layout for boutique hotels, guesthouses, and lodges.',
    layoutProfile: {
      shell: 'boutique-warm',
      hero: 'portrait',
      gallery: 'grid',
      itinerary: 'feature-list',
      pricing: 'cards',
    },
    onboardingKeywords: ['boutique', 'homestay', 'guesthouse', 'lodge', 'intimate', 'heritage'],
    theme: {
      colorPrimary: '#7b4f35',
      colorAccent: '#e2c28f',
      colorSurface: '#fff8f1',
      colorText: '#412a1f',
      fontHeading: 'Fraunces, serif',
      fontBody: 'Work Sans, sans-serif',
      radius: '22px',
    },
    heroClasses: 'py-24 bg-orange-950 text-white',
    heroEyebrow: 'Boutique stay',
    heroHeadline: 'A smaller stay with stronger atmosphere.',
    heroBody: 'Tailored for intimate properties where story and warmth matter.',
    galleryHeading: 'Property gallery',
    galleryBody: 'Images remain editable as media slots.',
    featuresClasses: 'py-16 bg-orange-50',
    featuresHeading: 'Stay experience',
    featuresBody: 'Amenities and property stories are structured for safe editing.',
    featureItems: [
      { title: 'Warm hospitality', body: 'Editorial tone for boutique stays.' },
      { title: 'Flexible contact points', body: 'Schema-driven phone, email, WhatsApp, Zalo.' },
      { title: 'Reservation-ready shell', body: 'Reservation engine can plug in later.' },
    ],
    contactClasses: 'py-16 bg-stone-900 text-white',
    contactHeading: 'Plan your stay',
    contactBody: 'Contact and reservation inquiry entry points remain configurable.',
    listingMenuLabel: 'Rooms & Stays',
    listingHeading: 'Rooms and stay options',
    listingBody: 'Listing shell for properties, rooms, or stay packages.',
    aboutHeading: 'About this property',
    aboutBody: 'Tell the story of the stay through structured public content.',
    contactPageHeading: 'Contact the property',
    contactPageBody: 'All direct channels remain configurable through schema.',
  }),
  buildStayVariant({
    key: 'stay-resort',
    label: 'Luxury Resort',
    description: 'Large-image layout for resorts and premium accommodation properties.',
    layoutProfile: {
      shell: 'resort-immersive',
      hero: 'immersive',
      gallery: 'cinematic',
      itinerary: 'amenity-grid',
      pricing: 'spotlight',
    },
    onboardingKeywords: ['resort', 'spa', 'beach', 'pool', 'wellness', 'luxury stay'],
    theme: {
      colorPrimary: '#173f5f',
      colorAccent: '#d4af37',
      colorSurface: '#f4f8fb',
      colorText: '#11283a',
      fontHeading: 'Playfair Display, serif',
      fontBody: 'Manrope, sans-serif',
      radius: '26px',
    },
    heroClasses: 'py-24 bg-sky-950 text-white',
    heroEyebrow: 'Resort experiences',
    heroHeadline: 'Space, atmosphere, and premium hospitality.',
    heroBody: 'Designed for destination resorts where imagery and experience lead.',
    galleryHeading: 'Resort imagery',
    galleryBody: 'Large visual sections support premium property storytelling.',
    featuresClasses: 'py-16 bg-sky-50',
    featuresHeading: 'What guests can expect',
    featuresBody: 'Amenities and experience promises stay editable and structured.',
    featureItems: [
      { title: 'Premium visual shell', body: 'Built for large-format hospitality media.' },
      { title: 'Structured contact schema', body: 'Ready for reservation and inquiry flows.' },
      { title: 'Future engine compatibility', body: 'Hospitality reservation engine can plug in later.' },
    ],
    contactClasses: 'py-16 bg-slate-900 text-white',
    contactHeading: 'Speak with our hospitality desk',
    contactBody: 'Reservation entry remains configurable while the engine is pending.',
    listingMenuLabel: 'Stay Options',
    listingHeading: 'Stay collection',
    listingBody: 'Display resort rooms, villas, or package offerings.',
    aboutHeading: 'About the resort',
    aboutBody: 'Use structured content blocks to tell the property story.',
    contactPageHeading: 'Reach our reservations desk',
    contactPageBody: 'Phone, email, WhatsApp, and Zalo are all configurable.',
  }),
  buildTransportVariant({
    key: 'transfer-private',
    label: 'Private Transfer',
    description: 'Utility-first shell for private transfer and transport service businesses.',
    layoutProfile: {
      shell: 'transfer-utility',
      hero: 'utility',
      gallery: 'fleet-grid',
      itinerary: 'service-steps',
      pricing: 'compact',
    },
    onboardingKeywords: ['transfer', 'private car', 'driver', 'airport', 'limousine', 'pickup'],
    theme: {
      colorPrimary: '#155e75',
      colorAccent: '#f59e0b',
      colorSurface: '#f6fbfd',
      colorText: '#15313c',
      fontHeading: 'Space Grotesk, sans-serif',
      fontBody: 'Inter, system-ui, sans-serif',
      radius: '14px',
    },
    heroClasses: 'py-24 bg-cyan-950 text-white',
    heroEyebrow: 'Private transfer service',
    heroHeadline: 'Fast, direct transport with clear booking entry points.',
    heroBody: 'Best for transfer operators focused on trust, convenience, and direct inquiry.',
    galleryHeading: 'Fleet and route gallery',
    galleryBody: 'Replace visuals and route imagery without touching layout internals.',
    featuresClasses: 'py-16 bg-cyan-50',
    featuresHeading: 'Service highlights',
    featuresBody: 'Structured service promises for direct-response transport businesses.',
    featureItems: [
      { title: 'Direct contact', body: 'Phone, WhatsApp, and Zalo can all surface.' },
      { title: 'Clear entry point', body: 'Prepared for future transport booking flows.' },
      { title: 'Operational separation', body: 'Public shell stays separate from engine internals.' },
    ],
    contactClasses: 'py-16 bg-slate-900 text-white',
    contactHeading: 'Book a transfer conversation',
    contactBody: 'Contact channels and reservation entry are schema-driven.',
    listingHeading: 'Transfer services',
    listingBody: 'Listing shell for transport services and transfer offers.',
    aboutHeading: 'About this service',
    aboutBody: 'Use structured content to explain service quality and coverage.',
    contactPageHeading: 'Talk to our transport team',
    contactPageBody: 'Contact channels stay configurable by schema.',
  }),
  buildTourVariant({
    key: 'tour-expedition',
    label: 'Expedition Tour',
    description: 'Dense route-first storytelling for serious multi-stop itineraries and guided expeditions.',
    layoutProfile: {
      shell: 'expedition-atlas',
      hero: 'stacked',
      gallery: 'filmstrip',
      itinerary: 'numbered',
      pricing: 'table',
    },
    onboardingKeywords: ['expedition', 'overland', 'multi-day', 'camp', 'summit', 'remote', 'trail'],
    theme: {
      colorPrimary: '#1f2937',
      colorAccent: '#84cc16',
      colorSurface: '#f7faf7',
      colorText: '#18212c',
      fontHeading: 'IBM Plex Sans, sans-serif',
      fontBody: 'IBM Plex Sans, sans-serif',
      radius: '16px',
    },
    heroClasses: 'py-24 bg-slate-900 text-white',
    heroEyebrow: 'Field expedition',
    heroHeadline: 'Route logic first. Everything else supports the mission.',
    heroBody: 'Built for operators selling harder journeys where day-by-day clarity matters.',
    primaryCtaLabel: 'Review Expedition',
    secondaryCtaLabel: 'Speak to planner',
    galleryHeading: 'Field notes',
    galleryBody: 'Compact visuals reinforce route reality without distracting from the plan.',
    featuresClasses: 'py-16 bg-lime-50',
    featuresHeading: 'Why this format works',
    featuresBody: 'Timelines, route logic, and logistics stay readable on both desktop and mobile.',
    featureItems: [
      { title: 'Route-first structure', body: 'Makes long itineraries easy to scan.' },
      { title: 'Logistics visibility', body: 'Stops, meals, and nights remain explicit.' },
      { title: 'Operator trust layer', body: 'Pricing and booking stay tied to canonical data.' },
    ],
    contactClasses: 'py-16 bg-slate-950 text-white',
    contactHeading: 'Talk to an expedition planner',
    contactBody: 'Best for serious itineraries that need route confidence before booking.',
    toursMenuLabel: 'Expeditions',
    listingHeading: 'Expedition collection',
    listingBody: 'Long-form itineraries presented with map-like structure.',
    aboutHeading: 'About this expedition operator',
    aboutBody: 'Explain route philosophy, risk control, and local guide depth.',
    contactPageHeading: 'Coordinate with our planning desk',
    contactPageBody: 'Use the structured contact layer for expedition consultation.',
    detailHeroClasses: 'py-24 bg-slate-900 text-white',
  }),
  buildStayVariant({
    key: 'stay-urban',
    label: 'Urban Stay',
    description: 'Compact city-hospitality layout for business hotels and modern apartments.',
    layoutProfile: {
      shell: 'urban-compact',
      hero: 'compact',
      gallery: 'stacked',
      itinerary: 'feature-list',
      pricing: 'table',
    },
    onboardingKeywords: ['city hotel', 'urban', 'business travel', 'downtown', 'apartment', 'metro'],
    theme: {
      colorPrimary: '#1d3557',
      colorAccent: '#e76f51',
      colorSurface: '#f4f7fb',
      colorText: '#172535',
      fontHeading: 'DM Sans, sans-serif',
      fontBody: 'DM Sans, sans-serif',
      radius: '18px',
    },
    heroClasses: 'py-20 bg-slate-900 text-white',
    heroEyebrow: 'Urban stay',
    heroHeadline: 'Fast access, calm rooms, and a city-ready booking shell.',
    heroBody: 'Built for downtown stays where clarity, location, and convenience lead the decision.',
    galleryHeading: 'Property highlights',
    galleryBody: 'Compact media works better for business-led stay decisions.',
    featuresClasses: 'py-16 bg-slate-50',
    featuresHeading: 'What guests need to know fast',
    featuresBody: 'Ideal for business hotels, serviced apartments, and transit-friendly stays.',
    featureItems: [
      { title: 'Compact mobile-first layout', body: 'Designed for quick scanning and direct action.' },
      { title: 'Flexible room listing shell', body: 'Works for apartments, rooms, and short stays.' },
      { title: 'Direct contact paths', body: 'Phone, email, and chat channels stay prominent.' },
    ],
    contactClasses: 'py-16 bg-slate-950 text-white',
    contactHeading: 'Contact the front desk',
    contactBody: 'Ideal for direct reservations and city-travel questions.',
    listingMenuLabel: 'Rooms',
    listingHeading: 'Room and stay options',
    listingBody: 'Compact listing layout for city inventory.',
    aboutHeading: 'About this city stay',
    aboutBody: 'Use structured copy to explain location, check-in, and room style.',
    contactPageHeading: 'Reach the property team',
    contactPageBody: 'All direct channels remain configurable through schema.',
  }),
  buildTransportVariant({
    key: 'transfer-city',
    label: 'City Transfer',
    description: 'Fast-response layout for airport, station, and city shuttle services.',
    layoutProfile: {
      shell: 'city-shuttle',
      hero: 'compact',
      gallery: 'minimal',
      itinerary: 'service-steps',
      pricing: 'table',
    },
    onboardingKeywords: ['city transfer', 'shuttle', 'airport transfer', 'station pickup', 'city ride', 'commute'],
    theme: {
      colorPrimary: '#0f4c5c',
      colorAccent: '#ffb703',
      colorSurface: '#f5fbfc',
      colorText: '#16303a',
      fontHeading: 'Archivo, sans-serif',
      fontBody: 'Archivo, sans-serif',
      radius: '12px',
    },
    heroClasses: 'py-20 bg-cyan-900 text-white',
    heroEyebrow: 'City mobility',
    heroHeadline: 'Airport pickups and city transfers without friction.',
    heroBody: 'Best for operators selling station, airport, and in-city transport with fast response.',
    galleryHeading: 'Fleet snapshots',
    galleryBody: 'Short-form media supports direct booking intent.',
    featuresClasses: 'py-16 bg-cyan-50',
    featuresHeading: 'Built for quick decisions',
    featuresBody: 'Lead with route clarity, vehicle trust, and immediate contact.',
    featureItems: [
      { title: 'Fast quote-first layout', body: 'Highlights route and availability quickly.' },
      { title: 'City-use compact sections', body: 'Mobile-first blocks work for travelers on the move.' },
      { title: 'Direct action emphasis', body: 'Perfect for transfer-focused service brands.' },
    ],
    contactClasses: 'py-16 bg-cyan-950 text-white',
    contactHeading: 'Arrange your ride now',
    contactBody: 'Supports direct-response transfer sales with minimal friction.',
    listingHeading: 'Transfer routes',
    listingBody: 'Show airport, station, and city transfer offers cleanly.',
    aboutHeading: 'About this transfer service',
    aboutBody: 'Explain service area, driver quality, and transfer process.',
    contactPageHeading: 'Reach dispatch',
    contactPageBody: 'Keep chat, call, and direct booking channels in one place.',
  }),
];

function expandPageBlueprints(variant) {
  const baseSections = variant.defaultConfig.sections.map((section) => clone(section));
  const pageBlueprints = {};
  for (const [pageKey, blocks] of Object.entries(variant.defaultConfig.page_blueprints)) {
    pageBlueprints[pageKey] = blocks === 'default_sections'
      ? baseSections.map((section) => clone(section))
      : blocks.map((block) => clone(block));
  }
  return pageBlueprints;
}

export const UNIVERSAL_GROUPS = GROUP_DEFINITIONS;

export const UNIVERSAL_VARIANTS = VARIANT_DEFINITIONS.map((variant) => ({
  key: variant.key,
  group_key: variant.groupKey,
  label: variant.label,
  description: variant.description,
  theme: clone(variant.theme),
  layout_profile: clone(variant.layoutProfile || {}),
}));

export function getUniversalGroups(lang = 'en') {
  return Object.values(GROUP_DEFINITIONS).map((group) => localizeGroupDefinition(group, lang));
}

export function getUniversalVariants(lang = 'en') {
  return VARIANT_DEFINITIONS.map((variant) => {
    const localized = localizeVariantDefinition(variant, lang);
    return {
      key: localized.key,
      group_key: localized.groupKey,
      label: localized.label,
      description: localized.description,
      theme: clone(localized.theme),
      layout_profile: clone(localized.layoutProfile || {}),
    };
  });
}

export function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export function buildTourPageKey(tourId) {
  return `tour-${tourId}`;
}

export function buildUniversalPublicPath(tenantId, slug) {
  return `/p/${tenantId}/${slug}`;
}

export function buildUniversalCacheKeyUrl(tenantId, slug) {
  return `https://universal-cache.internal${buildUniversalPublicPath(tenantId, slug)}`;
}

export function getVariantByKey(variantKey) {
  return VARIANT_DEFINITIONS.find((variant) => variant.key === variantKey) || null;
}

export function getVariantsForGroup(groupKey, lang = 'en') {
  return VARIANT_DEFINITIONS
    .filter((variant) => variant.groupKey === groupKey)
    .map((variant) => {
      const localized = localizeVariantDefinition(variant, lang);
      return {
        key: localized.key,
        group_key: localized.groupKey,
        label: localized.label,
        description: localized.description,
        theme: clone(localized.theme),
        layout_profile: clone(localized.layoutProfile || {}),
      };
    });
}

export function buildDefaultThemeTokens(groupKey, variantKey, lang = 'en') {
  const variant = getVariantByKey(variantKey) || getVariantByKey(getVariantsForGroup(groupKey)[0]?.key) || VARIANT_DEFINITIONS[0];
  const copy = getUniversalSystemCopy(groupKey, lang);
  return {
    mode: 'light',
    group_key: groupKey,
    variant_key: variant.key,
    colorPrimary: variant.theme.colorPrimary,
    colorSecondary: variant.theme.colorAccent,
    colorAccent: variant.theme.colorAccent,
    colorSurface: variant.theme.colorSurface,
    colorText: variant.theme.colorText,
    fontHeading: variant.theme.fontHeading,
    fontBody: variant.theme.fontBody,
    radius: variant.theme.radius,
    logoUrl: '',
    ui: {
      bookNowLabel: '',
      cta: {
        discoveryLabel: '',
        bookingLabel: '',
        contactLabel: '',
      },
      header: {
        showMenuButton: true,
        showLanguageChip: true,
        languageLabel: copy.header.languageChip,
        showLoginLink: true,
        loginLabel: copy.header.login,
        loginHref: '',
        showBookNowButton: true,
        primaryPageKey: '',
        solidOnScroll: true,
      },
      hero: {
        showMapLink: true,
        mapLinkLabel: copy.header.viewMap,
        mapLinkHref: '#section-destinations',
        showModuleShortcuts: true,
        showSearchPanel: true,
        searchButtonLabel: copy.search.button,
        showSecondaryCta: true,
      },
      socialRail: {
        visible: true,
      },
      menuDrawer: {
        title: copy.header.curatedMenu,
      },
      floating: {
        showBookNow: false,
        revealOnScroll: true,
        showContactDock: false,
        showPhone: true,
        showEmail: true,
        showWhatsapp: true,
        showInstagram: false,
      },
      footer: {
        kickerText: copy.footer.kicker,
        showNavigation: true,
        showContacts: true,
        showSocials: true,
        showLegalLinks: true,
      },
    },
  };
}

export function getDefaultCtaLabels(groupKey, lang = 'en') {
  const copy = getUniversalSystemCopy(groupKey, lang);
  return {
    discovery: copy.cta.discovery,
    booking: copy.cta.booking,
    contact: copy.cta.contact,
  };
}

export function resolveThemeCtaLabel(theme, groupKey, intent, explicitLabel = '', lang = 'en') {
  const cleanExplicit = String(explicitLabel || '').trim();
  if (cleanExplicit) return cleanExplicit;

  const defaults = getDefaultCtaLabels(groupKey, lang);
  const cta = theme?.ui?.cta || {};
  if (intent === 'booking') {
    const bookingLabel = String(cta.bookingLabel || theme?.ui?.bookNowLabel || '').trim();
    return bookingLabel || defaults.booking;
  }
  if (intent === 'contact') {
    return String(cta.contactLabel || '').trim() || defaults.contact;
  }
  return String(cta.discoveryLabel || '').trim() || defaults.discovery;
}

export function buildDefaultContacts(lang = 'en') {
  const copy = getUniversalSystemCopy('tour_operator', lang);
  return {
    contactForm: {
      enabled: true,
      label: copy.contact.sendMessage,
      endpoint: '/api/contact',
    },
    channels: {
      phone: { enabled: false, label: copy.channel.phone, value: '' },
      email: { enabled: false, label: copy.channel.email, value: '' },
      whatsapp: { enabled: false, label: copy.channel.whatsapp, value: '' },
      zalo: { enabled: false, label: copy.channel.zalo, value: '' },
      instagram: { enabled: false, label: copy.channel.instagram, value: '' },
      facebook: { enabled: false, label: copy.channel.facebook, value: '' },
      youtube: { enabled: false, label: copy.channel.youtube, value: '' },
      address: { enabled: false, label: copy.channel.address, value: '', mapUrl: '' },
    },
  };
}

function buildStandardPages(groupKey, variant, lang = 'en') {
  const group = GROUP_DEFINITIONS[groupKey];
  const blueprints = expandPageBlueprints(variant);
  const pages = groupKey === 'tour_operator'
    ? [
        { pageKey: 'home', title: 'Home', slug: 'home', pageType: 'standard', visible: 1, status: 'draft' },
        { pageKey: 'tours', title: 'Tours', slug: 'tours', pageType: 'standard', visible: 1, status: 'draft' },
        { pageKey: 'destinations', title: 'Destinations', slug: 'destinations', pageType: 'standard', visible: 1, status: 'draft' },
        { pageKey: 'featured-tours', title: 'Featured Tours', slug: 'featured-tours', pageType: 'standard', visible: 1, status: 'draft' },
        { pageKey: 'accommodation', title: 'Accommodation', slug: 'accommodation', pageType: 'standard', visible: 1, status: 'draft' },
        { pageKey: 'booking', title: 'Booking', slug: 'booking', pageType: 'standard', visible: 0, status: 'draft' },
        { pageKey: 'about-us', title: 'About Us', slug: 'about-us', pageType: 'standard', visible: 1, status: 'draft' },
        { pageKey: 'contact-us', title: 'Contact Us', slug: 'contact-us', pageType: 'standard', visible: 1, status: 'draft' },
        { pageKey: 'terms', title: 'Terms & Conditions', slug: 'terms', pageType: 'legal', visible: 1, status: 'draft' },
        { pageKey: 'privacy', title: 'Privacy Policy', slug: 'privacy', pageType: 'legal', visible: 1, status: 'draft' },
        { pageKey: 'impressum', title: 'Impressum', slug: 'impressum', pageType: 'legal', visible: 1, status: 'draft' },
      ]
    : [
        { pageKey: 'home', title: 'Home', slug: 'home', pageType: 'standard', visible: 1, status: 'draft' },
        {
          pageKey: group.listingPageKey,
          title: groupKey === 'stay_accommodation' ? 'Hotels' : 'Services',
          slug: group.listingPageKey,
          pageType: 'standard',
          visible: 1,
          status: 'draft',
        },
        {
          pageKey: group.reservationPageKey,
          title: 'Reservation',
          slug: group.reservationPageKey,
          pageType: 'standard',
          visible: 1,
          status: 'draft',
        },
        { pageKey: 'about-us', title: 'About Us', slug: 'about-us', pageType: 'standard', visible: 1, status: 'draft' },
        { pageKey: 'contact-us', title: 'Contact Us', slug: 'contact-us', pageType: 'standard', visible: 1, status: 'draft' },
        { pageKey: 'terms', title: 'Terms & Conditions', slug: 'terms', pageType: 'legal', visible: 1, status: 'draft' },
        { pageKey: 'privacy', title: 'Privacy Policy', slug: 'privacy', pageType: 'legal', visible: 1, status: 'draft' },
        { pageKey: 'impressum', title: 'Impressum', slug: 'impressum', pageType: 'legal', visible: 1, status: 'draft' },
      ];

  if (groupKey === 'tour_operator') {
    pages.push({ pageKey: 'tour-detail-template', title: 'Tour Detail Template', slug: 'tour-detail-template', pageType: 'system', visible: 0, status: 'draft' });
  }

  return localizeUniversalPages(pages.map((page) => ({
    ...page,
    blocks: clone(blueprints[page.pageKey] || []),
    seo: {},
  })), groupKey, lang);
}

export function buildDefaultMenuItems(groupKey, variantKey, lang = 'en') {
  const variant = getVariantByKey(variantKey) || getVariantByKey(getVariantsForGroup(groupKey)[0]?.key) || VARIANT_DEFINITIONS[0];
  return localizeUniversalMenuItems(variant.defaultConfig.menu_structure.map((item, index) => ({
    itemKey: item.item_key,
    label: item.label,
    href: item.href,
    pageKey: item.page_key || null,
    target: '_self',
    isExternal: 0,
    visible: 1,
    sortOrder: index,
  })), groupKey, lang);
}

export function buildVariantRuntimeConfig(groupKey, variantKey, lang = 'en') {
  const variant = getVariantByKey(variantKey);
  if (!variant || variant.groupKey !== groupKey) {
    return null;
  }

  const group = GROUP_DEFINITIONS[groupKey];
  const localizedVariant = localizeVariantDefinition(variant, lang);
  const localizedGroup = localizeGroupDefinition(group, lang);
  return {
    group_key: groupKey,
    group_label: localizedGroup.label,
    variant_key: localizedVariant.key,
    variant_label: localizedVariant.label,
    description: localizedVariant.description,
    entity_type: group.entityType,
    layout_profile: clone(variant.layoutProfile || {}),
    default_config: {
      sections: clone(variant.defaultConfig.sections),
      menu_structure: clone(variant.defaultConfig.menu_structure),
      data_bindings: clone(variant.defaultConfig.data_bindings),
      page_blueprints: expandPageBlueprints(variant),
    },
    render_contract: {
      engine: 'tailwind-json-v1',
      mode: 'edge-render',
      group_key: groupKey,
      variant_key: variant.key,
      primary_entity: group.entityType,
      class_source: 'tailwind-class-tokens',
      resolution_order: [
        'system_sync_snapshot',
        'tenant_page_content_override',
        'tenant_theme_tokens',
        'variant_default_content',
      ],
      booking_slot: groupKey === 'tour_operator'
        ? {
            type: 'system-booking-engine',
            action_id: 'like_this_tour',
            binds_to: ['tour_id', 'pricing_engine'],
          }
        : {
            type: 'future-reservation-engine',
            action_id: 'reservation_entrypoint',
            binds_to: [],
          },
    },
  };
}

export function buildEditorSchema(groupKey, variantKey, lang = 'en') {
  const runtime = buildVariantRuntimeConfig(groupKey, variantKey, lang);
  if (!runtime) return null;

  const bookingPagePath = groupKey === 'tour_operator'
    ? 'pages.by_key.booking.visible'
    : 'pages.by_key.reservation.visible';

  return {
    version: 'universal-editor-schema/v1',
    group_key: groupKey,
    variant_key: variantKey,
    groups: [
      createEditorGroup('site_identity', 'Site Identity', [
        createField('site_name', 'Site Name', 'text', 'site.site_name'),
        createField('group_key', 'Industry Group', 'select', 'site.group_key', {
          options: getUniversalGroups(lang).map((group) => ({ label: group.label, value: group.key })),
        }),
        createField('variant_key', 'Variant', 'select', 'site.variant_key', {
          options: getVariantsForGroup(groupKey, lang).map((variant) => ({ label: variant.label, value: variant.key })),
        }),
        createField('default_lang', 'Default Language', 'select', 'site.default_lang', {
          options: STRONG_LANGUAGE_OPTIONS,
        }),
      ]),
      createEditorGroup('brand_media', 'Brand Media', [
        createField('logo_url', 'Logo', 'image_upload', 'theme.logoUrl'),
        createField('hero_background_image', 'Hero Background', 'image_upload', 'pages.by_key.home.blocks.hero.content.hero_image'),
      ]),
      createEditorGroup('theme_tokens', 'Theme Tokens', [
        createField('color_primary', 'Primary Color', 'color', 'theme.colorPrimary'),
        createField('color_secondary', 'Secondary Color', 'color', 'theme.colorSecondary'),
        createField('color_accent', 'Accent Color', 'color', 'theme.colorAccent'),
        createField('color_surface', 'Surface Color', 'color', 'theme.colorSurface'),
        createField('color_text', 'Text Color', 'color', 'theme.colorText'),
        createField('font_heading', 'Heading Font', 'text', 'theme.fontHeading'),
        createField('font_body', 'Body Font', 'text', 'theme.fontBody'),
        createField('radius', 'Corner Radius', 'text', 'theme.radius'),
      ]),
      createEditorGroup('feature_switches', 'Feature Switches', [
        createField('booking_enabled', 'Enable Booking', 'switch', bookingPagePath),
      ]),
      createEditorGroup('cta_labels', 'CTA Labels', [
        createField('discovery_cta_label', 'Discovery CTA Label', 'text', 'theme.ui.cta.discoveryLabel'),
        createField('booking_cta_label', 'Booking CTA Label', 'text', 'theme.ui.cta.bookingLabel'),
        createField('contact_cta_label', 'Contact CTA Label', 'text', 'theme.ui.cta.contactLabel'),
      ]),
      createEditorGroup('menu_structure', 'Menu Structure', [
        createField('menu_items', 'Menu Items', 'repeater', 'menu.items', {
          item_schema: [
            createField('label', 'Label', 'text', 'label'),
            createField('href', 'Hyperlink', 'link', 'href'),
            createField('visible', 'Visible', 'switch', 'visible'),
            createField('target', 'Target', 'select', 'target', {
              options: [
                { label: 'Same Tab', value: '_self' },
                { label: 'New Tab', value: '_blank' },
              ],
            }),
          ],
        }),
      ]),
      createEditorGroup('hero_section', 'Hero Section', [
        createField('hero_eyebrow', 'Eyebrow', 'text', 'variant.sections.hero.content.eyebrow'),
        createField('hero_headline', 'Hero Title', 'text', 'pages.by_key.home.blocks.hero.content.headline'),
        createField('hero_body', 'Body', 'rich_text', 'pages.by_key.home.blocks.hero.content.body'),
        createField('hero_image', 'Hero Image', 'image_upload', 'pages.by_key.home.blocks.hero.content.hero_image'),
        createField('hero_image_brightness', 'Hero Image Brightness', 'text', 'pages.by_key.home.blocks.hero.content.image_brightness'),
        createField('hero_overlay_strength', 'Hero Overlay Strength', 'text', 'pages.by_key.home.blocks.hero.content.overlay_strength'),
        createField('hero_side_panel_label', 'Hero Side Panel Label', 'text', 'pages.by_key.home.blocks.hero.content.side_panel_label'),
        createField('hero_side_panel_body', 'Hero Side Panel Body', 'rich_text', 'pages.by_key.home.blocks.hero.content.side_panel_body'),
        createField('hero_primary_cta_label', 'Primary CTA Label', 'text', 'pages.by_key.home.blocks.hero.content.primary_cta_label'),
        createField('hero_primary_cta_href', 'Primary CTA Link', 'link', 'pages.by_key.home.blocks.hero.content.primary_cta_href'),
      ]),
      createEditorGroup('about_section', 'About Section', [
        createField('about_heading', 'About Heading', 'text', 'pages.by_key.about-us.blocks.about-story.content.heading'),
        createField('about_body', 'About Body', 'rich_text', 'pages.by_key.about-us.blocks.about-story.content.body'),
      ]),
      createEditorGroup('gallery_section', 'Gallery Section', [
        createField('gallery_heading', 'Heading', 'text', 'pages.by_key.home.blocks.gallery.content.heading'),
        createField('gallery_body', 'Body', 'rich_text', 'pages.by_key.home.blocks.gallery.content.body'),
        createField('gallery_images', 'Gallery Images', 'repeater', 'pages.by_key.home.blocks.gallery.content.images', {
          item_schema: [
            createField('src', 'Image', 'image_upload', 'src'),
            createField('alt', 'Alt Text', 'text', 'alt'),
            createField('caption', 'Caption', 'text', 'caption'),
          ],
        }),
      ]),
      createEditorGroup('luxury_modules', 'Luxury Modules', [
        createField('featured_tours_heading', 'Featured Tours Heading', 'text', 'pages.by_key.featured-tours.blocks.featured-tour-grid.content.heading'),
        createField('featured_tours_body', 'Featured Tours Body', 'rich_text', 'pages.by_key.featured-tours.blocks.featured-tour-grid.content.body'),
        createField('featured_tours_label', 'Featured Tours Card Label', 'text', 'pages.by_key.featured-tours.blocks.featured-tour-grid.content.card_label'),
        createField('featured_tours_accent', 'Featured Tours Accent', 'color', 'pages.by_key.featured-tours.blocks.featured-tour-grid.content.accent_color'),
        createField('destinations_heading', 'Destinations Heading', 'text', 'pages.by_key.destinations.blocks.destination-grid.content.heading'),
        createField('destinations_body', 'Destinations Body', 'rich_text', 'pages.by_key.destinations.blocks.destination-grid.content.body'),
        createField('destinations_label', 'Destinations Card Label', 'text', 'pages.by_key.destinations.blocks.destination-grid.content.card_label'),
        createField('destinations_accent', 'Destinations Accent', 'color', 'pages.by_key.destinations.blocks.destination-grid.content.accent_color'),
        createField('accommodation_heading', 'Accommodation Heading', 'text', 'pages.by_key.accommodation.blocks.accommodation-story.content.heading'),
        createField('accommodation_body', 'Accommodation Body', 'rich_text', 'pages.by_key.accommodation.blocks.accommodation-story.content.body'),
        createField('accommodation_image', 'Accommodation Story Image', 'image_upload', 'pages.by_key.accommodation.blocks.accommodation-story.content.story_image'),
        createField('accommodation_label', 'Accommodation Card Label', 'text', 'pages.by_key.accommodation.blocks.accommodation-story.content.card_label'),
        createField('accommodation_accent', 'Accommodation Accent', 'color', 'pages.by_key.accommodation.blocks.accommodation-story.content.accent_color'),
      ]),
      createEditorGroup('features_section', 'Features Section', [
        createField('features_heading', 'Heading', 'text', 'pages.by_key.home.blocks.features.content.heading'),
        createField('features_body', 'Body', 'rich_text', 'pages.by_key.home.blocks.features.content.body'),
        createField('features_items', 'Items', 'repeater', 'pages.by_key.home.blocks.features.content.items', {
          item_schema: [
            createField('title', 'Title', 'text', 'title'),
            createField('body', 'Body', 'rich_text', 'body'),
          ],
        }),
      ]),
      createEditorGroup('contact_channels', 'Contact Channels', COMMON_CONTACT_FIELDS),
      createEditorGroup('legal_footer', 'Footer & Legal', [
        createField('terms_label', 'Terms Label', 'text', 'legal.terms.label'),
        createField('privacy_label', 'Privacy Label', 'text', 'legal.privacy.label'),
        createField('impressum_label', 'Impressum Label', 'text', 'legal.impressum.label'),
      ]),
    ],
  };
}

export function buildEditorModel(site, theme, contacts, menu, pages, runtime) {
  const pageMap = {};
  for (const page of pages) {
    const blockMap = {};
    for (const block of page.blocks || []) {
      blockMap[block.id] = block;
    }
    pageMap[page.page_key] = {
      ...page,
      blocks: blockMap,
    };
  }

  return {
    site,
    theme,
    contacts,
    variant: {
      sections: Object.fromEntries((runtime?.default_config?.sections || []).map((section) => [section.id, section])),
    },
    menu: { items: menu },
    pages: {
      by_key: pageMap,
      items: pages,
    },
  };
}

export function buildEditorStoreBundle({ site, theme, contacts, menu, pages, runtime }) {
  const lang = site?.default_lang || 'en';
  return {
    editor_model: buildEditorModel(site, theme, contacts, menu, pages, runtime),
    editor_schema: buildEditorSchema(site.group_key, site.variant_key, lang),
    render_contract: runtime?.render_contract || null,
    variant_runtime: runtime,
  };
}

function buildPlaceholderImageDataUrl(label, background, foreground = '#ffffff') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="${background}"/><circle cx="1320" cy="180" r="140" fill="${foreground}" opacity="0.08"/><circle cx="260" cy="760" r="180" fill="${foreground}" opacity="0.08"/><text x="80" y="420" fill="${foreground}" font-size="84" font-family="Inter, Arial, sans-serif" font-weight="700">${label}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function setBlockContent(pages, pageKey, blockId, updates) {
  const page = pages.find((entry) => entry.pageKey === pageKey);
  const block = page?.blocks?.find((entry) => entry.id === blockId);
  if (!block) return;
  block.content = { ...block.content, ...updates };
}

function getBootstrapSystemText(key, lang = 'en', vars = {}) {
  const locale = normalizeLocale(lang);
  const templates = {
    en: {
      auto_selected: 'Auto-selected {{variant}} based on your onboarding description. You can edit every field after bootstrap.',
      onboarding_mock: 'Onboarding mock for {{siteName}}. Source prompt: {{summary}}',
      rationale: 'Matched onboarding keywords against the template registry and selected {{variant}}.',
      universal_site_name: 'Universal Site',
    },
    vi: {
      auto_selected: 'Da tu dong chon {{variant}} dua tren mo ta onboarding. Ban co the sua moi truong sau khi bootstrap.',
      onboarding_mock: 'Ban mock onboarding cho {{siteName}}. Mo ta nguon: {{summary}}',
      rationale: 'Da doi chieu tu khoa onboarding voi registry template va chon {{variant}}.',
      universal_site_name: 'Universal Site',
    },
    zh: {
      auto_selected: '已根据 onboarding 描述自动选择 {{variant}}。Bootstrap 后您仍可编辑所有字段。',
      onboarding_mock: '{{siteName}} 的 onboarding mock。来源描述：{{summary}}',
      rationale: '已根据 onboarding 关键词匹配模板库，并选择 {{variant}}。',
      universal_site_name: 'Universal Site',
    },
  };
  return applyVars(templates[locale]?.[key] || templates.en[key] || key, vars);
}

export function recommendUniversalVariant(description = '') {
  const normalized = String(description || '').toLowerCase();
  let best = null;

  for (const variant of VARIANT_DEFINITIONS) {
    const score = (variant.onboardingKeywords || []).reduce((sum, keyword) => (
      normalized.includes(keyword) ? sum + keyword.length : sum
    ), 0);
    if (!best || score > best.score) {
      best = { variant, score };
    }
  }

  return (best && best.score > 0) ? best.variant : getVariantByKey('tour-luxury');
}

function buildBootstrapMediaSet(groupKey, variantKey) {
  if (variantKey === 'tour-luxury') {
    return {
      heroImage: 'https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=2200&q=80',
      galleryImages: [
        { src: 'https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=2200&q=80', alt: 'Oceanfront luxury escape', caption: 'Oceanfront arrival' },
        { src: 'https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?auto=format&fit=crop&w=2200&q=80', alt: 'Private terrace over tropical water', caption: 'Private terrace mornings' },
        { src: 'https://images.unsplash.com/photo-1519046904884-53103b34b206?auto=format&fit=crop&w=2200&q=80', alt: 'Resort pool and palms at sunset', caption: 'Golden-hour resort mood' },
      ],
    };
  }

  if (groupKey === 'tour_operator') {
    return {
      heroImage: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=2200&q=80',
      galleryImages: [
        { src: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=2200&q=80', alt: 'Mountain travel landscape', caption: 'Route-defining landscapes' },
        { src: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=2200&q=80', alt: 'Layered mountain ridges', caption: 'Highland atmosphere' },
        { src: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=2200&q=80', alt: 'Lakeside travel scene', caption: 'Slow scenic moments' },
      ],
    };
  }

  if (groupKey === 'stay_accommodation') {
    return {
      heroImage: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=2200&q=80',
      galleryImages: [
        { src: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=2200&q=80', alt: 'Luxury suite interior', caption: 'Suite interior' },
        { src: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=2200&q=80', alt: 'Warm resort bedroom', caption: 'Calm room styling' },
        { src: 'https://images.unsplash.com/photo-1505692952047-1a78307da8f2?auto=format&fit=crop&w=2200&q=80', alt: 'Resort lounge with natural light', caption: 'Designed hospitality spaces' },
      ],
    };
  }

  return {
    heroImage: 'https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=2200&q=80',
    galleryImages: [
      { src: 'https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=2200&q=80', alt: 'Premium travel transfer vehicle', caption: 'Premium service arrival' },
      { src: 'https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?auto=format&fit=crop&w=2200&q=80', alt: 'Road journey through scenic landscape', caption: 'On-the-road atmosphere' },
      { src: 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=2200&q=80', alt: 'Traveler on scenic overlook', caption: 'Guest journey moments' },
    ],
  };
}

export function buildUniversalBootstrapMock(description, tenantName = 'Universal Site', lang = 'en') {
  const variant = recommendUniversalVariant(description);
  const localizedVariant = localizeVariantDefinition(variant, lang);
  const scaffold = buildDefaultSiteScaffold(variant.groupKey, variant.key, lang);
  const siteName = tenantName || getBootstrapSystemText('universal_site_name', lang);
  const summary = String(description || '').trim() || localizedVariant.description;
  const heroTitle = summary.length > 72 ? `${summary.slice(0, 69)}...` : summary;
  const mediaSet = buildBootstrapMediaSet(variant.groupKey, variant.key);
  const heroImage = mediaSet.heroImage;

  setBlockContent(scaffold.pages, 'home', 'hero', {
    eyebrow: localizedVariant.label,
    headline: heroTitle,
    body: getBootstrapSystemText('auto_selected', lang, { variant: localizedVariant.label }),
    hero_image: heroImage,
  });
  setBlockContent(scaffold.pages, 'home', 'gallery', {
    images: mediaSet.galleryImages,
  });
  setBlockContent(scaffold.pages, 'about-us', variant.groupKey === 'tour_operator' ? 'about-story' : variant.groupKey === 'stay_accommodation' ? 'stay-story' : 'service-story', {
    body: getBootstrapSystemText('onboarding_mock', lang, { siteName, summary }),
  });

  const site = {
    tenant_id: null,
    group_key: variant.groupKey,
    variant_key: variant.key,
    status: 'draft',
    site_name: siteName,
    default_lang: normalizeLocale(lang),
    home_page_key: 'home',
  };

  const pages = scaffold.pages.map((page, index) => ({
    id: `mock-page-${index + 1}`,
    tenant_id: null,
    page_key: page.pageKey,
    title: page.title,
    slug: page.slug,
    page_type: page.pageType,
    status: page.status,
    visible: Boolean(page.visible),
    blocks: clone(page.blocks || []),
    seo: {
      title: `${siteName} | ${localizedVariant.label}`,
      description: summary,
      og_image: heroImage,
    },
    created_at: null,
    updated_at: null,
  }));
  const menu = scaffold.menuItems.map((item, index) => ({
    id: `mock-menu-${index + 1}`,
    item_key: item.itemKey,
    label: item.label,
    href: item.href,
    page_key: item.pageKey,
    target: item.target,
    is_external: Boolean(item.isExternal),
    visible: Boolean(item.visible),
    sort_order: item.sortOrder,
  }));
  const runtime = buildVariantRuntimeConfig(variant.groupKey, variant.key);
  const localizedRuntime = buildVariantRuntimeConfig(variant.groupKey, variant.key, lang);

  return {
    recommendation: {
      description: summary,
      group_key: variant.groupKey,
      variant_key: variant.key,
      variant_label: localizedVariant.label,
      rationale: getBootstrapSystemText('rationale', lang, { variant: localizedVariant.label }),
    },
    site,
    theme: scaffold.themeTokens,
    contacts: scaffold.contacts,
    menu,
    pages,
    ...buildEditorStoreBundle({
      site,
      theme: scaffold.themeTokens,
      contacts: scaffold.contacts,
      menu,
      pages,
      runtime: localizedRuntime || runtime,
    }),
  };
}

export function buildDefaultSiteScaffold(groupKey, variantKey, lang = 'en') {
  const runtime = buildVariantRuntimeConfig(groupKey, variantKey, lang);
  if (!runtime) {
    throw new Error(`Unknown universal variant: ${groupKey}/${variantKey}`);
  }

  return {
    themeTokens: buildDefaultThemeTokens(groupKey, variantKey, lang),
    contacts: buildDefaultContacts(lang),
    menuItems: buildDefaultMenuItems(groupKey, variantKey, lang),
    pages: buildStandardPages(groupKey, getVariantByKey(variantKey), lang),
    editorSchema: buildEditorSchema(groupKey, variantKey, lang),
    renderContract: runtime.render_contract,
    variantRuntime: runtime,
  };
}
