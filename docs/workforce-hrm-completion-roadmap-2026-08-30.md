# Workforce HRM — completion roadmap

> **Status:** current C6 server slices delivered; C6 roadmap and physical pilot remain open
> **Date:** 2026-08-30
> **Scope:** employee time, attendance evidence, offices and branches, schedules,
> HR requests, exceptions, device trust, mobile application, privacy, export,
> operations and controlled rollout
> **Delivery repository:** `rashadoni/leaddrive-v2`; reviewable slices merge through `main`
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
> [`workforce-c5-attendance-admin-ui-evidence-2026-08-30.md`](./workforce-c5-attendance-admin-ui-evidence-2026-08-30.md),
> [`workforce-c6-exception-intake-evidence-2026-08-30.md`](./workforce-c6-exception-intake-evidence-2026-08-30.md),
> [`workforce-c6-exception-case-lifecycle-evidence-2026-08-30.md`](./workforce-c6-exception-case-lifecycle-evidence-2026-08-30.md),
> [`workforce-c7-self-service-request-evidence-2026-08-30.md`](./workforce-c7-self-service-request-evidence-2026-08-30.md),
> [`mobile-sync-v2-workforce-contract.md`](./mobile-sync-v2-workforce-contract.md),
> [`workforce-c7-directory-picker-evidence-2026-08-30.md`](./workforce-c7-directory-picker-evidence-2026-08-30.md),
> [`workforce-c6-scoped-decision-api-evidence-2026-08-31.md`](./workforce-c6-scoped-decision-api-evidence-2026-08-31.md),
> [`workforce-c7-employment-history-evidence-2026-08-30.md`](./workforce-c7-employment-history-evidence-2026-08-30.md),
> [`workforce-c9-mobile-bootstrap-release-evidence-2026-08-30.md`](./workforce-c9-mobile-bootstrap-release-evidence-2026-08-30.md),
> [`workforce-c9-android-foundation-evidence-2026-08-30.md`](./workforce-c9-android-foundation-evidence-2026-08-30.md),
> [`workforce-c9-action-time-location-contract-evidence-2026-08-31.md`](./workforce-c9-action-time-location-contract-evidence-2026-08-31.md),
> [`workforce-c9-action-time-location-binding-evidence-2026-08-31.md`](./workforce-c9-action-time-location-binding-evidence-2026-08-31.md),
> [`workforce-c14-browser-e2e-foundation-evidence-2026-08-30.md`](./workforce-c14-browser-e2e-foundation-evidence-2026-08-30.md).

## 1. Purpose and honest starting point

### 1.0 Current delivery receipt (2026-09-13)

The current C6 exception-management server chain has now been delivered as
bounded pull requests rather than by merging the original large implementation
branch. This receipt does not mark the broader C0-C14 roadmap complete:

- PR #109 / `4de8c4e44fdc6a58e6d900c3f43be1ef740d2a3a`: historical employment and
  schedule resolution plus transaction-safe, idempotent exception writes;
- PR #115 / `b4102588ceb245e5f1163f393cc5256a62dcdc27`: review-only no-show and
  missed-finish materialization under owned transactions and advisory locks;
- PR #119 / `72aea540f4b322cc60c6b3e19bb3ec3c61ddcfb1`: MFA/rate-limit fences and
  fixed-label privacy-safe failure logging for HR decisions and employee
  responses.

Each slice stayed below the 400 KB review limit, received an independent
security/concurrency review, and passed its current GitHub static, typecheck,
scope, runner-policy and secret-scan gates before merge. PR #109 and PR #115
have matching successful production deployment receipts and public build SHA
verification. PR #119 deployment workflow `34730054162` also completed
successfully; the public build endpoint returned the exact artifact SHA
`72aea540f4b322cc60c6b3e19bb3ec3c61ddcfb1` and `/api/v1/ping` returned
`{"ok":true}`.

This source-delivery milestone does not convert external evidence into a pass.
The following remain explicitly **NOT RUN / externally gated**:

- signed physical Android testing on two device classes, including QR, GPS,
  device attestation, biometric unlock, offline recovery, reboot and rollover;
- a named human LeadDrive pilot and its HR/employee sign-off;
- the isolated 5,000-user wave, chaos/reconciliation and restore drill;
- activation of any policy that treats location/device evidence as payroll,
  disciplinary or conclusive physical-presence proof.

These items require real devices, people or a deliberately scheduled isolated
staging exercise. Their absence does not reopen the delivered C6 server chain,
but it does block any claim that the broader roadmap or physical/mobile H6 pilot
is complete.

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
| H6 pilot/scale | **NOT MET** | No named physical LeadDrive cohort, real app/device matrix, 5,000-user result or pilot exit decision; the owner-confirmed privacy notice does not replace these operational gates |

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
| OD-07 | Lunch treatment | **Confirmed v1:** actual Pause/Resume and no automatic deduction. Paid/unpaid treatment remains an HR/legal decision before official timesheet use. | C3, C11 |
| OD-08 | Overnight and split shifts | **Confirmed v1 exclusion:** no overnight/split-shift calculation. Work-date/rest rules still need HR/legal approval before a later phase. | C3 |
| OD-09 | Inter-branch travel | **Confirmed v1:** no travel-pay calculation. Existing explicit `TRAVEL` segments stay non-payroll; future paid/expected treatment remains tenant-policy work. | C2, C3, C11 |
| OD-10 | Exact role separation | **Confirmed v1 draft:** least-privilege role vocabulary plus scheduler/time approver, time approver/team manager, evidence reviewer/device-security admin and export custodian/retention-hold incompatibilities. Durable RACI enforcement remains C7 work. | C7, C8, C10 |
| OD-11 | Location visibility | Normal manager view shows verdict/reason, not raw coordinates; restricted drill-down only for authorized investigations | C8, C10 |
| OD-12 | Employee monitoring legal basis/notice | **Confirmed platform boundary:** section 9 EN/RU/AZ discloses purpose, collection, visibility, 30-day raw retention, controller/processor roles and rights channel; each employer must still establish its applicable basis and notify employees before enabling a real cohort | C10, C14 |
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
| 2026-08-30T08:22:00+02:00 | C2i geofence snapshot completion | 16% | C2 64% | 33/161 | 0/15 | WF-C2-004 accepted: validated effective circle revisions are pinned with scheduled site/eligibility context at accepted START; later site changes cannot rewrite historical evidence |
| 2026-08-30T02:02:00+02:00 | C4a evidence-envelope contract | 7% | C4 10% | 14/161 | 0/15 | WF-C4-001 accepted: strict versioned evidence envelope and tenant-HMAC redaction exist; collection, geofence evaluation, proof verification and persistence remain open |
| 2026-08-30T02:06:00+02:00 | C4b snapshotted circle evaluation | 7% | C4 20% | 15/161 | 0/15 | WF-C4-002 accepted: server-side Haversine evaluates the immutable 25–5,000 m circle; uncertainty at a boundary stays `UNKNOWN` and no evidence is persisted |
| 2026-08-30T02:10:00+02:00 | C4c location-quality baseline | 8% | C4 30% | 16/161 | 0/15 | WF-C4-003 accepted: versioned action-time policy preserves stale/weak/mock/provider/permission outcomes as explainable review or unavailable states; legal/pilot activation remains blocked |
| 2026-08-30T02:18:00+02:00 | C4d QR station/site binding | 8% | C4 40% | 17/161 | 0/15 | WF-C4-004 accepted: QR v2 cryptographically binds tenant/station/site/revision/action/expiry/nonce; legacy unbound station rows remain auditable but cannot issue/verify new QR |
| 2026-08-30T02:23:00+02:00 | C4e proof-policy composition | 9% | C4 50% | 18/161 | 0/15 | WF-C4-005 accepted: versioned all-of/any-of/optional proof rules return exact missing methods and a safe fallback state; no tenant policy was implicitly enabled |
| 2026-08-30T02:28:00+02:00 | C4f encrypted evidence/assessment split | 9% | C4 60% | 19/161 | 0/15 | WF-C4-006 accepted: append-only encrypted evidence and raw-free assessments are separate; due ciphertext purge retains a report-safe verdict/receipt |
| 2026-08-30T02:31:00+02:00 | C4g review-only risk hints | 10% | C4 70% | 20/161 | 0/15 | WF-C4-007 accepted: versioned impossible-transition and clock signals are deterministic review hints only, with no automatic guilt or decision |
| 2026-08-30T02:35:00+02:00 | C4h safe assessment explanation | 10% | C4 80% | 21/161 | 0/15 | WF-C4-009 accepted: employee/manager contract maps known evidence outcomes to recovery keys and collapses unknown internal security detail to generic review |
| 2026-08-30T02:39:00+02:00 | C4i GPS edge matrix | 11% | C4 90% | 22/161 | 0/15 | WF-C4-010 accepted: automated matrix covers zero/boundary/stale/future/weak/mock/provider/permission outcomes with no silent acceptance |
| 2026-08-30T08:28:00+02:00 | C2j transition/evidence link | 17% | C2 73% | 34/161 | 0/15 | WF-C2-007 accepted: arrival/departure facts require a snapshotted SITE segment and C4 evidence/assessment is tenant-FK-linked without raw proof in the transition ledger |
| 2026-08-30T08:41:02+02:00 | C5a attendance administration UI (partial) | 21% | C5 0% | 42/161 | 0/15 | QR image display/expiry/disable and verified-device approve/revoke are visible without exposing token/key material; physical, recovery and assurance conditions remain open |
| 2026-08-30T12:40:00+02:00 | C5c attendance endpoint throttling (partial) | 31% | C5 8% | 62/161 | 0/15 | WF-C5-011 has fingerprinted, endpoint-specific rate limits for QR issue and device enrollment/proof before sensitive database work; central limiting, key rotation and security-alert operations remain open, so no completion credit is claimed |
| 2026-08-30T12:50:00+02:00 | C5d review-only security triage (partial) | 31% | C5 8% | 62/161 | 0/15 | WF-C5-009 now returns bounded aggregate prompts for concurrent trusted-device use, enrollment churn and action volume without exposing device IDs or mutating facts; formal case lifecycle, granular reviewer scope and pilot calibration remain open, so no completion credit is claimed |
| 2026-08-30T17:45:33+02:00 | C6c case-subject integrity hardening (partial) | 32% | C6 10% | 64/161 | 0/15 | WF-C6-002 now prevents a case from linking another employee's evidence or a non-snapshotted segment to a concrete workday; detector/writer/lifecycle and migration apply remain deliberately inactive |
| 2026-08-30T17:52:56+02:00 | C6d immutable transaction writer (partial) | 32% | C6 10% | 64/161 | 0/15 | WF-C6-002 now has a canonical raw-proof-free case/decision insert primitive with exact replay and changed-payload conflict behavior; endpoint, authorization, taxonomy, lifecycle and applied migration remain unavailable |
| 2026-08-30T12:42:35+02:00 | C5e attendance-security MFA gate (partial) | 31% | C5 8% | 63/161 | 0/15 | WF-C5-002 now fails closed on critical QR/device-admin mutations unless the accountable live admin has mandatory enrolled MFA; per-use/mobile step-up, hardware assurance and physical evidence remain open, so no completion credit is claimed |
| 2026-08-30T12:55:00+02:00 | C5g MFA-gated mobile release control plane (partial) | 31% | C5 8% | 63/161 | 0/15 | WF-C5-002 also now fails closed before any mobile write-fence/cohort mutation unless the accountable session has mandatory enrolled MFA; read-only posture inspection remains available to the existing session-admin boundary |
| 2026-08-30T14:30:00+02:00 | C5h device separation of duties (partial) | 31% | C5 8% | 63/161 | 0/15 | WF-C5-007 now blocks self-approval of a linked employee's pending device, retains self-revoke as lost-factor containment, and exposes replacement lineage/terminal status without key or proof disclosure; signed-mobile recovery and physical evidence remain open, so no completion credit is claimed |
| 2026-08-30T13:42:00+02:00 | C5i atomic QR emergency replacement (partial) | 31% | C5 8% | 63/161 | 0/15 | WF-C5-008 now has an MFA-gated, deliberate create-and-retire replacement that preserves the current effective site/circle binding and leaves a redacted audit trail; controller health, skew, physical display and QR relay limits remain external, so no completion credit is claimed |
| 2026-08-30T17:07:38+02:00 | C6b safe exception/no-show intake (partial) | 32% | C6 10% | 64/161 | 0/15 | WF-C6-001/003 now have a pure review-only taxonomy/no-show proposal that requires published schedule, eligible unexcused calendar, complete no-workday observation and expired grace. It assigns no owner/severity/SLA and creates no case/job/notification, so no completion credit is claimed |
| 2026-08-30T17:10:21+02:00 | C6c safe missed-finish intake (partial) | 32% | C6 10% | 64/161 | 0/15 | WF-C6-004 now has a pure generic-reminder/review proposal that needs an immutable schedule snapshot and complete open-workday observation, and permanently refuses to invent a finish. No policy timing, job, notification, auto-close or case is activated, so no completion credit is claimed |
| 2026-08-30T17:16:05+02:00 | C6d immutable case/decision ledger (partial) | 32% | C6 10% | 64/161 | 0/15 | WF-C6-002 now has additive tenant/RLS/append-only schema and raw-proof-free deterministic case/decision drafts. Migration apply, owner taxonomy/RACI, transaction writer, UI and browser evidence remain open, so no completion credit is claimed |
| 2026-08-30T17:32:48+02:00 | C6e correction-bounds policy evaluator (partial) | 32% | C6 10% | 64/161 | 0/15 | WF-C6-007 now has a versioned pure date/window/duration/boundary evaluator that routes absent, closed or extreme policy states to review. Tenant policy selection, endpoint wiring and escalation ownership remain open, so no completion credit is claimed |
| 2026-08-30T17:39:40+02:00 | C6f employee correction-response bridge (partial) | 32% | C6 10% | 64/161 | 0/15 | WF-C6-006 now records the safe own-workday correction/status bridge to C7 self-service. Formal C6 case/segment appeal lifecycle, applied schema, mobile and browser evidence remain open, so no completion credit is claimed |
| 2026-08-30T09:28:46+02:00 | C7a employee self-service web fallback | 23% | C7 10% | 47/161 | 0/15 | WF-C7-005 accepted: self-scoped leave/absence/time-correction submission, history and pending cancellation are timezone-aware, idempotent and do not mutate facts before manager decision |
| 2026-08-30T09:37:45+02:00 | C7b named HR directory and site assignment | 24% | C7 20% | 48/161 | 0/15 | WF-C7-003 accepted: named tenant employee/team/site pickers expose status and effective-date context; future site eligibility remains Workforce-only and server-validated |

| 2026-08-30T20:25:00+02:00 | C6j authorized immutable case writer (partial) | 33% | C6 20% | 66/161 | 0/15 | WF-C6-002 now requires an injected authorization decision before any C6 writer lock/write, serializes the immutable case or case-decision stream with a PostgreSQL advisory transaction lock, and adds metadata-only ledger audit on a new record. Exact replay remains idempotent and unauthorised input touches neither lock nor database. No endpoint, detector, tenant policy, lifecycle activation, migration apply or case is created; focused source contracts pass and staging/browser/physical evidence remains NOT RUN |
| 2026-08-30T18:45:00+02:00 | C6g/C7j recommended HR policy drafts | 33% | C6 20%; C7 50% | 66/161 | 0/15 | WF-C6-001 and WF-C7-001 accepted as owner-approved, source-tested v1 **drafts**: non-disciplinary exception taxonomy/triage/owner/targets/lifecycle and least-privilege incompatible-role pairs. Neither grants nor an HR policy are activated for any tenant; durable enforcement, lifecycle, migration and rollout evidence remain open |

| 2026-08-30T19:10:00+02:00 | C6h policy-aware immutable decision draft (partial) | 33% | C6 20% | 66/161 | 0/15 | WF-C6-002 now has an opt-in pure adapter that validates a candidate immutable decision against the complete caller-supplied recommended-v1 sequence and fails closed before emitting a draft. It performs no database read/write, tenant activation or authorization; applied migration, transaction concurrency, endpoint and employee-visible queue remain open |

| 2026-08-30T19:30:00+02:00 | C6i raw-proof-free exception queue projection (partial) | 33% | C6 20% | 66/161 | 0/15 | WF-C6-005 now has a pure queue item projection for already authorized scoped input: display reference/name, triage, age, lifecycle, restricted evidence state, employee response and human next action only. Unknown lifecycle becomes integrity review; no database ID/proof/reason, query, endpoint, UI or tenant workflow is activated |

