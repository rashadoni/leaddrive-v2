# C12-008 dense reconciliation and dormant operations

This extends the accepted PR589 source `0a40cd6922affc8c21cc07c655ad5af5df990b19`.
It is an unactivated implementation, not C12-008 or production acceptance.
The ledger remains 82/161 DONE, 79 open, 14/15 gates, C8 45%, weighted 59%.

## Dense source traversal

The original bounded snapshot API remains available. The new dense reader visits
all eight root families in a single read-only repeatable-read transaction. Root
pages use C-collated keysets and bounded dependency lookups. Mismatches and
examined counts belong to their root family, so dependency reloads do not inflate
counts. Approval histories are enumerated by complete employee/period group;
they are never divided across checkpoints. Schedule subjects retain the existing
pinned-workday versus effective-schedule rules.

Limits are explicit: 100,000 total roots per transaction, 128 roots per ordinary
page, 64 exception roots per page, 1 MiB per protected query, 4 MiB per dependency
component, and 1,000 revisions/1 MiB per indivisible approval group. Ordinary
pages shrink on projection overflow. An oversized atomic group, missing source,
malformed record, timeout, or incomplete enumeration refuses progress. The
worker permits 5 seconds per SQL statement and 30 seconds per read transaction.
There is no persisted row cursor: each invocation revisits late or backdated
facts under a fresh MVCC snapshot. Only a fully matched, completed transaction
may advance the existing global opaque cursor.

## Dormant operational adapter

No route, cron, scheduler, registration, production grant, or activation is added.
The caller supplies the existing lease owner, an authorized control client, and
a tenant-scoped reader factory. The caller must bound the reader factory's own
setup time; the transaction limits start after it returns. The scoped transaction
must use the selected `app.org_id`, `app.rls_bypass=off`, and a role that is neither
superuser nor BYPASSRLS. The worker verifies this context and current active HRM
capability inside the read snapshot before reading facts.

Tenant operational state records attempts separately from successful completion.
Due active HRM tenants are ordered by due time, last attempt, and tenant ID. New
tenants use creation time, not an artificial oldest priority. Selection refuses
more than 10,000 active roster rows or a 4 MiB roster projection. Failure backs
off from 30 seconds to 30 minutes; success schedules eligibility in one hour.
An abandoned attempt becomes retryable after two minutes. Failed tenants move
behind other due tenants and do not advance completed reconciliation progress.

Claims, outcomes, and cursor writes fence the current lease owner and wall-clock
expiry after lock waits. Cursor writes additionally fence the tenant attempt
token, RUNNING state, and attempt deadline. A replaced or expired attempt cannot
advance global progress even if its process still owns the same lease. A claim
whose insertion conflict waits beyond lease expiry rolls back its state change.
An uncertain checkpoint acknowledgement remains UNKNOWN, not confirmed success.

Health exposes finite counts and failure/stale/never-completed alerts, without
tenant identifiers or facts. Its coverage is explicitly TRACKED_ATTEMPTS_ONLY;
eligible roster coverage is NOT_MEASURED. Zero tracked counts are not proof that
all eligible tenants have been reconciled. There is no notification transport or
production monitoring registration in this slice.

## Migration and evidence boundary

The migration adds tenant-owned FORCE RLS operational state and nine C-collated
indexes for root and approval-scope traversal. It has no grants or backfill.
Prisma cannot express index collation: schema-generated SQL alone does not
reproduce these indexes. Validation must apply the actual migration. Index-build
locking, time, storage and maintenance-window suitability on real staging data
remain deployment prerequisites; this is not a concurrent production rollout.

Independent baseline measurements on PostgreSQL 16 found a sequential scan and
C-order sort over 101,000 selected workdays. The isolated C-index experiment
changed the first page to an index scan. Those synthetic timings are diagnostic,
not a production SLO or p95. New-source tests and query plans have separate
source-bound receipts; historical baseline measurements are not borrowed as
current-source acceptance.

Full empty-database migration replay is BLOCKED: after 391 completed migrations,
`20260811150000_zapier_webhook_api_key_provenance` fails with P3018 / SQL 42P01
because `api_keys` is absent. No migration was repaired, resolved, marked applied,
or bypassed. Full-schema generated SQL plus repository-derived RLS policy
projection is a separately labelled synthetic fixture; it does not reproduce
every historical trigger, check, ACL, or migration and is not full staging proof.

Remaining C12-008 prerequisites include an approved reproducible staging baseline
or separately scoped repair of that unrelated migration history, complete real
staging RLS/ACL/trigger verification, measured production-shaped density and
timeouts, eligible-roster monitoring coverage, alert delivery, and separately
approved runtime activation. Tenants exceeding the explicit atomic or total
bounds remain safely refused. No merge, deploy, or activation is authorized by
this document.
