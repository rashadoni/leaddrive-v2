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
> [`workforce-c5-android-key-attestation-foundation-evidence-2026-08-30.md`](./workforce-c5-android-key-attestation-foundation-evidence-2026-08-30.md),
> [`workforce-c6-exception-intake-evidence-2026-08-30.md`](./workforce-c6-exception-intake-evidence-2026-08-30.md),
> [`workforce-c6-exception-case-lifecycle-evidence-2026-08-30.md`](./workforce-c6-exception-case-lifecycle-evidence-2026-08-30.md),
> [`workforce-c6-exception-response-cycle-dedup-evidence-2026-09-28.md`](./workforce-c6-exception-response-cycle-dedup-evidence-2026-09-28.md),
> [`workforce-c7-self-service-request-evidence-2026-08-30.md`](./workforce-c7-self-service-request-evidence-2026-08-30.md),
> [`mobile-sync-v2-workforce-contract.md`](./mobile-sync-v2-workforce-contract.md),
> [`workforce-c7-directory-picker-evidence-2026-08-30.md`](./workforce-c7-directory-picker-evidence-2026-08-30.md),
> [`workforce-c6-scoped-decision-api-evidence-2026-08-31.md`](./workforce-c6-scoped-decision-api-evidence-2026-08-31.md),
> [`workforce-c7-employment-history-evidence-2026-08-30.md`](./workforce-c7-employment-history-evidence-2026-08-30.md),
> [`workforce-c9-mobile-bootstrap-release-evidence-2026-08-30.md`](./workforce-c9-mobile-bootstrap-release-evidence-2026-08-30.md),
> [`workforce-c9-android-foundation-evidence-2026-08-30.md`](./workforce-c9-android-foundation-evidence-2026-08-30.md),
> [`workforce-c9-action-time-location-contract-evidence-2026-08-31.md`](./workforce-c9-action-time-location-contract-evidence-2026-08-31.md),
> [`workforce-c9-action-time-location-binding-evidence-2026-08-31.md`](./workforce-c9-action-time-location-binding-evidence-2026-08-31.md),
> [`workforce-c9-action-time-evidence-persistence-evidence-2026-08-31.md`](./workforce-c9-action-time-evidence-persistence-evidence-2026-08-31.md),
> [`workforce-c9-location-recovery-evidence-2026-08-31.md`](./workforce-c9-location-recovery-evidence-2026-08-31.md),
> [`workforce-c9-history-local-recovery-evidence-2026-08-31.md`](./workforce-c9-history-local-recovery-evidence-2026-08-31.md),
> [`workforce-c9-request-local-recovery-evidence-2026-08-31.md`](./workforce-c9-request-local-recovery-evidence-2026-08-31.md),
> [`workforce-c9-device-replacement-source-evidence-2026-09-01.md`](./workforce-c9-device-replacement-source-evidence-2026-09-01.md),
> [`workforce-c9-recovery-server-truth-evidence-2026-08-31.md`](./workforce-c9-recovery-server-truth-evidence-2026-08-31.md),
> [`workforce-c9-sign-in-boundary-evidence-2026-08-31.md`](./workforce-c9-sign-in-boundary-evidence-2026-08-31.md),
> [`workforce-c5-attestation-preflight-evidence-2026-08-31.md`](./workforce-c5-attestation-preflight-evidence-2026-08-31.md),
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
| 2026-09-13T18:29:00+02:00 | C7 role-management browser UI (partial) | 47% | C7 70% | 78/161 | 6/15 | WF-C7-002 gains a named, localized role-management section with bounded target search, least-scope selection, expiry/reason review, aggregate access-review findings and two-step revocation. Tenant-admin bootstrap/removal stays outside the browser and no live grant or flag is created. Two contract files / 13 tests, scoped lint, translation parity and diff check pass; browser interaction remains NOT RUN and no completion credit is introduced. |
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

| 2026-08-31T22:37:00+02:00 | C9n accepted action-time evidence persistence (partial) | 36% | C9 0% | 74/161 | 0/15 | Location-required actions now transactionally persist an event-bound encrypted `LOCATION` envelope and a raw-free C4 `LOCATION_QUALITY` assessment; the receipt HMAC uses a separate server-only tenant key domain. Missing key/evidence storage rolls back the fact. It deliberately does not infer a site, write a geofence verdict or exception case, activate a tenant, or claim physical/staging evidence. 167 focused contracts, scoped ESLint and diff check pass; full typecheck/build, Prisma apply and external gates remain NOT RUN. |

| 2026-08-31T22:40:00+02:00 | C9o location-specific terminal recovery (partial) | 36% | C9 0% | 74/161 | 0/15 | WF-C9-010 now maps the two canonical server location failures to concise EN/RU/AZ employee recovery messages. It distinguishes a needed fresh capture from a reviewed fallback, exposes no proof/location detail and cannot queue/replay an action-time proof. 132 focused contracts, scoped ESLint and diff check pass; Android Gradle/device recovery evidence remains NOT RUN. |
| 2026-09-14T03:55:00+02:00 | C9 action-time location chain (partial) | 80% | C9 99% | 78/161 | 6/15 | The opt-in foreground location chain now covers policy manifest, v4 immutable hash binding, encrypted event-bound evidence, raw-free quality assessment and localized terminal recovery. It does not activate any tenant policy or infer a site. Migration apply, exact-SHA Android CI, signed devices and physical GPS/geofence evidence remain NOT RUN, so no completion credit is introduced. |

| 2026-08-31T22:45:00+02:00 | C9p snapshotted action-time geofence assessment (partial) | 36% | C9 0% | 74/161 | 0/15 | WF-C9-007 now resolves the accepted event's segment from immutable workday date/timezone/windows, not a client site ID, and persists a separate raw-free `GEOFENCE` assessment only for a matching snapshotted `SITE` segment. Missing snapshot geometry is an explicit `UNKNOWN`; non-site/off-schedule actions remain unclassified rather than guessed. C6 exception lifecycle and all physical/staging proof remain open, so no completion credit is claimed. 8 focused source contracts / 92 tests passed; scoped ESLint and diff check pass. |

| 2026-08-31T22:55:00+02:00 | C9q accepted Work Time day-detail source (partial) | 36% | C9 0% | 74/161 | 0/15 | WF-C9-004 now returns a hard-capped employee-only accepted-event/review/correction-status detail and lets Android expand a day using EN/RU/AZ labels. The API excludes coordinates, notes, review reason codes and proofs; local pending/conflict facts remain C9-010 recovery rather than an invented history state. Android Gradle/device/accessibility proof remains open, so no completion credit is claimed. |

| 2026-08-31T23:05:00+02:00 | C9r employee request status history minimisation (partial) | 36% | C9 0% | 74/161 | 0/15 | WF-C9-005 now makes the mobile self-request response an explicit allow-list: it no longer selects or returns free-text request reason/client idempotency key, and Android expands only valid server submitted/decision/cancellation status times in the tenant timezone plus the employee-visible decision note. Offline/outbox recovery and device evidence remain open, so no completion credit is claimed. |

| 2026-08-31T23:15:00+02:00 | C9s account-bound encrypted outbox fence (partial) | 36% | C9 0% | 74/161 | 0/15 | WF-C9-006 now scopes Android outbox rows/envelopes/recovery/drain to a fresh encrypted opaque session boundary, cancels the worker on logout and performs an additive v1-to-v2 Room migration that discards only unscoped legacy rows rather than replaying them under a new sign-in. The existing seven-day/eight-attempt/domain-order guarantees remain. Gradle/Room upgrade, process-death and physical two-account evidence remain open, so no completion credit is claimed. |

