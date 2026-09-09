# Mobile sync v2 rollout and rollback runbook

This is an operator runbook for server-first mobile cohorts (`routes`,
`visits`, `tasks` and the active-workday-only `workforce` read, plus GPS
batches). It is not a deploy instruction and does not authorize a production
deploy. Protocol v1 remains the compatibility path throughout this runbook.

## Preconditions

- A database backup/restore rehearsal has succeeded for the target PostgreSQL
  version.
- The mobile capability manifest is observed returning `preferred: 1` and
  `syncV2.routes: false` for every non-pilot device.
- No Field outbox is cleared, migrated, or dual-written. The `routes` v2
  pilot is pull-only and cannot acknowledge or mutate a v1 operation. The
  GPS v2 adapter may acknowledge only its existing GPS rows; it never mutates
  or duplicates a v1 business operation.
- Production baseline exists for route mutation latency, v1 failure rate,
  outbox oldest age, and route payload sizes.
- The migration writes a compact, actor-addressed fourteen-day routes journal
  even before a device cohort exists. This preserves a correct boundary around
  cohort enable/disable; record its row count/storage growth and block cohort
  expansion if it harms route-write latency or retention capacity.
- GPS batches remain off until their own exact `gps` cohort is enrolled. The
  client retains the v1 point adapter when `manifest.gps` is absent, disabled
  or invalid; neither a preferred protocol nor a mutable device header grants
  admission.

## Schema-first deployment order

1. Apply every additive v2 migration required by the intended code revision
   while no device cohort is enabled, then generate the matching Prisma client.
   This includes `20260829120000_mtm_mobile_sync_v2_bounded_retention` whenever
   the revision can call `/api/cron/mtm-cleanup`. The v2 migrations add tables,
   RLS, trigger journal and endpoints; they do not alter v1 tables, contracts
   or idempotency records.
   The later `visits`/`tasks` and active-workday `workforce` migrations add
   trigger functions only, so the already-present generic v2 tables cannot
   signal their absence with `P2021`.
   Do not create or enable either exact cohort until that migration and the
   matching legacy-table index verification below have both completed.
2. Before enabling any cohort, create all four indexes below **outside a
   transaction**. Do not put them back into the Prisma migration: normal
   `CREATE INDEX` on a large legacy table can block route writes.

   ```sql
   SET lock_timeout = '3s';
   CREATE INDEX CONCURRENTLY IF NOT EXISTS "mtm_routes_mobile_sync_v2_primary_idx"
     ON "mtm_routes"("organizationId", "agentId", "date", "id")
     WHERE "deletedAt" IS NULL;
   CREATE INDEX CONCURRENTLY IF NOT EXISTS "mtm_route_assignments_mobile_sync_v2_active_idx"
     ON "mtm_route_assignments"("organizationId", "agentId", "routeId")
     WHERE "removedAt" IS NULL AND "role" <> 'OBSERVER';
   CREATE INDEX CONCURRENTLY IF NOT EXISTS "mtm_visits_mobile_sync_v2_primary_idx"
     ON "mtm_visits"("organizationId", "agentId", "id")
     WHERE "deletedAt" IS NULL AND "status" = 'CHECKED_IN';
   CREATE INDEX CONCURRENTLY IF NOT EXISTS "mtm_tasks_mobile_sync_v2_primary_idx"
     ON "mtm_tasks"("organizationId", "agentId", "id")
     WHERE "deletedAt" IS NULL AND "status" IN ('PENDING', 'IN_PROGRESS', 'OVERDUE');
   ```

3. Verify all four indexes are valid before the cohort change:

   ```sql
   SELECT indexrelid::regclass AS index_name, indisvalid, indisready
   FROM pg_index
   WHERE indexrelid IN (
     'mtm_routes_mobile_sync_v2_primary_idx'::regclass,
     'mtm_route_assignments_mobile_sync_v2_active_idx'::regclass,
     'mtm_visits_mobile_sync_v2_primary_idx'::regclass,
     'mtm_tasks_mobile_sync_v2_primary_idx'::regclass
   );
   ```

   If an online build fails, leave all cohorts disabled. Investigate the
   failure and remove only the named invalid index with `DROP INDEX
   CONCURRENTLY` after confirming its exact name and `indisvalid = false`.

4. Deploy application code only after every schema migration required by that
   code revision is present, including the bounded-retention cursor seed before
   any code that calls `/api/cron/mtm-cleanup`. During an accidental
   code-before-schema rolling interval, bootstrap fails safe to a v1 manifest
   instead of breaking old APK login; bounded cleanup deliberately fails closed
   if its cursor state is absent and must not be used as a schema-order fallback.
