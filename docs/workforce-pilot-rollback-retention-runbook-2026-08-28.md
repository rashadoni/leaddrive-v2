# Workforce pilot, rollback, export and retention runbook

> **Status:** pre-production runbook; owner decisions and production evidence are
> still required.  This document does not authorize deploy, tenant mutation,
> export, retention deletion or capability enablement.
>
> **Scope:** `workforce-hrm` in LeadDrive and the LeadDrive Field variant of
> LeadShelf. Route & Field remains an independent product and failure domain.

## 1. Non-negotiable safety rules

- Rollout uses one tenant cohort at a time. No global enablement is allowed for
  the first release. The server now has a separately named `workforce-write`
  device-cohort/write-fence control plane, but it starts with no tenant row and
  therefore legacy behavior. It is a server-owned device selector, **not** a
  cryptographic APK provenance or attestation claim; physical-pilot verification
  remains a release gate.
- Capability disable is soft: it hides Workforce UI and blocks Workforce API
  and sync without deleting history.
- Old mobile adapters remain available for the declared supported APK window.
- No schema rename/drop, destructive backfill or retention deletion is part of
  rollback.
- A Route/LeadShelf outage must not stop critical Workforce outbox delivery.
- A Workforce failure must not degrade Route & Field SLOs.
- Tenant and actor always come from verified auth/RLS context, never a mobile
  payload.
- Exact GPS payloads, access tokens and employee reasons must not be copied into
  general sync diagnostics.

## 2. Owner gate before schema or pilot work

The following values must be recorded in the release decision. Blank values are
a stop condition, not an invitation to choose a default.

| Decision | Required recorded value |
|---|---|
| User-facing name | **Two-level naming:** employee-facing `Рабочее время`; manager-facing `Табель и команда` (owner decision, 2026-08-28) |
| Export boundary | **Approved-timesheet export only; payroll is excluded from the first release** (owner decision, 2026-08-28) |
| Time/decision retention | **1 year** (owner decision, 2026-08-28); no separate legal-hold extension in the first release. A detected legal hold blocks deletion pending a separate owner/legal decision. |
| Raw GPS retention | **30 days** (owner decision, 2026-08-28); no separate legal-hold extension in the first release. A detected legal hold blocks deletion pending a separate owner/legal decision. |
| First trust release | Ordinary production release remains **without QR, device trust or local biometric confirmation**. The owner later requested an H5/H6 physical trust pilot; it is allowed only as a separately recorded, cohort-scoped pre-production/pilot gate with QR/device policy values, two physical devices and rollback owner. It is not global enablement. `biometricRequiredActions` stays disabled until a server-validated Android Key Attestation protocol and its trust policy are approved. |
| Time correction authority | **Direct manager edit is permitted with a mandatory reason and immutable audit contract** (owner decision, 2026-08-28) |
| Approved-timesheet correction | **Create a new correcting record with manager, reason and audit; never overwrite the original approved record** (owner decision, 2026-08-28) |
| Team policy resolution | **A matching team policy replaces the organization policy** (owner decision, 2026-08-29). For an offline workday sent after an employee transfer, use the employee's **new/current team when the server processes the event** (owner decision, 2026-08-29). This deliberately does not infer a historical team from the workday date. |
| Team shift resolution | For a **selected team-scoped default shift** sent after an employee transfer, use the employee's **new/current team when the server processes the event** (owner decision, 2026-08-29). Default selection is explicit: at most one active default per organization/team; an explicit individual assignment overrides it. |
| Shift definition format | First implementation uses local start/end in HH:mm, one IANA timezone and ISO weekdays (Monday = 1 through Sunday = 7). Overnight behavior remains explicitly unsupported pending a separate owner decision. |
| Pilot cohorts | One owner-designated HRM-only tenant first. The `workforce-hrm` + `route-field` cohort is deferred until the owner selects it; tenant IDs are not recorded in source control. |
| Supported offline horizon | **7 days** (owner decision, 2026-08-28); cursor/idempotency retention must exceed it with margin |
| Supported APK window | exact oldest/newest versions, minimum supported upgrade cycle, deprecation date and retry horizon |

Biometric templates are never collected or stored. A native biometric prompt
may only authorize local key use and does not replace server identity or device
enrollment. Until Android Key Attestation verifies hardware/user-auth assurance
server-side, it cannot be a policy-required HRM attendance factor.

## 3. Pilot sequence

1. **Internal cohort:** synthetic tenant, no production employees. Prove the
   four module modes and capability rollback.
2. **HRM-only tenant:** Today, Workday, requests, manager decisions and sync must
   work without Route or commercial LeadShelf traffic.
3. **Both-products tenant:** prove independent errors, separate counters and no
   cross-product data leakage.
