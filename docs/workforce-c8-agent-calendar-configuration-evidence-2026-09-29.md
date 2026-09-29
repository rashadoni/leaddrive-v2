# WF-C8-007d future employee calendar configuration evidence — 2026-09-29

## Claim boundary

This slice extends the released forward-only Workforce calendar surface with
one named employee (`AGENT`) scope. It does not complete `WF-C8-007`, change a
roadmap row to `DONE`, or add a production-readiness gate.

Included:

- strict `ORGANIZATION`, `TEAM` or `AGENT` scope selection under the existing
  session-only `SCHEDULE_READ` / `SCHEDULE_WRITE` authorization boundary;
- a tenant-bound active-employee directory, bounded to 100 named results with
  explicit truncation and server-side name/external-code search;
- selected-employee continuity for a same-tenant inactive or suspended person,
  with status/current-team context and no new write for that person;
- exact employee-only future list/create while organization and team rows stay
  excluded from the returned inventory;
- shared organization/date serialization, an active employee row lock, locked
  current-team Route baseline, exact replay/conflict behavior and atomic audit;
- localized named employee selection, latest-request fencing and mutation-time
  control freezing on the released responsive calendar surface.

Excluded:

- leave/absence request approval, self-service authoring or replacement of a
  request-created personal calendar row;
- moved-day pairs, update/delete/rollback, historical repair or bulk authoring;
- effective-dated transfer editing, break-policy authoring, new permissions,
  schema/migration work or any Route UI/API behavior change;
- browser/AT/contrast/zoom/device acceptance, real-PostgreSQL race injection,
  Android/Gradle, load/chaos, signed-device and tenant-pilot evidence.

## Tenant, target and response safety

Employee search always predicates `MtmAgent` by the authenticated
`organizationId` and `status: ACTIVE`. It searches only name and external code,
orders by name/ID, reads `limit + 1`, and reports `hasMore`. Results expose only
the stable employee ID required for the scoped request, name, optional external
code, status and a safe current-team ID/name/code/activity summary. Email,
phone, password/device material and unrelated personnel data are neither
selected nor returned.

A separately selected employee is still looked up inside the same tenant
without an active-status filter so an inactive or suspended selection can
remain visible for read continuity. Missing and cross-tenant GET targets share
one 404 contract. POST revalidation admits only an active row, so missing,
inactive, suspended and cross-tenant targets share one 404 contract before any
calendar write. The browser uses a named picker; it does not offer raw target
ID input.

Employee inventory uses the exact retained-ledger filter
`{ organizationId, agentId, teamId: null, deletedAt: null }`. It therefore
shows existing personal rows regardless of their established source while
excluding organization/team rows. Returned day summaries remain limited to
date/kind/name; calendar-row IDs, source, actors and Route fields remain
omitted.

## Transaction, baseline and idempotency safety

The writer takes locks and reads state in this order:

1. the existing `workforce-calendar-configuration:<org>:<date>` transaction
   advisory lock;
2. the tenant employee row with `status = ACTIVE` using `FOR SHARE OF agent`,
   freezing the current `teamId` against the transfer writer's row lock;
3. only the exact employee, locked current-team and organization candidates for
   that tenant/date;
4. calendar-row creation and its audit in the same transaction.

The candidate employee row is excluded from its own baseline. The stored
`routePlanningAllowed` value is resolved from the locked current team's
effective team/organization/default calendar state, so team precedence is
preserved and the selected HR kind does not silently redefine Route planning.
An employee without a team inherits the organization/default state. A later
transfer does not rewrite the recorded flag; historical membership is not used
to guess a future target.

Only an exact `ADMIN` state with matching scope, employee, date, kind, name,
null team/moved date and computed Route baseline is a no-op replay. A different
state, a request-created `WORKFORCE_LEAVE`/`WORKFORCE_ABSENCE` row, or a partial
unique collision fails closed with 409. Exact retry writes neither a second row
nor a second audit. Audit failure rolls the row back with the transaction.

The audit separates operator from target: `actorUserId` is the authenticated
writer and `agentId` is the selected employee. Metadata contains the safe
employee/current-team labels, scope, date, day kind, the operator-supplied
calendar display label, `ADMIN` source and computed Route baseline. That label
is deliberately returned to schedule readers and retained in audit; it is not
a private HR field. The UI therefore calls it a non-sensitive display label
and explicitly forbids leave, absence, medical, health, disciplinary or proof
details. Email, phone and request/proof records are not selected or copied.

## API and UI contract

- `GET /api/v1/workforce/configuration/calendar` strictly rejects mixed target
  IDs, keeps the 1–367-day future range and lists only the exact selected
  scope. The directory remains bounded and tenant-scoped.
- `POST` accepts `agentId` only with `scope: "AGENT"`; team/organization input
  cannot smuggle an employee and employee input cannot smuggle a team.
- The UI labels this operation as a personal scheduling exception, not leave or
  absence approval, and states that existing request-created entries remain
  visible and are never replaced. Employee scope replaces the general
  "name or reason" prompt with a described non-sensitive display-label field;
  its warning says not to enter leave/absence, medical/health, disciplinary or
  proof details and discloses that the label is schedule-visible and audited.
- Same-tenant inactive/suspended selected employees remain readable with status
  and current-team context, while creation is disabled and server-rejected.
- All GETs share the released AbortController plus monotonic latest-request
  fence. All eight possible mutable target/search/draft controls freeze from
  POST submission through its reconciliation GET. Submission also snapshots
  the selected target/query, so an old completion cannot reconcile a new
  selection or clear newer input.
