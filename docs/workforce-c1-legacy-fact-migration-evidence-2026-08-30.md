# Workforce C1h — legacy attendance-fact migration and reconciliation plan

> **Status:** implementation and runbook evidence for `WF-C1-009`; no
> production database was inspected or changed.
> **Recorded:** 2026-08-30
> **Applies to:** `mtm_agent_workday_events` and its C1 provenance/review
> extensions. It does not classify historic location, QR, device or identity
> evidence as trustworthy.

## Safety decision

The C1 release is **expand-only**.  Existing event rows are immutable historic
facts, not incomplete inputs for a later writer to repair.  In particular, the
release must never derive or write any of the following for an old row:

- `claimedAt`, `capturedAt`, `queuedAt`, `serverReceivedAt` or `appliedAt`;
- a `requestHash`, segment ID, QR/device proof or new evidence assessment;
- a current team, site, schedule, policy, clock order or review decision;
- an ordinary/approved state in place of `LEGACY_UNKNOWN`.

The C1 provenance and review migrations already add nullable/defaulted columns
without an event-table rewrite.  The accompanying v3 migration only expands
the schema-version check from `(1, 2)` to `(1, 2, 3)`, so a new segment-bound
event is not rejected by the database after the application accepts it.  It
does not alter a row and leaves v1/v2 digests byte-for-byte compatible.

## Controlled rollout order

1. In CI or an isolated, restorable staging database, record the preflight
   counts below in one read-only transaction.
2. Apply the C1 migrations in repository order.  Do **not** run `db push`, a
   handwritten backfill, or an ad-hoc `UPDATE` against attendance facts.
3. Re-run the same counts and compare them by tenant.  A count difference in a
   legacy cohort is a release stop, not a reason to normalise that cohort.
4. Only after reconciliation is clean, enable v3 writers through their normal
   release route.  v1/v2 readers and retries remain supported during the
   approved mobile compatibility window.

No migration in this slice creates payroll, approval, disciplinary or
location-collection effects.  Any later human review must add a separate,
append-only case; it must not edit the source event.

## Read-only preflight and reconciliation queries

Run with the production-equivalent RLS/bypass procedure approved for the
release operator; these examples deliberately do not set a tenant bypass or
perform a write.  Capture results per `organizationId`, redact tenant IDs in
the release record, and retain only aggregate counts.

```sql
BEGIN TRANSACTION READ ONLY;

-- Baseline by immutable evidence class.  The values are expected to remain
-- identical before and after this schema-only release.
SELECT
  "organizationId",
  "schemaVersion",
  "attendanceReviewState",
  count(*) AS events,
  count(*) FILTER (WHERE "requestHash" IS NULL) AS without_request_hash,
  count(*) FILTER (WHERE "claimedAt" IS NULL) AS without_claim_time,
  count(*) FILTER (WHERE "serverReceivedAt" IS NULL) AS without_receipt_time
FROM "mtm_agent_workday_events"
GROUP BY "organizationId", "schemaVersion", "attendanceReviewState"
ORDER BY "organizationId", "schemaVersion", "attendanceReviewState";

-- A legacy row is defined by its missing historical provenance, not inferred
-- from its current employee/team/site relations.
SELECT
  "organizationId",
  count(*) AS legacy_unknown_events
FROM "mtm_agent_workday_events"
WHERE "schemaVersion" = 1
  AND "attendanceReviewState" = 'LEGACY_UNKNOWN'
  AND "requestHash" IS NULL
  AND "claimedAt" IS NULL
  AND "capturedAt" IS NULL
  AND "queuedAt" IS NULL
  AND "serverReceivedAt" IS NULL
  AND "appliedAt" IS NULL
GROUP BY "organizationId"
ORDER BY "organizationId";

-- Referential integrity for the review projection is expected to be empty
-- both before and after rollout; it does not grant a case resolution action.
SELECT case_row."organizationId", count(*) AS orphaned_review_cases
FROM "workforce_attendance_review_cases" AS case_row
LEFT JOIN "mtm_agent_workday_events" AS event_row
  ON event_row."organizationId" = case_row."organizationId"
 AND event_row."id" = case_row."workdayEventId"
WHERE event_row."id" IS NULL
GROUP BY case_row."organizationId";

ROLLBACK;
```

The reconciliation artifact records the first two result sets before and after
the migration.  It also records the migration SHA, application SHA, database
schema migration IDs, execution start/end, query checksum and the operator.
New online events may make global totals grow while the release runs; compare
only the pre-existing legacy cohort keyed by the preflight snapshot, not a
live total sampled at different times.

## Rollback and failure handling

There is no destructive down migration for attendance evidence.  If the
application or migration gate fails:

1. stop the feature release and retain the append-only schema additions;
2. roll the application back to the previous compatible SHA through the normal
   GitHub Actions release route;
3. keep v1/v2 readers active and do not delete columns, constraints or new
   v3 rows that might already exist;
4. attach the preflight/reconciliation output and migration log to the
   incident, then repair forward in a separately reviewed change.

Dropping a column or rewriting v3 to v2 would destroy information and is not a
valid rollback action.  A new v3 fact can be read as a normal immutable event
by the previous release because the stored core event fields remain unchanged;
clients that cannot send v3 use their declared supported v1/v2 contract.

## Evidence and current limits

- `PASS` — the new migration contract test proves the v3 check expansion has
  no `INSERT`, `UPDATE`, `DELETE` or `TRUNCATE` statement.
- `PASS` — prior C1 provenance/review migration contract tests prove their
  event-table changes are additive and do not rewrite historical facts.
- `NOT RUN` — isolated migration apply, rollback rehearsal and dry-run counts:
  no disposable database or authorized production data inspection is part of
  this worktree task.
- `NOT RUN` — production release: all C0–C14 gates and required CI remain
  incomplete; this document is not deployment authorization.
