# Workforce HRM — completion roadmap

> **Status:** active planning roadmap; schema/mobile/pilot owner gates remain open
> **Date:** 2026-08-30
> **Scope:** employee time, attendance evidence, offices and branches, schedules,
> HR requests, exceptions, device trust, mobile application, privacy, export,
> operations and controlled rollout
> **Current implementation branch:** `codex/implement-hrm-plan`
> **Baseline inspected:** `ffb412f15`
> **Related documents:**
> [`mtm-hrm-module-plan-2026-08-28.md`](./mtm-hrm-module-plan-2026-08-28.md),
> [`workforce-pilot-rollback-retention-runbook-2026-08-28.md`](./workforce-pilot-rollback-retention-runbook-2026-08-28.md),
> [`workforce-h6-pilot-evidence.md`](./workforce-h6-pilot-evidence.md),
> [`workforce-hrm-h0-baseline.md`](./workforce-hrm-h0-baseline.md),
> [`workforce-c0-foundation-evidence-2026-08-30.md`](./workforce-c0-foundation-evidence-2026-08-30.md),
> [`workforce-c1-provenance-evidence-2026-08-30.md`](./workforce-c1-provenance-evidence-2026-08-30.md),
> [`workforce-c1-audit-projection-evidence-2026-08-30.md`](./workforce-c1-audit-projection-evidence-2026-08-30.md),
> [`workforce-c3-schedule-snapshot-evidence-2026-08-30.md`](./workforce-c3-schedule-snapshot-evidence-2026-08-30.md),
> [`workforce-c2-schedule-safety-evidence-2026-08-30.md`](./workforce-c2-schedule-safety-evidence-2026-08-30.md),
> [`workforce-c3-timezone-matrix-evidence-2026-08-30.md`](./workforce-c3-timezone-matrix-evidence-2026-08-30.md),
> [`workforce-c3-bulk-preview-evidence-2026-08-30.md`](./workforce-c3-bulk-preview-evidence-2026-08-30.md),
> [`mobile-sync-v2-workforce-contract.md`](./mobile-sync-v2-workforce-contract.md)

## 1. Purpose and honest starting point

This roadmap completes the gap between the H0-H6 server/web foundation and a
real HR attendance product. It is written for the concrete target scenario:

- Workforce HRM is commercially and technically separate from Route & Field;
- an employee may work in an office, remotely, in the field or in several
  branches during one day;
- HR must know the expected schedule and receive explainable evidence of
  arrival, departure, breaks and site transitions;
- a manager must resolve exceptions rather than silently rewrite facts;
- a stolen/shared account, forwarded QR, spoofed GPS or untrusted device must
  not be presented as proof that the named employee was physically present;
- the employee mobile application does not exist yet and is a first-class
  delivery stream, not an already-completed H2/H5 artifact.

The current code is a useful foundation: tenant/capability separation,
idempotent workday transitions, immutable facts and corrections, policy/shift
snapshots, a deterministic timesheet calculation, QR replay protection and a
device-key lifecycle. It is **not yet** safe to use as automatic evidence for
payroll, disciplinary action or physical-presence claims.

### 1.1 H0-H6 completion map

| Original phase | Honest current status | Remaining release gap |
|---|---|---|
| H0 contract/baseline | **PARTIAL** | Decisions are recorded, but production counts, latency, outbox age and physical baseline remain `NOT RUN` |
| H1 independent capability | **DONE foundation** | Must remain covered as new sites/evidence/jobs/mobile routes are added |
| H2 basic HRM | **PARTIAL** | Separate manager web exists; employee Workforce web/mobile experience and physical accessibility evidence do not |
| H3 policies/shifts/timesheet | **PARTIAL — gate not met** | Missing complete calendar/no-show/segment lifecycle, assignment UX, approved export delivery and retention execution |
| H4 isolated sync | **PARTIAL** | Server lanes/write fence exist; no real mobile client, physical offline/two-device evidence or complete old-event safety |
| H5 QR/device trust | **PARTIAL backend primitives** | No Workforce geofence, site binding, complete admin/mobile UX, hardware attestation or physical trust evidence |
| H6 pilot/scale | **NOT MET** | No named physical LeadDrive cohort, real app/device matrix, 5,000-user result, formal privacy approval or pilot exit decision |

This roadmap does not renumber H0-H6 or declare them complete. Phases C0-C14
are the closure program and preserve the original plan as the compatibility
baseline.

## 2. North star and product boundaries

### 2.1 North star

An employee sees the correct assignment and one obvious action. The server
records what was claimed, when it was received, which evidence was supplied,
what policy was applied and whether the fact was accepted or needs review. HR
and managers work from exceptions and approved facts, not from an invasive live
map or unexplained red/green statuses.

Design words: **calm, operational, evidence-led**.

### 2.2 Module boundary

| Capability | Workforce HRM owns | Route & Field owns |
|---|---|---|
| Work schedule and attendance | Yes | Reads published HRM facts only |
| Office/branch attendance site | Yes | May reference the same organization/site directory |
| Customer visit/geofence | No | Yes |
| Continuous field-route telemetry | No by default | Yes, only during the Route workday policy |
| Leave, absence and time correction | Yes | Shows route conflicts but does not decide HR requests |
| Payroll calculation | No in the first release | No |

Workforce must continue to function when Route is disabled or unavailable.
Route must not create, complete or correct a Workforce shift automatically.

### 2.3 Non-goals for the first official release

- wage, tax, statutory premium or payroll calculation;
- face recognition or server-side biometric templates;
- covert off-shift tracking;
- automatic disciplinary decisions from GPS, QR or device signals;
- destructive rename/drop of legacy `Mtm*` tables;
- unreviewed global enablement for every tenant;
- claims that GPS, QR or device trust alone proves a human identity.

## 3. Recorded decisions and owner gates

### 3.1 Confirmed decisions

| ID | Decision | Recorded value |
|---|---|---|
| DEC-01 | Commercial modules | `workforce-hrm` and `route-field` remain independent |
| DEC-02 | Employee / manager naming | `Рабочее время` / `Табель и команда` |
| DEC-03 | Initial default profile | Asia/Baku, Mon-Fri, 09:00-18:00, 8 expected hours, 15-minute late grace, planned lunch 13:00-14:00 |
| DEC-04 | Export boundary | Approved-timesheet export only; payroll excluded |
| DEC-05 | Time and decision retention | 1 year |
| DEC-06 | Raw GPS retention | 30 days |
| DEC-07 | Offline horizon | 7 days, with idempotency/cursor retention beyond it |
| DEC-08 | Direct correction | Manager may correct with mandatory reason and immutable audit; approved periods receive a correcting revision |
| DEC-09 | Biometrics | No biometric template/result is stored by LeadDrive |
| DEC-10 | First pilot tenant | LeadDrive; one tenant initially, exact internal tenant ID stays outside source control |
| DEC-11 | Mobile product status | A new employee mobile application must be developed; API/build artifacts are not a delivered app |

### 3.2 Owner decisions that must not be guessed

The recommended default is safe and reversible. The owner/legal/HR value must
be recorded before the dependent phase can leave `BLOCKED`.

| ID | Required decision | Recommended starting point | Blocks |
|---|---|---|---|
| OD-01 | Mobile platforms and distribution | Android first, managed Play track; iOS as a separate parity phase | C9, C14 |
| OD-02 | Device ownership | Support company-owned and BYOD as distinct policies; never infer one from the other | C5, C9 |
| OD-03 | Background location | Action-time location by default; scheduled on-duty geofence transitions only after legal/privacy approval; never off-shift | C4, C9, C10 |
| OD-04 | Office proof combination | `GEO + rotating QR` for high-assurance office actions; `GEO` or reviewed fallback for ordinary sites | C4, C5 |
| OD-05 | Geofence shape/radius governance | Revisioned circle per site for v1; radius chosen per site after on-location calibration | C2, C4 |
| OD-06 | Kiosk/badge support | Optional site policy, never a universal fallback | C5, C8 |
| OD-07 | Lunch treatment | Keep actual Pause/Resume in v1; decide paid/unpaid and any auto-deduction before official timesheet use | C3, C11 |
| OD-08 | Overnight and split shifts | Support before broad commercial rollout; define work-date attribution and rest rules with HR/legal | C3 |
| OD-09 | Inter-branch travel | Explicit `TRAVEL` segment; owner decides whether it is paid/expected time per tenant policy | C2, C3, C11 |
| OD-10 | Exact role separation | HR admin, scheduler, approver, location reviewer, device-security admin, export custodian | C7, C8, C10 |
| OD-11 | Location visibility | Normal manager view shows verdict/reason, not raw coordinates; restricted drill-down only for authorized investigations | C8, C10 |
| OD-12 | Employee monitoring legal basis/notice | Local legal/privacy sign-off and employee notice before any real location cohort | C10, C14 |
| OD-13 | Backdated event outcome | **Recorded safe default:** older than seven days is rejected; an in-window claim received over 15 minutes after `claimedAt` becomes `PENDING_REVIEW` under `c1-delay-review-v1`. Tenant-published policy/resolution awaits C6. | C6 |
| OD-14 | Pilot population and observation window | Named small LeadDrive cohort, two physical devices, at least one full payroll-like reporting cycle without using results for payroll | C14 |
| OD-15 | Supported app version window | Minimum/maximum version, forced-update policy and offline drain period | C9, C13, C14 |
| OD-16 | Equitable non-mobile fallback | Site kiosk/badge or reviewed web/manual exception for no smartphone, disability, lost phone or unavailable GPS; never a permanent unreviewed bypass | C4, C5, C8, C14 |

## 4. UX design brief

### 4.1 Feature summary

