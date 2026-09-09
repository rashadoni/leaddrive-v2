# SwissMed MTM parity register

Last audited: 2026-08-12
Production evidence target: `b1f7180269271181cec7ff27462b54dc2a9b78d9`
Evidence runner checkpoint: `3c101f17da935c9007c2c2ed38128b307600bbf2`

This register prevents backend foundations from being reported as completed
SwissMed scenarios. Every scenario is assessed across five independent layers.

## Status legend

- `DONE`: implemented and covered by current-tree evidence.
- `PARTIAL`: usable foundation exists, but the SwissMed scenario is incomplete.
- `MISSING`: no sufficient implementation was found.
- `BLOCKED`: requires a signed product rule or external source.

`Acceptance` can become `DONE` only after browser/device evidence is recorded
against the corresponding section in
`docs/swissmed-visual-forensic-analysis-2026-07-28.md`.

## Five-layer register

| SWM | Scenario | Data | API | Web/tablet UI | Phone/offline | Acceptance | Next task |
|---|---|---|---|---|---|---|---|
| 01 | Organization catalogue and ownership | DONE | DONE | DONE | PARTIAL | PARTIAL | physical assignment/device evidence |
| 02 | Bulk contact transfer | DONE | DONE | DONE | PARTIAL | PARTIAL | authenticated two-employee offline/physical-phone evidence |
| 03 | Contact master card | DONE | DONE | DONE | PARTIAL | PARTIAL | approved dictionary values + signed merge policy + physical-device evidence |
| 04 | Doctor scoring and brand potential | DONE | DONE | DONE | PARTIAL | PARTIAL | tenant-approved glossary package + physical-phone evidence |
| 05 | My contacts | DONE | DONE | DONE | PARTIAL | PARTIAL | signed coverage package + physical-device evidence |
| 06 | Organization detail | DONE | DONE | DONE | PARTIAL | PARTIAL | authoritative departments/files/commercial provenance + physical-device evidence |
| 07 | My organizations | DONE | DONE | DONE | PARTIAL | PARTIAL | signed classification sources + team/phone/offline evidence |
| 08 | Dense organization grid | DONE | DONE | DONE | PARTIAL | PARTIAL | large-data/physical-phone evidence + license source |
| 09 | Pharmacy promotion and approval | DONE | DONE | PARTIAL | PARTIAL | BLOCKED | SWM-09 product rules/evidence gates |
| 10 | GPS history and stop detail | DONE | DONE | DONE | PARTIAL | PARTIAL | signed retention/stop policy + physical-device evidence |
| 11 | Actual day replay | DONE | DONE | DONE | PARTIAL | PARTIAL | deterministic physical-device replay + offline no-map-tiles evidence |
| 12 | Live team map | DONE | DONE | DONE | PARTIAL | PARTIAL | authenticated large-team physical-device evidence |
| 13 | Plan/GPS KPI | DONE | DONE | DONE | PARTIAL | BLOCKED | approved SwissMed KPI package + physical-device evidence |
| 14 | Full task card and recurrence | DONE | DONE | DONE | PARTIAL | PARTIAL | approved task-group values + physical-device evidence |
| 15 | Coverage, cancellation queue, active tasks | DONE | DONE | DONE | PARTIAL | BLOCKED | signed SwissMed coverage rules/data + device evidence |
| 16 | Filter-led visit planning | DONE | DONE | DONE | PARTIAL | BLOCKED | signed capacity policy + physical-phone/offline evidence |
| 17 | Weekly operational home | DONE | DONE | PARTIAL | PARTIAL | PARTIAL | confirm M/K/print semantics + physical-device evidence |
| 18 | Contact-by-date planning matrix | DONE | DONE | DONE | PARTIAL | BLOCKED | signed what-if capacity rules + physical-device evidence |

Coverage: 18/18 scenarios assessed. No scenario is fully accepted yet.

## 2026-08-11 implementation reconciliation

The table separates implementation evidence from product approval and physical
device acceptance. `DONE` in Data/API/Web does not mean the entire scenario is
accepted; the Acceptance column remains authoritative for that decision.

- SWM-01 web parity was completed by PR #777: active dependent facets use the
  same tenant, actor, effective-assignment, signed-attribute and date scope as
  the catalogue, including polygon; stale facet responses cannot replace newer
  results and the empty state lists the exact active filters.
- SWM-03 governed contact master data was completed by PR #772 and its build
  repair PR #775: effective-dated assignments bind psychotype, product category
  and brand category values to exact signed dictionary versions and are
  projected to mobile sync without inventing tenant values.
- SWM-05 governed contact coverage was completed by PR #765: the list reads an
  explicit month, signed policy and complete frozen snapshot, preserves saved
  views and fails closed when tenant evidence is missing.
- SWM-06, SWM-12, SWM-14, SWM-15, SWM-16 and SWM-18 web completion checkpoints
  are present in the deployed mainline. Their remaining work is recorded under
  product evidence, authenticated acceptance and physical phone/offline proof,
  not as an unimplemented web screen.
- all of the above changes and the browser-evidence runner are ancestors of the
  successful production release `c88647750` (workflow `31522447012`). Quality,
  security, MTM/auth/i18n tests, standalone build, atomic deploy, public ping,
  feature smoke and the standard authenticated browser smoke passed. An
  independent post-deploy probe also confirmed `deploy_sha=c88647750`, PM2
  `leaddrive-v2` online with zero restarts, `/mtm/routes` redirecting an
  anonymous visitor to login, and the MTM organizations API returning `401`.
  Feature-specific authenticated MTM evidence is still pending because the
  repository has no `MTM_EVIDENCE_*` secrets. A production read-only query
  confirmed that the active `mars` tenant currently has zero CRM users and zero
  MTM agents, so the two documented demo principals cannot authenticate.
- the read-only manual workflow
  `.github/workflows/swissmed-mtm-browser-evidence.yml` now maps all 18 SWM
  scenarios to their modern routes, captures Admin/Agent desktop, tablet and
  phone-viewport evidence, and reports overflow/page/HTTP errors. Superseding
  Zeytun workflow `31548934762` passed all 84 scenario-role-viewport checks:
  54 Admin, 30 Agent and 28 per viewport. It recorded zero blocking HTTP
  errors, page/console errors, login redirects and document-level horizontal
  overflow. The runner opens the scenario-specific transfer, scoring, GPS
  history/replay and coverage states; critical paired screenshots have distinct
  hashes. This completes the authenticated web/tablet/phone-viewport evidence
  layer, but moves no Acceptance row to `DONE`: physical Android/offline proof
  and signed product rules remain authoritative open gates.

## Evidence and gaps

### SWM-01 — Organization catalogue and ownership

Evidence:

- `prisma/schema.prisma`: `MtmCustomer`,
  `MtmCustomerAgentAssignment`, `MtmOrganizationAssignmentOperation`.
- `src/app/api/v1/mtm/organizations/route.ts`: scoped list, server filters,
  sorting and pagination.
- `src/app/api/v1/mtm/organizations/facets/route.ts`: scoped facets.
- `src/app/api/v1/mtm/organizations/views/route.ts`: saved views.
- `src/app/api/v1/mtm/organization-assignments/preview/route.ts` and
  `src/app/api/v1/mtm/organization-assignments/route.ts`: preview/apply,
  conflicts, idempotency and audit.
