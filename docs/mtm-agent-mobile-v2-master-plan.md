# Agent Mobile v2 — master scope and delivery contract

Status: implementation complete; automated gates passed; physical Android release gate pending
Owner decision: 2026-07-15
Primary rule: an agent must be able to complete the working day without a desktop.

## 1. Product outcome

LeadDrive Field is the single mobile workspace for field agents. It combines
the route, visit, task, workday and communication workflows owned by LeadDrive.

The application must let an agent:

- plan and execute a week of routes and visits;
- work with clinics, pharmacies, doctors, pharmacists, and retail stores;
- perform tasks, promotions, commitments, orders, returns, rewards, and stock work;
- exchange messages and documents;
- manage their workday, attendance requests, GPS, and personal KPI;
- keep working when the network is unavailable and reconcile safely later.

The product is not complete while any normal agent operation still requires a
desktop browser.

## 2. Architecture decision

### 2.1 One client, bounded API surface

- The mobile client uses only the versioned LeadDrive Field API.
- It never stores service credentials and never performs a second product login.
- LeadDrive owns CRM/medical field-force data: identity, organization/contact,
  routes, visits, work calendar, tasks, commitments, GPS, KPI, messages,
  documents, and HRM requests.

### 2.2 Protocol rules

- Version every request/response contract.
- Return a capability manifest after login so navigation and actions reflect
  the tenant and role.
- Apply authorization on the server for every mutation; hidden UI is not a
  security boundary.
- Every offline mutation carries a device ID, operation ID, client timestamp,
  expected version, and payload schema version.
- Applied and conflict results are idempotently pinned. Transient errors remain
  retryable.
- Attachments upload before operations that reference them; a failed attachment
  does not block unrelated operations.
- All mobile-visible timestamps include timezone context. The organization
  timezone is authoritative for workdays and missed-route calculation.

## 3. Role boundary

### Agent mobile

Every action in the matrix below is implemented on mobile when the agent has
permission. A denied action explains why and, where applicable, offers a request
or approval flow.

### Manager/admin web

The following remain primarily web operations:

- global role and permission configuration;
- holiday/work-calendar configuration;
- bulk transfer of organizations and contacts;
- import jobs and mapping of distributor/ERP data;
- team-wide planning, approvals, and exception queues;
- global dictionaries, scoring formulas, and policy configuration.

Their results must sync to mobile. Agent-side responses to approvals, requests,
and corrections remain mobile-capable.

## 4. Agent action matrix

| Area | Mobile actions | Offline requirement |
| --- | --- | --- |
| Session/device | sign in, select tenant, refresh/revoke session, register device, choose locale | keep an encrypted valid session; fail closed after revocation is confirmed |
| Workday | start, pause when policy allows, resume, finish, see elapsed time | queue every transition with captured device time and GPS state |
| Week | browse previous/current/next week, see workdays/holidays, status legend, daily totals | cache at least current plus adjacent weeks |
| Routes | create/copy/edit draft, add/search/reorder/remove stops, add time, detect conflicts, submit, answer review, accept manager revision | drafts and edits survive restart; conflicts reconcile explicitly |
| Published route | start, navigate, request stop add/remove, reschedule/cancel with reason, explain missed stop | queue allowed requests; never mutate a locked route silently |
| Visit | check in/out, complete policy actions, outcome, potential, next action, notes, products, photos, documents, cancellation reason | full visit can be completed without network, including media queue |
| Organizations | search/filter, view details/history/GPS/assignees, request create/edit, report duplicate | cache assigned and route-relevant records |
| Contacts | doctors/pharmacists, specialty/category/profile, call/message/navigate, request edit/new workplace | cache assigned contacts and workplace history |
| Tasks | create allowed task, accept, start, complete, reschedule, comment, attach evidence, repeat/copy where policy allows | all agent mutations queued; recurrence definition validated locally |
| Commitments | record promise, product/brand, quantity, due date, evidence; later record fact and variance | local draft and immutable submitted event |
| Promotions | view eligibility/mechanics, enroll outlet/contact, execute action, submit proof, see manager decision | cache active mechanics; queue proof and execution |
| Sales | view imported distributor sales, promise-vs-fact, product/brand history | cache scoped recent history; imports remain web/admin |
| Messages | inbox, thread, send text/attachment, acknowledge broadcast | drafts/outbox supported; ordering reconciled on sync |
| Documents | browse assigned files, download for offline use, upload visit/task document | explicit download state and upload queue |
| HRM | see schedule, request leave/absence/correction, view decision | requests queue; approved calendar changes sync back |
| GPS | permission readiness, tracking state, current accuracy, personal day history | buffer points and upload in ordered idempotent batches |
| KPI | personal plan/fact/coverage/GPS/task/promo/order indicators with drill-down | last computed snapshots available offline |
| Notifications | route/task/approval/calendar/sync events, mark read, deep link | notifications persisted locally and deduplicated |
| Sync center | pending/applied/conflict/rejected counts, retry, resolve supported conflict | always available, including after crash/restart |

