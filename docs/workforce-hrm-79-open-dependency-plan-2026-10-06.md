# Remaining HRM completion plan — 79 open items

Checkpoint: PR589 source `5f87cc94a684d5083804f0dae23116384dda24b4`, main `86cba428d39e3ce4be13245bdb8e34e49dccf8d4`. Sole HRM writer; Support work remains outside this slice. No merge, deploy, activation, credential/grant change or historical migration edit is authorized.

## Ledger and reading rule

Exactly 161 unique task IDs: 82 DONE and 79 open (55 PARTIAL, one PARTIAL owner attestation, 14 PLANNED, six OWNER DECISION, three BLOCKED). Gates remain 14/15; C8 45%; weighted completion 59%; C12-008 PARTIAL. No status is promoted by this document or by synthetic tests. The canonical source is `docs/workforce-hrm-completion-roadmap-2026-08-30.md`: use its last explicit table row for each task ID, including later checkpoint tables; prose saying an owner decision was resolved is not a DONE row.

## Dependency order and independent work

1. **Now, source-only:** this bounded C12 baseline-export contract and eligible-roster diagnostic, tests and review. No historic baseline claim.
2. **Next independent slice:** WF-C12-002 + WF-C10-011 finite metric schema/redaction canary audit; reuse the diagnostic without installing telemetry transport. Then WF-C12-004/005 virtual fault/fairness matrix and WF-C13-006 four-entitlement regressions. These do not require `api_keys` creation history.
3. **Parallel-ready preparation, one writer sequenced:** exception lifecycle/role negative tests, schedule draft/preview tests and three-language browser/a11y scenarios. Keep overnight/split release-one exclusion intact. Establish a fresh path/scope inventory before choosing each bounded change; do not rewrite Support or implement HRHub/follow-on personnel documents.
4. **Owner/environment lanes:** privacy/site/fallback decisions; authoritative restored-copy schema/ledger provenance; Android identity/signing/distribution and physical device access; approved provider or notification destination. No one lane blocks preparation in the others. Existing decisions are reused, not reopened without a concrete unresolved fact.
5. **Convergence:** historical full-staging migration/rollback and representative load/restore, signed-device and integrated security/role matrices. Synthetic schema receipts remain separate. `api_keys` blocks the clean-history replay route, not all 79 tasks.
6. **Release lane:** named private pilot packet → scoped activation → observation/exit review → separately approved official HRM release → separately approved Both cohort. No automatic payroll/discipline. HRHub and follow-on personnel documents wait for current HRM acceptance.

Each row below preserves the canonical status and gives a concrete next artifact/acceptance step. Group dependencies apply to every row. Passing one local test does not close its entire row. Evidence must be exact-source-bound, sanitized, independently reviewed where required, and distinguish NOT RUN from PASS.

## owner_privacy_decisions — 7 items

Dependency: Owner/HR/privacy scope and policy evidence; six OWNER DECISION rows remain non-DONE even where notes say OD resolved.

Baseline boundary: No technical dependency on api_keys. Do not independently invent owner/legal approval or close statuses from prose.

| Task | Current status | Next artifact / acceptance step | Canonical line |
| --- | --- | --- | --- |
| WF-C0-004 | PARTIAL (OWNER ATTESTATION) | Reusable future-tenant jurisdiction/notice template; distinguish owner attestation from external counsel evidence. | 777 |
| WF-C0-006 | OWNER DECISION | Record authoritative Android package, signing, distribution, OS/device and version-window decision. | 779 |
| WF-C2-003 | OWNER DECISION | Bind site calibration checklist and min/max radius/accuracy to approved policy revision. | 838 |
| WF-C2-008 | OWNER DECISION | Bind inter-site travel/pay/grace and edit authority to approved policy revision. | 843 |
| WF-C4-008 | OWNER DECISION | Map disability/lost-phone/GPS/QR failures to approved equitable fallback and accountable review. | 887 |
| WF-C5-001 | OWNER DECISION | Record assurance tiers by site/action and BYOD rules; verify dormant enforcement against that decision. | 901 |
| WF-C5-010 | OWNER DECISION | Record kiosk/badge/PIN anti-sharing and emergency fallback decision before implementation acceptance. | 910 |

