#!/bin/sh
set -eu

if [ -z "${DATABASE_URL:-}" ] && [ -n "${POSTGRES_PASSWORD_FILE:-}" ]; then
  POSTGRES_PASSWORD="$(cat "$POSTGRES_PASSWORD_FILE")"
  export DATABASE_URL="postgresql://${POSTGRES_USER:-mvp_agent}:${POSTGRES_PASSWORD}@${POSTGRES_HOST:-postgres}:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-mvp_agent}?schema=public"
fi

npm run prisma:migrate

MODE="${1:-server}"

case "$MODE" in
  bootstrap)
    npm run bootstrap
    ;;
  server)
    npm run start
    ;;
  *)
    echo "Unknown mode: $MODE" >&2
    exit 1
    ;;
esac
