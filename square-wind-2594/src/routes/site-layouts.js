/**
 * Hosted site layout routes
 * GrapesJS-style layout persistence plus Worker-side hostname rendering.
 */

import {
	getTenantId,
	successResponse,
	readJsonBody,
	validationError,
	notFoundResponse,
	internalError,
} from '../lib/db.js';

const DEFAULT_LAYOUT = {
	template_engine: 'grapesjs',
	status: 'draft',
	html: defaultHtmlTemplate(),
	css: defaultCssTemplate(),
	project_data: null,
	updated_at: null,
	published_at: null,
};

export async function getSiteLayout(request, db) {
	try {
		const tenantId = getTenantId(request);
		const layout = await db.prepare('SELECT * FROM tenant_site_layouts WHERE tenant_id = ?').bind(tenantId).first();
		return successResponse(normalizeLayout(tenantId, layout));
	} catch (error) {
		return internalError(`Failed to get site layout: ${error.message}`);
	}
}

export async function upsertSiteLayout(request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) {
			return parsedBody.response;
		}

		const tenantId = getTenantId(request);
		const existing = normalizeLayout(
			tenantId,
			await db.prepare('SELECT * FROM tenant_site_layouts WHERE tenant_id = ?').bind(tenantId).first()
		);
		const body = parsedBody.value;
		const next = {
			template_engine: body.template_engine ?? existing.template_engine,
			status: body.status ?? existing.status,
			html: body.html ?? existing.html,
			css: body.css ?? existing.css,
			project_data: body.project_data ?? existing.project_data,
		};

		const validation = validateLayout(next);
		if (validation) {
			return validation;
		}

		const now = Date.now();
		const publishedAt = next.status === 'published' ? (existing.published_at || now) : null;
		await db.prepare(
			`INSERT INTO tenant_site_layouts
			(tenant_id, template_engine, status, html, css, project_json, updated_at, published_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(tenant_id) DO UPDATE SET
				template_engine = excluded.template_engine,
				status = excluded.status,
				html = excluded.html,
				css = excluded.css,
				project_json = excluded.project_json,
				updated_at = excluded.updated_at,
				published_at = excluded.published_at`
		)
			.bind(
				tenantId,
				next.template_engine,
				next.status,
				next.html,
				next.css,
				next.project_data ? JSON.stringify(next.project_data) : null,
				now,
				publishedAt
			)
			.run();

		const saved = await db.prepare('SELECT * FROM tenant_site_layouts WHERE tenant_id = ?').bind(tenantId).first();
		return successResponse(normalizeLayout(tenantId, saved));
	} catch (error) {
		return internalError(`Failed to save site layout: ${error.message}`);
	}
}

export async function maybeRenderHostedSite(request, db) {
	try {
		if (request.method !== 'GET') {
			return null;
		}

		const url = new URL(request.url);
		if (!shouldHandleHostedSite(url)) {
			return null;
		}

		const domain = await db
			.prepare('SELECT tenant_id, hostname FROM tenant_domain_configs WHERE hostname = ? AND status = ?')
			.bind(url.hostname.toLowerCase(), 'verified')
			.first();
		if (!domain) {
			return null;
		}

		const layoutRow = await db
			.prepare('SELECT * FROM tenant_site_layouts WHERE tenant_id = ? AND status = ?')
			.bind(domain.tenant_id, 'published')
			.first();
		if (!layoutRow) {
			return notFoundHtml('Published site layout not found');
		}

		const siteConfig = await ensureSiteConfig(domain.tenant_id, db);
		const tours = await listPublishedTours(domain.tenant_id, siteConfig.default_public_lang, db);
		const renderedHtml = renderLayoutHtml(normalizeLayout(domain.tenant_id, layoutRow), siteConfig, tours, url);
		return new Response(renderedHtml, {
			status: 200,
			headers: {
				'Content-Type': 'text/html; charset=utf-8',
				'Cache-Control': 'public, max-age=300',
			},
		});
	} catch (error) {
		return new Response(`<html><body><h1>Hosted site error</h1><pre>${escapeHtml(error.message)}</pre></body></html>`, {
			status: 500,
			headers: { 'Content-Type': 'text/html; charset=utf-8' },
		});
	}
}

function normalizeLayout(tenantId, layout) {
	if (!layout) {
		return { tenant_id: tenantId, ...DEFAULT_LAYOUT };
	}

	let projectData = null;
	try {
		projectData = layout.project_json ? JSON.parse(layout.project_json) : null;
	} catch {
		projectData = null;
	}

	return {
		tenant_id: tenantId,
		template_engine: layout.template_engine || 'grapesjs',
		status: layout.status || 'draft',
		html: layout.html || defaultHtmlTemplate(),
		css: layout.css || defaultCssTemplate(),
		project_data: projectData,
		updated_at: layout.updated_at || null,
		published_at: layout.published_at || null,
	};
}

function validateLayout(layout) {
	if (!layout.template_engine || typeof layout.template_engine !== 'string') {
		return validationError('template_engine is required and must be a string');
	}
	if (!['draft', 'published'].includes(layout.status)) {
		return validationError('status must be draft or published');
	}
	for (const field of ['html', 'css']) {
		if (typeof layout[field] !== 'string') {
			return validationError(`${field} must be a string`);
		}
	}
	if (layout.project_data !== null && layout.project_data !== undefined && typeof layout.project_data !== 'object') {
		return validationError('project_data must be an object when provided');
	}
	return null;
}

