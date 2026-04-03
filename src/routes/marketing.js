import { Hono } from 'hono';
import { resolveLocaleFromAcceptLanguage } from '../utils/formatter.js';
import { getMarketingSitePayload } from '../lib/marketingSite.js';

const marketing = new Hono();

marketing.get('/marketing-site', async (c) => {
  const lang = resolveLocaleFromAcceptLanguage(c.req.header('Accept-Language'));
  const payload = await getMarketingSitePayload(c.env.DB, lang);
  return c.json({ ok: true, ...payload });
});

export default function registerMarketingRoutes(app) {
  app.route('/api', marketing);
}