- `src/__tests__/api-mtm-organization-assignments.test.ts`.
- `src/components/mtm/organization-explorer.tsx`: server-backed catalogue,
  advanced facets, explicit page/all-filtered selection, responsive table/cards
  and preview/apply assignment flow; saved views can be created, restored,
  marked as the default and deleted by their owner.
- `src/lib/mtm/organization-explorer.ts` and its targeted unit test: stable URL
  query, saved-view normalization and selection semantics.

Gap:

- browser/tablet/phone and assignment API integration evidence is still
  required before acceptance.

### SWM-02 — Bulk contact transfer

Evidence:

- `MtmContactAgentAssignment`, `MtmContactTransferOperation`.
- `/api/v1/mtm/contact-transfers/preview` and
  `/api/v1/mtm/contact-transfers`.
- `src/lib/mtm/contact-transfer.ts`.
- `src/__tests__/api-mtm-contact-transfers.test.ts`.
- `/mtm/contacts` exposes explicit current-page, custom and all-filtered
  selection scopes, bounded to the server transfer limit;
- managers choose the current owner, target owner and effective date, then
  review the authoritative preview before supplying an audited reason;
- conflicts and exclusions are shown per contact, and the result reconciles
  transferred versus unchanged rows without deleting the contact master or
  rewriting historical visit actors;
- the preview reports open tasks linked through the contact's visits and
  explicitly preserves their current assignee; task reassignment is never an
  implicit side effect of contact ownership transfer;
- stale previews return to editable parameters while preserving the list
  selection, and apply uses one stable idempotency key for the reviewed batch.
- implementation `b6f6ec6e8` plus type fix `2e2429a6f` adds a principal-scoped
  IndexedDB receipt, an adaptive latest-result panel and automatic/manual
  reconciliation after connectivity returns; the offline UI never queues a
  manager ownership mutation without a current authoritative preview;
- reconciliation reads the durable operation and verifies both effective-dated
  assignment rows before reporting `VERIFIED`; mismatches remain visible;
- PR checks `31255504294`, secret scan `31255504296` and blocking suite
  `31255504290` passed; all 34 targeted transfer/master-data/receipt/UI tests
  are green and the follow-up TypeScript run contains no errors in changed
  files;
- the implementation is deployed in `main` SHA `9fba23bbf`; production workflow
  `31259763860` passed security and MTM/auth/i18n gates, standalone build,
  immutable artifact staging, atomic deployment and post-deploy browser smoke;
- independent production smoke returned `200` with `db: ok`; unauthenticated
  contact-transfer reconciliation and contact list requests both returned
  `401`, confirming the new routes remain session-protected.

Gap:

- authenticated two-employee sync plus browser-offline and real-phone evidence
  is still required before Acceptance can move from `MISSING`.

### SWM-03 — Contact master card

Evidence:

- `MtmContact`, `MtmContactWorkplace`, `MtmContactChangeRequest`.
- contact detail, workplace and change-request endpoints.
- `src/lib/mtm/contact-master-data.ts`.
- current mobile visit workspace can consume contact context.
- canonical `/mtm/contacts/[id]` card is reachable from an organization and
  preserves its organization/list return context;
- personal, professional, communication and address fields are separated from
  current/historical workplaces, so a workplace move does not create a second
  person;
- phone, email, WhatsApp and contact-specific route-planning actions are
  available; the route builder keeps both organization and contact target;
- assignments, verification/consent, change requests, audit events, assessments
  and field potentials stay under the existing tenant/role scope;
- managers can edit the canonical card directly with audit and optimistic
  concurrency, while field agents submit only changed fields with a reason
  through the existing idempotent approval workflow;
- the same responsive form covers identity, professional, communication,
  address and governance fields, and exposes a mobile sticky action;
- the missing authoritative versioned brand-category relation is explicitly
  unavailable instead of being inferred from numeric potential.
- the mobile contact delta carries core identity/professional/communication
  fields, the agent's active effective assignment, workplaces, assessments
  and potentials; the separate visit projection joins back by `contactId`.
- deployed `6bccb472f` connects current workplace create/edit/end actions to the
  canonical card: managers write through the audited workplace API while field
  agents submit idempotent `WORKPLACE_UPSERT`/`WORKPLACE_END` approval requests;
- organization lookup remains server-scoped, workplace edits use optimistic
  concurrency, closing a relationship preserves it in history, and the phone
  controls retain 44px touch targets;
- PR checks `31260814146`, secret scan `31260814139` and blocking suite
  `31260814144` passed. The 21 field-master-data API tests, six contact approval
  tests and the workplace UI contract all passed, as did TypeScript compile;
- production workflow `31261182352` passed security/MTM/auth/i18n gates,
  standalone build, atomic deploy and post-deploy smoke. Independent ping
  returned `200` with `db: ok`; unauthenticated workplace/approval routes
  returned `401` and the contact card redirected to login.
- deployed `ef2f69305` adds the safe duplicate flow to the canonical card:
  an Agent searches only contacts visible in the same tenant/territory scope,
  selects a canonical record, records a reason and submits an idempotent
  `DUPLICATE_REPORT`; Manager/Admin sees the canonical target and can approve
  or reject with a mandatory decision comment;
- self-selection and duplicate/merged canonical targets are blocked both at
  submission and again inside the transactional decision path. Approval marks
  the current record `DUPLICATE` and links it to the canonical contact without
  silently moving visits, workplaces or history;
- PR #728 passed TypeScript, Gitleaks, blocking regression and static checks.
  `api-mtm-contact-change-requests` passed 7/7 and the duplicate UI contract
  passed 1/1; the full advisory run recorded 16,019 passing tests and 38 known
  failures outside this slice;
- production workflow `31262974682` passed security/MTM/auth/i18n gates,
  standalone verification, immutable staging, atomic deploy, public DB ping,
  hashed-asset and authenticated browser smoke. Independent ping returned
  `200` with `db: ok`; unauthenticated contact search/report/decision routes
  returned `401`, and the contact card redirected to login;
- deployed `0d7c4c9c1` adds a tenant-level required-field policy for the
  canonical contact. First and last name remain the non-removable baseline;
  an MTM administrator can additionally require any supported personal,
  professional, communication or home-address field;
- the policy is normalized at the settings boundary and enforced by the
  server on contact creation, direct Manager/Admin edits, Agent proposals and
  again on approval against the then-current policy. The approval check runs
  inside the serializable decision transaction, so a newly invalid request is
  rolled back instead of being partially claimed or applied;
- the responsive edit form exposes the same policy, required markers and
  localized EN/RU/AZ validation while preserving legacy tenants through the
  first/last-name-only default;
- PR #729 passed secret scan and both Social Monitoring checks. The focused
  contact approval suite passed 11/11 and policy unit suite passed 3/3;
  production workflow `31265054984` passed security/MTM/auth/i18n gates,
  standalone build, immutable staging, atomic deployment and all post-deploy
  smoke. Independent production probes returned `200` with `db: ok`, `401`
  for the protected settings/contact APIs and `307` to login for both MTM
  pages;
- deployed `c792608ff` adds the governed dictionary lifecycle required before
  contact values can become authoritative. `PSYCHOTYPE`, `PRODUCT_CATEGORY`
  and `BRAND_CATEGORY` remain separate tenant-scoped kinds with immutable
  drafts, normalized RU/AZ/EN entries, source evidence and server-computed
  SHA-256 hashes;
- activation is web-Admin-only, records an approval reference, rechecks the
  current actor and reviewed hash inside a serializable transaction, and
  retires only the previous active version of the same kind. Database RLS,
  one-active-per-kind and coherent-signature constraints provide independent
  backstops;