| 2026-08-31T10:22:00+02:00 | C6k exception review web/API slice | 34% | C6 15% | 72/161 | 0/15 | WF-C6-005 now has a session-admin, tenant-scoped, hard-capped raw-proof-free queue endpoint and EN/RU/AZ web workbench. It shows risk, age, evidence completeness, employee-response state and next human action, and refuses to mutate attendance/pay/discipline. API, projection and voice-coverage contracts pass (16 tests); real case-linked appeal, granular grants, immutable resolution, browser/physical/staging evidence remain open, so no completion credit is claimed. |
| 2026-08-31T10:34:00+02:00 | C6l immutable employee-response ledger | 34% | C6 15% | 72/161 | 0/15 | WF-C6-006 now has an additive inactive employee acknowledgement/correction-request ledger: one tenant employee/user, exact case/workday/segment and same-workday self correction are enforced by an append-only RLS migration; writer authorization precedes locking/writing and retries are exact. Prisma validate and 9 focused contracts pass. Migration apply, self-scoped case API/UI/mobile, granular grants, notification and physical/staging evidence remain NOT RUN, so no completion credit is claimed. |
| 2026-08-31T10:37:00+02:00 | C6m self-scoped employee response API | 34% | C6 15% | 72/161 | 0/15 | WF-C6-006 now has a session-only self response endpoint. It derives exact own case/workday/segment server-side, has an indistinguishable unavailable result for missing/cross-employee ids, and permits only acknowledgement or existing own correction-request linkage. 13 source/API contracts pass. No migration apply, employee discovery UI/mobile, notification, granular HR workflow, browser/physical/staging evidence or completion credit is claimed. |
| 2026-08-31T10:43:00+02:00 | C6n private exception-notification boundary | 34% | C6 15% | 72/161 | 0/15 | WF-C6-009 now has a pure Workforce-only planner that permits generic in-app copy only after visibility/lifecycle/preference checks and produces an opaque dedupe key. It cannot accept or emit reasons, location, QR/device proof, contact data or case ids. No Route outbox reuse, delivery, scheduler, recipient mapping or tenant policy is activated; source privacy/deduplication contracts (4) pass and no completion credit is claimed. |
| 2026-08-31T10:49:00+02:00 | C6o employee exception discovery web/API slice | 35% | C6 18% | 72/161 | 0/15 | WF-C6-006 now exposes a session-only employee page/API containing only own generic exception type, opaque reference and exact own workday date/link. The correction form preselects that owned workday but server-side self/date checks remain authoritative. It deliberately does not query the unapplied response ledger or expose acknowledgement writes. Seven self/API contracts, EN/RU/AZ parity, targeted ESLint and diff check pass; migration/RLS apply, case-to-request linkage, mobile and browser/physical/staging evidence remain open. |

| 2026-08-31T11:09:00+02:00 | C6q immutable correction-request source link | 35% | C6 20% | 72/161 | 0/15 | WF-C6-006 now records an optional immutable case source only for an employee's exact self-owned correction workday. The server, idempotency comparison and unapplied additive DB trigger reject foreign/different-day/reassigned links; normal corrections stay unlinked. 22 targeted contracts, Prisma validate, runner syntax, ESLint and diff check pass. Migration apply/RLS, visible acknowledgement, mobile, full Chromium CI, physical/staging evidence and lifecycle completion remain open; no completion credit is claimed. |

| 2026-08-31T23:28:00+02:00 | C7u explicit scoped exception-decision permission (partial) | 36% | C7 52% | 74/161 | 0/15 | WF-C7-002 now assigns accountable exception decisions only to explicit `HR_ADMIN` or scoped `TEAM_MANAGER` grants; `TIME_APPROVER` remains denied and no role gains raw evidence, payroll, discipline or approval power. The grant ledger is still inactive, so no endpoint/tenant behavior changes and no completion credit is claimed. |
| 2026-08-31T23:33:00+02:00 | C6s/C7v scoped immutable decision source slice (partial) | 36% | C6 20%; C7 52% | 74/161 | 0/15 | WF-C6-002 now uses a policy-aware per-case locked decision writer and session-only API, while WF-C7-002 resolves only bounded active scope grants. Missing case/grant remains indistinguishable and the current zero-grant state is default-deny. Disposable DB/RLS/concurrency, grant rollout, manager browser flow and tenant activation remain open, so no completion credit is claimed. |
| 2026-08-30T10:26:12+02:00 | C7c explicit employment lifecycle history (partial) | 24% | C7 20% | 48/161 | 0/15 | WF-C7-004 source foundation: explicit hire/termination/rehire plus historical team/site resolver does not infer legal status from account fields; database apply/generated-client gate remains NOT RUN, so no task credit is claimed |
| 2026-08-31T23:59:06+02:00 | C6u server-resolved no-show configuration (partial) | 37% | C6 20% | 75/161 | 0/15 | `WF-C6-003` now derives its review-only expected start and grace from matching hash-verified, effective published policy/shift resolution rather than accepting a caller-provided `PUBLISHED` flag. It rejects missing/tampered schedules, future/retired-before-start configuration and policy/shift historical-team mismatch; the LeadDrive default produces 09:00 Baku with the approved 15-minute grace. Three focused C6/C3 contracts (31 tests), scoped ESLint and diff check pass. No scheduler, daily expectation snapshot, no-workday query, exception-case write, notification, tenant activation, database apply or payroll/discipline outcome exists; those gates remain NOT RUN. |
| 2026-08-30T13:50:00+02:00 | C7f reversible bulk schedule review (partial) | 31% | C7 40% | 63/161 | 0/15 | WF-C7-007 now exposes a named up-to-200 employee browser-only draft with read-only conflict outcomes and explicit discard; no mass-write, publish, site-bulk or recurrence contract is claimed |
| 2026-08-30T13:55:00+02:00 | C8g concise bulk-result announcement | 31% | C8 55% | 63/161 | 0/15 | C8-010 source fix announces only summary counts and renders the up-to-200 outcome rows as a semantic list; roster paging/search and real browser/AT evidence remain open, so no completion credit is claimed |
| 2026-08-30T14:01:00+02:00 | C7g bulk site-preview service (partial) | 31% | C7 40% | 63/161 | 0/15 | WF-C7-007 now has a bounded tenant/session-admin site preview that returns ready/no-change/unavailable/conflict without locks, writes or audit; web draft, publish, recurrence and browser evidence remain open |
| 2026-08-30T14:05:00+02:00 | C7h reversible bulk site review (partial) | 31% | C7 40% | 63/161 | 0/15 | WF-C7-007 now exposes a named up-to-200 employee browser-only site draft with future windows, conflict outcomes and explicit discard; no bulk access write, publish, recurrence or browser evidence is claimed |
| 2026-08-30T14:25:00+02:00 | C8h bounded named roster search (partial) | 31% | C8 60% | 63/161 | 0/15 | WF-C8-010 now loads at most 200 named active employees with explicit refine-search metadata and preserves selected named bulk-review records across a query change; API/UI contracts, lint and i18n passed, while browser/AT/mobile evidence remains open and local full typecheck hit Node OOM |
| 2026-09-13T06:40:00Z | C11 approved-export preview | 85% | C11 50% | 139/161 | 12/15 | WF-C11-005 accepted: a no-store, MFA/rate/scoped server preview verifies one immutable revision and shows the allowlisted time-fact rows, count, employee/date/revision and excluded site/location scope before direct-session download; external artifact delivery remains open under WF-C11-004 |
| 2026-09-13T06:46:00Z | C11 approved-time reporting (partial) | 85% | C11 50% | 139/161 | 12/15 | WF-C11-007 gains a tenant/actor-scoped date report from hash-verified immutable approvals with correction deduplication; schedule-aware no-show, site-transition and full exception lanes remain explicitly unavailable, so no completion credit is claimed |
| 2026-09-13T07:21:00+02:00 | C11 site-transition reporting (partial) | 86% | C11 50% | 139/161 | 14/15 | WF-C11-007 gains a bounded, raw-proof-free transition-claim API with pair/incomplete/review reconciliation, tenant-timezone bounds, exact historical scope and metadata-only audit; UI remains open, so no completion credit is claimed |
| 2026-09-13T07:35:00+02:00 | C11 reconciled reporting | 87% | C11 60% | 140/161 | 14/15 | WF-C11-007 accepted across separate approved-time, exception and site-transition reports: scoped date/name filters, immutable/time-safe aggregates and raw-proof-free transition completeness are visible in EN/RU/AZ; physical presence and payroll conclusions remain prohibited |
| 2026-09-13T07:42:56+02:00 | C12 bounded mobile-sync telemetry (partial) | 87% | C12 0% | 140/161 | 14/15 | WF-C12-002 now maps stream, endpoint, contract, result and duration to finite allowlisted/bounded dimensions before sampling or logging, so caller-controlled labels cannot expose an identifier or create unbounded metric cardinality. Existing tenant HMAC, APK validation and payload-content exclusion remain intact. Dashboard ingestion, paging/SLO approval and end-to-end cardinality review remain open, so no completion credit is claimed. |
| 2026-09-13T07:45:14+02:00 | C12 server stream isolation (partial) | 87% | C12 0% | 140/161 | 14/15 | WF-C12-004 now has a concurrent contract proving Routes still completes while the Workforce rate/protection dependency returns bounded 503, plus the inverse proof that Workforce completes after a Route snapshot timeout. Mobile queue scheduling, sustained overload and database failover remain open, so no completion credit is claimed. |
| 2026-09-13T07:52:00+02:00 | C12 server workload bounds (partial) | 87% | C12 0% | 140/161 | 14/15 | WF-C12-005 now has executable Workforce recovery for an over-one-megabyte page, alongside the existing 1-500 row bound, 250-row snapshot chunks, one-hour leases, finite Retry-After and atomic stream/device/user/tenant budgets. Android retry/backoff and poison-operation quarantine plus isolated load/chaos evidence remain open, so no completion credit is claimed. |
| 2026-09-13T07:52:58+02:00 | C12 privacy-safe support diagnostics | 88% | C12 10% | 141/161 | 14/15 | WF-C12-010 accepted: a bounded stdin-only tool produces fixed-dimension per-stream counts/latency/result and capped APK buckets for one 16-hex tenant pseudonym, discards foreign/malformed/high-cardinality records and never returns the pseudonym or source lines. The escalation playbook prohibits token/QR/key/biometric/GPS/reason collection and preserves per-stream cursors/outboxes. |
| 2026-09-13T07:58:50+02:00 | C13 additive compatibility contract | 90% | C13 44% | 145/161 | 14/15 | WF-C13-001/002/004/005 accepted: an ADR and executable contract keep all 35 Workforce-named migrations free of destructive rewrites, route both supported workday transports through one canonical state machine, preserve historical assurance as `LEGACY_UNKNOWN`, and fail approvals explicitly when an immutable snapshot is absent. Schema retirement, full signed-app/four-mode staging evidence and before/after reconciliation remain open. |
| 2026-09-13T08:05:32+02:00 | C14 executable traceability | 91% | C14 8% | 146/161 | 14/15 | WF-C14-001 accepted: a CI maintenance guard maps all eight required domains to 26 real test files and refuses missing, renamed, undocumented or non-executable entries. The complete mapped set passed locally (168 domain tests plus 3 register guards). The register explicitly excludes signed-device, browser, staging/load and human-pilot claims. |
| 2026-09-13T08:09:46+02:00 | C14 multi-site source matrix | 91% | C14 17% | 147/161 | 14/15 | WF-C14-005 accepted at the server/source boundary: the Baku 09-13 site A, 13-14 transition/break window and 14-18 site B scenario covers wrong-site and weak-GPS review cases, delayed offline arrival, realistic transfer speed, complete transition pairs and an unchanged eight-hour timesheet. Claims remain explicitly distinct from physical presence; signed-device/staging evidence stays under its own gates. |
| 2026-09-13T08:11:46+02:00 | C14 security matrix (partial) | 91% | C14 17% | 147/161 | 14/15 | WF-C14-002 now has a living seven-lane matrix and maintenance guard; all 16 mapped server/source files passed (113 tests plus 2 guard tests). Tenant/RLS, role/IDOR, replay/backdating, QR binding, GPS signals, attestation fail-closed rules and admin-abuse controls are represented. Physical QR relay, hardware attestation/biometric, signed-device recovery and disposable-DB RLS remain explicit residual gates, so no completion credit is claimed. |
| 2026-09-13T08:14:13+02:00 | C14 verified help and recovery guides | 92% | C14 25% | 148/161 | 14/15 | WF-C14-012 accepted: separate administrator and employee guides map all eight current Workforce pages to safe configuration, daily review, correction, export and incident procedures; a contract verifies every page/runbook path and the approved Baku defaults. The guides explicitly exclude payroll/discipline/presence and unverified signed-mobile promises. |
| 2026-09-13T06:20:14Z | C5 device/access recovery playbooks (partial) | 92% | C5 8% | 148/161 | 15/15 | WF-C5-012 now defines source-backed lost/stolen-phone, termination/rehire and compromised-admin containment/recovery sequences. They preserve immutable facts, separation of duties and Routes isolation, and specify measurable rejection/audit/reconciliation/rollback evidence. No staging or physical exercise is claimed, so acceptance credit remains open. |
| 2026-09-13T06:27:57Z | C12 reconciliation kernel (partial) | 92% | C12 10% | 148/161 | 5/15 | WF-C12-008 now has a bounded, read-only claim-to-export reconciliation kernel. It checks tenant/employee links, one-subject evidence, assessments, exception subjects, approval revision/hash chains and export-to-approval hashes; output is identifier-free finite counts with `repair: NONE`. A durable database cursor, scheduler and staging run remain open, so no completion credit is claimed. |
| 2026-09-13T06:31:34Z | C12 paged reconciliation job (partial) | 92% | C12 10% | 148/161 | 5/15 | WF-C12-008 adds finite 1,000-row/10-page orchestration. A clean page advances through compare-and-set; mismatch leaves the page uncommitted, cursor races and truncation are explicit, and no repair path exists. The durable database adapter/schedule and staging exercise remain open. |
| 2026-09-13T06:33:52Z | C12 durable reconciliation cursor (partial) | 92% | C12 10% | 148/161 | 5/15 | An additive global operational cursor now supplies bounded compare-and-set progress without storing tenant/employee payload. The first insert is valid only from a null cursor and competing runners cannot skip a page. Schema validation and 10 focused tests pass; snapshot reader/schedule/staging remain open. |
| 2026-09-13T07:21:18Z | C12 release-one SLO contract | 93% | C12 20% | 149/161 | 5/15 | WF-C12-001 accepted: p95/p99 acknowledgement, two/15-minute oldest-pending thresholds, zero accepted-event loss, conflict/error/isolation stops, zero-repair reconciliation and 30-minute freeze-or-restore recovery are assigned to accountable roles. The contract preserves tenant-safe evidence and does not claim the external 5,000-user/chaos/restore exercise. |
| 2026-09-13T06:38:00Z | C3 release-one shift workflow scope | 93% | C3 55% | 150/161 | 5/15 | WF-C3-011 accepted: swaps, open shifts and operational on-call are explicitly excluded. Existing `ON_CALL` schema/history remains readable, while activation fails closed before writes until a future reviewed effective policy defines eligibility, consent, rest, compensation and appeal. |
| 2026-09-13T07:08:35Z | C3 explicit break and shift semantics | 95% | C3 82% | 153/161 | 5/15 | WF-C3-003/004/005 accepted: the approved Baku lunch requires recorded Pause/Resume, planned metadata is never silently deducted, and release one rejects overnight/split definitions. Focused calculation/definition/default-profile evidence remains separate from the future WF-C3-006 extension. |
| 2026-09-13T06:41:00Z | C9 iOS release exclusion | 95% | C9 7% | 154/161 | 5/15 | WF-C9-015 accepted by explicit safe exclusion: the current pilot/release is Android-only, no iOS parity/signing/background-location claim is made, and a future separate iOS roadmap requires signed Android pilot, support/privacy, device/OS, custody and platform-assurance evidence. |
| 2026-09-13T06:43:00Z | C11 payroll/HRIS release boundary | 96% | C11 70% | 155/161 | 5/15 | WF-C11-009 accepted: release 1 remains approved-time review only, with no wage/payroll/discipline contract. Any HRIS delivery is a separate approved project requiring system-of-record, jurisdiction/rounding, custody, signed versioning, retry/reconciliation and correction ownership. WF-C11-010 remains conditional and unbuilt. |
| 2026-09-13T06:46:00Z | C11 external HRIS exclusion | 97% | C11 80% | 156/161 | 5/15 | WF-C11-010 accepted as an explicit release-one exclusion: no external HRIS is approved, no signed delivery/retry ledger is exposed, and the direct-session review export cannot be reused as background integration. A future approval creates a separate reviewed project. |
| 2026-09-13T06:58:45Z | C8 employee Workforce Today fallback | 97% | C8 18% | 157/161 | 5/15 | WF-C8-001 accepted at the source/web boundary: an HRM-only employee sees the published assignment and segments, exactly one canonical action, explicit proof requirement and the server-applied/pending-review outcome on `/workforce`. QR/device/biometric requirements fail closed to the reviewed fallback; browser E2E remains NOT RUN for GitHub CI. |
| 2026-09-13T07:17:00Z | C8 employee multi-site timeline | 97% | C8 27% | 158/161 | 5/15 | WF-C8-003 accepted for the employee Today surface: immutable planned segments are paired with same-workday arrival/departure claims and finite no-claim/arrived/completed/review states. Raw evidence and Route data are excluded, and the page explicitly refuses to call claims physical presence. |
| 2026-09-13T09:17:44Z | C9 mobile bootstrap release contract (partial) | 42% | C9 7% | 71/161 | 5/15 | WF-C9-002 now exposes effective attendance config identity and an inert-by-default Android minimum/recommended/maximum version decision. Configured stale/missing/malformed/incompatible clients fail closed in bootstrap without changing legacy clients; native consumption, package/signing/distribution and signed-device evidence remain open, so no completion credit is claimed. This row corrects the preceding ledger numerator to the task register's 71 `DONE` rows; `PARTIAL`, `PLANNED`, owner-decision and blocked rows cannot count under section 6.1. |
| 2026-09-13T09:41:47Z | C8/C10 derived evidence timeline (partial) | 42% | C10 36% | 71/161 | 5/15 | WF-C8-009/WF-C10-006 now have a session-only, rate-limited derived evidence API: an exact evidence-review grant plus bounded purpose/reason is required, the audit write must succeed before release, and the Prisma projection excludes raw coordinates/ciphertext, QR/device proof, reversible distance and accuracy. Web UI, any separately approved raw-investigation disclosure and periodic access review remain open, so no completion credit is claimed. |
| 2026-09-13T10:23:55Z | C13 mobile wire-schema contract | 42% | C13 56% | 72/161 | 5/15 | WF-C13-003 accepted at its Backend boundary: authenticated bootstrap advertises exact supported bootstrap-response, workday-request/response, evidence-envelope and site-transition schemas from parser-owned constants, while the independently versioned Android release contract supplies fail-closed update/drain outcomes. Native consumption, signing/distribution and physical-device evidence remain separate C9/C14 tasks and are not claimed. |
| 2026-09-13T10:53:20Z | C1 expired-client mutation abuse boundary | 43% | C1 100% | 73/161 | 5/15 | WF-C1-010 accepted at its server Security/QA boundary: once an accountable Android version window is configured, new unsupported direct/offline Workforce mutations fail before state writes while exact stored replays remain available for reconciliation and Route-only/browser paths stay independent. No production version values, package/signing claim or physical-device evidence is inferred; those remain C9/C14. |
| 2026-09-13T13:09:21+02:00 | C9 secure mobile bootstrap contract | 43% | C9 13% | 74/161 | 5/15 | WF-C9-002 accepted at its Mobile/Backend server boundary: authenticated bootstrap supplies split module entitlements, permissions, effective attendance configuration, exact wire schemas and one version-policy decision; direct and offline new Workforce writes enforce that decision while exact replays remain available for drain/reconciliation. Native screens, encrypted outbox, package/signing/distribution and signed-device evidence remain separate C9/C14 tasks. |
| 2026-09-13T13:12:00+02:00 | C6 bounded no-show review scheduler (partial) | 43% | C6 20% | 74/161 | 5/15 | WF-C6-003 gains a CRON_SECRET-gated, leased, serializable and cursor-bounded worker that scans only explicitly opted-in Workforce tenants, rechecks each candidate inside the case transaction and writes only immutable raw-proof-free review cases plus aggregate audit. It reuses the generic bounded system cursor and remains absent from production scheduling with no tenant flag enabled; measured cadence/load, applied-RLS concurrency, responsible cohort and staging evidence remain open, so no completion credit is claimed. |
| 2026-09-13T13:18:00+02:00 | C7 immutable employment/team/site history | 44% | C7 50% | 75/161 | 5/15 | WF-C7-004 accepted: append-only employment events and effective-dated team/site history resolve delayed facts from historical state, never mutable directory status or Route data. Current PR gates generated/checked the Prisma client, and successful production deploy 34752597613 confirmed all 468 artifact migrations applied, schema current, DB probe green and exact public artifact ff67047d2d62c35527234e1c389d7e97421bbee3. |
| 2026-09-13T13:21:00+02:00 | C7 manager request decision acceptance | 44% | C7 60% | 76/161 | 5/15 | WF-C7-006 accepted: the scoped manager queue and web action use an idempotent pending-only transition; request/calendar/correction/notification/audit facts commit atomically, Route overlap needs explicit acknowledgement only when that independent module is enabled, and Route facts are never mutated. Three focused contracts / 12 tests pass; the delivered production artifact contains the route and workbench. |
| 2026-09-13T13:22:00+02:00 | C5 recovery playbook definition | 45% | C5 8% | 77/161 | 5/15 | WF-C5-012 accepted at its HR/Security definition boundary: lost/stolen device, termination/rehire and compromised-admin procedures name narrow containment, immutable evidence, validation and rollback with Routes isolation. Four related source/UI/API suites / 27 tests pass. Measured staging and physical exercises remain separate WF-C14-004/006/007 and are still NOT RUN. |
| 2026-09-13T13:31:00+02:00 | C7 delegation and manager-absence contract | 45% | C7 70% | 78/161 | 5/15 | WF-C7-009 accepted at its definition boundary: temporary authority is tenant/scope/time/operation bounded, approved, expiring and audited to the actual actor; re-delegation and sensitive security/export/retention/admin powers are excluded. Implementation and rollout remain separate and no current authorization changes. |
| 2026-09-13T14:02:00+02:00 | C7 durable grant/revocation schema (partial) | 45% | C7 70% | 78/161 | 5/15 | WF-C7-002 gains an additive, initially empty role-grant/revocation schema with exact scope, effective interval, accountable actors, append-only history, tenant RLS and an incompatible-pair insert guard. The migration assigns no grant and changes no tenant rollout flag; writer, initial cohort, database/RLS exercise and live access review remain open, so no completion credit is claimed. |
| 2026-09-13T13:58:00+02:00 | C7 bounded access review (partial) | 45% | C7 70% | 78/161 | 5/15 | WF-C7-010 gains a pure, bounded review of at most 1,000 grants and 5,000 exact-grant actions. It identifies expired-unrevoked, inactive-principal, stale, incompatible and out-of-window assignments, fails closed on malformed/cross-tenant input and explicitly performs no automatic revocation. Durable reading, accountable revocation, scheduling and staging evidence remain open, so no completion credit is claimed. |

