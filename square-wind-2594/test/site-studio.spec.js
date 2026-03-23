import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index.js';

describe('Site Studio [CHK-404]', () => {
	let db;
	const tenantId = 'ten-site-1';
	const headers = { 'X-Tenant-ID': tenantId, 'Content-Type': 'application/json' };

	beforeEach(async () => {
		db = env.DB;
		for (const statement of tableStatements()) {
			await db.prepare(statement).run();
		}
	});

	afterEach(async () => {
		for (const table of ['tour_public_contents', 'tenant_site_pages', 'tenant_site_configs', 'tours']) {
			await db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
		}
	});

	it('returns default tenant site config', async () => {
		const response = await worker.fetch(
			new Request('http://example.com/api/site/config', { method: 'GET', headers }),
			env
		);
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.theme).toBe('editorial');
		expect(data.builder_template).toBe('editorial-journey');
		expect(Array.isArray(data.builder_blocks)).toBe(true);
		expect(Array.isArray(data.builder_utilities)).toBe(true);
		expect(data.default_public_lang).toBe('vi');
		expect(data.search_enabled).toBe(true);
	});

	it('updates site config with theme/contact values', async () => {
		const response = await worker.fetch(
			new Request('http://example.com/api/site/config', {
				method: 'POST',
				headers,
				body: JSON.stringify({
					theme: 'forest',
					primary_color: '#2f6a54',
					font_family: 'Avenir Next',
					builder_template: 'postcard-sprint',
					builder_blocks: ['hero', 'faq', 'final-cta'],
					builder_utilities: ['sticky-cta', 'trust-badges'],
					builder_content: {
						hero: {
							eyebrow: 'Summer Edit',
							headline: 'Move fast from city heat to mountain air',
							subtitle: 'A sharper hero for mobile-first demand.',
							cta_label: 'Check Departures',
							cta_href: '/book.html',
						},
						faq: [
							{ question: 'How many days?', answer: 'Three days.' },
							{ question: 'Is pickup included?', answer: 'Yes.' },
							{ question: 'Can I customize?', answer: 'Yes.' },
						],
						testimonials: [
							{ quote: 'Very smooth trip.', name: 'Lan', role: 'Couple traveler' },
							{ quote: 'Great pacing.', name: 'Minh', role: 'Group organizer' },
							{ quote: 'Easy to book.', name: 'Julia', role: 'Traveler' },
						],
						cta: {
							heading: 'Reserve this route',
							body: 'Move to booking when ready.',
							button_label: 'Reserve Now',
							button_href: '/book.html',
						},
					},
					header_title: 'Forest Tours',
					footer_text: 'Operated by Forest Tours LLC',
					contact_phone: '+84901234567',
					whatsapp_url: 'https://wa.me/84901234567',
					default_public_lang: 'en',
					search_enabled: true,
				}),
			}),
			env
		);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.theme).toBe('forest');
		expect(data.builder_template).toBe('postcard-sprint');
		expect(data.builder_blocks).toEqual(['hero', 'faq', 'final-cta']);
		expect(data.builder_utilities).toEqual(['sticky-cta', 'trust-badges']);
		expect(data.builder_content.hero.headline).toBe('Move fast from city heat to mountain air');
		expect(data.builder_content.faq[0].question).toBe('How many days?');
		expect(data.default_public_lang).toBe('en');
		expect(data.contact_phone).toBe('+84901234567');
	});

	it('returns explicit builder payload in public site response', async () => {
		await worker.fetch(
			new Request('http://example.com/api/site/config', {
				method: 'POST',
				headers,
				body: JSON.stringify({
					builder_template: 'lodge-mineral',
					builder_blocks: ['hero', 'story-grid', 'testimonial-wall', 'final-cta'],
					builder_utilities: ['floating-contact'],
				}),
			}),
			env
		);

		const response = await worker.fetch(new Request('http://example.com/public/site?lang=en', { method: 'GET', headers }), env);
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.builder.template).toBe('lodge-mineral');
		expect(data.builder.blocks).toEqual(['hero', 'story-grid', 'testimonial-wall', 'final-cta']);
		expect(data.builder.utilities).toEqual(['floating-contact']);
		expect(data.config.builder_template).toBe('lodge-mineral');
	});

	it('preserves legacy builder compatibility fields when updating modern site config only', async () => {
		await worker.fetch(
			new Request('http://example.com/api/site/config', {
				method: 'POST',
				headers,
				body: JSON.stringify({
					builder_template: 'postcard-sprint',
					builder_blocks: ['hero', 'faq', 'final-cta'],
					builder_utilities: ['sticky-cta'],
					header_title: 'Before Modern Update',
				}),
			}),
			env
		);

		const response = await worker.fetch(
			new Request('http://example.com/api/site/config', {
				method: 'POST',
				headers,
				body: JSON.stringify({
					theme: 'forest',
					primary_color: '#2f6a54',
					font_family: 'Avenir Next',
					header_title: 'Modern Site Studio',
					footer_text: 'Footer only update',
					default_public_lang: 'en',
					search_enabled: false,
				}),
			}),
			env
		);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.theme).toBe('forest');
		expect(data.header_title).toBe('Modern Site Studio');
		expect(data.builder_template).toBe('postcard-sprint');
		expect(data.builder_blocks).toEqual(['hero', 'faq', 'final-cta']);
		expect(data.builder_utilities).toEqual(['sticky-cta']);
	});

	it('stores and resolves multilingual legal page with language fallback', async () => {
		await worker.fetch(
			new Request('http://example.com/api/site/pages', {
				method: 'POST',
				headers,
				body: JSON.stringify({
					page_key: 'terms',
					lang: 'vi',
					title: 'Dieu khoan',
					content: 'Noi dung tieng Viet',
				}),
			}),
			env
		);

		const response = await worker.fetch(
			new Request('http://example.com/api/site/pages?page_key=terms&lang=en', { method: 'GET', headers }),
			env
		);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.lang).toBe('vi');
		expect(data.title).toBe('Dieu khoan');
	});

	it('returns localized public tour detail content', async () => {
		const tourId = await seedTour(db, tenantId, 'Saigon Signature');
		await worker.fetch(
			new Request(`http://example.com/api/site/tours/${tourId}/content`, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					lang: 'en',
					headline: 'Saigon Signature',
					summary: 'City rhythm and river nights',
					body: 'Full English body',
				}),
			}),
			env
		);

		const response = await worker.fetch(
			new Request(`http://example.com/public/tours/${tourId}?lang=en`, { method: 'GET', headers }),
			env
		);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.title).toBe('Saigon Signature');
		expect(data.summary).toBe('City rhythm and river nights');
		expect(data.body).toBe('Full English body');
		expect(data.content_lang).toBe('en');
		expect(data.builder.template).toBeTruthy();
		expect(Array.isArray(data.builder.blocks)).toBe(true);
	});

	it('supports basic public tour search across title and localized summary', async () => {
		const firstTour = await seedTour(db, tenantId, 'Mountain Drift');
		await seedTour(db, tenantId, 'Coastal Escape');
		await worker.fetch(
			new Request(`http://example.com/api/site/tours/${firstTour}/content`, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					lang: 'en',
					headline: 'Mountain Drift',
					summary: 'Sapa valleys and ridge walks',
				}),
			}),
			env
		);

		const response = await worker.fetch(
			new Request('http://example.com/public/tours?lang=en&q=valleys', { method: 'GET', headers }),
			env
		);
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.total).toBe(1);
		expect(data.tours[0].title).toBe('Mountain Drift');
	});
});