- MTM settings exposes a responsive governed-history UI with 44px phone
  actions. Only signed active versions are projected to mobile config, where
  they override same-named transitional settings without exposing drafts;
- contacts now hold effective-dated, version-bound assignments to the exact
  signed dictionary and entry code. Psychotype, product categories and brand
  categories remain separate; current values and immutable history are shown
  before assessment snapshots and numeric potential;
- Manager/Admin replacement is audited and conflict-protected, while Agents
  submit `DICTIONARY_ASSIGNMENTS` through the existing idempotent review flow.
  Approval revalidates the exact active dictionary, signed hash, entry code,
  contact version and assignment-state hash inside a serializable transaction;
- the database enforces tenant-composite contact/dictionary foreign keys, RLS,
  one active psychotype, unique active category codes, valid periods, matching
  dictionary kinds and entry membership. Mobile contact delta v4 carries the
  same governed projection and refreshes when an assignment changes;
- PR #730 passed secret scan, both blocking Social Monitoring checks and the
  static runner. Focused dictionary API tests passed 3/3, contract tests 4/4,
  mobile-config tests 3/3 and migration invariants 3/3; no TypeScript error
  was reported in changed paths;
- production workflow `31266687807` passed security/MTM/auth/i18n, standalone
  build, immutable staging, migration precheck, atomic deployment and all
  smoke. The deploy log confirms migration
  `20260808160000_mtm_contact_dictionaries` was applied successfully.
  Independent probes returned `200` with `db: ok`, `401` for the protected
  dictionary/mobile APIs and `307` to login for MTM settings.

Gap:

- physical record consolidation, field precedence and undo remain a separate
  signed merge policy; the deployed flow intentionally marks and links only;
- SwissMed-approved values have not been seeded or signed; the lifecycle and
  assignment UI deliberately refuse to infer values from screenshot 17;
- authenticated Manager/Agent browser and physical-device parity evidence is
  still required.

### SWM-04 — Doctor scoring and brand potential

Evidence:

- `MtmDoctorScoringFormula`, `MtmDoctorAssessment`, `MtmFieldPotential`,
  `MtmFieldPotentialEvidence`.
- scoring formula activation, assessment review and field-potential workflow
  endpoints.
- `src/lib/mtm/doctor-scoring.ts` and `src/lib/mtm/brand-potential.ts`.
- the canonical doctor card now separates the effective verified assessment
  from append-only history and exposes office, patient/bed counts, KOL, profile,
  psychotype snapshot, detailed category, actual/target arithmetic difference,
  formula version/signature, source, period, actor and review evidence;
- active brand potential is separated from full history and shows potential,
  coverage, arithmetic uncovered difference, measurement-category snapshot,
  source/formula freshness, agent dimension, provenance and supporting visits;
- authorized reviewers can verify or reject pending assessments and potential
  rows from the same workflow without mutating the recorded source values;
- managers can append a doctor assessment only against an active signed
  formula, preserving its factors, period, source and provenance;
- authorized field users can append doctor × brand potential/coverage
  measurements, select the governed agent dimension, and link only completed
  in-scope visits belonging to that agent;
- the recorder or an authorized reviewer can end a potential period with a
  mandatory reason; the record remains in history and is never deleted;
- MTM administrators can create immutable formula drafts, inspect the exact
  JSON definition and explicitly sign/activate one version from MTM settings;
  activation retires the previous version while historical assessments keep
  their recorded formula version and factors;
- formula drafts now contain a strict RU/AZ/EN professional glossary for
  balance, potential, coverage/disclosure, doctor category, KOL and profile;
  the server canonicalizes and hashes the full definition and stores its
  authoritative source, observed-at timestamp and approval reference;
- activation requires the exact SHA-256 and approval reference, while new web
  and offline assessment/potential writes receive the same server-selected
  governed glossary snapshot and formula version in append-only provenance;
- the doctor card exposes that source, approval and checksum, renders the six
  definitions in the active locale, and labels pre-governance records as
  historical instead of silently treating them as signed;
- unsigned psychotype and brand-category semantics remain visibly bounded
  instead of being promoted to authoritative master data.

Gap:

- a real SwissMed-approved glossary version still has to be entered and signed
  by the tenant administrator; the product deliberately does not invent that
  approval from screenshot 15;
- browser/tablet/phone acceptance evidence remains outstanding.

### SWM-05 — My contacts

Evidence:

- scoped `/api/v1/mtm/contacts` query;
- effective-dated contact assignments in the data model.
- dedicated `/mtm/contacts` route with URL-restored filters, server pagination,
  responsive desktop table and phone cards;
- list rows preserve professional, current workplace, communication and owner
  context, and detail navigation returns to the exact list URL;
- available owner/transfer agents are projected by the same server-side actor
  scope rather than loaded from an organization-wide browser list;
- `/api/v1/mtm/contacts/facets` returns only professional and active-workplace
  values visible through that same contact scope;
- search covers contact identity/communication plus active workplace
  organization, code and address, while URL-restored advanced filters cover
  specialty, profile, qualification, geography and organization type/kind;
- each desktop row and phone card links the latest completed visit and next
  pending point from a planned/in-progress route without inventing coverage;
- the URL/saved-view contract carries an explicit coverage month; each doctor
  row is joined to the current PRIMARY owner's signed policy and exact complete
  frozen snapshot, exposes actual/required/uncovered plus approval provenance,
  and fails closed with a specific unavailable state when any policy, period,
  row or explanation evidence is missing;
- personal/default saved views persist the sanitized URL filter contract and
  page size through the existing tenant-scoped `SavedView` model;
- managers/admins can filter the free/assigned pool and run a reviewed,
  effective-dated bulk add/remove operation for existing contacts; the server
  rechecks visit, route and future-assignment conflicts inside a serializable
  transaction, persists an idempotent result envelope and writes the audit;
- mobile initial/delta pull mirrors the web scope through either direct
  effective assignment or an accessible active workplace, republishes
  assignment/workplace/route changes and emits a deduplicated contact
  tombstone only after the complete scope is gone;
- the selection action explicitly states that assignment changes do not delete
  the master contact.

Gap:

- psychotype is deliberately absent because the only current source is an
  unsigned assessment snapshot, not authoritative contact master data;
- production still needs the real SwissMed policy package, frozen period data
  and tenant approval reference before rows can display an authoritative
  covered/gap result; the application deliberately shows the missing-evidence
  state until then;
- browser/tablet/phone and physical offline-cache acceptance evidence is
  outstanding.

### SWM-06 — Organization detail

Evidence:

- `/api/v1/mtm/organizations/[id]` supports scoped detail/update/delete and
  audit;
- canonical `/mtm/customers/[id]` detail opens from the catalogue and preserves
  the exact filter/sort/page return URL;
- summary, contacts, visits and staff projections load independently under the
  same tenant/role scope;
- all seven reference sections lazy-load under the same scoped organization
  predicate: details, contacts, visits, authoritative departments, staff,
  pharmacy promotions and private organization files;
- departments require an explicit source and observed timestamp and are never
  inferred from contact workplace text;
- commercial month/year totals are derived from non-cancelled imported sales
  documents and expose the latest import file, status and applied timestamp;
- coordinate values, assignment history and map verification are presented
  separately; a manager confirmation creates an immutable receipt for the
  exact latitude/longitude pair, source and observation date;
- organization files reuse the private MTM document store, add a composite
  tenant/customer relation and never expose the opaque storage key;
