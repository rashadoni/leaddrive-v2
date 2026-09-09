# MTM Routes Phase 1 — Product and Implementation Plan

> **Status:** proposed implementation plan
> **Date:** 2026-07-13
> **Scope:** routes, field visits, visit policies, approvals, lead/customer requests, Excel exchange
> **Integration decision:** Phase 1 uses Excel import/export. Direct 1C integration is deferred.

> **Active UX modernization roadmap (2026-08-23):**
> `docs/mtm-routes-ux-roadmap-2026-08-23.md`. It is the task/status source for
> the calendar-first web and Android simplification work; this document remains
> the authoritative product-scope contract.

## 1. Outcome

Phase 1 must give a field agent one clear daily workflow:

1. Open today's route or create a route draft.
2. Travel to the next customer and check in.
3. See previous promises and overdue customer tasks at the right moment.
4. Complete only the actions required for the agent's group and visit type.
5. Explicitly close the visit after all required actions pass validation.
6. Continue to the next stop.

Managers must be able to plan and supervise routes without micromanaging every
normal action. They should spend attention on exceptions: route conflicts,
customer removal requests, new customer requests, incomplete visits, and route
deviations.

Administrators must be able to configure which visit actions are required,
optional, or hidden for each agent group. The same application must therefore
support, for example, a medical representative who must show a presentation and
a merchandiser who must take a photo.

Excel is the first integration channel. It must support controlled data exchange
without requiring users to edit internal IDs or understand the database model.

## 2. Product Principles

### 2.1 Task-first, not data-first

The agent sees the next useful action, not a dashboard full of counters. The
primary mobile screen is **Today**, with the current route, current stop, visit
state, and one main action.

### 2.2 Role-specific surfaces

- **Agent:** Today, My routes, Visit, New customer request.
- **Manager/Supervisor:** Week plan, Team routes, Approvals, Exceptions.
- **Administrator:** Agent groups, Visit policies, Excel exchange, Reference data.

The underlying data can be shared, but each role should not see controls it
cannot use.

### 2.3 Progressive disclosure

Required actions are visible first. Optional notes, stock details, additional
photos, and advanced fields remain collapsed until needed. A normal visit should
be completable without scrolling through irrelevant sections.

### 2.4 Drafts are automatic; completion is explicit

Forms may autosave locally or as server drafts. A visit must never be
automatically checked out. Only the agent's explicit **Complete visit** action
can close it, after server-side validation of required actions.

### 2.5 Explain every block

When an action is unavailable, the interface must state the exact missing item,
for example: `Presentation not recorded` or `1 required photo is missing`.
Generic `Validation failed` messages are not acceptable in the user interface.

### 2.6 Exception-driven management

Normal routes do not need approval. Only exceptional operations go to a manager:
removing a customer from a published route, resolving a conflict, approving a
new customer, or overriding a business rule.

## 3. Phase 1 Scope

### 3.1 Included

- Agent-created route drafts.
- Manager-created routes and team week planning.
- Assignment of one route to multiple agents with explicit roles.
- Protection against exact duplicates and route conflicts.
- Approval workflow for removing a customer from a published route.
- Manual visit check-in and manual visit completion.
- Customer-specific task and promise reminders during a visit.
- Configurable visit actions by agent group and visit type.
- Required/optional/hidden photo, presentation, note, stock check, checklist,
  feedback, and next-action blocks.
- Visit result capture and next-action creation.
- Request form for creating a lead/customer from the Routes module.
- Excel import/export with preview, validation, history, and error files.
- Read-only imported order/sales facts linked to customers and agents.
- Basic route, visit, action-compliance, and sales-plan reports.
- Audit history for configuration, approvals, imports, and route changes.
- AZ/RU/EN product copy and Excel templates.

### 3.2 Deferred

- Direct 1C API or scheduled 1C synchronization.
- Mobile order creation and order lifecycle management.
- Automatic route optimization based on traffic.
- Automatic visit evaluation from audio or video.
- Payroll or bonus calculation from route metrics.

The current LeadDrive mobile sync contract intentionally excludes order creation.
Phase 1 therefore imports external order/sales facts for context and reporting;
it does not reintroduce a competing order-management workflow.

## 4. Roles and Permissions

