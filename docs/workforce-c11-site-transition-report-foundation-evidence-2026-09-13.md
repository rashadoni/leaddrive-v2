# Workforce C11 site-transition report foundation evidence

**Status:** WF-C11-007 partial — safe aggregation and a fail-closed access
contract are implemented; no endpoint or user-visible site-transition report
is claimed by this checkpoint.
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
- Before granular cutover, the access contract preserves the established
  session-administrator boundary. After cutover, a selected employee or site
  requires an exact matching durable attendance-read grant; an unfiltered
  aggregate requires organization scope. A current team grant is never widened
  into a historical report because claims do not snapshot team membership.
- Names, tenant-timezone date reads, rate limits, audit and response shaping
  remain mandatory work for the future API/UI.

## Verification

- **PASS:** targeted Vitest, 1 file and 4 tests: reconciliation, incomplete
  segments, privacy boundaries, malformed/duplicate/oversized fail-closed.
- **PASS:** targeted access-contract Vitest, 1 file and 5 tests: legacy
  compatibility, exact site grant, no team-to-history widening, ambiguous-scope
  rejection and fail-closed fixed-label logging.
- **PASS:** targeted ESLint.
- **PASS:** `git diff --check`.
- **NOT RUN:** TypeScript full check, browser E2E, database integration, staging
  reconciliation and load tests; heavy gates are reserved for CI or an
  approved heavy worker.