| 2026-08-31T23:25:00+02:00 | C9t fresh QR action-attempt fence (partial) | 36% | C9 0% | 74/161 | 0/15 | WF-C9-008 now binds delegated QR callbacks to one in-memory action-attempt, disables parallel attendance transitions while scanning and clears the attempt on cancellation/failure/logout. A late callback is ignored; raw QR remains immediate-only. Scanner/relay/replay and physical evidence remain open, so no completion credit is claimed. |
| 2026-08-31T23:11:00+02:00 | C9u recovery return to current server truth (partial) | 36% | C9 0% | 74/161 | 0/15 | WF-C9-010 now offers a separate direct return to canonical current server truth alongside the metadata-only local recovery refresh. It clears only in-memory derived screens and neither replays/decrypts outbox data nor starts QR/device/location proof. Android recovery/device exercise remains open, so no completion credit is claimed. |
| 2026-08-31T23:24:00+02:00 | C9v failed-sign-in boundary preservation (partial) | 36% | C9 0% | 74/161 | 0/15 | WF-C9-006/WF-C9-009 now wait for a successful server login response before destroying the former encrypted account boundary. A successful new login still clears old session/key/outbox state before it writes the new token; a rejected login does not silently discard recoverable local state. Android account-switch/device exercise remains open, so no completion credit is claimed. |
| 2026-08-30T17:21:43+02:00 | C5j Android key-attestation server boundary (partial) | 32% | C5 8% | 64/161 | 0/15 | WF-C5-004 now validates an injected chain's X.509/root/revocation/public-key and exact claimed hardware/boot/app prerequisites fail-closed. A vetted ASN.1 inspector, live Google operations, endpoint binding and physical evidence remain open, so no completion credit is claimed |
| 2026-09-14T04:20:00+02:00 | C5 Android key-attestation foundation (partial) | 88% | C5 17% | 78/161 | 6/15 | WF-C5-004 now has a fail-closed server verifier foundation for certificate chain/root/revocation/public-key and claimed hardware/boot/app prerequisites. The official Android verifier, live revocation operations, final app identity, endpoint consumption and signed physical devices remain NOT RUN, so no completion credit is introduced. |
| 2026-08-31T23:55:00+02:00 | C5q server-first Android attestation preflight (partial) | 36% | C5 25% | 74/161 | 0/15 | WF-C5-004 now obtains an ephemeral tenant/employee server nonce before a new Android KeyStore key is created, with RLS-protected HMAC-only persistence and an immutable minimal receipt schema. The route does not yet submit/validate the certificate chain or consume the nonce, so it cannot claim hardware trust; Kotlin verifier, root/revocation operations, final app identity and physical evidence remain open. |
| 2026-09-14T04:35:00+02:00 | C5 server-first attestation preflight (partial) | 90% | C5 25% | 78/161 | 6/15 | Enrollment now obtains a tenant/employee-bound ephemeral server nonce before Android creates its key; persistence is RLS-protected and stores only an HMAC selector plus minimal receipt. Certificate-chain submission/consumption, final app identity, live revocation and signed physical evidence remain NOT RUN, so no completion credit is introduced. |
| 2026-08-31T23:59:00+02:00 | C9w Work Time local recovery status (partial) | 36% | C9 0% | 74/161 | 0/15 | WF-C9-004 now pairs accepted self Work Time history with global metadata-only `WORKDAY` outbox pending/conflict/recovery-review counts. It does not decrypt a payload, expose an operation identifier/proof or bind any local action to a day; EN/RU/AZ copy sends the employee to Recovery for fresh server truth. Android Gradle/Room/process-death/device/accessibility evidence remains NOT RUN, so no completion credit is claimed. |
| 2026-09-01T00:05:00+02:00 | C9x request delivery recovery status (partial) | 36% | C9 0% | 74/161 | 0/15 | WF-C9-005 now reads only global metadata-only `HRM_REQUEST` outbox pending/conflict/recovery-review counts, including immediately after a durable offline submit/cancel. It has no request ID/type/date/reason/correction/case/payload and cannot make a local delivery state look submitted or decided; EN/RU/AZ copy sends the employee to Recovery for fresh server truth. Android Gradle/Room/process-death/offline device evidence remains NOT RUN, so no completion credit is claimed. |
| 2026-09-01T00:15:00+02:00 | C9y mobile replacement enrollment source (partial) | 36% | C9 0% | 74/161 | 0/15 | WF-C9-009 now lets a new/revoked Android device select a server-returned own active enrollment as a replacement. The optional opaque link is unavailable during pending provisioning/proof/current active states; server ownership validation and independent manager approval remain required, and no key/proof/chain/biometric/location becomes UI data. Android Gradle, disposable DB replacement transaction and physical two-device evidence remain NOT RUN, so no completion credit is claimed. |
| 2026-09-14T23:15:00+02:00 | C9 action-level location transparency (partial) | 92% | C9 99%; C10 30% | 78/161 | 6/15 | `WF-C9-007`/`WF-C10-008` now show an AZ/RU/EN explanation directly under each server-required location action: selecting it requests a current location only for that action and does not enable background tracking. The UI cannot infer or activate a policy and cannot capture before explicit selection. Android Gradle, rendered permission/accessibility and physical pilot evidence remain NOT RUN, so no completion credit is claimed. |
| 2026-09-14T23:20:00+02:00 | C9 release-error localisation (partial) | 92% | C9 99% | 78/161 | 6/15 | `WF-C9-012` maps only canonical server update-required and platform-unsupported recovery codes to matched EN/RU/AZ managed-update guidance. All other server failures remain generic and no raw diagnostic reaches employee UI. Android Gradle, TalkBack/200% font and signed-device evidence remain NOT RUN, so no completion credit is claimed. |
| 2026-09-14T23:25:00+02:00 | C5 terminal device-key cleanup (partial) | 93% | C5 25%; C9 99% | 78/161 | 6/15 | `WF-C5-003`/`WF-C9-009` delete a local Android Keystore key and clear its encrypted binding only after a fresh server response identifies that exact own enrollment as `REVOKED` or `REPLACED`. Unknown, missing, pending and active states preserve it. Android Keystore/StrongBox and physical two-device evidence remain NOT RUN, so no completion credit is claimed. |
| 2026-09-14T23:30:00+02:00 | C5 local biometric callback containment (partial) | 93% | C5 38%; C9 99% | 78/161 | 6/15 | `WF-C5-006` uses the OS-owned strong-biometric prompt only to release one prepared Keystore signature, and an atomic one-shot fence prevents cancellation or late callbacks from completing the same action twice. No biometric template/result leaves the OS. Android Gradle, packet/log inspection and physical biometric tests remain NOT RUN, so no completion credit is claimed. |
| 2026-09-14T23:35:00+02:00 | C9 one-use Android QR token boundary (partial) | 94% | C9 99% | 78/161 | 6/15 | `WF-C9-008` carries a scanned QR through an opaque one-use object and consumes it before building the immediate action envelope. UI and repository APIs no longer accept a raw QR string; retry requires a fresh scan and QR proof remains outbox-ineligible. Android compile/install, storage/log inspection, relay and physical-device evidence remain NOT RUN, so no completion credit is claimed. |
| 2026-09-14T23:40:00+02:00 | C9 private next-segment reminder (partial) | 94% | C9 99% | 78/161 | 6/15 | `WF-C9-011` schedules opt-in generic local reminders from immutable server-selected shift-end and next-segment instants. WorkManager input and notification text contain no employee, tenant, site, location, QR, workday or proof data. Android Gradle, notification permission/channel/delivery and physical-device evidence remain NOT RUN, so no completion credit is claimed. |
| 2026-09-14T23:45:00+02:00 | C5 biometric manifest downgrade fence (partial) | 95% | C5 44%; C9 99% | 78/161 | 6/15 | `WF-C5-006` treats either a device-trust or biometric requirement as requiring the exact hardware-backed signature path. A malformed/future manifest cannot downgrade a biometric-only action to an unsigned mutation, and no biometric template/result enters transport. Android Gradle, signed-device and physical biometric evidence remain NOT RUN, so no completion credit is claimed. |
| 2026-09-14T23:50:00+02:00 | C5 attestation material minimization (partial) | 95% | C5 50%; C9 99% | 78/161 | 6/15 | `WF-C5-004` no longer materializes or Base64-encodes a Key Attestation certificate chain during generic enrollment while no reviewed submission/receipt transaction consumes it. The challenge-bound key and public-key proof are unchanged; a future verified submission must read and discard the chain immediately. Android verifier integration, live status operations and physical devices remain NOT RUN, so no completion credit is claimed. |
| 2026-09-14T23:55:00+02:00 | C5 attestation receipt write fence (partial) | 96% | C5 56%; C9 99% | 78/161 | 6/15 | `WF-C5-004`/`WF-C5-007` require a complete non-future minimal hardware-attestation receipt before manager approval or use of a device-trust key. Proof-of-possession alone cannot become hardware/app assurance; missing receipt fails closed without writing verification. The receipt writer, official verifier, live status feed and physical-device proof remain NOT RUN, so no completion credit is claimed. |
| 2026-09-15T00:00:00+02:00 | C9 action-time location evidence reconciliation | 96% | C9 99% | 78/161 | 6/15 | Android README and C9 evidence now accurately describe the active-manifest-gated foreground capture: one fresh bounded sample is attached only to the immediate v4 action, with no background service/listener/receiver, last-known fallback or outbox bypass. Android Gradle/device/background/permission/battery, tenant activation and pilot remain NOT RUN; no completion credit is claimed. |
| 2026-09-15T00:05:00+02:00 | C5 Play Integrity exact-action foundation (partial) | 96% | C5 63% | 78/161 | 6/15 | `WF-C5-005` derives a privacy-minimized SHA-256 request hash from the exact tenant/employee/enrollment/operation/workday/action/time/schema tuple and evaluates only a Google-server-decoded verdict. Hash/app/version/license mismatch rejects; insufficient device tier routes to explicit human review, and no verdict is cached. Google decode/client/Play configuration and physical anti-tamper evidence remain NOT RUN, so no completion credit is claimed. |
| 2026-09-15T00:15:00+02:00 | C5 default-off Play Integrity integration (partial) | 97% | C5 75%; C9 99% | 78/161 | 6/15 | `WF-C5-005` adds a fresh Android Standard API token path and server decoder bound to the exact v5 attendance operation. Only a minimal fingerprinted verification fact is retained; token/verdict are not cached. The manifest remains default-off and fails closed without explicit Play service/app identity configuration. Android Gradle, Google live decode, migration apply and physical anti-tamper evidence remain NOT RUN, so no completion credit is claimed. |
| 2026-09-15T00:20:00+02:00 | C5 Android Play Integrity API repair | 98% | C5 81%; C9 99% | 78/161 | 6/15 | `WF-C5-005` imports the Play Integrity 1.6.0 Standard API request builders from their documented nested `StandardIntegrityManager` types. Provider warm-up, exact-action hash, token transport and default-off policy are unchanged. Android Gradle/signed APK, real Google decode and physical-device evidence remain NOT RUN, so no completion credit is claimed. |
| 2026-09-15T00:25:00+02:00 | C9 schedule-mode localization | 98% | C9 99% | 78/161 | 6/15 | Today schedule context now maps canonical WORK/OFF/TRAVEL/SPLIT modes to matched EN/RU/AZ resources instead of exposing server-internal mode strings. Unknown future modes render a generic unavailable label. Android Gradle and physical locale/accessibility review remain NOT RUN, so no completion credit is claimed. |
| 2026-09-15T00:30:00+02:00 | C9 Today tenant-clock rendering | 98% | C9 99% | 78/161 | 6/15 | Today start/end and next-segment time render in the server-provided IANA tenant timezone with an explicit zone label, independent of the phone timezone. Invalid timezone data fails to a generic unavailable state. Android Gradle and physical cross-timezone review remain NOT RUN, so no completion credit is claimed. |
| 2026-09-15T00:35:00+02:00 | C9 Recovery tenant-clock rendering | 99% | C9 99% | 78/161 | 6/15 | Recovery timestamps now use the same server-provided IANA tenant timezone as Today and history, never the device timezone. Invalid timezone or timestamp data renders a generic unavailable state instead of silently substituting UTC. Android Gradle and physical cross-timezone review remain NOT RUN, so no completion credit is claimed. |
| 2026-09-26T16:16:45+02:00 | PR #198 independent-review repair (pending) | 99% | C5 81%; C9 99% | 81/161 | 14/15 | Independent review correctly blocked merge on fail-open attestation enums and Google Play Integrity decode under workday locks. The repair uses positive runtime allowlists and moves provider I/O to a read-only policy/device preflight; the write transaction rechecks policy, enrollment, signature, token fingerprint, exact-action hash and receipt freshness before atomic persistence. README now records the existing next-segment reminder. No task/gate credit is added until exact-SHA CI and independent rereview are green; full build/browser/device/load remain NOT RUN on Contabo. |
| 2026-09-26T17:39:00+02:00 | PR #198 reviewed production release | 99% | C5 81%; C9 99% | 81/161 | 14/15 | Independent rereview of exact head `81ca9a130862b13d50223e66d4de4f81a64b3dcf` returned GREEN with zero findings after fail-closed attestation, transaction-I/O and type-boundary repairs. All five machine checks and Android lint/unit passed; PR #198 merged normally as `cb9a886ab888b28e8098a735dfac3ff93875d4d5`. Deploy run `36250578124` completed through the SHA-bound artifact path; public ping returned 200/`ok`, and public build-info reported the exact merge SHA. This closes the pending release receipt but adds no task or phase-gate credit; physical Android/QR/GPS/biometric, isolated load/restore and human pilot remain NOT RUN. |
| 2026-09-26T17:54:24+02:00 | Exact-SHA independent-review delivery control (pre-merge) | 99% | C5 81%; C9 99% | 81/161 | 14/15 | Live readback found five Actions checks correctly bound to GitHub Actions, admin enforcement enabled, a non-null zero-approval PR rule and force-push/deletion disabled, but no required `agent-review`. The isolated repair preserves every live invariant, adds `agent-review` without restoring the fail-open Anthropic workflow, rejects abbreviated/stale/non-main/non-open review publication, and verifies the exact protection readback. Shell syntax, publisher behavior, delivery asset assertions and diff whitespace pass locally; live configuration is intentionally unchanged until this separate PR is independently reviewed and merged. No workforce task or phase-gate credit is added. |
| 2026-09-26T18:00:32+02:00 | Delivery-control independent pre-commit review | 99% | C5 81%; C9 99% | 81/161 | 14/15 | Independent review found and blocked one P2: active delivery guidance still claimed environment reviewers were unavailable because the repository was private/required Enterprise, while the current repository is public. The repair now records the factual solo-owner boundary and keeps independent review at the pre-merge `agent-review` layer. Rereview returned GREEN with zero remaining findings and measured the complete diff at 55,180 bytes. Live protection is still unchanged; no task or phase-gate credit is added before reviewed merge and exact readback. |
| 2026-09-26T18:49:52+02:00 | PR #439 release and protection-readback follow-up | 99% | C5 81%; C9 99% | 81/161 | 14/15 | Exact head `dca279fd0162e3bc6d23019da1436ad9c2da4e4d` passed independent review plus all machine gates, merged normally as `5b3db2211d4e48c6a79490b711dd634088894fcf`, and deploy run `36255490143` completed through public smoke with exact artifact SHA. The reviewed live PUT added required `agent-review` while preserving the five Actions app bindings and every other protection invariant. GitHub normalized the requested any-app sentinel `app_id=-1` to `app_id=null`; the overly literal verifier therefore failed after the correct write. A narrow tested follow-up accepts GitHub's documented readback representation without removing or weakening the live gate. No workforce task or phase-gate credit is added. |
| 2026-09-26T18:54:11+02:00 | Protection-readback follow-up independent review | 99% | C5 81%; C9 99% | 81/161 | 14/15 | Independent review found one P2 in the first normalization repair: jq would also treat a missing `agent-review.app_id` key as `null`. The corrected verifier requires the key to exist before normalizing explicit `null` to the requested `-1` semantics. Behavioral coverage now proves explicit `null` and echoed `-1` succeed while a missing binding and every weakened live invariant fail closed. Rereview returned GREEN with zero remaining findings; no workforce task or phase-gate credit is added. |
| 2026-09-26T19:45:38+02:00 | PR #440 release and exact protection receipt | 99% | C5 81%; C9 99% | 81/161 | 14/15 | Exact head `ae52e4941b71754961ddb7b4437d9edf9bb4cf30` passed all five machine checks and the required independent `agent-review`, merged normally as `ea3e3c539a2d92cda4978e753508796ae28c3a13`, and deploy run `36258347026` completed with public ping 200 plus exact build-info artifact SHA. The reviewed configurator now exits zero against GitHub's explicit-null wildcard readback; independent REST verification preserves five `app_id=15368` checks, required `agent-review`, admin enforcement, the PR rule and disabled force-push/deletion. No Workforce task or phase-gate credit is added. |
| 2026-09-26T19:46:55+02:00 | C6 scoped exception-workbench backend (partial) | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | WF-C6-002/005 gain metadata-first historical team/site filtering, per-case read/decide grants, no case-id response, principal/action/revision-bound encrypted action tokens and a fixed body-only decision endpoint. Review found terminal resolution can race linked request/response writers that lack the same case lock, so this slice deliberately offers only acknowledge/request actions; resolution/reopen, shared-lock cutover and disposable-DB race proof remain open. Six frozen-diff findings were repaired: actor-independent write access, live cutover rollback, the 64-decision bound, current-cycle response projection, revoked-grant pre-scan and canonical token text. Thirteen focused files / 94 tests, scoped ESLint, recursive RLS scan, diff check and independent zero-finding rereview pass; full exact-SHA CI remains pending, while local full build/typecheck/browser/Android/load are NOT RUN. No completion credit is claimed. |
| 2026-09-26T20:55:59+02:00 | PR #441 exact-head type inference repair | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | First ready head `702b9830e3107d71bf0fc69f3ffb2585b76e3852` passed static checks and every required gate except typecheck, which correctly found 18 new TS2339 diagnostics in the queue route from lost nested Prisma payload inference. The selection is now a checked module-level `WorkforceExceptionCaseSelect` with its exact `GetPayload`; no baseline or gate changed. Thirteen focused files / 94 tests, route-scoped ESLint and diff check pass; fresh independent exact-head review and all replacement CI gates remain pending. No completion credit is claimed. |
| 2026-09-26T21:44:22+02:00 | PR #441 reviewed production release | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Independent review of exact head `089fbe39b14cd381ad5e4e698c59013bbf528efe` returned GREEN with zero findings after the type-inference repair. `pr-scope`, `static-checks`, `typecheck`, `runner-policy`, `scan` and required `agent-review` passed; PR #441 merged normally as `13cc5bd51a76f28f8c9d434ab0f6e9337e4b95af`. Deploy run `36265543226` passed quality/security, built the SHA-bound artifact, deployed atomically and completed scheduler, tenant-isolation, ping, revision and feature smoke checks. Independent public reads returned `{"ok":true}` and exact `artifactSha=13cc5bd51a76f28f8c9d434ab0f6e9337e4b95af`. Terminal actions remain fenced pending shared-lock cutover and real PostgreSQL race proof, so no task or phase-gate credit is added. |
| 2026-09-26T22:13:09+02:00 | C6 exception shared-lock cutover (pre-review) | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | [`Shared-lock evidence`](./workforce-c6-shared-lock-cutover-evidence-2026-09-26.md): employee response, linked self-request submit/cancel, manager request decision and mobile sync now use the canonical case decision lock plus a bounded post-lock lifecycle guard. A real finding changed the terminal writer from a potentially stale serializable snapshot to explicit `READ COMMITTED` with post-lock capability/grant/context rechecks. Seven focused files pass 156 tests; targeted ESLint, recursive RLS scan (552/0) and delivery assets pass. The two opposite-table PostgreSQL race tests are wired into PR and deploy CI but remain locally skipped pending the disposable service; independent review and exact-SHA gates remain open. Terminal resolution/reopen stay fenced and no task/gate credit is added. |
| 2026-09-26T22:52:59+02:00 | C6 shared-lock independent-review repair | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | The first independent review returned RED with three P2 findings: opposite `case -> workday` ordering versus timesheet approval, stale pre-lock historical scope in the terminal grant recheck, and missing post-lock exact replay for linked submit/cancel. Repairs establish `workday -> case` whenever both fences are needed, rebuild the resource from the post-lock case row, and preserve exact web/mobile retries before the lifecycle guard. Seven focused files pass 161 tests; four expanded PostgreSQL tests are locally skipped and remain blocking in PR/deploy CI. Fresh complete-tree rereview and exact-head gates remain open; terminal actions stay fenced and no task/gate credit is added. |
| 2026-09-26T22:59:41+02:00 | C6 repaired cutover integrated with current main | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Current `origin/main` `a18728b2b2ef20d9ac5f6f568647a23263db51ce` was merged without conflict after the repair checkpoint. The exact integrated tree again passes 161 focused tests with four opt-in PostgreSQL tests skipped, targeted ESLint, recursive RLS scan (552/0), event assets, runner policy (37 workflows) and diff whitespace using an exact-lock dependency cache. Current delivery policy intentionally has five GitHub checks and no `agent-review` status; the task-specific independent complete-diff rereview remains mandatory and has not yet run. No task/gate credit is added. |
| 2026-09-26T23:30:18+02:00 | C6 global idempotency-fence review repair | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | The second complete-diff independent review returned RED with three P2 cross-case races: employee response ids, HR request client ids and decision operation ids are globally unique outside one case stream. Exact uniqueness-key advisory fences now precede replay reads; residual decision/response `P2002` paths roll back as controlled conflicts without querying an aborted PostgreSQL transaction. Eight focused files pass 173 tests; seven opt-in PostgreSQL tests (including three new observed-wait cross-case proofs) skip locally and remain blocking in PR/deploy CI. ESLint, recursive RLS scan (552/0), event assets, runner policy (37 workflows) and diff whitespace pass. `origin/main` has since advanced to `13277465d731cdfc106e7942c0a2b97ffa38d0b5`; integration, repeated gates and a new zero-finding review remain open. Terminal actions stay fenced and no task/gate credit is added. |
| 2026-09-26T23:33:14+02:00 | C6 global-key repair integrated with latest main | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Repair checkpoint `49c92cbe2` was followed by a conflict-free merge of current `origin/main` `13277465d731cdfc106e7942c0a2b97ffa38d0b5` as `47c3d55a56e9755e7893a58a431fc5ce582aeaef`. On that exact integrated source tree, eight focused files again pass 173 tests with seven PostgreSQL cases locally skipped; targeted ESLint, recursive RLS scan (552/0), event assets, runner policy (37 workflows) and diff whitespace pass. Full local typecheck/build/browser/Android/load remain NOT RUN; a newly frozen complete diff still requires zero-finding author-independent review and all five exact-head CI checks. Terminal actions remain fenced and no task/gate credit is added. |
| 2026-09-26T23:55:24+02:00 | C6 shared-lock complete-tree rereview GREEN | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Author-independent review of base `13277465d731cdfc106e7942c0a2b97ffa38d0b5` through head `632ecdf77e6a43e01090bbfe43f0d6bfd3fd97d2` returned GREEN with zero findings. The frozen 22-file / 155,648-byte diff had SHA-256 `712ff622dd7c0ebf86127740ba099f65bab6218c0cb9d8cbe0ed94a15dbe4330`; all six repair groups, lock graph, tenant/grant/resource revalidation, replay/mismatch semantics, PostgreSQL proof fidelity and blocking CI wiring were confirmed. Five exact-head GitHub checks and real PostgreSQL execution remain open; no task/gate credit is added, and no retired `agent-review` status will be published. |
| 2026-09-27T00:01:01+02:00 | C6 reviewed cutover integrated with MTM #449/#450 | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | `origin/main` advanced to `aaeff0dccd2437aa3bba37f74dccf60ff1e46b98` through unrelated MTM analytics/naming work and merged without conflict as `4ee5aad896ca463034b6ca47dc7d657bb8b19d55`. Relative to the new base, the reviewed task diff remained byte-identical (`3b77be90af7641db0e10e44cea3dd73c32db226acfcb2fc3c99b436dd46f7dd7`, 159,190 bytes, 22 files). Eight focused files again pass 173 tests / seven local PostgreSQL skips; ESLint, RLS 552/0, assets 27/86/5, runner 37, diff and 23,582-key RU/AZ i18n parity pass. Exact identity confirmation and five CI checks remain open; no credit is added. |
| 2026-09-27T00:32:38+02:00 | PR #451 exact-head type payload repair | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Exact head `881ae07a42df09bde44ee59aacd5863354894da2` passed `pr-scope`, `static-checks` (including all seven real PostgreSQL races), `runner-policy` and `scan`. `typecheck` correctly blocked merge because `typeof existing` was evaluated inside the already-narrowed `else` branch and typed the post-case-lock replay as `null`, adding one TS2322 and one TS2339 defect pair in mobile sync. A checked shared `MtmHrmRequestSelect` and exact `GetPayload` now preserve the intended selected-row type without changing runtime behavior, locks or gates. Two focused files / six tests and route ESLint pass; fresh independent review and all five replacement exact-head checks remain mandatory. No task/gate credit is added. |
| 2026-09-27T00:43:58+02:00 | PR #451 repaired complete-diff review GREEN | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Fresh author-independent review of base/merge-base `aaeff0dccd2437aa3bba37f74dccf60ff1e46b98` through repaired head `167cbc68f4e210ca4bdca38a9b1ab5a37de3c793` returned GREEN with zero findings. The frozen 22-file / 168,276-byte binary diff had SHA-256 `1120175a486278b0a1e24a715ea4c25ee63f22003ea6eb6fbb228305b346abed`; the reviewer reconfirmed the exact payload repair, unchanged runtime projection/replay/lock sequence, acyclic writer lock graph, tenant/grant/resource revalidation and exact old-run failure evidence. Replacement exact-head CI remains mandatory; no task/gate credit is added. |
| 2026-09-27T01:33:47+02:00 | PR #451 reviewed production release | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Receipt-integrity review kept the frozen source/workflow patch byte-identical, and exact head `d1bbecc0422dc00d67f385c3ee9190066286bf05` passed the five required contexts: `pr-scope`, `static-checks`, `typecheck`, `runner-policy` and `scan`; `static-checks` executed all seven real PostgreSQL shared-lock races. PR #451 merged normally as `fdc601599b048734409a1359863ede382d08e768`. Deploy run `36278500513` passed quality/security, standalone build, SHA-bound artifact publication, atomic production deployment, scheduler/tenant-isolation checks and all post-deploy smoke. An independent public read at `2026-09-26T23:33:47Z` returned ping HTTP 200/`{"ok":true}` and build-info HTTP 200 with exact `artifactSha=fdc601599b048734409a1359863ede382d08e768`. The cutover is released, but terminal resolution/reopen remain separately fenced; progress stays `81/161` and `14/15`, with physical-device/load/pilot evidence still `NOT RUN`. |
| 2026-09-27T02:32:30+02:00 | C6 case-local lifecycle revision cutover (pre-review) | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | [`Case-revision evidence`](./workforce-c6-case-revision-cutover-evidence-2026-09-27.md): decision, response and linked-request lifecycle ordering now uses a monotonic revision allocated under the canonical case lock instead of client or transaction-start timestamps. A review finding replaced the first long `ACCESS EXCLUSIVE` migration with bounded expand/backfill/concurrent-index/validate phases that never disable the append-only guard; the exact-PG harness now applies SQL through a production-like `NOSUPERUSER + BYPASSRLS` owner-member under FORCE RLS. Focused evidence passes 13 files / 231 tests, targeted ESLint, Prisma validate and diff whitespace; 11 PostgreSQL cases, generated-client typecheck and full build remain NOT RUN locally and mandatory in CI. Independent complete-diff review is open. Terminal actions/UI/activation remain fenced, so no task or gate credit is added. |
| 2026-09-27T03:05:12+02:00 | C6 frozen-review P1 migration repairs | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | The first frozen independent review returned RED: the deployed timestamp reader could disagree with revision readers during rolling drain/rollback, and one multi-phase Prisma ledger row was not safely replayable after a later timeout. The repair uses a case-lock timestamp/revision bridge for old decision/response/request writers, including the expand-before-backfill window, and four separately tracked atomic/restartable migrations. The exact-PG harness now drives real `prisma migrate deploy`, forces a failed index ledger plus invalid index, resolves it and replays to four successes. Twelve selected files pass 226 tests; the 11-case PostgreSQL file is `NOT RUN` locally without an approved URL; ESLint and Prisma validate pass. Replacement frozen review and five exact-head CI contexts remain mandatory. No terminal action/UI/tenant activation or task/gate credit is introduced. |
| 2026-09-27T03:09:24+02:00 | C6 migration-proof fidelity correction | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | A separate pre-freeze read-only audit confirmed both P1 repairs and found one P2 in the proof fixture: decision `createdAt` used `TIMESTAMPTZ` while production uses `TIMESTAMP(3)`. The fixture now matches production exactly and the audit rereview reports zero remaining findings. The 13-file focused selection again passes 226 tests with 11 real-PostgreSQL cases locally skipped; fixture ESLint and diff whitespace pass. This is not the mandatory post-checkpoint frozen complete-diff review, adds no credit and changes no runtime behavior, terminal surface or tenant state. |
| 2026-09-27T03:11:48+02:00 | C6 repaired cutover pre-checkpoint gates | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | The repaired working tree passes the full permitted local slice: 12 files / 226 tests, targeted ESLint, Prisma validate, recursive RLS 552/0, runner policy for 37 workflows, event assets 27/86/5, main-protection configurator and diff whitespace. The 11-case disposable-PostgreSQL file, Prisma generate, broad typecheck/build, browser, Android, load, physical device and pilot remain `NOT RUN` locally and cannot add credit. A clean checkpoint, frozen complete-diff review and the five exact-head GitHub contexts are still required before merge. |
| 2026-09-27T03:26:29+02:00 | C6 first replacement frozen review P3 repair | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Independent review verified the exact clean 32-file / 188,429-byte identity and found no P0–P2, but correctly returned RED for one P3 evidence defect: the document transposed employee-response `createdAt` and correction-request `submittedAt` and attributed client origin to the wrong signal. The text now reflects the production schema; runtime, migration and tests are unchanged. A new checkpoint/identity and zero-finding rereview remain mandatory, so no review or progress credit is inherited. |
| 2026-09-27T03:36:57+02:00 | C6 replacement complete-diff rereview GREEN | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Fresh author-independent review of clean base/merge-base `fdc601599b048734409a1359863ede382d08e768` through head `55e0b12aa51766375c7f587f5930b9f841cb7310` returned GREEN with zero P0–P3 findings. The complete 32-file / 191,101-byte binary diff had SHA-256 `0cb01f3e46e39e3fa430d8a186a0ca9495f8a0550a1973846008a6fdff73b809`; both P1 repairs, the `TIMESTAMP(3)` fixture and corrected response/request evidence were reconfirmed. Reviewer-side Prisma validate and 226 tests pass; 11 PostgreSQL cases remain mandatory in CI. This receipt still needs docs-only integrity confirmation and all five exact-head contexts; no task/gate credit is added. |
| 2026-09-27T03:54:17+02:00 | PR #452 Prisma-ledger baseline repair | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Receipt integrity was GREEN and PR #452 exact head `9e60bce04b5303d7c742ed69c16c26f4b8331048` passed `pr-scope`, `runner-policy` and `scan`. `static-checks` correctly failed the real-PostgreSQL harness with Prisma `P3005`: the fixture pre-created a non-empty production-like schema but omitted the already-existing migration ledger that production has. The repair registers one test-only no-op baseline through `prisma migrate resolve --applied`, then still deploys and verifies all four exact migrations plus failed-index recovery. The 13-file local selection passes 226 tests / 11 PG skips and exact-test ESLint. Fresh review and all five replacement head checks remain mandatory; no gate or progress credit is added. |
| 2026-09-27T04:05:54+02:00 | PR #452 baseline-repair complete-diff review GREEN | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Fresh author-independent review of clean repaired head `576cdf62027120ad37c311eca379cffa4a495754` returned GREEN with zero P0–P3 findings. The complete 32-file / 199,903-byte diff from base/merge-base `fdc601599b048734409a1359863ede382d08e768` had SHA-256 `e494fb92be01589e60bb89d611ac6080cb7e1d3305b251f69046d841ad6eb2d2`. Runtime/revision invariants, four migrations, prior findings and exact P3005 baseline/failure-replay proof were reconfirmed; reviewer-side Prisma validate, 226 tests and ESLint pass. Old head typecheck passed but cannot transfer. Receipt integrity and five replacement exact-head contexts remain required; no progress credit is added. |
| 2026-09-27T04:29:17+02:00 | PR #452 implicit-transaction index repair | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Exact head `cdddfb507d17c38b767f5f7341ed0791d6763170` passed `pr-scope`, `typecheck` (17m23s), `runner-policy` and `scan`, but `static-checks` correctly blocked merge. PostgreSQL proved that Prisma submitted the multi-statement index migration in an implicit transaction and rejected its first `DROP INDEX CONCURRENTLY`; the test's expected invalid index could therefore never exist. The repair uses one atomic ordinary-index phase under the deploy quiet window, refuses either heap above 64 MiB, bounds lock acquisition/execution to 3s/2min, and strengthens the real-PG gate to require exact `23505`, zero rollback artifacts and two exact valid/ready indexes after replay. Local evidence passes 226 tests / 11 PG skips, two-file ESLint and Prisma validate. A production size read was `NOT RUN` because the registered SSH key was rejected; the in-migration size fence is mandatory. Fresh review and all five replacement contexts remain required; no terminal action/UI/activation or progress credit is added. |
| 2026-09-27T04:49:11+02:00 | PR #452 blocking-index P2 repair | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Frozen review of unpushed head `77257d11656506c201ac445bcb6e2b39f4c48fe3` returned RED with one P2: the ordinary index transaction violated the migration runbook because the live app was not explicitly drained, the quiet-window was only a momentary sample, and the per-statement timeout did not bound the whole write-conflicting phase. The replacement uses two separately tracked, exactly one-statement `CREATE INDEX CONCURRENTLY` migrations. The real-PG harness must prove the unique build leaves one exact invalid index on `23505`, clean it with standalone `DROP INDEX CONCURRENTLY` as the production-like migration role, resolve only that ledger row and replay five target migrations to two exact valid/ready indexes. Local and real-PG gates plus fresh review remain pending for this repair; no progress credit is added. |
| 2026-09-27T04:55:00+02:00 | PR #452 online-index local gate | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | The two exactly-one-statement concurrent index migrations and exact invalid-index recovery passed the complete small local gate: 12 dependency-backed files / 226 tests passed, the 11 opt-in real-PostgreSQL cases were `SKIPPED / NOT RUN`, both changed test files passed ESLint, Prisma validation passed, RLS context scan reported 552 organization models / 0 gaps, runner policy passed 37 workflows, event assets passed 27 domains / 86 topics / 5 schemas, branch-protection configuration tests passed and `git diff --check` passed. Real PostgreSQL, full typecheck/build, browser E2E, Android, load, physical-device and pilot evidence remain `NOT RUN` locally. A new checkpoint identity and fresh full-diff review are still mandatory; no progress credit is added. |
| 2026-09-27T05:13:25+02:00 | PR #452 online-index full-diff review GREEN | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Fresh author-independent review of frozen clean head `e7efdab38992abe28660b0527c9f74362b706074` returned GREEN with zero P0-P3 findings. The full diff from base/merge-base `fdc601599b048734409a1359863ede382d08e768` was 33 files / 225,549 bytes, SHA-256 `b3d5d57e4a70f42474db9f6957e9a5afc97fa038094b6361b73569fbfb55e03c`. The reviewer checked the complete runtime, tenant/RLS/auth, idempotency, revision/terminal fences, five migrations, prior P3005/25001 repairs and exact `23505` invalid-index cleanup/replay proof. Reviewer-side diff, runner, RLS, event-asset, protection and identity checks passed; real PostgreSQL and heavy gates remain NOT RUN reviewer-side. Receipt integrity and all five replacement exact-head GitHub contexts remain mandatory; no progress credit is added. |
| 2026-09-27T05:38:10+02:00 | PR #452 exact-PG GREEN; C13 contract repair | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Exact head `405342e648e397d5b1ce7bfe4c305ae0f1f659ff` passed `pr-scope`, `typecheck` (16m45s), `runner-policy` and `scan`; its real-PostgreSQL Workforce migration/recovery step also passed, proving the two one-statement concurrent index phases and exact failed-index replay. `static-checks` later failed because the existing C13 source contract rejected every lexical top-level `UPDATE`, including the intentional deterministic `caseRevision` structural backfill. The repair does not update the failure baseline or permit a general class: every other Workforce migration remains UPDATE-free, while the one exact named phase must satisfy positive target/order/NULL-only/transaction/timeout/owner/all-other-column/append-only invariants. The C13 ADR records why this structural ordinal is not fabricated historical assurance. The repaired 14-file selection passes 234 tests / 11 PG skips and targeted ESLint. Fresh review, receipt integrity and all five replacement contexts remain mandatory; no progress credit is added. |
| 2026-09-27T05:52:30+02:00 | PR #452 C13-repair full-diff review GREEN | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Fresh author-independent review of clean repaired head `f91a52197c2329e46e02f8df7b4ce2309e1dfd88` returned GREEN with zero P0-P3 findings. The full diff from base/merge-base `fdc601599b048734409a1359863ede382d08e768` was 35 files / 244,953 bytes, SHA-256 `d0486bb6f8a57180c670b82e52154453bf40cd97fbcb3b5483aec0b0edbe3838`. The reviewer confirmed the one exact structural-revision UPDATE is positively fenced rather than generally allowlisted, every other Workforce migration remains UPDATE-free, and the complete tenant/RLS/idempotency/revision/terminal/five-phase/P3005/25001/23505 contract remains sound. Reviewer-side diff, runner, RLS, event-asset, protection and identity checks passed. Receipt integrity and five replacement exact-head contexts remain mandatory; no progress credit is added. |
| 2026-09-27T06:45:32+02:00 | PR #452 reviewed production release | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Final receipt-integrity review kept the independently reviewed source patch unchanged at head `5df8f602b4ad6a8fa43dcd886db2f15f92a1aaf8`, and all five exact-head contexts passed, including the real-PostgreSQL five-phase recovery proof. PR #452 merged normally as `249466e9ac25eccecefc34b62563b328a8026817`; deploy run `36293964083` completed quality/security, standalone build, immutable artifact, atomic production swap, scheduler/tenant-isolation checks and public smokes. Independent reads returned ping `{"ok":true}` and exact `artifactSha=249466e9ac25eccecefc34b62563b328a8026817`. Terminal actions/UI/tenant activation remain fenced and physical-device/load/pilot evidence remains `NOT RUN`, so no task or gate credit is added. The next bounded slice is an entirely inactive exception-policy revision foundation. |
| 2026-09-27T07:14:34+02:00 | C6 inactive policy-revision foundation (pre-review) | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | [`Policy-revision evidence`](./workforce-c6-exception-policy-revision-foundation-evidence-2026-09-27.md): the exact owner-approved `recommended-v1` draft now has a pinned canonical hash, fail-closed pure resolver, empty append-only FORCE-RLS provenance ledger and nullable tenant-bound decision link. No seed, writer, route, provisioning, tenant activation, terminal action or UI consumes it. Four local files pass 32 tests, targeted ESLint, Prisma validate, RLS 553/0, runner 37 and assets 27/86/5; four exact PostgreSQL cases and every heavy/physical gate are `NOT RUN` locally. Frozen independent review and exact-head CI remain mandatory, so no task/gate credit is added. |
| 2026-09-27T07:30:47+02:00 | C6 policy-revision first review P2 repair | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Independent review of frozen head `d12e51ca1e1e63152750724b535b8c639e555d0a` returned RED with one P2: the live decision-table nullable-column/FK lock was acquired before unrelated new-ledger DDL and retained until transaction commit. Both live ALTERs now run in the final pre-`COMMIT` block, with a positive source-order guard. The focused 32 tests / four PG skips, ESLint and Prisma validate pass again; replacement full review and all exact-head CI contexts remain mandatory. No behavior, tenant state, task or gate credit is added. |
| 2026-09-27T07:34:30+02:00 | C6 policy-revision replacement review GREEN | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Fresh author-independent review of clean head `3561a08877d1c865a3240cc06e000d5f604ebe5c` returned GREEN with zero P0–P3 findings. The full diff from base/merge-base `249466e9ac25eccecefc34b62563b328a8026817` is 14 files / 79,022 bytes, SHA-256 `88375445e73dfb2bb0fb6cd9efb81e7f672d988ca93af25c9dc40b662f2788bb`. The repaired final pre-commit ALTER order plus dormant/hash/resolver/tenant/RLS/append-only/rollback/PG-workflow boundaries were reconfirmed. Receipt integrity and all five exact-head contexts remain mandatory; no progress credit is added. |
| 2026-09-27T08:34:31+02:00 | PR #453 fail-closed typecheck capacity repair review GREEN | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Head `31e43ea48bcbd0dd7ba37a6e9a0c77b431eb9ed5` passed `pr-scope`, exact PostgreSQL-backed `static-checks`, `runner-policy` and `scan`, but two full `typecheck` attempts reproducibly exited 134 at the former 11,264-MiB heap ceiling; merge was not attempted. The bounded repair raises only the unchanged full-compiler step to 12,288 MiB and adds a contract assertion preserving its exact command, real-exit capture and both blocking gates. Fresh independent review of clean head `44ef9df0efd3bc3593378995269bca3cb9eaa2a6` returned GREEN/zero P0–P3 for the complete 15-file / 85,293-byte diff, SHA-256 `630559d59268f9863f01670e5a244d3adc96f75e9e02cf8b33c8911fba07be54`. Receipt integrity and five replacement exact-head contexts remain mandatory; no progress credit is added. |
| 2026-09-27T09:22:31+02:00 | PR #453 reviewed production release | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Receipt-integrity review kept the independently reviewed patch unchanged at final head `732a4fe053d5e4e8e2af870766640953e7b5a613`. All five exact-head contexts passed; `static-checks` repeated the exact PostgreSQL proof and repaired `typecheck` completed in 16m21s with both blockers green. PR #453 merged normally as `330da758f9a5af22da5e6a33795530547e7e4f85`; deploy run `36301608281` completed quality/security, standalone build, immutable artifact, atomic production deploy and workflow smoke. Independent no-cache reads returned ping `{"ok":true}` and exact `artifactSha=330da758f9a5af22da5e6a33795530547e7e4f85`. The foundation remains inactive, so no progress credit is added; next is a separate read-only-preflighted FK validation phase. |
| 2026-09-27T09:38:40+02:00 | C6 policy-revision FK validation (pre-review) | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | [`FK validation evidence`](./workforce-c6-exception-policy-revision-validation-evidence-2026-09-27.md): a separate migration contains only one exact `VALIDATE CONSTRAINT` inside a 3s-lock/2min-statement bounded transaction; no DML, writer, consumer, activation or UI is added. The two-phase Prisma harness now requires the foundation to be initially unvalidated, inserts a valid tenant-bound link, then requires validation, two successful target ledger rows, unchanged full row snapshots, old-binary compatibility and tenant/RLS/append-only invariants. Local source/C13 tests pass 13 tests; five PostgreSQL tests remain `SKIPPED / NOT RUN` locally. Registered production SSH rejected its key, so live catalog/size preflight is explicitly `NOT RUN`; the migration fails closed. Review and exact-head CI remain mandatory; no progress credit is added. |
| 2026-09-27T09:49:37+02:00 | C6 policy-revision FK validation complete-diff review GREEN | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Fresh author-independent review verified clean base/merge-base `330da758f9a5af22da5e6a33795530547e7e4f85`, head `c1bb838c22d079486207a6463bfa17f286314a6e`, seven files / 37,911 bytes and SHA-256 `6047e13f0f9c1f6fc8b8c88463dd79ff290b97d22394a3ed3ffc6b48729b08d7`, then returned GREEN with zero P0-P3 findings. Atomic timeout/replay behavior, two-phase Prisma proof, tenant/RLS/grant/append-only invariants, honest production preflight `NOT RUN` and the no-writer/no-consumer/no-activation boundary were confirmed. Reviewer-side exact PostgreSQL was `NOT RUN`; receipt integrity and all five exact-head CI contexts remain mandatory. No progress credit is added. |
| 2026-09-27T10:34:57+02:00 | PR #454 reviewed FK validation production release | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Receipt integrity kept the source-reviewed migration/tests unchanged and returned GREEN with zero P0-P3 findings. Final head `0f392a2a0aa4a1a22a8418d8063c6b02e093ad72` passed all five exact-head contexts; real PostgreSQL proved both Prisma phases and the validated tenant key. PR #454 merged normally as `0a71fc31967adc2683b6f481f59e516e71ed111c`; deploy run `36305282373` completed quality/security, SHA-bound standalone build, atomic migration/deploy and workflow smokes. Independent no-cache reads returned ping `{"ok":true}` and exact `artifactSha=0a71fc31967adc2683b6f481f59e516e71ed111c`. The validation adds no writer, tenant activation, terminal behavior, UI, task or gate credit; physical/browser/load/pilot evidence remains `NOT RUN`. |
| 2026-09-27T10:50:48+02:00 | C6 dormant policy-revision writer (pre-review) | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | [`Dormant writer evidence`](./workforce-c6-exception-policy-revision-writer-evidence-2026-09-27.md): a transaction-scoped primitive can append only the exact server-pinned `recommended-v1` acknowledgement after injected tenant-wide authorization, under one organization advisory lock, complete fail-closed stream validation, a 64-row bound and exact operation replay. No route, provisioning, activation, decision link, terminal action or UI imports it. Local resolver/writer/source contracts pass 28 tests, C13 passes 8, targeted ESLint passes and six exact-PostgreSQL cases remain `SKIPPED / NOT RUN` without an approved local URL. Frozen independent review and exact-head CI remain mandatory; no progress credit is added. |
| 2026-09-27T10:56:29+02:00 | C6 writer PG-harness P2 repair | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Early independent preflight found one P2 in the test harness: an assertion could run before releasing the deliberately held first transaction and strand both PostgreSQL transactions until timeout. The repair captures the observation, releases the hold unconditionally in `finally`, settles both transactions, then asserts. The five-file focused selection now passes 36 tests with six exact-PostgreSQL cases `SKIPPED / NOT RUN`; targeted ESLint and diff whitespace pass. Preflight rereview, clean checkpoint and fresh frozen complete-diff review remain mandatory; no runtime behavior or progress credit changes. |
| 2026-09-27T11:01:29+02:00 | C6 writer integrated with current main | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | `origin/main` advanced through unrelated MTM compact-filter PR #455 to `4e5afe8da053c187e5070fbedd157ade9382817b`; its six UI/i18n paths do not overlap the nine-path C6 slice and merged without conflict. The prior frozen identity was withdrawn. On the integrated tree, 36 focused tests pass / six real-PG cases remain `SKIPPED / NOT RUN`; ESLint, Prisma, RLS 553/0, runner 37, assets 27/86/5, protection, diff and i18n 23,587/0/0 pass. A replacement checkpoint and fresh complete-diff review remain mandatory; no progress credit is added. |
| 2026-09-27T11:12:42+02:00 | C6 writer frozen complete-diff review GREEN | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Fresh author-independent review of clean base/current main `4e5afe8da053c187e5070fbedd157ade9382817b` through head `db506b51a4e8c20b2a94524fdb5d00ac14b12755` returned GREEN with zero P0-P3 findings. The complete nine-path / 61,305-byte binary diff had SHA-256 `f74233dfe5827c5b0eaeefca31a16f3cd43b98bae8b2914faa9e2bb73cb2892a`; tenant/auth/RLS, exact pinned payload, bounded full stream, replay/conflict/P2002, lock/concurrency, PG cleanup, no-consumer/activation and evidence truth were reconfirmed. Receipt integrity and all five exact-head contexts remain mandatory; no progress credit is added. |
| 2026-09-27T11:56:30+02:00 | PR #457 reviewed dormant writer production release | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Receipt integrity kept the independently reviewed runtime/tests unchanged at final head `0fec9ebc9075a3078cbc0de4c77ae17f6d68957a`. All five exact-head contexts passed; `static-checks` ran all six real-PostgreSQL policy-revision cases and `typecheck` passed. PR #457 merged normally as `99b8ce27077352951769ce4a8c60cf2459e36ebf`; deploy run `36309895996` completed quality/security, SHA-bound standalone build, immutable artifact, atomic production deploy, built-in smoke and retention cleanup. Independent no-cache reads returned ping `{"ok":true}` and exact `artifactSha=99b8ce27077352951769ce4a8c60cf2459e36ebf`. The writer remains uninvoked, so no activation, decision link, terminal behavior, UI, task or gate credit is added. Independent comparison selected a session-only, operation-ID-only tenant acknowledgement POST as the next bounded slice; provisioner, activation/effective windows, decision linkage, terminal actions, UI and backfill remain fenced. |
| 2026-09-27T12:15:12+02:00 | C6 session-only policy acknowledgement API (pre-review) | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | [`Session API evidence`](./workforce-c6-exception-policy-revision-session-api-evidence-2026-09-27.md): one strict operation-ID-only POST now derives tenant/actor from the authenticated policy-configuration session, opens the tenant-RLS transaction and calls the released writer with exact operation/org/actor authorization. It returns only revision/idempotency with private no-store containment and remains unable to activate/select policy or touch decisions. Early review found and repaired one P2 raw-error logging leak; fixed-label logging and its no-secret response/log test received zero-finding rereview. Five focused files pass 67 tests; six exact-PG cases remain `SKIPPED / NOT RUN` locally. ESLint, Prisma, RLS 553/0, runner 37, assets 27/86/5, protection, i18n 23,587/0/0 and diff pass. Frozen review/exact-head CI remain mandatory; no progress credit is added. |
| 2026-09-27T12:30:09+02:00 | C6 session API frozen complete-diff review GREEN | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Fresh author-independent review of clean base/current main `99b8ce27077352951769ce4a8c60cf2459e36ebf` through head `9b6721af465d9655ed314fc018d4d7c6c636d14f` returned GREEN with zero P0-P3 findings. The complete nine-path / 44,748-byte binary diff had SHA-256 `a54dcb6ac31378ddacb129740a0dd41a663bf0283c29a3601d78ffd02983eca6`; release evidence, session/capability/granular auth, tenant RLS, actor FK, exact writer binding, strict input, replay, minimized outputs/logs, errors, exact consumer allowlist and all activation/decision/provisioner/UI/backfill fences were reconfirmed. Receipt integrity and five exact-head contexts remain mandatory; no progress credit is added. |
| 2026-09-27T13:15:35+02:00 | PR #458 reviewed session API production release | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Receipt integrity kept all five reviewed source/test blobs byte-identical and returned GREEN with zero P0-P3 findings at final head `22ea9c0c4dd203f0d9991d5a4409146795db86b9`. All five exact-head contexts passed; `static-checks` ran all six real-PostgreSQL policy-revision cases and `typecheck` passed in 14m21s. PR #458 merged normally as `a78fa409888fb319fab2a049f86fa299212cd3aa`; deploy run `36313824867` completed quality/security, SHA-bound standalone build, immutable staging, atomic production deploy, built-in smoke and retention cleanup. Independent no-cache reads returned ping `{"ok":true}` and exact `artifactSha=a78fa409888fb319fab2a049f86fa299212cd3aa`. The acknowledgement remains draft-only and earns no progress credit; browser, Android, load, physical and pilot gates remain `NOT RUN`. The next bounded slice is a minimized read-only draft-receipt GET with no active/current/effective claim, history, selector, write or lock. |
| 2026-09-27T13:32:54+02:00 | C6 draft-receipt GET (pre-review) | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | [`Draft-receipt GET evidence`](./workforce-c6-exception-policy-revision-read-api-evidence-2026-09-27.md): the same session-policy route now reports only exact root `{state:"NOT_RECORDED"}` or `{state:"RECORDED_DRAFT",revision}` receipts from an explicit session-tenant, ascending, bounded complete stream resolved by the released pure resolver. It exposes no history/policy/actor metadata and makes no active/current/effective claim, transaction, lock or write. Early review found and repaired one P2 wrapper containment gap and one P1 extra success-envelope contract; replacement narrow rereview is GREEN with zero remaining P0-P3 findings. Six focused files pass 89 tests; six exact-PG cases remain `SKIPPED / NOT RUN` locally. ESLint, Prisma, RLS 553/0, runner 37, assets 27/86/5, protection, i18n 23,587/0/0 and diff pass. Frozen review and exact-head CI remain mandatory; no progress credit is added. |
| 2026-09-27T13:35:19+02:00 | C6 draft-receipt implementation checkpoint clean | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Release receipt plus GET runtime/tests/evidence are checkpointed through `e76407def5a2abdc84a0b80058de3fb3d4686fc8`; fresh fetch kept base/merge-base/current main at deployed `a78fa409888fb319fab2a049f86fa299212cd3aa`. Preliminary complete diff: 11 paths / 46,989 bytes, SHA-256 `6ee85938cc40c1c057e6c96a6c2b8c698786a2b3aeb9309db0f5e2a18d00a2f8`. This status receipt supersedes that identity; a replacement clean head and author-independent complete-diff review remain mandatory. No progress credit is added. |
| 2026-09-27T13:58:35+02:00 | C6 draft-receipt frozen complete-diff review GREEN | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Fresh author-independent review from zero verified clean base/current main `a78fa409888fb319fab2a049f86fa299212cd3aa` through head `441e1f76d4f161b6025a9cce66713a74f1920c33` and returned GREEN with zero P0-P3 findings. The complete 11-path / 49,672-byte diff had SHA-256 `8828a616b87df2f3ed89bfd3ce95a4d074945dd41a428eb5197cd01fd9499a67`; PR #458 receipt, exact receipt payloads, session/granular auth, tenant RLS, complete bounded resolver stream, no-write GET, containment, wrapper compatibility, consumer fence and all exclusions were reconfirmed. Reviewer-side diff, RLS 553/0, runner 37, assets 27/86/5, protection, i18n 23,587/0/0 and consumer scans passed. Receipt integrity and all five exact-head contexts remain mandatory; no progress credit is added. |
| 2026-09-27T14:51:49+02:00 | PR #459 reviewed draft-receipt GET production release | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Receipt integrity kept all seven reviewed runtime/test blobs byte-identical and returned GREEN with zero P0-P3 findings at final head `fbd0eedf76a08244d79a4c28966ac03b15d21ca2`. All five exact-head contexts passed; `static-checks` passed both real-PostgreSQL shared-lock files / 17 tests including all six revision cases, and `typecheck` passed in 17m17s. PR #459 merged normally as `86fc1d2c23fead588b45c2e700e125a6d98bbe82`; deploy run `36318896243` completed quality/security, SHA-bound standalone build, immutable staging, atomic production deploy, built-in smoke and retention cleanup. Independent no-cache reads returned ping `{"ok":true}` and exact `artifactSha=86fc1d2c23fead588b45c2e700e125a6d98bbe82`. The root-only status receipt remains draft-only and earns no progress credit; browser, Android, load, physical and pilot gates remain `NOT RUN`. |
| 2026-09-27T15:12:23+02:00 | C6/C8 scoped acknowledgement UI (pre-review) | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | [`Acknowledgement UI evidence`](./workforce-c6-exception-acknowledgement-ui-evidence-2026-09-27.md): the existing exception queue now offers a two-step, 44-pixel `ACKNOWLEDGE` control only when the server supplies an exact scoped token. The token/UUID stay in memory; the minimized POST uses a fixed privacy-safe reason, verifies the returned action and safely replays an uncertain request. Request/correction/terminal/unknown codes remain hidden, no free text is collected and the action cannot resolve, notify or change attendance/pay/discipline. Eight focused files pass 53 tests, targeted ESLint and i18n 23,600/0/0 pass. WF-C8-005 moves `PLANNED` to `PARTIAL`; no DONE/gate credit is added. Frozen review, exact-head CI and real browser evidence remain mandatory. |
| 2026-09-27T15:17:22+02:00 | C6/C8 acknowledgement UI checkpoint clean | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Implementation/test/evidence is checkpointed through `02c795f702b1ef4b22c89377a1cb9111b2f8dbd8`; fresh fetch kept base/merge-base/current main at deployed `86fc1d2c23fead588b45c2e700e125a6d98bbe82`. Preliminary complete diff including the PR #459 release receipt: nine paths / 72,880 bytes, SHA-256 `9a86e899d0a1ff6ba40b0198eda44e910e5b7d80e2dc36b786654214220eaacb`, below 400 KB. This status receipt supersedes that identity; replacement clean head and zero-finding author-independent complete-diff review remain mandatory. No task/gate credit is added. |
| 2026-09-27T15:28:50+02:00 | C6/C8 acknowledgement UI frozen review P2 repair | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | First frozen review of base/main `86fc1d2c23fead588b45c2e700e125a6d98bbe82` through head `2bb994de07f381bf6a47eef6977dccb749268748` (nine paths / 76,058 bytes, SHA-256 `d83e6a0a8c9b56f0728617c1c87070debfbe0e0a2516853c5f4aff43322cba0e`) returned RED with one P2 and no P0/P1/P3: a pending trigger switch/reopen could lose the original idempotency UUID. The repair synchronously fences every trigger/refresh/cancel, caches one UUID per token and applies async results only to the exact token/org/request. Deferred cross-row and close/reopen replay coverage brings the related selection to 8 files / 54 tests; targeted ESLint passes. The rejected review does not transfer; a new checkpoint and fresh complete rereview remain mandatory. |
| 2026-09-27T15:43:19+02:00 | C6/C8 acknowledgement UI replacement review P1 repair | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Replacement review of clean head `c3aac962ff55fab9107e08852c1de1c190e9029b` (nine paths / 85,303 bytes, SHA-256 `8f4a7e8c9f3259aefecf6a2e5a809e49c94e5043ef27cc453adadcdccfc52bee`) returned RED with one P1 and no other P0-P3: direct `onClick={closeAction}` treated the React event as the internal truthy force flag, making the handler type-invalid and allowing a same-tick cancel to bypass the pending ref fence. The bounded repair wraps the click without a force argument and extends the deferred test to attempt cancel and cross-row selection in the same batch before disabled rendering. Prior review/checks do not transfer; focused checks, a replacement checkpoint and zero-finding complete rereview remain mandatory. No task/gate credit is added. |
| 2026-09-27T15:48:32+02:00 | C6/C8 acknowledgement UI cancel-fence checkpoint | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | P1 repair and RED receipt are checkpointed as `93be88a5b1615a2f35ff002dc1a993dacb4ed9a2`; same-tick interaction 7/7, the related 8-file / 54-test selection, targeted ESLint, i18n 23,600/0/0 and diff whitespace pass. Fresh main remains deployed `86fc1d2c23fead588b45c2e700e125a6d98bbe82`; preliminary complete diff is nine paths / 89,448 bytes, SHA-256 `9a81ab3c750b880408974a9f9cf0835905fd346d83d62fa43c16cbe7df29f9f7`, below 400 KB. This receipt supersedes that identity; a new clean checkpoint and zero-finding author-independent complete rereview remain mandatory. Full typecheck/build/browser/Android/load/physical/pilot checks are `NOT RUN` locally and no task/gate credit is added. |
| 2026-09-27T15:55:55+02:00 | C6/C8 acknowledgement UI replacement review GREEN | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Fresh author-independent complete-diff review from zero verified clean base/current main `86fc1d2c23fead588b45c2e700e125a6d98bbe82` through head `6c8980995ad86f882d5a1d1b7688aceeb2787bf6` and returned GREEN with zero P0-P3 findings. The complete nine-path / 92,969-byte diff had SHA-256 `439314c91ea7212894dc4d8b5cfec1e7d99285ea103ee773577c46a991be0eb9`; both replay/cancel findings, same-tick refs, strict allowlist, minimized privacy-safe POST, response fences, a11y/i18n, backend authority and evidence truth were reconfirmed. Reviewer-side diff/JSON/parity checks passed; dependency-backed and heavy gates were `NOT RUN`. Receipt integrity and all five exact-head CI contexts remain mandatory; no task/gate credit is added. |
| 2026-09-27T16:52:56+02:00 | PR #460 reviewed acknowledgement UI production release | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Receipt integrity kept the five independently reviewed runtime/test/translation blobs byte-identical at final head `bdc1c73de8b5edcad032732f7b95268515d512ea`; both reviews were GREEN with zero P0-P3. All five exact-head contexts passed: `static-checks` included the real PostgreSQL shared-lock gate and `typecheck` completed in 13m07s. PR #460 merged normally as `4823fa18b07cb9e27128ef8d8e14c07eae9f0e7a`; deploy run `36325162459` completed quality/security, SHA-bound standalone build, immutable staging, atomic deploy, scheduler/tenant-isolation checks, built-in smokes and retention cleanup. Independent no-cache reads returned ping `{"ok":true}` and exact `artifactSha=4823fa18b07cb9e27128ef8d8e14c07eae9f0e7a`. Browser/Android/load/physical/pilot evidence remains `NOT RUN`; no task/gate credit is added. Independent comparison selected only the server-offered non-terminal `REQUEST_TIME_CORRECTION` manager UI as the next safe slice; response/terminal actions remain hidden. |
| 2026-09-27T17:02:32+02:00 | C6/C8 correction-request action UI (pre-review) | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | [`Correction-request UI evidence`](./workforce-c6-exception-correction-request-ui-evidence-2026-09-27.md): the released queue now consumes exactly one server-offered `REQUEST_TIME_CORRECTION` token through the existing two-step, stable-UUID and pending-response fences. The minimized POST carries only token, operation ID and fixed privacy reason; no case ID, decision code, free text or proof is sent. Localized copy explicitly says the immutable review step neither notifies the employee, creates/approves a correction nor changes time. Response, terminal, unknown and malformed multi-action surfaces remain hidden. Focused jsdom passes 8/8, the related selection passes eight files / 55 tests, targeted ESLint, JSON, i18n 23,602/0/0 and diff checks pass. Full typecheck/build/browser/Android/load/physical/pilot remain `NOT RUN`; frozen review and exact-head CI remain mandatory and no task/gate credit is added. |
| 2026-09-27T17:10:13+02:00 | C6/C8 correction-request preflight GREEN | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Author-independent read-only preflight covered `origin/main` `4823fa18b…` through release receipt `2eef7aa…`, all tracked changes and the untracked evidence file: nine paths / 49,312 bytes, SHA-256 `90f85f9104945c347a79ada08c046c88476197aaef43da4ea2dbc7cefc9c3dc8`. It returned GREEN with zero P0-P3 findings and confirmed strict/fail-closed actions, privacy/request/response fences, localized copy and evidence truth. Reviewer-side JSON/whitespace/i18n/scope/production-receipt checks passed; Vitest was `NOT RUN` reviewer-side after module resolution stopped before collection. This is not a frozen verdict; clean checkpoint and a new exact-head complete-diff review remain mandatory. No credit is added. |
| 2026-09-27T17:17:45+02:00 | C6/C8 correction-request frozen review GREEN | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Fresh author-independent review from zero verified clean base/current main/merge-base `4823fa18b07cb9e27128ef8d8e14c07eae9f0e7a` through head `d5e952dca3bedce73fafca94efaf2cc639bf5f00` and returned GREEN with zero P0-P3 findings. The complete nine-path / 53,028-byte diff had SHA-256 `51b5913e3e8a5a0be8b816dd703eb06749f4fef79222065e91ea93e0c401232a`; server authority, exact-one fail-closed behavior, token/UUID/org/pending/async fences, minimized fixed request, strict response validation, recovery, privacy/a11y/i18n and evidence truth were reconfirmed. Reviewer diff/JSON/i18n/lock/release-receipt checks passed; dependency-backed and heavy gates were `NOT RUN`. Receipt integrity and all five exact-head CI contexts remain mandatory; no credit is added. |
| 2026-09-27T18:07:43+02:00 | PR #461 reviewed correction-request UI production release | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Receipt integrity preserved all five reviewed runtime/test/translation blobs byte-identically at final head `6cc6938d6109c73c029c59edbf5f3e3af167869d`; both independent reviews were GREEN with zero P0-P3. All five exact-head contexts passed; `static-checks` included the real PostgreSQL shared-lock gate and completed in 13m05s, while `typecheck` completed in 19m24s. PR #461 merged normally as `000eb2532402cf4860afcb270ea8bfac6a6796d0`; deploy run `36330613672` completed quality/security, SHA-bound standalone build, immutable staging, atomic deploy, scheduler/tenant-isolation checks, built-in smokes and retention cleanup. Independent no-cache reads returned ping `{"ok":true}` and exact `artifactSha=000eb2532402cf4860afcb270ea8bfac6a6796d0`. Browser/Android/load/physical/pilot evidence remains `NOT RUN`; no task/gate credit is added. |
| 2026-09-27T18:20:00+02:00 | C6 employee-response rollout fence (pre-review) | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | [`Response rollout fence evidence`](./workforce-c6-exception-response-rollout-fence-evidence-2026-09-27.md): the manager queue now withholds only `REQUEST_EMPLOYEE_RESPONSE` tokens when the employee channel flag is unavailable, and the decision service rechecks the same fail-closed predicate before case lookup and after the case lock before a new append. ACK/correction behavior and the hidden response UI remain unchanged. Eight focused files pass 59 tests in two sequential selections; targeted ESLint and diff whitespace pass. Full local typecheck/build/browser/Android/load/physical/pilot remain `NOT RUN`; clean checkpoint, frozen independent review and exact-head CI remain mandatory. WF-C6-002/006 stay `PARTIAL`; no task/gate credit is added. |
| 2026-09-27T18:25:45+02:00 | C6 response rollout fence preflight GREEN | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Author-independent preflight of base `316caedc933407589aa5f7a5acffb86aed267b15` plus the full working snapshot (nine paths / 34,671 bytes, SHA-256 `77ca058977501c0abe839a401116db46564e571bb9f697d2cfb9f43da4d2672e`) returned GREEN with zero P0-P3 findings. Token issuance, preflight rejection, post-lock reread/no-new-append, ACK/correction non-regression, token binding and generic containment were confirmed. Reviewer diff/whitespace and pure helper 3/3 passed; API suites were `NOT RUN` reviewer-side after dependency resolution stopped before collection. The READ COMMITTED flag is not claimed as a linearizable emergency kill switch. This pre-commit verdict does not transfer; a clean checkpoint and fresh frozen review remain mandatory. No task/gate credit is added. |
| 2026-09-27T18:31:16+02:00 | C6 response rollout frozen review GREEN | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Fresh author-independent review from zero verified clean base/current main/merge-base `000eb2532402cf4860afcb270ea8bfac6a6796d0` through frozen head `6268f618a027e33beec1ca700a8fe3454eccf0e7` and returned GREEN with zero P0-P3 findings. The complete 10-path / 44,535-byte diff had SHA-256 `c215ff2555c734ddacfc57aee1c2629e686a1d6e436d13aeedc2d11628e44fce`; token mint/preflight/post-lock/replay fences, tenant binding, generic containment, ACK/correction preservation, inherited PR #461 receipt and evidence truth were confirmed. Reviewer identity/clean/diff/append-only checks, helper 3/3 and live release receipt passed; API/lint/heavy gates were `NOT RUN` reviewer-side. Receipt integrity and all exact-head CI contexts remain mandatory; no credit is added. |
| 2026-09-27T18:54:50+02:00 | PR #462 exact-head type-boundary repair | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Exact head `803b56880668e8bbbb56b492f135369ff0e89ff5` passed four required checks, including 13m30s `static-checks` with the real PostgreSQL lock gate, but `typecheck` correctly blocked merge after 16m52s on one new TS2345: the canonical writer callback exposes a string decision code while the response-only rollout helper required the narrower workbench union. The repair accepts the storage-boundary string, still special-cases only exact `REQUEST_EMPLOYEE_RESPONSE`, and proves an unknown/future code remains delegated to the lifecycle validator. Core tests 27/27, targeted ESLint and diff pass. Prior review/check identities do not transfer; checkpoint, fresh independent review and five replacement checks remain mandatory. No task/gate credit is added. |
| 2026-09-27T18:58:55+02:00 | PR #462 repair integrated with current main | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Fresh `origin/main` advanced to `bc126735cc316cfc7f206aae839288884d5a9d5d` through unrelated PR #456 MTM compact-filter work. Its 19 paths had no overlap; current main merged conflict-free as `4ee1655fe1c0c547923b9e7f3c6cd06c31361bc2`. On that exact integrated tree, all eight selected Workforce files pass 59/59 tests, targeted ESLint for all six changed runtime/test files and diff whitespace pass. Full local typecheck/build/heavy gates remain `NOT RUN`; a clean receipt checkpoint, fresh current-base review and all five replacement checks remain mandatory. No task/gate credit is added. |
| 2026-09-27T19:06:32+02:00 | PR #462 replacement frozen review GREEN | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Fresh author-independent review verified clean current base/main/merge-base `bc126735cc316cfc7f206aae839288884d5a9d5d` through head `2711f194d5615c9efbbc2701412b3b535b157416` and returned GREEN with zero P0-P3 findings. The complete 10-path / 55,819-byte diff had SHA-256 `a33d15906defd7735979da6da144cb4dfb99adda6abf3efff1daf25d2d891367`. Token mint/preflight/post-lock/replay fences, type-boundary repair, unknown-code rejection, authority/lifecycle chain, READ COMMITTED evidence, inherited release receipt and non-overlapping PR #456 integration were confirmed. Reviewer Vitest/lint/typecheck/heavy gates were `NOT RUN`. Receipt integrity and all five replacement checks remain mandatory; no credit is added. |
| 2026-09-27T19:52:49+02:00 | PR #462 reviewed response-rollout fence production release | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Receipt integrity kept all six independently reviewed runtime/test blobs byte-identical at final head `ac4049444b0ddd874002a8b8c580bbdc8dc067da`; both reviews were GREEN with zero P0-P3. All five replacement exact-head contexts passed: `static-checks` included the real PostgreSQL shared-lock gate and completed in 8m22s, while `typecheck` completed in 17m45s. PR #462 merged normally as `bf1cd5786dfe1968eda4912135556ef0247437c6`; deploy run `36337133864` completed quality/security, SHA-bound standalone build, immutable staging, atomic production deployment, scheduler/tenant-isolation checks and built-in smokes. Independent no-cache reads returned ping `{"ok":true}` and exact `artifactSha=bf1cd5786dfe1968eda4912135556ef0247437c6`. Browser/Android/load/physical/pilot evidence remains `NOT RUN`; WF-C6-002/006 stay `PARTIAL` and no task/gate credit is added. |
| 2026-09-27T20:00:00+02:00 | C6 revision-aware employee self-response projection (pre-review) | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | [`Self-response projection evidence`](./workforce-c6-self-response-projection-evidence-2026-09-27.md): the self-scoped exception feed now derives acknowledgement from a complete bounded decision stream and the highest lock-observed response revision instead of any timestamp-ordered row. New request/reopen cycles invalidate stale responses; resolved, schedule-only, gapped, unknown, invalid, future-revision and over-bound contexts fail closed without hiding the generic case. Rollout-off queries read neither relation; rollout-on reads at most 65 minimized decision facts and one non-null response revision per case. Five focused/regression files pass 44 tests, four-file ESLint and diff checks pass. Full typecheck/build/browser/Android/load/physical/pilot remain `NOT RUN`; independent review and exact-head CI are mandatory. WF-C6-006 stays `PARTIAL`; no task/gate credit is added. |
| 2026-09-27T20:07:33+02:00 | C6 self-response preflight P2 evidence repair | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | The first author-independent pass returned RED on one P2: two hard-break spaces in the new untracked evidence file escaped the tracked-only `git diff --check`. They are removed, and the enabled-route test now asserts the whole exact minimized Prisma selection rather than partial relation matchers. Tracked plus explicit untracked whitespace checks, five files / 44 tests and four-file ESLint pass. The RED verdict does not transfer; a fresh full-snapshot rereview and fingerprint remain mandatory. No runtime policy, task or gate credit changes. |
| 2026-09-27T20:11:20+02:00 | C6 self-response replacement preflight GREEN | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Fresh author-independent review from zero returned GREEN with zero P0-P3 findings on base/HEAD/merge-base `778709ef36f9c438bce5c060fda69bffe5947f94` plus the complete seven-path working snapshot: 38,244 bytes, SHA-256 `f039c7297cbcc70e7994bc57e47b54bc28befb42d7f8b2e20a3c9a1f5fd107be`. Reviewer tracked/untracked whitespace and append-only-prefix checks passed; causal revision, bounds, lifecycle, rollout, privacy and evidence contracts were confirmed. Reviewer dependency-backed/heavy gates were `NOT RUN`. This pre-commit verdict does not transfer to the receipt delta; clean checkpoint and fresh frozen complete-diff review remain mandatory. No credit is added. |
| 2026-09-27T20:21:37+02:00 | C6 self-response frozen-review P2 platform-scope repair | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | First frozen review of clean base/main `68cf17eddd1d5db8179fe2ec2981506403fc98ca` through head `ea3dd1791215efe9f4504cdcbdd977582f208a4f` (eight paths / 47,601 bytes, SHA-256 `2da644671f700ec80506d75b519ed606e52c59411b9b7697c96d3b89a8ae056a`) returned RED with one P2: the task row overstated the new web projection as existing across mobile. Runtime was sound. The repaired wording scopes revision-aware acknowledgement to server/web and explicitly keeps mobile acknowledgement/response-ledger projection open. The RED identity does not transfer; checkpoint and fresh complete rereview remain mandatory. No progress credit changes. |
| 2026-09-27T20:26:28+02:00 | C6 self-response replacement frozen review GREEN | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Fresh author-independent review from zero returned GREEN with zero P0-P3 findings on clean base/current main/merge-base `68cf17eddd1d5db8179fe2ec2981506403fc98ca` through head `57f32f10fb5b609015a70fdaa13f18b919ea54f4`: eight paths / 51,114 binary-diff bytes, SHA-256 `c65f22fced42ea3fa25bae94b8e38c407da0b314e3eafd79b5f00be6aa6a0090`. Both evidence P2 repairs, server/web-only mobile boundary, rollout/query/privacy/revision/lifecycle/64–65 contracts, inherited PR #462 receipt, append-only log and unchanged progress were confirmed. Reviewer dependency/heavy gates were `NOT RUN`. Receipt integrity and all exact-head CI contexts remain mandatory; no credit is added. |
| 2026-09-27T21:13:17+02:00 | PR #465 revision-aware self-response projection production release | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Receipt integrity preserved all four reviewed runtime/test blobs byte-identically at final head `ce9b77d8711fb6d292017528661e4a8ec1379f20`; both independent reviews were GREEN with zero P0-P3. All five exact-head contexts passed, including `static-checks` in 8m16s and `typecheck` in 16m06s. PR #465 merged normally as `84c5e9ef2d2409cfb95056a738579a6267cf35b6`; deploy run `36342013489` completed quality/security, SHA-bound build, immutable staging, atomic production deploy and built-in smokes. Independent no-cache reads returned ping `{"ok":true}` and exact `artifactSha=84c5e9ef2d2409cfb95056a738579a6267cf35b6`. Browser/Android/load/physical/pilot evidence remains `NOT RUN`; WF-C6-006 stays `PARTIAL` and no task/gate credit is added. The next bounded slice is the read-only mobile projection of this current-cycle response state, without a mobile acknowledgement writer. |
| 2026-09-27T21:26:06+02:00 | C6 mobile current-cycle response-state projection (pre-review) | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | [`Mobile self-response projection evidence`](./workforce-c6-mobile-self-response-projection-evidence-2026-09-27.md): the existing fresh mobile-auth snapshot now carries the canonical response rollout bit without a second Organization read. Rollout-off reads no ledger relation; rollout-on reads only 65 minimized decision facts and one highest non-null response revision, then reuses the released fail-closed projector. Android strictly parses a typed three-state enum and renders localized EN/RU/AZ read-only status beside the existing correction card; there is no acknowledge action, POST, outbox or delivery claim. Five selected files pass 93 tests, four-file targeted ESLint has zero errors, the legacy auth test lint delta stays 46/46 and diff whitespace passes. Local Android/typecheck/build/browser/load/physical/pilot remain `NOT RUN`; independent review and exact-head web plus Android CI are mandatory. WF-C6-006 stays `PARTIAL`; no credit is added. |
| 2026-09-27T21:38:44+02:00 | C6 mobile response projection preflight P3 receipt repair | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | First author-independent complete-snapshot review returned RED with one P3 and no P0-P2: the new append-only session entry used a nonexistent full SHA for the already created release-receipt commit. The actual SHA is `d9a0142216947ae1384946e7d0caf8234c65337d`; an append-only correction now supersedes only that identifier. All runtime/query/auth/privacy/Kotlin/UI, diff, XML 253/253/253, lockfile and PR #465 release checks were otherwise GREEN on the rejected 16-path / 60,265-byte snapshot, SHA-256 `271a33522b46cedc8392de20d8f913db052609605db18c1296a98794ba95b4ea`. The rejected verdict does not transfer; fresh full-snapshot rereview is mandatory. No credit changes. |
| 2026-09-27T21:47:45+02:00 | C6 mobile response projection replacement preflight GREEN | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Fresh author-independent review from zero returned GREEN with zero P0-P3 findings on exact base/current main/merge-base `84c5e9ef2d2409cfb95056a738579a6267cf35b6`, HEAD `d9a0142216947ae1384946e7d0caf8234c65337d` plus every tracked and both untracked task files. The corrected 16-path combined binary stream was 63,662 bytes, SHA-256 `2bb3d0efdf06317085dfc8f4ac7d3735b6ce682492f2337f89c3cade3fe49729`. The reviewer reconfirmed all auth/query/revision/privacy/Kotlin/UI/no-writer boundaries plus whitespace, append-only prefixes, XML 253/253/253, exact lockfile and PR #465 receipt. Reviewer dependency/heavy gates were `NOT RUN`. This pre-commit verdict does not transfer to the receipt delta or forthcoming clean head; frozen rereview remains mandatory. No credit changes. |
| 2026-09-27T21:56:18+02:00 | C6 mobile response projection frozen review GREEN | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Fresh author-independent complete-diff review from zero returned GREEN with zero P0-P3 findings on clean base/current main/merge-base `84c5e9ef2d2409cfb95056a738579a6267cf35b6` through head `1783d2924ddcaafcac6489f493e63ae8953c2bcc`. The complete 16-path / 63,464-byte binary diff had SHA-256 `6e4ea817cfdc100d417d4921dac4d4b2602043888f87cd7806057da6cb6f830c`; auth snapshot, zero second org lookup, exact 101/65/1 query, revision/self/privacy fences, strict Kotlin parser, localized read-only UI, no-writer boundary, whitespace, append-only prefixes, XML 253/253/253, lock and PR #465 receipt were confirmed. Reviewer dependency/heavy gates were `NOT RUN`. Live protection still lacks `agent-review`; the independent GREEN review remains mandatory evidence. Receipt integrity and exact-head web plus Android CI remain required; no credit is added. |
| 2026-09-27T22:43:26+02:00 | PR #466 mobile response projection production release | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Receipt integrity preserved all 12 reviewed runtime/test/resource/build blobs byte-identically at final head `ec4e46f8bf369f0b1c502a66d9c9024f7516fbd8`; both independent reviews were GREEN with zero P0-P3. Exact-head `pr-scope`, `static-checks`, `typecheck`, `runner-policy`, `scan` and Android lint/unit CI passed. PR #466 merged normally as `a7189fd72d62fb0b0f04f327341a0377d1191a41`; deploy run `36347616300` completed quality/security, SHA-bound build, immutable staging, atomic production deployment, built-in smokes and retention cleanup. Independent no-cache reads returned ping `{"ok":true}` and exact `artifactSha=a7189fd72d62fb0b0f04f327341a0377d1191a41`. Browser/load/signed-device/physical/pilot evidence remains `NOT RUN`; WF-C6-006 stays `PARTIAL` and no task/gate credit is added. The next mobile acknowledgement API must bind the employee-visible case revision under the canonical case lock and remain unavailable to unlinked principals. |
| 2026-09-27T23:00:50+02:00 | C6 revision-bound mobile acknowledgement API (pre-review) | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | [`Mobile acknowledgement API evidence`](./workforce-c6-mobile-acknowledgement-api-evidence-2026-09-27.md): a self card offers only a fixed acknowledgement plus expected case revision when rollout, lifecycle, mutate permission and linked-user authority all pass. The strict mobile POST derives every identity/link and checks that revision after the canonical case lock; stale cycles append neither response nor audit, while exact same-revision retries remain idempotent without returning ledger identity. Ten related files pass 77 tests, seven-file ESLint and whitespace checks pass; the 12-case real-PostgreSQL file is locally `SKIPPED / NOT RUN` and mandatory in exact-head CI. Android control/outbox/delivery, the web stale-presentation repair, browser/load/device/pilot evidence and tenant activation remain open. WF-C6-006 stays `PARTIAL`; no credit is added. |
| 2026-09-27T23:16:31+02:00 | C6 mobile acknowledgement API current-main integration | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | The first author-independent complete-snapshot preflight was GREEN with zero P0-P3 findings at 11 paths / 72,975 bytes / SHA-256 `da0061372e6902e46d2f47bda5865a4fa665da2c49826e52978bef22071b046f`, but remote main advanced through PR #468. Its 12 MTM/map paths were non-overlapping and current main `fb1833a1bbbba77f5f9fbd603507144a8a41f0b5` was integrated as merge `6893772b87a1c604d30e5927e3fc6553f41e7f0c`. On the integrated tree, core 37/37 and expanded regression 100/100 tests, seven-file ESLint and whitespace pass; 12 PostgreSQL cases are compiled but locally `SKIPPED / NOT RUN`. The old fingerprint is historical and non-transferable; a fresh checkpoint identity, independent review and exact-head CI remain mandatory. No progress credit is added. |
| 2026-09-27T23:31:21+02:00 | C6 mobile acknowledgement API second main refresh | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Remote main advanced again through PR #469 to `a043fc9f1b41b87c032714d8d4f28e5dde9def3a`. Its sole `.github/workflows/mtm-map-matching.yml` change is disjoint from the Workforce slice and was integrated normally as `03964302087911b19db7c519f8b900acf530f844`. The 37-test core, expanded 100-test regression, 12-case PostgreSQL collection, seven-file ESLint and whitespace checks were repeated with unchanged results; PostgreSQL remains locally `SKIPPED / NOT RUN`. The complete 11-path Workforce diff remained 77,316 bytes / SHA-256 `7c11617e64ad1a9c04a9a5f9d1664a2c017dbbede713c77d78ff7c7936cfb363` before this receipt. A new receipt checkpoint and author-independent final review remain mandatory; no progress credit is added. |
| 2026-09-27T23:34:23+02:00 | C6 mobile acknowledgement API frozen review GREEN | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Fresh author-independent review returned GREEN with zero P0-P3 findings on exact base/live main/merge-base `a043fc9f1b41b87c032714d8d4f28e5dde9def3a` through clean head `65dba61f568a07b6fdc44053682029bf5aa288fb`. Independent identity matched 11 paths / 80,713 bytes / SHA-256 `60db23fdeda37741ece40322243ef7698987f4c74333b7b4a8d74a7fffb83c34`, below 400 KB. Authority, self scope, strict input/privacy, post-lock revision, replay/lock/lifecycle/audit/DB topology, bounded PostgreSQL harness, GET compatibility, append-only history and zero Android mutation were reconfirmed. Reviewer dependency-backed/heavy checks were `NOT RUN`; receipt integrity and exact-head CI remain mandatory. WF-C6-006 stays `PARTIAL`; no credit is added. |
| 2026-09-28T00:20:56+02:00 | PR #470 revision-bound mobile acknowledgement API production release | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Receipt integrity preserved all seven independently reviewed runtime/test blobs byte-identically at final head `b3d6871d3f928a66b1729f2e9185c9c847811a9c`; both independent reviews were GREEN with zero P0-P3. All five exact-head contexts passed, including `static-checks` in 10m25s with the real PostgreSQL shared-lock race and `typecheck` in 13m22s. PR #470 merged normally as `94dce0d423240921d1c3c68c14cb4a135c99e45d`; deploy run `36353254435` completed quality/security, SHA-bound build/artifact publication, atomic production deployment, built-in smokes and retention cleanup. Independent no-cache reads returned ping `{"ok":true}` and exact `artifactSha=94dce0d423240921d1c3c68c14cb4a135c99e45d`. Browser/Android/load/signed-device/physical/pilot evidence remains `NOT RUN`; WF-C6-006 stays `PARTIAL` and no task/gate credit is added. The next bounded slice closes the web presentation-to-write revision race without claiming Android action/outbox or tenant activation. |
| 2026-09-28T00:56:41+02:00 | C6 web response revision binding replacement preflight GREEN | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | [`Web response revision-binding evidence`](./workforce-c6-web-response-revision-binding-evidence-2026-09-28.md): the self GET offers only a write-role-authorized acknowledgement with its validated case revision; the strict POST rechecks revision after the canonical lock. Two independent P2 findings were repaired in sequence: unstable per-click UUIDs, then premature/cross-tenant reconciliation. Stable browser operation identity plus a request/org/case/key and `SUBMITTING`/`RECONCILING` state machine now make lost-response retry exact and ignore old async completions. Fresh replacement preflight was GREEN with zero P0-P3 on 10 paths / 55,872 bytes / SHA-256 `94375be04d8ae91b4af0338654cfc956698070ca91e939bbe98bfe661034690f`. Expanded regression is 15 files / 120 tests; ten-path ESLint and whitespace pass; 12 PostgreSQL cases are locally `SKIPPED / NOT RUN`. Clean checkpoint, frozen rereview and exact-head CI remain mandatory. WF-C6-006 stays `PARTIAL`; no credit is added. |
| 2026-09-28T09:38:00+02:00 | C6 web response revision binding current-main refresh | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | The first clean frozen review was GREEN with zero P0-P3 on base `94dce0d423240921d1c3c68c14cb4a135c99e45d` through head `d46a1ea0fd9385d39f91de25f013359fe2efe4ee`, independently matching 14 paths / 81,937 bytes / SHA-256 `c8259ffdf46b152baec011ebe599e5f1138731ae389b9ab4d123eedf6ab40fb3`. Live main then advanced through PR #471 to `f26d5767e92f14300838e4d59ede05c1101cfcc4`; its six translation/MTM visit-pagination paths are disjoint and were integrated as `e716df985ed2b101536ff2aff7af6e280fdd6b66`. Integrated-tree regression remains 15 files / 120 tests, ten-path ESLint and whitespace pass, and 12 PostgreSQL cases remain locally `SKIPPED / NOT RUN`. The complete Workforce diff identity is unchanged on the new base, but the old review is historical; receipt checkpoint and fresh complete rereview remain mandatory. No credit is added. |
| 2026-09-28T11:26:55+02:00 | C6 employee-response cycle deduplication preflight GREEN | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | [`Cycle-dedup evidence`](./workforce-c6-exception-response-cycle-dedup-evidence-2026-09-28.md): under the canonical case lock, every cooperating writer now rejects a second different operation at the same tenant/case/revision while preserving exact replay and allowing a later revision. Independent design and implementation preflights were GREEN with zero P0-P3. Focused writer tests pass 15/15, the related seven-file selection passes 54/54, targeted ESLint and whitespace pass; the 13-case PostgreSQL file compiles but is locally `SKIPPED / NOT RUN` and mandatory in exact-head CI. No schema/route/UI/rollout change or completion credit is claimed; legacy/raw-writer uniqueness still requires a separate duplicate audit and online migration. |
| 2026-09-28T11:32:21+02:00 | C6 response-cycle dedup current-main integration | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Main advanced through disjoint PR #476/#467 to `147369b5027b9dae7b5a6cb25d9f82711fbdb43b` and was integrated normally as `0395f7a718f09b14eae8240d05927647d399e4ed`. Its seven MTM map/demo and Social relevance paths do not overlap this seven-path Workforce diff. Integrated-tree response regression remains 54/54, targeted ESLint and whitespace pass, while 13 PostgreSQL scenarios remain locally `SKIPPED / NOT RUN`. Before this receipt the diff was 41,889 bytes / SHA-256 `a6ad90f92f60c5ab2d01e0a55ea87245f9cfba7f70c807bae80dbdf8f38ea100`; the working preflight is not frozen merge authority, so receipt checkpoint and fresh complete-diff review remain mandatory. No credit is added. |
| 2026-09-28T11:37:40+02:00 | C6 cycle-dedup rejected-review fingerprint correction | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | The first frozen review returned RED with one P3 evidence finding and no P0-P2: the preceding 41,889-byte fingerprint used `--full-index` and is superseded by reproducible plain-binary identities. Base `147369b5027b9dae7b5a6cb25d9f82711fbdb43b` through pre-receipt merge `0395f7a718f09b14eae8240d05927647d399e4ed` is seven paths / 41,455 bytes / SHA-256 `0e666ed0c59a87e378eabffef9312e20e79c0d5c432c1904c02d5a7cb378f5c1`; rejected head `08f48c948c6c7e760e1ee3be78e0e22c0589244b` is seven paths / 46,954 bytes / SHA-256 `b24950e8ea97ae20fe5559ee459c4ca743dd247814741707de0ccef4b547b73b`. Runtime/test inspection was otherwise GREEN, but the verdict does not transfer; correction checkpoint and full replacement review are mandatory. No credit changes. |
| 2026-09-28T11:42:10+02:00 | C6 cycle-dedup replacement frozen review GREEN | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Fresh author-independent complete-diff review returned GREEN with zero P0-P3 on exact base/live main/merge-base `147369b5027b9dae7b5a6cb25d9f82711fbdb43b` through clean head `af345a337885ca07fe83e1a0a6dad0572cb05330`: seven paths / 52,498 plain-binary bytes / SHA-256 `6cce6d11115b7994488b961c564cbb953720504935ce3106bd8c28335059c5bc`, below 400 KB. Writer/race/API semantics, all four append-only fingerprint corrections, PR #473 receipt, disjoint main integration, progress and `NOT RUN` truth passed. Reviewer dependency/heavy gates were `NOT RUN`; this docs-only receipt needs final blob-integrity review before push. No credit changes. |
| 2026-09-28T12:31:32+02:00 | PR #477 employee-response cycle deduplication production release | 99% | C5 81%; C6 20%; C9 99% | 81/161 | 14/15 | Final receipt integrity preserved all three reviewed runtime/test blobs at head `a8c03595966d82ddb0e84b4fc717e7eb6d726d52`; both independent reviews were GREEN after the rejected P3 evidence fingerprint was append-only corrected. All five exact-head contexts passed, including 12m06s `static-checks` with the real PostgreSQL race and 18m45s `typecheck`. PR #477 merged normally as `6b858b4514e58b1d01c1b027d7ce503a7b39b185`; deploy run `36407634637` passed quality/security, SHA-bound build, atomic production deploy/smokes and retention. Independent HTTP 200 reads returned ping `{"ok":true}` and exact `artifactSha=6b858b4514e58b1d01c1b027d7ce503a7b39b185`. Browser/Android/load/physical/pilot remain `NOT RUN`; no credit changes. |

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
| WF-C2-009 | P1 | DONE | Backend | Validate segment overlap, ordering, site eligibility, timezone and impossible travel at publish and action time | [`workforce-c2-schedule-safety-evidence-2026-08-30.md`](./workforce-c2-schedule-safety-evidence-2026-08-30.md): publish/START/action checks, exact preceding-departure ordering and conservative review-only impossible-transition signal; PR #486 exact-head CI and production receipt below |
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
| WF-C5-003 | P0 | PARTIAL | Mobile/Security | Generate non-exportable Android Keystore keys with user-auth properties and safe rotation | [`Android foundation`](./workforce-c9-android-foundation-evidence-2026-08-30.md) and [`terminal cleanup`](./workforce-c5-device-key-terminal-cleanup-evidence-2026-08-31.md): challenge-bound Android Keystore/StrongBox-preferred source plus server-confirmed terminal-state key cleanup exist; physical key lifecycle, rotation transport and server validation remain open |
| WF-C5-004 | P0 | PARTIAL | Backend/Security | Validate Android Key Attestation chain, roots, revocation, security level, challenge and app identity server-side | [`attestation verifier foundation`](./workforce-c5-android-key-attestation-foundation-evidence-2026-08-30.md), [`server-first preflight`](./workforce-c5-attestation-preflight-evidence-2026-08-31.md), [`material minimization`](./workforce-c5-attestation-material-minimization-evidence-2026-09-01.md) and [`receipt write fence`](./workforce-c5-attestation-receipt-write-fence-evidence-2026-09-01.md): fail-closed verifier foundation and server nonce exist, while approval/use require a minimal verified receipt; official verifier integration, receipt writer, live status feed and physical evidence remain open |
| WF-C5-005 | P0 | PARTIAL | Mobile/Backend | Bind Play Integrity verdict/request hash to the exact attendance action; use tiered response and no verdict cache | [`Play Integrity binding evidence`](./workforce-c5-play-integrity-binding-evidence-2026-08-30.md): exact-action hash, fresh Android token path, server decoder and minimal verification fact are default-off and fail closed without explicit identity/service configuration; live Google decode, migration apply and physical tamper evidence remain open |
| WF-C5-006 | P0 | PARTIAL | Mobile | Use local BiometricPrompt/device credential only to unlock per-use signature; no template/result leaves OS | [`local-biometric foundation`](./workforce-c5-local-biometric-foundation-evidence-2026-08-30.md) and [`manifest downgrade fence`](./workforce-c5-biometric-manifest-fence-evidence-2026-09-01.md): the OS-owned strong-biometric prompt releases one exact Keystore signature behind an atomic one-shot callback fence, and biometric-only policy cannot fall through unsigned; Android Gradle, packet/log inspection and physical biometric evidence remain open |
| WF-C5-007 | P1 | PARTIAL | Backend/Web | Complete device pending/approve/revoke/replace/lost/recovery UI with separation of duties | [Partial UI evidence](./workforce-c5-attendance-admin-ui-evidence-2026-08-30.md) and [`attestation receipt fence`](./workforce-c5-attestation-receipt-write-fence-evidence-2026-09-01.md): self-approval is rejected, proof-only enrollment cannot be promoted, linked employees can revoke only their own pending/active factor, and replacement lineage is visible. Signed-mobile recovery and physical evidence remain open |
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
| WF-C6-002 | P0 | PARTIAL | Backend | Create immutable exception case/decision lifecycle with deduplication and links to claim/evidence/workday/segment | [`workforce-c6-exception-case-lifecycle-evidence-2026-08-30.md`](./workforce-c6-exception-case-lifecycle-evidence-2026-08-30.md), [`scoped decision API`](./workforce-c6-scoped-decision-api-evidence-2026-08-31.md), [`scoped workbench backend`](./workforce-c6-scoped-workbench-backend-evidence-2026-09-26.md), [`case-revision cutover`](./workforce-c6-case-revision-cutover-evidence-2026-09-27.md), [`employee-response rollout fence`](./workforce-c6-exception-response-rollout-fence-evidence-2026-09-27.md), [`inactive policy-revision foundation`](./workforce-c6-exception-policy-revision-foundation-evidence-2026-09-27.md), [`policy-revision FK validation`](./workforce-c6-exception-policy-revision-validation-evidence-2026-09-27.md), [`dormant policy-revision writer`](./workforce-c6-exception-policy-revision-writer-evidence-2026-09-27.md), [`session-only acknowledgement API`](./workforce-c6-exception-policy-revision-session-api-evidence-2026-09-27.md) and [`draft-receipt GET`](./workforce-c6-exception-policy-revision-read-api-evidence-2026-09-27.md): immutable/RLS storage, exact replay, granular scope, case-local causal revisions, response-channel rollout fencing and session-attributed inactive draft provenance recording/readback exist; separately fenced activation/decision linkage/terminal action/UI remain open |
| WF-C6-003 | P0 | PARTIAL | Backend | Generate no-show only from a published expected schedule after grace and approved leave/calendar checks | [`exception intake`](./workforce-c6-exception-intake-evidence-2026-08-30.md) and [`bounded scheduler`](./workforce-c6-no-show-review-scheduler-evidence-2026-09-01.md): a default-deny leased worker rechecks published historical schedule, grace, employment, calendar/leave and current workday state inside a serializable materialization transaction, then writes only an immutable review case. Production cadence, tenant flag/cohort, measured load and applied-RLS concurrency remain open |
| WF-C6-004 | P1 | PARTIAL | Backend/HR | Define missed checkout and stale open-shift policy: reminder, review, bounded auto-close proposal or manual correction | [`workforce-c6-exception-intake-evidence-2026-08-30.md`](./workforce-c6-exception-intake-evidence-2026-08-30.md): safe generic reminder/review proposal requires immutable schedule and complete observation; it never fabricates a finish, while policy timing/delivery/auto-close stay owner-gated |
| WF-C6-005 | P1 | PARTIAL | Web | Build exception queue with scope, risk, age, evidence completeness, employee response and next action | [`queue foundation`](./workforce-c6-exception-queue-foundation-evidence-2026-08-30.md), [`scoped backend`](./workforce-c6-scoped-workbench-backend-evidence-2026-09-26.md), [`case-revision cutover`](./workforce-c6-case-revision-cutover-evidence-2026-09-27.md), [`scoped acknowledgement UI`](./workforce-c6-exception-acknowledgement-ui-evidence-2026-09-27.md) and [`correction-request UI`](./workforce-c6-exception-correction-request-ui-evidence-2026-09-27.md): the raw-proof-free queue filters by immutable historical team/site grants, evaluates current-cycle signals only by validated case revision and exposes only one exact server-offered acknowledgement or correction-review request through a two-step UI; employee-response/appeal UI, terminal action enablement, real browser evidence and full C6 acceptance remain open |
| WF-C6-006 | P1 | PARTIAL | Web/Mobile | Let employee explain or appeal an exception and request a correction from the exact day/segment | [`employee-response foundation`](./workforce-c6-employee-response-foundation-evidence-2026-08-30.md), [`case-to-correction source link`](./workforce-c6-correction-request-link-evidence-2026-08-31.md), [`mobile self-exception foundation`](./workforce-c6-mobile-self-exception-evidence-2026-08-31.md), [`case-revision cutover`](./workforce-c6-case-revision-cutover-evidence-2026-09-27.md), [`response rollout fence`](./workforce-c6-exception-response-rollout-fence-evidence-2026-09-27.md), [`self-response projection`](./workforce-c6-self-response-projection-evidence-2026-09-27.md), [`mobile self-response projection`](./workforce-c6-mobile-self-response-projection-evidence-2026-09-27.md), [`mobile acknowledgement API`](./workforce-c6-mobile-acknowledgement-api-evidence-2026-09-27.md), [`web revision binding`](./workforce-c6-web-response-revision-binding-evidence-2026-09-28.md) and [`response-cycle deduplication`](./workforce-c6-exception-response-cycle-dedup-evidence-2026-09-28.md): self discovery and exact-case/workday/source correction linking exist across web/mobile; bounded current-cycle acknowledgement status is projected across server/web/mobile, both server-only mobile plus existing web acknowledgement writes bind the employee-visible revision under the case lock, and cooperating writers allow only one operation per case revision. Android control/outbox/delivery, database-enforced cycle uniqueness, full appeal UX and real mobile/browser evidence remain open |
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
| WF-C8-002 | P1 | PARTIAL | Web | Rebuild manager Today around scheduled roster, no-show/previous-open and exceptions rather than only existing workdays | [`bounded manager Today evidence`](./workforce-c8-manager-today-evidence-2026-09-29.md): scheduled roster, immutable/live plan boundary, distinct calendar, previous-open fact and independently authorized persisted exception projection are implemented with stable pagination and safe response minimization; real browser/AT proof that the absent employee is visible and explained remains open |
| WF-C8-003 | P1 | DONE | Web | Add multi-site day timeline and transition status | [`workforce-c8-multisite-timeline-evidence-2026-09-13.md`](./workforce-c8-multisite-timeline-evidence-2026-09-13.md): the self-only timeline shows Site/Travel/Site plans and append-only arrival/departure/review states without raw proof or physical-presence claims |
| WF-C8-004 | P1 | DONE | Web | Complete timesheet: plan/fact/evidence status/exceptions/approval/correction revisions | [`Complete timesheet review evidence`](./workforce-c8-complete-timesheet-evidence-2026-09-29.md): query-bounded, calculation-version-aware linked and schedule-only exceptions plus hash-verified v1/v2 approval/correction history join deterministic plan/fact; missing snapshots and unresolved exceptions remain non-approvable, successful writes refresh exact history, and PR #489 passed independent review, exact-head gates, release and exact-SHA production verification. |
| WF-C8-005 | P1 | PARTIAL | Web | Add exception workbench and employee response/appeal context | [`Scoped acknowledgement UI`](./workforce-c6-exception-acknowledgement-ui-evidence-2026-09-27.md) and [`correction-request UI`](./workforce-c6-exception-correction-request-ui-evidence-2026-09-27.md): the queue shows scoped risk/age/evidence/response context and records one exact server-offered non-terminal acknowledgement or correction-review request through a two-step localized UI; employee response/appeal surfaces, terminal lifecycle and real browser evidence remain open, so C6 acceptance is not yet met |
| WF-C8-006 | P1 | DONE | Web | Add Sites/Geofences configuration with map pin, radius calibration, effective date and access scope | [`workforce-c8-sites-geofences-evidence-2026-08-30.md`](./workforce-c8-sites-geofences-evidence-2026-08-30.md): administrator-only named sites, future calibrated circles, assignment-only impact preview and immutable revision history; no browser location collection or physical-presence claim |
| WF-C8-007 | P1 | PARTIAL | Web | Add schedule/calendar/break/segment policy editor with safe defaults and validation | [`ordered segment editor evidence`](./workforce-c8-shift-segment-editor-evidence-2026-09-29.md): named ACTIVE sites, released modes, safe break-aware defaults, full-array draft writes, hidden proof-reference preservation and immutable ACTIVE summaries; calendar authoring and real browser/AT evidence remain open |
| WF-C8-008 | P1 | PARTIAL | Web | Add proof-policy, QR station and trusted-device administration separated by permission | [`workforce-c5-attendance-admin-ui-evidence-2026-08-30.md`](./workforce-c5-attendance-admin-ui-evidence-2026-08-30.md): named-site/effective-circle QR station creation plus device/QR lifecycle UI are administrator-only; proof-policy UI and granular separation-of-duties await C7/C5 gates |
| WF-C8-009 | P1 | PARTIAL | Web | Add restricted evidence timeline and access audit; normal view shows verdict instead of exact coordinates | [`derived evidence timeline evidence`](./workforce-c10-derived-evidence-timeline-evidence-2026-09-13.md): a visible named-employee web timeline now returns only bounded localized verdict/reason records after exact grant, explicit context and successful access audit; raw-investigation policy/UI and real-browser acceptance remain open |
| WF-C8-010 | P1 | PARTIAL | Web/I18n | Complete AZ/RU/EN, keyboard, focus, contrast, 200% zoom, responsive tablet/phone and error/empty states | [`derived evidence timeline evidence`](./workforce-c10-derived-evidence-timeline-evidence-2026-09-13.md) and [`bulk preview evidence`](./workforce-c7-bulk-draft-preview-evidence-2026-08-30.md): AZ/RU/EN, concise announcements, focus transfer, bounded named search, responsive source and error/empty states exist; real browser/AT/contrast/200%-zoom/mobile evidence remains open |
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
| WF-C9-004 | P0 | PARTIAL | Mobile | Build Work Time history and day detail with pending/conflict/review/correction status | [`Android foundation`](./workforce-c9-android-foundation-evidence-2026-08-30.md), [`accepted day detail`](./workforce-c9-mobile-history-detail-evidence-2026-08-31.md) and [`local recovery status`](./workforce-c9-history-local-recovery-evidence-2026-08-31.md): bounded self history and expandable accepted event/review/correction detail expose no raw proof, while only global metadata-only pending/conflict/review counts are shown; device evidence remains open |
| WF-C9-005 | P0 | PARTIAL | Mobile | Build Requests: leave, absence, correction, cancellation, evidence-safe reason and status history | [`Android foundation`](./workforce-c9-android-foundation-evidence-2026-08-30.md), [`request status history`](./workforce-c9-mobile-request-history-evidence-2026-08-31.md) and [`request delivery recovery`](./workforce-c9-request-local-recovery-evidence-2026-08-31.md): typed employee-only request/cancellation, encrypted per-domain queue, explicit self-history/status timeline and aggregate local delivery status exist; physical form/offline/conflict/review evidence remains open |
| WF-C9-006 | P0 | PARTIAL | Mobile | Implement encrypted local database/outbox, per-domain ordering, operation IDs, retry bounds and logout/tenant-change isolation | [`Android foundation`](./workforce-c9-android-foundation-evidence-2026-08-30.md), [`account-bound outbox fence`](./workforce-c9-account-bound-outbox-evidence-2026-08-31.md) and [`sign-in boundary`](./workforce-c9-sign-in-boundary-evidence-2026-08-31.md): encrypted Room payload envelope, fixed operation ID, 7-day/8-attempt bounds, scoped WorkManager drain and account-isolated successful sign-in boundary exist; Android build/Room migration/process-death/two-account/7-day tests remain open |
| WF-C9-007 | P0 | PARTIAL | Mobile | Implement permission-aware action-time location capture and approved on-duty transition mode; stop at Finish/off-shift | [`Android foundation`](./workforce-c9-android-foundation-evidence-2026-08-30.md), [`policy contract`](./workforce-c9-action-time-location-contract-evidence-2026-08-31.md), [`v4 action binding`](./workforce-c9-action-time-location-binding-evidence-2026-08-31.md) and [`encrypted persistence`](./workforce-c9-action-time-evidence-persistence-evidence-2026-08-31.md): foreground-only action capture, permission/recovery, immediate-only transport, quality fail-closed guard, transaction-bound encrypted raw evidence, raw-free quality assessment and server-resolved immutable SITE geofence verdict now exist; C6 review-case lifecycle and physical background/permission/battery evidence remain open |
| WF-C9-008 | P0 | PARTIAL | Mobile | Implement QR scanner with fresh-token immediate path; never persist raw QR or queue an expired scan | [`Android foundation`](./workforce-c9-android-foundation-evidence-2026-08-30.md) and [`fresh QR action-attempt fence`](./workforce-c9-qr-attempt-fence-evidence-2026-08-31.md): delegated single-QR callback is bound to one live server-required action, uses an opaque one-use token, has no app camera permission and bypasses durable outbox; device storage/log/replay evidence remains open |
| WF-C9-009 | P0 | PARTIAL | Mobile | Implement device enrollment, attested key, local authentication, revoke/replace cleanup and exact-action signature | [`Android foundation`](./workforce-c9-android-foundation-evidence-2026-08-30.md), [`sign-in boundary`](./workforce-c9-sign-in-boundary-evidence-2026-08-31.md), [`mobile replacement source`](./workforce-c9-device-replacement-source-evidence-2026-09-01.md) and [`terminal cleanup`](./workforce-c5-device-key-terminal-cleanup-evidence-2026-08-31.md): Android Keystore candidate, per-use OS strong-biometric signature, self enrollment/proof, account-bound cleanup, manager-approved replacement link, server-confirmed terminal key cleanup and exact workday signature source exist; server attestation validation and physical H5 matrix remain open |
| WF-C9-010 | P1 | PARTIAL | Mobile | Implement offline/conflict/review recovery center and safe re-scan/re-capture rules | [`workforce-c9-android-foundation-evidence-2026-08-30.md`](./workforce-c9-android-foundation-evidence-2026-08-30.md), [`location recovery`](./workforce-c9-location-recovery-evidence-2026-08-31.md) and [`server-truth return`](./workforce-c9-recovery-server-truth-evidence-2026-08-31.md): metadata-only outbox recovery, explicit fresh-capture/review guidance and a distinct return to current server truth exist; Android conflict/device/re-scan exercise remains open |
| WF-C9-011 | P1 | PARTIAL | Mobile | Add push/local reminders for shift/segment/missed action with privacy-safe notification text | [`Android foundation`](./workforce-c9-android-foundation-evidence-2026-08-30.md) and [`next-segment reminder`](./workforce-c9-next-segment-reminder-evidence-2026-09-01.md): opt-in generic local end/next-segment source uses only immutable server instants and has no identifier/payload input; permission/channel/delivery physical tests plus push/start-before-workday lanes remain open |
| WF-C9-012 | P1 | PARTIAL | Mobile | Add AZ/RU/EN, TalkBack, 200% font, 48 dp, reduced motion, poor-vision/color-independent states | [`workforce-c9-android-foundation-evidence-2026-08-30.md`](./workforce-c9-android-foundation-evidence-2026-08-30.md): AZ/RU/EN core resource catalogs, canonical server update-error mapping, tab state semantics, live status and explicit 48 dp source exist; physical accessibility/language review remains open |
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
| WF-C10-006 | P1 | PARTIAL | Security/Web | Enforce restricted raw-evidence access, purpose/reason, access log and periodic review | [`derived evidence timeline evidence`](./workforce-c10-derived-evidence-timeline-evidence-2026-09-13.md): generic managers/API keys are denied; the visible directory and timeline require explicit purpose/reason plus the same exact evidence-review grant and audit before response; the wire timeline is raw-free and its internal IDs are removed from the parsed result before rendering, while raw-investigation policy/UI and periodic review remain open |
| WF-C10-007 | P1 | DONE | Backend | Preserve derived inside/outside/unknown verdict and approved time after raw evidence purge without retaining reversible exact location | [`workforce-c10-post-purge-verdict-evidence-2026-08-30.md`](./workforce-c10-post-purge-verdict-evidence-2026-08-30.md): post-purge fixture preserves the derived verdict and purge receipt while excluding exact/reversible location |
| WF-C10-008 | P1 | PARTIAL | Product/Mobile/Web | Show employees when/why location is captured, permission state, retention summary and how to request correction | [`Android action transparency`](./workforce-c9-action-time-location-transparency-evidence-2026-08-31.md): AZ/RU/EN source gives an action-specific current-location/no-background explanation only when the server manifest requires location; rendered permission/accessibility and physical employee acceptance remain open |
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
| WF-C11-001 | P1 | DONE | Backend | Complete deterministic calculation for segments, approved breaks/travel, calendar, exceptions and corrections | [`deterministic immutable rehydration evidence`](./workforce-c11-deterministic-rehydration-evidence-2026-09-29.md): v2 binds full policy/shift/schedule hashes, calendar/segments, actual-pause-only breaks, non-payroll travel and correction replay; exact-head CI, merge, deploy and production SHA are verified |
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
| WF-C13-001 | P0 | DONE | Backend/DBA | Write additive schema ADR and migration sequence; no rename/drop/destructive backfill | [`C13 additive migration ADR`](./workforce-c13-additive-migration-adr-2026-09-13.md) plus the compatibility contract reject drop/rename/truncate/delete and every UPDATE except one exact deterministic structural-revision phase, whose target/order/NULL-only/transaction/owner/all-other-column/append-only invariants are positively pinned |
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

