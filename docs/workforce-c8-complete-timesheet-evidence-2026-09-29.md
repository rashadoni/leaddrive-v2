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