| 2026-09-13T14:50:00+02:00 | C7 grant/revocation draft writer (partial) | 45% | C7 70% | 78/161 | 5/15 | WF-C7-002 gains a source-only draft writer that fails closed on malformed identifiers/reasons, non-exact or incompatible role scope, invalid effective windows and pre-grant revocation. It has no Prisma dependency or write path; atomic authorization/audit, endpoint rollout, initial cohort and database/RLS concurrency evidence remain open, so no completion credit is claimed. |

| 2026-09-13T14:52:00+02:00 | C7 atomic access-grant transaction primitive (partial) | 45% | C7 70% | 78/161 | 5/15 | WF-C7-002 gains a caller-authorized transaction writer with per-principal advisory locking, tenant-unique operation IDs, exact replay/conflict handling, immutable grant-start matching and metadata-only audit. The additive operation-ID migration refuses non-empty dormant storage rather than inventing authority history. No endpoint, tenant rollout or grant is introduced, so no completion credit is claimed. |
| 2026-09-13T14:54:00+02:00 | C7 revocation probe hardening (partial) | 45% | C7 70% | 78/161 | 5/15 | The C7 writer now authorizes a revocation before any grant lookup, advisory lock or authority write, preventing unauthorized grant-ID probing. Endpoint rollout, initial grant custody and disposable-database concurrency remain open, so WF-C7-002 stays partial. |
| 2026-09-13T15:31:17+02:00 | C7 fenced grant/revocation API (partial) | 45% | C7 74% | 78/161 | 5/15 | WF-C7-002 gains session-only MFA-protected POST/DELETE endpoints for granular grants and append-only revocations. They require an existing exact `TENANT_ADMIN` authority, forbid self/bootstrap administration, recheck actor and target inside the serializable transaction, bind caller fields across retries, audit minimized metadata and fail closed through a shared 12/minute guard. Seven focused files / 54 tests and scoped lint pass; initial custody, tenant activation, disposable-DB/RLS concurrency and remaining endpoint migration stay open, so no completion credit is claimed. |
| 2026-09-13T16:01:26+02:00 | C7 bounded grant inventory and target picker (partial) | 45% | C7 76% | 78/161 | 5/15 | WF-C7-002 gains an MFA/granular-admin-only inventory capped at 500 active grants and a two-character tenant-local target search capped at 25 rows. Responses omit principal/scope IDs from inventory, reasons, operation keys and evidence; search audits omit query/labels/IDs, and both read paths fail closed through a shared 30/minute budget. Two focused files / 23 tests and scoped lint pass; browser role-management UI, initial custody, activation and disposable-DB/RLS evidence remain open, so no completion credit is claimed. |
| 2026-09-13T16:22:00+02:00 | C7 Today/timesheet granular read fences (partial) | 45% | C7 78% | 78/161 | 5/15 | WF-C7-002 now resolves the explicit persisted grant before Today or Timesheet returns employee names or time facts after granular cutover. Today supports exact self plus current team/agent/organization scope from one bounded snapshot; basic historical Timesheet deliberately accepts only self, exact-agent or organization scope until the immutable historical-team adapter is integrated. Legacy tenants retain their existing actor ceiling. Three focused files / 31 tests and scoped lint pass; actorless grant holders, historical team-at-workday scope, applied RLS and browser evidence remain open, so no completion credit is claimed. |
| 2026-09-13T16:45:00+02:00 | C7 named-read session boundary (partial) | 45% | C7 79% | 78/161 | 6/15 | WF-C7-002 now requires an accountable browser session before Today or Timesheet can return named employees or attendance facts; an integration key cannot inherit its creator's CRM identity. Existing tenant, actor and persisted-grant checks remain unchanged, and no rollout flag is activated. Two focused files / 23 tests, scoped lint and diff check pass; actorless grants, historical-team scope and the remaining C7 rollout work stay open, so no completion credit is claimed. |
| 2026-09-13T16:50:00+02:00 | C7 actor-independent read grants (partial) | 45% | C7 80% | 78/161 | 6/15 | WF-C7-002 now treats an explicit persisted Today/Timesheet grant as first-class authority after deliberate tenant cutover, without requiring a legacy CRM actor row. Legacy tenant scope is unchanged; Today returns no self-action model for a grant-only reviewer, and historical team/site Timesheet scope remains fail-closed. Three focused files / 33 tests, scoped lint and diff check pass; no grant or tenant flag is created, so no completion credit is claimed. |
| 2026-09-13T16:56:00+02:00 | C7 granular timesheet approval authority (partial) | 45% | C7 82% | 78/161 | 6/15 | WF-C7-002 now makes an effective exact `TIME_APPROVER` grant authoritative after explicit cutover, including grant-only principals, while retaining legacy scope before cutover and prohibiting self-approval. Authority resolves before employee lookup so an ungranted caller cannot probe the directory; audit records the authorization source without grant detail. Two focused files / 22 tests, scoped lint and diff check pass; no tenant/grant changes or completion credit are claimed. |
| 2026-09-13T17:02:00+02:00 | C7 granular direct-correction authority (partial) | 45% | C7 84% | 78/161 | 6/15 | WF-C7-002 now makes an effective exact `TIME_APPROVER` correction grant authoritative after cutover, including grant-only principals, while preserving MFA/session/rate fences, legacy scope before cutover, immutable replay and locked self-correction denial. Two focused files / 31 tests, scoped lint and diff check pass; no tenant/grant changes or completion credit are claimed. |
| 2026-09-13T17:36:00+02:00 | C7 transactional request-decision grants (partial) | 45% | C7 86% | 78/161 | 6/15 | WF-C7-002 now requires historical-scope `TEAM_REQUEST_DECIDE` for leave/absence and `TIME_APPROVE` for immutable corrections after cutover, checks authority before Route-conflict disclosure and rechecks it in the write transaction. Self-decision and mutable-current-team fallback remain denied. Eleven decision tests, three persisted-grant resolver tests, scoped lint and diff check pass; no live grant/flag or completion credit is introduced. |
| 2026-09-13T17:08:00+02:00 | C7 shift-configuration grants (partial) | 45% | C7 88% | 78/161 | 6/15 | WF-C7-002 moves shift list/create/update/activate and organization-default reads/writes behind the session-only `SCHEDULE_READ`/`SCHEDULE_WRITE` boundary. Legacy tenant-admin behavior is preserved before cutover; effective grants become authoritative afterward. Two focused files / 33 tests, scoped lint and diff check pass; no schedule, grant or tenant flag changes and no completion credit are claimed. |
| 2026-09-13T17:12:00+02:00 | C7 assignment-configuration grants (partial) | 45% | C7 90% | 78/161 | 6/15 | WF-C7-002 moves named assignment reads, bulk preview and future assignment writes behind `SCHEDULE_READ`/`SCHEDULE_WRITE`. Legacy admin behavior is preserved before cutover and persisted grants are authoritative afterward. Two focused files / 33 tests, scoped lint and diff check pass; the preview remains read-only and no assignment/grant/tenant flag or completion credit is created. |
| 2026-09-13T17:57:00+02:00 | C7 site/geofence configuration grants (partial) | 47% | C7 70% | 78/161 | 6/15 | WF-C7-002 moves Workforce site/geofence inventory and configuration behind session-only `SCHEDULE_READ`/`SCHEDULE_WRITE`, while keeping Route geography isolated and historical revisions append-only. Targeted site/wrapper/RLS tests, scoped lint, diff and RLS scan pass; no assignment, monitoring, grant or tenant flag is activated. |
| 2026-09-13T18:09:00+02:00 | C7 retention dry-run grant (partial) | 47% | C7 70% | 78/161 | 6/15 | WF-C7-002 moves the bounded raw-location retention inventory behind session-only `RETENTION_DRY_RUN_READ` after cutover. Legacy admin and MFA behavior remain before cutover; the HTTP route still cannot delete data or manage legal holds. Three focused files / 31 tests, scoped lint, diff and RLS scan pass; no grant, flag, retention execution or completion credit is introduced. |
| 2026-09-13T18:35:00+02:00 | C7 durable access-review reader (partial) | 47% | C7 70% | 78/161 | 6/15 | WF-C7-010 now evaluates up to 1,000 durable tenant grants for expiry, inactive principals and incompatible roles, with aggregate-only audit and accountable manual revocation. Missing exact-grant usage telemetry is declared `UNAVAILABLE`, so stale-use findings are suppressed rather than invented. Three focused files / 19 tests, scoped lint, diff and RLS scan pass; usage instrumentation, scheduling and staging evidence remain open, so no completion credit is introduced. |
| 2026-09-13T17:54:00+02:00 | C7 historical request-read grants (partial) | 47% | C7 70% | 78/161 | 6/15 | WF-C7-002 gains a session-only two-phase request queue: bounded metadata and immutable historical team are grant-filtered before reasons/notes load, exact self-history stays available, and per-record decision/cancel controls are server-derived. Four focused files / 19 tests, scoped lint, diff and RLS scan pass after rebasing onto the access-review checkpoint. No tenant flag/grant is activated and no acceptance credit is claimed; this row resumes the strict accepted-task phase formula. |
| 2026-09-13T21:18:00+02:00 | C9 native Android source foundation (partial) | 47% | C9 7% | 78/161 | 6/15 | WF-C9-001/002 and WF-C5-003 gain a separate native Android/Kotlin source project with release-identity guard, encrypted session selector, tenant-slug login/bootstrap and challenge-bound non-exportable Keystore foundation. Current server bootstrap remains canonical; package/signing/distribution, Gradle/physical-device evidence and final device matrix remain blocked or NOT RUN, so no completion credit is introduced. |
| 2026-09-13T21:26:00+02:00 | C9 canonical Android Today state (partial) | 48% | C9 14% | 78/161 | 6/15 | WF-C9-003 restores the encrypted session after process death, renders only the server-owned workday state/actions, submits one idempotent online v3 transition and reloads canonical truth. It creates no optimistic or hidden offline fact; current segment/site/proof context, durable outbox, Gradle/physical-device evidence and release identity remain open, so no completion credit is introduced. |
| 2026-09-13T21:34:00+02:00 | C9 encrypted Android outbox (partial) | 48% | C9 20% | 78/161 | 6/15 | WF-C9-006 gains a Room queue whose tenant/action payload is Android-Keystore AES-GCM ciphertext authenticated to its operation/domain, with immutable operation identity, seven-day expiry, eight-attempt exponential retry, oldest-first domain drain and destructive account-boundary isolation. Server conflicts/rejections are terminal and cannot enter the retry lane. Gradle, process-death, two-account and physical seven-day evidence remain open, so no completion credit is introduced. |
| 2026-09-13T21:42:00+02:00 | C9 Android Work Time history (partial) | 49% | C9 27% | 78/161 | 6/15 | WF-C9-004 gains a bounded self-only history reader and screen for server-accepted calendar, workday duration and request state. The server now returns canonical worked seconds so the app never reconstructs accepted time from its local clock or queued claims. Pending/conflict/review/correction detail, Android rendering/accessibility and physical-device evidence remain open, so no completion credit is introduced. |
| 2026-09-13T22:02:00+02:00 | C9 Android employee requests (partial) | 49% | C9 34% | 78/161 | 6/15 | WF-C9-005 gains typed leave, absence and time-correction create plus pending cancellation from the standalone client. Corrections bind to a server-returned workday; ambiguous network failures queue in an encrypted, tenant/domain-authenticated `HRM_REQUEST` lane while conflicts and terminal rejections require review. Gradle/device, localization, recovery-centre and physical evidence remain open, so no completion credit is introduced. |
| 2026-09-13T22:14:00+02:00 | C9 foreground action-time GEO primitive (partial) | 50% | C9 41% | 78/161 | 6/15 | WF-C9-007 gains a bounded foreground-only current-location primitive: permission/provider/platform/timeout outcomes, 15-second cancellation, 30-second freshness, coordinate/accuracy validation and mock-location signal, with no background service or stale fallback. It is deliberately not bound to attendance until tenant policy and server assessment are active; Gradle/device/permission/battery evidence remains open, so no completion credit is introduced. |
| 2026-09-13T22:26:00+02:00 | C9 immediate QR proof path (partial) | 51% | C9 48% | 78/161 | 6/15 | WF-C9-008 gains a delegated, QR-only scanner invoked solely for the currently selected server-required action. The raw token is bounded, used once in memory, never saved/logged/queued, and transport ambiguity requires a fresh scan; invalid/unsupported attendance manifests fail closed in the UI. Gradle/device/storage/replay and combined QR+device physical evidence remain open, so no completion credit is introduced. |
| 2026-09-13T22:37:00+02:00 | C9 metadata-only recovery center (partial) | 52% | C9 55% | 78/161 | 6/15 | WF-C9-010 gains a tenant/session-serialized view of up to 100 local queue records showing only domain, state, tenant-timezone timestamp and bounded recovery guidance. It never decrypts or renders IDs, reasons, QR, GPS, tenant or device proof; expiry directs correction and conflicts direct server refresh. Terminal-action controls and physical conflict/retry evidence remain open, so no completion credit is introduced. |
| 2026-09-13T23:02:00+02:00 | C9 trusted-device source path (partial) | 53% | C9 62% | 78/161 | 6/15 | WF-C9-009 gains account-bound Android Keystore P-256 enrollment, resumable proof-of-possession, manager-approval lifecycle and exact action/tenant/employee/workday/time signatures unlocked only by the OS strong-biometric prompt. QR/device proofs are immediate-only and never enter the outbox; account mutation is mutex-serialized. Verified hardware/app attestation, revoke/replace, Gradle and physical H5 matrix remain open, so no completion credit is introduced. |
| 2026-09-13T23:20:00+02:00 | C9 private local missed-finish reminder (partial) | 56% | C9 69% | 78/161 | 6/15 | WF-C9-011 gains an employee-opt-in, generic one-shot Android reminder sourced only from the immutable server shift end. It persists no workday, employee, tenant, site or proof data and cancels on account boundary. Physical permission/channel/delivery evidence and push/start/segment support remain NOT RUN, so no completion credit is introduced. |
| 2026-09-13T23:35:00+02:00 | C9 localisation/accessibility source foundation (partial) | 58% | C9 75% | 78/161 | 6/15 | WF-C9-012 gains default EN plus AZ/RU core resource catalogs, accessible tab role/selection state, polite status announcements and explicit 48 dp controls. Server-error localisation and physical TalkBack/language/200%-font/contrast/reduced-motion evidence remain NOT RUN, so no completion credit is introduced. |
| 2026-09-13T23:50:00+02:00 | C9 privacy-safe mobile diagnostics (partial) | 60% | C9 81% | 78/161 | 6/15 | WF-C9-013 gains bounded semver, release SHA, Android platform and coarse phone/tablet/other diagnostics through the existing sanitized census. Legacy calls without Workforce diagnostics keep their prior event shape; arbitrary values collapse to `unknown`. No crash SDK, collector/dashboard, raw device identity, token, QR, GPS or employee reason is added, so no completion credit is introduced. |
| 2026-09-14T00:10:00+02:00 | C9 release/update and protected outbox source path (partial) | 62% | C9 87% | 78/161 | 6/15 | WF-C9-014 parses the server release state fail-closed, disables new Workforce mutations on a mandatory update, preserves encrypted pending rows without consuming retry count and resumes oldest-first drain only after a supported bootstrap. It includes translated lost-device/uninstall guidance but no physical Play/update/rollback drill, so no completion credit is introduced. |
| 2026-09-14T00:25:00+02:00 | C9 Today schedule allow-list (partial) | 64% | C9 90% | 78/161 | 6/15 | WF-C9-003 returns only one server-selected immutable current/next segment and safe site name to Android. The adapter omits workday/event GPS, notes, addresses, site IDs, geofences, QR and device proof; the client labels schedule context as planning rather than presence evidence. Physical Android verification remains open, so no completion credit is introduced. |
| 2026-09-14T00:40:00+02:00 | C5/C9 self-service lost-device containment (partial) | 66% | C9 92% | 78/161 | 6/15 | WF-C5-007/WF-C9-009 gain a linked-user-audited mobile route that atomically revokes only the authenticated employee's own pending/active enrollment and clears its matching local key only after server acknowledgement. Android build/device recovery and signed-release evidence remain NOT RUN, so no completion credit is introduced. |
| 2026-09-14T01:05:00+02:00 | C9 Android compile and permission hardening (partial) | 67% | C9 93% | 78/161 | 6/15 | WF-C9-001/007/011/014 move release identity to the valid Android DSL scope, retain a positive debug version code, avoid nullable Compose smart-cast failures, use an API-declared compatible location executor, convert permission races to safe outcomes, and gate StrongBox use by platform level. Source contracts and scoped static checks pass; Gradle compilation and physical-device evidence remain NOT RUN, so no completion credit is introduced. |
| 2026-09-14T01:20:00+02:00 | C9 localized trusted-device containment (partial) | 68% | C9 94% | 78/161 | 6/15 | WF-C9-009/012 source trusted-device explanation, lifecycle, labels and irreversible revoke confirmation from complete EN/AZ/RU Android resources rather than repository-internal English messages. Gradle lint/unit, emulator/physical biometric/device/locale and signed-release evidence remain NOT RUN, so no completion credit is introduced. |
| 2026-09-14T01:25:00+02:00 | C9 localized QR recovery (partial) | 68% | C9 94% | 78/161 | 6/15 | WF-C9-008/012 source QR cancellation and unreadable-code recovery from EN/AZ/RU resources and state only that no attendance action was sent; no token or scanner diagnostic is displayed or persisted. Gradle lint/unit, physical QR/device/locale and signed-release evidence remain NOT RUN, so no completion credit is introduced. |
| 2026-09-14T01:40:00+02:00 | C9 localized mobile status and error boundary (partial) | 69% | C9 95% | 78/161 | 6/15 | WF-C9-012 moves sign-in, refresh, outbox, request, device, sign-out and exact-action states to matched EN/AZ/RU resources; repository/API exception text no longer reaches employee UI. Resource-key parity and source contracts pass; Gradle and physical locale/QR/biometric evidence remain NOT RUN, so no completion credit is introduced. |
| 2026-09-14T01:55:00+02:00 | C9 localized attendance surfaces (partial) | 70% | C9 96% | 78/161 | 6/15 | WF-C9-003/004/005/007/010/012 move Today, Recovery, Requests, Work Time and known lifecycle labels to complete EN/AZ/RU resources while preserving tenant-timezone display, invalid-policy fail-closed behavior, outbox disclosure and no-background-location language. Gradle/device locale/TalkBack/200%-font evidence remains NOT RUN, so no completion credit is introduced. |
| 2026-09-14T02:10:00+02:00 | C9 typed localized recovery states (partial) | 71% | C9 97% | 78/161 | 6/15 | WF-C9-010/011/012 keep outbox and reminder layers wording-free and account-mutex protected; Compose resolves typed known/unknown states through complete EN/AZ/RU resources. Unknown metadata remains a generic review path and never exposes queued proof data. Gradle/device locale/TalkBack evidence remains NOT RUN, so no completion credit is introduced. |
| 2026-09-14T02:20:00+02:00 | C9 typed localized request/history states (partial) | 72% | C9 98% | 78/161 | 6/15 | WF-C9-004/005/012 parse known request type/status and calendar codes into typed values before EN/AZ/RU rendering. Unknown values show generic review and cannot be cancelled locally; server dates and reviewer notes remain unchanged facts. Gradle/device locale evidence remains NOT RUN, so no completion credit is introduced. |
| 2026-08-31T11:15:00+02:00 | C5o on-demand device-security review UI | 35% | C5 8% | 72/161 | 0/15 | WF-C5-009 now exposes the existing bounded device/activity triage only after an explicit administrator action. The browser receives employee names, fixed review prompt codes and aggregate counts, never internal agent/device IDs or raw proof; it cannot auto-revoke, decide fraud or create a case. 16 targeted contracts, i18n parity, ESLint and diff check pass. C6 lifecycle/C7 reviewer scope, alerts, query-plan/load, Android and physical evidence remain NOT RUN; no completion credit is claimed. |
| 2026-08-31T11:20:00+02:00 | C5p generic attendance-admin failure boundary | 35% | C5 8% | 72/161 | 0/15 | QR/device/capability/geofence and on-demand triage failures no longer reflect authorization, capacity or diagnostic error text into browser alerts/toasts. They preserve localized generic messages while server diagnostics remain within protected request/audit boundaries. Four targeted contracts (17 tests), i18n parity, ESLint and diff check pass. No lifecycle, reviewer-scope, alerting, Android, physical or load completion credit is claimed. |
| 2026-08-31T11:31:00+02:00 | C8j source-quality audit and read-only error boundary | 35% | C8 65% | 72/161 | 0/15 | The scoped Workforce web audit scores 16/20 and records current controls plus remaining browser/AT/contrast/zoom/mobile evidence. It closed one P1 source issue: evidence-timeline and approved-report browser alerts now use generic localized load failures rather than reflecting API diagnostics. Targeted source contracts, i18n parity, ESLint and diff check pass; real rendered verification remains NOT RUN and no C8 completion credit is claimed. |
| 2026-08-31T11:38:00+02:00 | C9c localized trusted-device containment source | 35% | C9 0% | 72/161 | 0/15 | The native trusted-device screen now sources its explanation, lifecycle, enrollment labels and irreversible revoke confirmation from complete EN/AZ/RU Android resource catalogs instead of displaying repository-internal English lifecycle messages. Source contracts (23 tests), resource-key parity and diff check pass. Gradle lint/unit, emulator/physical biometric/device/locale and signed-release evidence remain NOT RUN; no C9 completion credit is claimed. |
| 2026-08-31T11:43:00+02:00 | C9d localized QR recovery source | 35% | C9 0% | 72/161 | 0/15 | QR scan cancellation and unreadable-code recovery now use EN/AZ/RU Android resources and state only that no attendance action was sent; no token/scanner diagnostic is displayed or persisted. Targeted source contracts, resource-key parity and diff check pass. Gradle lint/unit, physical QR/camera/device/locale evidence and signed release remain NOT RUN; no C9 completion credit is claimed. |
| 2026-08-31T11:51:00+02:00 | C3f planned-break observation foundation | 35% | C3 45% | 72/161 | 0/15 | WF-C3-004 now deterministically compares the immutable local planned break with recorded pause facts and reports complete/partial/missing/in-progress coverage. Baku 13:00–14:00 actual pause yields 3,600 observed seconds; no time deduction, exception, payroll or HR action exists. 29 focused contracts, ESLint and diff check pass. Paid/unpaid policy, snapshot wiring, browser/mobile capture and legal/owner review remain NOT RUN, so no completion credit is claimed. |
| 2026-08-31T12:00:00+02:00 | C9e localized generic mobile status/error boundary | 35% | C9 0% | 72/161 | 0/15 | Android root sign-in/refresh/outbox/request/device/sign-out states and exact-action/enrollment prompts now use matched EN/AZ/RU resources. `WorkforceApiException.message` and device API messages no longer reach employee UI; a fixed Compose violation in the prior Android candidate (`stringResource` in `rememberSaveable` initializer) is corrected. Resource-key parity, 17 targeted source contracts, ESLint and diff check PASS. GitHub Android Gradle lint/unit must rerun for the next SHA; physical device/locale/QR/biometric evidence remains NOT RUN, so no completion credit or mobile gate is claimed. |
| 2026-08-31T12:06:00+02:00 | C9f static mobile surface localization | 35% | C9 0% | 72/161 | 0/15 | Today disclosures, Recovery, Requests, Work Time history and known STARTED/PAUSED/COMPLETED labels now use complete EN/AZ/RU resource catalogs while preserving the outbox/no-background-location/claim-not-payroll wording. Free-form reviewer notes and raw server calendar/request values are not machine-translated. Resource-key parity, 17 targeted source contracts, ESLint and diff check PASS. Gradle CI is in progress for the preceding checkpoint; device locale/TalkBack/200% review remains NOT RUN, so no completion credit or gate is claimed. |
| 2026-08-31T12:12:00+02:00 | C9g typed local recovery/reminder localization | 35% | C9 0% | 72/161 | 0/15 | The reminder scheduler and encrypted outbox now return only typed local states/hints; Android Compose resolves all Recovery/Reminder employee wording with EN/AZ/RU resources. Unknown stored metadata becomes a generic review path and never becomes raw queue/proof data. Resource-key parity, 17 targeted source contracts, ESLint and diff check PASS. Android Gradle CI remains external/pending; device locale/TalkBack/200% evidence remains NOT RUN, so no completion credit or gate is claimed. |
| 2026-08-31T12:19:00+02:00 | C9h typed request/calendar localization | 35% | C9 0% | 72/161 | 0/15 | Android parses known request type/status and calendar codes into typed values before rendering them with EN/AZ/RU resources. Unknown codes show a generic localized review state and cannot be locally cancelled; server dates/free-form reviewer notes remain unmodified facts. Full `MainActivity.kt` text-resource guard, resource parity, 17 source contracts, ESLint and diff check PASS. Android Gradle/browser/device locale evidence remains external/pending or NOT RUN, so no completion credit or gate is claimed. |
| 2026-08-31T12:00:38+02:00 | C9i configuration-aware device localization repair | 35% | C9 0% | 72/161 | 0/15 | GitHub Android lint correctly rejected five configuration-stale `LocalContext.current.getString` calls on predecessor `4135083e4`. Device action prompts, enrollment prompt template and lifecycle copy are now resolved through Compose `stringResource` values; only the server expiry is interpolated into an already-localized template. No lint suppression/baseline was added. Android source contract is 17/17, EN/AZ/RU resource parity is 186 keys and diff check PASS. The replacement GitHub Android lint/unit gate is required; physical/device/locale evidence remains NOT RUN, so no completion credit or gate is claimed. |
| 2026-09-14T02:30:00+02:00 | C9 configuration-aware localized device copy (partial) | 73% | C9 99% | 78/161 | 6/15 | WF-C9-009/012 resolve device prompts, enrollment templates and lifecycle copy through Compose resources, avoiding configuration-stale context strings while interpolating only bounded server expiry. EN/AZ/RU parity and source contracts pass; Android Gradle and physical locale/device evidence remain NOT RUN, so no completion credit is introduced. |
| 2026-08-31T12:03:08+02:00 | C7t/C14x exact mobile-request and browser-E2E repair | 35% | C7 52%; C14 35% | 72/161 | 0/15 | CI surfaced two real preflight failures without reaching user behavior: the mobile HR-request idempotency adapter omitted the newly mandatory `exceptionCaseId`, and the disposable browser seed violated the 64-hex exception deduplication constraint. Mobile now sends/compares an explicit `null` because its separate contract does not yet expose case-linked corrections, so an unlinked mobile retry cannot replay a case-linked web request. The E2E seed creates an opaque SHA-256 digest; no schema/baseline/constraint was weakened. Focused mobile-sync, browser-runner and Android-source contracts are 127/127 PASS with diff check. Replacement static/browser/Android GitHub gates remain required; no completion credit or production change is claimed. |
| 2026-08-31T12:16:11+02:00 | C6r mobile self-exception correction foundation | 35% | C6 20% | 72/161 | 0/15 | WF-C6-006 now has a separate explicit Workforce-only mobile self-exception card endpoint and Android request-screen prefill. It returns only an employee's bounded generic case/workday card, maps unknown type to localized review copy and never fetches proof/reason/response-ledger data. A selected case can link only to the same employee/workday time correction; changing request type/workday clears the link and server validation makes unavailable/foreign/reassigned case IDs indistinguishable. 131 focused contracts, EN/RU/AZ 198-key parity, ESLint, diff and RLS-gap finder PASS. Migration apply, response write/lifecycle, exact-SHA CI/browser/Android/physical/staging evidence remain open, so no completion credit or tenant activation is claimed. |
| 2026-09-14T02:50:00+02:00 | C6/C9 mobile self-exception correction (partial) | 74% | C9 99% | 78/161 | 6/15 | WF-C6-006/WF-C9-005 add a bounded self-only exception-card endpoint and Android correction prefill. Exact employee/workday linkage, idempotency comparison and metadata-only audit prevent foreign, reassigned or mismatched cases from becoming an oracle or correction source. Migration apply, response lifecycle, Gradle and physical evidence remain NOT RUN, so no completion credit is introduced. |
| 2026-08-31T12:21:00+02:00 | C9j remove dead device-message channel | 35% | C9 0% | 72/161 | 0/15 | `WorkforceDeviceTrustState` no longer stores internal English device-status text; its only UI-relevant values are typed lifecycle and metadata-only enrollment state, and Compose resolves lifecycle copy from EN/AZ/RU resources. The Android source contract rejects restoration of that display-text field; 17/17 targeted source tests, scoped ESLint and diff check PASS. Exact-SHA Android CI, signed app and physical device/locale/biometric/QR proof remain external or NOT RUN, so no completion credit is claimed. |
| 2026-08-31T12:23:00+02:00 | C6s Android generic-list compilation repair | 35% | C6 20% | 72/161 | 0/15 | GitHub Android CI for `26020f925` reached Kotlin compilation and correctly rejected the ambiguous `emptyList()` `when` branch in the mobile self-exception card state; lint/unit did not run. The successor uses a null-safe `ownExceptions.isEmpty()` branch and the Android source contract rejects the ambiguous form. No HRM data/authorization/policy behavior, migration or baseline was changed. 17/17 local source contracts, scoped ESLint and diff check PASS; exact-SHA Android CI and browser/static gates remain required; physical/staging evidence remains NOT RUN. |
| 2026-09-14T03:00:00+02:00 | C9 localized device-state cleanup and compile repair (partial) | 75% | C9 99% | 78/161 | 6/15 | WF-C9-005/009/012 remove the dead repository display-text channel and use a null-safe exception-list branch, leaving only typed state for localized Compose rendering. Source tests pass; exact-SHA Android Gradle and physical device evidence remain NOT RUN, so no completion credit is introduced. |
| 2026-08-31T12:34:00+02:00 | C6t/C9k exact-SHA CI confirmation | 35% | C6 20%; C9 0% | 72/161 | 0/15 | Exact code checkpoint `a0aeed2bf` passes GitHub Android debug lint/unit, Workforce Chromium/RLS browser E2E, secret scan, static gates and both Social Monitoring regression jobs. Static gates report 69 existing defect-shaped TypeScript pairs and 18 failing test files equal to their approved repository baselines; no new gate regression was introduced. Existing TypeScript diagnostics are advisory and are not reported as a full clean typecheck. Physical Android/QR/GPS/biometric, signed release, migration/RLS, isolated staging load/restore and legal/pilot evidence remain NOT RUN, so no completion credit or release gate is claimed. |
| 2026-08-31T12:51:00+02:00 | C14y deterministic RLS finder input | 35% | C14 35% | 72/161 | 0/15 | The CI-only RLS finder flaked because unsorted filesystem enumeration changed which same-named helper entered its static call graph. Source and route traversal are now sorted before analysis; regular and sorted-order executions both report 0 gaps (747 context-requiring helpers in sorted mode), and a source contract prevents regression. No RLS policy, schema, baseline or production data changed. Exact-SHA static/CI confirmation remains required; no completion credit is claimed. |
| 2026-08-31T13:00:00+02:00 | C14z staging-release-lane discovery | 35% | C14 35% | 72/161 | 0/15 | Read-only GitHub metadata confirms that this repository currently exposes one environment, `production`; its active Workforce workflows are source/ephemeral CI (`Workforce Android foundation` and `Workforce browser E2E`), not a deployed isolated staging lane. The documented H6 placeholder hostname and load/restore commands therefore have no provisioned target, synthetic credential set, backup artifact or owner record. No production, tenant, secret, workflow dispatch, load, restore or pilot action was attempted. WF-C12-003/WF-C12-007/WF-C14-006 remain external staging gates, and production must not be substituted for them. |
| 2026-08-31T13:05:00+02:00 | C14aa complete RLS finder ordering | 35% | C14 35% | 72/161 | 0/15 | The exact-SHA static gate on `87b6221d7` still reported the RLS finder test as newly failing even though its focused run passed. The prior traversal sort left one residual nondeterministic input: `ctx_req` is a set and was interpolated directly into the finder regex. It is now sorted before regex construction, and the source contract rejects its regression. Focused CI-mode finder test is 2/2 PASS with 0 reported gaps and `git diff --check` PASS. The failed static gate was not reclassified or baselined: replacement exact code checkpoint `9568b110d` passes all six GitHub checks (static, Android lint/unit, Workforce browser E2E, secret scan and both Social browser paths). |
| 2026-08-31T16:30:00+02:00 | C10/C14 policy disclosure and H6 server preflight | 36% | C14 35% | 73/161 | 0/15 | Current-main legal disclosure is reconciled into the feature branch: policy §§2/3/9 in EN/RU/AZ truthfully state existing field Workforce collection categories, route/visit/time purpose, open-workday server boundary, 30-day raw-point deletion, tenant RLS, employer/Fanumsec MMC controller-processor allocation and inquiry routes. H6 fence/control-plane source checks pass 124 tests; privacy/fence targeted suite passes 57 tests and translation parity passes. No H6 tenant, capability, staging, physical device, load or production action was performed. |
| 2026-08-31T16:33:00+02:00 | C14ab write-fence audit proof | 35% | C14 35% | 72/161 | 0/15 | `WF-C14-008` is now source-partial: session-admin + MFA release controls, tenant transaction locks, auditable posture/cohort transitions, hashed device selectors and final-cohort safety are explicit in the H6 evidence packet. Targeted write-fence/sync/week contracts pass 173 tests; expected injected failure diagnostics remain fail-closed. No tenant cohort, capability activation, staging, device, load, pilot, deploy or production write was performed. |
| 2026-08-31T16:34:00+02:00 | C14ac bounded H6 security recheck | 35% | C14 35% | 72/161 | 0/15 | Eight single-file source checks for attendance trust/security, GPS, Key Attestation, Play Integrity, H5 migration, Workforce RLS authorization and rate limits pass 30 tests after the fence-audit checkpoint. Together with the 173 fence/sync/week tests they reconfirm server-only fail-closed contracts. Database-RLS, physical Android/QR/biometric, staging load/restore and pilot remain NOT RUN; the in-progress exact-SHA CI has not yet been credited. |
| 2026-08-31T16:55:00+02:00 | C14ad current-main merge CI | 36% | C14 35% | 73/161 | 0/15 | Exact merge checkpoint `73a492b0e` passes all six GitHub checks: static, secret scan, Android debug lint/unit, Workforce Chromium/RLS browser E2E, Social regression and Social durable recovery. The PR is clean but remains Draft. This source/CI result does not run staging, a migration/backup restore, physical Android/QR/biometric matrix, tenant cohort or production release. |
| 2026-08-31T21:31:53+02:00 | C12n leased read-only reconciliation worker | 36% | C12 15% | 74/161 | 0/15 | WF-C12-006/WF-C12-008 now have a source-only CRON_SECRET-gated reconciliation entrypoint: an additive RLS-bypass cursor row and global lease select at most one enabled Workforce tenant, scan a bounded rolling 31-day structural history and emit only counts/codes/fingerprint audit metadata. It does not create a no-show, alter a workday, activate a capability, add a deployment cron line or expose tenant identifiers. 29 focused lease/RLS/route/scanner/migration contracts, ESLint, Prisma validate and diff check pass. Migration apply, staging scheduler/lease rehearsal, metrics/alerts, C6 case database coverage, export reconciliation, load/chaos/restore and production execution remain NOT RUN. |
| 2026-08-31T21:45:07+02:00 | C5j Google status-list alignment (partial) | 36% | C5 25% | 74/161 | 0/15 | WF-C5-004 now parses Google's attestation status-list shape by certificate serial number and rejects both `REVOKED` and `SUSPENDED` chains; fingerprints remain only an additive internal deny-list. 7 focused attestation/security tests, scoped ESLint and diff check pass. The official recommended Kotlin verifier, live status-cache operation, final app identity, enrollment endpoint/persistence and physical matrix remain NOT RUN; no hardware trust is activated. |
| 2026-08-31T21:47:46+02:00 | C5k Play Integrity request-detail hardening (partial) | 36% | C5 25% | 74/161 | 0/15 | WF-C5-005 now validates the Google-decoded request package and bounded fresh timestamp beside the exact hash, and rejects malformed/duplicate decoder fields before an assessment. 12 focused Play-Integrity/attestation/security tests, scoped ESLint and diff check pass. No Play Cloud decode, client warm-up/token, identity configuration, persistence/enforcement or physical anti-tamper evidence is claimed. |
| 2026-08-31T22:00:00+02:00 | C10k leased raw-location retention rehearsal (partial) | 36% | C10 30% | 74/161 | 0/15 | WF-C10-005 now has a source-only CRON_SECRET-gated, global-lease and RLS-bypass-cursor rehearsal which reads at most one enabled Workforce tenant and audits aggregate dry-run counts only. It accepts no execution mode, is absent from the deployment schedule and cannot delete raw evidence. Nine focused scheduler/API/retention tests, migration contract, Prisma validate/generate, scoped ESLint and diff check pass. Backup/restore, pressure/alert ownership, real scheduler rehearsal, staging execution, load and production operation remain NOT RUN; no completion credit is claimed. |
| 2026-08-31T21:59:25+02:00 | C12o fixed Workforce lease health probe (partial) | 36% | C12 15% | 74/161 | 0/15 | WF-C12-006 now exposes a CRON_SECRET-gated source-only aggregate probe for reconciliation and retention-rehearsal lease state. It redacts owner/error/timestamp fields, treats unscheduled jobs honestly, has no cadence/paging threshold, schedule or automatic reaction, and cannot alter leases or tenant capabilities. Six focused health-route contracts plus scheduler regressions, scoped ESLint, TS-Prettier and diff check pass. SLO approval, alerts, real lease observation, staging, load and production operation remain NOT RUN; no completion credit is claimed. |
| 2026-08-31T22:03:00+02:00 | C12p terminal mobile sync quarantine recovery (partial) | 36% | C12 15% | 74/161 | 0/15 | WF-C12-005 now maps the existing server `QUARANTINED` size/invalid-operation codes into a distinct Android terminal recovery state. The encrypted outbox does not retry/delete/recreate the item or repeat QR/device proof; recovery gets generic matching EN/RU/AZ guidance with no payload or server diagnostic. Source contract, resource parity, ESLint and diff check pass. Android Gradle CI/signed device, tenant fairness, load/chaos and staging remain NOT RUN; no completion credit is claimed. |
| 2026-09-14T03:10:00+02:00 | C9/C12 terminal sync quarantine recovery (partial) | 76% | C9 99% | 78/161 | 6/15 | WF-C9-010/WF-C12-005 map invalid and oversized sync operations to an encrypted terminal quarantine state with generic EN/AZ/RU recovery. The client never retries, recreates, re-scans QR or repeats device proof. Signed-device and load/chaos evidence remain NOT RUN, so no completion credit is introduced. |
| 2026-08-31T22:08:20+02:00 | C12q bounded retry jitter and delayed-head continuity (partial) | 36% | C12 15% | 74/161 | 0/15 | WF-C12-005 now applies equal jitter within its existing 30-second-to-six-hour bounded exponential Android retry window and keeps the WorkManager retry chain alive when an early wake finds a future-due encrypted queue head. Queue ordering, seven-day/eight-attempt limits, ciphertext isolation and immediate-only QR/device proof remain unchanged. Android Gradle/signed-device, server tenant fairness, load/chaos and staging remain NOT RUN; no completion credit is claimed. |
| 2026-09-14T03:25:00+02:00 | C9/C12 outbox retry continuity (partial) | 77% | C9 99% | 78/161 | 6/15 | The account-isolated Android outbox now combines oldest-first domain ordering with equal jitter and preserves the WorkManager retry chain across an early wake. Seven-day/eight-attempt bounds and immediate-only QR/device proof are unchanged. Android Gradle/signed-device and load/chaos evidence remain NOT RUN, so no completion credit is introduced. |

