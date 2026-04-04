import { nanoid } from 'nanoid';

export const CANONICAL_INTERESTS = [
  { key: 'adventure', label: 'Adventure', description: 'Active, discovery-driven journeys with movement and challenge.' },
  { key: 'culture', label: 'Culture', description: 'History, heritage, rituals, arts, and local ways of life.' },
  { key: 'beach', label: 'Beach', description: 'Sea, coast, islands, and slower shoreline escapes.' },
  { key: 'sport', label: 'Sport', description: 'Trips centered on physical activity, events, or training-oriented experiences.' },
  { key: 'food', label: 'Food', description: 'Cuisine-led routes, tastings, markets, and local dining experiences.' },
  { key: 'nature', label: 'Nature', description: 'Landscapes, wildlife, parks, mountains, forests, and outdoor immersion.' },
];

export const CANONICAL_SUB_INTERESTS = [
  { key: 'trekking', label: 'Trekking', parent_key: 'adventure' },
  { key: 'diving', label: 'Diving', parent_key: 'adventure' },
  { key: 'cycling', label: 'Cycling', parent_key: 'sport' },
  { key: 'heritage', label: 'Heritage', parent_key: 'culture' },
];

const INTEREST_MAP = new Map(CANONICAL_INTERESTS.map((item) => [item.key, item]));
const SUB_INTEREST_MAP = new Map(CANONICAL_SUB_INTERESTS.map((item) => [item.key, item]));

export function listInterestTaxonomy() {
  return CANONICAL_INTERESTS.map((interest) => ({
    ...interest,
    sub_interests: CANONICAL_SUB_INTERESTS.filter((item) => item.parent_key === interest.key),
  }));
}

export function normalizeInterestKey(value) {
  const key = String(value || '').trim().toLowerCase();
  return INTEREST_MAP.has(key) ? key : '';
}

export function normalizeSubInterestKey(value) {
  const key = String(value || '').trim().toLowerCase();
  return SUB_INTEREST_MAP.has(key) ? key : '';
}

export function getInterestDefinition(key) {
  return INTEREST_MAP.get(normalizeInterestKey(key)) || null;
}

export function getSubInterestDefinition(key) {
  return SUB_INTEREST_MAP.get(normalizeSubInterestKey(key)) || null;
}

export function buildInterestPageKey(interestKey) {
  return `interest-${interestKey}`;
}

export function buildInterestSlug(interestKey) {
  return `${interestKey}-tours`;
}

export function buildInterestTitle(interestKey) {
  const definition = getInterestDefinition(interestKey);
  return definition ? `${definition.label} Tours` : 'Interest Tours';
}

export function buildInterestDescription(interestKey) {
  const definition = getInterestDefinition(interestKey);
  return definition?.description || 'Curated journeys collected by interest.';
}

export function validateInterestPayload(body) {
  const topLevel = Array.isArray(body?.interest_keys)
    ? [...new Set(body.interest_keys.map(normalizeInterestKey).filter(Boolean))]
    : [];
  const subInterests = Array.isArray(body?.sub_interest_keys)
    ? [...new Set(body.sub_interest_keys.map(normalizeSubInterestKey).filter(Boolean))]
    : [];

  const requiredParents = new Set(subInterests.map((key) => getSubInterestDefinition(key)?.parent_key).filter(Boolean));
  for (const parent of requiredParents) {
    if (!topLevel.includes(parent)) {
      topLevel.push(parent);
    }
  }

  return {
    interest_keys: topLevel,
    sub_interest_keys: subInterests,
    primary_interest_key: normalizeInterestKey(body?.primary_interest_key) || topLevel[0] || null,
    toggles_json: body?.toggles_json && typeof body.toggles_json === 'object' && !Array.isArray(body.toggles_json) ? body.toggles_json : {},
    scores_json: body?.scores_json && typeof body.scores_json === 'object' && !Array.isArray(body.scores_json) ? body.scores_json : {},
    ranking_json: body?.ranking_json && typeof body.ranking_json === 'object' && !Array.isArray(body.ranking_json) ? body.ranking_json : {},
  };
}

export function buildInterestPageBlocks(interestKey) {
  const definition = getInterestDefinition(interestKey);
  const label = definition?.label || 'Interest';
  const description = definition?.description || 'Curated journeys collected by interest.';

  return [
    {
      id: 'hero',
      type: 'hero',
      label: `${label} Hero`,
      content: {
        eyebrow: 'Interest Collection',
        headline: `${label} Tours`,
        body: description,
        primary_cta_label: `Explore ${label}`,
        primary_cta_href: '#section-interest-listing',
        secondary_cta_label: 'Plan with concierge',
        secondary_cta_href: '#contact-us',
      },
      data_bindings: {},
    },
    {
      id: 'interest-listing',
      type: 'listing',
      label: `${label} Listing`,
      content: {
        heading: `${label} journeys`,
        body: `The system automatically keeps this collection in sync with all tours tagged ${label.toLowerCase()}.`,
        card_label: label,
      },
      data_bindings: {
        cards: {
          source: `taxonomy.interest.${interestKey}.tour_listing`,
        },
      },
    },
    {
      id: 'interest-rich-text',
      type: 'rich_text',
      label: `${label} Intro`,
      content: {
        heading: `Why ${label.toLowerCase()} travelers land here`,
        body: description,
      },
      data_bindings: {},
    },
  ];
}

