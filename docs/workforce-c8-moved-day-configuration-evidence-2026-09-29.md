# WF-C8-007e atomic moved-day configuration evidence — 2026-09-29

## Claim boundary

This slice adds forward-only atomic workday moves to the released Workforce
calendar configuration surface. It does not complete `WF-C8-007`, change a
roadmap row to `DONE`, or add a production-readiness gate.

Included:

- strict `MOVE_WORKDAY` create for `ORGANIZATION` and one named active `TEAM`;
- two distinct future dates inside the existing 367-day calendar window;
- one reciprocal `MOVED_DAY_OFF` / `MOVED_WORKDAY` pair, one transaction and
  one pair-level audit;
- exact-pair retry, conflict behavior and deterministic dual-date locks;
- minimized future inventory with a reciprocal paired date;
- explicit fences preventing the legacy MTM PUT/DELETE endpoints from
  creating, converting or independently deleting moved rows;
- localized EN/RU/AZ web controls and updated voice guidance.

Excluded:

- `AGENT` moved days, because request approval can replace a personal
  calendar row and would orphan the other half of a pair;
- update, reversal, delete, repair/backfill and bulk moved-day operations;
- today/past edits, schema or migration changes, Route mutations and
  break-policy authoring;
- browser/AT/contrast/zoom/device acceptance, Android/Gradle, load/chaos,
  signed-device and tenant-pilot evidence.

## Request, target and response contract

`POST /api/v1/workforce/configuration/calendar` now accepts a strict union.
The existing holiday/closure/exception create contract is unchanged. The new
branch requires `operation: "MOVE_WORKDAY"`, exact organization or team scope,
two real distinct dates and a trimmed 1–160-character non-sensitive display
label. Unknown fields, mixed targets, employee scope and internal storage
fields are rejected. The domain writer repeats the organization/team scope
guard so a future internal caller cannot cast an employee draft into an
organization write.

Team scope revalidates and row-locks an active team inside the authenticated
tenant. The list response remains minimized to date, readable kind, display
label and optional paired date. It does not expose row IDs, source, actors,
Route values or audit data.

## Atomicity, precedence and idempotency

Both tenant/date advisory keys are de-duplicated and sorted before either is
acquired. The same lock primitive is used by the existing one-date Workforce
writer. After both locks, team scope takes `FOR SHARE OF team`, then reads only
the target and organization candidates for the two dates.

The source must be an effective HR working day and the destination an
effective HR non-working day under organization/team/default precedence. Each
date independently freezes its already-resolved `routePlanningAllowed`
baseline. The HR move therefore does not silently enable or disable Route
planning.

Creation writes both rows and one `WORKFORCE_CALENDAR_MOVED_DAY_CREATED` audit
inside one Prisma transaction. A failed second insert or audit rolls the first
row back. A database unique collision maps to the same 409 conflict contract.

Only a complete reciprocal `ADMIN` pair with matching scope, dates, kinds,
label, reciprocal links and two non-null server-owned Route baselines is an
exact no-op retry. The frozen Route values are not recomputed on retry because
parent calendar state can legitimately change after the original write.
Partial, mismatched, foreign-provenance, nullable-baseline or occupied state
fails closed and is never repaired implicitly.

## Legacy mutation fence

The legacy `/api/v1/mtm/work-calendar` reader remains available. Its PUT now
returns `409 MTM_CALENDAR_MOVED_PAIR_REQUIRED` before target lookup or mutation
for either internal moved kind or any supplied moved destination. It also
refuses to convert an existing moved row through an ordinary update. Legacy
DELETE returns the same 409 before soft deletion, so one half cannot be
removed independently. Malformed moved input still fails schema validation.

## UI and accessibility source contract

The calendar form offers one explicit “Move workday” operation only for
organization/team scope; internal moved kinds are never selectable. Source
and destination are separate native date inputs with described HR/Route
semantics, the shared label discloses schedule visibility and audit retention,
and the submit action is disabled for equal or missing dates. Switching to
employee scope resets the operation to ordinary override creation.