| 2026-08-31T22:17:00+02:00 | C9l explicit action-time location policy/manifest contract (partial) | 36% | C9 0% | 74/161 | 0/15 | WF-C9-007 now has a strict opt-in `attendance.location.requiredActions` policy field and server-owned `locationRequiredActions` mobile manifest. Android can parse the active server requirement but this checkpoint does not invoke location capture, create a background flow, activate a tenant policy or claim a GEO verdict. 44 targeted contracts, scoped ESLint and diff check pass. Exact-SHA Android CI, server action/evidence binding, physical permission/GPS and staging/pilot proof remain open; no completion credit is claimed. |

| 2026-08-31T22:28:00+02:00 | C9m action-time location v4 binding (partial) | 36% | C9 0% | 74/161 | 0/15 | WF-C9-007 now gets an explicit user-action permission/capture path, an immediate-only raw-location mutation that cannot enter the Android outbox, v4 source/mock/capture metadata bound into the canonical request hash, C4 quality fail-closed checks and optional device-signature location binding. The v4 constraint migration preserves v1-v3 facts. It does not select a snapshotted geofence, persist encrypted evidence/assessment, write review cases, activate a tenant or claim device/physical proof. 205 focused contracts, scoped production/new-test ESLint and diff check pass; exact-SHA Android CI/migration apply/physical/staging remain NOT RUN. |

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
| WF-C0-003 | P0 | DONE | Legal/Privacy/HR | Complete data inventory and processing-purpose map for time, location, device, audit, requests and exports | Owner confirmed employee-location disclosure in privacy-policy section 9 (EN/RU/AZ), controller/processor roles and 30-day retention on 2026-09-12 |
| WF-C0-004 | P0 | PARTIAL (OWNER ATTESTATION) | Legal/Privacy | Complete Azerbaijan employment/privacy review and any required employee notice/assessment; add jurisdiction template for future tenants | Owner explicitly closed the LeadDrive privacy gate on 2026-09-12 based on the published section 9 notice, roles and retention; a reusable future-tenant jurisdiction template and any separate external-counsel opinion are not claimed |
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
| WF-C1-010 | P1 | DONE | Security/QA | Add abuse tests for backdating, future time, replay, two devices, changed payload and expired app version | [`C1 abuse matrix`](./workforce-c1-abuse-matrix-evidence-2026-08-30.md): all time/replay/two-device/changed-payload cases plus the configured Android-version direct/offline mutation boundary pass; exact stored replay remains available without claiming native app identity |

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
| WF-C2-004 | P0 | DONE | Backend | Add immutable effective-dated geofence revisions; v1 supports a validated circle and preserves future polygon extension | [`workforce-c2-geofence-revision-evidence-2026-08-30.md`](./workforce-c2-geofence-revision-evidence-2026-08-30.md): validated circle timeline plus accepted-START snapshot/eligibility integration; future polygon remains a versioned extension |
| WF-C2-005 | P0 | DONE | Backend | Add effective-dated employee site eligibility/primary-secondary assignments | [`workforce-c2-site-assignment-evidence-2026-08-30.md`](./workforce-c2-site-assignment-evidence-2026-08-30.md): transfer and temporary-assignment tests |
| WF-C2-006 | P0 | DONE | Backend/HR | Add ordered shift segments with mode, site, planned window, grace and proof policy reference | [`workforce-c2-shift-segment-evidence-2026-08-30.md`](./workforce-c2-shift-segment-evidence-2026-08-30.md): tenant/RLS/immutable draft timeline; C3 workday snapshot remains separate |
| WF-C2-007 | P0 | DONE | Backend | Add arrival/departure/site-transition facts linked to segment and evidence assessment | [`workforce-c2-site-transition-evidence-2026-08-30.md`](./workforce-c2-site-transition-evidence-2026-08-30.md): snapshotted SITE binding plus tenant-FK-linked encrypted evidence and raw-free assessment; client transport remains intentionally C5/C9-gated |
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
| WF-C3-003 | P1 | DONE | HR/Legal | Define paid/unpaid/manual/automatic break policy and lunch treatment | [`workforce-c3-break-semantics-evidence-2026-09-13.md`](./workforce-c3-break-semantics-evidence-2026-09-13.md): actual Pause/Resume only, with no hidden planned deduction or payroll conclusion |
| WF-C3-004 | P1 | DONE | Backend | Make planned breaks enforceable/calculable according to the approved policy while preserving old metadata snapshots | [`workforce-c3-break-semantics-evidence-2026-09-13.md`](./workforce-c3-break-semantics-evidence-2026-09-13.md): Baku 09-18 plus recorded 13-14 pause is eight hours; an omitted pause remains nine hours and is never auto-deducted |
| WF-C3-005 | P1 | DONE | HR/Legal | Define overnight work date, split shifts, minimum rest and cross-midnight correction rules | [`workforce-c3-break-semantics-evidence-2026-09-13.md`](./workforce-c3-break-semantics-evidence-2026-09-13.md): release one fails closed for overnight/split shifts pending a later approved version |
| WF-C3-006 | P1 | PLANNED | Backend | Extend schedule model for overnight/split segments without changing historical definition hashes | Compatibility and DST/property tests |
| WF-C3-007 | P1 | DONE | Backend | Version future default-selection timeline instead of mutating a timeless `isDefault` | [`workforce-c3-default-timeline-evidence-2026-08-30.md`](./workforce-c3-default-timeline-evidence-2026-08-30.md): RLS/audit/snapshot-bound organization timeline; team defaults remain safely unavailable without historical membership |
| WF-C3-008 | P1 | DONE | Backend | Snapshot calendar, schedule, segments, sites and calculation policy atomically on accepted start/assignment | [`workforce-c3-schedule-snapshot-evidence-2026-08-30.md`](./workforce-c3-schedule-snapshot-evidence-2026-08-30.md): append-only, tenant-bound START snapshot; historical pairs are not reconstructed |
| WF-C3-009 | P2 | PARTIAL | HR/Web | Add bulk assignments, temporary cover, recurring templates and safe preview | [`workforce-c3-bulk-preview-evidence-2026-08-30.md`](./workforce-c3-bulk-preview-evidence-2026-08-30.md): named 200-person browser draft and read-only impact preview; bulk apply/cover/recurrence remain deliberately unavailable |
| WF-C3-010 | P2 | DONE | Backend/QA | Cover IANA timezones, DST gaps/folds, leap day and organization date rollover | [`workforce-c3-timezone-matrix-evidence-2026-08-30.md`](./workforce-c3-timezone-matrix-evidence-2026-08-30.md): Baku unchanged; gap/fold endpoints refuse silent interpretation |
| WF-C3-011 | P2 | DONE | HR/Product | Define shift swap/open shift/on-call requirements or explicitly exclude them per release | [`Release-one shift workflow scope`](./workforce-c3-shift-workflow-scope-2026-09-13.md) explicitly excludes swaps/open shifts/operational on-call; `ON_CALL` remains additive/readable but activation fails closed until a future effective policy is approved |

