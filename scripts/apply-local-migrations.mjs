import { spawnSync } from 'node:child_process';

const NPX_BIN = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const POWERSHELL_BIN = 'powershell.exe';
const DB_NAME = 'travel_agent_db';
const RECONCILE_MIGRATION = '0012_stop_services_config.sql';
const BOOKING_TODO_SERVICE_FIELDS_MIGRATION = '0052_booking_order_todos_service_fields.sql';
const TENANT_CALENDAR_SECRET_MIGRATION = '0056_tenant_calendar_secret.sql';
const SUPPLIERS_V2_MIGRATION = '0076_suppliers_v2.sql';

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

function tableIndexes(tableName) {
  if (!hasTable(tableName)) return [];
  return runD1Json(`PRAGMA index_list(${tableName});`);
}

function reconcileAdditiveColumnsMigration({ name, tableName, columns, postSql = [], missingLabel = 'expected columns' }) {
  if (hasLedgerEntry(name)) {
    console.log(`[db:migrate:local] ${name}: ledger already consistent.`);
    return;
  }

  if (!hasTable(tableName)) {
    console.log(`[db:migrate:local] ${name}: ${tableName} table missing, normal Wrangler apply will handle it.`);
    return;
  }

  const existingColumns = new Set(tableColumns(tableName).map((row) => String(row.name)));
  const hasAnyExpectedColumn = columns.some((column) => existingColumns.has(column.name));
  if (!hasAnyExpectedColumn) {
    console.log(`[db:migrate:local] ${name}: ${missingLabel} missing, normal Wrangler apply will handle it.`);
    return;
  }

  for (const column of columns) {
    if (existingColumns.has(column.name)) continue;
    runD1Json(column.sql);
    console.log(`[db:migrate:local] ${name}: added missing column ${column.name}.`);
  }

  for (const sql of postSql) {
    runD1Json(sql);
  }

  runD1Json(`INSERT INTO d1_migrations (name, applied_at) VALUES ('${name}', CURRENT_TIMESTAMP);`);
  console.log(`[db:migrate:local] ${name}: reconciled partial apply and inserted missing ledger row.`);
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

function reconcileTenantCalendarSecretMigration() {
  if (hasLedgerEntry(TENANT_CALENDAR_SECRET_MIGRATION)) {
    console.log(`[db:migrate:local] ${TENANT_CALENDAR_SECRET_MIGRATION}: ledger already consistent.`);
    return;
  }

  if (!hasTable('tenants')) {
    console.log(`[db:migrate:local] ${TENANT_CALENDAR_SECRET_MIGRATION}: tenants table missing, normal Wrangler apply will handle it.`);
    return;
  }

  const existingColumns = new Set(tableColumns('tenants').map((row) => String(row.name)));
  if (!existingColumns.has('calendar_secret')) {
    console.log(`[db:migrate:local] ${TENANT_CALENDAR_SECRET_MIGRATION}: calendar_secret column missing, normal Wrangler apply will handle it.`);
    return;
  }

  const existingIndexes = new Set(tableIndexes('tenants').map((row) => String(row.name)));
  if (!existingIndexes.has('idx_tenants_calendar_secret')) {
    runD1Json(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_calendar_secret ON tenants(calendar_secret) WHERE calendar_secret IS NOT NULL;`);
    console.log(`[db:migrate:local] ${TENANT_CALENDAR_SECRET_MIGRATION}: created missing idx_tenants_calendar_secret index.`);
  }

  runD1Json(`INSERT INTO d1_migrations (name, applied_at) VALUES ('${TENANT_CALENDAR_SECRET_MIGRATION}', CURRENT_TIMESTAMP);`);
  console.log(`[db:migrate:local] ${TENANT_CALENDAR_SECRET_MIGRATION}: reconciled partial apply and inserted missing ledger row.`);
}

function reconcileSuppliersV2Migration() {
  if (hasLedgerEntry(SUPPLIERS_V2_MIGRATION)) {
    console.log(`[db:migrate:local] ${SUPPLIERS_V2_MIGRATION}: ledger already consistent.`);
    return;
  }

  if (!hasTable('suppliers')) {
    console.log(`[db:migrate:local] ${SUPPLIERS_V2_MIGRATION}: suppliers table missing, normal Wrangler apply will handle it.`);
    return;
  }

  const existingColumns = new Set(tableColumns('suppliers').map((row) => String(row.name)));
  const expectedColumns = [
    {
      name: 'contact_name',
      sql: `ALTER TABLE suppliers ADD COLUMN contact_name TEXT`,
    },
    {
      name: 'contact_phone',
      sql: `ALTER TABLE suppliers ADD COLUMN contact_phone TEXT`,
    },
    {
      name: 'contact_email',
      sql: `ALTER TABLE suppliers ADD COLUMN contact_email TEXT`,
    },
    {
      name: 'contact_whatsapp',
      sql: `ALTER TABLE suppliers ADD COLUMN contact_whatsapp TEXT`,
    },
    {
      name: 'contact_zalo',
      sql: `ALTER TABLE suppliers ADD COLUMN contact_zalo TEXT`,
    },
    {
      name: 'address',
      sql: `ALTER TABLE suppliers ADD COLUMN address TEXT`,
    },
    {
      name: 'is_active',
      sql: `ALTER TABLE suppliers ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`,
    },
  ];

  const hasAnyExpectedColumn = expectedColumns.some((column) => existingColumns.has(column.name));
  if (!hasAnyExpectedColumn) {
    console.log(`[db:migrate:local] ${SUPPLIERS_V2_MIGRATION}: structured supplier columns missing, normal Wrangler apply will handle it.`);
    return;
  }

  for (const column of expectedColumns) {
    if (existingColumns.has(column.name)) continue;
    runD1Json(column.sql);
    console.log(`[db:migrate:local] ${SUPPLIERS_V2_MIGRATION}: added missing column ${column.name}.`);
  }

  runD1Json(`CREATE INDEX IF NOT EXISTS idx_suppliers_tenant ON suppliers (tenant_id);`);
  runD1Json(`INSERT INTO d1_migrations (name, applied_at) VALUES ('${SUPPLIERS_V2_MIGRATION}', CURRENT_TIMESTAMP);`);
  console.log(`[db:migrate:local] ${SUPPLIERS_V2_MIGRATION}: reconciled partial apply and inserted missing ledger row.`);
}

function reconcileToursSeoFieldsMigration() {
  reconcileAdditiveColumnsMigration({
    name: '0077_tours_seo_fields.sql',
    tableName: 'tours',
    columns: [
      { name: 'meta_title', sql: `ALTER TABLE tours ADD COLUMN meta_title TEXT` },
      { name: 'meta_description', sql: `ALTER TABLE tours ADD COLUMN meta_description TEXT` },
      { name: 'og_image', sql: `ALTER TABLE tours ADD COLUMN og_image TEXT` },
    ],
    missingLabel: 'SEO columns',
  });
}

function reconcileBookingSourceMigration() {
  reconcileAdditiveColumnsMigration({
    name: '0080_booking_source.sql',
    tableName: 'booking_orders',
    columns: [
      { name: 'booking_source', sql: `ALTER TABLE booking_orders ADD COLUMN booking_source TEXT` },
    ],
    missingLabel: 'booking source column',
  });
}

function reconcilePaymentSessionsMigration() {
  reconcileAdditiveColumnsMigration({
    name: '0081_payment_sessions.sql',
    tableName: 'booking_orders',
    columns: [
      { name: 'payment_provider', sql: `ALTER TABLE booking_orders ADD COLUMN payment_provider TEXT` },
      { name: 'payment_session_id', sql: `ALTER TABLE booking_orders ADD COLUMN payment_session_id TEXT` },
      { name: 'payment_link_url', sql: `ALTER TABLE booking_orders ADD COLUMN payment_link_url TEXT` },
      { name: 'payment_link_expires_at', sql: `ALTER TABLE booking_orders ADD COLUMN payment_link_expires_at INTEGER` },
    ],
    missingLabel: 'payment session columns',
  });
}

function reconcilePropertyAddressMigration() {
  reconcileAdditiveColumnsMigration({
    name: '0082_property_address.sql',
    tableName: 'properties',
    columns: [
      { name: 'address_line_1', sql: `ALTER TABLE properties ADD COLUMN address_line_1 TEXT` },
      { name: 'address_line_2', sql: `ALTER TABLE properties ADD COLUMN address_line_2 TEXT` },
      { name: 'city', sql: `ALTER TABLE properties ADD COLUMN city TEXT` },
      { name: 'state_province', sql: `ALTER TABLE properties ADD COLUMN state_province TEXT` },
      { name: 'postal_code', sql: `ALTER TABLE properties ADD COLUMN postal_code TEXT` },
      { name: 'country_code', sql: `ALTER TABLE properties ADD COLUMN country_code TEXT` },
    ],
    missingLabel: 'property address columns',
  });
}

function reconcileTenantAddonSlotsMigration() {
  reconcileAdditiveColumnsMigration({
    name: '0083_tenant_addon_slots.sql',
    tableName: 'tenants',
    columns: [
      { name: 'extra_property_slots', sql: `ALTER TABLE tenants ADD COLUMN extra_property_slots INTEGER NOT NULL DEFAULT 0` },
      { name: 'extra_staff_slots', sql: `ALTER TABLE tenants ADD COLUMN extra_staff_slots INTEGER NOT NULL DEFAULT 0` },
    ],
    missingLabel: 'tenant add-on slot columns',
  });
}

function reconcileReservationRoomAssignmentMigration() {
  reconcileAdditiveColumnsMigration({
    name: '0084_property_reservation_room_assignment.sql',
    tableName: 'property_reservations',
    columns: [
      {
        name: 'assigned_room_unit_id',
        sql: `ALTER TABLE property_reservations ADD COLUMN assigned_room_unit_id TEXT REFERENCES room_units(id)`,
      },
    ],
    postSql: [
      `CREATE INDEX IF NOT EXISTS idx_property_reservations_assigned_room_unit ON property_reservations (tenant_id, property_id, assigned_room_unit_id, status)`,
    ],
    missingLabel: 'room assignment column',
  });
}

function reconcilePropertyAddonFeeFieldsMigration() {
  reconcileAdditiveColumnsMigration({
    name: '0086_property_addon_fee_fields.sql',
    tableName: 'property_addon_service_presets',
    columns: [
      {
        name: 'early_arrival_fee',
        sql: `ALTER TABLE property_addon_service_presets ADD COLUMN early_arrival_fee REAL NOT NULL DEFAULT 0`,
      },
      {
        name: 'late_checkout_fee',
        sql: `ALTER TABLE property_addon_service_presets ADD COLUMN late_checkout_fee REAL NOT NULL DEFAULT 0`,
      },
    ],
    missingLabel: 'addon fee columns',
  });
}

function reconcilePropertyReservationGuestPhotosMigration() {
  reconcileAdditiveColumnsMigration({
    name: '0087_property_reservation_guest_photos.sql',
    tableName: 'property_reservations',
    columns: [
      { name: 'guest_photo_key', sql: `ALTER TABLE property_reservations ADD COLUMN guest_photo_key TEXT` },
      { name: 'guest_photo_uploaded_at', sql: `ALTER TABLE property_reservations ADD COLUMN guest_photo_uploaded_at INTEGER` },
    ],
    missingLabel: 'guest photo columns',
  });
}

function reconcilePropertyShiftHandoverRoomFlagsMigration() {
  const name = '0088_property_shift_handover_room_flags.sql';
  if (hasLedgerEntry(name)) {
    console.log(`[db:migrate:local] ${name}: ledger already consistent.`);
    return;
  }

  if (!hasTable('properties') || !hasTable('room_units')) {
    console.log(`[db:migrate:local] ${name}: properties or room_units table missing, normal Wrangler apply will handle it.`);
    return;
  }

  const propertyColumns = [
    { name: 'shift_handover_note', sql: `ALTER TABLE properties ADD COLUMN shift_handover_note TEXT` },
    { name: 'shift_handover_updated_at', sql: `ALTER TABLE properties ADD COLUMN shift_handover_updated_at INTEGER` },
    { name: 'shift_handover_updated_by', sql: `ALTER TABLE properties ADD COLUMN shift_handover_updated_by TEXT` },
  ];
  const roomUnitColumns = [
    { name: 'do_not_disturb', sql: `ALTER TABLE room_units ADD COLUMN do_not_disturb INTEGER NOT NULL DEFAULT 0` },
    { name: 'room_service_requested', sql: `ALTER TABLE room_units ADD COLUMN room_service_requested INTEGER NOT NULL DEFAULT 0` },
  ];

  const existingPropertyColumns = new Set(tableColumns('properties').map((row) => String(row.name)));
  const existingRoomUnitColumns = new Set(tableColumns('room_units').map((row) => String(row.name)));
  const hasAnyExpectedColumn = propertyColumns.some((column) => existingPropertyColumns.has(column.name))
    || roomUnitColumns.some((column) => existingRoomUnitColumns.has(column.name));
  if (!hasAnyExpectedColumn) {
    console.log(`[db:migrate:local] ${name}: shift handover and room flag columns missing, normal Wrangler apply will handle it.`);
    return;
  }

  for (const column of propertyColumns) {
    if (existingPropertyColumns.has(column.name)) continue;
    runD1Json(column.sql);
    console.log(`[db:migrate:local] ${name}: added missing properties column ${column.name}.`);
  }
  for (const column of roomUnitColumns) {
    if (existingRoomUnitColumns.has(column.name)) continue;
    runD1Json(column.sql);
    console.log(`[db:migrate:local] ${name}: added missing room_units column ${column.name}.`);
  }

  runD1Json(`INSERT INTO d1_migrations (name, applied_at) VALUES ('${name}', CURRENT_TIMESTAMP);`);
  console.log(`[db:migrate:local] ${name}: reconciled partial apply and inserted missing ledger row.`);
}

function reconcileHousekeepingTaskKindServiceDateMigration() {
  reconcileAdditiveColumnsMigration({
    name: '0090_housekeeping_task_kind_service_date.sql',
    tableName: 'housekeeping_tasks',
    columns: [
      { name: 'task_kind', sql: `ALTER TABLE housekeeping_tasks ADD COLUMN task_kind TEXT NOT NULL DEFAULT 'departure_clean'` },
      { name: 'service_date', sql: `ALTER TABLE housekeeping_tasks ADD COLUMN service_date TEXT` },
    ],
    postSql: [
      `UPDATE housekeeping_tasks SET service_date = date(scheduled_for, 'unixepoch') WHERE service_date IS NULL AND scheduled_for IS NOT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_housekeeping_tasks_kind_service_date ON housekeeping_tasks (tenant_id, property_id, task_kind, service_date, status)`,
    ],
    missingLabel: 'housekeeping task columns',
  });
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
  reconcileTenantCalendarSecretMigration();
  reconcileSuppliersV2Migration();
  reconcileToursSeoFieldsMigration();
  reconcileBookingSourceMigration();
  reconcilePaymentSessionsMigration();
  reconcilePropertyAddressMigration();
  reconcileTenantAddonSlotsMigration();
  reconcileReservationRoomAssignmentMigration();
  reconcilePropertyAddonFeeFieldsMigration();
  reconcilePropertyReservationGuestPhotosMigration();
  reconcilePropertyShiftHandoverRoomFlagsMigration();
  reconcileHousekeepingTaskKindServiceDateMigration();
  applyLocalMigrations();
} catch (error) {
  console.error(`[db:migrate:local] ${error.message}`);
  process.exit(1);
}