| Capability | Agent | Manager/Supervisor | Administrator |
|---|---:|---:|---:|
| View own assigned routes | Yes | Yes | Yes |
| Create own route draft | Yes | Yes | Yes |
| Publish own route | Configurable | Yes | Yes |
| Create route for another agent | No | Within scope | Yes |
| Assign multiple agents | No | Within scope | Yes |
| Edit draft route | Own only | Within scope | Yes |
| Remove stop from draft | Own only | Within scope | Yes |
| Request removal from published route | Own routes | Yes | Yes |
| Approve removal request | No | Within scope | Yes |
| Configure mandatory actions | No | No | Yes |
| Submit new customer request | Yes | Yes | Yes |
| Approve new customer request | No | Within scope | Yes |
| Import Excel | No by default | Configurable | Yes |
| Export scoped data | Own data | Team/region | Organization |

Every API check must enforce organization and territory scope. Hiding a button is
not a permission check.

## 5. Information Architecture

### 5.1 Agent mobile navigation

#### Today

- Route date and assignment status.
- Compact progress: completed stops / total stops.
- Current or next customer with address and navigation action.
- One primary action: **Start route**, **Check in**, **Continue visit**, or
  **Complete route** depending on state.
- Secondary actions: reorder draft, add stop, request new customer.

#### My routes

- Today, upcoming, drafts, and history.
- Search by customer or route name.
- Conflict and approval status shown inline.

#### Visit workspace

- Customer identity and visit timer.
- Reminder block for open promises/tasks from previous visits.
- Required actions with visible completion progress.
- Optional actions in a collapsed section.
- Sticky bottom action **Complete visit**.

### 5.2 Manager web navigation

#### Week plan

- Rows: agents; columns: days.
- Each cell shows route status, stop count, conflict state, and assignment role.
- Filters by region, team, agent group, and date.
- Selecting a route opens a detail panel without losing the week context.

#### Approvals

One queue with tabs:

- Stop removal.
- New customer/lead.
- Route conflict override.
- Visit override, if enabled later.

Each approval shows who requested it, what changes, why, and the relevant route
or customer context. Approve/reject requires a comment when the decision changes
the route or rejects the request.

#### Exceptions

- Open visit for too long.
- Required action incomplete.
- Route not started / missed stop.
- GPS or route deviation alert.
- Import rows requiring attention.

### 5.3 Administrator settings

#### Visit policies

A matrix with rows for actions and columns for agent groups or visit types:

| Action | Medical reps | Merchandisers | Sales reps |
|---|---|---|---|
| Photo | Optional | Required | Hidden |
| Presentation | Required | Hidden | Optional |
| Stock check | Optional | Required | Required |
| Visit note | Required | Optional | Required |

Each cell uses a three-state control: **Required / Optional / Hidden**. Advanced
conditions are opened only when needed: customer category, visit type, minimum
count, allowed file types, and whether a reason can replace the action.

## 6. Core User Flows

### 6.1 Agent creates a route

1. Agent selects a date; today is the default.
2. The system suggests customers based on territory and recent visit history.
3. Agent searches and adds customers.
4. The system prevents the same customer from being added twice to one route.
5. Agent reorders stops using drag and drop or move up/down controls.
6. Before save, the system checks exact duplicates and schedule conflicts.
7. Agent saves as draft or publishes if their group allows self-publishing.

The route builder should be a full screen on mobile and a side panel or full page
on web, not a small modal with many dropdowns.

### 6.2 Duplicate and conflict handling

Two different checks are required:

- **Exact duplicate, hard block:** same organization, date, ordered customer
  list, and assigned agent set. The existing route is opened instead.
- **Schedule conflict, warning:** an assigned agent already has another published
  route on that date, or the same customer is planned for overlapping agents.
  A manager can resolve or explicitly override the conflict with a reason.

A stable route fingerprint should be generated server-side from normalized date,
ordered customer IDs, and sorted assignment IDs. Client-side checks are only for
fast feedback; the server and database remain authoritative.

### 6.3 Multi-agent route

Assignments use explicit roles:

- **Primary:** owns route execution and the final route result.
- **Participant:** joins selected or all visits.
- **Observer/Manager:** participates in coaching and can add an evaluation.

One shared route must not create duplicate visits automatically. A visit has one
primary agent and zero or more participants. Completion is recorded once, while
participation and evaluations remain attributable to each person.

### 6.4 Removing a customer from a route