4. **Measured expansion:** add one tenant cohort only after the previous cohort
   meets every gate for an agreed observation window. A mobile write cohort may
   be prepared through the audited server control plane, but `COHORT_ONLY` or
   `FROZEN` may be enabled only in the separately recorded pilot/change record.
   It is not an APK allowlist and does not replace physical release evidence.

Every cohort record includes tenant ID, APK version, enabled capabilities,
policy/config versions, start/end time, approver and rollback owner. It includes
a device/APK cohort only when that gate exists. Tenant IDs are not hard-coded
in source control.

## 4. Acceptance gates

### Functional and isolation

- HRM-only, Routes-only, Both and Neither invoke only permitted endpoints.
- Offline `START → PAUSE → RESUME → FINISH` preserves operation order and IDs.
- A lost 503 response is replayed after process restart without duplicate facts.
- Two-device transitions preserve the server winner and expose the conflict and
  allowed recovery actions for the loser.
- An old supported APK receives an idempotent result from legacy adapters.
- A disabled capability returns a structured 403 and does not query or mutate
  Workforce data.
- Route failure does not delay Workforce delivery; Workforce failure does not
  delay Route delivery.

### Human/mobile

- Physical Android QR/device trust: poor network, airplane mode,
  background/foreground, process death, reboot and organization-date rollover.
  A system biometric prompt is a native smoke only until the attestation gate
  makes it server-enforceable.
- TalkBack announces current state, one primary action, disabled reason and
  conflict recovery.
- RU/AZ/EN, 200% font scale and 48 dp targets pass acceptance on supported
  devices. A missing locale is a release blocker, not a fallback approval.
- The application clearly distinguishes locally saved, server-applied,
  conflict and rejected states.

### Scale and reliability

- Confirmed business-event loss: zero.
- Online critical mutation acknowledgement p95: at most 10 seconds.
- Owner-approved warning and critical thresholds for oldest pending operations
  are recorded after the baseline. Two and 15 minutes are initial proposals,
  not acceptance criteria until approved.
- Morning start load: 5,000 users with client jitter, per-tenant fairness and
  bounded retries.
- Chaos scenarios cover 503, timeout, partial result, process death, DB failover
  and cursor resnapshot.
- No P0/P1 defects remain open at pilot expansion.

Full builds, full E2E, Android and load phases on the remote host run only via
`/home/codex-alt/.local/bin/codex-heavy-run`. If admission control refuses a
phase, record `NOT RUN (resource-blocked)`; never bypass the wrapper.

## 5. Baseline and evidence packet

Capture before enabling the first production cohort and again after each
cohort:

- active Workforce employees and active devices;
- workday events/day and peak events/minute;
- online acknowledgement p50/p95/p99 by tenant, stream and APK;
- 4xx/5xx/conflict rates by machine code;
- pending count, oldest outbox age and retry-attempt distribution;
- previous-day open workdays and manual correction rate;
- payload row/byte counts and server/local-apply duration;
- Route SLO beside Workforce SLO to prove failure isolation.

The packet contains the commit IDs, exact commands, exit codes and artifact
paths. It must not contain tokens, full reasons or exact raw GPS payloads.

No production baseline was collected by the implementation task because it had
no deploy, production-query or tenant-mutation authorization.

## 6. Export procedure

The owner chose approved-timesheet export only for the first release; payroll
calculation is out of scope. The H3 approval route can now create an immutable,
audited approval, but delivery remains blocked until the tenant-policy, purpose,
recipient and approved encrypted-channel controls are implemented and verified.

For an approved-timesheet export:

1. Resolve tenant, period, employee scope, timezone, approved state and policy/
   shift snapshot versions.
2. Dry-run the row count and date bounds under tenant RLS.
3. Recompute plan/fact with the pinned calculation version and snapshot inputs;
   never read a live policy to rewrite closed rows.
4. Produce a tenant-scoped artifact with generation time, scope and checksum.
5. Record the actor, purpose and delivery recipient in audit.
6. Deliver through the approved encrypted channel and remove temporary copies
   according to the approved export-retention rule.

Do not label overtime as payable, calculate wages, tax or statutory premiums
unless payroll mode, jurisdictional rules, rounding and the accountable owner
are explicitly approved. Operational overtime remains only a plan/fact
deviation.

## 7. Retention procedure

Time facts/decisions and raw GPS are separate retention classes. Capability
disable, employee deactivation and ordinary cache cleanup do not delete either.

Before any destructive retention job:

1. Resolve the approved retention duration. A detected contractual or legal hold
   blocks deletion; the first release has no automatic hold-extension workflow.