- deployed merge `489dafdf7` upgrades the mobile `customers` entity to the
  explicit `organization-core-v2` projection: it carries address and geo core,
  contact person, notes, geofence/polygon, managing manager, the current
  actor's effective assignment, accessible route points, active-contact/visit
  counts, projection version, scope contract and server `asOf` freshness;
- offline visibility now reuses the same effective-assignment-or-route
  predicate as web. Delta pulls republish relation-only assignment/route
  changes and emit one deduplicated customer tombstone only after every web
  access path has disappeared;
- PR `#731` checks passed; the focused mobile sync file passed `76/76` tests
  with no TypeScript error in either changed path. Production workflow
  `31268310002` passed quality/security/MTM/auth/i18n, standalone build,
  atomic deployment and post-deploy smoke. Independent probes returned
  `200`/`db: ok` for ping, `401` for unauthenticated mobile sync and a login
  redirect for the organization detail route.

Gap:

- real SwissMed department, commercial and file sources must still be loaded;
  the product intentionally does not synthesize absent tenant facts;
- ОКПО remains an explicit product refusal until an authoritative source is
  supplied;
- browser/tablet/phone and authenticated role-scope evidence is still required
  before SWM-06 acceptance.

### SWM-07 — My organizations

Evidence:

- deployed commit `6d051e2a9` adds a `MINE` projection to the canonical
  organization explorer; it does not create or copy organization records;
- `MINE` is an exact effective assignment predicate for the current actor,
  including exclusive `effectiveTo` boundaries; agents default to this scope
  server-side, while managers can switch between the role/team catalogue,
  themselves and permitted employees;
- the API returns actor/effective-scope evidence and the next pending route
  point only inside the actor's route/team scope, preventing another team's
  route from leaking through a shared organization;
- the common desktop grid now has a saved/configurable next-visit column; last
  and next visits drill into their source visit/route;
- the phone card provides 44px navigation and plan actions in `MINE`: navigation
  is disabled when stored coordinates are absent, and planning opens the
  existing route builder with the organization prefilled;
- targeted API/library/static UI tests cover the agent default, exact current
  assignment, route scope, saved query semantics and RU/AZ/EN copy;
- workflow evidence: secret scan `31254070959`, PR checks `31254070956` and
  deploy `31254070981` succeeded; TypeScript, full unit suite, MTM/auth/i18n,
  standalone build, atomic deploy and post-deploy smoke all passed. Manual ping
  returned `db: ok`; unauthenticated `scope=MINE` access returned `401`.
- the deployed `organization-core-v2` mobile projection makes the web scope
  available offline through both direct effective ownership and route access,
  includes explicit server freshness, and evicts the cached organization only
  after the final assignment/route path is removed. This is the same deployed
  `489dafdf7` / PR `#731` evidence recorded under SWM-06.

Gap:

- coverage state and distance require governed snapshot/location evidence and
  are not inferred from stale or absent data;
- the application now has the fail-closed signed package mechanism for
  `Лиц.`, `Категория МО` and polygon: drafts resolve exact Etalon IDs, freeze
  multilingual rows by SHA-256, require web-ADMIN exact-hash activation and
  retain source/approval metadata; active values feed scoped filters, dense
  columns and the new `organization-core-v3` mobile delta sync, while absent
  values remain explicitly empty;
- production still needs the real SwissMed package and approval reference;
- authenticated manager/agent browser evidence, physical-phone evidence and
  physical offline-cache evidence remain to be recorded, so acceptance is
  `MISSING` and phone/offline remains `PARTIAL` despite the verified sync
  contract.

### SWM-08 — Dense organization grid

Evidence:

- deployed commit `2da056988` extends the existing canonical organization
  explorer instead of creating a second list;
- the server list keeps tenant/actor scope, server filters/sort/pagination and
  now returns only the latest completed, non-deleted, tenant-scoped visit per
  organization; page size remains bounded to 200;
- the desktop/tablet grid has row numbers and explicit page selection, separate
  Etalon ID, organization/address, kind, K.O./specialization, location, owner,
  last visit and activity columns; identity and action columns are sticky;
- column visibility/order/width and compact/comfortable density are sanitized
  and persisted in saved views; visible-column page export and bounded
  all-filtered export share the existing 500-record bulk ceiling;
- arrow/Home/End keyboard navigation and accessible headers are present;
- the phone projection is a task-focused card with 44px actions, factual last
  completed visit evidence and read access for non-manager roles;
- `src/__tests__/mtm-organization-grid-ui-contract.test.ts`,
  `src/__tests__/lib-mtm-organization-explorer.test.ts` and
  `src/__tests__/api-mtm-field-master-data.test.ts` cover UI, saved layout,
  paging ceiling and latest-visit scope;
- workflow evidence: secret scan `31253117643`, PR checks `31253117671` and
  deploy `31253117666` succeeded; the production workflow passed TypeScript,
  the full unit suite, MTM/auth/i18n gates, standalone build, atomic deploy and
  post-deploy smoke. Manual ping returned `db: ok`; unauthenticated list access
  returned `401`.

Additional implementation:

- the signed SWM-07 organization attribute package adds configurable
  `Категория МО` and `Лиц.` columns/filters to this same grid and saved-view
  contract; missing or unsigned values render as not provided rather than a
  fabricated boolean;

Gap:

- production needs the real SwissMed attribute package before `Лиц.` values
  can appear;
- authenticated browser evidence at 200% zoom and with a 1,000+ record tenant
  dataset is not recorded;
- physical phone/device and offline replay evidence are not recorded; the
  `organization-core-v3` projection contract exists, but phone/offline
  acceptance remains `PARTIAL` and overall acceptance remains `MISSING`.

### SWM-09 — Pharmacy promotions

Evidence:

- deployed tenant/RLS-aware promotion type, signed formula/policy, immutable
  campaign version, pharmacy target, visit-linked execution, evidence,
  two-level review, operation, reward and append-only ledger domain;
- server APIs cover target planning and reasoned eligibility override, field
  fact/evidence/submit, calculation preview, L1/L2 and exact-ID bulk decisions,
  saved views and snapshot-bound export with current manager/team scope;
- negative API tests hide out-of-scope employees/executions; version CAS,
  self-approval policy, request/selection hashes, stable idempotency and
  compensating entries are covered by focused API, contract, outbox and
  migration suites;
- `/mtm/promotions` provides dense filters, plan/fact/points, current step and
  next responsible, detail audit history, responsive desktop/tablet/phone
  projections and RU/AZ/EN copy; field drafts use an identity-bound IndexedDB
  outbox and stable client identifiers;
- commits `abe350dbf`, `9809273fb` and `b71f7c08f` are deployed. Secret scan
  `30717776649`, PR checks `30717776652` and deployment `30717776646` passed;
  the workflow applied migration
  `20260801170000_mtm_pharmacy_promotion_workflow`, passed 967 mandatory
  MTM/auth/i18n tests, built production and completed atomic smoke;
- production ping, unauthenticated boundaries and a read-only authenticated
  Mars page/execution/campaign/saved-view smoke all returned the expected
  successful contracts.
- production checkpoint `819f1ab99` persists promotion evidence metadata and
  the binary `Blob` together in the identity-bound IndexedDB outbox, replays it
  as multipart with stable execution/evidence/document/operation identifiers,
  and fails closed if the persisted binary is absent or inconsistent. PR
  checks `31271128432` passed the focused outbox (`20/20`) and UI-contract
  (`6/6`) suites; both mandatory Social Monitoring gates and Secret Scan
  passed. Deploy workflow `31271526327` completed quality, production build,
  atomic deployment and smoke; independent production probes returned ping
  `200`, evidence-without-session `401` and page-to-login `307`.
