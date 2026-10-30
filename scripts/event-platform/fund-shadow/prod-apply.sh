#!/usr/bin/env bash
# Fund shadow pilot, production host side. Run as root by
# `provision.sh fund-shadow-prod`, next to provision-role.sql; each phase is
# idempotent:
#
#   prod-apply.sh role     ORG ROLE BUILD_ID BUILD_KEY CODE_SHA   (SCRAM verifier on stdin)
#   prod-apply.sh hba      ADDR ROLE...                           TLS-only logins of the ROLEs from ADDR; reload
#   prod-apply.sh retire   BUILD_KEY ROLE...                      earlier pilots: builds abandoned, logins off
#   prod-apply.sh status                                          read-only
#
# Nothing here restarts PostgreSQL, touches the CDC role/slot or the data of
# any organization other than through provision-role.sql's own checks.
set -Eeuo pipefail
die() { printf 'fund-shadow: %s\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "run as root"
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
dbname="${DBNAME:-leaddrive_v2}"
hba="$(sudo -u postgres psql -XAtqc 'show hba_file')"
psql_su() { sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d "$dbname" "$@"; }
role_ok() { [[ "$1" =~ ^ld_fund_shadow_[a-z0-9_]{1,40}$ ]] || die "invalid role"; }

case "${1:-}" in
  role)
    org="${2:-}"; role="${3:-}"; build="${4:-}"; key="${5:-}"; sha="${6:-}"; role_ok "$role"
    install -m 0644 "$here/provision-role.sql" /tmp/ld-fund-shadow-provision-role.sql
    trap 'rm -f /tmp/ld-fund-shadow-provision-role.sql' EXIT
    # stdin (the verifier) goes straight to psql's \prompt; it is never echoed.
    psql_su -q -At -v org="$org" -v role="$role" -v build_id="$build" -v build_key="$key" -v code_sha="$sha" \
      -f /tmp/ld-fund-shadow-provision-role.sql
    ;;
  hba)
    addr="${2:-}"; shift 2 || die "usage: hba ADDR ROLE..."
    [[ "$addr" =~ ^10\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "ADDR must be a mesh address"
    [ "$#" -ge 1 ] || die "usage: hba ADDR ROLE..."
    for role in "$@"; do role_ok "$role"; done
    tmp="$(mktemp)"
    awk '/^# BEGIN leaddrive-fund-shadow/{skip=1} !skip{print} /^# END leaddrive-fund-shadow/{skip=0}' "$hba" >"$tmp"
    {
      echo '# BEGIN leaddrive-fund-shadow (prod-apply.sh): TLS only, the shadow pilot logins, their Connect host only'
      for role in "$@"; do printf 'hostssl %s %s %s/32 scram-sha-256\n' "$dbname" "$role" "$addr"; done
      echo '# END leaddrive-fund-shadow'
    } >>"$tmp"
    cmp -s "$tmp" "$hba" || { install -m 0640 -o postgres -g postgres "$tmp" "$hba"; psql_su -qAtc 'select pg_reload_conf()' >/dev/null; }
    rm -f "$tmp"
    psql_su -qAt -c "select count(*) from pg_hba_file_rules where user_name && string_to_array('$*', ' ') and error is null" | sed 's/^/hba rules for the pilot logins: /'
    ;;
  retire)
    key="${2:-}"; shift 2 || die "usage: retire BUILD_KEY ROLE..."
    [ "$#" -ge 1 ] || die "usage: retire BUILD_KEY ROLE..."
    for role in "$@"; do role_ok "$role"; done
    install -m 0644 "$here/retire-builds.sql" /tmp/ld-fund-shadow-retire-builds.sql
    trap 'rm -f /tmp/ld-fund-shadow-retire-builds.sql' EXIT
    psql_su -q -At -v keep_key="$key" -v keep_roles="$(IFS=,; echo "$*")" -f /tmp/ld-fund-shadow-retire-builds.sql
    ;;
  status)
    psql_su -qAt -c "select 'role ' || rolname || ' login=' || rolcanlogin || ' super=' || rolsuper || ' bypassrls=' || rolbypassrls from pg_roles where rolname like 'ld\_fund\_shadow\_%' order by 1"
    psql_su -qAt -c "select 'build ' || \"buildKey\" || ' ' || left(\"organizationId\", 8) || ' ' || mode || '/' || status || ' code=' || left(\"codeSha\", 12) from projection_builds where \"projectionName\" = 'finance.fund-balance' and mode = 'shadow' order by \"buildKey\", \"organizationId\""
    grep -c "leaddrive-fund-shadow" "$hba" | sed 's/^/hba block markers: /'
    ;;
  *) sed -n '2,12p' "$0"; exit 2 ;;
esac
