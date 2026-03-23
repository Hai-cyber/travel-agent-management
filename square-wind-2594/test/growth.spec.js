import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index.js';

describe('Growth & SEO [CHK-405]', () => {
	let db;
	const tenantId = 'ten-growth-1';
	const headers = { 'X-Tenant-ID': tenantId, 'Content-Type': 'application/json' };

	beforeEach(async () => {
		db = env.DB;
		for (const statement of tableStatements()) {
			await db.prepare(statement).run();
		}
	});

	afterEach(async () => {
		for (const table of ['growth_events', 'growth_leads', 'tour_growth_seo_metas', 'tour_growth_slugs', 'tenant_growth_configs', 'tours']) {
			await db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
		}
	});

	it('returns default growth config and supports updates', async () => {
		const getResponse = await worker.fetch(new Request('http://example.com/api/growth/config', { method: 'GET', headers }), env);
		expect(getResponse.status).toBe(200);
		const base = await getResponse.json();
		expect(base.google_analytics_id).toBeNull();
		expect(base.trust_badges).toEqual([]);

		const updateResponse = await worker.fetch(
			new Request('http://example.com/api/growth/config', {
				method: 'POST',
				headers,
				body: JSON.stringify({
					google_analytics_id: 'G-TEST123',
					facebook_pixel_id: '1234567890',
					whatsapp_url: 'https://wa.me/84901111222',
					trust_badges_json: ['verified', 'top-rated'],
				}),
			}),
			env
		);
		expect(updateResponse.status).toBe(200);
		const updated = await updateResponse.json();
		expect(updated.google_analytics_id).toBe('G-TEST123');
		expect(updated.trust_badges).toEqual(['verified', 'top-rated']);
	});

	it('stores tour slug and multilingual seo metadata with public slug lookup', async () => {
		const tourId = await seedTour(db, tenantId, 'Mekong Flow', 'on_sale');

		const slugRes = await worker.fetch(
			new Request(`http://example.com/api/growth/tours/${tourId}/slug`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ slug: 'mekong-flow' }),
			}),
			env
		);
		expect(slugRes.status).toBe(200);

		const seoRes = await worker.fetch(
			new Request(`http://example.com/api/growth/tours/${tourId}/seo`, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					lang: 'en',
					meta_title: 'Mekong Flow 3N2D',
					meta_description: 'Canals, markets, and river nights.',
					og_title: 'Mekong Flow Tour',
					og_description: 'Explore Mekong highlights',
					og_image: 'https://cdn.test/mekong.jpg',
				}),
			}),
			env
		);
		expect(seoRes.status).toBe(200);

		const publicRes = await worker.fetch(
			new Request('http://example.com/public/tours/slug/mekong-flow?lang=en', { method: 'GET', headers }),
			env
		);
		expect(publicRes.status).toBe(200);
		const publicData = await publicRes.json();
		expect(publicData.meta_description).toContain('Canals');
		expect(publicData.og_image).toContain('mekong.jpg');
	});

	it('rejects duplicate slug claims within tenant', async () => {
		const tourA = await seedTour(db, tenantId, 'Tour A', 'on_sale');
		const tourB = await seedTour(db, tenantId, 'Tour B', 'on_sale');

		await worker.fetch(
			new Request(`http://example.com/api/growth/tours/${tourA}/slug`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ slug: 'shared-slug' }),
			}),
			env
		);

		const duplicate = await worker.fetch(
			new Request(`http://example.com/api/growth/tours/${tourB}/slug`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ slug: 'shared-slug' }),
			}),
			env
		);
		expect(duplicate.status).toBe(400);
	});

	it('generates sitemap and robots baseline', async () => {
		const tourOnSale = await seedTour(db, tenantId, 'Sapa Trail', 'on_sale');
		const tourDraft = await seedTour(db, tenantId, 'Draft Tour', 'draft');

		await worker.fetch(
			new Request(`http://example.com/api/growth/tours/${tourOnSale}/slug`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ slug: 'sapa-trail' }),
			}),
			env
		);
		await worker.fetch(
			new Request(`http://example.com/api/growth/tours/${tourDraft}/slug`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ slug: 'draft-tour' }),
			}),
			env
		);

		const sitemap = await worker.fetch(new Request('http://example.com/sitemap.xml', { method: 'GET', headers }), env);
		expect(sitemap.status).toBe(200);
		const sitemapText = await sitemap.text();
		expect(sitemapText).toContain('/public/tours/slug/sapa-trail');
		expect(sitemapText).not.toContain('/public/tours/slug/draft-tour');

		const robots = await worker.fetch(new Request('http://example.com/robots.txt', { method: 'GET', headers }), env);
		expect(robots.status).toBe(200);
		const robotsText = await robots.text();
		expect(robotsText).toContain('Sitemap: /sitemap.xml');
	});

	it('captures lead and growth event payloads', async () => {
		const tourId = await seedTour(db, tenantId, 'Lead Tour', 'on_sale');

		const leadRes = await worker.fetch(
			new Request('http://example.com/public/leads/contact', {
				method: 'POST',
				headers,
				body: JSON.stringify({
					tour_id: tourId,
					channel: 'contact_form',
					name: 'An Nguyen',
					email: 'an@example.com',
					message: 'Can I customize this itinerary?',
				}),
			}),
			env
		);
		expect(leadRes.status).toBe(201);

		const eventRes = await worker.fetch(
			new Request('http://example.com/public/events', {
				method: 'POST',
				headers,
				body: JSON.stringify({
					event_name: 'view_tour',
					tour_id: tourId,
					channel: 'seo',
					metadata: { source: 'google' },
				}),
			}),
			env
		);
		expect(eventRes.status).toBe(201);

		const leadCount = await db.prepare('SELECT COUNT(*) as total FROM growth_leads WHERE tenant_id = ?').bind(tenantId).first();
		const eventCount = await db.prepare('SELECT COUNT(*) as total FROM growth_events WHERE tenant_id = ?').bind(tenantId).first();
		expect(leadCount.total).toBe(1);
		expect(eventCount.total).toBe(1);
	});
});