- deployed checkpoint `f7eb81f25` adds the administrator-only signed-definition
  catalog for promotion types, points formulas and L1/L2 policies. Drafts
  require localized names plus source provenance; formula/policy activation
  submits the immutable server SHA-256 and an approval reference, with no
  guessed commercial defaults. PR checks `31272682579` passed the focused UI
  contract (`7/7`), mandatory gates and Secret Scan. The intervening voice
  route RLS gap was closed by `5da300ff8`; scanner reports zero gaps and deploy
  workflow `31273357580` passed quality, build, atomic deploy and smoke.
- deployed checkpoint `265fdf580` adds the administrator campaign lifecycle:
  sourced campaign-root creation, immutable revision authoring against active
  type/formula/policy definitions, server-hash-bound publish and reasoned
  hash-bound retirement. Required localized names, explicit IANA timezone,
  eligibility JSON and approval references keep the UI fail-closed without
  invented commercial defaults. PR checks `31275575315` passed the focused UI
  contract (`8/8`), mandatory gates, Secret Scan and Social E2E. Deploy workflow
  `31275945498` passed quality/security, standalone build, atomic production
  deployment and post-deploy smoke; independent probes returned ping `200`,
  unauthenticated create/publish `401` and workspace-to-login `307`.

Gap:

- exact SwissMed formula, eligibility, reward and L1/L2 definitions remain
  product-blocked and production posting therefore remains disabled by default;
- local Node checks for the binary-evidence checkpoint were `NOT RUN` because
  `user.slice` was at 8.34 GB against its 8.59 GB high-water mark. Zeytun
  workflow `31548934762` now supplies task-specific authenticated Admin/Agent
  desktop, tablet and phone-viewport evidence, while physical Android
  kill/restart/reconnect evidence remains missing. Therefore Web/tablet UI,
  Phone/offline and Acceptance stay PARTIAL/BLOCKED rather than DONE.

### SWM-10 — GPS history

Evidence:

- `MtmAgentWorkday`, `MtmAgentWorkdayEvent`, `MtmAgentLocation`, route points
  and completed visit facts remain the canonical raw evidence;
- deployed commits `4e5fdd3fa` and `8d3e71706` add the scoped
  `/api/v1/mtm/location-history` contract with server-pinned tenant timezone,
  date/time range, accuracy threshold, bounded raw/output limits,
  deterministic first/last-preserving downsampling and one versioned
  Haversine distance formula;
- stop, telemetry-gap, impossible-jump, missing-segment and low-accuracy
  derivations remain distinct from confirmed visits. A stop only carries an
  organization confirmation when an actual overlapping visit exists;
- the response correlates workday start/end, route versions/points, visits and
  organization rows, reports truncation/rejection counts and writes a GPS
  history audit record; scoped CSV export reuses the same actor/date contract;
- `/mtm/map` has a responsive `History` mode with employee/date/time/accuracy
  controls, distance and quality summary, workday/organization table, raw
  point/stop drill-down and map layers rather than compressing the live view;
- current production workflow `31268310002` reran the mandatory MTM/auth/i18n
  gate (`1007/1007`); `api-mtm-location-history.test.ts` passed `6/6`, the
  standalone build and atomic production smoke also passed.
- deployed `main` SHA `02296f78a` closes the server-side tracking boundary:
  live mobile points require a current `STARTED`/`PAUSED` workday; queued
  offline points require an explicit owned workday and a capture timestamp
  inside its start/end interval. The write transaction rechecks that interval,
  while an already accepted `clientLocationId` remains replay-safe after close;
  production workflow `31269715002` passed the mandatory MTM/auth/i18n gate,
  standalone build, atomic deploy and post-deploy smoke.
- presentation commit `e73b55e93` and translation hotfix `f95e50eba` keep all
  displayed moments in the server-pinned tenant timezone, localize domain
  statuses and preserve separate scalar/dictionary translation contracts.
  PR `#747` merged as `abe2b8eef`; production workflow `31310378651` passed
  every gate, build, atomic deploy and smoke step. Independent probes returned
  ping `200` / `db: ok`, `/mtm` `307` to login and history API `401` without a
  session.

Gap:

- retention and stop-detection values are tenant settings but are not yet a
  signed/versioned SwissMed policy;
- authenticated Manager/Agent browser evidence at desktop/tablet/phone sizes
  and physical-device history evidence are not recorded, so Acceptance stays
  `MISSING` and Phone/offline stays `PARTIAL`.

### SWM-11 — Actual day replay

Evidence:

- the same deployed history contract returns a deterministic UTC timeline that
  merges workday boundaries, immutable route/version planned stops, actual
  visits, GPS stops, telemetry gaps and quality anomalies with stable IDs and
  explicit source/confirmation fields;
- plan, actual, stops, visits and gaps are independently switchable layers;
  stop/visit rows link back to their real MTM entities, while gaps and low
  accuracy are labeled evidence warnings rather than visits;
- server-pinned timezone prevents a query parameter from changing the day's
  facts, historical route/version evidence is not rewritten by reassignment,
  and mobile location idempotency retains `clientLocationId`/`recordedAt` so a
  repeated offline sync does not duplicate a point;
- the deployed mobile ingest gate binds every newly accepted coordinate to a
  real owned workday and rejects capture outside its temporal boundary without
  breaking idempotent replay of an already accepted point;
- scoped CSV export and GPS-history read each have explicit audit actions;
  implementation `266fbe853` and documentation checkpoint `d0c74681d` are in
  production merge `8d706bc9d`; workflow `31312656786` completed
  quality/security, build/stage and deploy/smoke, with an independent `db: ok`
  ping plus expected anonymous login redirect/`401` boundaries.
- SWM-11 adds a true deterministic player over accepted points with
  play/pause/restart, rate selection and an accessible scrubber. The actual
  route and time-bound stop/visit/gap/workday evidence reveal progressively,
  the current point is distinct by size and outline, and fitting continues to
  use the full-day bounds so playback does not move the user's frame;
- each derived stop now carries first/last available battery evidence in
  addition to timestamps, duration, accuracy and connectivity; organization
  name/address remain conditional on a stored overlapping visit fact.

Gap:

- authenticated browser evidence exercising the new playback/scrub controls
  against the screenshot sequence has not yet been recorded;
- a physical-device test proving the cached route/timeline remains usable
  without new map tiles is still missing.

### SWM-12 — Live team map

Evidence:

- `/api/v1/mtm/locations` resolves the authenticated MTM actor and enforces
  tenant plus manager/team/region scope before returning the roster, events,
  markers, or history; negative API coverage proves an employee outside scope
  is absent;
- `src/lib/mtm/live-location.ts` keeps GPS freshness independent from workday
  state and has boundary tests for online/delayed/stale thresholds;
- `/mtm/map` and `src/components/mtm/live-map.tsx` expose team/employee filters,
  latest accepted timestamp, accuracy, battery, explanatory no-location states,
  bounded 500-person roster/viewport contract, non-overlapping polling, manual
  cooldown and preserved agent/date history context;
- employees without a coordinate remain in the roster without producing a map
  marker; stale markers differ by shape and opacity rather than colour alone;
