#!/usr/bin/env bash
#
# nginx-install-station-routes.sh — send the PBX's requests to the phone line's
# own process (pm2 leaddrive-v2-line, :3003) with the web app (:3001) as backup.
# Owner, 2026-10-28: «отдельная программа для линии».
#
# Installs ops/nginx/leaddrive-station-upstream.conf into /etc/nginx/conf.d/ and
# ops/nginx/leaddrive-station-routes.conf into /etc/nginx/snippets/, includes the
# snippet in the app.leaddrivecrm.org TLS server block, runs `nginx -t`, reloads.
# Any failure puts every file back as it was and reloads nothing.
#
# Since 2026-10-29 also the web's own upstream (leaddrive-web-upstream.conf:
# the line's live slot answers people while a deploy restarts the web) with
# `location /` sent to it, and leaddrive-web-routes.conf keeping the shell's
# event stream on the web process alone.
#
# Run on production as root, after a deploy that started the line process (the
# deploy's SUMMARY line says line=ok). The release bundle does not carry ops/,
# so copy this script and the two ops/nginx/leaddrive-station-*.conf files from
# a checkout of the same commit, keeping the scripts/ and ops/nginx/ layout:
#   bash <dir>/scripts/nginx-install-station-routes.sh            # dry run
#   bash <dir>/scripts/nginx-install-station-routes.sh --apply
# Idempotent. --remove takes the include out again (the files stay, unused).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE="${NGINX_SITE:-/etc/nginx/sites-enabled/app.leaddrivecrm.org}"
UPSTREAM_SRC="$ROOT/ops/nginx/leaddrive-station-upstream.conf"
ROUTES_SRC="$ROOT/ops/nginx/leaddrive-station-routes.conf"
UPSTREAM_DST="${NGINX_CONF_D:-/etc/nginx/conf.d}/leaddrive-station-upstream.conf"
ROUTES_DST="${NGINX_SNIPPETS:-/etc/nginx/snippets}/leaddrive-station-routes.conf"
WEB_UPSTREAM_SRC="$ROOT/ops/nginx/leaddrive-web-upstream.conf"
WEB_ROUTES_SRC="$ROOT/ops/nginx/leaddrive-web-routes.conf"
WEB_UPSTREAM_DST="${NGINX_CONF_D:-/etc/nginx/conf.d}/leaddrive-web-upstream.conf"
WEB_ROUTES_DST="${NGINX_SNIPPETS:-/etc/nginx/snippets}/leaddrive-web-routes.conf"
INCLUDE_LINE="    include snippets/leaddrive-station-routes.conf;"
WEB_INCLUDE_LINE="    include snippets/leaddrive-web-routes.conf;"
# The site's one proxy to the web process, as certbot left it.
WEB_PROXY_DIRECT="  location / { proxy_pass http://127.0.0.1:3001; proxy_http_version 1.1;"
WEB_PROXY_UPSTREAM="  location / { proxy_pass http://leaddrive_web; proxy_http_version 1.1;"
# The TLS server block is the one with this include right after its error pages.
ANCHOR="    include snippets/leaddrive-deny-cron.conf;"
NGINX="${NGINX_BIN:-nginx}"

MODE="dry-run"
case "${1:-}" in
  --apply) MODE="apply" ;;
  --remove) MODE="remove" ;;
  ""|--dry-run) ;;
  *) echo "usage: $0 [--apply|--remove]" >&2; exit 2 ;;
esac

log() { echo "[station-routes] $*"; }

[ -f "$SITE" ] || { log "FATAL: $SITE not found"; exit 1; }
for f in "$UPSTREAM_SRC" "$ROUTES_SRC" "$WEB_UPSTREAM_SRC" "$WEB_ROUTES_SRC"; do
  [ -f "$f" ] || { log "FATAL: ops/nginx files missing under $ROOT"; exit 1; }
done

included() { grep -qxF "$INCLUDE_LINE" "$SITE" && grep -qxF "$WEB_INCLUDE_LINE" "$SITE" && grep -qxF "$WEB_PROXY_UPSTREAM" "$SITE"; }

# The includes go after the FIRST anchor only: the first server block is the
# TLS one (the second, port 80, only redirects or returns 404). Exit 3: no
# anchor; exit 4: the web proxy line is neither the direct nor the upstream one.
with_include() {
  awk -v anchor="$ANCHOR" -v line="$INCLUDE_LINE" -v web="$WEB_INCLUDE_LINE" \
      -v direct="$WEB_PROXY_DIRECT" -v upstream="$WEB_PROXY_UPSTREAM" '
    $0 == line || $0 == web { next }
    $0 == direct { print upstream; proxied = 1; next }
    $0 == upstream { proxied = 1 }
    { print }
    !done && $0 == anchor { print line; print web; done = 1 }
    END { if (!done) exit 3; if (!proxied) exit 4 }
  ' "$SITE"
}