function shouldHandleHostedSite(url) {
	const hostname = url.hostname.toLowerCase();
	if (
		hostname === 'example.com' ||
		hostname === 'localhost' ||
		hostname === '127.0.0.1' ||
		hostname.endsWith('.workers.dev')
	) {
		return false;
	}
	if (url.pathname.startsWith('/api') || url.pathname.startsWith('/public')) {
		return false;
	}
	if (url.pathname === '/sitemap.xml' || url.pathname === '/robots.txt') {
		return false;
	}
	return url.pathname === '/' || url.pathname === '/index.html';
}

async function ensureSiteConfig(tenantId, db) {
	let config = await db.prepare('SELECT * FROM tenant_site_configs WHERE tenant_id = ?').bind(tenantId).first();
	if (config) {
		return config;
	}

	await db.prepare(
		`INSERT INTO tenant_site_configs
		(tenant_id, theme, primary_color, font_family, header_title, footer_text, contact_email, contact_phone, whatsapp_url, default_public_lang, search_enabled, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	)
		.bind(tenantId, 'editorial', '#bf5a36', 'Iowan Old Style', 'Tour Collection', null, null, null, null, 'vi', 1, Date.now())
		.run();

	config = await db.prepare('SELECT * FROM tenant_site_configs WHERE tenant_id = ?').bind(tenantId).first();
	return config;
}

async function listPublishedTours(tenantId, lang, db) {
	const rows = await db
		.prepare('SELECT id, title, duration_text FROM tours WHERE tenant_id = ? AND status = ? ORDER BY created_at DESC')
		.bind(tenantId, 'on_sale')
		.all();

	const tours = [];
	for (const row of rows.results || []) {
		const localized = await db
			.prepare('SELECT headline, summary FROM tour_public_contents WHERE tenant_id = ? AND tour_id = ? AND lang = ?')
			.bind(tenantId, row.id, lang)
			.first();
		tours.push({
			id: row.id,
			title: localized?.headline || row.title,
			summary: localized?.summary || '',
			duration_text: row.duration_text || '',
		});
	}
	return tours;
}

function renderLayoutHtml(layout, siteConfig, tours, url) {
	const replacements = new Map([
		['{{SITE_TITLE}}', siteConfig.header_title || 'Tour Collection'],
		['{{SITE_FOOTER}}', siteConfig.footer_text || ''],
		['{{PRIMARY_COLOR}}', siteConfig.primary_color || '#bf5a36'],
		['{{CONTACT_EMAIL}}', siteConfig.contact_email || ''],
		['{{CONTACT_PHONE}}', siteConfig.contact_phone || ''],
		['{{WHATSAPP_URL}}', siteConfig.whatsapp_url || ''],
		['{{DOMAIN_NAME}}', url.hostname],
		['{{TOUR_LIST}}', buildTourListMarkup(tours)],
	]);

	let html = layout.html;
	let css = layout.css;
	for (const [placeholder, value] of replacements.entries()) {
		html = html.split(placeholder).join(value);
		css = css.split(placeholder).join(value);
	}

	if (!/^<!doctype html>/i.test(html.trim())) {
		html = `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(siteConfig.header_title || 'Tour Collection')}</title><style>${css}</style></head><body>${html}</body></html>`;
	} else if (css) {
		html = html.replace('</head>', `<style>${css}</style></head>`);
	}

	return html;
}

function buildTourListMarkup(tours) {
	if (!tours.length) {
		return '<div class="tour-empty">No tours published yet.</div>';
	}
	return `<section class="tour-list">${tours
		.map(
			(tour) => `<article class="tour-card"><h3>${escapeHtml(tour.title)}</h3><p>${escapeHtml(tour.summary || 'Signature itinerary ready to publish.')}</p><div class="tour-meta">${escapeHtml(tour.duration_text || '')}</div></article>`
		)
		.join('')}</section>`;
}

function defaultHtmlTemplate() {
	return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{{SITE_TITLE}}</title>
</head>
<body>
  <header class="site-hero">
    <p class="site-kicker">Hosted by {{DOMAIN_NAME}}</p>
    <h1>{{SITE_TITLE}}</h1>
    <p class="site-copy">Replace this layout in GrapesJS and keep placeholders like {{TOUR_LIST}} where live SaaS data should be injected.</p>
  </header>
  <main>
    {{TOUR_LIST}}
  </main>
  <footer>{{SITE_FOOTER}}</footer>
</body>
</html>`;
}

function defaultCssTemplate() {
	return `:root { --accent: {{PRIMARY_COLOR}}; }
body { font-family: system-ui, sans-serif; margin: 0; color: #1f1a17; background: #f5efe7; }
.site-hero { padding: 72px 24px 32px; background: linear-gradient(135deg, rgba(255,255,255,0.9), rgba(244,233,221,0.95)); }
.site-kicker { text-transform: uppercase; letter-spacing: .12em; color: var(--accent); font-size: 12px; }
h1 { margin: 0 0 12px; font-size: clamp(2.4rem, 7vw, 4.8rem); }
.site-copy { max-width: 56ch; line-height: 1.7; }
main { padding: 24px; }
.tour-list { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.tour-card { padding: 20px; border-radius: 20px; background: white; border: 1px solid rgba(31,26,23,.08); box-shadow: 0 10px 30px rgba(31,26,23,.06); }
.tour-card h3 { margin-top: 0; }
.tour-meta { margin-top: 12px; color: var(--accent); font-weight: 700; }
footer { padding: 24px; color: rgba(31,26,23,.7); }`;
}

function notFoundHtml(message) {
	return new Response(`<!doctype html><html><body><h1>404</h1><p>${escapeHtml(message)}</p></body></html>`, {
		status: 404,
		headers: { 'Content-Type': 'text/html; charset=utf-8' },
	});
}

function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}
