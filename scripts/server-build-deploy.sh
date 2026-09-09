#!/usr/bin/env bash
# Legacy on-host build entry point — intentionally retired.
set -euo pipefail

cat >&2 <<'MESSAGE'
FATAL: building or deploying LeadDrive from a persistent application host is disabled.

The only supported release route is:
  reviewed main -> .github/workflows/deploy.yml on a GitHub-hosted ephemeral
  Linux builder -> immutable SHA-bound artifact -> scripts/server-deploy.sh on
  the registered production host.

An on-host build competes with persistent workloads, bypasses the reviewed CI
artifact boundary, and can leave an untracked release. Use the GitHub Actions
workflow. For recovery, use its exact recovery_sha input and the documented
event-platform/backup runbooks.
MESSAGE

exit 64
