#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Enable RLS on the remaining core tenant tables in ONE run, safely — each table
# is enabled via enable-one.sh (role preflight + idempotent policy), then the
# server logs are checked for a table-specific [RLS-GUARD] hit; if one appears
# (an un-wrapped app path now fail-closing) the table is auto-rolled-back and the
# run STOPS.
#
# Run ON THE SERVER:
#   bash scripts/rls/enable-rest.sh                       # medium → hot, default order
#   bash scripts/rls/enable-rest.sh companies leads tickets   # just these, in order
#   RLS_WAIT_SECONDS=3600 bash scripts/rls/enable-rest.sh     # 1h soak between tables
#
# NOTE: the per-table log check is a LIGHT touch (it only sees paths that real
# traffic exercised during the wait). It is NOT a substitute for the plan's
# ~a-day soak — for the hot tables (contacts/deals/invoices) prefer a longer
# RLS_WAIT_SECONDS, or enable them individually and watch the app UI. The audit
# is clean (find-context-gaps.py = 0) and the canary (quotes) is already live, so
# residual risk is low, but this is faster than the phased plan by design.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ENABLE="$HERE/enable-one.sh"
WAIT="${RLS_WAIT_SECONDS:-30}"

RED=$'\033[0;31m'; GRN=$'\033[0;32m'; YLW=$'\033[1;33m'; NC=$'\033[0m'

# table → Prisma model name (the [RLS-GUARD] line names the MODEL, e.g. "Contact").
# Plain case — no associative arrays — so it also runs on macOS bash 3.2 and zsh.
ALLOWED="quotes companies leads tickets contacts deals invoices"
model_of() {
  case "$1" in
    quotes)    echo Quote ;;
    companies) echo Company ;;
    leads)     echo Lead ;;
    tickets)   echo Ticket ;;
    contacts)  echo Contact ;;
    deals)     echo Deal ;;
    invoices)  echo Invoice ;;
    *)         echo "" ;;
  esac
}

if [[ $# -gt 0 ]]; then TABLES=("$@"); else TABLES=(companies leads tickets contacts deals invoices); fi

# returns 0 if a [RLS-GUARD] line for THIS model is present in recent server logs
guard_hit_for() {
  local model="$1"
  command -v pm2 >/dev/null 2>&1 || return 1     # no pm2 here → can't check → treat clean
  [[ -n "$model" ]] || return 1
  pm2 logs leaddrive-v2 --lines 200 --nostream 2>/dev/null \
    | grep -Eq "RLS-GUARD.*org-scoped ${model}\."
}

echo "${YLW}RLS batch: ${TABLES[*]}  (wait ${WAIT}s + log-check between each)${NC}"
for t in "${TABLES[@]}"; do
  model="$(model_of "$t")"
  if [[ -z "$model" ]]; then
    echo "${RED}✗ unknown table '$t' — allowed: ${ALLOWED}${NC}"; exit 1
  fi
  echo
  echo "${YLW}──────── enabling: $t ────────${NC}"
  if ! bash "$ENABLE" "$t"; then
    echo "${RED}✗ enable failed for '$t' — stopping.${NC}"; exit 1
  fi
  echo "${YLW}• waiting ${WAIT}s, then checking logs for a [RLS-GUARD] on ${model}…${NC}"
  sleep "$WAIT"
  if guard_hit_for "$model"; then
    echo "${RED}⚠ [RLS-GUARD] for ${model} detected — an un-wrapped path is now fail-closing.${NC}"
    echo "${RED}  Auto-rolling back '$t' and STOPPING (wrap that path, then resume).${NC}"
    bash "$ENABLE" "$t" --rollback
    exit 2
  fi
  echo "${GRN}✓ $t enabled, no [RLS-GUARD] for ${model} in the check window.${NC}"
done
echo
echo "${GRN}All requested tables enabled. Keep watching:  pm2 logs leaddrive-v2 | grep RLS-GUARD${NC}"
