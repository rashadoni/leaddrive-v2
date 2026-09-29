# Workforce C8 — complete timesheet review evidence

**Task:** `WF-C8-004`

**Base:** deployed main `eab1c60de3e56e4ea26001c9ddfd01fc603524a5`

**Branch:** `codex/workforce-completion-part7`

**Status:** PARTIAL (working checkpoint; frozen independent review and release
evidence remain mandatory)

## Delivered contract

The existing session-only Workforce timesheet now presents one bounded review
model alongside its deterministic plan and fact calculation:

- event and site-transition evidence states are reduced to the finite
  `NOT_RECORDED`, `NOT_REQUIRED`, `PENDING_REVIEW` and `LEGACY_UNKNOWN`
  vocabulary with fail-closed precedence;
- calculated exceptions expose only allowlisted type/status pairs;
- C6 cases derive their current lifecycle only from a complete contiguous
  decision stream. Unknown, non-contiguous or truncated history becomes
  `DATA_INTEGRITY_REVIEW` instead of a guessed business outcome;
- exact employee-and-period approval history is rebuilt from stored immutable
  rows, hash-verified revision by revision and checked as one contiguous
  approval/correction chain. Historical calculation v1 and current v2 are
  supported, while downgrade, branch, mixed scope or tampering fails closed;
- the browser renders localized EN/RU/AZ plan, fact, evidence review,
  exceptions and the minimized approval/correction revision sequence;
- approval readiness remains bound to completed workdays whose immutable
  snapshots can be rehydrated. A missing or invalid snapshot still cannot look
  approval-ready.

The route reads every new source under the authenticated tenant and existing
Workforce access decision. Approval history is queried only for one explicitly
selected employee and exact period; the all-employee view does not read that
ledger. The response excludes approval IDs, employee/workday IDs from the
revision projection, hashes, immutable rows, correction reasons, decision
reasons, actors, proof payloads, coordinates and reversible location detail.
It does not claim physical presence, payroll correctness or a disciplinary
outcome.

## Bounds and failure behavior

- timesheet period: at most 93 days (existing route contract);
- evidence events/transitions: at most 1,000 of each per workday projection;
- calculated exceptions and C6 cases: at most 500;
- C6 decision history: at most 64 complete decisions per case, with one
  fetched sentinel used to detect truncation;
- approval/correction history: at most 64 revisions and 93 immutable rows per
  revision;
- more than 500 cases returns `413`; unknown or unverifiable read-model data
  returns safe `409 WORKFORCE_TIMESHEET_READ_MODEL_INVALID`.

No schema, migration, write path, permission vocabulary, rollout flag or
production configuration changes in this slice.

## Working-tree verification

- PASS — targeted Vitest matrix: **16 files / 121 tests**, covering the
  Workforce route, finite read model, v1/v2 approval hashing, approval service,
  immutable rehydration, export/report consumers and UI source contracts.
- PASS — scoped ESLint for all six changed runtime/test TypeScript files.
- PASS — EN/RU/AZ translation parity: **23,734** English leaf keys,
  `missing=0`, `extra=0` for both locales.
- PASS — all three message catalogs parse as JSON.
- PASS — `git diff --check`.

## Explicitly not run

- NOT RUN — full TypeScript, full test suite and production build on Contabo;
  exact-head CI/heavy workers are mandatory.
- NOT RUN — real browser E2E, keyboard/AT, contrast, 200% zoom and responsive
  device evidence; these remain separate C8/C14 acceptance evidence.
- NOT RUN — Android/Gradle, signed APK, physical-device, load and human-pilot
  checks; this web/API slice does not satisfy or imply them.
- NOT RUN — database apply/migration because this slice has no schema or
  migration.

## Acceptance boundary

`WF-C8-004` remains **PARTIAL** at this working checkpoint. It may move to
`DONE` only after a clean checkpoint receives a fresh author-independent
complete-diff review, the sub-400 KB PR passes every required exact-head gate,
merges normally, and the merged main artifact is deployed and verified on the
only approved production target. Progress therefore remains `DONE 80/161`,
`GATES 14/15`, C8 27% and overall 58% until that evidence exists.

## Frozen review RED and replacement repair

The first clean checkpoint was
`6b46c38ea93272d5130de8a94e2fe128b53ca117`. A fresh author-independent
review verified base/current main/merge-base
`eab1c60de3e56e4ea26001c9ddfd01fc603524a5` and the complete 13-path /
94,821-byte diff with SHA-256
`d4b5e413e4926e96874dd2bd48903e457a3ddbb83857cfde4780a845eba569cb`,
then returned **RED** with `P0=0`, `P1=1`, `P2=4`, `P3=0`:

- a valid schedule-only `NO_SHOW` with no workday was omitted even though the
  canonical approval service blocks it;
- stale calculation-version exceptions were presented as current;
- event, transition and calculated-exception limits were enforced only after
  unbounded query materialization;
- visible unresolved exceptions did not disable client approval readiness;
- a successful approval/correction did not refresh the displayed revision
  chain.

