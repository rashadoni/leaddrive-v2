#!/usr/bin/env bash
set -Eeuo pipefail
ssh -o ConnectTimeout=30 -o ServerAliveInterval=15 -i ~/.ssh/deploy_key \
  ${SERVER_USER}@${SERVER_HOST} \
  "bash -s -- '${DEPLOY_TARGET_SHA}' '${DEPLOYMENT_MODE}'" <<'REMOTE'
set -euo pipefail
DEPLOY_SHA="$1"
DEPLOY_MODE="$2"
case "$DEPLOY_MODE" in
  normal|recovery-bootstrap|recovery-bootstrap-resume) ;;
  *) echo "FATAL: unsupported deployment mode" >&2; exit 1 ;;
esac
CANDIDATE="/tmp/leaddrive-deploy-${DEPLOY_SHA}.tar.gz"
[ -s "$CANDIDATE" ] || {
  echo "FATAL: exact SHA-named staged artifact is missing for $DEPLOY_SHA" >&2
  exit 1
}
test "$(tar -xOzf "$CANDIDATE" ./.deploy-sha | tr -d '\r\n')" = "$DEPLOY_SHA"
mv "$CANDIDATE" /tmp/leaddrive-deploy.tar.gz
bash "/tmp/server-deploy-${DEPLOY_SHA}.sh" "$DEPLOY_MODE" "$DEPLOY_SHA"
REMOTE
