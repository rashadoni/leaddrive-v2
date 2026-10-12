> Разведка 2026-10-13 для `docs/mtm-attendance/README.md`. Отчёт собран помощником-исследователем:
> пути и номера строк верны на эту дату, перед использованием сверяй с кодом. `<repo>` — корень репозитория.

All paths below are under `<repo>` (written as `R/`). Nothing was modified.

## 0. What the withdrawal changed for you

- **Gate:** `R/src/proxy.ts:396` returns 410 (API) or 404 (pages) for every prefix in `R/src/lib/crm-product-availability.ts:16-28`. `/api/v1/mtm/work-calendar`, `/api/v1/mtm/mobile/workday` and `/api/v1/mtm/week/workday` are in that list (confirmed).
- **Capability is hard-off:** `isTenantCapabilityEnabled("workforce-hrm")` is always false (`R/src/lib/tenant-capabilities.ts:238`).
- **Workdays are now written only by mobile sync push**, as a "Route field session" (`R/src/app/api/v1/mtm/mobile/sync/push/route.ts:227-234`, `2989-2993`). The `afterEvent` hook returns early, so workdays recorded after withdrawal get no policy, shift or schedule snapshot.
- **HRM requests over sync are refused** with `TENANT_CAPABILITY_DISABLED` (same file, `702-705`).
- **DB triggers on `mtm_agent_workdays` and the Workforce tables stay active** regardless of the gate.
- **Library functions carry no capability check**; only the route wrappers and the proxy do. A new live MTM route can call them.

## 1. Employee requests (`MtmHrmRequest`, `R/prisma/schema.prisma:8181-8222`)

**Columns:** `clientRequestId`, `type`, `status`, `startDate`/`endDate` (`@db.Date`), `correctionWorkdayId`, `exceptionCaseId`, `exceptionCaseRevision`, `requestedStartAt`, `requestedEndAt`, `reason`, `decisionNote`, `decidedByUserId`, `submittedAt`, `decidedAt`, `cancelledAt`. Unique on `(organizationId, agentId, clientRequestId)`.

**Create and cancel**

| Path | Code | State |
|---|---|---|
| Web `POST /api/v1/workforce/requests` | `R/src/app/api/v1/workforce/requests/route.ts:331` → `submitWorkforceSelfRequest` (`R/src/lib/workforce/self-request.ts:157`) | withdrawn |
| Web `POST /api/v1/workforce/requests/:id/cancel` | → `cancelWorkforceSelfRequest` (`self-request.ts:401`) | withdrawn |
| Mobile sync push, entity `hrmRequests` (create / update=cancel) | `push/route.ts:2495-2680`, `2682-2790`; parser `R/src/lib/mtm/mobile-hrm.ts` | route live, entity refused |

- Web body (`self-request.ts:21-56`, strict): `clientRequestId` (8–128), `type`, `startDate`, `endDate`, `reason` (3–1000), and for corrections `correctionWorkdayId`, `exceptionCaseId`, `requestedStartLocal`, `requestedEndLocal` (`YYYY-MM-DDTHH:mm`, tenant timezone).
- Mobile body adds `id` and `submittedAt` (not more than 5 minutes ahead) and sends `requestedStartAt`/`requestedEndAt` as timestamps.
- Only an actor with role `AGENT` and an `agentId` may submit (`self-request.ts:99-101`).

**Validation**
- Range: `endDate >= startDate`, at most 366 days.
- TIME_CORRECTION: one day only, the workday must belong to the agent on that date, at least one of start/end, both on that date, end after start.
- Overlap (`self-request.ts:331-350`): a LEAVE or ABSENCE is refused if any PENDING or APPROVED LEAVE/ABSENCE of the same agent intersects. A TIME_CORRECTION is refused if a PENDING or APPROVED one exists for the same workday, so only one approved correction request per workday is ever possible.
- Not checked: past dates, notice period, weekends or holidays inside the range, any quota.

