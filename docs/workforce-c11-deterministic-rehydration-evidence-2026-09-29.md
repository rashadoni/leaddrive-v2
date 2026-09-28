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
