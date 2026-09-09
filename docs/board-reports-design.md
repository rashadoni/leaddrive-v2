# Board Reports — Design (per-Kanban-board analytics)

> Status: **DESIGN ONLY** (not built). Researched against Jira / Linear / Asana /
> ClickUp / Monday / Trello board analytics (Perplexity-verified 2026-06-03) and
> mapped to LeadDrive's actual task data. Goal: a "Reports" tab inside each board
> giving managers the metrics teams actually rely on.

## 1. Data foundation (what we already have)

| Source | Fields usable for reports |
|---|---|
| `Task` | `status`, `boardColumnKey`, `type` (bug/feature/story/epic/task), `priority`, `category` (Q1–Q4), `dueDate`, `completedAt`, `createdAt`, `assignedTo`, `estimatedHours` (Decimal), `estimatedPrice` (Decimal), `checklist[]`, `recurrenceParentId`, `deletedAt` |
| `TaskActivity` | `action='status_changed'` with `oldValue`→`newValue` + `createdAt` → **status-transition timeline** (the basis for cycle time, time-in-status, aging, CFD, reopened). Also assignee_changed / created / deleted. |
| `BoardColumn` | `key`, `label`, `mapsToStatus`, `sortOrder` — the board's lanes |

**Hard caveats (must be designed-around):**
- **Incomplete flow history — THREE gaps, not just "old tasks"** (corrected after architect feasibility review):
  1. *Pre-feature*: `status_changed` rows only exist since the Kanban feature shipped; earlier moves have none, and no backfill is possible.
  2. *Bulk moves are never recorded*: `tasks/bulk` (complete / update_status) changes `status` via `updateMany` and writes **no** `status_changed` row — permanently, for every bulk op. Flow metrics go blind on bulk-moved tasks on **ongoing** usage, not just history.
  3. *Fire-and-forget write*: a single PATCH writes the `status_changed` row **outside** the update transaction (`createMany(...).catch(()=>{})`), so a failed write silently drops the transition.
  ⇒ flow reports (cycle time, time-in-status, CFD, aging, reopened) must show **"based on N of M tasks with usable history"** and fall back to `createdAt→completedAt` (lead time) where transitions are missing. This makes the §5.7 prerequisite **mandatory before Phase B**.
- **Legacy statuses leak in.** `POST /tasks` defaults `status` to legacy `"pending"` (the enum permits the 6 canonical values too, but board-less / CRM-side creates land on the legacy default), and the `created` activity records that. Reports MUST normalise legacy→canonical with the **same fold the board uses** (`STATUS_TO_STAGE`: pending→todo, completed/cancelled→done) when bucketing; otherwise CFD/aging (which key off the 6 canonical statuses) leave legacy-status tasks in no lane.
- **No "blocked" concept.** No blocked flag/status ⇒ no blocked-trend report unless we add one.
- **No sprints.** Boards are continuous Kanban ⇒ no Velocity / Burndown; the Kanban equivalents are **Throughput** and **Burnup**.

## 2. Report catalogue (mapped to our data)

### Tier 1 — essentials (current-state + date aggregations; no TaskActivity needed)

| # | Report | Definition / query | Chart | Notes |
|---|---|---|---|---|
| 1 | **Status / WIP snapshot** | `COUNT(*) GROUP BY boardColumnKey` (deletedAt IS NULL) | horizontal bars / donut | at-a-glance pipeline + bottleneck |
| 2 | **Throughput** | `COUNT(*) WHERE completedAt IN week GROUP BY week` over last N weeks | bar/line | delivery rate + trend |
| 2b | **Assignee throughput** | `COUNT(*) WHERE completedAt ∈ week GROUP BY assignedTo` | bars per person | "who shipped how much" — complements #2 (board total) and #4 (current load) |
| 3 | **Created vs Resolved** | two series: `created` per week (`createdAt`) and `resolved` per week (`completedAt`) | dual line | backlog growing or shrinking? |
| 4 | **Workload by assignee** | `COUNT(*)` + `SUM(estimatedHours)` GROUP BY `assignedTo`, split by status | stacked bar per person | who is overloaded |
| 5 | **Overdue / Due-soon** | overdue = `dueDate < now AND status != done`; due-soon = `dueDate ∈ [now,+7d]` | KPI cards + list | risk surfacing |
| 6 | **Work mix** | `COUNT(*) GROUP BY type` (and toggles for priority / category) | donut/bar | bugs vs features split |

### Tier 2 — flow & time (needs `TaskActivity`; "active stages" = recorded `status` ∈ {in_progress, testing, review} — keyed off the `status` the history stores, NOT column `mapsToStatus`, so it survives Phase-2 custom columns where two columns may share one status)