- In a draft, an authorized owner may remove a stop immediately.
- In a published or in-progress route, an agent submits a removal request with a
  mandatory reason.
- The stop remains active and visible with status **Removal requested**.
- Manager approval soft-deletes the stop and recalculates route totals.
- Rejection keeps the stop and records the manager comment.
- A stop with a started or completed visit cannot be removed; it can only be
  marked skipped/cancelled with a reason according to policy.

### 6.5 Visit and reminders

1. Agent checks in at the customer.
2. The visit opens in `CHECKED_IN`; no timer or background job can close it.
3. The system shows unresolved customer tasks, promises, and next actions from
   previous visits.
4. Agent can complete, reschedule, or acknowledge a reminder without leaving the
   visit.
5. Required action blocks are resolved from the policy snapshot for this visit.
6. Agent completes actions and records the result.
7. On **Complete visit**, the server validates the snapshot.
8. If valid, the visit changes to `CHECKED_OUT`; otherwise the response contains
   structured missing-action codes and user-facing labels.

A long-running visit generates an alert but remains open. Managers must not see
a false completion created by automation.

### 6.6 Visit result

The default result is intentionally short:

- Outcome: successful / partial / no contact / reschedule.
- Discussed products or topics.
- Customer feedback or objection.
- Potential: high / medium / low / unknown.
- Next action and due date.
- Final note.

If the agent creates a next action, it becomes a customer-linked task and appears
as a reminder during the next relevant visit.

### 6.7 Presentation tracking

For a presentation action, the agent selects or opens an approved material. The
system records:

- Material and version.
- Product/topic.
- Customer/contact.
- Agent and participants.
- Opened and completed timestamps.
- Optional result or feedback.

The requirement is satisfied only by a valid tracked event, not by checking a
manual checkbox.

### 6.8 Stock check

The fast path uses three states per product: **Available / Not available /
Information unavailable**. Quantity is optional unless the group policy requires
it. The previous visit value is shown alongside the current entry, but does not
pre-fill the new answer as if it were current.

### 6.9 New lead/customer request

The form is available from the route builder and active route:

- Object type: pharmacy, clinic, doctor, store, other.
- Name.
- Address and captured geolocation.
- Contact person and phone.
- Category/potential.
- Territory/region.
- Agent comment and reason for creation.
- Photo only when the policy requires it.

Statuses: `DRAFT`, `SUBMITTED`, `IN_REVIEW`, `NEEDS_INFO`, `APPROVED`, `REJECTED`.
On approval, the customer is created once, linked to the request, and offered for
addition to the current route. Duplicate customer candidates must be shown to the
reviewer before approval.

## 7. Excel Exchange

### 7.1 UX flow

Excel exchange is a guided five-step flow:

1. **Choose data type:** Customers, Routes, External orders/sales, or Visit
   results.
2. **Download template or upload file:** the template matches the selected type.
3. **Preview:** show detected sheet, headers, first rows, and column mapping.
4. **Validate:** show counts for create, update, unchanged, duplicate, and error.
5. **Apply and review:** create an import job, show progress, then provide a
   summary and downloadable error workbook.

Users never upload directly from a generic file button with no preview. The
final import action must state exactly what will change.

### 7.2 Common workbook rules

- `.xlsx` only in Phase 1; CSV can be added later if demanded.
- Maximum file size: 20 MB.
- Maximum rows per import: 50,000.
- First sheet is `Instructions`; data sheet names are stable and localized
  labels are not used as machine identifiers.
- A hidden `_meta` sheet stores `template_type` and `template_version`.
- Dates use ISO `YYYY-MM-DD`; time uses `HH:mm` in the organization timezone.
- External codes are strings; leading zeroes must be preserved.
- Dropdown validation is included for controlled values where Excel supports it.
- Formula cells are rejected for fields that are persisted as data.
- Exported text is protected against spreadsheet formula injection.
- Import is organization-scoped and records the initiating user.
- Re-uploading the same file does not create duplicate facts.

### 7.3 Customer import

Sheet: `customers`