## android_device_assurance — 21 items

Dependency: Exact signed Android artifact/package/distribution identity, physical devices, official attestation/verdict integration, key/biometric/QR/offline/accessibility matrix.

Baseline boundary: Source/contract preparation can proceed independently; signed physical and external provider evidence requires its own authorized environment. api_keys is not the direct blocker.

| Task | Current status | Next artifact / acceptance step | Canonical line |
| --- | --- | --- | --- |
| WF-C5-003 | PARTIAL | Inspect non-exportable key/user-auth/rotation source; prove lifecycle on signed physical devices. | 903 |
| WF-C5-004 | PARTIAL | Prepare attestation invalid-chain/root/revocation/challenge/app-identity corpus; authorized provider/device proof later. | 904 |
| WF-C5-005 | PARTIAL | Test exact-action request-hash binding and replay/cache rejection; bind official verdict proof to signed artifact. | 905 |
| WF-C5-006 | PARTIAL | Test per-use authentication failure/cancellation; physical OS proof that biometric data never leaves device. | 906 |
| WF-C5-007 | PARTIAL | Review approve/revoke/replace/lost/recovery separation of duties; role-specific UI and device cleanup proof. | 907 |
| WF-C5-008 | PARTIAL | Test QR lifecycle/controller health/skew and permission UI; physical station/device exercise later. | 908 |
| WF-C5-013 | PLANNED | Write relay/screen-share attack matrix and residual-risk criteria; execute with approved physical setup. | 913 |
| WF-C9-001 | BLOCKED | Resolve canonical Android repository/package/signing/distribution ownership and device matrix. | 993 |
| WF-C9-003 | PARTIAL | One-action Today state transitions and server-truth recovery contract; signed-device validation later. | 995 |
| WF-C9-004 | PARTIAL | Pending/conflict/review/correction day-history state fixtures; signed-device navigation proof later. | 996 |
| WF-C9-005 | PARTIAL | Leave/absence/correction/cancellation privacy-safe request history and recovery cases. | 997 |
| WF-C9-006 | PARTIAL | Encrypted outbox ordering/op-id/retry/logout/tenant-switch tests plus process-death/reboot device proof. | 998 |
| WF-C9-007 | PARTIAL | Permission and action-time capture boundaries; physical Finish/off-shift stop proof. | 999 |
| WF-C9-008 | PARTIAL | Fresh QR immediate path, expired token rejection and no raw-token persistence tests. | 1000 |
| WF-C9-009 | PARTIAL | Enrollment/exact-action signature/revoke cleanup corpus; attested signed-device lifecycle proof. | 1001 |
| WF-C9-010 | PARTIAL | Offline/conflict recovery matrix with explicit re-scan/re-capture, no stale proof reuse. | 1002 |
| WF-C9-011 | PARTIAL | Minimized notification payload and timing tests; provider delivery/device observation later. | 1003 |
| WF-C9-012 | PARTIAL | AZ/RU/EN/TalkBack/200%font/48dp/reduced-motion/color-independent physical matrix. | 1004 |
| WF-C9-013 | PARTIAL | Crash/sync payload allowlist and secret/location canaries, bound to build/app/device class only. | 1005 |
| WF-C9-014 | PARTIAL | Version-window/outbox-drain/upgrade protocol fixtures; signed install/update/lost-device proof. | 1006 |
| WF-C14-004 | BLOCKED | Run two approved signed physical Android device classes including date rollover/process death/reboot. | 1115 |

## authorization_security — 6 items

Dependency: Granular policy enforcement, accountable privilege review, per-use step-up, finite security alerts and purpose-scoped evidence access.

