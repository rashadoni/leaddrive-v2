#!/bin/bash
# ═══════════════════════════════════════════════════════════
# LeadDrive CRM v2 — Deploy to Client Server
# Usage: bash scripts/deploy-client.sh
#
# Required env vars (set in .env.deploy-client or pass inline):
#   CLIENT_SERVER   — IP or hostname of client VPS
#   CLIENT_APP_DIR  — app directory on server (default: /opt/leaddrive-v2)
#   CLIENT_APP_PORT — port number (default: 3001)
#   CLIENT_APP_HOST — bind host for Next.js upstream (default: 127.0.0.1)
#   CLIENT_PM2_NAME — PM2 process name (default: leaddrive-client)
#   CLIENT_DOMAIN   — client domain for final message
# ═══════════════════════════════════════════════════════════
set -e

# Load config from file if exists
if [ -f .env.deploy-client ]; then
  export $(grep -v '^#' .env.deploy-client | xargs)
fi

SERVER="${CLIENT_SERVER:?ERROR: CLIENT_SERVER not set}"
APP_DIR="${CLIENT_APP_DIR:-/opt/leaddrive-v2}"
APP_PORT="${CLIENT_APP_PORT:-3001}"
APP_HOST="${CLIENT_APP_HOST:-127.0.0.1}"
PM2_NAME="${CLIENT_PM2_NAME:-leaddrive-client}"
DOMAIN="${CLIENT_DOMAIN:-$SERVER}"
HEALTH_URL="http://$APP_HOST:$APP_PORT"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

step() { echo -e "\n${YELLOW}[$1/5]${NC} $2"; }
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }

case "$APP_HOST" in
  "0.0.0.0"|"::"|"[::]"|"*")
    fail "CLIENT_APP_HOST=$APP_HOST would expose the Next.js upstream directly"
    ;;
esac

# ─── Step 1: Pre-flight ───
step 1 "Pre-flight checks..."
if ! git diff --quiet HEAD 2>/dev/null; then
  fail "Uncommitted changes! Commit first."
fi
ok "Clean working tree"

# ─── Step 2: Push to GitHub ───
step 2 "Pushing to GitHub..."
git push origin main 2>&1 | tail -3
ok "Pushed"

# ─── Step 3: Build on server ───
step 3 "Building on client server ($SERVER)..."
ssh -o ConnectTimeout=10 root@$SERVER "
  cd $APP_DIR &&
  git pull origin main --quiet &&
  npx prisma generate 2>&1 | tail -1 &&
  npx prisma migrate deploy 2>&1 | tail -3 &&
  npx next build --webpack 2>&1 | tail -10
"
ok "Build complete"

# ─── Step 4: Restart ───
step 4 "Restarting PM2..."
ssh root@$SERVER "
  cd $APP_DIR &&
  pm2 delete $PM2_NAME 2>/dev/null; true
  pm2 start 'npx next start -H $APP_HOST -p $APP_PORT' --name $PM2_NAME --cwd $APP_DIR
  pm2 save
"
ok "PM2 restarted"

# ─── Step 5: Health check ───
step 5 "Health check..."
sleep 8
HEALTH_RESULT=$(ssh root@$SERVER "
  HTTP_CODE=\$(curl -s -o /dev/null -w '%{http_code}' $HEALTH_URL)
  echo \"HTTP:\$HTTP_CODE\"
  if [ \"\$HTTP_CODE\" = '307' ] || [ \"\$HTTP_CODE\" = '200' ]; then
    echo 'DEPLOY_OK'
  else
    echo 'DEPLOY_FAILED'
  fi
")

echo "  $HEALTH_RESULT"

if echo "$HEALTH_RESULT" | grep -q "DEPLOY_OK"; then
  ok "Deploy verified!"
elif echo "$HEALTH_RESULT" | grep -q "DEPLOY_FAILED"; then
  fail "App not responding! Check: ssh root@$SERVER 'pm2 logs $PM2_NAME --lines 30'"
else
  echo -e "  ${YELLOW}⚠${NC} Could not fully verify — check manually"
fi

echo ""
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}  Deployed! https://$DOMAIN${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
