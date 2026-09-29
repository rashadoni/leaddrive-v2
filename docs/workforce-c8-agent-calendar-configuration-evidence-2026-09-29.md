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
writer and `agentId` is the selected employee. Metadata contains only the safe
employee/current-team labels, scope, date, day kind/name, `ADMIN` source and
computed Route baseline; it contains no email, phone, proof or leave reason.

## API and UI contract

- `GET /api/v1/workforce/configuration/calendar` strictly rejects mixed target
  IDs, keeps the 1–367-day future range and lists only the exact selected
  scope. The directory remains bounded and tenant-scoped.
- `POST` accepts `agentId` only with `scope: "AGENT"`; team/organization input
  cannot smuggle an employee and employee input cannot smuggle a team.
- The UI labels this operation as a personal scheduling exception, not leave or
  absence approval, and states that existing request-created entries remain
  visible and are never replaced.
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