5. Enroll one explicitly approved `(tenant, agent, device)` in
   `mtm_mobile_sync_cohorts`. The manifest and endpoint both re-check the
   exact row. Do not enable a tenant-wide wildcard and do not enroll an
   unverified device identifier.
6. `visits` and `tasks` require their own migration and exact stream rows.
   Never reuse a `routes` enrollment. Read
   `docs/mobile-sync-v2-visits-tasks-contract.md`, verify the two partial
   indexes above, then enroll at most one verified device per new stream.
   Compare only PII-free read-only projections to v1; all writes remain v1.
   Roll back by disabling only the affected stream cohort.
7. `workforce` is a separate active-workday-only cohort, not a replacement for
   the v1 HRM/calendar surface. Read
   `docs/mobile-sync-v2-workforce-contract.md`; verify the existing
   `mtm_agent_workdays_organizationId_agentId_status_idx` is valid with an
   `EXPLAIN (ANALYZE, BUFFERS)` against a staging-sized own-agent active-shift
   query before enrolling one verified device. Do not add a speculative legacy
   index in the migration. Compare only the GPS/note-free active-workday
   projection; HRM requests, completed history and all writes remain v1.

## GPS batch cohort and rollback

1. Apply the additive GPS projection/idempotency migration before the route
   code that reads it, then generate the matching Prisma client. Keep every
   `gps` cohort disabled through this schema-first step.
2. Confirm the `/api/cron/mtm-cleanup` path is scheduled and reports the
   fixed 30-day raw-GPS cutoff with bounded deletes. Do not introduce a
   per-request retention override.
   If pre-projection rows need repair, invoke
   `/api/cron/mtm-latest-location-reconcile` for one tenant at a time and
   persist/retry its sealed continuation in an operator-controlled,
   round-robin loop. It is deliberately not wired into retention cleanup and
   must not be treated as an autonomous global scheduler.
3. Enroll one verified `(tenant, agent, device)` row with stream `gps`; the
   bootstrap manifest must advertise `gps.batches: true` only to that device.
   Observe the privacy-safe GPS telemetry dimensions: tenant HMAC, result,
   point count, APK version and duration. Never collect coordinates,
   workday IDs or device IDs in the rollout report.
4. Verify one exact replay and one `429 Retry-After` recovery. A point-level
   validation/conflict response may identify only the caller's opaque
   `clientLocationId`; the client holds that point and continues the remaining
   batch without parallel v1/v2 writes.
5. To roll back, disable that exact `gps` cohort. The next bootstrap returns
   the compatible v1 adapter; route cohorts, Field/media outbox rows, GPS raw
   rows and schema are untouched. Do not use a rollback to clear local queues.

## Bounded v2 retention gate

1. Apply `20260829120000_mtm_mobile_sync_v2_bounded_retention` and generate the
   matching Prisma client before deploying any code that calls
   `/api/cron/mtm-cleanup` (and before expanding a v2 cohort). It adds only the
   bypass-only `mtm_mobile_sync_retention_cursors` scheduler state; it does not
   alter v1 pull/push, `mtm_sync_operations`, or a Field mutation outbox. Verify
   that the new table has both `ENABLE` and `FORCE ROW LEVEL SECURITY`, with a
   policy that permits only `app.rls_bypass = 'on'`.
2. Before the 100-tenant S6 gate, create these indexes **outside a transaction**
   on the already-live rebuildable v2 tables. Do not move them into the Prisma
   migration: a normal `CREATE INDEX` may block interactive Field work.

   ```sql
   SET lock_timeout = '3s';
   CREATE INDEX CONCURRENTLY IF NOT EXISTS "mtm_mobile_sync_changes_retention_scan_idx"
     ON "mtm_mobile_sync_changes"("organizationId", "expiresAt", "stream", "revision", "id");
   CREATE INDEX CONCURRENTLY IF NOT EXISTS "mtm_mobile_sync_snapshots_retention_scan_idx"
     ON "mtm_mobile_sync_snapshots"("organizationId", "expiresAt", "id");
   CREATE INDEX CONCURRENTLY IF NOT EXISTS "mtm_mobile_sync_snapshot_leases_retention_scan_idx"
     ON "mtm_mobile_sync_snapshot_leases"("organizationId", "expiresAt", "stream", "agentId", "deviceId", "horizonKey");
   ```

   Record this validation query with the rollout evidence; all three rows must
   have `indisvalid` and `indisready` set before cohort expansion:

   ```sql
   SELECT indexrelid::regclass AS index_name, indisvalid, indisready
   FROM pg_index
   WHERE indexrelid IN (
     'mtm_mobile_sync_changes_retention_scan_idx'::regclass,
     'mtm_mobile_sync_snapshots_retention_scan_idx'::regclass,
     'mtm_mobile_sync_snapshot_leases_retention_scan_idx'::regclass
   );
   ```

   The existing `("snapshotId", "ordinal")` index serves the item-first
   snapshot reaper. Until this output is recorded, the retention index gate is
   **NOT PROVEN**; application code does not infer index validity at runtime.
