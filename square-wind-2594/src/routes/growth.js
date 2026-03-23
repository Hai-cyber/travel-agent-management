/**
 * Growth & SEO routes [CHK-405]
 * Tenant-level distribution metadata, sitemap/robots, and lead/event hooks.
 */

import {
	getTenantId,
	generateId,
	successResponse,
	readJsonBody,
	validationError,
	notFoundResponse,
	internalError,
} from '../lib/db.js';

const EVENT_NAMES = new Set(['view_tour', 'click_contact', 'submit_booking']);
const LEAD_CHANNELS = new Set(['contact_form', 'whatsapp', 'call']);

export async function getGrowthConfig(request, db) {
	try {
		const tenantId = getTenantId(request);
		const config = await ensureGrowthConfig(tenantId, db);
		return successResponse(normalizeGrowthConfig(config));
	} catch (error) {
		return internalError(`Failed to get growth config: ${error.message}`);
	}
}

export async function upsertGrowthConfig(request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) {
			return parsedBody.response;
		}

		const tenantId = getTenantId(request);
		const existing = await ensureGrowthConfig(tenantId, db);
		const body = parsedBody.value;

		const next = {
			google_analytics_id: body.google_analytics_id ?? existing.google_analytics_id,
			facebook_pixel_id: body.facebook_pixel_id ?? existing.facebook_pixel_id,
			tripadvisor_url: body.tripadvisor_url ?? existing.tripadvisor_url,
			google_reviews_url: body.google_reviews_url ?? existing.google_reviews_url,
			whatsapp_url: body.whatsapp_url ?? existing.whatsapp_url,
			call_phone: body.call_phone ?? existing.call_phone,
			contact_email: body.contact_email ?? existing.contact_email,
			trust_badges_json: body.trust_badges_json ?? existing.trust_badges_json,
		};

		for (const field of [
			'google_analytics_id',
			'facebook_pixel_id',
			'tripadvisor_url',
			'google_reviews_url',
			'whatsapp_url',
			'call_phone',
			'contact_email',
		]) {
			if (next[field] !== null && next[field] !== undefined && typeof next[field] !== 'string') {
				return validationError(`${field} must be a string`);
			}
		}

		if (next.trust_badges_json !== null && next.trust_badges_json !== undefined) {
			if (!Array.isArray(next.trust_badges_json)) {
				return validationError('trust_badges_json must be an array');
			}
			for (const item of next.trust_badges_json) {
				if (typeof item !== 'string') {
					return validationError('trust_badges_json must contain only strings');
				}
			}
		}

		await db
			.prepare(
				`INSERT INTO tenant_growth_configs
				(tenant_id, google_analytics_id, facebook_pixel_id, tripadvisor_url, google_reviews_url, whatsapp_url, call_phone, contact_email, trust_badges_json, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(tenant_id) DO UPDATE SET
					google_analytics_id = excluded.google_analytics_id,
					facebook_pixel_id = excluded.facebook_pixel_id,
					tripadvisor_url = excluded.tripadvisor_url,
					google_reviews_url = excluded.google_reviews_url,
					whatsapp_url = excluded.whatsapp_url,
					call_phone = excluded.call_phone,
					contact_email = excluded.contact_email,
					trust_badges_json = excluded.trust_badges_json,
					updated_at = excluded.updated_at`
			)
			.bind(
				tenantId,
				next.google_analytics_id || null,
				next.facebook_pixel_id || null,
				next.tripadvisor_url || null,
				next.google_reviews_url || null,
				next.whatsapp_url || null,
				next.call_phone || null,
				next.contact_email || null,
				next.trust_badges_json ? JSON.stringify(next.trust_badges_json) : null,
				Date.now()
			)
			.run();

		const saved = await db
			.prepare('SELECT * FROM tenant_growth_configs WHERE tenant_id = ?')
			.bind(tenantId)
			.first();
		return successResponse(normalizeGrowthConfig(saved));
	} catch (error) {
		return internalError(`Failed to save growth config: ${error.message}`);
	}
}