Workforce HRM serves employees checking work time, managers resolving team
exceptions, HR configuring schedules/sites and approving timesheets, and a
restricted security/privacy role reviewing attendance evidence. The interface
must make the current status and next action obvious while explaining exactly
what evidence is available, missing or under review.

### 4.2 Primary actions by role

| Role | Primary action |
|---|---|
| Employee | Understand the current assignment and perform exactly one valid action: Start, Arrive, Pause, Resume, Leave site or Finish |
| Manager | Resolve the highest-risk exception with context and a recorded reason |
| HR/scheduler | Publish a future-effective schedule/site assignment without rewriting past facts |
| Time approver | Approve a reproducible period or create an immutable correcting revision |
| Security/privacy admin | Manage proof policy, device lifecycle and restricted evidence access |

### 4.3 Design direction

- Preserve LeadDrive's professional, light-first CRM shell and restrained
  accent; support the existing dark theme.
- Employee mobile is action-first and usable with one hand.
- Manager/HR web is exception-first, not a wall of KPI cards and not a live-map
  surveillance screen.
- Status always includes text, reason and recovery action; color alone is not
  evidence.
- Advanced proof and retention controls use progressive disclosure and remain
  separate from ordinary schedule configuration.

### 4.4 Layout strategy

**Employee mobile**

1. Current date, shift segment, expected site/mode and offline status.
2. One dominant state/action card with timer.
3. Evidence step only when policy requires it: location check, QR scan or local
   device confirmation.
4. Current site/travel/next segment and last server confirmation.
5. Recovery/request action below the primary flow.

**Manager web**

1. Exception queue and SLA first.
2. Team status table with schedule, accepted fact, confidence/verdict and next
   action.
3. Employee evidence timeline in context; raw coordinates hidden by default.
4. Timesheet approval and corrections remain distinct from live attendance.

**HR/configuration web**

1. People and assignment directory.
2. Sites/geofences.
3. Shifts, calendars and break/travel rules.
4. Attendance proof policies.
5. Devices/QR/kiosks.
6. Retention, export and audit.

### 4.5 Required states

- unscheduled, non-working day, remote, office, field and travel;
- ready, capturing location, waiting for QR, waiting for local authentication;
- locally saved, sending, server-applied, pending review, conflict, rejected;
- weak/stale/missing location, outside zone, mocked-location suspicion;
- QR expired, reused, wrong tenant/site or station disabled;
- device pending, active, replaced, revoked, unsupported or integrity unknown;
- prior day still open, missed start, missed finish, long pause and no-show;
- site transition expected, arrived, left, late transition or impossible travel;
- policy/shift snapshot missing, historical policy ambiguity and transfer during
  offline delay;
- employee correction requested, approved, rejected, cancelled or appealed;
- empty, loading, partial, stale-cache, offline and service-unavailable states.

### 4.6 Interaction and content contract

- A critical action receives immediate local feedback and an explicit server
  outcome; pending is never rendered as accepted.
- A rejected action retains safe diagnostic context and offers a valid recovery
  path without asking the employee to understand an internal code.
- Manager decisions show evidence, policy version, effect on the timesheet and
  required reason before confirmation.
- All new copy ships in AZ/RU/EN together. Machine codes remain stable while
  user text is localized.
- Touch targets are at least 48 dp in the mobile app; browser flows support
  keyboard, visible focus, 200% zoom and reduced motion.
- Recommended implementation references: `interaction-design.md`,
  `responsive-design.md`, `ux-writing.md`, `spatial-design.md`,
  `color-and-contrast.md` and `typography.md` from the project's design skill.

## 5. Target domain and trust model

### 5.1 Attendance is a decision over evidence

The server must keep these layers distinct:

1. **Claim:** what action the authenticated account claims happened and when.
2. **Receipt:** when LeadDrive first received the claim and from which app/
   device/session context.
3. **Evidence:** location, QR, device signature, kiosk or manual fallback.
4. **Policy snapshot:** rules effective for that employee, segment and date.
5. **Assessment:** accepted, accepted with warning, pending review or rejected,
   with stable reason codes.
6. **HR decision:** resolution, actor, reason and effect on approved time.

No client-provided coordinate, clock, QR or device label is a server verdict by
itself.

### 5.2 Required work modes

| Mode | Expected evidence | Tracking boundary |
|---|---|---|
| `OFFICE` | Site assignment; policy may require geo, QR and/or trusted device | Start/end and scheduled site transitions; background only if explicitly approved |
| `FIELD` | Workday action plus route/customer evidence when Route is enabled | Route owns continuous field telemetry; HRM consumes bounded facts |
| `REMOTE` | Authenticated time action and optional device confirmation | No location by default |
| `TRAVEL` | Explicit segment between sites and policy-specific proof | No hidden assumption that travel is break or payable time |
| `EXCEPTION` | Manual reason and review | Never silently converted to normal attendance |

### 5.3 Required logical entities

Names are provisional; responsibilities and tenant boundaries are mandatory.
All tenant-owned rows require `organizationId`, RLS, effective dates where
applicable, tenant-first indexes and immutable/audited lifecycle rules.

| Entity | Responsibility |
|---|---|
| `WorkforceSite` | Office/branch identity, timezone, address, active lifecycle and responsible managers |
| `WorkforceGeofenceRevision` | Effective-dated center/radius, calibration metadata and immutable history |
| `WorkforceEmployeeSiteAssignment` | Employee-to-site eligibility and primary/secondary site history |
| `WorkforceShiftSegment` / snapshot | Expected time window, mode, site and ordering within a workday |
| `WorkforceSiteTransition` | Expected/actual arrival and departure between segments |
| `WorkforceAttendanceClaim` | Client action with claimed/captured/queued/received timestamps and app/device provenance |
| `WorkforceAttendanceEvidence` | Append-only method-specific evidence, separated from the verdict |
| `WorkforceAttendanceAssessment` | Server policy result, confidence/reasons and policy/site/segment snapshot hashes |
| `WorkforceExceptionCase` | Review lifecycle for no-show, weak/missing proof, clock anomaly, offsite and other risks |
| `WorkforceExceptionDecision` | Immutable manager/HR decision and reason; supports appeal/correction |
| `WorkforceDeviceAttestation` | Verified hardware/app integrity properties, expiry and trust roots without private keys |
| `WorkforceRetentionPolicy` | Tenant data-class retention settings and provenance |
| `WorkforceLegalHold` | Explicit hold scope and auditable release; deletion fails closed on a match |
| `WorkforceExportArtifact` | Approved scope, checksum, purpose, recipient, encrypted delivery and expiry |

Existing `MtmAgentWorkday`, events, requests and Workforce snapshot/approval
tables remain the compatibility foundation. New migrations are additive; no
physical rename/drop is part of this roadmap.

### 5.4 Proof policy composition

| Proof | What it can support | What it cannot prove alone |
|---|---|---|
| Session/account | Authenticated account submitted an action | Named human was physically present |
| GPS/geofence | Reported device location is compatible with a site at capture time | Human identity or uncompromised device |
| Rotating QR | Client saw a fresh station token | Physical proximity if the token was relayed |
| Device key | Registered key signed the exact action | Hardware protection or person presence without attestation/local auth |
| Local biometric/PIN | User locally unlocked a key | Central biometric identity; templates must never leave the OS |
| Kiosk/badge | Site-controlled terminal recorded a credential | Strong identity when PIN/badge is shared |
| Manual exception | Accountable HR decision with reason | Original automated evidence |

Policies combine methods by action and work mode. Failure can produce
`PENDING_REVIEW` rather than an unsafe silent acceptance or an unnecessarily
punitive hard rejection.

## 6. Roadmap conventions

Statuses: **DONE**, **PARTIAL**, **NEXT**, **PLANNED**, **BLOCKED**,
**OWNER DECISION**.

Priorities:

- **P0:** blocks any real attendance/location pilot or creates material data,
  tenant, identity or privacy risk;
- **P1:** blocks official timesheet/HR operation or broad production rollout;
- **P2:** needed before commercial scale or complex workforce use;
- **P3:** optimization and advanced capability after the core gates pass.

Owner roles are accountabilities, not individual names:
`Product`, `HR`, `Legal/Privacy`, `Security`, `Backend`, `Web`, `Mobile`,
`QA`, `SRE/DBA`.

### 6.2 Checkpoint progress ledger

