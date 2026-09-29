# Workforce C8 — bounded manager Today evidence

**Task:** `WF-C8-002`

**Base:** deployed main `f95ec02952c425e97a470aba5d2e591ffb5b9486`

**Branch:** `codex/workforce-completion-part8`

**Status:** PARTIAL (working checkpoint; independent review, exact-head CI,
release and real browser/AT evidence remain mandatory)

## Delivered contract

The manager `/workforce` Today surface now starts from the scheduled active
roster rather than from employees who already have a workday:

- the roster is authorized from one bounded grant snapshot before names or
  attendance facts are read, ordered by a stable employee-id cursor and
  limited to 25 rows plus one pagination sentinel;
- current workdays expose a plan only from their hash-verified immutable shift
  snapshot. A missing or corrupt snapshot is `UNAVAILABLE` and is never
  reconstructed from mutable configuration;
- employees without a workday use one bounded batch resolver for personal,
  historical-team and organization schedule precedence. It has no per-person
  database loop and fails overlap, overflow or unstable historical-team
  resolution closed;
- calendar state remains distinct across scheduled, non-working, public
  holiday, tenant closure, approved leave, approved absence and personal
  exception;
- a previous open workday is retained as a review fact. This read never closes
  it, invents a finish or rewrites its date;
- `NO_SHOW` is displayed only when an independently authorized persisted C6
  case projects to an unresolved no-show. This GET neither infers nor creates
  a case;
- `TEAM_ATTENDANCE_READ` does not imply `TEAM_EXCEPTION_READ`. Unauthorized
  exception data is `null`; authorized empty scope is `[]`;
- the manager projection excludes reasons, actors, case identifiers, raw
  evidence, QR/device proof, coordinates and site/location detail and states
  that schedule/work-time claims are not proof of continuous presence;
- responses, denials and unsafe-bound failures use `private, no-store`.

The shared exception queue now uses the same two-phase case-scope resolver.
That closes the prior gap where a schedule-only no-show had neither a workday
nor event instant and therefore could not be authorized for its immutable
historical team. Its planned instant is derived only from the case-bound first
segment, canonical expected date, verified definition hash and template
lifecycle; current directory team, case creation time and tenant midnight are
never substituted.

## Explicit bounds

- roster page: 25 rows plus one sentinel;
- current workdays: one unique row per page employee plus one sentinel;
- prior open workdays: one grouped latest date per page employee, then at most
  50 exact rows plus one sentinel;
- calendar overrides: at most twice the number of employee/team/organization
  scopes on the page plus one sentinel;
- Today exception metadata: 100 cases plus one sentinel;
- shared queue exception metadata: existing 1,000-case bound;
- decision history: 64 decisions per case plus one sentinel;
- shift assignments/defaults/legacy defaults: fixed per-page/tier sentinels;
- historical team correction: at most two batch fixed-point passes.

## Working-tree verification

- PASS — targeted API/helper/UI Vitest matrix: **6 files / 59 tests**.
- PASS — scoped ESLint for all **13** changed TypeScript/TSX runtime and test
  paths.
- PASS — `npm run i18n:check`: 23,765 English leaf keys, `missing=0` and
  `extra=0` for RU/AZ.
- PASS — all three message catalogs parse as JSON.
- PASS — `git diff --check`.
- PASS — initial author-independent helper audit found two P2 resolver defects;
  both were repaired before the route was connected. A complete frozen-diff
  review is still required and this earlier helper audit is not release
  authority.

## Explicitly not run

- NOT RUN — full TypeScript, full test suite and production build on Contabo;
  exact-head GitHub CI/heavy workers are mandatory.
- NOT RUN — real browser E2E, keyboard/AT, contrast, 200% zoom and responsive
  device evidence. The jsdom interaction contract is not a substitute.
- NOT RUN — Android/Gradle, signed APK, physical-device, load and human-pilot
  checks; this web/API slice does not satisfy or imply them.
- NOT RUN — database apply/migration because this slice changes no schema.

## Acceptance boundary

`WF-C8-002` remains **PARTIAL**. Its roadmap definition of done still requires
real browser/AT evidence that a scheduled absent employee is visible and
explained. No completion credit, gate increase or `100%` claim is made by this
working checkpoint. Progress remains `DONE 81/161`, `GATES 14/15`, C8 36%
and overall 59% until independently reviewed release and the remaining
acceptance evidence exist.

## 2026-09-29 frozen review finding and repair

- The first complete author-independent review froze deployed main
  `f95ec02952c425e97a470aba5d2e591ffb5b9486` through implementation head
  `eab14f1d4f7393e7509b46cdf812b3198d470912`: 20 paths / 144,051 binary
  bytes / SHA-256
  `7ea3d6d0862ad5fbaeeb8a3561f67537cb9914451b4146e555592ae86d717fb6`.
  Verdict was RED with `P0=0`, `P1=0`, `P2=1`, `P3=0`.
- The P2 proved that roster authorization's mutable current team also fed the
  display calendar while the live plan was corrected to the historical team
  at planned start. A same-day transfer could therefore hide an old-team
  scheduled shift behind the new team's holiday, manufacture a scheduled
  state on the inverse calendar, or contradict a persisted no-show.
- The live plan resolver now returns its stable historical planned-start team
  context. Calendar overrides are loaded only for those historical teams;
  the current directory team remains roster/authorization metadata and is no
  longer an attendance/display fact.
- Existing workdays no longer consult any live calendar. Their calendar is
  projected only after the complete immutable workday schedule envelope,
  snapshot links, schema and SHA-256 hash verify; missing or corrupt history
  is explicitly `UNAVAILABLE` and fails closed.
- New regressions cover a same-day Team B transfer with a divergent Team B
  holiday while the stable Team A plan/calendar remains scheduled, plus an
  existing snapshotted workday that remains scheduled without a live calendar
  query after transfer.
- PASS — expanded targeted matrix: **8 files / 72 tests**; scoped ESLint on
  all **14** candidate TypeScript/TSX paths; translation parity
  **23,766/0/0**; three JSON catalogs; `git diff --check`.
- NOT RUN — local full typecheck/build/suite, real browser/AT,
  Android/Gradle, load, signed device and pilot under Contabo workload policy.
- `WF-C8-002` remains **PARTIAL** and progress remains `DONE 81/161`,
  `GATES 14/15`, C8 36%, overall 59%. The changed repair head requires a
  fresh complete independent review before publication.
