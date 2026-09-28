# C6 employee-response cycle deduplication evidence — 2026-09-28

Status: `PARTIAL`

Task: `WF-C6-006`

## Bounded claim

The cooperating web and mobile employee-response writers now allow at most one
immutable response for one tenant/case/decision revision, even when separate
clients submit different operation UUIDs. The first committed operation wins;
a later different operation receives the existing private revision-conflict
contract and appends neither a response nor an audit row.

This is not a global exactly-once claim. No database uniqueness migration is
included: pre-existing duplicate cycles must be inventoried and resolved by a
separately reviewed policy before an online unique constraint can be safe.
Legacy binaries, raw inserts or any path that bypasses the shared writer remain
outside this slice's guarantee.

## Writer contract

The shared writer preserves the existing order:

1. authorize the employee-owned append;
2. take the canonical tenant/case advisory transaction lock;
3. take the employee/operation advisory transaction lock;
4. resolve an exact completed retry before lifecycle validation;
5. validate the bounded lifecycle and caller's presented case revision;
6. validate correction-request topology when applicable;
7. while still holding the case lock, re-read by tenant, case and observed
   revision; and
8. create the response and metadata-only audit atomically only when that cycle
   is empty.

The cycle read uses the existing
`(organizationId, caseId, observedCaseRevision)` index. It returns
`WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_REVISION_CONFLICT` for a different
operation rather than pretending that operation was durably recorded. An
exact same-operation retry remains idempotent even after later resolution, and
a response from an earlier revision does not block a newly requested cycle.
Both existing HTTP adapters already contain that conflict as a private
no-store 409, so no route, response shape or UI change is required.

## Independent review

An author-independent read-only design review inspected clean HEAD
`181224631cc0a968aecf8f6da02943ac11a77e21`, confirmed the different-UUID
same-revision defect and returned GREEN with zero P0-P3 findings for the
bounded contract.

After implementation, the same independent reviewer inspected the complete
three-path working diff and again returned GREEN with zero P0-P3 findings. It
confirmed lock/replay/lifecycle/topology/cycle ordering, current-revision
scoping, absence of a new lock inversion, exact-replay preservation and the
PostgreSQL winner/waiter proof. This is a working-tree preflight; a clean
checkpoint and a fresh frozen complete-diff review remain mandatory before
push.

## Verification

The package lock and borrowed dependency tree both have SHA-256
`54c9be2264ef8e1ec5f8b0d9c545ba868c24de938ee0cf3734f4c475e62c816f`.
Resource preflight showed 23 GiB RAM, 16 GiB available, no swap-in/out during
the live sample and 332 GiB free disk.

- focused employee-response writer: 1 file / 15 tests passed;
- expanded writer, web/mobile route, operation, parser, limiter and rollout
  selection: 7 files / 54 tests passed;
- targeted ESLint for the three changed runtime/test paths passed;
- diff whitespace passed;
- the real-PostgreSQL file compiled and discovered 13 scenarios, including
  the new two-UUID/same-revision race, but all 13 are `SKIPPED / NOT RUN`
  locally without an approved disposable database.

Full local typecheck/build, browser E2E, Android/Gradle, load, signed APK,
physical-device and human-pilot checks are `NOT RUN` under host policy. The
real PostgreSQL proof, full typecheck and normal exact-head PR checks remain
mandatory in CI.

## Scope and progress

No Prisma schema, migration, endpoint, UI, rollout flag, tenant activation,
notification, appeal, terminal decision or production state changed. Progress
remains `81/161`, `14/15`, C5 81%, C6 20% and C9 99%; `WF-C6-006` remains
`PARTIAL` and no task or phase-gate credit is added.

## Current-main integration

Before the frozen review, live `main` advanced from
`09502d1c96b43e30ba6648c6a322cc8f3f01ac44` to
`147369b5027b9dae7b5a6cb25d9f82711fbdb43b` through PR #476 and PR #467.
Their seven paths are confined to MTM demo/map matching and the offline Social
relevance replay; none overlaps or semantically changes the Workforce writer,
tests or evidence paths. Current main was integrated normally and without
conflict as merge commit `0395f7a718f09b14eae8240d05927647d399e4ed`.

On the integrated tree, the related seven-file selection again passes 54/54,
the three-path targeted ESLint check passes, diff whitespace passes and the
PostgreSQL file again compiles/discovers 13 scenarios while remaining locally
`SKIPPED / NOT RUN`. The package-lock identity is unchanged and the temporary
dependency link was removed.

Before this receipt, the complete diff against base/merge-base/current main
was seven paths / 41,889 binary-diff bytes / SHA-256
`a6ad90f92f60c5ab2d01e0a55ea87245f9cfba7f70c807bae80dbdf8f38ea100`.
The prior working-tree review remains useful preflight evidence but is not
frozen merge authority. This receipt must be checkpointed and a fresh
author-independent review must verify the resulting clean complete diff before
push or PR.

## Fingerprint correction after rejected frozen review

The first frozen review returned RED with one P3 evidence finding and no
P0-P2 finding. The preceding `41,889`-byte / `a6ad90f...` value was calculated
with `git diff --binary --full-index`; it is not the project's reproducible
plain `git diff --binary <base> <head>` fingerprint and is superseded, not
deleted.

For exact base `147369b5027b9dae7b5a6cb25d9f82711fbdb43b` and pre-receipt
checkpoint/merge `0395f7a718f09b14eae8240d05927647d399e4ed`, the corrected complete
identity is seven paths / 41,455 bytes / SHA-256
`0e666ed0c59a87e378eabffef9312e20e79c0d5c432c1904c02d5a7cb378f5c1`.
For the rejected frozen-review head
`08f48c948c6c7e760e1ee3be78e0e22c0589244b`, it is seven paths / 46,954
bytes / SHA-256
`b24950e8ea97ae20fe5559ee459c4ca743dd247814741707de0ccef4b547b73b`.

The reviewer otherwise found the complete runtime/test diff GREEN: no
lock-order, replay, revision, delegate, PostgreSQL harness, API containment or
scope defect. That rejected verdict grants no merge authority. This correction
requires a new checkpoint and replacement frozen review from the complete
base/head diff.