| Recorded at | Checkpoint | Overall | Current phase | Accepted tasks | Passed gates | Evidence / blocker change |
|---|---|---:|---:|---:|---:|---|
| 2026-08-30T00:26:11+02:00 | C0 contract/threat/data evidence | 2% | C0 50% | 4/161 | 0/15 | WF-C0-001/002/007/008 accepted; legal review, tenant-scoped production baseline and mobile-distribution gates remain open |
| 2026-08-30T00:44:05+02:00 | C1a provenance/offline-boundary contract | 3% | C1 20% | 6/161 | 0/15 | WF-C1-001/002 accepted; changed-payload digest is partial pending C2 segment identity, claim/review and audit-projection work remain open |
| 2026-08-30T00:57:42+02:00 | C1b transactional audit projection | 3% | C1 30% | 7/161 | 0/15 | WF-C1-005 accepted for workday and request decisions; failure injection blocks a successful result when the audit write fails; review-case and segment binding remain open |
| 2026-08-30T01:11:00+02:00 | C1c delayed-claim review | 4% | C1 40% | 8/161 | 0/15 | WF-C1-003 accepted: delayed in-window claims create an immutable tenant review case; legacy evidence remains unknown; segment binding remains open |
| 2026-08-30T01:15:00+02:00 | C2a site-domain ADR | 5% | C2 18% | 10/161 | 0/15 | WF-C2-001/011 accepted: Workforce-only vocabulary and circle-v1/future-geometry boundary recorded; no tenant site or Route linkage added |
| 2026-08-30T01:22:00+02:00 | C2b independent site lifecycle | 5% | C2 27% | 11/161 | 0/15 | WF-C2-002 accepted: tenant-scoped site create/archive and admin API are isolated from Route; geofence/assignment/segment facts remain open |
| 2026-08-30T01:28:00+02:00 | C2c geofence-revision foundation | 5% | C2 27% | 11/161 | 0/15 | C2-004 foundation checkpointed: circle geometry/timeline is immutable and tenant-scoped; physical calibration and workday snapshot integration remain open |
| 2026-08-30T01:35:00+02:00 | C2d effective site assignments | 6% | C2 36% | 12/161 | 0/15 | WF-C2-005 accepted: future primary/secondary/temporary history is tenant-scoped and auditable; historical workday resolution remains open |
| 2026-08-30T01:48:00+02:00 | C2e ordered shift segments | 6% | C2 45% | 13/161 | 0/15 | WF-C2-006 accepted: one draft/active schedule can express 09-13 Site A and 14-18 Site B with an explicit planned break, independent of Route; workday snapshot and transitions remain open |
| 2026-08-30T01:56:00+02:00 | C2f site-transition fact foundation | 6% | C2 45% | 13/161 | 0/15 | WF-C2-007 is partial: append-only arrival/departure claims are tenant-scoped, provenance-bound and review-safe; no unverified mobile/API path, C3 snapshot or C4 assessment is claimed |
| 2026-08-30T06:44:00+02:00 | C3b calendar semantics | 11% | C3 20% | 23/161 | 0/15 | WF-C3-002 accepted: Workforce-only adapter distinguishes scheduled/non-working/public holiday/closure/approved leave/absence; `/today` exposes calendar state without calling a no-show |
| 2026-08-30T06:52:00+02:00 | C3c default-shift timeline | 12% | C3 30% | 24/161 | 0/15 | WF-C3-007 accepted: future organization-default selection is RLS/audit/snapshot-bound; legacy `isDefault` is retained without historical backfill and new team defaults await immutable team history |
| 2026-08-30T07:02:28+02:00 | C3d accepted workday schedule snapshot | 12% | C3 40% | 25/161 | 0/15 | WF-C3-008 accepted: START atomically pins calendar, ordered segments, scheduled sites/effective geofence, policy and shift facts; historical pairs remain explicitly unknowable rather than reconstructed |
| 2026-08-30T07:06:15+02:00 | C3e timezone/DST matrix | 13% | C3 50% | 26/161 | 0/15 | WF-C3-010 accepted: signed shift dates remain organization-local across leap day and UTC rollover; DST gaps/folds are refused until an explicit policy exists |
| 2026-08-30T07:09:57+02:00 | C3f bulk assignment preview | 13% | C3 50% | 26/161 | 0/15 | WF-C3-009 remains partial: session-admin preview reports ready/no-change/conflict outcomes for up to 200 employees but cannot mass-write or claim approval semantics |
| 2026-08-30T07:16:08+02:00 | C2g schedule/site safety | 13% | C2 45% | 26/161 | 0/15 | WF-C2-009 remains partial: shift/site timezone and effective eligibility are pinned at START; transition claims bind only to the employee's snapshotted SITE segment; travel semantics remain owner-gated |
| 2026-08-30T07:24:00+02:00 | C1d segment-bound idempotency | 13% | C1 50% | 27/161 | 0/15 | WF-C1-004 accepted: v3 request hashes bind the snapshotted segment ID, while v1/v2 hashes remain byte-for-byte compatible with their existing replay contract |
| 2026-08-30T07:40:00+02:00 | C1e historical team membership | 14% | C1 60% | 28/161 | 0/15 | WF-C1-006 accepted: append-only employee team facts resolve delayed workdays at start time; pre-history never falls back to mutable current team |
| 2026-08-30T07:41:00+02:00 | C1f transition risk codes | 14% | C1 70% | 29/161 | 0/15 | WF-C1-007 accepted: duplicate-active and impossible-order attempts return non-punitive machine risk codes while exact replays retain canonical success |
| 2026-08-30T07:51:00+02:00 | C1g canonical recovery contract | 15% | C1 80% | 30/161 | 0/15 | WF-C1-008 accepted: every workday conflict has canonical state, structured reason, allowed actions and refresh contract across web/mobile adapters |
| 2026-08-30T08:01:00+02:00 | C1h legacy-fact migration plan | 15% | C1 90% | 31/161 | 0/15 | WF-C1-009 accepted: v3 schema constraint now matches the segment-bound writer; legacy rows remain unknown, no backfill is permitted, and dry-run/reconciliation/forward-rollback procedures are recorded |
| 2026-08-30T08:08:00+02:00 | C1i abuse matrix (partial) | 15% | C1 90% | 31/161 | 0/15 | Backdate/future/replay/changed-payload and second-device state-integrity cases pass; binary app-version enforcement remains owner- and mobile-app-gated, so WF-C1-010 receives no artificial credit |
| 2026-08-30T08:11:00+02:00 | C3g visible assignment/default configuration | 17% | C3 45% | 35/161 | 0/15 | WF-C3-001 accepted: named employee/template picker, on-demand direct-assignment preview and session-admin organization-default timeline are visible; team-default timeline remains separately bounded |
| 2026-08-30T08:16:00+02:00 | C2h independent module scopes | 16% | C2 55% | 32/161 | 0/15 | WF-C2-010 accepted: organization/team/site API surface is Workforce-scoped, session-admin protected and tested in an HRM-only tenant without Route tables/API |

**C3 phase display reconciliation (2026-08-30T08:11:00+02:00):** the C3
register contains 11 tasks and its scope did not change. Earlier C3 ledger
display values were not calculated from the stated phase formula. The current
row uses the live register: 5 accepted tasks / 11 = **45%**. The overall
accepted-task denominator remains 161, so this is a display correction rather
than a hidden scope or completion change.

### 6.1 Progress reporting contract

During an autonomous implementation run, every user-facing work update starts
with one stable progress line:

```text
[HRM 18% | C2 41%] DONE 29/161 tasks | GATES 1/15 | NOW WF-C2-007 | BLOCKED 2
```

The percentage is an auditable completion index, not a time estimate:

```text
overall % = round(80 * accepted tasks / 161 + 20 * passed phase gates / 15)
phase %   = round(accepted tasks in phase / all tasks in phase * 100)
```

- A task counts only after its stated acceptance evidence exists. `PARTIAL`,
  `IN PROGRESS`, `BLOCKED` and `OWNER DECISION` receive no artificial partial
  credit.
- A phase gate counts only when every condition printed under that gate is
  evidenced. A successful commit or test alone is not a passed gate.
- The raw task and gate counts are always shown beside the percentage so the
  user can verify what changed.
- Each update states the active task, newly completed task IDs, remaining P0/P1
  count, blockers and the next checkpoint. Long-running checks are announced
  before they start and reported when they finish.
- Updates are emitted after each logical slice/checkpoint, on any test or gate
  result, whenever scope/blocker state changes, and at least every 5-10 minutes
  of active work when no faster event occurs.
- At every checkpoint commit, task statuses and a timestamped progress snapshot
  are updated in this roadmap (or its linked progress ledger) in the same
  commit. A new session resumes from Git evidence rather than a remembered
  percentage.
- If discovery adds or removes work, the roadmap revision, old/new denominator
  and reason are recorded before recalculating the percentage. A percentage may
  fall after an evidence-backed scope increase; that change must be explained,
  never hidden.
- `NOT RUN` verification never contributes progress. A blocked owner decision
  remains visible, while independent safe work continues.

The completion index for this closure roadmap starts from accepted task and
gate evidence, not from the earlier H0-H6 foundation. This prevents historical
code volume from overstating readiness for real employee monitoring.

## 7. Delivery phases and task register

### C0 — Contract, threat model and measurable baseline

**Goal:** freeze what the product promises and establish evidence before new
attendance schema or a real employee cohort.

| ID | Pri | Status | Owner | Task | Acceptance evidence |
|---|---:|---|---|---|---|
| WF-C0-001 | P0 | DONE | Product/HR | Approve this roadmap, terminology and non-goals | Active task authorization recorded in C0 evidence; unresolved owner decisions remain explicit |
| WF-C0-002 | P0 | DONE | Security/Product | Create abuse/threat model: shared credentials, stolen sessions, QR relay, GPS spoof, clock rollback, rooted/emulated app, replay, manager abuse and tenant leakage | `workforce-c0-foundation-evidence-2026-08-30.md` sections 2-3 |
| WF-C0-003 | P0 | PARTIAL | Legal/Privacy/HR | Complete data inventory and processing-purpose map for time, location, device, audit, requests and exports | Technical inventory exists; lawful basis/notice awaits C0-004 |
| WF-C0-004 | P0 | BLOCKED | Legal/Privacy | Complete Azerbaijan employment/privacy review and any required employee notice/assessment; add jurisdiction template for future tenants | Signed review and approved notice/fallback, not source-level assumption |
| WF-C0-005 | P0 | PARTIAL | SRE/DBA | Capture tenant-scoped baseline: employees, events/day, peak/minute, p50/p95/p99, failures, conflicts, outbox age, storage growth and prior-day opens | Read-only query/NOT RUN baseline recorded; production telemetry access remains required |
| WF-C0-006 | P1 | OWNER DECISION | Product/Mobile | Record platforms, distribution, supported OS/device classes and app-version window | OD-01 and OD-15 resolved |
| WF-C0-007 | P1 | DONE | Product/QA | Create requirements traceability matrix from H0-H6, this roadmap, tests and release evidence | C0 evidence section 5 maps all `WF-C*` groups to contract/test/gate |
| WF-C0-008 | P1 | DONE | Product | Establish risk rule: no automated payroll/discipline from unreviewed attendance evidence | C0 evidence section 1 records binding product rule |