3. Schedule `POST /api/cron/mtm-cleanup` frequently enough to complete a
   round-robin pass over the active tenant count inside the retention window.
   Each call is fenced by `system_job_leases.name = 'mtm-cleanup'`; an overlap is
   a successful no-op and the lease row is the heartbeat/last-run evidence.
   The authoritative schedule is the deployment-managed
   `scripts/install-resilience-crons.sh` entry:

   ```text
   */15 * * * * .../cron-trigger.sh /api/cron/mtm-cleanup
   ```

   It must be the single active `mtm-cleanup` line in the managed resilience
   block. The production workflow invokes the same protected trigger once
   after installation and requires a fresh completed `mtm-cleanup` lease; do
   not add a hand-maintained `mtm-cleanup-cron.sh` line. Until that deploy
   proof and a subsequent observed heartbeat exist, retention is **NOT PROVEN
   ACTIVE** and v2 cohort expansion is blocked.
4. The cleanup advances a stream floor and deletes only the selected expired
   change IDs in one short transaction. It processes snapshot items before an
   empty parent and matches both token and observed expiry before deleting an
   expired build lease. Rollback stops the scheduler or rolls back code; never
   lower a retention floor, recreate cache rows, or clear v1/outbox data.

## Media object-storage cohort and rollback

1. Apply `20260829090000_mtm_media_object_storage_foundation` and generate the
   matching Prisma client while every `media` cohort stays disabled. Check that
   `mtm_media_objects` has both `ENABLE` and `FORCE ROW LEVEL SECURITY` before
   any application code can create an object row.
2. Provision a **new private Field media bucket** with Object Lock/versioning,
   TLS-only endpoint and least-privilege service credentials. Do not reuse the
   Hetzner backup bucket, `BACKUP_S3_*`, `AWS_*`, backup retention, or a
   backup writer credential. The app must have only the operations it needs
   for one opaque `mtm-field/v1/*` prefix (PUT/GET/HEAD; purge is not enabled
   by this slice).
3. Leave `MTM_MEDIA_OBJECT_STORAGE_MODE=disabled` until the approved media
   retention duration, Object Lock mode/legal-hold policy and encryption-key
   ownership are stored in the deployment secret manager. With `s3` enabled,
   every `MTM_MEDIA_*` value is required; a partial configuration fails the
   exact cohort closed with controlled `503`, never falls back to local disk.
4. Enroll one verified `(tenant, agent, device)` `media` cohort. Upload one
   photo and one document with durable client IDs, then verify: one PENDING →
   COMMITTED row, opaque object key, no same-request local file, exact replay,
   `429/503 Retry-After`, a Field outbox push while storage is unavailable,
   authenticated photo/document reads, and cross-tenant denial. Do not report
   this evidence as passed until it is actually run.
5. To roll back **new writes**, disable only that exact `media` cohort. Keep
   M3 reader code, media bucket, keyring and metadata for committed objects;
   existing object rows cannot be served by a pre-M3 server. Do not clear the
   mobile media queue, delete PENDING rows, or remove bytes as a rollback.
   Physical purge is intentionally blocked until its separate retention/legal
   hold review is approved and rehearsed.

## S6 evidence and S7 retirement fence

- The 100-tenant/5,000-user scenario requires a staging-only pool of distinct
  tenants, agents, mobile JWTs, active workdays and exact device cohort rows.
  Do not model that load by reusing one token/device: the intended per-user and
  per-device guards would make the result meaningless.
- Run one heavy verification command at a time through
  `/home/codex-alt/.local/bin/codex-heavy-run`, only after checking available
  RAM, swap, disk and user-slice pressure. Cover login jitter, a noisy tenant,
  503/timeout/partial response, process death, database recovery and backup
  cursor replay. Record unrun checks as **NOT RUN**.
- Before the 100-tenant/5,000-user gate, verify the v2 guard's shared Redis
  topology: authenticated `REDIS_URL`, bounded command latency, no eviction of
  active guard keys, normal host clock synchronisation and, for Redis Cluster,
  tenant hash-tag routing for every atomic device/user/tenant batch. v2 fails
  closed with a stream-local `503` when that guard is unavailable; it must
  never fall back to the old in-process limiter. Record the Redis key-capacity
  calculation for ordinary and initial-snapshot budgets. Do not disable rate
  limits to make this scenario pass, and do not claim tenant fairness without
  this evidence.