## 5. Status semantics

Color never carries meaning alone. Every state has a label and icon.

| Effective state | Meaning | Visual intent |
| --- | --- | --- |
| `DRAFT` | not yet submitted/published | amber-neutral |
| `PLANNED` | approved future/current work | slate |
| `IN_PROGRESS` | active route/visit | blue |
| `COMPLETED` | fully executed | green |
| `MISSED` | planned date passed without required execution | red |
| `CANCELLED` | explicitly cancelled with reason | muted, struck through |
| `NON_WORKING_DAY` | holiday/weekend/override | violet pattern plus label |

`MISSED` is computed from organization-local date, route/stop status, approved
calendar overrides, and approved cancellation. It is not stored by overloading
`CANCELLED`.

## 6. Data foundations

Additive models are required for:

- organization work-calendar day and overrides;
- organization/contact separation;
- contact workplace history;
- many-to-many agent assignment with effective dates;
- contact/organization category and brand/product potential;
- promotion commitment and fulfilment events;
- sample/material inventory ledger;
- HRM workday and request records;
- message thread/message receipt and mobile document assignment;
- mobile device, sync cursor/conflict, and protocol capability snapshots.

Every tenant-owned model carries `organizationId`, indexes for its scoped query,
and RLS/mutation tests before deployment.

## 7. Work calendar and coverage

- Administrators can define weekends, public holidays, exceptional workdays,
  moved days, and per-team overrides.
- Agents cannot plan on a non-working day unless policy explicitly allows an
  exception.
- Coverage is calculated separately for doctors and pharmacies, with filters by
  region, team, specialty, category, brand, and period.
- KPI exposes numerator and denominator; a percentage without drill-down is not
  accepted.
- Contact/organization category uses a configurable weighted score. The formula
  version is stored with each resulting snapshot.

## 8. GPS and privacy

- Background tracking is active only during a started workday or an explicit
  active visit, according to tenant policy.
- Mobile shows permission, background-access, accuracy, battery, online/offline,
  and last-upload state.
- The server stores ordered points, workday boundaries, stop segments, and
  anomaly evidence without silently rewriting device claims.
- Permission denial, weak accuracy, mock-location suspicion, low battery, and
  tracking gaps have explicit operational states and allowed reason flows.

## 9. UX contract

- Phone is thumb-first, single-column, 44px minimum targets, 16px minimum body
  text, safe-area aware, and never hover-dependent.
- The primary navigation is Today, Week, Work, Inbox, and Profile. Work opens a
  task-oriented module index rather than placing every module in the tab bar.
- Advanced filters use bottom sheets; current scope and active filters remain
  visible after closing them.
- Destructive or permission-sensitive operations use exact verbs and explain
  consequences. Recoverable actions prefer undo.
- Lists use status, next action, and exception-first ordering; they do not copy
  the dense legacy SwissMed filter wall.
- Russian, Azerbaijani, and English strings ship together.
- Light mode is primary for daylight field work; dark mode remains supported.

## 10. Acceptance gates

### Automated

- pure status/calendar/coverage/scoring tests;
- tenant/RLS and role/action authorization tests;
- API contract and idempotency tests;
- migration validate/generate/deploy rehearsal;
- web typecheck, focused tests, and production build;
- mobile typecheck, unit tests, and deterministic offline sync tests;
- E2E journeys for manager plan -> agent execution -> manager review.

### Physical Android

- clean install and upgrade from the last supported build;
- login with tenant disambiguation;
- permission allowed/denied/limited flows;
- route edit and full visit offline;
- app kill/restart before sync;
- network recovery with media and operation deduplication;
- concurrent manager/agent edit conflict;
- low storage, low battery, poor GPS, and slow network;
- background tracking boundary and end-workday stop;
- APK signing, install, update prompt, and rollback evidence.

No release may be called 100% complete while the physical-device gate or a
required domain integration is unverified.

## 11. Delivery order

