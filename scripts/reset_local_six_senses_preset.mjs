import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { nanoid } from 'nanoid';
import { buildDefaultSiteScaffold } from '../src/lib/universalSite.js';

const tenantId = process.argv[2] || 'ten-demo-001';
const siteName = process.argv[3] || 'Demo Agency';
const groupKey = 'tour_operator';
const variantKey = 'tour-luxury';
const now = Math.floor(Date.now() / 1000);
const scaffold = buildDefaultSiteScaffold(groupKey, variantKey);

function q(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

const sql = [];
sql.push(`UPDATE tenant_universal_sites SET group_key = ${q(groupKey)}, variant_key = ${q(variantKey)}, site_name = ${q(siteName)}, home_page_key = 'home', updated_at = ${now} WHERE tenant_id = ${q(tenantId)};`);
sql.push(`UPDATE tenant_universal_theme_tokens SET tokens_json = ${q(JSON.stringify(scaffold.themeTokens))}, updated_at = ${now} WHERE tenant_id = ${q(tenantId)};`);
sql.push(`UPDATE tenant_universal_contacts SET channels_json = ${q(JSON.stringify(scaffold.contacts))}, updated_at = ${now} WHERE tenant_id = ${q(tenantId)};`);
sql.push(`DELETE FROM tenant_universal_menu_items WHERE tenant_id = ${q(tenantId)};`);
sql.push(`DELETE FROM tenant_universal_pages WHERE tenant_id = ${q(tenantId)} AND page_type IN ('standard','legal','system');`);

for (const [index, item] of scaffold.menuItems.entries()) {
  sql.push(
    `INSERT INTO tenant_universal_menu_items (id, tenant_id, item_key, label, href, page_key, target, is_external, visible, sort_order, created_at, updated_at) VALUES (${q(nanoid())}, ${q(tenantId)}, ${q(item.itemKey)}, ${q(item.label)}, ${q(item.href)}, ${item.pageKey ? q(item.pageKey) : 'NULL'}, ${q(item.target || '_self')}, ${item.isExternal ? 1 : 0}, ${item.visible === 0 ? 0 : 1}, ${Number.isFinite(item.sortOrder) ? Number(item.sortOrder) : index}, ${now}, ${now});`
  );
}

for (const page of scaffold.pages) {
  sql.push(
    `INSERT INTO tenant_universal_pages (id, tenant_id, page_key, title, slug, page_type, status, visible, blocks_json, seo_json, created_at, updated_at) VALUES (${q(nanoid())}, ${q(tenantId)}, ${q(page.pageKey)}, ${q(page.title)}, ${q(page.slug)}, ${q(page.pageType)}, ${q(page.status)}, ${page.visible}, ${q(JSON.stringify(page.blocks || []))}, ${q(JSON.stringify(page.seo || {}))}, ${now}, ${now});`
  );
}

const tempDir = mkdtempSync(join(tmpdir(), 'reset-six-senses-'));
const tempFile = join(tempDir, 'reset.sql');

try {
  writeFileSync(tempFile, sql.join('\n'));
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'travel_agent_db', '--local', '--file', tempFile], { stdio: 'inherit' });
  console.log(`Restored ${tenantId} to the default Six Senses luxury scaffold.`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}