**Read**
- `GET /api/v1/workforce/requests` (`requests/route.ts:81`, cursor, limit 250).
- `GET /api/v1/mtm/mobile/hrm` (`R/src/app/api/v1/mtm/mobile/hrm/route.ts:76`): at most 93 days, returns `days[]{date, calendar, workday, requests}`.
- `GET /api/v1/mtm/operations` (`R/src/app/api/v1/mtm/operations/route.ts:188-212`): live route, but the HRM part is gated off.
- `R/src/app/api/v1/mtm/mobile/manager/approvals/route.ts:31`: also gated on `workforceHrm`.

**Decide** — `decideWorkforceRequest` (`R/src/lib/workforce/request-decision.ts:180`), called by `R/src/app/api/v1/workforce/requests/[id]/decision/route.ts` and the adapter `R/src/app/api/v1/mtm/operations/hrm/[id]/decision/route.ts`.
- Body (`:34-42`): `decision` APPROVED or REJECTED, `note` (required on reject), `acknowledgeRouteConflicts`.
- Who: never one's own request (`:206`). Legacy mode needs the employee inside the actor's MTM scope (`:213`). Granular mode needs `TEAM_REQUEST_DECIDE` for LEAVE/ABSENCE and `TIME_APPROVE` for corrections, resolved against the historical team (`:113-142`).
- It is a single step with one `decidedByUserId`.
- An approved request cannot be revoked; only a PENDING one can be cancelled, and only by the employee.

**What approval does**
- **LEAVE / ABSENCE (`:349-396`):** for every date in the range it upserts an agent-scoped `MtmWorkCalendarDay` with `kind: "COMPANY_HOLIDAY"`, `routePlanningAllowed: false`, name "Approved leave" / "Approved absence", `source` `WORKFORCE_LEAVE` / `WORKFORCE_ABSENCE`. An existing agent row for that date is overwritten. No timesheet, workday or exception row is touched.
- LEAVE and ABSENCE differ only in that label, the source string and the permission.
- Route conflicts (PLANNED / IN_PROGRESS routes in the range) return a 409 until acknowledged (`:244-265`).
- **TIME_CORRECTION (`:398-553`):** yes, it writes `WorkforceTimeCorrection` (`source: "REQUEST_APPROVAL"`, `operationId: request-approval:<id>`, before/after facts) and updates `MtmAgentWorkday.startedAt` and/or `completedAt`. If `requestedEndAt` is set on an open day it also sets `status: COMPLETED`, clears `pausedAt` and adds the open pause to `totalPausedSeconds`.
- Every decision writes an `mtmNotification` and an `HRM_REQUEST_DECISION` audit row.

**Absent:** leave sub-types (annual, sick, unpaid, trip, remote, study), half-days or hours, attached documents (`MtmDocument` links only to visit, task and customer), balances or accruals, paid/unpaid flag, substitute, revocation of an approved request.

## 2. Schedules and norms

**`WorkforcePolicy` (`schema.prisma:8415`)** — versioned, organization or team scope (`teamId`), no per-agent scope, `effectiveFrom`/`effectiveTo`, DRAFT → ACTIVE → RETIRED.
- Its JSON holds exactly five interpreted fields (`R/src/lib/workforce/policy-definition.ts:14-20`): `expectedWorkSeconds`, `lateGraceSeconds`, `undertimeToleranceSeconds`, `overtimeThresholdSeconds`, `longPauseThresholdSeconds` (nullable).
- An optional `attendance` block covers QR, device and location proof (`R/src/lib/workforce/attendance-policy.ts`).
- Defaults (`R/src/lib/workforce/default-profile.ts:22-39`): 8 h, 15 min grace, 0, 0, 60 min.

**`WorkforceShiftTemplate` (`:8459`)** — `code`, `version`, `timezone`, `teamId`, `isDefault`.
- JSON (`R/src/lib/workforce/shift-definition.ts:20-29`): `startTime`, `endTime`, `timezone`, `daysOfWeek` (ISO 1–7), `plannedBreaks[]` (at most 8).
- One time window applies to every listed weekday.
- Planned breaks are display metadata and are never deducted.
- Overnight shifts are rejected (`shift-definition.ts:34`).

**`WorkforceShiftSegment` (`:8507`)** — `sequence`, `mode` (SITE, REMOTE, FIELD, TRAVEL, ON_CALL, EXCEPTION; ON_CALL cannot be activated), `siteId`, `startTime`, `endTime`, `lateGraceSeconds`, `proofPolicyReference`.

