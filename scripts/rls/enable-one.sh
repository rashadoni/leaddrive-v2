#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Enable (or roll back) Postgres Row-Level Security on ONE core tenant table.
#
# Run this ON THE SERVER (where the app's DB is reachable). Enabling RLS is pure
# DB state — NO code redeploy is needed: the [RLS-GUARD] hook, runWithTenant and
# runWithRlsBypass are already live in prod. deploy.sh does NOT run migrations, so
# this script is the mechanism for the one-table-at-a-time rollout.
#
# Usage:
#   bash scripts/rls/enable-one.sh <table>             # preflight + enable + status
#   bash scripts/rls/enable-one.sh <table> --status    # show current RLS state only
#   bash scripts/rls/enable-one.sh <table> --rollback  # DISABLE RLS + drop the policy
#
# DB connection (first set wins):
#   $DBURL  ·  $DATABASE_URL  ·  a DATABASE_URL= line in /etc/leaddrive/app.env
#   (production) or a local ./.env file (development only)
#
# Recommended order (one per step, watch ~a day between):
#   quotes → companies → leads → tickets → contacts → deals → invoices
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

CORE_TABLES="quotes companies leads tickets contacts deals invoices"
APP_ENV_FILE="${APP_ENV_FILE:-/etc/leaddrive/app.env}"

RED=$'\033[0;31m'; GRN=$'\033[0;32m'; YLW=$'\033[1;33m'; NC=$'\033[0m'
die()  { echo "${RED}✗ $*${NC}" >&2; exit 1; }
ok()   { echo "${GRN}✓ $*${NC}"; }
info() { echo "${YLW}• $*${NC}"; }

# ── args ──
TABLE="${1:-}"
MODE="${2:-enable}"
case "$MODE" in enable|--status|--rollback) ;; *) die "unknown mode '$MODE' (use --status or --rollback)";; esac
[[ -n "$TABLE" ]] || die "usage: bash scripts/rls/enable-one.sh <table> [--status|--rollback]"
grep -qw "$TABLE" <<<"$CORE_TABLES" || die "'$TABLE' is not a core rollout table. Allowed: $CORE_TABLES"

# ── resolve DATABASE_URL ──
resolve_dburl() {
  [[ -n "${DBURL:-}" ]]        && { printf '%s' "$DBURL"; return; }
  [[ -n "${DATABASE_URL:-}" ]] && { printf '%s' "$DATABASE_URL"; return; }
  local f u
  for f in "$APP_ENV_FILE" ./.env ../.env; do
    [[ -f "$f" ]] || continue
    u=$(grep -E '^DATABASE_URL=' "$f" | head -1 | cut -d= -f2- | tr -d '"'\'' ')
    [[ -n "$u" ]] && { printf '%s' "$u"; return; }
  done
  printf ''
}
DBURL="$(resolve_dburl)"
[[ -n "$DBURL" ]] || die "DATABASE_URL not found. Set \$DBURL, configure $APP_ENV_FILE, or run locally with a .env."
PSQL=(psql "$DBURL" -v ON_ERROR_STOP=1 -qtA)

show_status() {
  local rls; rls=$("${PSQL[@]}" -c "SELECT relrowsecurity||' '||relforcerowsecurity FROM pg_class WHERE relname='$TABLE'")
  local pol; pol=$("${PSQL[@]}" -c "SELECT count(*) FROM pg_policies WHERE tablename='$TABLE' AND policyname='tenant_isolation'")
  echo "  RLS state for \"$TABLE\":  rowsecurity/force = ${rls:-<no such table>} ;  tenant_isolation policy = $([[ "$pol" == 1 ]] && echo present || echo MISSING)"
}

# ── connectivity + status-only short circuit ──
"${PSQL[@]}" -c "SELECT 1" >/dev/null || die "cannot connect with the resolved DATABASE_URL"
if [[ "$MODE" == "--status" ]]; then show_status; exit 0; fi

# ── rollback ──
if [[ "$MODE" == "--rollback" ]]; then
  info "Rolling back RLS on \"$TABLE\" (instant, non-destructive)…"
  "${PSQL[@]}" <<SQL
ALTER TABLE "$TABLE" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "$TABLE";
SQL
  ok "RLS disabled on \"$TABLE\"."; show_status; exit 0
fi

# ── PREFLIGHT: the connecting role must NOT be superuser / bypassrls, else RLS is
#    silently a no-op (superusers and BYPASSRLS roles ignore every policy). ──
read -r IS_SUPER IS_BYPASS < <("${PSQL[@]}" -c "SELECT rolsuper::text||' '||rolbypassrls::text FROM pg_roles WHERE rolname = current_user")
WHO=$("${PSQL[@]}" -c "SELECT current_user")
if [[ "$IS_SUPER" == "true" || "$IS_BYPASS" == "true" ]]; then
  die "role '$WHO' is superuser=$IS_SUPER bypassrls=$IS_BYPASS — RLS would NOT isolate. Use the app's non-privileged role (e.g. hermes: NOSUPERUSER NOBYPASSRLS)."
fi
ok "Preflight: role '$WHO' is NOSUPERUSER/NOBYPASSRLS — RLS will bind."

# ── enable (idempotent) ──
info "Enabling RLS + tenant_isolation policy on \"$TABLE\"…"
"${PSQL[@]}" <<SQL
ALTER TABLE "$TABLE" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "$TABLE" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "$TABLE";
CREATE POLICY tenant_isolation ON "$TABLE"
  USING      ("organizationId" = current_setting('app.org_id', true)
              OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true)
              OR current_setting('app.rls_bypass', true) = 'on');
SQL
ok "RLS enabled on \"$TABLE\"."
show_status
echo
info "Now watch ~a day before the next table:  pm2 logs leaddrive-v2 | grep RLS-GUARD"
info "Rollback if needed:  bash scripts/rls/enable-one.sh $TABLE --rollback"