**Gate C3:** every expected day is derived from a versioned calendar/schedule,
and breaks/overnight/travel have approved semantics rather than hidden math.

### C4 — Geofence and attendance evidence engine

**Goal:** evaluate location and other proof consistently, explainably and
without confusing evidence with identity.

| ID | Pri | Status | Owner | Task | Acceptance evidence |
|---|---:|---|---|---|---|
| WF-C4-001 | P0 | DONE | Backend | Define versioned evidence envelope: source, capture time, accuracy, provider/mock flags, app/device/session references and redacted payload hash | [`workforce-c4-evidence-envelope-evidence-2026-08-30.md`](./workforce-c4-evidence-envelope-evidence-2026-08-30.md): strict v1 schema and tenant-HMAC redaction contract |
| WF-C4-002 | P0 | DONE | Backend | Evaluate distance server-side against the snapshotted geofence and return inside/outside/unknown plus distance/accuracy reason | [`workforce-c4-geofence-evaluation-evidence-2026-08-30.md`](./workforce-c4-geofence-evaluation-evidence-2026-08-30.md): server-side Haversine evaluation treats boundary uncertainty as `UNKNOWN` |
| WF-C4-003 | P0 | DONE | Security/Mobile | Define maximum accuracy, freshness, mock/provider and permission-denied handling per policy | [`workforce-c4-location-evidence-policy-evidence-2026-08-30.md`](./workforce-c4-location-evidence-policy-evidence-2026-08-30.md): quality signals become explainable review/unavailable states, never a silent pass |
| WF-C4-004 | P0 | DONE | Backend | Link QR station to site/area and effective lifecycle; bind token to tenant/station/revision/action/expiry/nonce | [`workforce-c4-qr-station-binding-evidence-2026-08-30.md`](./workforce-c4-qr-station-binding-evidence-2026-08-30.md): immutable Workforce-only station binding and signed QR v2 context |
| WF-C4-005 | P0 | DONE | Backend | Compose required/optional methods per action and segment mode (`allOf`, `anyOf`, fallback/review) | [`workforce-c4-proof-policy-evidence-2026-08-30.md`](./workforce-c4-proof-policy-evidence-2026-08-30.md): explicit all-of/any-of/optional resolver covers Office/Field/Remote/Travel |
| WF-C4-006 | P0 | DONE | Backend | Persist append-only evidence and assessment separately; normal reports retain verdict after raw evidence expiry | [`workforce-c4-evidence-storage-evidence-2026-08-30.md`](./workforce-c4-evidence-storage-evidence-2026-08-30.md): encrypted raw envelope, append-only assessment and due-purge/report projection contract |
| WF-C4-007 | P1 | DONE | Backend | Add impossible-travel, speed, clock and site-transition risk signals as review hints, never automatic guilt | [`workforce-c4-risk-signals-evidence-2026-08-30.md`](./workforce-c4-risk-signals-evidence-2026-08-30.md): deterministic review-only rule version and no guilt/decision output |
| WF-C4-008 | P1 | OWNER DECISION | Product/HR/Privacy | Define equitable fallback when GPS/QR/device/smartphone is unavailable, including disability and lost-phone cases: retry, kiosk/alternative proof or reviewed manual request | OD-16 resolved; every rejection code has a safe recovery action |
| WF-C4-009 | P1 | DONE | Backend/Web | Expose assessment explanation to employee/manager without exposing secrets or raw security internals | [`workforce-c4-assessment-explanation-evidence-2026-08-30.md`](./workforce-c4-assessment-explanation-evidence-2026-08-30.md): safe presentation/recovery keys with secret-detail suppression |
| WF-C4-010 | P1 | DONE | QA/Security | Test GPS edge cases: zero coordinates, boundary, stale/future timestamp, low accuracy, mock suspicion, no permission and no provider | [`workforce-c4-gps-edge-matrix-evidence-2026-08-30.md`](./workforce-c4-gps-edge-matrix-evidence-2026-08-30.md): consolidated negative/edge matrix passes |

