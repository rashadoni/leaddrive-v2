#!/usr/bin/env bash
# Trusted host code. The caller must own the host heavy-work lock.
cleanup_idle_resources() {
  local -a ids=()
  mapfile -t ids < <(docker ps -aq --filter label=leaddrive.azure-ci=1)
  if [ "${#ids[@]}" -gt 0 ]; then timeout 45s docker rm -f "${ids[@]}" >/dev/null; fi
  mapfile -t ids < <(docker network ls -q --filter label=leaddrive.azure-ci=1)
  if [ "${#ids[@]}" -gt 0 ]; then timeout 15s docker network rm "${ids[@]}" >/dev/null; fi
  mapfile -t ids < <(docker volume ls -q --filter label=leaddrive.azure-ci=1)
  if [ "${#ids[@]}" -gt 0 ]; then timeout 30s docker volume rm "${ids[@]}" >/dev/null; fi
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -Eeuo pipefail
  exec 9> /var/lock/leaddrive-azure-heavy.lock
  # An active validation/build owns this lock, so its resources are untouched.
  flock -n 9 || exit 0
  cleanup_idle_resources
fi