| Column | Required | Rule |
|---|---:|---|
| `external_code` | Yes | Unique within organization; update key |
| `object_type` | Yes | pharmacy/clinic/doctor/store/other |
| `name` | Yes | 1-200 characters |
| `status` | No | active/prospect/inactive |
| `category` | No | A/B/C/D or configured equivalent |
| `address` | No | Text |
| `city` | No | Text |
| `district` | No | Text |
| `latitude` | No | -90..90 |
| `longitude` | No | -180..180 |
| `contact_person` | No | Text |
| `phone` | No | Text, not numeric |
| `territory_code` | No | Must exist |

Existing `external_code` rows are previewed as updates. The importer never
matches by name alone; similar names are reported as possible duplicates.

### 7.4 Route import

Sheet: `routes`; one row represents one stop.

| Column | Required | Rule |
|---|---:|---|
| `route_external_id` | Yes | Groups rows into a route |
| `route_date` | Yes | `YYYY-MM-DD` |
| `route_name` | No | Text |
| `agent_codes` | Yes | Comma-separated external codes |
| `primary_agent_code` | Yes | Must be in `agent_codes` |
| `stop_order` | Yes | Positive integer, unique per route |
| `customer_code` | Yes | Existing customer external code |
| `planned_time` | No | `HH:mm` |
| `notes` | No | Text |

Validation builds the same server-side fingerprint used by manual route
creation. Exact duplicates are blocked. Conflicts are shown before apply and
require a manager override; they are not silently imported.

### 7.5 External orders/sales import

Sheet: `sales_facts`

| Column | Required | Rule |
|---|---:|---|
| `document_no` | Yes | External document identifier |
| `document_date` | Yes | `YYYY-MM-DD` |
| `customer_code` | Yes | Existing customer external code |
| `agent_code` | No | Existing agent external code |
| `product_code` | Yes | External product code |
| `product_name` | Yes | Text |
| `quantity` | Yes | Decimal >= 0 |
| `unit` | No | Text |
| `amount` | No | Decimal >= 0 |
| `currency` | No | ISO code; organization default otherwise |
| `document_status` | No | imported/confirmed/cancelled |

Idempotency key: organization + document number + document date + product code
+ line number. Corrections update the matching fact and preserve an audit record.
The imported data is read-only in Routes and Visits.

### 7.6 Exports

All exports honor current filters and access scope. Phase 1 provides:

- **Route plan:** routes, assignments, ordered stops, planned times, statuses.
- **Route execution:** actual visit times, result, skipped stops, deviations.
- **Visit actions:** required/optional actions and compliance results.
- **Customer requests:** request data, status, reviewer, decision.
- **Sales facts:** imported order/sales facts linked to route/customer/agent.
- **Plan vs fact:** imported sales amount/quantity against uploaded plan values.

Each workbook includes an `Instructions` or `Summary` sheet with export filters,
organization timezone, generated time, and human-readable status legends.

### 7.7 Import history

Every import stores:

- Type, template version, original filename, file checksum.
- User, organization, timestamps, and status.
- Total/create/update/unchanged/skipped/error counts.
- Row-level errors with row number, field, error code, and readable message.
- Link to the generated error workbook.
- Apply mode and a rollback reference for operations that support rollback.

Statuses: `UPLOADED`, `VALIDATING`, `READY`, `APPLYING`, `COMPLETED`,
`COMPLETED_WITH_ERRORS`, `FAILED`, `ROLLED_BACK`.

## 8. Recommended Data Model Changes

This is a safety-lane change: it affects Prisma, permissions, mobile sync, and
tenant-scoped APIs. It requires migrations, backfill, and compatibility tests.

### 8.1 Route assignments

Add `MtmRouteAssignment` with `routeId`, `agentId`, `role`, `assignedBy`,
`assignedAt`, and assignment status. Keep the current `MtmRoute.agentId` during
a compatibility period as the primary agent, backfill an assignment for every
existing route, and migrate mobile reads to the assignment relation before
removing the legacy field in a later release.

Add `DRAFT` to `MtmRouteStatus`. Keep the existing `PLANNED` database value as
the published state during compatibility; the UI may label it **Published**.

### 8.2 Visit participants

Add `MtmVisitParticipant` with `visitId`, `agentId`, role, joined/left timestamps,
and optional evaluation reference. Keep `MtmVisit.agentId` as the primary agent.

### 8.3 Visit policy and snapshot

- `MtmVisitPolicy`: organization, team/group, visit type, priority, effective
  dates, active flag.
- `MtmVisitPolicyAction`: action key, mode required/optional/hidden, minimum
  count, conditions, override rule.
