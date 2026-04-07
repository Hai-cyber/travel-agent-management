const RESERVED_SUBDOMAIN_GROUPS = Object.freeze({
  marketing: Object.freeze([
    'www', 'marketing', 'start', 'plans', 'demo', 'customers', 'compare', 'why',
    'stories', 'blog', 'learn', 'academy', 'events', 'promo', 'go',
    'community', 'waitlist'
  ]),
  commercial: Object.freeze([
    'partners', 'referrals', 'rewards', 'billing', 'checkout', 'pay', 'book',
    'trips', 'portal', 'success', 'migrate', 'import', 'contact'
  ]),
  product: Object.freeze([
    'app', 'auth', 'studio', 'preview', 'api', 'docs', 'developers', 'help',
    'support', 'id'
  ]),
  operations: Object.freeze([
    'admin', 'ops', 'internal', 'status', 'trust', 'legal', 'webhooks', 'hooks',
    'cdn', 'assets', 'media', 'edge', 'sandbox', 'staging', 'dev', 'beta',
    'labs', 'region', 'm'
  ]),
  technical: Object.freeze([
    'mail', 'smtp', 'imap', 'pop', 'ftp', 'ns1', 'ns2', 'autodiscover',
    'webmail', 'cpanel', 'localhost'
  ]),
});

const RESERVED_GROUP_DESCRIPTIONS = Object.freeze({
  marketing: 'platform marketing, SEO, and campaign surfaces',
  commercial: 'platform commerce, revenue, and customer lifecycle surfaces',
  product: 'platform product, auth, API, docs, and support surfaces',
  operations: 'platform operations, delivery, and environment surfaces',
  technical: 'infrastructure, email, DNS, and operational safety labels',
});

const RESERVED_SUBDOMAIN_SET = new Set(
  Object.values(RESERVED_SUBDOMAIN_GROUPS).flat()
);

const SUGGESTION_SUFFIXES = Object.freeze([
  'travel',
  'agency',
  'tours',
  'studio',
  'team',
  'co',
]);

const SUBDOMAIN_MIN_LENGTH = 3;
const SUBDOMAIN_MAX_LENGTH = 63;
const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
const SUBDOMAIN_REVIEW_USER_AGENT = 'travel-agent-management/1.0 subdomain-review';

const SUSPICIOUS_SUBDOMAIN_GROUPS = Object.freeze({
  auth: Object.freeze([
    'account', 'accounts', 'login', 'signin', 'signon', 'verify', 'verification',
    'secure', 'security', 'reset', 'password', 'passcode', 'otp', 'sso', 'auth'
  ]),
  finance: Object.freeze([
    'bank', 'banking', 'payment', 'payments', 'billing', 'invoice', 'refund',
    'wallet', 'card', 'transfer', 'kyc', 'aml', 'pay', 'checkout'
  ]),
  support: Object.freeze([
    'support', 'helpdesk', 'help', 'service', 'case', 'ticket', 'recovery'
  ]),
  authority: Object.freeze([
    'admin', 'system', 'internal', 'staff', 'employee', 'hr', 'payroll', 'gov',
    'government', 'official', 'police', 'court', 'tax', 'customs'
  ]),
  locale_variants: Object.freeze([
    'taikhoan', 'dangnhap', 'xacminh', 'thanhtoan', 'nganhang', 'hotro',
    'factura', 'pagos', 'suporte', 'seguro', 'banque'
  ]),
});

const PROTECTED_BRAND_SLUGS = Object.freeze([
  'paypal', 'stripe', 'visa', 'mastercard', 'americanexpress', 'amex', 'wise',
  'revolut', 'chase', 'citibank', 'citi', 'hsbc', 'barclays', 'santander',
  'lloyds', 'natwest', 'dbs', 'ocbc', 'uob', 'maybank', 'bca', 'bni', 'mandiri',
  'bdo', 'bpi', 'gtbank', 'accessbank', 'stanbic', 'absa', 'ecobank',
  'vietcombank', 'vietinbank', 'techcombank', 'bidv', 'acb', 'sacombank',
  'agribank', 'mbbank', 'tpbank', 'vpbank'
]);

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
}

function splitSubdomainTokens(value) {
  return normalizeSubdomainLabel(value).split('-').filter(Boolean);
}

function compactSubdomainLabel(value) {
  return normalizeSubdomainLabel(value).replace(/-/g, '');
}

function summarizeReviewSignals(signals) {
  return dedupe(signals.map((signal) => signal.summary).filter(Boolean)).slice(0, 3);
}

