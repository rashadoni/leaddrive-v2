# Support Module UX Redesign — Implementation Plan

> **Status:** IN PROGRESS — Service Desk and Ticket Detail are deployed;
> Complaint Registry is evidence-complete and awaiting PR/release
> **Original date:** 2026-08-31
> **Last reviewed:** 2026-09-13
> **Code baseline:** `rashadoni/leaddrive-v2` `main` at
> `aad61167a68565b64c33e7eab257bf0e8ca33f0d`
> **Scope:** 15 potentially visible Support destinations (14 base destinations
> plus role/add-on-gated Support AI Settings), their nested operational flows,
> and customer-portal dependencies
> **Source:** UX audit based on the supplied sidebar screenshot, repository UI,
> source review, two independent manual plan reviews, targeted static
> anti-pattern scans and the source-level verification recorded per section.
> Authenticated screenshots and measured task baselines are required before
> each remaining workstream can be marked complete or released.
> **Implementation authorization:** autonomous code/document edits, checkpoint
> commits and feature-branch pushes are authorized. After a fully green slice,
> PR, merge, standard GitHub Actions deployment and post-deploy smoke are also
> authorized. Direct/manual production deployment remains forbidden.

Canonical-status note: the only active repository and delivery route is
`rashadoni/leaddrive-v2`. The old `rashadrahimov` copy and Azure pipelines are
not delivery targets. Service Desk and Ticket Detail were delivered by PR #82;
subsequent production RLS recovery was delivered by PR #100. Remaining work
continues from a clean current-main worktree on a dedicated `codex/*` branch.

Status legend: `TODO` · `IN_PROGRESS` · `DONE` · `BLOCKED` · `DEFERRED`

Execution checkpoint (2026-09-13): the plan contains 191 tracked SUPUX tasks.
All 19 Service Desk and Ticket Detail tasks are evidence-complete and deployed;
all 11 Complaint Registry tasks are evidence-complete and awaiting the normal
PR/release path. The remaining 161 tasks stay open until their own
section-scoped implementation, authenticated browser matrix, CI, performance/
visual comparison and deployment evidence are complete.

Execution unblock (2026-09-05): manual GitHub Actions workflow `Support UX
evidence` now provisions a dedicated `support_ux_evidence` PostgreSQL service,
creates the synthetic `Northstar Support Lab` tenant and agent, manager, admin
and customer accounts, installs Chromium, and uploads only non-secret evidence.
Passwords are generated outside the repository and stored only as GitHub
Secrets. The seed refuses production, non-CI and non-local databases; the
workflow rejects the production domain and host. First bounded capture run
`33949384734` targeted commit `92976a464e5c088ecb17b803cdddda18b3154fb8`
with AZ/light/desktop and agent/admin/customer roles. GitHub cancelled its
capture step after 1,659 seconds and skipped artifact upload, so it provides
infrastructure execution proof but no page acceptance evidence. The runner is
now section-scoped and emits per-scenario progress; no acceptance task is
closed merely because execution is possible.

Second bounded run `33952086518` targeted Service Desk and Ticket Detail at
`d1ca8658af9579390ce8d62f279cdd58fc47a172`. It uploaded a non-secret artifact
and failed correctly instead of producing a false green result. The evidence
confirmed no page-level horizontal overflow and a first-viewport queue, while
also exposing a hidden ownerless intake queue, one unnamed shell control,
disabled mobile zoom, a hard-coded document language, two contrast failures,
forbidden background requests, a Customer 360 query against the nonexistent
`Deal.status` field, and premature capture of the Ticket Detail loading shell.
Checkpoints `1d2a9e215` and `b6d8428b2` fix those confirmed defects, wait for
data-ready Support roots, and strengthen the five mutation assertions. Repeat
run `33953405138` was canceled before its build after a pre-CI import audit
found and corrected a stale module path. Replacement run `33953660277` was bound
to `b6d8428b2735527f774368ef6119b469ec0fad50`; its dependency, contract, secret,
and fixture steps passed, but GitHub canceled `next build` after exactly five
silent compile minutes before Chromium or artifact upload. Run `33954383410`
proved the five-minute cancellation is an external step budget even with a
45-second heartbeat. The isolated disposable tenant therefore uses a clearly
labelled development runtime for browser evidence; ordinary GitHub CI remains
the production-build gate.

Run `33955025762` produced the first complete two-page artifact and exposed
missing navigation labels, first-visit tour interception, five Ticket Detail
contrast violations, and two stale mutation assertions. Checkpoints
`dd1937dce`, `fd307494a`, and `e76c77f94` fixed those findings and the underlying
clickable-row keyboard propagation defect. Exact-SHA run `33957057784` is green:
Service Desk and Ticket Detail both have zero HTTP/console errors, zero axe or
custom accessibility violations, no horizontal overflow, matching AZ/light/
reduced-motion environment, and first-viewport primary work. All five mutation
flows pass with screenshot evidence. This is one reference slice only; the
remaining locale/theme/viewport/data/role matrices stay open.

Rules for every implementation slice:

1. Keep behavior and permissions intact unless the slice explicitly changes them.
2. Preserve all existing UI sections until product approval is given to move,
   collapse, replace, or remove them.
3. Use path-scoped commits; never use `git add -A` or `git add .`.
4. Run targeted tests and lint for touched files, then `npx tsc --noEmit` where
   practical.
5. Run `npm run i18n:check` after any `messages/*.json` change.
6. For a touched `"use client"` boundary, record production build status. Heavy
   build and browser E2E belong in CI or the approved build worker, not on the
   Contabo development host.
7. Verify visible changes in AZ, RU, and EN at desktop, tablet, and 375 px mobile
   widths. Include keyboard-only and reduced-motion checks.
8. Never report a gate as passed unless it was run in the current tree.

---

## 1. Outcome

Replace the current collection of disconnected operational and administration
pages with one
coherent **Support Operations Workbench**. The module should feel compact,
calm, operational, and human: one obvious next action, exceptions before vanity
metrics, progressive disclosure for complex settings, and trustworthy feedback
for every server operation.

The redesign must make three jobs easier:

1. A support agent handles the next ticket, complaint, or call with minimal
   navigation and without scanning irrelevant dashboard blocks.
2. A support manager sees SLA risk, workload, routing gaps, and schedule
   exceptions without relying on misleading metrics.
3. A tenant administrator configures categories, policies, entitlements,
   templates, escalations, macros, and portal access without needing internal
   implementation language.

These roles are working assumptions derived from the module's current product
surfaces. They require explicit product confirmation before the design brief is
considered final.

## 2. Audit Baseline

### 2.1 Provisional scores and evidence limits

- Nielsen heuristics: **18/40 — Poor (provisional)**.
- Technical UI quality: **7/20 — Poor**.
- Cognitive load: **7 of 8 checks fail — Critical**.
- P0 blockers: **0**. Core tasks remain possible.
- P1 problem groups: data trust, information architecture and density,
  progressive disclosure, accessibility/adaptiveness, error feedback, and
  localization/consistency.

The score is a source-and-screenshot baseline, not a completed production
usability study. It must not be presented as a measured before-state until Phase
A records authenticated evidence for every representative workflow.

| Nielsen heuristic | Score | Current evidence |
| --- | ---: | --- |
| Visibility of system status | 2/4 | Loading, mutation, and retry feedback varies by section |
| Match with the real world | 2/4 | Raw enums, IDs, and duration abbreviations leak into business UI |
| User control and freedom | 2/4 | Some flows rely on browser confirm/prompt or lose list context |
| Consistency and standards | 2/4 | Headers, cards, actions, tables, and states vary across Support |
| Error prevention | 1/4 | Draft-loss, conflicting SLA targets, and duplicate mutation risks remain |
| Recognition rather than recall | 2/4 | Fourteen-plus flat destinations and hidden/hover actions increase recall |
| Flexibility and efficiency | 2/4 | Some shortcuts/bulk actions exist, but patterns are inconsistent |
| Aesthetic and minimalist design | 1/4 | Repeated KPI/card stacks delay primary work and create excess scroll |
| Error recovery | 1/4 | Several fetch/mutation failures are silent or indistinguishable from empty |
| Help and documentation | 3/4 | Help exists, but permanent tips compete with primary work |
| **Total** | **18/40** | **Poor — validate with authenticated baseline evidence** |

### 2.2 User complaints confirmed by the audit

| Criterion | Current finding | Target |
| --- | --- | --- |
| Dry / visually generic | Repeated cards, rainbow KPI colors, generic dashboard composition | A task-specific operational workbench with restrained brand accent |
| Not compact | Header, repeated descriptions, tip, KPI grid, filters, then content | Useful action and work queue visible in the first viewport |
| Scattered | Original screenshot: fourteen equal-weight items; current code: up to fifteen | Role- and task-based navigation with one primary action |
| Large typography | Inconsistent 20/24/30 px headings and oversized block footprints | One compact product type scale and clearer hierarchy |
| Not intuitive | Hidden actions, raw enums, weak next-step guidance | Recognition-first labels, previews, explicit next actions |
| Too much vertical scroll | Permanent tutorials, KPI grids, stacked forms, repeated detail blocks | Progressive disclosure, drawers, compact lists, agenda/mobile variants |
| Not interactive | Click-only/hover-only controls and weak state feedback | Keyboard/touch interaction, preview, optimistic feedback where safe |
| Not friendly | Silent failures, technical copy, browser prompt/confirm | Human copy and visible loading/error/success/retry states |

### 2.3 Systemic evidence

- The supplied baseline screenshot shows 14 flat destinations. Current code can
  expose a fifteenth, feature-gated destination for Support AI Settings.
- The common page pattern repeats title, subtitle, `PageDescription`, a large
  `DidYouKnow` block, four or five KPI cards, filters, and only then the primary
  work surface.
- Shared `DataTable` adds `pb-20`, creating roughly 80 px of blank space below
  table content.
- Sortable table headers and clickable rows do not consistently expose keyboard
  semantics or `aria-sort`.
- Shared buttons are commonly 32–36 px high, below the 44 px target for primary
  touch controls.
- Shared `Select` labels are not always programmatically bound to their controls.
- Responsive behavior often means horizontal scrolling or vertically stacking
  every desktop block rather than adapting the task flow.
- Loading, empty, error, success, and mutation-progress states vary by section.
- Existing pages leak raw English enums and hardcoded strings into localized UI.
- The current navigation can expose a fifteenth destination,
  `/support/ai-settings`, for admin/superadmin users with the AI add-on.
- The core agent flow continues into `/tickets/[id]`; limiting the redesign to
  sidebar destinations would leave the highest-frequency work surface outside
  the plan.
- Targeted static detection confirmed two recognizable visual anti-patterns in
  the audited checkout: a decorative side accent in ticket comments and a
  purple KPI treatment in Support VoIP. These findings require visual
  confirmation against the current production build before remediation.

## 3. Draft Design Brief

### 3.1 Feature summary

The Support module is an operational workspace for agents, support managers,
and tenant administrators. It must help each role complete its primary job with
less navigation, less scrolling, fewer simultaneous choices, and higher trust
in data and system state.

### 3.2 Primary user action

- **Agent:** identify and handle the next case requiring attention.
- **Manager:** identify and resolve the most important support exception.
- **Administrator:** safely configure one support rule and understand its effect
  before saving.

### 3.3 Design direction

Three target qualities: **calm, operational, human**. Product feedback has
already confirmed the desired outcomes: compact screens, less vertical travel,
smaller and more disciplined typography, clearer interaction, friendlier
feedback, and distinctive visual hooks without a recognizable AI-generated
palette. Role precedence and the exact information architecture remain open.

Use LeadDrive's professional shell and restrained orange brand accent, but move
away from multi-color KPI galleries, nested generic cards, decorative gradients,
and oversized helper blocks. The memorable product characteristic should be an
exception-first work queue: users immediately understand what needs attention
and what action is available.

Support both existing light and dark themes. Do not introduce a Support-only
visual language that conflicts with the rest of LeadDrive.

### 3.4 Layout strategy

1. Compact page header with title, optional one-line context, and one primary CTA.
2. Up to three actionable exception indicators, rendered inline rather than as
   a mandatory hero-card grid.
3. Sticky search/filter/view toolbar.
4. Primary list, table, queue, or agenda in the first viewport.
5. Create, edit, and detail work in a drawer or dedicated route when the task is
   too large for inline editing.
6. Advanced fields, explanations, and constructors collapsed until requested.
7. Mobile layouts adapt into cards, agenda, or master-detail views instead of
   preserving desktop table geometry.

### 3.5 Required states

Every section must define and test:

- initial loading and subsequent refresh;
- empty/first-use state with a useful next step;
- populated default state;
- filtered-no-results state with reset action;
- recoverable fetch error with retry;
- mutation in progress with duplicate-action protection;
- success feedback;
- mutation failure that preserves user input;
- partial or stale data when applicable;
- permission denied / action unavailable with a reason;
- offline or connection-degraded state where relevant;
- mobile, keyboard-only, dark theme, and reduced-motion behavior.

### 3.6 Interaction model

- A row/card opens detail without losing list context.
- Secondary row actions live in an accessible `...` menu with text labels.
- Hover may enhance discovery but must never be the only way to reach an action.
- Destructive actions explain impact and provide confirmation or undo.
- Forms preserve drafts and warn before context switches that would discard work.
- Filters provide active chips and a single clear reset action.
- Search requests are debounced; result counts and loading state remain stable.
- Motion communicates state changes only and respects reduced-motion settings.

### 3.7 Content requirements

- All user-facing strings in AZ, RU, and EN.
- No raw database enums, technical IDs, `h/m`, or untranslated fallbacks.
- One description per page; avoid text that repeats the title.
- Empty states explain why the section matters and give one next action.
- Errors state what failed, what was preserved, and how to recover.
- Settings summaries read as business-language sentences and include previews.

### 3.8 Support-specific design context

The repository-level `.impeccable.md` currently describes Brand Protection and
must not be treated as the design brief for Support. Until a product-wide design
context is approved, this document is the scoped source of truth for Support:

- **Users:** support agents doing repetitive daily triage, support managers
  resolving SLA/workload exceptions, and tenant administrators configuring
  policies and access.
- **Use context:** frequent operational use on laptop/desktop, occasional tablet
  and mobile intervention, often under time pressure.
- **Tone:** calm, compact, direct, trustworthy, and human — never decorative,
  toy-like, or artificially futuristic.
- **Anti-reference:** generic AI dashboards built from repeated rounded cards,
  rainbow metrics, purple/cyan accents, gradients, glows, and oversized headings.
- **Accessibility baseline:** WCAG 2.2 AA intent, keyboard-complete primary flows,
  visible focus, non-color state cues, and reduced-motion support.

### 3.9 Operational visual hooks

Each surface needs one memorable operational idea. A hook must clarify the next
decision; it must not be a decorative chart, gradient, or another KPI card.

| Surface | Hook to prototype and validate |
| --- | --- |
| Service Desk | SLA urgency rail plus a role-aware **Take next ticket** action |
| Ticket detail | Sticky case spine: customer, SLA, ownership, conversation, next action |
| Complaint Registry | Deadline-and-owner triage strip that exposes overdue exceptions |
| Agent Desktop | **Now / Next / Waiting** personal queue rather than a leaderboard hero |
| VoIP Calls | Call outcome timeline with recording, contact, and follow-up in one row |
| Knowledge Base | Category rail with visible draft/published coverage gaps |
| Ticket Categories | Editable hierarchy with an immediate impact summary |
| SLA Policies | Plain-language response/resolution timeline preview |
| Support Entitlements | Customer coverage timeline with uncovered/expiring exceptions |
| Entitlement Templates | Generated milestone timeline before save |
| Skill Routing | Queue-to-agent coverage map highlighting unowned queues |
| Agent Calendar | **Now / Next** agenda with empty hours compressed |
| Escalation Rules | Executable **If / When / Then** simulation preview |
| Macros | Readable action timeline with before-apply preview |
| Portal Users | Access lifecycle row: state, last activity, recovery, next safe action |
| Support AI Settings | Consequence map showing exactly which Support flows the master switch affects |

## 4. Product and Design Invariants

1. **Task first.** The primary work queue or configuration action must be visible
   without passing through dashboard decoration.
2. **Exception first.** Metrics earn space only when they change the next action.
3. **Default target of up to three KPI indicators** in the page header. More are
   allowed only when baseline evidence shows that each changes the next action.
4. **Group peer choices into chunks of four or fewer.** Do not hide familiar
   expert controls merely to satisfy an arbitrary count; use hierarchy,
   presets, and progressive disclosure based on task testing.
5. **One primary CTA per state.** Secondary actions must be visually secondary.
6. **Real data only.** No random, placeholder, page-local, or mixed-scope metrics
   may be presented as operational truth.
7. **Progressive disclosure.** Advanced fields and constructors remain available
   but do not occupy the default work surface.
8. **Responsive adaptation.** No page-level horizontal overflow at 375 px; wide
   data becomes a card, agenda, or selected-detail experience.
9. **Accessible by default.** Keyboard operation, visible focus, semantic controls,
   programmatic labels, 44 px primary touch targets, and non-color status cues.
10. **Trustworthy feedback.** Every fetch and mutation exposes a truthful state.
11. **Localized business language.** Internal enum names and technical IDs do not
    reach the interface.
12. **No AI-dashboard fingerprints.** Avoid nested card grids, rainbow metric
    palettes, decorative side stripes, gradient text, and generic hero metrics.

## 5. Scope

### 5.1 Included

- Information architecture for 15 potentially visible Support destinations:
  14 base destinations plus role/add-on-gated Support AI Settings.
- Shared Support page shell, toolbar, filtering, tables/lists, drawers, state
  feedback, responsive behavior, and accessibility.
- UX redesign workstreams for all 15 destinations.
- Nested operational flows that determine whether the module is actually usable:
  ticket detail, complaint create/detail/import, knowledge article detail, and
  relevant customer-portal ticket/knowledge/closure journeys.
- AZ/RU/EN copy normalization.
- Data-contract corrections required to remove misleading Support metrics.
- Targeted tests and authenticated browser verification per slice.

### 5.2 Deferred unless separately approved

- Removal of existing routes or product capabilities.
- Database migrations unrelated to trustworthy metrics or required UI state.
- A new global LeadDrive typography system outside Support.
- Rebranding the entire CRM.
- Replacing the existing component library.
- New billing, tenant, entitlement, or permission semantics.
- Production rollout, push, merge, or deploy.

### 5.3 Backlog governance

The original document contained 140 checkbox tasks, all marked `TODO`. This
revision contains 191 tasks after adding missing operational, evidence,
performance, and rollout scope. It remains an inventory rather than a
schedulable backlog until the following work is complete:

- create one canonical epic for the program and one tracked issue per vertical
  slice, linking task IDs, pull requests, evidence, and rollout status;
- assign each slice an accountable product/design owner and engineering owner;
- record dependencies and blockers explicitly rather than relying on document
  order;
- estimate only after Phase A measures realistic data volume and flow
  complexity; do not invent dates from file size;
- allow only one page slice to be `IN_PROGRESS` at a time unless shared API work
  is independently testable;
- mark a task `DONE` only with linked code and acceptance evidence.

Program priorities:

| Priority | Scope |
| --- | --- |
| P1 | Canonical backlog/evidence, navigation contract, Service Desk + ticket detail, data-trust fixes, mutation safety, permissions, AI Settings, rollout safety |
| P2 | Remaining page density/responsiveness, portal journeys, performance, visual regression, localization hardening |
| P3 | Optional motion, secondary delight, and non-operational visual polish |

No current finding is a P0 because core tasks remain possible. Any newly found
tenant-isolation, permission-bypass, silent data-loss, or production-blocking
defect is promoted to P0 and leaves the visual queue immediately.

## 6. Target Information Architecture

### 6.1 Proposed navigation

#### Work

1. Service Desk
2. Complaint Registry
3. Agent Desktop
4. VoIP Calls
5. Knowledge Base

#### Team

6. Skill Routing
7. Agent Calendar
8. Portal Users

#### Rules and Settings

9. Ticket Categories
10. SLA Policies
11. Support Entitlements
12. Entitlement Templates
13. Escalation Rules
14. Macros
15. Support AI Settings — visible only with the AI add-on and an authorized role

The Work group is visible by default. Team and Rules and Settings are collapsible,
permission-aware groups. Exact naming and whether Agent Calendar belongs under
Work or Team remain open product decisions.

Visibility contract from the current navigation baseline:

| Destination | Additional gate beyond Support module | Required verification |
| --- | --- | --- |
| Complaint Registry | `complaints_register` feature | Hidden/visible navigation plus direct-route denial |
| VoIP Calls | `voip` add-on | Hidden/visible navigation plus direct-route denial |
| Support AI Settings | `ai` add-on and `admin`/`superadmin` role | Role, add-on, read, save, and direct-route checks |
| Other Support destinations | No additional nav gate currently declared | Verify page/API permissions for agent, manager, admin, superadmin |

### 6.2 Navigation tasks

**Status: IN PROGRESS — three-group implementation and local contracts green;
authenticated browser job blocked before startup**

- [ ] **SUPUX-NAV-001** Confirm the three-group information architecture with
  agents, managers, and administrators.
- [ ] **SUPUX-NAV-002** Preserve all 15 destination routes while changing
  presentation only; preserve nested operational routes as well.
- [ ] **SUPUX-NAV-003** Make group state persistent without hiding the active route.
- [ ] **SUPUX-NAV-004** Keep Support search aware of collapsed destinations.
- [ ] **SUPUX-NAV-005** Verify permission and feature-gate behavior for every item.
- [ ] **SUPUX-NAV-006** Provide a mobile navigation pattern with labels, not a
  forced icon-only mystery state.