No authority transfers from that RED verdict. The replacement repairs every
finding without weakening the canonical approval service:

- period-bound schedule-only cases are queried even with zero workdays and
  returned as a separate minimized employee/date/type/status collection;
- calculated exceptions are selected with `calculationVersion` and retained
  only when they match the rehydrated calculation or its v2 core version;
- Prisma reads stop at explicit request sentinels: 20,000 events, 10,000 site
  transitions and 5,000 calculated exceptions, plus one overflow row; overflow
  returns safe `413 WORKFORCE_TIMESHEET_READ_LIMIT_EXCEEDED`;
- unresolved linked or schedule-only exceptions make the selected period
  visibly not ready and disable the approval action;
- a successful approval/correction increments the existing read retry and
  reloads the hash-verified revision history.

Replacement author verification passes 18 targeted files / 132 tests, scoped
ESLint for all six changed TypeScript files, JSON parsing, EN/RU/AZ parity at
23,737/0/0 and whitespace. Full local typecheck/build/suite, browser/AT,
Android/Gradle, load, signed-device and pilot checks remain `NOT RUN` under
host policy. A new clean checkpoint and a fresh complete-diff independent
review remain mandatory; `WF-C8-004` is still **PARTIAL** and progress remains
`DONE 80/161`, `GATES 14/15`, C8 27%, overall 58%.

## Replacement review RED and preview-lifecycle repair

The first replacement checkpoint was
`ab289618132908ce00c0d5bfcda759332e9b9f67`: base/current main/merge-base
remained `eab1c60de3e56e4ea26001c9ddfd01fc603524a5`; the complete 13-path /
116,103-byte diff had SHA-256
`f3b8e3a176c758835dd2029bcef20e4dfa7cb17825da12d56fb536831af61c90`.
A new full author-independent review did not inherit the earlier verdict. It
confirmed the original P1 and four P2 repairs, but returned **RED** with one
new lifecycle finding: `P0=0`, `P1=1`, `P2=0`, `P3=0`.

The successful approval path started the required history refetch, but the
global loading branch temporarily unmounted `TimesheetApprovalPanel`. That
destroyed its local, server-returned approval ID; because the minimized history
projection intentionally contains no IDs, approved-export preview could no
longer be opened after the refetch.

The repair gives an approval-triggered retry an exact retry-number marker,
keeps the existing timesheet and panel mounted while that background request
runs, and retains the local approval record/preview control. A successful
request still replaces the period data and verified history. If only the
background refresh fails, the last verified data and approval record stay
mounted and a generic localized load toast is shown; ordinary initial/manual
load failure behavior is unchanged. A source lifecycle regression asserts the
background render condition, stable panel key, retry marker and preservation
failure branch.

The statements above that all five initial findings were repaired remain true
for those findings, but did not authorize release and are superseded as a
completeness claim by this newly found P1 and its repair. A clean replacement
checkpoint and another fresh complete-diff independent review remain
mandatory. `WF-C8-004` stays **PARTIAL** with progress `DONE 80/161`,
`GATES 14/15`, C8 27%, overall 58%.

## Lifecycle repair verification

The complete bounded author matrix after the preview-lifecycle repair passes
18 files / 133 tests. Scoped ESLint for all six changed TypeScript files, all
three JSON catalogs, EN/RU/AZ parity at 23,737/0/0 and whitespace also pass.
Full local typecheck/build/suite, browser/AT, Android/Gradle, load, signed APK,
physical-device and pilot checks remain `NOT RUN` under host policy. No
completion credit is added before a fresh frozen GREEN and release evidence.

## Third review RED and exact-request lifecycle repair

The second replacement checkpoint was
`cb5f31419a73e2b8bf1a2c9c749515e9cadcf01a`. A third fresh full-range
author-independent review verified the complete 13-path / 127,919-byte diff,
SHA-256
`984184f4d8327294c8864e0ae1f9eb7c2888aaad97afd5eb5e6002840e07c8fc`,
and returned **RED** with `P0=0`, `P1=1`, `P2=0`, `P3=0`. It found no new
server-model, authorization, privacy, bounds, hash-chain, C6, i18n or
accessibility issue.

The P1 showed that the retry-number marker was never consumed and the render
condition retained the old panel for every timesheet load, not only for the
approval-triggered request. A later filter/manual/organization load could
therefore expose an interactive old approval surface, and a failure could keep
stale data instead of entering the ordinary error state. This supersedes the
earlier claim that ordinary load behavior was unchanged; that claim was not
release authority.

The repair now gives every read an identity over view, tenant, retry and exact
timesheet query. A small lifecycle object tags only the next approval refresh,
survives a cancelled Strict Mode effect restart, consumes the tag after live
success/failure, and discards it when a different view, tenant, filter or
manual retry replaces the request. Loaded data carries the identity that
produced it, so an ordinary transition hides the prior panel before its effect
runs. A tagged failure deliberately rebinds the retained verified data to that
single settled request; the following ordinary load again has normal
hide/clear/error behavior. Approval is disabled and guarded throughout the
tagged background load.