async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function levenshteinDistance(left, right) {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  const rows = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) rows[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) rows[0][j] = j;

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + cost
      );
    }
  }

  return rows[left.length][right.length];
}

function normalizedSimilarity(left, right) {
  const longest = Math.max(left.length, right.length);
  if (!longest) return 1;
  return 1 - (levenshteinDistance(left, right) / longest);
}

function calculateShannonEntropy(value) {
  if (!value) return 0;
  const counts = new Map();
  for (const char of value) {
    counts.set(char, (counts.get(char) || 0) + 1);
  }
  return [...counts.values()].reduce((entropy, count) => {
    const probability = count / value.length;
    return entropy - (probability * Math.log2(probability));
  }, 0);
}

function detectSuspiciousKeywordSignals(normalized) {
  const compact = compactSubdomainLabel(normalized);
  const tokens = splitSubdomainTokens(normalized);
  const matches = [];

  for (const [group, fragments] of Object.entries(SUSPICIOUS_SUBDOMAIN_GROUPS)) {
    for (const fragment of fragments) {
      if (tokens.includes(fragment) || compact.includes(fragment)) {
        matches.push({ group, fragment });
      }
    }
  }

  const uniqueMatches = dedupe(matches.map((match) => `${match.group}:${match.fragment}`)).map((entry) => {
    const [group, fragment] = entry.split(':');
    return { group, fragment };
  });

  if (!uniqueMatches.length) return [];

  return [{
    type: 'suspicious_keywords',
    severity: 'review',
    summary: `contains phishing-sensitive keyword${uniqueMatches.length > 1 ? 's' : ''}`,
    details: uniqueMatches,
  }];
}

function detectProtectedBrandSignals(normalized) {
  const compact = compactSubdomainLabel(normalized);
  if (!compact || compact.length < SUBDOMAIN_MIN_LENGTH) return [];

  let bestMatch = null;
  for (const brand of PROTECTED_BRAND_SLUGS) {
    const similarity = normalizedSimilarity(compact, brand);
    const containsBrand = compact.includes(brand) || brand.includes(compact);
    const closeLength = Math.abs(compact.length - brand.length) <= 2;

    if (!containsBrand && !(closeLength && similarity >= 0.86)) continue;

    if (!bestMatch || similarity > bestMatch.similarity) {
      bestMatch = {
        brand,
        similarity,
        contains_brand: containsBrand,
      };
    }
  }

  if (!bestMatch) return [];

  return [{
    type: 'protected_brand',
    severity: 'review',
    summary: `closely resembles protected finance brand "${bestMatch.brand}"`,
    details: bestMatch,
  }];
}

function detectHighEntropySignals(normalized) {
  const compact = compactSubdomainLabel(normalized);
  if (compact.length < 8) return [];

  const entropy = calculateShannonEntropy(compact);
  const digitCount = (compact.match(/\d/g) || []).length;
  const letterCount = (compact.match(/[a-z]/g) || []).length;
  const vowelCount = (compact.match(/[aeiou]/g) || []).length;
  const uniqueRatio = new Set(compact).size / compact.length;
  const digitRatio = digitCount / compact.length;
  const vowelRatio = letterCount ? (vowelCount / letterCount) : 0;
  const looksRandom = (
    (digitCount >= 2 && digitRatio >= 0.2 && entropy >= 3.2 && uniqueRatio >= 0.6) ||
    (compact.length >= 12 && entropy >= 3.6 && uniqueRatio >= 0.7) ||
    (compact.length >= 10 && vowelRatio > 0 && vowelRatio < 0.2 && uniqueRatio >= 0.7)
  );

  if (!looksRandom) return [];

  return [{
    type: 'high_entropy',
    severity: 'review',
    summary: 'looks randomly generated or typo-squatting oriented',
    details: {
      entropy: Number(entropy.toFixed(3)),
      digit_ratio: Number(digitRatio.toFixed(3)),
      unique_ratio: Number(uniqueRatio.toFixed(3)),
      vowel_ratio: Number(vowelRatio.toFixed(3)),
    },
  }];
}

function analyzeSubdomainRisk(normalized) {
  const signals = [
    ...detectSuspiciousKeywordSignals(normalized),
    ...detectProtectedBrandSignals(normalized),
    ...detectHighEntropySignals(normalized),
  ];

  return {
    requires_review: signals.length > 0,
    signals,
    summaries: summarizeReviewSignals(signals),
  };
}

export function normalizeSubdomainLabel(value) {
  return String(value || '').trim().toLowerCase();
}

export function slugifySubdomainLabel(value, maxLength = SUBDOMAIN_MAX_LENGTH) {
  return normalizeSubdomainLabel(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength);
}