- [ ] **SUPUX-NAV-007** Add navigation analytics or usability evidence before
  considering any route removal or merge.
- [ ] **SUPUX-NAV-008** Update navigation tests and the inventory whenever a
  feature/add-on-gated Support destination is added or removed.
- [ ] **SUPUX-NAV-009** Document the page/API permission matrix for all Support
  destinations; hiding a nav item is never sufficient authorization.

Acceptance criteria:

- A daily-work destination is reachable without expanding Settings.
- The active destination remains visible and understandable at every width.
- Keyboard users can traverse, expand, collapse, and activate every group/item.
- No existing permission or feature gate is weakened.

Current verification evidence (2026-09-06):

- `5f46b72d5` adds an explicit `supportSection` contract to the single shared
  navigation catalog and preserves all 15 unique destinations in the approved
  5 Work / 3 Team / 7 Rules and Settings order. Complaint Registry, Support
  VoIP and Support AI retain their feature, add-on and role metadata; no route
  or nested route was removed or renamed.
- Expanded desktop navigation renders three compact semantic subgroup buttons.
  Work opens by default, manual state persists in local storage, and the active
  subgroup cannot be collapsed over its current destination. Search matches the
  localized subgroup name even while that subgroup is closed. Keyboard focus,
  visible focus rings and reduced-motion fallbacks are explicit.
- At widths below `lg`, every Support page now exposes a labeled native select
  with localized optgroups and only the destinations returned by the same
  permission-aware catalog. It keeps a 44 px target and current-route value,
  avoiding the prior icon-only discovery dependency without duplicating route
  or gate logic.
- `docs/support-navigation-permission-matrix.md` separates navigation/page UX
  gating from the API security boundary for every destination and its required
  nested flows. It also prohibits route merging/removal until separately owned
  usage evidence, stakeholder approval and a reversible migration exist.
- Navigation/catalog/evidence contracts passed 113 assertions in 6 suites;
  the wider role, permission, add-on and tenant API slice passed 136 assertions
  in 12 suites. Changed-source ESLint, both browser-script syntax checks,
  `git diff --check`, AZ/RU/EN parity (21,900 keys), and the 27-file Support
  anti-pattern scan (0 findings) are green. Full TypeScript/build remain
  **NOT RUN/BLOCKED** by the Contabo workload contract.
- The fail-closed `scripts/support-ux-navigation-flow-evidence.mjs` is wired to
  the explicit `support-navigation` matrix scenario. Its five outcome groups
  cover three-group/active-route behavior, persisted state, closed-group search
  and keyboard clearing, a 375 px labeled/touch/overflow check, and
  support/manager/admin feature/add-on/role visibility. It is restricted to the
  named disposable loopback tenant and exact commit.
- Exact-SHA GitHub Actions run `34007060091` for `5f46b72d5` ended in
  `startup_failure` with zero jobs created. Rendered desktop/mobile, AZ/RU/EN,
  light/dark, physical-touch, keyboard/focus, accessibility and visual evidence
  remains **NOT RUN**. NAV checkboxes remain open; NAV-001 and NAV-007 also need
  real role/stakeholder or observed-usage evidence before completion can be
  claimed.

## 7. Slice 0 — Global UX Foundation

**Status: IN PROGRESS — shared compact shell and control contracts implemented through `a959654ef`;
rendered browser matrices pending**

This slice is a dependency for all page-specific work. It should land as small,
reviewable commits rather than one broad visual rewrite.

### 7.1 Page shell and density

- [ ] **SUPUX-FND-001** Introduce a shared compact Support page shell with title,
  optional one-line context, primary CTA, and toolbar slots.
- [ ] **SUPUX-FND-002** Define a fixed application type scale and normalize
  Support headings, labels, metadata, and table typography.
- [ ] **SUPUX-FND-003** Define a 4 px spacing scale and compact/comfortable density
  tokens without shrinking critical touch targets.
- [ ] **SUPUX-FND-004** Remove duplicate page descriptions and define when
  `PageDescription` is allowed.
- [ ] **SUPUX-FND-005** Replace permanently expanded `DidYouKnow` banners with
  contextual help, first-use disclosure, or a Help popover.
- [ ] **SUPUX-FND-006** Limit default KPI presentation to three actionable
  indicators and define an overflow/insights pattern.

### 7.2 Shared data surfaces

- [ ] **SUPUX-FND-010** Remove the unexplained `pb-20` for Support through an
  opt-in compact variant first; change the shared `DataTable` default only after
  auditing every non-Support consumer.
- [ ] **SUPUX-FND-011** Make sortable headers semantic buttons with focus state and
  `aria-sort`.
- [ ] **SUPUX-FND-012** Make clickable rows keyboard-operable without nesting
  conflicting interactive controls.
- [ ] **SUPUX-FND-013** Add accessible row-action menus with text labels.
- [ ] **SUPUX-FND-014** Define a responsive data contract: desktop table plus
  mobile card/list representation for wide records.
- [ ] **SUPUX-FND-015** Remove duplicate result counts and standardize pagination,
  page-size, selection, and bulk-action behavior.
- [ ] **SUPUX-FND-016** Decide whether large datasets require virtualization and
  test realistic 0, 5, 50, and 500-record states.

### 7.3 Forms, controls, and feedback

- [ ] **SUPUX-FND-020** Programmatically bind every label, description, and error
  to its control, including shared `Select`.
- [ ] **SUPUX-FND-021** Give primary touch controls a minimum 44 x 44 px target;
  document justified exceptions for dense desktop-only controls.
- [ ] **SUPUX-FND-022** Replace clickable `div` and `Badge` elements with semantic
  button, link, checkbox, or switch controls.
- [ ] **SUPUX-FND-023** Standardize initial loading, refresh, empty, no-results,
  error/retry, saving, success, and failure states.
- [ ] **SUPUX-FND-024** Prevent duplicate mutations and preserve unsaved input after
  server errors.
- [ ] **SUPUX-FND-025** Standardize safe confirm/undo patterns and remove browser
  `prompt`/`confirm` from Support workflows.
- [ ] **SUPUX-FND-026** Add debounced search behavior and cancel stale requests.
- [ ] **SUPUX-FND-027** Expose status with text/icon as well as color.

### 7.4 Visual system, localization, and motion

- [ ] **SUPUX-FND-030** Replace rainbow KPI styling with one restrained brand
  accent and semantic colors used only for state.
- [ ] **SUPUX-FND-031** Remove nested generic cards and decorative side-stripe
  borders from Support surfaces.
- [ ] **SUPUX-FND-032** Verify light/dark tokens and contrast for every Support
  state, including calendar event types.
- [ ] **SUPUX-FND-033** Create shared localized dictionaries for ticket status,
  priority, support level, lifecycle, duration units, and action labels.
- [ ] **SUPUX-FND-034** Replace English fallback text, raw enum values, and
  technical IDs across all 15 destinations and required nested flows.
- [ ] **SUPUX-FND-035** Use purposeful state transitions only; honor
  `prefers-reduced-motion` and avoid decorative animation.

Foundation acceptance criteria:

- Primary work appears in the first 768 px of vertical viewport on daily-work
  pages in a representative populated state.
- No shared component creates unexplained blank vertical space.
- Every shared control has an accessible name and keyboard interaction.
- No page-level horizontal overflow at 375 px.
- All shared strings pass AZ/RU/EN parity checks.

Current foundation evidence (2026-09-06):

- Checkpoint `b8a9f0c08` introduces `SupportPageShell`, a flat task-first frame
  with one semantic `h1`, optional one-line context, inline leading/help slots,
  a touch-safe action row, notice/toolbar slots and compact 4 px-based rhythm.
  It adds no card wrapper and no nested `main`; narrow/default/wide/fluid widths
  and compact/default title sizes cover configuration, daily-work and case
  contexts without a Support-only visual language.
- Checkpoints `0845ed655`, `e948b396e` and `e535e661c` migrate all 15 internal
  Support destinations. `a4a0ca365` and `16874d82f` migrate the required
  complaint create/import/detail, Knowledge article and Ticket Detail flows.
  Existing route, test-id, permission, action, draft, filter and recovery
  content stays in place; only duplicated page-frame markup is consolidated.
- Macros no longer repeats two page descriptions or renders a permanently
  expanded `DidYouKnow` block beside the existing contextual Help control.
  Support AI no longer enlarges its title at desktop or wraps the leading bot
  glyph in a decorative mini-card. Ticket Detail retains its denser title scale.
- Checkpoint `480f3ecff` adds a 20-surface inventory contract to GitHub evidence
  preflight. The test fails if any internal destination or required nested flow
  stops using the shared shell. Component rendering tests prove exactly one
  heading, flat semantic slots, width variants, touch-safe utility/action rows
  and absence of a generic rounded/shadowed card frame.
- Checkpoint `5173db9e7` defines named 4 px-step spacing, compact/comfortable
  density, page-type and 44 px critical-control tokens on the shell. The tokens
  replace page-local rhythm without shrinking mobile actions.
- Checkpoint `97ddbb486` expands fail-closed anti-pattern coverage from route
  files to 44 visible route and child-component TSX files. It removes the
  remaining chat/history gradients, gives all discovered transitions and
  spinners reduced-motion fallbacks, and makes the portal chat responsive,
  touch-safe, explicitly named and localized without raw-status fallbacks.
- Checkpoints `dde00c1c6`, `ae895b727`, `13613d74a` and `77974079f`
  enforce coarse-pointer target height, reduced-motion on the shared Button,
  semantic table focus/sort/card behavior and explicit form bindings. Ticket,
  complaint and portal ticket metadata now use localized unknown-state labels
  instead of raw enum/category slugs or technical contact/company IDs; generic
  English/AZ-only fallbacks were removed from shared ticket controls.
- Checkpoint `c82f7439a` applies the same safe localized metadata contract to
  complaint priority, Ticket Detail call status and Service Desk reports. Report
  status, priority, SLA, entitlement, milestone and source values no longer
  expose unknown raw enums or use English-only fallbacks.
- Checkpoints `bcc5ea52c` through `f57df6135` close further source-audit gaps:
  portal chat is closed by default and focus-returning; transcript roles,
  imported values, loading labels, dates, numbers and compact durations are
  locale-bound; undersized metadata/disclosure targets are rejected; ordinary
  primary actions and non-state report charts use shared tokens; and raw
  backend error strings cannot reach the checked KB, case or Support AI recovery
  surfaces. Semantic SLA, priority, internal-note and failure colors remain.
- Checkpoints `a1dd37f7f` through `a959654ef` compact the global AI search only
  on Support routes, replace the floating AI overlay's generic gradient/glass
  treatment, and close the remaining source-audit gaps for native-button focus,
  44 px targets, literal UI copy, form labels, locale-aware file sizes, support
  levels, complaint sources and imported chat metadata. Raw session IDs and
  escalation trigger internals are no longer rendered.
- AZ/RU/EN now pass at 21,956 parity keys. The deterministic anti-pattern
  inventory passes 46 visible TSX files with zero findings and now also rejects
  native buttons without focus/44 px targets, literal localizable copy and
  attributes, unlabeled native form controls and hard-coded file-size units.
- A current-SHA re-audit after `a959654ef` passes 113 non-overlapping test files
  and 1,115 assertions: 29 Support evidence/foundation suites (138), 36 UX/state
  suites (379), 36 API/permission/isolation suites (528), and 12 additional
  presentation/component suites (70). The complete scoped internal Support and
  customer-portal route/component ESLint run, all Support evidence-script Node
  syntax checks, AZ/RU/EN parity and `git diff --check` are green. Full
  TypeScript/build and rendered browser work remain NOT RUN under the recorded
  host workload and CI-startup constraints.
- FND checkboxes remain open until the authenticated 375/768/1024/1440,
  AZ/RU/EN, light/dark, keyboard/focus, touch, reduced-motion, forced-state,
  accessibility, performance and visual comparison matrices execute. GitHub
  Actions still fails before job creation; the Actions run list ends at push run
  `34022582918` for `0f527357f`, while later feature commits are present on
  origin without a newer run record. Source evidence is not described as
  rendered proof.

## 8. Workstream 1 — Service Desk

**Status: DONE — full acceptance matrix, CI, merge, deployment and smoke green**
**Route:** `/tickets`
**Primary file:** `src/app/(dashboard)/tickets/page.tsx`

Current problem: list/Kanban/reports are useful, but repeated descriptions, a tip,
five KPI cards, and up to eight status chips push the ticket queue below the first
viewport. Kanban drag-and-drop lacks a complete keyboard/touch alternative.

Target UX: an exception-first ticket workspace with the active queue visible
immediately and one obvious next case.

- [x] **SUPUX-TKT-001** Replace five KPI cards with up to three exception
  indicators: new, unassigned, and SLA risk.
- [x] **SUPUX-TKT-002** Consolidate search, status, ownership, priority, and view
  controls into one compact sticky toolbar with active chips and reset.
- [x] **SUPUX-TKT-003** Add a primary `Take next ticket` or equivalent role-aware
  action where queue semantics allow it.
- [x] **SUPUX-TKT-004** Keep list/Kanban/reports, but make the active mode and its
  purpose clear without three equally prominent buttons.
- [x] **SUPUX-TKT-005** Provide keyboard and touch alternatives for Kanban move,
  including explicit move-to-column actions.
- [x] **SUPUX-TKT-006** Replace tiny/color-only SLA cues with readable risk labels
  and remaining-time text.
- [x] **SUPUX-TKT-007** Add a mobile ticket-card representation with priority,
  assignee, status, customer, and SLA risk.
- [x] **SUPUX-TKT-008** Verify empty, no-results, load-error, stale-data, and
  mutation-error states.
- [x] **SUPUX-TKT-009** Preserve list filters, scroll position, and selected queue
  when opening a ticket and returning from its detail workspace.

Acceptance:

- The queue is visible in the first viewport at 1366 x 768.
- An agent can open and reprioritize a ticket using keyboard only.
- List and Kanban expose the same core information and actions.

Current verification evidence (2026-09-04):

- `4da1a5fc4` implements the unified toolbar and active-filter chips, an atomic
  tenant-scoped and role-checked `Take next` mutation, explicit keyboard/touch
  Kanban status controls, differentiated empty/no-results/load/stale/permission
  and mutation feedback, and queue/query/scroll preservation through detail and
  sibling navigation.
- Changed-file ESLint, translation parity, `git diff --check`, and 17 targeted
  Vitest assertions are green in the implementation worktree. The API tests
  cover authentication, role and field permission denial, tenant-scoped query
  and compare-and-set update predicates, empty queue, concurrent-claim conflict,
  and rejection of client-controlled assignee input.
- The 2 GB local targeted TypeScript process exhausted its Node heap after
  Prisma generation. Per the Contabo workload contract it was not retried with
  a larger heap; the GitHub CI typecheck remains mandatory.
- The new TKT task checkboxes remain open until authenticated 375/768/1024/1440,
  AZ/RU/EN, light/dark, keyboard, touch, reduced-motion, forced-failure,
  accessibility, visual-regression, and performance evidence is recorded.
- Checkpoint `30e854caf` programmatically associates every visible ticket-form
  label, localizes empty option copy, gives touch controls a 44 px target, and
  reflows paired fields to one column on narrow screens. Scoped ESLint,
  translation parity and three new form-contract assertions are green.
- Checkpoints `4f82d9896` and `10f37b74e` add a disposable-tenant interaction
  runner for keyboard row opening and context/scroll return, atomic Take next,
  keyboard reprioritization, explicit Kanban movement, and internal-note failure,
  preserved draft and successful retry. The flow is hard-restricted to the
  ephemeral local evidence host and records five screenshot-backed outcomes;
  browser execution is still pending.
- Run `33952086518` proved that record-level sharing excluded ownerless tickets
  from the agent's list, making the already role-checked Take next endpoint
  unreachable. Checkpoint `1d2a9e215` keeps ownerless tickets in the Support
  intake queue, adds a regression test for that boundary, and uses stable,
  data-ready selectors for queue return, ticket editing and Kanban relocation.
  The same checkpoint passed 113 focused tests, Support anti-pattern scan,
  translation parity and changed-source ESLint (zero errors; two pre-existing
  `next/image` warnings in the touched global header).
- Exact-SHA run `33957057784` (`e76c77f9425033e213255140efb87e1cb9a03cc9`)
  passes the AZ/light/1440x900 agent reference slice. `/tickets` renders 20 rows
  with no page scroll or horizontal overflow, zero console/HTTP errors, zero
  axe/custom accessibility findings, valid keyboard stops, a 42 ms filter p50,
  and matching language, theme and reduced-motion settings. Queue context return,
  atomic Take next, failed-send draft recovery, keyboard reprioritization, and
  explicit Kanban movement all pass as five screenshot-backed mutation results.
  TKT-002/003/005/008/009 remain open until their required cross-device,
  cross-locale, theme, touch, permission and data-state evidence is complete.
- Runs `33964831143` and `33965630196` expand the disposable agent audit to 15
  screenshot-backed flows. All 15 pass, including empty and stale queues,
  permission/load recovery, Kanban rollback, attachment retry, keyboard
  assignment/status restore and the Support AI master-switch API boundary. The
  static list and Ticket Detail captures also pass. Both runs correctly remain
  red because the Kanban lane width propagated into the dashboard `main`
  scroller even though the document viewport itself did not overflow.
- Mobile run `33964852273` independently passes Ticket Detail in AZ light and
  dark with zero accessibility, browser or touch-target findings and primary
  work at 692 px. It exposes the same shell propagation for list and Kanban;
  therefore its four queue captures are diagnostic failures, not acceptance
  evidence. Checkpoints `620ed079f` and `62ebc2aa5` make the Kanban viewport the
  owned horizontal scroller, keep the dashboard shell vertical-only, and teach
  the audit to distinguish an explicit nested scroller from uncontained clipped
  content. Exact-SHA replacement runs are pending, so no additional TKT box is
  checked yet.
- Empty-state run `33991830724` on `b865e0f81` passes all 72 manager/admin
  combinations for list, Kanban and reports across AZ/RU/EN, light/dark and
  desktop/mobile. Every result has loaded primary work within the first 610 px,
  zero browser/API errors, zero axe/custom accessibility or touch findings, no
  environment mismatch and no horizontal overflow. This replaces the earlier
  diagnostic failures: explicit empty/no-result selectors make empty workspaces
  provable; the report scroller is keyboard-focusable; compact pagination uses
  an accessible active-state contrast.
- High-volume run `33992981530` passes the matching 72 manager/admin cells with
  200 seeded tickets and at most 20 rendered list rows. Primary work remains
  within the first 684 px and all accessibility, touch, browser/API, environment
  and overflow counters remain zero. The run is diagnostic rather than final
  after the subsequent typography and mobile-mode improvements.
- Manual artifact review found two issues outside the initial automated
  assertions. Russian copy fell through the Latin-only Plus Jakarta face to a
  browser serif, and the active list/Kanban/reports mode was outside the first
  mobile filter-strip view. Checkpoints `cdf95e7cf` and `a5ddd0d3c` retain Plus
  Jakarta for Latin copy, add an explicit native sans fallback chain for
  Cyrillic, and place an expanded active-mode label first on narrow screens
  without adding vertical UI.
- Five-ticket run `33994518772` then correctly failed on four 12 px SLA labels
  with 2.13:1/3.21:1 light-theme contrast. Checkpoint `be0eae9e6` replaces the
  table, mobile-card and first-response SLA text tones with accessible 700/300
  light/dark pairs. Replacement run `33995212537` passes 3/3 list/Kanban/report
  scenarios with zero axe findings.
- Exact-SHA performance runs `33995212537`, `33995793208`, `33996390612` and
  `33996890457` pass data profiles 5, 50, 500 and 0 respectively with three load
  samples per surface. All 12 results have zero browser/API, accessibility,
  environment or overflow failures. The 500 profile keeps the list bounded to
  20 DOM rows; steady p50 is 933 ms for list, 797 ms for Kanban and 897 ms for
  reports, filter p50 is 166/394 ms and CLS is 0.0011. First-sample Next.js dev
  compilation outliers are retained separately and are not described as
  steady-state latency.
- The next exact-SHA 96-cell agent matrix is still NOT RUN. Runs `33997418827`,
  `33997623926`, `33997762641` and `33997882343` all ended in GitHub Actions
  `startup_failure` before a job was created while the required self-hosted
  runner reported online and idle. This infrastructure condition does not count
  as a product result; the matrix must be retried before any remaining TKT/TKD
  checkbox can close.
- A current-tree source self-audit passes 24 focused Service Desk, Ticket Detail,
  attachment, permissions, AI-boundary, evidence and state-contract test files
  with 232/232 assertions. `npm run i18n:check` reports 21,893 EN source keys and
  zero missing/extra RU or AZ keys; the deterministic Support UX scan covers 27
  visible TSX files with zero AI-palette, gradient, decorative-stripe,
  oversized-heading, blocking-dialog or reduced-motion findings. These checks
  strengthen but do not replace the pending rendered browser matrix.

## 8A. Nested Workstream — Ticket Detail Workspace

**Status: DONE — full acceptance matrix, CI, merge, deployment and smoke green**
**Route:** `/tickets/[id]`
**Primary file:** `src/app/(dashboard)/tickets/[id]/page.tsx`

Current problem: the highest-frequency Support workflow is outside the original
14-destination scope. Conversation, internal notes, SLA, customer context,
status/assignment, attachments, AI actions, and secondary metadata compete in a
long page. Internal/email messages also use decorative colored side accents,
which the static detector flagged as a recognizable generic dashboard pattern.

Target UX: a compact case workspace with a stable case spine, a readable
conversation, and a composer that keeps the next action visible without losing
customer/SLA context.