## 2026-09-28 — WF-C6-006 web response second current-main refresh

- The complete-diff review on base `f26d5767e92f14300838e4d59ede05c1101cfcc4` through head `6a2e807b279182d468ff2dd6124f7f80dcdea7b0` found zero P0-P3 defects and matched 14 paths / 86,905 bytes / SHA-256 `e01a49280883e443fe8fef60853917e379db689be3fefbafe528f4626c149cc8`, but its closing remote check found live-main drift. It is retained as code/evidence inspection only and is not valid merge authority.
- PR #472 advanced main to `494e14f515f0228b00b78fbefc1fd76a1a010c32` through 20 non-overlapping CRM Voice, translation and CRM command paths. It was integrated normally without conflict as `ff19084bfc3097e584eaecc921e8fc9e8d187039`; its parents are the prior receipt head `6a2e807b279182d468ff2dd6124f7f80dcdea7b0` and exact current main `494e14f515f0228b00b78fbefc1fd76a1a010c32`.
- The second integrated tree again passes 15 files / 120 targeted tests, ten-path ESLint and diff whitespace. The PostgreSQL suite discovers 12 scenarios but remains `SKIPPED / NOT RUN` locally. Full typecheck/build, browser, Android, load, signed APK, physical-device and pilot checks remain `NOT RUN` under host policy.
- Before this receipt, the complete 14-path diff remains 86,905 bytes with SHA-256 `e01a49280883e443fe8fef60853917e379db689be3fefbafe528f4626c149cc8`. A new author-independent frozen review is mandatory for the receipt checkpoint and current base; no earlier verdict transfers.
- Progress remains `DONE 81/161`, `GATES 14/15`, C5 81%, C6 20% and C9 99%. WF-C6-006 stays `PARTIAL`; no task or gate credit is added.

