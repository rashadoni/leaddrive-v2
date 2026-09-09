# Da Vinci Operations Advisor — 100% Delivery Tickets

## Target State

Da Vinci Operations Advisor is not a generic AI chat. It is a controlled operations layer for LeadDrive:

`data -> signal -> evidence -> why it matters -> safe next step -> approval -> execution -> audit -> playbook learning`

At 100%, a manager can open `/ai/actions` every morning and understand:

- where the business is losing speed, money or control;
- which module owns the issue;
- which owner/team is responsible;
- which source records prove the risk;
- which safe next action is recommended;
- whether the action is waiting, approved, executing, executed, failed or rejected.

The product promise is controlled foresight with proof. Autonomous execution is allowed only for safe, tenant-approved workflows.

## Definition of Done

The Advisor is complete only when all of the following are true:

- All core domains produce real, typed signals: CRM, sales, contracts, marketing, tasks/projects, finance, support/ticketing, routes/logistics, MTM/field execution and KPI/managers.
- Every signal has a stable domain, severity, owner/team label, metric, facts, source links, recommendation and action type.
- The UI never shows technical ids such as CUIDs as user-facing owner names.
- Empty states distinguish `no active risks`, `module disabled`, `no permission`, `collector failed` and `no data`.
- Ask Advisor answers from permitted records/signals with citations and does not become a detached chatbot.
- Recommended actions are typed and schema-validated before queueing or execution.
- Approval shows a human-readable action preview, affected object, owner, risk and evidence snapshot.
- Execution writes to the real module, records result status and keeps audit/history.
- High-risk actions remain approval-gated: external sends, money movement, permission changes, deletion/export and mass operations.
- Route/logistics and MTM signals show operational evidence: stops, visits, missed stops, delay, last activity and field photos.
- Production QA proves the flow on desktop, laptop, tablet and mobile with authenticated browser evidence.
- Pilot/demo data can show a complete cross-module story without manual database repair.

## Ticket Map

### A. Production Trust Foundation

#### ADV-100-A01 — Owner Label Hygiene

Goal: never expose unresolved technical owner ids in Advisor UI.

Scope:

- Resolve known owners to display names where possible.
- Collapse unresolved CUID-like ids to `Unassigned` / localized equivalent.
- Keep filtering behavior stable when unresolved owner ids are hidden.
- Apply the same display rule in Today rail, detail panel, route evidence and record widgets.

Acceptance:

- No `c[a-z0-9]{20,}`-style owner label appears in `/ai/actions`.
- Owner filter still supports named users and unresolved/unassigned grouping.
- Tests/lint cover touched Advisor UI files.

Status: done in `fix(ai): hide unresolved advisor owner ids`.

#### ADV-100-A02 — Collector Health Metadata

Goal: make "no risks" distinguishable from broken collectors or disconnected modules.

Scope:

- Add per-domain health metadata to Advisor payload.
- Track status: `active`, `no_data`, `module_disabled`, `no_permission`, `collector_failed`.
- Include signal count, last checked timestamp and failure reason when safe.
- Surface health in Modules and empty/disconnected diagnostics.

Acceptance:

- If a collector throws, the API response contains a failed health record instead of silently returning an empty risk list.
- Empty state can explain why no signals are visible.
- Unit tests verify failed collector health and normal collector health.

Status: done in `feat(ai): add advisor roadmap and collector health`.

#### ADV-100-A03 — Capability and Permission Accuracy

Goal: capabilities must reflect tenant modules plus current user access.

Scope:

- Keep tenant module status separate from user permission status.
- Produce `locked` for disabled module and `no_access` for permission-blocked module.
- Use existing LeadDrive role/module permission vocabulary.
- Avoid invented permission strings.

Acceptance:

- Active tenant module can still show `no_access` for a restricted user.
- Disabled tenant module shows `locked`.
- Advisor API and UI communicate the correct reason.

Status: done in `fix(ai): make advisor capabilities role-aware`.

#### ADV-100-A04 — Read Path Side-Effect Split

Goal: reading Advisor payload should not silently mutate operational alerts.

Scope:

- Split signal read from `ProactiveAlert` synchronization.
- Move alert sync to explicit cron/job or explicit mutation path.
- Keep compatibility while avoiding page-refresh side effects.

Acceptance:

- GET `/api/v1/ai/advisor/signals` can be called without creating new alerts.
- Alert sync has its own observable execution path.

Status: done in `fix(ai): split advisor alert sync from reads`.

### B. Signal Quality and Data Contracts

#### ADV-100-B01 — Typed Signal Contract

