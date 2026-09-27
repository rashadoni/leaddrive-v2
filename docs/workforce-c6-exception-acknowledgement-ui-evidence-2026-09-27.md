# Workforce C6 exception acknowledgement UI evidence — 2026-09-27

## Scope and task effect

This bounded slice connects the existing `/workforce/exceptions` queue to the
already released fixed `POST /api/v1/workforce/exception-decisions` boundary
for exactly one server-offered non-terminal action: `ACKNOWLEDGE`.

It advances WF-C6-005's visible-action requirement and moves WF-C8-005 from
`PLANNED` to `PARTIAL`. It does not complete either task: employee-response and
correction actions, terminal resolution/reopen, real browser evidence and the
full C6 acceptance lifecycle remain open. Progress therefore stays `81/161`,
`14/15`, C5 81%, C6 20% and C9 99%.

An author-independent read-only comparison selected this slice over a
configuration draft-status card because it is the smallest executable change
that advances an open roadmap item without inventing activation, effective
windows, terminal HR decisions or notification behavior.

## UI and privacy boundary

- The UI renders a 44-pixel minimum action control only for an exact non-empty
  server action whose code is `ACKNOWLEDGE`. It deliberately filters
  `REQUEST_EMPLOYEE_RESPONSE`, `REQUEST_TIME_CORRECTION`, terminal and unknown
  codes even if they appear in a future or malformed queue response.
- Selection opens an inline second confirmation step; there is no one-click
  mutation and no modal. The copy states that acknowledgement only appends an
  immutable review step and cannot resolve the case, notify the employee or
  change attendance, evidence, pay or discipline.
- The encrypted token is never rendered, logged or persisted. The client sends
  no case database ID and cannot select a decision code. The POST body contains
  only the server token, one in-memory operation UUID and the fixed
  privacy-safe reason `MANAGER_ACKNOWLEDGED_FOR_HUMAN_REVIEW`.
- No free-text reason is collected, so this new surface cannot become a path
  for coordinates, QR/device proof, medical details or another employee's
  explanation. Prior decision reasons remain absent from the queue.
- The operation UUID and token remain stable after an uncertain network
  failure so an exact retry reaches the writer's idempotent replay path. A
  confirmed response must return the same `ACKNOWLEDGE` code before the client
  reports success, discards the token/UUID and refreshes the queue.
- `404`, `409` and revoked-access `403` outcomes discard the stale action and
  reread the queue with generic localized copy. Mandatory-MFA and rate-limit
  responses keep the same confirmation available for safe recovery. No server
  error text, internal code or identifier is displayed.

The backend remains authoritative. This slice changes no API, authorization,
schema, migration, RLS, writer or lifecycle evaluator. The released endpoint
still rechecks capability, mandatory MFA, live granular grant, historical
scope, exact case revision and lifecycle under the established transaction
lock before any append.

## Localization and accessibility

The acknowledgement, limitations, confirmation, recovery and status copy is
present in English, Russian and Azerbaijani. Native buttons remain keyboard
reachable, action and cancel targets are at least 44 pixels high, the trigger
publishes `aria-expanded`/`aria-controls`, the inline panel is associated with
that trigger, and success/error states use live status/alert roles. The action
column is placed beside case and employee identity rather than after the wide
evidence table.

## Current verification

- PASS — focused jsdom interaction contract: 6/6 tests cover the exact
  allowlist, no token DOM exposure, two-step confirmation, minimized POST,
  fixed reason, stable uncertain replay, stale refresh, generic containment,
  mismatched-success rejection, localization and 44-pixel/source fences.
- PASS — related C6 selection: eight files / 53 tests across the queue API,
  fixed decision API, token, workbench lifecycle, projection/label, scoped read
  authorization, aggregate-report UI and new acknowledgement UI. Six files / 34
  tests and two generated-client API files / 19 tests ran sequentially.
- PASS — targeted ESLint for the component and new test.
- PASS — translation parity: 23,600 English leaf keys; RU/AZ missing=0,
  extra=0.
- PASS — JSON parse and diff whitespace checks.
- NOT RUN on Contabo — full local typecheck/build, real browser E2E,
  Android/Gradle, load, physical-device and human-pilot checks. The exact-head
  GitHub typecheck/static/security gates and an author-independent frozen-diff
  review remain mandatory before merge.

The first attempted focused test invocation did not start because this
worktree has no `node_modules`; it is not counted as a test result. All reported
passes used an existing dependency tree with the exact current
`package-lock.json` hash. The temporary link was removed after every command
without changing its target.
