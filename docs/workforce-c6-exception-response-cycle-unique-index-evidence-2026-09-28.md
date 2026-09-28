# C6 exception-response cycle unique-index evidence — 2026-09-28

Status: `PARTIAL`

Task: `WF-C6-006`

## Bounded claim

This slice adds the database-enforced half of the employee-response cycle
invariant already guarded by the shared writer: at most one non-legacy
response may exist for one exact
`(organizationId, caseId, observedCaseRevision)` tuple.

The migration is one standalone
`CREATE UNIQUE INDEX CONCURRENTLY workforce_exception_employee_responses_org_case_revision_key`
statement. PostgreSQL's default `NULLS DISTINCT` behavior deliberately keeps
multiple legacy rows whose observed revision is unknown. The existing
non-unique organization/case/revision index and Prisma `@@index` remain in
place, and no nullable `@@unique` contract is added to Prisma.

This slice does not choose duplicate winners, delete or update tenant data,
backfill NULL revisions, expose identifiers, change the writer/API/UI/Android
contract, or authorize automatic recovery from dirty production data.

## Global fail-closed fence

The pinned aggregate-only verification query returns twelve numeric fields and
no tenant, case, employee, response, request or operation identifiers. In one
`REPEATABLE READ READ ONLY` transaction under the already validated
`NOSUPERUSER BYPASSRLS` migration role, it uses `row_security=off`, a 1-second
lock timeout, 2-minute statement timeout and 4 MB work memory to verify:

- duplicate non-NULL cycle groups, all rows in those groups and excess rows
  are all zero;
- legacy NULL-revision rows remain informational and do not block the index;
- the exact Prisma ledger name and migration SHA-256;
- absence of unresolved migration rows; and
- the named index's exact table, columns, uniqueness, validity, readiness,
  plain/no-predicate shape and default NULL-distinct behavior.

The same state query and both artifact checksums are verified from the staged
tar before backup/extraction, then from the immutable extracted candidate
immediately before migration. The exact applied ledger/catalog/data
postcondition is required after `prisma migrate status` and before PM2 can
start.

Migration SHA-256:
`bc9c3346fd44151634990b9f7df93ccd4cd313384873029b3901d71608fe91f8`.
State-query SHA-256:
`bd59a9add36d0212968d35930a43b3e8b3ff0fc8bcc60c61e41078b31818535d`.

## Concurrent DDL and recovery contract

The canonical migration-role provisioner and
`docs/MIGRATION_RUNBOOK.md` set database-scoped server defaults of
`lock_timeout=10s` and `statement_timeout=14min`. Immediately before a pending
index migration, deploy opens a fresh raw migration connection with
`PGOPTIONS` explicitly absent and requires exact `10s|14min`. It then runs the
ordinary Prisma schema engine command with the same migration URL. Deploy does
not mutate or repair role configuration and does not assume that libpq-only
`PGOPTIONS` controls Prisma.

An exact failed `23505` ledger row plus the exact named invalid index is
recognized only to produce a contained fatal error. Production deploy never
drops the index, deletes duplicate rows, chooses a winner, or runs
`migrate resolve`. The real-PostgreSQL test documents the operator recovery
sequence with test-only data: remove only the six injected loser fixtures,
drop the exact invalid index concurrently outside a transaction, prove it is
gone, resolve only the exact ledger row as rolled back, replay, and verify the
final index. That procedure is evidence, not automatic production behavior.

## Independent preflight

The first author-independent implementation preflight returned RED with one P1
and no other findings: an injected `PGOPTIONS` was proven only in a separate
`psql` process even though Prisma's standalone schema engine does not inherit
that libpq environment contract. The rejected approach is not merge authority.

The repair removed the conditional `PGOPTIONS` Prisma wrapper. The disposable
PostgreSQL harness now configures its migration role defaults before opening
Prisma connections, observes the inherited values through `PrismaClient`, and
runs Prisma normally. Production only verifies the persistent configuration
created by the canonical provisioner.

A fresh author-independent read-only preflight of the repaired five-path
implementation returned GREEN with P0=0, P1=0, P2=0 and P3=0. It confirmed the
one-statement migration, NULL semantics, double aggregate fence, immutable
hashes, raw role-default proof, ordinary Prisma execution, exact postcondition,
contained 23505 state and absence of automatic remediation. Reviewer changes:
none. A clean frozen complete-diff review is still mandatory after checkpoint.

## Verification

