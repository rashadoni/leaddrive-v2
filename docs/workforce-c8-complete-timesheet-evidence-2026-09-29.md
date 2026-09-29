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
