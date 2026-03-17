#!/bin/sh
set -eu

load_secret() {
  var_name="$1"
  file_var_name="${var_name}_FILE"
  file_path="$(printenv "$file_var_name" 2>/dev/null || true)"
  if [ -n "$file_path" ] && [ -f "$file_path" ]; then
    export "$var_name=$(cat "$file_path")"
  fi
}

load_secret FALCON_CLIENT_ID
load_secret FALCON_CLIENT_SECRET
load_secret FALCON_BASE_URL

exec falcon-mcp "$@"