1. Contract, capability manifest, participant sync fix, week/KPI endpoint.
2. Work calendar and effective route status.
3. Organization/contact/workplace/assignment foundation.
4. Agent mobile shell variant, auth adapter, Week, routes, visits, tasks, sync.
5. Coverage, KPI, GPS workday/history, customer/contact requests.
6. Commitments, promotions, stock ledger, orders/returns/rewards integration.
7. Messages/documents and HRM.
8. Web planner/admin redesign, demo seed, migration, E2E, physical Android gate.

## 12. Explicit exclusions

- No Google Drive upload or dependency.
- No duplicated order/SKU source of truth in LeadDrive.
- No desktop screen copied pixel-for-pixel into mobile.
- No color-only status, silent conflict resolution, or online-only critical flow.
- No claim of production completion without current-tree tests and runtime proof.

## 13. Delivery status — 2026-07-17

Implemented:

- versioned mobile contracts, capability manifest, tenant-aware authentication,
  week/calendar/status semantics, offline sync, and conflict handling;
- organization, contact, workplace, assignment, potential, and customer-request
  workflows;
- route create/copy/edit/reorder/planned-time flows, published-route requests,
  approvals, visits, workday, GPS, tasks, KPI, and notifications;
- server-enforced GPS/workday lifecycle: live coordinates require an active
  workday, completed-day offline backlog is accepted only inside its explicit
  workday interval, and accepted retries remain idempotent;
- agent messages, private documents, HRM requests, and the manager operations
  center for broadcasts, document assignment, and HRM decisions;
- responsive route planning and operations UI with Azerbaijani, Russian, and
  English parity; Google Drive is neither required nor used.

Current-tree automated evidence:

- targeted operations/timezone tests: 42 passed;
- full MTM regression: 78 files, 669 passed, 1 pre-existing todo;
- targeted ESLint and `git diff --check`: passed;
- translation parity: 16,655 English source keys, zero missing/extra RU or AZ
  keys;
- Prisma Client generation and full non-incremental TypeScript check: passed;
- Next.js webpack production build: exit 0, 809/809 static pages generated.
- built standalone runtime smoke: server ready; `/api/v1/ping` returned HTTP 200
  with `db: ok` and three visible organizations;
- Android Expo export: exit 0, 1,563 modules, 4.4 MB HBC bundle; SHA-256
  `e3eb67bba24996cf4ef1c21534483e64a83bc4698a9710f8c74fed62b6900b71`.
- LeadDrive feature history rebased cleanly onto `origin/main` at `a445c7339`
  and the web gates above were repeated after the rebase.
- lifecycle checkpoint `02296f78a` passed focused GPS tests (`43/43` detail and
  `16/16` notification files), mandatory MTM/auth/i18n gates, standalone build,
  atomic production deploy and smoke in workflow `31269715002`.
- pharmacy-promotion checkpoint `819f1ab99` durably queues binary evidence in
  the identity-scoped IndexedDB outbox and replays stable multipart operations
  after reconnect. Focused outbox (`20/20`) and UI-contract (`6/6`) suites,
  mandatory gates, production build, atomic deploy and smoke passed in PR run
  `31271128432` and deploy workflow `31271526327`.
- promotion-definition checkpoint `f7eb81f25` adds administrator-only sourced
  drafts and hash-bound activation for promotion types, points formulas and
  L1/L2 policies without guessed defaults. UI-contract (`7/7`), mandatory
  gates, zero-gap RLS scan, production build, atomic deploy and smoke passed in
  PR run `31272682579` and deploy workflow `31273357580`.
- promotion-campaign checkpoint `265fdf580` adds sourced campaign roots,
  immutable revisions and hash-bound publish/retire administration without
  guessed business defaults. UI-contract (`8/8`), mandatory gates, Secret
  Scan, Social E2E, standalone build, atomic deploy and smoke passed in PR run
  `31275575315` and deploy workflow `31275945498`; independent production
  probes returned ping `200`, unauthenticated mutations `401` and page redirect
  `307`.
The demo API and responsive browser journeys were executed before the temporary
worktree cleanup and included route-time editing, failed-publication retry
without duplicate drafts, HRM conflict/override, private document download, and
mobile-width overflow checks. The source changes were then restored exactly from
the session patch log and revalidated by the current-tree gates above; temporary
screenshot artifacts were not retained.

Remaining release gate:

- execute and record the Physical Android matrix from section 10 on a real
  supported device. This requires external hardware and remains the only reason
  the release is not labelled 100% production-complete.