2. Produce a dry-run by data class with oldest/newest time, row count and bytes.
3. Verify a restorable backup and record restore evidence.
4. Verify that idempotency/cursor records outlive the supported offline and APK
   retry horizon.
5. Verify that the post-GPS report retains approved start/end, duration, pauses
   and final exceptions without raw coordinates.
6. Obtain the recorded release/tenant approvals.

Execution must be tenant-scoped, bounded, resumable and idempotent. Delete in
small ordered batches or eligible partitions, observe database/replica pressure
and stop on an ownership, scope, backup or legal-hold mismatch. Afterward,
compare deleted counts to the dry-run and run tenant-isolation/report smoke.

The H3 foundation intentionally grants no DELETE path for immutable Workforce
facts. A future retention implementation requires a reviewed legal/contract
hold and audited approval model before it can turn this procedure into code.

Until that approved purge path exists, permanent deletion of an employee with
Workforce workdays/events, HRM requests and their calendar/audit projections,
raw location evidence or other Workforce history — and permanent deletion of a
tenant with any such history or Workforce configuration — are rejected with
`WORKFORCE_RETENTION_BLOCKED`.
Deactivate or archive the employee/tenant instead; this guard is deliberately
checked before manual and scheduled tenant export, email and DNS cleanup.

No retention deletion or backfill was run by the implementation task.

## 8. Rollback

Rollback triggers include confirmed event loss, tenant leakage, incorrect
terminal transition, unusable recovery UI, critical p95 breach, cross-stream
degradation or an open P0/P1.

There are two distinct rollback modes. A client/UX rollback keeps the tenant
capability enabled while the supported client path is changed. The server-side
write fence now supports an auditable `FROZEN` hard stop or a `COHORT_ONLY`
device selector for mobile `workdays`/`hrmRequests` v1 sync and the mobile
branch of `week/workday`; it is independent of the read-only sync-v2
`workforce` stream. `COHORT_ONLY` cannot be enabled without an active exact
agent/device row, and its final active row cannot be disabled until the posture
changes. Mobile mutations hold the matching shared tenant lock through commit,
so an exclusive freeze/cohort transition cannot succeed while a previously
permitted Workforce write is still pending. This is still not a verified remote client-release gate, an APK
allowlist or an automated offline-drain cutoff: it blocks subsequent server
write attempts, including known v1 replays, but does not delete or reconcile an
offline outbox. A hard stop disables the tenant capability, after which the
Workforce API, sync and legacy adapters are intentionally unavailable.

1. Freeze cohort expansion and preserve diagnostics.
2. Choose and record either an available, pre-verified client/UX rollback or a
   hard stop. Do not disable `route-field` unless its own incident independently
   requires it.
3. For an immediate mobile-only incident stop, a named session administrator
   may set the affected tenant's write posture to `FROZEN`; record the owner,
   time and expected reconciliation procedure. For a commercial/product hard
   stop, soft-disable `workforce-hrm`. Do not describe either action as a
   controlled APK drain: installed/offline clients retain their outbox until a
   separately verified client-release and reconciliation plan is in place.
4. Preserve server diagnostics and on-device outboxes for later reconciliation;
   do not clear the outbox, cursor or encrypted database. The disabled tenant
   cannot use Workforce sync or legacy adapters until deliberate re-enable.
5. A future verified client-release gate may use the implemented fence, keep
   the capability enabled, switch the client path and drain to a separately
   recorded cutoff. Do not infer that cutoff from the fence alone.
6. Keep the canonical server state machine and event journal intact. Reconcile
   pending/applied/conflict operations by operation ID before re-enable.
7. Verify `/api/v1/ping` and feature-specific tenant-isolation/compatibility
   smoke only when a separately authorized deploy actually occurs.

Rollback never drops additive H1-H4 schema, rewrites closed shifts or deletes
history. A destructive database rollback requires a separate reviewed plan and
restore point.

## 9. Implementation checkpoints and verification gaps

H5 trust evidence and the H6 physical/scale matrix are maintained in
[`workforce-h6-pilot-evidence.md`](./workforce-h6-pilot-evidence.md). This
adds no production evidence by itself: exact cohort identities, device builds,
approvers, scale target and results must be recorded outside git before a pilot.

Git-verifiable LeadDrive checkpoints on `codex/implement-hrm-plan` include
`9da5adec6bc654cbdc54d54386451a933b204da4` for the versioned pure timesheet
calculation and its tests, plus the preceding capability, permission,
compatibility, standalone Workforce, product-boundary and sync-lane commits.
Git-verifiable LeadShelf checkpoints on `codex/workforce-h2` include
`08eb3a7b54a24cf64b7f0f7944319829ef3420af` and its preceding manifest-gating,
independent outbox, recovery and timezone-safe HRM commits.