Baseline boundary: Dormant source and pure tests can proceed; operational grants/access changes require scoped approval; full DB RLS acceptance uses authoritative staging.

| Task | Current status | Next artifact / acceptance step | Canonical line |
| --- | --- | --- | --- |
| WF-C5-002 | PARTIAL | Negative tests for per-use step-up, recovery/reset audit and critical-action bypass attempts. | 902 |
| WF-C5-009 | PARTIAL | Finite anomaly vocabulary and bounded review queue tests; do not enable automatic discipline. | 909 |
| WF-C5-011 | PARTIAL | Boundary tests for rate/nonce/expiry/redaction and alert payload; key rotation/delivery require scoped operation. | 911 |
| WF-C7-002 | PARTIAL | Build granular role/action deny matrix and check each boundary; no grants changed. | 949 |
| WF-C7-010 | PARTIAL | Prepare privileged assignment review report and accountable stale-access decision; disable only with scoped approval. | 957 |
| WF-C10-006 | PARTIAL | Purpose/reason/log and review tests for raw-evidence access with role denial cases. | 1025 |

## schedule_configuration — 4 items

Dependency: Versioned overnight/split and future-effective bulk/cover/recurrence contracts, immutable old hashes, safe preview and publish semantics.

Baseline boundary: Source and UI preparation independent of api_keys; new policy scope/DB changes and activation require own review. Existing release-one exclusion must not be silently reversed.

| Task | Current status | Next artifact / acceptance step | Canonical line |
| --- | --- | --- | --- |
| WF-C3-006 | PLANNED | Keep release-one overnight/split exclusion; prepare versioned segment contract and historical-hash fixtures only until scope approval. | 863 |
| WF-C3-009 | PARTIAL | Exercise bulk/cover/recurrence preview conflict and idempotency cases without publication. | 866 |
| WF-C7-007 | PARTIAL | Future-effective draft/preview/conflict tests with unchanged published history and reversible drafts. | 954 |
| WF-C8-007 | PARTIAL | Policy editor defaults/validation/preview tests; do not publish new schedule scope. | 977 |

## exception_workflow — 10 items

Dependency: Published schedule/calendar eligibility, immutable case lifecycle, scoped queue and employee appeal, bounded corrections/reminder policy, real operational outcomes.

Baseline boundary: Dormant implementation and selected tests independent of api_keys; full historical RLS/staging and reminder delivery/pilot measurement remain separate dependent acceptance.

| Task | Current status | Next artifact / acceptance step | Canonical line |
| --- | --- | --- | --- |
| WF-C6-002 | PARTIAL | Verify dedup, immutable decision chain and cross-tenant link rejection in isolated lifecycle tests. | 927 |
| WF-C6-003 | PARTIAL | No-show eligibility matrix: published schedule, grace, calendar, approved leave and replay dedup. | 928 |
| WF-C6-004 | PARTIAL | Define stale-open/missed-checkout state table; verify proposal bounds without auto-close activation. | 929 |
| WF-C6-005 | PARTIAL | Queue tests for team/site scope, age/risk/evidence and permitted next actions. | 930 |
| WF-C6-006 | PARTIAL | Employee appeal/correction exact-day linkage, ownership and immutable response tests. | 931 |
| WF-C6-007 | PARTIAL | Boundary tests for configured date/duration/range correction limits and manual provenance. | 932 |
| WF-C6-009 | PARTIAL | Privacy-safe reminder payload and dedup/cursor tests; actual delivery and escalation approval separate. | 934 |
| WF-C6-010 | PLANNED | Define aggregate false-positive/overturn/resolution denominators; collect outcomes only during approved observation. | 935 |
| WF-C8-002 | PARTIAL | Scheduled-roster empty/no-show/previous-open UI scenarios, including employees with no workday. | 972 |
| WF-C8-005 | PARTIAL | Role-specific workbench/appeal states and evidence minimization browser checks. | 975 |

## web_accessibility_privacy — 5 items