**Gate C0:** threat/data models exist, legal blockers are named, baseline is
captured or explicitly `NOT RUN`, and no requirement is represented as complete
without evidence.

### C1 — Time provenance, offline safety and canonical fact integrity

**Goal:** prevent a valid session or legacy client from turning arbitrary old
client timestamps into trusted attendance facts.

| ID | Pri | Status | Owner | Task | Acceptance evidence |
|---|---:|---|---|---|---|
| WF-C1-001 | P0 | DONE | Backend | Define `claimedAt`, `capturedAt`, `queuedAt`, `serverReceivedAt`, `appliedAt` and server-authoritative work date semantics | Versioned contract and parser tests |
| WF-C1-002 | P0 | DONE | Backend | Enforce the confirmed seven-day offline horizon in every legacy and new mutation path | Boundary, future-skew and replay tests for all adapters |
| WF-C1-003 | P0 | DONE | Backend/HR | Route delayed/anomalous claims to `PENDING_REVIEW`; never silently manufacture an approved historical workday | [`workforce-c1-review-evidence-2026-08-30.md`](./workforce-c1-review-evidence-2026-08-30.md): immutable claim/receipt review case, explicit legacy state and targeted contracts |
| WF-C1-004 | P0 | DONE | Backend | Bind idempotency hash to actor, action, claimed time, segment, evidence references and schema version | [`workforce-c1-segment-idempotency-evidence-2026-08-30.md`](./workforce-c1-segment-idempotency-evidence-2026-08-30.md): v3 segment digest and pinned-schedule assertion; v1/v2 replay digest remains compatible |
| WF-C1-005 | P0 | DONE | Backend | Make standard audit projection atomic with accepted workday/request decisions or derive it reliably from the immutable ledger | Failure-injection proves no accepted mutation lacks reconstructable audit |
| WF-C1-006 | P1 | DONE | Backend/HR | Resolve policy/team/site assignment from an effective-dated employee history, not the current team after a delayed upload | [`workforce-c1-team-history-evidence-2026-08-30.md`](./workforce-c1-team-history-evidence-2026-08-30.md): immutable membership timeline, no pre-history guessing, and transfer-during-offline contract |
| WF-C1-007 | P1 | DONE | Backend | Add impossible clock/order and duplicate active-shift risk codes without breaking idempotent retries | [`workforce-c1-transition-risk-evidence-2026-08-30.md`](./workforce-c1-transition-risk-evidence-2026-08-30.md): review-only codes, transport contract and replay-first tests |
| WF-C1-008 | P1 | DONE | Backend | Return current canonical state, reason and allowed recovery actions on every conflict | [`workforce-c1-recovery-contract-evidence-2026-08-30.md`](./workforce-c1-recovery-contract-evidence-2026-08-30.md): structured recovery, fresh mismatch lookup and AZ/RU/EN UI mapping |
| WF-C1-009 | P1 | DONE | Backend | Create additive migration/backfill plan for existing facts; unknown provenance remains `LEGACY`, never falsely attested | [`workforce-c1-legacy-fact-migration-evidence-2026-08-30.md`](./workforce-c1-legacy-fact-migration-evidence-2026-08-30.md): v3 schema constraint, no-backfill contract, read-only count/reconciliation and forward-only rollback procedure |
| WF-C1-010 | P1 | PARTIAL | Security/QA | Add abuse tests for backdating, future time, replay, two devices, changed payload and expired app version | [`workforce-c1-abuse-matrix-evidence-2026-08-30.md`](./workforce-c1-abuse-matrix-evidence-2026-08-30.md): all server-side cases pass; expired binary-version enforcement awaits OD-01/OD-15 and the real mobile app |

**Gate C1:** no supported endpoint can convert an out-of-policy past timestamp
into ordinary accepted attendance; every accepted fact is reproducible and
auditable.

**Current evidence:**
[`workforce-c1-provenance-evidence-2026-08-30.md`](./workforce-c1-provenance-evidence-2026-08-30.md)
records the C1a contract, migration and targeted test results. C1 remains open
until C2 segment binding and the remaining C1 tasks exist; delayed-claim review
is in [`workforce-c1-review-evidence-2026-08-30.md`](./workforce-c1-review-evidence-2026-08-30.md)
and atomic audit evidence is in
[`workforce-c1-audit-projection-evidence-2026-08-30.md`](./workforce-c1-audit-projection-evidence-2026-08-30.md).
The v3 segment-bound replay contract is recorded in
[`workforce-c1-segment-idempotency-evidence-2026-08-30.md`](./workforce-c1-segment-idempotency-evidence-2026-08-30.md).
Historical membership selection is in
[`workforce-c1-team-history-evidence-2026-08-30.md`](./workforce-c1-team-history-evidence-2026-08-30.md).
Transition risk codes are in
[`workforce-c1-transition-risk-evidence-2026-08-30.md`](./workforce-c1-transition-risk-evidence-2026-08-30.md).
The canonical recovery contract is in
[`workforce-c1-recovery-contract-evidence-2026-08-30.md`](./workforce-c1-recovery-contract-evidence-2026-08-30.md).
The legacy-fact no-backfill and reconciliation procedure is in
[`workforce-c1-legacy-fact-migration-evidence-2026-08-30.md`](./workforce-c1-legacy-fact-migration-evidence-2026-08-30.md).
The C1 abuse matrix and its explicit app-version boundary are in
[`workforce-c1-abuse-matrix-evidence-2026-08-30.md`](./workforce-c1-abuse-matrix-evidence-2026-08-30.md).

### C2 — Sites, geofences, multi-branch segments and travel

**Goal:** represent where an employee is expected to work and how one day moves
between office, field, remote and travel segments.

| ID | Pri | Status | Owner | Task | Acceptance evidence |
|---|---:|---|---|---|---|
| WF-C2-001 | P0 | DONE | Product/HR | Approve vocabulary and site types: Site, Area, Segment, Office, Warehouse, Temporary site, Customer site, Home/Remote, Field, Travel, On-call and Exception | [`workforce-c2-site-domain-adr-2026-08-30.md`](./workforce-c2-site-domain-adr-2026-08-30.md) AZ/RU/EN glossary and module boundary |
| WF-C2-002 | P0 | DONE | Backend | Add tenant-scoped `WorkforceSite` lifecycle with code/name/timezone/address/status and responsible scope | [`workforce-c2-site-evidence-2026-08-30.md`](./workforce-c2-site-evidence-2026-08-30.md): Prisma/RLS/migration/API tests and Route-independence contract |
| WF-C2-003 | P0 | OWNER DECISION | HR/Privacy | Approve per-site geofence calibration procedure, minimum/maximum radius and accuracy policy | OD-05 resolved with calibration evidence |
| WF-C2-004 | P0 | PARTIAL | Backend | Add immutable effective-dated geofence revisions; v1 supports a validated circle and preserves future polygon extension | [`workforce-c2-geofence-revision-evidence-2026-08-30.md`](./workforce-c2-geofence-revision-evidence-2026-08-30.md): immutable circle/timeline foundation; historical workday snapshot awaits C2/C3 integration |
| WF-C2-005 | P0 | DONE | Backend | Add effective-dated employee site eligibility/primary-secondary assignments | [`workforce-c2-site-assignment-evidence-2026-08-30.md`](./workforce-c2-site-assignment-evidence-2026-08-30.md): transfer and temporary-assignment tests |
| WF-C2-006 | P0 | DONE | Backend/HR | Add ordered shift segments with mode, site, planned window, grace and proof policy reference | [`workforce-c2-shift-segment-evidence-2026-08-30.md`](./workforce-c2-shift-segment-evidence-2026-08-30.md): tenant/RLS/immutable draft timeline; C3 workday snapshot remains separate |
| WF-C2-007 | P0 | PARTIAL | Backend | Add arrival/departure/site-transition facts linked to segment and evidence assessment | [`workforce-c2-site-transition-evidence-2026-08-30.md`](./workforce-c2-site-transition-evidence-2026-08-30.md): immutable claim ledger; C3 snapshot/C4 assessment and public client path remain open |
| WF-C2-008 | P1 | OWNER DECISION | HR/Legal | Define inter-site travel, paid/expected treatment, delay grace and who may alter it | OD-09 resolved; calculation rule versioned |
| WF-C2-009 | P1 | PARTIAL | Backend | Validate segment overlap, ordering, site eligibility, timezone and impossible travel at publish and action time | [`workforce-c2-schedule-safety-evidence-2026-08-30.md`](./workforce-c2-schedule-safety-evidence-2026-08-30.md): publish/START/action site boundary; OD-09 travel semantics remain open |
| WF-C2-010 | P1 | DONE | Backend | Add organization/team/site scoped APIs and permissions independent of Route customers/geofences | [`workforce-c2-module-scope-evidence-2026-08-30.md`](./workforce-c2-module-scope-evidence-2026-08-30.md): session-admin organization/team/site APIs, actor-scoped read surface and HRM-only isolation tests |
| WF-C2-011 | P2 | DONE | Product/Backend | Reserve versioned extension for polygon/multi-entrance/large-campus zones without forcing it into v1 | [`workforce-c2-site-domain-adr-2026-08-30.md`](./workforce-c2-site-domain-adr-2026-08-30.md) documents the circle-v1 compatibility boundary |

