import { spawnSync } from 'node:child_process';

const NPX_BIN = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const POWERSHELL_BIN = 'powershell.exe';
const DB_NAME = 'travel_agent_db';
const RECONCILE_MIGRATION = '0012_stop_services_config.sql';

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runNpx(args, options = {}) {
  const result = process.platform === 'win32'
    ? spawnSync(POWERSHELL_BIN, ['-NoProfile', '-Command', `& ${quotePowerShell(NPX_BIN)} ${args.map(quotePowerShell).join(' ')}`], {
        cwd: process.cwd(),
        encoding: 'utf8',
        ...options,
      })
    : spawnSync(NPX_BIN, args, {
        cwd: process.cwd(),
        encoding: 'utf8',
        ...options,
      });

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `Command failed: npx ${args.join(' ')}`).trim());
  }

  return result.stdout;
}

function runD1Json(sql) {
  const normalizedSql = String(sql).replace(/\s+/g, ' ').trim();
  const raw = runNpx([
    'wrangler', 'd1', 'execute', DB_NAME,
    '--local',
    `--command="${normalizedSql.replaceAll('"', '\\"')}"`,
    '--json',
  ]);

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed[0]?.success) {
    throw new Error(`D1 execute failed for SQL: ${sql}`);
  }
  return parsed[0].results || [];
}

function hasServicesConfigColumn() {
  const rows = runD1Json('PRAGMA table_info(tour_stops);');
  return rows.some((row) => row.name === 'services_config');
}

function hasMigrationLedgerEntry() {
  const rows = runD1Json(`SELECT id FROM d1_migrations WHERE name = '${RECONCILE_MIGRATION}' LIMIT 1;`);
  return rows.length > 0;
}

function reconcileServicesConfigMigration() {
  const columnExists = hasServicesConfigColumn();
  const ledgerExists = hasMigrationLedgerEntry();

  if (!columnExists) {
    console.log(`[db:migrate:local] ${RECONCILE_MIGRATION}: services_config column missing, normal Wrangler apply will handle it.`);
    return;
  }

  if (ledgerExists) {
    console.log(`[db:migrate:local] ${RECONCILE_MIGRATION}: ledger already consistent.`);
    return;
  }

  runD1Json(`INSERT INTO d1_migrations (name, applied_at) VALUES ('${RECONCILE_MIGRATION}', CURRENT_TIMESTAMP);`);
  console.log(`[db:migrate:local] ${RECONCILE_MIGRATION}: inserted missing ledger row because tour_stops.services_config already exists.`);
}

function applyLocalMigrations() {
  const output = runNpx([
    'wrangler', 'd1', 'migrations', 'apply', DB_NAME,
    '--local',
  ]);

  process.stdout.write(output);
}

try {
  reconcileServicesConfigMigration();
  applyLocalMigrations();
} catch (error) {
  console.error(`[db:migrate:local] ${error.message}`);
  process.exit(1);
}