Resource preflight showed 23 GiB RAM, 15 GiB available, zero current memory
pressure and 332 GiB free disk. The package-lock SHA-256 is
`54c9be2264ef8e1ec5f8b0d9c545ba868c24de938ee0cf3734f4c475e62c816f`.

- shell syntax: `bash -n scripts/server-deploy.sh` passed;
- migration/deploy/recovery regression: 17 files / 80 tests passed;
- event-platform immutable asset guard passed with 27 domains, 86 topics and
  5 concrete schemas;
- targeted ESLint for both changed test files passed without warnings;
- Prisma schema validation passed using a non-secret validation URL;
- `git diff --check` passed;
- the mandatory real-PostgreSQL file compiles and discovers 15 scenarios, but
  all 15 are `SKIPPED / NOT RUN` locally without the CI disposable database.

The PostgreSQL scenario pins the dirty state at 3 duplicate groups / 9 rows /
6 excess rows / 3 legacy NULL rows, proves the first deploy fails with exact
23505 and one exact invalid artifact, proves the explicit test-only recovery,
then rejects a new duplicate non-NULL cycle while accepting another legacy
NULL row.

A manual read-only production database probe was `NOT RUN`: the registered
`leaddrive-prod` SSH endpoint rejected this session's public key before any
database command ran. No alternate host or credential path was attempted. The
GitHub deploy's pre-backup global fence remains authoritative and will fail
before extraction if production data, ledger, role defaults or index state is
unsafe.

Full local typecheck/build, real PostgreSQL, browser E2E, Android/Gradle, load,
signed APK, physical-device and human-pilot checks are `NOT RUN` under host
policy. Exact-head PR CI must run the real database proof, full unit baseline,
typecheck, policy and scan gates.

## Scope and progress

The slice starts from deployed main
`29fb2234866c28dd101ad0abaedf8da0548c678e`; its release receipt is checkpoint
`e56b786e01f4899ae5304f1c7a4a0132cdf171b3` on branch
`codex/workforce-exception-response-cycle-unique-index`.

No production database request completed, no production mutation occurred and
nothing was pushed. Progress remains `DONE 81/161`, `GATES 14/15`, C5 81%, C6
20% and C9 99%; `WF-C6-006` stays `PARTIAL` and no task or gate credit is
added. A task-only checkpoint, exact base/head fingerprint, frozen independent
review, sub-400 KB PR, exact-head CI, merge, workflow deploy and exact-SHA
public smoke are still required.

## Frozen-review fence-order correction

The earlier production-probe paragraph is superseded only where it grouped
role defaults into the pre-backup fence. Data, ledger and index state are
checked before backup/extraction and again immediately before migration. The
fresh no-`PGOPTIONS` `10s|14min` role-default check runs after extraction,
immediately before the ordinary Prisma migration. Unsafe defaults therefore
fail before migration and PM2, but are not claimed to fail before extraction.

## Replacement frozen complete-diff review GREEN

Fresh author-independent review returned GREEN with P0=0, P1=0, P2=0 and
P3=0 on exact base/live `origin/main`/merge-base
`29fb2234866c28dd101ad0abaedf8da0548c678e` through clean head
`f674f2c46624ec8cf5d08fc15d8001475c69ddc5`. The reviewer independently
reproduced nine paths / 62,005 plain-binary bytes / SHA-256
`9dd6624545a5397b3fd646a22f744b3ca1cc4354d7cbe93ffd3ffebc1420d8ad`,
well below 400 KB.

All five implementation blobs remained byte-identical to rejected checkpoint
`f4e622dc18ed332362b7876cd0d9e933c4d621e6`; all four corrected document files
preserved that checkpoint as an exact byte prefix. Both factual P3 repairs,
the migration/state hashes, role provisioning and no-`PGOPTIONS` proof,
double fence, exact postcondition, 23505 containment and no-remediation scope
passed. Reviewer `bash -n`, whitespace, Git identity/drift and current
production ping/build-info checks passed.

Reviewer-side dependency-backed tests, ESLint, Prisma validation, real
PostgreSQL, full typecheck/build, browser, Android, load, signed device and
pilot checks were `NOT RUN`; author results were not relabelled. Closing state
was clean and drift-free. This review receipt is documentation-only and still
requires final receipt-integrity review before push.

## PR #480 merge and failed-closed production attempt

Final receipt-integrity review returned GREEN with P0=P1=P2=P3=0 on exact head
`33ea0c353c0be61f837e48a389cc0d7125a05826`. The complete nine-path diff from
base `29fb2234866c28dd101ad0abaedf8da0548c678e` was 66,513 plain-binary bytes /
SHA-256 `4ee528b7b8f08fee4ce990bff8047fc19b02202f6754ce141f3aa3275eec6c14`;
all implementation and prior audit-receipt blobs remained byte-identical.