**Gate C2:** the system can schedule, snapshot and explain a multi-site day
without using Route customer geofences or inventing a second workday.

### C3 — Calendars, shifts, breaks and assignment lifecycle

**Goal:** produce a legally/operationally meaningful expected schedule for
ordinary, night, split and exceptional days.

| ID | Pri | Status | Owner | Task | Acceptance evidence |
|---|---:|---|---|---|---|
| WF-C3-001 | P1 | DONE | Backend/Web | Finish employee/team/default shift assignment with roster lookup and effective-date preview | [`workforce-c3-assignment-roster-evidence-2026-08-30.md`](./workforce-c3-assignment-roster-evidence-2026-08-30.md): named roster picker, direct-assignment date preview and separately versioned organization-default timeline; team-default timelines remain separately scoped |
| WF-C3-002 | P1 | DONE | Backend/HR | Add work calendar: workdays, holidays, tenant closures and employee exceptions | [`workforce-c3-calendar-evidence-2026-08-30.md`](./workforce-c3-calendar-evidence-2026-08-30.md): Workforce calendar resolution distinguishes non-working/leave/holiday without a Route dependency |
| WF-C3-003 | P1 | OWNER DECISION | HR/Legal | Define paid/unpaid/manual/automatic break policy and lunch treatment | OD-07 resolved and versioned by tenant |
| WF-C3-004 | P1 | PLANNED | Backend | Make planned breaks enforceable/calculable according to the approved policy while preserving old metadata snapshots | Baku 09-18 with 13-14 yields explainable eight-hour expectation |
| WF-C3-005 | P1 | OWNER DECISION | HR/Legal | Define overnight work date, split shifts, minimum rest and cross-midnight correction rules | OD-08 resolved |
| WF-C3-006 | P1 | PLANNED | Backend | Extend schedule model for overnight/split segments without changing historical definition hashes | Compatibility and DST/property tests |
| WF-C3-007 | P1 | DONE | Backend | Version future default-selection timeline instead of mutating a timeless `isDefault` | [`workforce-c3-default-timeline-evidence-2026-08-30.md`](./workforce-c3-default-timeline-evidence-2026-08-30.md): RLS/audit/snapshot-bound organization timeline; team defaults remain safely unavailable without historical membership |
| WF-C3-008 | P1 | DONE | Backend | Snapshot calendar, schedule, segments, sites and calculation policy atomically on accepted start/assignment | [`workforce-c3-schedule-snapshot-evidence-2026-08-30.md`](./workforce-c3-schedule-snapshot-evidence-2026-08-30.md): append-only, tenant-bound START snapshot; historical pairs are not reconstructed |
| WF-C3-009 | P2 | PARTIAL | HR/Web | Add bulk assignments, temporary cover, recurring templates and safe preview | [`workforce-c3-bulk-preview-evidence-2026-08-30.md`](./workforce-c3-bulk-preview-evidence-2026-08-30.md): read-only 200-person impact preview; bulk apply/cover/recurrence remain deliberately unavailable |
| WF-C3-010 | P2 | DONE | Backend/QA | Cover IANA timezones, DST gaps/folds, leap day and organization date rollover | [`workforce-c3-timezone-matrix-evidence-2026-08-30.md`](./workforce-c3-timezone-matrix-evidence-2026-08-30.md): Baku unchanged; gap/fold endpoints refuse silent interpretation |
| WF-C3-011 | P2 | PLANNED | HR/Product | Define shift swap/open shift/on-call requirements or explicitly exclude them per release | Scope decision recorded |

**Gate C3:** every expected day is derived from a versioned calendar/schedule,
and breaks/overnight/travel have approved semantics rather than hidden math.

### C4 — Geofence and attendance evidence engine

**Goal:** evaluate location and other proof consistently, explainably and
without confusing evidence with identity.

| ID | Pri | Status | Owner | Task | Acceptance evidence |
|---|---:|---|---|---|---|
| WF-C4-001 | P0 | PLANNED | Backend | Define versioned evidence envelope: source, capture time, accuracy, provider/mock flags, app/device/session references and redacted payload hash | Strict schema rejects incomplete/ambiguous evidence |
| WF-C4-002 | P0 | PLANNED | Backend | Evaluate distance server-side against the snapshotted geofence and return inside/outside/unknown plus distance/accuracy reason | Boundary and missing-site tests |
| WF-C4-003 | P0 | PLANNED | Security/Mobile | Define maximum accuracy, freshness, mock/provider and permission-denied handling per policy | Weak GPS becomes explainable review/rejection, not silent pass |
| WF-C4-004 | P0 | PLANNED | Backend | Link QR station to site/area and effective lifecycle; bind token to tenant/station/revision/action/expiry/nonce | Wrong site/action and relayed stale token fail |
| WF-C4-005 | P0 | PLANNED | Backend | Compose required/optional methods per action and segment mode (`allOf`, `anyOf`, fallback/review) | Policy matrix tests cover Office/Field/Remote/Travel |
| WF-C4-006 | P0 | PLANNED | Backend | Persist append-only evidence and assessment separately; normal reports retain verdict after raw evidence expiry | Retention test preserves semantic result without raw coordinates |
| WF-C4-007 | P1 | PLANNED | Backend | Add impossible-travel, speed, clock and site-transition risk signals as review hints, never automatic guilt | Deterministic rule versions and false-positive review path |
| WF-C4-008 | P1 | OWNER DECISION | Product/HR/Privacy | Define equitable fallback when GPS/QR/device/smartphone is unavailable, including disability and lost-phone cases: retry, kiosk/alternative proof or reviewed manual request | OD-16 resolved; every rejection code has a safe recovery action |
| WF-C4-009 | P1 | PLANNED | Backend/Web | Expose assessment explanation to employee/manager without exposing secrets or raw security internals | Localized reason/recovery contract |
| WF-C4-010 | P1 | PLANNED | QA/Security | Test GPS edge cases: zero coordinates, boundary, stale/future timestamp, low accuracy, mock suspicion, no permission and no provider | Automated negative/edge matrix passes |

**Gate C4:** every location/QR/device result names the evidence, policy and
reason; missing or weak evidence cannot silently look verified.

### C5 — Identity, devices, QR, kiosk and anti-fraud controls

**Goal:** reduce buddy punching/account sharing through layered controls while
remaining recoverable for legitimate employees.

| ID | Pri | Status | Owner | Task | Acceptance evidence |
|---|---:|---|---|---|---|
| WF-C5-001 | P0 | OWNER DECISION | Product/Security/HR | Approve assurance tiers per tenant/site/action and BYOD/company-device rules | OD-02 and OD-04 resolved |
| WF-C5-002 | P0 | PLANNED | Security/Backend | Require HRM-specific MFA/step-up policy for critical employee/admin actions; preserve recovery codes and accountable reset | Session/auth tests; no role silently bypasses policy |
| WF-C5-003 | P0 | PLANNED | Mobile/Security | Generate non-exportable Android Keystore keys with user-auth properties and safe rotation | Physical device proves key lifecycle |
| WF-C5-004 | P0 | PLANNED | Backend/Security | Validate Android Key Attestation chain, roots, revocation, security level, challenge and app identity server-side | Software key/emulator/untrusted chain rejected or reviewed |
| WF-C5-005 | P0 | PLANNED | Mobile/Backend | Bind Play Integrity verdict/request hash to the exact attendance action; use tiered response and no verdict cache | Tampered/replayed request tests |
| WF-C5-006 | P0 | PLANNED | Mobile | Use local BiometricPrompt/device credential only to unlock per-use signature; no template/result leaves OS | Physical smoke and packet/log inspection |
| WF-C5-007 | P1 | PARTIAL | Backend/Web | Complete device pending/approve/revoke/replace/lost/recovery UI with separation of duties | Old key rejected; replacement and approver are auditable |
| WF-C5-008 | P1 | PARTIAL | Backend/Web | Complete QR station create/display/rotate/disable/emergency replacement UI linked to a site, with controller health and clock-skew state | Physical display never exposes long-lived reusable token; stale/unhealthy station fails visibly |
| WF-C5-009 | P1 | PLANNED | Security/Backend | Detect concurrent sessions/devices, impossible device changes and abnormal action volume; route to review | Risk events avoid raw device identifiers in general logs |
| WF-C5-010 | P1 | OWNER DECISION | Product/HR/Security | Define site kiosk/badge/PIN mode, anti-sharing controls and emergency fallback | OD-06 resolved before kiosk implementation |
| WF-C5-011 | P1 | PLANNED | Security | Add rate limits, nonce/challenge expiry, key/secret rotation, redaction and security event alerts | Security regression suite and runbook |
| WF-C5-012 | P1 | PLANNED | HR/Security | Define lost/stolen phone, employee termination and admin compromise playbooks | Measured revoke/freeze/recovery exercises |
| WF-C5-013 | P1 | PLANNED | Security/QA | Exercise QR photo/video relay and remote screen-sharing scenarios; document proximity mitigations and residual risk | Threat test/evidence shows which policy combinations detect or cannot prevent relay |

**Gate C5:** a trusted-device claim is backed by validated hardware/app
assurance and per-use intent; QR/device controls have operational recovery and
do not masquerade as absolute human identity.

### C6 — Exceptions, no-show, correction and employee appeal

**Goal:** make uncertain or missing attendance a reviewable HR workflow rather
than a hidden calculation or direct data overwrite.

