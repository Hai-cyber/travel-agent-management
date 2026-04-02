import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildDefaultThemeTokens } from '../src/lib/universalSite.js';

const NPX_BIN = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const POWERSHELL_BIN = 'powershell.exe';
const DB_NAME = 'travel_agent_db';

const args = new Set(process.argv.slice(2));
const useRemote = args.has('--remote');
const fromVariant = 'tour-adventure';
const toVariant = 'tour-luxury';
const tokens = JSON.stringify(buildDefaultThemeTokens('tour_operator', toVariant)).replace(/'/g, "''");

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runNpx(commandArgs) {
  const result = process.platform === 'win32'
    ? spawnSync(POWERSHELL_BIN, ['-NoProfile', '-Command', `& ${quotePowerShell(NPX_BIN)} ${commandArgs.map(quotePowerShell).join(' ')}`], {
        cwd: process.cwd(),
        encoding: 'utf8',
      })
    : spawnSync(NPX_BIN, commandArgs, {
        cwd: process.cwd(),
        encoding: 'utf8',
      });

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'Wrangler command failed').trim());
  }

  return result.stdout;
}

function executeJson(sql) {
  const modeFlag = useRemote ? '--remote' : '--local';
  const tempDir = mkdtempSync(join(tmpdir(), 'tam-universal-luxury-'));
  const sqlFile = join(tempDir, 'statement.sql');
  writeFileSync(sqlFile, `${String(sql).trim()}\n`, 'utf8');

  let raw;
  try {
    raw = runNpx([
      'wrangler', 'd1', 'execute', DB_NAME,
      modeFlag,
      '--file',
      sqlFile,
      '--json',
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed[0]?.success) {
    throw new Error(`D1 execute failed for SQL: ${sql}`);
  }
  return parsed[0].results || [];
}

function scalarCount(sql) {
  const rows = executeJson(sql);
  const first = rows[0] || {};
  return Number(first.count ?? first.total ?? 0);
}

const beforeCount = scalarCount(`SELECT COUNT(*) AS count FROM tenant_universal_sites WHERE group_key = 'tour_operator' AND variant_key = '${fromVariant}'`);

executeJson(`
  UPDATE tenant_universal_sites
     SET variant_key = '${toVariant}',
         updated_at = CAST(strftime('%s','now') AS INTEGER)
   WHERE group_key = 'tour_operator'
     AND variant_key = '${fromVariant}';
`);

executeJson(`
  UPDATE tenant_universal_theme_tokens
     SET tokens_json = '${tokens}',
         updated_at = CAST(strftime('%s','now') AS INTEGER)
   WHERE tenant_id IN (
     SELECT tenant_id
       FROM tenant_universal_sites
      WHERE group_key = 'tour_operator'
        AND variant_key = '${toVariant}'
   );
`);

const afterCount = scalarCount(`SELECT COUNT(*) AS count FROM tenant_universal_sites WHERE group_key = 'tour_operator' AND variant_key = '${toVariant}'`);

console.log(JSON.stringify({
  ok: true,
  mode: useRemote ? 'remote' : 'local',
  updated_from_variant: fromVariant,
  updated_to_variant: toVariant,
  converted_count: beforeCount,
  total_luxury_count: afterCount,
}, null, 2));