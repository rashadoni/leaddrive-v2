#!/bin/bash
# Moves production's Node.js between majors (nodesource apt packages) and back.
#
#   switch-prod-node.sh check      read-only: what is installed, what is reachable,
#                                  are the processes healthy now
#   switch-prod-node.sh apply      Node 20 -> 24; rolls itself back if the
#                                  processes do not come up healthy on 24
#   switch-prod-node.sh rollback   back to the saved Node 20 package
#
# Run as root on the production host, through switch-prod-node-remote.sh from
# the dev box (it detaches the run from the connection). Production was switched
# with it on 2026-10-28 (20.20.2 -> 24.22.2); `rollback` returns to the package
# saved then in /var/backups/leaddrive/node20-rollback.
#
# Why 24: from Node 24 AsyncLocalStorage runs on AsyncContextFrame instead of an
# async_hooks PromiseHook that runs on every promise — ~20% of the web thread's
# samples on production (perf, 2026-10-28). Node 20 has had no security fixes
# since 2026-04-30. PR checks have run on 24 since #1164.
#
# What it touches: the nodesource apt source, the nodejs package, and one
# `systemctl restart pm2-root`, which stops and starts EVERY pm2 app (web, jobs,
# softphone relay, the Zeytun line slot) on the new binary — ~20-40 s with no
# web answer and no phone line. Run it in a quiet hour. pm2 is restarted through
# systemd, not `pm2 update`: the unit is Type=forking with Restart=on-failure,
# and killing its daemon from outside would leave systemd to resurrect a second
# set of apps.
set -euo pipefail

MODE="${1:-check}"
FROM_MAJOR=20
TO_MAJOR=24
SAVE_DIR=/var/backups/leaddrive/node${FROM_MAJOR}-rollback
SOURCES=/etc/apt/sources.list.d/nodesource.sources
APP_ENV_FILE=/etc/leaddrive/app.env
LOG_FILE=/var/log/leaddrive-node-switch.log

log() { echo "[$(date -u '+%F %T') UTC] $*" | tee -a "$LOG_FILE"; }
die() { log "STOP: $*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root"
case "$MODE" in check | apply | rollback) ;; *) die "mode must be check, apply or rollback" ;; esac

node_major() { node -v | sed -E 's/^v([0-9]+)\..*/\1/'; }

# The cron secret, read as data the way cron-trigger.sh does. Never printed.
cron_secret() {
  local s
  s="$(sed -nE 's/^[[:space:]]*(export[[:space:]]+)?CRON_SECRET[[:space:]]*=[[:space:]]*(.*)$/\2/p' "$APP_ENV_FILE" | tail -1)"
  s="${s%$'\r'}"
  if [ "${#s}" -ge 2 ]; then
    local first="${s:0:1}" last="${s: -1}"
    if { [ "$first" = '"' ] && [ "$last" = '"' ]; } || { [ "$first" = "'" ] && [ "$last" = "'" ]; }; then
      s="${s:1:${#s}-2}"
    fi
  fi
  printf '%s' "$s"
}

# name status node_version port, one line per pm2 app
pm2_apps() {
  pm2 jlist 2>/dev/null | python3 -c '
import json, sys
for p in json.load(sys.stdin):
    e = p["pm2_env"]
    port = e.get("PORT") or (e.get("env") or {}).get("PORT") or "-"
    print(p["name"], e.get("status"), e.get("node_version"), port)'
}

line_port() { pm2_apps | awk '$1 ~ /^leaddrive-v2-line-/ {print $4; exit}'; }

post() { curl -s --max-time "${2:-15}" -X POST -H "x-cron-secret: $SECRET" "$1" 2>/dev/null || true; }

# Healthy = every pm2 app online on the expected major, and each server answers
# /api/v1/ping and reads the PII key from its file — the same bar the deploy sets.
health() {
  local want="$1" ok=true name status ver port code
  [ "$(node_major)" = "$want" ] || { log "node -v is $(node -v), expected v${want}"; ok=false; }
  while read -r name status ver port; do
    if [ "$status" != online ] || [ "${ver%%.*}" != "$want" ]; then
      log "pm2 $name: $status on node $ver"; ok=false
    fi
  done < <(pm2_apps)
  local ports="3001 3002 $(line_port)"
  for port in $ports; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$port/api/v1/ping" || true)"
    key="$(post "http://127.0.0.1:$port/api/cron/pii-key-check")"
    if [ "$code" = 200 ] && [ "$key" = '{"ok":true,"source":"file"}' ]; then
      log ":$port ping 200, PII key from its file"
    else
      log ":$port ping ${code:-none}, PII key ${key:-no answer}"; ok=false
    fi
  done
  $ok
}

wait_healthy() {
  local want="$1" i
  for i in $(seq 1 24); do
    if health "$want" >/dev/null 2>&1; then health "$want"; return 0; fi
    sleep 5
  done
  health "$want" || return 1
}

# The phone line keeps Zeytun's catalog in process memory; a restarted slot has
# none until it is warmed, and the web process is the line's fallback.
warm_line() {
  local port out
  for port in $(line_port) 3001; do
    out="$(post "http://127.0.0.1:$port/api/cron/zeytun-line-warm" 180)"
    if printf '%s' "$out" | grep -Eq '"outcome":"(warm|not_configured)"'; then
      log ":$port Zeytun catalog: $(printf '%s' "$out" | grep -Eo '"outcome":"[a-z_]+"')"
    else
      log "WARNING :$port Zeytun catalog did not load: ${out:-no answer}"
    fi
  done
}

