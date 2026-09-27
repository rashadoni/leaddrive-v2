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

- PASS — focused jsdom interaction contract: 7/7 tests cover the exact
  allowlist, no token DOM exposure, two-step confirmation, minimized POST,
  fixed reason, stable uncertain replay, stale refresh, generic containment,
  mismatched-success rejection, deferred cross-row locking, localization and
  44-pixel/source fences.
- PASS — related C6 selection: eight files / 54 tests across the queue API,
  fixed decision API, token, workbench lifecycle, projection/label, scoped read
  authorization, aggregate-report UI and new acknowledgement UI.
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

## Clean implementation checkpoint

The eight task-owned implementation/test/translation/evidence paths were
checkpointed as `5aec9991df5bf50ce9b2034183341069097df236`; a one-line trailing-blank
evidence repair was preserved separately as
`02c795f702b1ef4b22c89377a1cb9111b2f8dbd8`. The worktree was then clean.

A fresh fetch kept base, merge-base and current `origin/main` at exact deployed
SHA `86fc1d2c23fead588b45c2e700e125a6d98bbe82`. The preliminary complete
base-to-head diff, including the preceding PR #459 release receipt, was nine
paths / 72,880 binary-diff bytes with SHA-256
`9a86e899d0a1ff6ba40b0198eda44e910e5b7d80e2dc36b786654214220eaacb`,
below the 400 KB review boundary.

This append-only checkpoint receipt supersedes that preliminary identity. No
runtime/test/translation path changed after the final 6/6 interaction rerun,
targeted ESLint, translation parity and diff check. A replacement clean head
and fresh author-independent complete-diff review remain mandatory before any
push.

## First frozen review RED and bounded repair

The first clean frozen identity was base/main
`86fc1d2c23fead588b45c2e700e125a6d98bbe82`, head
`2bb994de07f381bf6a47eef6977dccb749268748`, nine paths / 76,058 bytes and
SHA-256
`d83e6a0a8c9b56f0728617c1c87070debfbe0e0a2516853c5f4aff43322cba0e`.
Fresh author-independent review returned RED with one P2 and no P0/P1/P3:
while a POST was pending, another action trigger could replace the selected
token/UUID, and reopening the same token after an uncertain failure minted a
new UUID rather than preserving the exact replay identity.

The repair adds a synchronous in-memory submission fence in addition to the
rendered disabled state, disables every action trigger/refresh/cancel during
the pending POST, caches one operation UUID per server token until
reconciliation, and binds response handling to the exact token, organization
and request object that started the POST. Organization changes or unmounts
invalidate the pending marker, so an old asynchronous result cannot update a
new panel. Confirmed success is now literal `success === true` plus the exact
returned action code.

The interaction test now closes and reopens an action after an uncertain
failure and proves the same token/UUID body is replayed. A deferred two-row
test proves all triggers/refresh/cancel stay disabled, a cross-row click cannot
replace the pending action, only the first token is submitted and the queue
refresh starts after settlement. The complete related selection passes eight
files / 54 tests; targeted ESLint passes. The earlier RED identity and checks
do not transfer: a clean repair checkpoint and fresh complete-diff rereview are
required before push.

## First replacement frozen review RED and cancel-fence repair

The first replacement clean identity was base/main
`86fc1d2c23fead588b45c2e700e125a6d98bbe82`, head
`c3aac962ff55fab9107e08852c1de1c190e9029b`, nine paths / 85,303 bytes and
SHA-256
`8f4a7e8c9f3259aefecf6a2e5a809e49c94e5043ef27cc453adadcdccfc52bee`.
Fresh author-independent replacement review returned RED with one P1 and no
other P0-P3 finding. The cancel button passed `closeAction` directly to React,
so the click event was interpreted as the internal truthy `force` parameter.
That handler was type-incompatible with the button contract and a same-tick
click before the disabled render could bypass the synchronous pending fence.

The bounded repair wraps the public click as `() => closeAction()`, reserving
the internal forced close for explicit reconciliation paths. The deferred POST
test now submits, attempts cancel and attempts a second-row action in the same
React batch before the disabled state renders; the original panel, token and
operation UUID must remain selected. A source fence also rejects reintroduction
of the direct event handler. The rejected identity and prior checks do not
transfer: focused checks, a new clean checkpoint and a fresh complete-diff
rereview are required before push.

## Cancel-fence repair verification and checkpoint

The repaired interaction contract passes 7/7, including the same-tick pending
cancel and cross-row attempt. The complete related selection passes eight
files / 54 tests in one exact-lock invocation; targeted component/test ESLint,
translation parity at 23,600 English leaf keys with RU/AZ missing=0/extra=0,
and diff whitespace pass. The temporary dependency link was removed after each
command. Full local typecheck/build, real browser E2E, Android/Gradle, load,
physical-device and human-pilot checks remain `NOT RUN` under host policy.

The exact repair and its RED-review receipt were checkpointed as
`93be88a5b1615a2f35ff002dc1a993dacb4ed9a2`. Fresh fetch kept base,
merge-base and current `origin/main` at deployed
`86fc1d2c23fead588b45c2e700e125a6d98bbe82`. The preliminary complete diff is
nine paths / 89,448 binary-diff bytes with SHA-256
`9a81ab3c750b880408974a9f9cf0835905fd346d83d62fa43c16cbe7df29f9f7`, below
400 KB. This documentation receipt supersedes that preliminary identity; it
must be checkpointed before a new clean identity and author-independent
complete-diff rereview are valid.
