#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8787}"
TENANT_ID="${TENANT_ID:-demo-tenant}"
TOUR_ID="${TOUR_ID:-}"
BOOTSTRAP_DESCRIPTION="${BOOTSTRAP_DESCRIPTION:-Toi lam tour leo nui o Ha Giang}"

echo "== Apply migration 0029 locally =="
echo "npx wrangler d1 migrations apply travel_agent_db --local"

echo
echo "== Apply migration 0029 to preview/remote =="
echo "npx wrangler d1 migrations apply travel_agent_db --remote"

echo
echo "== GET /api/universal/site/config =="
curl -sS \
  -H "X-Tenant-ID: ${TENANT_ID}" \
  "${BASE_URL}/api/universal/site/config"

echo
echo
echo "== POST /api/universal/site/bootstrap (AI onboarding mock) =="
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: ${TENANT_ID}" \
  "${BASE_URL}/api/universal/site/bootstrap" \
  --data @- <<JSON
{
  "description": "${BOOTSTRAP_DESCRIPTION}",
  "site_name": "Bootstrap Demo Site"
}
JSON

echo
echo
echo "== POST /api/universal/site/bootstrap (persist mode) =="
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: ${TENANT_ID}" \
  "${BASE_URL}/api/universal/site/bootstrap" \
  --data @- <<JSON
{
  "description": "${BOOTSTRAP_DESCRIPTION}",
  "site_name": "Bootstrap Persisted Site",
  "persist": true
}
JSON

echo
echo
echo "== PATCH /api/universal/site/config (site_name + primary color) =="
curl -sS -X PATCH \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: ${TENANT_ID}" \
  "${BASE_URL}/api/universal/site/config" \
  --data @- <<'JSON'
{
  "site": {
    "site_name": "Universal Demo Site"
  },
  "theme": {
    "mode": "light",
    "group_key": "tour_operator",
    "variant_key": "tour-adventure",
    "colorPrimary": "#14532d",
    "colorSecondary": "#f59e0b",
    "colorAccent": "#f59e0b",
    "colorSurface": "#f8fafc",
    "colorText": "#0f172a",
    "fontHeading": "Space Grotesk, sans-serif",
    "fontBody": "Inter, system-ui, sans-serif",
    "radius": "18px",
    "logoUrl": ""
  }
}
JSON

echo
echo
echo "== PATCH /api/universal/site/config (switch to luxury variant) =="
curl -sS -X PATCH \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: ${TENANT_ID}" \
  "${BASE_URL}/api/universal/site/config" \
  --data '{"site":{"variant_key":"tour-luxury"}}'

echo
echo
echo "== GET /api/universal/site/config after variant switch =="
curl -sS \
  -H "X-Tenant-ID: ${TENANT_ID}" \
  "${BASE_URL}/api/universal/site/config"

echo
echo
echo "== GET /p/${TENANT_ID}/home after luxury switch =="
curl -sS "${BASE_URL}/p/${TENANT_ID}/home" | head -n 30

echo
echo
echo "== PATCH /api/universal/site/config (switch back to adventure variant) =="
curl -sS -X PATCH \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: ${TENANT_ID}" \
  "${BASE_URL}/api/universal/site/config" \
  --data '{"site":{"variant_key":"tour-adventure"}}'

echo
echo
echo "== GET /p/${TENANT_ID}/home after adventure switch =="
curl -sS "${BASE_URL}/p/${TENANT_ID}/home" | head -n 30

if [[ -n "${TOUR_ID}" ]]; then
  echo
  echo
  echo "== POST /api/universal/tours/${TOUR_ID}/page/sync =="
  curl -sS -X POST \
    -H "X-Tenant-ID: ${TENANT_ID}" \
    "${BASE_URL}/api/universal/tours/${TOUR_ID}/page/sync"

  echo
  echo
  echo "== GET /api/universal/render/${TENANT_ID}?tourId=${TOUR_ID} =="
  curl -sS \
    -H "X-Tenant-ID: ${TENANT_ID}" \
    "${BASE_URL}/api/universal/render/${TENANT_ID}?tourId=${TOUR_ID}" | head -n 40

  echo
  echo
  echo "== GET /p/${TENANT_ID}/<slug> =="
  TOUR_SLUG="$(curl -sS -H "X-Tenant-ID: ${TENANT_ID}" "${BASE_URL}/api/universal/tours/${TOUR_ID}/page" | sed -n 's/.*"slug":"\([^"]*\)".*/\1/p' | head -n 1)"
  if [[ -n "${TOUR_SLUG}" ]]; then
    curl -sS "${BASE_URL}/p/${TENANT_ID}/${TOUR_SLUG}" | head -n 40
  else
    echo "Could not resolve universal slug for tour ${TOUR_ID}"
  fi
fi