- [x] **SUPUX-TKD-001** Baseline the agent journey from queue to reply, internal
  note, assignment/status change, and return to the same queue state.
- [x] **SUPUX-TKD-002** Define the case spine: customer, channel, ownership,
  priority, status, SLA state, and next safe action.
- [x] **SUPUX-TKD-003** Keep the conversation and reply/note composer primary;
  move infrequent metadata and diagnostics behind progressive disclosure.
- [x] **SUPUX-TKD-004** Make public reply versus internal note unmistakable in
  copy, composer state, message history, focus order, and screen-reader output.
- [x] **SUPUX-TKD-005** Preserve drafts across send errors, tab switches,
  navigation warnings, attachment failures, and recoverable refreshes.
- [x] **SUPUX-TKD-006** Keep SLA risk and assignment/status controls reachable
  without a full-page return scroll; do not cover conversation content on mobile.
- [x] **SUPUX-TKD-007** Replace decorative side stripes and color-only message
  distinctions with structure, labels, icons, and restrained semantic surfaces.
- [x] **SUPUX-TKD-008** Provide keyboard-complete reply, note, attach, assign,
  change-status, and secondary-action flows with visible focus.
- [x] **SUPUX-TKD-009** Define loading, partial-context, stale, send-progress,
  duplicate-send prevention, success, failure, permission, and closed-ticket states.
- [x] **SUPUX-TKD-010** Verify Support AI actions respect the module master switch
  and explain unavailable/disabled/configuration states without blocking manual work.

Acceptance:

- An agent can open the next case, understand urgency, reply, and move on without
  losing queue context or using a pointer.
- Public replies and internal notes cannot be confused by color, placement, or
  ambiguous labels.
- A failed send preserves text and attachments and offers an actionable retry.
- The primary conversation/composer flow works at 375 px without horizontal
  overflow or a permanently obstructed viewport.

Current verification evidence (2026-09-04):

- `61c43a64b` adds a stable customer/channel/owner/status/priority/SLA case
  spine and next-safe-action control, makes the conversation/composer the first
  primary block, and collapses request metadata plus diagnostics behind native
  keyboard-operable disclosure.
- Tenant-and-ticket-scoped reply/note drafts survive refresh and navigation;
  send failure keeps text, presents retry, and duplicate clicks are disabled.
  Closed tickets are blocked in both UI and the comment API until reopened.
  Initial, permission, partial-context, stale, progress, success, and mutation
  failure feedback are explicit. Support AI loading, disabled, unavailable, and
  action-failure states leave the manual composer usable.
- Changed source ESLint, translation parity, `git diff --check`, and 52 targeted
  Vitest assertions are green. The pre-existing combined ticket test file still
  contains 43 unrelated `no-explicit-any` lint findings; the newly added case
  does not add one.
- `d9c378fae` adds tenant/RBAC-gated ticket uploads with random stored names,
  size, extension, MIME and byte-signature validation, persistent proxy
  delivery, own-pending-file removal, and atomic comment binding. The composer
  restores successful uploads with its tenant-and-ticket draft, retains a
  failed file for retry during the active session, prevents send/upload races,
  and renders sent files as keyboard-focusable links.
- Comment submission now carries a durable client request key. Replays return
  the original comment without duplicating notification, milestone, or channel
  side effects; mismatched or unavailable attachment ownership fails closed
  while preserving the client draft.
- Prisma schema validation and client generation, changed-source ESLint,
  translation parity, `git diff --check`, and 57 focused Vitest assertions are
  green for the attachment slice. The migration is committed but was not
  applied to any database during development.
- TKD checkboxes remain open until GitHub CI typecheck plus the mandatory
  authenticated browser matrix (375/768/1024/1440, AZ/RU/EN, light/dark,
  keyboard, touch, reduced motion, forced failures, accessibility,
  performance, and visual regression) is recorded. Full local typecheck is
  still NOT RUN for this checkpoint because the earlier attempt exhausted the
  Node 2 GB heap and the Contabo workload contract forbids a heavier retry.
- Run `33952086518` captured only the loading shell because the evidence runner
  waited for document load rather than ticket data. Its server responses also
  exposed the invalid `Deal.status` filters in Customer 360 and a forbidden
  full-user-directory request by the Support role. Checkpoint `1d2a9e215`
  replaces those filters with the tenant's configured won/closed stage
  vocabulary, reuses the ticket-safe routing-agent projection, and makes the
  runner wait for `ticket-detail-workspace`.
- Exact-SHA run `33957057784` captures the loaded Ticket Detail workspace at
  1440x900 with no horizontal or page-level vertical overflow, zero HTTP/console
  errors, zero axe/custom accessibility findings, valid keyboard stops, and
  matching AZ/light/reduced-motion environment. It also proves preserved text
  after a synthetic 503 and successful retry, plus a keyboard-only priority
  update. The five earlier contrast failures are cleared by restrained darker
  shades of the existing orange/amber system. TKD tasks remain open until the
  full role/locale/theme/device/state matrix and production-build CI gate pass.
- Exact-SHA runs `33964831143` and `33965630196` pass every one of the original
  15 interaction scenarios. Checkpoint `95f4960ff` raises that contract to 19
  required outcomes by adding comment-permission recovery, Reply/Internal mode
  plus leave-warning draft recovery, closed-ticket blocking/reopen, and
  recoverable Support AI state-load failure. It also gives the unavailable AI
  state an explicit retry without disabling manual composition. These additions
  are source-tested but remain NOT RUN in the browser until the queued exact-SHA
  mutation run completes.

Closure evidence (2026-09-12; supersedes the earlier open/NOT RUN notes above):

- PR #82 delivered exact head
  `f5b5b8a7d11145d3f6dc5b13d6e0a9359965cf68` to `main` as
  `4405a6233ac0dba79a2d95e6bb76749a6bce7b9f`; every required PR check passed.
- Exact-head run `34709481284` passes the complete typical-data matrix: 96/96
  static rows across AZ/RU/EN, light/dark, desktop/tablet/mobile coverage and
  the required roles. Empty-data run `34710883064` passes 72/72 manager/admin
  rows; high-volume run `34712213207` passes the matching 72/72 rows. All three
  report zero browser/API errors, accessibility findings, touch-target issues,
  environment mismatches and uncontained horizontal overflow.
- Desktop mutation run `34707306974` and mobile mutation run `34708570440`
  each pass 20/20 required state/recovery flows plus 4/4 static surfaces. This
  proves keyboard and touch queue opening/return, Take next, reprioritization,
  explicit Kanban movement, reply/note distinction, draft and attachment
  recovery, permission recovery, closed-ticket handling and the Support AI
  master-switch boundary.
- Seven-sample baseline run `34713953704` passes 4/4 surfaces with maximum load
  p75 494 ms, filter p75 108 ms and primary-work top 488 px. Seven-sample compare
  run `34715061387` passes 4/4 visual and 4/4 performance comparisons, with no
  visual mismatch or performance regression; maximum load p75 is 391 ms and
  filter p75 is 87 ms.
- The first production run exposed one unrelated but release-blocking database
  isolation gap on `ticket_attachments`. PR #100 applied the forward-only RLS
  correction and merged as
  `b0a4ba67fa8c7a5da78d0442bfc919e55a5ca202`. Deployment run `34718930337`
  then passed quality/security, immutable production build, atomic deployment,
  scheduler checks, public DB-path ping, exact revision, hashed-asset smoke and
  tenant isolation. The production log records migration
  `20260912225000_ticket_attachments_rls` and RLS coverage of 533/533 enforced,
  zero leaks, zero unreadable tables and zero warnings.
- Public verification after the green deployment returned `{"ok":true}` from
  `/api/v1/ping` and exact `artifactSha`
  `b0a4ba67fa8c7a5da78d0442bfc919e55a5ca202` from `/api/v1/public/build-info`.
  The Service Desk and Ticket Detail Definition of Done is therefore complete;
  all SUPUX-TKT and SUPUX-TKD checkboxes are closed.

## 9. Workstream 2 — Complaint Registry

**Status: DONE — exact-SHA browser, recovery, responsive, accessibility, performance and visual gates green; PR/release pending**
**Route:** `/complaints`
**Primary file:** `src/app/(dashboard)/complaints/page.tsx`

Current problem: a 30 px title, four KPI cards, four server filters, and DataTable
search create duplicate control surfaces. The ten-column table is difficult on
laptop/mobile and fetch/export failures are not clearly reported.

Target UX: a compact complaint triage list with clear ownership, deadline, and
resolution state.

- [x] **SUPUX-CMP-001** Normalize header size and remove extra page/container
  padding.
- [x] **SUPUX-CMP-002** Use one search plus a Filters popover/drawer, active chips,
  reset, and stable result count.
- [x] **SUPUX-CMP-003** Reduce default columns to triage-critical data; move
  secondary metadata to row detail.
- [x] **SUPUX-CMP-004** Add responsive complaint cards for narrow widths.
- [x] **SUPUX-CMP-005** Show import/export progress, completion, and failure.
- [x] **SUPUX-CMP-006** Add fetch error/retry and preserve the current query.
- [x] **SUPUX-CMP-007** Keep create/import/export hierarchy to one primary and
  secondary actions.
- [x] **SUPUX-CMP-008** Audit and redesign `/complaints/new` as part of the create
  flow, including draft preservation, validation, and return-to-registry state.
- [x] **SUPUX-CMP-009** Audit `/complaints/[id]` for ownership, deadline,
  conversation/evidence, lifecycle actions, and responsive detail hierarchy.
- [x] **SUPUX-CMP-010** Audit `/complaints/import` with explicit mapping preview,
  row-level validation, partial success, retry, and downloadable error evidence.
- [x] **SUPUX-CMP-011** Preserve registry filters and scroll position across
  create, import, detail, and back navigation.

Acceptance:

- Search and filtering are controlled from one surface.
- A complaint can be triaged at 375 px without horizontal page scrolling.
- Export failure cannot be mistaken for a completed export.
- Create/detail/import flows return users to the same registry context and never
  discard recoverable work silently.

Current verification evidence (2026-09-13):

- Checkpoints `f0088c1ae`, `1c3b36c4b` and `38e411c47` replace the duplicate
  KPI/search/filter surfaces with a compact URL-backed registry, five triage
  columns, progressive metadata and mobile cards. Create is the sole primary
  action; import/export are secondary and expose distinct progress, success,
  failure and retry states. Tenant-scoped assignee validation and the 15 MB
  import limit are enforced at the API boundary as well as in the UI.
- Create, detail and import carry a validated `returnTo`; tenant-scoped drafts,
  leave warning and failed-submit recovery prevent silent loss. Detail puts
  owner/deadline/lifecycle/conversation/evidence first and exposes assignment
  rollback, stale snapshot, closed-response, permission, retry/idempotency and
  destructive-confirm states. Import previews mapping and row validation,
  distinguishes full/partial/failure results, downloads complete CSV evidence
  and retries only failed source rows.
- Typical run `34724208546` passed 192/192 combinations across manager/admin,
  AZ/RU/EN, light/dark and 1440/1024/768/375 viewports. Empty run `34726959676`
  and high-density run `34728256789` each passed 96/96. Across these 384 rows
  there are zero runtime, axe, custom accessibility, touch-target, horizontal
  overflow, environment or first-viewport-primary failures. Maximum recorded
  load was 1,146 ms in the high-density one-sample matrix; primary work remained
  within the first 680 px.
- Desktop mutating run `34738564918` passed 10/10 recovery journeys and 4/4
  static pages. Mobile RU/dark run `34740752183` passed the same 10/10 and 4/4
  at 375 px with physical-touch emulation and reduced motion; the visible card
  opened by touch, query context persisted and the registry scroll restored
  exactly from 878 px to 878 px. The flows cover keyboard/touch open-and-return,
  fetch/export failure, draft/create retry, response retry, status permission,
  assignee rollback/restore, stale and detail-permission recovery, XLSX mapping,
  partial import, error CSV and failed-row-only retry.
- Exact-SHA baseline run `34743619941` on `5dbc61e5ba04ebab4dba55a998c4233f957b5197`
  passed 4/4 pages with seven samples each. Measured load p75 was 618 ms for the
  registry, 401 ms for create, 387 ms for import and 289 ms for detail. The
  evidence-derived budgets are 650/450/350/400 ms and retain the existing
  relative, CLS, density and primary-work guards.
- Exact-SHA compare run `34744431151` passed 4/4 visual and 4/4 performance
  comparisons with no regressions: load p75 was 549/253/258/231 ms. Three page
  screenshots were byte-identical; detail changed 0.0308% of pixels, below the
  0.5% threshold, with matching dimensions and layout. All four results have
  zero browser/HTTP errors and unchanged primary-work position.
- Current-tree checks pass all 11 Complaint/browser/performance contract files
  (84/84 assertions), changed-source ESLint,
  runner syntax, `git diff --check`, translation parity (22,498 EN keys; zero
  RU/AZ missing or extra) and the scoped anti-pattern scan (five visible TSX
  files; zero findings). Exact-SHA evidence production builds are green; a full
  local build/typecheck remains intentionally NOT RUN under the Contabo workload
  contract and is delegated to the mandatory PR checks.

## 10. Workstream 3 — Agent Desktop

**Status: IN PROGRESS — implementation and recovery-evidence checkpoints complete; rendered CI/browser gates pending**
**Route:** `/support/agent-desktop`
**Primary file:** `src/app/(dashboard)/support/agent-desktop/page.tsx`

Current problem: average response time, SLA compliance, and part of leaderboard
CSAT are hardcoded or random. The page looks authoritative while showing data
that cannot support operational decisions. The layout prioritizes dashboard
metrics and team leaderboard over an agent's next case.

Target UX: a personal workbench centered on the next urgent case, personal queue,
availability, and real SLA deadlines.

- [ ] **SUPUX-AGT-001** Remove random and hardcoded operational metrics or label
  them explicitly unavailable until a real aggregate API exists.
- [ ] **SUPUX-AGT-002** Define one authoritative metric contract and time range for
  response, resolution, SLA, CSAT, and queue counts.
- [ ] **SUPUX-AGT-003** Put next urgent ticket and personal queue before team-level
  analytics.
- [ ] **SUPUX-AGT-004** Move leaderboard and management analytics into a secondary
  view restricted by role.
- [ ] **SUPUX-AGT-005** Replace four saturated KPI cards with compact trustworthy
  indicators and avoid duplicating CSAT/open-case information.
- [ ] **SUPUX-AGT-006** Implement availability as an accessible switch with clear
  saving, success, and rollback feedback.
- [ ] **SUPUX-AGT-007** Localize priority/status values and make queue rows
  keyboard-operable.
- [ ] **SUPUX-AGT-008** Add error/retry states for availability and dashboard data.

Acceptance:

- No visible metric is random, hardcoded, or computed from an incompatible scope.
- An agent reaches the next assigned/urgent case in one primary action.
- A failed availability update is visible and the control returns to truth.

Current verification evidence (2026-09-05):

- `fa85acf70` removes the page-size-derived, hardcoded, and random figures and
  introduces one tenant-scoped personal metric contract. Queue volume is the
  current assigned non-terminal set; response, resolution, resolution rate,
  SLA compliance, and CSAT use the same rolling 30-day assigned creation cohort,
  expose their sample sizes, and return `null` rather than a misleading zero
  when no observation exists.
- The first primary action opens the next assigned ticket, ordered by actionable
  SLA deadline, then business priority and age. The complete personal queue is
  before analytics, has native links and 44 px targets, and switches from table
  to compact cards below the tablet breakpoint. Priority/status values and all
  new copy have AZ/RU/EN parity.
- The old saturated KPI quartet, SVG gauges, and inline leaderboard are removed.
  Team comparison is a secondary link emitted only for
  `admin`/`manager`/`superadmin`. The availability control reads server truth,
  exposes accessible switch semantics and saving/success/failure state, does not
  optimistically move on failure, and offers a retry for both load and save.
- Changed-source ESLint, AZ/RU/EN translation parity, `git diff --check`, and 16
  focused Vitest assertions are green. Tests cover exact metric math and null
  samples, queue ordering, tenant/user query scoping, ticket-read authorization,
  management visibility, availability read/write scoping, failure behavior,
  responsive/keyboard contracts, and removal of fabricated values and rainbow
  dashboard patterns.
- AGT checkboxes remain open until authenticated browser evidence covers
  375/768/1024/1440, AZ/RU/EN, light/dark, keyboard/focus, touch, reduced motion,
  forced loading/empty/error/permission/recovery states, accessibility,
  performance, and visual regression. Full local typecheck is NOT RUN because
  the earlier reference-slice process exhausted Node's 2 GB heap and the Contabo
  workload contract forbids a heavier local retry; GitHub CI remains mandatory.
- Checkpoint `d3cc476f1` removes an invalid nested `main` landmark, makes the
  browser gate wait for the data-ready workspace and first next-case surface,
  localizes urgent priority and escalated status, and exposes an inline live
  success state for availability instead of relying on a transient toast.
- Checkpoint `983e83b85` adds a six-outcome disposable Agent Desktop runner for
  initial load failure and keyboard retry, availability load failure, keyboard
  save failure with rollback and retry, failed refresh with stale snapshot,
  empty-queue recovery, and non-retryable permission denial. It is hard-blocked
  outside an ephemeral loopback tenant and restores the availability fixture
  after its only real mutation.
- Current-tree verification passes five Agent Desktop/availability test files
  with 21/21 assertions, changed-source ESLint, `git diff --check`, translation
  parity (21,895 EN keys; zero RU/AZ missing or extra keys), and the Support UX
  anti-pattern scan (27 visible TSX files; zero findings). Browser execution is
  still **NOT RUN** because GitHub Actions continues to fail before job creation;
  no AGT checkbox is closed on source evidence alone.

## 11. Workstream 4 — VoIP Calls

**Status: IN PROGRESS — implementation and recovery-evidence checkpoints complete; rendered CI/browser gates pending**
**Route:** `/support/voip`
**Primary file:** `src/app/(dashboard)/support/voip/page.tsx`

Current problem: total calls are server-wide while inbound/outbound/average are
computed from the current page. Search requests fire per keystroke, the table is
not safely responsive, and recording playback is a tiny icon-only link.

Target UX: a responsive call timeline with accurate aggregates, connection
health, and useful recording/contact actions.

- [ ] **SUPUX-VOIP-001** Create or reuse one aggregate contract for total,
  inbound, outbound, missed, and average duration over the same filter/time range.
- [ ] **SUPUX-VOIP-002** Debounce search and cancel stale requests.
- [ ] **SUPUX-VOIP-003** Preserve visible connection/test/settings status while
  reducing header competition.
- [ ] **SUPUX-VOIP-004** Add responsive call rows/cards instead of relying on a
  clipped desktop table.
- [ ] **SUPUX-VOIP-005** Replace the icon-only recording link with an accessible
  inline player, duration, loading, unavailable, and error states.
- [ ] **SUPUX-VOIP-006** Add contextual call-back/open-contact actions where
  permissions and data allow.
- [ ] **SUPUX-VOIP-007** Distinguish no calls from load failure.

Acceptance:

- All summary metrics use the same server filter and time range.
- Search does not request on every raw keystroke.
- A recording can be discovered and controlled by keyboard and touch.

Current verification evidence (2026-09-05):

- `889143660` adds an opt-in summary to the existing call-history response so
  total, inbound, outbound, missed, and average duration are evaluated against
  the exact same tenant/access/search/direction/rolling-30-day predicate as the
  visible rows. Duration exposes its real sample and missing data stays
  unavailable instead of becoming `0:00`; consumers that do not request the
  summary avoid the extra aggregate queries.
- Raw search input is committed after 350 ms and every history request has an
  `AbortController`. A filter/page change clears incompatible prior data, while
  a same-filter refresh retains its snapshot and labels failure explicitly.
  Initial permission/load failure, loading, empty history, filtered no-results,
  stale refresh, reset, and retry paths are distinct.
- Connection readiness remains visible with icon and text. Agents read safe
  provider configuration readiness; only administrators invoke the live
  connection test or see the settings action, matching the server gate. The
  call log is a desktop table and tablet/mobile card timeline with 44 px actions,
  localized text status, restrained semantic styling, callback/contact actions
  gated by `voip:write`/`contacts:read`, and no clipped narrow-width table.
- Both timeline rows and deep-link detail use the tenant/RBAC-protected recording
  path through a native inline audio control. The control exposes call/media
  duration, ready/loading/playing/paused/ended/error/unavailable text, keyboard
  and touch controls, and error retry. Loading and transition animation opt out
  under reduced motion.
- Changed-source ESLint, AZ/RU/EN translation parity, `git diff --check`, and 121
  related Vitest assertions are green. The original `api-calls.test.ts` file has
  longstanding unrelated `no-explicit-any` findings, so changed application and
  contract-test sources were linted separately; the full file's 87 API tests
  pass within the 121-assertion related suite.
- VOIP checkboxes remain open until authenticated browser evidence covers
  375/768/1024/1440, AZ/RU/EN, light/dark, keyboard/focus, actual touch audio
  controls, reduced motion, forced connection/recording/list failures,
  accessibility, performance, and visual regression. Full local typecheck is
  NOT RUN for the same recorded Contabo memory/workload constraint; GitHub CI is
  mandatory before this workstream can be marked complete.
- Checkpoints `b9b2d737f` and `fe44dee68` remove invalid nested `main` landmarks,
  bind browser capture to the data-ready call timeline, expose stable loading,
  empty, error, connection and recording states, and align the UI's role
  fallback with the canonical permission contract.