Goal: every collector returns the same trustworthy signal shape.

Scope:

- Extend signal type with freshness, collector key, health context and optional confidence/safety note.
- Normalize metric fields for amount, overdue days, SLA age, route delay, plan gap and completion ratio.
- Add source link validation helper.

Acceptance:

- Every domain collector fills required fields consistently.
- Invalid or missing source links fail tests.

Status: done across `fix(ai): validate advisor signal sources`, `feat(ai): normalize advisor signal metrics`, `feat(ai): add advisor signal freshness` and `feat(ai): add advisor signal confidence`.

#### ADV-100-B02 — CRM and Sales Deep Signals

Goal: sales managers see real pipeline risks.

Scope:

- Cold lead, no owner, stale contact, low score.
- Stalled deal, stage aging, no next step, quote/proposal idle.
- Evidence links to contact/company/deal/quote/activity.

Acceptance:

- Demo tenant produces at least one actionable CRM and one actionable sales risk.

Status: done in `test(ai): cover advisor crm sales signals`; CRM idle contacts and sales stalled deal, hot unassigned lead, cold lead, idle offer and idle quote signals have typed evidence and safe next actions covered by unit tests.

#### ADV-100-B03 — Contracts and Finance Causal Signals

Goal: connect money risk to contract blockers.

Scope:

- Unsigned contract, approval stuck, expiring contract.
- Overdue invoice, unpaid balance, approved order not executed/paid.
- Related risk chain: contract blocker -> invoice/payment risk -> owner action.

Acceptance:

- Advisor can show a cross-module causal chain with contract and finance sources.

Status: done across `feat(ai): wire advisor module action types`, `feat(ai): add advisor causal chain templates` and signal coverage tests; overdue invoices include linked contract evidence, invoice reminder actions and `contract_invoice_task` causal-chain coverage for contract blocker -> invoice risk -> owner task.

#### ADV-100-B04 — Tasks, Support and KPI Signals

Goal: expose work aging and owner performance gaps.

Scope:

- Aging task, overdue task, blocked task, overloaded owner.
- SLA warning/breach, repeated tickets from same company, unresolved escalation.
- Manager plan gap, low monthly completion, response gaps.

Acceptance:

- Risks can be filtered by owner/team and show manager-level context.

Status: done in `feat(ai): cover advisor task support kpi signals`; tasks now include blocked/due/overdue/aging risks, support covers SLA and unresolved escalations, repeated-ticket company risks and KPI owner plan/response-gap signals are covered by unit tests.

#### ADV-100-B05 — Routes, Logistics and MTM Signals

Goal: make field execution visible without requiring a map.

Scope:

- Late route start, missed stop, open visit, long break, stale route.
- Delivery/logistics stall where supported by existing data.
- Rejected field photo or other available route evidence.
- Compact route timeline evidence.

Acceptance:

- Route/MTM risk detail shows planned stops, completed visits, delay, last activity and linked evidence.

Status: done across `feat(ai): wire advisor module action types` and signal coverage tests; route signals cover missed stops, long breaks and stale open visits with compact timeline facts, while MTM signals retain rejected field-photo evidence with typed `flag_route_issue` actions.

### C. Action and Execution Loop

#### ADV-100-C01 — Server-Side Action Schemas

Goal: approvals must validate typed business payloads, not arbitrary JSON.

Scope:

- Define schemas for `create_task`, `assign_task`, `create_note`, `create_alert`, `draft_followup`, `invoice_reminder`, `flag_route_issue`, `suggest_budget_change`.
- Validate target entity, organization scope, owner scope and editable fields.
- Prevent edited payloads from retargeting entities outside the original signal scope.

Acceptance:

- Invalid edited payloads are rejected server-side.
- Tests cover safe edits and forbidden retargeting.

Status: done in `fix(ai): validate advisor edited actions`.

#### ADV-100-C02 — Action Preview Forms

Goal: managers approve business fields, not raw JSON.

Scope:

- Typed preview/edit UI for each safe action type.
- JSON remains advanced fallback only.
- Show target object, owner, due date, message/body, risk and evidence.

Acceptance:

- Queue/approval cards are understandable without reading raw JSON.

Status: safe action previews added in `feat(ai): add advisor safe action previews`.

#### ADV-100-C03 — Executor Coverage

Goal: approved actions write to real modules and report execution status.

Scope:

- Implement module-specific executors for first safe actions.
- Track `queued`, `executing`, `executed`, `failed`, `rejected`.
- Store failure reason and execution timestamp.

Acceptance:

- Approving a task action creates a real task.
- Approving a note/alert action creates the real module artifact.
- Failed execution remains visible with actionable reason.

Status: safe Advisor executor coverage added in `feat(ai): execute safe advisor actions`; deeper module-specific executors remain for future action types.

#### ADV-100-C04 — Durable Audit History

Goal: governance survives beyond the current queue.

Scope:

- Keep accepted/rejected/failed actions with evidence snapshot.
- Stop prematurely purging rejected actions needed for audit.
- Add filters by status, module, owner and date.

Acceptance:

- A rejected action remains visible in History with original evidence.

Status: done in `feat(ai): add advisor durable history filters`; reviewed history now keeps approved/rejected/failed records visible with evidence snapshots, saves Advisor owner metadata on queued actions and supports status/module/owner/date filtering.

### D. Ask, Reasoning and Causal Chains

#### ADV-100-D01 — Grounded Ask Routing

Goal: Ask selects/filter signals before generating prose.

Scope:

- Intent routing by domain, metric, owner, date and severity.
- Matched signal links in answer.
- Query scope and citations visible.

Acceptance:

- Ask response can be traced to specific Advisor signals and source records.

Status: done in `feat(ai): add grounded advisor ask routing`; Ask now derives deterministic routing by domain, metric, owner, date and severity, filters signals before ranking, records routing metadata in audit tools and shows scope/citation metadata in the Ask panel.

#### ADV-100-D02 — Cross-Module Causal Chains

Goal: Advisor should connect related risks across modules.

Scope:

- Link signals by company, deal, contract, invoice, ticket, route and owner.
- Show chain such as `unsigned contract -> overdue invoice risk -> overdue manager task`.
- Keep chain as evidence-based graph, not model invention.

Acceptance:

- At least three chain templates are tested on seeded data.

Status: three deterministic chain templates added in `feat(ai): add advisor causal chain templates`; UI currently shows linked signals and can later expose template labels.

#### ADV-100-D03 — Daily Briefing

Goal: first screen explains what changed since last refresh/day.

Scope:

- New critical risks.
- Money at risk delta.
- SLA/route/KPI changes.
- Top recommended next steps.

Acceptance:

- Briefing is generated from persisted/current signals with timestamps.

Status: done across `feat(ai): extract advisor briefing builder`, `feat(ai): add advisor briefing deltas` and the server-side snapshot pass; daily Advisor signal snapshots are now persisted by cron, previous-day snapshots are available through a read-only briefing endpoint and `/ai/actions` uses them before falling back to browser storage.

### E. Playbooks and Controlled Autopilot

#### ADV-100-E01 — Playbook Model

Goal: repeat accepted Advisor actions as tenant-owned workflows.

Scope:

- Persist playbook templates from repeated signal/action patterns.
- Track acceptance rate, rejection rate and execution success.
- Allow tenant admin to enable/disable playbook automation.

Acceptance:

- A repeated approved action can be promoted into a disabled-by-default playbook.

Status: done in the playbook pass; repeated approved Advisor action patterns are grouped into promotion candidates, can be promoted through `/api/v1/settings/ai-advisor`, and persist as tenant-owned `AdvisorPlaybook` records with `status=disabled` by default, approval/rejection/execution counters and source action ids.

#### ADV-100-E02 — Autonomy Levels

Goal: make automation explicit and safe.

Levels:

- L0 dashboard: show signals only.
- L1 advisor: signal + evidence + recommendation.
- L2 shadow action: prepare action, require approval.
- L3 controlled autopilot: execute tenant-approved safe internal actions.
- L4 playbook automation: repeat approved workflows with limits.

Acceptance:

- Every action type declares its maximum allowed autonomy level.
- Dangerous actions cannot exceed L2.

Status: done across `feat(ai): add advisor autonomy policy` and the Advisor settings pass; queued action autonomy now respects tenant `aiAdvisorMaxAutonomyLevel`, and `/settings/ai-automation` exposes execution enabled/disabled, max autonomy, daily execution cap and per-action cap controls.

#### ADV-100-E03 — Limits, Kill Switches and Cost Guardrails

Goal: prevent runaway automation or AI cost.

Status: global env kill switches, tenant execution settings, daily execution caps, per-action daily caps and execution counters are implemented in `src/lib/ai/advisor/execution-guardrails.ts`; the cron executor checks them before claiming queued Advisor actions, so read-only signals still work while execution is disabled or capped.

Scope:

- Tenant-level Advisor limits.
- Per-action rate caps.
- Global kill switch for execution.
- Cost and volume metrics.

Acceptance:

- Admin can disable Advisor execution without disabling read-only signals.

