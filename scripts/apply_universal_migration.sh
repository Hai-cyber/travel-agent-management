#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-local}"
DB_NAME="${DB_NAME:-travel_agent_db}"

case "$TARGET" in
  local)
    npx wrangler d1 migrations apply "$DB_NAME" --local
    ;;
  preview|remote)
    npx wrangler d1 migrations apply "$DB_NAME" --remote
    ;;
  *)
    echo "Usage: $0 [local|preview|remote]" >&2
    exit 1
    ;;
esac
