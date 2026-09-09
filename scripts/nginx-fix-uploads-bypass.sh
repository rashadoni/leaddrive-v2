#!/usr/bin/env bash
#
# nginx-fix-uploads-bypass.sh
# ─────────────────────────────────────────────────────────────────────────────
# Closes the F-41 /uploads/ bypass on tenant subdomains (Task #65, memory
# `project_nginx_uploads_routing.md`).
#
# What's wrong (state as of 2026-05-14, re-verified 2026-05-22 via curl):
#   • `app.leaddrivecrm.org/uploads/test.png` → 401 (F-41 gate fires) ✓
#   • `mars.leaddrivecrm.org/uploads/test.png` → 404 from nginx alias ✗
#     `mars.leaddrivecrm.org/uploads/contracts/` → 403 ✗
#
# The wildcard `*.leaddrivecrm.org` server block in
# /etc/nginx/sites-enabled/wildcard.leaddrivecrm.org has a leftover
#
#   location /uploads/ {
#     alias /opt/leaddrive-v2/public/uploads/;
#     expires 1h;
#   }
#
# block that serves uploads directly from disk, bypassing the Next.js
# F-41 auth gate. The alias target is the PRE-F-40 path; new uploads
# land in /opt/leaddrive-v2/uploads/ so the actual exposure is the
# handful of pre-2026-04 files that still sit in
# /opt/leaddrive-v2/public/uploads/contracts/ and /mtm-photos/.
#
# This script:
#   1. Backs up the current wildcard config to /tmp/.
#   2. Removes the `location /uploads/` block from
#      /etc/nginx/sites-enabled/wildcard.leaddrivecrm.org.
#   3. Runs `nginx -t` to validate, then `systemctl reload nginx`.
#   4. Curls a tenant subdomain /uploads/ path and asserts the response
#      is now 401 (F-41 gate) instead of 404 (nginx alias).
#
# Idempotent: running twice is safe (the second run finds nothing to
# remove and exits with a "already clean" message).
#
# DRY-RUN by default. Pass `--apply` to actually mutate state.
#
# Usage on prod:
#   ssh leaddrive 'bash -s -- --apply' < scripts/nginx-fix-uploads-bypass.sh
# Or copy the script over and run:
#   sudo bash /tmp/nginx-fix-uploads-bypass.sh --apply

set -euo pipefail

CONFIG="/etc/nginx/sites-enabled/wildcard.leaddrivecrm.org"
BACKUP_DIR="/tmp/nginx-uploads-fix-$(date +%Y%m%d-%H%M%S)"
APPLY=false
VERIFY_HOST="${VERIFY_HOST:-mars.leaddrivecrm.org}"

for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=true ;;
    --host=*) VERIFY_HOST="${arg#--host=}" ;;
    --help|-h)
      sed -n '1,40p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg" >&2
      echo "Usage: $0 [--apply] [--host=<verify-tenant-host>]" >&2
      exit 1
      ;;
  esac
done

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

# ── Step 1: locate config ──────────────────────────────────────────
if [ ! -f "$CONFIG" ]; then
  log "ERROR: $CONFIG not found. Is this running on the LeadDrive server?"
  log "Hint: look in /etc/nginx/sites-available/ for the wildcard config."
  exit 2
fi

# ── Step 2: detect the bypass block ────────────────────────────────
# POSIX [[:space:]] not GNU \s — script runs on whatever the prod host
# has (BSD grep on macOS, GNU grep on Debian; both honor [[:space:]]).
if ! grep -qE '^[[:space:]]*location[[:space:]]+/uploads/[[:space:]]*\{' "$CONFIG"; then
  log 'Already clean: no "location /uploads/" block found in '"$CONFIG"
  log "Verifying via curl on $VERIFY_HOST..."
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "https://$VERIFY_HOST/uploads/nonexistent-probe-$(date +%s).png")
  if [ "$CODE" = "401" ]; then
    log "PASS: $VERIFY_HOST/uploads/* → 401 (F-41 gate firing as expected)"
    exit 0
  else
    log "WARN: $VERIFY_HOST/uploads/* returns $CODE (expected 401)"
    log 'If this is 404, nginx may still have the bypass under a different file.'
    exit 3
  fi
fi

log 'Found "location /uploads/" block in '"$CONFIG"

# ── Step 3: backup ──────────────────────────────────────────────────
if [ "$APPLY" = true ]; then
  mkdir -p "$BACKUP_DIR"
  cp "$CONFIG" "$BACKUP_DIR/wildcard.leaddrivecrm.org.conf.bak"
  log "Backup written to $BACKUP_DIR/"
fi

