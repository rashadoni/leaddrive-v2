#!/usr/bin/env bash
set -Eeuo pipefail
BASE_URL="${NEXTAUTH_URL}"
BASE_URL="${BASE_URL%/}"
# Cache-busting query so a CDN can't serve pre-deploy cached HTML.
PAGE_URL="$BASE_URL/login?smoke=${DEPLOY_TARGET_SHA:0:12}"
CODE="000"
for i in 1 2 3; do
  CODE=$(curl -s -o /tmp/login.html -w '%{http_code}' --max-time 15 "$PAGE_URL" || echo "000")
  echo "attempt $i/3: /login -> $CODE"
  [ "$CODE" = "200" ] && break
  [ "$i" -lt 3 ] && sleep 10
done
[ "$CODE" = "200" ] || { echo "::error::/login returned $CODE"; exit 1; }

CSS_PATH=$(grep -o '/_next/static/[^"]*\.css' /tmp/login.html | head -1)
JS_PATH=$(grep -o '/_next/static/[^"]*\.js' /tmp/login.html | head -1)
[ -n "$CSS_PATH" ] || { echo "::error::no CSS asset URL found in login HTML"; exit 1; }
[ -n "$JS_PATH" ] || { echo "::error::no JS asset URL found in login HTML"; exit 1; }

for ASSET in "$CSS_PATH" "$JS_PATH"; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$BASE_URL$ASSET" || echo "000")
  echo "asset $ASSET -> $CODE"
  if [ "$CODE" != "200" ]; then
    echo "::error::asset $ASSET returned $CODE — page HTML references assets the origin does not serve"
    exit 1
  fi
done
echo "Feature smoke passed: page 200, CSS + JS assets 200"