All ten possible selection/search/draft controls freeze during mutation and
reconciliation. Existing latest-request fencing and honest unknown-outcome
copy remain intact. Inventory renders the reciprocal date without exposing
storage identity. Touch targets remain at least 44 px and the form collapses
from four columns to the existing responsive single-column layout.

## Real PostgreSQL CI proof

`lib-workforce-calendar-configuration-lock-postgres.test.ts` is wired into
both `.github/workflows/pr-checks.yml` and `.github/workflows/deploy.yml` on the
existing PostgreSQL 16 service.

The first proof pauses transaction A after its first real advisory lock, starts
a reversed-date transaction B, observes B in PostgreSQL's advisory-lock wait,
then releases A. Correct sorting lets both finish. Removing sorting makes the
transactions own opposite first keys and produces a real deadlock, so the gate
fails rather than relying on a short negative timer.

The second proof uses a unique temporary schema and two real Prisma clients.
Concurrent exact writer retries must produce exactly two reciprocal rows, one
creation result, one replay result and one audit. A reversed pair then fails
with the occupied-state conflict, and the database must still contain two rows
and one audit. The schema is dropped after the test.

## Author verification

PASS on the current implementation tree:

- exact focused calendar/API/UI/auth/RLS/voice selection: 118 tests passed;
  the selection is `api-mtm-work-calendar`,
  `api-workforce-calendar-configuration`, `lib-mtm-work-calendar`,
  `lib-workforce-calendar-configuration-lock-postgres`,
  `workforce-calendar-configuration-ui-contract`,
  `workforce-calendar-configuration`, `workforce-calendar`,
  `mtm-rls-coverage`, `rls-route-context-coverage`, `voice-guide-coverage`
  and `with-workforce-rls-auth`;
- the two real-PostgreSQL tests in that selection were discovered and skipped
  locally because the CI-only database URL is intentionally absent;
- scoped ESLint on all changed TypeScript/TSX implementation and test paths;
- `npm run i18n:check`: EN source 23,905 leaf keys, RU/AZ missing 0 and extra
  0;
- event-platform workflow asset validation and runner policy validation;
- JSON parsing through translation parity and `git diff --check`.

NOT RUN under the Contabo workload-placement contract:

- the real PostgreSQL gate (mandatory in exact-head PR CI and deploy CI);
- full repository typecheck, production build and full test suite;
- browser, assistive-technology, contrast, zoom and physical-device checks;
- Android/Gradle, load/chaos, signed-device and tenant-pilot gates.

Exact-head GitHub CI and a fresh author-independent full-range frozen review
remain mandatory before merge.

## Roadmap accounting

`WF-C8-007` remains `PARTIAL`: ordered segments and future
organization/team/employee override creation plus organization/team moved-day
create/list are source-complete. Moved-day reversal/delete governance,
general update/delete governance, break-policy authoring and real browser/AT
acceptance remain open. Progress stays `DONE 81/161`, `GATES 14/15`, C8 36%,
overall 59%, with 80 non-DONE rows. No completion or gate credit is claimed by
this checkpoint.

## Live-main reconciliation

The implementation checkpoint `b11798b93` was merged with live `origin/main`
`8c8ca4360285dec692caf7784d805936c276ae1e`. Main contributed only five Social
Monitoring source/test/evidence paths. No calendar implementation, workflow,
locale, test or evidence path overlapped, and the merge completed without a
manual resolution.

On the integrated head, the same exact 11 focused files pass 118 tests with both
real-PostgreSQL cases discovered and skipped locally, scoped ESLint passes,
i18n remains EN 23,905 with RU/AZ 0/0, event-platform workflow assets and
runner policy pass, and `git diff --check` is clean. The fresh independent
review must use this post-reconciliation head and the live-main merge base.

## First frozen-head review RED and evidence repair

Author-independent full-range review of exact clean head
`55b3562ef8e3ee3e3650e20a42e341c53c8d818e` against live main/merge-base
`8c8ca4360285dec692caf7784d805936c276ae1e` returned RED with
`P0=0`, `P1=0`, `P2=0`, `P3=1`.

