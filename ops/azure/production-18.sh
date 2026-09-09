#!/usr/bin/env bash
set -Eeuo pipefail
ssh -o ConnectTimeout=30 -o ServerAliveInterval=15 -i ~/.ssh/deploy_key \
  ${SERVER_USER}@${SERVER_HOST} \
  'set -euo pipefail
   cd /opt/leaddrive-v2/.next/standalone
   APP_ENV_FILE="${APP_ENV_FILE:-/etc/leaddrive/app.env}"
   DATABASE_URL="$(sed -nE "s/^[[:space:]]*DATABASE_URL[[:space:]]*=[[:space:]]*(.*)$/\1/p" "$APP_ENV_FILE" | tail -1)"
   DATABASE_URL="${DATABASE_URL%\"}"; DATABASE_URL="${DATABASE_URL#\"}"
   [ -n "$DATABASE_URL" ] || { echo "FATAL: DATABASE_URL not found in canonical app environment"; exit 1; }
   export DATABASE_URL
   node scripts/rls/verify-coverage.mjs'