- Checkpoint `abb87986b` adds a seven-outcome disposable VoIP runner for initial
  and stale history recovery, connection recovery, measured search debounce,
  filtered reset, empty-history recovery, protected audio failure/retry with a
  keyboard-controlled native player, and non-retryable permission denial. It is
  hard-blocked outside an ephemeral loopback tenant and performs no outbound
  call or external side effect.
- Current-tree verification passes eight VoIP/call suites with 130/130
  assertions, changed-source ESLint, `git diff --check`, and the Support UX
  anti-pattern scan (27 visible TSX files; zero findings). Exact-SHA run
  `34000191517` was accepted into the queue but then ended in GitHub Actions
  `startup_failure` before job creation, so rendered execution remains **NOT
  RUN** and no VOIP checkbox is closed.

## 12. Workstream 5 — Knowledge Base

**Status: IN PROGRESS — recovery-evidence checkpoint `7e489b1e7`; CI/browser gates pending**
**Route:** `/knowledge-base`
**Primary file:** `src/app/(dashboard)/knowledge-base/page.tsx`

Current problem: category grouping is useful, but status relies on a small color
dot, row actions are hover-only, category collapse lacks complete semantics, and
the permanent tip delays the article list.

Target UX: a compact library with a category rail, readable publication state,
and always-discoverable article actions.

- [ ] **SUPUX-KB-001** Use a two-pane category/list layout where width permits and
  an equivalent mobile category selector.
- [ ] **SUPUX-KB-002** Replace color-only dots with localized Published/Draft
  labels and icons.
- [ ] **SUPUX-KB-003** Replace hover-only edit/delete actions with an accessible
  row menu.
- [ ] **SUPUX-KB-004** Add `aria-expanded` and focus behavior to category groups.
- [ ] **SUPUX-KB-005** Add create CTA to empty/no-result states and error/retry for
  article/category operations.
- [ ] **SUPUX-KB-006** Move persistent educational copy to contextual help.
- [ ] **SUPUX-KB-007** Confirm destructive category/article behavior, dependency
  impact, and confirmation/undo.
- [ ] **SUPUX-KB-008** Include `/knowledge-base/[id]` in the redesign: readable
  article hierarchy, edit/publish state, related content, and stable back context.
- [ ] **SUPUX-KB-009** Verify customer-visible article state and permissions
  against the portal knowledge-base experience.

Acceptance:

- Publication state is understandable without color.
- All article actions are available without hover.
- Category navigation remains usable at 375 px and by keyboard.
- Opening and returning from an article preserves category/search context.

Current verification evidence (2026-09-05):

- `a0a68b220` replaces the card/table stack with a compact library: an exact
  tenant summary, category rail with published/draft coverage at desktop width,
  an equivalent labelled category select on tablet/mobile, URL-backed search,
  status and category filters, and collapsible category groups with native
  buttons, `aria-expanded`, `aria-controls`, visible focus and 44 px primary
  targets. Loading, partial-refresh failure, initial error, permission/read-only,
  empty, filtered no-results and independent category recovery states are
  distinct.
- Publication state uses localized icon-plus-text labels everywhere, including
  the customer visibility statement on detail. Article actions use an
  always-visible keyboard-operable menu rather than hover opacity. The permanent
  `DidYouKnow` block and decorative metric cards are removed; compact page help
  remains available through the existing contextual Help drawer.
- Article and category deletion now show customer/dependency impact in a proper
  confirmation. Server deletion returns a restorable tenant-scoped snapshot;
  undo recreates the same stable article/category ID and restores article and
  child-category links. Category unlink/delete and dependency capture are one
  transaction, and category references are verified against the current tenant
  on article create/update.
- `/knowledge-base/[id]` now has a readable 72-character content measure,
  explicit edit/publish controls and portal visibility, related same-category
  content, responsive metadata, not-found/error/retry states, safe deletion
  undo, and a validated `returnTo` path. List state is serialized into that path,
  so category/search/status context survives the round trip.
- The portal API remains authenticated and filters both list and detail by the
  verified portal tenant plus `status: "published"`. The previously mismatched
  portal response consumer is corrected, portal rows are native buttons, and
  localized category/search, loading, empty/no-results, article/load error and
  retry states are present. Dates follow the selected AZ/RU/EN locale.
- Changed application/contract-test ESLint, AZ/RU/EN translation parity,
  `git diff --check`, and 105 focused Vitest assertions are green. The two
  modified legacy aggregate test files retain pre-existing `no-explicit-any`
  debt, so lint was run on changed application sources and the new/static guard
  tests; their complete relevant test suites pass.
- Checkpoint `7e489b1e7` removes the nested dashboard `<main>` landmark, binds
  list, article and portal capture to explicit data-ready workspaces, and adds
  stable observable selectors for loading, initial/stale/category failure,
  empty/no-results, non-retryable permission, form-save, publication and portal
  article states. The disposable seed now exports its exact KB article ID, so
  nested detail evidence is fixture-bound rather than guessing a route.
- The same checkpoint adds a nine-outcome Knowledge Base flow runner, hard
  restricted to an ephemeral loopback tenant. It proves keyboard retry,
  category partial-failure recovery, true empty recovery with create path,
  keyboard disclosure and URL-backed return context, transient versus
  non-retryable detail failure, edit/category/save recovery with value
  retention, publication rollback/retry, published-only customer visibility
  and fixture restoration, plus portal list/search/article recovery. The
  runner mutates no remote target and restores the article's original status.
- Current-tree verification passes nine KB/evidence suites with 147/147
  assertions, changed-source ESLint, `git diff --check`, AZ/RU/EN translation
  parity (21,895 leaf keys) and the Support UX anti-pattern scan (27 visible
  TSX files; zero findings). The stale legacy `api-kb.test.ts` expectations now
  reflect multi-field search and the restorable delete snapshot; its existing
  `no-explicit-any` debt remains excluded exactly as documented above.
- KB checkboxes remain open until authenticated browser evidence covers
  375/768/1024/1440, AZ/RU/EN, light/dark, keyboard/focus, physical touch,
  reduced motion, forced loading/empty/error/permission/recovery states,
  accessibility, performance and visual regression. No browser binary is
  installed on this Contabo host, and the host contract assigns browser/build
  gates to CI or the approved worker. Full local typecheck is NOT RUN because
  the earlier reference-slice attempt exhausted Node's 2 GB heap and the same
  contract forbids a heavier local retry; GitHub CI remains mandatory.
  Exact-SHA matrix run `34001165886` for `7e489b1e7` ended in GitHub Actions
  `startup_failure` before job creation (`total_count: 0`), so rendered execution
  is **NOT RUN** and no KB checkbox is closed.

## 13. Workstream 6 — Ticket Categories

**Status: IN PROGRESS — recovery-evidence checkpoint `ac88d8df3`; CI/browser gates pending**
**Route:** `/settings/ticket-categories`
**Primary file:** `src/app/(dashboard)/settings/ticket-categories/page.tsx`

Current problem: the tree/editor concept is sound, but five administrative KPI
tiles precede the task. The editor permanently competes with the tree and moves
below a potentially long list on small screens. Advanced technical fields are
shown by default.

Target UX: an editable category tree with focused add/edit flow and progressive
advanced settings.

- [ ] **SUPUX-CAT-001** Replace five KPI tiles with one compact status summary or
  remove them after product approval.
- [ ] **SUPUX-CAT-002** Add tree expand/collapse and preserve hierarchy context.
- [ ] **SUPUX-CAT-003** Open create/edit in a drawer on desktop and full-screen
  sheet/route on mobile.
- [ ] **SUPUX-CAT-004** Move slug, sort order, and other technical fields into
  Advanced options.
- [ ] **SUPUX-CAT-005** Localize priorities and explain scope/visibility in
  business language.
- [ ] **SUPUX-CAT-006** Replace tiny icon clusters with accessible row actions.
- [ ] **SUPUX-CAT-007** Explain impact before deactivation/deletion when a category
  is in use.

Acceptance:

- Selecting Create/Edit never sends the user searching below a long tree.
- The basic category flow does not require technical fields.
- Deep hierarchies remain navigable and focused after save.

Current verification evidence (2026-09-05):

- `3946aa28b` removes the five-tile KPI block in favor of one border-separated
  status line and puts the searchable category tree in the primary viewport.
  Deep levels use native 44 px disclosure buttons, `role="tree"`/`treeitem`,
  `aria-level`, `aria-expanded`, visible focus and compact capped indentation.
  Filtered descendants retain non-matching ancestors as labelled context,
  search/scope results force their matching paths open, and ordinary/inactive
  browsing still respects the user's collapsed branches.
- Create, child-create and edit now open the same focus-trapped Sheet: full
  viewport at mobile width and a 34 rem drawer from `sm` upward. Saving clears
  incompatible filters, expands the saved node's ancestors and restores focus
  to its tree row. Unsaved sheet changes have an explicit discard guard. The
  shared Sheet close target is now localized, 44 px and reduced-motion safe.
- Name, parent, scope, localized default priority, description and customer
  visibility form the basic flow. Slug and sort order live behind an accessible
  Advanced disclosure. Scope, default behavior and portal visibility are
  explained in business language; raw `low`/`medium`/`high`/`critical` values
  no longer leak into AZ/RU/EN UI.
- Tiny icon clusters are replaced by an always-visible keyboard/touch menu.
  Deactivation can no longer be bypassed through the editor: the confirmation
  explains exact linked-ticket and child-category counts, that existing tickets
  retain their category, and that children stay active with the hidden parent
  kept as admin context. Soft deactivation now preserves the configured portal
  preference so a later restore returns to the prior visibility state rather
  than silently becoming internal-only.
- Initial loading/failure/retry, empty, filtered no-results/reset, read-only
  permission, save/deactivate/restore failure, mutation progress, success and
  draft-discard states are distinct. Shared confirmation and dropdown motion/
  touch behavior was tightened without adding gradients, decorative color
  strips or dashboard-card decoration.
- Changed-source ESLint (including JSX accessibility rules), AZ/RU/EN
  translation parity, `git diff --check`, and 25 focused Vitest assertions are
  green. Pure hierarchy tests prove ancestor-context retention, collapse and
  forced search expansion; route tests prove tenant validation and preservation
  of portal visibility across deactivate/restore; static contracts cover the
  drawer, disclosure, focus, states, localization and visual constraints.
- Checkpoint `ac88d8df3` removes the nested dashboard `<main>`, distinguishes
  transient load failure from non-retryable permission denial, and binds normal
  capture to a data-ready category-tree workspace. It adds stable selectors for
  loading, error, empty/no-results, filters, tree rows/disclosures, row actions,
  editor, advanced options, save failure and lifecycle recovery.
- The checkpoint also fixes an observed focus defect: deactivation now reveals
  inactive rows before returning focus, so the operated category does not
  disappear before the focus-restoration effect runs. The disposable seed adds
  an actual child category under the linked Technical help category, allowing
  parent/child behavior and dependency impact to be tested rather than inferred.
- A seven-outcome loopback-only runner proves keyboard retry plus non-retryable
  permission handling, true empty recovery with create path, no-result reset,
  collapse/expand and forced ancestor context, keyboard Advanced disclosure and
  discard guard, save failure/value retention/retry/focus return, and
  deactivate/restore rollback with final fixture restoration. Current-tree
  verification passes eight focused suites with 48/48 assertions,
  changed-source ESLint, `git diff --check`, AZ/RU/EN parity (21,895 leaf keys)
  and the Support UX anti-pattern scan (27 visible TSX files; zero findings).
- CAT checkboxes remain open until authenticated browser evidence covers
  375/768/1024/1440, AZ/RU/EN, light/dark, keyboard/focus trap and return,
  physical touch, reduced motion, forced loading/empty/error/permission/recovery
  states, accessibility, performance and visual regression. No browser binary
  is installed on this Contabo host and browser/build gates belong to CI or the
  approved worker. Full local typecheck is NOT RUN because the earlier
  reference-slice attempt exhausted Node's 2 GB heap and the host contract
  forbids a heavier local retry; GitHub CI remains mandatory. Exact-SHA run
  `34001658728` for `ac88d8df3` ended in GitHub Actions `startup_failure`
  before any job was created, so rendered execution is **NOT RUN** and no CAT
  checkbox is closed.

## 14. Workstream 7 — SLA Policies

**Status: IN PROGRESS — recovery-evidence checkpoint `bad92f916`; CI/browser gates pending**
**Route:** `/settings/sla-policies`
**Primary files:** `src/app/(dashboard)/settings/sla-policies/page.tsx`,
`src/components/sla-policy-form.tsx`

Current problem: title and explanation are duplicated; priorities and time units
leak raw values; actions are icon-only; errors can look like an empty list; and
the form does not clearly prevent conflicting response/resolution targets.

Target UX: a readable SLA policy matrix with safe editing and a plain-language
preview of policy behavior.

- [ ] **SUPUX-SLA-001** Remove duplicate header/card title and repeated copy.
- [ ] **SUPUX-SLA-002** Present policies as a compact matrix by priority where it
  improves comparison; retain a responsive list alternative.
- [ ] **SUPUX-SLA-003** Localize priorities, hours/minutes, placeholders, errors,
  and accessible names.
- [ ] **SUPUX-SLA-004** Add preview text for first response, resolution, business
  hours, and escalation implications.
- [ ] **SUPUX-SLA-005** Validate resolution target against response target and
  detect duplicates/conflicts before submit.
- [ ] **SUPUX-SLA-006** Replace icon-only actions and add load/save error recovery.

Acceptance:

- A manager can compare policy targets without opening each policy.
- Invalid or conflicting targets cannot be saved silently.
- No English unit or raw priority leaks into AZ/RU/EN UI.

Current verification evidence (2026-09-05):

- `61d4087eb` replaces the duplicated page/card headings and generic data table
  with one compact heading, a border-separated coverage summary, a semantic
  priority matrix from `md` upward and an equivalent stacked mobile list.
  Response, resolution, clock mode, active state and exact company/entitlement
  dependency counts are comparable without opening a policy. Legacy missing
  coverage and duplicate-active conflicts are surfaced explicitly rather than
  hidden by sorting.
- Priorities, duration units, placeholders, descriptions, errors, action names,
  permission guidance and status text are localized in AZ/RU/EN. Active state
  uses icon plus text, not color alone. Desktop column headers and priority
  rowgroups have explicit table semantics; action triggers and menu items have
  accessible names and 44 px targets. The mobile form uses the shared
  focus-trapped full-viewport dialog and keeps entered values after server
  errors.
- The editor previews the first-response deadline, resolution deadline, clock
  behavior and escalation/reporting consequence in plain language. Repository
  inspection proved that the current SLA resolver still adds calendar time and
  does not yet apply a support schedule. Therefore the business-hours flag is
  presented honestly as a stored preference while the preview warns that
  current ticket deadlines continue continuously; no unsupported paused-clock
  behavior is claimed.
- Client and API validation both require targets of at least one minute and
  resolution at or after first response. The API restricts priorities to the
  supported domain and uses serializable tenant-scoped transactions to reject a
  second active policy for the same priority, including concurrent-write retry
  conflicts. Existing legacy conflicts remain repairable by deactivating one
  policy. Deletion is blocked when an entitlement depends on the policy and
  reports company detach impact before confirmation.
- Initial loading, populated, empty, initial failure/retry, read-only permission,
  save validation/failure/value retention, background refresh failure/retry,
  delete dependency/failure and success states are distinct. Motion is limited
  to the reduced-motion-safe loading skeleton; the surface uses theme tokens
  without gradients, decorative colored strips, rainbow KPIs or oversized
  typography.
- Changed-source ESLint, AZ/RU/EN translation parity, `git diff --check`, and 64
  focused Vitest assertions are green. Unit tests cover duration and coverage
  rules; API tests cover invalid ordering, transactional active-priority
  conflicts, partial updates, inactive alternatives and dependency-safe delete;
  static contracts cover responsive composition, localization, truthful
  preview, recovery states, touch sizing and visual constraints. Existing SLA
  resolver, duration-format and mixed API regression suites are also green.
- Checkpoint `bad92f916` removes the nested dashboard `<main>`, binds desktop
  matrix and mobile list capture to an explicit data-ready workspace, and adds
  stable observable selectors for loading, initial/background failure,
  non-retryable permission denial, empty/create, policy rows/actions, editor
  validation, target inputs, clock/active toggles, preview and save recovery.
- A six-outcome disposable loopback runner proves keyboard retry and permission
  behavior, true empty recovery, client target-order and active-priority
  conflict prevention, truthful preview, keyboard selection of an inactive
  alternative, save failure with value retention, stale-snapshot refresh
  recovery, dependency-blocked delete, and delete failure/retry. Its temporary
  policy is removed before completion; the linked production-like fixture is
  never mutated. Current-tree verification passes nine SLA/evidence suites with
  85/85 assertions, changed-source ESLint, `git diff --check`, AZ/RU/EN parity
  (21,895 leaf keys) and the Support UX anti-pattern scan (27 visible TSX files;
  zero findings).
- SLA checkboxes remain open until authenticated browser evidence covers
  375/768/1024/1440, AZ/RU/EN, light/dark, keyboard/focus trap and return,
  physical touch, reduced motion, forced loading/empty/error/permission/recovery
  states, accessibility, performance and visual regression. No browser binary
  is installed on this Contabo host and browser/build gates belong to CI or the
  approved worker. Full local typecheck is NOT RUN because the earlier
  reference-slice attempt exhausted Node's 2 GB heap and the host contract
  forbids a heavier local retry; GitHub CI remains mandatory. Exact-SHA run
  `34001984499` for `bad92f916` ended in GitHub Actions `startup_failure`
  before job creation, so rendered execution is **NOT RUN** and no SLA checkbox
  is closed.

## 15. Workstream 8 — Support Entitlements

**Status: IN PROGRESS — recovery-evidence checkpoint `168aa7134`; CI/browser gates pending**
**Route:** `/support/entitlements`
**Primary file:** `src/app/(dashboard)/support/entitlements/page.tsx`
**Related roadmap:** `docs/support-entitlements-roadmap.md`

Current problem: five KPI cards, six how-it-works blocks, five filters, long
entitlement cards, a permanent create/edit form, and a milestone constructor in
every record make this the longest and most cognitively expensive page. Browser
`prompt` is used for cancellation reasons.

Target UX: a compact support-terms list with one selected detail, lifecycle
clarity, and a milestone editor loaded only when requested.

- [ ] **SUPUX-ENT-001** Reconcile this UX plan with the completed functional
  entitlement roadmap; do not regress lifecycle, audit, permission, or ticket
  milestone behavior.
- [ ] **SUPUX-ENT-002** Replace long record cards with a compact list/table and a
  selected-detail drawer or dedicated route.
- [ ] **SUPUX-ENT-003** Move create/edit into a persistent drawer or full-screen
  mobile flow instead of rendering beside/below every record.
- [ ] **SUPUX-ENT-004** Load the milestone summary by default and open the full
  constructor only for the selected entitlement.
- [ ] **SUPUX-ENT-005** Collapse how-it-works content into contextual first-use
  help.
- [ ] **SUPUX-ENT-006** Limit KPI indicators to active exceptions: expiring,
  at-risk, and uncovered companies.
- [ ] **SUPUX-ENT-007** Consolidate five filters into the shared toolbar pattern.
- [ ] **SUPUX-ENT-008** Replace browser prompt/confirm with a lifecycle dialog that
  captures reason, impact, and confirmation.
- [ ] **SUPUX-ENT-009** Preserve the current stronger permission, notice, error,
  and lifecycle-state handling.
- [ ] **SUPUX-ENT-010** Test 0, 1, 20, and 100 entitlements with multiple milestone
  definitions.

Acceptance:

- The list remains compact regardless of milestone count.
- Create/edit/cancel can be completed without losing list context.
- Existing lifecycle and audit behavior remains intact.

Current verification evidence (2026-09-05):

- `27c571df4` reconciles this workstream with every completed phase in
  `docs/support-entitlements-roadmap.md`. CRUD, immutable company/SLA identity,
  draft/suspended edit rules, lifecycle transitions, role-specific permissions,
  milestone templates and duplicate protection, ticket runtime milestones,
  waiver/escalation, audit events and report integration remain on their
  existing APIs. Lifecycle reasons are now retained in audit payloads for every
  action; cancellation still persists its required dedicated reason.
- Five KPI cards are replaced by one border-separated exception line containing
  only expiring terms, overdue/due-soon milestone attention and uncovered active
  companies. The six-step explainer is a native collapsed disclosure beside the
  existing contextual Help entry. Five filters now share one compact toolbar
  with localized accessible names, result context, active-filter count and one
  reset action.
- Long cards and their repeated constructors are replaced by a semantic desktop
  table at wide widths and a compact mobile/tablet list through 1024 px. Company,
  level, SLA, validity, milestone health and lifecycle status are visible in the
  list without rendering definitions. Text and icons supplement state color;
  raw support/status/milestone values have localized unknown fallbacks.
- Opening a record keeps the list and filters mounted and presents contract
  details in a full-viewport mobile/42 rem desktop drawer. It initially renders
  only the milestone summary. The complete template/manual rule constructor is
  mounted only after Manage rules on the selected editable term. Definition
  delete uses a recoverable confirmation dialog rather than browser confirm.
- Create/edit uses a separate full-viewport mobile/34 rem desktop drawer, keeps
  input after API errors, validates required fields and date order before
  submit, protects unsaved close with a discard dialog, and preserves retired or
  paginated company/SLA labels when editing existing terms. Closing detail or
  edit restores focus to the visible desktop/mobile row; if a lifecycle/filter
  change removed that row, focus falls back to the list region.