Dependency: Permission-separated web surfaces, finite error/recovery/empty states, three-language keyboard/focus/contrast/responsive/zoom and restricted evidence UX.

Baseline boundary: Bounded browser/source work independent of missing api_keys creation. Full role flows depend on security/exception contracts; real AT/device evidence cannot be inferred from geometry.

| Task | Current status | Next artifact / acceptance step | Canonical line |
| --- | --- | --- | --- |
| WF-C8-008 | PARTIAL | Permission-separated proof-policy/QR/device UI negative and recovery cases. | 978 |
| WF-C8-009 | PARTIAL | Restricted evidence purpose/audit flow and normal verdict-only rendering checks. | 979 |
| WF-C8-010 | PARTIAL | AZ/RU/EN keyboard/focus/contrast/200%zoom/responsive/error-state browser matrix; record AT separately. | 980 |
| WF-C10-008 | PARTIAL | Employee capture/permission/retention/correction explanations in all three languages and accessibility checks. | 1027 |
| WF-C14-003 | PLANNED | Run employee/manager/HR/security browser matrix against authorized isolated environment; geometry alone not AT proof. | 1114 |

## retention_data_rights — 5 items

Dependency: Retention/legal-hold fail-closed policy, accountable dry runs/purge/audit, data-subject workflows and minimized telemetry/incident response.

Baseline boundary: Pure policy and dry-run/source contracts can proceed. Destructive operations/backup access are not authorized; actual historical schema/restore proof needs authoritative staging.

| Task | Current status | Next artifact / acceptance step | Canonical line |
| --- | --- | --- | --- |
| WF-C10-004 | PARTIAL | Retention eligible-class and legal-hold fail-closed pure tests; real deletion remains separately authorized. | 1023 |
| WF-C10-005 | PARTIAL | Dry-run/batch/resume/pressure-stop fixtures; authoritative restore verification before destructive exercise. | 1024 |
| WF-C10-009 | PLANNED | Redacted subject/tenant export and deactivation contract with third-party separation; no destructive action. | 1028 |
| WF-C10-010 | PARTIAL | Incident tabletop packet with exposure scope, revocation/notification authority and minimized evidence. | 1029 |
| WF-C10-011 | PLANNED | Metric schema allowlist and location/reason/identity canary tests before analytics wiring. | 1030 |

## approved_export_delivery — 1 items

Dependency: Purpose/recipient/scope plus encrypted delivery and expiry; distinguish prepared session download from proven recipient delivery.

Baseline boundary: Contract/source preparation independent of api_keys. External destination/delivery/credentials and release approval are separate; do not manufacture a delivery manifest.

| Task | Current status | Next artifact / acceptance step | Canonical line |
| --- | --- | --- | --- |
| WF-C11-004 | PARTIAL | Purpose/recipient/scope/expiry manifest contract; prove approved encrypted delivery, not merely download preparation. | 1046 |

## reliability_operations — 9 items

Dependency: Tenant baseline, finite metrics, load/isolation/fairness, dormant jobs and eligible roster, query-plan/storage/restore and reconciliation/rollback exercises.

Baseline boundary: Monitoring source and synthetic tests independent of clean-history replay. Representative historical staging/restore/5k load and runtime schedule/alert delivery are separate gates; api_keys blocks this full-history evidence route, not all implementation.

