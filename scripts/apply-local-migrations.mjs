import { spawnSync } from 'node:child_process';

const NPX_BIN = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const POWERSHELL_BIN = 'powershell.exe';
const DB_NAME = 'travel_agent_db';
const RECONCILE_MIGRATION = '0012_stop_services_config.sql';
const BOOKING_TODO_SERVICE_FIELDS_MIGRATION = '0052_booking_order_todos_service_fields.sql';

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

function hasLedgerEntry(name) {
  const rows = runD1Json(`SELECT id FROM d1_migrations WHERE name = '${name}' LIMIT 1;`);
  return rows.length > 0;
}

function hasTable(tableName) {
  const rows = runD1Json(`SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}' LIMIT 1;`);
  return rows.length > 0;
}

function tableColumns(tableName) {
  if (!hasTable(tableName)) return [];
  return runD1Json(`PRAGMA table_info(${tableName});`);
}

// Migration 0049 captures tables (tenant_destinations, tour_destination_links, tour_hotel_links)
// that were applied directly to the remote D1 in CHK-R48 without a migration file.
// If those tables already exist in the local DB (unlikely for a fresh .wrangler state) we add
// a ledger row so Wrangler does not try to create them again.
function reconcileTenantDestinationsMigration() {
  const name = '0049_tenant_destinations_catalog.sql';
  if (hasLedgerEntry(name)) {
    console.log(`[db:migrate:local] ${name}: ledger already consistent.`);
    return;
  }
  if (hasTable('tenant_destinations')) {
    runD1Json(`INSERT INTO d1_migrations (name, applied_at) VALUES ('${name}', CURRENT_TIMESTAMP);`);
    console.log(`[db:migrate:local] ${name}: inserted missing ledger row because tenant_destinations already exists.`);
  } else {
    console.log(`[db:migrate:local] ${name}: tables missing, normal Wrangler apply will create them.`);
  }
}

// Migration 0045 added show_on_home to tenant_universal_hotels and tenant_destinations.
// The tables tenant_destinations / tour_destination_links / tour_hotel_links were
// previously only on remote (no migration file before 0045), so a fresh local DB
// could get into a half-applied state. Reconcile by detecting the existing column
// and creating missing tables + ledger row without re-running the altered ALTERs.
function reconcileShowOnHomeMigration() {
  const name = '0045_show_on_home.sql';
  if (hasLedgerEntry(name)) {
    console.log(`[db:migrate:local] ${name}: ledger already consistent.`);
    return;
  }
  const cols = runD1Json('PRAGMA table_info(tenant_universal_hotels);');
  const hasColumn = cols.some((r) => r.name === 'show_on_home');
  if (!hasColumn) {
    console.log(`[db:migrate:local] ${name}: column missing — normal Wrangler apply will handle it.`);
    return;
  }
  // Column already exists — migration was partially applied. Create missing tables.
  if (!hasTable('tenant_destinations')) {
    const ddls = [
      `CREATE TABLE IF NOT EXISTS tenant_destinations (id TEXT NOT NULL PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT, region TEXT, gallery_json TEXT, status TEXT NOT NULL DEFAULT 'active', show_on_home INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS tour_destination_links (id TEXT NOT NULL PRIMARY KEY, tenant_id TEXT NOT NULL, tour_id TEXT NOT NULL, destination_id TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, UNIQUE (tour_id, destination_id, tenant_id))`,
      `CREATE TABLE IF NOT EXISTS tour_hotel_links (id TEXT NOT NULL PRIMARY KEY, tenant_id TEXT NOT NULL, tour_id TEXT NOT NULL, hotel_id TEXT NOT NULL, nights INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, UNIQUE (tour_id, hotel_id, tenant_id))`,
    ];
    for (const ddl of ddls) runD1Json(ddl);
    console.log(`[db:migrate:local] ${name}: created missing destination/hotel-link tables.`);
  }
  runD1Json(`INSERT INTO d1_migrations (name, applied_at) VALUES ('${name}', CURRENT_TIMESTAMP);`);
  console.log(`[db:migrate:local] ${name}: inserted missing ledger row (show_on_home already present).`);
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

function reconcileBookingOrderTodoServiceFieldsMigration() {
  if (hasLedgerEntry(BOOKING_TODO_SERVICE_FIELDS_MIGRATION)) {
    console.log(`[db:migrate:local] ${BOOKING_TODO_SERVICE_FIELDS_MIGRATION}: ledger already consistent.`);
    return;
  }

  if (!hasTable('booking_order_todos')) {
    console.log(`[db:migrate:local] ${BOOKING_TODO_SERVICE_FIELDS_MIGRATION}: booking_order_todos missing, normal Wrangler apply will handle it.`);
    return;
  }

  const existingColumns = new Set(tableColumns('booking_order_todos').map((row) => String(row.name)));
  const expectedColumns = [
    {
      name: 'service_type',
      sql: `ALTER TABLE booking_order_todos ADD COLUMN service_type TEXT`,
    },
    {
      name: 'service_item_id',
      sql: `ALTER TABLE booking_order_todos ADD COLUMN service_item_id TEXT`,
    },
    {
      name: 'status',
      sql: `ALTER TABLE booking_order_todos ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'`,
    },
    {
      name: 'person_in_charge',
      sql: `ALTER TABLE booking_order_todos ADD COLUMN person_in_charge TEXT`,
    },
    {
      name: 'contact_name',
      sql: `ALTER TABLE booking_order_todos ADD COLUMN contact_name TEXT`,
    },
    {
      name: 'contact_phone',
      sql: `ALTER TABLE booking_order_todos ADD COLUMN contact_phone TEXT`,
    },
    {
      name: 'contact_email',
      sql: `ALTER TABLE booking_order_todos ADD COLUMN contact_email TEXT`,
    },
    {
      name: 'service_meta_json',
      sql: `ALTER TABLE booking_order_todos ADD COLUMN service_meta_json TEXT`,
    },
    {
      name: 'last_reminded_at',
      sql: `ALTER TABLE booking_order_todos ADD COLUMN last_reminded_at INTEGER`,
    },
  ];

  const hasAnyExpectedColumn = expectedColumns.some((column) => existingColumns.has(column.name));
  if (!hasAnyExpectedColumn) {
    console.log(`[db:migrate:local] ${BOOKING_TODO_SERVICE_FIELDS_MIGRATION}: service fields missing, normal Wrangler apply will handle it.`);
    return;
  }

  for (const column of expectedColumns) {
    if (existingColumns.has(column.name)) continue;
    runD1Json(column.sql);
    console.log(`[db:migrate:local] ${BOOKING_TODO_SERVICE_FIELDS_MIGRATION}: added missing column ${column.name}.`);
  }

  runD1Json(`CREATE INDEX IF NOT EXISTS idx_bot_status_order ON booking_order_todos(tenant_id, status, order_id);`);
  runD1Json(`INSERT INTO d1_migrations (name, applied_at) VALUES ('${BOOKING_TODO_SERVICE_FIELDS_MIGRATION}', CURRENT_TIMESTAMP);`);
  console.log(`[db:migrate:local] ${BOOKING_TODO_SERVICE_FIELDS_MIGRATION}: reconciled partial apply and inserted missing ledger row.`);
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
  reconcileShowOnHomeMigration();
  reconcileTenantDestinationsMigration();
  reconcileBookingOrderTodoServiceFieldsMigration();
  applyLocalMigrations();
} catch (error) {
  console.error(`[db:migrate:local] ${error.message}`);
  process.exit(1);
}