## 2026-09-28 — WF-C6-006 web response frozen review GREEN

- Fresh author-independent review returned GREEN with zero P0-P3 findings for exact base/live main/merge-base `494e14f515f0228b00b78fbefc1fd76a1a010c32` through clean head `8370b15bdd55d10ac7e505e5ac27af5b6623f2a4`.
- The reviewer independently matched 14 paths / 93,073 binary-diff bytes / SHA-256 `894add348e49b92c252aaf4fedb13d94d856e94e87c772f2c6cd7cb65289d600`, below 400 KB. Clean start/end, diff whitespace, append-only prefixes and a closing no-drift fetch passed.
- Both repaired browser races and the GET/UI/POST/writer revision, role/auth, tenant/self, privacy, replay, lock and stale-write contracts were reconfirmed. PR #471/#472 disjoint integrations, unchanged runtime/test blobs, i18n parity and the PR #470 production receipt were also verified.
- Reviewer-side dependency-backed checks, real PostgreSQL, full typecheck/build, browser, Android, load, signed APK, physical-device and pilot were `NOT RUN`. Exact-head PR CI remains mandatory.
- Progress remains `DONE 81/161`, `GATES 14/15`, C5 81%, C6 20% and C9 99%; WF-C6-006 remains `PARTIAL` and the review adds no credit.