set_source_major() {
  sed -i -E "s#(deb\.nodesource\.com/node_)[0-9]+\.x#\1$1.x#" "$SOURCES" &&
    grep -q "node_$1.x" "$SOURCES" &&
    apt-get update -qq
}

restart_pm2() {
  pm2 save --force >/dev/null
  log "restarting pm2 (all apps) on $(node -v)"
  systemctl restart pm2-root
}

do_rollback() {
  local deb
  deb="$(ls -1 "$SAVE_DIR"/nodejs_*.deb 2>/dev/null | tail -1)"
  [ -n "$deb" ] || die "no saved Node ${FROM_MAJOR} package in $SAVE_DIR"
  log "rolling back to $(basename "$deb")"
  cp "$SAVE_DIR/nodesource.sources" "$SOURCES"
  apt-get update -qq || true
  DEBIAN_FRONTEND=noninteractive dpkg -i "$deb" >>"$LOG_FILE" 2>&1
  [ "$(node_major)" = "$FROM_MAJOR" ] || die "node is $(node -v) after reinstalling $deb"
  restart_pm2
  if wait_healthy "$FROM_MAJOR"; then
    warm_line
    log "ROLLBACK DONE: production is on $(node -v) and healthy"
  else
    die "back on $(node -v) but the processes are not healthy — see pm2 logs"
  fi
}

SECRET="$(cron_secret)"
[ -n "$SECRET" ] || die "CRON_SECRET not found in $APP_ENV_FILE"

log "=== $MODE: node $(node -v), pm2 $(pm2 -v 2>/dev/null) ==="

case "$MODE" in
check)
  pm2_apps | while read -r l; do log "pm2 $l"; done
  log "apt: $(apt-cache policy nodejs | sed -n 2,3p | xargs)"
  curl -fsI --max-time 15 "https://deb.nodesource.com/node_${TO_MAJOR}.x/dists/nodistro/Release" >/dev/null \
    && log "nodesource node_${TO_MAJOR}.x repository reachable" || log "WARNING nodesource node_${TO_MAJOR}.x not reachable"
  ls "$SAVE_DIR"/nodejs_*.deb >/dev/null 2>&1 && log "saved rollback package: $(ls "$SAVE_DIR"/nodejs_*.deb)" \
    || log "no rollback package saved yet (apply saves it first)"
  log "free on /var: $(df -h --output=avail /var | tail -1 | xargs)"
  if health "$(node_major)"; then log "CHECK OK"; else log "CHECK: not healthy now — do not apply"; exit 1; fi
  ;;

apply)
  [ "$(node_major)" = "$FROM_MAJOR" ] || die "expected Node ${FROM_MAJOR}, found $(node -v)"
  health "$FROM_MAJOR" || die "production is not healthy before the switch — nothing changed"

  # 1. Keep the exact package we are leaving, and the files that describe it.
  install -d -m 700 "$SAVE_DIR"
  current="$(dpkg-query -W -f='${Version}' nodejs)"
  if [ ! -f "$SAVE_DIR/nodejs_${current}_amd64.deb" ]; then
    (cd "$SAVE_DIR" && apt-get download -q "nodejs=${current}" 2>&1 | tee -a "$LOG_FILE" | tail -1)
  fi
  deb="$SAVE_DIR/nodejs_${current}_amd64.deb"
  [ "$(dpkg-deb -f "$deb" Version 2>/dev/null)" = "$current" ] || die "could not save nodejs ${current} for rollback — nothing changed"
  cp "$SOURCES" "$SAVE_DIR/nodesource.sources"
  install -m 600 /root/.pm2/dump.pm2 "$SAVE_DIR/dump.pm2.before"
  log "saved $(basename "$deb") ($(du -h "$deb" | cut -f1)), apt source and pm2 dump in $SAVE_DIR"

  # 2. Install Node 24. Running processes keep the old binary until the restart.
  if ! set_source_major "$TO_MAJOR"; then
    cp "$SAVE_DIR/nodesource.sources" "$SOURCES"; apt-get update -qq || true
    die "could not switch the apt source to node_${TO_MAJOR}.x — source restored, nothing changed"
  fi
  candidate="$(apt-cache policy nodejs | awk '/Candidate:/ {print $2}')"
  case "$candidate" in
    "${TO_MAJOR}".*) log "installing nodejs $candidate" ;;
    *) cp "$SAVE_DIR/nodesource.sources" "$SOURCES"; apt-get update -qq || true
       die "apt offers nodejs ${candidate:-nothing}, not ${TO_MAJOR}.x — source restored, nothing changed" ;;
  esac
  if ! DEBIAN_FRONTEND=noninteractive apt-get install -y -q nodejs >>"$LOG_FILE" 2>&1; then
    log "apt-get install failed"; do_rollback; exit 1
  fi
  [ "$(node_major)" = "$TO_MAJOR" ] || { log "node is $(node -v) after install"; do_rollback; exit 1; }
  log "installed $(node -v); pm2 globals: $(ls /usr/lib/node_modules | xargs)"

  # 3. Restart every app on it, and require the deploy's health bar.
  restart_pm2
  if wait_healthy "$TO_MAJOR"; then
    warm_line
    log "DONE: production runs $(node -v). Rollback: same command with 'rollback'."
  else
    log "not healthy on $(node -v) after 2 minutes — rolling back"
    do_rollback
    exit 1
  fi
  ;;

rollback)
  do_rollback
  ;;
esac
