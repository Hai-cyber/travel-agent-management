// Service Items Router for CHK‑R09


import { createItem, getItems, updateItem } from '../services/serviceItems.js';
import { createTasksForServiceItem, getTasksForItem } from "../services/tasks.js";

// Đọc tenant từ header X-Tenant-ID (pre-auth pattern).
// TODO: thay bằng JWT/session khi auth middleware được triển khai.
function resolveTenantId(request) {
  const t = request.headers.get('X-Tenant-ID');
  return t ? t.trim() : null;
}


const REQUIRED_FIELDS = {
  accommodations: ["hotel_name", "person_in_charge", "address"],
  meals: ["meal_type", "restaurant_name", "person_in_charge", "address"],
  guides: ["guide_name", "person_in_charge", "address"],
  "local-transports": ["mode", "supplier", "address", "person_in_charge"],
  "intercity-legs": ["mode", "supplier", "address", "person_in_charge"],
};

export async function handleCreateServiceItem(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) {
    return new Response(JSON.stringify({ ok: false, error: 'X-Tenant-ID header is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const { group, stopId } = params;
    // Validate stopId is scoped to this tenant
    const stop = await env.DB.prepare('SELECT id FROM tour_stops WHERE id = ? AND tenant_id = ?').bind(stopId, tenantId).first();
    if (!stop) throw new Error('tour_stop_id not found');
    const data = await request.json();
    // CHK‑R10 validation
    const required = REQUIRED_FIELDS[group] || [];
    const missing = required.filter(f => !data[f] || (typeof data[f] === 'string' && data[f].trim() === ''));
    if (missing.length) {
      return new Response(JSON.stringify({ ok: false, error: "VALIDATION_ERROR", details: { missing } }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const item = await createItem(env, group, tenantId, stopId, data);
    // CHK‑R11: create tasks for new service item
    await createTasksForServiceItem(item, group, env);
    return new Response(JSON.stringify({ ok: true, item }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export async function handleGetServiceItems(request, env, params) {
  const tenantId = resolveTenantId(request);
  if (!tenantId) {
    return new Response(JSON.stringify({ ok: false, error: 'X-Tenant-ID header is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const { group, stopId } = params;
    // Validate stopId is scoped to this tenant
    const stop = await env.DB.prepare('SELECT id FROM tour_stops WHERE id = ? AND tenant_id = ?').bind(stopId, tenantId).first();
    if (!stop) throw new Error('tour_stop_id not found');
    const items = await getItems(env, group, tenantId, stopId);
    // CHK‑R11: embed tasks for each item
    for (const item of items) {
      item.tasks = await getTasksForItem(item.id, tenantId, env);
    }
    return new Response(JSON.stringify({ ok: true, items }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}


const ALLOWED_FIELDS = {
  accommodations: ["hotel_name","person_in_charge","address","contact_name","contact_phone","contact_email","check_in","check_out","room_type","guests","notes","stage","status","position"],
  meals: ["meal_type","restaurant_name","person_in_charge","address","meal_datetime","notes","stage","status","position"],
  guides: ["guide_name","person_in_charge","address","contact_name","phone","email","time_from","time_to","notes","stage","status","position"],
  "local-transports": ["mode","supplier","address","person_in_charge","contact_name","driver_name","phone","email","pickup_time","pickup_place","dropoff_place","notes","stage","status","position"],
  "intercity-legs": ["mode","supplier","address","person_in_charge","contact_name","phone","email","depart_time","depart_point","arrive_point","ticket_ref","notes","stage","status","position"],
};

export async function handleUpdateServiceItem(request, env, params) {
  try {
    const { group, itemId } = params;
    const data = await request.json();
    // CHK‑R10 PATCH validation
    if (!data || Object.keys(data).length === 0) {
      return new Response(JSON.stringify({ ok: false, error: "VALIDATION_ERROR", details: { message: "Empty update" } }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const allowed = ALLOWED_FIELDS[group] || [];
    const unknown = Object.keys(data).filter(f => !allowed.includes(f));
    if (unknown.length) {
      return new Response(JSON.stringify({ ok: false, error: "VALIDATION_ERROR", details: { unknown_fields: unknown } }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const tenantId = resolveTenantId(request);
    if (!tenantId) {
      return new Response(JSON.stringify({ ok: false, error: 'X-Tenant-ID header is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    const item = await updateItem(env, group, tenantId, itemId, data);
    return new Response(JSON.stringify({ ok: true, item }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
