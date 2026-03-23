import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index.js';

describe('Hosted Site Layouts', () => {
	let db;
	const tenantId = 'ten-layout-1';
	const headers = { 'X-Tenant-ID': tenantId, 'Content-Type': 'application/json' };

	beforeEach(async () => {
		db = env.DB;
		for (const statement of tableStatements()) {
			await db.prepare(statement).run();
		}
	});

	afterEach(async () => {
		for (const table of ['tour_public_contents', 'tours', 'tenant_site_layouts', 'tenant_site_configs', 'tenant_domain_configs']) {
			await db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
		}
	});

	it('returns default hosted layout for tenant', async () => {
		const response = await worker.fetch(new Request('http://example.com/api/site/layout', { method: 'GET', headers }), env);
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.template_engine).toBe('grapesjs');
		expect(data.status).toBe('draft');
		expect(data.html).toContain('{{TOUR_LIST}}');
	});

	it('stores published hosted layout and project payload', async () => {
		const response = await worker.fetch(
			new Request('http://example.com/api/site/layout', {
				method: 'POST',
				headers,
				body: JSON.stringify({
					status: 'published',
					html: '<!doctype html><html><head></head><body><h1>{{SITE_TITLE}}</h1><div>{{TOUR_LIST}}</div></body></html>',
					css: 'body { color: #123456; }',
					project_data: { pages: [{ name: 'Home' }] },
				}),
			}),
			env
		);
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.status).toBe('published');
		expect(data.project_data.pages[0].name).toBe('Home');
		expect(data.published_at).toBeTypeOf('number');
	});

	it('renders published hosted layout for verified custom domain', async () => {
		await seedVerifiedDomain(db, tenantId, 'agent-tour.com');
		await seedSiteConfig(db, tenantId);
		await seedTour(db, tenantId, 'Saigon Signature');
		await db
			.prepare(
				`INSERT INTO tour_public_contents (id, tenant_id, tour_id, lang, headline, summary, body, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(crypto.randomUUID(), tenantId, 'tour-1', 'vi', 'Saigon Signature', 'City rhythm and river nights', 'Body', Date.now())
			.run();
		await db
			.prepare(
				`INSERT INTO tenant_site_layouts (tenant_id, template_engine, status, html, css, project_json, updated_at, published_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(
				tenantId,
				'grapesjs',
				'published',
				'<!doctype html><html><head></head><body><h1>{{SITE_TITLE}}</h1><section>{{TOUR_LIST}}</section></body></html>',
				'body { background: #fff; }',
				null,
				Date.now(),
				Date.now()
			)
			.run();

		const response = await worker.fetch(new Request('http://agent-tour.com/', { method: 'GET' }), env);
		expect(response.status).toBe(200);
		const html = await response.text();
		expect(html).toContain('Layout Demo Travel');
		expect(html).toContain('Saigon Signature');
		expect(html).toContain('City rhythm and river nights');
	});
});

async function seedVerifiedDomain(db, tenantId, hostname) {
	await db
		.prepare(
			`INSERT INTO tenant_domain_configs (tenant_id, hostname, status, verification_record_type, verification_record_name, verification_record_value, verified_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(tenantId, hostname, 'verified', 'TXT', `_tour-booking-verification.${hostname}`, 'tb-verify-demo', Date.now(), Date.now())
		.run();
}

async function seedSiteConfig(db, tenantId) {
	await db
		.prepare(
			`INSERT INTO tenant_site_configs (tenant_id, theme, primary_color, font_family, header_title, footer_text, contact_email, contact_phone, whatsapp_url, default_public_lang, search_enabled, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(tenantId, 'editorial', '#bf5a36', 'Iowan Old Style', 'Layout Demo Travel', 'Footer copy', 'hello@example.com', '+840000', null, 'vi', 1, Date.now())
		.run();
}

async function seedTour(db, tenantId, title) {
	await db
		.prepare(
			`INSERT INTO tours (id, tenant_id, title, lang, start_date, duration_text, status, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind('tour-1', tenantId, title, 'vi', Date.now(), '3N2D', 'on_sale', Date.now())
		.run();
}

function tableStatements() {
	return [
		`CREATE TABLE IF NOT EXISTS tenant_domain_configs (
			tenant_id TEXT PRIMARY KEY,
			hostname TEXT UNIQUE,
			status TEXT NOT NULL,
			verification_record_type TEXT NOT NULL,
			verification_record_name TEXT,
			verification_record_value TEXT,
			verified_at INTEGER,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS tenant_site_configs (
			tenant_id TEXT PRIMARY KEY,
			theme TEXT NOT NULL,
			primary_color TEXT NOT NULL,
			font_family TEXT NOT NULL,
			header_title TEXT NOT NULL,
			footer_text TEXT,
			contact_email TEXT,
			contact_phone TEXT,
			whatsapp_url TEXT,
			default_public_lang TEXT NOT NULL DEFAULT 'vi',
			search_enabled INTEGER NOT NULL DEFAULT 1,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS tenant_site_layouts (
			tenant_id TEXT PRIMARY KEY,
			template_engine TEXT NOT NULL,
			status TEXT NOT NULL,
			html TEXT NOT NULL,
			css TEXT NOT NULL,
			project_json TEXT,
			updated_at INTEGER NOT NULL,
			published_at INTEGER
		)`,
		`CREATE TABLE IF NOT EXISTS tours (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			title TEXT NOT NULL,
			lang TEXT DEFAULT 'vi',
			start_date INTEGER,
			duration_text TEXT,
			status TEXT NOT NULL DEFAULT 'draft',
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS tour_public_contents (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			tour_id TEXT NOT NULL,
			lang TEXT NOT NULL,
			headline TEXT,
			summary TEXT,
			body TEXT,
			updated_at INTEGER NOT NULL,
			UNIQUE (tenant_id, tour_id, lang)
		)`,
	];
}