**Assignment** — resolution order in `R/src/lib/workforce/shift-resolution.ts:181-315`: personal → team default → organization default → legacy `isDefault`.
- `WorkforceShiftAssignment` (`:8576`): per agent, effective-dated.
- `WorkforceShiftTeamDefaultAssignment` (`:8682`) and `WorkforceShiftDefaultAssignment` (`:8631`).
- `*BulkOperation` and `*Operation` tables are idempotency receipts.
- No model named `WorkforceSchedule*` exists apart from the snapshot below.

**Snapshots** — immutable, one per workday, written at START by `R/src/lib/workforce/snapshot-writer.ts:412`.
- `WorkforcePolicySnapshot` (`:8735`): the five numbers.
- `WorkforceShiftSnapshot` (`:8769`): `plannedStartAt`, `plannedEndAt`, `timezone`.
- `WorkforceWorkdayScheduleSnapshot` (`:8810`): `calendarState`, `calendarSnapshot`, `segments`, `sites`, hash.
- The writer returns `off_day` and writes nothing when the calendar says attendance is not expected or the weekday is not in `daysOfWeek` (`snapshot-writer.ts:472`, `491`).

**Calculation** — `calculateWorkforceTimesheetDay` (`R/src/lib/workforce/timesheet-calculation.ts:171-314`), a pure function of schedule, policy snapshot and replayed journal facts:
- Late (`:265-266`): `startedAt - plannedStartAt`, exception if above grace.
- Undertime (`:267-268`): `expectedWorkSeconds - workedSeconds`, only when completed or past planned end.
- Overtime (`:269`): `workedSeconds - expectedWorkSeconds`.
- Long pause (`:270-272`): longest single pause against the threshold.
- Nothing compares `completedAt` with `plannedEndAt`.

**`WorkforceAttendanceException` (`:8842`) has no writer in application code.** I found only reads and counts; deviations are computed on read.

## 3. Calendar

**`MtmWorkCalendarDay` (`schema.prisma:5923`)** — `date`, `kind`, `name`, `teamId`, `agentId` (at most one of the two), `movedToDate`, `routePlanningAllowed`, `source` (default `ADMIN`), `createdBy`, `updatedBy`, `deletedAt`. Partial unique indexes allow one active row per date per scope (`R/prisma/migrations/20260715160000_mtm_work_calendar/migration.sql`).

**`resolveWorkCalendarDay` (`R/src/lib/mtm/work-calendar.ts:49`)**
- Precedence: agent > team > organization (`:63`).
- Returns `{date, kind, isWorkingDay, routePlanningAllowed, name, movedToDate, source, overrideId}`.
- Working kinds: WORKING_DAY, EXCEPTION_WORKDAY, MOVED_WORKDAY (`:45`).
- Default weekend is Saturday and Sunday, hard-coded (`R/src/lib/mtm/mobile-week.ts:104-108`).
- No shortened-day support: there is no hours column anywhere.
- No holiday seeding or import was found.

**Attendance adapter** — `resolveWorkforceCalendarDay` (`R/src/lib/workforce/calendar.ts:64`) maps a day to SCHEDULED, NON_WORKING, PUBLIC_HOLIDAY, TENANT_CLOSURE, APPROVED_LEAVE, APPROVED_ABSENCE or PERSONAL_EXCEPTION, with `attendanceExpected`, `noShowEligible` and `excused`. Leave is recognised only by an agent-scoped row whose `source` is `WORKFORCE_LEAVE` or `WORKFORCE_ABSENCE`.

**Editing APIs — both withdrawn**
- `GET/PUT /api/v1/mtm/work-calendar` and `DELETE …/[id]` (`R/src/app/api/v1/mtm/work-calendar/route.ts`); they refuse moved days.
- `GET/POST /api/v1/workforce/configuration/calendar` → `R/src/lib/workforce/calendar-configuration.ts`: create PUBLIC_HOLIDAY, COMPANY_HOLIDAY or EXCEPTION_WORKDAY, future dates only, plus an atomic moved-day pair and its reversal.
- There is currently no live way to edit the calendar.