- `MtmVisitRequirementSnapshot`: immutable actions resolved at check-in.
- `MtmVisitActionResult`: result and evidence for each required/optional action.

The snapshot prevents a later settings change from changing the rules for a
visit already in progress.

Use the existing `MtmTeam` as the Phase 1 policy group. A separate overlapping
group model should be added only if one agent must simultaneously inherit rules
from several independent groups.

### 8.4 Approvals and requests

- `MtmRouteChangeRequest` for stop removal and conflict override.
- `MtmCustomerCreateRequest` for lead/customer onboarding.
- Both include requester, reviewer, status, reason, decision comment, timestamps,
  and organization scope.

### 8.5 External facts and import jobs

- `MtmImportJob` and `MtmImportRowError`.
- `MtmExternalSalesDocument` and `MtmExternalSalesLine`, or an equivalent
  normalized fact model.
- Unique external keys per organization and immutable audit entries for
  corrections.

### 8.6 Dedupe and audit

- Add `dedupeKey` to routes and a partial unique rule for active routes.
- Record route create/update/publish, assignment, removal request/decision,
  policy change, visit completion, and import apply/rollback in MTM audit.

## 9. API Changes

### 9.1 Routes

- Extend route create/update with `assignments[]` while accepting legacy
  `agentId` during compatibility.
- Add `POST /mtm/routes/{id}/publish`.
- Add `POST /mtm/routes/{id}/change-requests`.
- Add approval decision endpoint with manager scope checks.
- Return `duplicate` and `conflict` as distinct structured error codes.

### 9.2 Visits

- Add `routeId` and `routePointId` links to visits.
- Resolve and persist the visit-policy snapshot at check-in.
- Add action-result endpoints for presentation, photo, stock, checklist,
  feedback, and next action.
- Checkout validates the snapshot transactionally and never runs from a
  scheduler.
- Return missing requirements as structured objects, not one text string.

### 9.3 Customer requests

- Create/update/submit own request.
- List scoped requests.
- Manager approve/reject/request-info.
- Approval transaction creates exactly one customer and links it to the request.

### 9.4 Excel

- Template download by type and version.
- Upload and parse.
- Validate/preview without mutation.
- Apply validated import with idempotency.
- Job status and error workbook download.
- Filter-aware exports.

Large imports should execute as jobs. The request must return a job ID and never
keep a web request open while processing tens of thousands of rows.

## 10. Implementation Backlog

### Epic 0 — Product contract and baseline

- [x] Confirm route assignment roles and which role owns final completion.
- [x] Confirm agent self-publish policy; recommended default is draft-only until
  enabled for a group.
- [x] Confirm customer object types and category dictionary.
- [x] Inventory web and mobile route/visit consumers.
- [x] Add API contract tests around the current single-agent behavior before
  migration.
- [x] Create final UX brief and clickable flow for Today, Visit, Week plan,
  Approvals, and Excel import.

**Acceptance:** stakeholders can walk through the full agent and manager flow;
compatibility consumers are listed; unresolved rules have owners.

### Epic 1 — Schema, migration, and permission foundation

- [x] Add assignments, participants, policy, snapshot, action result, approval,
  customer request, import job, and external sales fact models.
- [x] Add organization-scoped unique keys and indexes.
- [x] Backfill primary route assignments from existing `agentId`.
- [x] Add tenant/RLS coverage for every new table.
- [x] Add permission helpers for agent, manager scope, and administrator.
- [x] Add audit events and retention rules.

**Acceptance:** Prisma validate/generate pass; migration works on a production-like
copy; all new records are tenant-isolated; rollback procedure is documented.

### Epic 2 — Route creation and planning

- [x] Replace the cramped route modal with a route builder.
- [x] Allow agents to create and edit own drafts.
- [x] Add customer search, add, reorder, and remove in draft.
- [x] Add multi-agent assignments and roles.
- [x] Add server-side fingerprint and exact-duplicate block.
- [x] Add conflict detection and manager override request.
- [x] Add publish transition and immutable published-date rules.
- [x] Build manager week plan and route detail panel.
- [x] Remove or redesign the current copy/template action so it cannot create an
  exact duplicate.

**Acceptance:** exact duplicates cannot be created through UI, API, concurrent
requests, or Excel; an agent cannot alter another agent's route; legacy mobile
still receives the primary assignment during the compatibility period.

