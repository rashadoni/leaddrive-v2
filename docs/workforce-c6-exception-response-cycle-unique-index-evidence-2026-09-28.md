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
