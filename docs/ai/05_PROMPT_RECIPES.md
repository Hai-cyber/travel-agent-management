#
 In this file, add one more explicit rule under the "Rules" / "Non-negotiables" / "Rules" section:

- "Always treat 01_CURRENT_STATE.md and MIGRATION_PLAN_V1.md as runtime truth for what is actually implemented vs planned."

Do not change anything else.

# Prompt Recipes for Copilot / Cline

## 1) Small implementation task
Read:
- `00_AI_INDEX.md`
- `01_CURRENT_STATE.md`
- relevant source-of-truth docs for `[CHK-XXX]`

Task:
Implement `[CHK-XXX]` only.

Output format:
1. assumptions/TODOs
2. files to edit
3. code
4. tests
5. update note for `03_PROGRESS_LEDGER.md`

Constraints:
- Always treat 01_CURRENT_STATE.md and MIGRATION_PLAN_V1.md as runtime truth for what is actually implemented vs planned.
- do not invent fields/routes/tables
- do not refactor unrelated code
- keep answer compact

## 2) Bug fix task
Read only files relevant to the failing behavior.

Task:
Fix the bug without changing documented domain contracts.
Explain root cause in 3 bullets max.
Provide only touched files and tests.

## 3) Documentation sync task
Task:
Synchronize docs with current code reality.
Mark planned-vs-implemented explicitly.
Do not describe features as implemented unless present in code.

## 4) Cline execution prompt
You are working in a Cloudflare Workers + D1 repo.
First read:
- `00_AI_INDEX.md`
- `01_CURRENT_STATE.md`
- `02_WORKING_AGREEMENT.md`
Then make a 5-step plan for `[CHK-XXX]`.
After the plan, edit files.
At the end, output:
- files changed
- tests added/updated
- unresolved TODOs
- one-line ledger update

## 5) End-of-session prompt
Summarize this session into `04_SESSION_HANDOFF.md` using the template there.
Keep it under 180 words.