- country-scale rendering groups nearby employees in deterministic Web
  Mercator screen cells instead of silently dropping the roster at the Leaflet
  marker cap; each group retains online/delayed/stale counts, expands on click,
  and the focused employee always remains an individual marker;
- RU/AZ/EN messages are present and responsive desktop/tablet/phone composition
  is implemented;
- CI security gates, MTM/auth/i18n tests, production build and deployment passed
  for deployed `main` SHA `546b4163c` in workflow `30688142715`; production ping
  returned `200`, unauthenticated locations returned `401`, and the map route
  redirected to login.

Gap:

- feature-specific authenticated browser evidence at desktop/tablet/phone
  viewports and Android physical-device evidence are still missing;
- the 500-person bounded contract is tested structurally but needs a production-
  representative large-team interaction trace before full acceptance;
- local Node checks were `NOT RUN` because Node is absent on the host; CI is the
  recorded executable evidence.

### SWM-13 — Plan/GPS KPI

Evidence:

- deployed `src/app/api/v1/mtm/kpi/route.ts` and snapshot-bound CSV export use
  authenticated module permission plus server-resolved tenant/current
  manager/team/employee scope; negative API coverage excludes an employee
  outside that scope before fact reads;
- `SWM_PLAN_GPS_V1` exposes plan/GPS numerator and denominator, baseline and
  reasoned append-only exclusions, source facts, GPS-day evidence, source
  freshness, completeness and snapshot identity;
- period/team/employee/visit-type/brand filters apply consistently across UI,
  export and fact ledgers; potential revision validity, tenant-local dates,
  joint attribution and coordinate quality have focused regressions;
- `src/components/mtm/explainable-kpi-dashboard.tsx` adds compact attainment,
  plan/fact bars, plan/GPS lines, searchable filters and fact/GPS-day audit
  drill-down without removing the older analytics sections; RU/AZ/EN keys and
  responsive desktop/tablet/phone compositions are implemented;
- the screenshot's dynamics detail is restored as day/week/month/quarter
  aggregation over the same filtered daily facts; aggregate ratios are
  recomputed from summed numerators and denominators, and the period summary
  exposes plan, fact, execution and GPS evidence together;
- the trend-detail follow-up commits `57f46bd2b` and `d8f21383d` are contained
  in deployed merge `2aa6e8ca3`; workflow `31314137688` passed all
  quality/security, build/stage and deploy/smoke jobs, after which production
  ping returned `db: ok`, `/mtm/analytics` redirected to login, and KPI plus
  KPI-export APIs rejected anonymous requests with `401`;
- mobile KPI evidence semantics were aligned, and the legacy analytics API,
  cache and XLSX export were hardened to current primary-owner actor scope;
- current branch adds tenant-scoped `MtmKpiPolicy`: an administrator uploads a
  versioned package, the server validates the exact supported plan/GPS contract
  and reproduces every embedded reconciliation case, then signs the reviewed
  SHA-256 plus approval reference under a tenant activation lock and audit;
- a complete live result is now authoritative only when one coherent signed
  policy covers the entire requested period; without it the dashboard says the
  formula is not approved and both the UI and direct CSV endpoint refuse an
  official export. Approved exports carry policy code/version/hash/document and
  effective dates, binding UI and export to the same reviewed definition;
- MTM settings now provide the administrator upload/preview/confirmation/
  activation workflow in RU/AZ/EN; mobile principals and non-admin web actors
  cannot configure or sign KPI policy;
- checked-in engineering reference fixture SHA is verified; Secret Scan, full
  PR typecheck/unit suite, deploy MTM/auth/i18n gates, production build and
  deployment passed for implementation commit `331fe4ead`, contained in
  deployed `main` SHA `2172932b3` (workflow `30692766772`);
- production ping returned `200` with `db: ok`; unauthenticated KPI, KPI export
  and legacy analytics returned `401`, and the analytics page redirected to
  login.

Gap:

- SwissMed must still supply and approve the real tenant KPI package; the
  checked-in fixture remains engineering evidence and does not impersonate
  product approval. Until then production correctly remains non-authoritative;
- closed KPI results are snapshot-bound for a response/export pair but are not
  a separately frozen reporting warehouse fact; if statutory period locking is
  required, that is a new retention/reporting requirement rather than a hidden
  promise of this operational dashboard;
- the screenshot's `Tasks` tooltip value has no signed cohort/formula or
  defined behavior for visit-type/brand filtering, so it remains deliberately
  absent rather than being represented by a fabricated KPI;
- authorization and team filters use current roster membership, so a closed
  period's accessible team cohort can change even though route/visit
  attribution itself is historical;
- Zeytun workflow `31548934762` supplies authenticated desktop, tablet and
  phone-viewport browser evidence for this feature. The unsigned tenant KPI
  package remains visible as a deliberate fail-closed product gate;
- physical Android evidence is still missing, so mobile/offline parity and
  Acceptance remain incomplete;
- local Node checks were `NOT RUN` because Node/npm/npx are absent on the host;
  the successful CI typecheck/full unit suite is the executable evidence.

### SWM-14 — Task card and recurrence

Evidence:

- deployed `/mtm/tasks` and `/mtm/tasks/[id]` expose the scoped task workspace,
  role/status actions, timeline, files, progress, review/return, duplicate,
  reassignment, print and return-context contracts;
- web and mobile APIs enforce current tenant/team/assignee scope, version CAS,
  terminal-state immutability, append-only audited evidence and idempotent,
  tombstone-aware retries; negative API tests exclude out-of-scope principals;
- recurrence has planned-time fields, pinned timezone/DST, immutable occurrence
  cursor and monthly-anchor semantics, `THIS` / `THIS_AND_FUTURE` propagation,
  preview and exact-once spawning;
- durable browser execution/document outboxes, mobile sync alignment, RU/AZ/EN
  copy and responsive desktop/tablet/phone projections have focused tests;
- commits `3cb5df392` and `a2f3a094b` are deployed as `main` SHA `a2f3a094b`;
  Secret scan `30707495380`, PR checks `30707495399` and workflow `30707495385`
  passed quality/security gates, Prisma generation, MTM/auth/i18n tests,
  production build and atomic deployment;
- production ping and unauthenticated task boundaries passed; a read-only
  authenticated Mars-tenant smoke returned `200` for the task page, scoped list
  and detail APIs.
- the 2026-08-09 re-audit compared the fifth supplied SwissMed image with the
  current create/edit/detail/action workspace: schedule, status transitions,
  priority, responsible employee, event, description, place, organization,
  recurrence, duplication, progress, files and save/exit semantics are present.
  The legacy `Group` selector is now implemented through a separate immutable,
  administrator-signed `TASK_GROUP` dictionary rather than being incorrectly
  mapped to employee team or source metadata. Tasks pin the exact dictionary
  version and code; create/edit, `THIS_AND_FUTURE`, recurrence spawning, web and
  mobile duplication, mobile config/pull and localized detail rendering preserve
  the governed value. With no active signed dictionary, authoring fails closed
  and historical retired values remain readable;
- implementation checkpoint `a5a66efa7` is tracked by PR #754 with a dedicated
  migration and focused signed-hash/task-group tests.

Gap:

- Zeytun workflow `31548934762` supplies authenticated Admin/Agent desktop,
  tablet and phone-viewport task-card evidence;
- the real SwissMed task-group entry set and approval reference must still be
  supplied and activated by the tenant administrator; the product does not
  infer those values from the screenshot;
- physical Android evidence has not proved offline progress/file recovery across
  an actual process restart;