| # | Report | Definition | Chart | Notes |
|---|---|---|---|---|
| 7 | **Cycle time** | per completed task: `completedAt − (first transition into an active stage)`. Report median + p50/p85/p95 + histogram | histogram + percentile lines | predictability / SLA basis |
| 8 | **Lead time** | `completedAt − createdAt` per completed task (no TaskActivity needed → also a fallback for #7) | histogram | total customer wait |
| 9 | **Aging WIP** | current active tasks; age = `now − (entered current status)`; flag age > p85 cycle time | scatter by column | what's stuck / at risk |
| 10 | **Time-in-status** | from transitions, avg duration each task spent per status | bar per status | bottleneck = high avg |
| 11 | **Cumulative Flow (CFD)** | per day in range, count tasks in each status as-of that day (reconstructed from latest `status_changed ≤ day`, legacy-status-normalised) | stacked area | flow stability + WIP trend; heaviest to compute. ⚠ On incomplete history this is confident-but-wrong — render only WITH the coverage note, or defer until §5.7 is fixed (matches the project's anti-false-positive rule) |

### Tier 3 — quality / forecasting / value

| # | Report | Definition | Chart |
|---|---|---|---|
| 12 | **Bug trend** | `type='bug'`: created vs resolved per week + current open count | line + KPI |
| 13 | **Reopened / rework** | count `status_changed` from a done-stage back to a non-done stage; rework % = reopened (distinct tasks reopened ≥1) ÷ completed (tasks with completedAt) | bar + KPI |
| 14 | **SLA achievement** | % of completed tasks **with a measurable cycle** whose cycle ≤ target (per-board `Division.slaTargetDays`, default 5 **calendar** days — calendar, NOT working days, for coherence with the cycle-time metric) | gauge |
| 15 | **Burnup** | scope (all tasks over time) vs cumulative completed | two lines |
| 16 | **Value / effort in pipeline** | `SUM(estimatedPrice)`, `SUM(estimatedHours)` GROUP BY status (open) | stacked bar | LeadDrive-specific (we have these fields) |
| 17 | **Monte-Carlo forecast** *(advanced, later)* | simulate completion date for the remaining N tasks from the historical throughput distribution | fan chart — ⚠ needs reliable throughput history; gated on §5.7, else it forecasts confident-but-wrong |

## 3. Architecture

- **API**: `GET /api/v1/divisions/[id]/analytics?range=30d&assignee=&type=` — one org-scoped, board-access-gated endpoint (reuse `getAccessibleDivisionIds` + `BoardPermission.canView`, same as the board read). Returns a JSON bundle of the requested tier's metrics. Heavy aggregations (weekly buckets via `date_trunc`, CFD reconstruction) use `$queryRaw`; the rest are Prisma `groupBy`.
- **Performance**: boards are small (tens–low-hundreds of tasks) ⇒ on-demand SQL is fine. The CFD (days × statuses) is the heaviest but still small; add a short-TTL cache (per board+range) only if needed.
- **Frontend**: a **"Reports / Отчёты" tab** on `/boards/[divisionId]` (a tab switch, NOT a new route, so board context/filters persist). Shared top bar: **period (7/30/90d)** + **filters (assignee, type)**. Top row = KPI cards (throughput this week, median cycle time, WIP, overdue count); below = a responsive grid of chart cards. Reuse the project's existing chart components (the CDP/dashboard charts) — do not add a new chart lib.
- **i18n**: en/ru/az keys under a new `boardReports` namespace.
- **Empty/partial states**: every flow report renders "Not enough history yet (N of M tasks have status history)" instead of a misleading chart.

## 4. Build plan (phased — each phase ships independently)

- **Phase A — Tier 1** (the 6 essentials). Pure current-state + `completedAt`/`createdAt` aggregations; no TaskActivity. Highest value-per-effort, zero history caveats. Ships the tab + filters + KPI cards + 6 charts.
- **Phase B — Tier 2** (flow metrics). Adds the `TaskActivity`-based cycle/lead/aging/time-in-status/CFD with graceful partial-history handling.
- **Phase C — Tier 3** (quality/forecast/value). Bug trend, reopened, SLA, burnup, value rollup, then (optionally) Monte-Carlo.

## 5. Open decisions (need user input before building)

1. **Partial flow history** — OK to ship flow metrics covering only tasks that have recorded status transitions (with an explicit "based on N tasks" note)? No backfill is possible.
2. **Blocked tracking** — add a `blocked` flag/label to tasks so we can report a blocked/impediment trend? (Out of scope unless wanted.)
3. **SLA target** — per-board configurable, or a single global default (e.g., 5 working days)?
4. **Export** — should board reports plug into the existing Report Builder (F4) / scheduled-email reports, or be view-only first?
5. **Placement** — confirm a Reports tab on the board (vs a separate page).
6. **First scope** — Phase A only, Phase A+key-flow (cycle time + aging), or full A+B+C.
7. **History prerequisite for flow metrics (architect-flagged)** — before Phase B, fix `tasks/bulk` to emit `status_changed` rows AND make the single-PATCH `status_changed` write transactional (currently fire-and-forget). Without this, cycle time / CFD / aging / reopened are wrong on real (bulk-using) workflows, not just on old data. Small, contained fix — **strongly recommended as a Phase-B prerequisite.** (Tier 1 + lead time + value reports do NOT need it.) *Footnote: the other TaskActivity writes (POST `created`, DELETE soft-delete) are also best-effort fire-and-forget, but they are not flow-metric inputs, so they're out of this decision's scope.*