**H3 Gate: NOT MET.** The current additive foundation pins policy/shift
snapshots, makes the workday event journal append-only, seals completed
workdays behind their transaction-local immutable correction fact, and appends
approved-request corrections transactionally. Both canonical `START` writers
now invoke the snapshot writer in their existing outer transaction, so a
configured policy/shift pair and the accepted workday event commit together.
The hook is deliberately readiness-gated: a tenant with no calculation policy
or shift continues the legacy `START` path, but its row remains explicitly
snapshot-missing and cannot look approval/export-ready. Direct managers may now
correct the complete boundary of a closed shift only through
`POST /api/v1/workforce/workdays/:id/corrections`: reason, `operationId`,
optimistic `expectedUpdatedAt`, request hash and transaction-local audit are
mandatory; self-edits and active shifts remain excluded. The live policy/shift
resolvers already run through the in-transaction snapshot writer in both
canonical `START` paths. Calculation is immutable rehydration/read-only (and
its plan/fact/deviations are shown in the tabular timesheet). Session-only
administrator APIs list, create and edit validated `DRAFT` policies and shift
templates; integration API keys cannot use this configuration surface. A new
policy or individual assignment is scheduled only for a future
organization-local date: an active predecessor is closed on the prior date,
and started/closed workdays and snapshots remain untouched. There is still no
future default-selection timeline for shift templates. Each configuration write
derives version/hash values and appends the actor, request metadata and
before/after configuration hashes to the tenant audit log in the same
transaction. The current-team policy resolver and current-team validator for an
explicit individual assignment or selected team-scoped default shift implement
the recorded precedence and employee-transfer decisions.

The Workforce web surface now exposes those guarded flows without turning them
into a bulk or default-setting path. A manager selects exactly one employee and
one bounded recorded period before creating an immutable approval; the
all-team view stays read-only, and a later changed period requires a stated
correcting reason. A signed-in tenant administrator can list, create, edit and
schedule policy and shift drafts at Workforce configuration. The screen does
not create individual assignments from a typed or inferred employee identifier:
that needs a separately scoped administrator roster lookup.

`POST /api/v1/workforce/timesheet/approvals` is session-only and reconstructs
every *recorded* workday for one employee/period under the same per-employee
lock as canonical workday writers. It rejects self-approval, out-of-scope
employees, open workdays, missing policy/shift snapshots and a journal that
cannot reproduce the current immutable facts. It persists an idempotent initial
approval or an append-only correcting revision with a manager reason, and
writes approval metadata/audit in the same transaction. It deliberately does
not infer missing starts, no-shows or leave days as zero-pay rows; exception and
calendar completeness still need their own explicit lifecycle. A payroll-free
export envelope exists only for a persisted immutable approval. No download or
external delivery route exists yet, because recipient, purpose and encrypted
delivery/retention controls are still release-gated. No export or H3 completion
claim may rely on these checkpoints alone.

No evidence packet meeting section 5 was persisted. Targeted green results seen
during implementation are developer-session observations only; without the
tree, exact command, exit code and artifact captured together they do not count
as current release evidence and must be rerun for acceptance.

- Full LeadDrive typecheck: **NOT RUN (resource-blocked)** after bounded
  `codex-heavy-run` could not acquire the shared host lock in the current
  worktree. It was not run directly or retried around the resource guard.
- Full LeadShelf mobile typecheck: **NOT RUN (resource-blocked)** because
  `codex-heavy-run` admission required 5 GiB `user.slice` headroom.
- Full build, full suite, browser E2E, Android emulator/physical-device
  acceptance, 5,000-user load, production baseline and security/privacy review:
  **NOT RUN** in this implementation task. The build-only Android CI evidence
  recorded in [`workforce-h6-pilot-evidence.md`](./workforce-h6-pilot-evidence.md)
  verifies compilation, signing and artifact verification only; it does not
  replace emulator or physical-device acceptance.

These gaps are release gates; targeted success does not convert them into a
pass.

**H6 server-release safeguard: implemented, physical gate not met.** The
additive `WorkforceMobileWriteFence` is tenant-RLS scoped and defaults to no
row/`LEGACY_ALLOWED`; migration creates no tenant configuration. Its separate
`workforce-write` cohort is managed only by a signed-in Workforce administrator
and every posture/cohort transition is transactionally audited. The server
enforces it under the same tenant lock as the control plane, so a successful
freeze cannot be overtaken by a previously approved mobile HRM write, while a
neighboring Route operation in a mixed legacy batch remains unaffected. It does not enroll an APK, bind a device to
an attested hardware identity, enable QR/biometrics, select pilot tenants or
provide physical Android/load evidence. Those remaining H6 inputs stay outside
source control and are listed in the companion evidence packet.