PR #480 passed `pr-scope`, `static-checks` including the real PostgreSQL
Workforce recovery proof and full unit baseline, `typecheck`, `runner-policy`,
`scan` and the companion tenant-cascade PostgreSQL integration job. It merged
normally at `2026-09-28T13:36:58Z` as main SHA
`4f9d0d715b201ca7b4226fb301d1d3bddbbd2c8d`.

Deploy run `36429869791` passed the 9m20s quality/security job and 17m13s
SHA-bound production build. The atomic step proved the registered production
host, migration-role identity, quiet window, successful tenant-cascade state,
and zero Workforce duplicate/ledger/index artifacts, then created backup
`backup-20260928-155816` and verified the extracted artifact SHA. Immediately
before Prisma it failed closed because a fresh migration-role session did not
match the required `10s|14min` defaults. Prisma did not run, PM2 was unchanged,
and the previous standalone tree was restored. No duplicate rows, index,
migration ledger entry or application data was changed.

The workflow log intentionally did not expose the observed pair, and direct
read-only SSH remained unavailable, so the exact pre-repair values are unknown.
Independent public no-cache reads forced to `13.140.132.245` returned HTTP 200
for ping and exact prior `artifactSha=29fb2234866c28dd101ad0abaedf8da0548c678e`,
confirming that the failed release never became live.

## Migration-role defaults reconciliation working checkpoint

An author-independent failure audit returned P0=0, P1=1, P2=2 and P3=1. It
confirmed one release blocker (no supported update path for an existing role),
an incomplete provisioner postcondition, late detection after backup/extraction,
and insufficient safe diagnostics. It made no file or production change.

The remediation branch starts from exact merged main
`4f9d0d715b201ca7b4226fb301d1d3bddbbd2c8d`. A new artifact-bound helper is
hash-pinned as
`c3661ee726985aaf8da8a29cda90366d0bd2e03107e62d9cc9567ca67433536f`.
Normal deploy extracts it from the staged exact-SHA tar before backup. It
proves the already validated session role/current role/database, accepts only
legacy `0` or already reviewed `10s`/`14min` values, applies only those two
database-scoped defaults as the migration role, and verifies them through a
new session with `PGOPTIONS` absent. Any other nonzero value fails closed and
is reported without credentials. Preflight-only uses read-only `--check`; the
existing immediate pre-Prisma exact gate remains unchanged.

The canonical new-role provisioner now verifies all three defaults it installs,
including `idle_in_transaction_session_timeout=60s`. The real-PostgreSQL
harness exercises refusal of an unexpected 5s lock timeout, the accepted legacy
transition, fresh-session postcondition, idempotent replay, database-only scope,
and non-mutation of the application role before Prisma is opened.

The earlier statements that production “only verifies” provisioner state and
that deploy “does not mutate or repair role configuration” are superseded only
for this exact timeout-default reconciliation. Normal deploy may now change
these two database-scoped role defaults through the hash-pinned allowlisted
helper before backup. All data, response rows, migration ledger state, indexes,
permissions, credentials and other role settings remain outside automatic
remediation; the later exact pre-Prisma gate still decides whether migration
may proceed.

Shell syntax and whitespace checks pass. Dependency-backed unit/ESLint, real
PostgreSQL, full typecheck/build, browser, Android/Gradle, load, signed APK,
physical-device and pilot checks are currently `NOT RUN`; exact-head CI remains
mandatory. Progress remains `DONE 81/161`, `GATES 14/15`, C5 81%, C6 20% and
C9 99%; WF-C6-006 remains `PARTIAL` and no credit is added.

## Replacement reconciliation preflight GREEN

The first remediation preflight returned RED only for two P3 evidence gaps:
the earlier no-repair wording lacked an explicit supersession, and the real
PostgreSQL harness had not executed read-only `--check`. Both are retained as
rejected review history and grant no merge authority.

After correction, fresh author-independent review returned GREEN with
P0=P1=P2=P3=0. It confirmed ordinary `NOSUPERUSER/NOCREATEROLE` self-default
authority, transactional/atomic `ALTER ROLE` statements inside the single
`DO`, exact artifact/hash binding, ordering before backup, non-mutating
preflight mode, strict legacy allowlist, safe diagnostics, unchanged immediate
pre-Prisma gate and absence of credential leakage.

