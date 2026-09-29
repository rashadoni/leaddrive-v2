# Workforce C8 — bounded manager Today evidence

**Task:** `WF-C8-002`

**Base:** deployed main `f95ec02952c425e97a470aba5d2e591ffb5b9486`

**Branch:** `codex/workforce-completion-part8`

**Status:** PARTIAL (typecheck repair review GREEN; replacement exact-head CI,
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
- employees without a workday and without a readable persisted no-show use one
  bounded batch resolver for personal, team and organization schedule
  precedence. Its explicit live-row rule is one append-only membership
  snapshot at the server resolution instant; it has no per-person database
  loop and fails overlap or overflow closed;
- calendar state remains distinct across scheduled, non-working, public
  holiday, tenant closure, approved leave, approved absence and personal
  exception;
- a previous open workday is retained as a review fact. This read never closes
  it, invents a finish or rewrites its date;
- `NO_SHOW` is displayed only when an independently authorized persisted C6
  case projects to an unresolved no-show. The plan and historical calendar
  team are reconstructed from that validated case-bound schedule context;
  missing, corrupt or conflicting contexts fail plan/calendar closed. This GET
  neither infers nor creates a case;
- for an ordinary live row, the SELF model receives the same exact
  team/template/scope instant selected by Today and revalidates assignment plus
  policy against it. A concurrent or inconsistent resolution fails the action
  model closed instead of combining calendar, assignment or policy from
  different teams. A persisted no-show context is display-only: SELF `START`
  remains disabled until a separately reviewed case/recovery flow exists;
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
- ordinary live-row membership: one bounded append-only batch at the exact
  server resolution instant;
- exception-case historical membership: one bounded batch for the already
  bounded case-candidate set.

## Working-tree verification

- PASS — targeted API/helper/UI Vitest matrix: **9 files / 86 tests**.
- PASS — scoped ESLint for all **16** changed TypeScript/TSX runtime and test
  paths.
- PASS — `npm run i18n:check`: 23,766 English leaf keys, `missing=0` and
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

## 2026-09-29 replacement review findings and repair

- The replacement complete-diff review froze deployed main
  `f95ec02952c425e97a470aba5d2e591ffb5b9486` through clean head
  `b446ed7d3fe246e6a9a2071ebade0b9448d7098b`: 21 paths / 166,274 binary
  bytes / SHA-256
  `9db5aacacf2e59202871a3f5b0c847da97f9f6a6dd32b4031b616e5b83b0ffcf`.
  Verdict was RED with `P0=0`, `P1=0`, `P2=2`, `P3=0`.
- The first P2 showed that the two-pass planned-start fixed point could select
  the wrong plan after a same-day transfer and had no case-bound source of
  truth for an already persisted schedule-only no-show. The fixed-point rule
  recorded above is superseded: ordinary fact-free live rows now use one
  explicit membership-as-of-read context, while an authorized unresolved
  no-show uses only its validated case date, first segment, template lifecycle
  and membership at planned start. Missing or conflicting case contexts are
  `UNAVAILABLE`.
- The second P2 showed that SELF could receive the manager calendar for one
  team and independently resolve assignment/policy for another. Today now
  passes one authoritative team/template/scope context into the employee
  loader; the loader verifies exact template, team, schedule times, timezone,
  name and policy team at that same instant and fails closed on a mismatch.
- PASS — expanded targeted matrix: **9 files / 84 tests**; scoped ESLint on
  all **16** candidate TypeScript/TSX paths; translation parity
  **23,766/0/0**; three JSON catalogs; `git diff --check`.
- NOT RUN — local full typecheck/build/suite, real browser/AT,
  Android/Gradle, load, signed device and pilot under Contabo workload policy.
- `WF-C8-002` remains **PARTIAL**. Progress remains `DONE 81/161`,
  `GATES 14/15`, C8 36%, overall 59%, with 80 non-DONE rows. The repair still
  requires a clean checkpoint and fresh author-independent full-range GREEN.

## 2026-09-29 SELF no-show START review repair

- Fresh author-independent review matched exact clean base/live main/merge-base
  `f95ec02952c425e97a470aba5d2e591ffb5b9486` through head
  `9e812b3f06389573c521ca0d9dcbb19adaa4f66b`: 23 paths / 190,805 binary
  bytes / SHA-256
  `66d20f47c67be331bc18287e8e8f6c75d9635c7dd897e6e391c3ebaae64c0c24`.
  Verdict was RED with `P0=0`, `P1=0`, `P2=1`, `P3=0`.
- The P2 showed that SELF could be offered `START` from historical Team A
  no-show context while the existing POST snapshots a newly accepted start at
  its actual instant, potentially under Team B after a same-day transfer. The
  UI contract and write contract would therefore disagree.
- Persisted no-show plan/team/calendar is now read-only display context. Today
  passes no actionable planned context to SELF, so assignment is
  `UNAVAILABLE` and `START` is disabled. Ordinary no-case live rows retain the
  exact shared context/revalidation path. No raw client template/team identity
  or unreviewed write protocol was added.
- Regressions prove both route selection and employee fail-closed action.
  PASS — expanded targeted matrix: **9 files / 86 tests**; scoped ESLint on
  all **16** candidate TS/TSX paths; i18n **23,766/0/0**; three JSON catalogs;
  `git diff --check`.
- NOT RUN — local full typecheck/build/suite, real browser/AT,
  Android/Gradle, load, signed device and pilot under Contabo workload policy.
- The RED verdict does not transfer to changed source. `WF-C8-002` remains
  **PARTIAL** at `DONE 81/161`, `GATES 14/15`, C8 36%, overall 59%, with 80
  non-DONE rows; a clean checkpoint and fresh independent review are required.

## 2026-09-29 replacement frozen review GREEN

- Fresh author-independent read-only review completed from exact live
  origin/main/local main/merge-base
  `f95ec02952c425e97a470aba5d2e591ffb5b9486` through clean head
  `756731f7d9417e8df16a61414f921025e4aba84a`. Verdict is GREEN with
  `P0=0`, `P1=0`, `P2=0`, `P3=0`.
- Independent identity matched 23 paths / 200,352 plain-binary bytes / SHA-256
  `1ef2da7544b2e9003926b00c31369ddea508ed54a30d010226d48173466586c0`;
  the third-review repair delta is exactly the six claimed paths.
- The reviewer re-audited the complete tenant/access/privacy/bounds/snapshot,
  exception lifecycle/order, pagination, SELF/write-context, UI/i18n and
  evidence surfaces. All three prior P2 classes are closed with no actionable
  finding. The site-scoped exception regression matches current access-control
  semantics and does not widen the SELF roster.
- Reviewer PASS: 9 files / 86 tests, scoped ESLint on all 16 TypeScript/TSX
  paths, i18n 23,766/0/0, all three JSON catalogs and `git diff --check`.
  Live main, merge-base and clean-tree identity were rechecked at the end.
- NOT RUN under Contabo policy: full local typecheck/build/suite, real
  browser/keyboard/AT/contrast/zoom/responsive devices, Android/Gradle,
  signed/physical device, load, pilot and DB apply (no schema change).
- `WF-C8-002` remains **PARTIAL** at `DONE 81/161`, `GATES 14/15`, C8 36%,
  overall 59%, with 80 non-DONE rows. GREEN permits exact-head CI publication;
  it does not substitute for release or real browser/AT acceptance evidence.

## 2026-09-29 PR #491 typecheck failure and payload-type repair

- PR #491 published exact integrity-reviewed head
  `8413cb8a33fabd27ba8c3b0e1685c4e9063fea18`. `pr-scope`,
  `static-checks`, `runner-policy` and `scan` passed; `static-checks` completed
  its PostgreSQL/unit/baseline gates in 14m26s and the scoped production build
  was correctly skipped. Required run `36539911706` failed only `typecheck`
  after 16m12s.
- The blocking baseline reported 39 new `TS2339` and one new `TS2322` in the
  Today route. Conditional empty/query expressions had erased the selected
  Prisma payload shapes, cascading properties to `{}` and the SELF workday to
  `{}` instead of `EmployeeTodayWorkday`.
- The repair defines exact `satisfies Prisma.*Select` constants and generated
  `GetPayload` result types for named agents, today/previous workdays,
  calendar overrides and exception candidate/detail rows. The three parallel
  query results now enter explicitly typed variables. Query filters, limits,
  ordering, parallelism, selected columns, response shape and runtime policy
  are unchanged; no cast or baseline weakening was added.
- PASS after repair: complete 9-file / 86-test matrix, scoped ESLint on all 16
  candidate TS/TSX paths, i18n 23,766/0/0, JSON and whitespace. Full local
  typecheck/build/suite remains `NOT RUN`; replacement exact-head CI must prove
  the compiler repair.
- The previous GREEN does not authorize changed source. `WF-C8-002` remains
  **PARTIAL** at `DONE 81/161`, `GATES 14/15`, C8 36%, overall 59%, with 80
  non-DONE rows; fresh repair/full-range review is mandatory before push.

## 2026-09-29 post-typecheck-repair review GREEN

- Fresh independent repair and full-range review returned GREEN with
  `P0=P1=P2=P3=0` on exact clean head
  `43cf8a9836803b91e0303335b153258bab89922a`; live origin/main/local main and
  merge-base remain `f95ec02952c425e97a470aba5d2e591ffb5b9486`.
- Full identity independently matched 23 paths / 212,220 bytes / SHA-256
  `226af4b828799971a976d173b593eb81768bdf12aa734ea7f532492327d5f3a0`.
  Repair identity independently matched exactly four paths / 18,150 bytes /
  SHA-256
  `07fce38abdbd44c41c7b51843b06a684ffdc3af5cca5c6e2c89f4804f31ae162`.
- The reviewer verified exact generated Prisma payload compatibility, the
  groupBy structural assignment and all three parallel results. Zero-agent
  no-query and nonzero Promise.all concurrency remain unchanged; no cast,
  `any`, `unknown`, suppression or baseline weakening was added. Every filter,
  order, bound, selected column, query count and response field is unchanged.
- Independent PASS: 9 files / 86 tests, scoped ESLint 16/16, i18n
  23,766/0/0, JSON and full/repair whitespace. Prior P2 closures and
  append-only continuity remain valid; tree and live main were rechecked.
- Full local typecheck/build/suite and browser/device/load/pilot gates remain
  `NOT RUN`; replacement exact-head CI must prove the compiler repair.
  `WF-C8-002` stays **PARTIAL** with unchanged progress and no new credit.

## 2026-09-29 PR #491 release receipt

- Replacement PR head `9f7e5f2d622b6b6f4faf4d5651c8625764a6ec8e` retained the
  independently reviewed runtime/test blobs and passed every required context:
  `pr-scope`, `static-checks`, `typecheck`, `runner-policy` and `scan`.
  PR-check run `36543790838` completed `static-checks` in 8m08s and
  `typecheck` in 15m35s; the scope-conditioned production-build job was
  correctly skipped. Runner-policy run `36543790711` and secret-scan run
  `36543790785` also passed.
- GitHub merged PR #491 normally into `main` as
  `13dc3a179c8f5c0148c5f96d9e64c29815cd9d76`; no protection bypass, force
  push or direct production copy was used.
- Exact-SHA deploy workflow `36545693169` completed SUCCESS. Its quality and
  security job passed in 11m06s, SHA-bound production build/publish passed in
  17m15s, and atomic production deploy plus workflow smoke passed in 6m24s.
- Independent no-cache TLS checks pinned to approved production
  `13.140.132.245` returned `/api/v1/ping` as `{"ok":true}` and
  `/api/v1/public/build-info.artifactSha` as the exact merged main SHA
  `13dc3a179c8f5c0148c5f96d9e64c29815cd9d76` (`builtAt`
  `2026-09-29T09:00:10Z`).
- Real browser/keyboard/AT/contrast/200%-zoom/responsive-device evidence is
  still `NOT RUN`; Android/Gradle, signed/physical device, load and pilot are
  also `NOT RUN` under the placement policy. Therefore `WF-C8-002` remains
  **PARTIAL**, and progress remains `DONE 81/161`, `GATES 14/15`, C8 36%,
  overall 59%, with 80 non-DONE rows.