export function isValidSubdomainFormat(value) {
  const normalized = normalizeSubdomainLabel(value);
  return normalized.length >= SUBDOMAIN_MIN_LENGTH
    && normalized.length <= SUBDOMAIN_MAX_LENGTH
    && SUBDOMAIN_PATTERN.test(normalized);
}

export function isReservedSubdomain(value) {
  return RESERVED_SUBDOMAIN_SET.has(normalizeSubdomainLabel(value));
}

export function getReservedSubdomainCategory(value) {
  const normalized = normalizeSubdomainLabel(value);
  for (const [groupKey, labels] of Object.entries(RESERVED_SUBDOMAIN_GROUPS)) {
    if (labels.includes(normalized)) {
      return groupKey;
    }
  }
  return '';
}

export function getReservedSubdomainReason(value) {
  const normalized = normalizeSubdomainLabel(value);
  const category = getReservedSubdomainCategory(normalized);
  const description = RESERVED_GROUP_DESCRIPTIONS[category] || 'platform operations';
  return `Subdomain "${normalized}" is reserved for ${description}. Please choose a tenant-specific brand label instead.`;
}

export function resolvePlatformApexDomain(env) {
  const configured = String(env?.PLATFORM_BASE_URL || '').trim();
  if (configured) {
    try {
      return new URL(configured).hostname || 'tours-market.com';
    } catch {
      return configured.replace(/^https?:\/\//i, '').replace(/\/.*$/, '') || 'tours-market.com';
    }
  }
  return 'tours-market.com';
}

export function buildSubdomainPolicy(env) {
  const apexDomain = resolvePlatformApexDomain(env);
  return {
    apex_domain: apexDomain,
    lock_once: true,
    min_length: SUBDOMAIN_MIN_LENGTH,
    max_length: SUBDOMAIN_MAX_LENGTH,
    pattern: SUBDOMAIN_PATTERN.source,
    review_required: true,
    reserved_subdomains: Array.from(RESERVED_SUBDOMAIN_SET).sort(),
    reserved_groups: Object.fromEntries(
      Object.entries(RESERVED_SUBDOMAIN_GROUPS).map(([groupKey, labels]) => [
        groupKey,
        {
          description: RESERVED_GROUP_DESCRIPTIONS[groupKey],
          labels,
        },
      ])
    ),
    suggestion_suffixes: [...SUGGESTION_SUFFIXES],
    examples_allowed: ['sunset-travel', 'atlas-voyages', 'blue-lagoon-tours'],
    examples_reserved: ['app', 'auth', 'demo', 'billing', 'status'],
  };
}

export function buildTenantSubdomainSuggestions(rawValue, limit = 5) {
  const normalized = slugifySubdomainLabel(rawValue);

  const base = normalized || 'travel-brand';
  const candidates = [base];
  for (const suffix of SUGGESTION_SUFFIXES) {
    candidates.push(`${base}-${suffix}`.slice(0, SUBDOMAIN_MAX_LENGTH).replace(/-+$/g, ''));
  }
  candidates.push(`go-${base}`.slice(0, SUBDOMAIN_MAX_LENGTH).replace(/-+$/g, ''));
  candidates.push(`${base}-team`.slice(0, SUBDOMAIN_MAX_LENGTH).replace(/-+$/g, ''));

  return dedupe(candidates)
    .filter((candidate) => candidate && !isReservedSubdomain(candidate))
    .slice(0, limit);
}

export async function dispatchSubdomainReviewAlert(env, details = {}) {
  const webhookUrl = String(env?.SUBDOMAIN_REVIEW_WEBHOOK_URL || '').trim();
  const webhookSecret = String(env?.SUBDOMAIN_REVIEW_WEBHOOK_SECRET || '').trim();
  const reviewEmail = String(env?.SUBDOMAIN_REVIEW_EMAIL || '').trim() || null;
  const eventId = crypto.randomUUID();
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = {
    event: 'subdomain.review_required',
    event_id: eventId,
    occurred_at: timestamp,
    review_email: reviewEmail,
    subdomain: {
      attempted: details.attemptedSubdomain || null,
      current: details.currentSubdomain || null,
      suggestions: Array.isArray(details.suggestions) ? details.suggestions : [],
    },
    tenant: {
      id: details.tenantId || null,
      name: details.tenantName || null,
    },
    review: details.review || null,
    request: {
      ip: details.ip || null,
      user_agent: details.userAgent || null,
    },
    source: {
      app: 'travel-agent-management',
      base_url: String(env?.PLATFORM_BASE_URL || '').trim() || null,
    },
  };
  const payloadText = JSON.stringify(payload);

  if (webhookUrl) {
    try {
      const destinationUrl = new URL(webhookUrl);
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': SUBDOMAIN_REVIEW_USER_AGENT,
        'X-TravelAgent-Event': payload.event,
        'X-TravelAgent-Event-Id': eventId,
        'X-TravelAgent-Timestamp': String(timestamp),
      };

      destinationUrl.searchParams.set('ta_event', payload.event);
      destinationUrl.searchParams.set('ta_event_id', eventId);
      destinationUrl.searchParams.set('ta_ts', String(timestamp));

      if (webhookSecret) {
        const signature = await hmacSha256Hex(webhookSecret, `${timestamp}.${payloadText}`);
        headers['X-TravelAgent-Signature'] = `v1=${signature}`;
        destinationUrl.searchParams.set('ta_sig_v', 'v1');
        destinationUrl.searchParams.set('ta_sig', signature);
      }

      const response = await fetch(destinationUrl.toString(), {
        method: 'POST',
        headers,
        body: payloadText,
      });

      if (response.ok) {
        return { channel: 'webhook', delivered: true };
      }

      console.warn(`[subdomain-review] webhook delivery failed: status=${response.status}`);
    } catch (error) {
      console.warn('[subdomain-review] webhook delivery error:', error.message);
    }
  }

  console.warn(
    `[SUBDOMAIN_REVIEW_REQUIRED] tenant=${details.tenantId || '-'} attempted=${details.attemptedSubdomain || '-'} reasons=${(details.review?.summaries || []).join('; ') || 'manual review'}`
  );
  return { channel: 'log_only', delivered: false };
}

