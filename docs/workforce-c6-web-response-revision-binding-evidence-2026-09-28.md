# C6 web response revision binding evidence — 2026-09-28

Status: `PARTIAL`

Task: `WF-C6-006`

## Bounded claim

This safety slice closes the known web presentation-to-write race for the
existing employee acknowledgement and correction-response endpoint. It does
not add free-text explanation, appeal resolution, Android acknowledgement UI,
an Android outbox, notification delivery, tenant activation or a terminal HR
decision. Progress remains `81/161`, `14/15`, C5 81%, C6 20% and C9 99%; no
task or phase-gate credit is added.

## Revision-bound presentation and write

`GET /api/v1/workforce/exceptions/mine` now exposes
`availableResponseAction={kind:"ACKNOWLEDGE", expectedCaseRevision}` only for a
workday-bound card whose tenant response rollout is available, whose complete
bounded lifecycle projects `NOT_ACKNOWLEDGED`, and whose current session role
is accepted by the matching Workforce write boundary. Schedule-only,
acknowledged, resolved, malformed, gapped, truncated, over-bound,
rollout-disabled and read-only-role contexts receive `null`. The revision is
the contiguous decision count already validated by the canonical projector;
no decision, reason, response or ledger identity is exposed by the GET.

The strict session POST now requires integer `expectedCaseRevision` from 0
through 63 for either allowed response code and calls the shared
revision-bound writer. Tenant, case, employee, workday, segment and actor are
still derived server-side, with a full tenant/case/agent/user authorization
predicate and the existing rollout, rate, self-scope, link and database
topology fences. A new response must match the revision observed after the
canonical case lock; a stale presentation receives a private no-store 409 and
appends neither response nor audit. An exact stored operation and revision
still replays before later lifecycle validation.

## Stable browser retry and reconciliation fence

The browser keeps one UUID per organization/case/revision in memory and
best-effort `sessionStorage`. Network uncertainty or a remount therefore
reuses the same writer operation instead of minting a second immutable row.
An explicit attempt state machine binds request id, organization, case and
operation key:

- `SUBMITTING` synchronously blocks acknowledgement and manual refresh;
- no GET that started before POST completion may reconcile the attempt;
- POST success or a stale-revision conflict moves the same attempt to
  `RECONCILING` with the current GET-request watermark;
- only a later GET for the same organization may release the fence and remove
  the stored UUID after that exact action is no longer presented; and
- organization changes, replacement attempts and unmounts make old async POST
  completions inert, while uncertain failures retain the UUID for exact retry.

This is exact retry safety for one browser operation, not a global exactly-once
claim. Different UUIDs from separate tabs/clients can still target one cycle;
the existing shared limiter bounds that broader disclosed case until a
separately reviewed cycle-deduplication rule or stable Android outbox exists.

## Independent preflight and repairs

The first independent read-only preflight returned RED with one P2: the web UI
generated a fresh UUID on every click, so a lost response or pre-refresh retry
could append twice at one revision. The first repair made the UUID stable, but
the replacement preflight returned RED with one P2: an unrelated or
cross-organization GET could release that fence while POST was still running.
Neither rejected verdict transfers.

After the request/organization/phase/load-watermark repair, a fresh replacement
preflight returned GREEN with zero P0-P3 findings on all ten runtime/test paths.
The reviewer independently matched a 55,872-byte snapshot with SHA-256
`94375be04d8ae91b4af0338654cfc956698070ca91e939bbe98bfe661034690f`
and reconfirmed both repaired races plus the GET/UI/POST/locked-writer bounds.
This is a working-snapshot preflight; a clean checkpoint and fresh frozen
complete-diff review remain mandatory.

## Local verification

The dependency source matched package-lock SHA-256
`54c9be2264ef8e1ec5f8b0d9c545ba868c24de938ee0cf3734f4c475e62c816f`.
The temporary dependency link is removed after checks.

- focused web/mobile revision and UI selection: 8 files / 77 tests passed;
- expanded related regression selection: 15 files / 120 tests passed;
- operation/reconciliation helper plus source contract: 2 files / 7 tests
  passed after the final orchestration repair;