- local Vitest/typecheck/i18n/build were `NOT RUN` because Node/npm/npx are
  absent on the host; CI is the executable evidence. Phone/offline and
  Acceptance remain PARTIAL until physical-device proof and approved task-group
  values are available.

### SWM-15 — Coverage, cancellation and task dashboard

Evidence:

- coverage now has tenant-scoped, versioned and administrator-signed policy
  definitions plus immutable employee-period snapshots, subject rows and
  reconciled group/overall totals; DB guards and coherent retired-policy reads
  preserve closed periods when ownership or a formula version changes;
- the importer validates tenant population, source evidence, localized row
  explanations, policy hash, rounding and totals before a Serializable atomic
  `BUILDING → FROZEN` transition; exact retries are idempotent and conflicting
  closed-period imports fail closed;
- the operational home reads only the selected employee/month frozen snapshot,
  renders signed RU/AZ/EN totals and explicit loading/offline/unsigned/missing/
  invalid/incomplete states, and never reconstructs the unknown screenshot
  formula in the browser;
- managers can expand a group into bounded uncovered rows with a verified
  localized explanation, safe contact/customer links and an internal planner
  transition preserving `returnTo`; source evidence and hashes are not exposed;
- coverage checkpoints `ad6c27d14`, `de22634f8`, `d63163fed` and `b1f819d37`
  are deployed. For the final slice Secret scan `31250736116`, PR checks
  `31250736123` and deploy workflow `31250736110` passed TypeScript, unit,
  MTM/auth/i18n, standalone build, atomic deploy and all post-deploy smokes;
- production ping returned `200` with `db: ok`; unauthenticated snapshot import
  and uncovered-row reads returned `401`.
- checkpoint `a6b22c9e0` adds the missing administrator-facing workflow to MTM
  settings: an immutable policy registry, reviewed JSON policy upload, exact
  SHA-256 activation with approval reference, and reference snapshot upload
  with doctor/pharmacy/totals preview. Non-admin users do not see the surface,
  while the existing server validators remain authoritative for every write.

- cancellation workflow reuses the published-route approval source of truth:
  planned points expose normalized reason taxonomy, requester/time, decision
  comment, reviewer capability and deterministic planned/eligible impact in
  the bounded operational-week response;
- agents can submit cancellation requests from a pending published point;
  managers in current server scope can approve, reject or return them from the
  exception rail, while out-of-scope and self-review requests remain hidden or
  non-actionable;
- approval, point removal, route/published version advancement, total-point
  recalculation, requester/co-assignee notifications and audit are committed in
  one Serializable transaction; started or already-resolved points fail closed;
- reschedule preserves the original subject and planned time, removes the
  published source point and adds a replacement to the employee's existing or
  new draft route in the same Serializable transaction; effective target
  validity, duplicate subject, active-visit, 180-day and enforced work-calendar
  guards fail before mutation, and the completed queue card links the
  destination route/date;
- implementation `fb79b6819` plus test fix `e5f975afa` is in production.
  Secret Scan `31244536209`, PR checks `31244536181`, deploy quality gates,
  standalone build, immutable artifact, atomic switch, DB ping and asset smoke
  passed in workflow `31244536198`; its final unrelated Social Monitoring
  browser smoke failed on missing `#profile-name` after the successful switch;
- reschedule implementation `fe27a7728` plus locale/audit fix `438219ca3` is in
  production. Secret Scan `31245674744`, PR checks `31245674754` and deploy
  workflow `31245674757` passed MTM/auth/i18n tests, TypeScript compile-check,
  standalone build, immutable artifact, atomic switch, public DB/asset and
  authenticated Social Monitoring smoke;
- deployed `GET /api/v1/mtm/week` reads the current employee task queue in a
  bounded query independent of the selected reporting period; tenant,
  employee and non-terminal status constraints are applied before facts leave
  the database, and terminal period rows cannot mask current exceptions;
- the queue classifies and stably orders overdue, returned and active work,
  preserves the authoritative task status/version, exposes start/due dates and
  return reason, and excludes its clock-relative attention label from snapshot
  identity;
- the operational home shows the task source-of-truth as an exception-first
  responsive rail with RU/AZ/EN state and priority labels, five-row summary,
  employee-filtered full-list link and direct SWM-14 detail links preserving
  the dashboard return context;
- cached task attention advances at the exact due boundary and refreshes when
  the app becomes visible; successful create/edit/delete/review/duplicate/
  execution/bulk-reassignment mutations invalidate retained week snapshots;
- implementation checkpoint `6a92ff68f` is deployed. Secret scan
  `31243182452`, PR checks `31243182229` and production workflow
  `31243182222` passed. The blocking deploy gate ran 75 MTM/auth/i18n files
  and 975 tests, including 40 `api-mtm-week` tests; the standalone build,
  atomic deploy, public DB ping and hashed asset smoke passed;
- post-deploy `/api/v1/ping` returned `200` with `db: ok`, the unauthenticated
  Mars week endpoint returned `401`, and `/mtm` redirected to login.
- checkpoint `e1cdd016b` removes the five-row blind spot from the cancellation
  rail, adds an exact shown/total counter plus reveal/collapse action, and gives
  compact/desktop copies unique label/control identities. PR `#745` merged as
  `d38ea510b` and shipped in `main` SHA `76f1d59e6` through workflow
  `31308172116`: MTM/auth/i18n, production build, immutable staging, atomic
  deploy, scheduler, DB ping and asset smoke passed. The overall workflow was
  red only after deployment because the unrelated Social Monitoring browser
  locator detached during a wizard click; independent MTM probes returned
  ping `200` / `db: ok`, `/mtm` login redirect and week API `401` without a
  session.

Gap:

- the coverage domain is deployed, but the SwissMed tenant has not supplied and
  signed its real population/metric rules or an anonymized reference batch, so
  no production coverage values are fabricated from the screenshot; the UI
  path to load and sign that external product evidence is now implemented;
- coverage and GPS formulas remain product-evidence blocked, and SWM-13
  reconciliation against the same signed fact set is not yet proven;
- authenticated desktop/tablet/phone evidence for cancellation/task rails and
  coverage drill-down, accessibility/200% zoom and physical Android offline-sync
  evidence remain missing, so SWM-15 stays PARTIAL.

### SWM-16 — Filter-led planning

Evidence:

- deployed `GET /api/v1/mtm/routes/candidates` reads only the selected
  employee's effective contact/customer assignments and supports doctors or
  pharmacies, 5/7-day or monthly windows, scoped text/geo/organization/
  specialty/psychotype facets and name/priority/last-visit/coverage-gap sorts;
- the route builder preserves selected stops while filters change, shows work
  calendar and existing-plan conflicts, and writes contact-specific targets to
  the same route draft used by every other planning surface;
- `MtmRoute.version`, optimistic update checks, publish snapshots and route
  change requests protect published plans from silent overwrite; the mobile
  week/sync contracts read the published version;
- implementation checkpoints `d19334dcb` (candidate search), `84f8b5287`
  (versioned publish) and `8365b3fed` (planning matrix) were previously
  deployed with green workflow sets `30510724866/30510724867/30510724868`,
  `30512817222/30512817212/30512817232` and
  `30514306303/30514306301/30514306329` respectively;
- checkpoint `24acf5f99` removes the unsigned hard-coded preview: planner
  candidates now read the same coherent signed/frozen SWM-15 snapshot as the
  operational dashboard, expose localized subject explanations, sort loaded
  candidates by exact scale-4 uncovered MOI and fail closed when policy,
  snapshot or explanation integrity is invalid;
