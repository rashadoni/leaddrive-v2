#!/bin/bash
# Legacy manual production deploy entry point — intentionally retired.
set -euo pipefail

cat >&2 <<'MESSAGE'
FATAL: manual LeadDrive production deployment is disabled.

The only supported release route is:
  reviewed main -> .github/workflows/deploy.yml -> immutable SHA-bound artifact
  -> scripts/server-deploy.sh on the registered production host.

Direct git reset/build/PM2 restart bypasses migration, backup, tenant-isolation,
and event-platform cutover gates. Push an approved commit to main and follow the
GitHub Actions deployment instead. For recovery, use the workflow's pinned
recovery_sha input and the event-platform/backup runbooks.
MESSAGE

exit 64