The expanded CI-only database scenario now executes both helper modes: legacy
`0|0` check failure with zero catalog rows, independent 5s lock and statement
refusals, partial database-scoped `10s|0` check failure with byte-equivalent
catalog state, accepted reconciliation, exact check success with unchanged
catalog state, idempotent replay and Prisma inheritance. Locally the file
compiled and discovered all 15 scenarios but they remain `SKIPPED / NOT RUN`
without the approved database.

Local focused verification passed 20 static files / 100 tests, targeted ESLint,
three-file `bash -n`, diff whitespace and the event-platform asset guard (27
domains / 86 topics / 5 schemas). Full local typecheck/build, real PostgreSQL,
browser, Android/Gradle, load, signed APK, physical-device and pilot remain
`NOT RUN`. Exact-head PR and deploy CI are mandatory.

## Frozen remediation review GREEN

Clean checkpoint `eee4ea1699614d50397384d7b0564a3069469882` received a fresh
author-independent GREEN with P0=P1=P2=P3=0 against exact base/live main and
merge-base `4f9d0d715b201ca7b4226fb301d1d3bddbbd2c8d`. Independent identity
matched nine paths / 44,802 plain-binary bytes / SHA-256
`ad9af6c73192bae088103eb4f5b9d6c39039c5de97476dd1acaab95a813f24e1`;
the tree was clean, one commit ahead and drift-free before and after review.

The reviewer reconfirmed the helper checksum, strict unsafe-nonzero refusal,
atomic self-role reconciliation, read-only check mode, fresh-session proof,
exact artifact binding, before-backup ordering, two-default/database-only scope,
idempotence, unchanged later gate and absence of scope or credential leakage.
All three review receipts were append-only. Reviewer shell syntax, whitespace,
targeted Vitest (6 passed / 15 PostgreSQL skipped) and ESLint passed. Real
PostgreSQL, ShellCheck and every heavy gate remained explicitly `NOT RUN`.

## PR #481 remediation and production release

Final receipt-integrity review returned GREEN with P0=P1=P2=P3=0 on exact
head `d768dc167a65123c1a590c0889c841ec8b6205bf`. The complete nine-path diff
from base `4f9d0d715b201ca7b4226fb301d1d3bddbbd2c8d` was 48,325 plain-binary
bytes / SHA-256
`5c1c5c960195ff70bb3b2f75cda5e7b1214a5708fa74f746e6d13d5ad9730aa6`;
all six reviewed implementation/test/runbook blobs remained byte-identical
after the documentation-only receipt.

PR #481 passed `pr-scope`, `static-checks` in 10m37s including the real
PostgreSQL migration-role scenarios and unit baseline, `typecheck` in 14m16s,
`runner-policy`, `scan` and the companion tenant-cascade PostgreSQL job. It
merged normally at `2026-09-28T15:01:32Z` as main SHA
`f6b4c06dad08c72534174a8c004c325c417238cf`.

Deploy run `36440433296` completed SUCCESS at `2026-09-28T15:28:29Z`.
Quality/security passed in 9m17s, the SHA-bound production build and artifact
publication passed in 19m24s, atomic deploy/post-smoke passed, and artifact
retention cleanup passed. On the registered production host, the helper safely
observed legacy `lock_timeout=0` and `statement_timeout=0`, reconciled only
those accepted values and proved a fresh-session `10s|14min` postcondition.
The global duplicate/ledger/index fence passed before backup and immediately
before Prisma. Backup `backup-20260928-172602` was created, migration
`20260928123000_workforce_exception_response_cycle_unique_index` was applied,
and the exact Workforce unique-ledger/data/index postcondition passed before
PM2 completion.

Built-in ping, revision, login and hashed-asset smoke passed. Independent
no-cache requests forced TLS host `app.leaddrivecrm.org` to registered IP
`13.140.132.245`: `/api/v1/ping` returned HTTP 200 `{"ok":true}` and
build-info returned HTTP 200 with exact
`artifactSha=f6b4c06dad08c72534174a8c004c325c417238cf` and
`builtAt=2026-09-28T15:09:20Z`. Release used only GitHub `main` through
`.github/workflows/deploy.yml`; no direct production mutation or alternate
host was used.

Browser E2E, Android/Gradle, load, signed APK, physical-device and pilot
evidence remain `NOT RUN`. Progress remains `DONE 81/161`, `GATES 14/15`,
C5 81%, C6 20% and C9 99%; WF-C6-006 remains `PARTIAL` and no acceptance
credit is added merely for deployment.