### F. UX and Production QA

#### ADV-100-F00 — Video Story Before Product Demo

Goal: explain the meaning of the Advisor before showing clicks.

Scope:

- Open the video with the 100% operating cycle:
  `data -> signal -> evidence -> why it matters -> safe next step -> approval -> execution -> audit -> playbook learning`.
- Explain that `/ai/actions` is not a generic AI chat and not a decorative dashboard.
- Position the section as a controlled operations center: it finds delays, overdue work, stale deals, money risks, route/logistics issues, SLA risks and KPI gaps.
- Explain the safety promise: the system recommends and prepares actions, while risky business changes require approval.
- Only after this narrative, show the live product flow on `/ai/actions`.
- Presenter rule: first explain why the section exists and how the 100% cycle works, then demonstrate clicks and screens.
- Use the RU opening script in `docs/ai-operations-advisor-video-script.md` before any live UI walkthrough.
- Demo order: Daily briefing, Today risks, evidence panel, source links, queue action, approval preview, execution/history, record-level widget.

Acceptance:

- The demo script starts with the business meaning and the full operating cycle before screen walkthrough.
- The script avoids claims like "AI automatically runs the business".
- The script clearly says "Advisor recommends, manager approves, execution is audited".

Status: done in `docs/ai-operations-advisor-video-script.md`; RU opening narrative added so the video starts with meaning and the 100% cycle before product clicks.

#### ADV-100-F01 — Operating Center Layout QA

Goal: `/ai/actions` feels like a control center, not a debug page.

Scope:

- Dense Today rail.
- Evidence panel.
- Queue/history panel.
- Modules health.
- Keyboard navigation and responsive layout.

Acceptance:

- Browser QA artifacts prove desktop, laptop, tablet and mobile layout.

Status: implemented through `scripts/capture-advisor-screenshots.mjs`; the runner captures Today routes, detail routes, modules, Ask, queue and history across desktop/laptop/tablet/mobile, verifies recognizable Advisor content, rejects runtime-error text, horizontal overflow and offscreen elements, and writes `docs/screenshots/advisor/responsive-qa-report.json` as the browser QA artifact.

#### ADV-100-F02 — Pilot Tenant and Demo Story

Goal: sales/demo environment proves the full idea.

Scope:

- Seed cross-module risks across all Advisor domains.
- Include causal chain demo.
- Include queue/approve/execute demo.
- Include route/MTM evidence demo.

Acceptance:

- Readiness script fails if demo tenant cannot show the full story.

Status: implemented through `scripts/seeds/advisor-demo.mjs` and `scripts/check-advisor-qa-readiness.mjs`; the seed now creates cross-module demo evidence for CRM, sales, contracts, marketing, tasks/KPI, finance, support, routes and MTM, plus pending approval queue data, executed/rejected history, a disabled playbook candidate and a previous-day briefing snapshot. The readiness gate fails when any domain, loop state or human-readable owner label requirement is missing.

#### ADV-100-F03 — Production Smoke Gates

Goal: deploy only when Advisor is operationally believable.

Scope:

- API smoke for capabilities, signals, query and actions.
- Browser smoke for `/ai/actions`.
- No technical ids.
- No silent collector failures.

Acceptance:

- Smoke report clearly states pass/fail per module and per workflow.

Status: implemented as explicit QA gates: `scripts/check-advisor-qa-readiness.mjs --json` reports auth, schema, tenant, modules, QA user, demo-story, advisor-loop and owner-label checks; `scripts/capture-advisor-screenshots.mjs` reports pass/fail browser evidence per workflow and viewport. Together they catch missing tables, disabled modules, incomplete seeded story, missing queue/history/playbook/snapshot data, technical ids in Advisor owner labels, route rendering regressions and layout/runtime failures before a production demo.

## Recommended Autonomous Build Order

1. ADV-100-A01 and ADV-100-A02: production trust and diagnostics.
2. ADV-100-A03: capability/permission accuracy.
3. ADV-100-C01: action schemas before deeper execution.
4. ADV-100-B03 and ADV-100-B05: two high-wow verticals, money and route reality.
5. ADV-100-C03: execute safe actions end to end.
6. ADV-100-D02 and ADV-100-D03: causal chains and daily briefing.
7. ADV-100-E01/E02: playbooks and controlled autopilot.

## Current Completion Estimate

- Foundation/UI shell: 60-65%.
- Full 100% Advisor vision: 35-40%.
- Autonomous/playbook layer: 20-25%.

The next work should improve trust and execution before adding more decorative AI behavior.
