# Workforce C11 approved-export preview evidence

**Status:** WF-C11-005 complete

**Date:** 2026-09-13

**Scope:** preview one newly recorded immutable approval before its matching
direct-session HR-record export.

## Contract

The no-store preview endpoint applies the same controls as the approved export:

- authenticated Workforce session and current MFA;
- fixed `HR_RECORD_REVIEW` purpose and the shared export rate limit;
- current granular export-custodian and historic employee-scope authorization;
- tenant and employee binding before selecting immutable approval rows;
- row/fact hash verification through the ordinary time-fact-only export
  projection.

The preview never reads current workdays or raw attendance proof. It shows the
named employee, period, row count, approval/correction revision, exact ordinary
time-fact rows and warnings that site/location/QR/device evidence is excluded
and overtime is not a payable calculation. It also states that no persistent
artifact has been created: the matching export is a direct session download
for HR record review.

The UI does not infer export permission from a browser role. After an approver
records a revision, it asks the server for that immutable id; the server remains
the authority for export-custodian scope. The response is allowlist-parsed
before rendering, including fixed delivery values, warning codes, row types and
the server-declared row count. Unknown or malformed payloads fail closed.

The server appends `WORKFORCE_TIMESHEET_APPROVED_EXPORT_PREVIEWED` with hashes,
period, revision, count, purpose, recipient and explicit excluded site scope.
The audit record contains no rows, coordinates, QR/device proof, free-text
reason or correction reason.

## Verification

- **PASS:** targeted preview API and UI-contract Vitest: 2 files, 9 tests.
- **PASS:** targeted ESLint for the preview route, workbench and tests.
- **PASS:** `npm run i18n:check`: 22,498 EN leaf keys; RU/AZ missing=0,
  extra=0.
- **PASS:** `git diff --check`.
- **NOT RUN:** full TypeScript program check, full build and browser E2E on the
  Contabo development host; these are reserved for the pull-request gates.

This closes the preview requirement only. External encrypted artifact delivery
and expiry remain explicitly open under WF-C11-004.
