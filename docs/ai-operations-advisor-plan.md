# Da Vinci Operations Advisor — Architecture Plan

Implementation tickets for the full target state are tracked in
`docs/ai-operations-advisor-100-tickets.md`.

## Goal

Build an AI operations layer inside LeadDrive that helps managers run sales, tasks, finance, support and field execution from one controlled CRM.

The feature should not start as a fully autonomous agent. The first strong version should be an advisor: it reads permitted CRM data, answers business questions, detects exceptions, explains why they matter, and proposes actions that a human can approve.

## Product Positioning

**One platform to manage the business.** Managers keep their customer base, monthly action plan, tasks, offers, invoices, route activity and KPI responsibility in LeadDrive. Da Vinci monitors routine signals and tells the team where attention is needed.

Example questions:

- Which leads are going cold and should be touched today?
- Which deals or commercial offers have not moved?
- Which tasks are aging or overdue by manager?
- Which invoices or payments are overdue?
- Which route visits or field photos need attention?
- What would happen if we move budget from one campaign/channel to another?
- Which managers are on track against their monthly activity plan and KPI?

## Existing Foundation

- AI chat and tool calling: `src/app/api/v1/ai/chat/route.ts`, `src/lib/ai/read-tools.ts`.
- Lead and deal AI: `src/app/api/v1/lead-scoring/route.ts`, `src/app/api/v1/deals/ai-analysis/route.ts`, `src/app/api/v1/deals/ai-suggestions/route.ts`.
- Semantic search foundation: `src/app/api/v1/search/semantic/route.ts`, `src/app/api/v1/search/semantic/index/route.ts`, `src/lib/semantic-search/*`.
- Shadow actions: `AiShadowAction` in `prisma/schema.prisma`.
- Proactive alerts: `ProactiveAlert` in `prisma/schema.prisma`.
- Tasks and boards: `Task`, `Division`, `BoardPermission`, `BoardColumn`, `TaskActivity`.
- Access controls: `FieldPermission`, `SharingRule`, role/module permissions.
- Finance signals: invoice overdue status and finance cron in `src/instrumentation.ts`.
- Field execution: `MtmRoute`, `MtmVisit`, `MtmTask`, `MtmPhoto`.

## Architecture

### 1. Data Access Layer

Create a permission-aware retrieval layer for advisor questions.

Inputs:

- `organizationId`
- `userId`
- role/module permissions
- optional manager scope: owner/team/territory/board
- question intent

Outputs:

- normalized records from deals, leads, tasks, invoices, quotes/offers, tickets, campaigns, MTM visits and photos
- source links for every answer
- redacted fields when field permissions require it

Hard rule: the advisor should only see what the current user is allowed to see.

### 2. Signal Engine

Compute deterministic signals before asking the model to reason.

Initial signals:

- cold lead: low score, no recent activity, stale status
- stalled deal: no stage transition or activity for N days
- quote/proposal idle: sent/viewed but no action for N days
- overdue invoice/payment: status overdue or due date exceeded with balance due
- aging task: open task older than SLA or due soon/overdue
- support risk: SLA warning/breach, repeated tickets from same company
- route risk: late start, stale visit, route deviation, long break
- field-evidence risk: rejected field photo
- manager plan risk: monthly planned actions vs completed activity count

The model should explain signals; it should not invent them.

### 3. Advisor Orchestrator

Flow:

1. User asks a business question.
2. Intent router chooses relevant tools/data sources.
3. Retrieval layer fetches permission-safe records.
4. Signal engine computes facts.
5. Model produces answer with citations and recommended actions.
6. Proposed actions are saved as `AiShadowAction`.
7. User approves, rejects or edits.
8. Approved action writes to the real module and logs audit.

### 4. Action Layer

Start with safe, reversible actions:

- create task
- assign task
- draft email/WhatsApp follow-up
- create invoice reminder task
- create manager alert
- create note/activity
- suggest campaign/channel budget change
- flag route issue for supervisor

Avoid in v1:

- automatic budget movement
- automatic mass messaging
- automatic permission changes
- automatic deletion/export
- any action that sends money, deletes data or exposes customer lists

### 5. UI

Add a single `Da Vinci Advisor` surface:

- global command/search bar: ask any business question
- answer panel with source records
- recommendation cards grouped by module
- approval queue for shadow actions
- manager view: "Today needs attention"
- record-level widget: "Why is this lead/deal/task at risk?"

