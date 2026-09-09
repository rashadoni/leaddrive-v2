# Roadmap: Support Entitlements / SLA by Customer

## Purpose

Turn `/support/entitlements` from a read-only status page into a working Service Desk control center for customer support terms.

The target business loop is:

`Company -> Support entitlement -> SLA policy -> Milestone definitions -> Ticket milestones -> Escalation -> Reports`

This roadmap covers only the support-entitlement layer. It does not replace the existing ticket reports, category constructor, SLA policies, or agent desktop work; it connects them.

## Current State

Observed in the current implementation:

- The route `/support/entitlements` exists.
- `GET /api/v1/entitlements` exists.
- Prisma models exist for:
  - `Entitlement`
  - `EntitlementMilestoneDefinition`
  - `EntitlementTicketMilestone`
  - `EntitlementAuditEvent`
- The UI is read-only.
- Empty state does not explain the next operational step.
- There is no UI to create or activate an entitlement.
- Milestone definitions can be configured on draft/suspended support terms.
- Ticket creation applies active customer support terms and ticket detail shows
  the applied entitlement when runtime milestones exist.
- Ticket reports do not yet expose entitlement-specific SLA risk.

## Product Definition

An entitlement is the support contract/rule for one customer company:

- which company receives support;
- which SLA policy applies;
- what support level the company has;
- when the support term is valid;
- which ticket milestones must be met;
- what happens if a milestone is at risk or missed.

Recommended UI naming:

- RU: `Условия поддержки клиентов`
- AZ: `Musteri destek shertleri` or keep `Destek huquqlari` with clearer helper copy
- EN: `Customer support terms`

## Phase 1: Make The Section Understandable

Goal: users should understand what the page is for before any data exists.

Tasks:

- [x] ENT-001 Rename the page copy from abstract entitlement language to customer-support terms language.
- [x] ENT-002 Replace the empty state with an operational empty state:
  - what this section controls;
  - how it affects tickets;
  - who should configure it;
  - primary CTA: `Create support term`.
- [x] ENT-003 Add a setup checklist:
  - choose company;
  - choose SLA policy;
  - choose support level;
  - define validity period;
  - define milestones;
  - activate.
- [x] ENT-004 De-emphasize global AI search on the empty state so the first action is creation/configuration.
- [x] ENT-005 Add a compact explainer panel: `When a ticket is created for this company, LeadDrive creates milestone deadlines automatically.`
- [x] ENT-006 Add loading skeletons and clearer error state for `/api/v1/entitlements`.

Acceptance criteria:

- Empty production tenant no longer looks broken.
- First-time admin can identify the next setup action without reading help docs.
- The screen explains the ticket connection in one sentence.

Verification:

- Browser check `/support/entitlements` with no entitlements.
- `npm run i18n:check` if translation keys change.
- Targeted lint/typecheck for the page.

## Phase 2: Entitlement CRUD And Lifecycle Actions

Goal: admins can create and manage customer support terms from the UI.

Tasks:

- [x] ENT-010 Add `POST /api/v1/entitlements`.
- [x] ENT-011 Add `PATCH /api/v1/entitlements/[id]` for editable fields while draft/suspended.
- [x] ENT-012 Add lifecycle actions:
  - `activate`;
  - `suspend`;
  - `resume`;
  - `expire`;
  - `cancel`.
- [x] ENT-013 Enforce one active entitlement per company at API level before relying on the DB constraint.
- [x] ENT-014 Write `EntitlementAuditEvent` for create/update/lifecycle actions.
- [x] ENT-015 Build create/edit form:
  - company;
  - SLA policy;
  - support level;
  - valid from;
  - valid to;
  - notes.
- [x] ENT-016 Add status-specific actions in the list/card UI.
- [x] ENT-017 Add filters:
  - company;
  - status;
  - support level;
  - SLA policy;
  - expiring soon;
  - overdue milestones.

Progress note: Phase 2 is implemented with immutable company/SLA after create,
editable support level/validity/notes for draft/suspended terms, API-level
duplicate-active protection, and lifecycle audit events.

Acceptance criteria:

- Admin can create a draft support term and activate it.
- Active duplicate for the same company is blocked with a clear error.
- Every lifecycle action writes an audit event.

Verification:

- API tests for create/update/lifecycle transitions.
- DB constraint regression for duplicate active entitlement.
- Browser create/activate/cancel smoke.

## Phase 3: Milestone Constructor

Goal: support managers can define the concrete deadlines applied to tickets.

Tasks:

- [x] ENT-020 Add milestone definition editor per entitlement.
- [x] ENT-021 Support milestone types:
  - first response;
  - problem identified;
  - workaround delivered;
  - resolution;
  - escalation.
- [x] ENT-022 Support severity scoping:
  - all;
  - critical;
  - high;
  - normal;
  - low.
- [x] ENT-023 Support due-window input in business-friendly units:
  - minutes;
  - hours;
  - days.
- [x] ENT-024 Add required/optional toggle per milestone.
- [x] ENT-025 Add templates:
  - Basic;
  - Standard;
  - Premium;
  - Enterprise.
- [x] ENT-026 Add copy-from-template flow when creating a new entitlement.
- [x] ENT-027 Validate unique `(entitlement, type, severity)` combinations before submit.

Progress note: Phase 3 is implemented on `/support/entitlements` with
draft/suspended-only milestone editing, Basic/Standard/Premium/Enterprise
templates, manual add/update/delete, duplicate preflight validation, and delete
protection once a definition is referenced by ticket milestones.

Acceptance criteria:

- Manager can build milestone rules without touching raw SLA internals.
- Templates create a complete starting set.
- Invalid duplicate definitions are rejected before DB error.

Verification:

- Unit tests for validation.
- API tests for milestone creation/update.
- Browser check with one custom Enterprise entitlement.

## Phase 4: Ticket Lifecycle Integration

Goal: entitlements must affect real tickets, not only sit in a settings page.

Tasks:

- [x] ENT-030 Resolve ticket company during ticket creation across all intake paths:
  - portal;
  - email;
  - WhatsApp;
  - complaint registry;
  - manual API;
  - AI tool executor.
- [x] ENT-031 Find active entitlement for the ticket company.
- [x] ENT-032 Create `EntitlementTicketMilestone` rows for matching definitions.
- [x] ENT-033 Preserve fallback behavior when no entitlement exists:
  - normal SLA policy still applies;
  - ticket creation must not fail.
- [x] ENT-034 Show applied entitlement on ticket detail:
  - company support level;
  - SLA policy;
  - active milestone deadlines;
  - overdue/at-risk state.
- [x] ENT-035 Update milestones when ticket events happen:
  - first response sent;
  - problem identified;
  - workaround delivered;
  - resolved;
  - escalated.
- [x] ENT-036 Add audit trail entries for milestone start/met/missed/waived.

Progress note: Phase 4 now wires ticket creation into active company support
terms through the shared ticket factory and direct complaint/email/portal intake
paths. New covered tickets create runtime milestones in the ticket transaction;
ticket detail shows the applied support term and deadlines; first response,
in-progress, waiting, resolved, and escalation events mark matching milestones
as met with audit entries. Start/met/missed/waived audit is implemented; missed
events are written by the SLA cron entitlement worker and waived events are
written by the ticket runtime milestone waiver action.

Acceptance criteria:

- New ticket for a company with active entitlement gets milestone rows.
- Ticket detail shows the applied support term.
- Ticket without entitlement still works normally.

Verification:

- Tests for ticket creation through portal/email/WhatsApp/manual API.
- Browser check on ticket detail.
- Regression tests for ticket numbering and existing ticket factory flow.

## Phase 5: Escalation And Automation

Goal: the system should warn and escalate before support terms are missed.

Tasks:

- [x] ENT-040 Extend SLA cron/worker to evaluate entitlement milestones.
- [x] ENT-041 Mark milestone as at-risk when due within configured warning window.
- [x] ENT-042 Mark milestone as missed when due time passes.
- [x] ENT-043 Add escalation levels per milestone:
  - notify assignee;
  - notify manager;
  - increase priority;
  - reassign to queue;
  - create internal note.
- [x] ENT-044 Add waiver action with required reason.
- [x] ENT-045 Add manager notification for missed Premium/Enterprise milestones.
- [x] ENT-046 Make escalation idempotent so cron retries do not duplicate actions.

Progress note: Phase 5 is implemented through the existing SLA escalation cron.
The entitlement worker marks due-soon milestones at risk, flips overdue runtime
milestones to missed, writes missed/escalated audit events, creates internal
ticket notes, notifies assignees/managers, raises ticket priority and reassigns
late missed milestones through the existing auto-assign path. Runtime milestones
can be waived from ticket detail only with a required audit reason.

Acceptance criteria:

- A due milestone moves to missed once.
- Re-running cron does not duplicate notifications or audit records.
- Manager can waive with reason and the waiver is visible.

Verification:

