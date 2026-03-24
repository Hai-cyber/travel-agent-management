export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response(
        `<!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Travel Agent Management</title>
          </head>
          <body>
  <h1>Travel Agent Management</h1>
  <p id="status">Loading...</p>

  <script>
    fetch('/api/site/config')
      .then(res => res.json())
      .then(data => {
        document.getElementById('status').innerText =
          'API OK: ' + data.name + ' (' + data.version + ')';
      })
      .catch(err => {
        document.getElementById('status').innerText =
          'API ERROR';
      });
  </script>
</body>
        </html>`,
        {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        }
      );
    }

    if (url.pathname === "/api/site/config") {
  return new Response(
    JSON.stringify({
      name: "Travel Agent Management",
      version: "rescue-1",
      status: "ok"
    }),
    {
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}
    if (url.pathname === "/message") {
      return new Response("Hello, World!");
    }

    if (url.pathname === "/random") {
      return new Response(crypto.randomUUID());
    }

    if (url.pathname === "/api/db-check") {
  const result = await env.DB.prepare("SELECT 1 as ok").first();

  return new Response(JSON.stringify(result), {
    headers: {
      "Content-Type": "application/json",
    },
  });
}

    if (url.pathname === "/api/tables") {
  const rows = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all();

  return new Response(JSON.stringify(rows.results), {
    headers: {
      "Content-Type": "application/json",
    },
  });
}

    if (url.pathname === "/api/destinations-preview") {
  const { results } = await env.DB.prepare(`
    SELECT id, code, name, is_active, created_at
    FROM destinations
    ORDER BY id DESC
  `).all();

  return Response.json(results);
}

    if (url.pathname === "/api/destination-texts-preview") {
  const { results } = await env.DB.prepare(`
    SELECT
      dt.id,
      dt.destination_id,
      d.name AS destination_name,
      dt.lang_code,
      dt.title,
      dt.summary,
      dt.content,
      dt.created_at
    FROM destination_texts dt
    JOIN destinations d ON dt.destination_id = d.id
    ORDER BY dt.id ASC
  `).all();

  return Response.json(results);
}

if (url.pathname === "/api/tour-destinations-preview") {
  const { results } = await env.DB.prepare(`
    SELECT
      td.id,
      td.tour_id,
      t.name AS tour_name,
      td.destination_id,
      d.name AS destination_name,
      td.sort_order,
      td.created_at
    FROM tour_destinations td
    JOIN tours t ON td.tour_id = t.id
    JOIN destinations d ON td.destination_id = d.id
    ORDER BY td.sort_order ASC, td.id ASC
  `).all();

  return Response.json(results);
}

    if (url.pathname === "/api/tours-preview") {
  const rows = await env.DB.prepare("SELECT * FROM tours LIMIT 5").all();

  return new Response(JSON.stringify(rows.results, null, 2), {
    headers: {
      "Content-Type": "application/json",
    },
  });
}

    if (url.pathname === "/api/tours-with-destinations") {
  // 1. lấy tất cả tours
  const { results: tours } = await env.DB.prepare(`
    SELECT id, name
    FROM tours
    ORDER BY id ASC
  `).all();

  // 2. lấy tất cả relations
  const { results: relations } = await env.DB.prepare(`
    SELECT
      td.tour_id,
      d.id AS destination_id,
      d.name AS destination_name
    FROM tour_destinations td
    JOIN destinations d ON td.destination_id = d.id
    ORDER BY td.sort_order ASC
  `).all();

  // 3. gộp dữ liệu
  const result = tours.map(tour => {
    const destinations = relations
      .filter(r => r.tour_id === tour.id)
      .map(r => ({
        id: r.destination_id,
        name: r.destination_name
      }));

    return {
      ...tour,
      destinations
    };
  });

  return Response.json(result);
}

    return new Response("Not Found", { status: 404 });
  },
};