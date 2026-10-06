# Dormant eligible-roster reconciliation diagnostic

This PR589 slice advances WF-C12-008 and supplies source groundwork for WF-C12-002/006. All remain PARTIAL. It creates no job schedule, endpoint, external alert transport or privilege grant.

`workforceReconciliationOperationsStore(...).eligibleRosterHealth()` uses an already-authorized control client. Existing `health()` retains its `TRACKED_ATTEMPTS_ONLY` meaning. The new diagnostic reads active organizations plus tracked inactive organizations, applies the canonical HRM entitlement resolver (including legacy MTM fallback and explicit HRM disable), and includes eligible organizations without a reconciliation-state row.

One repeatable-read read-only transaction supplies both visibility verification and the roster snapshot. Both source relations must be ordinary tables. A role subject to RLS on either table is refused even if its current policy looks permissive. The roster ceiling is 10,000 organizations across active plus inactive tracked rows; a 10,001st row or projection over 4 MiB produces UNKNOWN without partial counts. The timeout also fails closed. These limits constrain returned projections, not a universal CPU/memory guarantee for arbitrarily large database values.

Output contains aggregate counters and finite alert codes only. It never includes organization or employee identifiers, entitlement fields, coordinates, reasons, database errors or credential values. Counters overlap and are not a partition: eligible, trackedEligible, neverAttempted, neverMatched, running, expiredAttempts, failed, due, staleCompleted, excludedTracked. A preserved earlier match remains a match when a later attempt fails. RUNNING is expired when dueAt is at or before the snapshot time; successful completion is stale only when older than two hours. This fixed diagnostic window is not an approved operational SLO.

Statuses:

- `NO_ELIGIBLE`: the fully visible bounded snapshot contains no eligible organizations; no coverage percentage is invented.
- `CLEAR`: no enumerated diagnostic alert in this snapshot. This does not assert end-to-end reconciliation completeness or historical correctness.
- `ATTENTION`: unattempted/never-matched tenants, failed attempts, expired RUNNING attempts or stale prior completions.
- `UNKNOWN / UNAVAILABLE`: visibility, budget, malformed snapshot or database boundary prevented a complete result. No fake zero counters are returned.

Strict entitlement-shape validation refuses malformed active rows rather than quietly shrinking the denominator. Inactive/disabled tracked organizations appear only in excludedTracked; their outcomes do not inflate eligible failures. Monitoring delivery, collection cadence, freshness SLO, representative historical schema and production observation are separate acceptance gates.

Fifteen new tests (14 PostgreSQL scenarios and one pure error boundary) exercise zero denominator, never-attempted tenants, entitlement transitions, legacy fallback, live/expired attempts, retained prior success, RLS denial, exact row ceiling, projection overflow, malformed entitlements, inconsistent RUNNING state and a concurrent update across the MVCC snapshot. They run on a disposable synthetic schema, not replayed history. Existing 123 reconciliation tests are rerun with their isolated fixtures. Historical full-staging, 5,000-user representative load, runtime scheduling and external delivery are not claimed.