- Worker/cron tests with frozen time.
- Idempotency tests.
- Browser check for waived/missed/at-risk states.

## Phase 6: Reports And Search

Goal: ticket reports should expose support-term health.

Tasks:

- [x] ENT-050 Add entitlement filters to ticket reports:
  - company;
  - support level;
  - SLA policy;
  - entitlement status;
  - milestone type;
  - milestone state.
- [x] ENT-051 Add report tiles:
  - active support terms;
  - expiring in 30 days;
  - overdue milestones;
  - at-risk milestones;
  - missed milestones in 30 days.
- [x] ENT-052 Add company-level SLA risk table.
- [x] ENT-053 Add support-level comparison:
  - Basic vs Standard vs Premium vs Enterprise.
- [x] ENT-054 Add ticket list drill-down from every entitlement metric.
- [x] ENT-055 Export entitlement report to CSV.

Progress note: Phase 6 is implemented in the Service Desk report API and UI.
Ticket reports now accept support-level, SLA-policy, entitlement-status,
milestone-type, and milestone-state filters; return support-term KPI tiles,
company-level risk rows, support-level comparison rows, and a milestone
drill-down list; and export the entitlement report details to CSV with company,
support level, milestone state, and ticket number.

Acceptance criteria:

- Manager can answer: which customers are at risk today?
- Reports drill down to the real tickets.
- Export includes company, support level, milestone state, ticket number.

Verification:

- API tests for report filters.
- Browser check `/tickets?view=reports#ticketing-report`.
- CSV smoke test.

## Phase 7: Permissions, QA, And Release

Goal: make the feature safe for production use.

Tasks:

- [x] ENT-060 Define permissions:
  - `entitlements.read`;
  - `entitlements.write`;
  - `entitlements.activate`;
  - `entitlements.cancel`;
  - `entitlements.waive_milestone`.
- [x] ENT-061 Map permissions to roles:
  - agent: read only on ticket detail;
  - support manager: create/edit draft and waive;
  - admin: lifecycle actions;
  - owner: full access.
- [x] ENT-062 Add route/API permission checks.
- [x] ENT-063 Add i18n coverage for AZ/RU/EN.
- [x] ENT-064 Add seeded demo data for one active entitlement with milestones.
- [x] ENT-065 Add help article update and video slot note.
- [x] ENT-066 Run final verification:
  - targeted tests;
  - eslint on touched files;
  - typecheck;
  - i18n check;
  - browser smoke;
  - production smoke after deploy when release is approved.

Acceptance criteria:

- Agents cannot change customer support terms.
- Admins can complete the full lifecycle.
- Demo tenant shows meaningful data, not five zero KPI tiles.

Implementation note:

- `entitlements.read` is limited to support/ticketing/manager/admin/superadmin roles.
- `entitlements.write` is for support managers and administrators.
- lifecycle actions (`activate`, `suspend`, `resume`, `expire`, `cancel`) are admin-only.
- milestone waiver is available to support managers and administrators.
- the demo seed creates active support terms with milestone definitions, ticket milestones, and audit events.
- help content is registered under the `entitlements` slug and the video launcher has a `/support/entitlements` slot; approved video assets remain tracked in the help-video audit.
- final local verification passed with targeted tests, eslint, typecheck, i18n check, and production build before release.

## Suggested Implementation Order

1. ENT-001 to ENT-006: make the current screen understandable.
2. ENT-010 to ENT-017: make support terms manageable.
3. ENT-020 to ENT-027: add milestone constructor.
4. ENT-030 to ENT-036: wire into ticket creation and ticket detail.
5. ENT-040 to ENT-046: add automation and escalation.
6. ENT-050 to ENT-055: add reporting.
7. ENT-060 to ENT-066: harden permissions, translations, and release checks.

## Risks

- Company resolution from email/WhatsApp can be ambiguous. The feature must support a no-entitlement fallback.
- Existing SLA policy and entitlement milestone deadlines can conflict. UI must explain which one is primary.
- Cron escalation must be idempotent to avoid duplicate manager notifications.
- Permissions should not be bundled only under broad `tickets` write access once lifecycle actions are live.
- Demo data is required; otherwise the page will keep looking broken even when the backend is correct.

## Release Notes Template

When this roadmap is implemented, the release should say:

- Added customer support terms for Service Desk.
- Admins can configure company-level support levels, validity windows, SLA policies, and milestone deadlines.
- Tickets created for covered companies receive milestone tracking automatically.
- Reports show customers and tickets at risk of support-term/SLA breach.