## 2026-09-28 — PR #473 web response revision binding released

- Receipt-integrity review returned GREEN with zero P0-P3 findings on final head `f6e551a9918433d7b1f51f1690ab882d34d9f724`: 14 paths / 97,304 bytes / SHA-256 `8307a4e723ae4e206a6a3ddecd24070b7fa83c7510a390220ee23db17e96b6ee`. The receipt changed only three append-only docs and preserved all ten runtime/test blobs byte-identically.
- Exact-head PR run `36394863256` passed `pr-scope`, `static-checks` including the real PostgreSQL Workforce shared-lock race gate and full unit baseline, and `typecheck`; companion `runner-policy` and `scan` contexts passed. The PR production-build job was skipped by design.
- PR #473 merged at `2026-09-28T08:21:41Z` as `57853b89252972308c626409a504e147e1b5dbbf`. Deploy run `36396900111` passed quality/security, SHA-bound standalone build/publication, atomic production deploy, scheduler and tenant-isolation verification, built-in public smokes and retention cleanup.
- Independent no-cache public reads returned HTTP 200/`{"ok":true}` from `/api/v1/ping` and exact `artifactSha=57853b89252972308c626409a504e147e1b5dbbf` from `/api/v1/public/build-info`. Only GitHub main through `deploy.yml` was used.
- Browser E2E, Android/Gradle, load, signed APK, physical-device and human-pilot evidence remains `NOT RUN`. Progress remains `DONE 81/161`, `GATES 14/15`, C5 81%, C6 20% and C9 99%; WF-C6-006 remains `PARTIAL` with no new credit.
- Main later advanced through PR #475/#474 to `09502d1c96b43e30ba6648c6a322cc8f3f01ac44`, which contains the released merge. The clean successor branch starts from that current main.

## 2026-09-28 — WF-C6-006 employee-response cycle deduplication preflight GREEN

- A clean design review at `181224631cc0a968aecf8f6da02943ac11a77e21` confirmed that distinct operation UUIDs could append multiple response rows for one case revision because only the operation key was re-read and the case/revision key was indexed but not unique.
- The shared writer now performs a tenant/case/observed-revision read while holding the canonical case lock, after exact replay, lifecycle/revision and correction-topology validation. A prior row produces the existing contained revision conflict; exact retry remains idempotent and a later case revision remains eligible.
- The complete three-path working diff received a second author-independent GREEN with zero P0-P3 findings. No lock-order inversion, deadlock or cross-revision false-positive was found.
- Writer tests pass 15/15, the expanded seven-file response selection passes 54/54, targeted ESLint and whitespace pass. The PostgreSQL file compiles and discovers 13 scenarios, but all are `SKIPPED / NOT RUN` locally; exact-head CI must run the real winner/waiter proof.
- No schema, migration, route, UI, rollout or production state changed. Full local typecheck/build, browser, Android/Gradle, load, signed APK, physical device and pilot remain `NOT RUN`. Progress remains `DONE 81/161`, `GATES 14/15`, C5 81%, C6 20% and C9 99%; no credit is added.
- Precise stopping point: implementation, focused verification and working-tree independent preflight are complete; evidence is not yet checkpointed and there is no clean frozen-head review.
- Next action: remove the temporary dependency link, checkpoint only the seven task paths, freeze the complete diff against current main and require a fresh author-independent GREEN before push or PR.

## 2026-09-28 — WF-C6-006 cycle-dedup current-main integration

- Live main advanced through PR #476/#467 from `09502d1c96b43e30ba6648c6a322cc8f3f01ac44` to `147369b5027b9dae7b5a6cb25d9f82711fbdb43b`. Its seven MTM demo/map and Social relevance paths are disjoint from the Workforce slice.
- Current main was integrated normally without conflict as `0395f7a718f09b14eae8240d05927647d399e4ed`, with parents `37815d80b8bf5d39fdea05d4cd9ba4a06a297fe1` and `147369b5027b9dae7b5a6cb25d9f82711fbdb43b`.
- The integrated tree again passes seven related files / 54 tests, targeted three-path ESLint and whitespace. The PostgreSQL file discovers 13 scenarios but remains locally `SKIPPED / NOT RUN`; full typecheck/build/browser/Android/load/device/pilot remain `NOT RUN`.
- Before this receipt, the complete seven-path diff measured 41,889 binary bytes with SHA-256 `a6ad90f92f60c5ab2d01e0a55ea87245f9cfba7f70c807bae80dbdf8f38ea100`. Progress remains `DONE 81/161`, `GATES 14/15`, C5 81%, C6 20% and C9 99%.
- Precise stopping point: current main is integrated and focused verification is repeated green; only this three-document integration receipt is uncommitted and the integrated clean head has no independent frozen review.
- Next action: checkpoint the receipt, compute the final clean base/head identity and require a fresh author-independent complete-diff GREEN before push or PR.

## 2026-09-28 — WF-C6-006 rejected frozen-review fingerprint correction

- The first frozen review returned RED with one P3 evidence finding and no P0-P2. The recorded 41,889-byte / `a6ad90f...` pre-receipt fingerprint came from `git diff --binary --full-index`, not the reproducible plain `git diff --binary` stream, and is superseded without removing history.
- Correct base `147369b5027b9dae7b5a6cb25d9f82711fbdb43b` through pre-receipt merge `0395f7a718f09b14eae8240d05927647d399e4ed` identity: seven paths / 41,455 bytes / SHA-256 `0e666ed0c59a87e378eabffef9312e20e79c0d5c432c1904c02d5a7cb378f5c1`.
- Correct rejected head `08f48c948c6c7e760e1ee3be78e0e22c0589244b` identity: seven paths / 46,954 bytes / SHA-256 `b24950e8ea97ae20fe5559ee459c4ca743dd247814741707de0ccef4b547b73b`. Runtime/test review was otherwise GREEN, but a rejected verdict grants no merge authority.
- Progress and `NOT RUN` state are unchanged: `DONE 81/161`, `GATES 14/15`, C5 81%, C6 20%, C9 99%; real PostgreSQL, full typecheck/build, browser, Android, load, device and pilot remain pending their declared gates.
- Precise stopping point: the evidence defect is append-only corrected in the working tree; the correction is not checkpointed and no valid frozen review exists.
- Next action: checkpoint the three corrected evidence paths, calculate the new complete diff identity with plain `git diff --binary`, then require a replacement independent frozen review before push or PR.

## 2026-09-28 — WF-C6-006 replacement frozen review GREEN

- Fresh author-independent review returned GREEN with zero P0-P3 findings on base/live main/local main/merge-base `147369b5027b9dae7b5a6cb25d9f82711fbdb43b` through clean head `af345a337885ca07fe83e1a0a6dad0572cb05330`.
- It independently reproduced seven paths / 52,498 plain-binary bytes / SHA-256 `6cce6d11115b7994488b961c564cbb953720504935ce3106bd8c28335059c5bc`, below 400 KB, and verified clean start/end plus no live-main drift.
- Writer order, exact replay, same-cycle conflict, later-revision eligibility, index-backed delegate, PostgreSQL harness, existing API containment, bounded scope, PR #473 release evidence, PR #476/#467 integration and all append-only fingerprint corrections passed. Reviewer dependency-backed and heavy gates remained `NOT RUN`.
- Progress remains `DONE 81/161`, `GATES 14/15`, C5 81%, C6 20% and C9 99%; WF-C6-006 remains `PARTIAL` and no credit is added.
- Precise stopping point: the corrected clean source/test/evidence head is independently GREEN; only this three-document review receipt is uncommitted.
- Next action: checkpoint the receipt, independently prove all three reviewed runtime/test blobs unchanged and verify the final diff identity, then push/open the PR and require exact-head CI including real PostgreSQL.

## 2026-09-28 — PR #477 employee-response cycle deduplication released

- Receipt-integrity review returned GREEN with zero P0-P3 at final head `a8c03595966d82ddb0e84b4fc717e7eb6d726d52`: seven paths / 58,087 plain-binary bytes / SHA-256 `aeed0983324147fc6c6fddf76736c12448a8e2eeb1fc5cef50eecee5b7ab2fc0`. The final receipt changed only three append-only docs and all three runtime/test blobs remained byte-identical.
- Exact-head PR run `36405513119` passed `pr-scope`, 12m06s `static-checks` including the real PostgreSQL Workforce race and full unit baseline, and 18m45s `typecheck`. Companion `runner-policy` run `36405513089` and `scan` run `36405513116` passed; production-build was skipped by PR policy.
- PR #477 merged at `2026-09-28T10:06:01Z` as `6b858b4514e58b1d01c1b027d7ce503a7b39b185`. Deploy run `36407634637` completed GREEN at `2026-09-28T10:28:47Z`: quality/security 10m31s, SHA-bound build/publication 16m15s, atomic deploy/post-smokes 6m11s and retention 6s.
- Independent no-cache public reads returned HTTP 200 `{"ok":true}` from `/api/v1/ping` and exact `artifactSha=6b858b4514e58b1d01c1b027d7ce503a7b39b185` with `builtAt=2026-09-28T10:11:46Z` from `/api/v1/public/build-info`. Only GitHub main through `deploy.yml` was used.
- Browser E2E, Android/Gradle, load, signed APK, physical-device and pilot remain `NOT RUN`. Progress remains `DONE 81/161`, `GATES 14/15`, C5 81%, C6 20% and C9 99%; no credit is added.
- Precise stopping point: PR #477 is independently reviewed, merged, deployed and exact-SHA smoke-verified; only this three-document release receipt is uncommitted on clean successor branch `codex/workforce-exception-response-cycle-audit`.
- Next action: checkpoint the release receipt, then implement the independently preflighted bounded aggregate duplicate-cycle dry-run detector without schema mutation, remediation, IDs or UI.

## 2026-09-28 — WF-C6-006 response-cycle aggregate audit working checkpoint

- [`Response-cycle audit evidence`](./workforce-c6-exception-response-cycle-audit-evidence-2026-09-28.md) records the new session/MFA/organization-grant protected dry run. One complete tenant aggregate reports duplicate non-NULL cycle groups, their rows, excess rows and legacy NULL-revision rows without returning record IDs or authorizing mutation.
- The scan runs inside one repeatable-read RLS transaction with fixed 1s lock, 5s statement, 4MB work-memory and 8s transaction bounds. Bigint/malformed/timeout results fail closed. A separate atomic Redis budget charges principal and tenant buckets, and the counts-only append-only audit must finish before the response is released.
- Unit/API coverage passes 3 files / 12 tests and targeted ESLint passes all eight runtime/test paths. The mandatory PostgreSQL file compiles and discovers 14 scenarios, including NOBYPASSRLS two-tenant isolation and exact index/count proof, but all 14 remain locally `SKIPPED / NOT RUN`; both PR and deploy CI execute that file with the approved database.
- No migration, repair, delete/backfill, writer, UI, Android, rollout or production change is included. Full local typecheck/build, real PostgreSQL, browser, Android/Gradle, load, signed device and pilot remain `NOT RUN` under host policy.
- Progress remains `DONE 81/161`, `GATES 14/15`, C5 81%, C6 20% and C9 99%; WF-C6-006 stays `PARTIAL` and no credit is added.
- Precise stopping point: bounded source/API/rate/audit/tests/evidence are implemented and focused checks are green, but task paths are not checkpointed and no frozen complete-diff review exists.
- Next action: checkpoint only the explicit task paths, compute the plain-binary base/head identity, and require a fresh author-independent complete-diff GREEN before push or PR.

## 2026-09-28 — WF-C6-006 response-cycle audit frozen review GREEN