function parseJsonSafe(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function normalizeDiscoveryProfile(row) {
  return row ? {
    primary_interest_key: row.primary_interest_key || null,
    toggles_json: parseJsonSafe(row.toggles_json, {}),
    scores_json: parseJsonSafe(row.scores_json, {}),
    ranking_json: parseJsonSafe(row.ranking_json, {}),
    created_at: Number(row.created_at || 0),
    updated_at: Number(row.updated_at || 0),
  } : {
    primary_interest_key: null,
    toggles_json: {},
    scores_json: {},
    ranking_json: {},
    created_at: 0,
    updated_at: 0,
  };
}

export function normalizeInterestTags(rows = []) {
  return rows.map((row) => ({
    interest_key: row.interest_key,
    tag_level: row.tag_level,
    source: row.source,
    created_at: Number(row.created_at || 0),
    updated_at: Number(row.updated_at || 0),
  }));
}

export async function replaceTourTaxonomy(db, tenantId, tourId, payload, now = Math.floor(Date.now() / 1000)) {
  const statements = [
    db.prepare('DELETE FROM tenant_tour_interest_tags WHERE tenant_id = ? AND tour_id = ?').bind(tenantId, tourId),
    db.prepare(
      `INSERT INTO tenant_tour_discovery_profiles (tenant_id, tour_id, primary_interest_key, toggles_json, scores_json, ranking_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, tour_id) DO UPDATE SET
         primary_interest_key = excluded.primary_interest_key,
         toggles_json = excluded.toggles_json,
         scores_json = excluded.scores_json,
         ranking_json = excluded.ranking_json,
         updated_at = excluded.updated_at`
    ).bind(tenantId, tourId, payload.primary_interest_key, JSON.stringify(payload.toggles_json), JSON.stringify(payload.scores_json), JSON.stringify(payload.ranking_json), now, now),
  ];

  for (const interestKey of payload.interest_keys) {
    statements.push(
      db.prepare(
        `INSERT INTO tenant_tour_interest_tags (id, tenant_id, tour_id, interest_key, tag_level, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'top_level', 'manual', ?, ?)`
      ).bind(nanoid(), tenantId, tourId, interestKey, now, now)
    );
  }

  for (const subInterestKey of payload.sub_interest_keys) {
    statements.push(
      db.prepare(
        `INSERT INTO tenant_tour_interest_tags (id, tenant_id, tour_id, interest_key, tag_level, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'sub_interest', 'manual', ?, ?)`
      ).bind(nanoid(), tenantId, tourId, subInterestKey, now, now)
    );
  }

  await db.batch(statements);
}

export async function replaceDestinationTaxonomy(db, tenantId, destinationId, payload, now = Math.floor(Date.now() / 1000)) {
  const statements = [
    db.prepare('DELETE FROM tenant_destination_interest_tags WHERE tenant_id = ? AND destination_id = ?').bind(tenantId, destinationId),
    db.prepare(
      `INSERT INTO tenant_destination_discovery_profiles (tenant_id, destination_id, primary_interest_key, toggles_json, scores_json, ranking_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, destination_id) DO UPDATE SET
         primary_interest_key = excluded.primary_interest_key,
         toggles_json = excluded.toggles_json,
         scores_json = excluded.scores_json,
         ranking_json = excluded.ranking_json,
         updated_at = excluded.updated_at`
    ).bind(tenantId, destinationId, payload.primary_interest_key, JSON.stringify(payload.toggles_json), JSON.stringify(payload.scores_json), JSON.stringify(payload.ranking_json), now, now),
  ];

  for (const interestKey of payload.interest_keys) {
    statements.push(
      db.prepare(
        `INSERT INTO tenant_destination_interest_tags (id, tenant_id, destination_id, interest_key, tag_level, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'top_level', 'manual', ?, ?)`
      ).bind(nanoid(), tenantId, destinationId, interestKey, now, now)
    );
  }

  for (const subInterestKey of payload.sub_interest_keys) {
    statements.push(
      db.prepare(
        `INSERT INTO tenant_destination_interest_tags (id, tenant_id, destination_id, interest_key, tag_level, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'sub_interest', 'manual', ?, ?)`
      ).bind(nanoid(), tenantId, destinationId, subInterestKey, now, now)
    );
  }

  await db.batch(statements);
}

export async function getTourTaxonomy(db, tenantId, tourId) {
  const [profile, tags] = await Promise.all([
    db.prepare('SELECT * FROM tenant_tour_discovery_profiles WHERE tenant_id = ? AND tour_id = ?').bind(tenantId, tourId).first(),
    db.prepare('SELECT interest_key, tag_level, source, created_at, updated_at FROM tenant_tour_interest_tags WHERE tenant_id = ? AND tour_id = ? ORDER BY tag_level ASC, interest_key ASC').bind(tenantId, tourId).all(),
  ]);
  const normalizedTags = normalizeInterestTags(tags.results || []);
  return {
    profile: normalizeDiscoveryProfile(profile),
    tags: normalizedTags,
    interest_keys: normalizedTags.filter((item) => item.tag_level === 'top_level').map((item) => item.interest_key),
    sub_interest_keys: normalizedTags.filter((item) => item.tag_level === 'sub_interest').map((item) => item.interest_key),
  };
}

export async function getDestinationTaxonomy(db, tenantId, destinationId) {
  const [profile, tags] = await Promise.all([
    db.prepare('SELECT * FROM tenant_destination_discovery_profiles WHERE tenant_id = ? AND destination_id = ?').bind(tenantId, destinationId).first(),
    db.prepare('SELECT interest_key, tag_level, source, created_at, updated_at FROM tenant_destination_interest_tags WHERE tenant_id = ? AND destination_id = ? ORDER BY tag_level ASC, interest_key ASC').bind(tenantId, destinationId).all(),
  ]);
  const normalizedTags = normalizeInterestTags(tags.results || []);
  return {
    profile: normalizeDiscoveryProfile(profile),
    tags: normalizedTags,
    interest_keys: normalizedTags.filter((item) => item.tag_level === 'top_level').map((item) => item.interest_key),
    sub_interest_keys: normalizedTags.filter((item) => item.tag_level === 'sub_interest').map((item) => item.interest_key),
  };
}

export async function syncInterestCollectionPages(db, tenantId, now = Math.floor(Date.now() / 1000)) {
  const countsResult = await db.prepare(
    `SELECT interest_key, COUNT(DISTINCT tour_id) AS total
       FROM tenant_tour_interest_tags
      WHERE tenant_id = ?
        AND tag_level = 'top_level'
      GROUP BY interest_key`
  ).bind(tenantId).all();
  const counts = new Map((countsResult.results || []).map((row) => [row.interest_key, Number(row.total || 0)]));

  const existingResult = await db.prepare('SELECT * FROM tenant_universal_interest_pages WHERE tenant_id = ?').bind(tenantId).all();
  const existingRows = existingResult.results || [];
  const existingByInterest = new Map(existingRows.map((row) => [row.interest_key, row]));
  const existingPageRows = new Map(((await db.prepare('SELECT id, page_key FROM tenant_universal_pages WHERE tenant_id = ?').bind(tenantId).all()).results || []).map((row) => [row.page_key, row]));

  const statements = [];
  for (const interest of CANONICAL_INTERESTS) {
    const total = counts.get(interest.key) || 0;
    const visible = total >= 3 ? 1 : 0;
    const status = total >= 3 ? 'published' : 'draft';
    const pageKey = buildInterestPageKey(interest.key);
    const slug = buildInterestSlug(interest.key);
    const title = buildInterestTitle(interest.key);
    const description = buildInterestDescription(interest.key);
    const rules = {
      source: 'taxonomy',
      entity_type: 'tour',
      interest_key: interest.key,
      minimum_tour_count: 3,
      sort: ['manual_featured', 'newest'],
    };
    const seo = {
      title,
      description,
      taxonomy_interest_key: interest.key,
      auto_generated: true,
    };
    const row = existingByInterest.get(interest.key);
    const pageRow = existingPageRows.get(pageKey);

    if (!row) {
      statements.push(
        db.prepare(
          `INSERT INTO tenant_universal_interest_pages (id, tenant_id, interest_key, page_key, slug, status, visible, rules_json, seo_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(nanoid(), tenantId, interest.key, pageKey, slug, status, visible, JSON.stringify(rules), JSON.stringify(seo), now, now)
      );
    } else {
      statements.push(
        db.prepare(
          `UPDATE tenant_universal_interest_pages
              SET slug = ?, status = ?, visible = ?, rules_json = ?, seo_json = ?, updated_at = ?
            WHERE tenant_id = ? AND interest_key = ?`
        ).bind(slug, status, visible, JSON.stringify(rules), JSON.stringify(seo), now, tenantId, interest.key)
      );
    }

    if (!pageRow) {
      statements.push(
        db.prepare(
          `INSERT INTO tenant_universal_pages (id, tenant_id, page_key, title, slug, page_type, status, visible, blocks_json, seo_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'standard', ?, ?, ?, ?, ?, ?)`
        ).bind(nanoid(), tenantId, pageKey, title, slug, status, visible, JSON.stringify(buildInterestPageBlocks(interest.key)), JSON.stringify(seo), now, now)
      );
    } else {
      statements.push(
        db.prepare(
          `UPDATE tenant_universal_pages
              SET title = ?, slug = ?, status = ?, visible = ?, blocks_json = ?, seo_json = ?, updated_at = ?
            WHERE tenant_id = ? AND page_key = ?`
        ).bind(title, slug, status, visible, JSON.stringify(buildInterestPageBlocks(interest.key)), JSON.stringify(seo), now, tenantId, pageKey)
      );
    }
  }

  if (statements.length) {
    await db.batch(statements);
  }
}