| ID | Pri | Status | Owner | Task | Acceptance evidence |
|---|---:|---|---|---|---|
| WF-C6-001 | P0 | PLANNED | HR/Product | Approve exception taxonomy, severity, owner and SLA | Glossary covers no-show, missed finish, offsite, weak/mock GPS, clock, device, QR, impossible travel and missing snapshot |
| WF-C6-002 | P0 | PLANNED | Backend | Create immutable exception case/decision lifecycle with deduplication and links to claim/evidence/workday/segment | Concurrent detection creates one case; resolution is append-only |
| WF-C6-003 | P0 | PLANNED | Backend | Generate no-show only from a published expected schedule after grace and approved leave/calendar checks | No workday alone is never treated as absence on a non-working day |
| WF-C6-004 | P1 | PLANNED | Backend/HR | Define missed checkout and stale open-shift policy: reminder, review, bounded auto-close proposal or manual correction | No silent fabricated finish time |
| WF-C6-005 | P1 | PLANNED | Web | Build exception queue with scope, risk, age, evidence completeness, employee response and next action | Manager can resolve every case without raw DB identifiers |
| WF-C6-006 | P1 | PLANNED | Web/Mobile | Let employee explain or appeal an exception and request a correction from the exact day/segment | Employee sees status/history and cannot edit accepted facts directly |
| WF-C6-007 | P1 | PARTIAL | Backend | Constrain manager corrections to configured date/duration/range rules; mark derived records as manual | Extreme/cross-period edit needs explicit escalation |
| WF-C6-008 | P1 | PLANNED | Backend | Make correction affect calculation/approval through a new ledger revision, preserving original evidence/verdict | Rehydration and approval hash tests |
| WF-C6-009 | P1 | PLANNED | Notifications | Add reminders/escalations for missed actions and aging cases without exposing reasons/location in unsafe channels | Delivery preference, retry and privacy tests |
| WF-C6-010 | P2 | PLANNED | HR/Analytics | Measure false positives, correction rate, appeal overturn rate and time-to-resolution | Aggregated metrics exclude raw coordinates/reasons |

**Gate C6:** every uncertain attendance outcome has an accountable lifecycle,
employee visibility and immutable resolution; no-show and corrections are
schedule-aware.

### C7 — HR operations, directory and separation of duties

**Goal:** make the module usable by a real HR department without raw IDs,
overbroad CRM roles or mobile-only requests.

| ID | Pri | Status | Owner | Task | Acceptance evidence |
|---|---:|---|---|---|---|
| WF-C7-001 | P1 | OWNER DECISION | HR/Security | Approve Workforce role/permission matrix and incompatible-role rules | OD-10 resolved; RACI and permission tests exist |
| WF-C7-002 | P1 | PLANNED | Backend | Implement granular scopes: employee self, team/site manager, scheduler, time approver, evidence reviewer, device admin, export custodian, retention/legal-hold officer, pilot/rollback operator and tenant admin | Least-privilege positive/negative tests |
| WF-C7-003 | P1 | PLANNED | Web | Build employee/team/site directory pickers with status and effective-date context | Configuration has no typed `teamId`/employee ID workflow |
| WF-C7-004 | P1 | PLANNED | Backend/HR | Add employment/team/site history for transfer, temporary assignment, termination and rehire | Delayed event resolves against correct historical assignment |
| WF-C7-005 | P1 | PLANNED | Web/Mobile | Deliver self-service leave, absence and time-correction creation/cancel/history | No mobile app dependency for employee web fallback; overlap conflicts explained |
| WF-C7-006 | P1 | PARTIAL | Web/Backend | Complete manager request decision queue, route conflict acknowledgement and immutable audit | Concurrent decision is idempotent and scoped |
| WF-C7-007 | P1 | PLANNED | HR/Web | Add future-effective bulk schedules/sites, preview, conflict report and reversible draft before publish | Affected employee/day count and errors shown before activation |
| WF-C7-008 | P1 | PLANNED | Backend | Freeze approvals when unresolved blocking exceptions or snapshot gaps exist | Approval error lists exact blocking rows |
| WF-C7-009 | P2 | PLANNED | HR | Define delegation, temporary approver and manager absence workflow | Delegation is bounded, expiring and audited |
| WF-C7-010 | P2 | PLANNED | Security/HR | Review access and decisions periodically; disable stale privileged assignments | Access review evidence and revocation SLA |

**Gate C7:** ordinary HR tasks use named records and least-privilege roles;
employees can submit requests without Route or an unavailable mobile app.

### C8 — Workforce web product

**Goal:** deliver complete employee, manager, HR and security surfaces separate
from Route & Field.

| ID | Pri | Status | Owner | Task | Acceptance evidence |
|---|---:|---|---|---|---|
| WF-C8-001 | P1 | PLANNED | Web | Add employee Workforce Today web fallback with one valid action, assignment, evidence requirement and sync/server outcome | HRM-only employee completes the basic day without `/mtm` |
| WF-C8-002 | P1 | PARTIAL | Web | Rebuild manager Today around scheduled roster, no-show/previous-open and exceptions rather than only existing workdays | Scheduled absent employee is visible and explained |
| WF-C8-003 | P1 | PLANNED | Web | Add multi-site day timeline and transition status | Site A/Travel/Site B plan and accepted facts are readable |
| WF-C8-004 | P1 | PARTIAL | Web | Complete timesheet: plan/fact/evidence status/exceptions/approval/correction revisions | Missing snapshots cannot look approvable |
| WF-C8-005 | P1 | PLANNED | Web | Add exception workbench and employee response/appeal context | Queue meets C6 acceptance |
| WF-C8-006 | P1 | PLANNED | Web | Add Sites/Geofences configuration with map pin, radius calibration, effective date and access scope | Changes preview impact and preserve revision history |
| WF-C8-007 | P1 | PLANNED | Web | Add schedule/calendar/break/segment policy editor with safe defaults and validation | No raw IDs; published history is immutable |
| WF-C8-008 | P1 | PLANNED | Web | Add proof-policy, QR station and trusted-device administration separated by permission | Ordinary scheduler cannot manage security factors unless granted |
| WF-C8-009 | P1 | PLANNED | Web | Add restricted evidence timeline and access audit; normal view shows verdict instead of exact coordinates | OD-11 enforced |
| WF-C8-010 | P1 | PLANNED | Web/I18n | Complete AZ/RU/EN, keyboard, focus, contrast, 200% zoom, responsive tablet/phone and error/empty states | Automated checks plus browser evidence |
| WF-C8-011 | P2 | PLANNED | Web | Add policy/version diff, effective-date impact preview and safe rollback-to-new-version | No direct historical mutation |

**Gate C8:** all four roles can complete their primary web task in an HRM-only
tenant; security/privacy controls are not mixed into ordinary scheduling.

### C9 — Employee mobile application

**Goal:** deliver a real, signed, supported employee client; server API or a CI
APK artifact alone does not close any mobile gate.

| ID | Pri | Status | Owner | Task | Acceptance evidence |
|---|---:|---|---|---|---|
| WF-C9-001 | P0 | BLOCKED | Product/Mobile | Approve repository/app ownership, Android-first scope, package/signing/distribution and supported device matrix | OD-01/OD-15 resolved; keys/credentials stay outside git |
| WF-C9-002 | P0 | PLANNED | Mobile/Backend | Implement secure login/bootstrap with tenant module manifest, permissions, policy/config versions and forced-update response | HRM-only app never calls Route endpoints |
| WF-C9-003 | P0 | PLANNED | Mobile | Build Today state machine UI with one action, current segment/site, timer and server truth | Restart/process death restores canonical state |
| WF-C9-004 | P0 | PLANNED | Mobile | Build Work Time history and day detail with pending/conflict/review/correction status | Employee distinguishes local claim from accepted fact |
| WF-C9-005 | P0 | PLANNED | Mobile | Build Requests: leave, absence, correction, cancellation, evidence-safe reason and status history | Offline-safe request flow with conflict recovery |
| WF-C9-006 | P0 | PLANNED | Mobile | Implement encrypted local database/outbox, per-domain ordering, operation IDs, retry bounds and logout/tenant-change isolation | Offline 7-day/process-death/two-account tests |
| WF-C9-007 | P0 | PLANNED | Mobile | Implement permission-aware action-time location capture and approved on-duty transition mode; stop at Finish/off-shift | Physical background/permission/battery tests and OD-03 enforcement |
| WF-C9-008 | P0 | PLANNED | Mobile | Implement QR scanner with fresh-token immediate path; never persist raw QR or queue an expired scan | Storage/log inspection and replay tests |
| WF-C9-009 | P0 | PLANNED | Mobile | Implement device enrollment, attested key, local authentication, revoke/replace cleanup and exact-action signature | Physical H5 matrix passes |
| WF-C9-010 | P1 | PLANNED | Mobile | Implement offline/conflict/review recovery center and safe re-scan/re-capture rules | Every server code has a user recovery flow |
| WF-C9-011 | P1 | PLANNED | Mobile | Add push/local reminders for shift/segment/missed action with privacy-safe notification text | Permission and delivery-failure states tested |
| WF-C9-012 | P1 | PLANNED | Mobile | Add AZ/RU/EN, TalkBack, 200% font, 48 dp, reduced motion, poor-vision/color-independent states | Physical accessibility acceptance |
| WF-C9-013 | P1 | PLANNED | Mobile/SRE | Add privacy-safe crash/sync telemetry, build SHA, app version and device-class diagnostics | No token, raw QR/GPS or employee reason in telemetry |
| WF-C9-014 | P1 | PLANNED | Mobile | Implement version migration, forced upgrade, offline outbox drain and safe uninstall/lost-device guidance | Supported-version matrix and rollback drill |
| WF-C9-015 | P2 | OWNER DECISION | Product/Mobile | Decide iOS release/parity scope after Android pilot evidence | Separate approved iOS roadmap or explicit exclusion |

