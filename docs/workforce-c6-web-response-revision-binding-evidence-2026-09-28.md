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