**Live readers today**
- `R/src/app/api/v1/mtm/mobile/week/route.ts:295`
- `R/src/app/api/v1/mtm/week/attention/route.ts:90` and `R/src/lib/mtm/panel-attention.ts`
- `R/src/app/api/v1/mtm/routes/route.ts:275`, `routes/[id]/route.ts:578`, `routes/candidates/route.ts:458`
- `R/src/app/api/v1/mtm/route-change-requests/[id]/decision/route.ts:153`
- `R/src/app/api/v1/mtm/mobile/routes/targets/route.ts:153`
- `R/src/app/api/v2/mtm/mobile/route-field/planning-targets/route.ts:329`
- `R/src/lib/mtm/mobile-route-command.ts:284`, `R/src/lib/mtm/field-eligibility.ts:87`
- `R/src/components/mtm/route-calendar.tsx:261`

## 4. Timesheet

- **Per workday only.** `GET /api/v1/workforce/timesheet` (`R/src/app/api/v1/workforce/timesheet/route.ts:100`, at most 93 days) returns one row per existing `MtmAgentWorkday`. Days without a workday have no row; leave, holidays and weekends never appear.
- No-show cases without a workday come back in a separate `unrecordedWorkdayExceptions` list.
- **Live row (`:445-503`):** workday columns plus `date`, `review{evidenceReview, exceptions[{type,status}]}`, `workedSeconds`, `calculation`, `calculationStatus`.
- **Stored row in `rows` JSON** (`R/src/lib/workforce/timesheet-approval.ts:10-16`): `{workdayId, agentId, workDate, calculationVersion, calculation}`.
- `calculation` holds `status`, `isFinal`, `plan{plannedStartAt, plannedEndAt, expectedWorkSeconds, workDate, timezone}`, `fact{startedAt, completedAt, workedSeconds, pausedSeconds, longestPauseSeconds}`, `deviations{lateStart, undertime, overtime, longPause seconds}`, `exceptions[]` and `immutableSchedule{…}`.
- Rows are built by `R/src/lib/workforce/timesheet-approval-service.ts:301` through `rehydrateWorkforceTimesheetDay` (`R/src/lib/workforce/timesheet-rehydration.ts:174`).
- **Approval** (`WorkforceTimesheetApproval`, `schema.prisma:8952`): per agent and arbitrary period, append-only revisions (APPROVAL, then CORRECTION with a reason), `rowsHash` and `factsHash`. Only COMPLETED final days qualify. Blockers: `WORKDAY_NOT_FINAL`, `SNAPSHOT_MISSING`, `HISTORY_INVALID`, `UNRESOLVED_EXCEPTION`.
- **Export:** JSON only, format `workforce-approved-timesheet-v1` (`R/src/app/api/v1/workforce/timesheet/approvals/[id]/export/route.ts`, `R/src/lib/workforce/timesheet-export.ts`). No xlsx, pdf or csv exists in the Workforce code. Overtime is labelled `OPERATIONAL_DEVIATION_NOT_PAYABLE`.
- **Aggregate report:** `R/src/lib/workforce/approved-timesheet-report.ts` gives per-employee sums from approved rows.
- **UI:** `/workforce/timesheet` → `TimesheetView` in `R/src/components/workforce/workforce-workbench.tsx:1122`. Columns: employee, date, status, planned, actual, evidence review, exceptions, deviations.

**Vocabulary**
- Day status: NOT_STARTED, STARTED, PAUSED, COMPLETED.
- Calculation status: `WORKFORCE_TIMESHEET_CALCULATED`, `…_SNAPSHOT_MISSING`, `WORKFORCE_WORKDAY_HISTORY_INVALID` (the UI also knows `…_SNAPSHOT_READ_DISABLED`).
- Exception types (`R/src/lib/workforce/exception-policy-draft.ts:14-25`): LATE_START, UNDERTIME, OVERTIME, LONG_PAUSE, NO_SHOW, MISSED_FINISH, DELAYED_CLAIM, SITE_TRANSITION_REVIEW, DEVICE_SECURITY_REVIEW, ATTENDANCE_PROOF_REVIEW.
- Exception stages: OPEN, ACKNOWLEDGED, AWAITING_EMPLOYEE_RESPONSE, HR_REVIEW, RESOLVED, DATA_INTEGRITY_REVIEW.
- Approval state: NOT_APPROVED, APPROVED, CORRECTED.
- Manager "today" state (`R/src/lib/workforce/manager-today.ts:58-65`): STARTED, PAUSED, COMPLETED, NO_SHOW, SCHEDULED_NOT_STARTED, NOT_EXPECTED, SCHEDULE_UNAVAILABLE.
- There are no tabel-style letter codes.