### Epic 3 — Route change approvals

- [x] Add stop-removal request from a published route.
- [x] Show pending state on the stop and route.
- [x] Build manager approval queue and decision screen.
- [x] Apply approved removal transactionally and recalculate totals.
- [x] Prevent removal after visit start/completion.
- [x] Send in-app notifications for request and decision.

**Acceptance:** the stop remains executable until approval; every decision is
audited; repeated approval requests are idempotent.

### Epic 4 — Visit policy configuration

- [x] Build group/visit-type policy matrix.
- [x] Support required, optional, and hidden states.
- [x] Add minimum counts and simple conditions.
- [x] Validate conflicting policy priority and effective dates.
- [x] Add preview: “What will agent X see at customer Y?”
- [x] Snapshot resolved rules at check-in.

**Acceptance:** changing a policy affects new visits only; a test preview matches
the actual mobile visit; hidden actions cannot be submitted through the API.

### Epic 5 — Agent visit workspace

- [x] Build Today screen and active-visit resume behavior.
- [x] Show previous promises and customer tasks after check-in.
- [x] Add quick complete/reschedule/acknowledge reminder actions.
- [x] Render required actions first and optional actions collapsed.
- [x] Implement presentation evidence and material tracking.
- [x] Implement stock availability and optional quantity entry.
- [x] Implement visit result and next-action creation.
- [x] Add sticky manual completion action with missing-item explanations.
- [x] Generate long-open-visit alerts without auto-closing.
- [x] Preserve offline draft and idempotent sync behavior.

**Acceptance:** no server path auto-closes a visit; checkout fails consistently on
web, mobile, and sync when required evidence is missing; retrying checkout does
not duplicate results or tasks.

### Epic 6 — New customer request

- [x] Add request form from route builder and active route.
- [x] Capture geolocation with manual correction.
- [x] Add possible-duplicate matching by code, phone, location, and similar name.
- [x] Build manager review and needs-info loop.
- [x] Create customer transactionally on approval.
- [x] Offer approved customer for insertion into the route under normal route
  change rules.

**Acceptance:** double approval cannot create two customers; agent sees the
decision; rejected and needs-info requests remain traceable.

### Epic 7 — Excel foundation

- [x] Reuse the existing `exceljs` dependency and shared export helpers.
- [x] Implement versioned templates and machine-stable sheet/column names.
- [x] Add streaming-safe upload limits and file-type validation.
- [x] Build preview/mapping/validation UI.
- [x] Add import job state machine, checksum, idempotency, and row errors.
- [x] Add formula-injection protection and formula-cell rejection.
- [x] Add job history and error workbook download.

**Acceptance:** validation performs no writes; apply only uses the validated
snapshot/checksum; the same file cannot silently duplicate data; errors point to
an exact sheet, row, column, and fix.

### Epic 8 — Excel data types

- [x] Customer import and export.
- [x] Route import and export with duplicate/conflict checks.
- [x] External orders/sales facts import and export.
- [x] Visit result and action-compliance export.
- [x] Plan vs fact import/export if a plan file is supplied.
- [x] AZ/RU/EN template instructions and status legends.

**Acceptance:** each type has golden workbooks for valid, invalid, duplicate,
update, and large-file cases; exports reopen successfully in Excel and preserve
leading zeroes in codes.

### Epic 9 — Reporting and management views

- [x] Route plan vs execution by agent/team/region.
- [x] Required-action compliance by group and action type.
- [x] Open promises and overdue next actions.
- [x] Stock change since previous visit.
- [x] External sales by customer/agent/territory with plan vs fact.
- [x] Export every report with active filters.

**Acceptance:** report totals reconcile with source records and exported totals;
manager scope does not leak another region's data.

### Epic 10 — Rollout and operational readiness

Current gate evidence and the remaining real-pilot inputs are recorded in
[`mtm-routes-phase-1-pilot-evidence.md`](./mtm-routes-phase-1-pilot-evidence.md).

- [x] Add feature flags for new route assignments, visit policies, and Excel
  imports.
- [x] Run a scoped production demo pilot with two agent groups and one manager.
- [x] Import a sanitized demo workbook and reconcile preview/apply/export row
  counts (the user authorized synthetic data when no source workbook exists).