- Author-independent complete-diff review returned GREEN with zero P0-P3 on exact base/live main/merge-base `6b858b4514e58b1d01c1b027d7ce503a7b39b185` through clean head `a864b5bcc756f260679ffa83cbdfd5b56793b3cb`.
- The reviewer independently matched 12 paths / 68,483 plain-binary bytes / SHA-256 `cd66534e4a30a7fb1705aa4c4b398182c9f3088dde782ed77f1dc23721d83d30`, below 400 KB, and verified clean closing state with no live-main drift.
- Authorization, MFA, private containment, atomic two-bucket limiter, complete tenant aggregate, NULL/count failure semantics, transaction-local RLS/timeouts, audit-before-release, no-action scope and the mandatory NOBYPASSRLS PostgreSQL proof all passed static review. Reviewer dependency/heavy checks remained `NOT RUN`.
- Author-side related auth/RLS/MFA/transaction coverage adds 46/46 passing tests without changing the frozen head, in addition to the 12/12 new unit/API tests. Real PostgreSQL, full typecheck/build, browser, Android, load, device and pilot remain `NOT RUN` locally.
- Progress stays `DONE 81/161`, `GATES 14/15`, C5 81%, C6 20% and C9 99%; no task or gate credit is added.
- Precise stopping point: the frozen implementation/evidence checkpoint is independently GREEN; only this three-document review receipt is uncommitted.
- Next action: checkpoint the receipt, independently prove all eight reviewed runtime/test blobs unchanged and verify final diff identity, then push/open the sub-400 KB PR and require every exact-head check including real PostgreSQL.

## 2026-09-28 — PR #479 response-cycle aggregate audit production release

- Final receipt-integrity review returned GREEN with zero P0-P3 at head `aed3cced83df0ef5779a77c1d543d9f448d78021`: 12 paths / 73,245 plain-binary bytes / SHA-256 `9b8d64e5ef810746b85da57bb856291b8eb2ac54416e15bb8a4938d1c41af9e5`. Only three append-only docs changed after frozen review; all eight reviewed runtime/test blobs remained byte-identical.
- Exact-head PR run `36414664981` passed 16s `pr-scope`, 12m12s `static-checks` including the real restricted-role Workforce PostgreSQL proof and full unit baseline, and 18m39s `typecheck`. `runner-policy` run `36414665145` and `scan` run `36414665001` also passed; the PR production build was skipped by design.
- PR #479 merged normally at `2026-09-28T11:36:30Z` as main SHA `29fb2234866c28dd101ad0abaedf8da0548c678e`. Deploy run `36416663752` completed SUCCESS at `2026-09-28T11:57:44Z`: quality/security 9m30s, SHA-bound build/publication 15m14s, atomic deploy/post-smokes 5m39s and retention cleanup 5s.
- Independent no-cache requests forced `app.leaddrivecrm.org` to registered production IP `13.140.132.245`: `/api/v1/ping` returned HTTP 200 `{"ok":true}` and build-info returned HTTP 200 with exact `artifactSha=29fb2234866c28dd101ad0abaedf8da0548c678e` and `builtAt=2026-09-28T11:40:36Z`. Only GitHub main through `deploy.yml` was used.
- Browser E2E, Android/Gradle, load, signed APK, physical-device and pilot remain `NOT RUN`. Progress remains `DONE 81/161`, `GATES 14/15`, C5 81%, C6 20% and C9 99%; WF-C6-006 stays `PARTIAL` and no credit is added.
- Precise stopping point: PR #479 is independently reviewed, merged, deployed and exact-SHA smoke-verified; only this three-document release receipt is uncommitted on clean successor branch `codex/workforce-exception-response-cycle-unique-index`.
- Next action: checkpoint the release receipt, then independently design-audit the bounded online uniqueness-migration prerequisite and recovery contract before any schema change.

## 2026-09-28 — WF-C6-006 concurrent response-cycle unique-index working checkpoint

- [`Unique-index evidence`](./workforce-c6-exception-response-cycle-unique-index-evidence-2026-09-28.md) records one standalone `CREATE UNIQUE INDEX CONCURRENTLY` over organization/case/observed revision. Default NULL-distinct semantics preserve legacy unknown-revision rows; the existing non-unique index remains and Prisma does not claim a nullable `@@unique` contract.
- Deploy pins both migration and aggregate state-query hashes, runs one global BYPASSRLS `REPEATABLE READ READ ONLY` counts/ledger/catalog fence before backup and again immediately before migration, and requires the exact applied postcondition before PM2. Non-zero duplicates, incompatible artifacts, ledger drift and exact unresolved 23505 state all fail closed without automatic repair, drop or resolve.
- The first independent implementation preflight returned RED with one P1 because libpq-only `PGOPTIONS` did not prove bounds inside Prisma's standalone schema engine. That approach was removed. Deploy now validates the canonically provisioned migration-role server defaults through a fresh no-`PGOPTIONS` session (`10s|14min`) and runs ordinary Prisma; the repaired implementation received a fresh independent GREEN with P0-P3 all zero.
- Related migration/deploy/recovery coverage passes 17 files / 80 tests; shell syntax, targeted ESLint, Prisma validation, event-platform asset guard and whitespace pass. The PostgreSQL file discovers 15 scenarios but remains locally `SKIPPED / NOT RUN`; full typecheck/build, browser, Android, load, device and pilot also remain `NOT RUN` under host policy.
- A targeted read-only production probe did not authenticate over the registered SSH alias, so no database command ran and no alternate route was attempted. The workflow's pre-backup fence remains the authoritative production gate.
- Progress remains `DONE 81/161`, `GATES 14/15`, C5 81%, C6 20% and C9 99%; WF-C6-006 stays `PARTIAL` with no credit added.
- Precise stopping point: the repaired five-path implementation, focused verification, evidence and independent working-tree preflight are complete; the task paths are not checkpointed and no clean frozen review exists.
- Next action: remove the temporary dependency link, checkpoint only the explicit task paths, compute the plain-binary base/head identity and require a fresh author-independent complete-diff GREEN before push or PR.

## 2026-09-28 — response-cycle unique-index frozen-review P3 corrections

- The first frozen complete-diff review of checkpoint `f4e622dc18ed332362b7876cd0d9e933c4d621e6` returned RED with P0=0, P1=0, P2=0 and two evidence-only P3 findings; the migration, state query, deploy, provisioning-default and recovery implementation had no finding.
- The PR #479 receipt phrase “only workflow annotation” is superseded by “only warning annotation”; five informational notice annotations also existed and did not change the successful result.
- The unique-index evidence now separates the pre-backup data/ledger/index fence from the post-extraction fresh role-default check immediately before Prisma migration. Unsafe role defaults fail before migration/PM2, not before extraction.
- The rejected review independently reproduced nine paths / 58,227 plain-binary bytes / SHA-256 `54685b941bda03420b71e761d7b9b0678f11682f7a1b166452b961e89a5ecb98`; it grants no merge authority. Progress and all `NOT RUN` labels remain unchanged.
- Precise stopping point: both factual corrections are appended in the working tree; they are not checkpointed and no valid frozen review exists.
- Next action: checkpoint the append-only correction, recompute the complete diff identity and require a replacement author-independent frozen GREEN before push or PR.

## 2026-09-28 — response-cycle unique-index replacement frozen review GREEN

- Fresh author-independent complete-diff review returned GREEN with zero P0-P3 findings on exact base/live main/merge-base `29fb2234866c28dd101ad0abaedf8da0548c678e` through clean corrected head `f674f2c46624ec8cf5d08fc15d8001475c69ddc5`.
- The reviewer independently matched nine paths / 62,005 plain-binary bytes / SHA-256 `9dd6624545a5397b3fd646a22f744b3ca1cc4354d7cbe93ffd3ffebc1420d8ad`, below 400 KB. Five implementation blobs stayed byte-identical to the rejected checkpoint and four document prefixes were preserved exactly.
- Both evidence corrections, migration/state hashes, role-default provisioning/validation boundary, double global fence, ordinary Prisma execution, exact applied postcondition, 23505 containment and no-remediation contract passed. Closing fetch found no drift and the tree remained clean.
- Reviewer dependency-backed and heavy checks remained `NOT RUN`; author checks remain separately labelled. Progress stays `DONE 81/161`, `GATES 14/15`, C5 81%, C6 20% and C9 99%; no credit changes.
- Precise stopping point: the corrected source/migration/test/evidence head has valid independent GREEN; only this three-document review receipt is uncommitted.
- Next action: checkpoint the receipt, independently prove all five reviewed implementation blobs unchanged and verify the final diff identity, then push/open the sub-400 KB PR and require every exact-head context including real PostgreSQL.

## 2026-09-28 — PR #480 merged; deploy failed closed on migration-role defaults

- Final independent receipt-integrity review was GREEN with zero P0-P3 on head `33ea0c353c0be61f837e48a389cc0d7125a05826`; nine paths / 66,513 plain-binary bytes / SHA-256 `4ee528b7b8f08fee4ce990bff8047fc19b02202f6754ce141f3aa3275eec6c14`.
- Exact-head PR CI passed scope, static/unit and real PostgreSQL Workforce recovery gates, typecheck, runner policy, scan and tenant-cascade integration. PR #480 merged at `2026-09-28T13:36:58Z` as main `4f9d0d715b201ca7b4226fb301d1d3bddbbd2c8d`.
- Deploy run `36429869791` passed quality/security and the SHA-bound production build. Its atomic step proved zero response-cycle duplicates and clean ledger/index state, then stopped before Prisma because a fresh migration-role session was not exact `10s|14min`. The previous standalone was restored and PM2 remained unchanged.
- Independent exact-IP public reads returned HTTP 200 ping and prior live `artifactSha=29fb2234866c28dd101ad0abaedf8da0548c678e`; the failed release never served production traffic. Workflow smokes for the new SHA were skipped and are not claimed.
- Failure audit found P0=0, P1=1, P2=2 and P3=1: no supported existing-role reconciliation path, incomplete provisioner postcondition, late detection and weak safe diagnostics. The exact observed timeout pair remains unknown because the log did not emit it and direct SSH was unavailable.
- Progress remains `DONE 81/161`, `GATES 14/15`, C5 81%, C6 20% and C9 99%; WF-C6-006 remains `PARTIAL`. A merged-but-not-deployed migration adds no roadmap credit.
- Precise stopping point: production safely remains on `29fb223...`; a clean remediation branch now starts from merged main `4f9d0d...`.
- Next action: review, CI and release the exact bounded migration-role defaults reconciliation, then rerun the unchanged uniqueness migration and exact-SHA public smoke.

## 2026-09-28 — migration-role defaults reconciliation working checkpoint

- Added one SHA-256-pinned artifact helper. A normal exact-main deploy runs it before backup/extraction; preflight-only runs its read-only check mode. It accepts only legacy `0` or the reviewed `10s`/`14min` values, refuses every other nonzero setting, alters only the connected role in the connected database, verifies a fresh no-`PGOPTIONS` session, and never prints the URL.
- The immediate pre-Prisma role-default check remains unchanged as an independent TOCTOU postcondition. Data repair, index drop, migration resolve and tenant-row mutation remain forbidden.
- The canonical provisioner now verifies lock, statement and idle-in-transaction defaults rather than only lock timeout. The PostgreSQL harness now covers an unexpected 5s refusal, legacy transition, idempotence, database-specific scope, application-role non-mutation and ordinary Prisma execution.
- Shell syntax and whitespace pass. Dependency-backed unit/ESLint, real PostgreSQL, full typecheck/build, browser, Android, load, signed APK, physical-device and pilot are `NOT RUN` at this working checkpoint; exact-head CI is mandatory.
- Progress remains `DONE 81/161`, `GATES 14/15`, C5 81%, C6 20% and C9 99%; no credit changes.
- Precise stopping point: remediation source/tests/runbook/evidence are present in the working tree on `codex/workforce-migration-role-timeout-reconcile`; no checkpoint or frozen independent implementation review exists yet.
- Next action: finish targeted verification, checkpoint explicit paths, obtain a fresh author-independent complete-diff GREEN, then open the sub-400 KB PR.

## 2026-09-28 — migration-role defaults replacement preflight GREEN

- The first remediation preflight was RED only for two P3 evidence gaps: missing explicit supersession of old no-repair wording and no executable real-PostgreSQL `--check` proof. Both are corrected without changing the helper, deploy or provisioner blobs.
- Fresh author-independent replacement review is GREEN with P0=P1=P2=P3=0. It confirmed ordinary-role self-default authority, atomic `DO`, strict nonzero refusal, artifact/hash binding, check/reconcile ordering, preflight non-mutation, safe logging, database/application-role scope and unchanged pre-Prisma gate.
- The database harness now executes legacy and partial `--check` failure without catalog mutation, separate unexpected lock and statement refusal, accepted partial reconciliation, exact `--check` success without catalog mutation, idempotence and Prisma inheritance.
- Local focused results are 20 static files / 100 tests PASS, 15 real-PG scenarios discovered but `SKIPPED / NOT RUN`, targeted ESLint PASS, `bash -n` PASS, whitespace PASS and event-platform assets PASS. Full local typecheck/build and all browser/Android/load/device/pilot evidence remain `NOT RUN`; exact-head CI is mandatory.
- Progress remains `DONE 81/161`, `GATES 14/15`, C5 81%, C6 20% and C9 99%; no credit changes.
- Precise stopping point: the complete working diff is independently GREEN; only this append-only review receipt remains uncommitted.
- Next action: checkpoint all explicit remediation paths, freeze exact base/head identity, obtain receipt-integrity review, then push/open the sub-400 KB PR.

## 2026-09-28 — migration-role defaults frozen review GREEN

- Clean checkpoint `eee4ea1699614d50397384d7b0564a3069469882` received author-independent GREEN with P0=P1=P2=P3=0 against exact live main/merge-base `4f9d0d715b201ca7b4226fb301d1d3bddbbd2c8d`.
- Independent identity matched nine paths / 44,802 plain-binary bytes / SHA-256 `ad9af6c73192bae088103eb4f5b9d6c39039c5de97476dd1acaab95a813f24e1`, below 400 KB. Start/end were clean and drift-free.
- Helper hash/binding, strict refusal, atomic self-role change, read-only preflight, fresh-session postcondition, early ordering, database-only scope, idempotence, later gate and all append-only evidence passed.
- Reviewer `bash -n`, whitespace, targeted Vitest and ESLint passed. Real PostgreSQL, ShellCheck and heavy gates remained `NOT RUN`; exact-head CI remains mandatory.
- Progress stays `DONE 81/161`, `GATES 14/15`, C5 81%, C6 20% and C9 99%; no credit changes.
- Precise stopping point: implementation/evidence checkpoint is independently GREEN; only this three-document review receipt is uncommitted.
- Next action: checkpoint the receipt, obtain final blob-integrity/fingerprint proof, then push/open the PR and wait for all exact-head contexts.

## 2026-09-28 — PR #481 remediation and exact-SHA production release

- Final receipt-integrity review was GREEN with zero P0-P3 at head `d768dc167a65123c1a590c0889c841ec8b6205bf`: nine paths / 48,325 plain-binary bytes / SHA-256 `5c1c5c960195ff70bb3b2f75cda5e7b1214a5708fa74f746e6d13d5ad9730aa6`; all six reviewed non-receipt blobs were unchanged.
- PR #481 passed scope, 10m37s static/unit and real PostgreSQL Workforce gates, 14m16s typecheck, runner policy, scan and tenant-cascade integration. It merged normally at `2026-09-28T15:01:32Z` as main `f6b4c06dad08c72534174a8c004c325c417238cf`.
- Deploy run `36440433296` completed SUCCESS at `2026-09-28T15:28:29Z`. The helper observed accepted legacy `0|0`, reconciled and fresh-session proved `10s|14min`; both global Workforce fences passed; backup `backup-20260928-172602` was created; migration `20260928123000_workforce_exception_response_cycle_unique_index` applied; and its exact unique-ledger/data/index postcondition passed before the process swap completed.
- Built-in smoke passed. Independent no-cache requests forced `app.leaddrivecrm.org` to `13.140.132.245`: ping returned HTTP 200 `{"ok":true}` and build-info returned HTTP 200 with exact `artifactSha=f6b4c06dad08c72534174a8c004c325c417238cf` and `builtAt=2026-09-28T15:09:20Z`. Only GitHub `main` through `deploy.yml` was used.
- Browser E2E, Android/Gradle, load, signed APK, physical-device and pilot evidence remain `NOT RUN`. Progress remains `DONE 81/161`, `GATES 14/15`, C5 81%, C6 20% and C9 99%; WF-C6-006 stays `PARTIAL` and this release adds no synthetic acceptance credit.
- Precise stopping point: PR #481 is independently reviewed, merged, deployed and exact-SHA production-verified; this append-only release receipt is uncommitted on successor branch `codex/workforce-android-exception-response`.
- Next action: checkpoint the release receipt, then implement the bounded Android revision-bound acknowledgement/encrypted-outbox slice for WF-C9-006, WF-C6-006, WF-C9-010 and WF-C9-012 as a separate sub-400 KB reviewable PR.

## 2026-09-28 — C6/C9 Android revision-bound acknowledgement working checkpoint

- [`Android exception-response evidence`](./workforce-c9-android-exception-response-evidence-2026-09-28.md) records a fail-closed consumer of the exact server-offered current-revision acknowledgement. The direct attempt and encrypted replay share one UUID; the request body contains only operation ID and expected revision, and no local success is projected before fresh server truth.
- The new encrypted outbox domain retains the existing account fence, seven-day/eight-attempt bounds and oldest-first ordering. Dedicated pending-state aliases make its rows invisible to an older APK's exact pending SQL without changing the Room schema; this version resumes them after re-upgrade.
- Exact account/domain aggregate counts prevent the recovery center's latest-100 display bound from hiding an older pending response. Active delivery blocks a new action; terminal conflict/review remains visible but cannot deadlock a newly offered fresh revision. Old cards are removed before refresh, and same-tick/current-card/cancellation fences are explicit.
- Initial independent preflight found the terminal-row deadlock and blocked the snapshot. After repair, replacement read-only preflight returned GREEN with P0=P1=P2=P3=0 on nine source/test/resource paths / 72,672 plain-binary bytes / SHA-256 `0e8068b59fc3a35bc8aa67ea3d0fa50f0479f449419382e9d9b00e606442b5f6`.
- Focused checks pass: Android source contract 22/22, existing mobile exception GET/POST/writer/operation 43/43, scoped ESLint, 265-key EN/RU/AZ parity, three-catalog XML parse and whitespace. Android Gradle/Room instrumentation, signed APK, physical device/accessibility, browser, load and pilot remain `NOT RUN` under host policy.
- Progress remains `DONE 81/161`, `GATES 14/15`, C5 81%, C6 20% and C9 99%. WF-C6-006/WF-C9-006/WF-C9-010/WF-C9-012 stay `PARTIAL`; no credit is added.
- Precise stopping point: source, tests, translations and initial evidence are complete and working-tree preflight is GREEN, but the explicit task paths are not checkpointed and no clean frozen review exists.
- Next action: repeat focused checks, checkpoint only the explicit task paths, freeze exact base/head identity and require fresh author-independent complete-diff GREEN before push or PR.

## 2026-09-28 — C6/C9 Android acknowledgement frozen review GREEN

- Fresh author-independent complete-diff review returned GREEN with P0=P1=P2=P3=0 on exact base/live main/merge-base `f6b4c06dad08c72534174a8c004c325c417238cf` through clean head `3204bd3b09bbf13eee886c1e1a24a85fb8a64758`.
- Independent identity matched 13 paths / 93,776 plain-binary bytes / SHA-256 `45928568b9e9935fa0a1b5c6250a040d2c95ba8e9458ee3b75b0282d821ad569`, below 400 KB. Clean start/end, no main drift and all three existing append-only prefixes passed.
- Wire, auth/account, UUID/replay, retry/conflict, encryption, downgrade, Room-v2, exact recovery, terminal recovery, UI-race/cancellation, no-optimistic-ACK, i18n/a11y and evidence contracts passed. Reviewer repeated 22/22 Android source tests, 43/43 server tests, ESLint, parity/XML and whitespace checks.
- Android Gradle/Room instrumentation, signed APK, physical accessibility/device, browser, load and pilot remain `NOT RUN`; exact-head PR CI is mandatory. Progress remains `DONE 81/161`, `GATES 14/15`, C5 81%, C6 20% and C9 99%, with no credit added.
- Precise stopping point: the clean implementation/evidence checkpoint is independently GREEN; only this three-document receipt is uncommitted.
- Next action: checkpoint the receipt, prove all nine reviewed runtime/test/resource blobs unchanged, verify final identity, then push/open the PR and wait for all exact-head contexts including Android.

## 2026-09-28 — PR #482 first Android CI compile repair

- PR #482 opened on independently reviewed head `c9a3fb1b386f05879a51edd083f5209f256c2fca`. Scope, runner policy and scan passed; path-triggered Android run `36452049554` failed only at new unit-test Kotlin compilation after production Kotlin had compiled.
- Kotlin 2 rejected inferred heterogeneous `arrayOf` rows with `TYPE_INTERSECTION_AS_REIFIED_ERROR`. The bounded repair declares each malformed-offer row as `arrayOf<Any?>`; the new outbox helper also drops one compiler-reported redundant exhaustive `else` without changing behavior.
- Targeted source contract stays 22/22, scoped ESLint and whitespace pass. Android Gradle remains `NOT RUN` locally and must rerun in exact-head CI. Prior reviews do not transfer to changed bytes.
- Progress remains `DONE 81/161`, `GATES 14/15`, C5 81%, C6 20% and C9 99%; no credit changes.
- Precise stopping point: two repaired code/test paths and this append-only failure receipt are uncommitted; PR #482 remains open and unmergeable until replacement review and all new-head checks pass.
- Next action: checkpoint the five explicit repair/evidence paths, obtain fresh independent complete-diff GREEN, push the new head and require a clean Android plus standard CI rerun.

## 2026-09-28 — PR #482 Android repair replacement review GREEN

- Fresh complete-diff review returned GREEN with P0=P1=P2=P3=0 on exact base/current main `f6b4c06dad08c72534174a8c004c325c417238cf` through clean head `4b7103f4d7c06f56ee14d62c7fa4ef7b462a970f`.
- Independent identity matched 13 paths / 102,504 plain-binary bytes / SHA-256 `0c85f0a49c461f735429dae89ce8cb66537b29deb0a342a1351804ed9b928da7`. All 15 explicit nullable-any arrays preserve the rejected head's inputs; outbox runtime changes only by the safe redundant-branch deletion.
- Reviewer repeated 22/22 source and 43/43 server tests, ESLint, 265/265/265 XML/parity and whitespace. Android Gradle/device heavy gates remain `NOT RUN` locally and must pass on the new PR head.
- Progress remains `DONE 81/161`, `GATES 14/15`, C5 81%, C6 20% and C9 99%; no credit changes.
- Precise stopping point: replacement reviewed repair/evidence head is clean; only this three-document review receipt is uncommitted and PR #482 still points to the old failed head.
- Next action: checkpoint the receipt, obtain final blob/fingerprint integrity GREEN, push the repaired head and wait for every exact-head gate.

## 2026-09-28 — PR #482 Android acknowledgement production release

- Final receipt-integrity review returned GREEN with zero P0-P3 at exact head `2d1090e9f0050f8097abe0c4b6331cf8a06254df`: 13 paths / 106,240 plain-binary bytes / SHA-256 `46cfbd5b33b624796c385e34b43224e4ff2fd9b656bf23fc0b8e845b35d96905`. Only three append-only documents changed after repair review; all nine runtime/test/resource blobs and the inherited unique-index evidence remained byte-identical.
- Exact-head PR checks passed: 14s `pr-scope`, 17s `runner-policy`, 21s `scan`, 2m20s Android debug lint/unit, 11m05s `static-checks` and 19m40s `typecheck`. The PR production-build job was skipped by policy and is not reported as passed.
- PR #482 merged normally at `2026-09-28T17:12:42Z` as main `a6f6a7cf1a22a541a9de56d773ea811d8bb9ab44`. Deploy run `36456523638` completed SUCCESS at `2026-09-28T17:36:38Z`; quality/security, SHA-bound build/publication, immutable staging, atomic deploy, scheduler/tenant-isolation verification, built-in production smoke and retention cleanup passed.
- Independent no-cache requests forced `app.leaddrivecrm.org` to `13.140.132.245`: ping returned HTTP 200 `{"ok":true}` and build-info returned HTTP 200 with exact `artifactSha=a6f6a7cf1a22a541a9de56d773ea811d8bb9ab44` and `builtAt=2026-09-28T17:19:38Z`. Release used only GitHub `main` through `.github/workflows/deploy.yml`.
- Room instrumentation, signed APK, physical-device offline/retry/account/locale/accessibility, browser E2E, load and pilot remain `NOT RUN`. Progress remains `DONE 81/161`, `GATES 14/15`, C5 81%, C6 20% and C9 99%; affected tasks stay `PARTIAL` and no acceptance credit is added.
- Precise stopping point: PR #482 is independently reviewed, merged, deployed and exact-SHA production-verified; this three-document release receipt is uncommitted on clean successor branch `codex/workforce-android-foundation-v2-part4`.
- Next action: checkpoint the receipt, then use the roadmap and current main to select an independently reviewed sub-400 KB technically feasible C0-C14/M0-M6 slice.

## 2026-09-28 — restricted evidence timeline frozen review GREEN

- The prior release receipt was checkpointed as `6eccfa845b167eb4a9e40cdd1318da5da8be36bd`. A visible derived-only review page, bounded named target search, shared access resolver, strict ID-free parser and EN/RU/AZ UI were then implemented on current main `a6f6a7cf1a22a541a9de56d773ea811d8bb9ab44`.
- Initial independent review was RED (`P0=0`, `P1=1`, `P2=5`, `P3=3`) and no authority transferred from it. Repairs added an organization+principal remount fence, abort/stale-response guards, wildcard-query rejection, explicit purpose/reason and tenant dates, request/response binding, safe localized reason categories, focus restoration, concise live status and long-label containment. A follow-up P3 for repeated mapped categories was repaired with stable de-duplication and a real four-code regression.
- Fresh complete-diff review returned GREEN with `P0=P1=P2=P3=0` on exact head `c2f4c9ab2b3c22c3d51a296bfcbfbeade2fa692f`. Independent identity matched 18 paths / 112,395 plain-binary bytes / SHA-256 `cd2a00b8ad84ac14c3dcd9d656071eecdca7b24b16374917a316099176e12db4`; origin main and merge-base both remained `a6f6a7cf1a22a541a9de56d773ea811d8bb9ab44`.
- Author checks pass 11 files / 97 tests, full task-scoped ESLint, 23,712-key EN/RU/AZ parity, JSON parsing and whitespace. Reviewer checks pass 7 files / 32 tests, targeted ESLint, parity, diff-check and existing append-only prefixes.
- Local full typecheck attempted but exited 134 at the standard Node 2 GB heap and is not counted as passed. Full typecheck/build, browser E2E, real keyboard/AT/contrast/200% zoom, Android/Gradle, load, signed APK, physical-device and pilot evidence remain `NOT RUN`; exact-head PR CI is mandatory.
- Progress remains `DONE 81/161`, `GATES 14/15`, C5 81%, C6 20% and C9 99%. WF-C8-009/WF-C8-010/WF-C10-006 remain `PARTIAL`; no task or gate credit is added.
- Precise stopping point: reviewed runtime/test/i18n head is GREEN; this three-document evidence receipt is the only working-tree delta.
- Next action: checkpoint the receipt, independently prove reviewed blob identity and final fingerprint, then push/open the sub-400 KB PR and require all exact-head contexts.

