# Workforce C11 — deterministic immutable rehydration evidence

**Task:** `WF-C11-001`

**Base:** deployed main `7347e87eca493b9d663dc8e66096bc7afb603abb`

**Branch:** `codex/workforce-timesheet-rehydration-part6`

**Status:** PARTIAL (implementation candidate; exact-head CI and release pending)

## Delivered contract

The timesheet read and approval paths now reproduce a day only from the full
immutable context captured when the workday started:

- the complete policy definition and hash are verified against every persisted
  denormalized calculation value;
- the complete shift definition and hash are verified, then resolved again for
  the immutable work date and compared with the stored timezone and UTC plan;
- the version-2 workday schedule snapshot is hash-verified and must link the
  same policy, shift, employee, workday and date;
- scheduled calendar state, ordered segments, site references and planned
  break metadata are validated before calculation;
- only actual immutable `PAUSE`/`RESUME` facts subtract time. Planned breaks
  are metadata and never an automatic deduction;
- `TRAVEL` remains an explicit non-payroll schedule mode and never adds or
  removes calculated time;
- expected work remains pinned to the immutable policy across DST changes;
- corrections are replayed from the append-only correction chain, and any
  mismatch with the materialized workday fails closed;
- approval remains blocked by unresolved calculated deviations or C6 cases.

Successful rehydration produces calculation envelope v2. It retains the v1
arithmetic fields and binds them to minimized policy/shift/schedule hashes and
explicit break, travel, calendar, exception and correction semantics. Raw site
names, addresses, geofence geometry and proofs do not enter the calculation or
ordinary export. Existing stored v1 approvals remain hash-verifiable and
exportable; one approval cannot mix v1 and v2 rows.

Legacy workdays with only the historical policy/shift pair remain readable as
workday facts but are explicitly `SNAPSHOT_MISSING`; they cannot look
calculated, approval-ready or export-ready without a complete schedule
snapshot.

## Working-tree verification

- PASS — targeted Vitest covering calculation, immutable rehydration, bounded
  property matrices, approval, server-side approval, legacy/v2 export and the
  Workforce API: **7 files / 75 tests**.
- PASS — independent preliminary consumer regression matrix covering approval,
  legacy export, approved reporting and reconciliation: **4 files / 17 tests**.
- PASS — scoped ESLint for all changed runtime/test files.
- PASS — `git diff --check`.
- GREEN — independent preliminary read-only compatibility audit,
  `P0=P1=P2=P3=0`; no v1-only production consumer was found.

## Explicitly not run

- NOT RUN — full TypeScript, full test suite and production build on Contabo;
  these are mandatory exact-head CI/heavy-worker gates.
- NOT RUN — browser E2E, Android/Gradle, load, signed APK, physical-device and
  human-pilot checks. This backend-only slice does not satisfy or imply them.
- NOT RUN — database apply/migration because this slice changes no schema or
  migration.

## Acceptance boundary

`WF-C11-001` remains **PARTIAL** until the frozen checkpoint receives a fresh
author-independent exact-SHA review, the sub-400 KB PR passes every required
exact-head gate, merges normally, and the resulting main artifact is deployed
and production-verified. No ledger or gate credit is added before that
evidence.

## Frozen integration review

The implementation/evidence checkpoint is
`5f72c200e4d88966a2ff48485839f5b685a5b612`. While its first frozen review
ran, `origin/main` advanced through PR #487 only in four unrelated Social
Monitoring cron paths. A normal conflict-free merge produced integration head
`b3bbf10eb6057c6357f3fec26453480a66caf7bb` on exact current main and
merge-base `20bc83fb1d16b268ecbde9288f8043809651d660`.

A fresh author-independent review of that exact integration range is GREEN
with `P0=P1=P2=P3=0`. The full candidate is exactly 14 paths / 83,413
plain-binary bytes / SHA-256
`e31e7ff1c627cb7ca938716be80d469522ace438719358ded2d20c7c5109ab49`.
All ten WF-C11 runtime/test blobs are byte-identical to the reviewed
pre-integration checkpoint, and the merge added no conflict resolution or
dependency overlap.

Reviewer verification passes 9 targeted files / 81 tests, scoped ESLint for
all ten changed runtime/test paths and exact-range whitespace. Full
TypeScript, full suite/build, browser, Android/Gradle, load, signed APK,
physical-device and pilot checks remain `NOT RUN`; exact-head PR CI is still
mandatory. `WF-C11-001` therefore remains **PARTIAL** and ledger progress
remains `DONE 82/161`, `GATES 14/15` until release evidence exists.

## Exact-head CI finding and repair

PR #488 initially ran at reviewed head
`02b374048534e7d34ebc089d4736028bae423ff8`. `pr-scope`, `static-checks`,
`runner-policy` and `scan` passed, while run `36493981438` correctly blocked
on `typecheck`: the new v1/v2 discriminated calculation union exposed five
legacy test fixtures whose uncontextualized numeric literals widened from
`1` to `number`.

The repair narrows only those fixture discriminator fields with `1 as const`
in the report, approved export/preview and legacy export tests. It does not
change runtime code, weaken the calculation union or update the accepted type
baseline. Post-repair verification passes 11 targeted files / 98 tests,
scoped ESLint and whitespace. Exact-head CI and a new author-independent
review remain mandatory before merge; no completion credit is added.

The repair checkpoint is
`a3178eb8c3a14765316a3afac4e906c0c1a1aafb`. Fresh independent review is
GREEN with `P0=P1=P2=P3=0`. The exact repair delta from the prior PR head is
8 paths / 11,667 plain-binary bytes / SHA-256
`92c4b846d3ec8470c1c2033467b359502f9f2d6f69e467f813d9b11b021f4bf4`;
the resulting full candidate is 19 paths / 97,943 bytes / SHA-256
`ed0feb2c546c7920b2f32741a70a93c5f04775f70519ccc3faa0c99784710be3`.

The reviewer independently corroborated the five CI diagnostics and confirmed
the repair is exactly ten literal-only replacements across the five fixtures,
with no runtime, union, CI script, package or baseline change. Its 11-file /
98-test matrix, scoped ESLint and both repair/full-range whitespace checks
pass. Replacement exact-head CI is still required; `WF-C11-001` remains
**PARTIAL**.
