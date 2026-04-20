/**
 * CHK-R104 – SEO routes: sitemap.xml + robots.txt
 * Served at the tenant's domain root (resolved via Host header).
 *
 * GET /sitemap.xml   – Dynamic XML sitemap listing all on_sale tours
 * GET /robots.txt    – Allows/disallows crawlers based on public_indexing_enabled
 *
 * Both routes resolve the tenant via resolveTenantByHost (custom domain or
 * subdomain) and gate output on the tenant's public_indexing_enabled flag.
 */

import { resolveTenantByHost } from '../lib/siteStudio.js';

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

/**
 * Build the canonical base URL for a tenant.
 * Prefers custom_domain if verified, falls back to subdomain.
 */
function tenantBaseUrl(tenant) {
  if (tenant.custom_domain && tenant.custom_domain_verified_at) {
    return `https://${tenant.custom_domain}`;
  }
  if (tenant.subdomain) {
    return `https://${tenant.subdomain}.tours-market.com`;
  }
  return null;
}

export default function registerSeoRoutes(app) {
  // ── robots.txt ────────────────────────────────────────────────────────────
  app.get('/robots.txt', async (c) => {
    const host = c.req.header('Host') ?? '';
    let lines;

    try {
      const tenant = await resolveTenantByHost(host, c.env.DB);
      const base = tenantBaseUrl(tenant);

      if (tenant.public_indexing_enabled) {
        lines = [
          'User-agent: *',
          'Allow: /',
          ...(base ? [`Sitemap: ${base}/sitemap.xml`] : []),
        ];
      } else {
        lines = [
          'User-agent: *',
          'Disallow: /',
        ];
      }
    } catch {
      // Unknown host — be conservative
      lines = ['User-agent: *', 'Disallow: /'];
    }

    return new Response(lines.join('\n') + '\n', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
    });
  });

  // ── sitemap.xml ───────────────────────────────────────────────────────────
  app.get('/sitemap.xml', async (c) => {
    const host = c.req.header('Host') ?? '';

    let tenant;
    try {
      tenant = await resolveTenantByHost(host, c.env.DB);
    } catch {
      return new Response('Tenant not found', { status: 404 });
    }

    if (!tenant.public_indexing_enabled) {
      return new Response('Indexing disabled', { status: 403 });
    }

    const base = tenantBaseUrl(tenant);
    if (!base) {
      return new Response('No canonical URL configured', { status: 400 });
    }

    // Fetch all on_sale tours that have a slug
    const { results: tours } = await c.env.DB
      .prepare(
        `SELECT id, slug, meta_title, title, updated_at
         FROM tours
         WHERE tenant_id = ? AND status = 'on_sale' AND slug IS NOT NULL AND slug != ''
         ORDER BY created_at DESC
         LIMIT 500`
      )
      .bind(tenant.id)
      .all();

    // Fetch site pages (standard + legal) that are visible
    const { results: pages } = await c.env.DB
      .prepare(
        `SELECT slug, updated_at
         FROM universal_tour_pages
         WHERE tenant_id = ? AND status = 'published' AND visible = 1
           AND page_type IN ('standard', 'legal', 'custom')
           AND slug IS NOT NULL AND slug != ''
         ORDER BY updated_at DESC
         LIMIT 200`
      )
      .bind(tenant.id)
      .all()
      .catch(() => ({ results: [] })); // table may not exist on older installs

    const now = new Date().toISOString().split('T')[0];

    const tourUrls = tours.map(t => {
      const loc = esc(`${base}/tour/${t.slug}`);
      const lastmod = t.updated_at ? t.updated_at.slice(0, 10) : now;
      return `  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`;
    });

    const pageUrls = pages.map(p => {
      const loc = esc(`${base}/${p.slug}`);
      const lastmod = p.updated_at ? p.updated_at.slice(0, 10) : now;
      return `  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod><changefreq>monthly</changefreq><priority>0.5</priority></url>`;
    });

    // Home page
    const homepageUrl = `  <url><loc>${esc(base)}/</loc><lastmod>${now}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>`;

    const xml = [
      XML_HEADER,
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      homepageUrl,
      ...pageUrls,
      ...tourUrls,
      '</urlset>',
    ].join('\n');

    return new Response(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=1800',
      },
    });
  });
}

/** XML-safe escape for URL values */
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
