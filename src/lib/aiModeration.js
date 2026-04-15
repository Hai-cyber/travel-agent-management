function dedupe(values) {
  return [...new Set((values || []).filter(Boolean))];
}

const DEFAULT_AI_PROVIDER = 'cloudflare-ai';
const DEFAULT_CF_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const VALID_ACTIONS = new Set(['ALLOW', 'REVIEW', 'BLOCK', 'QUARANTINE']);

function clampNumber(value, min, max, fallback = min) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function normalizeCategoryList(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry) => ({
      key: String(entry?.key || '').trim().toLowerCase(),
      score: clampNumber(entry?.score, 0, 100, 0),
      evidence: Array.isArray(entry?.evidence)
        ? entry.evidence.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 4)
        : [],
    }))
    .filter((entry) => entry.key);
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(value, maxLength) {
  const text = String(value || '');
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

function buildNavigationDigest(siteConfig = {}) {
  const navigation = Array.isArray(siteConfig.navigation) ? siteConfig.navigation : [];
  return navigation.slice(0, 20).map((entry) => ({
    label: String(entry?.label || '').trim(),
    url: String(entry?.url || '').trim(),
  }));
}

function buildSectionsDigest(siteConfig = {}) {
  const customSections = Array.isArray(siteConfig.custom_sections) ? siteConfig.custom_sections : [];
  return customSections.slice(0, 24).map((entry, index) => ({
    id: String(entry?.id || `section-${index + 1}`).trim(),
    html_excerpt: truncate(String(entry?.html || '').trim(), 1200),
    text_excerpt: truncate(stripHtml(entry?.html || ''), 700),
  }));
}

export function buildTenantModerationPayload({ tenant = {}, siteConfig = {}, stage = 'publish' } = {}) {
  const navigation = buildNavigationDigest(siteConfig);
  const sections = buildSectionsDigest(siteConfig);
  const brand = siteConfig.brand && typeof siteConfig.brand === 'object' ? siteConfig.brand : {};
  const content = siteConfig.content && typeof siteConfig.content === 'object' ? siteConfig.content : {};
  const combinedText = truncate([
    tenant.name,
    tenant.subdomain,
    tenant.custom_domain,
    JSON.stringify(brand),
    JSON.stringify(content),
    ...navigation.map((entry) => `${entry.label} ${entry.url}`),
    ...sections.map((entry) => `${entry.id} ${entry.text_excerpt}`),
  ].filter(Boolean).join('\n'), 20000);

  return {
    stage,
    tenant: {
      id: tenant.id || null,
      name: tenant.name || null,
      email: tenant.email || null,
      subdomain: tenant.subdomain || null,
      custom_domain: tenant.custom_domain || null,
      trust_status: tenant.trust_status || null,
      subscription_status: tenant.subscription_status || null,
    },
    site: {
      brand: {
        name: String(brand.name || '').trim(),
        primary_color: String(brand.primary_color || '').trim(),
      },
      content: {
        hero_title: String(content.hero_title || '').trim(),
        hero_desc: String(content.hero_desc || '').trim(),
      },
      navigation,
      sections,
      combined_text: combinedText,
    },
  };
}

export function buildAssetModerationPayload({ tenant = {}, asset = {}, extractedText = '', stage = 'asset_upload' } = {}) {
  return {
    stage,
    tenant: {
      id: tenant.id || null,
      name: tenant.name || null,
      subdomain: tenant.subdomain || null,
      trust_status: tenant.trust_status || null,
      subscription_status: tenant.subscription_status || null,
    },
    asset: {
      filename: String(asset.filename || '').trim(),
      mime: String(asset.mime || '').trim(),
      size_bytes: Number(asset.size_bytes || asset.size || 0) || 0,
      sha256: String(asset.sha256 || '').trim() || null,
      text_excerpt: truncate(String(extractedText || '').trim(), 2000),
    },
  };
}

function buildModerationPrompt(payload) {
  return [
    'You are a SaaS tenant abuse and fraud moderation classifier.',
    'The tenant claims to be a travel business, travel agent, tour operator, or hospitality-related business.',
    'Your task is to classify whether the provided tenant content looks like phishing, scam, impersonation, SEO spam, adult content, gambling, pharma affiliate abuse, or other platform misuse.',
    'Return JSON only. No markdown. No prose outside JSON.',
    'Use this exact schema:',
    JSON.stringify({
      risk_score: 0,
      confidence: 0,
      recommended_action: 'ALLOW',
      categories: [{ key: 'phishing', score: 0, evidence: [''] }],
      summary: 'short operator summary',
      operator_message: 'what ops should know',
      reasons: ['short reason'],
    }),
    'Rules:',
    '- risk_score must be 0-100',
    '- confidence must be 0-1',
    '- recommended_action must be one of ALLOW, REVIEW, BLOCK, QUARANTINE',
    '- Use higher risk for credential theft, impersonation, fake finance, giveaway scams, explicit adult content, or obvious SEO spam',
    '- If this looks like a normal travel business site, return ALLOW with low risk',
    '- Focus on tenant content, links, forms, brand mismatch, and abuse intent',
    'Tenant payload:',
    JSON.stringify(payload),
  ].join('\n');
}

function buildAssetModerationPrompt(payload) {
  return [
    'You are a SaaS asset abuse moderation classifier.',
    'The platform hosts travel-business tenant assets such as images, videos, svg illustrations, brochures, and brand media.',
    'Classify whether the uploaded asset likely supports phishing, scam, impersonation, credential capture, SEO spam, adult content, gambling, malware delivery, or other platform misuse.',
    'Return JSON only. No markdown. No prose outside JSON.',
    'Use this exact schema:',
    JSON.stringify({
      risk_score: 0,
      confidence: 0,
      recommended_action: 'ALLOW',
      categories: [{ key: 'phishing', score: 0, evidence: [''] }],
      summary: 'short operator summary',
      operator_message: 'what ops should know',
      reasons: ['short reason'],
    }),
    'Rules:',
    '- risk_score must be 0-100',
    '- confidence must be 0-1',
    '- recommended_action must be one of ALLOW, REVIEW, BLOCK, QUARANTINE',
    '- Block or quarantine clear phishing, credential-harvest, malware, or explicit scam assets',
    '- Review suspicious branding mismatches, finance lures, giveaway bait, or repeated spam-like media',
    '- Allow normal travel photography, destination visuals, brochures, and marketing video assets',
    'Asset payload:',
    JSON.stringify(payload),
  ].join('\n');
}

function stripMarkdownCodeFence(value) {
  const text = String(value || '').trim();
  if (!text.startsWith('```')) return text;
  return text
    .replace(/^```[a-zA-Z0-9_-]*\s*/, '')
    .replace(/\s*```$/, '')
    .trim();
}

function extractJsonObject(value) {
  const text = stripMarkdownCodeFence(value);
  const parsed = safeJsonParse(text);
  if (parsed) return parsed;

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return safeJsonParse(text.slice(start, end + 1));
  }

  return null;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractCloudflareAiText(responseJson) {
  if (typeof responseJson === 'string') return responseJson.trim();

  const candidates = [
    responseJson?.response,
    responseJson?.result?.response,
    responseJson?.result?.text,
    responseJson?.text,
    responseJson?.output_text,
    responseJson?.choices?.[0]?.message?.content,
    Array.isArray(responseJson?.result)
      ? responseJson.result.map((entry) => String(entry?.text || entry?.response || '')).join('\n').trim()
      : '',
  ];

  for (const candidate of candidates) {
    const text = String(candidate || '').trim();
    if (text) return text;
  }

  return '';
}

function buildSkippedModerationResult({ provider = DEFAULT_AI_PROVIDER, model, stage, enabled = false, reason, error, rawText }) {
  return {
    provider,
    model,
    enabled,
    skipped: true,
    stage,
    reason,
    ...(error ? { error } : {}),
    ...(rawText ? { raw_text: truncate(rawText, 1200) } : {}),
  };
}

export function normalizeAiModerationResult(raw, context = {}) {
  const recommendedAction = VALID_ACTIONS.has(String(raw?.recommended_action || '').toUpperCase())
    ? String(raw.recommended_action).toUpperCase()
    : 'REVIEW';
  const categories = normalizeCategoryList(raw?.categories);
  const reasons = dedupe(Array.isArray(raw?.reasons) ? raw.reasons.map((entry) => String(entry || '').trim()) : []).slice(0, 6);

  return {
    provider: String(context.provider || DEFAULT_AI_PROVIDER).trim() || DEFAULT_AI_PROVIDER,
    model: String(context.model || '').trim() || DEFAULT_CF_MODEL,
    enabled: true,
    skipped: false,
    stage: context.stage || 'publish',
    risk_score: clampNumber(raw?.risk_score, 0, 100, 50),
    confidence: clampNumber(raw?.confidence, 0, 1, 0.5),
    recommended_action: recommendedAction,
    categories,
    summary: truncate(String(raw?.summary || raw?.operator_message || 'AI moderation completed.').trim(), 400),
    operator_message: truncate(String(raw?.operator_message || raw?.summary || '').trim(), 600),
    reasons,
  };
}

async function runCloudflareAiJsonPrompt(env, prompt, options = {}) {
  const stage = String(options.stage || 'publish').trim();
  const provider = String(env?.AI_MODERATION_PROVIDER || DEFAULT_AI_PROVIDER).trim().toLowerCase() || DEFAULT_AI_PROVIDER;
  const model = String(options.model || env?.AI_MODERATION_MODEL || env?.CLOUDFLARE_AI_MODEL || DEFAULT_CF_MODEL).trim() || DEFAULT_CF_MODEL;

  if (provider === 'off' || provider === 'disabled' || provider === 'none') {
    return buildSkippedModerationResult({
      provider: DEFAULT_AI_PROVIDER,
      model,
      stage,
      enabled: false,
      reason: 'AI moderation provider is disabled by AI_MODERATION_PROVIDER.',
    });
  }

  const binding = env?.AI;
  if (binding && typeof binding.run === 'function') {
    try {
      const response = await binding.run(model, {
        prompt,
        max_tokens: 700,
        temperature: 0,
      });
      const rawText = extractCloudflareAiText(response);
      const parsed = extractJsonObject(rawText);

      if (!parsed) {
        return buildSkippedModerationResult({
          provider: DEFAULT_AI_PROVIDER,
          model,
          stage,
          enabled: true,
          reason: 'Cloudflare AI returned a non-JSON moderation payload.',
          rawText,
        });
      }

      return normalizeAiModerationResult(parsed, { provider: DEFAULT_AI_PROVIDER, model, stage });
    } catch (error) {
      return buildSkippedModerationResult({
        provider: DEFAULT_AI_PROVIDER,
        model,
        stage,
        enabled: true,
        reason: `Cloudflare AI binding errored: ${error.message}`,
      });
    }
  }

  const accountId = String(env?.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const apiToken = String(env?.CLOUDFLARE_API_TOKEN || '').trim();
  if (!accountId || !apiToken) {
    return buildSkippedModerationResult({
      provider: DEFAULT_AI_PROVIDER,
      model,
      stage,
      enabled: false,
      reason: 'Cloudflare AI binding or REST credentials are not configured.',
    });
  }

  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${encodeURIComponent(model)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        max_tokens: 700,
        temperature: 0,
      }),
    });

    const responseText = await response.text();
    const responseJson = safeJsonParse(responseText);
    if (!response.ok) {
      return buildSkippedModerationResult({
        provider: DEFAULT_AI_PROVIDER,
        model,
        stage,
        enabled: true,
        reason: `Cloudflare AI REST moderation failed with status ${response.status}.`,
        error: responseJson || responseText,
      });
    }

    const rawText = extractCloudflareAiText(responseJson);
    const parsed = extractJsonObject(rawText);
    if (!parsed) {
      return buildSkippedModerationResult({
        provider: DEFAULT_AI_PROVIDER,
        model,
        stage,
        enabled: true,
        reason: 'Cloudflare AI returned a non-JSON moderation payload.',
        rawText,
      });
    }

    return normalizeAiModerationResult(parsed, { provider: DEFAULT_AI_PROVIDER, model, stage });
  } catch (error) {
    return buildSkippedModerationResult({
      provider: DEFAULT_AI_PROVIDER,
      model,
      stage,
      enabled: true,
      reason: `Cloudflare AI REST moderation errored: ${error.message}`,
    });
  }
}