**Gate C9:** a signed app completes normal and failure flows on supported
physical devices; there is no reliance on a web mock, emulator-only evidence or
another repository's generic preview build.

### C10 — Privacy, retention, legal hold and employee transparency

**Goal:** collect the minimum necessary evidence, restrict access and enforce
the recorded 30-day/one-year lifecycle safely.

| ID | Pri | Status | Owner | Task | Acceptance evidence |
|---|---:|---|---|---|---|
| WF-C10-001 | P0 | BLOCKED | Legal/Privacy/HR | Approve purpose, notice, lawful/contract basis, fallback and employee inquiry/appeal channel | OD-12 resolved before real location collection |
| WF-C10-002 | P0 | PLANNED | Backend/Privacy | Classify raw location, derived verdict, time fact, request reason, device evidence, audit and export separately | Data dictionary enforced in code/runbooks |
| WF-C10-003 | P0 | PLANNED | Backend | Implement tenant-scoped bounded purge for all raw GPS copies, including workday/event start/end coordinates, after 30 days | Dry-run/delete/reconciliation tests prove no raw coordinate remains |
| WF-C10-004 | P0 | PLANNED | Backend | Implement one-year time/decision retention with explicit eligible classes, legal-hold fail-closed check and immutable purge audit | Hold and no-hold integration tests |
| WF-C10-005 | P0 | PLANNED | Backend/SRE | Add retention dry run, backup/restore verification, batching, resume cursor, pressure stop and metrics | Staging retention drill is recoverable and auditable |
| WF-C10-006 | P1 | PLANNED | Security/Web | Enforce restricted raw-evidence access, purpose/reason, access log and periodic review | Unauthorized manager receives no raw coordinates |
| WF-C10-007 | P1 | PLANNED | Backend | Preserve derived inside/outside/unknown verdict and approved time after raw evidence purge without retaining reversible exact location | Post-purge report/test fixture |
| WF-C10-008 | P1 | PLANNED | Product/Mobile/Web | Show employees when/why location is captured, permission state, retention summary and how to request correction | AZ/RU/EN acceptance with no covert state |
| WF-C10-009 | P1 | PLANNED | Backend/Privacy | Implement employee/tenant data access/export/deactivation workflows with redaction and third-party separation | Subject/contract request test and approval audit |
| WF-C10-010 | P1 | PLANNED | Security/SRE | Add privacy/security incident runbook for location/device/export exposure | Tabletop drill, notification owner and evidence preservation |
| WF-C10-011 | P2 | PLANNED | Privacy/Analytics | Use aggregated/minimized operational metrics; forbid raw location/reasons in general analytics | Schema/log scanners and dashboard review |

**Gate C10:** collection and access are transparent, raw evidence expires in
code as promised, holds fail closed and normal managers do not receive exact
location by default.

### C11 — Timesheet, approvals, export and reporting

**Goal:** produce reproducible approved time without silently becoming a
payroll engine or leaking sensitive evidence.

| ID | Pri | Status | Owner | Task | Acceptance evidence |
|---|---:|---|---|---|---|
| WF-C11-001 | P1 | PARTIAL | Backend | Complete deterministic calculation for segments, approved breaks/travel, calendar, exceptions and corrections | Rehydration/property tests from immutable snapshots |
| WF-C11-002 | P1 | PARTIAL | Backend/Web | Block approval on incomplete facts, unresolved blocking cases or snapshot/history errors | Exact rows/reasons shown; valid bounded period approves once |
| WF-C11-003 | P1 | PLANNED | Backend | Add approved-export endpoint from immutable approval/revision, never live mutable rows | Checksum and facts/rows hashes verify |
| WF-C11-004 | P1 | PLANNED | Security/Web | Require purpose, recipient, authorized scope and encrypted delivery channel; set artifact expiry | Export audit and unauthorized/expired download tests |
| WF-C11-005 | P1 | PLANNED | Web | Add preview, row count, date/employee/site scope, warnings and correction version before export | User knows exactly what will leave the system |
| WF-C11-006 | P1 | PLANNED | Backend | Keep raw coordinates, QR/device proofs and free-text reasons out of ordinary timesheet export | Contract/privacy tests |
| WF-C11-007 | P1 | PLANNED | Web/Analytics | Add schedule/actual, late, no-show, overtime, break, site-transition and exception reports with scope/date filters | Metrics reconcile to approved facts |
| WF-C11-008 | P1 | PLANNED | HR/Product | Label overtime as operational deviation, not payable amount | Copy and export schema contain no wage claim |
| WF-C11-009 | P2 | PLANNED | Product | Define future payroll/integration contract only after jurisdiction, rounding and accountable system-of-record decisions | Separate approved project; not implicit in v1 |
| WF-C11-010 | P2 | PLANNED | Backend | Add signed/versioned integration export and delivery retry ledger if external HRIS is approved | Idempotent recipient delivery and reconciliation |

**Gate C11:** an authorized human can approve and securely export a complete,
reproducible period; no output is presented as payroll and no sensitive proof
leaks into the ordinary file.

### C12 — Reliability, observability, scale and operations

**Goal:** keep critical attendance delivery measurable and isolated from other
LeadDrive modules.

| ID | Pri | Status | Owner | Task | Acceptance evidence |
|---|---:|---|---|---|---|
| WF-C12-001 | P0 | PLANNED | SRE/Product | Approve SLOs: online acknowledgement, pending age, event loss, conflict/error rates and recovery | Thresholds and paging/runbook ownership recorded |
| WF-C12-002 | P0 | PLANNED | Backend/SRE | Emit tenant-safe metrics by stream/app/schema/policy result without high-cardinality employee/location data | Dashboard and cardinality/privacy review |
| WF-C12-003 | P0 | PLANNED | SRE/QA | Run 5,000-user morning START wave with jitter on isolated staging and representative trust-off/trust-on profiles | p95/p99, DB/queue metrics and zero-loss reconciliation |
| WF-C12-004 | P0 | PLANNED | Backend/SRE | Prove Workforce and Route queue/cursor/failure isolation under 503, timeout and overload | One stream failure does not delay the other |
| WF-C12-005 | P1 | PLANNED | Backend | Bound retries/backoff, payload size, batch size, per-tenant fairness and poison-operation quarantine | Load/chaos tests and operator recovery |
| WF-C12-006 | P1 | PLANNED | SRE | Schedule and monitor cleanup/retention/reminder/no-show jobs with leases, cursors and stale-job alerts | Production-like scheduler evidence |
| WF-C12-007 | P1 | PLANNED | SRE/DBA | Validate indexes/query plans, partition/archive need, storage forecast and backup/restore RTO/RPO | 5k plan plus one-year storage model |
| WF-C12-008 | P1 | PLANNED | Backend/SRE | Add reconciliation jobs for claim/event/assessment/exception/approval/export invariants | Mismatch is detected without automatic destructive repair |
| WF-C12-009 | P1 | PLANNED | SRE | Complete freeze/cohort/rollback and offline-drain runbooks; exercise them | Timed tabletop/staging rollback evidence |
| WF-C12-010 | P2 | PLANNED | Support/Product | Create privacy-safe support diagnostics and escalation playbook | Support resolves sync/device cases without raw secrets |

**Gate C12:** critical events are measured end to end, zero-loss reconciliation
passes, scale targets pass and rollback has been exercised.

### C13 — Additive migration and backward compatibility

**Goal:** introduce the new model without corrupting current workdays, breaking
old clients or coupling Workforce back to Route.

| ID | Pri | Status | Owner | Task | Acceptance evidence |
|---|---:|---|---|---|---|
| WF-C13-001 | P0 | PLANNED | Backend/DBA | Write additive schema ADR and migration sequence; no rename/drop/destructive backfill | Prisma validate/generate and migration contract tests |
| WF-C13-002 | P0 | PLANNED | Backend | Keep one canonical domain service behind legacy/new endpoints; prevent divergent state machines | Contract parity tests |
| WF-C13-003 | P0 | PLANNED | Backend | Version mobile request/response/evidence schemas and advertise support in bootstrap | Old/new app matrix with structured upgrade response |
| WF-C13-004 | P0 | PLANNED | Backend | Preserve legacy facts as `LEGACY/UNKNOWN` proof rather than fabricating site/device assurance | Backfill dry run and report distinction |
| WF-C13-005 | P1 | PLANNED | Backend | Introduce read path by feature flag: new snapshots/evidence where available, explicit missing state otherwise | No silent fallback to live policy for approval |
| WF-C13-006 | P1 | PLANNED | Backend/QA | Test Neither, HRM-only, Routes-only and Both for APIs, jobs, nav, sync, mobile and failures | Four-mode matrix in CI |
| WF-C13-007 | P1 | PLANNED | SRE | Define migration rollout, compatibility window, metrics, freeze and rollback without schema deletion | Staging rehearsal and production change plan |
| WF-C13-008 | P1 | PLANNED | Backend/Mobile | Drain/deprecate legacy mutation paths only after app adoption and offline horizon; return explicit unsupported-version code afterward | Usage reaches approved threshold and no pending old outbox remains |
| WF-C13-009 | P1 | PLANNED | QA | Reconcile before/after workday counts, event hashes, approvals, tenant scope and reports | Zero unexplained delta |

**Gate C13:** migrations are forward-compatible, old data is honestly labelled,
supported clients remain idempotent and rollback does not delete history.

### C14 — Verification, physical pilot and controlled release

**Goal:** close H6 with real evidence, one LeadDrive cohort and staged expansion.