async function seedTour(db, tenantId, title) {
	const id = crypto.randomUUID();
	await db
		.prepare(
			`INSERT INTO tours (id, tenant_id, title, lang, start_date, duration_text, status, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(id, tenantId, title, 'vi', Date.now(), '3N2D', 'on_sale', Date.now())
		.run();
	return id;
}

function tableStatements() {
	return [
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
		`CREATE TABLE IF NOT EXISTS tenant_site_configs (
			tenant_id TEXT PRIMARY KEY,
			theme TEXT NOT NULL,
			primary_color TEXT NOT NULL,
			font_family TEXT NOT NULL,
			builder_template TEXT,
			builder_blocks_json TEXT,
			builder_utilities_json TEXT,
			builder_content_json TEXT,
			header_title TEXT NOT NULL,
			footer_text TEXT,
			contact_email TEXT,
			contact_phone TEXT,
			whatsapp_url TEXT,
			default_public_lang TEXT NOT NULL DEFAULT 'vi',
			search_enabled INTEGER NOT NULL DEFAULT 1,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS tenant_site_pages (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			page_key TEXT NOT NULL,
			lang TEXT NOT NULL,
			title TEXT NOT NULL,
			content TEXT NOT NULL,
			updated_at INTEGER NOT NULL,
			UNIQUE (tenant_id, page_key, lang)
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