**Gate C4:** every location/QR/device result names the evidence, policy and
reason; missing or weak evidence cannot silently look verified.

### C5 — Identity, devices, QR, kiosk and anti-fraud controls

**Goal:** reduce buddy punching/account sharing through layered controls while
remaining recoverable for legitimate employees.

| ID | Pri | Status | Owner | Task | Acceptance evidence |
|---|---:|---|---|---|---|
| WF-C5-001 | P0 | OWNER DECISION | Product/Security/HR | Approve assurance tiers per tenant/site/action and BYOD/company-device rules | OD-02 and OD-04 resolved |
| WF-C5-002 | P0 | PARTIAL | Security/Backend | Require HRM-specific MFA/step-up policy for critical employee/admin actions; preserve recovery codes and accountable reset | [Attendance-security MFA evidence](./workforce-c5-attendance-security-mfa-evidence-2026-08-30.md): critical QR/device-admin mutations fail closed unless the accountable live admin has an enrolled mandatory MFA factor; mobile per-use step-up remains open |
| WF-C5-003 | P0 | PARTIAL | Mobile/Security | Generate non-exportable Android Keystore keys with user-auth properties and safe rotation | [`workforce-c9-android-foundation-evidence-2026-08-30.md`](./workforce-c9-android-foundation-evidence-2026-08-30.md): challenge-bound Android Keystore/StrongBox-preferred source foundation; physical key lifecycle, rotation transport and server validation remain open |
| WF-C5-004 | P0 | PLANNED | Backend/Security | Validate Android Key Attestation chain, roots, revocation, security level, challenge and app identity server-side | Software key/emulator/untrusted chain rejected or reviewed |
| WF-C5-005 | P0 | PLANNED | Mobile/Backend | Bind Play Integrity verdict/request hash to the exact attendance action; use tiered response and no verdict cache | Tampered/replayed request tests |
| WF-C5-006 | P0 | PLANNED | Mobile | Use local BiometricPrompt/device credential only to unlock per-use signature; no template/result leaves OS | Physical smoke and packet/log inspection |
| WF-C5-007 | P1 | PARTIAL | Backend/Web | Complete device pending/approve/revoke/replace/lost/recovery UI with separation of duties | [Partial UI evidence](./workforce-c5-attendance-admin-ui-evidence-2026-08-30.md): self-approval is rejected; a linked authenticated employee can confirm and atomically revoke only their own pending/active device without proof disclosure; replacement lineage is visible. Signed-mobile recovery and physical evidence remain open |
| WF-C5-008 | P1 | PARTIAL | Backend/Web | Complete QR station create/display/rotate/disable/emergency replacement UI linked to a site, with controller health and clock-skew state | [Partial UI evidence](./workforce-c5-attendance-admin-ui-evidence-2026-08-30.md): MFA-gated emergency replacement atomically creates a same-site/same-effective-circle successor and disables the old station; physical controller health/skew and display verification remain open |
| WF-C5-009 | P1 | PARTIAL | Security/Backend | Detect concurrent sessions/devices, impossible device changes and abnormal action volume; route to review | [Review-only triage evidence](./workforce-c5-security-triage-evidence-2026-08-30.md): bounded aggregate concurrent-device/churn/volume prompts and metadata-only audit; C6 lifecycle and C7 reviewer scope remain open |
| WF-C5-010 | P1 | OWNER DECISION | Product/HR/Security | Define site kiosk/badge/PIN mode, anti-sharing controls and emergency fallback | OD-06 resolved before kiosk implementation |
| WF-C5-011 | P1 | PARTIAL | Security | Add rate limits, nonce/challenge expiry, key/secret rotation, redaction and security event alerts | [Endpoint throttling evidence](./workforce-c5-attendance-rate-limit-evidence-2026-08-30.md): fingerprinted QR/device endpoint throttles and existing one-time expiry are regression-tested; central limiter, rotation and alerts remain open |
| WF-C5-012 | P1 | DONE | HR/Security | Define lost/stolen phone, employee termination and admin compromise playbooks | [`Device and access recovery playbooks`](./workforce-device-access-recovery-playbooks-2026-09-13.md) define narrow privacy-safe revoke/freeze/recovery sequences, accountable evidence, measurable validation and rollback; separate C14 staging/physical exercises remain NOT RUN |
| WF-C5-013 | P1 | PLANNED | Security/QA | Exercise QR photo/video relay and remote screen-sharing scenarios; document proximity mitigations and residual risk | Threat test/evidence shows which policy combinations detect or cannot prevent relay |

**Gate C5:** a trusted-device claim is backed by validated hardware/app
assurance and per-use intent; QR/device controls have operational recovery and
do not masquerade as absolute human identity.

### C6 — Exceptions, no-show, correction and employee appeal

**Goal:** make uncertain or missing attendance a reviewable HR workflow rather
than a hidden calculation or direct data overwrite.

| ID | Pri | Status | Owner | Task | Acceptance evidence |
|---|---:|---|---|---|---|
| WF-C6-001 | P0 | DONE | HR/Product | Approve exception taxonomy, severity, owner and SLA | [`workforce-c6-recommended-draft-policy-evidence-2026-08-30.md`](./workforce-c6-recommended-draft-policy-evidence-2026-08-30.md): owner-approved recommended v1 taxonomy, non-disciplinary triage severity, HR owner/escalation, business-hour targets and employee visibility are recorded as draft-only; no tenant policy is activated |
| WF-C6-002 | P0 | PARTIAL | Backend | Create immutable exception case/decision lifecycle with deduplication and links to claim/evidence/workday/segment | [`workforce-c6-exception-case-lifecycle-evidence-2026-08-30.md`](./workforce-c6-exception-case-lifecycle-evidence-2026-08-30.md) and [`scoped decision API`](./workforce-c6-scoped-decision-api-evidence-2026-08-31.md): additive immutable/RLS schema, deterministic raw-proof-free drafts, scoped policy-aware writer and default-deny decision API exist; migration apply/disposable DB concurrency, durable grant rollout and reviewed lifecycle remain open |
| WF-C6-003 | P0 | PARTIAL | Backend | Generate no-show only from a published expected schedule after grace and approved leave/calendar checks | [`exception intake`](./workforce-c6-exception-intake-evidence-2026-08-30.md) and [`bounded scheduler`](./workforce-c6-no-show-review-scheduler-evidence-2026-09-01.md): a default-deny leased worker rechecks published historical schedule, grace, employment, calendar/leave and current workday state inside a serializable materialization transaction, then writes only an immutable review case. Production cadence, tenant flag/cohort, measured load and applied-RLS concurrency remain open |
| WF-C6-004 | P1 | PARTIAL | Backend/HR | Define missed checkout and stale open-shift policy: reminder, review, bounded auto-close proposal or manual correction | [`workforce-c6-exception-intake-evidence-2026-08-30.md`](./workforce-c6-exception-intake-evidence-2026-08-30.md): safe generic reminder/review proposal requires immutable schedule and complete observation; it never fabricates a finish, while policy timing/delivery/auto-close stay owner-gated |
| WF-C6-005 | P1 | PARTIAL | Web | Build exception queue with scope, risk, age, evidence completeness, employee response and next action | [`workforce-c6-exception-queue-foundation-evidence-2026-08-30.md`](./workforce-c6-exception-queue-foundation-evidence-2026-08-30.md): session-admin tenant query, hard cap and EN/RU/AZ read-only queue show every safe review field without raw proof; case-linked employee response, granular grants and real immutable resolution remain open |
| WF-C6-006 | P1 | PARTIAL | Web/Mobile | Let employee explain or appeal an exception and request a correction from the exact day/segment | [`employee-response foundation`](./workforce-c6-employee-response-foundation-evidence-2026-08-30.md), [`case-to-correction source link`](./workforce-c6-correction-request-link-evidence-2026-08-31.md) and [`mobile self-exception foundation`](./workforce-c6-mobile-self-exception-evidence-2026-08-31.md): self discovery, exact-case/workday server validation, source-linked protected correction submission and a generic self-card Android prefill exist; migration apply, visible acknowledgement, accountable lifecycle and real mobile/browser evidence remain open |
| WF-C6-007 | P1 | PARTIAL | Backend | Constrain manager corrections to configured date/duration/range rules; mark derived records as manual | [`workforce-c6-correction-bounds-foundation-evidence-2026-08-30.md`](./workforce-c6-correction-bounds-foundation-evidence-2026-08-30.md): the session-only correction route has mandatory MFA, strict input validation, a fail-closed shared rate guard, generic conflict containment and immutable service handoff; tenant bounds-policy selection and escalation ownership remain open |
| WF-C6-008 | P1 | DONE | Backend | Make correction affect calculation/approval through a new ledger revision, preserving original evidence/verdict | Workforce C6 correction-to-approval evidence: rehydration, correction revision/hash and no-evidence-mutation tests |
| WF-C6-009 | P1 | PARTIAL | Notifications | Add reminders/escalations for missed actions and aging cases without exposing reasons/location in unsafe channels | [`workforce-c6-exception-notification-boundary-evidence-2026-08-31.md`](./workforce-c6-exception-notification-boundary-evidence-2026-08-31.md): pure private in-app planner suppresses unsafe/ineligible/duplicate delivery and emits no raw HRM proof; durable outbox, retry worker, policy/recipient mapping and delivery evidence remain open |
| WF-C6-010 | P2 | PLANNED | HR/Analytics | Measure false positives, correction rate, appeal overturn rate and time-to-resolution | Aggregated metrics exclude raw coordinates/reasons |

**Gate C6:** every uncertain attendance outcome has an accountable lifecycle,
employee visibility and immutable resolution; no-show and corrections are
schedule-aware.

### C7 — HR operations, directory and separation of duties

**Goal:** make the module usable by a real HR department without raw IDs,
overbroad CRM roles or mobile-only requests.

| ID | Pri | Status | Owner | Task | Acceptance evidence |
|---|---:|---|---|---|---|
| WF-C7-001 | P1 | DONE | HR/Security | Approve Workforce role/permission matrix and incompatible-role rules | [`workforce-c7-granular-access-foundation-evidence-2026-08-30.md`](./workforce-c7-granular-access-foundation-evidence-2026-08-30.md): owner-approved recommended v1 roles, scoped HR/team exception decision boundary and incompatible-pair draft are documented and negative-tested; durable enforcement stays separate |
| WF-C7-002 | P1 | PARTIAL | Backend | Implement granular scopes: employee self, team/site manager, scheduler, time approver, evidence reviewer, device admin, export custodian, retention/legal-hold officer, pilot/rollback operator and tenant admin | [`granular foundation`](./workforce-c7-granular-access-foundation-evidence-2026-08-30.md), [`write fence`](./workforce-c7-grant-management-write-fence-evidence-2026-09-05.md), [`Today read fence`](./workforce-c7-today-granular-read-fence-evidence-2026-09-01.md), [`Timesheet read fence`](./workforce-c7-timesheet-granular-read-fence-evidence-2026-09-01.md), [`request-read grant evidence`](./workforce-c7-request-read-grant-evidence-2026-09-13.md), [`named-read session boundary`](./workforce-c7-session-read-boundary-evidence-2026-09-13.md), [`actor-independent grant evidence`](./workforce-c7-actorless-read-grants-evidence-2026-09-13.md), [`timesheet approval grant evidence`](./workforce-c7-timesheet-approval-grant-evidence-2026-09-13.md), [`direct correction grant evidence`](./workforce-c7-direct-correction-grant-evidence-2026-09-13.md), [`shift configuration grant evidence`](./workforce-c7-shift-configuration-grant-evidence-2026-09-13.md), [`assignment configuration grant evidence`](./workforce-c7-assignment-configuration-grant-evidence-2026-09-13.md), [`policy configuration grant evidence`](./workforce-c7-policy-configuration-grant-evidence-2026-09-13.md), [`site-assignment grant evidence`](./workforce-c7-site-assignment-grant-evidence-2026-09-13.md), [`site/geofence configuration grant evidence`](./workforce-c7-site-geofence-configuration-grant-evidence-2026-09-13.md), [`pilot-fence grant evidence`](./workforce-c7-pilot-fence-grant-evidence-2026-09-13.md), [`attendance-security grant evidence`](./workforce-c7-attendance-security-grant-evidence-2026-09-13.md) and [`retention dry-run grant evidence`](./workforce-c7-retention-read-grant-evidence-2026-09-13.md): the empty ledger and replay-safe management endpoints feed bounded inventory/search and default-off pre-disclosure reads/approvals/corrections/configuration; named browser reads reject API-key impersonation and deliberately granted principals no longer depend on a legacy CRM actor. Historical-team grants, remaining endpoint migration, browser role management, initial custody, tenant activation and disposable-DB/RLS evidence stay open |
| WF-C7-003 | P1 | DONE | Web | Build employee/team/site directory pickers with status and effective-date context | Workforce C7 directory-picker evidence: named tenant records, status/effective windows and no typed team/employee/site ID workflow |
| WF-C7-004 | P1 | DONE | Backend/HR | Add employment/team/site history for transfer, temporary assignment, termination and rehire | [`Workforce C7 employment-history evidence`](./workforce-c7-employment-history-evidence-2026-08-30.md): append-only employment lifecycle and effective-dated team/site resolvers are tenant-scoped, generated-client checked and present in the production schema; delayed facts never infer history from mutable directory status or Route data |
| WF-C7-005 | P1 | DONE | Web/Mobile | Deliver self-service leave, absence and time-correction creation/cancel/history | Workforce C7 self-service evidence: self-scoped web fallback, named workday picker, idempotency/overlap/DST/cancel tests; mobile remains C9 |
| WF-C7-006 | P1 | DONE | Web/Backend | Complete manager request decision queue, route conflict acknowledgement and immutable audit | [`Manager request decision acceptance`](./workforce-c7-request-decision-evidence-2026-09-13.md): bounded actor-scoped queue and web actions use a pending-only idempotent transition; request/calendar/correction/notification/audit facts commit atomically and Route overlaps require explicit acknowledgement without mutating Route |
| WF-C7-007 | P1 | PARTIAL | HR/Web | Add future-effective bulk schedules/sites, preview, conflict report and reversible draft before publish | [`workforce-c7-bulk-draft-preview-evidence-2026-08-30.md`](./workforce-c7-bulk-draft-preview-evidence-2026-08-30.md): named schedule/site browser drafts and read-only conflict reports are safe; durable publish and recurrence remain open |
| WF-C7-008 | P1 | DONE | Backend | Freeze approvals when unresolved blocking exceptions or snapshot gaps exist | [`C11 approval blocker evidence`](./workforce-c11-approval-blockers-evidence-2026-09-13.md): server-rebuilt workdays, snapshot/history failures, current deviations and unresolved C6 lifecycles fail closed with exact minimized rows |
| WF-C7-009 | P2 | DONE | HR | Define delegation, temporary approver and manager absence workflow | [`Delegation and manager-absence contract`](./workforce-c7-delegation-absence-contract-2026-09-13.md): temporary authority is explicitly approved, tenant/scope/time/operation bounded, non-transferable, automatically expiring and audited to the actual actor; implementation remains separate |
| WF-C7-010 | P2 | PARTIAL | Security/HR | Review access and decisions periodically; disable stale privileged assignments | [`workforce-c7-access-review-foundation-2026-09-13.md`](./workforce-c7-access-review-foundation-2026-09-13.md): bounded tenant-snapshot review detects expired, inactive, stale, incompatible and out-of-window grants by exact grant ID; it is dry-run only, while the durable reader, reviewed revocation, schedule and staging SLA remain open |

