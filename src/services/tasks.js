// src/services/tasks.js

export async function createTasksForServiceItem(item, group, env) {
  const templates = {
    "accommodations": [
      "Confirm booking with hotel",
      "Verify room type",
      "Confirm check‑in/check‑out time"
    ],
    "meals": [
      "Confirm restaurant reservation",
      "Check dietary requirements",
      "Verify restaurant address"
    ],
    "guides": [
      "Confirm guide assignment",
      "Verify meeting point",
      "Confirm guide language"
    ],
    "local-transports": [
      "Confirm driver assignment",
      "Verify pickup time",
      "Verify dropoff location"
    ],
    "intercity-legs": [
      "Confirm ticket",
      "Verify departure time",
      "Verify arrival time"
    ]
  };

  const taskTitles = templates[group] || [];
  const now = Math.floor(Date.now() / 1000);

  for (const title of taskTitles) {
    const id = crypto.randomUUID();

    await env.DB.prepare(`
      INSERT INTO stop_service_tasks (id, tenant_id, service_item_id, group_name, title, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `)
      .bind(id, item.tenant_id, item.id, group, title, now)
      .run();
  }
}

export async function getTasksForItem(serviceItemId, tenantId, env) {
  const result = await env.DB.prepare(`
    SELECT id, title, status, created_at
    FROM stop_service_tasks
    WHERE service_item_id = ? AND tenant_id = ?
    ORDER BY created_at ASC
  `)
    .bind(serviceItemId, tenantId)
    .all();

  return result.results || [];
}

export async function updateTask(taskId, tenantId, data, env) {
  const fields = [];
  const values = [];

  if (data.status) {
    fields.push('status = ?');
    values.push(data.status);
  }

  if (fields.length === 0) {
    return { ok: false, error: 'Empty update' };
  }

  // [SEC] WHERE tenant_id = ? — ngăn update task của tenant khác
  values.push(taskId, tenantId);

  await env.DB.prepare(`
    UPDATE stop_service_tasks
    SET ${fields.join(', ')}
    WHERE id = ? AND tenant_id = ?
  `)
    .bind(...values)
    .run();

  return { ok: true };
}
