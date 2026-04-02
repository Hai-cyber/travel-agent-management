import { updateTask } from "../services/tasks.js";

// Task Routes for CHK-R11
export default function registerTaskRoutes(app) {
  if (!app || typeof app.patch !== 'function') return;

  app.patch('/api/tasks/:taskId', async (c) => {
    return handleUpdateTask(c.req.raw, c.env, { taskId: c.req.param('taskId') });
  });
}

export async function handleUpdateTask(request, env, params) {
  // [SEC] Tenant isolation: bắt buộc X-Tenant-ID header
  const tenantId = request.headers.get('X-Tenant-ID')?.trim();
  if (!tenantId) {
    return new Response(
      JSON.stringify({ ok: false, error: 'X-Tenant-ID header is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
  try {
    const { taskId } = params;
    const data = await request.json();
    if (!data || typeof data.status === 'undefined') {
      return new Response(
        JSON.stringify({ ok: false, error: 'VALIDATION_ERROR', details: { message: 'Missing status' } }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const task = await updateTask(taskId, tenantId, data, env);
    return new Response(JSON.stringify({ ok: true, task }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