- Activate, suspend, resume, expire and cancel open one explicit focus-trapped
  lifecycle dialog showing current state, concrete ticket impact, an optional
  audit reason (required for cancel) and final confirmation. Browser
  `prompt`/`confirm` no longer exists. Localized API codes distinguish active
  company conflicts, missing milestone rules, invalid validity, non-editable
  terms, duplicate definitions and definitions already used by tickets.
- Initial loading, empty, filtered no-results/reset, initial load failure/retry,
  stale-list background refresh failure/retry, read-only permission, drawer
  validation/save/recovery, milestone validation/mutation/delete, lifecycle
  permission/error/recovery and success states are distinct. All primary
  controls have 44 px targets, native or explicit accessible names and
  reduced-motion fallbacks. Theme tokens replace rainbow level/status blocks,
  gradients, colored side stripes and oversized headings.
- Changed-source ESLint, AZ/RU/EN translation parity, `git diff --check`, and 190
  focused Vitest assertions are green. The regression set covers entitlement
  CRUD/permissions/lifecycle/audit, templates/definitions, runtime automation,
  waiver, ticket creation and reports. Pure presentation tests prove stable
  filtering for 0, 1, 20 and 100 records with multiple definition counts;
  static contracts cover compact/responsive composition, conditional
  constructor mounting, focus recovery, dialogs, states, touch/motion and visual
  constraints. A 1.5 GB targeted TypeScript project for the page and list logic
  is green.
- ENT checkboxes remain open until authenticated browser evidence covers
  375/768/1024/1440 with 0/1/20/100 records and multiple definitions, AZ/RU/EN,
  light/dark, keyboard/focus trap and return, physical touch, reduced motion,
  forced loading/empty/error/permission/recovery states, accessibility,
  performance and visual regression. No browser binary is installed on this
  Contabo host. A separate targeted API-route TypeScript graph is NOT RUN: it
  exhausted the bounded 1.5 GB Node heap, and the host contract forbids a
  heavier retry; route ESLint and 190 regressions are green, but GitHub CI is
  still mandatory.

Additional recovery evidence (2026-09-06):

- `168aa7134` removes the nested page-level `<main>` from the dashboard route
  and distinguishes terminal 403 permission feedback from retryable initial,
  background and milestone failures. Stable state, list, row, drawer, form,
  lifecycle and milestone selectors now let browser evidence assert outcomes
  instead of inferring them from screenshots.
- The exact-SHA disposable flow
  `scripts/support-ux-entitlements-flow-evidence.mjs` is fail-closed to
  `ephemeral` loopback. Its seven outcomes exercise keyboard load recovery and
  terminal permission denial; rendered 0/1/20/100 density with 100 definitions
  per term; filter no-results/reset; detail focus return; lifecycle failure,
  retained reason and retry; edit failure with retained values; lazy milestone
  creation/delete rollback and cleanup; and restoration of the seeded active
  term and its original notes.
- The ephemeral manifest now exposes only the generated entitlement ID to the
  job environment. The generic AZ/RU/EN, light/dark and
  375/768/1024/1440 evidence matrix waits for an explicit ready state and a
  rendered entitlement row or empty state. No new remote secret or production
  target is used.
- Changed-source ESLint, `node --check`, `git diff --check`, translation parity
  (21,895 keys in each of AZ/RU/EN), the 27-file anti-pattern scan (0 findings),
  and 163 focused Vitest assertions in 12 suites are green in this worktree.
  A fresh full `npx tsc --noEmit` is **NOT RUN/BLOCKED**: Node exhausted its
  default 2 GB heap (`exit 134`), and the Contabo host contract forbids a
  heavier local retry.
- Exact-SHA GitHub Actions run `34002943562` for `168aa7134` ended in
  `startup_failure` with zero jobs created. Therefore the browser matrix,
  accessibility scan, physical touch proxy, performance sampling and visual
  comparison are still **NOT RUN**; all SUPUX-ENT checkboxes remain open.

## 16. Workstream 9 — Entitlement Templates

**Status: IN PROGRESS — recovery-evidence checkpoint `f71a46049`; browser/CI gates pending**
**Route:** `/settings/entitlement-templates`
**Primary file:** `src/app/(dashboard)/settings/entitlement-templates/page.tsx`

Current problem: switching support level replaces the current draft without a
dirty-state warning. Each rule is a wide six-field card, Save is duplicated, and
default names remain English.

Target UX: a safe template editor with compact rule summaries, explicit draft
state, and a preview of resulting support behavior.

- [ ] **SUPUX-TMP-001** Add autosave or a dirty-state guard before level, route,
  or context changes.
- [ ] **SUPUX-TMP-002** Preserve and restore drafts after mutation errors.
- [ ] **SUPUX-TMP-003** Replace six-field permanent cards with compact rule rows
  and an expandable editor.
- [ ] **SUPUX-TMP-004** Use one sticky Save/Discard bar and explain why Save is
  disabled.
- [ ] **SUPUX-TMP-005** Add plain-language timeline/summary preview.
- [ ] **SUPUX-TMP-006** Localize default rule names, support levels, units, and
  validation feedback.
- [ ] **SUPUX-TMP-007** Add accessible reorder behavior if rule order changes
  runtime meaning.

Acceptance:

- Switching template level cannot silently discard edits.
- A template with many rules remains scannable on desktop and mobile.
- The user understands resulting deadlines before save.

Current verification evidence (2026-09-05):

- The editor now keeps a tenant- and support-level-scoped draft in session
  storage, restores structurally valid unfinished input after level/route
  changes and mutation failures, and synchronously persists the current level
  before switching. Successful save and explicit Discard are the only paths
  that clear that stored draft.
- Four compact level tabs replace the previous side stack. Rules render as
  scannable summary rows with one progressively disclosed editor; the sole
  sticky Save/Discard bar names unsaved/saved state and provides the exact
  localized reason Save is disabled. Destructive rule removal uses the shared
  confirmation dialog rather than a browser prompt.
- A plain timeline sorts milestone deadlines by actual duration and summarizes
  required/optional behavior before save. Copy explicitly explains that row
  order controls display/copy order but does not alter independent deadline
  calculation. Named 44 px up/down controls provide keyboard and touch reorder
  without drag-only interaction.
- Built-in English template/rule names are presented through AZ/RU/EN locale
  labels while custom tenant names remain unchanged. Support levels, milestone
  types, severities, units, empty/read-only/loading/error/retry states and every
  validation failure are localized. The API exposes write capability and stable
  codes for active-empty, duplicate and invalid templates, so the UI does not
  infer permission or parse server prose.
- Responsive layout stacks the preview below the editor until wide desktop,
  touch targets are at least 44 px, reduced-motion fallbacks cover skeletons and
  transitions, theme tokens support light/dark, and the source contains no
  gradients, decorative palette bands, oversized headings or permanent
  six-field cards.
- Changed-source ESLint, AZ/RU/EN translation parity, `git diff --check`, a
  bounded 1.5 GB targeted TypeScript graph for the page/helper, and 117 focused
  Vitest assertions are green. Tests cover draft parsing/recovery, all blocked
  save reasons, reorder boundaries, template runtime helpers, permissions,
  stable API errors and the static responsive/accessibility/visual contract.
- TMP checkboxes remain open until authenticated browser evidence covers
  375/768/1024/1440, AZ/RU/EN, light/dark, keyboard/focus, physical touch,
  reduced motion, forced loading/empty/error/permission/recovery states,
  accessibility, performance and visual regression. No browser binary is
  installed on this Contabo host. Full local typecheck/build are NOT RUN under
  the host workload contract; GitHub CI remains mandatory before completion.

Additional recovery evidence (2026-09-06):

- `f71a46049` removes the nested dashboard `<main>`, adds explicit
  loading/ready/error and write/read-only state markers, and does not offer a
  misleading Retry for terminal 403 load failures. A draft badge now remains
  visible on every support-level tab that owns a session draft, not only on the
  currently selected tab, so switching context no longer makes protected work
  appear lost.
- The fail-closed disposable flow
  `scripts/support-ux-entitlement-templates-flow-evidence.mjs` defines six
  exact-outcome checks: keyboard load retry and terminal permission denial;
  read-only mutation suppression; compact 0/1/30-rule rendering with preview
  and no permanent editors; draft recovery across level switch and route
  reload; keyboard reorder, validation reason, confirmed delete and Discard;
  and failed-save value retention followed by retry and restoration of the
  original template description.
- The generic browser matrix now waits for the exact ready state and a rendered
  rule or empty-rules state. Changed-source ESLint, `node --check`,
  `git diff --check`, AZ/RU/EN parity (21,895 keys), the 27-file anti-pattern
  scan (0 findings), and 136 focused Vitest assertions in seven suites are
  green. Full TypeScript/browser execution is not repeated locally after the
  same worktree exhausted the default 2 GB Node heap; the host contract assigns
  those heavy gates to CI.
- Exact-SHA GitHub Actions run `34003284969` for `f71a46049` again ended in
  `startup_failure` with zero jobs created. Consequently the cross-viewport,
  cross-locale, theme, accessibility, touch, performance and visual evidence
  is still **NOT RUN**, and all SUPUX-TMP checkboxes remain open.

## 17. Workstream 10 — Skill Routing

**Status: IN PROGRESS — rollback-evidence checkpoint `768146ca3`; browser/CI gates pending**
**Route:** `/support/skill-routing`
**Primary files:** `src/app/(dashboard)/support/skill-routing/page.tsx`,
`src/components/support/agent-skills-manager.tsx`,
`src/components/support/queue-manager.tsx`, `src/components/skill-picker.tsx`

Current problem: agent skills and queue configuration are stacked without a
clear model of their relationship. Queue setup follows the long agent list even
though it can be a dependency. There is no agent search or bulk edit, and several
statuses/actions lack semantic controls and visible feedback.

Target UX: a queue-to-agent routing workspace that exposes coverage gaps and
makes the configuration order obvious.

- [ ] **SUPUX-RTE-001** Confirm the primary mental model: queue-first, agent-first,
  or role-dependent; default to queue-first for initial configuration.
- [ ] **SUPUX-RTE-002** Build a master-detail view: selected queue and eligible/
  assigned agents, or an equivalent routing map.
- [ ] **SUPUX-RTE-003** Add agent/queue search, filters, and safe bulk skill edits.
- [ ] **SUPUX-RTE-004** Add uncovered-queue and agent-without-skill summaries.
- [ ] **SUPUX-RTE-005** Use tabs or a focused step flow on small screens instead
  of stacking both managers.
- [ ] **SUPUX-RTE-006** Replace clickable badges with semantic switches/buttons
  and announce save/error state through accessible feedback.
- [ ] **SUPUX-RTE-007** Localize fallbacks, role labels, and Add actions.
- [ ] **SUPUX-RTE-008** Distinguish fetch failure from no skills/no queues.

Acceptance:

- A manager can identify an uncovered queue without inspecting every agent.
- Queue and agent configuration order is understandable on first use.
- Every skill/status change has visible success or rollback feedback.

Current verification evidence (2026-09-05):

- The surface now uses a queue-first mental model and a responsive master-detail
  workspace. Selecting a queue shows the exact active/available agents eligible
  under the same normalized skill-overlap and catch-all rules as runtime
  assignment. Mobile/tablet use explicit Queues and Agents tabs instead of
  stacking two complete managers.
- One border-separated coverage summary exposes active auto-assign queues,
  uncovered queues and active agents without skills. Queue and agent search,
  active/uncovered/availability filters and filtered empty/reset states avoid
  record-by-record inspection. Agent rows remain compact with selected-skill
  summaries; only the chosen agent mounts the complete skill picker.
- Multi-select bulk edit adds or removes selected canonical skills without
  replacing unrelated skills. The dedicated session-only tenant endpoint limits
  writes to manager/admin roles, validates every target, commits all selected
  agents in one transaction and writes per-agent old/new audit evidence. The UI
  optimistically updates but restores the complete previous list on failure.
- Queue create/edit/delete and the new semantic active switch preserve form
  input on error and expose success or rollback through polite live regions.
  API-boundary normalization trims, lowercases and deduplicates queue skills.
  Queue deletion explains current eligible-agent impact and retains recoverable
  server error feedback in the confirmation dialog.
- Read-only support/ticketing users can inspect the routing map while mutations
  remain manager/admin-only. The runtime eligible-role query now includes the
  actual support and ticketing agent roles in both matched-queue and fallback
  assignment, matching the eligibility shown in the workspace.
- All labels, role fallbacks, Add actions, queue/agent states and validation/
  recovery copy are present in AZ/RU/EN. Loading, no queues, no agents, no skills,
  no filter results, total failure, partial-source failure, permission, saving,
  success and rollback states are distinct. Controls use semantic buttons,
  checkboxes and switches with 44 px targets, accessible names, focus indicators
  and reduced-motion fallbacks. Theme tokens replace clickable colored badges,
  decorative KPI cards, gradients and oversized headings.
- Changed-source ESLint, AZ/RU/EN translation parity, `git diff --check`, a
  bounded 1.5 GB frontend TypeScript graph, and 154 focused/smoke assertions are
  green. Tests cover normalization, coverage, runtime role parity, add/remove
  preservation, RBAC, session-only atomic updates, tenant target validation,
  audit payloads, queue permissions/API behavior, navigation and static
  responsive/accessibility/visual contracts.
- RTE checkboxes remain open until authenticated browser evidence covers
  375/768/1024/1440, queue and agent datasets at operational scale, AZ/RU/EN,
  light/dark, keyboard/focus, physical touch, reduced motion, forced loading/
  empty/error/partial/permission/rollback states, accessibility, performance and
  visual regression. No browser binary is installed on this Contabo host. The
  combined API-route TypeScript graph is NOT RUN: its bounded 1.5 GB process
  exhausted the heap and the host contract forbids a larger retry. Full build
  remains delegated to GitHub CI before completion.

Additional recovery evidence (2026-09-06):

- `768146ca3` adds exact workspace/source/coverage/row/form/bulk/status markers
  and distinguishes retryable queue or agent transport failures from terminal
  403 permission denial. Terminal permission copy is localized in AZ/RU/EN and
  the unaffected half of a partial routing map remains available.
- The fail-closed disposable flow
  `scripts/support-ux-skill-routing-flow-evidence.mjs` defines six outcome
  groups: dual-source failure with keyboard recovery and terminal permission;
  one-source partial recovery; separate empty/filter states plus 50-queue and
  100-agent density; keyboard queue master-detail, mobile focused-tab behavior,
  optimistic switch rollback and disposable create/delete recovery; atomic
  two-agent skill rollback/retry with unrelated-skill preservation and fixture
  restore; and read-only suppression of all mutations.
- The generic browser matrix now waits for the exact ready state and a queue row
  or queue-empty state. Changed-source ESLint, `node --check`,
  `git diff --check`, translation parity (21,896 keys in AZ/RU/EN), the 27-file
  anti-pattern scan (0 findings), and 35 focused Vitest assertions in six suites
  are green. The first self-audit caught a selector string that accidentally
  matched the palette lint expression; it was renamed and the complete scoped
  audit passed on rerun.
- Exact-SHA GitHub Actions run `34003803339` for `768146ca3` ended in
  `startup_failure` with zero jobs created. The rendered responsive/localized/
  theme/accessibility/touch/performance/visual matrix therefore remains
  **NOT RUN**, and all SUPUX-RTE checkboxes remain open.

## 18. Workstream 11 — Agent Calendar

**Status: IN PROGRESS — recovery-evidence checkpoint `7a75e28c7`; browser/CI gates pending**
**Route:** `/support/calendar`
**Primary file:** `src/app/(dashboard)/support/calendar/page.tsx`

Current problem: 13 hourly rows at 64 px create roughly 832 px of grid before
legend and duplicated Today content. The grid enforces an 800 px minimum width,
events are click-only, details are hover-only, and the calendar uses light-only
color treatments and decorative side stripes.

Target UX: an adaptive schedule that defaults to agenda on mobile and emphasizes
current/next events rather than rendering every empty hour.

- [ ] **SUPUX-CAL-001** Add a mobile agenda as the default narrow-width view.
- [ ] **SUPUX-CAL-002** Compress empty business hours and provide navigation to
  events outside 07:00–19:00.
- [ ] **SUPUX-CAL-003** Remove duplicated Today schedule or make it a selected-day
  detail, not a second permanent calendar.
- [ ] **SUPUX-CAL-004** Replace event `div` interactions with accessible buttons
  and a detail drawer.
- [ ] **SUPUX-CAL-005** Make all hover details available on focus/touch.
- [ ] **SUPUX-CAL-006** Add accessible labels to previous/next/today controls and
  increase touch targets.
- [ ] **SUPUX-CAL-007** Replace color-only and side-stripe event styling; verify
  light/dark contrast and non-color cues.
- [ ] **SUPUX-CAL-008** Show fetch error/retry and partial-source states.

Acceptance:

- The calendar is usable at 375 px without an 800 px horizontal canvas.
- Events outside the current visual hour range remain discoverable.
- Every event can be opened by keyboard, touch, and mouse.

Current verification evidence (2026-09-05):

- The fixed 800 px, 13-hour canvas and its roughly 832 px of empty time rows are
  removed. Widths below `xl` render a seven-day selector and selected-day agenda;
  wide desktop renders a compact seven-column week board containing only actual
  work. Empty hours are therefore compressed instead of becoming scroll.
- The duplicate permanent Today card and separate legend are removed. A single
  selected-day agenda provides the detailed narrow view, while every row carries
  its own localized type icon and text. Lists reveal 20 more items at a time and
  dense desktop days expand in place after six, keeping 0/1/high-volume weeks
  readable without silently omitting records.
- Timed items before 07:00 or at/after 19:00 remain in chronological agenda/week
  order and carry a textual outside-hours cue. The next upcoming timed item is
  promoted above the calendar so current work is discoverable without scanning
  every day; all-day backlog is deliberately excluded from that appointment hook.
- Every calendar item, day, week navigation action and show-more control is a
  semantic button with an accessible name and at least a 44 px target. Mouse,
  focus and touch open the same focus-trapped, full-width-mobile detail drawer;
  status, priority, time range, outside-hours explanation, location, online mode
  and record navigation no longer depend on hover.
- Rainbow type backgrounds, priority dots, decorative side stripes and colored
  KPI cards are replaced with theme tokens plus persistent icon/text cues. The
  layout uses no gradients or oversized headings and includes reduced-motion
  fallbacks for loading and transitions. AZ/RU/EN cover type/status/priority
  fallbacks, drawer labels, source recovery, navigation and empty states.
- The aggregation API now exposes independent ticket/task/event/activity source
  health. A partial failure returns available items with the failed-source list;
  failure of all four sources returns retryable 503 code
  `CALENDAR_SOURCES_FAILED` instead of masquerading as an empty calendar. The UI
  distinguishes loading, selected-day empty, partial data, total fetch failure,
  permission denial and recovery.
- Changed-source ESLint, AZ/RU/EN translation parity, `git diff --check`, a
  bounded 1.5 GB page/helper TypeScript graph and 48 focused Vitest assertions
  are green. Tests cover local Monday/date behavior, agenda ordering,
  outside-hours boundaries, next-item selection, partial/all-source API failure,
  effect dependency regression and the static responsive/accessibility/visual
  contract.
- CAL checkboxes remain open until authenticated browser evidence covers
  375/768/1024/1440, 0/1/high-volume days, outside-hours events, AZ/RU/EN,
  light/dark, keyboard/focus return, physical touch, reduced motion, forced
  loading/empty/error/partial/permission/recovery states, accessibility,
  performance and visual regression. No browser binary is installed on this
  Contabo host. API-route TypeScript and full build are NOT RUN because the
  already demonstrated 1.5 GB backend graph limit cannot be raised under the
  host workload contract; GitHub CI remains mandatory before completion.

Additional recovery evidence (2026-09-06):

- `7a75e28c7` adds exact workspace, source-state, navigation, day, agenda,
  week-board, item, detail and expansion markers. Retry is offered for
  transport failures but intentionally suppressed for terminal 403 permission
  denial, while a recoverable partial-source state keeps available calendar
  data interactive.
- The fail-closed disposable flow
  `scripts/support-ux-agent-calendar-flow-evidence.mjs` defines six outcome
  groups: keyboard recovery from load failure plus terminal permission; partial
  source recovery; selected-day empty recovery; 30-item density with outside-
  hours discovery, next-item hook and no horizontal overflow; keyboard-opened
  detail with Escape focus return; and next-week navigation followed by Today
  recovery. The runner is strict, loopback-only, reduced-motion/touch-aware and
  uses disposable synthetic responses rather than production data.
- The generic browser matrix now waits for an exact ready state plus either a
  calendar item or selected-day empty state. Changed-source ESLint,
  `node --check`, `git diff --check`, translation parity (21,896 keys in each of
  AZ/RU/EN), the 27-file anti-pattern scan (0 findings), and 31 focused Vitest
  assertions in five suites are green. A fresh full `npx tsc --noEmit` remains
  **NOT RUN/BLOCKED** after the worktree exhausted Node's default 2 GB heap; the
  Contabo host contract forbids a heavier local retry.
- Exact-SHA GitHub Actions run `34004233845` for `7a75e28c7` ended in
  `startup_failure` with zero jobs created. Therefore the rendered viewport,
  locale, theme, keyboard/focus, touch, reduced-motion, accessibility,
  performance and visual matrix is still **NOT RUN**, and every SUPUX-CAL
  checkbox remains open.

## 19. Workstream 12 — Escalation Rules

**Status: IN PROGRESS — recovery-evidence checkpoint `a5f99035f`; browser/CI gates pending**
**Route:** `/settings/escalation`
**Primary file:** `src/app/(dashboard)/settings/escalation/page.tsx`

Current problem: rules cannot be edited or duplicated; users can only toggle or
delete them. A clickable Badge is used as a control, raw targets/`min` leak into
the UI, and no preview explains when or how the rule will fire.

