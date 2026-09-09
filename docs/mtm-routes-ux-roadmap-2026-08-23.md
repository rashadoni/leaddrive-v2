# MTM Routes — UX/UI roadmap

> **Status:** active implementation roadmap
> **Date:** 2026-08-23
> **Scope:** web Routes, Android MTM application, route/meeting planning, approvals, help
> **Primary language:** Azerbaijani; RU/EN must remain functionally equivalent
> **Related contracts:** `mtm-routes-phase-1-product-plan.md`,
> `mtm-routes-phase-1-ux-contract.md`, `mtm-agent-mobile-v2-master-plan.md`

## 1. North star

The normal planning flow must answer only four questions:

1. **Whose calendar?**
2. **Which day?**
3. **Where / with whom?**
4. **What time?**

An agent who is far from IT must be able to create or change a route without
leaving the calendar, understanding the database model, or asking why a record
has disappeared. A manager must spend attention on exceptions, not on ordinary
routes.

Design words: **calm, practical, reassuring**. The current LeadDrive visual
system remains authoritative; this roadmap changes hierarchy and interaction,
not the product identity.

## 2. Approved UX model

### 2.1 Role-oriented entry points

| User | Default surface | Secondary surfaces |
|---|---|---|
| Agent | **My calendar** | My routes, create route if permitted |
| Manager | **Team calendar** | Needs attention, all routes, reports/export |
| Administrator | **Team calendar** | Policies, reference data, Excel exchange |

Advanced tools are grouped by job. A generic “Other views” menu is not the
primary navigation model.

### 2.2 Calendar-first composition

- The calendar begins in the first viewport on a common laptop.
- The page has one compact title/navigation/action row.
- KPI cards do not sit above the calendar. Operational counters appear only in
  list/report contexts where they help a decision.
- Clicking an empty date opens an Outlook-like planner with the date already
  fixed. The user does not select the same date twice.
- Clicking an existing event opens details in context; edit/change-request is a
  clearly labelled action.

### 2.3 One adaptive planner

- Desktop/tablet: a wide side sheet or context-preserving planner; phone: full
  screen.
- Step 1: person and day.
- Step 2: meeting places, searchable by configured customer type.
- Step 3: order, half-hour time slots, conflicts, save/publish.
- One primary action per step. Back, cancel and draft are secondary.
- A weekly plan is a dedicated seven-day workspace, not a switch inside the
  one-day meeting dialog.
- Target types are tenant-configurable (doctor, pharmacy, clinic, hospital,
  retail point, or any future type) and are not hard-coded as a pharmaceutical
  taxonomy.

### 2.4 Explain and repair missing data

An empty customer list must state the exact reason for every excluded class:
assignment, permission, direction, status, type, territory or active filter.
Where permitted, the screen offers an in-place repair action and returns to the
same planning step. No redirect-and-return loop is allowed.

### 2.5 Safe collaboration

- Same customer + overlapping time produces a blocking or explicitly
  overridable conflict according to tenant policy.
- Same agent + overlapping time is always blocked.
- Travel-time infeasibility is a warning with an explanation.
- Published routes are not silently rewritten. The agent requests a change;
  managers see it in **Needs attention** and can approve/reject it.
- Meeting visibility between agents is tenant-configurable and privacy-safe.

### 2.6 Field workday lifecycle

- **Begin day** is an explicit agent action. After server confirmation the agent
  is online and permitted background location tracking starts.
- **End day** asks for confirmation, records the server-accepted end time and
  stops continuous tracking. It cannot silently leave a stale online status.
- App restart, temporary offline work and process termination restore the real
  server state instead of creating a second workday.
- Managers see the accepted workday state, location freshness and the reason
  when GPS is missing; an old coordinate is never presented as a live one.

## 3. Delivery roadmap

Statuses: **DONE**, **IN PROGRESS**, **NEXT**, **PLANNED**, **BLOCKED**.

### Phase 0 — Baseline and product contract

| ID | Pri | Status | Task | Acceptance evidence |
|---|---:|---|---|---|
| RUX-001 | P0 | DONE | Preserve all legacy route capabilities and document compatibility | Compatibility inventory and existing UX contract remain linked |
| RUX-002 | P0 | DONE | Establish AZ-first, RU/EN-equivalent copy contract | Locale checks cover all new keys |
| RUX-003 | P0 | DONE | Establish 44 px targets, keyboard use, 200% zoom and responsive contract | Acceptance matrix exists in UX contract |
| RUX-004 | P1 | DONE | Capture production baseline and route-page browser evidence | Desktop route page loads without console/page errors |