## 5. Corrections

**DB guard** — trigger `workforce_completed_workday_guard` (BEFORE UPDATE OR DELETE on `mtm_agent_workdays`), function `workforce_guard_completed_workday`. Three migrations define it:
- `20260828224500_workforce_h3_legacy_fact_guard` (created);
- `20260828230000_workforce_direct_correction_contract` (added `totalPausedSeconds` to the allowed fields);
- `20260915210100_workforce_workday_reopen_ledger` (current body).

Its rules:
- DELETE is always rejected.
- An open workday may change freely except `id`, organization, agent and `workDate`.
- A COMPLETED workday may change only `status`, `startedAt`, `pausedAt`, `completedAt`, `totalPausedSeconds` and `updatedAt`, and must stay COMPLETED with `completedAt > startedAt`.
- That change is accepted only if the transaction-local setting `app.workforce_correction_id` names a `workforce_time_corrections` row whose `beforeFacts` equal the old row and `afterFacts` equal the new row.
- The single exception is COMPLETED → PAUSED with `app.workforce_reopen_id` naming a matching `workforce_workday_reopens` row.
- `mtm_agent_workday_events` is append-only (`workforce_workday_events_append_only`).

**The only legal way to change a finished workday's times** — in one transaction:
1. `set_config('TimeZone','UTC',true)`.
2. Insert `WorkforceTimeCorrection` with exact before/after facts `{id, workDate, status, startedAt, pausedAt, completedAt, totalPausedSeconds}`.
3. `set_config('app.workforce_correction_id', id, true)`.
4. Update the workday.

Two library functions do this: `correctWorkforceTimeDirectly` (`R/src/lib/workforce/direct-time-correction.ts:122`) and the approval branch of `decideWorkforceRequest`. Both first replay the journal and prior corrections to prove consistency (`R/src/lib/workforce/workday-facts-replay.ts`).

**`WorkforceTimeCorrection` (`schema.prisma:8879`)** — `source` (DIRECT_MANAGER or REQUEST_APPROVAL), `operationId`, `requestHash`, `requestId`, `actorUserId`, `reason`, `beforeFacts`, `afterFacts`, `occurredAt`. Append-only. The insert trigger requires an approved matching request for REQUEST_APPROVAL (`20260828223000_workforce_h3_foundation`, lines 601-625).

**Direct manager correction**
- Body: `operationId`, `expectedUpdatedAt`, `startedAt`, `completedAt`, `reason` (1–1000).
- Only on a COMPLETED workday (`:234`), never the manager's own day.
- Changes start and end only; pauses stay as they were.
- Route `POST /api/v1/workforce/workdays/:id/corrections` (MFA, rate limit) is withdrawn.
- `R/src/lib/workforce/correction-bounds.ts` (window days, max duration, max delta) is not called from anywhere.

**Reopen** — `reopenWorkforceWorkday` (`R/src/lib/workforce/workday-reopen.ts:410`), `WorkforceWorkdayReopen` (`:8919`).
- Only today's COMPLETED day (tenant timezone), by a manager, with a reason of 3–1000 characters.
- Blocked by another open workday, an approved timesheet, a pending correction request, or any existing correction (`:243-309`).
- Writes a `REOPEN` event at the previous finish instant and a ledger row (before/after, actor, reason). The day becomes PAUSED from the old finish, so the gap counts as pause.

