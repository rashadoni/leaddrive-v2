# Workforce C0 — contract, threat and data evidence

> **Status:** active implementation evidence; not legal advice and not a pilot
> authorization
> **Recorded:** 2026-08-30T00:26:11+02:00
> **Applies to:** `workforce-hrm`; Route & Field is a separate module and
> failure domain
> **Sources:**
> [`workforce-hrm-completion-roadmap-2026-08-30.md`](./workforce-hrm-completion-roadmap-2026-08-30.md),
> [`mtm-hrm-module-plan-2026-08-28.md`](./mtm-hrm-module-plan-2026-08-28.md),
> [`workforce-hrm-h0-baseline.md`](./workforce-hrm-h0-baseline.md)

## 1. C0 decisions and non-negotiable product rule

The product owner started the autonomous Workforce completion program in the
active task on 2026-08-30. That is approval of the roadmap terminology,
boundaries and non-goals, while the explicitly named legal, physical-pilot and
mobile-distribution owner gates remain open.

The following rule is binding for every implementation slice and release:

> An attendance claim, QR, location, device signal, assessment or exception is
> operational evidence, not an automated payroll or disciplinary decision.
> Only an authorized human may approve a complete, reproducible period for the
> approved-timesheet export. The export is never labelled as wages, tax,
> statutory premium or a disciplinary outcome.

`PENDING_REVIEW`, `UNKNOWN`, missing evidence, weak location, a QR/device
failure, an anomaly score and a raw location coordinate are never rendered as
an accepted physical-presence or human-identity claim. A manager's ordinary
view shows the verdict and recovery action, not raw coordinates or security
material.

This follows the roadmap's purpose-limitation, human-review and minimization
boundaries. It is consistent with the NIST purpose specification/use-limitation
principle and OWASP MASVS data-minimization/storage controls, but it does not
replace Azerbaijan legal review.

## 2. Assets and trust boundaries

| Asset / boundary | Required property | Current or planned control |
|---|---|---|
| Tenant/actor identity | A client cannot select another tenant, employee or role | Auth/RLS-derived organization and actor; tenant-first queries; negative tests |
| Canonical workday ledger | Facts are append-only, ordered, reproducible and replay-safe | `MtmAgentWorkdayEvent`, advisory transition lock, immutable database guard, correction ledger |
| Claim provenance | The server distinguishes client claim/capture/queue time from receipt and application time | C1 timestamp contract, server receipt fields and bounded offline policy |
| Attendance evidence | Evidence is evaluated against a versioned policy and is not itself a verdict | C4 envelope/assessment; append-only verification facts |
| QR/device proof | Tokens/private keys are not persisted or exposed; replay is bounded | Short-lived signed QR, nonce fingerprint, exact-action signature, capability gates |
| Raw location | Exact coordinate access is minimized, auditable and independently expired | C10 data classification, 30-day purger, restricted evidence view |
| HR decision/correction | A decision is attributable and never silently overwrites original facts | Immutable correction/approval records and reason requirement |
| Offline client data | Pending operations cannot cross account/tenant boundaries or become trusted merely by age | C1/C9 operation binding, 7-day horizon, encrypted outbox and recovery state |
| Export artifact | Only an approved, scoped period leaves the system through an accountable channel | C11 approval hash, purpose/recipient, expiry and delivery audit |

## 3. Threat model

The residual-risk column is deliberate: no combination of account, GPS, QR or
device evidence proves that a named human was present. A legitimate employee
must always have an accountable fallback instead of an unreviewed bypass.

