# Workforce service-level objective contract

Status: approved release-one operating contract

Date: 2026-09-13

Owner roles: SRE owns detection, paging and recovery coordination; Product owns
cohort freeze/rollback; HR owns attendance disputes; Security/Privacy owns any
tenant isolation or sensitive-data incident. A named person is recorded in the
private pilot ticket before a cohort is enabled.

## Objectives and stop thresholds

| Signal | Objective | Warning | Critical / stop |
|---|---|---|---|
| Online critical mutation acknowledgement | p95 <= 10 seconds and p99 <= 20 seconds over a 15-minute window | either percentile consumes 80% of its ceiling for two windows | either ceiling is exceeded for two windows, or one request remains unacknowledged for 60 seconds |
| Oldest online pending operation | normally below 2 minutes | >= 2 minutes for 5 minutes | >= 15 minutes, or monotonic growth for 15 minutes |
| Accepted business-event loss or duplicate terminal event | zero | none | any confirmed instance is P0 and freezes the cohort |
| Avoidable synthetic START conflicts | zero in the isolated 5,000-user gate | any non-zero result requires investigation | unresolved non-zero result blocks the gate |
| Workforce 5xx/unavailable rate | below 1% over 15 minutes | >= 1% for 5 minutes | >= 5% for 5 minutes or sustained unavailable for 15 minutes |
| Route/Workforce isolation | no cross-stream blocking or cursor corruption | any correlated degradation investigation | any confirmed cross-stream blocking freezes Workforce, not Routes |
| Reconciliation | every accepted operation represented exactly once through its applicable fact/assessment/exception/approval/export chain | a truncated or cursor-race run is retried from the unchanged cursor | any mismatch leaves the page uncommitted, blocks expansion and permits no automatic repair |

The offline horizon remains seven days. It is a product acceptance boundary,
not permission to hide a pending operation: the employee must see local,
server-applied, pending-review, conflict or rejected state throughout recovery.

## Recovery objectives

- **RPO:** zero accepted attendance business events. Restore/replay must use
  operation IDs and immutable facts; operators never recreate START/FINISH.
- **RTO:** within 30 minutes either restore normal Workforce writes or freeze
  the exact cohort behind the write fence while keeping read/reconciliation
  access. Route & Field remains available.
- Warning pages SRE during the support window. Critical conditions page SRE and
  Product immediately; privacy/security conditions additionally invoke the
  incident runbook; attendance disputes route to HR without exposing proof.
- Close an incident only after canonical server state is visible and the
  bounded reconciliation page is clean. Clearing device data is prohibited.

## Evidence and privacy boundary

Operational evidence contains build SHA, time window, finite stream/app/schema/
result dimensions, counts, p50/p95/p99, oldest-pending age and reconciliation
counts. It excludes employee IDs, coordinates, QR values, device keys,
biometric material, tokens and free-text reasons.

The existing staging-only k6 contract encodes the 5,000-user, p95/p99 and zero
conflict thresholds. Passing source tests does not claim that external load,
restore, chaos or physical-device gates ran.

## Runbooks

- `docs/workforce-pilot-rollback-retention-runbook-2026-08-28.md`
- `docs/workforce-sync-support-playbook.md`
- `docs/workforce-c10-privacy-security-incident-runbook-2026-08-30.md`
- `docs/workforce-h6-pilot-evidence.md`