**Undo** — `R/src/lib/workforce/workday-reopen-undo.ts`.
- Only while REOPEN is still the last event and the day is today's.
- Appends a FINISH at the same instant (`clientEventId` prefix `reopen-undo:`), restoring `completedAt` exactly.
- Adds an audit row, but no new ledger row.

## 6. Employee directory facts

`MtmAgent` (`schema.prisma:5735-5775`) has: `name`, `email`, `phone`, `externalCode` (unique per organization, the only personnel-number-like field), `role` (ADMIN, MANAGER, SUPERVISOR, AGENT), `status` (ACTIVE, INACTIVE, SUSPENDED), `teamId`, `managerId`, `userId`, `tags`, `createdAt`.

Not on `MtmAgent`: hire date, termination date, position or job title, department, employment type, home site. (`User.department` exists at `:630` as a free string.)

Related Workforce tables:
- `WorkforceEmploymentEvent` (`:5895`): HIRE, TERMINATION, REHIRE with an `effectiveAt` instant. Append-only, forward-only, `@@ignore` in Prisma, so access is raw SQL (`R/src/lib/workforce/employment-history.ts`). The only consumer is the no-show candidate reader.
- `WorkforceEmployeeTeamMembership` (`:5872`): team history, written by a DB trigger on `mtm_agents` (migration `20260830130000`), so it is still accumulating.
- `WorkforceSiteAssignment` (`:8361`): PRIMARY, SECONDARY, TEMPORARY, effective-dated; `WorkforceSite.type` is OFFICE, WAREHOUSE, TEMPORARY, CUSTOMER or HOME_REMOTE.

## 7. Notifications

- **No-show cron** (`R/src/app/api/cron/workforce-no-show-review/route.ts`, `R/src/lib/workforce/no-show-review-scheduler.ts`):
  - Per tenant it needs the capability plus feature flag `workforce-no-show-review-v1`; the route comment says it is intentionally absent from the deployment schedule.
  - It scans the previous UTC day, 20 agents per slice.
  - It creates a review-only `WorkforceExceptionCase(kind NO_SHOW)` and an aggregate audit row, and sends no notification.
  - A candidate (`R/src/lib/workforce/no-show-candidate.ts`) needs a published shift that day, employment state EMPLOYED, a calendar day that expects attendance and is not excused, no workday row, and expired grace.
- **Missed finish** (`R/src/lib/workforce/exception-intake.ts:420-458`, `missed-finish-candidate.ts`, `missed-finish-case-materializer.ts`): a pure planner (private reminder, then review case) with `automaticFinish: "FORBIDDEN"`. The thresholds are caller inputs, and the materializer has no caller outside tests.
- **Exception notifications** (`R/src/lib/workforce/exception-notification-draft.ts`): a pure in-app planner; no delivery code was found.
- **Actually written:** only the request-decision notifications ("HR request approved/rejected", "Routes need replanning", `request-decision.ts:555-579`).
- **Delayed claim:** an event received more than 15 minutes after its claimed time is marked `PENDING_REVIEW`; the review-case insert is gated off (`R/src/lib/mtm/workday.ts:636`).
- **Live MTM:** `MtmAlertType` has LATE_START and OVERTIME values, but I found no generator. `R/src/lib/cron/mtm-auto-checkout-job.ts` handles visits only. Nothing auto-closes a workday.

## 8. UI (all behind `R/src/app/(dashboard)/workforce/layout.tsx`, which calls `notFound()`)

