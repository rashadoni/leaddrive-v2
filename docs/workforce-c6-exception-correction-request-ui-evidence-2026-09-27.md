# Workforce C6 exception correction-request UI evidence — 2026-09-27

## Scope and task effect

This bounded follow-up extends the released exception workbench with exactly
one additional server-offered, non-terminal manager action:
`REQUEST_TIME_CORRECTION`. It reuses the released decision-token endpoint and
does not add or change an API, writer, lifecycle rule, schema, migration, RLS
policy, tenant flag or notification path.

The slice advances the visible-action portions of WF-C6-005 and WF-C8-005 from
`PARTIAL` to a narrower `PARTIAL`. It does not complete either task: employee
response/appeal action surfaces, terminal resolution/reopen, real browser
evidence and the full C6 acceptance lifecycle remain open. Progress therefore
stays `81/161`, `14/15`, C5 81%, C6 20% and C9 99%.

An author-independent read-only comparison selected this action over restricted
evidence UI and broader manager-roster work because the backend already issues
a revision-bound scoped token for it, while this client can consume that token
without exposing raw evidence or inventing delivery/correction behavior.

## UI, authorization and privacy boundary

- The existing queue allowlist contains only `ACKNOWLEDGE` and
  `REQUEST_TIME_CORRECTION`. It still hides `REQUEST_EMPLOYEE_RESPONSE`, every
  terminal action and unknown action codes. Exactly one valid eligible action
  must remain after filtering; malformed responses with multiple eligible
  actions fail closed and show no action.
- The action appears only when the server returns its non-empty encrypted token.
  The token is never rendered, logged or stored. The client cannot select a
  case identifier or decision code and sends no employee reason, proof payload
  or free text.
- Selection opens the same inline two-step confirmation with 44-pixel controls.
  The minimized POST body contains only the server token, a stable in-memory
  operation UUID and fixed reason
  `MANAGER_REQUESTED_TIME_CORRECTION_FOR_REVIEW`.
- English, Russian and Azerbaijani copy states that this append-only review step
  does not notify the employee, create or approve a correction, or change
  recorded time, attendance, pay, discipline, evidence or resolution. The
  action name is not presented as a completed correction.
- Stable per-token replay, synchronous pending fences, exact organization/token
  response binding, stale refresh, mandatory-MFA recovery and generic error
  containment are unchanged from the independently reviewed acknowledgement
  UI. Success is accepted only when the server returns the exact requested
  decision code, after which the queue is reread.

The server remains the authority. Before appending the decision it rechecks the
current session capability, mandatory MFA, live granular grant, historical
scope, case revision and lifecycle under the existing shared lock. The client
does not infer authority from queue text or reconstruct a decision request.

## Current verification

- PASS — focused jsdom contract: 8/8 tests cover localization/source fences,
  strict eligible-action rendering, token containment, correction two-step
  confirmation, exact minimized POST/fixed reason, post-success refresh,
  acknowledgement replay, same-tick pending locks, stale refresh and
  mismatched-success rejection.
- PASS — related C6 selection: eight files / 55 tests across queue and decision
  APIs, token/workbench lifecycle, projection labels, scoped read access,
  aggregate-report UI and review-action UI.
- PASS — targeted ESLint for the component and interaction contract.
- PASS — translation parity: 23,602 English leaf keys; RU/AZ missing=0,
  extra=0.
- PASS — EN/RU/AZ JSON parse and diff whitespace checks.
- NOT RUN on Contabo — full local typecheck/build, real browser E2E,
  Android/Gradle, load, physical-device and human-pilot checks. Exact-head CI
  typecheck/static/security gates and a fresh author-independent complete-diff
  review remain mandatory before merge.

The first focused command did not start because Vitest 4.1.2 rejects the
unsupported `--minWorkers` option; it is not counted as a test result. All
reported passes used an existing dependency tree whose `package-lock.json`
SHA-256 exactly matched this worktree at
`54c9be2264ef8e1ec5f8b0d9c545ba868c24de938ee0cf3734f4c475e62c816f`.
The temporary dependency link was removed after every command.

## Release boundary

The implementation is intentionally non-terminal. It does not send a message
to the employee, create a self-service correction request, mutate a workday,
resolve/reopen an exception, activate a policy revision or enable a tenant.
Browser evidence and all physical Android/QR/GPS/biometric, isolated load and
human-pilot evidence remain `NOT RUN`. A clean checkpoint, frozen sub-400 KB
identity, independent zero-finding review, all exact-head required checks and
the normal GitHub `main` deployment path are still required.

## Read-only preflight review GREEN

An author-independent reviewer inspected `origin/main`
`4823fa18b07cb9e27128ef8d8e14c07eae9f0e7a` through the isolated PR #460
release receipt `2eef7aa02241d149bbf480f192d0b03312ca24bb`, the tracked working-tree
delta and this untracked evidence file. The complete preflight scope was nine
paths / 49,312 bytes with SHA-256
`90f85f9104945c347a79ada08c046c88476197aaef43da4ea2dbc7cefc9c3dc8`, below
400 KB. Review returned GREEN with zero P0-P3 findings.

The reviewer confirmed the exact allowlist and multi-action fail-closed rule,
hidden response/terminal/unknown actions, token/UUID/organization/pending and
response fences, minimized fixed-reason POST, exact response-code validation,
truthful EN/RU/AZ copy, a11y contracts and evidence/progress truth. Reviewer
JSON, whitespace, i18n 23,602/0/0, scope fingerprint and production-receipt
readback passed. Reviewer-side Vitest was `NOT RUN` after an external binary
could not resolve the worktree modules; the author's 8/8 and 55/55 results were
not relabelled. This was an uncommitted preflight only; a clean checkpoint and
fresh frozen complete-diff review remain mandatory.