Target UX: a sentence-based rule builder with timing preview, safe editing, and
conflict awareness.

- [ ] **SUPUX-ESC-001** Add edit and duplicate flows without forcing delete/recreate.
- [ ] **SUPUX-ESC-002** Express rules as localized sentences: If/when/after/then.
- [ ] **SUPUX-ESC-003** Add a timing preview relative to SLA and entitlement
  milestones.
- [ ] **SUPUX-ESC-004** Add rule ordering, test/simulation, and conflict warnings
  when runtime semantics support them.
- [ ] **SUPUX-ESC-005** Replace status Badge with an accessible switch/button and
  visible save/error feedback.
- [ ] **SUPUX-ESC-006** Localize targets, duration units, action labels, and errors.
- [ ] **SUPUX-ESC-007** Replace icon-only deletion and confirm destructive impact.

Acceptance:

- A rule can be safely modified without deleting it.
- A non-technical manager can read the rule's behavior before saving.
- Conflicting or invalid timing is blocked or explicitly warned.

Current verification evidence (2026-09-05):

- Create now shares one editor with real PATCH-based Edit and safe Duplicate.
  Duplicate pre-fills localized “copy” naming but is inactive by default, so it
  cannot silently double-fire while a manager reviews it. Input remains mounted
  after mutation failure and success is announced outside the dialog.
- Every row and draft renders a localized plain-language sentence describing
  when the trigger occurs, which action runs and at what escalation level. Raw
  `min`, enum actions and notification targets no longer leak into the UI;
  minute/hour/day controls round-trip to the worker's integer-minute contract.
- The editor includes a changeable sample SLA deadline and computes the exact
  warning-before or breach-after timestamp using the runtime direction. Copy
  explicitly states the real ordering semantics: active rules are evaluated
  L1 through L5 and every matching rule may execute; higher levels do not cancel
  lower ones.
- Exact active trigger/time/level/action/target duplicates are surfaced in the
  list and editor, disable Save and are independently rejected by POST/PATCH
  with stable `ESCALATION_RULE_CONFLICT`. Existing conflicting data remains
  inspectable/filterable so it can be repaired. Timing is bounded to a localized
  non-negative maximum of 365 days in both UI and API.
- The clickable colored status Badge is replaced by a named semantic switch.
  Toggle uses an optimistic update but restores the full previous list and
  announces the error if the server rejects it. Edit, Duplicate and Delete have
  44 px named buttons; deletion explains that future executions stop while
  prior notifications and audit history remain.
- Queue-style search and active/inactive/conflict filters sit above one compact
  responsive row list. A restrained three-part summary replaces palette KPI
  cards. Loading, empty, filtered empty/reset, fetch error/retry, permission,
  read-only, validation, simulation, conflict, saving, success and rollback
  states are distinct in AZ/RU/EN. Theme tokens, text/icons, focus indicators and
  reduced-motion fallbacks replace gradients, severity rainbow blocks and
  oversized headings.
- Escalation APIs now use ticket read/write scope with an explicit manager/admin
  mutation gate and return truthful write capability. Notification actions accept
  only manager/admin targets and all action arrays are constrained to the single
  action the current worker/editor actually supports. GET ordering is stable by
  level then creation time, matching the runtime mental model.
- Changed-source ESLint, AZ/RU/EN translation parity, `git diff --check`, a
  bounded 1.5 GB page/helper TypeScript graph and 54 focused Vitest assertions
  are green. Tests cover duration conversion, before/after simulation, exact
  conflict rules, safe duplicates, action payload shape, API RBAC/target/conflict
  validation, existing SLA worker behavior and the static responsive/
  accessibility/visual contract.
- ESC checkboxes remain open until authenticated browser evidence covers
  375/768/1024/1440, create/edit/duplicate/conflict/delete, AZ/RU/EN, light/dark,
  keyboard/focus return, physical touch, reduced motion, forced loading/empty/
  error/permission/validation/success/rollback states, accessibility,
  performance and visual regression. No browser binary is installed on this
  Contabo host. API-route TypeScript and full build remain NOT RUN under the
  already demonstrated backend heap/workload limit; GitHub CI is mandatory
  before completion.

Additional recovery evidence (2026-09-06):

- `a5f99035f` adds exact workspace, permission, loading/error/retry, summary,
  filters, empty, row, mutation-status, editor, preview and conflict markers.
  A 403 load response is now a terminal permission state without a misleading
  Retry, while transient failures retain keyboard recovery.
- The fail-closed disposable flow
  `scripts/support-ux-escalation-rules-flow-evidence.mjs` defines six outcome
  groups: transient load recovery plus terminal permission; read-only mutation
  suppression; empty/filter-empty recovery and 40-rule density without
  horizontal overflow; failed Edit retaining the complete draft followed by
  retry and dialog focus return; inactive-by-default Duplicate with an active
  conflict warning/block and safe creation; and optimistic switch rollback plus
  failed-delete dialog retention followed by successful retries. All mutation
  responses are intercepted in the ephemeral loopback browser and never reach
  production or persistent tenant data.
- The generic browser matrix now waits for the exact ready state and a rule row
  or true empty state. Changed-source ESLint, `node --check`,
  `git diff --check`, translation parity (21,896 keys in AZ/RU/EN), the 27-file
  anti-pattern scan (0 findings), and 61 focused Vitest assertions in six suites
  are green. Full TypeScript/build are **NOT RUN/BLOCKED** under the existing
  Contabo memory/workload limit rather than being retried with a larger heap.
- Exact-SHA GitHub Actions run `34004805773` for `a5f99035f` ended in
  `startup_failure` with zero jobs created. The responsive/localized/theme,
  keyboard/focus, touch, reduced-motion, accessibility, performance and visual
  browser matrix therefore remains **NOT RUN**, and all SUPUX-ESC checkboxes
  remain open.

## 20. Workstream 13 — Macros

**Status: IN PROGRESS — recovery-evidence checkpoint `13eaf2bb1`; browser/CI gates pending**
**Route:** `/settings/macros`
**Primary file:** `src/app/(dashboard)/settings/macros/page.tsx`

Current problem: the Action Builder is useful, but server responses are not
consistently checked, delete operations can lack confirmation, card/category
actions are hover-only, assignee requires free-text technical input, and macro
categories are stored locally rather than shared.

Target UX: a compact, trustworthy macro library with a readable action timeline,
safe execution/editing, and shared categories.

- [ ] **SUPUX-MAC-001** Check every fetch/mutation response and show saving,
  success, failure, and retry states.
- [ ] **SUPUX-MAC-002** Add confirm/undo for macro/category deletion and preserve
  user input after errors.
- [ ] **SUPUX-MAC-003** Replace the default two-column card gallery with a compact
  searchable list; open detail/editor on selection.
- [ ] **SUPUX-MAC-004** Move category/action overflow into accessible menus and
  reduce simultaneous peer choices.
- [ ] **SUPUX-MAC-005** Replace free-text assignee ID with a scoped agent/team
  picker.
- [ ] **SUPUX-MAC-006** Move categories to an organization-scoped server contract
  or explicitly document local-only behavior if product chooses to retain it.
- [ ] **SUPUX-MAC-007** Present actions as a readable timeline with accessible
  add, move, delete, and preview controls.
- [ ] **SUPUX-MAC-008** Preserve and document keyboard shortcuts without making
  them required for discovery.

Acceptance:

- A failed save/delete/toggle cannot appear successful.
- Categories are consistent across authorized users or clearly declared local.
- Macro actions can be created and reordered without pointer-only interaction.

Current verification evidence (2026-09-05):

- The two-column card gallery is replaced by one compact responsive list with
  name/description, first action, shortcut, usage, status and menu columns.
  Search, category and active-state filters share a single control surface with
  a restrained text summary; selection opens the same create/edit editor. Mobile
  rows retain every value without requiring horizontal scrolling.
- All settings-page reads and mutations pass through a checked response helper.
  Loading, empty, filtered-empty/reset, fetch error/retry, read-only permission,
  validation, saving, success, failure and optimistic toggle rollback states are
  explicit. A failed create/edit keeps the complete draft open. Toggle failure
  restores the exact previous list instead of leaving a false successful state.
- Macro and custom-category deletion now require an impact confirmation and are
  delayed for seven seconds before the server request. The visible Undo action
  cancels the timer without changing server data. Only a checked successful
  response removes the macro/category locally; failure leaves it available.
- Custom categories no longer use browser `localStorage`. They are stored under
  the tenant's existing organization settings JSON, merged without removing
  unrelated settings, and returned with each macro-library response. Category
  create, rename and delete use manager/admin RBAC; rename and delete update all
  affected macros in a serializable transaction, with deletion moving them to
  General. System categories cannot be renamed or deleted.
- The action editor is a numbered timeline with a single grouped add control,
  44 px named move-up, move-down and remove controls, validation beside the
  affected step, and an optional readable execution preview. Reordering works
  through ordinary keyboard-focusable buttons and does not rely on drag or a
  pointer. Action types and their value domains are server-validated.
- Free-text assignee identifiers are replaced with an active, organization-
  scoped agent picker. Stored legacy/unavailable assignees are identified and
  must be replaced before the API accepts the update. Both save and runtime
  apply verify that the selected agent is still active in the same tenant.
- Optional `Alt+1` through `Alt+9` shortcuts remain visible in the library and
  editor, conflicting shortcuts are disabled and server-rejected, and copy
  explicitly explains that shortcuts are optional because the action menu is
  always discoverable.
- Macro application on ticket detail now checks the response and exposes
  applying/success/failure feedback. All actions and the usage increment execute
  in one database transaction, so an error cannot retain a partial sequence.
  Inactive macros cannot run and no longer appear as Inbox quick replies.
- AZ/RU/EN strings are parity-checked. The implementation uses semantic theme
  tokens, text/icons and persistent focus-visible controls across light/dark;
  loading animation has a reduced-motion fallback. The old category/action
  rainbow palette, gradients, oversized headings, hover-only actions and
  decorative KPI cards are absent.
- Changed-source ESLint, `git diff --check`, AZ/RU/EN translation parity, a
  bounded 1.5 GB frontend TypeScript graph and 76 focused Vitest assertions are
  green. Tests cover RBAC, tenant assignees, inactive execution, category
  transactions, action schema constraints, search/filter/reordering helpers,
  Inbox visibility and the static responsive/accessibility/visual contract.
- MAC checkboxes remain open until authenticated browser evidence covers
  375/768/1024/1440, list/editor/category manager, create/edit/toggle/delete/undo/
  apply, AZ/RU/EN, light/dark, keyboard/focus return, physical touch, reduced
  motion, forced loading/empty/error/permission/validation/success/rollback
  states, accessibility, performance and visual regression. No browser binary
  is installed on this Contabo host. API-route TypeScript and full build remain
  NOT RUN under the demonstrated backend heap/workload limit; GitHub CI is
  mandatory before completion.

Additional recovery evidence (2026-09-06):

- `13eaf2bb1` adds exact workspace/write capability, loading/error/retry,
  read-only, filters, empty, list/row, mutation notice, editor/timeline/preview,
  shared-category manager and destructive confirmation markers. The checked
  response error now retains HTTP status, so terminal 403 permission failure no
  longer offers a misleading Retry while transport failures remain recoverable.
- The fail-closed disposable flow
  `scripts/support-ux-macros-flow-evidence.mjs` defines six outcome groups:
  keyboard load recovery plus terminal permission; read-only disabled/suppressed
  mutations; true empty and filtered-empty recovery plus 40-macro density;
  keyboard editor entry, ordered action movement, scoped assignee visibility,
  execution preview, failed-save draft retention, retry and focus return;
  optimistic toggle rollback/retry plus macro-delete confirmation, Undo, failed
  delete retention and retry; and shared-category failed-create retention/retry,
  category-delete Undo and focus return. Network mutations are intercepted in
  an ephemeral loopback browser and do not reach persistent or production data.
- The generic browser matrix now waits for the exact ready state and a macro row
  or true empty state. Changed-source ESLint, `node --check`,
  `git diff --check`, translation parity (21,896 AZ/RU/EN keys), the 27-file
  anti-pattern scan (0 findings), and 148 focused Vitest assertions in eight
  suites are green. Full TypeScript/build remain **NOT RUN/BLOCKED** by the
  documented Contabo memory/workload gate.
- Exact-SHA GitHub Actions run `34005143208` for `13eaf2bb1` ended in
  `startup_failure` with zero jobs created. Responsive/localized/theme,
  keyboard/focus, physical-touch, reduced-motion, accessibility, performance
  and visual evidence therefore remains **NOT RUN**, and every SUPUX-MAC
  checkbox remains open.

## 21. Workstream 14 — Portal Users

**Status: IN PROGRESS — recovery-evidence checkpoint `fa6143c00`; browser/CI gates pending**
**Route:** `/settings/portal-users`
**Primary file:** `src/app/(dashboard)/settings/portal-users/page.tsx`

Current problem: search requests fire per keystroke, mutations often lack
response checks/progress, row selection lacks complete labeling, and each row
shows four small color-coded icon actions. The seven-column table has no true
mobile alternative.

Target UX: a safe access-management list with debounced search, explicit status,
labelled actions, and a persistent batch workflow.

- [ ] **SUPUX-POR-001** Debounce search, cancel stale requests, and keep result
  state stable while loading.
- [ ] **SUPUX-POR-002** Check every mutation response; add progress, duplicate-click
  protection, success, and error feedback.
- [ ] **SUPUX-POR-003** Replace four row icons with an accessible labelled action
  menu while keeping frequent safe actions discoverable.
- [ ] **SUPUX-POR-004** Programmatically label select-all and row checkboxes.
- [ ] **SUPUX-POR-005** Define selection behavior when filters/pages change and
  show scope in a sticky bulk toolbar.
- [ ] **SUPUX-POR-006** Add confirmation/impact copy for bulk disable and other
  risky access changes.
- [ ] **SUPUX-POR-007** Add a responsive portal-user card/list representation.
- [ ] **SUPUX-POR-008** Remove duplicated description/help copy and preserve the
  useful contact-creation empty-state CTA.
- [ ] **SUPUX-POR-009** Re-baseline the page after the September portal-user and
  recovery-password changes; verify recovery initiation, temporary state,
  expiry, copy, permission, and audit feedback rather than assuming the August
  findings are still complete.

Acceptance:

- No access mutation can fail silently or be submitted repeatedly while pending.
- Batch scope remains explicit across filter/page changes.
- All selection and row actions work at 375 px and by keyboard.

Current verification evidence (2026-09-05):

- Search input now commits after a 350 ms debounce. Every result request owns an
  `AbortController`, so a later filter/search aborts stale work. The existing
  list stays mounted with a quiet updating label during background refresh;
  initial loading, filtered/no-contact empty states, permission/load failure and
  Retry remain distinct.
- Selection is explicitly limited to the currently visible result set. Search
  and filter commits clear it, the API states when only the first bounded set is
  shown, and a sticky bulk toolbar repeats both selected count and scope. Native
  select-all and row checkboxes have programmatic names and indeterminate state
  on desktop and mobile.
- The seven-column overflow table now has a separate 375 px card/list surface;
  desktop retains a compact table. Name/email, company, portal/recovery state,
  last login, selection, the frequent named Enable/Disable action and overflow
  menu remain available without horizontal scrolling. All interactive targets
  are at least 44 px and work through normal keyboard focus.
- The old row of small colored icon actions is replaced by one labelled menu for
  Edit, setup/reset link, manual password, clear chat and portal removal. Access
  enable/disable remains a persistent named control. Semantic tokens and
  text/icons replace the prior palette styling, decorative stat cards and
  oversized title.
- Every mutation uses one checked response helper and operation-specific pending
  guards. Single disable, bulk disable, chat deletion, portal removal and link
  issuance have consequence confirmation. Failed operations keep dialogs,
  drafts and selections available and cannot be reported as successful or
  double-submitted.
- The September recovery contract is surfaced rather than assumed: the UI
  distinguishes setup pending, registered, recovery-link active and link-expired
  states, renders the exact expiry, and explains resend recovery. The shared
  one-time-link service now returns its precise 24-hour expiry and localizes
  email subject/body for contact preferred language AZ/RU/EN; only the digest is
  persisted and a definite provider rejection restores the previous link.
- Manual password remains an acknowledged fallback with policy, mismatch,
  saving and failure states; no password is revealed after saving. Email changes
  state that credentials/sessions are revoked and attempt a new setup link while
  reporting separately if profile save succeeds but delivery fails.
- Direct GET/PATCH remain admin/superadmin gated. An inactive CRM contact cannot
  receive portal access individually or through bulk enable. Disable revokes
  password, sessions, active recovery token and last-login state. Portal removal
  combines chat deletion and access revocation in a database transaction while
  preserving the CRM contact and tickets.
- Audit events include organization, actor user, action, target/scope and action
  details. The API returns the real `auditRecorded` outcome; the UI distinguishes
  a successful access mutation with confirmed audit from an access mutation
  whose secondary audit write needs administrator attention.
- Header help copy is no longer duplicated; the useful no-contact explanation
  and link to contact creation are preserved. AZ/RU/EN UI strings and recovery
  states are parity-checked, theme tokens cover light/dark, and loading motion has
  a reduced-motion fallback.
- Changed-source ESLint, `git diff --check`, AZ/RU/EN translation parity, a
  bounded 1.5 GB frontend TypeScript graph and 35 focused Vitest assertions are
  green. Tests cover admin gating, bulk/individual eligibility, truthful audit
  failure, atomic removal calls, recovery expiry/digest/rollback/localization,
  access-state classification, scoped selection and the static responsive/
  keyboard/touch/state/visual contract.
- POR checkboxes remain open until authenticated browser evidence covers
  375/768/1024/1440, desktop table/mobile cards, debounce/abort, selection and
  bulk scope, every dialog/mutation, recovery active/expired/delivery failure,
  AZ/RU/EN, light/dark, keyboard/focus return, physical touch, reduced motion,
  forced loading/empty/error/permission/success/rollback states, accessibility,
  performance and visual regression. No browser binary is installed on this
  Contabo host. API-route TypeScript and full build remain NOT RUN under the
  demonstrated backend heap/workload limit; GitHub CI is mandatory before
  completion.

Additional recovery evidence (2026-09-06):

- `fa6143c00` adds exact workspace/refresh, HTTP retryability, controls/scope,
  loading/error/retry, true/filtered empty, desktop table/mobile list,
  row/card access state, selection, menu/action, bulk toolbar, edit and manual-
  password markers. Checked responses now retain HTTP status; a terminal 403 or
  explicit admin denial has no misleading Retry, while transport failure keeps
  keyboard recovery.
- The fail-closed disposable flow
  `scripts/support-ux-portal-users-flow-evidence.mjs` defines seven outcome
  groups: load recovery plus terminal permission; true empty, all six access/
  recovery states and 36-contact responsive density; 350 ms committed search,
  stale-request abort and selection clearing; confirmed bulk disable with
  duplicate-submit protection, failed-selection retention and retry; failed
  recovery issuance, retry, exact active-expiry rendering and truthful audit-
  failure feedback; edit draft recovery plus password mismatch,
  acknowledgement, server-failure retention and retry; and failed/retried
  single disable with confirmed chat clearing and portal removal. All mutation
  responses are intercepted on an ephemeral loopback target.
- The generic browser matrix now waits for an exact ready state and a table row,
  mobile card or true empty state. Changed-source ESLint, `node --check`,
  `git diff --check`, translation parity (21,896 keys in AZ/RU/EN), the 27-file
  anti-pattern scan (0 findings), and 51 focused Vitest assertions in seven
  suites are green. Full TypeScript/build remain **NOT RUN/BLOCKED** by the
  documented Contabo memory/workload gate.
- Exact-SHA GitHub Actions run `34005586339` for `fa6143c00` ended in
  `startup_failure` with zero jobs created. Responsive/localized/theme,
  keyboard/focus, physical-touch, reduced-motion, accessibility, performance
  and visual evidence therefore remains **NOT RUN**, and every SUPUX-POR
  checkbox remains open.

## 21A. Workstream 15 — Support AI Settings

**Status: IN PROGRESS — recovery-evidence checkpoint `99fec139c`; browser/CI gates pending**
**Route:** `/support/ai-settings`
**Primary file:** `src/app/(dashboard)/support/ai-settings/page.tsx`

Current problem: this page was added after the original 14-section audit. It
correctly exposes a module-wide switch, but its coverage is explained through a
generic three-card grid and it needs full validation of consequences,
permissions, cross-module isolation, recovery, and mobile behavior.

Target UX: a trustworthy Support control that tells an administrator exactly
what will stop or resume, what remains unaffected, who can change it, and
whether the saved organization state is currently active.

- [ ] **SUPUX-AI-001** Verify AI add-on and admin/superadmin gating in navigation,
  direct route, settings API, and every affected Support endpoint/background job.
- [ ] **SUPUX-AI-002** Replace the generic coverage-card grid with a compact
  consequence map grouped by Tickets, Complaints, Portal Chat, WhatsApp Support,
  and background Support actions.
- [ ] **SUPUX-AI-003** State explicitly which non-Support AI capabilities remain
  unaffected, especially Omnichannel and shared knowledge configuration.
- [ ] **SUPUX-AI-004** Explain immediate versus next-job effects before disable;
  require confirmation only when the consequence is material and not obvious.
- [ ] **SUPUX-AI-005** Preserve server truth during save, prevent duplicate
  toggles, roll back failed optimistic state, and expose retry for load failure.
- [ ] **SUPUX-AI-006** Record and display an auditable change event with actor,
  organization, previous state, new state, and timestamp if the platform audit
  contract supports it.