### Phase 1 — Calendar-first web shell

| ID | Pri | Status | Task | Acceptance evidence |
|---|---:|---|---|---|
| RUX-101 | P1 | DONE | Replace the tall title + toolbar + KPI wall with one compact page header | Calendar starts in first viewport at 1440×900/1000 |
| RUX-102 | P1 | DONE | Rename primary views by job: My calendar / Team calendar | Agent and manager immediately see the relevant entry point |
| RUX-103 | P1 | DONE | Group list, matrix, approvals and Excel under planning/control tools | One visible primary create action remains |
| RUX-104 | P1 | DONE | Show KPI counters only in operational list/report context | Calendar and team week are not preceded by duplicate counters |
| RUX-105 | P1 | IN PROGRESS | Persist last useful view per user without overriding deep links | Returning user lands on the expected view |
| RUX-106 | P2 | IN PROGRESS | Replace duplicated status chips/counters with one filter model | Status count has one source and one interaction |

### Phase 2 — One-day planner simplification

| ID | Pri | Status | Task | Acceptance evidence |
|---|---:|---|---|---|
| RUX-201 | P1 | DONE | Open planner from a calendar cell with date prefilled and non-duplicated | The chosen date appears once and is editable only through an explicit change action |
| RUX-202 | P1 | DONE | Use adaptive sheet/full-screen layout and remove large blank modal areas | No nested page scroll; footer and current action stay visible |
| RUX-203 | P1 | DONE | Keep exactly one primary action per step | A novice identifies the next action without scanning the footer |
| RUX-204 | P1 | IN PROGRESS | Make selected customers/stops compact, removable and reorderable before confirmation | Every draft stop can be changed before publish |
| RUX-205 | P1 | IN PROGRESS | Replace native minute picker with :00/:30 slots | Arbitrary minutes cannot be selected |
| RUX-206 | P1 | IN PROGRESS | Explain “Schedule times” or replace it with a useful automatic scheduler | The action visibly assigns sensible non-overlapping times or is removed |
| RUX-207 | P1 | IN PROGRESS | Add draft autosave, recovery banner and discard/undo | Reload does not silently destroy work; discard is recoverable |
| RUX-208 | P2 | PLANNED | Add keyboard flow and predictable focus between steps | Planner is fully operable without a pointer |

### Phase 3 — Customer discovery and assignment

| ID | Pri | Status | Task | Acceptance evidence |
|---|---:|---|---|---|
| RUX-301 | P1 | IN PROGRESS | Show a unified eligible-customer catalogue with configurable type tabs | All eligible records are discoverable without changing pages |
| RUX-302 | P1 | IN PROGRESS | Add exact empty-state diagnostics for assignment, permission, type, territory, direction and filters | “Why is this missing?” has a specific answer |
| RUX-303 | P1 | IN PROGRESS | Repair an assignment inline and return to the same planner state | No manual navigation back to Routes is required |
| RUX-304 | P1 | IN PROGRESS | Explain assignment ownership and validity dates in plain language | User knows which agent can plan which customer and for what period |
| RUX-305 | P1 | PLANNED | Remove redundant route filters: settlement, city district and organization kind | Core filter chain is Region → Administrative district plus useful customer/type filters |
| RUX-306 | P1 | PLANNED | Make target taxonomy tenant-configurable in Parameters | Non-pharma tenants can rename/add/remove target types |
| RUX-307 | P2 | PLANNED | Add saved filters and remember the last useful catalogue state | Frequent planners do not rebuild the same filter set |
| RUX-308 | P2 | PLANNED | Add bulk assignment/planning operations for large catalogues | Manager can act on multiple customers with a review step |

### Phase 4 — Week planning

| ID | Pri | Status | Task | Acceptance evidence |
|---|---:|---|---|---|
| RUX-401 | P1 | PLANNED | Separate weekly planning from the one-day meeting dialog | No nested “plan week” callout inside a daily flow |
| RUX-402 | P1 | PLANNED | Provide seven day rows/cards with per-day customers, order and time | A whole week is planned without one giant customer list |
| RUX-403 | P1 | PLANNED | Use Azerbaijani month/day names, never M08/M09 or English abbreviations | All user-facing dates are localized and readable |
| RUX-404 | P1 | PLANNED | Make workdays, holidays, capacity and existing load selectable/explainable | Disabled days state the reason; valid days can be selected |
| RUX-405 | P2 | PLANNED | Add copy/move day and repeat-template actions with preview | Repetitive planning is fast and reversible |

### Phase 5 — Conflicts, publication and approvals