The sole P3 found that this evidence named only an 11-file category and said
116 tests passed. That count was reproducible with a selection containing an
unrelated lead-qualification copy test, while the stronger relevant selection
uses `mtm-rls-coverage` and passes 118 tests plus two locally skipped
PostgreSQL tests. The exact canonical files are now enumerated above and all
current receipts use 118/2. Earlier 116 statements in append-only roadmap and
session receipts are preserved as history and explicitly superseded by the
correction receipts below them.

The reviewer found no runtime/auth/RLS/atomicity/lock/baseline/replay/audit/
legacy-fence/PostgreSQL-CI/API/UI/i18n issue. Rejected-head identity was 23
paths / 151,576 bytes / SHA-256
`f0417914a5fd76788b7efc89370b8bc2442e147e2900c0a81c5dd6646aceb98c`; non-doc
identity was 19 paths / 120,990 bytes / SHA-256
`649cc46ccc979f90e7438b4d62860f6d43f8a60dfb0db219a6da7ec5ecb98eed`.
This documentation repair does not alter non-doc bytes. The rejected GREEN
authority cannot transfer; a fresh exact-head full-range review is mandatory.

## Replacement frozen-head independent review GREEN

Fresh author-independent full-range review returned GREEN with
`P0=P1=P2=P3=0` on clean exact head
`4f75afff6884b616376085da11e508a8461a607a` against live main/merge-base
`8c8ca4360285dec692caf7784d805936c276ae1e`.

- Full identity matched 23 paths / 157,139 bytes / SHA-256
  `77f4ed3599f5291afa0c611d3c6e15c3de6226096e046fe01a091c93156dbe45`.
- Non-doc identity remained exactly 19 paths / 120,990 bytes / SHA-256
  `649cc46ccc979f90e7438b4d62860f6d43f8a60dfb0db219a6da7ec5ecb98eed`.
- The prior P3 is closed: the exact relevant 11-file selection is enumerated,
  passes 118 tests and discovers two locally skipped PostgreSQL tests; the
  append-only roadmap/session preserve and supersede their earlier 116
  statements.
- Reviewer checks passed focused tests, scoped ESLint, i18n 23,905/0/0, RLS
  scan 553 models / 847 helpers / 0 gaps, event assets 27/86/5, runner policy
  across 38 workflows, JSON, whitespace and append-only-prefix integrity.
- Full runtime/security/concurrency/workflow/API/UI/evidence re-review found no
  other issue. Real PostgreSQL, full typecheck/build/suite, browser/AT/device,
  Android/Gradle, load/chaos and pilot remain `NOT RUN` locally and exact-head
  CI remains mandatory.

This GREEN freezes the reviewed implementation. Only this receipt changes
after that head; a receipt-integrity review must confirm the non-doc identity
before publication.

## PR #506 initial CI finding and remediation

PR #506 published exact head
`618d4c7ba6520d06ab69ac628f6c5acb37369761`. Its `pr-scope`,
`runner-policy`, `scan` and complete `static-checks` jobs passed. The static
job included the mandatory PostgreSQL 16 gate: both real advisory-lock and
concurrent-Prisma-writer proofs passed. The PR-only production build skipped
as designed.

The `typecheck` job correctly blocked that head. It found 67 defect-shaped
file/code pairs against a baseline of 66 and isolated one new error:
`TS2322` at `configuration/calendar/route.ts:167`. TypeScript did not exclude
the moved-day member of the parsed Zod union after the inline `in` check, so
the remaining union was not assignable to the ordinary override writer even
though runtime routing was correct.

The route now uses an explicit `isMovedDayDraft` type predicate over the two
schema-inferred draft types. This preserves the runtime discriminator while
proving the ordinary branch is an override draft. After the repair, scoped
ESLint passes and the two calendar domain/API files pass 44/44 tests.

Full local typecheck remains `NOT RUN` under the Contabo workload-placement
contract; the updated exact-head CI must prove the defect pair returned to
baseline. Because a non-doc byte changed, all earlier frozen-head review
authority is invalidated and a fresh author-independent complete-diff review
is mandatory before republishing. Progress remains `DONE 81/161`,
`GATES 14/15`, C8 36%, overall 59%, with 80 non-DONE rows.

