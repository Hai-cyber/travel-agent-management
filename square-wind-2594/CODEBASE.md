# Codebase Map

High-level structure and module responsibilities.


# Codebase

## Stack
- Cloudflare Workers (module), Hono router (optional)
- D1 (SQL) cho domain data; KV cho preset & snippets
- Cron/Queues cho nhắc việc & gửi thông báo nền

## Cấu trúc (đề xuất)
- `/src/index.ts` – entry Worker
- `/src/routes/*` – API routes theo tài liệu `API_SPEC.md`
- `/src/db/*` – D1 bindings, migrations
- `/src/services/*` – composer itinerary, task scheduler
- `/src/lib/*` – utils (time, validation, email)
- `/db/migrations/*` – file SQL
- `/db/seeds.sql` – seed demo (tham chiếu `SEED_DATA.md`)

## Wrangler
- `wrangler.jsonc` – bindings:
  - `DB` (D1), `KV_PRESETS` (KV), `REMINDERS` (Queues)
  - `triggers.crons`: `*/15 * * * *`

## Secrets (đặt qua CLI)
- `TURNSTILE_SECRET`, `MAIL_API_KEY` (nếu có), v.v.

## Quy ước
- TypeScript, module Worker
- Tên bảng/field bám `DATA_MODEL.sql`
- Logging ngắn gọn, không lộ secrets