async function moderateTenantContentWithCloudflareAI(env, payload, options = {}) {
  const stage = String(options.stage || payload?.stage || 'publish').trim();
  return runCloudflareAiJsonPrompt(env, buildModerationPrompt(payload), { ...options, stage });
}

export async function moderateAssetWithAI(env, payload, options = {}) {
  const stage = String(options.stage || payload?.stage || 'asset_upload').trim();
  return runCloudflareAiJsonPrompt(env, buildAssetModerationPrompt(payload), { ...options, stage });
}

export async function moderateTenantContent(env, payload, options = {}) {
  return moderateTenantContentWithCloudflareAI(env, payload, options);
}

export async function moderateTenantContentWithGemini(env, payload, options = {}) {
  return moderateTenantContent(env, payload, options);
}

function escapeTelegramHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function sendTelegramModerationAlert(env, details = {}) {
  const token = String(env?.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = String(env?.TELEGRAM_CHAT_ID || '').trim();
  if (!token || !chatId) {
    console.warn('[TELEGRAM_ALERT_SKIPPED] Telegram credentials are not configured.', {
      has_token: Boolean(token),
      has_chat_id: Boolean(chatId),
      tenant_id: details.tenantId || null,
      stage: details.stage || 'publish',
    });
    return { ok: false, skipped: true, reason: 'Telegram credentials are not configured.' };
  }

  const message = [
    '<b>Tenant moderation alert</b>',
    `Tenant: <code>${escapeTelegramHtml(details.tenantId || '-')}</code> ${escapeTelegramHtml(details.tenantName || '')}`.trim(),
    `Stage: <b>${escapeTelegramHtml(details.stage || 'publish')}</b>`,
    `Action: <b>${escapeTelegramHtml(details.recommendedAction || 'REVIEW')}</b>`,
    `Risk score: <b>${escapeTelegramHtml(details.riskScore ?? 'n/a')}</b>`,
    details.summary ? `Summary: ${escapeTelegramHtml(details.summary)}` : '',
    Array.isArray(details.reasons) && details.reasons.length
      ? `Reasons: ${escapeTelegramHtml(details.reasons.join(' | '))}`
      : '',
    details.reviewCaseId ? `Review case: <code>${escapeTelegramHtml(details.reviewCaseId)}</code>` : '',
  ].filter(Boolean).join('\n');

  try {
    const response = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn('[TELEGRAM_ALERT_FAILED]', {
        tenant_id: details.tenantId || null,
        stage: details.stage || 'publish',
        status: response.status,
        error: errorText,
      });
      return { ok: false, skipped: false, reason: `Telegram alert failed with status ${response.status}`, error: errorText };
    }

    return { ok: true, skipped: false };
  } catch (error) {
    console.warn('[TELEGRAM_ALERT_ERROR]', {
      tenant_id: details.tenantId || null,
      stage: details.stage || 'publish',
      error: error.message,
    });
    return { ok: false, skipped: false, reason: error.message };
  }
}
