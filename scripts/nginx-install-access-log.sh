#!/usr/bin/env bash
#
# nginx-install-access-log.sh — write the response time and the answering
# process into /var/log/nginx/access.log (2026-11-09: the stalls of
# 2026-11-08/09 had to be found with separate probes, because the log said
# nothing about time).
#
# Installs ops/nginx/leaddrive-log-format.conf into /etc/nginx/conf.d/ (the
# `leaddrive_timed` format: nginx's combined line plus rt=, urt=, ua=, us= at
# the end) and ops/nginx/leaddrive-access-log.conf into /etc/nginx/snippets/,
# includes the snippet in EVERY server block of EVERY site in sites-enabled —
# right after the block's error-pages include, which each block has — runs
# `nginx -t` and reloads (never restarts). Any failure puts every file back as
# it was and reloads nothing.
#
# Every site, not only app.leaddrivecrm.org: all of them proxy to the same app
# process (:3001) and write the same access.log — tenant subdomains through
# wildcard.leaddrivecrm.org, custom domains through the catch-all — so one site
# alone would leave the log half timed, and a slow tenant page invisible.
#
# The deploy does not touch these files or the sites' includes (it only rewrites
# the upstream port lines, Step 7c), so this survives every deploy. Run on
# production as root from a checkout of the same commit, keeping the scripts/
# and ops/nginx/ layout:
#   bash <dir>/scripts/nginx-install-access-log.sh            # dry run
#   bash <dir>/scripts/nginx-install-access-log.sh --apply
# Idempotent. --remove takes the includes out again; the log goes back to the
# http-level combined format (the two files stay, unused).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITES_DIR="${NGINX_SITES_DIR:-/etc/nginx/sites-enabled}"
FORMAT_SRC="$ROOT/ops/nginx/leaddrive-log-format.conf"
SNIPPET_SRC="$ROOT/ops/nginx/leaddrive-access-log.conf"
FORMAT_DST="${NGINX_CONF_D:-/etc/nginx/conf.d}/leaddrive-log-format.conf"
SNIPPET_DST="${NGINX_SNIPPETS:-/etc/nginx/snippets}/leaddrive-access-log.conf"
INCLUDE_LINE="    include snippets/leaddrive-access-log.conf;"
# Every server block opens with this include (src/__tests__/nginx-server-tokens.test.ts).
ANCHOR="    include snippets/leaddrive-error-pages.conf;"
NGINX="${NGINX_BIN:-nginx}"
SYSTEMCTL="${SYSTEMCTL_BIN:-systemctl}"

MODE="dry-run"
case "${1:-}" in
  --apply) MODE="apply" ;;
  --remove) MODE="remove" ;;
  ""|--dry-run) ;;
  *) echo "usage: $0 [--apply|--remove]" >&2; exit 2 ;;
esac

log() { echo "[access-log] $*"; }

[ -d "$SITES_DIR" ] || { log "FATAL: $SITES_DIR not found"; exit 1; }
for f in "$FORMAT_SRC" "$SNIPPET_SRC"; do
  [ -f "$f" ] || { log "FATAL: ops/nginx files missing under $ROOT"; exit 1; }
done

SITES=()
for f in "$SITES_DIR"/*; do [ -f "$f" ] && SITES+=("$f"); done
[ "${#SITES[@]}" -gt 0 ] || { log "FATAL: no site under $SITES_DIR"; exit 1; }

# One include per server block, each right after that block's anchor. Exit 3:
# a site with no server block, or a block without the anchor — an include
# placed elsewhere would leave that block on the old format unnoticed.
with_include() {
  awk -v anchor="$ANCHOR" -v line="$INCLUDE_LINE" '
    $0 == line { next }
    /^server[[:space:]]*\{/ { blocks++ }
    { print }
    $0 == anchor { print line; anchored++ }
    END { if (blocks == 0 || anchored != blocks) exit 3 }
  ' "$1"
}

without_include() { grep -vxF -e "$INCLUDE_LINE" "$1" || true; }

included() {
  local wanted
  wanted="$(with_include "$1" 2>/dev/null)" || return 1
  [ "$wanted" = "$(cat "$1")" ]
}

# Refuse before touching anything when any site cannot take the include.
if [ "$MODE" != "remove" ]; then
  for site in "${SITES[@]}"; do
    with_include "$site" >/dev/null || { log "FATAL: a server block in $site has no anchor ($ANCHOR); nothing changed"; exit 1; }
  done
fi

if [ "$MODE" = "dry-run" ]; then
  for site in "${SITES[@]}"; do
    log "$site: include in every server block: $(included "$site" && echo yes || echo no)"
    included "$site" || with_include "$site" | diff "$site" - || true
  done
  log "would install $FORMAT_DST and $SNIPPET_DST, include the snippet, nginx -t, reload"
  exit 0
fi

BACKUP="$(mktemp -d "${BACKUP_PARENT:-/tmp}/nginx-access-log.XXXXXX")"
for i in "${!SITES[@]}"; do cp -p "${SITES[$i]}" "$BACKUP/site.$i"; done
[ -f "$FORMAT_DST" ] && cp -p "$FORMAT_DST" "$BACKUP/format"
[ -f "$SNIPPET_DST" ] && cp -p "$SNIPPET_DST" "$BACKUP/snippet"

# `cat >` and not `cp`/`mv`: a site may be a symlink into sites-available, and
# the link must stay a link.
restore() {
  log "restoring the previous configuration from $BACKUP"
  for i in "${!SITES[@]}"; do cat "$BACKUP/site.$i" > "${SITES[$i]}"; done
  if [ -f "$BACKUP/format" ]; then cp -p "$BACKUP/format" "$FORMAT_DST"; else rm -f "$FORMAT_DST"; fi
  if [ -f "$BACKUP/snippet" ]; then cp -p "$BACKUP/snippet" "$SNIPPET_DST"; else rm -f "$SNIPPET_DST"; fi
}

if [ "$MODE" = "remove" ]; then
  for site in "${SITES[@]}"; do
    without_include "$site" > "$BACKUP/new"
    cat "$BACKUP/new" > "$site"
  done
else
  install -m 0644 "$FORMAT_SRC" "$FORMAT_DST"
  install -m 0644 "$SNIPPET_SRC" "$SNIPPET_DST"
  for site in "${SITES[@]}"; do
    if ! with_include "$site" > "$BACKUP/new"; then
      restore
      log "FATAL: a server block in $site has no anchor ($ANCHOR)"
      exit 1
    fi
    cat "$BACKUP/new" > "$site"
  done
fi
rm -f "$BACKUP/new"

if ! "$NGINX" -t 2>"$BACKUP/nginx-t.log"; then
  cat "$BACKUP/nginx-t.log" >&2
  restore
  "$NGINX" -t >/dev/null 2>&1 || log "WARNING: nginx -t fails even on the restored files"
  log "FATAL: nginx -t refused the change; nothing reloaded"
  exit 1
fi
"$SYSTEMCTL" reload nginx
log "$MODE done (${#SITES[@]} sites); backup in $BACKUP"