| 2026-08-31T23:28:00+02:00 | C7u explicit scoped exception-decision permission (partial) | 36% | C7 52% | 74/161 | 0/15 | WF-C7-002 now assigns accountable exception decisions only to explicit `HR_ADMIN` or scoped `TEAM_MANAGER` grants; `TIME_APPROVER` remains denied and no role gains raw evidence, payroll, discipline or approval power. The grant ledger is still inactive, so no endpoint/tenant behavior changes and no completion credit is claimed. |

**Gate C7:** ordinary HR tasks use named records and least-privilege roles;
employees can submit requests without Route or an unavailable mobile app.

### C8 — Workforce web product

**Goal:** deliver complete employee, manager, HR and security surfaces separate
from Route & Field.

| ID | Pri | Status | Owner | Task | Acceptance evidence |
|---|---:|---|---|---|---|
| WF-C8-001 | P1 | DONE | Web | Add employee Workforce Today web fallback with one valid action, assignment, evidence requirement and sync/server outcome | [`Employee Workforce Today evidence`](./workforce-c8-employee-today-evidence-2026-09-13.md): self-only assignment/segments, exactly one canonical action, fail-closed proof requirements and explicit server/pending-review outcome on `/workforce`; no Route dependency or second state machine |
| WF-C8-002 | P1 | PARTIAL | Web | Rebuild manager Today around scheduled roster, no-show/previous-open and exceptions rather than only existing workdays | Scheduled absent employee is visible and explained |
| WF-C8-003 | P1 | DONE | Web | Add multi-site day timeline and transition status | [`workforce-c8-multisite-timeline-evidence-2026-09-13.md`](./workforce-c8-multisite-timeline-evidence-2026-09-13.md): the self-only timeline shows Site/Travel/Site plans and append-only arrival/departure/review states without raw proof or physical-presence claims |
| WF-C8-004 | P1 | PARTIAL | Web | Complete timesheet: plan/fact/evidence status/exceptions/approval/correction revisions | Missing snapshots cannot look approvable |
| WF-C8-005 | P1 | PLANNED | Web | Add exception workbench and employee response/appeal context | Queue meets C6 acceptance |
| WF-C8-006 | P1 | DONE | Web | Add Sites/Geofences configuration with map pin, radius calibration, effective date and access scope | [`workforce-c8-sites-geofences-evidence-2026-08-30.md`](./workforce-c8-sites-geofences-evidence-2026-08-30.md): administrator-only named sites, future calibrated circles, assignment-only impact preview and immutable revision history; no browser location collection or physical-presence claim |
| WF-C8-007 | P1 | PLANNED | Web | Add schedule/calendar/break/segment policy editor with safe defaults and validation | No raw IDs; published history is immutable |
| WF-C8-008 | P1 | PARTIAL | Web | Add proof-policy, QR station and trusted-device administration separated by permission | [`workforce-c5-attendance-admin-ui-evidence-2026-08-30.md`](./workforce-c5-attendance-admin-ui-evidence-2026-08-30.md): named-site/effective-circle QR station creation plus device/QR lifecycle UI are administrator-only; proof-policy UI and granular separation-of-duties await C7/C5 gates |
| WF-C8-009 | P1 | PARTIAL | Web | Add restricted evidence timeline and access audit; normal view shows verdict instead of exact coordinates | [`derived evidence timeline evidence`](./workforce-c10-derived-evidence-timeline-evidence-2026-09-13.md): the restricted API returns only bounded verdict/reason records after exact grant and audited purpose; visible web timeline remains open |
| WF-C8-010 | P1 | PARTIAL | Web/I18n | Complete AZ/RU/EN, keyboard, focus, contrast, 200% zoom, responsive tablet/phone and error/empty states | [`workforce-c7-bulk-draft-preview-evidence-2026-08-30.md`](./workforce-c7-bulk-draft-preview-evidence-2026-08-30.md): bulk review has concise announcements, semantic outcomes and bounded named roster search; real browser/AT/contrast/zoom/mobile evidence remains open |
| WF-C8-011 | P2 | PLANNED | Web | Add policy/version diff, effective-date impact preview and safe rollback-to-new-version | No direct historical mutation |

**Gate C8:** all four roles can complete their primary web task in an HRM-only
tenant; security/privacy controls are not mixed into ordinary scheduling.

### C9 — Employee mobile application

**Goal:** deliver a real, signed, supported employee client; server API or a CI
APK artifact alone does not close any mobile gate.

| ID | Pri | Status | Owner | Task | Acceptance evidence |
|---|---:|---|---|---|---|
| WF-C9-001 | P0 | BLOCKED | Product/Mobile | Approve repository/app ownership, Android-first scope, package/signing/distribution and supported device matrix | OD-01/OD-15 resolved; keys/credentials stay outside git |
| WF-C9-002 | P0 | DONE | Mobile/Backend | Implement secure login/bootstrap with tenant module manifest, permissions, policy/config versions and forced-update response | [`C9 mobile bootstrap evidence`](./workforce-c9-mobile-bootstrap-evidence-2026-09-13.md): authenticated bootstrap exposes split module/permissions, effective attendance configuration, exact wire-schema support and one release decision; configured unsupported direct/offline new Workforce writes fail closed while exact replays remain available for outbox drain. Native screens/outbox and signing/distribution remain separate C9/C14 tasks |
| WF-C9-003 | P0 | PARTIAL | Mobile | Build Today state machine UI with one action, current segment/site, timer and server truth | [`workforce-c9-android-foundation-evidence-2026-08-30.md`](./workforce-c9-android-foundation-evidence-2026-08-30.md): source restores server truth after process death, uses server-disclosed actions and requires live acknowledgement; an explicit allow-list now renders only one server-selected immutable current/next segment and safe site name, never GPS/address/geofence/QR/proof. Physical verification remains open |
| WF-C9-004 | P0 | PARTIAL | Mobile | Build Work Time history and day detail with pending/conflict/review/correction status | [`workforce-c9-android-foundation-evidence-2026-08-30.md`](./workforce-c9-android-foundation-evidence-2026-08-30.md): bounded self-history source labels only server-returned values accepted; day detail, persisted pending/conflict/review recovery and device evidence remain open |
| WF-C9-005 | P0 | PARTIAL | Mobile | Build Requests: leave, absence, correction, cancellation, evidence-safe reason and status history | [`workforce-c9-android-foundation-evidence-2026-08-30.md`](./workforce-c9-android-foundation-evidence-2026-08-30.md): typed employee-only request/cancellation and encrypted per-domain queue source; physical form/offline/conflict/review evidence remains open |
| WF-C9-006 | P0 | PARTIAL | Mobile | Implement encrypted local database/outbox, per-domain ordering, operation IDs, retry bounds and logout/tenant-change isolation | [`workforce-c9-android-foundation-evidence-2026-08-30.md`](./workforce-c9-android-foundation-evidence-2026-08-30.md): encrypted Room payload envelope, fixed operation ID, 7-day/8-attempt bounds, WorkManager drain and destructive account boundary source exist; Android build/process-death/two-account/7-day tests remain open |
| WF-C9-007 | P0 | PARTIAL | Mobile | Implement permission-aware action-time location capture and approved on-duty transition mode; stop at Finish/off-shift | [`Android foundation`](./workforce-c9-android-foundation-evidence-2026-08-30.md), [`policy contract`](./workforce-c9-action-time-location-contract-evidence-2026-08-31.md) and [`v4 action binding`](./workforce-c9-action-time-location-binding-evidence-2026-08-31.md): foreground-only action capture, permission/recovery, immediate-only location transport and quality fail-closed guard now exist; encrypted envelope/geofence assessment/review-case persistence and physical background/permission/battery evidence remain open |
| WF-C9-008 | P0 | PARTIAL | Mobile | Implement QR scanner with fresh-token immediate path; never persist raw QR or queue an expired scan | [`workforce-c9-android-foundation-evidence-2026-08-30.md`](./workforce-c9-android-foundation-evidence-2026-08-30.md): delegated single-QR callback is bound to server-required action, has no app camera permission and bypasses durable outbox; device storage/log/replay evidence remains open |
| WF-C9-009 | P0 | PARTIAL | Mobile | Implement device enrollment, attested key, local authentication, revoke/replace cleanup and exact-action signature | [`workforce-c9-android-foundation-evidence-2026-08-30.md`](./workforce-c9-android-foundation-evidence-2026-08-30.md): Android Keystore candidate, per-use OS strong-biometric signature, self enrollment/proof, account-bound local cleanup and exact workday signature source exist; server attestation validation, server/mobile revoke-replace flow and physical H5 matrix remain open |
| WF-C9-010 | P1 | PARTIAL | Mobile | Implement offline/conflict/review recovery center and safe re-scan/re-capture rules | [`workforce-c9-android-foundation-evidence-2026-08-30.md`](./workforce-c9-android-foundation-evidence-2026-08-30.md): metadata-only outbox recovery surface provides bounded safe messages; complete server-code mapping and Android conflict/device/re-scan exercise remain open |
| WF-C9-011 | P1 | PARTIAL | Mobile | Add push/local reminders for shift/segment/missed action with privacy-safe notification text | [`workforce-c9-android-foundation-evidence-2026-08-30.md`](./workforce-c9-android-foundation-evidence-2026-08-30.md): opt-in generic local missed-finish source uses only immutable server shift end and has no identifier/payload input; permission/channel/delivery physical tests and push/start/segment lanes remain open |
| WF-C9-012 | P1 | PARTIAL | Mobile | Add AZ/RU/EN, TalkBack, 200% font, 48 dp, reduced motion, poor-vision/color-independent states | [`workforce-c9-android-foundation-evidence-2026-08-30.md`](./workforce-c9-android-foundation-evidence-2026-08-30.md): AZ/RU/EN core resource catalogs, tab state semantics, live status and explicit 48 dp source exist; server-error localisation and physical accessibility/language review remain open |
| WF-C9-013 | P1 | PARTIAL | Mobile/SRE | Add privacy-safe crash/sync telemetry, build SHA, app version and device-class diagnostics | [`workforce-c9-android-foundation-evidence-2026-08-30.md`](./workforce-c9-android-foundation-evidence-2026-08-30.md): bounded app/build/platform/device-class diagnostics are sent through the existing sanitized sync census; crash SDK, telemetry collector/dashboard and release/privacy review remain open |
| WF-C9-014 | P1 | PARTIAL | Mobile | Implement version migration, forced upgrade, offline outbox drain and safe uninstall/lost-device guidance | [`workforce-c9-android-foundation-evidence-2026-08-30.md`](./workforce-c9-android-foundation-evidence-2026-08-30.md): client/server update gate and update-safe encrypted outbox source exist; supported device/version matrix, managed-Play release and physical rollback drill remain open |
| WF-C9-015 | P2 | DONE | Product/Mobile | Decide iOS release/parity scope after Android pilot evidence | [`iOS release scope`](./workforce-c9-ios-release-scope-2026-09-13.md) explicitly excludes iOS from the current release/pilot and defines evidence required before a separate parity roadmap |

**Gate C9:** a signed app completes normal and failure flows on supported
physical devices; there is no reliance on a web mock, emulator-only evidence or
another repository's generic preview build.

### C10 — Privacy, retention, legal hold and employee transparency

**Goal:** collect the minimum necessary evidence, restrict access and enforce
the recorded 30-day/one-year lifecycle safely.

| ID | Pri | Status | Owner | Task | Acceptance evidence |
|---|---:|---|---|---|---|
| WF-C10-001 | P0 | DONE | Legal/Privacy/HR | Approve purpose, notice, lawful/contract basis, fallback and employee inquiry/appeal channel | [`workforce-c10-legal-notice-evidence-2026-09-13.md`](./workforce-c10-legal-notice-evidence-2026-09-13.md): owner-confirmed section 9 EN/RU/AZ fixes the platform purpose/role/lifecycle/rights boundary while preserving each employer's pre-enable legal duties |
| WF-C10-002 | P0 | DONE | Backend/Privacy | Classify raw location, derived verdict, time fact, request reason, device evidence, audit and export separately | [`workforce-c10-data-classification-evidence-2026-08-30.md`](./workforce-c10-data-classification-evidence-2026-08-30.md): seven-class code dictionary and deny-by-default ordinary-export allow-list |
| WF-C10-003 | P0 | DONE | Backend | Implement tenant-scoped bounded purge for all raw GPS copies, including workday/event start/end coordinates, after 30 days | [`workforce-c10-raw-location-retention-evidence-2026-08-30.md`](./workforce-c10-raw-location-retention-evidence-2026-08-30.md): bounded dry-run/execute/reconciliation tests cover every current raw copy; destructive exposure remains fenced |
| WF-C10-004 | P0 | PARTIAL | Backend | Implement one-year time/decision retention with explicit eligible classes, legal-hold fail-closed check and immutable purge audit | [`workforce-c10-time-decision-retention-hold-evidence-2026-08-30.md`](./workforce-c10-time-decision-retention-hold-evidence-2026-08-30.md): calendar-year inventory and immutable tenant hold contract are fail-closed; writer, executor and immutable purge audit remain fenced |
| WF-C10-005 | P0 | PARTIAL | Backend/SRE | Add retention dry run, backup/restore verification, batching, resume cursor, pressure stop and metrics | [`workforce-c10-retention-dry-run-evidence-2026-08-30.md`](./workforce-c10-retention-dry-run-evidence-2026-08-30.md): dry-run, bounded batching and fail-closed external-execution preflight complete; restore proof, cursor/lease implementation, pressure metrics and staging drill remain open |
| WF-C10-006 | P1 | PARTIAL | Security/Web | Enforce restricted raw-evidence access, purpose/reason, access log and periodic review | [`derived evidence timeline evidence`](./workforce-c10-derived-evidence-timeline-evidence-2026-09-13.md): generic managers/API keys are denied, purpose/reason and an exact evidence-review grant are required, access is audited before response and raw material is absent from the projection; raw investigation policy/UI and periodic review remain open |
| WF-C10-007 | P1 | DONE | Backend | Preserve derived inside/outside/unknown verdict and approved time after raw evidence purge without retaining reversible exact location | [`workforce-c10-post-purge-verdict-evidence-2026-08-30.md`](./workforce-c10-post-purge-verdict-evidence-2026-08-30.md): post-purge fixture preserves the derived verdict and purge receipt while excluding exact/reversible location |
| WF-C10-008 | P1 | PLANNED | Product/Mobile/Web | Show employees when/why location is captured, permission state, retention summary and how to request correction | AZ/RU/EN acceptance with no covert state |
| WF-C10-009 | P1 | PLANNED | Backend/Privacy | Implement employee/tenant data access/export/deactivation workflows with redaction and third-party separation | Subject/contract request test and approval audit |
| WF-C10-010 | P1 | PARTIAL | Security/SRE | Add privacy/security incident runbook for location/device/export exposure | [`workforce-c10-privacy-security-incident-runbook-2026-08-30.md`](./workforce-c10-privacy-security-incident-runbook-2026-08-30.md): privacy-safe preservation, containment, triage and recovery procedure is recorded; named notification owner and tabletop drill remain external/NOT RUN |
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
| WF-C11-002 | P1 | DONE | Backend/Web | Block approval on incomplete facts, unresolved blocking cases or snapshot/history errors | [`C11 approval blocker evidence`](./workforce-c11-approval-blockers-evidence-2026-09-13.md): exact minimized rows/reasons cover finality, snapshots, replay, current deviations and C6 lifecycle; resolved bounded periods remain deterministic/idempotent |
| WF-C11-003 | P1 | DONE | Backend | Add approved-export endpoint from immutable approval/revision, never live mutable rows | [`workforce-c11-approved-export-evidence-2026-08-30.md`](./workforce-c11-approved-export-evidence-2026-08-30.md): persisted calculation/row/fact hashes are reproduced before a narrow attachment is returned |
| WF-C11-004 | P1 | PARTIAL | Security/Web | Require purpose, recipient, authorized scope and encrypted delivery channel; set artifact expiry | [`workforce-c11-direct-export-purpose-evidence-2026-08-30.md`](./workforce-c11-direct-export-purpose-evidence-2026-08-30.md): fixed direct-review purpose, MFA, shared rate guard and historic export-custodian scope exist; external encrypted artifact delivery/expiry remain open |
| WF-C11-005 | P1 | DONE | Web | Add preview, row count, date/employee/site scope, warnings and correction version before export | [`C11 approved-export preview evidence`](./workforce-c11-approved-export-preview-evidence-2026-09-13.md): the no-store UI shows one hash-verified immutable revision and exact ordinary time-fact scope before direct-session download; granular access and MFA stay server-authoritative |
| WF-C11-006 | P1 | DONE | Backend | Keep raw coordinates, QR/device proofs and free-text reasons out of ordinary timesheet export | Explicit `TIME_FACT` allow-list plus projection/privacy tests reject every other current data class |
| WF-C11-007 | P1 | DONE | Web/Analytics | Add schedule/actual, late, no-show, overtime, break, site-transition and exception reports with scope/date filters | [`approved-time report evidence`](./workforce-c11-approved-report-evidence-2026-08-30.md), [`exception aggregate evidence`](./workforce-c11-exception-aggregate-report-evidence-2026-09-01.md) and [`site-transition report evidence`](./workforce-c11-site-transition-report-foundation-evidence-2026-09-13.md): separate scoped reports reconcile approved time, append-only review cases and transition-claim completeness without a physical-presence or payroll claim |
| WF-C11-008 | P1 | DONE | HR/Product | Label overtime as operational deviation, not payable amount | Export schema emits `OPERATIONAL_DEVIATION_NOT_PAYABLE` and contains no wage/payroll field |
| WF-C11-009 | P2 | DONE | Product | Define future payroll/integration contract only after jurisdiction, rounding and accountable system-of-record decisions | [`Payroll/HRIS boundary`](./workforce-c11-payroll-integration-boundary-2026-09-13.md) keeps release 1 payroll-free and requires a separate approved project naming system of record, jurisdiction/rounding, custody, versioned delivery/reconciliation and correction ownership |
| WF-C11-010 | P2 | DONE | Backend | Add signed/versioned integration export and delivery retry ledger if external HRIS is approved | Explicitly excluded from release 1 by the [`payroll/HRIS boundary`](./workforce-c11-payroll-integration-boundary-2026-09-13.md); no external HRIS is approved and the direct-session export cannot become a background delivery channel |