Five behavioral lifecycle regressions cover exact tagging, successful
replacement, retained tagged failure followed by an ordinary filter load,
Strict Mode abort/restart, and tag discard on a competing query. Together with
the updated UI integration contract, the focused check passes 2 files / 11
tests and scoped ESLint. The complete bounded matrix, clean checkpoint and a
new full-range review remain mandatory. `WF-C8-004` stays **PARTIAL** at
`DONE 80/161`, `GATES 14/15`, C8 27%, overall 58%.

## Exact-request repair verification

The complete bounded post-repair author matrix passes 19 files / 137 tests,
including the prior 18-file consumer/read-model matrix plus the new behavioral
lifecycle suite. Scoped ESLint passes for all eight changed runtime/test
TypeScript paths; EN/RU/AZ parity remains 23,737 English leaf keys with
`missing=0`, `extra=0`; all catalogs parse and `git diff --check` passes.
Full local typecheck/build/suite, browser/AT, Android/Gradle, load, signed APK,
physical-device and pilot checks remain `NOT RUN` under host policy. A clean
checkpoint and fourth fresh full-range independent review remain mandatory;
no completion credit is added.

## Fourth review RED and submission-to-refresh interlock

The third replacement checkpoint was
`c1422649d8044658409295b9aeb840960f56da0a`. A fourth fresh full-range
author-independent review verified base/current main/merge-base
`eab1c60de3e56e4ea26001c9ddfd01fc603524a5` and the complete 15-path /
150,087-byte diff with SHA-256
`f9a9605ce9b337fdc424125009b3e678f7554bb2290e4feaf350b760ec53b8d2`.
It returned **RED** with `P0=0`, `P1=1`, `P2=0`, `P3=0` and no other new
finding.

The P1 was a remaining race before the tagged GET existed: while the approval
POST was pending, header refresh and timesheet filters were disabled only by
read loading. A competing ordinary reload could unmount the panel; the POST
would then resolve into the old component instance and its returned approval
ID would again be unavailable to the remounted privacy-minimized view.

The lifecycle now owns one synchronous busy interval from the first approval
submit instruction through settlement of its exact tagged refresh. Generic
reload and filter handlers fail closed while busy; repeated approval submits
are rejected before transport; navigation, refresh, filters, correction input,
approval and preview controls expose/observe the same interval. The tag keeps
that interval active after POST completion and before the read effect has set
its loading state, then releases it only on live refresh settlement. A new
behavioral race regression proves that a second submission and competing work
remain blocked across the POST-to-GET handoff.

The focused lifecycle/UI check passes 2 files / 13 tests and scoped ESLint.
The complete bounded matrix, new checkpoint and fifth fresh full-range review
remain mandatory. `WF-C8-004` is still **PARTIAL** at `DONE 80/161`,
`GATES 14/15`, C8 27%, overall 58%.

## Submission-interlock verification

The first complete rerun correctly exposed one stale source-contract
expectation for the preview guard; the contract was updated to require the new
busy check. The replacement complete matrix passes 19 files / 139 tests.
Scoped ESLint passes for all nine changed runtime/test TypeScript paths; JSON,
EN/RU/AZ parity at 23,737/0/0 and whitespace pass. Full local
typecheck/build/suite, browser/AT, Android/Gradle, load, signed APK,
physical-device and pilot remain `NOT RUN` under host policy. No completion
credit is added before a clean checkpoint, fifth fresh GREEN and exact-head
release evidence.

## Fifth independent review GREEN

Clean checkpoint `b506cad5cbced9c131cffd738adc46a9e590753b` received a fresh
complete-diff author-independent **GREEN** with `P0=P1=P2=P3=0`. The reviewer
independently confirmed base/live main/merge-base
`eab1c60de3e56e4ea26001c9ddfd01fc603524a5` and measured 16 paths / 164,032
binary bytes / SHA-256
`d76bd9a9c1f315eb9511143c48ab01982ab36d5a88e250da90336144a6513467`.

The review re-audited the entire candidate rather than inheriting earlier
verdicts: tenant and read authority, privacy projection, request sentinels,
schedule-only `NO_SHOW`, calculation-version filtering, C6 history integrity,
v1/v2 approval hash/chain rules, approval readiness, UI/i18n/a11y and
append-only continuity records. It specifically proved the synchronous
submission-to-refresh interlock, exact identity handoff, Strict Mode restart,
success/failure settlement, subsequent ordinary-load behavior and the
reachable explicit-period invariant. No finding remains.

Reviewer verification passes 19 files / 139 tests, scoped ESLint for nine
changed TypeScript paths, JSON, i18n 23,737/0/0, exact-range whitespace and
append-only journal prefix. Full typecheck/build/suite, browser/AT,
Android/Gradle, load, signed APK, physical-device and pilot remain `NOT RUN`
locally and must not be inferred. `WF-C8-004` remains **PARTIAL** and progress
stays `DONE 80/161`, `GATES 14/15`, C8 27%, overall 58% until exact-head CI,
normal merge, deploy and production SHA verification complete.