## 2026-09-28 — PR #483 first CI findings repaired

- PR #483 opened on exact independently GREEN head `a2ad15dee13d464d039cb31ab318c312b89dcbcb`. Run `36473500283` passed scope, runner policy and scan, but correctly blocked on two menu-derived voice coverage omissions and two new closed-union privacy-log TS2322 errors. The skipped PR production build is not a pass.
- No baseline or gate changed. `workforce_evidence` now has a truthful voice guide plus a `surface` classification with no generic aggregate. Privacy logging now admits only the two new fixed labels, never an error or user input; the directory row has explicit exact nullability and failure coverage proves 503 plus the safe label.
- Author checks pass the two formerly failing coverage files 10/10, wider voice 7 files / 62 tests, evidence 11 files / 98 tests, complete task-scoped ESLint and whitespace. Fresh independent review passes its focused 2 files / 12 tests and expanded 11 files / 101 tests.
- Replacement complete-diff review is GREEN with `P0=P1=P2=P3=0` on exact clean head `87d8f4e7115f8abb190f5c811512e8715f7eda06`: 22 paths / 134,054 plain-binary bytes / SHA-256 `858ae69e409a97772ab6bf018136f064687d39aeb08afe82480a61350a70d0cf`.
- Full replacement typecheck/static/build, browser E2E, real keyboard/AT/contrast/200% zoom, Android/Gradle, load, signed APK, physical-device and pilot evidence remain `NOT RUN` on the repaired head; exact-head PR CI is mandatory.
- Progress remains `DONE 81/161`, `GATES 14/15`, C5 81%, C6 20% and C9 99%. WF-C8-009/WF-C8-010/WF-C10-006 remain `PARTIAL`; no credit changes.
- Precise stopping point: repaired code/test head is independently GREEN; this three-document CI/review receipt is the only working-tree delta and PR #483 still points to the rejected old head.
- Next action: checkpoint the receipt, obtain final implementation-blob/fingerprint integrity GREEN, push the replacement head and require every exact-head context to rerun.

## 2026-09-28 — PR #483 restricted evidence timeline production release

- Final independent receipt-integrity review was GREEN with zero P0-P3 at
  exact head `99ed0a3641e3f3c102e57459230d66a615794d6f`: 22 paths / 140,368
  plain-binary bytes / SHA-256
  `bc8370a821dc7b01fe0076c5c7a10455a35d5bbdecd77e812992dfcc926e1d39`.
- Exact-head `pr-scope`, `static-checks`, `typecheck`, `runner-policy` and
  `scan` passed. The PR production-build job was skipped by policy. PR #483
  merged normally at `2026-09-28T20:25:23Z` as main
  `90ad3df47b5e6703b80097afcd5dd74378d4e995`.
- Deploy run `36479079543` completed SUCCESS at
  `2026-09-28T20:51:41Z`, including quality/security, immutable SHA-bound
  build/artifact, atomic production deployment, scheduler and tenant-isolation
  verification, and built-in post-deploy smoke.
- Independent no-cache HTTPS checks pinned the public hostname to registered
  production `13.140.132.245`: ping returned HTTP 200 `{"ok":true}` and
  build-info returned HTTP 200 with exact
  `artifactSha=90ad3df47b5e6703b80097afcd5dd74378d4e995` and
  `builtAt=2026-09-28T20:31:13Z`. Only GitHub `main` through `deploy.yml` was
  used.
- Browser E2E, real keyboard/AT/contrast/200% zoom, Android/Gradle, load,
  signed APK, physical-device and pilot evidence remain `NOT RUN`. Progress
  remains `DONE 81/161`, `GATES 14/15`, C5 81%, C6 20% and C9 99%;
  WF-C8-009/WF-C8-010/WF-C10-006 stay `PARTIAL` with no synthetic credit.
- Precise stopping point: PR #483 is independently reviewed, merged, deployed
  and exact-SHA production-verified; its append-only release receipt is
  uncommitted on successor branch `codex/workforce-site-transition-order-part5`.
- Next action: checkpoint the release receipt, then finish and freeze the
  independently preflighted sub-400 KB WF-C2-009 action-time ordering and
  review-only impossible-transition slice.

## 2026-09-28 — WF-C2-009 action-time ordering working checkpoint

- PR #483's exact-SHA release receipt was checkpointed as
  `f8ed2ddb4` on successor branch
  `codex/workforce-site-transition-order-part5` from merged/deployed main
  `90ad3df47b5e6703b80097afcd5dd74378d4e995`.
- The bounded backend slice now requires an earlier tenant/employee/workday
  scoped departure from the exact previous immutable SITE segment before a
  later SITE arrival. Replay remains first; a missing predecessor is a
  write-free retryable conflict.
- Complete immutable circle snapshots feed the existing review-only evaluator
  with conservative edge-to-edge distance. Impossible speed is a review hint,
  not rejection or guilt; delayed claims keep `DELAYED_CLAIM` primary and only
  the safe secondary risk code reaches audit. Missing geometry invents no
  signal and raw geometry/measurements never enter the row, response or audit.
- Initial independent preflight returned RED for one P2 malformed-mode gap.
  Strict six-mode, SITE-only-site, duplicate and malformed fail-closed parsing
  repaired it. Replacement independent review is GREEN with zero P0-P3 on
  five runtime/test files / 26,207 bytes / SHA-256
  `4357fb9a5b90e83a849e73fdd77ecfe47d68b104c62858c3ce5cc1cc8a835edd`.
- Focused author checks pass 4 files / 25 tests, scoped ESLint and whitespace.
  Full typecheck/suite/build, real PostgreSQL concurrency, browser, Android,
  load, physical-device and pilot checks remain `NOT RUN`; exact-head CI is
  mandatory.
- Progress remains `DONE 81/161`, `GATES 14/15`, C2 73%, C5 81%, C6 20% and
  C9 99%. WF-C2-009 stays `PARTIAL` until frozen exact-head CI passes; no
  provisional task or gate credit is added.
- Precise stopping point: the repaired runtime/test diff is independently
  GREEN and the initial evidence is present, but the explicit task paths are
  uncommitted and no frozen exact-commit review exists.
- Next action: checkpoint the explicit WF-C2-009 paths, prove the frozen diff
  and append-only receipts independently, then push/open a sub-400 KB PR and
  require every exact-head gate.

## 2026-09-28 — WF-C2-009 frozen integration review GREEN

- Checkpoint `6974b5ced4ad41097c5d08ae1de6b203c90e36e8` received frozen
  author-independent GREEN. During review, main advanced through unrelated PR
  #485 MTM map/period paths; a normal conflict-free merge produced clean head
  `4c3121ac4f042acca92bd6ebbb484209f10c4046` on exact current main/merge-base
  `8de4e7e7c952740644ee8eb0755f680b949ddcbf`.
- Fresh integration review returned `P0=P1=P2=P3=0`. The PR diff remains
  exactly 9 task paths / 42,937 plain-binary bytes / SHA-256
  `4a65114f08790df5fc9128abe2a5b256f0329725558204136f31e40849eac0a5`;
  the five runtime/test blobs still match the prior GREEN 26,207-byte
  fingerprint `4357fb9a5b90e83a849e73fdd77ecfe47d68b104c62858c3ce5cc1cc8a835edd`.
- Reviewer repeated 4 files / 25 tests, scoped ESLint and exact-range
  whitespace. All four documents remain append-only; the merge commit adds no
  manual conflict resolution or unrelated PR-diff path.
- Full TypeScript, full suite/build, PostgreSQL integration, browser, Android,
  load, physical-device and pilot checks remain `NOT RUN`; exact-head CI is
  mandatory. Progress stays `DONE 81/161`, `GATES 14/15`, C2 73%, C5 81%,
  C6 20% and C9 99%; WF-C2-009 remains `PARTIAL` with no provisional credit.
- Precise stopping point: the integrated source/test/evidence head is clean
  and independently GREEN; only this three-document review receipt is
  uncommitted.
- Next action: checkpoint the receipt, independently prove source/test blob
  identity and final fingerprint, then push/open the PR and require all
  exact-head contexts.

## 2026-09-28 — WF-C2-009 exact-head release GREEN

- PR #486 froze exact head `f82c52499dd1c23cceb6986e6dd4ef44c6c05092`.
  Independent final integrity review was GREEN with `P0=P1=P2=P3=0` on exactly
  9 paths / 47,731 plain-binary bytes / SHA-256
  `4c9dfd42e3d1fd9d15a48a3910edf5e6ea64c3b80e28483ab045904ad74fa11d`;
  the reviewed five-path runtime/test fingerprint remained
  `4357fb9a5b90e83a849e73fdd77ecfe47d68b104c62858c3ce5cc1cc8a835edd`.
- Exact-head PR run `36484581751` passed `pr-scope`, `static-checks` and
  `typecheck`; the separate exact-head `runner-policy` and `scan` contexts also
  passed. The scope-conditioned PR production-build job was `SKIPPED`, not
  represented as a pass.
- PR #486 merged normally without bypass at `2026-09-28T21:28:27Z` as main SHA
  `7347e87eca493b9d663dc8e66096bc7afb603abb`. Deploy workflow
  `36486330464` completed `SUCCESS` at `2026-09-28T21:51:06Z`, including the
  full quality/security job, SHA-stamped production build, atomic rollout and
  workflow post-deploy smoke.
- Independent no-cache checks pinned to the sole approved production IP
  `13.140.132.245` returned HTTP 200 from `/api/v1/ping` with `{"ok":true}`
  and HTTP 200 from `/api/v1/public/build-info`; `artifactSha` exactly matched
  `7347e87eca493b9d663dc8e66096bc7afb603abb` and `builtAt` was
  `2026-09-28T21:33:21Z`.
- `WF-C2-009` is therefore `DONE`. Progress is now `DONE 82/161`,
  `GATES 14/15`, C2 82%, C5 81%, C6 20% and C9 99%. The remaining register is
  79 non-DONE rows plus one gate; the historical `HRM 99%` label described a
  narrower release-readiness slice and must not be read as 99% of this ledger.
- Browser E2E, Android/Gradle, load, signed APK, physical-device and human-pilot
  evidence remains `NOT RUN`; this backend row does not convert those external
  gates into passes.
- Precise stopping point: PR #486 is independently reviewed, exact-head green,
  merged, deployed and exact-SHA production-verified; this release receipt is
  present on successor branch `codex/workforce-timesheet-rehydration-part6`.
- Next action: checkpoint this receipt, then implement bounded `WF-C11-001`
  immutable timesheet rehydration/property evidence. `WF-C10-011` remains
  planned because its required real dashboard/privacy/cardinality review
  cannot be replaced by code-only evidence.

## 2026-09-29 — WF-C11-001 immutable rehydration working checkpoint

- The complete policy, shift and v2 schedule snapshots are now identity- and
  hash-verified before a timesheet can be calculated. Persisted denormalized
  policy values and resolved shift UTC instants must reproduce their immutable
  definitions; calendar, segment order, site references and planned breaks
  must reproduce the complete schedule hash.
- Calculation envelope v2 keeps the v1 arithmetic projection while binding it
  to minimized immutable hashes and explicit semantics: only actual
  Pause/Resume deducts time, travel is non-payroll and does not alter time,
  expected work is calendar/policy pinned, exceptions block approval and
  corrections replay from the immutable ledger. Raw site details and geometry
  remain outside the calculation/export projection.
- Legacy stored v1 approvals remain hash-verifiable/exportable. Complete v2
  periods are approval-ready; mixed v1/v2 periods fail closed, and old
  policy/shift-only workdays remain explicitly snapshot-missing rather than
  being silently upgraded.
- Author checks pass 7 focused files / 75 tests, scoped ESLint and whitespace.
  A separate preliminary read-only consumer audit is GREEN with
  `P0=P1=P2=P3=0` and independently passes 4 files / 17 tests.
- Full TypeScript/suite/build, browser, Android/Gradle, load, signed APK,
  physical-device and pilot checks remain `NOT RUN`; exact-head CI is
  mandatory. Progress stays `DONE 82/161`, `GATES 14/15`, C11 80%;
  WF-C11-001 remains `PARTIAL` with no provisional credit.
- Precise stopping point: the runtime/test implementation and initial evidence
  are present but uncommitted; there is no frozen exact-commit review yet.
- Next action: repeat the bounded verification, measure/stage only explicit
  paths, checkpoint the candidate, then obtain fresh author-independent
  exact-SHA review before push or PR.

## 2026-09-29 — WF-C11-001 frozen integration review GREEN

- Implementation/evidence checkpoint
  `5f72c200e4d88966a2ff48485839f5b685a5b612` was independently GREEN from
  deployed main. During review, main advanced through PR #487 only in four
  unrelated Social Monitoring cron paths; a normal conflict-free merge
  produced integration head `b3bbf10eb6057c6357f3fec26453480a66caf7bb`
  on exact fresh main/merge-base
  `20bc83fb1d16b268ecbde9288f8043809651d660`.
- Fresh author-independent integration review returned
  `P0=P1=P2=P3=0`. The complete candidate is 14 paths / 83,413 plain-binary
  bytes / SHA-256
  `e31e7ff1c627cb7ca938716be80d469522ace438719358ded2d20c7c5109ab49`;
  all ten WF-C11 runtime/test blobs are byte-identical to the pre-integration
  checkpoint and the merge added no manual conflict resolution.
- Reviewer checks pass 9 files / 81 tests, scoped ESLint and exact-range
  whitespace. Full TypeScript/suite/build, browser, Android/Gradle, load,
  signed APK, physical-device and pilot checks remain `NOT RUN`; exact-head CI
  is mandatory.
- Progress stays `DONE 82/161`, `GATES 14/15`, C11 80%; WF-C11-001 remains
  `PARTIAL` with no credit before exact-head CI, merge and production receipt.
- Precise stopping point: integrated source/test/evidence head is clean and
  independently GREEN; only this three-document review receipt is uncommitted.
- Next action: checkpoint the receipt, independently verify final
  implementation-blob identity and candidate fingerprint, then push/open the
  sub-400 KB PR and require every exact-head context.

## 2026-09-29 — WF-C11-001 exact-head type fixture repair

- PR #488 opened at independently reviewed head
  `02b374048534e7d34ebc089d4736028bae423ff8`. Exact-head `pr-scope`,
  `static-checks`, `runner-policy` and `scan` passed; the scope-conditioned
  production build was `SKIPPED` and is not counted.
- Typecheck run `36493981438` correctly failed its defect-shaped baseline gate
  on five legacy v1 test fixtures. The new discriminated v1/v2 calculation
  type caused their inferred `calculationVersion: 1` fields to widen to
  `number`; this was a real compatibility typing gap, not an accepted baseline
  change.
- The bounded repair adds `as const` only to those row/calculation
  discriminators in report, approved export/preview and legacy export tests.
  Runtime code, the strict union and the type baseline are unchanged.
- Post-repair author checks pass 11 targeted files / 98 tests, scoped ESLint
  and whitespace. Full local typecheck remains `NOT RUN`; replacement exact-head
  CI must prove the repair. Progress remains `DONE 82/161`, `GATES 14/15`,
  C11 80%; WF-C11-001 remains `PARTIAL`.
- Precise stopping point: the five-file repair and three append-only evidence
  updates are uncommitted; the PR still points to the prior red head.
- Next action: checkpoint the explicit repair/evidence paths, obtain fresh
  author-independent exact-SHA review, then push the replacement head and
  require every gate again.

## 2026-09-29 — WF-C11-001 type repair review GREEN

- Repair checkpoint `a3178eb8c3a14765316a3afac4e906c0c1a1aafb` received fresh
  author-independent GREEN with `P0=P1=P2=P3=0`. The exact prior-head repair
  delta is 8 paths / 11,667 bytes / SHA-256
  `92c4b846d3ec8470c1c2033467b359502f9f2d6f69e467f813d9b11b021f4bf4`;
  the complete candidate is 19 paths / 97,943 bytes / SHA-256
  `ed0feb2c546c7920b2f32741a70a93c5f04775f70519ccc3faa0c99784710be3`.
- The reviewer independently matched the five reported TS2322 diagnostics to
  exactly ten v1 discriminator literal narrowings across five tests. No
  runtime, union, workflow, package or type-baseline change exists; the three
  evidence updates are byte-prefix append-only.
- Reviewer checks pass 11 files / 98 tests, scoped ESLint and repair/full-range
  whitespace. Full typecheck/build/suite/browser/Android/load remain
  `NOT RUN`; replacement exact-head CI remains mandatory.
- Progress remains `DONE 82/161`, `GATES 14/15`, C11 80%; WF-C11-001 remains
  `PARTIAL`. Precise stopping point: the reviewed repair is committed and
  clean; only this three-document receipt is uncommitted.
- Next action: checkpoint the receipt, obtain final exact-head integrity GREEN,
  then push the replacement head and require all contexts again.

## 2026-09-29 — WF-C11-001 exact-head release GREEN

- PR #488 froze final independently reviewed head
  `a90e0981fc8444cc8a2fa7172cf848c31ac8c9b1`: 19 paths / 101,395
  plain-binary bytes / SHA-256
  `8e6bb049e2643993fd885e7df9e4318c0394d5baec52d526ae5538de5c3ac009`,
  with `P0=P1=P2=P3=0`. All fifteen source/test blobs matched the reviewed
  repair checkpoint and the receipt-only delta was append-only.
- Replacement exact-head run `36496540485` passed `pr-scope`,
  `static-checks` and `typecheck`; separate exact-head `runner-policy` and
  `scan` also passed. The scope-conditioned PR production-build job was
  `SKIPPED`, not represented as a pass.
- PR #488 merged normally without bypass at `2026-09-28T23:31:26Z` as main
  SHA `eab1c60de3e56e4ea26001c9ddfd01fc603524a5`. Deploy workflow
  `36498458944` completed `SUCCESS` at `2026-09-28T23:55:50Z`, including
  full quality/security, SHA-bound production build/artifact, atomic rollout,
  post-deploy smoke and artifact retention.
- Independent no-cache checks pinned to the only approved production IP
  `13.140.132.245` returned HTTP 200 from `/api/v1/ping` with `{"ok":true}`
  and HTTP 200 from `/api/v1/public/build-info`; `artifactSha` exactly matched
  `eab1c60de3e56e4ea26001c9ddfd01fc603524a5` and `builtAt` was
  `2026-09-28T23:37:22Z`.
- `WF-C11-001` is therefore `DONE`. Progress is now `DONE 83/161`,
  `GATES 14/15` and C11 90%. The strict register has 78 non-DONE rows plus one
  gate; no browser, Android, load, signed-device or human-pilot evidence is
  inferred from this backend release.
- Precise stopping point: PR #488 is independently reviewed, exact-head green,
  merged, deployed and exact-SHA production-verified; this release receipt is
  uncommitted on clean successor branch `codex/workforce-completion-part7`.
- Next action: checkpoint this receipt, then implement the next independently
  selected technically completable roadmap row in another sub-400 KB PR.

## 2026-09-29 — accepted-task arithmetic reconciliation

- The preceding `DONE 83/161` release count is superseded. A deterministic
  audit of the final active status for all 161 unique `WF-*` identifiers gives
  exactly 80 `DONE`, 55 `PARTIAL`, 16 `PLANNED`, six `OWNER DECISION`, one
  `PARTIAL (OWNER ATTESTATION)` and three `BLOCKED` rows.
- The saved ledger was already three credits above the active task register
  before PR #486 and then incremented normally for WF-C2-009 and WF-C11-001.
  No active row or task-level acceptance receipt supports those three earlier
  credits, so they are removed rather than hidden. The denominator remains
  161; no scope or released implementation is removed.
- Correct progress after the independently reviewed and production-verified
  PR #488 is therefore `DONE 80/161`, `GATES 14/15`, C11 90%, with 81
  non-DONE tasks. Under the printed progress formula the overall completion
  index is 58%, not the historical release-slice label of 99%.
- Precise stopping point: the PR #488 release receipt and this arithmetic
  correction are uncommitted on `codex/workforce-completion-part7`.
- Next action: checkpoint the corrected receipt, then implement independently
  selected `WF-C8-004` as the next bounded sub-400 KB slice without claiming
  browser, physical-device, load or pilot evidence.

## 2026-09-29 — WF-C8-004 complete timesheet working checkpoint

- [`Complete timesheet review evidence`](./workforce-c8-complete-timesheet-evidence-2026-09-29.md)
  records the bounded session-only read model now wired into the existing
  deterministic timesheet: finite event/transition assurance, calculated and
  C6 exception lifecycle, and an exact employee/period immutable revision
  chain verified from stored rows and hashes.
- The ordinary response excludes IDs from the revision projection, hashes,
  rows, reasons, actors, proof and location. The all-employee view does not
  query approval history. Unknown, truncated, non-contiguous or tampered data
  fails closed instead of producing an approval or physical-presence claim.
- EN/RU/AZ UI now presents plan, fact, evidence review, exceptions and the
  minimized approval/correction sequence. Approval readiness is still exactly
  `COMPLETED` plus reproducible calculated history; a missing snapshot cannot
  look approvable.
- Author verification passes 16 targeted files / 121 tests, scoped ESLint for
  all six changed TypeScript paths, JSON parsing, i18n 23,734/0/0 and
  whitespace. Full local typecheck/build/suite, browser/AT, Android/Gradle,
  load, signed-device and pilot evidence remain `NOT RUN` under host policy.
- `WF-C8-004` remains `PARTIAL`; progress stays `DONE 80/161`,
  `GATES 14/15`, C8 27% and overall 58%. No provisional credit is added.
- Precise stopping point: implementation, tests, translations and working
  evidence are present but uncommitted; no frozen exact-SHA independent
  verdict exists yet.
- Next action: measure and checkpoint only the explicit task paths, then obtain
  a fresh author-independent complete-diff review before push or PR.

## 2026-09-29 — WF-C8-004 first frozen review RED and repairs

- The independent review verified clean base/current main/merge-base
  `eab1c60de3e56e4ea26001c9ddfd01fc603524a5`, frozen head
  `6b46c38ea93272d5130de8a94e2fe128b53ca117`, 13 paths / 94,821 binary
  bytes / SHA-256
  `d4b5e413e4926e96874dd2bd48903e457a3ddbb83857cfde4780a845eba569cb`.
  Its verdict was RED: `P0=0`, `P1=1`, `P2=4`, `P3=0`; it grants no release
  authority.
- The P1 was a valid period-bound `NO_SHOW` without a workday disappearing
  from GET while canonical approval correctly blocked it. The four P2s were
  stale calculation-version exceptions, query limits applied only after
  materialization, unresolved exceptions not affecting the ready badge/button,
  and stale revision history after a successful write.
- The replacement queries schedule-only cases even for a zero-workday period
  and exposes only employee/date/type/status; filters calculation exceptions
  to the reconstructed/current or v2-core version; adds Prisma sentinels at
  20,000 events, 10,000 transitions and 5,000 calculated exceptions; makes all
  unresolved visible exceptions non-ready; and refetches history after a
  successful approval/correction.
- Replacement checks pass 18 targeted files / 132 tests, scoped ESLint, JSON,
  i18n 23,737/0/0 and whitespace. Full local typecheck/build/suite,
  browser/AT, Android/Gradle, load, signed-device and pilot evidence remain
  `NOT RUN` under host policy.
- `WF-C8-004` remains `PARTIAL`; progress remains `DONE 80/161`,
  `GATES 14/15`, C8 27% and overall 58%. No credit is added for a repair that
  has not yet received replacement GREEN and release evidence.
- Precise stopping point: all five findings are repaired in the working tree
  with targeted checks green; repairs and this append-only receipt are
  uncommitted on top of the rejected checkpoint.
- Next action: checkpoint only explicit task paths, then require a fresh
  author-independent review of the complete replacement diff from deployed
  main before any push or PR.

## 2026-09-29 — WF-C8-004 replacement review RED and lifecycle repair

- A fresh full review of replacement head
  `ab289618132908ce00c0d5bfcda759332e9b9f67` independently verified the
  four data/readiness repairs from the first RED, but returned a new RED
  verdict `P0=0`, `P1=1`, `P2=0`, `P3=0`. Base/current main/merge-base stayed
  `eab1c60de3e56e4ea26001c9ddfd01fc603524a5`; complete identity was 13 paths /
  116,103 bytes / SHA-256
  `f3b8e3a176c758835dd2029bcef20e4dfa7cb17825da12d56fb536831af61c90`.
- The new P1 was a UI lifecycle regression: the post-success history refetch
  set global loading, unmounted the approval panel and erased the only
  server-returned approval ID, so approved-export preview disappeared. The
  minimized revision history correctly contains no ID and could not restore
  it.
- The repair marks exactly the approval-triggered retry, keeps the loaded
  timesheet/panel mounted during its background request, preserves the local
  record and preview control, and still replaces history on success. A failed
  background refresh keeps the last verified data mounted and shows only the
  localized generic load toast; initial/manual load failure remains unchanged.
- The regression contract now asserts the retry marker, background mount
  condition, stable panel key and preservation branch. Scoped UI tests, ESLint
  and whitespace pass; the complete targeted matrix and fresh frozen review
  remain mandatory.
- `WF-C8-004` remains `PARTIAL`; progress stays `DONE 80/161`,
  `GATES 14/15`, C8 27%, overall 58%. Neither RED review transfers authority.
- Precise stopping point: the lifecycle repair and this append-only
  clarification are uncommitted on top of rejected head `ab289618`.
- Next action: run the complete bounded matrix, checkpoint explicit repair
  paths, then require another author-independent full-range review from zero.

## 2026-09-29 — WF-C8-004 lifecycle repair verification complete

- The pending complete author rerun now passes 18 targeted files / 133 tests,
  full task-scoped ESLint, JSON parsing, i18n 23,737/0/0 and whitespace.
- Full local typecheck/build/suite, browser/AT, Android/Gradle, load,
  signed-device and pilot evidence remain `NOT RUN` under host policy; exact-
  head CI remains mandatory.