| Page | Component (`R/src/components/workforce/…`) | What it showed |
|---|---|---|
| `/workforce` | `workforce-workbench.tsx` (today) + `workforce-manager-today.tsx` | Employee start/pause/finish; manager board with plan, calendar state, attendance state, exceptions, previous open day |
| `/workforce/timesheet` | `workforce-workbench.tsx` (`TimesheetView`, `TimesheetApprovalPanel`) | Table, approve period, export preview |
| `/workforce/requests` | `workforce-workbench.tsx` (`SelfRequestPanel`, `RequestsView`) | Submit Leave / Absence / Time correction; approve or reject with note; route-conflict acknowledgement |
| `/workforce/calendar` | `workforce-calendar-configuration.tsx` | Holidays, exception workdays, moved days by scope |
| `/workforce/configuration` | `workforce-configuration-workbench.tsx`, `workforce-shift-segment-editor.tsx`, `workforce-access-management.tsx`, `workforce-attendance-administration.tsx`, policy preview/restore components | Policies, shifts, assignments, sites, grants, QR and devices |
| `/workforce/configuration/policy-versions` | `workforce-policy-version-comparison.tsx` | Version diff |
| `/workforce/exceptions` | `workforce-exception-queue.tsx` | HR review queue |
| `/workforce/exceptions/mine` | `workforce-my-exceptions.tsx` | Employee's own cases |
| `/workforce/exceptions/report` | `workforce-exception-report.tsx`, `workforce-exception-recorded-outcomes.tsx` | Aggregates |
| `/workforce/reports` | `workforce-approved-report.tsx` | Sums from approved timesheets |
| `/workforce/reports/site-transitions` | `workforce-site-transition-report.tsx` | Arrival/departure claims |
| `/workforce/evidence` | `workforce-evidence-timeline.tsx` | Evidence timeline |

Live MTM code that already reads workdays ungated:
- `R/src/app/api/v1/mtm/agents/route.ts:221` (today's state and breaks);
- `R/src/app/api/v1/mtm/agent-period/route.ts:61`;
- `workedSeconds()` in `R/src/lib/mtm/operational-week.ts:152`;
- `R/src/lib/mtm/workday-pauses.ts`.

## Checklist

**Already modelled — reuse**
- **Public holidays, company closures, extra workdays, moved days:** `mtm_work_calendar_days` + `resolveWorkCalendarDay` / `resolveWorkforceCalendarDay`.
- **Approved leave or absence as a per-day mark:** agent-scoped calendar rows with source `WORKFORCE_LEAVE` / `WORKFORCE_ABSENCE`, and the `mtm_hrm_requests` range behind them.
- **Late arrival:** `calculateWorkforceTimesheetDay` (LATE_START against planned start and grace).
- **Manual time correction with audit:** `workforce_time_corrections` plus the DB guard; `workforce_workday_reopens` for same-day reopen.
- **Pauses, worked seconds, long pause:** the event journal, `workday-facts-replay.ts`, `workday-pauses.ts`.
- **Schedule and norm definitions:** policies, shift templates, three assignment timelines, per-workday snapshots.
- **Team history:** `workforce_employee_team_memberships`.

**Modelled only partly**
- **Annual leave:** generic LEAVE only; no sub-type, balance or half-day.
- **Sick leave / unpaid leave / hours off with permission:** only as LEAVE or ABSENCE with free-text reason, whole days; no hours.
- **Business trip:** only as a planned `TRAVEL` segment in a template; no request or per-day mark.
- **Remote work:** `REMOTE` segment mode and `HOME_REMOTE` site type, template-level only.
- **Overtime approval:** OVERTIME deviation exists, explicitly non-payable; no pre-authorisation.
- **Weekend/holiday work:** plannable via EXCEPTION_WORKDAY / MOVED_WORKDAY; an unplanned workday on an off day gets no snapshot and blocks period approval.
- **Part-time:** a per-agent shift window is possible, but `expectedWorkSeconds` lives in a policy scoped to organization or team only; no employment-type field.
- **Early leave:** only as UNDERTIME; no comparison with planned end.
- **Absence without reason:** NO_SHOW case kind and manager-today state; the scheduler never ran in production schedule, and there is no day row.
- **Forgotten check-out:** MISSED_FINISH vocabulary and an unwired planner. The fix path is an employee TIME_CORRECTION with `requestedEndAt`, because direct manager correction needs a COMPLETED day.
- **Hired/dismissed mid-month:** `workforce_employment_events` exists but is raw-SQL, forward-only and not consumed by the timesheet.

**Not modelled at all**
- Training.
- Time off in lieu.
- Shortened pre-holiday day.
- Night shift across midnight (rejected by the shift schema; the workday is keyed to one `workDate`).
- Leave balances or accruals.
- Document attachment on requests.
- Multi-level approval.
- Leave sub-type enum.
- Tabel-style day codes.
- xlsx/pdf timesheet export.
- Rows for days without a workday.
