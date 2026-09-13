# Workforce C7 — historical request-read grants

## Delivered boundary

The request queue is a human-session-only surface. Before granular cutover it
preserves the established employee/manager scope. After
`workforce-granular-access-v1`, a legacy CRM role no longer exposes another
employee's request reason or decision note.

The server first loads at most 1,000 metadata-only candidates, resolves their
team at the immutable request-submission instant (or linked workday start),
and evaluates one bounded persisted-grant snapshot. Leave and absence require
`TEAM_REQUEST_READ`; a time-correction proposal requires `TIME_APPROVE`.
Unknown request types, missing history, malformed grants and unavailable
authorization all fail closed without substituting the current directory team.

Only authorized ids receive a second detail query. Per-record decision and
self-cancellation controls are returned by the server, so a mixed-scope page
cannot inherit one broad client-side `canDecide` flag. An exact employee may
still read and cancel their own pending request, but can never decide it. A
deliberately granted principal remains authorized even without a legacy CRM
actor row.

## Verification

- `PASS` — four focused files, 17 tests after rebasing onto the access-review
  checkpoint: legacy paging/cursor behavior,
  self-service, actor-independent grants, historical-team matching,
  correction-role separation, inaccessible cursor containment and bounded
  batch validation.
- `PASS` — scoped ESLint and `git diff --check`.
- `PASS` — RLS route-context scanner: 0 gaps.
- `NOT RUN` — full build and browser E2E locally; repository CI/heavy runner is
  required by the Contabo host policy.

## Rollout boundary

This checkpoint creates no grant and activates no tenant flag. It changes the
queue only for a tenant deliberately cut over by a later accountable rollout.