**Gate C11:** an authorized human can approve and securely export a complete,
reproducible period; no output is presented as payroll and no sensitive proof
leaks into the ordinary file.

### C12 — Reliability, observability, scale and operations

**Goal:** keep critical attendance delivery measurable and isolated from other
LeadDrive modules.

| ID | Pri | Status | Owner | Task | Acceptance evidence |
|---|---:|---|---|---|---|
| WF-C12-001 | P0 | DONE | SRE/Product | Approve SLOs: online acknowledgement, pending age, event loss, conflict/error rates and recovery | [`workforce-c12-slo-contract-2026-09-13.md`](./workforce-c12-slo-contract-2026-09-13.md): p95/p99, two/15-minute pending thresholds, zero-loss/reconciliation, error/isolation, RPO/RTO and accountable paging/runbooks |
| WF-C12-002 | P0 | PARTIAL | Backend/SRE | Emit tenant-safe metrics by stream/app/schema/policy result without high-cardinality employee/location data | [`bounded mobile-sync telemetry evidence`](./workforce-c12-mobile-sync-telemetry-evidence-2026-09-13.md): current pull telemetry maps all runtime dimensions to finite allowlists/bounds before logging; dashboard ingestion, paging and end-to-end cardinality/privacy review remain open |
| WF-C12-003 | P0 | PLANNED | SRE/QA | Run 5,000-user morning START wave with jitter on isolated staging and representative trust-off/trust-on profiles | p95/p99, DB/queue metrics and zero-loss reconciliation |
| WF-C12-004 | P0 | PARTIAL | Backend/SRE | Prove Workforce and Route queue/cursor/failure isolation under 503, timeout and overload | [`server stream-isolation evidence`](./workforce-c12-stream-isolation-evidence-2026-09-13.md): concurrent/sequential API contracts prove bounded 503/timeout containment in both directions; mobile queue scheduling, sustained overload and DB failover remain open |
| WF-C12-005 | P1 | PARTIAL | Backend | Bound retries/backoff, payload size, batch size, per-tenant fairness and poison-operation quarantine | [`server workload-bound evidence`](./workforce-c12-server-workload-bounds-evidence-2026-09-13.md): page/chunk/lease/retry and atomic stream/device/user/tenant limits fail closed with smaller-page recovery; Android maps invalid/oversized operations to terminal encrypted quarantine, while signed-device and load/chaos proof remain open |
| WF-C12-006 | P1 | PLANNED | SRE | Schedule and monitor cleanup/retention/reminder/no-show jobs with leases, cursors and stale-job alerts | Production-like scheduler evidence |
| WF-C12-007 | P1 | PLANNED | SRE/DBA | Validate indexes/query plans, partition/archive need, storage forecast and backup/restore RTO/RPO | 5k plan plus one-year storage model |
| WF-C12-008 | P1 | PARTIAL | Backend/SRE | Add reconciliation jobs for claim/event/assessment/exception/approval/export invariants | [`reconciliation kernel`](../src/lib/workforce/reconciliation.ts), [paged job](../src/lib/workforce/reconciliation-job.ts) and additive global [`system_job_cursors`](../prisma/migrations/20260913063500_system_job_cursors/migration.sql) state check bounded claim/event/evidence/assessment/exception/approval/export chains, verify immutable approval hashes, compare-and-set progress only after clean pages and return identifier-free counts with `repair: NONE`; snapshot database reader, schedule and staging exercise remain open |
| WF-C12-009 | P1 | PLANNED | SRE | Complete freeze/cohort/rollback and offline-drain runbooks; exercise them | Timed tabletop/staging rollback evidence |
| WF-C12-010 | P2 | DONE | Support/Product | Create privacy-safe support diagnostics and escalation playbook | [`Workforce sync support playbook`](./workforce-sync-support-playbook.md) plus the bounded `scripts/workforce-sync-diagnostics.mjs` contract: support gets fixed aggregate machine evidence and a recovery/escalation path without raw secrets, proof, location or employee reasons |
| WF-C12-004 | P0 | PARTIAL | Backend/SRE | Prove Workforce and Route queue/cursor/failure isolation under 503, timeout and overload | [`workforce-c12-mobile-isolation-observability-evidence-2026-08-30.md`](./workforce-c12-mobile-isolation-observability-evidence-2026-08-30.md): injected Route write failure leaves the next Workforce sync operation independently successful; real queue/cursor/timeout/overload proof remains staging work |
| WF-C12-005 | P1 | PARTIAL | Backend | Bound retries/backoff, payload size, batch size, per-tenant fairness and poison-operation quarantine | [`workforce-c12-sync-push-bounds-evidence-2026-08-30.md`](./workforce-c12-sync-push-bounds-evidence-2026-08-30.md): 512 KiB bounded body, 100-operation contract, 64 KiB payload-free terminal disposition and source-only Android terminal recovery mapping exist; tenant fairness and signed/load proof remain open |
| WF-C12-006 | P1 | PARTIAL | SRE | Schedule and monitor cleanup/retention/reminder/no-show jobs with leases, cursors and stale-job alerts | [`scheduler plan`](./workforce-c12-scheduler-operations-plan-2026-08-30.md), [`reconciliation foundation`](./workforce-c12-reconciliation-foundation-evidence-2026-08-30.md) and [`lease health probe`](./workforce-c12-job-health-probe-evidence-2026-08-31.md): CRON_SECRET-gated lease/cursor read-only workers and a fixed-name aggregate health probe exist in source but are deliberately absent from deployment cron; destructive/notification jobs, final thresholds/alerts and production-like scheduler evidence remain NOT RUN |
| WF-C12-007 | P1 | PARTIAL | SRE/DBA | Validate indexes/query plans, partition/archive need, storage forecast and backup/restore RTO/RPO | [`workforce-c12-capacity-restore-plan-2026-08-30.md`](./workforce-c12-capacity-restore-plan-2026-08-30.md): representative plan/restore/storage gates are defined; 5k plan, restore drill and owner RTO/RPO remain NOT RUN |
| WF-C12-008 | P1 | PARTIAL | Backend/SRE | Add reconciliation jobs for claim/event/assessment/exception/approval/export invariants | [`workforce-c12-reconciliation-foundation-evidence-2026-08-30.md`](./workforce-c12-reconciliation-foundation-evidence-2026-08-30.md): bounded scanner plus source-only, lease/cursor-fenced scheduled 31-day structural scan for one enabled tenant; migration-gated case/decision coverage, alerting, cron activation, export delivery and staging zero-loss evidence remain open |
| WF-C12-009 | P1 | PARTIAL | SRE | Complete freeze/cohort/rollback and offline-drain runbooks; exercise them | [Controlled fence rollback evidence](./workforce-c12-freeze-rollback-evidence-2026-08-30.md): MFA-gated non-destructive procedure and source contracts exist; timed tabletop/staging/offline-drain evidence remains open |
| WF-C12-010 | P2 | DONE | Support/Product | Create privacy-safe support diagnostics and escalation playbook | [`workforce-c12-support-diagnostics-evidence-2026-08-30.md`](./workforce-c12-support-diagnostics-evidence-2026-08-30.md): code-only sync/QR/device/fence recovery and escalation contract; live support exercise remains explicitly NOT RUN |

**Gate C12:** critical events are measured end to end, zero-loss reconciliation
passes, scale targets pass and rollback has been exercised.

### C13 — Additive migration and backward compatibility

**Goal:** introduce the new model without corrupting current workdays, breaking
old clients or coupling Workforce back to Route.

| ID | Pri | Status | Owner | Task | Acceptance evidence |
|---|---:|---|---|---|---|
| WF-C13-001 | P0 | DONE | Backend/DBA | Write additive schema ADR and migration sequence; no rename/drop/destructive backfill | [`C13 additive migration ADR`](./workforce-c13-additive-migration-adr-2026-09-13.md) plus the compatibility contract scan all 35 Workforce-named migrations and reject drop/rename/truncate/delete/update rewrites |
| WF-C13-002 | P0 | DONE | Backend | Keep one canonical domain service behind legacy/new endpoints; prevent divergent state machines | [`C13 compatibility contract`](../src/__tests__/workforce-c13-compatibility-contract.test.ts) proves direct and offline push adapters import and call `applyMtmWorkdayEvent` |
| WF-C13-003 | P0 | DONE | Backend | Version mobile request/response/evidence schemas and advertise support in bootstrap | [`C13 mobile wire-schema evidence`](./workforce-c13-mobile-schema-contract-evidence-2026-09-13.md): exact deployed bootstrap-response, workday request/response, evidence-envelope and site-transition schemas are advertised independently from cohort protocol and Android release policy; structured update/drain outcomes fail closed once deliberately configured |
| WF-C13-004 | P0 | DONE | Backend | Preserve legacy facts as `LEGACY/UNKNOWN` proof rather than fabricating site/device assurance | Additive schema default, no-backfill migration comment and the [`C13 compatibility contract`](../src/__tests__/workforce-c13-compatibility-contract.test.ts) preserve unknown historical assurance |
| WF-C13-005 | P1 | DONE | Backend | Introduce read path by feature flag: new snapshots/evidence where available, explicit missing state otherwise | Approval service returns `WORKFORCE_TIMESHEET_APPROVAL_SNAPSHOT_MISSING`; the contract prevents silent recalculation from mutable live policy |
| WF-C13-006 | P1 | PARTIAL | Backend/QA | Test Neither, HRM-only, Routes-only and Both for APIs, jobs, nav, sync, mobile and failures | Server bootstrap stream matrix covers all four entitlement modes; signed mobile, jobs and full failure/staging matrix remain open |
| WF-C13-007 | P1 | PARTIAL | SRE | Define migration rollout, compatibility window, metrics, freeze and rollback without schema deletion | [`C13 additive migration ADR`](./workforce-c13-additive-migration-adr-2026-09-13.md) and existing sync-v2 runbook define additive rollback/window/drain; timed staging rehearsal remains open |
| WF-C13-008 | P1 | PLANNED | Backend/Mobile | Drain/deprecate legacy mutation paths only after app adoption and offline horizon; return explicit unsupported-version code afterward | Usage reaches approved threshold and no pending old outbox remains |
| WF-C13-009 | P1 | PLANNED | QA | Reconcile before/after workday counts, event hashes, approvals, tenant scope and reports | Zero unexplained delta |

**Gate C13:** migrations are forward-compatible, old data is honestly labelled,
supported clients remain idempotent and rollback does not delete history.

### C14 — Verification, physical pilot and controlled release

**Goal:** close H6 with real evidence, one LeadDrive cohort and staged expansion.

| ID | Pri | Status | Owner | Task | Acceptance evidence |
|---|---:|---|---|---|---|
| WF-C14-001 | P0 | DONE | QA | Maintain unit/property tests for time, schedules, geofence, evidence composition, assessment, exceptions, retention and approvals | [`C14 verification traceability`](./workforce-c14-verification-traceability-2026-09-13.md) plus its executable maintenance guard map 26 test files across all eight domains; the complete mapped set passes without claiming physical evidence |
| WF-C14-002 | P0 | PARTIAL | QA/Security | Run tenant/RLS/role/IDOR, replay, backdating, QR relay assumptions, GPS spoof signals, attestation and admin-abuse tests | [`C14 security matrix`](./workforce-c14-security-matrix-2026-09-13.md) maps seven lanes to 16 passing server/source files; real QR relay, hardware attestation/biometric, signed-device recovery and disposable-DB RLS gates remain open |
| WF-C14-003 | P0 | PLANNED | QA/Web | Run browser E2E for employee/manager/HR/security roles in AZ/RU/EN at desktop/tablet/phone and 200% zoom | Artifacts show success/error/recovery states |
| WF-C14-004 | P0 | BLOCKED | QA/Mobile | Run signed physical Android matrix on at least two device classes: install/update, GPS/permission, QR, attestation, biometric unlock, offline, process death, reboot and date rollover | Exact build SHA/checksum and pass/fail evidence |
| WF-C14-005 | P0 | DONE | QA | Test multi-site 09-13 A, travel, 14-18 B; wrong site, weak GPS, delayed upload and transfer during offline | [`C14 multi-site scenario`](../src/__tests__/workforce-c14-multi-site-scenario.test.ts) pins the Baku schedule and expected review-case, transition-report and eight-hour timesheet outcomes without treating a claim as physical presence |
| WF-C14-006 | P0 | PLANNED | QA/SRE | Run load/chaos/reconciliation/backup/retention/export drills in isolated staging | C10-C12 gates met |
| WF-C14-007 | P0 | BLOCKED | Product/HR/Privacy | Record named LeadDrive pilot cohort, participants, devices, policies, sites, notice, observation window and rollback owner outside git | OD-14 and all legal gates resolved |
| WF-C14-008 | P0 | PLANNED | SRE/Product | Enable exact cohort behind write fence; preserve Route independence and daily evidence review | No global enablement; daily metric/exception report |
| WF-C14-009 | P0 | PLANNED | Product/HR/QA | Complete pilot exit review: usability, false positives, corrections, appeals, event loss, privacy complaints and SLO | Signed GO/NO-GO; no open P0/P1 |
| WF-C14-010 | P1 | PLANNED | Product/SRE | Release to official LeadDrive use only after green gates; initially prohibit automatic payroll/discipline | Main/CI/deploy/smoke evidence and communication |
| WF-C14-011 | P1 | PLANNED | Product | Add a Both-modules tenant cohort only after HRM-only LeadDrive evidence; then measured tenant-by-tenant expansion | Route/Workforce isolation and cohort observation pass |
| WF-C14-012 | P1 | DONE | Support/HR | Publish administrator/employee help and incident/recovery guides from the verified product | [`Administrator guide`](./workforce-administrator-guide.md), [`employee guide`](./workforce-employee-guide.md), existing incident/rollback/sync runbooks and their source contract map current pages and preserve explicit mobile/presence/payroll limitations |

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
- At roadmap creation, `NOT RUN` included full build, full browser E2E,
  physical Android/QR/GPS, 5,000-user load, formal legal/privacy assessment and
  the real LeadDrive pilot. The legal/privacy item was later closed by explicit
  owner attestation recorded in C0-003/C0-004; this does not claim an external
  counsel opinion. Physical devices, load and the human pilot remain `NOT RUN`.
- No deploy, production mutation, capability toggle or retention deletion is
  authorized by this document.