- Status and progress are unchanged: `WF-C8-004` is `PARTIAL`,
  `DONE 80/161`, `GATES 14/15`, C8 27%, overall 58%.
- Precise stopping point: the second replacement repair and all receipts are
  verified but uncommitted.
- Next action: checkpoint explicit paths and require a fresh full-range
  author-independent review; no prior RED transfers authority.

## 2026-09-29 — WF-C8-004 third review RED and request-identity repair

- Third fresh review of clean head
  `cb5f31419a73e2b8bf1a2c9c749515e9cadcf01a` returned RED with `P0=0`,
  `P1=1`, `P2=0`, `P3=0`. It independently measured the complete candidate
  as 13 paths / 127,919 binary bytes / SHA-256
  `984184f4d8327294c8864e0ae1f9eb7c2888aaad97afd5eb5e6002840e07c8fc`
  and found no further issue outside the UI load lifecycle.
- The approval retry marker was not consumed, while the old timesheet stayed
  mounted during every load. A later filter/manual/tenant request could leave
  an old approval action interactive and treat its failure as a preserved
  background failure. The earlier statement that ordinary load failure was
  unchanged is superseded by this finding.
- The repair binds preservation to one exact view/tenant/retry/query identity,
  consumes it after live settlement, preserves it across only a cancelled
  Strict Mode restart, and discards it on any competing request. Data is
  rendered only for the current load identity unless that exact approval
  refresh is active; approval is disabled and guarded while it is active.
- Five behavioral lifecycle cases plus the UI integration contract pass 2
  files / 11 tests; scoped ESLint passes. The complete bounded matrix is still
  pending, and no RED verdict grants release authority.
- Status remains `WF-C8-004 PARTIAL`, `DONE 80/161`, `GATES 14/15`, C8 27%,
  overall 58%.
- Precise stopping point: the third P1 repair, tests and append-only receipts
  are uncommitted on top of rejected head `cb5f31419`.
- Next action: run the full targeted slice, checkpoint explicit paths and
  require a fourth fresh full-range author-independent review.

## 2026-09-29 — WF-C8-004 exact-request repair checks complete

- The complete bounded author rerun passes 19 targeted files / 137 tests,
  scoped ESLint for all eight changed runtime/test TypeScript paths, JSON
  parsing, EN/RU/AZ parity at 23,737/0/0 and whitespace.
- Full local typecheck/build/suite, browser/AT, Android/Gradle, load, signed
  APK, physical-device and pilot evidence remain `NOT RUN` under host policy;
  exact-head CI remains mandatory.
- Status remains `WF-C8-004 PARTIAL`, `DONE 80/161`, `GATES 14/15`, C8 27%,
  overall 58%.
- Precise stopping point: verified third-review repair and receipts are
  uncommitted on top of rejected head `cb5f31419`.
- Next action: checkpoint only the seven explicit repair/receipt paths,
  measure the complete candidate and obtain a fourth independent full-range
  verdict from zero.

## 2026-09-29 — WF-C8-004 fourth review RED and approval interlock repair

- Fourth fresh complete-diff review froze
  `c1422649d8044658409295b9aeb840960f56da0a` against unchanged main
  `eab1c60de3e56e4ea26001c9ddfd01fc603524a5`: 15 paths / 150,087 bytes /
  SHA-256
  `f9a9605ce9b337fdc424125009b3e678f7554bb2290e4feaf350b760ec53b8d2`.
  Verdict was RED with `P0=0`, `P1=1`, `P2=0`, `P3=0`; all other audited
  areas remained clear.
- The remaining race preceded the tagged history GET. During the approval POST
  an enabled manual refresh or filter apply could unmount the panel, so its
  eventual success wrote the approval ID only into an obsolete component and
  preview remained unrecoverable from the minimized history.
- One synchronous lifecycle busy interval now spans approval submission and
  the exact tagged refresh. Handler guards block generic reload/filter and
  duplicate approval transport immediately; navigation and every affected
  panel control stay unavailable through the POST-to-GET handoff and refresh
  settlement.
- The added race case and updated UI integration contract pass 2 files / 13
  tests; scoped ESLint passes. Full bounded rerun and fifth review are still
  mandatory.
- Status remains `WF-C8-004 PARTIAL`, `DONE 80/161`, `GATES 14/15`, C8 27%,
  overall 58%.
- Precise stopping point: fourth-review repair/tests/receipts are uncommitted
  on top of rejected head `c1422649d`.
- Next action: rerun the complete targeted slice, checkpoint explicit paths
  and require a fifth independent full-range review from zero.

## 2026-09-29 — WF-C8-004 submission-interlock checks complete

- The first full rerun caught the preview source contract's old guard string;
  the assertion now requires the added busy guard. The replacement complete
  matrix passes 19 files / 139 tests.
- Scoped ESLint for all nine changed runtime/test TypeScript paths, JSON,
  i18n 23,737/0/0 and whitespace pass. Full local typecheck/build/suite,
  browser/AT, Android/Gradle, load, signed-device and pilot remain `NOT RUN`.
- Status remains `WF-C8-004 PARTIAL`, `DONE 80/161`, `GATES 14/15`, C8 27%,
  overall 58%.
- Precise stopping point: the fourth-review repair and final bounded checks
  are complete but uncommitted.
- Next action: checkpoint the eight explicit paths, fingerprint the full
  candidate and obtain a fifth fresh complete-diff independent verdict.

## 2026-09-29 — WF-C8-004 fifth independent review GREEN

- Exact clean head `b506cad5cbced9c131cffd738adc46a9e590753b` received fresh
  author-independent GREEN with `P0=P1=P2=P3=0`. Base/live main/merge-base is
  `eab1c60de3e56e4ea26001c9ddfd01fc603524a5`; full identity is 16 paths /
  164,032 binary bytes / SHA-256
  `d76bd9a9c1f315eb9511143c48ab01982ab36d5a88e250da90336144a6513467`.
- The reviewer rechecked the full data, authority, privacy, bounds, exception,
  hash-chain, readiness, localization and lifecycle surfaces from zero. The
  POST-to-tagged-GET busy interval, Strict Mode restart, success/failure,
  subsequent ordinary request and explicit-period edge all passed with no
  residual finding.
- Reviewer checks pass 19 files / 139 tests, scoped ESLint for nine TS paths,
  JSON, i18n 23,737/0/0, whitespace and append-only journal prefix. Heavy/full
  and physical/browser gates remain `NOT RUN` locally.
- `WF-C8-004` remains `PARTIAL`; progress stays `DONE 80/161`,
  `GATES 14/15`, C8 27%, overall 58%. GREEN permits publication for exact-head
  gates but is not release evidence.
- Precise stopping point: reviewed code head is clean and this three-document
  GREEN receipt is uncommitted.
- Next action: checkpoint the receipt, obtain final exact-head integrity GREEN,
  then push/open the sub-400 KB PR and require every mandatory context.

## 2026-09-29 — PR #489 type gate RED and explicit tuple repair

- PR #489 published exact reviewed head
  `f9f484d8a4ffdf95a3eda4bdc361d91667a1c7f3`. `pr-scope`,
  `static-checks`, `runner-policy` and `scan` passed; the conditional production
  build was `SKIPPED`. Required run `36514032198` failed `typecheck` on seven
  new route diagnostics: `TS2322` x4, `TS2339` x1 and `TS2345` x2.
- TypeScript collapsed the heterogeneous conditional `Promise.all` results to
  their common workday-ID shape, and inferred the current-version list as
  `2[]`. Explicit selected-record/result tuple types and `Array<1 | 2>` repair
  those diagnostics without altering runtime, queries, generated code,
  workflows or the accepted baseline.
- Replacement author checks pass 19 files / 139 tests and all nine-path scoped
  ESLint. Full typecheck is `NOT RUN` locally and remains an exact-head CI
  gate.
- `WF-C8-004` stays `PARTIAL`; progress remains `DONE 80/161`,
  `GATES 14/15`, C8 27%, overall 58%. The prior GREEN is invalidated for the
  changed head.
- Precise stopping point: type-only route repair and this receipt are
  uncommitted on the open PR branch.
- Next action: checkpoint explicit paths, obtain a fresh independent repair and
  full-range verdict, then push and rerun every mandatory context.

## 2026-09-29 — WF-C8-004 post-typecheck-repair review GREEN

- Exact clean head `c494d4ec63d5c46a03b41ef2d0c903ca8872788f` received a
  fresh author-independent GREEN with `P0=P1=P2=P3=0`. Main and merge-base
  remain `eab1c60de3e56e4ea26001c9ddfd01fc603524a5`.
- Repair identity is 4 paths / 8,784 binary bytes / SHA-256
  `143d23fee0b3ac6b0a0fd262c6ec67deec668106021c4665100847c0379b5b06`;
  full identity is 16 paths / 173,780 binary bytes / SHA-256
  `a458f97af4c525ec4d7afeb623af49e787d50fb6e35a2ecc23abfc4d49be9251`.
- The reviewer traced every one of the seven failed CI diagnostics to the
  repaired inference, validated all six selected payloads against generated
  Prisma DMMF and proved the emitted route JavaScript byte-identical before
  and after the repair. No query, runtime, response, workflow or baseline
  behavior changed.
- Reviewer checks pass 19 files / 139 tests, nine-path scoped ESLint, JSON,
  i18n 23,737/0/0, whitespace and append-only prefixes. Full local typecheck
  and all heavy/browser/Android/physical gates remain `NOT RUN`; a bounded
  compiler probe that exhausted the standard 2 GB heap is not evidence.
- `WF-C8-004` remains `PARTIAL`; progress stays `DONE 80/161`,
  `GATES 14/15`, C8 27%, overall 58%. GREEN authorizes replacement exact-head
  CI only.
- Precise stopping point: reviewed repair head is clean; this three-document
  GREEN receipt is uncommitted and PR #489 still points to the rejected head.
- Next action: checkpoint the receipt, obtain exact-head receipt-integrity
  confirmation, push and require all replacement mandatory contexts.

## 2026-09-29 — WF-C8-004 released and DONE

- Final PR head `46f9f602525507d8f3c2b1a6f3148a4ffe323a36` retained the
  independently reviewed 16-path / 178,681-byte candidate with SHA-256
  `08f234b95fbb8721d8cfda6190259376a7cbaadc5de2f5b00063c368bd359cb0`.
  Both independent reviews were GREEN with `P0=P1=P2=P3=0`.
- Replacement run `36518016723` passed all five required exact-head contexts:
  `pr-scope`, `static-checks`, `typecheck`, `runner-policy` and `scan`. The
  scope-conditioned PR production-build job was correctly skipped.
- PR #489 merged normally at `2026-09-29T04:02:27Z` as main SHA
  `f95ec02952c425e97a470aba5d2e591ffb5b9486`. Deploy run `36519816277`
  completed SUCCESS at `2026-09-29T04:23:25Z` through the documented GitHub
  main route, including quality/security, SHA-bound standalone artifact,
  atomic rollout, scheduler/tenant-isolation checks, public ping/revision/login
  and hashed-asset smoke, plus artifact retention.
- Fresh no-cache TLS checks forced `app.leaddrivecrm.org` to the sole approved
  production IP `13.140.132.245`: `/api/v1/ping` returned HTTP 200
  `{"ok":true}` and `/api/v1/public/build-info` returned HTTP 200 with exact
  `artifactSha=f95ec02952c425e97a470aba5d2e591ffb5b9486` and
  `builtAt=2026-09-29T04:08:34Z`.
- `WF-C8-004` is now `DONE`. Progress is `DONE 81/161`, `GATES 14/15`, C8
  36%, overall 59%, with 80 non-DONE rows. Full local typecheck/build/suite,
  browser/AT, Android/Gradle, load, signed APK, physical-device and pilot remain
  `NOT RUN`; exact-head CI supplied the type/build-quality evidence claimed
  above.
- Precise stopping point: production serves exact merged main; this release
  receipt is uncommitted on clean successor branch
  `codex/workforce-completion-part8`.
- Next action: checkpoint the three release records, then implement the
  bounded manager-Today portion of `WF-C8-002` without inferring no-show or
  widening exception access.

## 2026-09-29 — WF-C8-002 bounded manager Today working checkpoint

- Manager Today now starts from a grant-preauthorized, stable 25-row roster
  page and loads names/facts only for the exact authorized IDs. Existing
  workdays use a verified immutable shift snapshot; scheduled employees with
  no workday use one bounded batch resolver with no N+1 reads.
- Calendar state, previous-open state and attendance state remain separate.
  A no-show is never inferred or written by GET: only an unresolved persisted
  C6 case can project `NO_SHOW`.
- Exception visibility requires independent `TEAM_EXCEPTION_READ`; ordinary
  attendance authority returns `exceptions: null`. The queue and Today share
  a two-phase historical-team/site resolver that now authorizes valid
  schedule-only cases from their case-bound first segment.
- The manager UI renders localized EN/RU/AZ plan/calendar/attendance and safe
  type/status exception badges, uses only a generic exception-queue link and
  states the non-presence boundary. Pagination merges only an exact live read
  identity.
- PASS: 6 targeted files / 59 tests, scoped ESLint on 13 changed TS/TSX paths,
  JSON, i18n 23,765/0/0 and whitespace. Full local typecheck/build/suite,
  real browser/AT, Android/Gradle, load, signed-device and pilot are `NOT RUN`.
- An initial independent helper-only audit found two P2 resolver defects
  (lower-priority ambiguity and page-wide invalidation); both are repaired.
  A new clean full-diff review is still mandatory.
- `WF-C8-002` remains `PARTIAL`; progress stays `DONE 81/161`,
  `GATES 14/15`, C8 36%, overall 59%, with 80 non-DONE rows.
- Precise stopping point: implementation, focused verification and evidence
  are complete but uncommitted on `codex/workforce-completion-part8`.
- Next action: checkpoint only the explicit slice paths, freeze/fingerprint
  the full diff and obtain fresh author-independent full-range review.

## 2026-09-29 — WF-C8-002 historical calendar review repair

- Complete review of exact head `eab14f1d4f7393e7509b46cdf812b3198d470912`
  was RED with one P2: Today combined a historical live plan with a mutable
  current-team calendar after same-day transfers.
- Live rows now resolve calendar overrides with the stable historical team at
  planned start. Existing-workday rows use only a schema/link/hash-verified
  immutable schedule calendar and fail closed as `UNAVAILABLE`; current team
  remains only the roster authorization boundary.
- Transfer/divergent-calendar and immutable-workday regressions pass. The
  expanded targeted matrix is 8 files / 72 tests; scoped ESLint on 14
  candidate TS/TSX paths, JSON, i18n 23,766/0/0 and whitespace pass.
- Full local typecheck/build/suite, browser/AT, Android/Gradle, load, signed
  APK, physical-device and pilot remain `NOT RUN` under host policy.
- `WF-C8-002` remains `PARTIAL`; no completion or gate credit is added.
  Progress stays `DONE 81/161`, `GATES 14/15`, C8 36%, overall 59%, with 80
  non-DONE rows.
- Precise stopping point: the reviewed P2 is repaired and bounded checks pass;
  the changed repair plus receipts are uncommitted.
- Next action: checkpoint explicit paths, fingerprint the replacement full
  candidate and obtain a fresh author-independent complete-diff verdict.

## 2026-09-29 — WF-C8-002 replacement review P2x2 repaired

- Independent review matched exact clean range
  `f95ec02952c425e97a470aba5d2e591ffb5b9486..b446ed7d3fe246e6a9a2071ebade0b9448d7098b`
  at 21 paths / 166,274 binary bytes / SHA-256
  `9db5aacacf2e59202871a3f5b0c847da97f9f6a6dd32b4031b616e5b83b0ffcf`
  and returned RED: `P0=0`, `P1=0`, `P2=2`, `P3=0`.
- Finding one rejected the planned-start fixed-point rule: a same-day Team A
  shift followed by a Team B transfer/shift could display the persisted Team A
  no-show against Team B plan/calendar. Authorized schedule-only no-shows now
  use their validated case-bound first segment, date, template lifecycle and
  historical membership. Missing or conflicting contexts fail closed;
  ordinary no-fact live rows have the explicit canonical rule of one
  append-only membership snapshot at the server resolution instant.
- Finding two rejected SELF's independent at-now assignment/policy lookup.
  Today now supplies its exact team/template/scope context and the employee
  loader verifies assignment, schedule fields and policy team at that instant;
  any mismatch closes assignment/action rather than mixing team contexts.
- PASS: expanded 9-file / 84-test targeted matrix, scoped ESLint on all 16
  full-candidate TypeScript/TSX paths, JSON catalogs, i18n 23,766/0/0 and
  whitespace. Full local typecheck/build/suite, browser/AT, Android/Gradle,
  load, signed-device and pilot remain `NOT RUN` under host policy.
- `WF-C8-002` remains `PARTIAL`; progress stays `DONE 81/161`,
  `GATES 14/15`, C8 36%, overall 59%, with 80 non-DONE rows. Neither RED
  review transfers authority to the changed source.
- Precise stopping point: both review findings and regressions are repaired
  in the working tree but not yet checkpointed.
- Next action: commit only explicit slice paths, fingerprint the complete
  candidate and obtain a fresh independent full-range review from zero.

## 2026-09-29 — WF-C8-002 SELF no-show START review repair

- Fresh review matched clean exact base/live main/merge-base
  `f95ec02952c425e97a470aba5d2e591ffb5b9486` through head
  `9e812b3f06389573c521ca0d9dcbb19adaa4f66b`: 23 paths / 190,805 binary
  bytes / SHA-256
  `66d20f47c67be331bc18287e8e8f6c75d9635c7dd897e6e391c3ebaae64c0c24`.
  The author-independent verdict was RED: `P0=0`, `P1=0`, `P2=1`, `P3=0`.
- The remaining P2 was a read/write-context gap: SELF could see and enable
  `START` under historical Team A no-show context, while POST snapshots at the
  actual accepted start and could persist Team B after a same-day transfer.
- Persisted no-show plan/calendar is now display-only. SELF receives no
  actionable planned context, assignment fails closed and `START` is disabled
  until a separately reviewed recovery/case flow exists. Ordinary fact-free
  live rows still share and revalidate one exact route-selected context. No
  raw client team/template identifier or new write protocol was introduced.
- PASS: expanded 9-file / 86-test targeted matrix, scoped ESLint on all 16
  candidate TS/TSX paths, i18n 23,766/0/0, JSON catalogs and whitespace.
  Full local typecheck/build/suite, browser/AT, Android/Gradle, load,
  signed-device and pilot remain `NOT RUN` under host policy.
- `WF-C8-002` remains `PARTIAL`; progress stays `DONE 81/161`,
  `GATES 14/15`, C8 36%, overall 59%, with 80 non-DONE rows. The RED verdict
  does not authorize changed source.
- Precise stopping point: P2 repair, two regressions and receipts are complete
  in the working tree but not yet checkpointed.
- Next action: commit explicit paths, recompute the complete identity and
  obtain a fresh author-independent full-range verdict.

## 2026-09-29 — WF-C8-002 replacement full-range review GREEN

- Fresh author-independent read-only review returned GREEN with
  `P0=P1=P2=P3=0` on exact live origin/main/local main/merge-base
  `f95ec02952c425e97a470aba5d2e591ffb5b9486` through clean head
  `756731f7d9417e8df16a61414f921025e4aba84a`.
- Independent full identity matched 23 paths / 200,352 plain-binary bytes /
  SHA-256
  `1ef2da7544b2e9003926b00c31369ddea508ed54a30d010226d48173466586c0`;
  the last repair delta is exactly six paths.
- All three previous P2 classes are closed: one exact live context for
  ordinary no-case rows and SELF, validated case-bound context for readable
  persisted no-show plan/calendar, and display-only/no-START treatment for
  persisted no-show SELF. Tenant/access/privacy/bounds/snapshots/lifecycle,
  pagination, UI/i18n and evidence passed without a new finding.
- Reviewer PASS: 9 files / 86 tests, ESLint 16/16 TS/TSX paths, i18n
  23,766/0/0, three JSON catalogs and whitespace. Full local
  typecheck/build/suite, browser/AT, Android/Gradle, load, physical device and
  pilot remain `NOT RUN` under host policy.
- `WF-C8-002` remains `PARTIAL`; progress stays `DONE 81/161`,
  `GATES 14/15`, C8 36%, overall 59%, with 80 non-DONE rows. Review GREEN
  authorizes publication for exact-head CI but adds no completion/gate credit.
- Precise stopping point: independently reviewed code/test head is clean;
  only this three-document GREEN receipt is uncommitted.
- Next action: checkpoint the receipt, obtain exact-head blob-integrity GREEN,
  push/open the sub-400 KB PR and require every mandatory context.

## 2026-09-29 — PR #491 typecheck RED and explicit payload repair

- PR #491 exact head `8413cb8a33fabd27ba8c3b0e1685c4e9063fea18` passed
  `pr-scope`, `static-checks`, `runner-policy` and `scan`; static checks
  completed in 14m26s, and the scoped production build was correctly skipped.
  Run `36539911706` failed required `typecheck` after 16m12s.
- The blocking delta was confined to `today/route.ts`: 39 `TS2339` plus one
  `TS2322`. Conditional empty/query results lost the selected Prisma shapes,
  cascading rows to `{}` and the SELF workday away from its accepted input
  type.
- Exact Prisma select constants and generated payload types now bind named
  agents, current/previous workdays, calendar overrides and exception rows;
  the three parallel query outputs enter typed variables. Filters, ordering,
  bounds, selected columns, parallelism and response behavior are unchanged;
  no cast or typecheck-baseline update was introduced.
- PASS: 9 files / 86 tests, scoped ESLint 16/16 paths, i18n 23,766/0/0, JSON
  and whitespace. Full local typecheck/build/suite remains `NOT RUN`; only
  replacement exact-head CI can close the failed compiler gate.
- `WF-C8-002` remains `PARTIAL`; progress stays `DONE 81/161`,
  `GATES 14/15`, C8 36%, overall 59%, with 80 non-DONE rows. The previous
  GREEN is invalidated for changed source.
- Precise stopping point: compiler repair and bounded checks pass in the
  working tree but are uncommitted on the open PR branch.
- Next action: checkpoint explicit paths, obtain fresh independent repair and
  full-range review, push replacement head and rerun every mandatory context.

## 2026-09-29 — WF-C8-002 type-repair review GREEN

- Fresh independent repair/full-range review returned GREEN with
  `P0=P1=P2=P3=0` on clean head
  `43cf8a9836803b91e0303335b153258bab89922a`; live main and merge-base remain
  `f95ec02952c425e97a470aba5d2e591ffb5b9486`.
- Full identity matched 23 paths / 212,220 bytes / SHA-256
  `226af4b828799971a976d173b593eb81768bdf12aa734ea7f532492327d5f3a0`;
  repair identity matched exactly four paths / 18,150 bytes / SHA-256
  `07fce38abdbd44c41c7b51843b06a684ffdc3af5cca5c6e2c89f4804f31ae162`.
- Generated Prisma payload compatibility and parallel tuple assignment passed.
  Zero-agent/no-query and nonzero concurrency are unchanged; filters, order,
  bounds, selected columns, query count and response fields remain identical.
  There is no unsafe cast, suppression or typecheck-baseline weakening.
- Independent PASS: 9 files / 86 tests, ESLint 16/16, i18n 23,766/0/0, JSON
  and full/repair whitespace. Full local typecheck/build/suite and physical/
  browser/load/pilot gates remain `NOT RUN`; exact-head CI is mandatory.
- `WF-C8-002` remains `PARTIAL`; progress is unchanged at `DONE 81/161`,
  `GATES 14/15`, C8 36%, overall 59%, with 80 non-DONE rows.
- Precise stopping point: reviewed repair head is clean and only this
  three-document GREEN receipt is uncommitted.
- Next action: checkpoint receipt, obtain exact-head blob-integrity GREEN,
  push PR #491 replacement head and rerun every required context.

## 2026-09-29 — WF-C8-002 PR #491 production release receipt

- Exact reviewed PR head `9f7e5f2d622b6b6f4faf4d5651c8625764a6ec8e` passed required
  `pr-scope`, `static-checks`, `typecheck`, `runner-policy` and `scan`.
  Replacement PR run `36543790838`, runner-policy run `36543790711` and
  secret-scan run `36543790785` are green; the scope-conditioned production
  build was correctly skipped.
- PR #491 merged normally as main SHA
  `13dc3a179c8f5c0148c5f96d9e64c29815cd9d76`. Exact-SHA deploy workflow
  `36545693169` completed SUCCESS through quality/security, immutable artifact
  build, atomic production deployment and workflow post-deploy smoke.
- Separate no-cache TLS probes pinned to approved production
  `13.140.132.245` returned `{"ok":true}` from `/api/v1/ping` and exact
  `artifactSha=13dc3a179c8f5c0148c5f96d9e64c29815cd9d76` from
  `/api/v1/public/build-info`.
- Browser/AT/contrast/zoom/device acceptance remains `NOT RUN`, so
  `WF-C8-002` remains `PARTIAL`. No completion or gate credit is added:
  `DONE 81/161`, `GATES 14/15`, C8 36%, overall 59%, 80 non-DONE rows.
- Precise stopping point: the bounded Manager Today source is live on the
  exact verified production artifact; only this append-only release receipt
  is uncommitted on successor branch `codex/workforce-completion-part9`.
- Next action: checkpoint the release receipt, then implement the bounded
  `WF-C8-007a` ordered multi-site shift-segment draft editor without expanding
  into calendar, proof-policy or schema work.

## 2026-09-29 — WF-C8-007a ordered segment editor checkpoint

- The existing shift draft now supports a bounded ordered timeline of
  released Site/Remote/Field/Travel/Exception modes with named ACTIVE sites,
  44px keyboard controls, break-aware defaults, inline localized validation
  and named read-only summaries. `ON_CALL` is not offered.
- POST and PATCH send the complete ordered array when detailed segments are
  present. Legacy continuous-window drafts still omit segments. Existing
  hidden proof-policy references round-trip exactly without appearing in UI;
  ACTIVE history remains immutable.
- PASS: six focused files / 67 tests; scoped ESLint 4/4; i18n 23,803/0/0;
  EN/RU/AZ JSON and whitespace. Full local typecheck/build/suite and real
  browser/AT/device/load evidence remain `NOT RUN` under host policy.
- `WF-C8-007` is **PARTIAL**, not DONE. Calendar authoring and real browser/AT
  acceptance remain open. Progress is unchanged at `DONE 81/161`,
  `GATES 14/15`, C8 36%, overall 59%, with 80 non-DONE rows.
- Precise stopping point: implementation, focused verification and initial
  evidence are complete but uncommitted on
  `codex/workforce-completion-part9`.
- Next action: checkpoint explicit paths, fingerprint the exact candidate and
  obtain fresh author-independent full-range review before PR publication.