- [ ] **SUPUX-AI-007** Verify localized AZ/RU/EN copy, switch semantics, focus,
  screen-reader announcements, dark theme, and 375 px behavior.
- [ ] **SUPUX-AI-008** Add cross-module regression tests proving the switch stops
  only Support AI execution and never disables manual support work.

Acceptance:

- An authorized administrator understands the operational consequence before
  changing the switch and receives truthful saved/failed feedback.
- An unauthorized or unlicensed user cannot reach or mutate the setting directly.
- Manual Support workflows and Omnichannel AI remain unaffected when Support AI
  is disabled.

Current verification evidence (2026-09-05):

- The page is now a server-gated route. Anonymous users are redirected to login;
  non-admin roles and organizations without both Support and AI grants are
  redirected before client markup is rendered. The read projection and shared
  feature mutation independently repeat role and entitlement checks, while the
  sidebar retains its `ai` add-on plus admin/superadmin gates.
- The existing audited organization-feature endpoint used by Omnichannel remains
  the single mutation path; no second flag store or toggle implementation was
  introduced. Support-specific authorization was added only when the requested
  flag is `supportAiDisabled`, and atomic writes preserve unrelated values such
  as `aiAutoReply`.
- The generic three-card grid is replaced by a compact five-row consequence map
  for Tickets, Complaints, Portal Chat, WhatsApp Support and background Support
  work. Rows distinguish immediate effects from the next background-job run;
  disabling opens a focused consequence confirmation, while the safe enable
  action remains direct.
- Manual ticket/complaint work is stated as continuously available. A separate
  unaffected block explicitly preserves Omnichannel settings/replies, shared
  knowledge configuration, Sales AI and other module AI.
- Initial load is abortable and has a labelled skeleton plus a visible error and
  Retry surface. Save disables duplicate interaction, applies an optimistic
  state, derives authoritative state from the mutation response, verifies it
  through a fresh projection and rolls back only when the mutation itself
  fails. A failed secondary audit refresh no longer overwrites already-saved
  server truth.
- Real audit evidence is persisted for state-changing saves and rendered with
  actor, organization, previous/new Support AI state and timestamp. Idempotent
  retries do not create duplicate audit entries; older audit rows without state
  payload render a truthful generic change rather than invented values.
- The compact surface uses semantic theme tokens only, no cards, gradients,
  colored decoration or oversized typography. Responsive rows collapse without
  horizontal scroll, the confirmation actions become full-width at 375 px,
  touch targets are at least 44 px, dialog focus is trapped/restored by the
  shared primitive, the switch has a visible focus ring and programmatic hint,
  status changes use a polite live region, and loading/switch motion has a
  reduced-motion fallback.
- All Support-owned model entry points are fenced: ticket assistance and
  categorization, complaint categorization/background enrichment, Portal Chat,
  Support-owned WhatsApp replies, creation of Support background actions and
  execution of queued Support actions. Static execution-boundary checks pin
  those gates while also pinning that ticket/complaint/portal manual routes and
  Omnichannel execution files do not depend on the Support flag.
- Changed-source ESLint, `git diff --check`, AZ/RU/EN translation parity and 208
  focused Vitest assertions are green. Tests cover navigation, direct-route,
  read/mutation role and entitlement denial, legacy enabled default, audit
  projection, idempotency, server-side Support execution fences, manual ticket
  replies while disabled, Omnichannel-flag preservation, and the responsive/
  keyboard/touch/reduced-motion/state/visual contract.
- The bounded 1.5 GB source TypeScript graph was attempted and reached its heap
  ceiling, so it remains NOT RUN rather than green. AI checkboxes remain open
  until GitHub CI and authenticated browser evidence cover 375/768/1024/1440,
  AZ/RU/EN, light/dark, keyboard focus and dialog return, physical touch,
  reduced motion, forced load/save/audit failures and rollback, accessibility,
  performance and visual regression. No browser binary is installed on this
  Contabo host; full build/browser E2E are prohibited here by the host contract.

Additional recovery evidence (2026-09-06):

- `99fec139c` adds exact loading/error/retry, workspace/save/enabled state,
  persistent mutation notice/Retry, consequence, unaffected, audit and disable-
  dialog markers. Terminal 403 projection failures no longer show a misleading
  Retry. Save failure is no longer communicated only by a transient toast: the
  inline polite status retains the intended target and offers a stable retry
  while the existing Omnichannel feature API remains the sole mutation path.
- The fail-closed disposable flow
  `scripts/support-ux-ai-settings-flow-evidence.mjs` defines five outcome
  groups: transient load recovery plus terminal API permission; the five compact
  immediate/next-job consequence rows, unaffected capabilities and audit-empty
  state; keyboard disable confirmation, pending lock, failed mutation rollback,
  dialog focus return and retry; a successful authoritative mutation surviving
  secondary audit-refresh failure; and direct safe enable with recorded actor,
  organization and timestamp. Only intercepted ephemeral loopback responses are
  mutated.
- The generic matrix now waits for the exact ready state and master switch.
  Changed-source ESLint, `node --check`, `git diff --check`, translation parity
  (21,896 keys in AZ/RU/EN), the 27-file anti-pattern scan (0 findings), and 242
  focused cross-module Vitest assertions in 17 suites are green. Those tests pin
  Support execution gates while proving manual Support and Omnichannel paths do
  not depend on the Support-only flag. Full TypeScript/build remain
  **NOT RUN/BLOCKED** by the documented Contabo memory/workload gate.
- Exact-SHA GitHub Actions run `34005866169` for `99fec139c` ended in
  `startup_failure` with zero jobs created. Responsive/localized/theme,
  keyboard/focus, physical-touch, reduced-motion, accessibility, performance
  and visual evidence therefore remains **NOT RUN**, and every SUPUX-AI
  checkbox remains open.

## 21B. Cross-surface Track — Customer Support Portal

**Status: IN PROGRESS — implementation and fail-closed evidence runner verified;
browser/CI gates blocked before job creation**
**Routes:** `/portal/tickets`, `/portal/tickets/[id]`,
`/portal/knowledge-base`, `/portal/chat`, `/ticket-closure/[token]`

The internal Support UX is incomplete if customer-facing status, replies,
knowledge, chat, or closure contradict the agent workspace. This track does not
redesign the whole portal; it verifies and repairs only Support continuity.

- [ ] **SUPUX-CXP-001** Map the customer journey from creating a ticket through
  reply, attachment, status tracking, closure request, confirmation, and reopen.
- [ ] **SUPUX-CXP-002** Keep customer and agent status/SLA language consistent
  without exposing internal-only metadata or actions.
- [ ] **SUPUX-CXP-003** Verify drafts, upload/send progress, duplicate-submit
  protection, errors, offline recovery, and mobile keyboard behavior.
- [ ] **SUPUX-CXP-004** Verify portal knowledge visibility matches article
  publication/access settings in the internal Knowledge Base.
- [ ] **SUPUX-CXP-005** Verify Portal Chat communicates Support AI disabled,
  unavailable, handoff, and manual fallback states truthfully.
- [ ] **SUPUX-CXP-006** Test isolation and direct-route authorization for portal
  users across tickets, articles, attachments, and closure tokens.

Acceptance:

- The same case has compatible status and conversation meaning internally and in
  the customer portal.
- AI unavailability never blocks a customer from reaching a manual support path.
- A portal user cannot discover another tenant's or contact's Support data.

Current verification evidence (2026-09-05):

- The customer continuity map now fixes one journey from device-persisted ticket
  creation through owned-ticket tracking, public reply, validated attachment,
  resolution/CSAT, opaque-token closure confirmation and atomic reopen. It
  records actor, route, visible states, recovery behavior, safe projection and
  isolation boundaries in docs/support-customer-portal-journey.md.
- Ticket list/detail expose the same localized lifecycle vocabulary as the
  internal Support calendar and only the next customer-relevant SLA target.
  Priority, requester snapshots, assignee/queue, internal policy/escalation and
  internal comments/files are absent from the public projection. Known category
  slugs use AZ/RU/EN labels while tenant-defined category names remain intact.
- New-ticket and reply drafts persist for seven days with stable client request
  IDs. Comment retries are uniquely deduplicated; attachment binding and
  terminal-ticket reopen commit in one transaction. Upload shows actual byte
  percentage, validates MIME/extension/content/size, reconciles draft IDs after
  reload, supports safe deletion and serves files only through a private,
  no-store, non-sniffable, sandboxed owned-ticket route. Send/CSAT errors retain
  recoverable input and duplicate-submit controls lock active mutations.
- Portal Chat now distinguishes checking, enabled, disabled, configuration
  unavailable, offline, provider-degraded and agent-handoff states. Every
  unavailable/degraded path retains a 44 px manual Support action and carries
  the unsent request into the new-ticket draft. The shared Support AI flag gates
  only automation; manual ticket creation/reply remains available.
- Closure no longer defaults an empty POST to confirmation. The localized page
  distinguishes pending/confirmed/rejected/expired/canceled outcomes, locks
  duplicate actions and preserves retry after load/save failure. The 256-bit
  token remains hash-only: bypass resolves only the organization and the
  request is re-queried and mutated inside that tenant.
- Direct-route tests prove organization/contact predicates before ticket/file
  metadata access, public-comment versus own-draft attachment visibility,
  published-only tenant Knowledge Base reads, closure tenant re-entry, atomic
  attachment/reopen behavior and idempotent reply replay. Loading, empty,
  filtered-empty, error/retry, offline, permission loading, upload/send/rating,
  disabled/unavailable/degraded and closure recovery states are distinct.
- Source-level technical audit is provisionally 18/20: Accessibility 3,
  Performance 3, Responsive 4, Theming 4 and Anti-patterns 4. AZ/RU/EN have no
  hard-coded UI copy; semantic theme tokens cover light/dark; all primary
  targets are at least 44 px; native labels/radios, focus rings, keyboard
  shortcuts and reduced-motion fallbacks are present. The scoped scan finds no
  gradients, AI palette, colored side stripes, oversized headings or decorative
  Card components.
- Changed-source ESLint, AZ/RU/EN translation parity, git diff --check, the
  bounded 1.5 GB UI/helper TypeScript graph and 200 focused Vitest assertions
  are green. The combined and ticket-route TypeScript graphs are NOT RUN: both
  reached the 1.5 GB heap ceiling, and the host contract forbids a heavier
  retry. The code is covered by route regressions but GitHub CI remains
  mandatory.
- CXP checkboxes remain open because authenticated browser evidence for
  375/768/1024/1440, AZ/RU/EN, light/dark, keyboard focus order, physical touch,
  reduced motion, forced network/permission/recovery states, accessibility,
  measured performance and visual regression is NOT RUN. This Contabo host has
  no browser binary, so the section is not claimed 100% complete and cannot
  trigger PR/merge/deployment yet.

Additional recovery evidence (2026-09-06):

- `737dc6427` adds stable loading/error/refreshing/ready, online/offline,
  empty/filtered-empty, draft/mutation, upload, chat-availability, handoff and
  closure-outcome selectors across the ticket list, ticket detail, Portal Chat
  and opaque-token closure page. The generic browser matrix now waits for the
  exact customer workspace and primary-work selectors rather than timing the
  pages from a generic document-ready signal.
- The fail-closed disposable runner
  `scripts/support-ux-customer-portal-flow-evidence.mjs` defines six customer
  outcome groups: list failure plus keyboard recovery, filtering, retained
  create draft and offline lock; detail failure recovery, draft attachment,
  failed reply retention and terminal-ticket reopen; AI configuration
  unavailable/disabled plus manual ticket access; offline chat draft, failed
  send retry, degraded manual fallback and escalation ticket link; closure load
  and save recovery plus confirmed/rejected/expired/canceled outcomes; and an
  unauthenticated direct-route redirect plus denied invalid ticket. It refuses
  non-ephemeral/non-loopback targets and binds its report to the exact commit
  and named demo tenant.
- Changed-source ESLint, both evidence-script syntax checks, `git diff --check`,
  translation parity (21,896 keys in AZ/RU/EN), the 27-file anti-pattern scan
  (0 findings), and 94 focused portal/auth/API/presentation/evidence assertions
  in 9 suites are green. Full TypeScript/build/browser execution remains
  **NOT RUN/BLOCKED** by the documented Contabo workload gate.
- Exact-SHA GitHub Actions run `34006478273` for `737dc6427` selected all five
  customer Support routes on the disposable tenant, but ended in
  `startup_failure` with zero jobs created. No screenshot, accessibility,
  performance, physical-touch, responsive/theme/locale or visual-regression
  artifact exists from that run; all SUPUX-CXP checkboxes therefore remain
  open and no PR, merge or deployment is authorized by this checkpoint.
- Checkpoint `13613d74a` prevents unknown tenant-defined/missing categories from
  exposing raw category slugs in the portal ticket list or detail; the
  customer-visible fallback is localized in AZ/RU/EN. Its portal continuity
  slice passes 19 assertions across four suites and the 44-file scan remains
  at zero findings; rendered matrices remain pending.

## 21C. Evidence, Performance, and Rollout Track

**Status: IN PROGRESS — source/evidence contracts green; GitHub browser jobs
blocked before startup; rollout stays prohibited**

### Evidence tasks

- [ ] **SUPUX-EVD-001** Capture authenticated baselines for every destination and
  nested primary flow at 1440, 1024, 768, and 375 px in light and dark themes.
- [ ] **SUPUX-EVD-002** Store evidence under a dated, non-secret Support evidence
  index with route, role, feature/add-on state, viewport, data volume, and commit.
- [ ] **SUPUX-EVD-003** Record block count, vertical distance to primary work,
  horizontal overflow, immediately visible actions, and primary-flow clicks.
- [ ] **SUPUX-EVD-004** Run agent, manager, and administrator scenarios against
  empty, typical, and high-volume fixtures; record errors and context switches.
- [ ] **SUPUX-EVD-005** Re-run the deterministic anti-pattern scan and automated
  accessibility checks on every changed surface, reviewing false positives.
- [ ] **SUPUX-EVD-006** Add screenshot/visual-regression coverage for the shared
  Support shell and one representative state per section at desktop and mobile.

### Performance tasks

- [ ] **SUPUX-PERF-001** Measure current p50/p75 list load, filter feedback,
  interaction latency, layout shift, and rendered row/card count before setting
  absolute budgets.
- [ ] **SUPUX-PERF-002** Require no material regression from the measured baseline
  and define an explicit exception process for data-contract improvements.
- [ ] **SUPUX-PERF-003** Debounce remote search, cancel stale requests, and verify
  that typing does not produce one request per raw keystroke.
- [ ] **SUPUX-PERF-004** Test 0, 5, 50, 500, and section-specific high-volume
  states; introduce pagination or virtualization only where measurement supports it.
- [ ] **SUPUX-PERF-005** Prevent heavy charts, recordings, editors, and secondary
  detail from loading before they are visible or requested.

### Rollout tasks

- [ ] **SUPUX-ROL-001** Keep each page redesign independently releasable and
  rollbackable; never ship the full module as one indivisible change.
- [ ] **SUPUX-ROL-002** Use a tenant-scoped canary/feature flag for high-risk
  navigation, shared-shell, data-contract, entitlement, macro, and access changes.
- [ ] **SUPUX-ROL-003** Define old/new state compatibility and rollback behavior
  before any API or persisted preference change.
- [ ] **SUPUX-ROL-004** Run permission, tenant-isolation, feature/add-on, and
  direct-route regression before enabling each canary.
- [ ] **SUPUX-ROL-005** Record production revision, smoke evidence, observed
  metrics, owner, and rollback decision for every released slice.
- [ ] **SUPUX-ROL-006** Remove a flag only after representative tenants pass the
  agreed observation window with no unresolved P0/P1 regression.

Current verification evidence (2026-09-05):

- Checkpoint `1624cd66f` adds a fail-closed, SHA-bound browser evidence runner and
  manual GitHub Actions workflow. It requires secret-managed demo credentials,
  the expected non-production host and organization marker before capture; it
  never embeds secrets in the dated index or artifact. The route inventory
  covers all Support destinations plus ticket, complaint and portal nested
  flows for agent, manager, administrator and customer roles.
- Hardening checkpoint `4c485cb47` rejects unknown or empty matrix selections,
  samples keyboard tab order, records actual locale, color-scheme,
  reduced-motion and touch-capability state, and makes every blocked or empty
  result fail the workflow. Missing credentials or fixture IDs can no longer be
  mistaken for a green evidence run.
- Checkpoint `525a48c92` adds a deterministic fail-closed scan over 27 visible
  internal and customer Support TSX files. It currently reports zero generic
  AI-palette/gradient, decorative colored-side-strip, oversized-heading,
  blocking browser-dialog or missing reduced-motion findings. The same
  checkpoint repairs the previously uncovered Service Desk skeleton and
  Service Desk/Knowledge Base transition fallbacks. The static scan does not
  replace the pending automated browser accessibility pass.
- Checkpoint `84a19b371` wires `axe-core` into every authenticated page capture
  with WCAG 2/2.1 A/AA tags. Violation impact, help, selector and failure
  summaries are retained in the private artifact and any violation fails its
  scenario. The scanner is source-verified but remains NOT RUN without the
  browser/demo matrix.
- Checkpoint `adbbf0c8e` makes runner syntax, translation parity, scoped ESLint,
  the 27-file anti-pattern scan and evidence/performance contract tests blocking
  preflight steps before the workflow downloads Chromium or opens a session.
- Checkpoints `efa4775d6` and `165ee765d` add exact scenario selection and scope
  the 44 px failure gate to actual touch contexts while retaining raw desktop
  target measurements. Checkpoints `269f1e032`, `4f82d9896` and `10f37b74e`
  add a genuine empty ticket-list profile, actionable unassigned fixtures and
  disposable Service Desk mutation evidence without weakening the read-only
  cross-module capture.
- Checkpoint `fc8d7017d` completes the workflow path for visual regression:
  capture and compare are explicit modes; compare requires an exact prior run
  ID and artifact name, downloads it with read-only Actions permission, and
  fails when a same-matrix baseline is missing or changed. A first capture can
  no longer be confused with a successful comparison.
- Checkpoint `dcbb71f5e` replaces brittle whole-file PNG equality with a
  dimension-sensitive pixel comparison. It records changed-pixel ratio, mean
  channel delta, thresholds and both file hashes; it tolerates at most 0.5% of
  pixels beyond a 24-channel delta so volatile update-time text does not create
  false failures while material layout/style changes remain blocking. Three
  behavioral tests prove tolerated micro-regions, rejected material changes and
  rejected dimension changes. A capture/compare Actions pair is still required
  before EVD-006 can close.
- The runner expands the required AZ/RU/EN, light/dark, reduced-motion and exact
  1440/1024/768/375 matrices. Separate empty/typical/high and 0/5/50/500 fixture
  runs record route, role, feature context, viewport, theme, locale, data
  profile and commit. Missing fixture identifiers are reported as blocked, not
  silently skipped.
- Each result records document/viewport size, horizontal overflow, top distance
  to primary work, top-level block count, first-viewport actions, rendered rows
  and bordered containers, declared primary-flow click target, browser/HTTP
  errors, semantic accessibility findings, three-sample load p50/p75, filter
  feedback p50/p75, Event Timing p75 and cumulative layout shift. Screenshots
  are hash-compared when a same-matrix baseline directory is supplied; any
  overflow, accessibility issue, browser error or changed baseline fails the
  run for manual review.
- The performance contract defines comparable-matrix relative gates and an
  explicit, owned and expiring data-contract exception. Recordings remain
  `preload="none"`; large lists are server-bounded or paginated; secondary
  editors/details are conditionally mounted. The Complaint Registry now joins
  the existing debounced remote lists in aborting stale requests rather than
  allowing an older response to overwrite the newest filter state.
- The rollback ledger names every implementation and audit checkpoint. It
  defines additive API/draft compatibility, independent revert boundaries,
  canary admission order, immutable release evidence, post-deploy smoke and a
  separate observation-gated flag-removal release. It explicitly marks the
  current branch **NOT READY** for production because a reversible tenant-scoped
  old/new renderer is not yet present for every high-risk surface.
- Changed-source ESLint, browser-runner syntax, translation parity,
  deterministic 27-file anti-pattern scan and `git diff --check` are green.
  Fifteen scoped Support UX contract files passed
  111 assertions; ten state, permission, tenant/API and performance files
  passed another 71 assertions. A broader shell glob also selected an unrelated
  MTM pharmacy contract and exposed one pre-existing failure outside this
  workstream; that result is not counted as Support evidence and its source was
  not modified.
- EVD/PERF/ROL checkboxes remain open. Browser/demo prerequisites are now
  available in isolated GitHub CI, but run `33949384734` was cancelled during
  capture and produced no artifact; authenticated screenshots, accessibility,
  measured 0/5/50/500 performance, visual comparison and mutation-flow evidence
  therefore remain NOT RUN. Full typecheck/build remain delegated to GitHub CI
  under the host workload contract. Production use and deployment are
  explicitly prohibited for this evidence program.

Additional recovery evidence (2026-09-06):

- Checkpoints `67ac05996` and `b962df702` turn the relative performance policy
  into an executable same-matrix gate. Compare mode now requires baseline
  `evidence.json` for the same scenario, role, locale, theme, viewport and data
  profile; it rejects regressions in load p75, filter p50, interaction p75,
  primary-work position, rendered rows, rounded/bordered container density and
  cumulative layout shift. Behavioral tests cover boundary allowances,
  multi-metric regression and missing-baseline failure.
- `docs/support-evidence/2026-09-06/index.md` is the current non-secret
  28-scenario inventory and execution ledger. It distinguishes the earlier
  limited Service Desk evidence from every replacement matrix that remains
  NOT RUN, and links the per-slice rollback boundaries without claiming source
  tests as rendered proof.