export function validateSubdomainCandidate(rawValue, options = {}) {
  const input = String(rawValue ?? '');
  const normalized = slugifySubdomainLabel(input);
  const currentSubdomain = normalizeSubdomainLabel(options.currentSubdomain);
  const suggestionSeed = options.suggestionSeed || options.tenantName || normalized || input;
  const allowReserved = options.allowReserved === true;
  const lockOnce = options.lockOnce !== false;
  const enforceRiskChecks = options.enforceRiskChecks !== false;
  const policy = options.policy || buildSubdomainPolicy(options.env);

  if (!normalized || !isValidSubdomainFormat(normalized)) {
    return {
      ok: false,
      code: 'invalid_format',
      input,
      normalized,
      is_reserved: false,
      is_locked: false,
      review_required: false,
      review: null,
      reason: `Subdomain must use lowercase letters, numbers, and hyphens only, cannot start or end with a hyphen, and must be ${SUBDOMAIN_MIN_LENGTH}-${SUBDOMAIN_MAX_LENGTH} characters long.`,
      suggestions: buildTenantSubdomainSuggestions(suggestionSeed),
      policy,
    };
  }

  if (lockOnce && currentSubdomain && normalized !== currentSubdomain) {
    return {
      ok: false,
      code: 'locked_once',
      input,
      normalized,
      is_reserved: false,
      is_locked: true,
      review_required: false,
      review: null,
      reason: 'Subdomain has already been locked for this tenant and cannot be changed.',
      suggestions: [currentSubdomain],
      policy,
    };
  }

  if (!allowReserved && normalized !== currentSubdomain && isReservedSubdomain(normalized)) {
    return {
      ok: false,
      code: 'reserved',
      input,
      normalized,
      is_reserved: true,
      is_locked: false,
      review_required: false,
      review: null,
      reason: getReservedSubdomainReason(normalized),
      suggestions: buildTenantSubdomainSuggestions(suggestionSeed),
      policy,
    };
  }

  if (enforceRiskChecks && normalized !== currentSubdomain) {
    const review = analyzeSubdomainRisk(normalized);
    if (review.requires_review) {
      const reviewReason = review.summaries.length
        ? `Subdomain requires manual review because it ${review.summaries.join(', ')}.`
        : 'Subdomain requires manual review before it can be locked.';
      return {
        ok: false,
        code: 'manual_review',
        input,
        normalized,
        is_reserved: false,
        is_locked: false,
        review_required: true,
        review,
        reason: reviewReason,
        suggestions: buildTenantSubdomainSuggestions(suggestionSeed),
        policy,
      };
    }
  }

  return {
    ok: true,
    code: 'ok',
    input,
    normalized,
    is_reserved: false,
    is_locked: Boolean(currentSubdomain),
    review_required: false,
    review: null,
    reason: '',
    suggestions: buildTenantSubdomainSuggestions(suggestionSeed),
    policy,
  };
}