| ID | Pri | Status | Task | Acceptance evidence |
|---|---:|---|---|---|
| RUX-501 | P0 | DONE | Block same-agent overlapping meetings server-side and in UI | Conflict cannot be published by race or alternate client |
| RUX-502 | P1 | IN PROGRESS | Warn when multiple agents meet the same customer at overlapping time | Warning names agents, customer, date/time and policy outcome |
| RUX-503 | P1 | IN PROGRESS | Offer one-click conflict fixes: next free slot, change time, remove stop | User resolves conflict inside the planner |
| RUX-504 | P1 | PLANNED | Add travel-time feasibility warning between consecutive stops | Impossible sequence is visible before publish |
| RUX-505 | P1 | PLANNED | Clarify Draft / Planned / In progress / Completed / Cancelled in AZ/RU/EN | Status labels explain what can happen next |
| RUX-506 | P1 | PLANNED | Replace draft-only edit dead end with published-route change request | Agent can request a safe change; manager can approve/reject |
| RUX-507 | P1 | PLANNED | Turn approval queue and customer requests into an actionable “Needs attention” surface | Empty and non-empty states explain purpose and next action |
| RUX-508 | P2 | PLANNED | Add audit trail and undo for manager decisions | Actor, reason, before/after and timestamp are visible |

### Phase 6 — Calendar, team week, list and details

| ID | Pri | Status | Task | Acceptance evidence |
|---|---:|---|---|---|
| RUX-601 | P1 | PLANNED | Make month and team-week cells open the correct day/agent planner | Click has immediate visible response and preserved context |
| RUX-602 | P1 | PLANNED | Add search, scope and exception filters to team week | Large teams remain usable without horizontal hunting |
| RUX-603 | P1 | PLANNED | Replace the dense all-routes card wall with compact decision-oriented rows | Primary status/action is readable at a glance |
| RUX-604 | P1 | PLANNED | Simplify route details and remove hard-coded “Advisor risk” copy | Details show route facts, visits, changes and useful actions only |
| RUX-605 | P2 | PLANNED | Add travel/route preview and clear progress semantics | 0% and point/visit counts cannot contradict each other |
| RUX-606 | P2 | PLANNED | Add explicit role-aware meeting visibility controls | Tenant can enable/disable who sees agent/customer/time/place |
| RUX-607 | P2 | PLANNED | Keep Excel export in report/control context with clear scope | Export explains which filters and dates it uses |
| RUX-608 | P0 | IN PROGRESS | Show Begin day / End day state and location freshness in manager surfaces | Manager can distinguish online, offline, stale GPS and no GPS without guessing |

### Phase 7 — Responsive, accessibility and performance gate

| ID | Pri | Status | Task | Acceptance evidence |
|---|---:|---|---|---|
| RUX-701 | P0 | PLANNED | Verify desktop, tablet, phone, landscape tablet and 200% zoom | No clipped actions, hidden data or horizontal page overflow |
| RUX-702 | P0 | PLANNED | Verify keyboard, focus order, labels, contrast and reduced motion | Critical flow meets WCAG AA expectations |
| RUX-703 | P1 | PLANNED | Replace 10–11 px operational copy and tiny icon-only actions | All decision text is readable and actions have accessible names |
| RUX-704 | P1 | PLANNED | Virtualize/paginate large team and customer datasets | 1000+ rows do not freeze the planner |
| RUX-705 | P1 | PLANNED | Add targeted browser regression for the four-question flow | Agent and manager golden paths pass in AZ/RU/EN |

### Phase 8 — Android MTM parity

| ID | Pri | Status | Task | Acceptance evidence |
|---|---:|---|---|---|
| RUX-801 | P0 | PLANNED | Bring My calendar and permission-based self-planning to the APK | Agent can see, create and change permitted routes on a phone/tablet |
| RUX-802 | P0 | PLANNED | Preserve offline route/day operation and clear sync state | Offline edits recover safely and conflicts reconcile visibly |
| RUX-803 | P0 | IN PROGRESS | Implement reliable Begin day / End day and live GPS lifecycle | Server-confirmed state survives restart/offline recovery; End day stops tracking and clears online state |
| RUX-804 | P1 | PLANNED | Add in-app hints for first use and contextual empty states | Mobile does not depend on the web video guide |
| RUX-805 | P1 | PLANNED | Apply the same half-hour, conflict, assignment and visibility rules | Web and APK cannot create contradictory plans |
| RUX-806 | P0 | BLOCKED | Run physical Android acceptance across supported phone/tablet profiles | Requires signed APK plus real-device location/background tests |