without_include() {
  grep -vxF -e "$INCLUDE_LINE" -e "$WEB_INCLUDE_LINE" "$SITE" | awk -v direct="$WEB_PROXY_DIRECT" -v upstream="$WEB_PROXY_UPSTREAM" \
    '$0 == upstream { print direct; next } { print }'
}

if [ "$MODE" = "dry-run" ]; then
  log "site: $SITE (include present: $(included && echo yes || echo no))"
  log "would install $UPSTREAM_DST, $ROUTES_DST, $WEB_UPSTREAM_DST and $WEB_ROUTES_DST, include the snippets, send location / to leaddrive_web, nginx -t, reload"
  if ! included; then with_include | diff "$SITE" - || true; fi
  exit 0
fi

BACKUP="$(mktemp -d /tmp/nginx-station-routes.XXXXXX)"
cp -p "$SITE" "$BACKUP/site"
[ -f "$UPSTREAM_DST" ] && cp -p "$UPSTREAM_DST" "$BACKUP/upstream"
[ -f "$ROUTES_DST" ] && cp -p "$ROUTES_DST" "$BACKUP/routes"
[ -f "$WEB_UPSTREAM_DST" ] && cp -p "$WEB_UPSTREAM_DST" "$BACKUP/web-upstream"
[ -f "$WEB_ROUTES_DST" ] && cp -p "$WEB_ROUTES_DST" "$BACKUP/web-routes"

restore() {
  log "restoring the previous configuration from $BACKUP"
  cp -p "$BACKUP/site" "$SITE"
  if [ -f "$BACKUP/upstream" ]; then cp -p "$BACKUP/upstream" "$UPSTREAM_DST"; else rm -f "$UPSTREAM_DST"; fi
  if [ -f "$BACKUP/routes" ]; then cp -p "$BACKUP/routes" "$ROUTES_DST"; else rm -f "$ROUTES_DST"; fi
  if [ -f "$BACKUP/web-upstream" ]; then cp -p "$BACKUP/web-upstream" "$WEB_UPSTREAM_DST"; else rm -f "$WEB_UPSTREAM_DST"; fi
  if [ -f "$BACKUP/web-routes" ]; then cp -p "$BACKUP/web-routes" "$WEB_ROUTES_DST"; else rm -f "$WEB_ROUTES_DST"; fi
}

if [ "$MODE" = "remove" ]; then
  without_include > "$BACKUP/site.new"
  cat "$BACKUP/site.new" > "$SITE"
else
  install -m 0644 "$UPSTREAM_SRC" "$UPSTREAM_DST"
  # The deploy moves the primary between the line's slots and records which
  # one answers; a reinstall must not point nginx back at the other.
  active_port="$(head -c 16 "${LINE_ACTIVE_PORT_FILE:-/var/lib/leaddrive-v2/line-active-port}" 2>/dev/null | tr -d '[:space:]' || true)"
  case "$active_port" in
    300[3-9]) sed -i -E "s|^    server 127\.0\.0\.1:[0-9]+ max_fails=1 fail_timeout=5s;$|    server 127.0.0.1:${active_port} max_fails=1 fail_timeout=5s;|" "$UPSTREAM_DST" ;;
  esac
  install -m 0644 "$ROUTES_SRC" "$ROUTES_DST"
  install -m 0644 "$WEB_UPSTREAM_SRC" "$WEB_UPSTREAM_DST"
  case "$active_port" in
    300[3-9]) sed -i -E "s|^    server 127\.0\.0\.1:[0-9]+ backup; # line slot$|    server 127.0.0.1:${active_port} backup; # line slot|" "$WEB_UPSTREAM_DST" ;;
  esac
  install -m 0644 "$WEB_ROUTES_SRC" "$WEB_ROUTES_DST"
  if ! included; then
    if ! with_include > "$BACKUP/site.new"; then
      restore
      log "FATAL: $SITE has no anchor ($ANCHOR) or no known web proxy line"
      exit 1
    fi
    cat "$BACKUP/site.new" > "$SITE"
  fi
fi

if ! "$NGINX" -t 2>"$BACKUP/nginx-t.log"; then
  cat "$BACKUP/nginx-t.log" >&2
  restore
  "$NGINX" -t >/dev/null 2>&1 || log "WARNING: nginx -t fails even on the restored files"
  log "FATAL: nginx -t refused the change; nothing reloaded"
  exit 1
fi
systemctl reload nginx
log "$MODE done; backup in $BACKUP"
