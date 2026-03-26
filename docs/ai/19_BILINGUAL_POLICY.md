# > These conventions apply to all new code and documentation in the rescue rebuild.

#
> NOTE: These conventions apply to all new code and documentation in the rescue rebuild.
#
Add one sentence near the top stating that these conventions apply to all new code and documentation in the rescue rebuild.

Do not change anything else.


# 📄 19_BILINGUAL_POLICY.md

```md id="q3m9xr"
# MULTILINGUAL POLICY

## Purpose

Support:
- Vietnamese users (primary market)
- English developers (codebase standard)
- multilingual public websites per tenant and per tour

---

## Where Vietnamese is used

- UI (primary language)
- Comments in code
- Internal documentation
- Business logic explanation

---

## Where English is used

- Source code
- API
- Database schema
- System architecture naming

---

## UI Strategy

- Admin UI default language: Vietnamese
- Developer-facing code and API remain English
- Public websites must support multiple languages per tenant/tour
- Language variants should be modeled as localized content, not duplicated tours
- Default public language is tenant-configurable

---

## Rule

DO NOT mix languages in the same layer:

- Code → English
- API / schema → English
- Admin UI copy → Vietnamese-first
- Public-site copy → localized by language variant

## Product implication

- Tour website builder and publish flow must assume more than one public language
- Itinerary, pricing copy, visual copy, and legal/contact pages should be localizable
- Translation support affects CHK-303 and CHK-404, and should not be treated as optional polish

---

## Example

```ts
// Tạo task từ service item khi booking được xác nhận
function createTasksFromServices(...) {