| Threat | Prevent | Detect | Respond | Residual risk / roadmap closure |
|---|---|---|---|---|
| Tenant leakage, IDOR or confused Route/Workforce scope | Auth/RLS scope, capability and granular permission checks, tenant-first indexes | Four-module-mode, role and RLS negative tests | Deny, audit, isolate tenant and investigate | C7, C13, C14 must prove no cross-tenant read/write |
| Shared or stolen account/session | HRM step-up policy, device lifecycle and scoped recovery | Concurrent-session/device anomalies | Freeze/revoke device/session; create review case | Account auth alone cannot prove the person; C5 and C6 |
| Backdated/future client time or clock rollback | Server receipt/application time, future-skew and seven-day limits | Age/order/clock risk codes | Reject out-of-policy claim or create `PENDING_REVIEW` | Offline claims still rely on device clock; C1 |
| Replay or changed payload under one operation ID | Actor/action/payload/schema-bound idempotency digest | Mismatch reason code and immutable operation ledger | Return canonical prior result; never reapply | Digest must cover every adapter; C1/C13 |
| QR screenshot, video relay or stale/replayed token | Short expiry, station/action/tenant binding, nonce consumption | Station health/skew, duplicate nonce and relay exercises | Fail/review; use approved additional evidence or fallback | QR cannot prove proximity when relayed; C5 documents this |
| GPS spoof, stale/weak location or location permission denial | Server geofence calculation, accuracy/freshness policy and no automatic guilt | Mock/provider flags, impossible travel and boundary tests | `PENDING_REVIEW`, retry or equitable fallback | GPS never proves identity; C4/C6/C10 |
| Rooted, emulated or cloned device | Hardware-backed key/attestation, Play Integrity and exact-action challenge | Attestation/security-level/revocation failures | Reject/review, revoke enrollment and recover account | Unsupported hardware requires an approved fallback; C5/C9 |
| Manager/HR misuse or silent fact rewrite | Separation of duties, immutable decision/correction ledger, least privilege | Access/decision audit and periodic review | Revoke access, investigate and append correcting decision | A privileged authorized actor can still misuse data; C7/C10 |
| Raw GPS, QR token, reason or device material leaks through logs/backups/exports | Data classification, token minimization, redaction, encrypted mobile storage, export allowlist | Log/schema scanning, access audit and restoration drill | Incident process, revoke secrets, preserve evidence | Backup and third-party legal obligations need C10 review |
| Lost phone, no smartphone or disability exclusion | Reviewed web/manual fallback and optional kiosk policy | Fallback/appeal metrics | Restore access without fabricating evidence | Exact fallback and kiosk controls require OD-06/OD-16 |
| Sync outage, queue coupling or partial commit | Separate Workforce lane, atomic operation/result and bounded retry | Outbox age, conflicts, reconciliation and Route comparison | Retry/quarantine/reconcile; freeze cohort only when needed | Full load/chaos evidence remains C12/C14 |
| Retention purge or legal-hold failure | Per-class retention, tenant scope, dry run, hold check and immutable purge audit | Batch/reconciliation/backup metrics | Stop, restore only through approved runbook | No deletion before legal review and staging drill; C10 |

Threat sources and implementation references:

- NIST defines purpose specification/use limitation as notice of the purpose and
  restriction of processing to that explained or otherwise authorized purpose:
  <https://csrc.nist.gov/glossary/term/purpose_specification_and_use_limitation>.
- OWASP MASVS requires protection of intentionally stored sensitive mobile
  data and identifies unencrypted storage, keys outside the platform keystore
  and hardcoded secrets as failure modes:
  <https://mas.owasp.org/MASVS/controls/MASVS-STORAGE-1/>.
- Android key attestation must be validated on a trusted server, including the
  chain/root, security level and revocation status; it is not a client-only
  assertion: <https://developer.android.com/privacy-and-security/security-key-attestation>.

## 4. Technical data inventory and processing map

`Candidate legal basis` is a technical product assumption, **not** a legal
conclusion. C0-004 must confirm the applicable Azerbaijan employment/privacy
basis, employee notice, monitoring limits, data-subject workflow, retention
exceptions and cross-border/vendor conditions before real location collection.