export async function upsertTourSeoMeta(tourId, request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) {
			return parsedBody.response;
		}

		const { lang, meta_title, meta_description, keywords, og_title, og_description, og_image, snippet_template } = parsedBody.value;
		if (!lang || typeof lang !== 'string') {
			return validationError('lang is required and must be a string');
		}
		for (const [field, value] of Object.entries({
			meta_title,
			meta_description,
			keywords,
			og_title,
			og_description,
			og_image,
			snippet_template,
		})) {
			if (value !== undefined && value !== null && typeof value !== 'string') {
				return validationError(`${field} must be a string`);
			}
		}

		const tenantId = getTenantId(request);
		const tour = await db
			.prepare('SELECT id FROM tours WHERE id = ? AND tenant_id = ?')
			.bind(tourId, tenantId)
			.first();
		if (!tour) {
			return notFoundResponse('Tour not found');
		}

		const existing = await db
			.prepare('SELECT id FROM tour_growth_seo_metas WHERE tenant_id = ? AND tour_id = ? AND lang = ?')
			.bind(tenantId, tourId, lang)
			.first();
		if (existing) {
			await db
				.prepare(
					`UPDATE tour_growth_seo_metas
					SET meta_title = ?, meta_description = ?, keywords = ?, og_title = ?, og_description = ?, og_image = ?, snippet_template = ?, updated_at = ?
					WHERE id = ?`
				)
				.bind(meta_title || null, meta_description || null, keywords || null, og_title || null, og_description || null, og_image || null, snippet_template || null, Date.now(), existing.id)
				.run();
		} else {
			await db
				.prepare(
					`INSERT INTO tour_growth_seo_metas
					(id, tenant_id, tour_id, lang, meta_title, meta_description, keywords, og_title, og_description, og_image, snippet_template, updated_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(generateId(), tenantId, tourId, lang, meta_title || null, meta_description || null, keywords || null, og_title || null, og_description || null, og_image || null, snippet_template || null, Date.now())
				.run();
		}

		const saved = await resolveSeoMeta(tenantId, tourId, lang, null, db);
		return successResponse(saved);
	} catch (error) {
		return internalError(`Failed to save tour SEO metadata: ${error.message}`);
	}
}

export async function getTourSeoMeta(tourId, request, db) {
	try {
		const tenantId = getTenantId(request);
		const tour = await db
			.prepare('SELECT id, lang FROM tours WHERE id = ? AND tenant_id = ?')
			.bind(tourId, tenantId)
			.first();
		if (!tour) {
			return notFoundResponse('Tour not found');
		}

		const url = new URL(request.url);
		const lang = url.searchParams.get('lang') || tour.lang || 'vi';
		const seo = await resolveSeoMeta(tenantId, tourId, lang, tour.lang || 'vi', db);
		if (!seo) {
			return notFoundResponse('Tour SEO metadata not found');
		}
		return successResponse(seo);
	} catch (error) {
		return internalError(`Failed to get tour SEO metadata: ${error.message}`);
	}
}

export async function upsertTourSlug(tourId, request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) {
			return parsedBody.response;
		}
		const { slug } = parsedBody.value;
		if (!slug || typeof slug !== 'string') {
			return validationError('slug is required and must be a string');
		}
		const normalizedSlug = slug.trim().toLowerCase();
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedSlug)) {
			return validationError('slug must use lowercase letters, numbers, and hyphens only');
		}

		const tenantId = getTenantId(request);
		const tour = await db
			.prepare('SELECT id FROM tours WHERE id = ? AND tenant_id = ?')
			.bind(tourId, tenantId)
			.first();
		if (!tour) {
			return notFoundResponse('Tour not found');
		}

		const claimed = await db
			.prepare('SELECT tour_id FROM tour_growth_slugs WHERE tenant_id = ? AND slug = ? AND tour_id <> ?')
			.bind(tenantId, normalizedSlug, tourId)
			.first();
		if (claimed) {
			return validationError('slug is already used by another tour');
		}

		await db
			.prepare(
				`INSERT INTO tour_growth_slugs
				(tenant_id, tour_id, slug, updated_at)
				VALUES (?, ?, ?, ?)
				ON CONFLICT(tenant_id, tour_id) DO UPDATE SET
					slug = excluded.slug,
					updated_at = excluded.updated_at`
			)
			.bind(tenantId, tourId, normalizedSlug, Date.now())
			.run();

		const saved = await db
			.prepare('SELECT tenant_id, tour_id, slug, updated_at FROM tour_growth_slugs WHERE tenant_id = ? AND tour_id = ?')
			.bind(tenantId, tourId)
			.first();
		return successResponse(saved);
	} catch (error) {
		return internalError(`Failed to save tour slug: ${error.message}`);
	}
}

export async function getSitemapXml(request, db) {
	try {
		const tenantId = getTenantId(request);
		const rows = await db
			.prepare(
				`SELECT s.slug, t.id, t.created_at
				FROM tour_growth_slugs s
				JOIN tours t ON t.id = s.tour_id AND t.tenant_id = s.tenant_id
				WHERE s.tenant_id = ? AND t.status = 'on_sale'
				ORDER BY t.created_at DESC`
			)
			.bind(tenantId)
			.all();

		const urls = (rows.results || [])
			.map((row) => `<url><loc>/public/tours/slug/${escapeXml(row.slug)}</loc><lastmod>${new Date(row.created_at || Date.now()).toISOString()}</lastmod></url>`)
			.join('');

		const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
		return new Response(xml, {
			status: 200,
			headers: {
				'Content-Type': 'application/xml; charset=utf-8',
			},
		});
	} catch (error) {
		return internalError(`Failed to build sitemap: ${error.message}`);
	}
}

export async function getRobotsTxt() {
	const content = ['User-agent: *', 'Allow: /', 'Sitemap: /sitemap.xml'].join('\n');
	return new Response(content, {
		status: 200,
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
		},
	});
}

export async function getPublicTourBySlug(slug, request, db) {
	try {
		const tenantId = getTenantId(request);
		const slugRow = await db
			.prepare('SELECT tour_id FROM tour_growth_slugs WHERE tenant_id = ? AND slug = ?')
			.bind(tenantId, slug)
			.first();
		if (!slugRow) {
			return notFoundResponse('Tour not found');
		}

		const tour = await db
			.prepare('SELECT id, tenant_id, title, lang, start_date, duration_text, status FROM tours WHERE id = ? AND tenant_id = ?')
			.bind(slugRow.tour_id, tenantId)
			.first();
		if (!tour) {
			return notFoundResponse('Tour not found');
		}

		const url = new URL(request.url);
		const lang = url.searchParams.get('lang') || tour.lang || 'vi';
		const seo = await resolveSeoMeta(tenantId, tour.id, lang, tour.lang || 'vi', db);
		const growth = await ensureGrowthConfig(tenantId, db);

		return successResponse({
			id: tour.id,
			slug,
			title: seo?.meta_title || tour.title,
			meta_description: seo?.meta_description || null,
			og_title: seo?.og_title || seo?.meta_title || tour.title,
			og_description: seo?.og_description || seo?.meta_description || null,
			og_image: seo?.og_image || null,
			keywords: seo?.keywords || null,
			analytics: {
				google_analytics_id: growth.google_analytics_id,
				facebook_pixel_id: growth.facebook_pixel_id,
			},
			social: {
				whatsapp_url: growth.whatsapp_url,
			},
		});
	} catch (error) {
		return internalError(`Failed to get public tour by slug: ${error.message}`);
	}
}

export async function captureLead(request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) {
			return parsedBody.response;
		}
		const tenantId = getTenantId(request);
		const { tour_id, channel, name, email, phone, message } = parsedBody.value;

		if (!channel || !LEAD_CHANNELS.has(channel)) {
			return validationError(`channel must be one of: ${Array.from(LEAD_CHANNELS).join(', ')}`);
		}
		if (!message || typeof message !== 'string') {
			return validationError('message is required and must be a string');
		}
		for (const [field, value] of Object.entries({ name, email, phone })) {
			if (value !== undefined && value !== null && typeof value !== 'string') {
				return validationError(`${field} must be a string`);
			}
		}
		if (tour_id !== undefined && tour_id !== null && typeof tour_id !== 'string') {
			return validationError('tour_id must be a string');
		}

		if (tour_id) {
			const tour = await db
				.prepare('SELECT id FROM tours WHERE id = ? AND tenant_id = ?')
				.bind(tour_id, tenantId)
				.first();
			if (!tour) {
				return validationError('tour_id is invalid for tenant');
			}
		}

		const leadId = generateId();
		const now = Date.now();
		await db
			.prepare(
				`INSERT INTO growth_leads
				(id, tenant_id, tour_id, channel, name, email, phone, message, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(leadId, tenantId, tour_id || null, channel, name || null, email || null, phone || null, message, now)
			.run();

		return successResponse({ id: leadId, tenant_id: tenantId, tour_id: tour_id || null, channel, created_at: now }, 201);
	} catch (error) {
		return internalError(`Failed to capture lead: ${error.message}`);
	}
}

export async function captureGrowthEvent(request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) {
			return parsedBody.response;
		}
		const tenantId = getTenantId(request);
		const { event_name, tour_id, channel, metadata } = parsedBody.value;
		if (!event_name || !EVENT_NAMES.has(event_name)) {
			return validationError(`event_name must be one of: ${Array.from(EVENT_NAMES).join(', ')}`);
		}
		if (tour_id !== undefined && tour_id !== null && typeof tour_id !== 'string') {
			return validationError('tour_id must be a string');
		}
		if (channel !== undefined && channel !== null && typeof channel !== 'string') {
			return validationError('channel must be a string');
		}
		if (metadata !== undefined && metadata !== null && (typeof metadata !== 'object' || Array.isArray(metadata))) {
			return validationError('metadata must be an object');
		}

		if (tour_id) {
			const tour = await db
				.prepare('SELECT id FROM tours WHERE id = ? AND tenant_id = ?')
				.bind(tour_id, tenantId)
				.first();
			if (!tour) {
				return validationError('tour_id is invalid for tenant');
			}
		}

		const eventId = generateId();
		const now = Date.now();
		await db
			.prepare(
				`INSERT INTO growth_events
				(id, tenant_id, tour_id, event_name, channel, metadata_json, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(eventId, tenantId, tour_id || null, event_name, channel || null, metadata ? JSON.stringify(metadata) : null, now)
			.run();

		return successResponse({ id: eventId, tenant_id: tenantId, event_name, created_at: now }, 201);
	} catch (error) {
		return internalError(`Failed to capture growth event: ${error.message}`);
	}
}

async function ensureGrowthConfig(tenantId, db) {
	let config = await db
		.prepare('SELECT * FROM tenant_growth_configs WHERE tenant_id = ?')
		.bind(tenantId)
		.first();

	if (config) {
		return config;
	}

	await db
		.prepare(
			`INSERT INTO tenant_growth_configs
			(tenant_id, google_analytics_id, facebook_pixel_id, tripadvisor_url, google_reviews_url, whatsapp_url, call_phone, contact_email, trust_badges_json, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(tenantId, null, null, null, null, null, null, null, JSON.stringify([]), Date.now())
		.run();

	config = await db
		.prepare('SELECT * FROM tenant_growth_configs WHERE tenant_id = ?')
		.bind(tenantId)
		.first();
	return config;
}

function normalizeGrowthConfig(config) {
	return {
		tenant_id: config.tenant_id,
		google_analytics_id: config.google_analytics_id,
		facebook_pixel_id: config.facebook_pixel_id,
		tripadvisor_url: config.tripadvisor_url,
		google_reviews_url: config.google_reviews_url,
		whatsapp_url: config.whatsapp_url,
		call_phone: config.call_phone,
		contact_email: config.contact_email,
		trust_badges: parseJsonArray(config.trust_badges_json),
		updated_at: config.updated_at,
	};
}

async function resolveSeoMeta(tenantId, tourId, requestedLang, defaultLang, db) {
	const exact = await db
		.prepare('SELECT tenant_id, tour_id, lang, meta_title, meta_description, keywords, og_title, og_description, og_image, snippet_template, updated_at FROM tour_growth_seo_metas WHERE tenant_id = ? AND tour_id = ? AND lang = ?')
		.bind(tenantId, tourId, requestedLang)
		.first();
	if (exact) {
		return exact;
	}

	if (defaultLang && defaultLang !== requestedLang) {
		const fallback = await db
			.prepare('SELECT tenant_id, tour_id, lang, meta_title, meta_description, keywords, og_title, og_description, og_image, snippet_template, updated_at FROM tour_growth_seo_metas WHERE tenant_id = ? AND tour_id = ? AND lang = ?')
			.bind(tenantId, tourId, defaultLang)
			.first();
		if (fallback) {
			return fallback;
		}
	}

	return db
		.prepare('SELECT tenant_id, tour_id, lang, meta_title, meta_description, keywords, og_title, og_description, og_image, snippet_template, updated_at FROM tour_growth_seo_metas WHERE tenant_id = ? AND tour_id = ? ORDER BY updated_at DESC LIMIT 1')
		.bind(tenantId, tourId)
		.first();
}

function parseJsonArray(value) {
	if (!value) {
		return [];
	}
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function escapeXml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}
