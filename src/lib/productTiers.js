import { getLocaleMessages, normalizeLocale } from '../utils/formatter.js';

const PRODUCT_TIERS = [
  {
    key: 'starter_landing',
    family: 'landing',
    availability: 'active',
    available_for_signup: true,
    price_eur_monthly: 4.98,
    billing_model: 'per_user_month',
    capabilities: {
      landing_page: true,
      platform_subdomain: true,
      custom_domain_required: false,
      contact_form: true,
      payment_enabled: false,
      electronic_gateway_required: false,
      bank_transfer_supplementary: false,
      tour_operations: false,
      hotel_operations: false,
      public_tour_sales: false,
    },
    revenue_share: null,
  },
  {
    key: 'tour_operator_pro',
    family: 'tour',
    availability: 'active',
    available_for_signup: true,
    price_eur_monthly: 9.98,
    billing_model: 'per_user_month',
    capabilities: {
      landing_page: true,
      platform_subdomain: true,
      custom_domain_required: true,
      contact_form: true,
      // payment_enabled: electronic gateway (Stripe/MoMo/VNPay...) is REQUIRED to unlock commerce.
      // Bank transfer may be added as a supplementary method only after electronic gateway is active.
      payment_enabled: true,
      electronic_gateway_required: true,
      bank_transfer_supplementary: true,
      tour_operations: true,
      hotel_operations: false,
      public_tour_sales: true,
    },
    revenue_share: {
      applies_to: 'tour',
      billing_model: 'threshold_invoiced',
      // Commission is invoiced monthly to the operator — never deducted from customer payments.
      // Thresholds based on confirmed booking volume in EUR per calendar month:
      tiers: [
        { threshold_eur_min: 0,    threshold_eur_max: 499,  percent: 0 },
        { threshold_eur_min: 500,  threshold_eur_max: 1499, percent: 1 },
        { threshold_eur_min: 1500, threshold_eur_max: null, percent: 2 },
      ],
    },
  },
  {
    key: 'hotel_operator_pro',
    family: 'hotel',
    availability: 'future',
    available_for_signup: false,
    price_eur_monthly: 9.98,
    billing_model: 'per_user_month',
    capabilities: {
      landing_page: true,
      platform_subdomain: true,
      custom_domain_required: true,
      contact_form: true,
      payment_enabled: true,
      electronic_gateway_required: true,
      bank_transfer_supplementary: true,
      tour_operations: false,
      hotel_operations: true,
      public_tour_sales: false,
    },
    revenue_share: {
      applies_to: 'hotel',
      billing_model: 'threshold_invoiced',
      tiers: [
        { threshold_eur_min: 0,    threshold_eur_max: 499,  percent: 0 },
        { threshold_eur_min: 500,  threshold_eur_max: 1499, percent: 1 },
        { threshold_eur_min: 1500, threshold_eur_max: null, percent: 2 },
      ],
    },
  },
  {
    key: 'tour_hotel_suite',
    family: 'bundle',
    availability: 'future',
    available_for_signup: false,
    price_eur_monthly: 19,
    billing_model: 'per_user_month',
    capabilities: {
      landing_page: true,
      platform_subdomain: true,
      custom_domain_required: true,
      contact_form: true,
      payment_enabled: true,
      electronic_gateway_required: true,
      bank_transfer_supplementary: true,
      tour_operations: true,
      hotel_operations: true,
      public_tour_sales: true,
    },
    revenue_share: {
      applies_to: 'mixed',
      billing_model: 'threshold_invoiced',
      tiers: [
        { threshold_eur_min: 0,    threshold_eur_max: 499,  percent: 0 },
        { threshold_eur_min: 500,  threshold_eur_max: 1499, percent: 1 },
        { threshold_eur_min: 1500, threshold_eur_max: null, percent: 2 },
      ],
    },
  },
];

function resolve(messages, path) {
  return String(path || '').split('.').reduce((node, key) => node && node[key], messages);
}

function template(str, vars = {}) {
  return String(str || '').replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? `{{${key}}}`));
}

export function getDefaultSignupTierKey() {
  return PRODUCT_TIERS.find((tier) => tier.available_for_signup)?.key || PRODUCT_TIERS[0].key;
}

export function isValidProductTierKey(tierKey) {
  return PRODUCT_TIERS.some((tier) => tier.key === tierKey);
}

export function resolveSignupTierKey(rawTierKey) {
  const tierKey = String(rawTierKey || '').trim();
  if (!tierKey) return getDefaultSignupTierKey();

  const tier = PRODUCT_TIERS.find((item) => item.key === tierKey);
  if (!tier) return null;
  if (!tier.available_for_signup) return null;
  return tier.key;
}

export function getProductTierCatalog(lang = 'en') {
  const locale = normalizeLocale(lang);
  const messages = getLocaleMessages(locale);
  const priceTemplate = resolve(messages, 'product_tiers.per_user_month') || 'EUR {{price}} / user / month';
  const activeLabel = resolve(messages, 'product_tiers.status_active') || 'Available now';
  const futureLabel = resolve(messages, 'product_tiers.status_future') || 'Future tier';

  return PRODUCT_TIERS.map((tier) => {
    const tierBase = `product_tiers.tiers.${tier.key}`;
    return {
      ...tier,
      name: resolve(messages, `${tierBase}.name`) || tier.key,
      tagline: resolve(messages, `${tierBase}.tagline`) || '',
      description: resolve(messages, `${tierBase}.description`) || '',
      feature_bullets: resolve(messages, `${tierBase}.features`) || [],
      price_label: template(priceTemplate, { price: tier.price_eur_monthly.toFixed(2) }),
      availability_label: tier.available_for_signup ? activeLabel : futureLabel,
    };
  });
}

export function getProductTierCatalogPayload(lang = 'en') {
  const locale = normalizeLocale(lang);
  const messages = getLocaleMessages(locale);

  return {
    lang: locale,
    title: resolve(messages, 'product_tiers.catalog_title') || 'Choose your product plan',
    hint: resolve(messages, 'product_tiers.catalog_hint') || 'Start with an active plan now. Future tiers are shown for roadmap visibility.',
    tiers: getProductTierCatalog(locale),
  };
}