## Post-typecheck-fix independent review GREEN

Fresh author-independent complete-diff review returned GREEN with
`P0=P1=P2=P3=0` on exact clean head
`b42330c0b56ffaa469825675223e466983c0dd08` against live main/merge-base
`8c8ca4360285dec692caf7784d805936c276ae1e`.

- Full identity matched 23 paths / 166,907 bytes / SHA-256
  `7c6d257daeb7834478100d6f0a3dc8b85d9ac2c1df1c6ab182492958352f1d5c`.
- Non-doc identity matched 19 paths / 121,643 bytes / SHA-256
  `aaa7284416a780a59beff4d7b1602ca5aa6a8936c189e926f7e9f2b9e5a52c22`.
- The reviewer confirmed `isMovedDayDraft` is sound for the strict Zod-union
  output, keeps runtime routing unchanged and narrows the false branch to the
  ordinary override type without an auth, tenant or API behavior change.
- Complete runtime/security/concurrency/workflow/UI/evidence review found no
  issue. Reviewer PASS covered 118 tests / 2 local PostgreSQL skips, scoped
  ESLint, i18n 23,905/0/0, RLS 553/847/0, event assets 27/86/5, runner policy
  across 38 workflows, JSON, whitespace and append-only prefixes.
- The reviewer directly confirmed the old-head CI evidence: both real
  PostgreSQL tests passed and the only new typecheck pair was the repaired
  route `TS2322`.

New-head real PostgreSQL and full typecheck remain mandatory in exact-head CI;
build/suite/browser/AT/device/Android/load/chaos/pilot remain `NOT RUN` where
policy or scope excludes them. Only this receipt changes after the reviewed
head, so a receipt-integrity review must confirm the non-doc identity before
push.

## PR #506 replacement CI GREEN and live-main reconciliation

Replacement exact head `f1739b23a633c55b9c036e85eaf86a0176ec3018`
passed all required PR contexts in run `36630565484`: `pr-scope`,
`static-checks`, `typecheck`, `runner-policy` and `scan`. Static checks took
13m34s and passed the mandatory PostgreSQL moved-day proofs plus the repository
unit baseline. Typecheck took 16m07s and returned to the accepted baseline, so
the new route `TS2322` pair is closed. The PR-only production build skipped as
designed.

The mandatory pre-merge fetch then found live main advanced from
`8c8ca4360285dec692caf7784d805936c276ae1e` to
`13d13bcc58e8872ef676fd011e78a1adb954e210` through PR #505. That release added
only Help/Da Vinci guide content, components, contract test and evidence across
12 paths; it did not overlap a calendar, workflow, locale or moved-day evidence
path. The merge completed without manual resolution at
`73e08829b39f9e78f02515ea30bcb5cc6ede3175`.

Against the new live main/merge-base, the task diff is byte-identical to the
reviewed final candidate: 23 paths / 171,486 bytes / SHA-256
`4800c046ba480546981fcbd07eecde12144177ca28c628db77c6519278c693e2`;
non-doc remains 19 paths / 121,643 bytes / SHA-256
`aaa7284416a780a59beff4d7b1602ca5aa6a8936c189e926f7e9f2b9e5a52c22`.
This reconciliation receipt still requires exact-head independent integrity
review and replacement CI before merge. Progress remains unchanged.

## CI run attribution correction

The preceding replacement-CI receipt correctly states that all five required
contexts passed, but incorrectly groups them under one run ID. This append-only
correction supersedes that attribution:

- PR-checks run `36630565484` contains `pr-scope`, `static-checks`,
  `typecheck` and the intentionally skipped PR production build;
- `runner-policy` passed in run `36630565514`;
- `scan` passed in run `36630565512`.

No check result, implementation byte or progress accounting changes. The
rejected reconciliation-review head cannot authorize publication; a fresh
exact-head independent integrity review is required after this correction.