- Read-only GitHub inspection found Actions enabled and the required labeled
  self-hosted runner online/idle. Nevertheless, the latest exact-SHA manual
  runs `34002943562` through `34007060091` all ended in `startup_failure` with
  zero jobs, and feature-branch push run `34007370733` failed the same way.
  No screenshot, WCAG, complete responsive/locale/theme, measured current-SHA
  performance or visual-comparison artifact exists from those runs.
- Production, main merge, canary enablement and release-ledger completion remain
  prohibited. EVD/PERF/ROL boxes stay open until the complete authenticated
  matrix runs, an accepted baseline comparison exists, the canary/flag-off
  contract is proven where required, and real release ownership/evidence is
  recorded.
- Checkpoint `18659282b` source audit passed 911 assertions across non-overlapping
  evidence, UX/state/presentation, API/permission/isolation, shared-component
  and system-recovery groups. Node syntax passed for every Support evidence
  script; scoped evidence ESLint, AZ/RU/EN parity (21,900 keys), deterministic
  anti-pattern scan (27 visible TSX files, 0 findings), and `git diff --check`
  are green. Changed-source lint has zero new errors: five legacy API test files
  retain their `origin/main` `no-explicit-any` debt and the global header retains
  two pre-existing `next/image` warnings. Newly introduced mock lint debt was
  removed in `18659282b` and its 36-test suite rerun green.
- The later shell/component checkpoints through `97ddbb486` add 7/7 shell tests
  and a 36/36 component slice; targeted ESLint is warning-free, AZ/RU/EN parity
  is 21,905 keys, and the expanded 44-file scan has zero findings. The complete
  911-assertion grouping has not been re-labelled as rerun by these targeted
  checks.
- Final push run `34008042739` for `18659282b` again ended in
  `startup_failure`; its workflow has zero jobs and its GitHub Actions check
  suite has zero check runs. Full typecheck/build remain NOT RUN under the
  existing host workload constraint. Therefore the plan still has 184 open and
  7 evidence-backed completed `SUPUX-*` tasks, and the Definition of Done has
  not been reached.
- Navigation-only manual retry `34008168984` on audited SHA `79e686698` also
  ended in `startup_failure` with zero jobs. This final exact-SHA retry did not
  reach checkout or execute any product/evidence command.
- Later feature push run `34018087890` on `77974079f` repeats the same immediate
  `startup_failure`; GitHub again created no executable product gate. It does
  not change the pending browser/build/PR status.
- Current feature push run `34018487664` on `c82f7439a` also ended in immediate
  `startup_failure` with no workflow name or executable job. The 964-assertion
  source re-audit is therefore not a substitute for the required authenticated
  browser, full typecheck or production-build gates.
- Push runs `34020295731` through `34021517618`, ending on source checkpoint
  `f57df6135`, repeat the same immediate `startup_failure` with blank workflow
  names and zero executable jobs. The later 961-assertion source re-audit,
  21,939-key locale parity and 44-file scan therefore remain source evidence
  only; they do not close any rendered, build or release checkbox.
- Push runs `34022415208` and `34022582918` for the AI overlay/search checkpoints
  failed at startup with zero jobs. Commits through `a959654ef` are present on
  the feature branch in origin, but GitHub has created no newer run record. The
  current 1,115-assertion source audit, 21,956-key locale parity and 46-file
  scan therefore do not close build, browser, performance, comparison or
  rollout tasks.

GitHub return evidence (2026-09-12):

- The Azure delivery experiment is no longer the release route. Recovery work
  starts from the last GitHub evidence SHA `32e523ac7`, merges current GitHub
  `main` `809f5dd05`, and deliberately excludes the Azure-only merge history.
  The resulting GitHub checkpoint is `a64a8f6bb`; the preserved Azure worktree
  and its untracked `tmp/` remain untouched.
- The two merge conflicts were resolved without dropping either product
  contract: dashboard hero visibility still suppresses only the duplicate
  assistant entry point, while every internal Support route retains the compact
  search treatment. The stale MTM identity-key assertion and compact-search
  assertion were narrowed to their behavioral contracts rather than bypassed.
- Four merge-sensitive contract files passed 37/37 assertions. The wider
  Support source suite passed 36/36 files and 183/183 assertions; targeted
  ESLint is warning-free, AZ/RU/EN parity is 22,060 keys, and the deterministic
  anti-pattern scan covers 46 visible TSX files with zero findings.
- Checksummed Gitleaks 8.30.1 scanned 256 commits and approximately 2.35 MB
  against GitHub `main` with no leaks. The public `rolling_30_days` enum is
  allowlisted through three independent exact-value, one-path rules. `git diff
  --check origin/main...HEAD` is green.
- The customer-portal API TypeScript graph reached the default 2 GB V8 heap
  ceiling on the Contabo inspection host. It remains **NOT RUN**, not green;
  the heap is not raised locally because full type/build proof belongs on the
  isolated CI worker.
- Product PR `#1168` is open and mergeable on exact head `a64a8f6bb`. Repository
  Actions were restored and the labeled builder is online, but the first
  synchronize/ready event (`34686657667`) still ended in `startup_failure` with
  zero jobs or check runs. Actionlint 1.7.12 found no workflow syntax errors
  (only the expected custom-runner-label notices), so account-level GitHub
  Actions admission remains the external blocker. No SUPUX checkbox is closed
  by this source-only recovery.

## 22. Recommended Implementation Order

### Phase A — Canonical plan, product confirmation, and evidence

- Rebase this document onto a clean current `main` documentation branch and
  create the canonical epic/slice issues; do not merge the current local branch
  wholesale.
- Confirm Support user roles, role priorities, and the three navigation groups.
- Confirm the Support design brief: calm, operational, human.
- Complete `SUPUX-EVD-*` authenticated baselines and evidence indexing.
- Record representative data volumes, primary-flow clicks, and scroll distance
  for every section and nested flow.
- Define authoritative metric contracts for Agent Desktop and VoIP.

### Phase B — Reference vertical slice

- Implement Service Desk list plus Ticket Detail as one end-to-end slice.
- Introduce only the Support-scoped shell, toolbar, state, and responsive patterns
  required by that slice.
- Validate the queue-to-reply scenario with agent, manager, keyboard, mobile,
  light/dark, failure, permission, and representative-volume evidence.
- Release behind the agreed tenant canary and prove rollback before extraction.

### Phase C — Extract and prove the shared foundation

- Extract validated patterns from the reference slice into opt-in Support
  components; do not modify global shared components by default.
- Implement `SUPUX-NAV-*` and the relevant `SUPUX-FND-*` tasks incrementally.
- Add shared AZ/RU/EN dictionaries, state patterns, visual-regression fixtures,
  and performance checks.
- Audit consumers outside Support before any change to `DataTable`, Button,
  Select, or other global primitives.

### Phase D — Daily support work

1. Agent Desktop data-trust contract and personal queue
2. Complaint Registry plus create/detail/import flows
3. VoIP Calls metric contract and call timeline
4. Knowledge Base plus article detail/portal visibility
5. Agent Calendar adaptive agenda

### Phase E — Core policies and customer terms

1. Ticket Categories
2. SLA Policies
3. Support Entitlements
4. Entitlement Templates
5. Skill Routing

### Phase F — Automation, access, and AI control

1. Escalation Rules
2. Macros
3. Portal Users
4. Support AI Settings
5. Customer Support Portal continuity

### Phase G — Cross-module hardening and rollout completion

- AZ/RU/EN copy and long-text checks.
- Light/dark theme contrast.
- Keyboard-only, focus order, screen-reader names, and reduced motion.
- 375/768/1024/1440 responsive smoke.
- Performance with realistic large lists.
- Permission and feature-gate regression.
- Final consistency and anti-pattern review.
- Canary observation, revision evidence, rollback validation, and flag removal.

### 22.1 Slice registry

Estimates remain `TBD` until Phase A measures data and integration complexity.
`Owner` names must be assigned in the canonical issue tracker; the table records
the accountable discipline, not a person.

| Slice | Priority | Blocking dependency | Accountable disciplines | Estimate |
| --- | --- | --- | --- | --- |
| Canonical plan + evidence | P1 | Product confirmation | Product, Design, QA | TBD |
| Navigation contract | P1 | Role/add-on matrix | Product, Frontend, QA | TBD |
| Service Desk + Ticket Detail | P1 | Evidence baseline | Product, Design, Frontend, Backend, QA | TBD |
| Agent Desktop | P1 | Authoritative metric API | Product, Backend, Frontend, QA | TBD |
| Complaint flows | P1 | Lifecycle/permission contract | Product, Frontend, Backend, QA | TBD |
| VoIP Calls | P1 | Same-scope aggregate API | Product, Backend, Frontend, QA | TBD |
| Support Entitlements | P1 | Existing roadmap regression matrix | Product, Frontend, Backend, QA | TBD |
| Entitlement Templates | P1 | Draft/state contract | Product, Frontend, QA | TBD |
| Skill Routing | P1 | Queue-first mental model decision | Product, Design, Frontend, Backend | TBD |
| Agent Calendar | P1 | Event-source/visibility contract | Product, Design, Frontend, QA | TBD |
| Escalation Rules | P1 | Runtime edit/order/simulation support | Product, Backend, Frontend, QA | TBD |
| Macros | P1 | Mutation/category persistence contract | Product, Backend, Frontend, QA | TBD |
| Portal Users | P1 | Permission/audit/recovery contract | Product, Security, Frontend, Backend, QA | TBD |
| Support AI Settings | P1 | AI/add-on/role execution matrix | Product, Security, Frontend, Backend, QA | TBD |
| Knowledge Base | P2 | Publication/access contract | Product, Frontend, QA | TBD |
| Ticket Categories | P2 | Dependency-impact contract | Product, Frontend, Backend, QA | TBD |
| SLA Policies | P1 | Validation and timeline semantics | Product, Backend, Frontend, QA | TBD |
| Customer Support Portal | P2 | Internal workflow/status contract | Product, Security, Frontend, Backend, QA | TBD |
| Shared foundation extraction | P2 | Proven reference slice | Design System, Frontend, QA | TBD |
| Rollout completion | P1 | Green slice evidence | Release owner, QA, Product | TBD |

## 23. File and Component Impact Map

| Area | Likely files/components | Risk |
| --- | --- | --- |
| Navigation | `src/lib/nav-items.ts`, `src/components/sidebar.tsx` | Medium: permissions and feature gates |
| Page shell | dashboard layout plus new/shared Support shell | Medium: broad visual impact |
| Tables/lists | `src/components/data-table.tsx`, page-specific list/card views | Medium: keyboard and mobile behavior |
| Ticket detail | `src/app/(dashboard)/tickets/[id]/page.tsx` and ticket context/comment APIs | High: primary agent flow and send safety |
| Complaint flows | complaint list/new/detail/import routes and APIs | High: lifecycle, import, export, evidence |
| Forms | `src/components/ui/button.tsx`, `src/components/ui/select.tsx`, Support forms | Medium: shared component regression |
| Help | `src/components/did-you-know.tsx`, page help integration | Low/Medium: first-use discoverability |
| Localization | `messages/az.json`, `messages/ru.json`, `messages/en.json` | Medium: catalog drift |
| Metrics | Agent Desktop and VoIP APIs/view models | High: data definition and trust |
| Entitlements | entitlement page/components and existing roadmap contracts | High: complex lifecycle and permissions |
| Calendar | calendar page/event components | Medium: major responsive adaptation |
| Macros/Portal | page routes and related APIs | High: destructive/access mutations |
| Support AI | Support AI settings, organization feature API, Support execution gates | High: cross-module execution and permissions |
| Customer portal | portal ticket/detail/knowledge/chat and closure-token routes | High: external access and tenant isolation |
| Evidence/rollout | browser fixtures, visual regression, feature flag and release evidence | Medium/High: release confidence |

Exact file lists must be resolved per slice before implementation. Broad shared
component changes require checking consumers outside Support.

## 24. Verification Matrix

| Gate | Every visible slice | Data/mutation slice | Shared component slice | Release candidate |
| --- | ---: | ---: | ---: | ---: |
| `git diff --check` | Required | Required | Required | Required |
| Changed-file ESLint | Required | Required | Required | Required |
| Targeted tests | Required | Required | Required | Required |
| `npx tsc --noEmit` | Where practical | Required | Required | Required |
| `npm run i18n:check` | If messages change | If messages change | If messages change | Required |
| Authenticated browser smoke | Required | Required | Required | Required |
| 375/768/1024/1440 widths | Required | As relevant | Required | Required |
| Keyboard-only smoke | Required | Required | Required | Required |
| Light/dark themes | Required | As relevant | Required | Required |
| Reduced motion | If motion changes | No | If motion changes | Required |
| Production build | If client boundary/config changes | If applicable | Required | Required |
| Permission/tenant regression | As relevant | Required | As relevant | Required |
| Feature/add-on/direct-route matrix | Required | Required | Required | Required |
| Forced fetch/mutation failure | Required | Required | As relevant | Required |
| Automated accessibility scan | Required | Required | Required | Required |
| Visual regression | Representative state | Representative state | Required | Required |
| Performance baseline/budget | Required | Required | Required | Required |
| Canary and rollback evidence | No | As relevant | As relevant | Required |

Browser acceptance scenarios:

1. Agent handles the next urgent ticket, replies, changes status, and returns to
   the same queue context without using a pointer.
2. Agent distinguishes public reply from internal note and recovers a failed send
   without losing the draft.
3. Manager identifies an SLA-risk ticket and opens its context in one flow.
4. Manager finds an uncovered routing queue.
5. Administrator creates and previews an SLA policy.
6. Administrator edits an entitlement without losing list context.
7. Administrator changes template level with an unsaved draft and receives a
   safe choice.
8. Portal administrator performs a scoped bulk action and recovery-password flow
   with explicit scope, permission, progress, and audit feedback.
9. AI administrator disables and re-enables Support AI, sees the exact affected
   flows, and verifies that manual Support and Omnichannel AI remain available.
10. Customer creates and follows a portal ticket through reply and closure on a
    375 px viewport without crossing tenant/contact boundaries.
11. All representative error states preserve entered data and offer recovery.

## 25. Acceptance Matrix

| Criterion | Planned implementation | Evidence required | Status |
| --- | --- | --- | --- |
| Daily work visible in first viewport | Compact shell, max three indicators, sticky toolbar | 1366 x 768 screenshots with representative data | TODO |
| Support navigation is understandable | Three permission-aware groups | Agent/manager/admin navigation smoke | TODO |
| No misleading metrics | Agent/VoIP aggregate contracts | API tests plus UI comparison to response | TODO |
| No page-level mobile overflow | Responsive cards/agenda/master-detail | 375 px `scrollWidth === clientWidth` | TODO |
| Keyboard access | Semantic tables, rows, menus, switches, calendar events | Keyboard-only scenario recording | TODO |
| Touch target safety | Shared control sizing and row menus | 375 px inspection and automated audit | TODO |
| Non-color status communication | Text/icon labels across all states | Light/dark/color-blind inspection | TODO |
| Trustworthy operations | Shared loading/error/success/rollback patterns | Forced fetch/mutation failure tests | TODO |
| Draft-loss prevention | Template guard and form preservation | Navigation/context-switch tests | TODO |
| Localization parity | Shared dictionaries and no raw enums | i18n check plus AZ/RU/EN smoke | TODO |
| Reduced cognitive load | Progressive disclosure and task-first layout | Before/after block count and scroll comparison | TODO |
| No generic AI-dashboard patterns | Remove rainbow KPI/card nesting/side stripes | Final manual design review | TODO |
| Distinctive operational hooks | One decision-supporting hook per surface | Prototype review plus task-use evidence | TODO |
| Complete operational scope | Fifteen destinations plus nested case/portal flows | Route inventory and scenario coverage | TODO |
| Correct role/add-on visibility | Explicit feature, add-on, role, page/API matrix | Navigation and direct-route regression | TODO |
| Canonical traceability | Epic, slice issues, PRs, evidence and release status | Linked issue/backlog audit | TODO |
| Safe incremental rollout | Independent canary and rollback per high-risk slice | Production revision and rollback evidence | TODO |

## 26. Success Metrics

Before implementation, establish a baseline and then verify:

- At least a 35% reduction in vertical distance to the primary work surface on
  Service Desk, Agent Desktop, Entitlements, and Calendar.
- Primary work surface visible in the first 768 px viewport on daily-work pages.
- Default to no more than three KPI indicators; document evidence when additional
  operational indicators are necessary.
- Group peer filters/actions into understandable chunks of four or fewer while
  keeping familiar expert controls discoverable.
- Zero random or hardcoded operational metrics presented as real data.
- Zero pointer-only or hover-only critical actions.
- Zero page-level horizontal overflow at 375 px.
- Zero raw English enums/technical IDs in AZ/RU/EN representative flows.
- Every fetch/mutation path has visible loading/error/success behavior.
- All 15 potentially visible destinations and defined nested case/portal flows
  pass their desktop/mobile/keyboard acceptance scenarios.
- Every released surface has one validated operational hook and zero decorative
  AI-dashboard fingerprints.

Quantitative task-time goals should be added only after baseline usability
measurements with representative users; do not invent improvement percentages.

## 27. Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Broad visual rewrite causes regressions | High | Reference vertical slice first, then opt-in shared extraction and path-scoped releases |
| Reorganized navigation disrupts learned behavior | Medium/High | Preserve routes, role-test groups, keep active route visible |
| Shared component edits affect other modules | High | Inventory consumers and use incremental opt-in variants first |
| Agent/VoIP API data does not support accurate metrics | High | Define contract first; show unavailable rather than fabricated data |
| Entitlement UX breaks lifecycle or permissions | High | Reconcile existing roadmap and add lifecycle/API regressions |
| Mobile adaptation hides essential actions | High | Adapt task flow; do not remove critical functionality |
| Localization expands layout | Medium | Test longest AZ/RU strings before final density tuning |
| Dark theme diverges | Medium | Token-based states and paired light/dark visual checks |
| Too many simultaneous workstreams | High | Keep one page slice in progress; isolate independently testable API contracts |
| Stale audit baseline misses recent product changes | High | Re-baseline current `main` and record commit/role/add-on with every screenshot |
| Feature/add-on navigation differs from direct authorization | High | Maintain explicit nav/page/API matrix and regression tests |
| Internal and portal ticket states diverge | High | Treat customer portal continuity as a required cross-surface contract |
| Support AI switch leaks into other modules or blocks manual work | High | Cross-module execution tests plus auditable canary/rollback |
| User prefers a different aesthetic direction | Medium | Direction is provisionally confirmed; validate the reference slice before extraction |

## 28. Open Decisions Requiring Product Confirmation

1. Are the primary Support roles correctly identified as agent, manager, and
   tenant administrator? Which role has priority when goals conflict?
2. Approve or adjust the proposed Work / Team / Rules and Settings navigation.
3. Should Agent Calendar live under Work or Team?
4. Should Support have a dedicated landing/hub route, or should Service Desk
   remain the module entry point?
5. The direction **calm, operational, human**, restrained orange accent, compact
   typography, visible hooks, and avoidance of generic AI palettes is treated as
   confirmed by product feedback. Confirm only if this interpretation is wrong.
6. Should typography changes remain Support-scoped or become a later product-wide
   design-system initiative?
7. Service Desk plus Ticket Detail is the recommended reference slice. Confirm
   whether any operational dependency makes that sequence temporarily unsafe.
8. Confirm that customer-portal continuity is included as a dependency track,
   not as a full portal redesign.
9. Confirm whether Support AI Settings belongs under Rules and Settings or in a
   dedicated AI subsection if more Support AI controls are added later.

## 29. Do Not Do

- Do not solve density by making all text and targets tiny.
- Do not hide critical mobile actions to make the layout fit.
- Do not replace one card grid with another differently colored card grid.
- Do not add decorative charts or metrics without an operational decision.
- Do not show page-local statistics beside global statistics without scope labels.
- Do not use random, fallback, or stale values as authoritative metrics.
- Do not make hover the only way to discover an action.
- Do not use browser prompt/confirm for product workflows.
- Do not expose raw enums, IDs, or untranslated fallbacks.
- Do not remove existing sections, permissions, or feature gates without explicit
  product approval and regression evidence.
- Do not deploy the redesign as one indivisible release.
- Do not treat hiding a navigation item as authorization; page and API checks
  remain mandatory.
- Do not merge the current local feature branch wholesale merely to publish this
  plan; land the updated document from a clean current-main base.

## 30. Definition of Done

The Support UX redesign is complete only when:

- the design brief and navigation model are explicitly approved;
- the plan is canonical and every active slice has a linked issue, owner,
  dependency state, acceptance evidence, and rollout status;
- all `SUPUX-*` tasks are `DONE` or intentionally `DEFERRED` with a reason;
- all 15 potentially visible destinations plus required nested case and portal
  flows pass their acceptance criteria;
- shared foundation behavior is consistent across the module;
- data trust blockers in Agent Desktop and VoIP are resolved;
- representative loading, empty, no-results, error, success, and permission
  states are verified;
- AZ/RU/EN, light/dark, desktop/tablet/mobile, keyboard, touch, and reduced-motion
  checks are recorded;
- required targeted tests, typecheck, lint, i18n, and production build gates have
  evidence from the implementation tree;
- feature/add-on/role/direct-route, tenant-isolation, visual-regression, and
  performance gates have evidence;
- every surface has a validated operational hook and no unresolved generic
  AI-dashboard fingerprint;
- no unrelated UI or application behavior changed;
- rollout and rollback boundaries are documented before any production release.
