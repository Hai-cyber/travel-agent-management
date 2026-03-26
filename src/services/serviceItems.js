
// Service Items Service Layer for CHK‑R09 (Cloudflare Worker D1)
export const SERVICE_TABLES = {
  accommodations: 'stop_accommodations',
  meals: 'stop_meals',
  guides: 'stop_guides',
  'local-transports': 'stop_local_transports',
  'intercity-legs': 'stop_intercity_legs',
};

function getTable(group) {
  if (!SERVICE_TABLES[group]) throw new Error('Invalid group');
  return SERVICE_TABLES[group];
}

export async function createItem(env, group, tenantId, stopId, data) {
  const table = getTable(group);
  // Validate tour_stop_id exists
  const stopRes = await env.DB.prepare('SELECT * FROM tour_stops WHERE id = ? AND tenant_id = ?')
    .bind(stopId, tenantId).first();
  if (!stopRes) throw new Error('tour_stop_id not found');
  // Defaults
  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();
  const insert = { ...data };
  if (insert.stage == null) insert.stage = 'pending';
  if (insert.status == null) insert.status = 'planned';
  if (insert.position == null) insert.position = 0;
  insert.id = id;
  insert.created_at = now;
  insert.tenant_id = tenantId;
  insert.tour_stop_id = stopId;
  const fields = Object.keys(insert);
  const values = Object.values(insert);
  const placeholders = fields.map(() => '?').join(',');
  const sql = `INSERT INTO ${table} (${fields.join(',')}) VALUES (${placeholders}) RETURNING *`;
  const result = await env.DB.prepare(sql).bind(...values).all();
  const item = result.results?.[0];
  return item;
}

export async function getItems(env, group, tenantId, stopId) {
  const table = getTable(group);
  const result = await env.DB.prepare(`SELECT * FROM ${table} WHERE tenant_id = ? AND tour_stop_id = ?`)
    .bind(tenantId, stopId).all();
  return result.results || [];
}

export async function updateItem(env, group, tenantId, itemId, data) {
  const table = getTable(group);
  const allowed = Object.keys(data);
  if (!allowed.length) throw new Error('No fields to update');
  const set = allowed.map(f => `${f} = ?`).join(', ');
  const sql = `UPDATE ${table} SET ${set} WHERE id = ? AND tenant_id = ? RETURNING *`;
  const values = [...allowed.map(f => data[f]), itemId, tenantId];
  const result = await env.DB.prepare(sql).bind(...values).all();
  const item = result.results?.[0];
  if (!item) throw new Error('Item not found or not updated');
  return item;
}