| Data class / fields | Subject | Specific purpose | Candidate legal basis to validate | Normal viewers | Retention / deletion rule | Implementation boundary |
|---|---|---|---|---|---|---|
| Tenant/employee identifiers, team/site assignment, employment status | Employee | Scope schedule, actions and review to the correct person | Employment/service administration | Employee self, scoped manager/HR | Workforce fact lifetime; deactivation removes access, not history | RLS, effective-dated history, no client-supplied actor |
| Attendance claim: action, workday ID, operation/client ID, claimed/captured/queued/received/applied times | Employee | Reconstruct a workday transition and sync result | Attendance service/contract; confirm local basis | Employee, scoped HR/manager | Time/decision class: 1 year, then eligible purge subject to hold | Append-only ledger; receipt vs client claim separation |
| Raw coordinate, accuracy, provider/mock/permission state | Employee | Evaluate action-time/site policy and explain a decision | Must be expressly confirmed before collection | Restricted evidence reviewer; employee's own explanation | Raw location: 30 days, all copies; derived non-reversible verdict remains | No normal manager map; no off-shift collection; C10 bounded purge |
| QR token, nonce, station and proof fingerprint | Employee/site controller | Fresh site-station proof and replay detection | Security/fraud prevention; confirm local basis | Restricted security/admin; token itself never shown after scan | Raw token never stored; fingerprint/security event retention requires C10 classification | Tenant/station/action/expiry binding; no logs/exports |
| Device enrollment ID, public key, attestation/integrity properties, revocation state | Employee device | Protect exact attendance actions and recover lost devices | Security/fraud prevention; confirm BYOD notice/basis | Restricted device-security admin, employee self-state | Active lifecycle plus minimum audit period; exact period must be set in C10 | No private keys/biometric templates; revocation audit |
| Local biometric/device-credential outcome | Device user | Unlock a per-use local signature only | No LeadDrive collection; OS-local only | None in LeadDrive beyond an optional policy-safe outcome | Never transmit/store template or biometric result | C5/C9 only; unavailable until verified protocol |
| Request/correction reason, decision note, appeal | Employee/manager | Process leave, absence, correction and exception review | Employment/service administration; possible sensitive content needs C0-004 classification | Employee, scoped approver/HR | Time/decision class: 1 year, subject to hold | Avoid notification/log/export leakage; immutable decision trail |
| Assessment/verdict/reason code, policy/site/schedule snapshot hash | Employee | Explain accepted/review/rejected outcome after raw evidence is minimized | Attendance service/contract | Employee, scoped manager/HR | Time/decision class: 1 year, subject to hold | Verdict is distinct from raw evidence and identity proof |
| Audit/access records | Employee/admin | Accountability for decisions, evidence access and exports | Security/accountability; confirm local basis | Restricted audit/retention officer | 1 year minimum decision context; precise policy in C10 | Immutable/audited access and no secret/raw-coordinate payload |
| Export scope, checksum, purpose, recipient, channel, expiry | Employee/recipient | Deliver an approved timesheet to an authorized recipient | Approved export/service obligation; confirm recipient/transfer conditions | Export custodian/auditor | Expire artifact promptly; keep audit per approved policy | No raw GPS/QR/device/reason in ordinary export |
| Aggregated service metrics: counts, latency, conflicts, outbox age | Tenant service | Reliability/SLO and pilot safety without tracking people | Legitimate operational need; confirm local basis | SRE/product, tenant-safe scopes | Operational retention defined by C12/C10 | No employee IDs, raw coordinates, tokens or free text in metrics |

### Data flow and deletion constraints

```text
employee action
  -> authenticated Workforce adapter
  -> immutable claim/receipt + policy/evidence assessment
  -> workday facts, exception/correction and approval ledger
  -> restricted HR views / approved timesheet export

raw GPS (30d) ──> bounded purge ──> derived verdict/time fact (1y)
QR token ───────> validation only; nonce/proof fingerprint, never raw token
device private key/biometric template ──> never leaves the operating system
```

No raw location, QR token, private key, local biometric template/result or
free-text HR reason may enter general analytics, crash telemetry, ordinary
manager views or the approved-timesheet export. A legal hold fails closed;
neither capability disable nor employee deactivation authorizes deletion.

## 5. Requirements traceability register

The completion roadmap remains the atomic task register: every requirement has
a `WF-Cn-nnn` task, acceptance evidence and one phase gate. This table maps
every task group to the concrete implementation/test evidence that is required
before that gate can pass.