- targeted ESLint for all ten changed runtime/test paths passed;
- tracked and explicit untracked whitespace checks passed;
- the PostgreSQL shared-lock file compiled and discovered all 12 scenarios,
  including the channel-neutral stale-revision race, but all 12 are
  `SKIPPED / NOT RUN` locally without an approved disposable database.

Full local typecheck/build, browser E2E, Android/Gradle, load, signed APK,
physical-device and human-pilot checks are `NOT RUN` under host policy. The
real PostgreSQL gate, full typecheck and normal PR checks remain mandatory in
exact-head CI. No rollout flag or production state changed in this slice.

## First frozen review and current-main refresh

The first clean frozen-head review returned GREEN with zero P0-P3 findings on
base/merge-base `94dce0d423240921d1c3c68c14cb4a135c99e45d` through head
`d46a1ea0fd9385d39f91de25f013359fe2efe4ee`. The reviewer independently
matched 14 paths / 81,937 binary-diff bytes / SHA-256
`c8259ffdf46b152baec011ebe599e5f1138731ae389b9ab4d123eedf6ab40fb3`,
including the inherited PR #470 production receipt, and reconfirmed both race
repairs, revision/auth/privacy bounds, append-only history and evidence truth.

Before release, live `main` advanced through PR #471 to
`f26d5767e92f14300838e4d59ede05c1101cfcc4`. Its six translation and MTM visit
pagination paths do not overlap any of the 14 reviewed Workforce paths. The
current main was integrated normally as merge commit
`e716df985ed2b101536ff2aff7af6e280fdd6b66` without conflict. On the integrated
tree, the expanded 15-file / 120-test regression, ten-path targeted ESLint and
whitespace checks pass again; the 12 PostgreSQL scenarios remain compiled but
`SKIPPED / NOT RUN` locally.

Against the new base/merge-base, the complete Workforce diff remains exactly
14 paths / 81,937 bytes with the same SHA-256 because PR #471 is disjoint. The
old frozen verdict is retained only as historical evidence and is not treated
as current merge authority. This integration receipt must be checkpointed and
a fresh author-independent complete-diff review must return GREEN before push.

## Second current-main refresh

The replacement complete-diff inspection on base
`f26d5767e92f14300838e4d59ede05c1101cfcc4` through clean head
`6a2e807b279182d468ff2dd6124f7f80dcdea7b0` found zero P0-P3 defects and
independently matched 14 paths / 86,905 binary-diff bytes / SHA-256
`e01a49280883e443fe8fef60853917e379db689be3fefbafe528f4626c149cc8`.
That code and evidence result is retained, but its final merge authority was
invalidated when the reviewer's closing remote check found another live-main
advance.

PR #472 advanced `main` to
`494e14f515f0228b00b78fbefc1fd76a1a010c32`. Its 20 CRM Voice, translation
and CRM command paths have no overlap with the 14 Workforce paths. The current
main was integrated normally and without conflict as merge commit
`ff19084bfc3097e584eaecc921e8fc9e8d187039`, whose parents are
`6a2e807b279182d468ff2dd6124f7f80dcdea7b0` and
`494e14f515f0228b00b78fbefc1fd76a1a010c32`.

On this second integrated tree, the expanded related selection again passes 15
files / 120 tests, targeted ESLint for all ten runtime/test paths passes, and
diff whitespace passes. The PostgreSQL file compiles and discovers all 12
scenarios, but all 12 remain `SKIPPED / NOT RUN` locally without an approved
database. The package-lock SHA remains
`54c9be2264ef8e1ec5f8b0d9c545ba868c24de938ee0cf3734f4c475e62c816f`,
and the temporary exact-lock dependency link was removed.

Before this receipt, the complete diff against new base/merge-base/current
main remains exactly 14 paths / 86,905 bytes with SHA-256
`e01a49280883e443fe8fef60853917e379db689be3fefbafe528f4626c149cc8`.
Full local typecheck/build, browser E2E, Android/Gradle, load, signed APK,
physical-device and pilot evidence remains `NOT RUN`. Progress stays `81/161`,
`14/15`, C5 81%, C6 20% and C9 99%; WF-C6-006 remains `PARTIAL`.

The prior review is historical only. This receipt must be checkpointed and a
fresh author-independent review of the resulting exact base/head pair must
return GREEN before any push or PR.
