#!/bin/sh
set -eu

if [ -z "${DATABASE_URL:-}" ] && [ -n "${POSTGRES_PASSWORD_FILE:-}" ]; then
  POSTGRES_PASSWORD="$(cat "$POSTGRES_PASSWORD_FILE")"
  export DATABASE_URL="postgresql://${POSTGRES_USER:-mvp_agent}:${POSTGRES_PASSWORD}@${POSTGRES_HOST:-postgres}:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-mvp_agent}?schema=public"
fi

npm run prisma:migrate

MODE="${1:-server}"

sync_agno_catalog() {
  if [ "${AGNO_ENABLED:-true}" != "true" ]; then
    echo "Agno catalog sync skipped because AGNO_ENABLED is not true."
    return 0
  fi

  echo "Running Agno catalog sync before server start..."
  if npm run sync:agno-catalog; then
    echo "Agno catalog sync completed."
    return 0
  fi

  echo "Warning: Agno catalog sync failed. Continuing server startup with existing portal data." >&2
  return 0
}

case "$MODE" in
  bootstrap)
    npm run bootstrap
    ;;
  server)
    sync_agno_catalog
    npm run start
    ;;
  *)
    echo "Unknown mode: $MODE" >&2
    exit 1
    ;;
esac