- [x] Run production web and mobile-API regression for route -> check-in ->
  actions -> checkout.
- [x] Run duplicate-operation retry/idempotency scenarios.
- [x] Add dashboards for import failures, open visits, and approval backlog.
- [x] Publish role-specific help content after the UI is stable.
- [ ] Observe a physical Android device through a real offline-to-online network
  transition.
- [ ] Obtain human usability sign-off from a named pilot user.

**Acceptance:** pilot users complete the daily flow without administrator help;
no unresolved P0/P1 defects; rollback and support runbooks are ready.

## 11. Recommended Delivery Order

1. **Foundation:** Epics 0-1.
2. **Planning:** Epics 2-3.
3. **Visit execution:** Epics 4-5.
4. **Customer growth:** Epic 6.
5. **Excel-first integration:** Epics 7-8.
6. **Management value:** Epic 9.
7. **Pilot and rollout:** Epic 10.

Excel design starts during Foundation so its external-code and idempotency rules
shape the data model. User-facing Excel import should launch only after route,
customer, and visit validation rules are authoritative; otherwise imported data
can bypass product rules.

## 12. Test Matrix

### Business rules

- Exact duplicate route: UI, API, concurrent create, Excel import.
- Same customer twice in one route.
- Same agent on conflicting routes.
- Multi-agent primary/participant/observer behavior.
- Agent edits only own draft.
- Removal request approve/reject/repeat decision.
- Customer request duplicate candidate and double approval.
- Visit checkout with each required action missing.
- Policy changes while visit is active.
- Long-open visit stays open and creates an alert.
- Next action appears on a later customer visit.

### Excel

- Empty workbook, missing sheet, renamed headers, old/new template version.
- Leading-zero codes, localized Excel dates, invalid coordinates, formulas.
- Unknown customer/agent/product codes.
- Duplicate rows within file and against database.
- Re-upload same file and corrected file.
- 50,000-row boundary, 20 MB boundary, interrupted job, job retry.
- Export in AZ/RU/EN and open in current Microsoft Excel.

### Security

- Cross-organization IDs in every mutation.
- Manager accessing an out-of-scope region/team.
- Agent assigning another agent or approving own request.
- Export scope and guessed import-job IDs.
- Uploaded file content type, extension, size, and storage access.

### Compatibility

- Existing single-agent routes after assignment backfill.
- Existing mobile pull filters during transition.
- Offline visit checkout retry and idempotency.
- Current route metrics after approved stop removal.

## 13. Definition of Done

Phase 1 is done only when:

- The end-to-end agent flow works on a real mobile viewport and with an offline
  reconnect scenario.
- Visits cannot auto-close and required actions cannot be bypassed by API or sync.
- Exact duplicate routes are impossible at the database boundary.
- Multi-agent participation does not duplicate a visit or its result.
- Published-route removal always follows approval.
- New customer approval cannot create duplicates through repeated requests.
- Excel preview is non-mutating, apply is idempotent, and errors are actionable.
- Imported sales/order facts reconcile with the source workbook.
- Tenant, team, and role scopes are covered by automated tests.
- AZ/RU/EN copy passes localization checks.
- Prisma validation/generation, targeted tests, typecheck, build where required,
  and browser/mobile verification have been run and recorded.

## 14. Decisions to Confirm Before Schema Work

The following should be confirmed in Epic 0; recommended defaults are included:

1. **Can agents publish their own routes?** Recommended: configurable by agent
   group; default is save draft, manager publishing optional.
2. **What does multi-agent mean?** Recommended: one primary owner plus
   participants/observer, one shared visit result.
3. **Can an agent skip a stop without approval?** Recommended: yes only with a
   required reason; removal and skip remain different audited actions.
4. **What is an exact duplicate?** Recommended: same date, ordered stops, and
   assigned agent set. Same agent/date is a conflict warning, not always a hard
   duplicate.
5. **Who can import sales files?** Recommended: administrators, plus explicitly
   granted manager roles.
6. **Are quantities mandatory in stock checks?** Recommended: configurable;
   availability is the default requirement, quantity optional.
7. **How long before an open-visit alert?** Recommended: organization setting,
   default 120 minutes; alert only, never auto-close.
8. **What is an agent policy group?** Recommended: use the existing `MtmTeam` in
   Phase 1; introduce a separate group model only for overlapping membership.
