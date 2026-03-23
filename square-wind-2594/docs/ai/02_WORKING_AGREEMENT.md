# Working Agreement for Copilot / Cline

Use this as the first instruction block for AI coding sessions.

## Mission
Help implement the tour booking management MVP incrementally, without fabricating domain details, and without wasting tokens on unrelated repo context.

## Non-negotiables
- Source of truth is limited to:
  - `/docs/PROJECT_BRIEF.md`
  - `/docs/ARCHITECTURE.md`
  - `/docs/DOMAIN_MODEL.md`
  - `/docs/API_SPEC.md`
- Keep names consistent with existing docs.
- Do not silently rename tables, routes, bindings, entities, or statuses.
- If a needed detail is missing, write `TODO([CHK-XXX]: reason)`.
- Never claim a feature exists unless it is present in code or clearly marked planned.

## Response format
For implementation tasks, respond in this order:
1. checkpoint being addressed
2. assumptions / TODOs
3. files to edit
4. code changes
5. tests
6. short follow-up note for ledger update

## Scope control
- Work on one checkpoint at a time.
- Prefer smallest shippable slice.
- Avoid broad refactors unless explicitly requested.
- Avoid rewriting docs not needed for the current checkpoint.

## Repo-specific constraints
- Runtime is Cloudflare Workers module worker.
- Current app entry is `src/index.js`.
- Database binding is `DB`.
- KV binding is `TOUR_PRESETS`.
- Existing tests use Vitest + Cloudflare worker pool.

## Token control rules
- Read `00_AI_INDEX.md` and `01_CURRENT_STATE.md` first.
- Then read only the doc(s) and file(s) relevant to the requested checkpoint.
- Do not re-summarize the entire project in every answer.
- Keep generated explanations under 300 words unless asked for more.
- Produce diffs or full file content only for touched files.

## When using Cline
- Ask Cline to create a short plan first.
- Then execute file edits in batches grouped by checkpoint.
- After edits, require a “files changed + risks + tests” summary.