| Requirement group / task IDs | Primary implementation contract | Required verification evidence | Release gate |
|---|---|---|---|
| C0 (`WF-C0-001`..`008`) | This C0 evidence document, H0 baseline query and roadmap | Document review, `git diff --check`, production metrics only through approved read-only access | C0 |
| C1 (`WF-C1-001`..`010`) | `src/lib/mtm/workday.ts`, legacy week/sync adapters and immutable event schema | Parser, boundary, replay, concurrency and audit-failure tests | C1 / M0 |
| C2 (`WF-C2-001`..`011`) | Additive Workforce site/geofence/assignment/segment schema and HRM-only APIs | Prisma/RLS/migration, transfer/multi-site/validation tests | C2 / M1 |
| C3 (`WF-C3-001`..`011`) | Policy/shift/calendar/snapshot lifecycle and calculator | Effective-date, break, timezone/DST and rehydration tests | C3 / M2 |
| C4 (`WF-C4-001`..`010`) | Evidence envelope, assessment and geofence/policy evaluator | Boundary, missing/stale/mock GPS, QR and explanation tests | C4 / M1 |
| C5 (`WF-C5-001`..`013`) | MFA/device/QR/kiosk controls and operational recovery | Server security tests plus physical Android/relay evidence | C5 / M3 |
| C6 (`WF-C6-001`..`010`) | Exception, no-show, correction, appeal and notification lifecycle | Deduplication, schedule-aware, immutable-decision and recovery tests | C6 / M2 |
| C7 (`WF-C7-001`..`010`) | Workforce roles, scopes, history and request workflows | Least-privilege/IDOR, transfer and audit tests | C7 / M2 |
| C8 (`WF-C8-001`..`011`) | Employee/manager/HR/security web surfaces | Targeted UI/type checks, AZ/RU/EN and browser evidence | C8 / M2 |
| C9 (`WF-C9-001`..`015`) | New signed employee mobile client and isolated Workforce sync | Offline/process-death/device/accessibility physical matrix | C9 / M3 |
| C10 (`WF-C10-001`..`011`) | Data classes, restricted evidence, purge, hold and transparency | Dry-run/purge/hold/backup/access tests and approved notice | C10 / M4 |
| C11 (`WF-C11-001`..`010`) | Reproducible calculation, approval revision and export artifact | Rehydration, approval/hash, scope/expiry/privacy tests | C11 / M4 |
| C12 (`WF-C12-001`..`010`) | Metrics, lanes, reconciliation, jobs, backup and rollback | Isolated 5k load/chaos/reconciliation/runbook drill | C12 / M4 |
| C13 (`WF-C13-001`..`009`) | Additive schema, legacy/new adapter parity and rollout window | Prisma/migration parity, four-module-mode and reconciliation tests | C13 / M3 |
| C14 (`WF-C14-001`..`012`) | Consolidated test evidence, cohort fence, pilot and release controls | CI/browser/physical/load/retention/pilot evidence, GitHub deploy/smoke | C14 / M5-M6 |

Existing foundation references include the legacy compatibility tests,
`workforce-attendance-trust.test.ts`, workday replay/timesheet tests,
timesheet approval/export tests, configuration/default-provisioning tests and
the H6 load-contract test. They prove the previous foundation only; C14 is the
only place that can declare the end-to-end release evidence complete.

## 6. C0 evidence status

| Task | Status after this checkpoint | Evidence / remaining condition |
|---|---|---|
| WF-C0-001 | DONE | Active task explicitly approves the roadmap's terminology and non-goals |
| WF-C0-002 | DONE | Sections 2-3 define assets, attacks, prevention, detection, response and residual risks |
| WF-C0-003 | PARTIAL | Section 4 is the technical data/purpose/viewer/retention inventory; legal basis and notice await C0-004 |
| WF-C0-004 | BLOCKED | Azerbaijan employment/privacy review and approved notice cannot be created by source changes |
| WF-C0-005 | PARTIAL | Reproducible read-only baseline SQL exists; production tenant/telemetry evidence remains `NOT RUN` without approved access |
| WF-C0-006 | OWNER DECISION | Android-first/distribution/device/version decisions remain explicitly open |
| WF-C0-007 | DONE | Section 5 maps task groups to contracts, verification evidence and release gates |
| WF-C0-008 | DONE | Section 1 records the no-automated-payroll/discipline rule |

### Checks run for this document

- `PASS` — `git diff --check` in the dedicated Contabo worktree.
- `NOT RUN` — production baseline query/telemetry: no approved tenant-scoped
  read-only production data access in this checkpoint.
- `NOT RUN` — formal Azerbaijan legal/privacy assessment and employee notice:
  requires a qualified owner/legal decision outside source control.