- Unknown POST outcomes keep the honest refresh/exact-retry message; the client
  never claims that a transport failure proves no mutation occurred.

## Author verification

PASS on the current implementation tree:

- focused calendar domain/API/UI: 3 files / 41 tests;
- employee/team/organization calendar precedence and retained API regression:
  3 files / 16 tests;
- Workforce authorization wrapper and RLS route-context coverage: 2 files /
  33 tests;
- affected voice guide coverage: 1 file / 4 tests;
- scoped ESLint on all eight changed TypeScript/TSX implementation/test paths;
- `npm run i18n:check`: EN source 23,879 leaf keys, RU/AZ missing 0 and extra
  0;
- JSON parse, `git diff --check`, 11 changed implementation/i18n/test paths and
  a pre-evidence diff of 100,387 bytes.

NOT RUN under the Contabo workload-placement contract:

- full repository typecheck, production build and full test suite;
- real PostgreSQL concurrency/transfer injection;
- browser, assistive-technology, contrast, zoom and physical-device checks;
- Android/Gradle, load/chaos, signed-device and tenant-pilot gates.

Exact-head GitHub CI and a fresh author-independent full-range frozen review
remain mandatory before merge.

## Roadmap accounting

`WF-C8-007` remains `PARTIAL`: organization, named-team and named-employee
future create/list are implemented, while moved-day workflow, update/delete
governance, break-policy authoring and real browser/AT evidence remain open.
Progress remains `DONE 81/161`, `GATES 14/15`, C8 36%, overall 59%, with 80
non-DONE rows. No completion or gate credit is claimed by this checkpoint.

## Live-main reconciliation

Before frozen review, the branch was merged with live `origin/main`
`bd83c5d41182fca0003282e2241e5ad9ae35c04b`. Main had advanced through an
independent Support UX release; the only overlapping slice paths were the
three locale catalogs, which merged without conflict and retained both key
sets. The complete bounded verification was rerun on the integrated head:
94/94 tests, scoped ESLint, whitespace and translation parity passed. The
integrated EN catalog has 23,883 leaf keys with RU/AZ missing 0 and extra 0.
No calendar implementation/test path required conflict resolution. A fresh
review must use this post-reconciliation exact head and live-main diff.

## First frozen-head review RED and remediation

Author-independent full-range review of exact clean head
`a6423c114c74a75661e4be8d36151df7ab98ca7f` against live main
`bd83c5d41182fca0003282e2241e5ad9ae35c04b` returned RED with
`P0=0, P1=0, P2=1, P3=1`.

- P2: the shared "name or reason" UI label invited a scheduling operator to
  put leave/medical details into an employee calendar label that is returned to
  schedule readers and retained in audit. Employee scope now uses a distinct
  accessible "non-sensitive display label", neutral example and localized
  prohibition on leave/absence, medical/health, disciplinary and proof details.
  Its create disclosure truthfully states schedule visibility and audit
  retention. Evidence no longer claims that the stored label cannot be a
  reason; it documents the contract and actual storage/visibility boundary.
- P3: the authoritative `WF-C8-007` row still described team/employee workflows
  as open. It now links organization, team and employee evidence and lists only
  the real remaining work: moved-day, update/delete, break-policy and real
  browser/AT acceptance.

The reviewer separately tested the nested current-team tenant concern and did
not confirm a finding: the session route establishes tenant RLS,
`mtm_teams` is under FORCE RLS and the supported application role cannot bypass
it, while the write join also matches organization and team ID. A corrupted
foreign team link is therefore projected as no current team, not disclosed.

Post-remediation author checks pass: 9 files / 95 tests, scoped ESLint, JSON,
whitespace and i18n EN 23,886 with RU/AZ missing 0 and extra 0. The rejected
head is ineligible; a new exact-head full-range independent review is mandatory.

## Frozen-head independent review GREEN

Fresh author-independent full-range review returned GREEN with
`P0=P1=P2=P3=0` on exact clean head
`21d3dc6506193bb4e6e2ce7f9cc30bd15439197b` against live main/merge-base
`bd83c5d41182fca0003282e2241e5ad9ae35c04b`.

- Full identity: 15 paths / 136,737 bytes / SHA-256
  `5d54d093714f0fdb73d486d71f5785a51c262ca0ea81bbd6ac6d6b76eb6ab7d0`.
- Non-doc identity: 11 paths / 103,986 bytes / SHA-256
  `0891d37e861491d2a94acd056e1088651d28ce4f0a902923222e6893ab332d83`.
- The reviewer confirmed both prior findings closed, re-reviewed the complete
  tenant/auth, exact-scope, lock/current-team baseline, replay/conflict/audit,
  UI-race/accessibility/i18n, response-minimization and evidence boundaries,
  and found no new issue.
- The separately examined nested current-team relation remains contained by
  route tenant context plus FORCE RLS/NOBYPASSRLS; the writer additionally
  joins team on the same organization.
- Reviewer checks passed 95/95 bounded tests, scoped ESLint, i18n 23,886/0/0,
  JSON, whitespace and append-only session prefixes. Full typecheck/build/
  suite, real-PostgreSQL concurrency, browser/AT/device, Android/Gradle,
  load/chaos, signed-device and pilot remain `NOT RUN`.

This GREEN review adds no task or gate credit. Only this receipt changes after
the reviewed head; receipt-integrity review must prove the implementation
identity unchanged before push.