| ID | Pri | Status | Owner | Task | Acceptance evidence |
|---|---:|---|---|---|---|
| WF-C14-001 | P0 | PLANNED | QA | Maintain unit/property tests for time, schedules, geofence, evidence composition, assessment, exceptions, retention and approvals | Coverage maps to traceability register |
| WF-C14-002 | P0 | PLANNED | QA/Security | Run tenant/RLS/role/IDOR, replay, backdating, QR relay assumptions, GPS spoof signals, attestation and admin-abuse tests | No open P0/P1 security finding |
| WF-C14-003 | P0 | PLANNED | QA/Web | Run browser E2E for employee/manager/HR/security roles in AZ/RU/EN at desktop/tablet/phone and 200% zoom | Artifacts show success/error/recovery states |
| WF-C14-004 | P0 | BLOCKED | QA/Mobile | Run signed physical Android matrix on at least two device classes: install/update, GPS/permission, QR, attestation, biometric unlock, offline, process death, reboot and date rollover | Exact build SHA/checksum and pass/fail evidence |
| WF-C14-005 | P0 | PLANNED | QA | Test multi-site 09-13 A, travel, 14-18 B; wrong site, weak GPS, delayed upload and transfer during offline | Expected assessment/case/timesheet outcome |
| WF-C14-006 | P0 | PLANNED | QA/SRE | Run load/chaos/reconciliation/backup/retention/export drills in isolated staging | C10-C12 gates met |
| WF-C14-007 | P0 | BLOCKED | Product/HR/Privacy | Record named LeadDrive pilot cohort, participants, devices, policies, sites, notice, observation window and rollback owner outside git | OD-14 and all legal gates resolved |
| WF-C14-008 | P0 | PLANNED | SRE/Product | Enable exact cohort behind write fence; preserve Route independence and daily evidence review | No global enablement; daily metric/exception report |
| WF-C14-009 | P0 | PLANNED | Product/HR/QA | Complete pilot exit review: usability, false positives, corrections, appeals, event loss, privacy complaints and SLO | Signed GO/NO-GO; no open P0/P1 |
| WF-C14-010 | P1 | PLANNED | Product/SRE | Release to official LeadDrive use only after green gates; initially prohibit automatic payroll/discipline | Main/CI/deploy/smoke evidence and communication |
| WF-C14-011 | P1 | PLANNED | Product | Add a Both-modules tenant cohort only after HRM-only LeadDrive evidence; then measured tenant-by-tenant expansion | Route/Workforce isolation and cohort observation pass |
| WF-C14-012 | P1 | PLANNED | Support/HR | Publish administrator/employee help and incident/recovery guides from the verified product | Guides match actual app/screens; no unverified promise |

**Gate C14:** real physical and human acceptance is recorded, no P0/P1 remains,
retention/privacy/export/rollback work in staging, and the named cohort receives
a controlled release through the normal GitHub path.

## 8. Critical path and parallel work

```text
C0 contract/threat/privacy baseline
  -> C1 time provenance/offline safety
  -> C2 sites + multi-site segments
  -> C4 evidence/assessment engine
  -> C5 device/QR assurance
  -> C9 signed mobile app
  -> C14 physical LeadDrive pilot

Parallel after C0/C1:
  C3 schedule/calendar/breaks ------┐
  C6 exceptions/appeals -----------+-> C11 approval/export
  C7 roles/HR operations ----------+
  C8 web product ------------------+
  C10 privacy/retention -----------+
  C12 reliability/scale -----------+
  C13 migration/compatibility -----┘
```

No calendar estimate is asserted before team capacity, mobile platform scope
and legal gates are known. Progress is measured by gates and evidence, not by a
date chosen without owners.

## 9. Milestone roadmap

| Milestone | Included phases | User-visible outcome | Exit rule |
|---|---|---|---|
| M0 — Safe foundation | C0-C1 | Current voluntary timekeeping no longer accepts unsafe historical facts as normal attendance | C1 gate green |
| M1 — Schedulable presence | C2-C4 | HR can define sites, multi-site segments and explain geo/QR/device requirements | C2-C4 green; no real employee monitoring yet |
| M2 — Reviewable HR operations | C3, C6-C8 | HR/manager/employee web workflows cover schedules, no-show, exceptions, requests, corrections and approvals | C3/C6-C8 green |
| M3 — Trusted mobile beta | C5, C9, C13 | Signed Android app supports secure online/offline attendance and recovery | Physical internal matrix green |
| M4 — Privacy-safe reporting | C10-C12 | Retention, access control, approved export, SLOs and scale are operational | Retention/export/load drills green |
| M5 — LeadDrive pilot | C14 | One named LeadDrive cohort uses the complete flow under observation | Pilot GO; no open P0/P1 |
| M6 — Commercial expansion | C14 plus deferred P2 | HRM-only then Both tenants expand one cohort at a time | Per-cohort evidence and rollback owner |

## 10. Mandatory verification matrix

### 10.1 Functional and HR

- ordinary Baku 09:00-18:00 day with actual 13:00-14:00 pause;
- missing pause under every approved lunch policy;
- late within/outside 15-minute grace;
- scheduled employee with no workday, approved leave, holiday and non-working
  day;
- prior-day open shift, missed finish and manager correction;
- overnight, split shift and date rollover after OD-08;
- Site A -> Travel -> Site B with arrival/departure and delayed upload;
- temporary site assignment and employee team/site transfer;
- request overlap, concurrent decisions, appeal and correcting approval;
- HRM-only, Routes-only, Both and Neither.

### 10.2 Identity and evidence

- valid session without required evidence fails/reviews according to policy;
- stolen/shared-account scenario is bounded by MFA, device and risk controls;
- QR valid, expired, replayed, wrong tenant/site/action and disabled station;
- QR relay is retained as a documented residual risk when proximity evidence is
  absent;
- device pending, active, revoked, replaced, lost and two-device race;
- hardware-backed/untrusted/software key and attestation revocation;
- Play Integrity exact-request hash, replay, stale verdict and tampered app;
- local biometric/device credential success, cancel, lockout and unavailable;
- GPS inside, boundary, outside, missing, stale, future, low accuracy, mock
  suspicion and permission denial;
- impossible travel and high-speed transition produce review, not automatic
  punishment.

### 10.3 Offline and reliability

- online and offline START/PAUSE/RESUME/FINISH order;
- event at 6d23h59m, exactly 7d and beyond 7d;
- process death before send, after send before response and after server commit;
- airplane mode, intermittent network, timeout, 503, partial batch and retry;
- two devices, duplicate operation, same ID/different payload and app upgrade;
- tenant/account switch with pending outbox;
- Route failure while Workforce sends and Workforce failure while Route sends;
- 5,000 morning starts with jitter and no business-event loss;
- DB/job/queue failure, reconciliation, freeze and rollback.

### 10.4 Privacy, access and retention

- normal manager cannot read raw coordinates/device security material;
- authorized evidence reviewer access requires scope/purpose and is audited;
- notification/log/crash/export contains no raw QR/token/biometric template or
  unnecessary GPS/reason;
- 30-day raw GPS purge covers every copy and keeps a non-reversible verdict;
- one-year fact/decision purge respects legal hold and backup gate;
- export requires approved period, purpose, recipient, encryption and expiry;
- deactivated/terminated employee loses access/device trust while immutable
  history remains until approved retention.

### 10.5 Accessibility and localization

- AZ/RU/EN complete and semantically equivalent;
- TalkBack announces state, evidence request, pending/server result and recovery;
- keyboard/focus/labels/contrast/200% zoom/reduced motion;
- 48 dp mobile targets and no critical hover-only action;
- long names, large teams, zero/one/thousands of rows and all empty/error states.

## 11. Definition of done

A task or phase is `DONE` only when all applicable items are true:

1. Owner/legal decision is recorded where required.
2. Schema/API/UX contract and threat/privacy implications are reviewed.
3. Tenant/RLS, role and negative paths are tested.
4. Additive migration has validate/generate/migration evidence and rollback.
5. New copy is complete in AZ/RU/EN.
6. Targeted tests and static checks pass in the exact tree.
7. Full build/browser/Android/load gates run only in approved CI/heavy workers;
   unrun gates are recorded as `NOT RUN` with reason.
8. Visible behavior has browser or physical-device evidence; source inspection
   alone does not close it.
9. Metrics, support and rollback exist before a real cohort.
10. Checkpoint commit contains only task-owned paths and an evidence entry.

## 12. First implementation sequence after roadmap approval

The first safe implementation checkpoint must stay independent of mobile,
geofence policy and legal monitoring decisions:

1. `WF-C0-002` threat model and `WF-C0-007` traceability register.
2. `WF-C1-001` timestamp/provenance contract.
3. `WF-C1-002` seven-day offline enforcement in every current writer.
4. `WF-C1-003` pending-review outcome for delayed/ambiguous claims.
5. `WF-C1-004` complete idempotency binding.
6. `WF-C1-005` atomic/reconstructable audit.
7. Targeted unit/API/concurrency tests and checkpoint commit.

Only after this checkpoint should the repository add C2 site/geofence schema.
OD-03/OD-05/OD-09 must be resolved before any production location policy is
enabled. Mobile C9 starts after OD-01/OD-02/OD-15 and never modifies LeadShelf
from this worktree.

## 13. Evidence status at roadmap creation

- Source/workflow audit completed on `ffb412f15`.
- Targeted tests observed in the same tree:
  - `workforce-attendance-trust`: 5 passed;
  - `lib-mtm-workday`: 10 passed;
  - shift definition and timesheet calculation: 17 passed.
- `NOT RUN`: full build, full browser E2E, physical Android/QR/GPS, 5,000-user
  load, formal legal/privacy assessment and real LeadDrive pilot.
- No deploy, production mutation, capability toggle or retention deletion is
  authorized by this document.