async function seedTour(db, tenantId, title, status) {
	const id = crypto.randomUUID();
	await db
		.prepare(
			`INSERT INTO tours (id, tenant_id, title, lang, start_date, duration_text, status, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(id, tenantId, title, 'vi', Date.now(), '3N2D', status, Date.now())
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
		`CREATE TABLE IF NOT EXISTS tenant_growth_configs (
			tenant_id TEXT PRIMARY KEY,
			google_analytics_id TEXT,
			facebook_pixel_id TEXT,
			tripadvisor_url TEXT,
			google_reviews_url TEXT,
			whatsapp_url TEXT,
			call_phone TEXT,
			contact_email TEXT,
			trust_badges_json TEXT,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS tour_growth_slugs (
			tenant_id TEXT NOT NULL,
			tour_id TEXT NOT NULL,
			slug TEXT NOT NULL,
			updated_at INTEGER NOT NULL,
			PRIMARY KEY (tenant_id, tour_id),
			UNIQUE (tenant_id, slug)
		)`,
		`CREATE TABLE IF NOT EXISTS tour_growth_seo_metas (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			tour_id TEXT NOT NULL,
			lang TEXT NOT NULL,
			meta_title TEXT,
			meta_description TEXT,
			keywords TEXT,
			og_title TEXT,
			og_description TEXT,
			og_image TEXT,
			snippet_template TEXT,
			updated_at INTEGER NOT NULL,
			UNIQUE (tenant_id, tour_id, lang)
		)`,
		`CREATE TABLE IF NOT EXISTS growth_leads (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			tour_id TEXT,
			channel TEXT NOT NULL,
			name TEXT,
			email TEXT,
			phone TEXT,
			message TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS growth_events (
			id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			tour_id TEXT,
			event_name TEXT NOT NULL,
			channel TEXT,
			metadata_json TEXT,
			created_at INTEGER NOT NULL
		)`,
	];
}
