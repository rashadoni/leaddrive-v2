# C6 exception-response cycle audit evidence — 2026-09-28

Status: `PARTIAL`

Task: `WF-C6-006`

## Bounded claim

This slice adds a read-only, tenant-scoped dry run that inventories historical
employee-response cycles before any database-enforced uniqueness migration is
considered. It reports only four aggregate counts:

- non-NULL `(case, observed revision)` groups containing more than one row;
- all response rows in those duplicate groups;
- excess rows beyond one per duplicate group; and
- legacy rows whose observed revision is NULL.

The report explicitly sets `automaticAction: NONE` and
`uniquenessMigrationAuthorized: false`. It does not return case, response,
employee, workday, request, operation or tenant record identifiers. It does
not repair, delete, backfill, update, lock out writers, change schema, create an
index, enable a cohort or authorize the future uniqueness migration.

## Access and containment

`GET /api/v1/workforce/configuration/exception-response-cycle-audit` uses the
existing session-only organization-wide exception-read boundary:

- Workforce capability is required;
- legacy access is restricted to tenant admin/superadmin;
- after granular cutover, an effective organization-scoped
  `TEAM_EXCEPTION_READ` grant is required; team/site scope is not inflated;
- a currently enrolled mandatory MFA factor is required; and
- an atomic shared Redis budget charges separate principal and tenant buckets
  at 3 and 12 requests per 15 minutes and fails closed when unavailable.

Success, MFA/rate denial, authorization denial and failure responses receive
`private, no-store` and `nosniff`. Storage, timeout and audit failures produce
one generic 503 and a fixed operation label only; no database error or record
detail is reflected or logged.

## Database contract

The complete, unsampled aggregate executes as one tagged `$queryRaw` inside
one repeatable-read interactive transaction. The same transaction fixes
`lock_timeout=1s`, `statement_timeout=5s` and `work_mem=4MB`; Prisma admission
and transaction time are bounded at 2 and 8 seconds. The query explicitly
filters `organizationId`, groups only inside PostgreSQL, uses the deployed
`(organizationId, caseId, observedCaseRevision)` index shape and obtains
`observedAt` from the same transaction snapshot.

PostgreSQL bigint counts are validated and converted to JSON-safe integers.
Missing, negative, unsafe or internally inconsistent results fail closed; a
timeout can never become a zero-count all-clear. Legacy NULL revisions are
counted separately and never treated as a safely unique cycle.

The append-only metadata audit is awaited after the scan transaction and
before the response is released. It contains only report version, mode,
status, snapshot time, the four counts and the two explicit no-action flags.
An audit-write failure blocks disclosure of the report.

## Independent design review

An author-independent read-only review selected this dry-run inventory as the
next bounded prerequisite after PR #477 and found no design blocker. It pinned
the exact organization grant, MFA, two-bucket fail-closed limiter,
transaction-local RLS/timeouts, full aggregate, NULL separation, bigint
validation, audit-before-release ordering and NOBYPASSRLS PostgreSQL proof.
The review did not inspect or approve the later implementation; a fresh frozen
complete-diff review remains mandatory before push.

## Verification

The package-lock SHA-256 remains
`54c9be2264ef8e1ec5f8b0d9c545ba868c24de938ee0cf3734f4c475e62c816f`.
Resource preflight showed 23 GiB RAM, 15 GiB available, zero current memory
pressure and 332 GiB free disk. The exact-lock temporary dependency link was
removed after the checks.

- audit parser/query, rate-limit and API suites: 3 files / 12 tests passed;
- targeted ESLint for all eight runtime/test paths passed without warnings;
- the existing mandatory PostgreSQL file compiles and discovers 14 scenarios,
  including the new restricted-role aggregate proof, but all 14 are
  `SKIPPED / NOT RUN` locally without the CI disposable database;
- both `.github/workflows/pr-checks.yml` and `.github/workflows/deploy.yml`
  already execute that exact PostgreSQL file with the approved database.

The PostgreSQL scenario creates a NOBYPASSRLS application role, enables and
forces response-table RLS, proves an unscoped read sees zero rows, proves an
organization-A context cannot see organization B, verifies exact counts for
both tenants, and checks that the deployed non-unique index is valid, ready,
plain and ordered by organization/case/revision.

Full local typecheck/build, real PostgreSQL, browser E2E, Android/Gradle, load,
signed APK, physical-device and human-pilot checks are `NOT RUN` under host
policy. Exact-head PR CI must run the real database proof, full unit baseline,
typecheck, policy and scan gates.

## Scope and progress

The slice is based on exact deployed main
`6b858b4514e58b1d01c1b027d7ce503a7b39b185`; the preceding PR #477 release
receipt is checkpoint `7f7f2338239ec980cf7de947fb3f618b28f63174` on branch
`codex/workforce-exception-response-cycle-audit`.

No production request was issued and no schema, migration, application data,
UI, mobile code, rollout or production state changed. Progress remains
`DONE 81/161`, `GATES 14/15`, C5 81%, C6 20% and C9 99%; `WF-C6-006` stays
`PARTIAL` and no task or gate credit is added. A clean checkpoint, exact
base/head fingerprint, author-independent frozen review, sub-400 KB PR and
exact-head CI are still required.

## Frozen complete-diff review GREEN

Fresh author-independent read-only review returned GREEN with zero P0-P3
findings on exact base/live `origin/main`/merge-base
`6b858b4514e58b1d01c1b027d7ce503a7b39b185` through clean head
`a864b5bcc756f260679ffa83cbdfd5b56793b3cb`. The reviewer independently
reproduced all 12 paths, 68,483 plain-binary diff bytes and SHA-256
`cd66534e4a30a7fb1705aa4c4b398182c9f3088dde782ed77f1dc23721d83d30`,
below 400 KB, and closed with a no-drift fetch and clean worktree.

The review inspected every runtime, test and document path. It reconfirmed the
session/capability/legacy/granular-organization authorization boundary, MFA,
outer privacy headers, atomic tenant/principal limiter, complete aggregate,
NULL separation, count invariants, same-transaction RLS/timeouts/snapshot,
audit-before-release ordering, absence of identifiers/errors/mutation and the
restricted-role PostgreSQL isolation/count/index/cleanup proof in both
mandatory workflows. Progress and `NOT RUN` claims were accepted without
inflation.

Reviewer-side dependency tests, ESLint, real PostgreSQL, typecheck/build,
browser, Android, load, device and pilot checks were `NOT RUN`; author results
were not relabelled. Separately, the author ran an additional four-file
auth/RLS/MFA/transaction regression after freezing the unchanged head: 46/46
tests passed, alongside the earlier 12/12 new unit/API tests. This receipt is
documentation-only and still requires final blob-integrity review before push.