### 5.1 UX/UI Architecture

The Advisor should feel like an operations control center, not like a generic AI chat. The repeated interaction model is:

`signal -> evidence -> why it matters -> next safe step -> approval -> audit trail`

Primary screens:

- **Today:** the default view and main daily workflow. It is a prioritized work queue of risks, overdue items and operational stalls. Each row should answer "what needs attention now?" and open an evidence panel.
- **Modules:** coverage and health by business domain. This is a navigation/filter layer, not a second dashboard. It shows CRM, sales, contracts, marketing, tasks, logistics/routes, finance, ticketing/support, field execution and KPI coverage.
- **Ask:** an investigation tool, not a free-form chatbot. It should use quick prompts, scoped answers, matched signals and source links so users can narrow risk areas without losing auditability.
- **Approval Queue:** the trust layer. Every proposed action must show who/what it affects, what will change, risk level, editable payload and approve/reject controls.
- **History:** review and audit trail for accepted/rejected recommendations and their execution state.
- **Record Widget:** embedded on lead/deal/task/ticket/route/invoice records. It answers "why is this record at risk?" with a compact explanation chain, source links and one safe next action.
- **Route / Logistics Lens:** a focused operational lens inside the same Advisor center for route delays, open visits, skipped stops, long field breaks and delivery/logistics stalls. This should not be a separate AI product; it is the routes module view of the same signal system.

Visual principles:

- calm enterprise density: compact rows, tabs, side evidence panel, no oversized AI hero
- evidence-first layout: facts and source links always near the recommendation
- semantic severity only: critical/high/medium/low colors should communicate state, not decorate the page
- one primary action per risk card: queue the safe next step, then move to approval
- no autonomous language: use "recommended", "queued", "requires approval", "executed", "failed"
- fast feedback states: skeleton loading, empty safe state, queued confirmation, failed action state

The "wow" effect should come from operational clarity:

- the system surfaces hidden cross-module risks before the manager searches for them
- every recommendation is explainable in two or three facts
- record-level widgets make AI visible exactly where work happens
- the approval queue previews the action before anything mutates business data
- source links let a manager jump from insight to the original CRM object in one click

#### Screen Layout

The main Advisor surface should use a four-zone layout:

- **Command strip:** search, quick prompts, date scope and refresh. This is always visible at the top because the user should be able to ask, filter or refresh without scrolling.
- **Signal rail:** prioritized risks grouped by severity and domain. Rows should stay compact and scannable: module, title, owner, amount/SLA if relevant, severity and one recommended step.
- **Evidence panel:** selected signal details. It shows why the signal exists, facts, source records and the recommended action. This replaces modal-heavy exploration.
- **Action/audit panel:** pending approval queue and execution history. This makes governance visible on the same screen as recommendations.

On wide desktop, these zones can sit as `signal rail + evidence panel + action panel`. On laptop/tablet, use `signal rail + evidence panel` with queue/history under tabs. On mobile, collapse into stacked tabs: Today, Detail, Queue, History.

The v1 route should remain `/ai/actions` because the current product already has AI action governance there. The Advisor should upgrade that route into the operating center instead of creating a second disconnected AI destination. If a future `/ai/advisor` route is added, it should redirect or mount the same center, not split the queue/history model.

#### Information Architecture

The IA should keep one source of truth and many entry points:

- **Main route:** `/ai/actions` is the Advisor Center and owns Today, Modules, Ask, Approval Queue and History.
- **Deep links:** selected domain, owner, signal and tab should be expressible in URL state, for example `?tab=today&domain=routes&signal=...`, so managers can share the exact risk view.
- **Module links:** every source link opens the real CRM module: lead, deal, contract, campaign, task, invoice, ticket, route, visit, field photo or KPI owner.
- **Record widgets:** record pages call the same advisor signal API with `entityType/entityId` and show only local risks plus one safe next action.
- **Global command entry:** the top command/search bar should open the same Advisor context and prefill Ask, not create a separate chat session.
- **Notifications:** daily briefing, sidebar badges and dashboard widgets should all point back to the same selected Advisor signal or queue item.

#### Card and Row Anatomy

Every Advisor signal row should have the same structure:

- domain badge: CRM, sales, contracts, marketing, tasks, logistics/routes, finance, ticketing/support, field execution or KPI
- severity badge: critical, high, medium, low
- human title: what is wrong
- owner or team
- business metric: amount, SLA age, overdue days, route delay, plan gap or completion ratio
- one next step button

Every selected signal detail should show:

- "why this matters" summary in one sentence
- 2-4 facts, formatted as label/value chips
- source links to the exact CRM objects
- recommended action preview
- confidence/safety note when the action is risky or incomplete

Every queued action should show:

- target object and module
- action payload preview before approval
- editable JSON only as an advanced escape hatch
- current status: queued, executing, executed, failed or rejected
- failure reason when execution fails

#### Interaction Rules

- Clicking a signal selects it inline; it should not open a modal.
- Clicking a source link opens the real module record in the current app navigation.
- Queueing an action should immediately move it to Approval Queue with a toast and preserved evidence snapshot.
- Approving an action should change the status to "queued", not "done". The action becomes "executed" only after the background executor writes to the real module.
- Rejected actions remain in History with their original evidence, so managers can audit why advice was ignored.
- The Ask tab should answer by selecting/filtering signals where possible; it should not become a separate chat transcript that hides operational work.
- Module tiles should filter Today instead of navigating away by default. The user should feel "show me route risks" or "show me finance risks", not "leave the control center".
- Queue and approve interactions should be optimistic only for UI placement. Business completion is never optimistic; it appears only after the executor writes the module record and marks the action executed.
- Inline editing is for business payloads, not raw AI prompt tuning. JSON remains an advanced escape hatch, with a later product step to replace it with typed forms per action type.

#### Interaction Architecture

The main loop should be fast and predictable:

1. **Scan:** user lands on Today and sees severity, module, owner and business metric without opening anything.
2. **Inspect:** selecting a row updates the evidence panel in place, preserving scroll position in the signal rail.
3. **Trust:** evidence panel shows facts first, then source links, then recommended action. The action never appears without proof.
4. **Queue:** queue button creates `AiShadowAction` with evidence snapshot and visible pending state.
5. **Approve:** approval queue previews target, payload, risk and source snapshot before mutation.
6. **Execute:** background executor moves status through approved/executing/executed/failed and the audit panel reflects the final state.
7. **Return:** source links and record widgets let the user move back to the module where work continues.

For route/logistics signals, the detail panel should prefer operational evidence over generic text: planned stops, visited count, missed stop, delay minutes, last activity, route owner and linked visit/photo/order. A map can be added later, but the first version must work as a dense route timeline even without geospatial rendering.

#### States and Feedback

Required UI states:

- loading: skeleton rows and detail placeholders, not a centered spinner as the only feedback
- empty: "no active signals for enabled modules" plus module coverage so the user understands whether the system is quiet or disconnected
- no access: module tile explains permission/module limitation
- queued: visible pending state in Approval Queue
- executing: blue progress state for approved actions being processed
- executed: green completion state with execution timestamp
- failed: red failure state with actionable error reason
- stale data: show last refresh time and manual refresh

#### Visual System

Use restrained product UI:

- compact density, clear hierarchy, same button and badge vocabulary as the rest of LeadDrive
- state colors only for meaning: red risk/failure, amber warning, blue in-progress/info, green executed/healthy
- no decorative AI gradients, glass panels or chatbot-first layout
- source/evidence areas should look like operational proof, not marketing cards
- action buttons should use familiar icons: approve, reject, edit, source, refresh, search

Concrete visual hierarchy:

- **Top strip:** title, short operating scope, last refresh, manual refresh and command input. Keep it compact; no hero.
- **KPI strip:** four to six small tiles only for decision context: open risks, critical risks, money at risk, pending actions, failed executions and active module coverage.
- **Signal rail:** dense list with stable row height. Use selected background, not large shadows. Rows should survive long company names and multilingual text.
- **Evidence panel:** uses small labeled facts, source buttons and a single highlighted next action. It should read like proof, not copywriting.
- **Action trail:** compact approval cards with status badges, evidence snapshot and action preview. This is the trust layer and should be visible on wide screens.
- **Record widget:** same visual vocabulary at smaller density: severity/domain, one summary, top facts, top sources and one queue button.

Use motion only for state feedback:

- row selection highlight: 150-200 ms color transition
- queue success: toast plus the action card appearing in Approval Queue
- executing: spinner/icon only on the specific action, not page-wide loading
- failed: inline red failure block with retry/review path when available
- respect reduced motion; no animated AI background or page-load choreography

#### Visual Interaction Architecture

The interface should be built around progressive disclosure. A manager should understand the first screen in five seconds, then discover depth only after selecting a risk.

Visual hierarchy by attention level:

1. **Urgency:** severity, overdue/SLA/amount and owner must be visible in the signal row before any long description.
2. **Reason:** the selected detail panel explains the signal with facts and sources, not model prose first.
3. **Action:** the next safe step is visually primary only after evidence is visible.
4. **Governance:** approval status, execution state and audit history stay visible enough that AI never feels like an uncontrolled black box.

Interactive patterns:

- **Command-first filtering:** the top command input should support text search plus quick chips such as `Money`, `Routes`, `SLA`, `Overdue`, `No owner`, `Critical`.
- **Keyboard-friendly scan:** arrow keys should move through signal rows, `/` should focus search, and `Enter` should open the selected detail when the route is browser-verified.
- **Context-preserving drilldown:** selecting a risk updates URL state and detail content without resetting filters or scroll position.
- **Inline action preview:** queued actions should be previewed as typed fields before approval. Raw JSON is an advanced fallback, not the normal manager experience.
- **Micro-feedback:** queue, approve, reject, execute and fail states should update the exact affected row/card instead of refreshing the whole page.
- **Explainable ask:** asking a question should either filter/select matching signals or return an answer with matched signal links. It should not create a detached chat history.
- **Route lens interaction:** route/logistics signals should expose stop progress, missed stops, delay, last activity and linked visit/photo/order in a compact timeline before any future map view.

Avoid:

- a full-screen AI chatbot as the main entry point
- large decorative hero blocks on an operational page
- card grids where every module looks equally important
- hidden approval state after queueing an action
- generic "AI confidence" without facts, source records and business impact
- autonomous wording such as "AI fixed", "AI sent", or "AI changed" unless the execution audit proves it happened

#### Frontend Component Architecture

Implement the Advisor UI as reusable product components instead of a single growing page component:

- `AdvisorShell`: owns URL state, responsive layout, tab selection, command strip and refresh state.
- `AdvisorCommandStrip`: search, quick prompts, domain/date/owner filters, stale data warning and manual refresh.
- `AdvisorKpiStrip`: compact decision metrics such as open risks, critical risks, money at risk, pending actions, active modules and failed executions.
- `AdvisorSignalRail`: virtualizable/scannable risk list with severity/domain/owner/metric and selected-row state.
- `AdvisorSignalDetail`: evidence chain, source links, route-specific facts and recommended action preview for the selected signal.
- `AdvisorModuleCoverage`: module health/filter tiles for CRM, sales, contracts, marketing, tasks, finance, ticketing, routes/logistics, MTM and KPI.
- `AdvisorAskPanel`: scoped question input, quick questions, answer, matched signals and source references.
- `AdvisorActionPreview`: typed preview for `create_task`, `create_alert`, `create_note`, `draft_followup` and `suggest_budget_change`.
- `AdvisorApprovalQueue`: pending approval list with edit/approve/reject and execution-state polling.
- `AdvisorHistoryTrail`: reviewed actions, failure reasons and audit metadata.
- `AdvisorRecordWidget`: compact record-level version that reuses the same signal/action vocabulary.

State ownership:

- URL state owns `tab`, `domain`, `owner`, `signal`, `scope` and future `query`.
- API payload owns `capabilities`, `signals`, `answers`, `actions`, `lastRefreshedAt` and `coverageReason`.
- Local UI state owns transient editing drafts, selected mobile detail state and optimistic queue placement.
- Business completion state must come only from the action executor and audit records.

Responsive architecture:

- **Desktop:** three-panel operating center: signal rail, evidence detail, action/audit trail.
- **Laptop:** two-panel layout with queue/history behind tabs below or beside detail.
- **Tablet:** stacked command/KPI, signal list and detail sections with sticky command strip.
- **Mobile:** tabbed workflow: Today, Detail, Modules, Ask, Queue, History. Rows must use stable height and truncation rules for multilingual names.

Accessibility and clarity:

- every icon-only action needs an accessible label and tooltip
- severity cannot rely on color alone; badges need text labels
- selected row and focus state must be visible in light and dark themes
- long company names, route names and multilingual text must wrap or truncate without shifting row controls
- loading should use skeleton rows/panels; empty states must distinguish quiet system, disabled modules and missing permission

#### Wow Interaction Architecture

The impressive moment should be "the system already understands my business flow", not "the screen has AI decoration".

Build the wow layer in this order:

1. **Daily briefing:** a compact top summary that says what changed since last refresh: new critical risk, money at risk, route issue, SLA breach or manager plan gap.
2. **Causal chain:** when signals are related, show a chain such as `unsigned contract -> overdue invoice risk -> stalled manager task`.
3. **One-click safe next step:** the first recommended action is queueable immediately, but it stays approval-gated.
4. **Action preview diff:** before approval, show what will be created or changed in business language.
5. **Record-local proof:** source records show the same Advisor evidence on their own pages, so the AI center and CRM modules feel connected.
6. **Live execution trail:** approved actions visibly move through queued, executing, executed or failed with timestamps and failure reasons.

#### Wow Layer

The product "wow" should be workflow intelligence, not animation. The strong moments are:

- **Cross-module causal chain:** "Invoice overdue because contract milestone is unsigned and task owner has no recent activity."
- **Risk-to-action continuity:** one click moves from signal to evidence, queues the safest action, then shows execution status.
- **Record-local explanation:** on a deal, ticket, invoice or route, the widget explains the risk without forcing the user back to the AI center.
- **Manager plan lens:** the same risk list can be viewed by owner/team, showing who needs help before the month-end KPI review.
- **Approval transparency:** the manager sees exactly what the AI will do before business data changes.
- **Route reality check:** a field supervisor can filter routes and immediately see late start, missed stop, open visit, field photo or route deviation evidence with the responsible agent and next action.
- **One queue across the business:** CRM, finance, ticketing, marketing and route actions all land in one approval queue, so governance feels stronger instead of scattered.

Do not make the wow layer depend on autonomous execution. The impressive part is controlled foresight with proof.

#### UX Build Tasks

- Done: add URL-state support for tab, domain, owner, date scope and selected signal so Advisor views are shareable and record widgets can deep-link back to the exact risk.
- Done: convert module tiles into active filters for Today, with secondary "open module" links only when the user explicitly wants the source module.
- Done: add typed action preview renderers for `create_task`, `create_alert`, `create_note`, `draft_followup` and `suggest_budget_change` so JSON editing becomes an advanced-only fallback.
- Done: add route/logistics-specific detail rendering: stop progress, missed stop, delay minutes, last activity, linked visit/photo/order evidence and source route link.
- Done: add failed/executing action refresh behavior in the queue so approved actions visibly move through execution states without a full page reload.
- Done: add empty/disconnected diagnostics that explain whether Advisor is quiet because there are no signals, no enabled modules, or no permissions.
- Done: extract the top command strip and KPI strip into reusable Advisor UI components so the operating-center layout is not locked inside one page component.
- Done: extract the signal rail into a reusable Advisor UI component so filtering, empty-state diagnostics and risk row rendering share one operating-center pattern.
- Done: extract module coverage into a reusable Advisor UI component so module health/filter tiles follow the same operating-center component architecture.
- Done: extract the Ask panel into a reusable Advisor UI component so scoped questions, grounded answers and matched signal links share one explainable investigation pattern.
- Done: extract signal detail into a reusable Advisor UI component so evidence chain, related risks, route evidence and recommended action preview share one detail pattern.
- Done: extract approval queue, action preview and execution/history trail into reusable Advisor UI components so shadow-action governance follows the same component architecture.
- Done: run authenticated responsive browser QA on desktop three-panel, laptop two-panel, tablet stacked panels and mobile tabbed workflow; artifacts live in `docs/screenshots/advisor/` with `responsive-qa-report.json`.
- Done: add route-level safety coverage for Advisor action queueing so `/api/v1/ai/advisor/actions` reuses the server-derived signal/action payload, rejects out-of-scope signals and avoids duplicate pending shadow actions.
- Done: keep `/ai/advisor` as a redirect alias to `/ai/actions` so Advisor entry points do not split queue/history governance.
- Done: make `queued` the canonical approved-but-not-executed shadow-action status while keeping the executor compatible with legacy `approved` / `pending` rows.

