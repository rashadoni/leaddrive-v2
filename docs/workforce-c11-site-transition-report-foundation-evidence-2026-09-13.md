# Workforce C11 site-transition report foundation evidence

**Status:** WF-C11-007 partial — safe aggregation is implemented; no endpoint
or user-visible site-transition report is claimed by this checkpoint.
**Last verified:** 2026-09-13

## Delivered projection

`buildWorkforceSiteTransitionReport` converts at most 5,000 append-only,
scheduled site-transition claims into reconciled tenant-safe counts. It reports
arrivals, departures, complete arrival/departure segment pairs, incomplete
segments and claims requiring review, grouped by opaque site and employee IDs.

The projection validates every identifier, timestamp, transition kind and
review state. Duplicate arrival or departure facts in the same employee,
workday, segment and site fail closed instead of inflating a count.

## Safety boundary

- A complete pair means workflow completeness, not physical presence.
- Raw coordinates, QR/device proof, distances, evidence verdicts and employee
  reasons are neither inputs nor outputs.
- The projection is not a payroll or disciplinary input.
- Names, authorization, historical scope, tenant timezone, rate limits, audit
  and private response headers remain mandatory work for the future API/UI.

## Verification

- **PASS:** targeted Vitest, 1 file and 4 tests: reconciliation, incomplete
  segments, privacy boundaries, malformed/duplicate/oversized fail-closed.
- **PASS:** targeted ESLint.
- **PASS:** `git diff --check`.
- **NOT RUN:** TypeScript full check, browser E2E, database integration, staging
  reconciliation and load tests; heavy gates are reserved for CI or an
  approved heavy worker.