# ── Step 4: surgical removal of the block ─────────────────────────
# Brace-depth tracking — counts every `{` and `}` inside the block so a
# nested `if (...) { ... }` doesn't terminate `skip` at the wrong `}`.
# (Architect M1-5b.6 follow-up verified the naïve "first ^}$" approach
# breaks on real nginx conditional blocks.) Block ends when depth=0.
#
# Defensive: we ALSO confirm the block contains an `alias` directive
# before deleting — earlier comment claimed this; now actually enforced
# via a post-extract grep.
TMP_OUT="/tmp/wildcard.uploads-fix.$$"
TMP_REMOVED="/tmp/wildcard.uploads-removed.$$"
awk -v out="$TMP_REMOVED" '
  /^[[:space:]]*location[[:space:]]+\/uploads\/[[:space:]]*\{/ {
    if (!skip) {
      skip = 1
      depth = 0
    }
  }
  skip {
    # Count braces on this line. Use gsub returning the count.
    n_open = gsub(/\{/, "{")
    n_close = gsub(/\}/, "}")
    depth += n_open - n_close
    print > out
    if (depth <= 0) {
      skip = 0
    }
    next
  }
  { print }
' "$CONFIG" > "$TMP_OUT"

# Sanity: the removed chunk must mention `alias` — otherwise we may have
# clobbered a different `location /uploads/` block (e.g. a future
# proxy_pass override). Bail loudly instead of writing a config the
# user didn't sign up for.
if [ -s "$TMP_REMOVED" ] && ! grep -qE 'alias[[:space:]]+/' "$TMP_REMOVED"; then
  log 'ERROR: removed block has no `alias` directive — refusing to apply.'
  log "Inspect: $TMP_REMOVED"
  rm -f "$TMP_OUT"
  exit 7
fi

if diff -q "$CONFIG" "$TMP_OUT" > /dev/null; then
  log 'ERROR: awk produced identical output — manual inspection needed.'
  rm -f "$TMP_OUT" "$TMP_REMOVED"
  exit 4
fi

DIFF_LINES=$(diff "$CONFIG" "$TMP_OUT" | grep -c '^[<>]' || true)
log "Removed $DIFF_LINES lines from the config."

if [ "$APPLY" = false ]; then
  log 'DRY-RUN — diff that WOULD be applied:'
  diff "$CONFIG" "$TMP_OUT" || true
  log "Removed chunk preserved at $TMP_REMOVED for inspection."
  rm -f "$TMP_OUT"
  log 'Re-run with --apply to mutate state.'
  exit 0
fi

# ── Step 5: replace + validate + reload ───────────────────────────
mv "$TMP_OUT" "$CONFIG"
log "$CONFIG updated. Validating..."

NGINX_T_OUT=$(nginx -t 2>&1 || true)
if ! printf '%s\n' "$NGINX_T_OUT" | grep -q 'syntax is ok'; then
  log 'ERROR: nginx -t failed. Output:'
  printf '%s\n' "$NGINX_T_OUT"
  log 'Rolling back...'
  cp "$BACKUP_DIR/wildcard.leaddrivecrm.org.conf.bak" "$CONFIG"
  log 'Rollback restored. Post-rollback nginx -t:'
  nginx -t || true
  exit 5
fi

systemctl reload nginx
log "nginx reloaded."

# ── Step 6: verify via curl ───────────────────────────────────────
# Cache-buster query string avoids any CDN-cached 404 from the bypass era.
sleep 2
PROBE_PATH="/uploads/nonexistent-probe-$(date +%s).png"
TENANT_CODE=$(curl -s -o /dev/null -w '%{http_code}' "https://$VERIFY_HOST$PROBE_PATH")
APP_CODE=$(curl -s -o /dev/null -w '%{http_code}' "https://app.leaddrivecrm.org$PROBE_PATH")

if [ "$TENANT_CODE" = "401" ] && [ "$APP_CODE" = "401" ]; then
  log "PASS: $VERIFY_HOST/uploads/* → 401 (F-41 gate now fires uniformly)"
  log "PASS: app.leaddrivecrm.org/uploads/* → 401 (unchanged, F-41 still works)"
else
  log "WARN: tenant=$TENANT_CODE app=$APP_CODE (both expected 401)"
  log "Backup at: $BACKUP_DIR/wildcard.leaddrivecrm.org.conf.bak"
  log "Restore: cp $BACKUP_DIR/wildcard.leaddrivecrm.org.conf.bak $CONFIG && systemctl reload nginx"
  exit 6
fi

log "F-41 bypass closed on tenant subdomains."
log "Backup: $BACKUP_DIR/wildcard.leaddrivecrm.org.conf.bak"
log 'Removed-block excerpt: '"$TMP_REMOVED"
log ""
log 'Next: record any legacy upload inventory, then use the controlled runtime cutover.'
log '  - Do not copy data between checkout paths or delete it from this repair script.'
log '  - The approved release reconciles keepers into /var/lib/leaddrive-v2/uploads with collision checks.'