- Verify bounded retention independently: the three online retention indexes
  are valid, `system_job_leases` shows a recent completed `mtm-cleanup` run,
  each cursor advances across tenants, and the cron response reports bounded
  item/change/lease work. Do not infer this from the route existing in source.
- The owner permits a mandatory old-APK update before sync v2, but that is not
  permission to remove v1 now. The exact S7 policy below is a future cutover
  contract, not authorization to activate it in this read-only-v2 rollout.
- Media object-storage code is schema-first and disabled by default. Its exact
  cohort cannot expand until the separate media section above has complete
  provider/IAM/key/retention evidence; the filesystem is not an object-storage
  substitute.

### Accepted S7 v1 retirement policy — 2026-08-29

1. Record an immutable UTC `mandatoryUpdateAvailableAt` tied to the approved
   release artifact (canonical `versionName`, Android `versionCode` and artifact
   SHA), never to a server deploy or first observation. The release must have a
   verified single authoritative v2 mutation path and outbox replay evidence;
   current v2 is read-only, so this clock is **not started**.
2. The first full UTC day starts at the next `00:00 UTC` after
   `mandatoryUpdateAvailableAt`. v1 then keeps its existing read/write behavior
   for **90 full UTC days**. Afterwards, require **30 consecutive full UTC
   days** before an operator may request a cutover; no request is eligible
   before the end of the 120th full UTC day.
3. The active-fleet source of truth is an external immutable, queryable
   telemetry sink — not application `console.info` alone — containing the
   unsampled authenticated `mobile_apk_observed` bootstrap event and
   `mobile_sync_v1_activity` events from v1 pull/push. Retain it for at least
   **150 days** (the 120-day policy plus a 30-day review/export buffer) and
   attach a signed/exported query result to the cutover review.
   Deduplicate `(tenant HMAC, principal HMAC, UTC day)`. The signed query must
   show zero distinct identities from any `mobile_sync_v1_activity` event
   regardless of its APK claim, zero `mobile_apk_observed` events with
   `protocolPreferred: 1`, and zero bootstrap or v1 events with a missing,
   invalid, `unknown`, unregistered or unsupported release-ledger claim. A
   syntactic claim is only `major.minor.patch[+numericVersionCode]`; it is not
   authoritative until it maps to the approved artifact ledger.
   Headers are census evidence only; they never authorize a client.
4. A future, default-disabled v1 mutation gate must return explicit
   `426 upgrade_required` without acknowledging, mutating or clearing an
   outbox operation. It may be enabled only after the evidence in steps 1–3
   and a separate v2 mutation-authority review; it is not enabled by this
   change.
5. From actual `426` activation, keep v1 endpoint compatibility stubs, schema
   and idempotency rows non-destructively for at least **90 more days**, and no
   shorter than retry/legal-retention horizons. Dropping them remains a separate
   destructive migration review with backup/restore proof.

## Pilot observation and rollback

- Observe per-stream `ok`, `rate_limited`, `unavailable`, resnapshot and
  payload-size telemetry by tenant hash, APK version and response size.
- Compare only read-only v1/v2 route projections for the enrolled device.
  A mismatch blocks expansion; do not add a v2 mutation writer as a workaround.
- `429 Retry-After: 2` means another snapshot builder owns the exact
  device/horizon lease. The client retries the same pull; it does not clear
  its stream cache or outbox. A bounded `429 Retry-After` (at most 60
  seconds) is an actual rate limit.
- On a v2 incident, first disable the exact cohort. The APK returns to its v1
  adapter, while its v2 route cursor/cache may be rebuilt independently. v1
  operations, v1 idempotency and all mutation outboxes stay intact.
- Do not drop v2 tables, triggers, columns, v1 endpoints or old idempotency
  records during rollback. Those are a separate destructive-review decision
  after fleet census and restore evidence.

## Required evidence before expansion

- Targeted protocol, isolation and idempotency checks have passed.
- A physical Android device has passed restart, offline-to-online, scope-loss
  and two-device scenarios for the enrolled stream.
- The bounded load/chaos run has exercised one noisy tenant, `503`, timeout,
  partial page, process death and database recovery. Use
  `/home/codex-alt/.local/bin/codex-heavy-run` only after host-resource
  preflight; do not report it as passed when it was not run.
- Backup restore and cursor replay have been rehearsed.

Until all evidence exists, cohort expansion and any v1 retirement are **NOT
AUTHORIZED**.