### 6. Audit and Safety

- Log every advisor question and tool call.
- Store every proposed action in `AiShadowAction`.
- Store active business exceptions in `ProactiveAlert`.
- Keep source links and query scope for every answer.
- Enforce field permissions before model context is built.
- Mask PII where possible before model calls.
- Add rate limits and cost caps per tenant.

Current implementation notes:

- Done: Advisor question audit writes `AiInteractionLog` with intent, scope and source refs in `toolsCalled`.
- Done: Advisor answers return source-linked evidence and query scope, and audit metadata stores compact source refs for replay.
- Done: high and critical Advisor exceptions sync into `ProactiveAlert` with source/fact context and active-alert dedupe.
- Done: Advisor signal context is filtered by owner scope and field permissions before it is used for answers or action payloads.
- Done: Advisor audit text masks obvious email and phone values before storing `userMessage` / `aiResponse`.
- Done: Advisor v1 answers are deterministic over permission-filtered signals; no external model context is built for the Advisor answer path.
- Done: Advisor query route applies burst rate limiting plus tenant AI budget and per-tenant daily Advisor request caps before building an answer.

## One-Month Implementation Plan

### Week 1 — Scope and Deterministic Signals

- Define v1 entities: leads, deals, tasks, invoices, quotes/offers, tickets, MTM routes, visits and photos.
- Implement `advisor/signals` helpers with unit tests.
- Implement permission-aware source fetchers.
- Define response schema: answer, facts, sources, recommendations, proposed actions.

### Week 2 — Q&A and Smart Search

- Build `/api/v1/ai/advisor/query`.
- Reuse semantic search where useful, but do not rely only on embeddings.
- Add deterministic routing for common questions.
- Return source-linked answers.
- Add UI panel or command bar entry point.
- Add URL-state and deep-link behavior for tab, domain, owner and selected signal.

### Week 3 — Recommendations and Shadow Actions

- Add recommendations for cold leads, stalled deals, aging tasks, overdue invoices and route or field-evidence issues.
- Persist proposed actions to `AiShadowAction`.
- Add approve/reject/edit workflow.
- Create audit entries for approved actions.
- Add typed action preview UI and route/logistics-specific evidence rendering.

### Week 4 — Manager Plan and KPI Layer

- Add monthly action plan model or reuse tasks/templates where possible.
- Compute planned vs completed actions per manager.
- Add KPI widgets: action completion, overdue work, response gaps, owner scope.
- Add pilot-ready demo data and screenshots for the deck.
- Seed a pilot tenant with `ADVISOR_DEMO_PASSWORD='<secret-managed-strong-password>' node scripts/seeds/advisor-demo.mjs --slug=<tenant-slug>` before screenshot capture. For a non-local database, also set the tenant-bound confirmation `CONFIRM_PROD=advisor-demo:<tenant-slug>`. The seed creates deterministic Advisor risks across CRM, sales, contracts, marketing, tasks, finance, ticketing, routes/logistics, MTM field execution and KPI owner scope. Use `--clean` to remove only demo rows tagged with `ADV-DEMO` / `@advisor-demo.local`; clean-only runs do not require the password but retain the same database guard.
- Run `node scripts/check-advisor-qa-readiness.mjs --slug=<tenant-slug>` before browser capture. It fails fast on missing auth input, stale local schema, missing pilot tenant, disabled Advisor modules or absent demo QA user, without mutating the database.
- Use `scripts/capture-advisor-screenshots.mjs` to capture `/ai/actions` Today, Detail, Modules, Ask, Queue and History at desktop, laptop, tablet and mobile breakpoints when an authenticated session or storage state is available. The script saves PNGs plus `responsive-qa-report.json` and fails on login redirect, missing Advisor content, runtime error text or horizontal overflow.
- Run responsive browser QA for desktop, laptop, tablet and mobile Advisor workflows.

## Deck Wording

Use:

> Da Vinci Operations Advisor answers business questions across CRM data, detects routine exceptions and proposes the next action while permissions, ownership and audit stay controlled.

Avoid:

> AI automatically runs the business.

Use:

> Shadow mode first: AI recommends, the manager approves. Autopilot is enabled only for safe, repeatable workflows.

Avoid:

> Fully autonomous budget and customer management.