- Secret scan `31251970946`, PR checks `31251970970` and production workflow
  `31251970896` passed. Evidence includes TypeScript, the full unit suite,
  MTM/auth/i18n gates, standalone build, immutable artifact, atomic deploy,
  DB/assets smoke and the workflow browser smoke;
- independent post-deploy `/api/v1/ping` returned `200` with `db: ok`; the
  candidate and coverage endpoints returned `401` without a session;
- the 500-row bound remains explicit. When coverage-gap sort is only within
  the loaded window, the UI tells the operator to narrow filters rather than
  pretending the ordering is global;
- checkpoint `7904b5b56` adds the separate organization selector visible in
  the reference, a sticky and reversible scope/filter summary, touch-sized
  controls, honest rendered/total counts and 50-row incremental rendering;
  switching to pharmacies clears doctor-only hidden constraints;
- PR `#742` merged as `47bbcce65`; all four PR checks passed and production
  workflow `31305694977` passed MTM/auth/i18n, standalone build, immutable
  staging, atomic deploy, DB/assets and browser smoke. Independent production
  probes returned `db: ok` with 3 ms latency, login redirect for `/mtm`, and
  `401` for the unauthenticated candidates endpoint.

Gap:

- SwissMed has not signed a daily capacity policy, so current workload and
  non-working days are shown but no guessed capacity limit blocks a plan;
- frozen base coverage is evidence, not a what-if forecast: changing a route
  cannot recalculate future coverage until the tenant supplies the approved
  transition rule and source facts;
- authenticated desktop/tablet/phone evidence, keyboard/200% zoom evidence and
  physical-device published-plan offline acceptance are still missing.

### SWM-17 — Weekly operational home

Evidence:

- deployed `GET /api/v1/mtm/week` and
  `POST /api/v1/mtm/week/workday` enforce authenticated MTM permission, tenant
  and fresh current manager/team/employee scope; AGENT access is self-only and
  negative API coverage rejects an out-of-scope employee before fact reads;
- the bounded 1/5/7-day contract reads published route versions, reconciles
  actual visits and cancellations, reports independent workday/GPS state and
  exposes explicit completeness/truncation;
- `src/components/mtm/operational-week-home.tsx` adds role-adaptive manager
  filters, employee day agenda, coverage, plan-change and active-task queues;
  visit, contact, organization, route and GPS-history links preserve week
  context;
- workday mutations share the per-agent concurrency fence, are idempotent,
  server-time bounded and audited; managers remain read-only;
- exact tenant/viewer/employee/window/filter-bound offline snapshots, bounded
  retention, authorization purge, request timeout and retained-GPS aging have
  focused tests; RU/AZ/EN copy and responsive desktop/tablet/phone compositions
  are implemented;
- implementation commit `4a338c7f8`, CI parsing fix `9f2621d46` and fixture
  checkpoint `b3d1de599` are contained in deployed `main` SHA `60d6a60a2`;
  Secret Scan `30700552740`, full PR typecheck/unit tests `30700552793` and
  deploy MTM/auth/i18n gates, production build and deployment `30700552751`
  passed; production ping, unauthenticated API boundaries and an authenticated
  Mars-tenant SWM-17/SWM-12 read-only smoke passed.
- lifecycle checkpoint `02296f78a` makes the workday an enforced server
  boundary for mobile GPS: live tracking cannot start without an active
  workday, completed-day backlog must carry an owned `workdayId` and an
  in-window `recordedAt`, and the boundary is rechecked in the coordinate write
  transaction. PR checks `31269439375` passed the focused files
  (`api-mtm-detail` 43/43 and `api-mtm-notifications` 16/16); production workflow
  `31269715002` passed mandatory MTM/auth/i18n, build, atomic deploy and smoke.
- checkpoint `7cb734ec9` adds an explicit current-day recovery state for GPS
  permission denial or a missing coordinate, with scoped GPS-history and
  bounded refresh actions in RU/AZ/EN. PR `#744` merged as `cfeaa41d3`; all
  four PR checks passed and production workflow `31306921609` passed quality,
  MTM/auth/i18n, standalone build, atomic deploy and all post-deploy smokes.
  Independent production probes returned `db: ok`, `/mtm` login redirect and
  `401` for the unauthenticated week endpoint.
Gap:

- the server-scoped full task card and cancellation approval are delivered in
  SWM-14/SWM-15; `M` / `K` / print semantics still require product confirmation;
- device permission/background-access telemetry remains incomplete; the
  server-side lifecycle gate and user-facing denial/missing-location recovery
  guidance are complete;
- Zeytun workflow `31548934762` supplies feature-specific authenticated
  Admin/Agent desktop, tablet and phone-viewport evidence; physical Android
  evidence is still missing;
- local Node checks for the lifecycle checkpoint were `NOT RUN`: `user.slice`
  was at 7.81 GB against its 8.59 GB high-water mark. External CI is the
  recorded executable evidence for that checkpoint.

### SWM-18 — Contact-by-date matrix

Evidence:

- `src/components/mtm/route-planning-matrix.tsx` is a second projection of the
  same candidate/read and route/version contracts used by the route builder;
- the desktop/tablet projection virtualizes dense contact rows, pages monthly
  date columns, exposes workday/conflict/published states and applies scoped
  additions/removals through an explicit preview;
- the phone projection presents the same candidates as an unscheduled queue
  with touch-sized date actions rather than shrinking the whole matrix;
- monthly visit counts keep source drill-down, candidate rows preserve
  contact + organization identity, and verified SWM-15 uncovered values and
  localized explanations are visible without changing the fixed row rhythm;
- checkpoints `8365b3fed` and `24acf5f99` provide the shared matrix and governed
  coverage integration; focused API and static UI contracts prove that both
  surfaces use the same signed snapshot and keep unsigned capacity explicit.
- checkpoint `d307204d6` restores the reference-visible last-visit fact, applies
  app-locale date formatting, makes row/date/all scopes explicit, adds arrow and
  Home/End navigation across virtualized cells, keeps staged phone selections
  reversible, and names every changed contact/date before persistence;
- PR `#741` passed TypeScript and unit checks in `31303806884`, secret scan in
  `31303806903`, and the blocking plus browser platform regression jobs in
  `31303806890`. The platform browser run is regression evidence only; it is
  not represented as an authenticated SWM-18 screenshot/device acceptance.

Gap:

- live capacity/coverage what-if after each cell change remains product-rule
  blocked; the current preview truthfully describes the frozen source period;
- Zeytun workflow `31548934762` supplies authenticated rendering evidence for
  the desktop, tablet and phone projections. Keyboard operation, focus order,
  sticky behavior and 200% zoom still require a dedicated accessibility pass;
- physical-device offline/conflict acceptance for the published plan is still
  missing, so the scenario is not accepted as full SwissMed parity.

## First implementation checkpoint

The first code slice is SWM-01A/B because its data/API/security foundation is
already present and it unlocks organization facets and ownership for later
planning work.

Required exit evidence:

1. `/mtm/customers` reads `/api/v1/mtm/organizations` with server paging.
2. Basic and advanced filters map to the API contract.
3. Row, page and all-filtered selection have explicit meanings.
4. Bulk assignment always runs preview before apply.
5. Conflicts and result reconciliation are visible.
6. Desktop/tablet and phone projections preserve the same task.
7. RU/AZ/EN keys and targeted tests pass.