| Task | Current status | Next artifact / acceptance step | Canonical line |
| --- | --- | --- | --- |
| WF-C0-005 | PARTIAL | Prepare fixed aggregate baseline query set; record NOT RUN until scoped telemetry read is approved. | 778 |
| WF-C12-002 | PARTIAL | Finite metric dimensions/redaction tests and dormant roster aggregates; runtime collection remains unproven. | 1066 |
| WF-C12-003 | PLANNED | Prepare deterministic 5000-user jittered trust-off/on load driver; run representative wave only after baseline/staging approval. | 1067 |
| WF-C12-004 | PARTIAL | Inject 503/timeout/overload in separate Workforce/Route queues and prove cursor/failure independence. | 1075 |
| WF-C12-005 | PARTIAL | Boundary tests for fairness/retry/payload/batch/poison quarantine and overload recovery. | 1076 |
| WF-C12-006 | PARTIAL | Dormant lease/cursor/stale-job contracts and roster diagnostic now; schedule/delivery only after activation approval. | 1077 |
| WF-C12-007 | PARTIAL | Schema-only baseline contract now; then representative plans/storage forecast and approved RTO/RPO restore drill. | 1078 |
| WF-C12-008 | PARTIAL | This slice: complete eligible-roster snapshot + unknown boundaries; then historical reconciliation/rollback and operational evidence. | 1079 |
| WF-C12-009 | PARTIAL | Freeze/cohort/offline-drain tabletop and synthetic rollback; approved representative exercise remains required. | 1080 |

## compatibility_rollout — 4 items

Dependency: Four entitlement modes, migration/rollback window, legacy adoption+offline drain and zero unexplained before/after fact deltas.

Baseline boundary: Source protocol and isolated tests can proceed. Real historical migration rehearsal needs authoritative baseline; deprecation awaits adopted artifact/outbox evidence and scoped release.

| Task | Current status | Next artifact / acceptance step | Canonical line |
| --- | --- | --- | --- |
| WF-C13-006 | PARTIAL | Neither/HRM-only/Routes-only/Both source/API/job/nav/sync failure matrix with Route regression protection. | 1098 |
| WF-C13-007 | PARTIAL | Version-window/freeze/rollback protocol without schema deletion; authoritative historical rehearsal later. | 1099 |
| WF-C13-008 | PLANNED | Prepare unsupported-version transition contract; no legacy deprecation before adoption and offline horizon receipts. | 1100 |
| WF-C13-009 | PLANNED | Prepare count/hash/approval/tenant/report comparison manifest; accept only zero unexplained deltas on authoritative baseline. | 1101 |

## integrated_security_pilot_release — 7 items

Dependency: Integrated security and staging drills; named cohort/policies/notices/devices/rollback owner, bounded activation, observed exit review and expansion.

Baseline boundary: Preparation can proceed. Completion depends on earlier source+staging+physical/privacy gates, named owner decisions, and separate release/activation authorization; not a single api_keys-only dependency.

| Task | Current status | Next artifact / acceptance step | Canonical line |
| --- | --- | --- | --- |
| WF-C14-002 | PARTIAL | Combine tenant/role/IDOR/replay/backdating/relay/spoof/admin-abuse negative corpus; retain physical/provider evidence gaps. | 1113 |
| WF-C14-006 | PLANNED | Execute load/chaos/reconciliation/backup/retention/export drills after each environment/operation is approved. | 1117 |
| WF-C14-007 | BLOCKED | Record named cohort/participants/devices/policies/sites/notice/window/rollback owner outside public git. | 1118 |
| WF-C14-008 | PLANNED | Request exact-cohort activation only after gates; preserve write fence and Route independence, review daily. | 1119 |
| WF-C14-009 | PLANNED | Evaluate observed pilot usability/errors/appeals/loss/privacy/SLO against predefined exit criteria. | 1120 |
| WF-C14-010 | PLANNED | Request official release only after green gates; preserve initial ban on automatic payroll/discipline. | 1121 |
| WF-C14-011 | PLANNED | After HRM-only exit, request Both tenant cohort and evaluate measured tenant-by-tenant expansion. | 1122 |

## Concrete next external authorization

First finish and review the source-only candidate. To investigate the missing historical baseline afterward, identify one already-restored isolated Contabo copy and approve only the committed read-only catalog-plus-ledger export through an existing approved operator/service. No raw dump upload, SSH, restore, production query, new credential/grant or migration mutation is included. If that scope is unavailable, proceed with the independent metric/fault/role source slices above.
