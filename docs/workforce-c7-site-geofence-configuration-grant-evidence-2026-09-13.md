# Workforce C7 — site and geofence configuration grants

## Boundary

Workforce site inventory, site creation/archive and calibrated geofence
revision reads/writes now use the same session-only schedule-configuration
wrapper as shifts and assignments. Before granular cutover, the legacy
session-admin boundary remains unchanged. After cutover, reads require
`SCHEDULE_READ` and mutations require `SCHEDULE_WRITE`; an ungranted CRM admin
has no fallback.

This authority controls configuration only. It does not assign an employee,
activate mobile monitoring, alter a Route customer/geofence, create a grant or
enable the tenant rollout flag. Historical site/geofence revisions remain
append-only through their existing services.

## Verification

- `PASS` — site API contracts include construction-time permission mapping,
  tenant-scoped inventory and calibrated revision reads.
- `PASS` — schedule-wrapper and RLS route-context suites.
- `PASS` — scoped ESLint, `git diff --check`, and RLS scanner with 0 gaps.
- `NOT RUN` — full build/browser/physical geofence verification locally; those
  remain CI, staging and device gates.
