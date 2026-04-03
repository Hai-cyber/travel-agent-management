import {
  getProductTierCatalogPayload,
  isValidProductTierKey,
} from './productTiers.js';

export const MARKETING_SITE_SETTING_KEY = 'marketing_site';

const DEFAULT_MARKETING_SITE = Object.freeze({
  announcement_bar: 'Launch offer: 6 free months. Register now with no credit card required.',
  launch_offer_badge: '0 EUR for 6 months',
  launch_offer_terms: 'Then your selected plan starts. Cancel anytime.',
  signup_title: 'Sign up to create your tour platform with 0 EUR.',
  signup_requirement_copy: 'Required: choose a product tier, enter your email, and create your password. Your brand, team, or working name sets up the workspace.',
  hero_badge: 'Travel SaaS on Cloudflare edge',
  hero_title: 'Sell faster with 4 clear travel plans, from landing-page launch to full operator suite.',
  hero_subtitle: 'Start with a conversion-ready site, move into bookings and payments when you are ready, and keep fees transparent from day one.',
  primary_cta: {
    label: 'Start signup - no card, 6 free months',
    url: '/signup.html',
  },
  secondary_cta: {
    label: 'Compare the 4 tiers',
    url: '#plans',
  },
  hero_trust_points: [
    '6 months free before billing starts',
    'No credit card required at signup',
    'Free SSL on every live domain',
    'Fast global edge delivery',
    'Transparent subscription and revenue-share rules',
  ],
  spotlight_cards: [
    {
      eyebrow: 'Free launch runway',
      title: 'Six months free',
      body: 'On active launch tiers, you get six free months to build demand before software fees start.',
    },
    {
      eyebrow: 'Friction removed',
      title: 'No card to register',
      body: 'Founders, agencies, and operator teams can open an account without sharing credit card details upfront.',
    },
    {
      eyebrow: 'Trust by default',
      title: 'SSL included',
      body: 'Every branded site goes live with HTTPS so customers see a secure storefront from the first visit.',
    },
    {
      eyebrow: 'Performance',
      title: 'Superior edge speed',
      body: 'Pages are served from the Cloudflare edge for fast first loads, resilient checkout, and better conversion.',
    },
    {
      eyebrow: 'Money clarity',
      title: 'Transparent pricing',
      body: 'Your subscription, payment enablement, and any revenue-share logic are visible upfront instead of hidden later.',
    },
  ],
  plans_title: 'Four tiers, one upgrade path',
  plans_subtitle: 'Choose the entry point that matches your current business model. Upgrade without rebuilding your stack.',
  transparency_title: 'Money stays visible',
  transparency_body: 'We make software fees, payment readiness, and revenue-share logic explicit so operators can forecast margins before going live.',
  transparency_points: [
    'Clear subscription per tier',
    'Payment-enabled plans are obvious before signup',
    'Future hotel and bundle tiers are shown now so roadmap expectations stay honest',
  ],
  faq_title: 'Questions operators ask before they launch',
  faq_items: [
    {
      question: 'Do I need a credit card to create an account?',
      answer: 'No. The launch flow is card-free so teams can test setup, content, and onboarding before billing begins.',
    },
    {
      question: 'Is SSL included when I connect my domain?',
      answer: 'Yes. The platform is built to ship secure storefronts with HTTPS enabled as part of the standard go-live flow.',
    },
    {
      question: 'Can I start with a landing page and upgrade later?',
      answer: 'Yes. The tier ladder is designed so you can begin with simple lead capture and move into operations and payments later.',
    },
  ],
  bottom_cta_title: 'Launch now, scale later, keep the economics clear.',
  bottom_cta_body: 'Pick a tier, start free for six months, and move from polished brochure site to real travel commerce when your market is ready.',
  bottom_cta: {
    label: 'Create account - no card needed',
    url: '/signup.html',
  },
  waitlist_url: '/signup.html',
  tier_overrides: {
    starter_landing: {
      badge: 'Best for validation',
      audience: 'Solo founders and agencies that need a polished sales page first.',
      pitch: 'Launch fast with a branded landing page, contact capture, and a low monthly entry point.',
      note: 'Ideal when you want inbound leads before live transactions.',
      feature_bullets: [
        'Landing page and branded lead capture',
        'Platform subdomain included',
        'Contact form workflow',
        'No online payment required',
      ],
    },
    tour_operator_pro: {
      badge: 'Most commercial-ready',
      audience: 'Tour operators who want direct sales, payments, and full tour operations.',
      pitch: 'Run your public tour storefront, accept online payments, and manage tour operations in one plan.',
      note: 'Built for operators who need stronger conversion and transactional readiness.',
      feature_bullets: [
        'Tour operations workspace',
        'Public tour selling and online payment',
        'Custom domain readiness',
        'Revenue-share ready business model',
      ],
    },
    hotel_operator_pro: {
      badge: 'Coming next',
      audience: 'Hotels and hospitality teams that want room-led commerce on the same stack.',
      pitch: 'Prepare for hotel inventory, branded booking, and payment-enabled hospitality operations.',
      note: 'Visible now for roadmap clarity. Signup opens when hotel runtime is ready.',
      feature_bullets: [
        'Hotel operations foundation',
        'Payment and custom domain support',
        'Low hospitality revenue-share target',
        'Future-ready migration path',
      ],
    },
    tour_hotel_suite: {
      badge: 'Future flagship',
      audience: 'Hybrid brands selling tours and stays from a single commercial engine.',
      pitch: 'Unify tour sales, hotel operations, payments, and brand control in one higher-value suite.',
      note: 'Best fit for brands that need bundle-scale operations, not just brochureware.',
      feature_bullets: [
        'Tours and hotels in one stack',
        'Shared checkout and brand surface',
        'Combined commercial visibility',
        'Designed for higher-margin travel groups',
      ],
    },
  },
});

function cloneDefaultConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_MARKETING_SITE));
}

function sanitizeString(value, fallback = '', maxLength = 2000) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, maxLength) : fallback;
}

function sanitizeUrl(value, fallback) {
  const url = sanitizeString(value, '', 512);
  if (!url) return fallback;
  if (url.startsWith('/') || url.startsWith('#') || url.startsWith('https://') || url.startsWith('http://')) {
    return url;
  }
  return fallback;
}

function sanitizeStringArray(value, fallback = [], maxItems = 8, maxLength = 180) {
  if (!Array.isArray(value)) return fallback;
  return value
    .map((item) => sanitizeString(item, '', maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function sanitizeCards(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value
    .slice(0, 6)
    .map((item) => ({
      eyebrow: sanitizeString(item?.eyebrow, '', 80),
      title: sanitizeString(item?.title, '', 120),
      body: sanitizeString(item?.body, '', 280),
    }))
    .filter((item) => item.title || item.body);
}

function sanitizeFaqItems(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value
    .slice(0, 8)
    .map((item) => ({
      question: sanitizeString(item?.question, '', 180),
      answer: sanitizeString(item?.answer, '', 500),
    }))
    .filter((item) => item.question && item.answer);
}

function sanitizeTierOverrides(value, fallback = {}) {
  if (!value || typeof value !== 'object') return fallback;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([tierKey]) => isValidProductTierKey(tierKey))
      .map(([tierKey, override]) => [tierKey, {
        badge: sanitizeString(override?.badge, '', 60),
        audience: sanitizeString(override?.audience, '', 220),
        pitch: sanitizeString(override?.pitch, '', 320),
        note: sanitizeString(override?.note, '', 220),
        feature_bullets: sanitizeStringArray(override?.feature_bullets, [], 8, 160),
      }]),
  );
}

export function sanitizeMarketingSiteConfig(input = {}) {
  const defaults = cloneDefaultConfig();

  return {
    announcement_bar: sanitizeString(input.announcement_bar, defaults.announcement_bar, 220),
    launch_offer_badge: sanitizeString(input.launch_offer_badge, defaults.launch_offer_badge, 80),
    launch_offer_terms: sanitizeString(input.launch_offer_terms, defaults.launch_offer_terms, 180),
    signup_title: sanitizeString(input.signup_title, defaults.signup_title, 120),
    signup_requirement_copy: sanitizeString(input.signup_requirement_copy, defaults.signup_requirement_copy, 280),
    hero_badge: sanitizeString(input.hero_badge, defaults.hero_badge, 80),
    hero_title: sanitizeString(input.hero_title, defaults.hero_title, 180),
    hero_subtitle: sanitizeString(input.hero_subtitle, defaults.hero_subtitle, 360),
    primary_cta: {
      label: sanitizeString(input.primary_cta?.label, defaults.primary_cta.label, 60),
      url: sanitizeUrl(input.primary_cta?.url, defaults.primary_cta.url),
    },
    secondary_cta: {
      label: sanitizeString(input.secondary_cta?.label, defaults.secondary_cta.label, 60),
      url: sanitizeUrl(input.secondary_cta?.url, defaults.secondary_cta.url),
    },
    hero_trust_points: sanitizeStringArray(input.hero_trust_points, defaults.hero_trust_points, 8, 120),
    spotlight_cards: sanitizeCards(input.spotlight_cards, defaults.spotlight_cards),
    plans_title: sanitizeString(input.plans_title, defaults.plans_title, 120),
    plans_subtitle: sanitizeString(input.plans_subtitle, defaults.plans_subtitle, 320),
    transparency_title: sanitizeString(input.transparency_title, defaults.transparency_title, 120),
    transparency_body: sanitizeString(input.transparency_body, defaults.transparency_body, 320),
    transparency_points: sanitizeStringArray(input.transparency_points, defaults.transparency_points, 6, 160),
    faq_title: sanitizeString(input.faq_title, defaults.faq_title, 120),
    faq_items: sanitizeFaqItems(input.faq_items, defaults.faq_items),
    bottom_cta_title: sanitizeString(input.bottom_cta_title, defaults.bottom_cta_title, 160),
    bottom_cta_body: sanitizeString(input.bottom_cta_body, defaults.bottom_cta_body, 320),
    bottom_cta: {
      label: sanitizeString(input.bottom_cta?.label, defaults.bottom_cta.label, 60),
      url: sanitizeUrl(input.bottom_cta?.url, defaults.bottom_cta.url),
    },
    waitlist_url: sanitizeUrl(input.waitlist_url, defaults.waitlist_url),
    tier_overrides: sanitizeTierOverrides(input.tier_overrides, defaults.tier_overrides),
  };
}

async function readMarketingSiteRow(db) {
  return db
    .prepare('SELECT value_json, updated_at FROM app_settings WHERE setting_key = ?')
    .bind(MARKETING_SITE_SETTING_KEY)
    .first();
}

export async function loadMarketingSiteConfig(db) {
  const defaults = cloneDefaultConfig();

  try {
    const row = await readMarketingSiteRow(db);
    if (!row?.value_json) {
      return { ...defaults, updated_at: null };
    }

    const parsed = JSON.parse(row.value_json);
    const config = sanitizeMarketingSiteConfig(parsed);
    return {
      ...config,
      updated_at: row.updated_at ?? null,
    };
  } catch {
    return { ...defaults, updated_at: null };
  }
}

export async function saveMarketingSiteConfig(db, nextConfig) {
  const sanitized = sanitizeMarketingSiteConfig(nextConfig);
  const updatedAt = Math.floor(Date.now() / 1000);

  await db
    .prepare(
      `INSERT INTO app_settings (setting_key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(setting_key)
       DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    )
    .bind(MARKETING_SITE_SETTING_KEY, JSON.stringify(sanitized), updatedAt)
    .run();

  return {
    ...sanitized,
    updated_at: updatedAt,
  };
}

export async function getMarketingSitePayload(db, lang = 'en') {
  const site = await loadMarketingSiteConfig(db);
  const catalog = getProductTierCatalogPayload(lang);

  const tiers = catalog.tiers.map((tier) => {
    const override = site.tier_overrides?.[tier.key] ?? {};
    const ctaUrl = tier.available_for_signup
      ? `/signup.html?tier=${encodeURIComponent(tier.key)}`
      : sanitizeUrl(site.waitlist_url, '/signup.html');

    return {
      ...tier,
      marketing_badge: override.badge || tier.availability_label,
      audience: override.audience || '',
      sales_pitch: override.pitch || tier.description || '',
      marketing_note: override.note || '',
      feature_bullets: Array.isArray(override.feature_bullets) && override.feature_bullets.length > 0
        ? override.feature_bullets
        : tier.feature_bullets,
      cta_label: tier.available_for_signup ? site.primary_cta.label : 'Join waitlist',
      cta_url: ctaUrl,
    };
  });

  return {
    lang: catalog.lang,
    updated_at: site.updated_at ?? null,
    site: {
      announcement_bar: site.announcement_bar,
      launch_offer_badge: site.launch_offer_badge,
      launch_offer_terms: site.launch_offer_terms,
      signup_title: site.signup_title,
      signup_requirement_copy: site.signup_requirement_copy,
      hero_badge: site.hero_badge,
      hero_title: site.hero_title,
      hero_subtitle: site.hero_subtitle,
      primary_cta: site.primary_cta,
      secondary_cta: site.secondary_cta,
      hero_trust_points: site.hero_trust_points,
      spotlight_cards: site.spotlight_cards,
      plans_title: site.plans_title,
      plans_subtitle: site.plans_subtitle,
      transparency_title: site.transparency_title,
      transparency_body: site.transparency_body,
      transparency_points: site.transparency_points,
      faq_title: site.faq_title,
      faq_items: site.faq_items,
      bottom_cta_title: site.bottom_cta_title,
      bottom_cta_body: site.bottom_cta_body,
      bottom_cta: site.bottom_cta,
      waitlist_url: site.waitlist_url,
    },
    tiers,
  };
}