### Phase 9 — Guided help (only after product approval)

| ID | Pri | Status | Task | Acceptance evidence |
|---|---:|---|---|---|
| RUX-901 | P1 | PLANNED | Demonstrate completed web and APK flows to the product owner | Explicit approval received before recording |
| RUX-902 | P1 | PLANNED | Re-test the Azerbaijani Routes flow end to end immediately before capture | No broken step is hidden in the guide |
| RUX-903 | P1 | BLOCKED | Produce detailed Azerbaijani end-to-end web guide | Voiceover requires user-provided audio or explicitly approved external provider |

## 4. Evidence ledger

| Date | Commit / run | Surface | Result | What it proves | Still not proved |
|---|---|---|---|---|---|
| 2026-08-23 | `fb95b69a9` | Production web shell | Deployed; production ping passed | Compact calendar-first header, role-oriented labels, grouped secondary tools, KPI removal from calendar/week | Agent-role visual acceptance and narrow viewport |
| 2026-08-23 | `32653480667` at `ed9b1b755` | Production, admin, desktop, Azerbaijani Routes guide | Passed; HTTP 200; no console/page/response errors; no horizontal overflow | Planner opens, eligible catalogue loads, doctor and pharmacy can be selected, three stops receive times, draft can be created and cleaned up | Phone layout, explicit inline-assignment recovery branch, uniqueness of every generated time |
| 2026-08-23 | `32654605713` at `f63d17ff6` | Production, admin, desktop, Azerbaijani Routes guide | Passed after successful deploy; full create-and-clean-up flow completed | One-scroll catalogue, responsive planner, customer selection and draft creation work on production | Every empty-state reason and explicit inline-repair branch |
| 2026-08-23 | `32654726747` at `f63d17ff6` | Production, admin, phone, Azerbaijani Routes guide | Passed; full create-and-clean-up flow completed | Phone uses the adaptive planner without blocking the current action; the production flow reaches save | Physical-device keyboard behaviour and 200% zoom |
| 2026-08-23 | `32663744445` against production `eb5d118aa` | Production, admin, desktop, calendar-first Routes guide | Passed after the evidence locator was narrowed to the visible calendar surface | Clicking the target desktop calendar cell opens the daily planner with that date prefilled; no second date input appears; create-and-clean-up completes | Agent-role permissions and physical touch input |
| 2026-08-23 | `32664066572` against production `eb5d118aa` | Production, admin, phone, calendar-first Routes guide | Passed; visible mobile calendar day selected and the full draft lifecycle completed | The phone calendar opens the selected day without asking for the date again, and the adaptive planner completes its flow | Physical Android WebView/keyboard behaviour and 200% zoom |
| 2026-08-23 | deploy `32669863934` at merge `3b8af912d` | Production Routes API and planner | Deployed; production ping passed; blocking route-conflict tests passed in CI | Same-agent overlaps are rejected inside the publish/create transactions and protected against concurrent requests | Physical multi-client race reproduction against production |
| 2026-08-23 | deploy `32671654360` at merge `b0eca97bc` | Production mobile bootstrap | Deployed; all quality/build/deploy gates and production ping passed; unauthenticated bootstrap remains `401` | A still-open prior-day workday is returned for safe mobile recovery instead of being misreported as not started | Authenticated restart recovery on a physical Android device |
| 2026-08-23 | PR CI `32671186765`; release `32672036655`; `v2.1.12-build173` | Signed Android APK | Jest, TypeScript, release build, version/package/signature verification and prerelease publication passed | Begin/End day is durable, reconciles with server truth, and `FINISH_PENDING` stops device tracking immediately while closure syncs | Physical phone/tablet background-location, process-death and offline acceptance (`RUX-806`) |

A row records only what was actually observed. Source inspection alone does not
close a visual or interaction task.

## 5. Definition of done for every phase

1. Source, locale copy and acceptance tests are committed together.
2. `git diff --check` and the narrowest relevant lint/type/i18n tests pass.
3. Full build/E2E/Android work runs sequentially in the bounded runner or CI.
4. Production deploy is followed by `/api/v1/ping` and feature-specific smoke.
5. Visible changes are inspected at desktop and the relevant narrow/tablet size.
6. A task is not marked done from code inspection alone when the requirement is
   about interaction or visual behaviour.

## 6. Decisions intentionally deferred

- Exact travel-time provider and tenant override policy.
- Whether same-customer overlap is warning-only or blocking by default.
- Final privacy defaults for agent-to-agent meeting visibility.
- External narration provider for help videos.

These decisions do not block the calendar-first shell or planner simplification.
