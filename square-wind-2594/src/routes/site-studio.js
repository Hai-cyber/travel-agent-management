/**
 * Site studio routes [CHK-404]
 * Tenant-level presentation config and multilingual public content.
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

const LEGAL_PAGE_KEYS = new Set(['terms', 'privacy', 'impressum']);
const LEGACY_BUILDER_COMPAT_DEFAULTS = {
	template: 'editorial-journey',
	blocks: ['hero', 'story-grid', 'itinerary-rail', 'price-spotlight', 'testimonial-wall', 'final-cta'],
	utilities: ['floating-contact', 'trust-badges', 'sticky-cta'],
	content: {
	hero: {
		eyebrow: 'Signature Journey',
		headline: 'Cities first, mountain silence after.',
		subtitle: 'Shape a high-conviction landing page with a clear promise, rich route mood, and immediate next step.',
		cta_label: 'Plan This Journey',
		cta_href: '/book.html',
	},
	faq: [
		{ question: 'What is included in the standard planning flow?', answer: 'Core stays, meals, operating support, and itinerary structure aligned to the selected class preset.' },
		{ question: 'Can travelers request a different departure date?', answer: 'Yes. The quote flow can adapt by departure date and matching season window.' },
		{ question: 'How quickly should a lead receive a response?', answer: 'Use the Builder utilities and ops shell together so high-intent travelers can be answered within the same working day.' },
	],
	testimonials: [
		{ quote: 'The route felt polished from the first city arrival to the final mountain night.', name: 'Anh Tran', role: 'Private group traveler' },
		{ quote: 'Everything from hotels to transfers felt coordinated and calm.', name: 'Mina Vo', role: 'Family booking lead' },
		{ quote: 'The itinerary pacing made the whole journey feel premium without being rigid.', name: 'Daniel Pham', role: 'Repeat guest' },
	],
	cta: {
		heading: 'Ready to turn this draft into a selling page?',
		body: 'Use the Builder to create the public story, then route travelers into the booking flow with clarity.',
		button_label: 'Open Booking Flow',
		button_href: '/book.html',
	},
},
};

export async function getSiteConfig(request, db) {
	try {
		const tenantId = getTenantId(request);
		const config = await ensureSiteConfig(tenantId, db);
		return successResponse(normalizeSiteConfig(config));
	} catch (error) {
		return internalError(`Failed to get site config: ${error.message}`);
	}
}

export async function upsertSiteConfig(request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) {
			return parsedBody.response;
		}

		const tenantId = getTenantId(request);
		const existing = normalizeSiteConfig(await ensureSiteConfig(tenantId, db));
		const body = parsedBody.value;
		const nextLegacyBuilder = {
			template: body.builder_template ?? existing.builder_template,
			blocks: body.builder_blocks ?? existing.builder_blocks,
			utilities: body.builder_utilities ?? existing.builder_utilities,
			content: body.builder_content ?? existing.builder_content,
		};
		const next = {
			theme: body.theme ?? existing.theme,
			primary_color: body.primary_color ?? existing.primary_color,
			font_family: body.font_family ?? existing.font_family,
			builder_template: nextLegacyBuilder.template,
			builder_blocks: nextLegacyBuilder.blocks,
			builder_utilities: nextLegacyBuilder.utilities,
			builder_content: nextLegacyBuilder.content,
			header_title: body.header_title ?? existing.header_title,
			footer_text: body.footer_text ?? existing.footer_text,
			contact_email: body.contact_email ?? existing.contact_email,
			contact_phone: body.contact_phone ?? existing.contact_phone,
			whatsapp_url: body.whatsapp_url ?? existing.whatsapp_url,
			default_public_lang: body.default_public_lang ?? existing.default_public_lang,
			search_enabled: body.search_enabled === undefined ? Boolean(existing.search_enabled) : body.search_enabled,
		};

		const validation = validateSiteConfig(next);
		if (validation) {
			return validation;
		}

		await db
			.prepare(
				`INSERT INTO tenant_site_configs
				(tenant_id, theme, primary_color, font_family, builder_template, builder_blocks_json, builder_utilities_json, builder_content_json, header_title, footer_text, contact_email, contact_phone, whatsapp_url, default_public_lang, search_enabled, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(tenant_id) DO UPDATE SET
					theme = excluded.theme,
					primary_color = excluded.primary_color,
					font_family = excluded.font_family,
					builder_template = excluded.builder_template,
					builder_blocks_json = excluded.builder_blocks_json,
					builder_utilities_json = excluded.builder_utilities_json,
					builder_content_json = excluded.builder_content_json,
					header_title = excluded.header_title,
					footer_text = excluded.footer_text,
					contact_email = excluded.contact_email,
					contact_phone = excluded.contact_phone,
					whatsapp_url = excluded.whatsapp_url,
					default_public_lang = excluded.default_public_lang,
					search_enabled = excluded.search_enabled,
					updated_at = excluded.updated_at`
			)
			.bind(
				tenantId,
				next.theme,
				next.primary_color,
				next.font_family,
				next.builder_template,
				JSON.stringify(next.builder_blocks),
				JSON.stringify(next.builder_utilities),
				JSON.stringify(next.builder_content),
				next.header_title,
				next.footer_text,
				next.contact_email,
				next.contact_phone,
				next.whatsapp_url,
				next.default_public_lang,
				next.search_enabled ? 1 : 0,
				Date.now()
			)
			.run();

		const saved = await db
			.prepare('SELECT * FROM tenant_site_configs WHERE tenant_id = ?')
			.bind(tenantId)
			.first();
		return successResponse(normalizeSiteConfig(saved));
	} catch (error) {
		return internalError(`Failed to save site config: ${error.message}`);
	}
}

export async function upsertLegalPage(request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) {
			return parsedBody.response;
		}

		const { page_key, lang, title, content } = parsedBody.value;
		if (!page_key || !LEGAL_PAGE_KEYS.has(page_key)) {
			return validationError(`page_key must be one of: ${Array.from(LEGAL_PAGE_KEYS).join(', ')}`);
		}
		if (!lang || typeof lang !== 'string') {
			return validationError('lang is required and must be a string');
		}
		if (!title || typeof title !== 'string') {
			return validationError('title is required and must be a string');
		}
		if (!content || typeof content !== 'string') {
			return validationError('content is required and must be a string');
		}

		const tenantId = getTenantId(request);
		const existing = await db
			.prepare('SELECT id FROM tenant_site_pages WHERE tenant_id = ? AND page_key = ? AND lang = ?')
			.bind(tenantId, page_key, lang)
			.first();

		if (existing) {
			await db
				.prepare('UPDATE tenant_site_pages SET title = ?, content = ?, updated_at = ? WHERE id = ?')
				.bind(title, content, Date.now(), existing.id)
				.run();
		} else {
			await db
				.prepare(
					`INSERT INTO tenant_site_pages
					(id, tenant_id, page_key, lang, title, content, updated_at)
					VALUES (?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(generateId(), tenantId, page_key, lang, title, content, Date.now())
				.run();
		}

		const saved = await db
			.prepare('SELECT tenant_id, page_key, lang, title, content, updated_at FROM tenant_site_pages WHERE tenant_id = ? AND page_key = ? AND lang = ?')
			.bind(tenantId, page_key, lang)
			.first();

		return successResponse(saved);
	} catch (error) {
		return internalError(`Failed to save legal page: ${error.message}`);
	}
}

export async function getLegalPage(request, db) {
	try {
		const tenantId = getTenantId(request);
		const url = new URL(request.url);
		const pageKey = url.searchParams.get('page_key');
		if (!pageKey || !LEGAL_PAGE_KEYS.has(pageKey)) {
			return validationError(`page_key must be one of: ${Array.from(LEGAL_PAGE_KEYS).join(', ')}`);
		}

		const config = await ensureSiteConfig(tenantId, db);
		const requestedLang = url.searchParams.get('lang') || config.default_public_lang;
		const page = await resolveLocalizedPage(tenantId, pageKey, requestedLang, config.default_public_lang, db);
		if (!page) {
			return notFoundResponse('Legal page not found');
		}

		return successResponse(page);
	} catch (error) {
		return internalError(`Failed to get legal page: ${error.message}`);
	}
}

export async function upsertTourPublicContent(tourId, request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) {
			return parsedBody.response;
		}

		const { lang, headline, summary, body } = parsedBody.value;
		if (!lang || typeof lang !== 'string') {
			return validationError('lang is required and must be a string');
		}
		if (headline !== undefined && typeof headline !== 'string') {
			return validationError('headline must be a string');
		}
		if (summary !== undefined && typeof summary !== 'string') {
			return validationError('summary must be a string');
		}
		if (body !== undefined && typeof body !== 'string') {
			return validationError('body must be a string');
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
			.prepare('SELECT id FROM tour_public_contents WHERE tenant_id = ? AND tour_id = ? AND lang = ?')
			.bind(tenantId, tourId, lang)
			.first();
		if (existing) {
			await db
				.prepare('UPDATE tour_public_contents SET headline = ?, summary = ?, body = ?, updated_at = ? WHERE id = ?')
				.bind(headline || null, summary || null, body || null, Date.now(), existing.id)
				.run();
		} else {
			await db
				.prepare(
					`INSERT INTO tour_public_contents
					(id, tenant_id, tour_id, lang, headline, summary, body, updated_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(generateId(), tenantId, tourId, lang, headline || null, summary || null, body || null, Date.now())
				.run();
		}

		const saved = await db
			.prepare('SELECT tenant_id, tour_id, lang, headline, summary, body, updated_at FROM tour_public_contents WHERE tenant_id = ? AND tour_id = ? AND lang = ?')
			.bind(tenantId, tourId, lang)
			.first();
		return successResponse(saved);
	} catch (error) {
		return internalError(`Failed to save tour public content: ${error.message}`);
	}
}

export async function getTourPublicContent(tourId, request, db) {
	try {
		const tenantId = getTenantId(request);
		const url = new URL(request.url);
		const config = await ensureSiteConfig(tenantId, db);
		const requestedLang = url.searchParams.get('lang') || config.default_public_lang;
		const tour = await resolvePublicTour(tenantId, tourId, requestedLang, config.default_public_lang, db);
		if (!tour) {
			return notFoundResponse('Tour not found');
		}
		return successResponse(tour);
	} catch (error) {
		return internalError(`Failed to get tour public content: ${error.message}`);
	}
}

export async function getPublicSite(request, db) {
	try {
		const tenantId = getTenantId(request);
		const config = await ensureSiteConfig(tenantId, db);
		const url = new URL(request.url);
		const lang = url.searchParams.get('lang') || config.default_public_lang;
		const legalPages = await getAvailableLegalPages(tenantId, lang, config.default_public_lang, db);

		return successResponse({
			tenant_id: tenantId,
			lang,
			config: normalizeSiteConfig(config),
			builder: buildPublicBuilder(normalizeSiteConfig(config)),
			legal_pages: legalPages,
		});
	} catch (error) {
		return internalError(`Failed to get public site: ${error.message}`);
	}
}

export async function listPublicTours(request, db) {
	try {
		const tenantId = getTenantId(request);
		const config = await ensureSiteConfig(tenantId, db);
		const url = new URL(request.url);
		const lang = url.searchParams.get('lang') || config.default_public_lang;
		const q = (url.searchParams.get('q') || '').trim().toLowerCase();

		const result = await db
			.prepare('SELECT id, tenant_id, title, lang, start_date, duration_text, status FROM tours WHERE tenant_id = ? ORDER BY created_at DESC')
			.bind(tenantId)
			.all();

		const tours = [];
		for (const row of result.results || []) {
			const localized = await resolveLocalizedTourContent(tenantId, row.id, lang, config.default_public_lang, db);
			const summaryText = `${row.title || ''} ${localized?.headline || ''} ${localized?.summary || ''}`.toLowerCase();
			if (q && !summaryText.includes(q)) {
				continue;
			}
			tours.push(buildPublicTourPreview(row, localized, lang));
		}

		return successResponse({ tours, total: tours.length, lang, search_enabled: Boolean(config.search_enabled) });
	} catch (error) {
		return internalError(`Failed to list public tours: ${error.message}`);
	}
}

export async function getPublicTour(tourId, request, db) {
	try {
		const tenantId = getTenantId(request);
		const config = await ensureSiteConfig(tenantId, db);
		const url = new URL(request.url);
		const lang = url.searchParams.get('lang') || config.default_public_lang;
		const tour = await resolvePublicTour(tenantId, tourId, lang, config.default_public_lang, db);
		if (!tour) {
			return notFoundResponse('Tour not found');
		}
		return successResponse({
			...tour,
			builder: buildPublicBuilder(normalizeSiteConfig(config)),
		});
	} catch (error) {
		return internalError(`Failed to get public tour: ${error.message}`);
	}
}

async function ensureSiteConfig(tenantId, db) {
	let config = await db
		.prepare('SELECT * FROM tenant_site_configs WHERE tenant_id = ?')
		.bind(tenantId)
		.first();

	if (config) {
		return config;
	}

	await db
		.prepare(
			`INSERT INTO tenant_site_configs
			(tenant_id, theme, primary_color, font_family, builder_template, builder_blocks_json, builder_utilities_json, builder_content_json, header_title, footer_text, contact_email, contact_phone, whatsapp_url, default_public_lang, search_enabled, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			tenantId,
			'editorial',
			'#bf5a36',
			'Iowan Old Style',
			LEGACY_BUILDER_COMPAT_DEFAULTS.template,
			JSON.stringify(LEGACY_BUILDER_COMPAT_DEFAULTS.blocks),
			JSON.stringify(LEGACY_BUILDER_COMPAT_DEFAULTS.utilities),
			JSON.stringify(LEGACY_BUILDER_COMPAT_DEFAULTS.content),
			'Tour Collection',
			null,
			null,
			null,
			null,
			'vi',
			1,
			Date.now()
		)
		.run();

	config = await db
		.prepare('SELECT * FROM tenant_site_configs WHERE tenant_id = ?')
		.bind(tenantId)
		.first();
	return config;
}

async function resolveLocalizedPage(tenantId, pageKey, requestedLang, defaultLang, db) {
	const exact = await db
		.prepare('SELECT tenant_id, page_key, lang, title, content, updated_at FROM tenant_site_pages WHERE tenant_id = ? AND page_key = ? AND lang = ?')
		.bind(tenantId, pageKey, requestedLang)
		.first();
	if (exact) {
		return exact;
	}

	if (requestedLang !== defaultLang) {
		const fallback = await db
			.prepare('SELECT tenant_id, page_key, lang, title, content, updated_at FROM tenant_site_pages WHERE tenant_id = ? AND page_key = ? AND lang = ?')
			.bind(tenantId, pageKey, defaultLang)
			.first();
		if (fallback) {
			return fallback;
		}
	}

	return db
		.prepare('SELECT tenant_id, page_key, lang, title, content, updated_at FROM tenant_site_pages WHERE tenant_id = ? AND page_key = ? ORDER BY updated_at DESC LIMIT 1')
		.bind(tenantId, pageKey)
		.first();
}

async function resolveLocalizedTourContent(tenantId, tourId, requestedLang, defaultLang, db) {
	const exact = await db
		.prepare('SELECT lang, headline, summary, body, updated_at FROM tour_public_contents WHERE tenant_id = ? AND tour_id = ? AND lang = ?')
		.bind(tenantId, tourId, requestedLang)
		.first();
	if (exact) {
		return exact;
	}

	if (requestedLang !== defaultLang) {
		const fallback = await db
			.prepare('SELECT lang, headline, summary, body, updated_at FROM tour_public_contents WHERE tenant_id = ? AND tour_id = ? AND lang = ?')
			.bind(tenantId, tourId, defaultLang)
			.first();
		if (fallback) {
			return fallback;
		}
	}

	return db
		.prepare('SELECT lang, headline, summary, body, updated_at FROM tour_public_contents WHERE tenant_id = ? AND tour_id = ? ORDER BY updated_at DESC LIMIT 1')
		.bind(tenantId, tourId)
		.first();
}

async function resolvePublicTour(tenantId, tourId, requestedLang, defaultLang, db) {
	const tour = await db
		.prepare('SELECT id, tenant_id, title, lang, start_date, duration_text, status FROM tours WHERE id = ? AND tenant_id = ?')
		.bind(tourId, tenantId)
		.first();
	if (!tour) {
		return null;
	}

	const localized = await resolveLocalizedTourContent(tenantId, tourId, requestedLang, defaultLang, db);
	const preview = buildPublicTourPreview(tour, localized, requestedLang);
	return {
		...preview,
		body: localized?.body || null,
	};
}

function buildPublicTourPreview(tour, localized, requestedLang) {
	return {
		id: tour.id,
		title: localized?.headline || tour.title,
		summary: localized?.summary || null,
		start_date: tour.start_date,
		duration_text: tour.duration_text,
		status: tour.status,
		content_lang: localized?.lang || requestedLang || tour.lang || 'vi',
	};
}

async function getAvailableLegalPages(tenantId, requestedLang, defaultLang, db) {
	const pages = [];
	for (const key of LEGAL_PAGE_KEYS) {
		const page = await resolveLocalizedPage(tenantId, key, requestedLang, defaultLang, db);
		if (page) {
			pages.push({ page_key: key, lang: page.lang, title: page.title });
		}
	}
	return pages;
}

function normalizeSiteConfig(config) {
	const legacyBuilder = normalizeLegacyBuilderCompat(config);

	return {
		tenant_id: config.tenant_id,
		theme: config.theme,
		primary_color: config.primary_color,
		font_family: config.font_family,
		builder_template: legacyBuilder.template,
		builder_blocks: legacyBuilder.blocks,
		builder_utilities: legacyBuilder.utilities,
		builder_content: legacyBuilder.content,
		header_title: config.header_title,
		footer_text: config.footer_text,
		contact_email: config.contact_email,
		contact_phone: config.contact_phone,
		whatsapp_url: config.whatsapp_url,
		default_public_lang: config.default_public_lang,
		search_enabled: Boolean(config.search_enabled),
		updated_at: config.updated_at,
	};
}

function validateSiteConfig(config) {
	for (const field of ['theme', 'primary_color', 'font_family', 'header_title', 'default_public_lang']) {
		if (!config[field] || typeof config[field] !== 'string') {
			return validationError(`${field} is required and must be a string`);
		}
	}

	const legacyValidation = validateLegacyBuilderCompat(config);
	if (legacyValidation) {
		return legacyValidation;
	}

	for (const field of ['footer_text', 'contact_email', 'contact_phone', 'whatsapp_url']) {
		if (config[field] !== null && config[field] !== undefined && typeof config[field] !== 'string') {
			return validationError(`${field} must be a string`);
		}
	}

	if (typeof config.search_enabled !== 'boolean') {
		return validationError('search_enabled must be a boolean');
	}

	return null;
}

function normalizeBuilderContent(value) {
	const hero = value?.hero && typeof value.hero === 'object' ? value.hero : {};
	const cta = value?.cta && typeof value.cta === 'object' ? value.cta : {};
	const faq = Array.isArray(value?.faq) ? value.faq : [];
	const testimonials = Array.isArray(value?.testimonials) ? value.testimonials : [];

	return {
		hero: {
			eyebrow: String(hero.eyebrow || LEGACY_BUILDER_COMPAT_DEFAULTS.content.hero.eyebrow),
			headline: String(hero.headline || LEGACY_BUILDER_COMPAT_DEFAULTS.content.hero.headline),
			subtitle: String(hero.subtitle || LEGACY_BUILDER_COMPAT_DEFAULTS.content.hero.subtitle),
			cta_label: String(hero.cta_label || LEGACY_BUILDER_COMPAT_DEFAULTS.content.hero.cta_label),
			cta_href: String(hero.cta_href || LEGACY_BUILDER_COMPAT_DEFAULTS.content.hero.cta_href),
		},
		faq: normalizeFaqItems(faq),
		testimonials: normalizeTestimonialItems(testimonials),
		cta: {
			heading: String(cta.heading || LEGACY_BUILDER_COMPAT_DEFAULTS.content.cta.heading),
			body: String(cta.body || LEGACY_BUILDER_COMPAT_DEFAULTS.content.cta.body),
			button_label: String(cta.button_label || LEGACY_BUILDER_COMPAT_DEFAULTS.content.cta.button_label),
			button_href: String(cta.button_href || LEGACY_BUILDER_COMPAT_DEFAULTS.content.cta.button_href),
		},
	};
}

function normalizeFaqItems(items) {
	const merged = LEGACY_BUILDER_COMPAT_DEFAULTS.content.faq.map((item, index) => {
		const source = items[index] && typeof items[index] === 'object' ? items[index] : {};
		return {
			question: String(source.question || item.question),
			answer: String(source.answer || item.answer),
		};
	});
	return merged;
}

function normalizeTestimonialItems(items) {
	const merged = LEGACY_BUILDER_COMPAT_DEFAULTS.content.testimonials.map((item, index) => {
		const source = items[index] && typeof items[index] === 'object' ? items[index] : {};
		return {
			quote: String(source.quote || item.quote),
			name: String(source.name || item.name),
			role: String(source.role || item.role),
		};
	});
	return merged;
}

function buildPublicBuilder(config) {
	return {
		template: config.builder_template,
		blocks: config.builder_blocks,
		utilities: config.builder_utilities,
		content: config.builder_content,
	};
}

function normalizeLegacyBuilderCompat(config) {
	let blocks = LEGACY_BUILDER_COMPAT_DEFAULTS.blocks;
	let utilities = LEGACY_BUILDER_COMPAT_DEFAULTS.utilities;
	let content = LEGACY_BUILDER_COMPAT_DEFAULTS.content;
	try {
		const parsed = typeof config.builder_blocks_json === 'string' ? JSON.parse(config.builder_blocks_json) : config.builder_blocks;
		if (Array.isArray(parsed)) {
			blocks = parsed.map((item) => String(item));
		}
	} catch {
		blocks = LEGACY_BUILDER_COMPAT_DEFAULTS.blocks;
	}
	try {
		const parsed = typeof config.builder_utilities_json === 'string' ? JSON.parse(config.builder_utilities_json) : config.builder_utilities;
		if (Array.isArray(parsed)) {
			utilities = parsed.map((item) => String(item));
		}
	} catch {
		utilities = LEGACY_BUILDER_COMPAT_DEFAULTS.utilities;
	}
	try {
		const parsed = typeof config.builder_content_json === 'string' ? JSON.parse(config.builder_content_json) : config.builder_content;
		content = normalizeBuilderContent(parsed);
	} catch {
		content = LEGACY_BUILDER_COMPAT_DEFAULTS.content;
	}

	return {
		template: config.builder_template || LEGACY_BUILDER_COMPAT_DEFAULTS.template,
		blocks,
		utilities,
		content,
	};
}

function validateLegacyBuilderCompat(config) {
	if (!config.builder_template || typeof config.builder_template !== 'string') {
		return validationError('builder_template must be a string when legacy Builder compatibility fields are present');
	}
	if (!Array.isArray(config.builder_blocks) || config.builder_blocks.some((item) => typeof item !== 'string')) {
		return validationError('builder_blocks must be an array of strings when legacy Builder compatibility fields are present');
	}
	if (!Array.isArray(config.builder_utilities) || config.builder_utilities.some((item) => typeof item !== 'string')) {
		return validationError('builder_utilities must be an array of strings when legacy Builder compatibility fields are present');
	}
	if (!config.builder_content || typeof config.builder_content !== 'object' || Array.isArray(config.builder_content)) {
		return validationError('builder_content must be an object when legacy Builder compatibility fields are present');
	}
	return null;
}
