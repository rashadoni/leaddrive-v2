#!/usr/bin/env bash
# Prepare bounded swap for the memory-heavy Linux production build.
#
# This helper is intentionally restricted to GitHub-hosted ephemeral runners.
# LeadDrive production and the persistent Contabo development host must never
# absorb a Next.js build: they receive only the reviewed SHA-bound artifact.
set -euo pipefail

SWAP_MIB="${LEADDRIVE_BUILD_SWAP_MIB:-4096}"
MIN_AVAILABLE_RAM_KIB="${LEADDRIVE_BUILD_MIN_RAM_KIB:-6000000}"
# An 8 GiB V8 old-space limit still needs room for SWC/native allocations and
# the runner OS. Fail before npm install unless at least 12 GiB RAM+swap is
# actually available; the workflow never guesses from a runner label.
MIN_MEMORY_BUDGET_KIB="${LEADDRIVE_BUILD_MIN_BUDGET_KIB:-12582912}"
MIN_WORKSPACE_FREE_DISK_MIB="${LEADDRIVE_BUILD_MIN_WORKSPACE_FREE_DISK_MIB:-8000}"
MIN_TEMP_FREE_DISK_MIB="${LEADDRIVE_BUILD_MIN_TEMP_FREE_DISK_MIB:-2048}"

fatal() {
  printf 'FATAL: %s\n' "$1" >&2
  exit 1
}

[ "${GITHUB_ACTIONS:-}" = "true" ] || \
  fatal "production-build swap may only be prepared inside GitHub Actions"
[ "${RUNNER_ENVIRONMENT:-}" = "github-hosted" ] || \
  fatal "production builds require a GitHub-hosted ephemeral runner"
[ "$(uname -s)" = "Linux" ] || \
  fatal "production artifacts must be built on Linux"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}"
[[ "$RUNNER_TEMP" = /* ]] || fatal "RUNNER_TEMP must be absolute"
[[ "$GITHUB_WORKSPACE" = /* ]] || fatal "GITHUB_WORKSPACE must be absolute"
[ -d "$RUNNER_TEMP" ] || fatal "RUNNER_TEMP is not an existing directory"
[ -d "$GITHUB_WORKSPACE" ] || fatal "GITHUB_WORKSPACE is not an existing directory"
RUNNER_TEMP_REAL="$(realpath -e -- "$RUNNER_TEMP")" || fatal "cannot resolve RUNNER_TEMP"
GITHUB_WORKSPACE_REAL="$(realpath -e -- "$GITHUB_WORKSPACE")" || fatal "cannot resolve GITHUB_WORKSPACE"
SYSTEM_TEMP_REAL="$(realpath -e -- "${TMPDIR:-/tmp}")" || fatal "cannot resolve system temp directory"
SWAP_FILE="$RUNNER_TEMP_REAL/leaddrive-production-build.swap"
MODE="${1:-prepare}"
[ "$MODE" = "prepare" ] || [ "$MODE" = "cleanup" ] || fatal "expected prepare or cleanup mode"

swap_is_active() {
  awk 'NR > 1 { print $1 }' /proc/swaps | grep -Fx -- "$SWAP_FILE" >/dev/null
}

if [ "$MODE" = "cleanup" ]; then
  [ ! -L "$SWAP_FILE" ] || fatal "refusing to clean a symlinked production-build swap path"
  if swap_is_active; then
    sudo swapoff "$SWAP_FILE"
  fi
  ! swap_is_active || fatal "cannot deactivate the production-build swap file"
  if [ -e "$SWAP_FILE" ]; then
    sudo rm -f -- "$SWAP_FILE"
  fi
  printf 'GitHub-hosted production-build swap cleaned: %s\n' "$SWAP_FILE"
  exit 0
fi

[[ "$SWAP_MIB" =~ ^[1-9][0-9]*$ ]] || fatal "LEADDRIVE_BUILD_SWAP_MIB must be a positive integer"
[ "$SWAP_MIB" -le 4096 ] || fatal "production-build swap must stay at or below 4096 MiB"

AVAILABLE_RAM_KIB="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)"
[ "${AVAILABLE_RAM_KIB:-0}" -ge "$MIN_AVAILABLE_RAM_KIB" ] || \
  fatal "GitHub-hosted runner has less than the required available RAM"

# The runner image layout is not a contract. Allocate and measure only through
# GitHub's documented directories, then prove both the checkout filesystem and
# the system temporary filesystem still have room after the swap allocation.
RUNNER_TEMP_FREE_MIB="$(df -Pm -- "$RUNNER_TEMP_REAL" | awk 'NR == 2 {print $4}')"
[ "${RUNNER_TEMP_FREE_MIB:-0}" -ge "$((SWAP_MIB + MIN_TEMP_FREE_DISK_MIB))" ] || \
  fatal "RUNNER_TEMP has insufficient disk for bounded swap and temporary files"

[ ! -e "$SWAP_FILE" ] && [ ! -L "$SWAP_FILE" ] || \
  fatal "refusing to replace an existing production-build swap path"
sudo fallocate -l "${SWAP_MIB}M" "$SWAP_FILE"
sudo chmod 0600 "$SWAP_FILE"
sudo mkswap "$SWAP_FILE" >/dev/null
sudo swapon "$SWAP_FILE"
swap_is_active || fatal "production-build swap did not become active"

WORKSPACE_FREE_MIB="$(df -Pm -- "$GITHUB_WORKSPACE_REAL" | awk 'NR == 2 {print $4}')"
SYSTEM_TEMP_FREE_MIB="$(df -Pm -- "$SYSTEM_TEMP_REAL" | awk 'NR == 2 {print $4}')"
[ "${WORKSPACE_FREE_MIB:-0}" -ge "$MIN_WORKSPACE_FREE_DISK_MIB" ] || \
  fatal "GITHUB_WORKSPACE has insufficient disk after bounded swap allocation"
[ "${SYSTEM_TEMP_FREE_MIB:-0}" -ge "$MIN_TEMP_FREE_DISK_MIB" ] || \
  fatal "system temp filesystem has insufficient disk after bounded swap allocation"

SWAP_FREE_KIB="$(awk '/^SwapFree:/ {print $2}' /proc/meminfo)"
MEMORY_BUDGET_KIB=$((AVAILABLE_RAM_KIB + SWAP_FREE_KIB))
[ "$MEMORY_BUDGET_KIB" -ge "$MIN_MEMORY_BUDGET_KIB" ] || \
  fatal "GitHub-hosted runner has less than the required bounded RAM+swap budget"

free -h
df -h -- "$GITHUB_WORKSPACE_REAL" "$RUNNER_TEMP_REAL" "$SYSTEM_TEMP_REAL"
printf 'GitHub-hosted production-build budget ready: ram_kib=%s swap_free_kib=%s workspace_free_mib=%s temp_free_mib=%s\n' \
  "$AVAILABLE_RAM_KIB" "$SWAP_FREE_KIB" "$WORKSPACE_FREE_MIB" "$SYSTEM_TEMP_FREE_MIB"
